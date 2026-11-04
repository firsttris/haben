/**
 * Zeichensatz, IBAN und BIC für SEPA-Dateien.
 *
 * Erlaubt ist nur der Latin-Zeichensatz des EPC: a–z, A–Z, 0–9 und / - ? : ( ) . , ' + Leerzeichen. Genau diese
 * Zeichen lässt das Schema der Deutschen Kreditwirtschaft für MsgId, PmtInfId und EndToEndId zu
 * (pain.001.001.09_GBIC_5.xsd, Anlage 3 des DFÜ-Abkommens Version 3.9); jede Bank im SEPA-Raum muss ihn annehmen.
 * Umlaute und ß schreibt Haben deshalb aus (ä → ae), statt sich auf einen erweiterten Zeichensatz der Bank zu verlassen.
 */

/** Ein Zeichen des Latin-Zeichensatzes (EPC) */
const ALLOWED = /[A-Za-z0-9/\-?:().,'+ ]/;

/** Kennungen (MsgId, PmtInfId, EndToEndId) nach dem Muster im Schema der DK: 1 bis 35 Zeichen des Latin-Zeichensatzes */
export const SEPA_ID_PATTERN = /^[A-Za-z0-9/\-?:().,'+ ]{1,35}$/;

const REPLACEMENTS: Record<string, string> = {
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
  ẞ: "SS",
  // Empfehlungen des EPC für Zeichen außerhalb des Latin-Zeichensatzes (EPC217-08, Kapitel 6.2; so auch sepa_king)
  "€": "E",
  "@": "(at)",
  _: "-",
  // & ist nicht erlaubt; „+“ bleibt im Namen lesbar („Müller & Söhne“ → „Mueller + Soehne“)
  "&": "+",
};

/**
 * Text für ein Feld der SEPA-Datei: Umlaute ausgeschrieben, Akzente entfernt (é → e), andere Zeichen durch ein
 * Leerzeichen ersetzt, Leerraum zusammengefasst und auf die Länge des Feldes gekürzt.
 */
export function sepaText(value: string, maxLength: number): string {
  const replaced = [...value].map((c) => REPLACEMENTS[c] ?? c).join("");
  // Zerlegt é in e und den Akzent, der danach als unerlaubtes Zeichen wegfällt
  const plain = [...replaced.normalize("NFD")]
    .filter((c) => !/\p{M}/u.test(c))
    .map((c) => (ALLOWED.test(c) ? c : " "))
    .join("");
  return plain.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

/** IBAN ohne Leerzeichen, in Großbuchstaben */
export function compactIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

/** Prüfziffer der IBAN (ISO 13616, MOD 97-10) */
function ibanChecksumOk(iban: string): boolean {
  let rest = 0;
  for (const char of iban.slice(4) + iban.slice(0, 4)) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

/** Form (Ländercode, Prüfziffer, bis 30 Zeichen Kontonummer, wie IBAN2007Identifier im Schema) und Prüfziffer */
export function isValidIban(iban: string): boolean {
  const value = compactIban(iban);
  return /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(value) && ibanChecksumOk(value);
}

/**
 * Länder des Europäischen Wirtschaftsraums: die 27 EU-Staaten sowie Island, Liechtenstein und Norwegen. Haben erzeugt
 * SEPA-Dateien nur für Empfänger dort: Für IBANs außerhalb von SEPA lehnt die Bank ab, und SEPA-Länder außerhalb des EWR
 * (Schweiz, Vereinigtes Königreich, Monaco, San Marino …) verlangen nach dem SCT-Rulebook des EPC BIC und Anschrift des
 * Empfängers, die Haben am Kontakt nicht führt.
 */
const EWR = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
  "IS",
  "LI",
  "NO",
]);

/** IBAN aus einem Land des EWR (nach dem Ländercode; die Prüfziffer prüft isValidIban) */
export function isEwrIban(iban: string): boolean {
  return EWR.has(compactIban(iban).slice(0, 2));
}

/** BIC nach BICFIDec2014Identifier im Schema: 8 oder 11 Zeichen */
export function isValidBic(bic: string): boolean {
  return /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic.replace(/\s+/g, "").toUpperCase());
}
