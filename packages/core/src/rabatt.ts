import { z } from "zod/mini";
import type { InvoiceTotals, PriceMode } from "./invoice.ts";
import { formatEuro, parseEuro, roundHalfAwayFromZero, taxIncluded, type BasisPoints, type Cents } from "./money.ts";
import { formatPercent } from "./skonto.ts";

/*
 * Rabatte auf Rechnung, Angebot und Auftragsbestätigung, nach dem Vorbild von Lexware Office („Rabatte in
 * Ausgangsbelegen“, help.lexware.de Artikel 547984): Positionsrabatt auf eine Position, Gesamtrabatt auf die Summe aller
 * Positionen; erst die Positionsrabatte, dann der Gesamtrabatt auf die schon rabattierten Positionen. Anders als Lexware
 * lässt Haben auch beim Positionsrabatt einen festen Betrag zu.
 *
 * Beträge gelten im Preismodus des Belegs: bei Nettopreisen netto, bei Bruttopreisen brutto. In der E-Rechnung steht der
 * Positionsrabatt als Line allowance (BG-27, BT-136 bis BT-140), der Gesamtrabatt je Steuersatz als Document level
 * allowance (BG-20, BT-92 bis BT-98) mit Netto, wie es EN 16931 verlangt. Skonto ist kein Rabatt und bleibt getrennt.
 */

/** Rabatt in Prozent (Basispunkte, 1000 = 10 %) oder als fester Betrag in Cent */
export type Discount = { kind: "prozent"; value: BasisPoints } | { kind: "betrag"; value: Cents };

export const discountSchema = z.union([
  z.object({ kind: z.literal("prozent"), value: z.int().check(z.minimum(1), z.maximum(10_000)) }),
  z.object({ kind: z.literal("betrag"), value: z.int().check(z.minimum(-100_000_000_00), z.maximum(100_000_000_00)) }),
]);

/**
 * Eingabe im Editor: „10 %“ ist ein Prozentsatz, „50,00“ ein Betrag. null = kein Rabatt, „ungültig“ bei Unsinn, 0, einem
 * negativen Wert oder mehr als 100 %.
 */
export function parseDiscount(input: string): Discount | null | "ungültig" {
  const text = input.trim();
  if (text === "") return null;
  if (text.includes("%")) {
    const value = parseEuro(text.replace(/%/g, "").trim());
    return value === null || value <= 0 || value > 10_000 ? "ungültig" : { kind: "prozent", value };
  }
  const value = parseEuro(text);
  return value === null || value <= 0 ? "ungültig" : { kind: "betrag", value };
}

/** „10 %“ bzw. „50,00 €“ */
export function discountLabel(discount: Discount): string {
  return discount.kind === "prozent" ? formatPercent(discount.value) : formatEuro(Math.abs(discount.value));
}

/** Für das Eingabefeld: „10 %“ bzw. „50,00“ */
export function discountInput(discount: Discount | null | undefined): string {
  if (!discount) return "";
  return discount.kind === "prozent" ? formatPercent(discount.value).replace(" ", " ") : formatEuro(Math.abs(discount.value)).replace(" €", "");
}

/** Aus den Spalten discount_percent und discount_amount; höchstens eine ist gesetzt (Check in der Datenbank) */
export function discountFromColumns(percent: number | null, amount: number | null): Discount | null {
  if (percent !== null) return { kind: "prozent", value: percent };
  if (amount !== null) return { kind: "betrag", value: amount };
  return null;
}

/** Für die Spalten discount_percent und discount_amount */
export function discountColumns(discount: Discount | null | undefined): { discountPercent: number | null; discountAmount: number | null } {
  return {
    discountPercent: discount?.kind === "prozent" ? discount.value : null,
    discountAmount: discount?.kind === "betrag" ? discount.value : null,
  };
}

/** Ein fester Betrag wechselt mit dem Beleg das Vorzeichen (Storno, Korrektur); Prozent bleibt */
export function negateDiscount(discount: Discount | null | undefined): Discount | null {
  if (!discount) return null;
  return discount.kind === "betrag" ? { kind: "betrag", value: -discount.value } : discount;
}

/**
 * Verteilt total anteilig nach weights, kaufmännisch gerundet; den Rundungsrest trägt der betragsmäßig größte Anteil (bei
 * gleichen der erste), wie beim Netto einer Bruttorechnung und bei Teilzahlungen. Die Summe ist exakt total, und negierte
 * Eingaben ergeben exakt negierte Anteile.
 */
export function distribute(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const shares = weights.map((w) => roundHalfAwayFromZero((total * w) / sum));
  const rest = total - shares.reduce((s, v) => s + v, 0);
  if (rest !== 0) {
    const largest = weights.reduce((best, w, i) => (Math.abs(w) > Math.abs(weights[best]!) ? i : best), 0);
    shares[largest] = shares[largest]! + rest;
  }
  return shares;
}

/** Abzug einer Position im Preismodus; mit dem Vorzeichen der Position */
export function lineDiscountAmount(amount: Cents, discount: Discount | null | undefined): Cents {
  if (!discount) return 0;
  return discount.kind === "prozent" ? roundHalfAwayFromZero((amount * discount.value) / 10_000) : discount.value;
}

export interface DiscountableLine {
  quantity: number;
  unitPrice: Cents;
  discount?: Discount | null | undefined;
}

