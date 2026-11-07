import { lexDate, lexToCents, type SevdeskClient, type SevOrder } from "@haben/import";
import { and, between, desc, eq, ilike, or, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadFile, sha256Of, storeFile } from "../../storage.ts";

export const ORDER_KINDS = { AN: "Angebot", AB: "Auftragsbestätigung", LI: "Lieferschein" } as const;
export const ORDER_STATUSES: Record<string, string> = {
  "100": "Entwurf",
  "200": "Ausgegeben / versendet",
  "300": "Abgelehnt",
  "500": "Angenommen",
  "750": "Teilweise berechnet",
  "1000": "Vollständig berechnet",
};
export class OrderArchiveError extends UserError {}

export function isImportableOrder(order: SevOrder): order is SevOrder & { orderType: keyof typeof ORDER_KINDS } {
  return Object.hasOwn(ORDER_KINDS, order.orderType ?? "") && [100, 200, 300, 500, 750, 1000].includes(Number(order.status));
}

/** Nur Metadaten-Endpunkte: getPdf kann laut OpenAPI den Quellvorgang verändern. */
export async function importOrder(actor: string, importId: string, client: SevdeskClient, order: SevOrder): Promise<boolean> {
  if (!isImportableOrder(order)) return false;
  const externalId = String(order.id);
  const [existing] = await db
    .select({ id: schema.legacyOrderDocuments.id })
    .from(schema.legacyOrderDocuments)
    .where(eq(schema.legacyOrderDocuments.externalId, externalId));
  if (existing) return false;
  const date = lexDate(order.orderDate);
  if (!date) throw new OrderArchiveError(`Auftragsdokument ${externalId}: Belegdatum fehlt oder ist ungültig.`);
  const positions = await client.orderPositions(externalId);
  const relatedObjects = await client.orderRelatedObjects(externalId);
  return withActor(actor, async (tx) => {
    const [contact] = order.contact
      ? await tx
          .select({ id: schema.contacts.id, name: schema.contacts.name })
          .from(schema.contacts)
          .where(eq(schema.contacts.sevdeskId, String(order.contact.id)))
      : [];
    const amount = (value: string | number | null | undefined) => {
      if (value == null || String(value).trim() === "") return null;
      const number = typeof value === "number" ? value : Number(value.replace(",", "."));
      if (!Number.isFinite(number) || !Number.isSafeInteger(lexToCents(number))) throw new OrderArchiveError("Ungültiger Quellbetrag im Auftragsdokument.");
      return lexToCents(number);
    };
    const [row] = await tx
      .insert(schema.legacyOrderDocuments)
      .values({
        externalId,
        importId,
        kind: order.orderType,
        number: order.orderNumber ?? "",
        date,
        status: String(order.status),
        contactId: contact?.id ?? null,
        contactName: order.address?.split(/\r?\n/)[0]?.trim() || contact?.name || "",
        currency: order.currency || "EUR",
        net: amount(order.sumNet),
        tax: amount(order.sumTax),
        gross: amount(order.sumGross),
        raw: { order, positions, relatedObjects },
      })
      .onConflictDoNothing({ target: schema.legacyOrderDocuments.externalId })
      .returning({ id: schema.legacyOrderDocuments.id });
    return Boolean(row);
  });
}

export async function orderArchiveYears(): Promise<number[]> {
  const rows = await db.selectDistinct({ year: sql<number>`extract(year from ${schema.legacyOrderDocuments.date})::int` }).from(schema.legacyOrderDocuments);
  return rows.map((r) => r.year).sort((a, b) => b - a);
}

export async function orderArchiveOverview() {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      // Fester äußerer Tabellenbezug: Drizzle kürzt interpolierte Spalten in Einzeltabellen-SELECTs auf „id“.
      withoutPdf: sql<number>`count(*) filter (where not exists (select 1 from legacy_order_files f where f.order_id = legacy_order_documents.id))::int`,
    })
    .from(schema.legacyOrderDocuments);
  return { count: row?.count ?? 0, withoutPdf: row?.withoutPdf ?? 0, years: await orderArchiveYears() };
}

