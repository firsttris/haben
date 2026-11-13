import { describe, expect, it } from "vitest";
import { parseEInvoiceXml } from "./incoming.ts";
import { pdfData } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";

const cases = [
  { name: "unbekannter Zahlstand", kind: "storno", hasPayments: undefined, de: "Es ist keine Zahlung erforderlich.", en: "No payment is required." },
  { name: "unbezahlte Rechnung", kind: "storno", hasPayments: false, de: "Es ist keine Zahlung erforderlich.", en: "No payment is required." },
  {
    name: "geleistete Zahlung",
    kind: "storno",
    hasPayments: true,
    de: "Bereits geleistete Zahlungen werden erstattet.",
    en: "Payments already received will be refunded.",
  },
  {
    name: "Rechnungskorrektur",
    kind: "korrektur",
    hasPayments: true,
    de: "Die ursprüngliche Rechnung wird um den ausgewiesenen Betrag korrigiert.",
    en: "The original invoice is adjusted by the amount shown.",
  },
] as const;

describe("Zahlungssatz negativer Belege", () => {
  for (const entry of cases) {
    it.each(["de", "en"] as const)(`${entry.name}: PDF auf %s ohne pauschale Auszahlung`, (language) => {
      const doc = { ...sampleDocument({ kind: entry.kind }), hasPayments: entry.hasPayments, language };
      expect(pdfData(doc).payment).toBe(entry[language]);
    });

    it.each(["xrechnung-ubl", "xrechnung-cii", "zugferd"] as const)(`${entry.name}: derselbe deutsche Inhalt in %s`, async (format) => {
      const doc = { ...sampleDocument({ kind: entry.kind, format }), hasPayments: entry.hasPayments };
      const { xml } = await buildEInvoice(doc);
      expect(parseEInvoiceXml(xml).paymentTerms).toBe(entry.de);
    });
  }
});
