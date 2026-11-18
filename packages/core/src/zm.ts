import { naechsterWerktag } from "./holidays.ts";
import type { Cents } from "./money.ts";

/*
 * Zusammenfassende Meldung (§ 18a UStG) an das Bundeszentralamt für Steuern: je USt-IdNr. des Kunden und Art der Leistung
 * die Summe der Bemessungsgrundlagen eines Meldezeitraums. Aufbau und Prüfregeln nach dem Schema zm_000005.xsd (Stand
 * 10.06.2025) und dem ERiC-Plugin checkZMDO (ERiC 43); die Fristen nach § 18a Abs. 1 und 2 UStG.
 */

/** Umsatzart laut Schema: L innergemeinschaftliche Lieferung, S sonstige Leistung (§ 3a Abs. 2 UStG), D Dreiecksgeschäft */
export type ZmArt = "L" | "S" | "D";

export const ZM_ART_LABEL: Record<ZmArt, string> = {
  L: "Innergemeinschaftliche Lieferung",
  S: "Sonstige Leistung",
  D: "Dreiecksgeschäft",
};

/** Eine Meldezeile: Summe der Bemessungsgrundlagen in Cent, gemeldet wird in vollen Euro */
export interface ZmZeile {
  ustId: string;
  art: ZmArt;
  betrag: Cents;
}

/** Ein Umsatz, der in die Meldung eingeht; Gutschriften, Stornos und Skonto mit negativer Bemessungsgrundlage */
export interface ZmPosten {
  ustId: string;
  art: ZmArt;
  base: Cents;
}

/**
 * Länderkennzeichen, die ERiC für die USt-IdNr. des Kunden annimmt (Prüfregel knre1_Laenderkennzeichen im Plugin
 * checkZMDO): Griechenland als EL, Nordirland als XI. DE weist das Plugin als inländische Nummer ab, GB nach dem Brexit.
 *
 * Je Land der Aufbau der Stellen nach dem Kennzeichen laut BZSt, „Aufbau der Umsatzsteuer-Identifikationsnummer (USt-IdNr.)
 * in den EU-Mitgliedstaaten“ (Stand 12.12.2025), auf die UStAE 18e.2 verweist. Wo das BZSt die Art der Stellen offenlässt
 * (AT nach dem U, CY vor dem Buchstaben), Ziffern wie in der Übersicht der EU-Kommission zu VIES (FAQ Frage 11); beim alten
 * irischen Aufbau an zweiter Stelle auch + und * wie dort. Prüfziffern veröffentlichen die Mitgliedstaaten nicht einheitlich;
 * Haben prüft sie nur bei der eigenen deutschen Nummer.
 */
