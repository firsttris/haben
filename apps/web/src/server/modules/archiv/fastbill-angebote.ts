import { FastbillApiError, type FastbillClient, mapFbEstimate } from "@haben/import";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import type { LegacyOriginalFile } from "./legacy-store.ts";
import { storeLegacyOrder } from "./legacy-store.ts";
import { sha256Of, storeFile } from "../../storage.ts";
import { FastbillError } from "./fastbill-zugang.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Angebote aus FastBill als Auftragsdokumente im Archiv (legacy_order_documents, source fastbill), wie die aus sevDesk:
 * ohne Buchungswirkung, mit dem PDF hinter DOCUMENT_URL. Das PDF lädt FastBill bei Angeboten ohne Anmeldung (echtes Konto,
 * November 2026). Liefert es keins, kommt das Angebot trotzdem ins Archiv und das PDF lässt sich von Hand nachreichen.
 * Schon archivierte Angebote überspringt ein neuer Abruf an ihrer Kennung fastbill/estimate/<ID>.
 */

// Ein abgelehnter Download-Link betrifft nur dieses Angebot, nicht die Anmeldung (wie stopsRun in fastbill.ts)
const fatal = (error: unknown, signal: AbortSignal) =>
  signal.aborted ||
  (error instanceof Error && error.name === "AbortError") ||
  (error instanceof FastbillApiError && error.service !== "document" && (error.status === 401 || error.status === 403));

/** Wie beim Nachreichen von Hand (attachOrderPdf): nur ein PDF bis 20 MB, sonst gilt das PDF als fehlend */
const isPdf = (bytes: Uint8Array) =>
  bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024 && Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from("%PDF-"));

export async function importFastbillEstimates(
  actor: string,
  importId: string,
  client: FastbillClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<void> {
  const result = { imported: 0, known: 0, withoutPdf: 0, pdfNachgeholt: 0 };
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
        .select({ id: schema.legacyOrderDocuments.id, raw: schema.legacyOrderDocuments.raw })
        .from(schema.legacyOrderDocuments)
        .where(eq(schema.legacyOrderDocuments.externalId, mapped.externalId));
      if (known) {
        result.known += 1;
        try {
          if (await retryPdf(actor, client, { orderId: known.id, archived: known.raw, current: mapped.raw, number: mapped.number }, raw.DOCUMENT_URL))
            result.pdfNachgeholt += 1;
        } catch (error) {
          if (fatal(error, signal)) throw error;
          progress.failed.push({ lexofficeId: mapped.externalId, number: label, message: `PDF nicht nachgeholt: ${progressMessage(error)}` });
        }
        continue;
      }
      try {
        const download = raw.DOCUMENT_URL ? await client.document(raw.DOCUMENT_URL) : null;
        const pdf = download && isPdf(download.bytes) ? download : null;
        const files: LegacyOriginalFile[] = pdf
          ? [{ role: "pdf", sourceFileId: null, filename: pdf.filename ?? `${mapped.number}.pdf`, mimeType: pdf.mimeType, bytes: pdf.bytes }]
          : [];
        const stored = await withActor(actor, async (tx) => {
          const [contact] = mapped.customerId
            ? await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.fastbillId, mapped.customerId))
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

/**
 * Fehlt einem archivierten Angebot das PDF, versucht der nächste Abruf es erneut (#1541). Angebote mit Datei bleiben
 * unberührt; angehängt wird nur, nie ersetzt (legacy_order_files ist nur anhängen).
 */
async function retryPdf(
  actor: string,
  client: FastbillClient,
  order: { orderId: string; archived: Record<string, unknown>; current: Record<string, unknown>; number: string },
  documentUrl: string | null | undefined,
): Promise<boolean> {
  const { orderId } = order;
  if (!documentUrl) return false;
  const [file] = await db.select({ id: schema.legacyOrderFiles.id }).from(schema.legacyOrderFiles).where(eq(schema.legacyOrderFiles.orderId, orderId)).limit(1);
  if (file) return false;
  // Wie bei sevDesk (order-pdfs.ts): Ein seit der Archivierung geändertes Angebot bekäme ein PDF, das nicht zum Archiv passt.
  // Nur der Status darf weiter sein (etwa von created zu sent).
  if (sameEstimate(order.archived) !== sameEstimate(order.current))
    throw new FastbillError("Angebot seit der Archivierung in FastBill geändert. PDF nach Prüfung von Hand nachreichen.");
  const download = await client.document(documentUrl);
  if (!download || !isPdf(download.bytes)) return false;
  await storeFile(download.bytes);
  await withActor(actor, (tx) =>
    tx
      .insert(schema.legacyOrderFiles)
      .values({
        orderId,
        origin: "fastbill",
        filename: (download.filename ?? `${order.number}.pdf`).slice(0, 200),
        mimeType: download.mimeType,
        sha256: sha256Of(download.bytes),
        size: download.bytes.byteLength,
      })
      .onConflictDoNothing(),
  );
  return true;
}

/** Vergleichsform eines Angebots ohne Status, mit sortierten Schlüsseln */
function sameEstimate(raw: Record<string, unknown>): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
          )
        : value;
  const { STATE: _, ...rest } = raw;
  return JSON.stringify(sorted(rest));
}
