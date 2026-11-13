import { describe, expect, it } from "vitest";
import { parseEInvoiceXml } from "./incoming.ts";
import { pdfData } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";

const cases = [
  {
    name: "Sollsaldo",
    balance: 50,
    de: "Nach dieser Stornierung übersteigen die offenen Rechnungsbeträge rechnerisch Ihr Guthaben.",
    en: "After this cancellation, the calculated outstanding invoice amounts exceed your credits.",
  },
  {
    name: "Habensaldo",
    balance: -50,
    de: "Nach dieser Stornierung verbleibt rechnerisch ein Guthaben zu Ihren Gunsten.",
    en: "After this cancellation, the calculated balance is a credit in your favour.",
  },
  {
    name: "Nullsaldo",
    balance: 0,
    de: "Nach dieser Stornierung ist der Saldo Ihrer offenen Rechnungen und Gutschriften rechnerisch ausgeglichen.",
    en: "After this cancellation, the calculated balance of your open invoices and credits is zero.",
  },
  { name: "unbekannter Saldo", balance: undefined, de: "Die ursprüngliche Rechnung wird storniert.", en: "The original invoice is cancelled." },
] as const;

describe("Saldoabhängiger Stornohinweis ohne Erstattungszusage", () => {
  for (const entry of cases) {
    it.each(["de", "en"] as const)(`${entry.name}: PDF auf %s`, (language) => {
      const doc = { ...sampleDocument({ kind: "storno" }), customerBalance: entry.balance, hasPayments: true, language };
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
