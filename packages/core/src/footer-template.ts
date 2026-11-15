import { type FormattedTextRun, parseTextFormatting } from "./text-format.ts";

/** Eigene Fußzeile der Belege (#113): Spalten als Text mit Platzhaltern und Auszeichnungen, gleich für PDF und Vorschau */

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

/**
 * Was alle Installationen setzen können, gegen die Zeichentabellen der Schriften in packages/einvoice/fonts geprüft. Für alles
 * andere bräche Typst unter PDF/A ab, sobald keine Systemschrift aushilft; ☎ ginge sonst nur auf manchen Servern.
 */
const WITHOUT_FONT = /[^\n\t -~ -ɏΆΈ-ΊΌΎ-ΡΣ-ώЀ-ѹҀ-ӿḀ-ẛẝ-ỿ‐-‧‰-⁕⁗₠-₯₱-₵₸-₺₼-₿№™←-↓−≈≠≤≥]/gu;

/** Zeichen, die keine Belegschrift enthält, je einmal; leer = alles setzbar */
export const charactersWithoutFont = (text: string): string[] => [...new Set(text.match(WITHOUT_FONT) ?? [])];

const TAX_PLACEHOLDER = /\{(steuernummer|ustid)\}/;

const placeholdersIn = (text: string): string[] => [...text.matchAll(/\{([^{}\s]*)\}/g)].map((match) => match[1]!);

const isPlaceholder = (name: string): name is FooterPlaceholder => (FOOTER_PLACEHOLDERS as readonly string[]).includes(name);

/** Warum sich die Spalten nicht speichern lassen; leer = in Ordnung */
export function footerIssues(columns: readonly string[]): string[] {
  const issues: string[] = [];
  // Sonst nennt sie auf der Rechnung niemand: § 14 Abs. 4 Nr. 2 UStG verlangt eine von beiden
  if (!columns.some((column) => TAX_PLACEHOLDER.test(column))) issues.push("Steuernummer oder USt-IdNr. fehlt: Bitte {steuernummer} oder {ustid} einfügen");
  const unknown = [...new Set(columns.flatMap(placeholdersIn).filter((name) => !isPlaceholder(name)))];
  if (unknown.length > 0) issues.push(`Unbekannte Platzhalter: ${unknown.map((name) => `{${name}}`).join(", ")}`);
  if (columns.some((column) => column.split("\n").length > MAX_FOOTER_LINES)) issues.push(`Höchstens ${MAX_FOOTER_LINES} Zeilen je Spalte`);
  if (columns.some((column) => column.length > MAX_FOOTER_TEXT)) issues.push(`Höchstens ${MAX_FOOTER_TEXT} Zeichen je Spalte`);
  const foreign = [...new Set(columns.join("").match(WITHOUT_FONT) ?? [])];
  if (foreign.length > 0) issues.push(`Diese Zeichen enthält keine Belegschrift, das PDF ließe sich nicht erzeugen: ${foreign.slice(0, 10).join(" ")}`);
  return issues;
}

const PLACEHOLDER = /\{([^{}\s]*)\}/g;

/**
 * Eine Zeile ohne Wert fällt weg: Ohne Telefon erscheint nicht „Telefon “. Ausgezeichnet wird der eingegebene Text, die Werte
 * kommen erst danach dazu: Ein Unterstrich in einer E-Mail-Adresse bleibt ein Unterstrich.
 */
function filledRuns(line: readonly FormattedTextRun[], values: FooterValues): FormattedTextRun[] | null {
  const names = line.flatMap((run) => placeholdersIn(run.text)).filter(isPlaceholder);
  if (names.length > 0 && names.every((name) => !values[name])) return null;
  const runs = line.map((run) => ({
    ...run,
    text: run.text.replace(PLACEHOLDER, (whole, name: string) => (isPlaceholder(name) ? values[name] : whole)),
  }));
  const last = runs.length - 1;
  const trimmed = runs.map((run, index) => {
    const start = index === 0 ? run.text.trimStart() : run.text;
    return { ...run, text: index === last ? start.trimEnd() : start };
  });
  const filled = trimmed.filter((run) => run.text);
  return filled.length > 0 ? filled : null;
}

const plainLine = (runs: readonly FormattedTextRun[]): string => runs.map((run) => run.text).join("");

/** Erst lesen, dann in Zeilen teilen: Wie in den Belegtexten gilt eine Auszeichnung auch über mehrere Zeilen. */
function columnLines(text: string): FormattedTextRun[][] {
  const lines: FormattedTextRun[][] = [[]];
  for (const run of parseTextFormatting(text)) {
    run.text.split("\n").forEach((piece, index) => {
      if (index > 0) lines.push([]);
      lines[lines.length - 1]!.push({ ...run, text: piece });
    });
  }
  return lines;
}

const columnRuns = (text: string, values: FooterValues): FormattedTextRun[][] =>
  columnLines(text)
    .map((line) => filledRuns(line, values))
    .filter((runs): runs is FormattedTextRun[] => runs !== null);

export function fillFooterColumn(text: string, values: FooterValues): string[] {
  return columnRuns(text, values).map(plainLine);
}

/**
 * Pflichtangabe, die auf dem Blatt noch fehlt: footerIssues sieht beim Speichern nur den Text, ob die Firma die genannte Nummer
 * hat, zeigt sich erst hier. Die USt-IdNr. geht vor; Reverse Charge und innergemeinschaftliche Lieferung verlangen sie (§ 14a UStG).
 */
function missingTaxLine(filled: readonly string[], values: FooterValues, labels: FooterTaxLabels, needsVatId: boolean): string | null {
  const shown = (value: string) => Boolean(value) && filled.some((line) => line.includes(value));
  if (shown(values.ustid) || (!needsVatId && shown(values.steuernummer))) return null;
  if (values.ustid) return `${labels.vatId} ${values.ustid}`;
  return values.steuernummer && !shown(values.steuernummer) ? `${labels.taxNumber} ${values.steuernummer}` : null;
}

export interface FooterTaxLabels {
  taxNumber: string;
  vatId: string;
}

/** Spalten mit eingesetzten Werten, je Zeile die ausgezeichneten Abschnitte; was Pflicht ist und fehlt, kommt ans Ende der letzten Spalte */
export function customFooterRuns(
  columns: readonly string[],
  values: FooterValues,
  { labels = { taxNumber: "Steuernummer", vatId: "USt-IdNr." }, needsVatId = false }: { labels?: FooterTaxLabels; needsVatId?: boolean } = {},
): FormattedTextRun[][][] {
  const filled = columns.map((column) => columnRuns(column, values));
  // Spalten ganz ohne Platzhalter dafür weist footerIssues schon beim Speichern ab
  if (!columns.some((column) => TAX_PLACEHOLDER.test(column))) return filled;
  const line = missingTaxLine(filled.flat().map(plainLine), values, labels, needsVatId);
  if (!line) return filled;
  const added: FormattedTextRun[] = [{ text: line, bold: false, italic: false, underline: false }];
  return filled.map((column, index) => (index === filled.length - 1 ? [...column, added] : column));
}

/** Dieselben Spalten als Text, ohne Auszeichnungen */
export function customFooter(...args: Parameters<typeof customFooterRuns>): string[][] {
  return customFooterRuns(...args).map((column) => column.map(plainLine));
}
