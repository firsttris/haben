import { and, eq, gte, lt } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/**
 * Verrechnungen zweier Belege im Zeitraum (#274): Sie gleichen einen Beleg ohne Bankumsatz aus und wirken in der EÜR
 * wie eine Zahlung auf den Beleg, am Tag der Zeile und in der gespeicherten Höhe (siehe euer-journal.ts und
 * euer-formel.ts). Eine aufgehobene Verrechnung ist eine Gegenzeile mit umgekehrtem Betrag.
 *
 * Ohne sie meldet der EÜR-Abgleich die betroffenen Zeilen als Abweichung: im Journal stehen sie, in den Nebenbüchern
 * fehlte der Ausgleich.
 */
export type VerrechnungImJahr = {
  id: string;
  documentId: string;
  date: string;
  amount: number;
  category: string | null;
  vorsteuerAbzug: boolean | null;
  privateShare: number | null;
};

export async function verrechnungenImJahr(start: string, end: string, q: Db | Tx = db): Promise<VerrechnungImJahr[]> {
  return q
    .select({
      id: schema.documentSettlements.id,
      documentId: schema.documentSettlements.documentId,
      date: schema.documentSettlements.date,
      amount: schema.documentSettlements.amount,
      category: schema.documents.category,
      vorsteuerAbzug: schema.documents.vorsteuerAbzug,
      privateShare: schema.documents.privateShare,
    })
    .from(schema.documentSettlements)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentSettlements.documentId))
    .where(and(gte(schema.documentSettlements.date, start), lt(schema.documentSettlements.date, end)));
}
