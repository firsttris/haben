import { ACCOUNTS } from "@haben/core";
import { eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";
import { storeLegacyOrder, storeLegacyVoucher } from "../archiv/index.ts";
import { addImportedCashEntries, lockCash, type ImportedCashEntry } from "../bank/index.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import type { ExternalImport, ExternalInvoice, ExternalQuote } from "./external-schema.ts";
import { ExternalImportError, validateExternalImport } from "./external-validation.ts";

/** Quellidentität und Hash sind unabhängig von JSON-Eigenschaftsreihenfolgen. */
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

export interface ExternalImportResult {
  created: number;
  duplicates: number;
  items: { kind: "quote" | "invoice" | "journal"; externalId: string; id: string }[];
}

/** Originale bleiben im gemeinsamen Umzugsbestand; die Belegnummer ist keine Quellidentität. */
async function storeOriginal(tx: Tx, source: string, entry: ExternalInvoice | ExternalQuote, importId: string, bytes: Uint8Array) {
  if (entry.contactId) {
    const [contact] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, entry.contactId));
    if (!contact) throw new ExternalImportError("Der zugeordnete Kontakt fehlt.");
  }
  // Namespace des lokalen Betreibereingangs, keine nachgebildete Anbieterkennung.
  const externalKey = `import:${importPayloadHash([source, entry.kind, entry.externalId])}`;
  const originals = [{ role: "pdf" as const, sourceFileId: null, filename: `${entry.number}.pdf`, mimeType: "application/pdf", bytes: bytes }];
  const raw = { ...entry, sourceName: source };
  if (entry.kind === "quote") {
    const stored = await storeLegacyOrder(
      tx,
      {
        source: "import",
        externalId: externalKey,
        importId,
        kind: entry.documentKind,
        number: entry.number,
        date: entry.date,
        status: entry.status,
        contactId: entry.contactId,
        contactName: entry.contactName,
        currency: entry.currency,
        net: entry.net,
        tax: entry.tax,
        gross: entry.gross,
        raw,
      },
      originals,
    );
    if (!stored) throw new ExternalImportError("Quellidentität ohne Herkunftsnachweis bereits vorhanden.");
    return { orderDocumentId: stored.id };
  } else {
    const payment = entry.payment
      ? {
          status: entry.payment.openAmount === 0 ? "balanced" : "open",
          openAmount: entry.payment.openAmount,
          paidDate: entry.payment.paidDate,
          items: [],
        }
      : null;
    const stored = await storeLegacyVoucher(
      tx,
      {
        source: "import",
        lexofficeId: externalKey,
        importId,
        type: entry.type,
        direction: entry.direction,
        number: entry.number,
        date: entry.date,
        dueDate: entry.dueDate,
        serviceFrom: entry.serviceFrom,
        serviceTo: entry.serviceTo,
        status: entry.status,
        contactId: entry.contactId,
        contactName: entry.contactName,
        currency: entry.currency,
        net: entry.net,
        tax: entry.tax,
        gross: entry.gross,
        taxes: entry.taxes,
        categories: entry.categories,
        payment,
        remark: entry.note,
        raw,
      },
      originals,
      (entry.payment?.items ?? []).map((p, index) => ({
        externalId: `import:${importPayloadHash([source, entry.externalId, index])}`,
        date: p.date,
        amount: p.amount,
        accountName: p.account,
        evidence: { ...p, sourceName: source, sourceDocumentId: entry.externalId },
      })),
    );
    if (!stored) throw new ExternalImportError("Quellidentität ohne Herkunftsnachweis bereits vorhanden.");
    return { voucherId: stored.id };
  }
}