const AUFBAU: Readonly<Record<string, { muster: RegExp; aus: string; form: string }>> = {
  AT: { muster: /^U\d{8}$/, aus: "Österreich", form: "ein U und acht Ziffern" },
  BE: { muster: /^\d{10}$/, aus: "Belgien", form: "zehn Ziffern; einer alten neunstelligen wird eine 0 vorangestellt" },
  BG: { muster: /^\d{9,10}$/, aus: "Bulgarien", form: "neun oder zehn Ziffern" },
  CY: { muster: /^\d{8}[A-Z]$/, aus: "Zypern", form: "acht Ziffern und einen Buchstaben" },
  CZ: { muster: /^\d{8,10}$/, aus: "Tschechien", form: "acht, neun oder zehn Ziffern" },
  DK: { muster: /^\d{8}$/, aus: "Dänemark", form: "acht Ziffern" },
  EE: { muster: /^\d{9}$/, aus: "Estland", form: "neun Ziffern" },
  EL: { muster: /^\d{9}$/, aus: "Griechenland", form: "neun Ziffern" },
  ES: { muster: /^[0-9A-Z]\d{7}[0-9A-Z]$/, aus: "Spanien", form: "neun Zeichen, Ziffern und nur an erster und letzter Stelle auch ein Buchstabe" },
  FI: { muster: /^\d{8}$/, aus: "Finnland", form: "acht Ziffern" },
  FR: { muster: /^[0-9A-Z]{2}\d{9}$/, aus: "Frankreich", form: "elf Zeichen, zwei Ziffern oder Buchstaben und dann neun Ziffern" },
  HR: { muster: /^\d{11}$/, aus: "Kroatien", form: "elf Ziffern" },
  HU: { muster: /^\d{8}$/, aus: "Ungarn", form: "acht Ziffern" },
  IE: {
    muster: /^(\d[0-9A-Z+*]\d{5}[A-Z]|\d{7}[A-W][A-I])$/,
    aus: "Irland",
    form: "acht Zeichen mit einem Buchstaben am Ende (an zweiter Stelle auch ein Buchstabe, + oder *) oder sieben Ziffern und zwei Buchstaben",
  },
  IT: { muster: /^\d{11}$/, aus: "Italien", form: "elf Ziffern" },
  LT: { muster: /^(\d{9}|\d{12})$/, aus: "Litauen", form: "neun oder zwölf Ziffern" },
  LU: { muster: /^\d{8}$/, aus: "Luxemburg", form: "acht Ziffern" },
  LV: { muster: /^\d{11}$/, aus: "Lettland", form: "elf Ziffern" },
  MT: { muster: /^\d{8}$/, aus: "Malta", form: "acht Ziffern" },
  NL: { muster: /^[0-9A-Z+*]{12}$/, aus: "den Niederlanden", form: "zwölf Zeichen, etwa 123456789B01" },
  PL: { muster: /^\d{10}$/, aus: "Polen", form: "zehn Ziffern" },
  PT: { muster: /^\d{9}$/, aus: "Portugal", form: "neun Ziffern" },
  RO: { muster: /^[1-9]\d{1,9}$/, aus: "Rumänien", form: "bis zu zehn Ziffern, die erste nicht 0" },
  SE: { muster: /^\d{10}01$/, aus: "Schweden", form: "zwölf Ziffern, die letzten beiden 01" },
  SI: { muster: /^\d{8}$/, aus: "Slowenien", form: "acht Ziffern" },
  SK: { muster: /^\d{10}$/, aus: "der Slowakei", form: "zehn Ziffern" },
  XI: {
    muster: /^(\d{9}|\d{12}|(GD|HA)\d{3})$/,
    aus: "Nordirland",
    form: "neun oder zwölf Ziffern, bei Verwaltungen und im Gesundheitswesen GD oder HA und drei Ziffern",
  },
};

/** Schreibweise wie in der Meldung: Großbuchstaben, ohne Leerzeichen, Punkte und Bindestriche, GR als EL */
export function normalizeUstId(raw: string): string {
  const compact = raw.toUpperCase().replace(/[\s.\-/]/g, "");
  return compact.startsWith("GR") ? `EL${compact.slice(2)}` : compact;
}

/**
 * Formale Prüfung der USt-IdNr. eines Kunden für die Meldung, wie ERiC sie vornimmt: Länderkennzeichen eines anderen
 * Mitgliedstaats, danach nur Buchstaben, Ziffern, + und *, zusammen 7 bis 14 Zeichen (Schema knre_Type und Mindestlänge im
 * Plugin); nordirische Nummern nur für Lieferungen. Dazu der Aufbau je Land, damit ein Tippfehler nicht erst beim BZSt
 * auffällt (#1413). Ob die Nummer erteilt ist, sagt erst die Bestätigungsabfrage beim BZSt.
 */
export function ustIdProblem(ustId: string, art: ZmArt): string | null {
  if (!ustId) return "USt-IdNr. des Kunden fehlt";
  const land = ustId.slice(0, 2);
  if (land === "DE") return `${ustId}: eine deutsche USt-IdNr. gehört nicht in die Zusammenfassende Meldung`;
  if (land === "GB") return `${ustId}: britische USt-IdNr. gelten seit dem Brexit nicht mehr; für Nordirland XI`;
  const aufbau = Object.hasOwn(AUFBAU, land) ? AUFBAU[land] : undefined;
  if (!aufbau) return `${ustId}: kein Länderkennzeichen eines anderen EU-Mitgliedstaats`;
  if (!/^[A-Z]{2}[A-Z0-9+*]{5,12}$/.test(ustId)) return `${ustId}: nach dem Länderkennzeichen 5 bis 12 Buchstaben, Ziffern, + oder *`;
  if (!aufbau.muster.test(ustId.slice(2))) return `${ustId}: eine USt-IdNr. aus ${aufbau.aus} hat nach ${land} ${aufbau.form}`;
  if (land === "XI" && art !== "L") return `${ustId}: nordirische USt-IdNr. nur bei Lieferungen, nicht bei sonstigen Leistungen`;
  return null;
}

