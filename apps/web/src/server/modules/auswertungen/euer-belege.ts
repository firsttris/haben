import { gespeicherterAnteil, totalsFromTaxes, type InvoiceTotals } from "@haben/core";
import { inArray } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/**
 * Die EÜR rechnet mit den Originalbeträgen und dem gespeicherten Abzug je Satz. Ein Altbeleg mit Anteil null fällt
 * ausschließlich auf seinen Boolean zurück; die heutigen Firmendaten ändern keine frühere Ausgabe.
 */
export async function documentTotalsById(
  ids: string[],
  q: Db | Tx = db,
): Promise<{ totals: Map<string, InvoiceTotals>; reverseCharge: Set<string>; selbstGeschuldet: Map<string, number[]> }> {
  if (ids.length === 0) return { totals: new Map(), reverseCharge: new Set(), selbstGeschuldet: new Map() };
  const amounts = await q.select().from(schema.documentAmounts).where(inArray(schema.documentAmounts.documentId, ids));
  const docs = await q
    .select({
      id: schema.documents.id,
      reverseCharge: schema.documents.reverseCharge,
      vorsteuerAbzug: schema.documents.vorsteuerAbzug,
      vorsteuerAnteil: schema.documents.vorsteuerAnteil,
    })
    .from(schema.documents)
    .where(inArray(schema.documents.id, ids));
  const reverseCharge = new Set(docs.filter((d) => d.reverseCharge).map((d) => d.id));
  const totals = new Map(
    docs.map((doc) => [
      doc.id,
      totalsFromTaxes(
        amounts
          .filter((a) => a.documentId === doc.id)
          .map((a) => ({
            rate: a.taxRate,
            base: a.net,
            // § 13b/Erwerb: Die Steuer wird ans Finanzamt gezahlt; sie steckt nicht im Abfluss an den Lieferanten.
            tax: doc.reverseCharge ? 0 : a.tax,
            vorsteuerAnteil: gespeicherterAnteil(doc, a.vorsteuerAnteil),
          })),
      ),
    ]),
  );
  return {
    totals,
    reverseCharge,
    selbstGeschuldet: new Map([...reverseCharge].map((id) => [id, amounts.filter((a) => a.documentId === id).map((a) => a.tax)])),
  };
}
