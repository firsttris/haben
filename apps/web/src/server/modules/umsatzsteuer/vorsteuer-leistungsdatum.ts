import { leistungsdatum, paidTaxShares, periodRange, splitPrivateShare, type Cents, type VatPeriod } from "@haben/core";
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Vorsteuer nach Leistungsdatum (#693, Stufe 2): Bei einem Eingangsbeleg ist die Vorsteuer in dem Zeitraum abziehbar, in
 * dem erstmalig beide Voraussetzungen erfüllt sind — die Leistung ist ausgeführt und eine Rechnung liegt vor (§ 15 Abs. 1
 * Satz 1 Nr. 1 UStG). Liegt das Leistungsdatum vor oder am Belegdatum, bleibt es deshalb beim Belegmonat. Liegt es
 * danach (Anzahlung, Abschlag vor der Leistung), zählt der gezahlte Anteil im Monat der Zahlung (UStAE 15.3 Abs. 1
 * Satz 2), der Rest mit der Ausführung; eine Zahlung nach der Ausführung zählt deshalb ebenfalls im Monat der Ausführung.
 *
 * Ein Beleg kann mehrere Zahlungen haben (Strom- und Gasabschläge im Ablesezeitraum): Jede Zahlung zieht ihren Anteil,
 * anteilig je Steuersatz und fortgeschrieben wie bei den Rechnungen (paidTaxShares), damit alle zusammen genau die
 * Vorsteuer des Belegs ergeben. Ohne Leistungsdatum bleibt alles wie bisher: Das erledigt die gewöhnliche Abfrage.
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
}

/** Eine Zahlung auf den Beleg: Tag und Betrag (ohne Vorzeichen, in Cent) */
interface Zahlung {
  date: string;
  amount: Cents;
}

/** Der spätere von zwei ISO-Tagen (JJJJ-MM-TT): Der Vergleich läuft über die Schreibweise, nicht über Zahlen. */
function spaetererTag(a: string, b: string): string {
  return a.localeCompare(b) < 0 ? b : a;
}

/**
 * Vorsteuer der Belege, deren Leistung erst nach dem Belegdatum ausgeführt ist (#693). `belege` enthält alle solche
 * Belege, damit die gewöhnliche Abfrage sie nicht zusätzlich nach dem Belegdatum zählt.
 */
