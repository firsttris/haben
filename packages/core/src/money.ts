import type { Einheit } from "./einheit.ts";

/** Geldbeträge sind immer ganze Cent. */
export type Cents = Einheit<"Cents">;

/** Steuersätze in Basispunkten: 1900 = 19 %. */
export type BasisPoints = Einheit<"BasisPoints">;

/** Kaufmännisch runden, symmetrisch zur Null: 2,5 → 3, −2,5 → −3 (Math.round ergäbe −2). So heben sich Beleg und Storno exakt auf. */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Steuer auf einen Nettobetrag, kaufmännisch gerundet. */
export function taxOf(net: Cents, rate: BasisPoints): Cents {
  return roundHalfAwayFromZero((net * rate) / 10_000);
}

/** Im Bruttobetrag enthaltene Steuer, kaufmännisch gerundet: 9,80 € zu 19 % → 1,56 € */
export function taxIncluded(gross: Cents, rate: BasisPoints): Cents {
  return roundHalfAwayFromZero((gross * rate) / (10_000 + rate));
}

const formatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123456 → "1.234,56 €", mit geschütztem Leerzeichen, damit das € nie allein in die nächste Zeile rutscht */
export function formatEuro(cents: Cents): string {
  return `${formatDecimal(cents)}\u00a0€`;
}

/** 123456 → "1.234,56" */
export function formatDecimal(cents: Cents): string {
  return formatHundredths(cents);
}

/** Ganze Hundertstel mit zwei Nachkommastellen, ohne Einheit: Cent als Euro, Basispunkte als Prozent (1900 → "19,00") */
export function formatHundredths(value: Cents | BasisPoints): string {
  // + 0 macht aus −0 (etwa Steuer einer Storno-Zeile zu 0 %) eine 0, sonst steht dort „-0,00“
  return formatter.format(value / 100 + 0);
}

/**
 * Betrag einer Zeile, die vom Ergebnis abzieht: Vorsteuer, Einfuhrumsatzsteuer, Vorauszahlungssoll.
 * Das Vorzeichen gehört zur Zeile, nicht zum Betrag: ein Abzug erscheint negativ, eine Gutschrift in
 * derselben Zeile positiv. Sonst zeigt eine negative Vorsteuer ein Minus und wird beim Zusammenzählen
 * der Spalte addiert statt abgezogen (#869).
 */
export function formatDeduction(cents: Cents): string {
  return formatEuro(-cents);
}

/** Für CSV-Dateien: Dezimalkomma ohne Tausenderpunkt, 123456 → "1234,56", -5 → "-0,05" */
export function csvDecimal(cents: Cents): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Ein Textfeld für CSV: gequotet, wenn nötig; beginnt es mit = + - @, wird ein ' vorangestellt, damit Excel es nicht als Formel ausführt */
function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV für Excel/LibreOffice: Semikolon, CRLF, UTF-8 mit BOM. Zahlen sind Centbeträge und werden mit Dezimalkomma geschrieben. */
export function toCsv(rows: (string | Cents)[][]): string {
  return `\ufeff${rows.map((r) => r.map((v) => (typeof v === "number" ? csvDecimal(v) : csvText(v))).join(";")).join("\r\n")}\r\n`;
}

// Vorzeichen und Währung vorn, in beliebiger Reihenfolge, die Zahl, die Währung hinten. Leerraum steht nur direkt hinter
// Vorzeichen oder Währung, vor der Währung hinten und in der Zahl vor einer Ziffer: So fällt keiner zwei Stellen des
// Ausdrucks zu, und eine lange Eingabe ohne Betrag scheitert in linearer Zeit statt nach allen Aufteilungen.
const AMOUNT = /^(?:([-+])\s*)?(?:(€|EUR)\s*)?(?:([-+])\s*)?(\d(?:[\d.,]|[    ](?=\d))*)(?:\s*(€|EUR))?$/i;
// Dezimalkomma; Tausender in Dreiergruppen, getrennt durch Punkt oder Leerzeichen (auch geschützt oder schmal wie U+2009),
// immer dasselbe Zeichen
const GERMAN_NUMBER = /^(\d{1,3}(?:([.    ])\d{3})(?:\2\d{3})*|\d+)(?:,(\d{1,2}))?$/;
// Dezimalpunkt, nur ohne Tausender und mit einer oder zwei Ziffern dahinter: „12.50“; „1.500“ sind Tausender
const DOT_NUMBER = /^(\d+)\.(\d{1,2})$/;

/**
 * Der eine Leser für Beträge in Euro (#1242), in Formularen, der Schnellsuche und dem CSV-Import: „1.234,56“, „12,5“,
 * „12,50 €“, „€ 12,50“, „12,50 EUR“ oder „12.50“ → Cent. „€“ oder „EUR“ steht nur am Anfang oder Ende, ein Vorzeichen
 * („-“, „−“, „–“, „+“) nur vorn; Leerzeichen, auch geschützte wie in formatEuro, nur am Rand, neben Währung und
 * Vorzeichen und als Tausendertrenner. „12€50“ und „1 2,50“ sind so kein Betrag, statt still 1.250,00 € oder 12,50 €
 * zu werden. Komma als Dezimaltrenner mit höchstens zwei Nachkommastellen; ein Punkt gilt als Dezimaltrenner, wenn
 * eine oder zwei Ziffern folgen und kein Komma da ist. Ob ein Feld negative Beträge annimmt, prüft das Feld.
 * null, wenn die Eingabe so kein Betrag ist.
 */
export function parseEuro(input: string): Cents | null {
  const match = AMOUNT.exec(input.trim().replace(/[−–]/g, "-"));
  if (!match) return null;
  const [, signBefore, currencyBefore, signAfter, number = "", currencyAfter] = match;
  if ((signBefore && signAfter) || (currencyBefore && currencyAfter)) return null;
  const german = GERMAN_NUMBER.exec(number);
  const dot = german ? null : DOT_NUMBER.exec(number);
  const whole = german ? german[1] : dot?.[1];
  if (whole === undefined) return null;
  const fraction = (german ? german[3] : dot?.[2]) ?? "";
  const cents = Number(whole.replace(/\D/g, "")) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return (signBefore || signAfter) === "-" && cents !== 0 ? -cents : cents;
}

const AMOUNT_EXAMPLE: Cents = 123456;

/**
 * Die Meldung, wenn ein Betragsfeld eine Eingabe nicht annimmt (#1242), in einer Form für Formulare und Importe:
 * amountError("den Preis", 12050) → „Trag den Preis ein, etwa 120,50.“ Eine Grenze gehört in subject („einen Betrag
 * über 0“), das Beispiel zum Feld. optional sagt dazu, dass das Feld leer bleiben darf.
 */
export function amountError(subject = "den Betrag", example: Cents = AMOUNT_EXAMPLE, { optional = false } = {}): string {
  return `Trag ${subject} ein, etwa ${formatDecimal(example)}${optional ? ", oder lass das Feld leer" : ""}.`;
}

/** Aufteilung eines Betrags nach Privatanteil in Prozent: privat wird gerundet, betrieblich ist der Rest */
export function splitPrivateShare(amount: Cents, percent: number): { business: Cents; private: Cents } {
  const privatePart = roundHalfAwayFromZero((amount * percent) / 100);
  return { business: amount - privatePart, private: privatePart };
}
