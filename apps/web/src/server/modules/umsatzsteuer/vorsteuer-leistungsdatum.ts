import {
  leistungsdatum,
  vorsteuerWartetAufAusfuehrung,
  paidTaxShares,
  periodRange,
  type Cents,
  type InvoiceTotals,
  type TaxShare,
  type VatPeriod,
} from "@haben/core";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { geschaeftlich, ZWISCHENKONTEN } from "./vorsteuer-anteile.ts";

/*
 * Vorsteuer nach Leistungsdatum (#693, Stufe 2): Bei einem Eingangsbeleg ist die Vorsteuer in dem Zeitraum abziehbar, in
 * dem erstmalig beide Voraussetzungen erfüllt sind — die Leistung ist ausgeführt und eine Rechnung liegt vor (§ 15 Abs. 1
 * Satz 1 Nr. 1 UStG). Liegt das Leistungsdatum vor oder am Belegdatum, bleibt es deshalb beim Belegmonat. Liegt es
 * danach (Anzahlung, Abschlag vor der Leistung), zählt der gezahlte Anteil im Monat der Zahlung, frühestens in dem der
 * Rechnung (UStAE 15.3 Abs. 1 Satz 2), der Rest mit der Ausführung; eine Zahlung nach der Ausführung zählt deshalb
 * ebenfalls im Monat der Ausführung.
 *
 * Ein Beleg kann mehrere Zahlungen haben (Strom- und Gasabschläge im Ablesezeitraum): Jede Zahlung zieht ihren Anteil,
 * anteilig je Steuersatz und fortgeschrieben wie bei den Rechnungen (paidTaxShares), damit alle zusammen genau die
 * Vorsteuer des Belegs ergeben. Belege ohne Leistungsdatum nach dem Belegdatum zählt die gewöhnliche Abfrage nach dem
 * Belegdatum.
 *
 * Ein Storno bleibt beim Stornodatum mit umgekehrtem Vorzeichen (§ 17 Abs. 1 UStG); es trifft aber nie früher als die
 * Zahlung, deren Anteil es zurücknimmt, sonst entstünde in einem Zeitraum eine Minderung, in dem nichts stand.
 */

/** Zeile der Vorsteuer, wie sie in die Voranmeldung geht */
export interface VorsteuerZeile {
  documentId: string;
  /** Tag, an dem die Vorsteuer zählt */
  date: string;
  supplier: string;
  number: string;
  rate: number;
  base: Cents;
  tax: Cents;
}

export interface VorsteuerNachLeistungsdatum {
  /** Belege mit Leistungsdatum nach dem Belegdatum; ihre Vorsteuer zählt nicht nach dem Belegdatum */
  belege: Set<string>;
  /** Fertige Zeilen dieses Zeitraums, Privatanteil und Vorzeichen schon angewandt */
  zeilen: VorsteuerZeile[];
  /** Skonto vor der Ausführung (und seine Aufhebung davor): Es erlässt Steuer, die nie abgezogen war, und mindert nichts */
  skontoOhneMinderung: Set<string>;
}

/** Eine Zahlung auf den Beleg: Tag und Betrag (ohne Vorzeichen, in Cent); `erlass` bei Skonto vor der Ausführung */
interface Zahlung {
  date: string;
  amount: Cents;
  erlass?: boolean;
}

/** Der spätere von zwei ISO-Tagen (JJJJ-MM-TT): Der Vergleich läuft über die Schreibweise, nicht über Zahlen. */
function spaetererTag(a: string, b: string): string {
  return a.localeCompare(b) < 0 ? b : a;
}

/** Skonto-Ausbuchung des Belegs (write_offs, kind skontoErhalten); `reversesId` bei der Gegenzeile einer Aufhebung */
interface Skonto {
  id: string;
  documentId: string | null;
  reversesId: string | null;
  amount: number;
  date: string;
}

/**
 * Storno-Zeilen zu den Aufhebungen nach der Ausführung, deren Skonto vor ihr lag (`erlass`): Die Skonto-Abfrage in
 * vat-figures.ts zählt die Aufhebung als Vorsteuer im Monat der Aufhebung; der Storno nimmt sie mit umgekehrtem Vorzeichen
 * zurück, nie vor deren Tag (§ 17 Abs. 1 UStG), wie im Journal die Umkehr der Freigabe aus der Aufhebung.
 */
