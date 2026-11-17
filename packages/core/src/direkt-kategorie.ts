import { taxIncluded, type BasisPoints, type Cents } from "./money.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, side, type ExpenseCategory, type Kontenrahmen, type PostingLine } from "./posting.ts";

/*
 * Direkt buchen mit Kategorie und Steuersatz (Roadmap Platz 1, #324): Ein Bankumsatz ohne Beleg geht auf eine Einnahme-
 * oder Ausgabekategorie, nicht frei auf ein Konto mit Steuerschlüssel („Bewusst nicht“ in docs/roadmap.md). EÜR,
 * Voranmeldung und E-Bilanz hängen an den Kategorien und ihren Konten.
 *
 * - Einnahme (Erlöse): Die Umsatzsteuer entsteht mit der Leistung, nicht mit einer Rechnung (§ 13 Abs. 1 Nr. 1 UStG); an
 *   Privatkunden besteht keine Rechnungspflicht (§ 14 Abs. 2 Satz 1 Nr. 2 UStG). Haben bucht sie am Tag der Zahlung, bei
 *   Ist- wie bei Soll-Versteuerung: Ohne Rechnung kennt Haben keinen anderen Zeitpunkt, und eine vor der Leistung
 *   vereinnahmte Zahlung ist auch bei Soll im Monat der Zahlung zu versteuern (§ 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG).
 *   Steuerfreie Umsätze, Reverse Charge, innergemeinschaftliche Lieferungen und Ausfuhren brauchen eine Rechnung mit
 *   Pflichtangaben bzw. die Zusammenfassende Meldung; die gibt es hier nicht. Kleinunternehmer buchen ohne Steuer (§ 19 UStG).
 * - Nicht steuerbare Einnahme (#1131): Echter Schadenersatz ist kein Entgelt, es fehlt am Leistungsaustausch (UStAE 1.3
 *   Abs. 1 Satz 1 bis 3), etwa die Erstattung einer Plattform für verlorene Ware. Ohne Umsatzsteuer und ohne Kennzahl; in
 *   der EÜR „nicht umsatzsteuerbare Betriebseinnahmen“ (Anleitung Anlage EÜR 2025, Zeile 16). Ob echter Schadenersatz
 *   vorliegt (Satz 4), entscheidet der Nutzer. Als Kleinunternehmer (Zeilen 12 und 13) noch nicht.
 * - Ausgabe: brutto als Aufwand, ohne Vorsteuer. Den Vorsteuerabzug gibt es nur mit einer Rechnung nach §§ 14, 14a UStG
 *   (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG); mit Rechnung gehört die Ausgabe als Beleg unter Belege.
 */

export const EINNAHME_KATEGORIEN = {
  erloese: { label: "Erlöse", hint: "Erlöse aus Lieferungen und Leistungen, z. B. Zahlung eines Privatkunden" },
  nichtSteuerbar: {
    label: "Nicht steuerbare Einnahme (z. B. Schadenersatz)",
    hint: "Echter Schadenersatz oder Entschädigung ohne Leistungsaustausch, z. B. Erstattung einer Plattform für verlorene Ware",
  },
} as const;

export type EinnahmeKategorie = keyof typeof EINNAHME_KATEGORIEN;

/**
 * Ausgabekategorien, die ohne Beleg nicht gehen: Anlagen und geringwertige Wirtschaftsgüter brauchen das
 * Anlagenverzeichnis, die Einfuhrumsatzsteuer den Bescheid des Zolls, Bewirtung den Bewirtungsbeleg (§ 4 Abs. 5 Satz 1
 * Nr. 2 Satz 2 EStG), Geschenke die Empfänger (§ 4 Abs. 7 EStG). Bankgebühren gibt es unter „Direkt buchen“ schon.
 */
const NUR_MIT_BELEG = ["anlage", "hardware", "einfuhrumsatzsteuer", "bewirtung", "geschenke"] as const satisfies readonly ExpenseCategory[];
const SCHON_DIREKT = ["geldverkehr"] as const satisfies readonly ExpenseCategory[];

export const DIREKT_AUSGABE_KATEGORIEN = EXPENSE_CATEGORY_KEYS.filter(
  (k) => !(NUR_MIT_BELEG as readonly string[]).includes(k) && !(SCHON_DIREKT as readonly string[]).includes(k),
);

export type DirektKategorie = EinnahmeKategorie | ExpenseCategory;

