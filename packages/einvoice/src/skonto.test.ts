import { parseSkontoTerms } from "@haben/core";
import { describe, expect, it } from "vitest";
import { parseEInvoiceXml } from "./incoming.ts";
import { pdfData, renderInvoicePdf } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";

// Beispielrechnung vom 02.10.2026 über 17.409,58 €, fällig am 16.10.2026 (14 Tage)
const skonto = [
  { days: 10, percent: 200 },
  { days: 14, percent: 100 },
];

/** Ausdruck XR-SKONTO-REGEX aus itplr-kosit/xrechnung-schematron (common.sch) */
const XR_SKONTO_REGEX = /(^|\r?\n)#(SKONTO)#TAGE=([0-9]+#PROZENT=[0-9]+\.[0-9]{2})(#BASISBETRAG=-?[0-9]+\.[0-9]{2})?#$/;

/** BR-DE-18 wie im Schematron: jede Zeile mit # passt, und nach der letzten Skontozeile folgt ein Zeilenumbruch */
function satisfiesBrDe18(terms: string): boolean {
  const lines = terms.split(/\r?\n/).filter((line) => line.trim().startsWith("#"));
  const afterLast = terms.split(/#.+#/).at(-1) ?? "";
  return lines.every((line) => XR_SKONTO_REGEX.test(line.trim())) && /^\s*\n/.test(afterLast);
}

describe("Skonto auf der Ausgangsrechnung", () => {
  it("PDF: je Stufe Frist als Datum, Skontobetrag und Zahlbetrag unter dem Zahlungsziel", () => {
    const data = pdfData({ ...sampleDocument(), skonto });
    expect(data.payment).toBe(
      "Bitte überweisen Sie den Betrag bis zum 16.10.2026 unter Angabe der Rechnungsnummer. " +
        "Bei Zahlung bis zum 12.10.2026 gewähren wir 2 % Skonto (348,19 €); Sie überweisen dann 17.061,39 €. " +
        "Bei Zahlung bis zum 16.10.2026 gewähren wir 1 % Skonto (174,10 €); Sie überweisen dann 17.235,48 €.",
    );
    expect(pdfData({ ...sampleDocument(), skonto, language: "en" }).payment).toContain(
      "If paid by 12 Oct 2026, you may deduct a 2% cash discount (€348.19) and transfer €17,061.39.",
    );
    // GiroCode bleibt beim vollen Betrag: welches Skonto der Kunde nutzt, steht beim Erstellen nicht fest
    expect(data.qr).not.toBeNull();
    expect(renderInvoicePdf({ ...sampleDocument(), skonto }).subarray(0, 5)).toEqual(new TextEncoder().encode("%PDF-"));
  });

  it("druckt ohne Skonto das Zahlungsziel und beim Storno den passenden Zahlungssatz", () => {
    expect(pdfData(sampleDocument()).payment).toBe("Bitte überweisen Sie den Betrag bis zum 16.10.2026 unter Angabe der Rechnungsnummer.");
    expect(pdfData({ ...sampleDocument({ kind: "storno" }), skonto }).payment).toBe("Die ursprüngliche Rechnung wird storniert.");
    expect(pdfData({ ...sampleDocument({ kind: "storno" }), skonto, hasPayments: true }).payment).toBe("Die ursprüngliche Rechnung wird storniert.");
  });

  it.each(["xrechnung-ubl", "xrechnung-cii", "zugferd"] as const)(
    "E-Rechnung (%s): #SKONTO#-Zeilen in BT-20 nach BR-DE-18, danach der Text",
    async (format) => {
      const { xml } = await buildEInvoice({ ...sampleDocument({ format }), skonto });
      const terms = parseEInvoiceXml(xml).paymentTerms ?? "";
      expect(terms).toBe(
        "#SKONTO#TAGE=10#PROZENT=2.00#\n#SKONTO#TAGE=14#PROZENT=1.00#\n" +
          "Zahlbar ohne Abzug bis zum 16.10.2026 (14 Tage). " +
          "Bei Zahlung bis zum 12.10.2026 (10 Tage) 2 % Skonto, 348,19 €. " +
          "Bei Zahlung bis zum 16.10.2026 (14 Tage) 1 % Skonto, 174,10 €.",
      );
      expect(satisfiesBrDe18(terms)).toBe(true);
      // Haben liest das eigene Skonto als Eingangsrechnung wieder
      expect(parseSkontoTerms(terms)).toEqual(skonto);
    },
  );

  it("ohne Skonto keine #SKONTO#-Zeile; Storno bekommt keins", async () => {
    const plain = await buildEInvoice(sampleDocument({ format: "xrechnung-ubl" }));
    expect(plain.xml).not.toContain("#SKONTO#");
    const storno = await buildEInvoice({ ...sampleDocument({ kind: "storno", format: "xrechnung-ubl" }), skonto });
    expect(storno.xml).not.toContain("#SKONTO#");
  });

  it("die Prüfung im Test erkennt einen fehlenden Zeilenumbruch nach der letzten Skontozeile", () => {
    expect(satisfiesBrDe18("#SKONTO#TAGE=10#PROZENT=2.00#")).toBe(false);
    expect(satisfiesBrDe18("#SKONTO#TAGE=10#PROZENT=2#\n")).toBe(false);
    expect(satisfiesBrDe18("#SKONTO#TAGE=10#PROZENT=2.00#\nText")).toBe(true);
  });
});
