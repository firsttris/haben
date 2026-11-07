import { PARTY_RULES } from "./party-rules.ts";
import { TEXT_RULES } from "./text-rules.ts";
import type { OwnCompany, OwnInvoiceInput, OwnInvoiceLevel, OwnInvoiceRule, OwnInvoiceSignal, OwnInvoiceVerdict } from "./types.ts";

export type * from "./types.ts";
export { isOwnName, isOwnUstId, nameCore } from "./company-match.ts";

/*
 * Erkennt eine eigene Ausgangsrechnung unter den Belegen. Jede Regel liefert Signale mit Richtung und Konfidenz;
 * eine neue Heuristik ist eine weitere Funktion in `OWN_INVOICE_RULES` (oder im Aufruf übergeben), sonst ändert sich
 * nichts.
 *
 * Zusammenfassung: Je Regel und Richtung zählt nur das stärkste Signal, damit eine Kennung, die dreimal auf dem Beleg
 * steht, nicht dreimal zählt. Die Regeln einer Richtung werden als unabhängige Hinweise verknüpft
 * (1 − ∏(1 − Konfidenz)); Hinweise auf eine fremde Rechnung mindern das Ergebnis im selben Maß.
 */

export const OWN_INVOICE_RULES: OwnInvoiceRule[] = [...PARTY_RULES, ...TEXT_RULES];

/** Ab dieser Konfidenz gilt der Beleg sicher als eigene Rechnung */
export const OWN_INVOICE_SURE = 0.9;
/** Ab dieser Konfidenz gibt es den Hinweis „vermutlich eigene Rechnung“ */
export const OWN_INVOICE_LIKELY = 0.6;

export function detectOwnInvoice(input: OwnInvoiceInput, company: OwnCompany, rules: OwnInvoiceRule[] = OWN_INVOICE_RULES): OwnInvoiceVerdict {
  const signals = strongestPerRule(rules.flatMap((rule) => rule(input, company)));
  const own = combined(signals.filter((s) => s.direction === "own"));
  const foreign = combined(signals.filter((s) => s.direction === "foreign"));
  const confidence = own * (1 - foreign);
  return { level: levelOf(confidence), confidence, signals };
}

function strongestPerRule(signals: OwnInvoiceSignal[]): OwnInvoiceSignal[] {
  const strongest = new Map<string, OwnInvoiceSignal>();
  for (const signal of signals) {
    const key = `${signal.rule}:${signal.direction}`;
    const seen = strongest.get(key);
    if (!seen || signal.confidence > seen.confidence) strongest.set(key, signal);
  }
  return [...strongest.values()].sort((a, b) => b.confidence - a.confidence);
}

function combined(signals: OwnInvoiceSignal[]): number {
  return 1 - signals.reduce((rest, signal) => rest * (1 - clamp(signal.confidence)), 1);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function levelOf(confidence: number): OwnInvoiceLevel {
  if (confidence >= OWN_INVOICE_SURE) return "sicher";
  if (confidence >= OWN_INVOICE_LIKELY) return "vermutlich";
  return "keine";
}

/** Hinweis am Beleg mit den Gründen, die dafür sprechen; null, wenn nichts erkannt wurde */
export function ownInvoiceHint(verdict: OwnInvoiceVerdict): string | null {
  if (verdict.level === "keine") return null;
  const reasons = verdict.signals.filter((s) => s.direction === "own").map((s) => s.reason);
  const head =
    verdict.level === "sicher" ? "Das ist eine eigene Ausgangsrechnung, keine Ausgabe." : "Das ist vermutlich eine eigene Ausgangsrechnung, keine Ausgabe.";
  return `${head} ${reasons.join(" ")} Haben schlägt deshalb keine Ausgabe vor; ist es doch ein Eingangsbeleg, trag Kategorie und Beträge von Hand ein.`;
}
