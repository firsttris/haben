import type { Cents } from "./money.ts";

/**
 * Inhalt eines GiroCodes (EPC-QR-Code, EPC069-12 Version 002): Banking-Apps lesen daraus Empfänger,
 * IBAN, Betrag und Verwendungszweck einer SEPA-Überweisung. Die BIC ist in Version 002 optional.
 */
export interface GirocodeInput {
  name: string;
  iban: string;
  bic?: string;
  amount: Cents;
  /** Unstrukturierter Verwendungszweck, höchstens 140 Zeichen */
  text: string;
}

const compact = (value: string) => value.replace(/\s+/g, "").toUpperCase();

/** Text für den QR-Code oder null, wenn eine Angabe nicht passt (dann entfällt der Code) */
export function girocodePayload(input: GirocodeInput): string | null {
  const iban = compact(input.iban);
  const bic = compact(input.bic ?? "");
  const name = input.name.trim().replace(/\s+/g, " ");
  const text = input.text.trim().replace(/\s+/g, " ");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  if (bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) return null;
  if (!name || name.length > 70 || text.length > 140) return null;
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > 99_999_999_999) return null;
  const amount = `EUR${Math.floor(input.amount / 100)}.${String(input.amount % 100).padStart(2, "0")}`;
  // Leerzeilen für Zweck und strukturierte Referenz; danach der freie Verwendungszweck
  const payload = ["BCD", "002", "1", "SCT", bic, name, iban, amount, "", "", text].join("\n");
  return new TextEncoder().encode(payload).length <= 331 ? payload : null;
}
