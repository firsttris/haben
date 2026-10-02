import type { Cents } from "./money.ts";

export interface MatchTransaction {
  bookingDate: string;
  /** Eingang positiv, Ausgang negativ */
  amount: Cents;
  counterpartyName: string;
  counterpartyIban?: string | null;
  purpose: string;
}

export interface OpenItem {
  type: "invoice" | "document";
  id: string;
  /** Rechnungsnummer (eigene oder des Lieferanten) */
  number: string;
  date: string;
  dueDate?: string | null;
  /** Offener Betrag mit dem Vorzeichen, das die Zahlung auf dem Konto hätte */
  open: Cents;
  partyName: string;
  partyIbans: string[];
}

export interface Suggestion {
  item: OpenItem;
  score: number;
  reasons: string[];
  /** Betrag, der zugeordnet würde */
  amount: Cents;
}

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const STOP_WORDS = new Set(["gmbh", "ag", "ug", "kg", "ohg", "mbh", "co", "und", "der", "die", "das", "e.k.", "ek", "se", "ltd", "inc"]);

function words(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-zäöüß0-9]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** Rechnungsnummer im Verwendungszweck, unabhängig von Leerzeichen und Trennzeichen */
export function purposeContainsNumber(purpose: string, number: string): boolean {
  const needle = compact(number);
  return needle.length >= 3 && compact(purpose).includes(needle);
}

/**
 * Vorschläge für einen Bankumsatz mit Begründung: Betrag, Rechnungsnummer im Verwendungszweck,
 * bekannte IBAN, Name; bei Belegen Betrag und Datum ± 5 Tage.
 */
export function suggestMatches(tx: MatchTransaction, items: OpenItem[], limit = 3): Suggestion[] {
  const iban = tx.counterpartyIban?.replace(/\s/g, "").toUpperCase();
  const txWords = words(tx.counterpartyName);
  const suggestions: Suggestion[] = [];

  for (const item of items) {
    if (item.open === 0 || Math.sign(item.open) !== Math.sign(tx.amount)) continue;
    const reasons: string[] = [];
    let score = 0;

    const exact = item.open === tx.amount;
    if (exact) {
      score += 50;
      reasons.push("Betrag stimmt exakt");
    } else if (Math.abs(tx.amount) < Math.abs(item.open)) {
      score += 5;
      reasons.push("Teilbetrag des offenen Betrags");
    }
    if (purposeContainsNumber(tx.purpose, item.number)) {
      score += 40;
      reasons.push("Rechnungsnummer im Verwendungszweck");
    }
    if (iban && item.partyIbans.some((i) => i.replace(/\s/g, "").toUpperCase() === iban)) {
      score += 30;
      reasons.push("IBAN bekannt vom Kontakt");
    }
    const partyWords = words(item.partyName);
    if ([...partyWords].some((w) => txWords.has(w))) {
      score += 15;
      reasons.push("Name passt");
    }
    if (item.type === "document") {
      const near = [item.date, item.dueDate].some((d) => d && daysBetween(d, tx.bookingDate) <= 5);
      if (near) {
        score += 10;
        reasons.push("Datum passt (± 5 Tage)");
      }
    }
    // Ohne passenden Betrag nur mit starkem weiteren Hinweis vorschlagen
    if (score < 40) continue;
    const amount = Math.abs(tx.amount) <= Math.abs(item.open) ? tx.amount : item.open;
    suggestions.push({ item, score, reasons, amount });
  }

  return suggestions.sort((a, b) => b.score - a.score || a.item.date.localeCompare(b.item.date)).slice(0, limit);
}
