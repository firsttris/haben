import type { OrderReferences } from "@haben/einvoice";
import { z } from "zod";

/**
 * Bestellnummer des Kunden (BT-13), eigene Auftragsnummer (BT-14) und Lieferschein (BT-16) an Rechnung und Angebot
 * (#389). EN 16931 kennt für die drei Kennungen keine Höchstlänge; 100 Zeichen reichen für jede Bestellnummer.
 */
const reference = z.string().trim().max(100, "Höchstens 100 Zeichen").default("");

export const referenceFieldsSchema = {
  /** Bestellnummer des Kunden (BT-13) */
  buyerOrderReference: reference,
  /** Eigene Auftragsnummer (BT-14) */
  sellerOrderReference: reference,
  /** Lieferscheinnummer (BT-16) */
  despatchAdviceReference: reference,
};

export interface ReferenceColumns {
  buyerOrderReference: string;
  sellerOrderReference: string;
  despatchAdviceReference: string;
}

/** Spalten aus der Eingabe; fehlt ein Feld, ist es leer */
export function referenceColumns(input: Partial<Record<keyof ReferenceColumns, string | undefined>>): ReferenceColumns {
  return {
    buyerOrderReference: input.buyerOrderReference?.trim() ?? "",
    sellerOrderReference: input.sellerOrderReference?.trim() ?? "",
    despatchAdviceReference: input.despatchAdviceReference?.trim() ?? "",
  };
}

/** Die Referenzen für PDF und XML; ohne gesetzte Referenz nichts */
export function documentReferences(row: ReferenceColumns): { references?: OrderReferences } {
  const references: OrderReferences = {
    ...(row.buyerOrderReference ? { buyerOrder: row.buyerOrderReference } : {}),
    ...(row.sellerOrderReference ? { sellerOrder: row.sellerOrderReference } : {}),
    ...(row.despatchAdviceReference ? { despatchAdvice: row.despatchAdviceReference } : {}),
  };
  return Object.keys(references).length > 0 ? { references } : {};
}

/**
 * Referenzen einer Rechnung aus dem Angebot: Bestell- und Lieferscheinnummer wie im Angebot, als Auftragsnummer die
 * eigene des Angebots, sonst seine Nummer (#389)
 */
export function referencesFromQuote(quote: ReferenceColumns & { number: string | null }): ReferenceColumns {
  return { ...referenceColumns(quote), sellerOrderReference: quote.sellerOrderReference || (quote.number ?? "") };
}
