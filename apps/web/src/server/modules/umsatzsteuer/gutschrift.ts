import { periodRange, settlementTaxShares, splitPrivateShare, type Cents, type TaxShare, type VatPeriod } from "@haben/core";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Vorsteuer aus einer Gutschrift, also einem Beleg mit negativen Beträgen (#690). Eine Gutschrift erstattet ein schon
 * bezahltes Entgelt; die Vorsteuer mindert sich deshalb nicht im Belegmonat, sondern erst, wenn das Geld tatsächlich
 * zurückkommt oder der Posten verrechnet wird: je Zahlung (allocations), Verrechnung (document_settlements) und
 * Ausbuchung (write_offs; erhaltenes Skonto, Kursdifferenz) ein Anteil mit dem Datum dieses Vorgangs (§ 17 Abs. 1
 * Satz 2 UStG, UStAE 17.1 Abs. 2 Satz 3; die Aufrechnung steht der Zahlung gleich, UStAE 13.6 Abs. 1 Satz 12).
 * Anteilig je Steuersatz wie beim erhaltenen Skonto, aber fortgeschrieben wie eine Teilzahlung (settlementTaxShares):
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
 * Nur Gutschriften mit Vorsteuerabzug, die über die Bank laufen: negativer, gebuchter Beleg ohne § 13b-Steuer.
 *
 * Bar oder privat bezahlt gibt es keinen offenen Posten, den eine Erstattung ausgleichen könnte; das Geld ist mit der
 * Buchung zurück, die Vorsteuer zählt dort im Belegmonat (vat-figures.ts). Aus einem Umzug übernommene Belege lässt
 * Haben aus, weil ihre Steuer im bisherigen Programm schon angemeldet ist.
 */
const nurGutschrift = and(
  lt(schema.documents.gross, 0),
  eq(schema.documents.vorsteuerAbzug, true),
  eq(schema.documents.status, "gebucht"),
  eq(schema.documents.payment, "bank"),
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
 * der Stand nach ihm abzüglich dessen, was die früheren schon erfasst haben (settlementTaxShares), damit die Anteile
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
  // Erhaltenes Skonto und Kursdifferenz gleichen den Rest des offenen Postens ohne Geldbewegung aus
  const ausbuchungen = await q
    .select({ ...beleg, date: schema.writeOffs.date, amount: schema.writeOffs.amount })
    .from(schema.writeOffs)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.writeOffs.documentId))
    .where(and(nurGutschrift, inArray(schema.writeOffs.kind, ["skontoErhalten", "kursdifferenz"]), lt(schema.writeOffs.date, end)));
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
    const neu = settlementTaxShares(totals, vorher, bisher, betrag);
    ausgeglichen.set(v.documentId, vorher + betrag);
    erfasst.set(
      v.documentId,
      [...bisher, ...neu].filter((s) => s.base !== 0 || s.tax !== 0),
    );
    if (v.date < start) continue;
    for (const share of neu) {
      const base = splitPrivateShare(share.base, v.privateShare).business;
      const tax = splitPrivateShare(share.tax, v.privateShare).business;
      if (tax === 0) continue;
      anteile.push({ documentId: v.documentId, date: v.date, supplier: v.supplier, number: v.number, rate: share.rate, base, tax });
    }
  }
  return anteile;
}
