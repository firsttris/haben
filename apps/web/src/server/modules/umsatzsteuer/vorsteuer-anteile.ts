import {
  ACCOUNTS,
  abziehbareSteuer,
  gespeicherterAnteil,
  leistungsdatum,
  paidTaxShares,
  splitPrivateShare,
  type Cents,
  type InvoiceTotals,
  type TaxShare,
  type Prozent,
} from "@haben/core";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";

/*
 * Wie viel Vorsteuer eines Belegs gerade abziehbar wird, wenn er seine Steuer auf dem Zwischenkonto (SKR03 1548, SKR04
 * 1434) geparkt hat: die Gutschrift, die bereits Bezahltes erstattet (#786), und die Rechnung, deren Leistung beim Buchen
 * noch nicht ausgeführt ist (#693). Der Anteil ist anteilig je Steuersatz und wird fortgeschrieben wie bei den Rechnungen
 * (settlementTaxShares): Ziel kumuliert minus dem, was die bisherigen Ausgleiche samt Freigaben schon umgebucht haben. So
 * ergeben alle zusammen genau die Vorsteuer des Belegs.
 *
 * Ob der Beleg überhaupt etwas auf dem Zwischenkonto hat, sagt das Journal und nicht die Angabe am Beleg: Der Nachweis
 * ist die Buchung selbst, damit Altbestand, Kleinunternehmer und 0 % unberührt bleiben und ein nachträglich gesetztes
 * Leistungsdatum nicht rückwirkend umbucht.
 *
 * Hier steht nur die Rechnung; gebucht wird an zwei Stellen: den Ausgleich (modules/bank/vorsteuer-ausgleich.ts) und die
 * Freigaben zum Leistungs- und zum Rechnungsdatum (modules/umsatzsteuer/vorsteuer-freigabe.ts). Das Modul umsatzsteuer
 * liegt unter bank, deshalb liegt die gemeinsame Rechnung hier und nicht dort.
 */

/** Beträge des Belegs je Steuersatz, wie sie auf der Rechnung stehen (nicht nachgerechnet) */
export async function belegTotals(tx: Tx, doc: { id: string; net: number; tax: number; gross: number }): Promise<InvoiceTotals> {
  const rows = await tx.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, doc.id));
  const taxes = rows.map((r) => ({ rate: r.taxRate, base: r.net, tax: r.tax, vorsteuerAnteil: r.vorsteuerAnteil })).sort((a, b) => b.rate - a.rate);
  return { net: doc.net, tax: doc.tax, gross: doc.gross, taxes };
}

/** Der geschäftliche Teil eines Betrags, gerundet wie beim Buchen (splitPrivateShare) */
export function geschaeftlich(betrag: Cents, privateShare: Prozent): Cents {
  return privateShare === 0 ? betrag : splitPrivateShare(betrag, privateShare).business;
}

/** Steuersatz zum Steuerschlüssel der Vorsteuer; das Zwischenkonto trägt nur 19 % und 7 % */
export function satzZumSchluessel(code: string | null): number | null {
  if (code === "VSt19") return 1900;
  if (code === "VSt7") return 700;
  return null;
}

/**
 * Beide Konten dieses Zwischenkontos: SKR03 1548 und SKR04 1434. Nach einem Wechsel des Kontenrahmens zum Jahreswechsel
 * steht die Buchung des Belegs noch im alten Rahmen; gesucht wird deshalb in beiden, gebucht wird im eingestellten.
 */
export const ZWISCHENKONTEN: readonly string[] = [ACCOUNTS.SKR03.vorsteuerNochNichtAbziehbar, ACCOUNTS.SKR04.vorsteuerNochNichtAbziehbar];

/** Steht die Vorsteuer dieses Belegs auf dem Zwischenkonto? Die Buchung selbst ist der Beleg dafür */
async function aufDemZwischenkonto(tx: Tx, documentId: string): Promise<boolean> {
  const [row] = await tx.execute<{ anzahl: number }>(sql`
    select count(*)::int as anzahl
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
     where (l.account = ${ZWISCHENKONTEN[0]!} or l.account = ${ZWISCHENKONTEN[1]!}) and e.source_type = 'document' and e.source_id = ${documentId} and e.reverses_id is null`);
  return Number(row?.anzahl ?? 0) > 0;
}

/**
 * Erledigter Betrag, der die Vorsteuer berichtigt: Zuordnungen, Verrechnungen und Kursdifferenzen, ohne ausgebuchtes
 * Skonto und ohne Kursdifferenzen vor `ausfuehrung` (sie ziehen nichts: Sie sind keine Zahlung, § 16 Abs. 6 UStG).
 * Vorzeichen wie in `settledOn` (Gutschrift positiv).
 */