function stornoDerSkontoAufhebung(
  k: { id: string; supplier: string; number: string; net: Cents; tax: Cents; gross: Cents },
  betraege: { documentId: string; rate: number; net: Cents; tax: Cents }[],
  erlass: Skonto[],
  skontos: Skonto[],
  ausgefuehrt: string,
  storno: string,
): VorsteuerZeile[] {
  const erlassen = new Set(erlass.filter((x) => !x.reversesId).map((x) => x.id));
  // Mit Vorzeichen, gerechnet wie die Zeile der Skonto-Abfrage
  const totals = {
    net: k.net,
    tax: k.tax,
    gross: k.gross,
    taxes: betraege
      .filter((b) => b.documentId === k.id)
      .map((b) => ({ rate: b.rate, base: b.net, tax: b.tax }))
      .sort((x, y) => y.rate - x.rate),
  };
  return skontos
    .filter((r) => r.reversesId && erlassen.has(r.reversesId) && r.date.localeCompare(ausgefuehrt) >= 0)
    .flatMap((x) =>
      paidTaxShares(totals, -x.amount).map((share) => ({
        documentId: k.id,
        date: spaetererTag(storno, x.date),
        supplier: k.supplier,
        number: `Storno ${k.number}`.trim(),
        rate: share.rate,
        base: share.base,
        tax: share.tax,
      })),
    );
}

/** Belege mit Leistungszeitraum, deren Buchung die Vorsteuer auf das Zwischenkonto gelegt hat */
async function kandidatenLaden(q: Db | Tx) {
  const d = schema.documents;
  // Auch Belege nach dem Periodenende: Ein Skonto zur Vorkasse kann vor dem Rechnungsdatum liegen und mindert dann nichts
  // (skontoOhneMinderung); ihre Zeilen liegen nie vor dem Belegdatum und fallen am Ende aus dem Zeitraum.
  return await q
    .select({
      id: d.id,
      supplier: d.supplierName,
      number: d.invoiceNumber,
      datum: d.documentDate,
      von: d.serviceFrom,
      bis: d.serviceTo,
      payment: d.payment,
      privateShare: d.privateShare,
      vorsteuerAbzug: d.vorsteuerAbzug,
      reverseCharge: d.reverseCharge,
      erstattetBezahltes: d.erstattetBezahltes,
      category: d.category,
      net: d.net,
      tax: d.tax,
      gross: d.gross,
    })
    .from(d)
    .where(
      and(
        eq(d.status, "gebucht"),
        isNull(d.lexofficeVoucherId),
        isNotNull(d.documentDate),
        or(isNotNull(d.serviceFrom), isNotNull(d.serviceTo)),
        // Nachweis ist die Buchung, wie im Ausgleich (vorsteuer-ausgleich.ts): Nur ein Beleg, dessen Buchung die Vorsteuer
        // auf das Zwischenkonto gelegt hat, zählt nach dem Leistungsdatum. Altbestand ohne Zwischenkonto, bar oder privat
        // bezahlte Belege bleiben beim Belegdatum wie im Journal; ein Update ändert keine gemeldeten Monate
        sql`exists (select 1 from journal_entries e join journal_lines l on l.entry_id = e.id
                     where e.source_type = 'document' and e.source_id = ${d.id} and e.reverses_id is null
                       and l.account in (${ZWISCHENKONTEN[0]!}, ${ZWISCHENKONTEN[1]!}))`,
      ),
    );
}

type Kandidat = Awaited<ReturnType<typeof kandidatenLaden>>[number];

/** Zählt die Vorsteuer dieses Belegs nach dem Leistungsdatum statt nach dem Belegdatum? Dieselbe Regel wie beim Buchen */
function zaehltNachLeistungsdatum(k: Kandidat): boolean {
  return vorsteuerWartetAufAusfuehrung({
    belegdatum: k.datum,
    leistungVon: k.von,
    leistungBis: k.bis,
    reverseCharge: k.reverseCharge,
    category: k.category,
    gross: k.gross,
    erstattetBezahltes: k.erstattetBezahltes,
  });
}

/** Zuordnung oder Verrechnung auf einen Beleg, mit dem Tag, an dem sie wirkt */
interface Ausgleich {
  documentId: string | null;
  reversesId: string | null;
  amount: number;
  date: string;
}

