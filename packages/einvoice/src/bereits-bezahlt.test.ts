import { describe, expect, it } from "vitest";
import { pdfData } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import { validateForFormat } from "./validate.ts";
import { buildEInvoice } from "./xml.ts";

const paidPayment = { paidVia: "eBay", paidOn: "2026-10-01" };

describe("Bereits bezahlte Rechnung (#1056)", () => {
  it("nennt die bereits erfolgte Zahlung auch auf Englisch und zeigt weder GiroCode noch IBAN", () => {
    const de = pdfData({ ...sampleDocument(), paidPayment });
    const en = pdfData({ ...sampleDocument(), paidPayment, language: "en" });
    expect(de.payment).toBe("Der Betrag wurde am 01.10.2026 über eBay bezahlt.");
    expect(en.payment).toBe("The amount was paid via eBay on 1 Oct 2026.");
    expect(de.qr).toBeNull();
    expect(de.footer.flat().join(" ")).not.toContain("IBAN");
    expect(pdfData({ ...sampleDocument(), paidPayment: { ...paidPayment, paidVia: "bar" } }).payment).toContain("bar bezahlt.");
  });

  it.each(["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const)("weist in %s den vollen Betrag als gezahlt aus", async (format) => {
    const doc = { ...sampleDocument({ format }), paidPayment };
    expect(validateForFormat({ ...doc, seller: { ...doc.seller, iban: "" } })).toEqual([]);
    const { xml } = await buildEInvoice(doc);
    const gross = "17409.58";
    if (format === "xrechnung-ubl") {
      expect(xml).toContain(`<cbc:PrepaidAmount currencyID="EUR">${gross}</cbc:PrepaidAmount>`);
      expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">0.00</cbc:PayableAmount>');
      expect(xml).toContain("<cbc:PaymentMeansCode>68</cbc:PaymentMeansCode>");
    } else {
      expect(xml).toContain(`<ram:TotalPrepaidAmount>${gross}</ram:TotalPrepaidAmount>`);
      expect(xml).toContain("<ram:DuePayableAmount>0.00</ram:DuePayableAmount>");
      expect(xml).toContain("<ram:TypeCode>68</ram:TypeCode>");
    }
    expect(xml).not.toMatch(/DueDate|PaymentTerms|FinancialAccount/);
  });
});
