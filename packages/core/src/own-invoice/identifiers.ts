import { isValidIban } from "../sepa-text.ts";
import { normalizeUstId } from "../zm.ts";

/*
 * Kennungen in einer Textzeile finden. Gedruckt stehen sie oft mit Leerzeichen, Punkten oder Strichen
 * („DE 123 456 789“, „12/345/67890“); verglichen wird deshalb die kompakte Form, die Stelle im Original bleibt bekannt,
 * damit die Regeln den Text davor lesen können.
 */

const SEPARATOR = /[\s.\-/]/;

/** Großbuchstaben ohne Trennzeichen; „de 123.456.789“ → „DE123456789“ */
export function compactId(value: string): string {
  return normalizeUstId(value);
}

export function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/** Startstellen (im Original) aller Vorkommen der kompakten Kennung in der Zeile */
export function occurrences(line: string, compactNeedle: string): number[] {
  if (compactNeedle.length < 5) return [];
  let compact = "";
  const origin: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (SEPARATOR.test(char)) continue;
    compact += char.toUpperCase();
    origin.push(i);
  }
  const found: number[] = [];
  for (let at = compact.indexOf(compactNeedle); at >= 0; at = compact.indexOf(compactNeedle, at + 1)) {
    // Mitten in einem längeren Wort oder einer längeren Ziffernfolge zählt es nicht; Trennzeichen davor und danach schon
    const start = origin[at]!;
    const end = origin[at + compactNeedle.length - 1]!;
    if (/[\p{L}\p{N}]/u.test(line[start - 1] ?? "") || /[\p{L}\p{N}]/u.test(line[end + 1] ?? "")) continue;
    found.push(start);
  }
  return found;
}

/** Länderkennungen der USt-IdNr. in der EU, dazu XI für Nordirland */
const VAT_PREFIXES = "AT|BE|BG|CY|CZ|DE|DK|EE|EL|GR|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI";
/**
 * Nach dem Länderkennzeichen höchstens zwei Zeichen (FR, AT „U“, ES), dann Ziffern, am Ende höchstens ein Buchstabe
 * oder „B01“ (NL). So wird aus „DE123456789 HRB 1234“ nicht „DE123456789HRB“.
 */
const VAT_ID = new RegExp(`\\b(?:${VAT_PREFIXES})[ ]?[A-Z0-9]{0,2}(?:[ .]?\\d){6,12}(?:[ ]?[A-Z]\\d{2}|[A-Z])?(?![0-9A-Z])`, "g");
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[0-9A-Z]{4}){2,7}(?:[ ]?[0-9A-Z]{1,4})?\b/g;

/** Alle USt-IdNrn. der Zeile, kompakt; IBANs werden vorher ausgeblendet, sie beginnen ebenfalls mit dem Ländercode */
export function ustIdsIn(line: string): string[] {
  const withoutIbans = line.replace(IBAN, (match) => (isValidIban(compactId(match)) ? " ".repeat(match.length) : match));
  return [...withoutIbans.matchAll(VAT_ID)].map((match) => compactId(match[0])).filter((id) => digitsOf(id).length >= 7);
}
