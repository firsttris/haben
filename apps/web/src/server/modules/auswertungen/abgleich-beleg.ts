import { ACCOUNTS, type Cents, type Kontenrahmen } from "@haben/core";
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Beleg gegen Buchung (#1116): je festgeschriebener Rechnung die gespeicherten Steuerzeilen (invoice_taxes, mit der
 * Rechnung festgeschrieben) gegen ihre Buchung im Journal: Netto auf den Erlöskonten mit Steuerschlüssel und Umsatzsteuer
 * (bei Ist auf „Umsatzsteuer nicht fällig“). Stimmen sie nicht, hat die Buchung andere Beträge als die Rechnung. Belege
 * und die übrigen Vorgänge vergleicht abgleich-vorgang.ts.
 *
 * Nicht verglichen: Abschlags- und Schlussrechnungen (die Schlussrechnung bucht die Anzahlungen gegen, das Bilanzverfahren
 * bucht um), reine Steuerumbuchungen (bis zur Rückzahlung gehaltene Steuer, #853) und aus Lexoffice übernommene Rechnungen (gebucht gegen den Saldenvortrag, docs/adr/journal-als-quelle.md).
 */

/** Steuerschlüssel einer Erlöszeile (revenueTaxCode) */
const ERLOES_SCHLUESSEL = new Set(["USt19", "USt7", "frei", "RC", "Drittland", "Steuerfrei", "IGL", "Ausfuhr", "KU"]);

export interface BelegZeile {
  zeitraum: string;
  posten: string;
  /** Stabiler Schlüssel des Postens (AbgleichZeile.schluessel) */
  schluessel: string;
  journal: Cents;
  rechnung: Cents;
}

/** Rechnungen, deren Buchung im Jahr liegt, mit Abweichungen zwischen Rechnung und Buchung */
export async function belegZeilen(year: number, q: Db | Tx = db): Promise<BelegZeile[]> {
  const e = schema.journalEntries;
  const i = schema.invoices;
  const entries = await q
    .select({ id: e.id, date: e.date, kontenrahmen: e.kontenrahmen, invoiceId: i.id, number: i.number })
    .from(e)
    .innerJoin(i, eq(i.id, e.sourceId))
    .where(
      and(
        eq(e.sourceType, "invoice"),
        isNull(e.reversesId),
        gte(e.date, `${year}-01-01`),
        lt(e.date, `${year + 1}-01-01`),
        isNull(i.variant),
        isNull(i.advanceAccounting),
        isNull(i.lexofficeVoucherId),
      ),
    );
  if (entries.length === 0) return [];
  const lines = await q
    .select({
      entryId: schema.journalLines.entryId,
      account: schema.journalLines.account,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
      taxCode: schema.journalLines.taxCode,
    })
    .from(schema.journalLines)
    .where(
      inArray(
        schema.journalLines.entryId,
        entries.map((x) => x.id),
      ),
    );
  const taxes = await q
    .select()
    .from(schema.invoiceTaxes)
    .where(inArray(schema.invoiceTaxes.invoiceId, [...new Set(entries.map((x) => x.invoiceId))]));
  const result: BelegZeile[] = [];
  for (const entry of entries) {
    const a = ACCOUNTS[entry.kontenrahmen as Kontenrahmen];
    const steuerkonten = new Set<string>([...Object.values(a.ust), ...Object.values(a.ustNichtFaellig)]);
    const eigene = lines.filter((l) => l.entryId === entry.id);
    // Reine Umbuchung zwischen „Umsatzsteuer“ und „nicht fällig“: Steuer, die eine Korrektur erst mit der Rückzahlung
    // mindert (#853, advance-vat.ts); sie ist keine Buchung der Rechnung selbst
    if (eigene.every((l) => steuerkonten.has(l.account))) continue;
    const haben = (l: (typeof eigene)[number]) => l.credit - l.debit;
    // Korrektur einer übernommenen Rechnung (legacyCorrectionPosting): das Netto auf dem Saldenvortrag, bei Ist ohne Schlüssel
    const netto = eigene
      .filter((l) => (l.account === a.saldenvortrag || (l.taxCode !== null && ERLOES_SCHLUESSEL.has(l.taxCode))) && !steuerkonten.has(l.account))
      .reduce((s, l) => s + haben(l), 0);
    const steuer = eigene.filter((l) => steuerkonten.has(l.account)).reduce((s, l) => s + haben(l), 0);
    const eigeneSteuern = taxes.filter((t) => t.invoiceId === entry.invoiceId);
    const rechnungNetto = eigeneSteuern.reduce((s, t) => s + t.base, 0);
    const rechnungSteuer = eigeneSteuern.reduce((s, t) => s + t.tax, 0);
    const name = `Rechnung ${entry.number ?? "ohne Nummer"}`;
    const zeitraum = entry.date.slice(0, 7);
    if (netto !== rechnungNetto)
      result.push({ zeitraum, posten: `${name}: Netto`, schluessel: `buchung:${entry.id}:netto`, journal: netto, rechnung: rechnungNetto });
    if (steuer !== rechnungSteuer)
      result.push({ zeitraum, posten: `${name}: Umsatzsteuer`, schluessel: `buchung:${entry.id}:steuer`, journal: steuer, rechnung: rechnungSteuer });
  }
  return result;
}
