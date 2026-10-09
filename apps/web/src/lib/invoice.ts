import type { DraftInput } from "../server/invoices.ts";

export type InvoiceFormat = DraftInput["format"];

export const FORMAT_LABEL: Record<InvoiceFormat, string> = {
  zugferd: "ZUGFeRD · EN 16931 (PDF mit XML)",
  "xrechnung-cii": "XRechnung 3.0 (CII)",
  "xrechnung-ubl": "XRechnung 3.0 (UBL)",
};
export const FORMATS = Object.keys(FORMAT_LABEL) as InvoiceFormat[];

export const KIND_TITLE = { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur", angebot: "Angebot" } as const;
export const VARIANT_TITLE = { abschlag: "Abschlagsrechnung", schluss: "Schlussrechnung" } as const;

/** Überschrift einer Rechnung: Abschlags- und Schlussrechnung heißen so, sonst nach Art */
export function invoiceTitle(kind: keyof typeof KIND_TITLE, variant?: keyof typeof VARIANT_TITLE | null): string {
  return kind === "rechnung" && variant ? VARIANT_TITLE[variant] : KIND_TITLE[kind];
}
