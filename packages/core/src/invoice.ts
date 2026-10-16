import { z } from "zod/mini";
import { roundHalfAwayFromZero, taxIncluded, taxOf, type BasisPoints, type Cents } from "./money.ts";

/** Mengen als ganze Tausendstel: 152 Std. = 152000, 0,5 Tage = 500. */
export type Millis = number;

export const TAX_RATES = [1900, 700, 0] as const;

/** Unterstützte Steuersätze in Basispunkten */
export type TaxRate = (typeof TAX_RATES)[number];

export const UNITS = {
  "Std.": "HUR",
  "Tag": "DAY",
  "Monat": "MON",
  "Stk.": "H87",
  "Psch.": "LS",
  "km": "KMT",
} as const;

export type UnitLabel = keyof typeof UNITS;

export const invoiceLineInputSchema = z.object({
  description: z.string().check(z.trim(), z.minLength(1, "Beschreibung fehlt"), z.maxLength(500)),
  quantity: z.int().check(z.minimum(1), z.maximum(1_000_000_000)),
  unit: z.enum(Object.keys(UNITS) as [UnitLabel, ...UnitLabel[]]),
  unitPrice: z.int().check(z.minimum(-100_000_000_00), z.maximum(100_000_000_00)),
  taxRate: z.literal(TAX_RATES),
});

export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;

export interface TaxBreakdown {
  rate: BasisPoints;
  base: Cents;
  tax: Cents;
}

export interface InvoiceTotals {
  net: Cents;
  tax: Cents;
  gross: Cents;
  /** Je Steuersatz, absteigend nach Satz */
  taxes: TaxBreakdown[];
}

/**
 * Preise netto (Standard, B2B) oder brutto inklusive Umsatzsteuer (Endpreise für Privatkunden).
 * Im Brutto-Modus sind Einzelpreis und Zeilenbetrag brutto; die Steuer wird je Satz herausgerechnet.
 */
export const PRICE_MODES = ["netto", "brutto"] as const;

export type PriceMode = (typeof PRICE_MODES)[number];

/** Zeilenbetrag: Menge × Einzelpreis, kaufmännisch gerundet; netto oder brutto wie der Einzelpreis */
export function lineAmount(quantity: Millis, unitPrice: Cents): Cents {
  return roundHalfAwayFromZero((quantity * unitPrice) / 1000);
}

/** Summen und das Netto jeder Zeile in Reihenfolge der Eingabe */
export interface InvoiceCalculation {
  totals: InvoiceTotals;
  lineNets: Cents[];
}

type CalculationLine = Pick<InvoiceLineInput, "quantity" | "unitPrice" | "taxRate">;

/**
 * Summen nach EN 16931: Steuer je Steuersatz auf die Summe der Zeilenbeträge, nicht als Summe der
 * Zeilensteuern.
 *
 * netto: Bemessungsgrundlage = Summe der Zeilen, Steuer darauf.
 * brutto: Bruttosumme je Satz, die Steuer daraus herausgerechnet, Netto ist die Differenz. So stimmt
 * der Endpreis auf den Cent (9,80 € statt 9,79 € oder 9,81 €). Das Netto wird auf die Zeilen verteilt,
 * damit ihre Summe exakt die Bemessungsgrundlage ergibt (BR-CO-10); den Rundungsrest trägt die
 * betragsmäßig größte Zeile des Satzes. Negierte Zeilen (Storno) ergeben exakt negierte Werte.
 */
export function computeInvoice(lines: CalculationLine[], priceMode: PriceMode = "netto"): InvoiceCalculation {
  const amounts = lines.map((line) => lineAmount(line.quantity, line.unitPrice));
  const sums = new Map<BasisPoints, Cents>();
  lines.forEach((line, i) => sums.set(line.taxRate, (sums.get(line.taxRate) ?? 0) + amounts[i]!));
  const taxes = [...sums.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, sum]) => {
      if (priceMode === "netto") return { rate, base: sum, tax: taxOf(sum, rate) };
      const tax = taxIncluded(sum, rate);
      return { rate, base: sum - tax, tax };
    });

  const lineNets = priceMode === "netto" ? amounts : amounts.map((amount, i) => amount - taxIncluded(amount, lines[i]!.taxRate));
  if (priceMode === "brutto") {
    for (const t of taxes) {
      const indexes = lines.map((line, i) => (line.taxRate === t.rate ? i : -1)).filter((i) => i >= 0);
      const rest = t.base - indexes.reduce((sum, i) => sum + lineNets[i]!, 0);
      if (rest === 0) continue;
      const largest = indexes.reduce((best, i) => (Math.abs(amounts[i]!) > Math.abs(amounts[best]!) ? i : best), indexes[0]!);
      lineNets[largest] = lineNets[largest]! + rest;
    }
  }

  const net = taxes.reduce((sum, t) => sum + t.base, 0);
  const tax = taxes.reduce((sum, t) => sum + t.tax, 0);
  return { totals: { net, tax, gross: net + tax, taxes }, lineNets };
}

export function computeInvoiceTotals(lines: CalculationLine[], priceMode: PriceMode = "netto"): InvoiceTotals {
  return computeInvoice(lines, priceMode).totals;
}

/** Preis von einem Modus in den anderen umrechnen, z. B. einen Nettoartikel in eine Bruttorechnung */
export function convertPrice(unitPrice: Cents, taxRate: BasisPoints, from: PriceMode, to: PriceMode): Cents {
  if (from === to) return unitPrice;
  return to === "brutto" ? unitPrice + taxOf(unitPrice, taxRate) : unitPrice - taxIncluded(unitPrice, taxRate);
}

/** Summen aus den gespeicherten Beträgen je Steuersatz */
export function totalsFromTaxes(rows: TaxBreakdown[]): InvoiceTotals {
  const taxes = [...rows].sort((a, b) => b.rate - a.rate).map(({ rate, base, tax }) => ({ rate, base, tax }));
  const net = taxes.reduce((sum, t) => sum + t.base, 0);
  const tax = taxes.reduce((sum, t) => sum + t.tax, 0);
  return { net, tax, gross: net + tax, taxes };
}

/** "152" → 152000, "0,5" → 500, "1.500" → 1500000; null, wenn keine Menge ("1.5" ist mehrdeutig) */
export function parseQuantity(input: string): Millis | null {
  const cleaned = input.trim();
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,3})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.replace(/\./g, "").split(",");
  return Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
}

const quantityFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });

export function formatQuantity(quantity: Millis): string {
  return quantityFormat.format(quantity / 1000);
}

export function formatRate(rate: BasisPoints): string {
  return `${rate / 100} %`;
}

/** Rechnungsnummer aus Jahr und laufender Nummer: 2026, 34 → "2026-034" */
export function formatInvoiceNumber(year: number, counter: number): string {
  return `${year}-${String(counter).padStart(3, "0")}`;
}

/** Angebotsnummer, eigener Nummernkreis: 2026, 7 → "AN-2026-007" */
export function formatQuoteNumber(year: number, counter: number): string {
  return `AN-${formatInvoiceNumber(year, counter)}`;
}

/** Standard-Gültigkeit eines Angebots in Tagen */
export const QUOTE_VALID_DAYS = 30;
