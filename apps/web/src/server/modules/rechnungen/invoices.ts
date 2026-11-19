import { invoiceListStatus, invoiceOpen, type InvoiceListStatus } from "@haben/core";
import { and, asc, desc, eq, lte, sql, type SQL } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { paperCancellationIds } from "./advance-payment-group.ts";
import { cancelledIds, cancelledIdsUpTo } from "./cancelled-invoices.ts";
import { invoiceLastSettledOn, invoiceLosses, invoicePayments } from "./zahlungsstand.ts";

/* Rechnungen lesen: eine Rechnung mit Positionen und Bezügen, die Rechnungsliste mit Status und die Kennzahlen der Übersicht */

export type Invoice = typeof schema.invoices.$inferSelect;
export type InvoiceLine = typeof schema.invoiceLines.$inferSelect;

export async function getInvoice(id: string, q: Db | Tx = db) {
  const [invoice] = await q.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  if (!invoice) return null;
  const lines = await q.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id)).orderBy(asc(schema.invoiceLines.position));
  const [contact] = invoice.contactId ? await q.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId)) : [];
  const [importSource] = invoice.lexofficeVoucherId
    ? await q
        .select({
          source: schema.lexofficeVouchers.source,
          sourceName: sql<
            string | null
          >`case when ${schema.lexofficeVouchers.source} = 'import' then ${schema.lexofficeVouchers.raw}->>'sourceName' else null end`,
        })
        .from(schema.lexofficeVouchers)
        .where(eq(schema.lexofficeVouchers.id, invoice.lexofficeVoucherId))
    : [];
  const [corrects] = invoice.correctsId
    ? await q
        // buyer: {KUNDENNR} von Storno und Korrektur nimmt die Kundennummer des Originals, solange sie taugt; der
        // Kreis des Originals entscheidet ebenso über den Kreis des Folgebelegs (#1426)
        .select({
          id: schema.invoices.id,
          number: schema.invoices.number,
          issueDate: schema.invoices.issueDate,
          numberContactId: schema.invoices.numberContactId,
          buyer: schema.invoices.buyer,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, invoice.correctsId))
    : [];
  const correctedBy = await q
    .select({ id: schema.invoices.id, number: schema.invoices.number, kind: schema.invoices.kind, status: schema.invoices.status })
    .from(schema.invoices)
    .where(eq(schema.invoices.correctsId, id))
    .orderBy(asc(schema.invoices.createdAt));
  return { invoice, lines, contact: contact ?? null, importSource: importSource ?? null, corrects: corrects ?? null, correctedBy };
}

export type { InvoiceListStatus };

/**
 * Rechnungsliste mit offenem Betrag und Status (Regeln in @haben/core, lebenszyklus.ts); bezahlt über die Zuordnungen
 * im Bankabgleich. Mit `id` nur diese Rechnung. Rechnungsliste, offene Posten, Mahnwesen und die Sperre der
 * Firmendaten zählen über diese Funktion, damit „offen“ überall dasselbe heißt.
 */
export function listInvoices(today: string, id?: string, q: Db | Tx = db, bis?: string) {
  return selectInvoiceList(today, id ? eq(schema.invoices.id, id) : undefined, q, bis);
}

/** Spalten der Rechnungsliste; die Schnellsuche liest dieselben (search.ts) */
export const invoiceListFields = {
  id: schema.invoices.id,
  kind: schema.invoices.kind,
  variant: schema.invoices.variant,
  status: schema.invoices.status,
  number: schema.invoices.number,
  issueDate: schema.invoices.issueDate,
  dueDate: schema.invoices.dueDate,
  gross: schema.invoices.gross,
  net: schema.invoices.net,
  correctsId: schema.invoices.correctsId,
  contactId: schema.invoices.contactId,
  externalSource: schema.invoices.externalSource,
  externalId: schema.invoices.externalId,
  buyerOrderReference: schema.invoices.buyerOrderReference,
  sellerOrderReference: schema.invoices.sellerOrderReference,
  contactName: schema.contacts.name,
  buyerName: sql<string | null>`${schema.invoices.buyer} ->> 'name'`,
  cancelled: sql<boolean>`${schema.invoices.id} in (${cancelledIds})`,
  // Für die Auskunft unter dem Status: welches Storno die Rechnung aufhebt, welche Rechnung Storno oder Korrektur betrifft
  cancelledBy: sql<
    string | null
  >`(select s.number from invoices s where s.kind = 'storno' and s.status = 'final' and s.corrects_id = ${schema.invoices.id} order by s.number limit 1)`,
  correctsNumber: sql<string | null>`(select o.number from invoices o where o.id = ${schema.invoices.correctsId})`,
};

