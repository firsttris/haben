import { z } from "zod/mini";
import type { InvoiceTotals, PriceMode } from "./invoice.ts";
import { formatEuro, roundHalfAwayFromZero, taxIncluded, taxOf, type BasisPoints, type Cents } from "./money.ts";
import { distribute } from "./rabatt.ts";

/*
 * Zahlungsplan im Angebot: Bei größeren Aufträgen wird in Teilen abgerechnet, z. B. 30 % bei Auftragserteilung, 40 % bei
 * Lieferung, der Rest mit der Schlussrechnung. Je Zeile ein Prozentsatz des Angebotsbetrags oder ein fester Betrag; die
 * letzte Zeile ist immer der Rest. Ein fester Betrag folgt dem Preismodus des Angebots (netto oder brutto), die Fälligkeit
 * ist nur Text („bei Lieferung“).
 *
 * Bei mehreren Steuersätzen teilt sich jede Zeile anteilig je Satz: Prozent gilt für jeden Satz gleich, ein fester Betrag
 * im Verhältnis der Nettobeträge, der Rundungsrest geht an den größten Satz (distribute). Die Abschlagsrechnung zu einer
 * Zeile bekommt je Satz eine Position; die Schlussrechnung zieht die Abschläge wie bisher je Satz ab (§ 14 Abs. 5 UStG).
 */

export type PlanShare = { kind: "prozent"; value: BasisPoints } | { kind: "betrag"; value: Cents } | { kind: "rest" };

export interface PaymentPlanRow {
  /** z. B. „Anzahlung“, „Abschlag“, „Schlussrechnung“ */
  label: string;
  share: PlanShare;
  /** Fällig bei …, nur Text, z. B. „Auftragserteilung“ */
  due: string;
}

export interface PlanTemplate {
  name: string;
  rows: PaymentPlanRow[];
}

/** Höchstzahl der Zeilen; mehr Abschläge sind in der Praxis selten */
export const PLAN_ROWS_MAX = 12;

export const planShareSchema = z.union([
  z.object({ kind: z.literal("prozent"), value: z.int().check(z.minimum(1), z.maximum(10_000)) }),
  z.object({ kind: z.literal("betrag"), value: z.int().check(z.minimum(1), z.maximum(100_000_000_00)) }),
  z.object({ kind: z.literal("rest") }),
]);

export const paymentPlanRowSchema = z.object({
  label: z.string().check(z.trim(), z.maxLength(100)),
  share: planShareSchema,
  due: z.string().check(z.trim(), z.maxLength(100)),
});

export const paymentPlanSchema = z.array(paymentPlanRowSchema).check(z.maxLength(PLAN_ROWS_MAX));

export const planTemplateSchema = z.object({
  name: z.string().check(z.trim(), z.minLength(1, "Name der Vorlage fehlt"), z.maxLength(60)),
  rows: paymentPlanSchema,
});

const rest = (label: string, due: string): PaymentPlanRow => ({ label, share: { kind: "rest" }, due });
const prozent = (label: string, value: number, due: string): PaymentPlanRow => ({ label, share: { kind: "prozent", value }, due });

/** Vorlagen ab Werk; in den Einstellungen änderbar */
export const DEFAULT_PLAN_TEMPLATES: PlanTemplate[] = [
  {
    name: "30/40/30",
    rows: [prozent("Anzahlung", 3000, "Auftragserteilung"), prozent("Abschlag", 4000, "Lieferung"), rest("Schlussrechnung", "Abnahme")],
  },
  { name: "50/50", rows: [prozent("Anzahlung", 5000, "Auftragserteilung"), rest("Schlussrechnung", "Abnahme")] },
];

/** Betrag des Auftrags je Satz im Preismodus, dazu das Netto (Gewicht für feste Beträge) */
export interface OrderRateAmount {
  rate: BasisPoints;
  amount: Cents;
  net: Cents;
}

export function orderRateAmounts(totals: InvoiceTotals, priceMode: PriceMode): OrderRateAmount[] {
  return totals.taxes.map((t) => ({ rate: t.rate, amount: priceMode === "netto" ? t.base : t.base + t.tax, net: t.base }));
}

/** Anteil einer Zeile in Cent im Preismodus, gerechnet auf die Summe */
function shareTotal(share: PlanShare, total: Cents): Cents {
  if (share.kind === "prozent") return roundHalfAwayFromZero((total * share.value) / 10_000);
  return share.kind === "betrag" ? share.value : 0;
}

