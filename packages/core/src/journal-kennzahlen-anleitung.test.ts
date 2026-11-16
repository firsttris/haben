import { describe, expect, it } from "vitest";
import { totalsFromTaxes } from "./invoice.ts";
import { JOURNAL_KENNZAHLEN, kennzahlenAusJournal, type JournalKennzahl } from "./journal-kennzahlen.ts";
import { documentPosting } from "./document-posting.ts";
import { invoicePosting, type Kontenrahmen } from "./posting.ts";
import type { TaxTreatment } from "./treatment.ts";

/*
 * Referenzfälle „Sachverhalt → Kennzahl“ nach der amtlichen Anleitung zur Umsatzsteuer-Voranmeldung 2026 (#1203, Vorschlag
 * von thomas-baumeister in #1144): Die Anleitung sagt je Kennzahl, was hineingehört. Die Fälle prüfen genau die Zuordnung
 * von Konto und Steuerschlüssel zur Kennzahl (kennzahlenAusJournal), die die Verprobung nicht sieht, weil sie mit derselben
 * Zuordnung rechnet. Gebucht wird wie in Haben (invoicePosting, documentPosting); erwartet ist nur, in welcher Kennzahl der
 * Betrag landet, und dass keine andere etwas bekommt. Die Beträge sind erfunden, die Zuordnung steht in der Quelle.
 *
 * Quelle: ELSTER, „Anleitung zur UStVA 2026“, https://www.elster.de/eportal/helpGlobal?themaGlobal=help_ustva_2026 (Abschnitt
 * je Kennzahl, Anker #kz81 usw.), abgerufen am 16.11.2026.
 */

/** Nur die Kennzahlen mit Betrag; so fällt auch auf, wenn ein Betrag zusätzlich in einer anderen landet */
const belegt = (k: Record<JournalKennzahl, number>) => Object.fromEntries(JOURNAL_KENNZAHLEN.filter((f) => k[f] !== 0).map((f) => [f, k[f]]));

const netto = (rate: 1900 | 700 | 0, base: number) => totalsFromTaxes([{ rate, base, tax: Math.round((base * rate) / 10_000) }]);

