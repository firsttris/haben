import { taxOf, type Cents } from "./money.ts";

/**
 * Kennzahlen der Umsatzsteuer-Voranmeldung, die Haben derzeit unterstützt.
 * Kz 81 und 86 sind steuerpflichtige Bemessungsgrundlagen, Kz 21 (Reverse Charge im EU-Ausland),
 * 45 (nicht steuerbar) und 48 (steuerfrei ohne Vorsteuerabzug) Umsätze ohne Steuer; ELSTER erwartet
 * dort volle Euro. Kz 46 und 84 sind Bemessungsgrundlagen von Leistungen, für die du als Empfänger die Steuer
 * schuldest (§ 13b UStG), in vollen Euro; Kz 47 und 85 die Steuer dazu in Cent. Kz 66 ist Vorsteuer, Kz 67
 * die Vorsteuer aus § 13b, beide in Cent. Kz 41 (innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.) und 43
 * (weitere steuerfreie Umsätze mit Vorsteuerabzug, hier Ausfuhrlieferungen) in vollen Euro; Kz 89 und 93 die
 * Bemessungsgrundlagen steuerpflichtiger innergemeinschaftlicher Erwerbe zu 19 und 7 % in vollen Euro, die Steuer daraus
 * rechnet das Formular wie bei Kz 81 und 86; Kz 61 die Vorsteuer aus dem Erwerb in Cent (Vordruckmuster USt 1 A 2026); Kz 62 die
 * entstandene Einfuhrumsatzsteuer (§ 15 Abs. 1 Satz 1 Nr. 2 UStG) in Cent.
 * Kz 83 wird gerechnet. Alle Werte dürfen negativ
 * sein, etwa wenn Gutschriften im Monat überwiegen.
 */
export interface UstvaValues {
  kz81: Cents;
  kz86: Cents;
  kz66: Cents;
  kz21?: Cents;
  kz45?: Cents;
  kz48?: Cents;
  kz46?: Cents;
  kz47?: Cents;
  kz84?: Cents;
  kz85?: Cents;
  kz67?: Cents;
  kz41?: Cents;
  kz43?: Cents;
  kz89?: Cents;
  kz93?: Cents;
  kz61?: Cents;
  /** Entstandene Einfuhrumsatzsteuer, als Vorsteuer abziehbar */
  kz62?: Cents;
  /** Abzug der festgesetzten Sondervorauszahlung (Dauerfristverlängerung), in der letzten Voranmeldung des Jahres */
  kz39?: Cents;
}

export interface UstvaFigures {
  /** Bemessungsgrundlage 19 % in Cent, auf volle Euro abgerundet */
  kz81: Cents;
  tax81: Cents;
  /** Bemessungsgrundlage 7 % in Cent, auf volle Euro abgerundet */
  kz86: Cents;
  tax86: Cents;
  /** Umsätze ohne Steuer in Cent, auf volle Euro abgerundet */
  kz21: Cents;
  kz45: Cents;
  kz48: Cents;
  kz66: Cents;
  /** § 13b: Bemessungsgrundlagen in vollen Euro, Steuer und Vorsteuer in Cent */
  kz46: Cents;
  kz47: Cents;
  kz84: Cents;
  kz85: Cents;
  kz67: Cents;
  /** Steuerfreie Lieferungen mit Vorsteuerabzug in vollen Euro: innergemeinschaftlich (41), Ausfuhr (43) */
  kz41: Cents;
  kz43: Cents;
  /** Innergemeinschaftlicher Erwerb: Bemessungsgrundlagen in vollen Euro, Steuer daraus, Vorsteuer (61) in Cent */
  kz89: Cents;
  tax89: Cents;
  kz93: Cents;
  tax93: Cents;
  kz61: Cents;
  /** Einfuhrumsatzsteuer in Cent */
  kz62: Cents;
  /** Abzug der Sondervorauszahlung, centgenau (§ 48 Abs. 4 UStDV) */
  kz39: Cents;
  /** Verbleibende Vorauszahlung; negativ = Erstattung */
  kz83: Cents;
}

/** Bemessungsgrundlagen gibt ELSTER nur in vollen Euro an; Cent fallen weg. */
export function toWholeEuros(cents: Cents): Cents {
  return Math.trunc(cents / 100) * 100;
}

export function computeUstva(input: UstvaValues): UstvaFigures {
  const kz81 = toWholeEuros(input.kz81);
  const kz86 = toWholeEuros(input.kz86);
  const tax81 = taxOf(kz81, 1900);
  const tax86 = taxOf(kz86, 700);
  const kz89 = toWholeEuros(input.kz89 ?? 0);
  const kz93 = toWholeEuros(input.kz93 ?? 0);
  const tax89 = taxOf(kz89, 1900);
  const tax93 = taxOf(kz93, 700);
  const kz61 = input.kz61 ?? 0;
  const kz62 = input.kz62 ?? 0;
  return {
    kz81,
    tax81,
    kz86,
    tax86,
    kz21: toWholeEuros(input.kz21 ?? 0),
    kz45: toWholeEuros(input.kz45 ?? 0),
    kz48: toWholeEuros(input.kz48 ?? 0),
    kz66: input.kz66,
    kz46: toWholeEuros(input.kz46 ?? 0),
    kz47: input.kz47 ?? 0,
    kz84: toWholeEuros(input.kz84 ?? 0),
    kz85: input.kz85 ?? 0,
    kz67: input.kz67 ?? 0,
    kz41: toWholeEuros(input.kz41 ?? 0),
    kz43: toWholeEuros(input.kz43 ?? 0),
    kz89,
    tax89,
    kz93,
    tax93,
    kz61,
    kz62,
    kz39: input.kz39 ?? 0,
    kz83: tax81 + tax86 + tax89 + tax93 + (input.kz47 ?? 0) + (input.kz85 ?? 0) - input.kz66 - (input.kz67 ?? 0) - kz61 - kz62 - (input.kz39 ?? 0),
  };
}