/** Kategorie und Steuersatz einer Direktbuchung; gespeichert an der Zuordnung (allocations.category, tax_rate) */
export interface KategorieAngabe {
  kategorie: DirektKategorie;
  /** Basispunkte; Erlöse 1900 oder 700, als Kleinunternehmer 0; nicht steuerbare Einnahme und Ausgaben immer 0 */
  steuersatz: BasisPoints;
}

export const DIREKT_STEUERSAETZE = [1900, 700] as const;

const istEinnahme = (k: string): k is EinnahmeKategorie => Object.hasOwn(EINNAHME_KATEGORIEN, k);

export function kategorieArt(kategorie: string): "einnahme" | "ausgabe" | null {
  if (istEinnahme(kategorie)) return "einnahme";
  return Object.hasOwn(EXPENSE_CATEGORIES, kategorie) ? "ausgabe" : null;
}

/** Auswahl unter „Direkt buchen“: erst die Einnahmen, dann die Ausgabekategorien, die ohne Beleg gehen */
export function direktKategorienFuer(): { value: DirektKategorie; label: string; art: "einnahme" | "ausgabe" }[] {
  return [
    ...(Object.keys(EINNAHME_KATEGORIEN) as EinnahmeKategorie[]).map((value) => ({
      value,
      label: EINNAHME_KATEGORIEN[value].label,
      art: "einnahme" as const,
    })),
    ...DIREKT_AUSGABE_KATEGORIEN.map((value) => ({ value, label: EXPENSE_CATEGORIES[value].label, art: "ausgabe" as const })),
  ];
}

/** Was eine Direktbuchung auf eine Kategorie verhindert; null = buchbar. kleinunternehmer: Stand am Tag der Zahlung */
export function kategorieFehler(angabe: KategorieAngabe, kleinunternehmer: boolean): string | null {
  const art = kategorieArt(angabe.kategorie);
  if (art === null) return "Diese Kategorie gibt es nicht.";
  if (art === "ausgabe") {
    if ((NUR_MIT_BELEG as readonly string[]).includes(angabe.kategorie)) {
      return `„${EXPENSE_CATEGORIES[angabe.kategorie as ExpenseCategory].label}“ geht nur mit Beleg; bitte unter Belege buchen.`;
    }
    if ((SCHON_DIREKT as readonly string[]).includes(angabe.kategorie)) return "Bankgebühren bitte als „Kontoführung und Bankgebühren“ buchen.";
    if (angabe.steuersatz !== 0) {
      return "Ohne Rechnung gibt es keine Vorsteuer (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG). Mit Rechnung bitte den Beleg unter Belege buchen.";
    }
    return null;
  }
  if (angabe.kategorie === "nichtSteuerbar") {
    if (kleinunternehmer) return "Als Kleinunternehmer lässt sich eine nicht steuerbare Einnahme hier noch nicht buchen.";
    return angabe.steuersatz === 0 ? null : "Eine nicht steuerbare Einnahme hat keine Umsatzsteuer.";
  }
  if (kleinunternehmer) return angabe.steuersatz === 0 ? null : "Als Kleinunternehmer weist du keine Umsatzsteuer aus (§ 19 UStG).";
  if (angabe.steuersatz === 0) {
    return "Steuerfreie und nicht steuerbare Umsätze (auch Reverse Charge, Ausfuhr, innergemeinschaftliche Lieferung) bitte über eine Rechnung buchen.";
  }
  if (!(DIREKT_STEUERSAETZE as readonly number[]).includes(angabe.steuersatz)) return "Der Steuersatz muss 19 % oder 7 % sein.";
  return null;
}

/** Netto und Steuer im Betrag (Vorzeichen wie auf dem Konto); Ausgaben und Kleinunternehmer ohne Steuer */
export function kategorieAnteil(angabe: KategorieAngabe, amount: Cents): { base: Cents; tax: Cents } {
  const tax = kategorieArt(angabe.kategorie) === "einnahme" ? taxIncluded(amount, angabe.steuersatz) : 0;
  return { base: amount - tax, tax };
}

/**
 * Buchung eines Teils eines Bankumsatzes auf eine Kategorie (amount wie auf dem Konto, Eingang positiv). Einnahme: Bank
 * an Erlöse und Umsatzsteuer, die mit der Zahlung fällig ist (kein „nicht fällig“, auch bei Ist); Kleinunternehmer auf
 * die Erlöse nach § 19 UStG. Nicht steuerbare Einnahme: Bank an Schadenersatz, ohne Steuerschlüssel. Ausgabe: Aufwand
 * brutto an Bank. Die Gegenrichtung (Erstattung) dreht die Seiten.
 * Prüft die Angabe nicht gegen den Kleinunternehmer-Stand; das macht der Aufrufer mit kategorieFehler.
 */
