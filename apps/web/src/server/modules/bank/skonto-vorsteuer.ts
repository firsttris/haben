import {
  abziehbareSteuer,
  documentWriteOffPosting,
  gespeicherterAnteil,
  paidTaxShares,
  type InvoiceTotals,
  type Kontenrahmen,
  type TaxShare,
} from "@haben/core";
import { sql } from "drizzle-orm";
import type { Tx } from "../../db/index.ts";
import { belegTotals, vorsteuerAbschreibung } from "./vorsteuer-ausgleich.ts";

/** Gemeinsame Skontobuchung: Originalbeträge, kumulierter Abzug und gegebenenfalls der Rest des Zwischenkontos. */
export async function belegSkontoPosting(
  tx: Tx,
  doc: {
    id: string;
    net: number;
    tax: number;
    gross: number;
    vorsteuerAnteil: number | null;
    vorsteuerAbzug: boolean;
    erstattetBezahltes: boolean;
    privateShare: number;
  },
  amount: number,
  kr: Kontenrahmen,
) {
  const totals = await belegTotals(tx, doc);
  return documentWriteOffPosting(
    totals,
    amount,
    kr,
    doc.vorsteuerAnteil ?? doc.vorsteuerAbzug,
    await vorsteuerAbschreibung(tx, doc, totals, amount),
    await skontoVorsteuer(tx, doc, totals, amount),
  );
}

/**
 * Weitere Skonti berichtigen nur den noch nicht berichtigten Teil der gezogenen Vorsteuer (§ 17 Abs. 1 UStG).
 * Der Zielbetrag wird kumuliert gerundet; bereits gebuchte Cents kommen aus dem Journal, einschließlich Gegenbuchungen.
 * Bestände ohne Anteil behalten den bisherigen Weg. Kein gespeicherter Satz wird aus heutigen Firmendaten abgeleitet.
 */
async function skontoVorsteuer(
  tx: Tx,
  doc: { id: string; vorsteuerAnteil: number | null; vorsteuerAbzug: boolean },
  totals: InvoiceTotals,
  amount: number,
): Promise<TaxShare[] | null> {
  if (doc.vorsteuerAnteil === null) return null;
  const [stand] = await tx.execute<{ amount: number }>(sql`
    select coalesce(sum(amount),0)::int as amount from write_offs where document_id=${doc.id} and kind='skontoErhalten'`);
  const bisher = await tx.execute<{ tax_code: string; tax: number }>(sql`
    select l.tax_code, sum(l.credit-l.debit)::int as tax from journal_lines l join journal_entries e on e.id=l.entry_id
    join write_offs w on w.id=e.source_id where e.source_type='ausbuchung' and w.document_id=${doc.id}
    and w.kind='skontoErhalten' and l.account in ('1576','1571','1406','1401') group by l.tax_code`);
  return paidTaxShares(totals, -(Number(stand?.amount ?? 0) + amount)).map((s) => ({
    ...s,
    tax:
      abziehbareSteuer(s.tax, gespeicherterAnteil(doc, totals.taxes.find((t) => t.rate === s.rate)?.vorsteuerAnteil)) -
      bisher.filter((r) => r.tax_code === (s.rate === 1900 ? "VSt19" : "VSt7")).reduce((sum, r) => sum + Number(r.tax), 0),
  }));
}