/** Was die Nebenbücher zu den Belegen wissen: Beträge je Satz, Storno, Zahlungen, Barzahlung und Skonto */
interface Nebenbuecher {
  betraege: { documentId: string; rate: number; net: Cents; tax: Cents }[];
  stornoAm: Map<string, string>;
  zahlungen: Map<string, Zahlung[]>;
  /** Zahlungen ohne ihre Aufhebungen: bei einem stornierten Beleg der Stand vor dem Storno */
  zahlungenVorStorno: Map<string, Zahlung[]>;
  barAm: Map<string, string>;
  skontos: Skonto[];
}

/**
 * Zahlungen je Beleg, nur die auf diesen Beleg (Ausgang, negativ), verteilt wird nach Betrag. Eine aufgehobene Zuordnung
 * bleibt am Tag der Zahlung stehen, ihre Gegenzeile nimmt den Anteil am Tag der Aufhebung zurück (allocations.date, #782),
 * damit ein gemeldeter Zeitraum unverändert bleibt. Bei einem stornierten Beleg hat der Storno die Zuordnungen aufgehoben;
 * dort zählt der Stand vor dem Storno, die Rücknahme übernimmt die Stornozeile.
 */
function zahlungenJeBeleg(ausgleiche: Ausgleich[]): Pick<Nebenbuecher, "zahlungen" | "zahlungenVorStorno"> {
  const zahlungen = new Map<string, Zahlung[]>();
  const zahlungenVorStorno = new Map<string, Zahlung[]>();
  const eintragen = (map: Map<string, Zahlung[]>, z: Ausgleich) => {
    // Zahlung: negativer Betrag; Gegenzeile einer Aufhebung: positiver Betrag mit reverses_id
    if (!z.documentId || (z.reversesId ? z.amount <= 0 : z.amount >= 0)) return;
    map.set(z.documentId, [...(map.get(z.documentId) ?? []), { date: z.date, amount: -z.amount }]);
  };
  for (const z of ausgleiche) {
    eintragen(zahlungen, z);
    if (!z.reversesId) eintragen(zahlungenVorStorno, z);
  }
  return { zahlungen, zahlungenVorStorno };
}

/** Lädt die Nebenbücher zu diesen Belegen */
async function nebenbuecherLaden(q: Db | Tx, ids: string[]): Promise<Nebenbuecher> {
  const a = schema.allocations;
  const t = schema.bankTransactions;
  const s = schema.documentSettlements;
  const c = schema.cashEntries;
  const w = schema.writeOffs;
  const [betraege, stornos, zuordnungen, verrechnungen, baren, skontos] = await Promise.all([
    q
      .select({
        documentId: schema.documentAmounts.documentId,
        rate: schema.documentAmounts.taxRate,
        net: schema.documentAmounts.net,
        tax: schema.documentAmounts.tax,
      })
      .from(schema.documentAmounts)
      .where(inArray(schema.documentAmounts.documentId, ids)),
    q
      .select({ documentId: schema.documentCancellations.documentId, date: schema.documentCancellations.date })
      .from(schema.documentCancellations)
      .where(inArray(schema.documentCancellations.documentId, ids)),
    q
      .select({ id: a.id, documentId: a.documentId, reversesId: a.reversesId, amount: a.amount, wirktAm: a.date, bookingDate: t.bookingDate })
      .from(a)
      .innerJoin(t, eq(t.id, a.transactionId))
      .where(inArray(a.documentId, ids)),
    q.select({ id: s.id, documentId: s.documentId, reversesId: s.reversesId, amount: s.amount, date: s.date }).from(s).where(inArray(s.documentId, ids)),
    q
      .select({ documentId: c.documentId, date: c.date })
      .from(c)
      .where(and(inArray(c.documentId, ids), isNull(c.reversesId))),
    q
      .select({ id: w.id, documentId: w.documentId, reversesId: w.reversesId, amount: w.amount, date: w.date })
      .from(w)
      .where(and(inArray(w.documentId, ids), eq(w.kind, "skontoErhalten"))),
  ]);
  const zuordnungsTage = zuordnungen.map(({ wirktAm, bookingDate, ...z }) => ({ ...z, date: wirktAm ?? bookingDate }));
  return {
    betraege,
    stornoAm: new Map(stornos.map((x) => [x.documentId, x.date])),
    ...zahlungenJeBeleg([...zuordnungsTage, ...verrechnungen]),
    barAm: new Map(baren.flatMap((x) => (x.documentId ? [[x.documentId, x.date] as const] : []))),
    skontos,
  };
}

