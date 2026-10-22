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