/**
 * Prüfziffer der deutschen USt-IdNr. (DE und neun Ziffern, die letzte ist die Prüfziffer) nach ISO 7064 MOD 11,10; ERiC
 * weist eine eigene Nummer mit falscher Prüfziffer ab („Ungültige UStIDNr“).
 */
export function isValidGermanUstId(ustId: string): boolean {
  const match = /^DE(\d{8})(\d)$/.exec(ustId);
  if (!match) return false;
  let product = 10;
  for (const digit of match[1]!) {
    const sum = (Number(digit) + product) % 10 || 10;
    product = (2 * sum) % 11;
  }
  return (11 - product) % 10 === Number(match[2]);
}

/** Volle Euro der Meldung: Cent fallen weg wie bei den Bemessungsgrundlagen der Voranmeldung */
export function zmEuro(betrag: Cents): number {
  return Math.trunc(betrag / 100);
}

const key = (z: { ustId: string; art: ZmArt }) => `${z.art} ${z.ustId}`;

/** Summe je USt-IdNr. und Art, sortiert; Zeilen, die in vollen Euro null ergeben, fallen weg */
export function aggregateZm(posten: readonly ZmPosten[]): ZmZeile[] {
  const sums = new Map<string, ZmZeile>();
  for (const p of posten) {
    const ustId = normalizeUstId(p.ustId);
    const k = key({ ustId, art: p.art });
    const line = sums.get(k) ?? { ustId, art: p.art, betrag: 0 };
    sums.set(k, { ...line, betrag: line.betrag + p.base });
  }
  return [...sums.values()].filter((z) => zmEuro(z.betrag) !== 0).sort((a, b) => a.art.localeCompare(b.art) || a.ustId.localeCompare(b.ustId));
}

/** Eine übermittelte Meldung: Erstmeldung oder Berichtigung mit den geänderten Zeilen */
export interface ZmMeldung {
  berichtigt: boolean;
  zeilen: readonly ZmZeile[];
}

/**
 * Stand beim BZSt nach allen echt übermittelten Meldungen eines Zeitraums, in der Reihenfolge des Sendens: die Erstmeldung,
 * danach ersetzt jede Berichtigung die Zeilen, die sie enthält (eine Zeile mit 0 nimmt eine gemeldete zurück).
 */
export function gemeldeterStand(meldungen: readonly ZmMeldung[]): ZmZeile[] {
  const stand = new Map<string, ZmZeile>();
  for (const meldung of meldungen) {
    if (!meldung.berichtigt) stand.clear();
    for (const z of meldung.zeilen) stand.set(key(z), z);
  }
  return [...stand.values()].filter((z) => zmEuro(z.betrag) !== 0);
}

/**
 * Zeilen einer Berichtigung (§ 18a Abs. 10 UStG): jede Zeile, deren Betrag in vollen Euro sich geändert hat, mit dem
 * richtigen Betrag, und jede gemeldete Zeile, die es nicht mehr gibt, mit 0. Leer, wenn nichts zu berichtigen ist.
 */
export function zmBerichtigung(gemeldet: readonly ZmZeile[], aktuell: readonly ZmZeile[]): ZmZeile[] {
  const neu = new Map(aktuell.map((z) => [key(z), z]));
  const alt = new Map(gemeldet.map((z) => [key(z), z]));
  const geaendert = aktuell.filter((z) => zmEuro(alt.get(key(z))?.betrag ?? 0) !== zmEuro(z.betrag));
  const entfallen = gemeldet.filter((z) => !neu.has(key(z))).map((z) => ({ ...z, betrag: 0 }));
  return [...geaendert, ...entfallen].sort((a, b) => a.art.localeCompare(b.art) || a.ustId.localeCompare(b.ustId));
}

/**
 * Frist der Meldung für ein Kalendervierteljahr: 25. Tag nach dessen Ablauf (§ 18a Abs. 1 Satz 2 und Abs. 2 UStG), eine
 * Dauerfristverlängerung gilt hier nicht. Fällt der Tag auf ein Wochenende oder einen bundesweiten Feiertag, endet sie am
 * nächsten Werktag (§ 108 Abs. 3 AO); Feiertage nur eines Landes zählen nicht, die Meldung geht an eine Bundesbehörde.
 */
export function zmFrist(year: number, quarter: number): string {
  const month = quarter * 3 + 1;
  const date = month > 12 ? `${year + 1}-01-25` : `${year}-${String(month).padStart(2, "0")}-25`;
  return naechsterWerktag(date, null);
}