async function steuerlichAusgeglichen(tx: Tx, documentId: string, ausfuehrung: string | null): Promise<number> {
  const [row] = await tx.execute<{ summe: number }>(sql`
    select coalesce(sum(amount), 0)::int as summe from (
      select amount from allocations where document_id = ${documentId}
      union all select amount from document_settlements where document_id = ${documentId}
      union all select amount from write_offs where document_id = ${documentId} and kind <> 'skontoErhalten'
        and not (kind = 'kursdifferenz' and ${ausfuehrung}::date is not null and date < ${ausfuehrung}::date)
    ) ausgeglichen`);
  return Number(row?.summe ?? 0);
}

/** Trägt der Beleg eine Freigabe zum Leistungs- oder Rechnungsdatum (auch eine aufgehobene)? */
export async function hatFreigabe(tx: Tx, documentId: string): Promise<boolean> {
  const [freigabe] = await tx
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "freigabe"), eq(schema.journalEntries.sourceId, documentId)))
    .limit(1);
  return freigabe !== undefined;
}

/**
 * Tag der Ausführung, wenn der Beleg eine Freigabe zum Leistungs- oder Rechnungsdatum trägt oder trug (#693); sonst
 * null, etwa bei der Gutschrift „erstattet bereits Bezahltes“ (#786), deren Kursdifferenz weiter ausgleicht
 */
export async function ausfuehrungMitFreigabe(tx: Tx, documentId: string): Promise<string | null> {
  const [doc] = await tx
    .select({ documentDate: schema.documents.documentDate, serviceFrom: schema.documents.serviceFrom, serviceTo: schema.documents.serviceTo })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  if (!doc?.documentDate) return null;
  if (!(await hatFreigabe(tx, documentId))) return null;
  return leistungsdatum({ belegdatum: doc.documentDate, leistungVon: doc.serviceFrom, leistungBis: doc.serviceTo });
}

/**
 * Was die bisherigen Ausgleiche dieses Belegs schon vom Zwischenkonto auf die Vorsteuer umgebucht haben, je Steuersatz,
 * mit Gegenbuchungen (Aufhebung) netto. Gelesen wird das Journal, nicht aus den Beträgen gerechnet: So stimmt der
 * fortgeschriebene Anteil auch dann, wenn ein Ausgleich vor dieser Umbuchung lag — der Saldo des Kontos ist die Wahrheit
 * über das, was noch offen ist.
 *
 * Die Freigabe zum Ausführungsdatum (`ausfuehrung`) zählt nicht mit: Sie steht schon ab dem Buchen im Journal, datiert
 * auf einen Tag, der noch kommen kann (#693), und eine Zahlung vor der Ausführung zöge ihren Anteil sonst ein zweites
 * Mal — bei Teilzahlungen mit negativem Vorzeichen. Alle anderen Buchungen zählen unabhängig vom Datum, auch die Freigabe
 * zum Rechnungsdatum vor einem Skonto zur Vorkasse und die Gegenbuchung einer Aufhebung nach dem Tag des Ausgleichs: Ein
 * nachgereichter, älterer Auszug soll den Anteil nicht neu verteilen.
 *
 * Anders als zwischenkontoSaldo (vorsteuer-freigabe.ts) ohne die Buchung des Belegs und ohne Skonto, mit der Grundlage
 * so, wie sie gebucht ist, und mit Sätzen ohne Steuer: Es geht um das schon Umgebuchte, nicht um den Rest.
 */
async function bisherUmgebucht(tx: Tx, documentId: string, ausfuehrung: string | null): Promise<TaxShare[]> {
  const rows = await tx.execute<{ tax_code: string | null; bewegt: number; basis: number }>(sql`
    select l.tax_code, sum(l.debit - l.credit)::int as bewegt, sum(coalesce(l.basis, 0))::int as basis
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
     where (l.account = ${ZWISCHENKONTEN[0]!} or l.account = ${ZWISCHENKONTEN[1]!})
       and ((e.source_type = 'allocation' and e.source_id in (select id from allocations where document_id = ${documentId}))
         or (e.source_type = 'verrechnung' and e.source_id in (select id from document_settlements where document_id = ${documentId}))
         or (e.source_type = 'ausbuchung' and e.source_id in
               (select id from write_offs where document_id = ${documentId} and kind <> 'skontoErhalten'))
         -- Beim Buchen schon freigegeben (#693): Der Ausgleich darf dieselbe Steuer nicht ein zweites Mal ziehen
         or (e.source_type = 'freigabe' and e.source_id = ${documentId}))
       -- Nur die Freigabe zum Ausführungsdatum trägt ein Datum, das noch kommen kann; alles andere zählt, auch nachgereicht
       and not (e.source_type = 'freigabe' and ${ausfuehrung}::date is not null and e.date >= ${ausfuehrung}::date)
     group by l.tax_code`);
  return [...rows].flatMap((r) => {
    const rate = satzZumSchluessel(r.tax_code);
    return rate === null ? [] : [{ rate, base: Number(r.basis), tax: Number(r.bewegt) }];
  });
}

