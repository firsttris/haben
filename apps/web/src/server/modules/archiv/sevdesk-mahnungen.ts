import { isSevDunning, mapSevDunning, SevdeskApiError, type SevdeskClient, type SevInvoice } from "@haben/import";
import { eq, inArray, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { sha256Of, storeFile } from "../../storage.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Mahnungen aus sevDesk ins Archiv (#472). Je Stufe eine Zeile in legacy_dunnings mit PDF, verbunden mit der gemahnten
 * Rechnung über deren Kennung. Keine Forderung, keine Buchung: Abgleich, offene Posten, Umsatzsteuer und EÜR lesen nur
 * lexoffice_vouchers. Das PDF kommt wie bei Rechnungen über getPdf mit preventSendBy.
 */

function isFatal(error: unknown, signal: AbortSignal): boolean {
  if (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403)) return true;
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

export async function importSevdeskDunnings(
  actor: string,
  importId: string,
  client: SevdeskClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<void> {
  const listed: SevInvoice[] = [];
  try {
    for await (const raw of client.dunnings()) if (isSevDunning(raw)) listed.push(raw);
  } catch (error) {
    if (isFatal(error, signal)) throw error;
    // Mahnungen sind nur Archiv: Ein Fehler darf den übrigen Abruf nicht verhindern
    progress.failed.push({ lexofficeId: "dunning", number: "Mahnungen", message: progressMessage(error) });
    return;
  }
  if (listed.length === 0) return;
  // Schon archivierte Mahnungen; die ohne Datei bekommen ihr PDF nachgeladen, ihre Zeile bleibt unverändert
  const known = new Map(
    (
      await db
        .select({
          externalId: schema.legacyDunnings.externalId,
          id: schema.legacyDunnings.id,
          hasFile: sql<boolean>`exists (select 1 from legacy_dunning_files f where f.dunning_id = legacy_dunnings.id)`,
        })
        .from(schema.legacyDunnings)
        .where(
          inArray(
            schema.legacyDunnings.externalId,
            listed.map((raw) => `invoice/${raw.id}`),
          ),
        )
    ).map((r) => [r.externalId, r]),
  );
  for (const raw of listed) {
    const externalId = `invoice/${raw.id}`;
    const archived = known.get(externalId);
    if (archived?.hasFile) continue;
    try {
      if (archived) await addMissingPdf(actor, client, raw, archived.id, progress);
      else if (await importDunning(actor, importId, client, raw, progress)) progress.dunnings = (progress.dunnings ?? 0) + 1;
    } catch (error) {
      if (isFatal(error, signal)) throw error;
      progress.failed.push({ lexofficeId: externalId, number: raw.invoiceNumber ?? "", message: progressMessage(error) });
    }
  }
}

async function importDunning(actor: string, importId: string, client: SevdeskClient, raw: SevInvoice, progress: LexofficeImportProgress): Promise<boolean> {
  const dunning = mapSevDunning(raw);
  const pdf = await client.invoicePdf(String(raw.id));
  return withActor(actor, async (tx) => {
    const [contact] = dunning.contactSevdeskId
      ? await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.sevdeskId, dunning.contactSevdeskId))
      : [];
    const [row] = await tx
      .insert(schema.legacyDunnings)
      .values({
        externalId: dunning.externalId,
        source: "sevdesk",
        importId,
        invoiceExternalId: dunning.invoiceExternalId,
        level: dunning.level,
        number: dunning.number,
        date: dunning.date,
        dueDate: dunning.dueDate,
        sentDate: dunning.sentDate,
        status: dunning.status,
        contactId: contact?.id ?? null,
        contactName: dunning.contactName,
        currency: dunning.currency,
        total: dunning.total,
        raw: raw as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: schema.legacyDunnings.externalId })
      .returning({ id: schema.legacyDunnings.id });
    // Ein gleichzeitiger Lauf hat die Mahnung schon archiviert
    if (!row) return false;
    if (pdf) await storePdf(tx, row.id, dunning.number || dunning.externalId, pdf, progress);
    return true;
  });
}

type Pdf = NonNullable<Awaited<ReturnType<SevdeskClient["invoicePdf"]>>>;

async function storePdf(tx: Tx, dunningId: string, name: string, pdf: Pdf, progress: LexofficeImportProgress): Promise<void> {
  const sha256 = sha256Of(pdf.bytes);
  await storeFile(pdf.bytes);
  const base = name.replace(/[^\w.-]+/g, "_");
  const [file] = await tx
    .insert(schema.legacyDunningFiles)
    .values({
      dunningId,
      filename: (pdf.filename ?? `Mahnung_${base}.pdf`).slice(0, 200),
      mimeType: pdf.mimeType.split(";")[0]!.trim() || "application/pdf",
      sha256,
      size: pdf.bytes.byteLength,
    })
    .onConflictDoNothing({ target: [schema.legacyDunningFiles.dunningId, schema.legacyDunningFiles.sha256] })
    .returning({ id: schema.legacyDunningFiles.id });
  if (file) progress.files += 1;
}

/** PDF einer schon archivierten Mahnung, das beim früheren Abruf fehlte; nur anhängend in legacy_dunning_files */
async function addMissingPdf(actor: string, client: SevdeskClient, raw: SevInvoice, dunningId: string, progress: LexofficeImportProgress): Promise<void> {
  const pdf = await client.invoicePdf(String(raw.id));
  if (!pdf) return;
  await withActor(actor, async (tx) => {
    // Ein gleichzeitiger Lauf kann die Datei schon angehängt haben
    const [present] = await tx
      .select({ id: schema.legacyDunningFiles.id })
      .from(schema.legacyDunningFiles)
      .where(eq(schema.legacyDunningFiles.dunningId, dunningId))
      .limit(1);
    if (!present) await storePdf(tx, dunningId, raw.invoiceNumber?.trim() || `invoice/${raw.id}`, pdf, progress);
  });
}
