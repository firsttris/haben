import { SevdeskApiError, type SevdeskClient, type SevOrder } from "@haben/import";
import { eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { sha256Of, storeFile } from "../../storage.ts";
import { OrderArchiveError } from "./orders.ts";

const STATE_FIELDS = [
  "id",
  "orderType",
  "status",
  "version",
  "sendDate",
  "sendType",
  "update",
  "orderNumber",
  "orderDate",
  "currency",
  "sumNet",
  "sumTax",
  "sumGross",
  "sumNetForeignCurrency",
  "sumTaxForeignCurrency",
  "sumGrossForeignCurrency",
  "address",
] as const;
const reference = (value: unknown) =>
  value && typeof value === "object" && "id" in value && "objectName" in value ? { id: String(value.id), objectName: value.objectName } : value;
const changes = (a: SevOrder, b: SevOrder) => [
  ...STATE_FIELDS.filter((key) => String(a[key] ?? "") !== String(b[key] ?? "")),
  ...[...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) => !STATE_FIELDS.includes(key as (typeof STATE_FIELDS)[number]) && !isDeepStrictEqual(reference(a[key]), reference(b[key])),
  ),
];
const message = (error: unknown) => (error instanceof Error ? error.message : "Unbekannter Fehler beim PDF-Abruf.");
const authenticationFailure = (error: unknown) => error instanceof SevdeskApiError && (error.status === 401 || error.status === 403);

/** Vor jedem fehlenden PDF frisch prüfen. API-Pfad /api/v1 sagt nichts über die Buchhaltungsversion aus. */
export function createOrderPdfImporter(actor: string, client: SevdeskClient, signal: AbortSignal) {
  let stopped = false;
  return async (externalId: string): Promise<boolean> => {
    if (stopped) return false;
    const [document] = await db.select().from(schema.legacyOrderDocuments).where(eq(schema.legacyOrderDocuments.externalId, externalId));
    if (!document) throw new OrderArchiveError("Archivdokument nicht gefunden.");
    const [file] = await db
      .select({ id: schema.legacyOrderFiles.id })
      .from(schema.legacyOrderFiles)
      .where(eq(schema.legacyOrderFiles.orderId, document.id))
      .limit(1);
    if (file) return false;
    const stop = (error: unknown): never => {
      stopped = true;
      if (signal.aborted || authenticationFailure(error)) throw error;
      throw new OrderArchiveError(`${message(error)} Weitere automatische Auftrags-PDFs sind für diesen Abruf ausgesetzt.`);
    };
    let before: SevOrder;
    try {
      const version = await client.bookkeepingSystemVersion();
      if (version !== "1.0")
        throw new OrderArchiveError(
          `Kein automatischer Auftrags-PDF-Abruf: Buchhaltungsversion ${version || "unbekannt"} ist nicht geprüft. Original-PDFs können manuell ergänzt werden.`,
        );
      before = await client.order(document.externalId);
    } catch (error) {
      return stop(error);
    }
    // Bis hier wurde kein PDF angefragt: die Abweichung betrifft nur dieses Dokument und setzt die übrigen nicht aus,
    // sonst sperrt ein einziges später bearbeitetes Dokument den Nachabruf bei jedem neuen Lauf.
    if (changes(document.raw.order as SevOrder, before).length)
      throw new OrderArchiveError("sevDesk-Dokument seit Archivierung verändert. PDF dem archivierten Stand nach Prüfung manuell zuordnen.");
    try {
      return await retrievePdf(actor, client, document, before);
    } catch (error) {
      return stop(error);
    }
  };
}

async function retrievePdf(
  actor: string,
  client: SevdeskClient,
  document: typeof schema.legacyOrderDocuments.$inferSelect,
  before: SevOrder,
): Promise<boolean> {
  let after: SevOrder | null = null;
  let pdf: Awaited<ReturnType<SevdeskClient["orderPdf"]>> = null;
  let failure: unknown;
  try {
    pdf = await client.orderPdf(document.externalId);
  } catch (error) {
    failure = error;
  }
  // Auch ein fehlgeschlagener PDF-Aufruf kann die Quelle beeinflusst haben. Kein zweiter PDF-Versuch.
  try {
    after = await client.order(document.externalId);
  } catch (error) {
    if (!failure || authenticationFailure(error)) failure = error;
  }
  const changed = after ? [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !isDeepStrictEqual(before[key], after[key])) : [];
  if (changed.length && !authenticationFailure(failure))
    failure = new OrderArchiveError(`Quelländerung beim PDF-Abruf: ${changed.join(", ")}. PDF wurde nicht zugeordnet.`);
  if (!after) failure ??= new OrderArchiveError("Nachkontrolle des PDF-Abrufs nicht möglich.");
  if (!failure && (!pdf || pdf.bytes.byteLength > 20 * 1024 * 1024 || !Buffer.from(pdf.bytes.subarray(0, 5)).equals(Buffer.from("%PDF-"))))
    failure = new OrderArchiveError("sevDesk hat kein gültiges PDF mit höchstens 20 MB geliefert.");
  if (!failure && pdf) {
    try {
      await storeFile(pdf.bytes);
    } catch (error) {
      failure = error;
    }
  }
  const added = await withActor(actor, async (tx) => {
    await tx
      .insert(schema.legacyOrderPdfAttempts)
      .values({ orderId: document.id, bookkeepingVersion: "1.0", before, after, error: failure ? message(failure) : null });
    if (failure || !pdf) return false;
    const rows = await tx
      .insert(schema.legacyOrderFiles)
      .values({
        orderId: document.id,
        filename: (pdf.filename || `${document.number || document.externalId}.pdf`).slice(0, 200),
        mimeType: "application/pdf",
        sha256: sha256Of(pdf.bytes),
        size: pdf.bytes.byteLength,
        origin: "sevdesk",
      })
      .onConflictDoNothing({ target: [schema.legacyOrderFiles.orderId, schema.legacyOrderFiles.sha256] })
      .returning({ id: schema.legacyOrderFiles.id });
    return rows.length > 0;
  });
  if (failure) throw failure;
  return added;
}