/** Plan prüfen gegen den Angebotsbetrag im Preismodus; null = in Ordnung, ein leerer Plan ist keiner */
export function planProblem(rows: PaymentPlanRow[], total: Cents): string | null {
  if (rows.length === 0) return null;
  const blank = rows.findIndex((r) => r.label.trim() === "");
  if (blank >= 0) return `Zeile ${blank + 1} des Zahlungsplans braucht eine Bezeichnung`;
  if (rows[rows.length - 1]!.share.kind !== "rest") return "Die letzte Zeile des Zahlungsplans ist der Rest (Schlussrechnung)";
  if (rows.slice(0, -1).some((r) => r.share.kind === "rest")) return "Nur die letzte Zeile des Zahlungsplans ist der Rest";
  const planned = rows.reduce((s, r) => s + shareTotal(r.share, total), 0);
  if (planned > total) return `Der Zahlungsplan übersteigt den Angebotsbetrag (${formatEuro(planned)} von ${formatEuro(total)})`;
  return null;
}

/** Eine Zeile je Satz: Prozent je Satz gleich, fester Betrag im Verhältnis der Nettobeträge; der Rest hier 0 */
export function splitPlanShare(share: PlanShare, amounts: OrderRateAmount[]): { rate: BasisPoints; amount: Cents }[] {
  if (share.kind === "prozent") return amounts.map((a) => ({ rate: a.rate, amount: roundHalfAwayFromZero((a.amount * share.value) / 10_000) }));
  const parts =
    share.kind === "betrag"
      ? distribute(
          share.value,
          amounts.map((a) => a.net),
        )
      : amounts.map(() => 0);
  return amounts.map((a, i) => ({ rate: a.rate, amount: parts[i]! }));
}

export interface ScheduledRate {
  rate: BasisPoints;
  /** Im Preismodus, wie auf der Abschlagsrechnung */
  amount: Cents;
  base: Cents;
  tax: Cents;
}

export interface ScheduledRow extends PaymentPlanRow {
  rates: ScheduledRate[];
  net: Cents;
  tax: Cents;
  gross: Cents;
}

/** Netto und Steuer eines Betrags im Preismodus, wie computeInvoice für eine einzelne Position rechnet */
function withTax(rate: BasisPoints, amount: Cents, priceMode: PriceMode): ScheduledRate {
  if (priceMode === "netto") return { rate, amount, base: amount, tax: taxOf(amount, rate) };
  const tax = taxIncluded(amount, rate);
  return { rate, amount, base: amount - tax, tax };
}

/** Beträge aller Zeilen je Satz mit Netto, Steuer und Brutto; der Rest ergänzt je Satz auf den Betrag des Auftrags */
export function planSchedule(rows: PaymentPlanRow[], amounts: OrderRateAmount[], priceMode: PriceMode): ScheduledRow[] {
  const parts = rows.map((row) => splitPlanShare(row.share, amounts));
  return rows.map((row, i) => {
    const rates = amounts.map((a, j) => {
      const amount = row.share.kind === "rest" ? a.amount - parts.reduce((s, p, k) => (k === i ? s : s + p[j]!.amount), 0) : parts[i]![j]!.amount;
      return withTax(a.rate, amount, priceMode);
    });
    const net = rates.reduce((s, r) => s + r.base, 0);
    const tax = rates.reduce((s, r) => s + r.tax, 0);
    return { ...row, rates, net, tax, gross: net + tax };
  });
}

/** „Abgerechnet X von Y (Z %), offen …“; percent in Basispunkten */
export function planProgress(billed: Cents, total: Cents): { billed: Cents; total: Cents; open: Cents; percent: BasisPoints } {
  return { billed, total, open: total - billed, percent: total === 0 ? 0 : roundHalfAwayFromZero((billed * 10_000) / total) };
}

export type PlanRowStatus = "offen" | "entwurf" | "festgeschrieben" | "bezahlt";

export const PLAN_ROW_STATUS_LABEL: Record<PlanRowStatus, string> = {
  offen: "Offen",
  entwurf: "Entwurf",
  festgeschrieben: "Festgeschrieben",
  bezahlt: "Bezahlt",
};

/** Status einer Zeile aus ihren Rechnungen; stornierte zählen nicht, eine festgeschriebene geht vor einem Entwurf */
export function planRowStatus(invoices: { status: "draft" | "final"; cancelled: boolean; open: Cents }[]): PlanRowStatus {
  const live = invoices.filter((i) => !i.cancelled);
  const final = live.find((i) => i.status === "final");
  if (final) return final.open === 0 ? "bezahlt" : "festgeschrieben";
  return live.length > 0 ? "entwurf" : "offen";
}

/** Anteil als Text: „30 %“, „3.000,00 €“ oder „Rest“ */
export function planShareLabel(share: PlanShare, formatPercent: (bp: BasisPoints) => string, money: (c: Cents) => string, restLabel: string): string {
  if (share.kind === "prozent") return formatPercent(share.value);
  return share.kind === "betrag" ? money(share.value) : restLabel;
}
