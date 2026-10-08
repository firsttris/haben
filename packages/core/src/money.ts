/** Geldbeträge sind immer ganze Cent. */
export type Cents = number;

/** Steuersätze in Basispunkten: 1900 = 19 %. */
export type BasisPoints = number;

/** Kaufmännisch runden, symmetrisch zur Null: 2,5 → 3, −2,5 → −3 (Math.round ergäbe −2). So heben sich Beleg und Storno exakt auf. */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Steuer auf einen Nettobetrag, kaufmännisch gerundet. */
export function taxOf(net: Cents, rate: BasisPoints): Cents {
  return roundHalfAwayFromZero((net * rate) / 10_000);
}

const formatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123456 → "1.234,56 €", mit geschütztem Leerzeichen, damit das € nie allein in die nächste Zeile rutscht */
export function formatEuro(cents: Cents): string {
  return `${formatter.format(cents / 100)}\u00a0€`;
}

/** 123456 → "1.234,56" */
export function formatDecimal(cents: Cents): string {
  return formatter.format(cents / 100);
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
  return "\ufeff" + rows.map((r) => r.map((v) => (typeof v === "number" ? csvDecimal(v) : csvText(v))).join(";")).join("\r\n") + "\r\n";
}

/**
 * Liest einen deutsch geschriebenen Betrag ("1.234,56", "-12,5", "1234") in Cent.
 * Gibt null zurück, wenn die Eingabe kein Betrag ist.
 */
export function parseEuro(input: string): Cents | null {
  const cleaned = input.replace(/\s|€/g, "").replace(/−/g, "-");
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole = "0", fraction = ""] = cleaned.replace("-", "").replace(/\./g, "").split(",");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** Aufteilung eines Betrags nach Privatanteil in Prozent: privat wird gerundet, betrieblich ist der Rest */
export function splitPrivateShare(amount: Cents, percent: number): { business: Cents; private: Cents } {
  const privatePart = roundHalfAwayFromZero((amount * percent) / 100);
  return { business: amount - privatePart, private: privatePart };
}