/**
 * Anteil eines Ausgleichs auf diesen Beleg, je Steuersatz, mit dem Vorzeichen des Ausgleichs (negativ heißt: Steuer wird
 * frei); null, wenn seine Buchung nichts auf das Zwischenkonto gelegt hat (Altbestand, Kleinunternehmer, 0 %, kein
 * Leistungsdatum nach dem Belegdatum). `amount` trägt das Vorzeichen des Ausgleichs (Zuordnung, Kursdifferenz,
 * Verrechnung), wie in `settledOn`, `datum` ist der Tag seiner Buchung; erst nach dem Sperren von Beleg und Umsatz
 * aufrufen.
 *
 * Ab der Ausführung ist die ganze Vorsteuer abziehbar (§ 15 Abs. 1 Satz 1 Nr. 1 UStG, Leistung und Rechnung liegen vor):
 * Ein Ausgleich an oder nach ihrem Tag bucht nichts mehr um, auch eine Teilzahlung nicht, und ein Skonto mindert die
 * Vorsteuer wie bei jedem Beleg (§ 17 Abs. 1 Satz 2 UStG). Maßgeblich ist die Ausführung selbst, nicht der Tag der
 * Freigabe: Eine Zahlung vor dem Rechnungsdatum wird schon zum Rechnungsdatum freigegeben, abziehbar wird die
 * ganze Steuer aber erst mit der Leistung. Eine Kursdifferenz vor der Ausführung zieht nichts.
 */
export async function vorsteuerAnteile(
  tx: Tx,
  doc: { id: string; privateShare: Prozent },
  totals: InvoiceTotals,
  amount: number,
  datum: string,
  kursdifferenz = false,
): Promise<TaxShare[] | null> {
  // Der Saldo kann nach einem Wechsel des Kontenrahmens auf dem Konto des alten Rahmens stehen; die Umbuchung selbst
  // bucht dann im eingestellten Rahmen, mit dessen Vorsteuerkonto, damit Kz 66 sie sieht
  if (!(await aufDemZwischenkonto(tx, doc.id))) return null;
  const ausfuehrung = await ausfuehrungMitFreigabe(tx, doc.id);
  if (ausfuehrung !== null && datum >= ausfuehrung) return null;
  if (kursdifferenz && ausfuehrung !== null && datum < ausfuehrung) return [];
  const bisher = await bisherUmgebucht(tx, doc.id, ausfuehrung);
  // Der Privatanteil und der nicht abziehbare Teil (§ 15 Abs. 4 UStG) stehen schon beim Buchen nicht auf dem
  // Zwischenkonto: Das Ziel wird deshalb vor dem Abzug der bisherigen Umbuchungen auf den geschäftlichen, abziehbaren
  // Teil gebracht, kumuliert gerundet. So endet das Konto bei null statt um diese Teile im Soll.
  const ziel = paidTaxShares(totals, (await steuerlichAusgeglichen(tx, doc.id, ausfuehrung)) + amount).map((s) => ({
    rate: s.rate,
    base: geschaeftlich(s.base, doc.privateShare),
    tax: abziehbareSteuer(geschaeftlich(s.tax, doc.privateShare), gespeicherterAnteil({}, totals.taxes.find((t) => t.rate === s.rate)?.vorsteuerAnteil)),
  }));
  return ziel.map((t) => {
    const recorded = bisher.filter((r) => r.rate === t.rate);
    return {
      rate: t.rate,
      base: t.base - recorded.reduce((sum, r) => sum + r.base, 0),
      tax: t.tax - recorded.reduce((sum, r) => sum + r.tax, 0),
    };
  });
}

/**
 * Anteil der Zahlungen, die vor dem Rechnungsdatum liegen: Er ist mit der Rechnung abziehbar, nicht schon mit der
 * Zahlung (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 3 UStG, UStAE 15.3 Abs. 1 Satz 2), und deshalb bucht ihn
 * umsatzsteuer/vorsteuer-freigabe.ts als eigene Freigabe zum Rechnungsdatum. Zurück kommt, was die Ausgleiche und die
 * Freigaben bis `tag` (frühestens das Rechnungsdatum) noch nicht gezogen haben — also der noch offene Unterschied, nach
 * einer Aufhebung mit positivem Vorzeichen; leer, wenn es keinen gibt.
 */
export async function anteilZumRechnungsdatum(
  tx: Tx,
  doc: { id: string; privateShare: Prozent; documentDate: string | null },
  totals: InvoiceTotals,
  tag: string,
): Promise<TaxShare[]> {
  if (!doc.documentDate) return [];
  return (await vorsteuerAnteile(tx, doc, totals, 0, tag)) ?? [];
}