export async function vorsteuerNachLeistungsdatum(period: VatPeriod, q: Db | Tx = db): Promise<VorsteuerNachLeistungsdatum> {
  const { start, end } = periodRange(period);
  const d = schema.documents;
  // Belegdatum vor dem Periodenende: eine Anzahlung kann in einem früheren Monat liegen als ihre Zahlung. Ohne
  // Leistungszeitraum zählt der Beleg nach Belegdatum; er kommt deshalb nur mit, wenn er in den Zeitraum fällt.
  const kandidaten = await q
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
    .where(and(eq(d.status, "gebucht"), isNull(d.lexofficeVoucherId), lt(d.documentDate, end), or(isNotNull(d.serviceFrom), isNotNull(d.serviceTo))));

  const vorzeitig = kandidaten.filter((k) => {
    if (!k.datum) return false;
    // § 13b, innergemeinschaftlicher Erwerb und Einfuhrumsatzsteuer haben ihren eigenen Zeitpunkt; er bleibt
    if (k.reverseCharge || k.category === "einfuhrumsatzsteuer") return false;
    // Gutschrift: Sie berichtigt nach § 17 Abs. 1 UStG im Zeitraum der Änderung, also nach Belegdatum bzw. mit dem
    // Ausgleich („erstattet bereits Bezahltes“, #786), nicht nach § 15; der Leistungszeitraum spielt keine Rolle
    if (k.erstattetBezahltes || k.gross < 0) return false;
    return leistungsdatum({ belegdatum: k.datum, leistungVon: k.von, leistungBis: k.bis }) > k.datum;
  });
  const belege = new Set(vorzeitig.map((k) => k.id));
  if (vorzeitig.length === 0) return { belege, zeilen: [] };

  const ids = [...belege];
  const a = schema.allocations;
  const t = schema.bankTransactions;
  const s = schema.documentSettlements;
  const c = schema.cashEntries;
  const [betraege, stornos, zuordnungen, verrechnungen, baren] = await Promise.all([
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
  ]);
  const stornoAm = new Map(stornos.map((x) => [x.documentId, x.date]));
  // Nur die Zahlungen auf diesen Beleg (Ausgang, negativ), verteilt wird nach Betrag. Eine aufgehobene Zuordnung bleibt am
  // Tag der Zahlung stehen, ihre Gegenzeile nimmt den Anteil am Tag der Aufhebung zurück (allocations.date, #782), damit
  // ein gemeldeter Zeitraum unverändert bleibt. Bei einem stornierten Beleg hat der Storno die Zuordnungen aufgehoben;
  // dort zählt der Stand vor dem Storno, die Rücknahme übernimmt die Stornozeile weiter unten.
  const zuordnungsTage = zuordnungen.map(({ wirktAm, bookingDate, ...z }) => ({ ...z, date: wirktAm ?? bookingDate }));
  const zahlungen = new Map<string, Zahlung[]>();
  const zahlungenVorStorno = new Map<string, Zahlung[]>();
  const eintragen = (map: Map<string, Zahlung[]>, z: { documentId: string | null; reversesId: string | null; date: string; amount: number }) => {
    // Zahlung: negativer Betrag; Gegenzeile einer Aufhebung: positiver Betrag mit reverses_id
    if (!z.documentId || (z.reversesId ? z.amount <= 0 : z.amount >= 0)) return;
    map.set(z.documentId, [...(map.get(z.documentId) ?? []), { date: z.date, amount: -z.amount }]);
  };
  for (const z of [...zuordnungsTage, ...verrechnungen]) {
    eintragen(zahlungen, z);
    if (!z.reversesId) eintragen(zahlungenVorStorno, z);
  }
  const barAm = new Map(baren.flatMap((x) => (x.documentId ? [[x.documentId, x.date] as const] : [])));

  const zeilen: VorsteuerZeile[] = [];
  const geschaeftlich = (betrag: Cents, privateShare: number) => (privateShare === 0 ? betrag : splitPrivateShare(betrag, privateShare).business);

  for (const k of vorzeitig) {
    // Kleinunternehmer und Belege ohne Abzug: nichts abzuziehen, also auch nichts zu verteilen
    if (!k.vorsteuerAbzug || !k.datum) continue;
    const saetze = betraege
      .filter((b) => b.documentId === k.id)
      .map((b) => ({ rate: b.rate, base: Math.abs(b.net), tax: Math.abs(b.tax) }))
      .sort((x, y) => y.rate - x.rate);
    const gross = Math.abs(k.gross);
    if (saetze.length === 0 || gross === 0) continue;
    const totals = { net: Math.abs(k.net), tax: Math.abs(k.tax), gross, taxes: saetze };

    const ausgefuehrt = leistungsdatum({ belegdatum: k.datum, leistungVon: k.von, leistungBis: k.bis });
    let zahlungenDesBelegs: Zahlung[];
    if (k.payment === "privat") {
      // Kein Bankweg: Die Zahlung gilt mit der Ausführung der Leistung als geleistet (spätestens dann liegt die Rechnung vor)
      zahlungenDesBelegs = [];
    } else if (k.payment === "kasse") {
      const bar = barAm.get(k.id);
      zahlungenDesBelegs = bar ? [{ date: bar, amount: gross }] : [];
    } else {
      // Am selben Tag die Zahlung vor ihrer Aufhebung
      zahlungenDesBelegs = [...((stornoAm.has(k.id) ? zahlungenVorStorno : zahlungen).get(k.id) ?? [])].sort(
        (x, y) => x.date.localeCompare(y.date) || y.amount - x.amount,
      );
    }
    // Was bis zur Ausführung nicht gezahlt ist, zählt mit ihr: Dann sind Leistung und Rechnung da (§ 15 Abs. 1 Satz 1 Nr. 1
    // Satz 1). Spätere Zahlungen und Aufhebungen ändern an der Vorsteuer nichts mehr.
    zahlungenDesBelegs = [...zahlungenDesBelegs.filter((z) => z.date.localeCompare(ausgefuehrt) <= 0), { date: ausgefuehrt, amount: gross }];

    const storno = stornoAm.get(k.id);
    let erledigt = 0;
    for (const z of zahlungenDesBelegs) {
      const vorher = erledigt;
      erledigt = Math.max(0, Math.min(gross, erledigt + z.amount));
      if (erledigt === vorher) continue;
      const bis = paidTaxShares(totals, erledigt);
      const von = paidTaxShares(totals, vorher);
      for (const { rate } of saetze) {
        const nachher = bis.find((x) => x.rate === rate);
        const vorheriger = von.find((x) => x.rate === rate);
        const base = (nachher?.base ?? 0) - (vorheriger?.base ?? 0);
        const tax = (nachher?.tax ?? 0) - (vorheriger?.tax ?? 0);
        // Die Rechnung muss vorliegen: nie früher als ihr Datum
        const tag = spaetererTag(z.date, k.datum);
        zeilen.push({
          documentId: k.id,
          date: tag,
          supplier: k.supplier,
          number: k.number,
          rate,
          base: geschaeftlich(base, k.privateShare),
          tax: geschaeftlich(tax, k.privateShare),
        });
        // Ein Storno nimmt den Anteil mit umgekehrtem Vorzeichen zurück, aber nie vor dem Stornodatum: Stand er in einem
        // schon gemeldeten Zeitraum, berichtigt er dort, sonst hebt er sich im selben Zeitraum auf (§ 17 Abs. 1 UStG).
        if (storno) {
          zeilen.push({
            documentId: k.id,
            date: spaetererTag(storno, tag),
            supplier: k.supplier,
            number: `Storno ${k.number}`.trim(),
            rate,
            base: -geschaeftlich(base, k.privateShare),
            tax: -geschaeftlich(tax, k.privateShare),
          });
        }
      }
    }
  }

  return { belege, zeilen: zeilen.filter((z) => z.date >= start && z.date < end && z.tax !== 0) };
}
