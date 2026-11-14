import { documentEuerEffects, EXPENSE_CATEGORIES, type DocumentEuerEffect, type EuerPayment, type ExpenseCategory } from "@haben/core";
import { inArray, sql } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { splitsByDocument } from "../belege/index.ts";
import { documentTotalsById } from "./euer-belege.ts";

/**
 * Teilabzüge über alle bisherigen Zahlungen fortschreiben, auch über den Jahreswechsel. Gelesen werden ausschließlich
 * vorhandene Zuordnungen, Verrechnungen und Kursdifferenzen; Skonto ist keine EÜR-Zahlung. Es wird nichts gespeichert.
 */
export async function belegZahlungsWirkungen(q: Db | Tx, ids: string[]): Promise<Map<string, DocumentEuerEffect>> {
  const result = new Map<string, DocumentEuerEffect>();
  if (ids.length === 0) return result;
  const { totals, reverseCharge, selbstGeschuldet } = await documentTotalsById(ids, q);
  const partial = ids.filter((id) => totals.get(id)?.taxes.some((t) => (t.vorsteuerAnteil ?? 0) > 0 && (t.vorsteuerAnteil ?? 10_000) < 10_000));
  if (partial.length === 0) return result;
  const d = schema.documents;
  const docs = await q.select({ id: d.id, category: d.category, privateShare: d.privateShare }).from(d).where(inArray(d.id, partial));
  const splits = await splitsByDocument(partial, q);
  // Wie das bestehende Journalmodell (#864): Gegenzeilen wirken an a.date, sonst gilt der Bankbuchungstag.
  // § 11 Abs. 2 EStG betrifft das Abflussjahr; spätere Aufhebungen dürfen frühere Zahlungsanteile nicht neu runden.
  // Quelle: https://www.gesetze-im-internet.de/estg/__11.html
  const history = await q.execute<{ id: string; document_id: string; paid: number; reverses_id: string | null }>(sql`
    select id, document_id, paid, reverses_id from (
      select a.id, a.document_id, -a.amount as paid, a.reverses_id, coalesce(a.date, b.booking_date) as datum, a.created_at
        from allocations a join bank_transactions b on b.id = a.transaction_id
       where ${inArray(sql`a.document_id`, partial)} and a.kind = 'document'
      union all
      select id, document_id, -amount, reverses_id, date, created_at from document_settlements
       where ${inArray(schema.documentSettlements.documentId, partial)}
      union all
      select id, document_id, -amount, reverses_id, date, created_at from write_offs
       where ${inArray(schema.writeOffs.documentId, partial)} and kind = 'kursdifferenz'
    ) zahlungen order by datum, created_at, id`);
  for (const doc of docs) {
    const lines = splits.get(doc.id)?.map((line) => (reverseCharge.has(doc.id) ? { ...line, tax: 0 } : line));
    const payment: Extract<EuerPayment, { kind: "document" }> = {
      kind: "document",
      date: "",
      paid: 0,
      totals: totals.get(doc.id)!,
      privateShare: doc.privateShare,
      category: doc.category && doc.category in EXPENSE_CATEGORIES ? (doc.category as ExpenseCategory) : "sonstiges",
      ...(lines ? { splits: lines } : {}),
      ...(selbstGeschuldet.has(doc.id) ? { selbstGeschuldet: selbstGeschuldet.get(doc.id)! } : {}),
    };
    const events = [...history].filter((h) => h.document_id === doc.id).map((h) => ({ id: h.id, paid: h.paid, reversesId: h.reverses_id }));
    for (const [id, effect] of documentEuerEffects(payment, events)) result.set(id, effect);
  }
  return result;
}