/** Zahlungen auf den Beleg, wie die Zahlungsart sie kennt; `datum` ist das Belegdatum */
function zahlungenDesBelegs(k: Kandidat, datum: string, gross: Cents, nb: Nebenbuecher): Zahlung[] {
  // Privat bezahlt ist der Beleg mit der Buchung ausgeglichen, wie im Journal (belegbuchung.ts parkt nichts): Zahltag ist
  // das Belegdatum, an dem die Einlage gebucht wird
  if (k.payment === "privat") return [{ date: datum, amount: gross }];
  if (k.payment === "kasse") {
    const bar = nb.barAm.get(k.id);
    return bar ? [{ date: bar, amount: gross }] : [];
  }
  // Am selben Tag die Zahlung vor ihrer Aufhebung
  return [...((nb.stornoAm.has(k.id) ? nb.zahlungenVorStorno : nb.zahlungen).get(k.id) ?? [])].sort(
    (x, y) => x.date.localeCompare(y.date) || y.amount - x.amount,
  );
}

/**
 * Die Zahlungen bis zur Ausführung, dazu der Rest am Tag der Ausführung und der Erlass durch Skonto davor, nach Tagen
 * sortiert (am selben Tag die Zahlung vor dem Erlass).
 */
function zahlungenBisZurAusfuehrung(gezahlt: Zahlung[], erlass: Skonto[], ausgefuehrt: string, gross: Cents): Zahlung[] {
  // Was bis zur Ausführung nicht gezahlt ist, zählt mit ihr: Dann sind Leistung und Rechnung da (§ 15 Abs. 1 Satz 1 Nr. 1
  // Satz 1). Spätere Zahlungen und Aufhebungen ändern an der Vorsteuer nichts mehr.
  const bisDahin = [...gezahlt.filter((z) => z.date.localeCompare(ausgefuehrt) <= 0), { date: ausgefuehrt, amount: gross }];
  return [...bisDahin, ...erlass.map((x) => ({ date: x.date, amount: x.reversesId ? -Math.abs(x.amount) : Math.abs(x.amount), erlass: true }))].sort(
    (x, y) => x.date.localeCompare(y.date) || Number(x.erlass ?? false) - Number(y.erlass ?? false),
  );
}

/**
 * Geschäftlicher Anteil je Steuersatz, der zwischen zwei erledigten Beträgen abziehbar wird. Kumuliert gerundet, wie im
 * Journal (vorsteuer-ausgleich.ts): Je Teilbetrag gerundet ergäben die Zeilen zusammen nicht genau die geschäftliche
 * Vorsteuer des Belegs.
 */
function anteilJeSatz(totals: InvoiceTotals, privateShare: number, vorher: Cents, nachher: Cents): TaxShare[] {
  const bis = paidTaxShares(totals, nachher);
  const von = paidTaxShares(totals, vorher);
  return totals.taxes.map(({ rate }) => {
    const n = bis.find((x) => x.rate === rate);
    const v = von.find((x) => x.rate === rate);
    return {
      rate,
      base: geschaeftlich(n?.base ?? 0, privateShare) - geschaeftlich(v?.base ?? 0, privateShare),
      tax: geschaeftlich(n?.tax ?? 0, privateShare) - geschaeftlich(v?.tax ?? 0, privateShare),
    };
  });
}

/** Zeilen der Zahlungen: Jede Zahlung zieht ihren Anteil, ein Erlass durch Skonto erledigt ohne Zeile */
function zeilenDerZahlungen(k: Kandidat & { datum: string }, totals: InvoiceTotals, zahlungen: Zahlung[], storno: string | undefined): VorsteuerZeile[] {
  const zeilen: VorsteuerZeile[] = [];
  let erledigt = 0;
  for (const z of zahlungen) {
    const vorher = erledigt;
    erledigt = Math.max(0, Math.min(totals.gross, erledigt + z.amount));
    if (erledigt === vorher || z.erlass) continue;
    // Die Rechnung muss vorliegen: nie früher als ihr Datum
    const tag = spaetererTag(z.date, k.datum);
    for (const { rate, base, tax } of anteilJeSatz(totals, k.privateShare, vorher, erledigt)) {
      zeilen.push({ documentId: k.id, date: tag, supplier: k.supplier, number: k.number, rate, base, tax });
      // Ein Storno nimmt den Anteil mit umgekehrtem Vorzeichen zurück, aber nie vor dem Stornodatum: Stand er in einem
      // schon gemeldeten Zeitraum, berichtigt er dort, sonst hebt er sich im selben Zeitraum auf (§ 17 Abs. 1 UStG).
      if (storno) {
        zeilen.push({
          documentId: k.id,
          date: spaetererTag(storno, tag),
          supplier: k.supplier,
          number: `Storno ${k.number}`.trim(),
          rate,
          base: -base,
          tax: -tax,
        });
      }
    }
  }
  return zeilen;
}

