import { ACCOUNTS, splitPrivateShare, type Cents, type Kontenrahmen } from "@haben/core";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Beleg gegen Buchung (#1116): je festgeschriebener Rechnung die gespeicherten Steuerzeilen (invoice_taxes, mit der
 * Rechnung festgeschrieben) gegen ihre Buchung im Journal: Netto auf den Erlöskonten mit Steuerschlüssel und Umsatzsteuer
 * (bei Ist auf „Umsatzsteuer nicht fällig“). Je gebuchtem Beleg die Vorsteuer aus seinen Beträgen (document_amounts, nur
 * der betriebliche Teil) gegen die Vorsteuerkonten seiner Buchung. Stimmen sie nicht, hat die Buchung andere Beträge als
 * der Beleg.
 *
 * Nicht verglichen: Abschlags- und Schlussrechnungen (die Schlussrechnung bucht die Anzahlungen gegen, das Bilanzverfahren
 * bucht um), aus Lexoffice übernommene Rechnungen und Belege (gebucht gegen den Saldenvortrag,
 * docs/adr/journal-als-quelle.md), Belege mit § 13b oder Erwerb (Vorsteuer auf eigenen Konten, je nach Abzug) und der
 * Bescheid über Einfuhrumsatzsteuer (der ganze Betrag ist Steuer).
 */

/** Steuerschlüssel einer Erlöszeile (revenueTaxCode) */
const ERLOES_SCHLUESSEL = new Set(["USt19", "USt7", "frei", "RC", "Drittland", "Steuerfrei", "IGL", "Ausfuhr", "KU"]);

export interface BelegZeile {
  zeitraum: string;
  posten: string;
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
    const haben = (l: (typeof eigene)[number]) => l.credit - l.debit;
    const netto = eigene
      .filter((l) => l.taxCode !== null && ERLOES_SCHLUESSEL.has(l.taxCode) && !steuerkonten.has(l.account))
      .reduce((s, l) => s + haben(l), 0);
    const steuer = eigene.filter((l) => steuerkonten.has(l.account)).reduce((s, l) => s + haben(l), 0);
    const eigeneSteuern = taxes.filter((t) => t.invoiceId === entry.invoiceId);
    const rechnungNetto = eigeneSteuern.reduce((s, t) => s + t.base, 0);
    const rechnungSteuer = eigeneSteuern.reduce((s, t) => s + t.tax, 0);
    const name = `Rechnung ${entry.number ?? "ohne Nummer"}`;
    const zeitraum = entry.date.slice(0, 7);
    if (netto !== rechnungNetto) result.push({ zeitraum, posten: `${name}: Netto`, journal: netto, rechnung: rechnungNetto });
    if (steuer !== rechnungSteuer) result.push({ zeitraum, posten: `${name}: Umsatzsteuer`, journal: steuer, rechnung: rechnungSteuer });
  }
  return result;
}

/** Gebuchte Belege, deren Buchung im Jahr liegt, mit anderer Vorsteuer als laut Beleg */
export async function belegVorsteuerZeilen(year: number, q: Db | Tx = db): Promise<BelegZeile[]> {
  const e = schema.journalEntries;
  const d = schema.documents;
  const entries = await q
    .select({
      id: e.id,
      date: e.date,
      kontenrahmen: e.kontenrahmen,
      documentId: d.id,
      number: d.invoiceNumber,
      supplier: d.supplierName,
      vorsteuerAbzug: d.vorsteuerAbzug,
      privateShare: d.privateShare,
    })
    .from(e)
    .innerJoin(d, eq(d.id, e.sourceId))
    .where(
      and(
        eq(e.sourceType, "document"),
        isNull(e.reversesId),
        gte(e.date, `${year}-01-01`),
        lt(e.date, `${year + 1}-01-01`),
        isNull(d.reverseCharge),
        isNull(d.lexofficeVoucherId),
        sql`${d.category} is distinct from 'einfuhrumsatzsteuer'`,
      ),
    );
  if (entries.length === 0) return [];
  const lines = await q
    .select({
      entryId: schema.journalLines.entryId,
      account: schema.journalLines.account,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
    })
    .from(schema.journalLines)
    .where(
      inArray(
        schema.journalLines.entryId,
        entries.map((x) => x.id),
      ),
    );
  const amounts = await q
    .select()
    .from(schema.documentAmounts)
    .where(inArray(schema.documentAmounts.documentId, [...new Set(entries.map((x) => x.documentId))]));
  const result: BelegZeile[] = [];
  for (const entry of entries) {
    const a = ACCOUNTS[entry.kontenrahmen as Kontenrahmen];
    const konten = new Set<string>([...Object.values(a.vorsteuer), a.vorsteuerNochNichtAbziehbar]);
    const gebucht = lines.filter((l) => l.entryId === entry.id && konten.has(l.account)).reduce((s, l) => s + l.debit - l.credit, 0);
    const laut = entry.vorsteuerAbzug
      ? amounts.filter((x) => x.documentId === entry.documentId).reduce((s, x) => s + splitPrivateShare(x.tax, entry.privateShare).business, 0)
      : 0;
    if (gebucht !== laut)
      result.push({
        zeitraum: entry.date.slice(0, 7),
        posten: `Beleg ${entry.number || "ohne Nummer"} (${entry.supplier}): Vorsteuer`,
        journal: gebucht,
        rechnung: laut,
      });
  }
  return result;
}
