import { ACCOUNTS, settlementTaxShares, vorsteuerAusgleichPosting, type InvoiceTotals, type Kontenrahmen, type PostingLine, type TaxShare } from "@haben/core";
import { eq, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";

/*
 * Vorsteuer einer Gutschrift, die bereits Bezahltes erstattet (#786): Beim Buchen steht sie auf dem Zwischenkonto
 * (SKR03 1548, SKR04 1434). Erst der Ausgleich — Bankerstattung, Verrechnung, Kursdifferenz — zieht den Anteil auf die
 * Vorsteuer um (§ 17 Abs. 1 Satz 2 und 8 UStG), damit Kz 66 die Minderung genau dann sieht. Der Anteil ist anteilig je
 * Steuersatz und wird fortgeschrieben wie bei den Rechnungen (settlementTaxShares): Ziel kumuliert minus dem, was die
 * bisherigen Ausgleiche schon umgebucht haben. So ergeben alle Ausgleiche zusammen genau die Vorsteuer des Belegs.
 *
 * Bei Zuordnung, Ausbuchung und Kursdifferenz hängt die Umbuchung an der Buchung des Ausgleichs: Aufheben und Storno
 * drehen dann dieselben Zeilen mit um, ohne eigenen Weg und ohne Rückwirkung (reverseLines). Die Verrechnung bucht sonst
 * nichts und bekommt deshalb eine eigene Buchung, die ihre Gegenzeile mit umdreht.
 *
 * Ausgebuchtes Skonto zählt hier nicht mit: Es erstattet nichts, sondern erlässt den Rest. Seine Steuer wird deshalb
 * nicht gezogen, sondern vom Zwischenkonto abgeschrieben (documentWriteOffPosting mit der Angabe), sonst stünde die
 * Vorsteuer für Geld, das nie zurückkommt.
 */

/** Beträge des Belegs je Steuersatz, wie sie auf der Rechnung stehen (nicht nachgerechnet) */
export async function belegTotals(tx: Tx, doc: { id: string; net: number; tax: number; gross: number }): Promise<InvoiceTotals> {
  const rows = await tx.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, doc.id));
  const taxes = rows.map((r) => ({ rate: r.taxRate, base: r.net, tax: r.tax })).sort((a, b) => b.rate - a.rate);
  return { net: doc.net, tax: doc.tax, gross: doc.gross, taxes };
}

/** Steuersatz zum Steuerschlüssel der Vorsteuer; das Zwischenkonto trägt nur 19 % und 7 % */
function satzZumSchluessel(code: string | null): number | null {
  if (code === "VSt19") return 1900;
  if (code === "VSt7") return 700;
  return null;
}

/**
 * Beide Konten dieses Zwischenkontos: SKR03 1548 und SKR04 1434. Nach einem Wechsel des Kontenrahmens zum Jahreswechsel
 * steht die Buchung des Belegs noch im alten Rahmen; gesucht wird deshalb in beiden, gebucht wird im eingestellten.
 */
const ZWISCHENKONTEN = [ACCOUNTS.SKR03.vorsteuerNochNichtAbziehbar, ACCOUNTS.SKR04.vorsteuerNochNichtAbziehbar];

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
 * Skonto. Vorzeichen wie in `settledOn` (Gutschrift positiv).
 */
async function steuerlichAusgeglichen(tx: Tx, documentId: string): Promise<number> {
  const [row] = await tx.execute<{ summe: number }>(sql`
    select coalesce(sum(amount), 0)::int as summe from (
      select amount from allocations where document_id = ${documentId}
      union all select amount from document_settlements where document_id = ${documentId}
      union all select amount from write_offs where document_id = ${documentId} and kind <> 'skontoErhalten'
    ) ausgeglichen`);
  return Number(row?.summe ?? 0);
}

/**
 * Was die bisherigen Ausgleiche dieses Belegs schon vom Zwischenkonto auf die Vorsteuer umgebucht haben, je Steuersatz,
 * mit Gegenbuchungen (Aufhebung) netto. Gelesen wird das Journal, nicht aus den Beträgen gerechnet: So stimmt der
 * fortgeschriebene Anteil auch dann, wenn ein Ausgleich vor dieser Umbuchung lag — der Saldo des Kontos ist die Wahrheit
 * über das, was noch offen ist.
 */
async function bisherUmgebucht(tx: Tx, documentId: string): Promise<TaxShare[]> {
  const rows = await tx.execute<{ tax_code: string | null; bewegt: number; basis: number }>(sql`
    select l.tax_code, sum(l.debit - l.credit)::int as bewegt, sum(coalesce(l.basis, 0))::int as basis
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
     where (l.account = ${ZWISCHENKONTEN[0]!} or l.account = ${ZWISCHENKONTEN[1]!})
       and ((e.source_type = 'allocation' and e.source_id in (select id from allocations where document_id = ${documentId}))
         or (e.source_type = 'verrechnung' and e.source_id in (select id from document_settlements where document_id = ${documentId}))
         or (e.source_type = 'ausbuchung' and e.source_id in
               (select id from write_offs where document_id = ${documentId} and kind <> 'skontoErhalten')))
     group by l.tax_code`);
  return [...rows].flatMap((r) => {
    const rate = satzZumSchluessel(r.tax_code);
    return rate === null ? [] : [{ rate, base: Number(r.basis), tax: Number(r.bewegt) }];
  });
}

/**
 * Zeilen der Umbuchung für einen Ausgleich dieses Belegs; leer, wenn der Beleg die Angabe nicht trägt, seine Buchung
 * nichts auf das Zwischenkonto gelegt hat (Altbestand, Kleinunternehmer, 0 %) oder auf diesen Ausgleich kein Anteil
 * entfällt. `amount` trägt das Vorzeichen des Ausgleichs (Zuordnung, Kursdifferenz, Verrechnung), wie in `settledOn`;
 * erst nach dem Sperren von Beleg und Umsatz aufrufen.
 */
export async function vorsteuerAusgleich(
  tx: Tx,
  doc: { id: string; erstattetBezahltes: boolean },
  totals: InvoiceTotals,
  amount: number,
  kontenrahmen: Kontenrahmen,
): Promise<PostingLine[]> {
  if (!doc.erstattetBezahltes) return [];
  // Der Saldo kann nach einem Wechsel des Kontenrahmens auf dem Konto des alten Rahmens stehen; gebucht wird die
  // Umbuchung im eingestellten, mit dessen Vorsteuerkonto, damit Kz 66 sie sieht
  if (!(await aufDemZwischenkonto(tx, doc.id))) return [];
  const bisher = await bisherUmgebucht(tx, doc.id);
  return vorsteuerAusgleichPosting(settlementTaxShares(totals, await steuerlichAusgeglichen(tx, doc.id), bisher, amount), kontenrahmen);
}