/**
 * Zeilen eines Belegs über alle Zeiträume und die Skontos vor der Ausführung (`erlass`); null, wenn es nichts abzuziehen
 * gibt (Kleinunternehmer, Beleg ohne Abzug, ohne Beträge).
 */
function zeilenDesBelegs(k: Kandidat, nb: Nebenbuecher): { zeilen: VorsteuerZeile[]; erlass: Skonto[] } | null {
  if (!k.vorsteuerAbzug || !k.datum) return null;
  const saetze = nb.betraege
    .filter((b) => b.documentId === k.id)
    .map((b) => ({ rate: b.rate, base: Math.abs(b.net), tax: Math.abs(b.tax) }))
    .sort((x, y) => y.rate - x.rate);
  const gross = Math.abs(k.gross);
  if (saetze.length === 0 || gross === 0) return null;
  const totals = { net: Math.abs(k.net), tax: Math.abs(k.tax), gross, taxes: saetze };

  const ausgefuehrt = leistungsdatum({ belegdatum: k.datum, leistungVon: k.von, leistungBis: k.bis });
  // Skonto vor der Ausführung erlässt den Rest, bevor seine Steuer abziehbar war: Es zählt als erledigt, ohne Zeile, und
  // die gewöhnliche Minderung im Skontomonat entfällt (wie im Journal, vorsteuer-ausgleich.ts). Seine Aufhebung vor der
  // Ausführung nimmt das zurück; eine Aufhebung danach zählt wie gewohnt im Monat der Aufhebung.
  const erlass = nb.skontos.filter((x) => x.documentId === k.id && x.date < ausgefuehrt);
  const zahlungen = zahlungenBisZurAusfuehrung(zahlungenDesBelegs(k, k.datum, gross, nb), erlass, ausgefuehrt, gross);
  const storno = nb.stornoAm.get(k.id);
  const zeilen = zeilenDerZahlungen({ ...k, datum: k.datum }, totals, zahlungen, storno);
  // Ein Skonto vor der Ausführung, das erst nach ihr aufgehoben wird, gibt seine Steuer im Monat der Aufhebung frei; das
  // zählt die gewöhnliche Skonto-Abfrage (vat-figures.ts). Ein späterer Storno nimmt auch das zurück.
  if (storno) zeilen.push(...stornoDerSkontoAufhebung(k, nb.betraege, erlass, nb.skontos, ausgefuehrt, storno));
  return { zeilen, erlass };
}

/**
 * Vorsteuer der Belege, deren Leistung erst nach dem Belegdatum ausgeführt ist (#693). `belege` enthält alle solche
 * Belege, damit die gewöhnliche Abfrage sie nicht zusätzlich nach dem Belegdatum zählt.
 */
export async function vorsteuerNachLeistungsdatum(period: VatPeriod, q: Db | Tx = db): Promise<VorsteuerNachLeistungsdatum> {
  const { start, end } = periodRange(period);
  const vorzeitig = (await kandidatenLaden(q)).filter(zaehltNachLeistungsdatum);
  const belege = new Set(vorzeitig.map((k) => k.id));
  const skontoOhneMinderung = new Set<string>();
  if (vorzeitig.length === 0) return { belege, zeilen: [], skontoOhneMinderung };

  const nb = await nebenbuecherLaden(q, [...belege]);
  const zeilen: VorsteuerZeile[] = [];
  for (const k of vorzeitig) {
    const beleg = zeilenDesBelegs(k, nb);
    if (!beleg) continue;
    for (const x of beleg.erlass) skontoOhneMinderung.add(x.id);
    zeilen.push(...beleg.zeilen);
  }
  return { belege, zeilen: zeilen.filter((z) => z.date >= start && z.date < end && z.tax !== 0), skontoOhneMinderung };
}