/** Abfrage der Rechnungsliste, noch ohne Zahlungen und Status (`withListStatus`) */
export function invoiceListQuery(fields: typeof invoiceListFields, filter: SQL | undefined, q: Db | Tx = db, rank?: SQL) {
  return q
    .select(fields)
    .from(schema.invoices)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
    .where(filter)
    .orderBy(
      ...(rank ? [rank] : []),
      desc(schema.invoices.issueDate),
      sql`${schema.invoices.number} desc nulls first`,
      desc(schema.invoices.createdAt),
      desc(schema.invoices.id),
    )
    .$dynamic();
}

async function selectInvoiceList(today: string, filter: SQL | undefined, q: Db | Tx = db, bis?: string) {
  // Abschlussstand (#1110): Rechnungen, die es am Stichtag noch nicht gab, stehen dort nicht, und eine erst danach
  // ausgestellte Stornorechnung hebt die Forderung nicht rückwirkend auf
  const fields = bis ? { ...invoiceListFields, cancelled: sql<boolean>`${schema.invoices.id} in (${cancelledIdsUpTo(bis)})` } : invoiceListFields;
  return withListStatus(await invoiceListQuery(fields, bis ? and(filter, lte(schema.invoices.issueDate, bis)) : filter, q), today, q, bis);
}

/** Zeilen der Rechnungsliste mit Zahlungen, offenem Betrag und Status */
export async function withListStatus(rows: Awaited<ReturnType<typeof invoiceListQuery>>, today: string, q: Db | Tx = db, bis?: string) {
  if (rows.length === 0) return [];
  const paid = await invoicePayments(
    [...rows.filter((r) => r.status === "final").map((r) => r.id), ...rows.filter((r) => r.kind === "storno" && r.correctsId).map((r) => r.correctsId!)],
    q,
    bis,
  );
  const losses = await invoiceLosses(
    rows.filter((r) => r.status === "final").map((r) => r.id),
    q,
    bis,
  );
  const paperStornos = await paperCancellationIds(
    rows.filter((r) => r.kind === "storno").map((r) => r.id),
    q,
  );
  const settledOn = await invoiceLastSettledOn(
    rows.filter((r) => r.status === "final").map((r) => r.id),
    q,
  );
  return rows.map(({ cancelled, ...row }) => {
    const facts = {
      ...row,
      paid: paid.get(row.id) ?? 0,
      writtenOffLoss: losses.get(row.id) ?? 0,
      cancelled,
      // Bei einem Storno bleibt offen, was auf die Rechnung gezahlt und noch nicht erstattet wurde
      paidOnOriginal: row.correctsId ? (paid.get(row.correctsId) ?? 0) : 0,
    };
    return {
      ...row,
      customer: row.buyerName ?? row.contactName ?? "–",
      listStatus: invoiceListStatus(facts, today),
      paid: facts.paid,
      open: paperStornos.has(row.id) ? 0 : invoiceOpen(facts),
      /** Letzte Zahlung oder Ausbuchung, JJJJ-MM-TT */
      settledOn: settledOn.get(row.id) ?? null,
    };
  });
}

/** Kennzahlen für die Übersicht */
export async function invoiceSummary(today: string) {
  const list = await listInvoices(today);
  const open = list.filter((i) => i.kind === "rechnung" && i.open !== 0);
  return {
    // Wie die offenen Forderungen in den Auswertungen (openPositions): alles Festgeschriebene mit offenem Betrag,
    // also auch Korrekturen und Erstattungen aus Stornos bezahlter Rechnungen
    openTotal: list.filter((i) => i.status === "final" && i.open !== 0).reduce((sum, i) => sum + i.open, 0),
    openCount: open.length,
    overdueCount: open.filter((i) => i.listStatus === "ueberfaellig").length,
    recent: list.filter((i) => i.status === "final").slice(0, 5),
    drafts: list.filter((i) => i.status === "draft").length,
  };
}
