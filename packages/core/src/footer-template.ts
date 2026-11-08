/** Eigene Fußzeile der Belege (#113): Spalten als Text mit Platzhaltern, gleich für PDF und Vorschau */

export const FOOTER_PLACEHOLDERS = [
  "firma",
  "strasse",
  "plz",
  "ort",
  "email",
  "telefon",
  "bank",
  "kontoinhaber",
  "iban",
  "bic",
  "steuernummer",
  "ustid",
] as const;
export type FooterPlaceholder = (typeof FOOTER_PLACEHOLDERS)[number];
export type FooterValues = Record<FooterPlaceholder, string>;

export const MIN_FOOTER_COLUMNS = 2;
export const MAX_FOOTER_COLUMNS = 4;
/** Mehr passt nicht in den unteren Rand von 34 mm (templates/rechnung.typ) */
export const MAX_FOOTER_LINES = 5;
export const MAX_FOOTER_TEXT = 400;

export const DEFAULT_FOOTER_COLUMNS: readonly string[] = [
  "{firma}\n{strasse}\n{plz} {ort}\n{email}",
  "{bank}\nIBAN {iban}\nBIC {bic}",
  "Steuernummer {steuernummer}\nUSt-IdNr. {ustid}",
];

interface FooterSeller {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  email: string;
  telefon?: string;
  bank?: string;
  kontoinhaber?: string;
  iban?: string;
  bic?: string;
  steuernummer?: string;
  ustId?: string;
}

export function footerValues(seller: FooterSeller): FooterValues {
  return {
    firma: seller.name,
    strasse: seller.strasse,
    plz: seller.plz,
    ort: seller.ort,
    email: seller.email,
    telefon: seller.telefon ?? "",
    bank: seller.bank ?? "",
    kontoinhaber: seller.kontoinhaber?.trim() || seller.name,
    iban: seller.iban ?? "",
    bic: seller.bic ?? "",
    steuernummer: seller.steuernummer ?? "",
    ustid: seller.ustId ?? "",
  };
}

const placeholdersIn = (text: string): string[] => [...text.matchAll(/\{([^{}\s]*)\}/g)].map((match) => match[1]!);

const isPlaceholder = (name: string): name is FooterPlaceholder => (FOOTER_PLACEHOLDERS as readonly string[]).includes(name);

/** Warum sich die Spalten nicht speichern lassen; leer = in Ordnung */
export function footerIssues(columns: readonly string[]): string[] {
  const issues: string[] = [];
  // Sonst nennt sie auf der Rechnung niemand: § 14 Abs. 4 Nr. 2 UStG verlangt eine von beiden
  if (!columns.some((column) => /\{(steuernummer|ustid)\}/.test(column)))
    issues.push("Steuernummer oder USt-IdNr. fehlt: Bitte {steuernummer} oder {ustid} einfügen");
  const unknown = [...new Set(columns.flatMap(placeholdersIn).filter((name) => !isPlaceholder(name)))];
  if (unknown.length > 0) issues.push(`Unbekannte Platzhalter: ${unknown.map((name) => `{${name}}`).join(", ")}`);
  if (columns.some((column) => column.split("\n").length > MAX_FOOTER_LINES)) issues.push(`Höchstens ${MAX_FOOTER_LINES} Zeilen je Spalte`);
  return issues;
}

/** Eine Zeile ohne Wert fällt weg: Ohne Telefon erscheint nicht „Telefon “ */
function filledLine(line: string, values: FooterValues): string | null {
  const names = placeholdersIn(line).filter(isPlaceholder);
  if (names.length > 0 && names.every((name) => !values[name])) return null;
  return line.replace(/\{([^{}\s]*)\}/g, (whole, name: string) => (isPlaceholder(name) ? values[name] : whole)).trim();
}

export function fillFooterColumn(text: string, values: FooterValues): string[] {
  return text
    .split("\n")
    .map((line) => filledLine(line, values))
    .filter((line): line is string => Boolean(line));
}

/** Spalten mit eingesetzten Werten; dass die Pflichtangabe vorkommt, prüft footerIssues beim Speichern */
export function customFooter(columns: readonly string[], values: FooterValues): string[][] {
  return columns.map((column) => fillFooterColumn(column, values));
}