/** Gemeinsamer Umzugsbestand und vorhandener Buchungskern, ohne neue Rechnungen oder zusätzliche EÜR-Quelle. */
export async function runExternalImport(
  actor: string,
  input: ExternalImport,
  fileForHash: (hash: string) => Promise<Uint8Array>,
): Promise<ExternalImportResult> {
  const { parsed, files } = await validateExternalImport(input, fileForHash);
  return withActor(actor, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`external-import:${parsed.source}`}, 0))`);
    await lockCash(tx);
    const company = await openBooks(tx);
    if (company.kontenrahmen !== parsed.kontenrahmen) throw new ExternalImportError("Paket und Firma verwenden unterschiedliche Kontenrahmen.");
    const previous = await tx.select().from(schema.externalImports).where(eq(schema.externalImports.source, parsed.source));
    const known = new Map(previous.map((r) => [`${r.kind}:${r.externalId}`, r]));
    if (parsed.entries.some((e) => e.kind === "journal" && !known.has(`journal:${e.externalId}`))) {
      const [taken] = await tx.execute<{ id: string }>(sql`select v.id from external_imports o
        join lexoffice_vouchers v on v.id=o.voucher_id where o.source=${parsed.source}
        and (exists (select 1 from invoices i where i.lexoffice_voucher_id=v.id)
          or exists (select 1 from documents d where d.lexoffice_voucher_id=v.id)) limit 1`);
      if (taken) throw new ExternalImportError("Offene Posten dieser Quelle sind schon nativ übernommen. Originaljournal vor weiteren Buchungen abgleichen.");
    }
    const result: ExternalImportResult = { created: 0, duplicates: 0, items: [] };
    const cash: ImportedCashEntry[] = [];
    let importId: string | undefined;
    for (const entry of parsed.entries) {
      const hash = importPayloadHash({ version: parsed.version, kontenrahmen: parsed.kontenrahmen, entry });
      const old = known.get(`${entry.kind}:${entry.externalId}`);
      if (old) {
        if (old.payloadHash !== hash)
          throw new ExternalImportError(`Quellvorgang ${entry.externalId} ist verändert; der importierte Stand bleibt unverändert.`);
        result.duplicates++;
        result.items.push({ kind: entry.kind, externalId: entry.externalId, id: (old.voucherId ?? old.orderDocumentId ?? old.entryId)! });
        continue;
      }
      if (!importId) {
        const [row] = await tx
          .insert(schema.lexofficeImports)
          .values({
            source: "import",
            status: "fertig",
            finishedAt: new Date(),
            progress: { phase: "fertig", contacts: 0, contactsLinked: 0, listed: parsed.entries.length, imported: 0, skipped: 0, files: 0, failed: [] },
          })
          .returning({ id: schema.lexofficeImports.id });
        importId = row!.id;
      }
      const id = randomUUID();
      let target: { voucherId?: string; orderDocumentId?: string; entryId?: string };
      if (entry.kind === "journal") {
        const entryId = await post(tx, company, { date: entry.date, description: entry.description, sourceType: "import", sourceId: id, lines: entry.lines });
        target = { entryId };
        const amount = entry.lines.filter((l) => l.account === ACCOUNTS[company.kontenrahmen].kasse).reduce((n, l) => n + l.debit - l.credit, 0);
        if (amount !== 0) cash.push({ date: entry.date, amount, text: entry.description, journalEntryId: entryId });
      } else {
        target = await storeOriginal(tx, parsed.source, entry, importId, files.get(entry.pdfSha256)!);
      }
      await tx
        .insert(schema.externalImports)
        .values({ id, source: parsed.source, externalId: entry.externalId, kind: entry.kind, payloadHash: hash, ...target, payload: entry });
      result.created++;
      result.items.push({ kind: entry.kind, externalId: entry.externalId, id: (target.voucherId ?? target.orderDocumentId ?? target.entryId)! });
    }
    await addImportedCashEntries(tx, cash);
    if (importId)
      await tx
        .update(schema.lexofficeImports)
        .set({
          progress: {
            phase: "fertig",
            contacts: 0,
            contactsLinked: 0,
            listed: parsed.entries.length,
            imported: result.created,
            skipped: result.duplicates,
            files: result.items.filter((i) => i.kind !== "journal" && !known.has(`${i.kind}:${i.externalId}`)).length,
            failed: [],
          },
        })
        .where(eq(schema.lexofficeImports.id, importId));
    return result;
  });
}
