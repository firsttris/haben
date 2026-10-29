import { describe, expect, it } from "vitest";
import { sampleDocument } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";

// In XML 1.0 unzulässige Zeichen (Char-Produktion): C0-Steuerzeichen außer Tab/LF/CR, U+FFFE, U+FFFF
const FORBIDDEN_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

describe("buildEInvoice (Review)", () => {
  it.each(["xrechnung-ubl", "xrechnung-cii", "zugferd"] as const)(
    "erzeugt wohlgeformtes XML, auch wenn Freitext Steuerzeichen enthält (%s)",
    async (format) => {
      // z. B. aus Word kopiert: vertikaler Tab als Zeilenumbruch
      const doc = sampleDocument({ format, note: "Zeile eins\u000BZeile zwei" });
      doc.lines[0]!.description = "Konzept\u000BUmsetzung";
      const { xml } = await buildEInvoice(doc);
      expect(xml).not.toMatch(FORBIDDEN_XML_CHARS);
    },
  );

  it("XRechnung ohne Zahlbetrag und ohne IBAN enthält trotzdem Zahlungsanweisungen (BG-16, BR-DE-1)", async () => {
    const doc = sampleDocument({
      format: "xrechnung-ubl",
      lines: [
        { description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice: 100000, taxRate: 1900 },
        { description: "Abzüglich Abschlag", quantity: 1000, unit: "Psch.", unitPrice: -100000, taxRate: 1900 },
      ],
    });
    doc.variant = "schluss";
    doc.seller = { ...doc.seller, iban: undefined, bic: undefined };
    expect(doc.totals.gross).toBe(0);
    const { xml } = await buildEInvoice(doc);
    expect(xml).toContain("<cac:PaymentMeans>");
  });
});
