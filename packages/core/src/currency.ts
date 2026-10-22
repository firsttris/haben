import { taxOf, type BasisPoints, type Cents } from "./money.ts";

/** ISO-4217-Code, z. B. USD */
export const CURRENCY_CODE = /^[A-Z]{3}$/;

/** Kurse mit bis zu sechs Nachkommastellen, wie in der Spalte numeric(12, 6) */
const RATE_SCALE = 1_000_000n;

/**
 * Liest einen Umrechnungskurs in der Form der Umsatzsteuer-Umrechnungskurse des BMF: 1 EUR = x Fremdwährung.
 * Komma oder Punkt als Dezimaltrenner, höchstens sechs Nachkommastellen; null, wenn kein positiver Kurs.
 * Ergebnis mit Punkt und ohne Nullen am Ende, z. B. "1,0812" → "1.0812".
 */
export function parseExchangeRate(input: string): string | null {
  const match = /^(\d{1,6})(?:[.,](\d{1,6}))?$/.exec(input.trim());
  if (!match) return null;
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  const whole = String(Number(match[1]));
  if (whole === "0" && !fraction) return null;
  return fraction ? `${whole}.${fraction}` : whole;
}

/** "1.0812" → "1,0812" für die Anzeige; auch die Form aus Postgres ("1.081200") */
export function formatExchangeRate(rate: string): string {
  return (parseExchangeRate(rate) ?? rate).replace(".", ",");
}

function rateUnits(rate: string): bigint {
  const normalized = parseExchangeRate(rate);
  if (!normalized) throw new Error(`Ungültiger Umrechnungskurs: ${rate}`);
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole!) * RATE_SCALE + BigInt(fraction.padEnd(6, "0"));
}

/** Fremdwährung in Euro: Betrag durch Kurs (1 EUR = Kurs), kaufmännisch auf Cent gerundet, ohne Gleitkomma */
export function foreignToEuro(amount: Cents, rate: string): Cents {
  const units = rateUnits(rate);
  const scaled = BigInt(Math.abs(amount)) * RATE_SCALE;
  // Halbe Cent aufrunden: (2a + b) / 2b
  const euro = (2n * scaled + units) / (2n * units);
  return Math.sign(amount) * Number(euro);
}

export interface ForeignAmount {
  taxRate: BasisPoints;
  /** Beträge in der Fremdwährung, wie auf dem Beleg */
  originalNet: Cents;
  originalTax: Cents;
}

/**
 * Rechnet die Beträge eines Fremdwährungsbelegs je Steuersatz in Euro um.
 * Bei § 13b steht keine Steuer auf der Rechnung: Bemessungsgrundlage ist der umgerechnete Nettobetrag,
 * die Steuer wird daraus berechnet (§ 16 Abs. 6 UStG), nicht aus einer umgerechneten Fremdwährungssteuer.
 */
export function convertForeignAmounts(rows: ForeignAmount[], rate: string, reverseCharge: boolean): { taxRate: BasisPoints; net: Cents; tax: Cents }[] {
  return rows.map((row) => {
    const net = foreignToEuro(row.originalNet, rate);
    return { taxRate: row.taxRate, net, tax: reverseCharge ? taxOf(net, row.taxRate) : foreignToEuro(row.originalTax, rate) };
  });
}

/** Monat (JJJJ-MM) eines Datums JJJJ-MM-TT */
export function rateMonth(date: string): string {
  return date.slice(0, 7);
}

/** "2026-09" → "09/2026" für Anzeige und Hinweise */
export function formatRateMonth(month: string): string {
  return `${month.slice(5, 7)}/${month.slice(0, 4)}`;
}

/** Ein veröffentlichter Kurs: 1 EUR = rate (Punkt als Dezimaltrenner) im Monat JJJJ-MM */
export interface PublishedRate {
  currency: string;
  month: string;
  rate: string;
}

const MONTH_NAMES: Record<string, number> = {
  januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, mrz: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6,
  juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};

function cells(line: string, delimiter: string): string[] {
  // Einfache CSV-Zellen; Anführungszeichen um Zellen (auch mit Trennzeichen darin) werden entfernt
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      result.push(current.trim());
      current = "";
    } else current += c;
  }
  result.push(current.trim());
  return result;
}

