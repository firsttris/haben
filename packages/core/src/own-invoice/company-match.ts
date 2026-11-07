import { compactId, digitsOf } from "./identifiers.ts";
import { normalizeText } from "./terms.ts";
import type { OwnCompany } from "./types.ts";

/*
 * Vergleiche einer Angabe mit den eigenen Firmendaten. Leere eigene Angaben passen nie, damit eine Firma ohne
 * USt-IdNr. nicht jede Rechnung ohne USt-IdNr. für die eigene hält.
 */

export function isOwnUstId(company: OwnCompany, value: string | null | undefined): boolean {
  const own = compactId(company.ustId);
  return own.length >= 7 && !!value && compactId(value) === own;
}

/** Ziffern der eigenen Steuernummer in allen bekannten Schreibweisen */
export function ownSteuernummerDigits(company: OwnCompany): string[] {
  return [...new Set(company.steuernummern.map(digitsOf).filter((digits) => digits.length >= 10))];
}

export function isOwnSteuernummer(company: OwnCompany, value: string | null | undefined): boolean {
  return !!value && ownSteuernummerDigits(company).includes(digitsOf(value));
}

export function isOwnIban(company: OwnCompany, value: string | null | undefined): boolean {
  const own = compactId(company.iban);
  return own.length >= 15 && !!value && compactId(value) === own;
}

const LEGAL_FORMS = new Set([
  "gmbh",
  "mbh",
  "ug",
  "haftungsbeschrankt",
  "ag",
  "kg",
  "kgaa",
  "ohg",
  "gbr",
  "ek",
  "e",
  "k",
  "ev",
  "v",
  "co",
  "und",
  "inh",
  "partg",
  "partgmbb",
  "se",
  "ltd",
  "limited",
  "inc",
  "llc",
  "sarl",
  "bv",
]);

/** Kern des Firmennamens ohne Rechtsform: „Muster & Co. KG“ → „muster“; zu kurze Kerne taugen nicht zum Vergleich */
export function nameCore(name: string): string {
  const core = normalizeText(name)
    .split(" ")
    .filter((word) => word && !LEGAL_FORMS.has(word))
    .join(" ");
  return core.length >= 4 ? core : "";
}

/** Steht der eigene Firmenname (ohne Rechtsform) als ganze Wörter im Text? */
export function mentionsOwnName(company: OwnCompany, text: string | null | undefined): boolean {
  const core = nameCore(company.name);
  if (!core || !text) return false;
  return ` ${normalizeText(text)} `.includes(` ${core} `);
}

/** Ist die Angabe der eigene Firmenname, abgesehen von Rechtsform und Schreibweise? */
export function isOwnName(company: OwnCompany, value: string | null | undefined): boolean {
  const core = nameCore(company.name);
  return !!core && !!value && nameCore(value) === core;
}