describe.each(["SKR03", "SKR04"] as const)("Anleitung zur UStVA 2026: Sachverhalt → Kennzahl (%s)", (kr: Kontenrahmen) => {
  const ausgang = (treatment: TaxTreatment, rate: 1900 | 700 | 0 = 0) =>
    belegt(kennzahlenAusJournal(kr, "soll", [invoicePosting(netto(rate, 1_000_00), kr, "soll", treatment)]));

  // Ausgangsrechnungen, Soll: die Kennzahl der Umsätze mit Rechnungsdatum
  const umsaetze: { fall: string; anker: string; treatment: TaxTreatment; rate?: 1900 | 700; erwartet: Partial<Record<JournalKennzahl, number>> }[] = [
    // #kz81: „die Bemessungsgrundlagen Ihrer Umsätze … zum allgemeinen Steuersatz von 19 %“
    { fall: "Lieferung im Inland zu 19 %", anker: "kz81", treatment: "regulaer", rate: 1900, erwartet: { kz81: 1_000_00, tax81: 190_00 } },
    // #kz86: zum ermäßigten Steuersatz von 7 %
    { fall: "Lieferung im Inland zu 7 %", anker: "kz86", treatment: "regulaer", rate: 700, erwartet: { kz86: 1_000_00, tax86: 70_00 } },
    // #kz21: „die von Ihnen nach § 3a Absatz 2 UStG im übrigen Gemeinschaftsgebiet ausgeführten sonstigen Leistungen …, für
    // die die Steuer in einem anderen Mitgliedstaat von einem dort ansässigen Leistungsempfänger geschuldet wird“
    { fall: "sonstige Leistung an einen Unternehmer im EU-Ausland (Reverse Charge)", anker: "kz21", treatment: "reverse_charge", erwartet: { kz21: 1_000_00 } },
    // #kz41: „steuerfreie innergemeinschaftliche Lieferungen (§ 4 Nummer 1 Buchstabe b UStG …) an Abnehmer mit USt-IdNr.“
    { fall: "innergemeinschaftliche Lieferung an einen Abnehmer mit USt-IdNr.", anker: "kz41", treatment: "ig_lieferung", erwartet: { kz41: 1_000_00 } },
    // #kz43: „steuerfreie Ausfuhrlieferungen (§ 4 Nummer 1 Buchstabe a UStG, § 6 UStG)“
    { fall: "Ausfuhrlieferung ins Drittland", anker: "kz43", treatment: "ausfuhr", erwartet: { kz43: 1_000_00 } },
    // #kz45: „übrige nicht steuerbare Umsätze (Nettoumsätze) …, deren Leistungsort nicht im Inland liegt“
    { fall: "sonstige Leistung mit Leistungsort im Drittland", anker: "kz45", treatment: "drittland", erwartet: { kz45: 1_000_00 } },
    { fall: "sonstige Leistung mit Leistungsort im EU-Ausland, kein Reverse Charge", anker: "kz45", treatment: "eu_sonstige", erwartet: { kz45: 1_000_00 } },
    // #kz48: „Steuerfreie Umsätze ohne Vorsteuerabzug sind z. B. Grundstücksvermietungen nach § 4 Nummer 12 UStG, Umsätze nach
    // § 4 Nummer 14 UStG …“
    { fall: "steuerfreier Umsatz nach § 4 UStG ohne Vorsteuerabzug", anker: "kz48", treatment: "steuerfrei", erwartet: { kz48: 1_000_00 } },
  ];

  it.each(umsaetze)("$fall → #$anker", ({ treatment, rate, erwartet }) => {
    expect(ausgang(treatment, rate)).toEqual(erwartet);
  });

  const eingang = (rate: 1900 | 700, reverseCharge: "eu" | "drittland" | "ig_erwerb" | null) => {
    // § 13b und Erwerb: gezahlt wird netto, die Steuer schuldest du selbst (documentPosting, reverseCharge)
    const t = netto(rate, 1_000_00);
    const totals = reverseCharge ? { ...t, gross: t.net } : t;
    const zeilen = documentPosting(totals, "buero", kr, "einzelunternehmen", "bank", true, undefined, 0, reverseCharge);
    return belegt(kennzahlenAusJournal(kr, "soll", [zeilen]));
  };

  // #kz66 (Zeile 38): „die gesetzlich geschuldete Steuer für Lieferungen und sonstige Leistungen, die von einem anderen
  // Unternehmer für sein Unternehmen ausgeführt worden sind“
  it("Eingangsrechnung eines inländischen Unternehmers zu 19 % → #kz66", () => {
    expect(eingang(1900, null)).toEqual({ kz66: 190_00 });
  });

  // #kz46/#kz47: „sonstige Leistungen nach § 3a Absatz 2 UStG eines im übrigen Gemeinschaftsgebiet ansässigen
  // Unternehmers“; #kz67 (Zeile 41): „die Umsatzsteuer aus Leistungen im Sinne des § 13b Absatz 1 und 2 UStG, die Sie als
  // Leistungsempfänger … schulden“
  it("sonstige Leistung eines Unternehmers aus dem EU-Ausland (§ 13b Abs. 1) → #kz46, #kz47 und #kz67", () => {
    expect(eingang(1900, "eu")).toEqual({ kz46: 1_000_00, kz47: 190_00, kz67: 190_00 });
  });

  // #kz84/#kz85: „Werklieferungen und die nicht in Zeile 30 einzutragenden sonstigen Leistungen eines im Ausland ansässigen
  // Unternehmers“; Vorsteuer wie oben in #kz67
  it("sonstige Leistung eines Unternehmers aus dem Drittland (§ 13b Abs. 2 Nr. 1) → #kz84, #kz85 und #kz67", () => {
    expect(eingang(1900, "drittland")).toEqual({ kz84: 1_000_00, kz85: 190_00, kz67: 190_00 });
  });

  // #kz89 bzw. #kz93: „steuerpflichtige innergemeinschaftliche Erwerbe zum allgemeinen Steuersatz von 19 %“ bzw. „zum
  // ermäßigten Steuersatz von 7 %“; #kz61 (Zeile 39): „die Umsatzsteuer für im Inland … bewirkten innergemeinschaftlichen
  // Erwerbe“
  it.each([
    [1900, { kz89: 1_000_00, tax89: 190_00, kz61: 190_00 }],
    [700, { kz93: 1_000_00, tax93: 70_00, kz61: 70_00 }],
  ] as const)("innergemeinschaftlicher Erwerb zu %s Basispunkten → #kz89 bzw. #kz93 und #kz61", (rate, erwartet) => {
    expect(eingang(rate, "ig_erwerb")).toEqual(erwartet);
  });

  // #kz62 (Zeile 40): „die entstandene Einfuhrumsatzsteuer für Gegenstände, die für das Unternehmen … eingeführt worden sind“
  it("Bescheid des Zolls über Einfuhrumsatzsteuer → #kz62", () => {
    const bescheid = totalsFromTaxes([{ rate: 0, base: 190_00, tax: 0 }]);
    const zeilen = documentPosting(bescheid, "einfuhrumsatzsteuer", kr, "einzelunternehmen", "bank");
    expect(belegt(kennzahlenAusJournal(kr, "soll", [zeilen]))).toEqual({ kz62: 190_00 });
  });
});
