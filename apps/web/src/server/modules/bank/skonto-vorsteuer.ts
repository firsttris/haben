import {
  ACCOUNTS,
  abziehbareSteuer,
  documentWriteOffPosting,
  gespeicherterAnteil,
  paidTaxShares,
  type InvoiceTotals,
  type Kontenrahmen,
  type TaxShare,
  type Prozent,
} from "@haben/core";
import { sql } from "drizzle-orm";
import type { Tx } from "../../db/index.ts";
import { belegTotals, ZWISCHENKONTEN } from "../umsatzsteuer/index.ts";
import { vorsteuerAbschreibung } from "./vorsteuer-ausgleich.ts";

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
    privateShare: Prozent;
  },
  amount: number,
  kr: Kontenrahmen,
  /** Tag der Ausbuchung: Vor der Ausführung (#693) schreibt das Skonto vom Zwischenkonto ab */
  datum: string,
) {
  const totals = await belegTotals(tx, doc);
  return documentWriteOffPosting(
    totals,
    amount,
    kr,
    doc.vorsteuerAnteil ?? doc.vorsteuerAbzug,
    await vorsteuerAbschreibung(tx, doc, totals, amount, datum),
    await skontoVorsteuer(tx, doc, totals, amount),
  );
}

/**
 * Weitere Skonti berichtigen nur den noch nicht berichtigten Teil der gezogenen Vorsteuer (§ 17 Abs. 1 UStG).
 * Der Zielbetrag wird kumuliert gerundet; bereits gebuchte Cents kommen aus dem Journal, einschließlich Gegenbuchungen.
 * Bestände ohne Anteil behalten den bisherigen Weg. Kein gespeicherter Satz wird aus heutigen Firmendaten abgeleitet.
 * Ein Skonto vor der Ausführung (#693) hat seinen Teil vom Zwischenkonto abgeschrieben statt von der Vorsteuer; er zählt
 * deshalb mit, sonst minderte ein späteres Skonto diesen Teil ein zweites Mal.
 */
async function skontoVorsteuer(
  tx: Tx,
  doc: { id: string; vorsteuerAnteil: number | null; vorsteuerAbzug: boolean },
  totals: InvoiceTotals,
  amount: number,
): Promise<TaxShare[] | null> {
  if (doc.vorsteuerAnteil === null) return null;
  // Auch frühere Skonti vor einem Kontenrahmenwechsel bleiben in der kumulierten Berichtigung enthalten.
  const konten = [...new Set([...Object.values(ACCOUNTS).flatMap((a) => Object.values(a.vorsteuer)), ...ZWISCHENKONTEN])];
  const [stand] = await tx.execute<{ amount: number }>(sql`
    select coalesce(sum(amount),0)::int as amount from write_offs where document_id=${doc.id} and kind='skontoErhalten'`);
  const bisher = await tx.execute<{ tax_code: string; tax: number }>(sql`
    select l.tax_code, sum(l.credit-l.debit)::int as tax from journal_lines l join journal_entries e on e.id=l.entry_id
    join write_offs w on w.id=e.source_id where e.source_type='ausbuchung' and w.document_id=${doc.id}
    and w.kind='skontoErhalten' and l.account in (${sql.join(
      konten.map((konto) => sql`${konto}`),
      sql`, `,
    )}) group by l.tax_code`);
  return paidTaxShares(totals, -(Number(stand?.amount ?? 0) + amount)).map((s) => ({
    ...s,
    tax:
      abziehbareSteuer(s.tax, gespeicherterAnteil(doc, totals.taxes.find((t) => t.rate === s.rate)?.vorsteuerAnteil)) -
      bisher.filter((r) => r.tax_code === (s.rate === 1900 ? "VSt19" : "VSt7")).reduce((sum, r) => sum + Number(r.tax), 0),
  }));
}
