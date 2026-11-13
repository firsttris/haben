import { describe, expect, it } from "vitest";
import { parseEInvoiceXml } from "./incoming.ts";
import { pdfData } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";

const cases = [
  {
    name: "Sollsaldo",
    balance: 50,
    de: "Ihr Kundenkonto weist einen Forderungsbestand i.H.v. 0,50\u00a0€ aus.",
    en: "Your customer account currently has an outstanding balance of €0.50.",
  },
  {
    name: "Habensaldo",
    balance: -50,
    de: "Ihr Kundenkonto weist aktuell ein Guthaben i.H.v. 0,50\u00a0€ aus.",
    en: "Your customer account currently has a credit balance of €0.50.",
  },
  {
    name: "Nullsaldo",
    balance: 0,
    de: "Ihr Kundenkonto ist ausgeglichen.",
    en: "Your customer account is balanced.",
  },
  { name: "unbekannter Saldo", balance: undefined, de: "Die ursprüngliche Rechnung wird storniert.", en: "The original invoice is cancelled." },
  {
    name: "Forderung mit Tausender und exakten Cent",
    balance: 123456,
    de: "Ihr Kundenkonto weist einen Forderungsbestand i.H.v. 1.234,56\u00a0€ aus.",
    en: "Your customer account currently has an outstanding balance of €1,234.56.",
  },
  {
    name: "Guthaben mit Tausender und exakten Cent",
    balance: -123456,
    de: "Ihr Kundenkonto weist aktuell ein Guthaben i.H.v. 1.234,56\u00a0€ aus.",
    en: "Your customer account currently has a credit balance of €1,234.56.",
  },
  {
    name: "Forderung von einem Cent",
    balance: 1,
    de: "Ihr Kundenkonto weist einen Forderungsbestand i.H.v. 0,01\u00a0€ aus.",
    en: "Your customer account currently has an outstanding balance of €0.01.",
  },
  {
    name: "Guthaben von einem Cent",
    balance: -1,
    de: "Ihr Kundenkonto weist aktuell ein Guthaben i.H.v. 0,01\u00a0€ aus.",
    en: "Your customer account currently has a credit balance of €0.01.",
  },
] as const;

describe("Saldoabhängiger Stornohinweis ohne Erstattungszusage", () => {
  for (const entry of cases) {
    it.each([
      ["de", "EUR"],
      ["en", "EUR"],
      ["de", "USD"],
      ["en", "USD"],
    ] as const)(`${entry.name}: PDF auf %s mit Belegwährung %s, Saldo in EUR`, (language, currency) => {
      const doc = { ...sampleDocument({ kind: "storno" }), customerBalance: entry.balance, hasPayments: true, language, currency };
      expect(pdfData(doc).payment).toBe(entry[language]);
    });

    it.each(["xrechnung-ubl", "xrechnung-cii", "zugferd"] as const)(`${entry.name}: %s mit demselben Inhalt`, async (format) => {
      const doc = { ...sampleDocument({ kind: "storno", format }), customerBalance: entry.balance, hasPayments: true };
      expect(parseEInvoiceXml((await buildEInvoice(doc)).xml).paymentTerms).toBe(entry.de);
    });
  }

  it("fordert beim positiven Storno einer Korrektur keine Zahlung des Belegbetrags", () => {
    const doc = { ...sampleDocument({ kind: "storno" }), customerBalance: 0 };
    doc.totals = { ...doc.totals, gross: Math.abs(doc.totals.gross) };
    expect(pdfData(doc).payment).toBe(cases[2].de);
  });
});
