// Positionen im Editor von Rechnung und Angebot: Eingabestand je Zeile und seine Prüfung (InvoiceEditor.tsx)
import {
  discountInput,
  formatDecimal,
  formatQuantity,
  lineDiscountProblem,
  parseDiscount,
  parseEuro,
  parseQuantity,
  type Discount,
  type InvoiceLineInput,
  type QuoteLineKind,
  type UnitLabel,
} from "@haben/core";
import type { DraftInput } from "../server/modules/rechnungen/index.ts";

export interface LineState {
  key: number;
  description: string;
  /** Mehrzeilige Beschreibung unter der Bezeichnung */
  detail: string;
  /** Artikelnummer (BT-155), aus dem Artikel kopiert und änderbar */
  itemNumber: string;
  quantity: string;
  unit: UnitLabel;
  unitPrice: string;
  taxRate: 1900 | 700 | 0;
  /** Positionsrabatt wie eingegeben, „10 %“ oder „50,00“ */
  discount: string;
  /** Nur im Angebot: optional oder Alternative zur Hauptposition davor */
  kind: QuoteLineKind | null;
}

/** Position im Entwurf; im Angebot zusätzlich die Art */
export type EditorLine = DraftInput["lines"][number] & { kind?: QuoteLineKind | null };

let nextKey = 1;

/** Bezeichnungen vergleichen, ohne dass Zeilenumbrüche und doppelte Leerzeichen zählen */
export const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export function toLineState(line: EditorLine): LineState {
  return {
    key: nextKey++,
    description: line.description,
    detail: line.detail ?? "",
    itemNumber: line.itemNumber ?? "",
    quantity: formatQuantity(line.quantity),
    unit: line.unit,
    unitPrice: line.unitPrice === 0 ? "" : formatDecimal(line.unitPrice),
    taxRate: line.taxRate,
    discount: discountInput(line.discount),
    kind: line.kind ?? null,
  };
}

/** Leere Zeile mit Einheit und Satz der letzten */
export const emptyLine = (unit: UnitLabel, taxRate: 1900 | 700 | 0): LineState => ({
  key: nextKey++,
  description: "",
  detail: "",
  itemNumber: "",
  quantity: "1",
  unit,
  unitPrice: "",
  taxRate,
  discount: "",
  kind: null,
});

export type ParsedLine = InvoiceLineInput & {
  detail: string;
  itemNumber: string;
  discount: Discount | null;
  kind: QuoteLineKind | null;
  valid: boolean;
  discountError: boolean;
};

export function parseLine(line: LineState): ParsedLine {
  const quantity = parseQuantity(line.quantity);
  const unitPrice = parseEuro(line.unitPrice);
  const discount = parseDiscount(line.discount);
  const parsed = {
    description: line.description.trim(),
    detail: line.detail.trim(),
    itemNumber: line.itemNumber.trim(),
    quantity: quantity ?? 0,
    unit: line.unit,
    unitPrice: unitPrice ?? 0,
    taxRate: line.taxRate,
    discount: discount === "ungültig" ? null : discount,
    kind: line.kind,
  };
  const discountError = discount === "ungültig" || lineDiscountProblem(parsed) !== null;
  return {
    ...parsed,
    discountError,
    valid: quantity !== null && quantity > 0 && unitPrice !== null && line.description.trim() !== "" && !discountError,
  };
}

/**
 * Was einer Position fehlt, als Satz für den Fehler unter ihr (DESIGN.md, Gesperrte Knöpfe); null, wenn sie gültig ist.
 * Ohne Rabatt (Serienrechnung) nur Beschreibung, Menge und Einzelpreis.
 */
export function positionsFehler(line: Pick<LineState, "description" | "quantity" | "unitPrice"> & Partial<LineState>): string | null {
  const fehlt = [
    line.description.trim() === "" && "die Beschreibung",
    !((parseQuantity(line.quantity) ?? 0) > 0) && "eine Menge über 0",
    parseEuro(line.unitPrice) === null && "den Einzelpreis",
  ].filter((teil): teil is string => Boolean(teil));
  const saetze = fehlt.length > 0 ? [`Trag ${fehlt.length > 1 ? `${fehlt.slice(0, -1).join(", ")} und ${fehlt.at(-1)}` : fehlt[0]} ein.`] : [];
  if (line.discount !== undefined && line.key !== undefined && parseLine(line as LineState).discountError) {
    const problem = parseDiscount(line.discount) === "ungültig" ? null : lineDiscountProblem(parseLine(line as LineState));
    saetze.push(problem ? `${problem}.` : "Rabatt als Prozent (z. B. 5 %) oder Betrag (z. B. 100,00).");
  }
  return saetze.length > 0 ? saetze.join(" ") : null;
}
