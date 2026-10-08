import { z } from "zod/mini";
import { roundHalfAwayFromZero, taxOf, type BasisPoints, type Cents } from "./money.ts";

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

/** Zeilennetto: Menge × Einzelpreis, kaufmännisch gerundet. */
export function lineNet(quantity: Millis, unitPrice: Cents): Cents {
  return roundHalfAwayFromZero((quantity * unitPrice) / 1000);
}

/**
 * Summen nach EN 16931: Steuer je Steuersatz auf die Summe der Zeilennetto,
 * nicht als Summe der Zeilensteuern.
 */
export function computeInvoiceTotals(lines: Pick<InvoiceLineInput, "quantity" | "unitPrice" | "taxRate">[]): InvoiceTotals {
  const bases = new Map<BasisPoints, Cents>();
  for (const line of lines) {
    bases.set(line.taxRate, (bases.get(line.taxRate) ?? 0) + lineNet(line.quantity, line.unitPrice));
  }
  const taxes = [...bases.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, base]) => ({ rate, base, tax: taxOf(base, rate) }));
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
