import { FastbillApiError, type FastbillClient, mapFbEstimate } from "@haben/import";
import { eq, inArray } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import type { LegacyOriginalFile } from "./legacy-store.ts";
import { storeLegacyOrder } from "./legacy-store.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Angebote aus FastBill als Auftragsdokumente im Archiv (legacy_order_documents, source fastbill), wie die aus sevDesk:
 * ohne Buchungswirkung, mit dem PDF hinter DOCUMENT_URL. Das PDF lädt FastBill bei Angeboten ohne Anmeldung (echtes Konto,
 * November 2026). Liefert es keins, kommt das Angebot trotzdem ins Archiv und das PDF lässt sich von Hand nachreichen.
 * Schon archivierte Angebote überspringt ein neuer Abruf an ihrer Kennung fastbill/estimate/<ID>.
 */

const fatal = (error: unknown, signal: AbortSignal) =>
  signal.aborted ||
  (error instanceof Error && error.name === "AbortError") ||
  (error instanceof FastbillApiError && (error.status === 401 || error.status === 403));

export async function importFastbillEstimates(
  actor: string,
  importId: string,
  client: FastbillClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<void> {
  const result = { imported: 0, known: 0, withoutPdf: 0 };
  progress.fastbillEstimates = result;
  try {
    for await (const raw of client.estimates()) {
      const mapped = mapFbEstimate(raw);
      const label = mapped?.number ?? `Angebot ${String(raw.ESTIMATE_ID)}`;
      if (!mapped) {
        progress.failed.push({ lexofficeId: `fastbill/estimate/${String(raw.ESTIMATE_ID)}`, number: label, message: "Angebot ohne Datum nicht übernommen." });
        continue;
      }
      const [known] = await db
        .select({ id: schema.legacyOrderDocuments.id })
        .from(schema.legacyOrderDocuments)
        .where(eq(schema.legacyOrderDocuments.externalId, mapped.externalId));
      if (known) {
        result.known += 1;
        continue;
      }
      try {
        const pdf = raw.DOCUMENT_URL ? await client.document(raw.DOCUMENT_URL) : null;
        const files: LegacyOriginalFile[] = pdf
          ? [{ role: "pdf", sourceFileId: null, filename: pdf.filename ?? `${mapped.number}.pdf`, mimeType: pdf.mimeType, bytes: pdf.bytes }]
          : [];
        const stored = await withActor(actor, async (tx) => {
          const [contact] = mapped.customerId
            ? await tx
                .select({ id: schema.contacts.id })
                .from(schema.contacts)
                .where(inArray(schema.contacts.fastbillId, [mapped.customerId]))
            : [];
          const { customerId: _, ...document } = mapped;
          return storeLegacyOrder(tx, { ...document, source: "fastbill", importId, contactId: contact?.id ?? null }, files);
        });
        if (!stored) result.known += 1;
        else {
          result.imported += 1;
          if (stored.files === 0) result.withoutPdf += 1;
        }
      } catch (error) {
        if (fatal(error, signal)) throw error;
        progress.failed.push({ lexofficeId: mapped.externalId, number: label, message: `Angebot nicht übernommen: ${progressMessage(error)}` });
      }
    }
  } catch (error) {
    if (fatal(error, signal)) throw error;
    progress.failed.push({ lexofficeId: "fastbill/estimate", number: "Angebote", message: progressMessage(error) });
  }
}
