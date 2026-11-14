import { describe, expect, it } from "vitest";
import { parseEInvoiceXml } from "./incoming.ts";
import { pdfData } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import type { InvoiceFormat } from "./types.ts";
import { buildEInvoice } from "./xml.ts";

const cases = [
  { name: "Storno", kind: "storno", positive: false, de: "Die ursprüngliche Rechnung wird storniert.", en: "The original invoice is cancelled." },
  {
    name: "positives Korrekturstorno",
    kind: "storno",
    positive: true,
    de: "Die ursprüngliche Rechnung wird storniert.",
    en: "The original invoice is cancelled.",
  },
  {
    name: "Rechnungskorrektur",
    kind: "korrektur",
    positive: false,
    de: "Die ursprüngliche Rechnung wird um den ausgewiesenen Betrag korrigiert.",
    en: "The original invoice is adjusted by the amount shown.",
  },
] as const;

function document(entry: (typeof cases)[number], format: InvoiceFormat = "zugferd") {
  return sampleDocument({
    kind: entry.kind,
    format,
    lines: entry.positive ? [{ description: "Storno einer Korrektur", quantity: 1000, unit: "Psch.", unitPrice: -100, taxRate: 0 }] : undefined,
  });
}

describe("Zahlungssatz von Storno und Korrektur", () => {
  for (const entry of cases) {
    it.each(["de", "en"] as const)(`${entry.name}: PDF auf %s ohne pauschale Auszahlung`, (language) => {
      const doc = { ...document(entry), language };
      expect(Math.sign(doc.totals.gross)).toBe(entry.positive ? 1 : -1);
      expect(pdfData(doc).payment).toBe(entry[language]);
    });

    it.each(["xrechnung-ubl", "xrechnung-cii", "zugferd"] as const)(`${entry.name}: derselbe deutsche Inhalt in %s`, async (format) => {
      const { xml } = await buildEInvoice(document(entry, format));
      expect(parseEInvoiceXml(xml).paymentTerms).toBe(entry.de);
    });
  }
});