/** Monatsspalte aus einer Kopfzelle wie „Januar“, „Jan. 2026“, „01/2026“ oder „01.2026“ */
function monthOfHeader(cell: string, year: number): number | null {
  const numeric = /^(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec(cell.trim());
  if (numeric) return Number(numeric[2]) === year && Number(numeric[1]) >= 1 && Number(numeric[1]) <= 12 ? Number(numeric[1]) : null;
  // Punkte nur bei Monatsnamen entfernen („Jan.“)
  const word = /^([a-zäö]+)(?:\s+(\d{4}))?$/.exec(cell.toLowerCase().replace(/\./g, "").trim());
  if (!word || (word[2] && Number(word[2]) !== year)) return null;
  return MONTH_NAMES[word[1]!] ?? null;
}

/** Kurszelle wie „1,5523 AUD“, „15.172,93 IDR“ oder „1,0812“ → Kurs und ggf. Code */
function rateCell(cell: string): { rate: string; code: string | null } | null {
  const match = /^(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?|\d+\.\d+)\s*([A-Z]{3})?$/.exec(cell.replace(/\u00a0/g, " ").trim());
  if (!match) return null;
  const number = match[1]!.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(match[1]!) ? match[1]!.replace(/\./g, "") : match[1]!;
  const rate = parseExchangeRate(number);
  return rate ? { rate, code: match[2] ?? null } : null;
}

/**
 * Umsatzsteuer-Umrechnungskurse aus der CSV-Datei des BMF (Datenportal, Datenlizenz Deutschland – Namensnennung 2.0):
 * eine Zeile je Land und Währung, eine Spalte je Monat, z. B. „Australien;1 Euro;1,5523 AUD;1,5612 AUD;…“.
 * Gelesen wird tolerant: Trennzeichen Semikolon oder Tabulator, Monatsnamen oder „01/2026“ als Kopf, der Code der
 * Währung aus der Zelle oder aus einer eigenen Spalte, Tausenderpunkte („15.172,93 IDR“). Leere Monate fehlen im
 * Ergebnis. Teilen sich Länder eine Währung, gilt der erste Kurs.
 */
export function parseBmfRates(text: string, year: number): PublishedRate[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const delimiter = lines.some((l) => l.includes(";")) ? ";" : "\t";
  const rows = lines.map((l) => cells(l, delimiter));
  const headerIndex = rows.findIndex((r) => r.filter((c) => monthOfHeader(c, year) !== null).length >= 1);
  if (headerIndex < 0) return [];
  const header = rows[headerIndex]!;
  const months = header.map((c) => monthOfHeader(c, year));
  // Spalte mit dem Code der Währung, wenn der Kopf sie benennt; sonst die letzte Zelle mit drei Großbuchstaben vor den
  // Monaten (davor steht das Land, und „USA“ ist kein Währungscode)
  const namedCodeColumn = header.findIndex((c, i) => months[i] === null && /iso|code|währung|waehrung|currency/i.test(c));
  const seen = new Set<string>();
  const result: PublishedRate[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    // Code aus einer eigenen Spalte (z. B. „ISO-Code“), falls die Kurszellen keinen tragen
    const named = namedCodeColumn >= 0 ? row[namedCodeColumn] : undefined;
    const codeColumn =
      named && CURRENCY_CODE.test(named) && named !== "EUR" ? named : (row.filter((c, i) => months[i] === null && CURRENCY_CODE.test(c) && c !== "EUR").at(-1) ?? null);
    row.forEach((cell, i) => {
      const month = months[i];
      if (!month) return;
      const parsed = rateCell(cell);
      const currency = parsed?.code ?? codeColumn;
      if (!parsed || !currency || currency === "EUR") return;
      const key = `${currency}|${month}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ currency, month: `${year}-${String(month).padStart(2, "0")}`, rate: parsed.rate });
    });
  }
  return result.sort((a, b) => a.currency.localeCompare(b.currency) || a.month.localeCompare(b.month));
}

/** Adresse der CSV-Datei des BMF mit den Kursen eines Jahres */
export function bmfRatesUrl(year: number): string {
  return `https://www.bundesfinanzministerium.de/Datenportal/Daten/offene-daten/steuern-zoelle/umsatzsteuer-umrechnungskurse/datensaetze/uu-kurse-${year}-csv.csv?__blob=publicationFile`;
}

/** Herkunft des Kurses an Beleg oder Rechnung */
export const EXCHANGE_RATE_SOURCES = {
  ust: "USt-Umrechnungskurs",
  tageskurs: "Tageskurs",
  manuell: "eigener Kurs",
} as const;

export type ExchangeRateSource = keyof typeof EXCHANGE_RATE_SOURCES;
export const EXCHANGE_RATE_SOURCE_KEYS = Object.keys(EXCHANGE_RATE_SOURCES) as [ExchangeRateSource, ...ExchangeRateSource[]];

/**
 * Kurs mit Herkunft für die Anzeige, z. B. „1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)“ oder
 * „1 EUR = 1,0790 USD (Tageskurs vom 14.09.2026)“.
 */
export function describeExchangeRate(currency: string, rate: string, source: ExchangeRateSource | null, date: string | null): string {
  const base = `1 EUR = ${formatExchangeRate(rate)} ${currency}`;
  if (source === "ust" && date) return `${base} (${EXCHANGE_RATE_SOURCES.ust} ${formatRateMonth(rateMonth(date))})`;
  if (source === "tageskurs" && date) return `${base} (${EXCHANGE_RATE_SOURCES.tageskurs} vom ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)})`;
  if (source) return `${base} (${EXCHANGE_RATE_SOURCES[source]})`;
  return base;
}
