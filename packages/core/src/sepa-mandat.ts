/**
 * SEPA-Lastschriftmandat (#445): Gläubiger-Identifikationsnummer, Mandatsreferenz und ob ein Mandat am Stichtag gilt.
 *
 * Quellen:
 * - EPC016-06 2025 SDD Core Rulebook und EPC222-07 2025 SDD B2B Rulebook, je Version 1.2 (gültig ab 30.09.2026)
 * - EPC262-08 Creditor Identifier Overview, Version 12.0
 * - Anlage 3 des DFÜ-Abkommens der Deutschen Kreditwirtschaft, Version 3.9 (Kap. 2.2.2, 2.2.2.7, 2.3.1) und das Schema
 *   pain.008.001.08_GBIC_5.xsd; Version 26.11 (ab 15.11.2026) behält pain.008.001.08 mit GBIC_5
 *
 * Die Länge der Mandatsreferenz begrenzt das Rulebook nicht (AT-M001); 35 Zeichen und der Zeichensatz kommen aus dem
 * Schema der DK (Max35Text mit Pattern, Anlage 3 Kap. 2.3.1). Groß- und Kleinschreibung zählen dort nicht (Kap. 2.2.2).
 */

/** Zeichen der Mandatsreferenz laut MndtId im Schema der DK: Latin-Zeichensatz des EPC mit Leerzeichen, 1 bis 35 Zeichen */
const MANDATSREFERENZ_ZEICHEN = /^[A-Za-z0-9+?/\-:().,' ]+$/;
export const MANDATSREFERENZ_LAENGE = 35;

/** Monate ohne Einzug, nach denen ein Mandat verfällt (Rulebook SDD Core und B2B, Kap. 4.2, siehe mandatStatus) */
export const MANDAT_VERFALL_MONATE = 36;

export type MandatSchema = "CORE" | "B2B";
export const MANDAT_SCHEMA_LABEL: Record<MandatSchema, string> = {
  CORE: "Basislastschrift (CORE)",
  B2B: "Firmenlastschrift (B2B)",
};

/** Gläubiger-ID ohne Leerzeichen, in Großbuchstaben */
export function normalizeGlaeubigerId(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** Rest einer Zahl aus Ziffern und Buchstaben (A = 10 … Z = 35) bei der Division durch 97, wie bei der IBAN */
function mod97(text: string): number {
  let rest = 0;
  for (const char of text) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest;
}

/**
 * Was an einer Gläubiger-ID nicht stimmt, oder null. Aufbau nach EPC262-08 v12.0, Kap. 3: Ländercode, Prüfziffern nach
 * ISO 7064 MOD 97-10, drei Zeichen Geschäftsbereichskennung (sonst ZZZ), nationale Kennung. Die Kennung zählt bei der
 * Prüfziffer nicht mit (Kap. 4; ebenso Anlage 3 der DK, Kap. 2.2.2): nationale Kennung, Ländercode und „00“, Buchstaben
 * als Zahlen (A = 10). Eine deutsche Gläubiger-ID hat 18 Stellen (EPC262-08, Kap. 8.1.8). Die Bundesbank nennt
 * DE98ZZZ09999999999 als Test-ID mit richtiger Prüfziffer (FAQ zur Gläubiger-Identifikationsnummer).
 */
export function glaeubigerIdProblem(value: string): string | null {
  const id = normalizeGlaeubigerId(value);
  if (id === "") return "Die Gläubiger-ID fehlt.";
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(id)) {
    return "Die Gläubiger-ID beginnt mit dem Ländercode und zwei Prüfziffern, z. B. DE98ZZZ09999999999.";
  }
  if (id.startsWith("DE") && !/^DE\d{2}[A-Z0-9]{3}\d{11}$/.test(id)) {
    return "Eine deutsche Gläubiger-ID hat 18 Stellen: DE, zwei Prüfziffern, drei Zeichen Kennung, elf Ziffern.";
  }
  const pruefziffern = String(98 - mod97(`${id.slice(7)}${id.slice(0, 2)}00`)).padStart(2, "0");
  return pruefziffern === id.slice(2, 4) ? null : "Die Prüfziffer der Gläubiger-ID stimmt nicht.";
}

/** Was an einer Mandatsreferenz nicht stimmt, oder null */
export function mandatsreferenzProblem(value: string): string | null {
  if (value.trim() === "") return "Die Mandatsreferenz fehlt.";
  if (value.length > MANDATSREFERENZ_LAENGE) return `Die Mandatsreferenz hat höchstens ${MANDATSREFERENZ_LAENGE} Zeichen.`;
  if (!MANDATSREFERENZ_ZEICHEN.test(value)) return "Die Mandatsreferenz darf nur A–Z, a–z, 0–9, Leerzeichen und + ? / - : ( ) . , ' enthalten.";
  // EPC132-17 v5.1, Kap. 2.1: Referenzen beginnen und enden nicht mit „/“ und enthalten kein „//“
  if (value.startsWith("/") || value.endsWith("/") || value.includes("//")) {
    return "Die Mandatsreferenz darf nicht mit / beginnen oder enden und kein // enthalten.";
  }
  return null;
}

/** Tag (JJJJ-MM-TT) plus Monate; fehlt der Tag im Zielmonat, der letzte Tag des Monats */
function plusMonate(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

function vortag(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export interface MandatDaten {
  /** Datum der Unterschrift */
  signedOn: string;
  /** Letzter Einzug auf dieses Mandat, auch wenn er zurückgegeben wurde; null = noch keiner */
  lastCollectionOn: string | null;
  /** Ab diesem Tag widerrufen; null = nicht widerrufen */
  revokedOn: string | null;
}

export type MandatStatus =
  | { art: "gueltig"; bis: string }
  | { art: "abgelaufen"; seit: string }
  | { art: "widerrufen"; seit: string }
  | { art: "noch-nicht"; ab: string };

/**
 * Ob das Mandat am Stichtag gilt. Rulebook SDD Core und B2B v1.2, Kap. 4.2: „If a Creditor does not present a Collection
 * under a Mandate for a period of 36 months (starting from the date of the latest Collection presented, even if
 * rejected, returned or refunded), the Creditor must cancel the Mandate“; danach braucht es ein neues Mandat.
 *
 * Für ein Mandat ohne Einzug nennen weder Rulebook noch Clarification Paper (EPC132-17 v5.1) einen Beginn; Haben zählt
 * dann vorsichtig ab der Unterschrift. Am Tag 36 Monate nach dem Beginn ist das Mandat abgelaufen. Ein Widerruf gilt ab
 * seinem Tag.
 */
export function mandatStatus(mandat: MandatDaten, stichtag: string): MandatStatus {
  if (mandat.revokedOn && stichtag >= mandat.revokedOn) return { art: "widerrufen", seit: mandat.revokedOn };
  if (stichtag < mandat.signedOn) return { art: "noch-nicht", ab: mandat.signedOn };
  const start = mandat.lastCollectionOn && mandat.lastCollectionOn > mandat.signedOn ? mandat.lastCollectionOn : mandat.signedOn;
  const verfall = plusMonate(start, MANDAT_VERFALL_MONATE);
  return stichtag >= verfall ? { art: "abgelaufen", seit: verfall } : { art: "gueltig", bis: vortag(verfall) };
}
