import { eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { importIssuedDocument } from "../rechnungen/index.ts";
import { externalImportSchema, type ExternalImport, type ExternalJournal } from "./external-schema.ts";

export class ExternalImportError extends UserError {}

/** Stabile Identität auch dann, wenn JSON-Eigenschaften im Quellsystem anders angeordnet werden. */
export function importPayloadHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function checkJournal(input: ExternalJournal, chart: "SKR03" | "SKR04") {
  const sum = (part: "debit" | "credit") => input.lines.reduce((n, l) => n + l[part], 0);
  if (sum("debit") !== sum("credit") || sum("debit") === 0) throw new ExternalImportError("Die Buchung ist nicht ausgeglichen.");
  if (input.cashFlows.length === 0) return;
  const liquid = chart === "SKR03" ? /^(10|12)\d{2}$/ : /^(16|18)\d{2}$/;
  const movement = input.lines.filter((l) => liquid.test(l.account)).reduce((n, l) => n + l.debit - l.credit, 0);
  if (input.cashFlows.some((f) => f.date !== input.date)) throw new ExternalImportError("EÜR-Zahlung und Buchung haben unterschiedliche Tage.");
  if (input.cashFlows.reduce((n, f) => n + f.amount, 0) !== movement)
    throw new ExternalImportError("EÜR-Zahlungen stimmen nicht mit der Geldbewegung überein.");
  if (input.cashFlows.some((f) => f.category === "anlage" || f.category === "hardware"))
    throw new ExternalImportError("Anlagen werden über den Anlagenimport übernommen, nicht als sofortiger Aufwand.");
}

export interface ExternalImportResult {
  created: number;
  duplicates: number;
  items: { kind: "quote" | "invoice" | "journal"; externalId: string; id: string }[];
}

/** Ein geprüfter Bestand in einer Transaktion. Nie Mailversand, Nummernverbrauch oder eine neue PDF-Ausstellung. */
export async function runExternalImport(
  actor: string,
  input: ExternalImport,
  fileForHash: (hash: string) => Promise<Uint8Array>,
): Promise<ExternalImportResult> {
  const parsed = externalImportSchema.parse(input);
  const keys = parsed.entries.map((e) => `${e.kind}:${e.externalId}`);
  if (new Set(keys).size !== keys.length) throw new ExternalImportError("Eine Quellidentität kommt mehrfach im Paket vor.");
  const files = new Map<string, Uint8Array>();
  for (const entry of parsed.entries) {
    if (entry.kind === "journal") {
      checkJournal(entry, parsed.kontenrahmen);
      continue;
    }
    const bytes = files.get(entry.pdfSha256) ?? (await fileForHash(entry.pdfSha256));
    if (bytes.length > 20 * 1024 * 1024 || !Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from("%PDF-")))
      throw new ExternalImportError("Ungültiges Original-PDF.");
    if (createHash("sha256").update(bytes).digest("hex") !== entry.pdfSha256)
      throw new ExternalImportError("Original-PDF und Herkunfts-Hash stimmen nicht überein.");
    files.set(entry.pdfSha256, bytes);
    if (
      entry.kind === "invoice" &&
      (Math.abs(entry.settledAmount) > Math.abs(entry.gross) || (entry.settledAmount !== 0 && Math.sign(entry.settledAmount) !== Math.sign(entry.gross)))
    )
      throw new ExternalImportError("Ungültiger übernommener Zahlungsstand.");
  }
  return withActor(actor, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`external-import:${parsed.source}`}, 0))`);
    const company = await openBooks(tx);
    if (!company.kleinunternehmer || company.rechtsform !== "einzelunternehmen" || company.kontenrahmen !== parsed.kontenrahmen)
      throw new ExternalImportError("Dieser Import unterstützt derzeit Einzelunternehmen mit Kleinunternehmerprofil im eingestellten Kontenrahmen.");
    const previous = await tx.select().from(schema.externalImports).where(eq(schema.externalImports.source, parsed.source));
    const known = new Map(previous.map((r) => [`${r.kind}:${r.externalId}`, r]));
    const quoteIds = new Map(previous.filter((r) => r.kind === "quote").map((r) => [r.externalId, r.quoteId!]));
    const rank = { quote: 0, invoice: 1, journal: 2 };
    const entries = [...parsed.entries].sort((a, b) => rank[a.kind] - rank[b.kind]);
    const result: ExternalImportResult = { created: 0, duplicates: 0, items: [] };
    for (const entry of entries) {
      const hash = importPayloadHash({ version: parsed.version, kontenrahmen: parsed.kontenrahmen, entry });
      const old = known.get(`${entry.kind}:${entry.externalId}`);
      if (old) {
        if (old.payloadHash !== hash)
          throw new ExternalImportError(`Quellvorgang ${entry.externalId} ist verändert; der importierte Stand bleibt unverändert.`);
        result.duplicates++;
        result.items.push({ kind: entry.kind, externalId: entry.externalId, id: (old.invoiceId ?? old.quoteId ?? old.entryId)! });
        continue;
      }
      const id = randomUUID();
      let target: { invoiceId?: string; quoteId?: string; entryId?: string };
      if (entry.kind === "journal")
        target = {
          entryId: await post(tx, company, {
            date: entry.date,
            description: entry.description,
            sourceType: "import",
            sourceId: id,
            lines: entry.lines.map((l) => ({ ...l, taxCode: null })),
          }),
        };
      else {
        const quoteId = entry.kind === "invoice" && entry.quoteExternalId ? quoteIds.get(entry.quoteExternalId) : null;
        if (entry.kind === "invoice" && entry.quoteExternalId && !quoteId) throw new ExternalImportError("Das verknüpfte Angebot fehlt im Bestand.");
        const document = entry.kind === "quote" ? { ...entry, source: parsed.source } : { ...entry, source: parsed.source, quoteId: quoteId ?? null };
        const targetId = await importIssuedDocument(tx, company, document, files.get(entry.pdfSha256)!);
        target = entry.kind === "quote" ? { quoteId: targetId } : { invoiceId: targetId };
        if (entry.kind === "quote") quoteIds.set(entry.externalId, targetId);
      }
      await tx.insert(schema.externalImports).values({
        id,
        source: parsed.source,
        externalId: entry.externalId,
        kind: entry.kind,
        payloadHash: hash,
        ...target,
        payload: entry,
        settledAmount: entry.kind === "invoice" ? entry.settledAmount : 0,
        paymentUncertain: entry.kind === "invoice" && entry.paymentUncertain,
        cashFlows: entry.kind === "journal" ? entry.cashFlows : [],
      });
      result.created++;
      result.items.push({ kind: entry.kind, externalId: entry.externalId, id: (target.invoiceId ?? target.quoteId ?? target.entryId)! });
    }
    return result;
  });
}