export async function listOrderDocuments(filter: { year: number; search: string; kind?: keyof typeof ORDER_KINDS }) {
  const term = filter.search.trim();
  return db
    .select({
      id: schema.legacyOrderDocuments.id,
      kind: schema.legacyOrderDocuments.kind,
      number: schema.legacyOrderDocuments.number,
      date: schema.legacyOrderDocuments.date,
      contactName: schema.legacyOrderDocuments.contactName,
      status: schema.legacyOrderDocuments.status,
      currency: schema.legacyOrderDocuments.currency,
      gross: schema.legacyOrderDocuments.gross,
      files: sql<number>`(select count(*)::int from legacy_order_files f where f.order_id = legacy_order_documents.id)`,
    })
    .from(schema.legacyOrderDocuments)
    .where(
      and(
        between(schema.legacyOrderDocuments.date, `${filter.year}-01-01`, `${filter.year}-12-31`),
        filter.kind ? eq(schema.legacyOrderDocuments.kind, filter.kind) : undefined,
        term ? or(ilike(schema.legacyOrderDocuments.number, `%${term}%`), ilike(schema.legacyOrderDocuments.contactName, `%${term}%`)) : undefined,
      ),
    )
    .orderBy(desc(schema.legacyOrderDocuments.date), desc(schema.legacyOrderDocuments.number));
}

export async function orderDocumentDetail(id: string) {
  const [document] = await db.select().from(schema.legacyOrderDocuments).where(eq(schema.legacyOrderDocuments.id, id));
  if (!document) return null;
  const files = await db.select().from(schema.legacyOrderFiles).where(eq(schema.legacyOrderFiles.orderId, id)).orderBy(schema.legacyOrderFiles.createdAt);
  const { raw, ...fields } = document;
  const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");
  const positions = Array.isArray(raw.positions)
    ? raw.positions
        .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
        .map((p, index) => ({
          id: text(p.id) || String(index),
          name: text(p.name),
          quantity: text(p.quantity),
          price: text(p.price),
          taxRate: text(p.taxRate),
          text: text(p.text),
        }))
    : [];
  return {
    document: { ...fields, positions, relatedObjects: JSON.stringify(raw.relatedObjects ?? []) },
    files,
  };
}

export async function orderDocumentFile(id: string) {
  const [file] = await db.select().from(schema.legacyOrderFiles).where(eq(schema.legacyOrderFiles.id, id));
  return file ? { ...file, bytes: await loadFile(file.sha256) } : null;
}

/** Anhängen statt Ersetzen: auch manuell nachgereichte Original-PDFs bleiben als eigener Stand erhalten. */
export async function attachOrderPdf(actor: string, orderId: string, file: { bytes: Uint8Array; filename: string }) {
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > 20 * 1024 * 1024 || !Buffer.from(file.bytes.subarray(0, 5)).equals(Buffer.from("%PDF-")))
    throw new OrderArchiveError("Bitte eine PDF-Datei mit höchstens 20 MB auswählen.");
  const [document] = await db
    .select({ id: schema.legacyOrderDocuments.id })
    .from(schema.legacyOrderDocuments)
    .where(eq(schema.legacyOrderDocuments.id, orderId));
  if (!document) throw new OrderArchiveError("Archivdokument nicht gefunden.");
  const sha256 = sha256Of(file.bytes);
  await storeFile(file.bytes);
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(schema.legacyOrderFiles)
      .values({
        orderId,
        filename: file.filename.slice(0, 200),
        mimeType: "application/pdf",
        sha256,
        size: file.bytes.byteLength,
        origin: "manuell",
      })
      .onConflictDoNothing({ target: [schema.legacyOrderFiles.orderId, schema.legacyOrderFiles.sha256] })
      .returning({ id: schema.legacyOrderFiles.id });
    return { added: Boolean(row) };
  });
}