export function kategoriePosting(angabe: KategorieAngabe, amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const fehler = kategorieFehler(angabe, angabe.kategorie === "erloese" && angabe.steuersatz === 0);
  if (fehler) throw new RangeError(fehler);
  const lines: PostingLine[] = [side(accounts.bank, amount, true, null)];
  if (!istEinnahme(angabe.kategorie)) {
    lines.push(side(EXPENSE_CATEGORIES[angabe.kategorie][kontenrahmen], -amount, true, "keineVSt"));
  } else if (angabe.kategorie === "nichtSteuerbar") {
    lines.push(side(accounts.schadenersatz, amount, false, null));
  } else if (angabe.steuersatz === 0) {
    lines.push(side(accounts.erloeseSonder.kleinunternehmer, amount, false, "KU"));
  } else {
    const rate = angabe.steuersatz as (typeof DIREKT_STEUERSAETZE)[number];
    const { base, tax } = kategorieAnteil(angabe, amount);
    const code = rate === 1900 ? "USt19" : "USt7";
    lines.push(side(accounts.erloese[rate], base, false, code), side(accounts.ust[rate], tax, false, code));
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Kurzer Text für Buchungstext und Anzeige: „Erlöse 19 %“, „Erlöse (Kleinunternehmer)“, „Nicht steuerbare Einnahme“, „Telefon“ */
export function kategorieText(angabe: KategorieAngabe): string {
  if (!istEinnahme(angabe.kategorie)) return EXPENSE_CATEGORIES[angabe.kategorie]?.label ?? angabe.kategorie;
  if (angabe.kategorie === "nichtSteuerbar") return "Nicht steuerbare Einnahme";
  const label = EINNAHME_KATEGORIEN[angabe.kategorie].label;
  return angabe.steuersatz === 0 ? `${label} (Kleinunternehmer)` : `${label} ${angabe.steuersatz / 100} %`;
}

/**
 * Aufladung eines Guthabens (#1356): Eine Zahlung ohne Beleg an einen Anbieter, bei dem das Geld als Guthaben liegt und
 * erst über eine spätere Rechnung verbraucht wird (etwa die Aufladung eines Mobilfunk-Guthabens). Bei der EÜR ist sie
 * im Monat der Zahlung Betriebsausgabe (§ 11 Abs. 2 EStG); Vorsteuer entsteht erst mit der Rechnung über die Leistung
 * (§ 15 Abs. 1 Satz 1 Nr. 1 UStG), die Aufladung selbst trägt keine. Gebucht wird wie „Direkt buchen“ auf eine Ausgabekategorie:
 * Bank gegen Aufwandskonto, kein Beleg.
 */
export const AUFLADUNG = {
  /** Bezeichnung der Zuordnungsart in Listen, Abgleich und Auswertungen */
  label: "Guthaben aufladen, Ausgabe ohne Vorsteuer",
  /** Kurztext im Zuordnungsdialog und im Buchungstext */
  text: "Aufladung Guthaben",
} as const;

/** Was eine Aufladung verhindert; null = buchbar. Sie ist immer eine Ausgabe und trägt nie einen Steuersatz. */
export function aufladungFehler(angabe: KategorieAngabe): string | null {
  if (kategorieArt(angabe.kategorie) !== "ausgabe") return "Eine Aufladung ist eine Ausgabe; bitte eine Ausgabekategorie wählen.";
  if (angabe.steuersatz !== 0) {
    return "Eine Aufladung trägt keine Vorsteuer (§ 15 Abs. 1 Satz 1 Nr. 1 UStG); sie entsteht erst mit der Rechnung über die Leistung.";
  }
  return kategorieFehler(angabe, false);
}

/** Buchung einer Aufladung: Bruttobetrag als Aufwand ohne Vorsteuer, Bank gegen das Konto der Ausgabekategorie */
export function aufladungPosting(angabe: KategorieAngabe, amount: Cents, kontenrahmen: Kontenrahmen): PostingLine[] {
  const fehler = aufladungFehler(angabe);
  if (fehler) throw new RangeError(fehler);
  return kategoriePosting(angabe, amount, kontenrahmen);
}
