import { paidTaxShares, periodRange, splitPrivateShare, type Cents, type TaxShare, type VatPeriod } from "@haben/core";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Vorsteuer aus einer Gutschrift „erstattet bereits Bezahltes“ (#690, #786). Eine solche Gutschrift erstattet ein schon
 * bezahltes Entgelt; die Vorsteuer mindert sich deshalb nicht im Belegmonat, sondern erst, wenn das Geld tatsächlich
 * zurückkommt oder der Posten verrechnet wird: je Zahlung (allocations), Verrechnung (document_settlements) und
 * Kursdifferenz (write_offs) ein Anteil mit dem Datum dieses Vorgangs (§ 17 Abs. 1 Satz 2 und Satz 8 UStG,
 * UStAE 17.1 Abs. 2 Satz 3; die Aufrechnung steht der Zahlung gleich, UStAE 13.6 Abs. 1 Satz 12).
 * Ausgebuchtes Skonto zählt nicht mit: Es erstattet nichts, sondern erlässt den Rest, und wird deshalb vom
 * Zwischenkonto abgeschrieben, ohne die Vorsteuer zu ändern (vorsteuer-ausgleich.ts).
 * Anteilig je Steuersatz wie beim erhaltenen Skonto, aber fortgeschrieben wie eine Teilzahlung (paidTaxShares kumuliert):
 * Alle Vorgänge einer Gutschrift ergeben zusammen genau ihre Vorsteuer, auch über mehrere Zeiträume und nach einer
 * Aufhebung.
 *
 * Solange nichts ausgeglichen ist, taucht die Vorsteuer der Gutschrift in keinem Zeitraum auf. Aufgehobene Vorgänge
 * tragen eine Gegenzeile und heben ihren Anteil an deren Datum wieder auf.
 */

export interface GutschriftAnteil {
  documentId: string;
  date: string;
  supplier: string;
  number: string;
  rate: number;
  base: Cents;
  tax: Cents;
}

/** Belegangaben, die jeder Vorgang für seinen Anteil braucht */
const beleg = {
  documentId: schema.documents.id,
  supplier: schema.documents.supplierName,
  number: schema.documents.invoiceNumber,
  net: schema.documents.net,
  tax: schema.documents.tax,
  gross: schema.documents.gross,
  privateShare: schema.documents.privateShare,
};

/**
 * Nur Belege mit der Angabe „Erstattet bereits Bezahltes“: dieselbe Angabe, an der die Buchung die Vorsteuer auf das
 * Zwischenkonto legt (belegbuchung.ts). Sie wird nur an einer Gutschrift über die Bank zugelassen
 * (documents.ts, erstattetBezahltesProblem), und ohne sie gilt wie bei jedem Beleg das Belegdatum — die
 * Voranmeldung und die Buchung entscheiden damit an derselben Angabe.
 *
 * Aus einem Umzug übernommene Belege lässt Haben aus, weil ihre Steuer im bisherigen Programm schon angemeldet ist.
 */
const nurGutschrift = and(
  eq(schema.documents.erstattetBezahltes, true),
  eq(schema.documents.vorsteuerAbzug, true),
  eq(schema.documents.status, "gebucht"),
  isNull(schema.documents.reverseCharge),
  isNull(schema.documents.lexofficeVoucherId),
);

/** Ein Vorgang, der den offenen Posten einer Gutschrift ausgleicht */
interface Vorgang {
  documentId: string;
  date: string;
  amount: Cents;
  supplier: string;
  number: string;
  net: Cents;
  tax: Cents;
  gross: Cents;
  privateShare: number;
}

/**
 * Anteile je Vorgang, der eine Gutschrift ausgleicht, mit dem Datum des Vorgangs. Zahlungen zählen mit dem
 * Buchungstag des Bankumsatzes, Verrechnungen mit dem Tag der Aufrechnung, Ausbuchungen mit ihrem Datum.
 *
 * Gelesen werden alle Vorgänge bis zum Ende des Zeitraums, nicht nur die im Zeitraum: Der Anteil eines Vorgangs ist
 * der geschäftliche Teil des Stands nach ihm abzüglich dessen, was die früheren schon erfasst haben, damit die Anteile
 * zusammen genau die Vorsteuer der Gutschrift ergeben. Ausgegeben werden nur die Vorgänge im Zeitraum.
 */
export async function gutschriftAnteile(period: VatPeriod, q: Db | Tx = db): Promise<GutschriftAnteil[]> {
  const { start, end } = periodRange(period);
  const zahlungen = await q
    .select({ ...beleg, date: schema.bankTransactions.bookingDate, amount: schema.allocations.amount })
    .from(schema.allocations)
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
    .innerJoin(schema.documents, eq(schema.documents.id, schema.allocations.documentId))
    .where(and(eq(schema.allocations.kind, "document"), nurGutschrift, lt(schema.bankTransactions.bookingDate, end)));
  const verrechnungen = await q
    .select({ ...beleg, date: schema.documentSettlements.date, amount: schema.documentSettlements.amount })
    .from(schema.documentSettlements)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentSettlements.documentId))
    .where(and(nurGutschrift, lt(schema.documentSettlements.date, end)));
  // Eine Kursdifferenz gleicht den Rest des offenen Postens ohne Geldbewegung aus; Skonto tut das auch, ändert aber die
  // Vorsteuer nicht (Kopf dieser Datei)
  const ausbuchungen = await q
    .select({ ...beleg, date: schema.writeOffs.date, amount: schema.writeOffs.amount })
    .from(schema.writeOffs)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.writeOffs.documentId))
    .where(and(nurGutschrift, eq(schema.writeOffs.kind, "kursdifferenz"), lt(schema.writeOffs.date, end)));
  const vorgaenge: Vorgang[] = [...zahlungen, ...verrechnungen, ...ausbuchungen].sort((a, b) => a.date.localeCompare(b.date));
  if (vorgaenge.length === 0) return [];
  const rows = await q
    .select()
    .from(schema.documentAmounts)
    .where(inArray(schema.documentAmounts.documentId, [...new Set(vorgaenge.map((v) => v.documentId))]));
  // Stand je Gutschrift: der Betrag, der schon ausgeglichen ist, und die dafür erfassten Anteile
  const ausgeglichen = new Map<string, Cents>();
  const erfasst = new Map<string, TaxShare[]>();
  const anteile: GutschriftAnteil[] = [];
  for (const v of vorgaenge) {
    const taxes = rows
      .filter((a) => a.documentId === v.documentId)
      .map((a) => ({ rate: a.taxRate, base: a.net, tax: a.tax }))
      .sort((a, b) => b.rate - a.rate);
    const totals = { net: v.net, tax: v.tax, gross: v.gross, taxes };
    // Der Vorgang ist eine Zahlung auf die Gutschrift (positiv); mit dem Vorzeichen des Belegs ist das -amount.
    // Eine Erstattung von 9025 Cent mindert die Vorsteuer damit um 1441 Cent.
    const betrag = -v.amount;
    const vorher = ausgeglichen.get(v.documentId) ?? 0;
    const bisher = erfasst.get(v.documentId) ?? [];
    // Fortgeschrieben wird der geschäftliche Teil des kumulierten Anteils, wie die Umbuchung im Journal
    // (vorsteuer-ausgleich.ts): Den Privatanteil je Vorgang zu runden ließe über mehrere Teilerstattungen einen Cent
    // neben der Vorsteuer, die beim Buchen auf dem Zwischenkonto steht (drei Drittel bei 50 %: 316 + 317 + 316 statt 950).
    const neu = paidTaxShares(totals, vorher + betrag).map((t) => {
      const recorded = bisher.filter((r) => r.rate === t.rate);
      return {
        rate: t.rate,
        base: splitPrivateShare(t.base, v.privateShare).business - recorded.reduce((sum, r) => sum + r.base, 0),
        tax: splitPrivateShare(t.tax, v.privateShare).business - recorded.reduce((sum, r) => sum + r.tax, 0),
      };
    });
    ausgeglichen.set(v.documentId, vorher + betrag);
    erfasst.set(
      v.documentId,
      [...bisher, ...neu].filter((s) => s.base !== 0 || s.tax !== 0),
    );
    if (v.date < start) continue;
    for (const { rate, base, tax } of neu) {
      if (tax === 0) continue;
      anteile.push({ documentId: v.documentId, date: v.date, supplier: v.supplier, number: v.number, rate, base, tax });
    }
  }
  return anteile;
}