/** Menge × Einzelpreis, kaufmännisch gerundet; dieselbe Rechnung wie lineAmount in invoice.ts */
const grossLineAmount = (line: DiscountableLine) => roundHalfAwayFromZero((line.quantity * line.unitPrice) / 1000);

/** Zeilenbetrag nach Positionsrabatt, netto oder brutto wie der Einzelpreis */
export function discountedLineAmount(line: DiscountableLine): Cents {
  const amount = grossLineAmount(line);
  return amount - lineDiscountAmount(amount, line.discount);
}

/** Ein fester Positionsrabatt darf die Position nicht übersteigen und hat ihr Vorzeichen; null = in Ordnung */
export function lineDiscountProblem(line: DiscountableLine): string | null {
  if (!line.discount || line.discount.kind === "prozent") return null;
  const amount = grossLineAmount(line);
  const discount = line.discount.value;
  return Math.sign(discount) !== Math.sign(amount) || Math.abs(discount) > Math.abs(amount) ? "Der Rabatt ist höher als die Position" : null;
}

/** Gesamtrabatt eines Steuersatzes: Grundlage und Abzug im Preismodus, dazu das Netto des Abzugs (BT-92) */
export interface DocumentAllowance {
  rate: BasisPoints;
  /** Summe der rabattierbaren Positionen des Satzes nach Positionsrabatt (BT-93 bei Nettopreisen) */
  basis: Cents;
  /** Abzug im Preismodus, wie er auf dem Beleg steht */
  amount: Cents;
  /** Abzug netto (BT-92); bei Nettopreisen gleich amount */
  net: Cents;
}

interface RateLine extends DiscountableLine {
  taxRate: BasisPoints;
  /** Abzugsposition einer Schlussrechnung: zählt nicht zur Grundlage des Gesamtrabatts */
  deductionOf?: string | null | undefined;
}

/** Rabattierbare Summe je Satz (absteigend nach Satz), ohne Abzüge der Schlussrechnung */
export function discountBasis(lines: RateLine[]): Map<BasisPoints, Cents> {
  const basis = new Map<BasisPoints, Cents>();
  for (const line of lines) {
    const current = basis.get(line.taxRate) ?? 0;
    basis.set(line.taxRate, current + (line.deductionOf ? 0 : discountedLineAmount(line)));
  }
  return basis;
}

/**
 * Gesamtrabatt je Satz im Preismodus: Prozent gilt für jeden Satz gleich, ein fester Betrag verteilt sich im Verhältnis der
 * Summen je Satz, der Rundungsrest geht an den größten Satz.
 */
export function splitDocumentDiscount(lines: RateLine[], discount: Discount | null | undefined): Map<BasisPoints, Cents> {
  const basis = discountBasis(lines);
  const rates = [...basis.keys()];
  if (!discount) return new Map(rates.map((rate) => [rate, 0]));
  if (discount.kind === "prozent") {
    return new Map(rates.map((rate) => [rate, roundHalfAwayFromZero((basis.get(rate)! * discount.value) / 10_000)]));
  }
  const shares = distribute(
    discount.value,
    rates.map((rate) => basis.get(rate)!),
  );
  return new Map(rates.map((rate, i) => [rate, shares[i]!]));
}

/** Ein Gesamtrabatt braucht Positionen mit dem Vorzeichen des Rabatts und darf ihre Summe nicht übersteigen; null = in Ordnung */
export function documentDiscountProblem(lines: RateLine[], discount: Discount | null | undefined): string | null {
  if (!discount) return null;
  const sums = [...discountBasis(lines).values()];
  const total = sums.reduce((s, v) => s + v, 0);
  const sign = discount.kind === "prozent" ? Math.sign(total) : Math.sign(discount.value);
  const mixed = sums.some((s) => s !== 0 && Math.sign(s) !== sign);
  const tooHigh = discount.kind === "betrag" && Math.abs(discount.value) > Math.abs(total);
  return total === 0 || mixed || Math.sign(total) !== sign || tooHigh ? "Der Gesamtrabatt ist höher als die Summe der Positionen" : null;
}

interface StoredLine extends RateLine {
  /** Zeilennetto, wie gespeichert */
  net: Cents;
}

/**
 * Gesamtrabatt je Satz aus einer gespeicherten Rechnung: Das Netto der Positionen eines Satzes abzüglich seiner
 * Bemessungsgrundlage ist der Abzug netto, so wie computeInvoice beides berechnet hat. PDF und XML lesen so nur
 * gespeicherte Werte (invoice_taxes, Zeilennetto) und rechnen nichts neu.
 */
export function documentAllowances(lines: StoredLine[], totals: InvoiceTotals, priceMode: PriceMode): DocumentAllowance[] {
  const basis = discountBasis(lines);
  return totals.taxes.flatMap((t) => {
    const ofRate = lines.filter((l) => l.taxRate === t.rate);
    const net = ofRate.reduce((s, l) => s + l.net, 0) - t.base;
    const priced = ofRate.reduce((s, l) => s + discountedLineAmount(l), 0);
    const amount = priceMode === "netto" ? net : priced - (t.base + t.tax);
    return amount === 0 && net === 0 ? [] : [{ rate: t.rate, basis: basis.get(t.rate) ?? 0, amount, net }];
  });
}

/** Netto eines Betrags im Preismodus, für einen einzelnen Satz */
export function netOf(amount: Cents, rate: BasisPoints, priceMode: PriceMode): Cents {
  return priceMode === "netto" ? amount : amount - taxIncluded(amount, rate);
}
