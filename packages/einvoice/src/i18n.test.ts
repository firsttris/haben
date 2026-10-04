import { describe, expect, it } from "vitest";
import { pdfData, renderInvoicePdf } from "./pdf.ts";
import { quotePdfData } from "./quote.ts";
import { sampleDocument } from "./samples.ts";

describe("Belege auf Englisch", () => {
  it("übersetzt Titel, Felder, Beträge, Einheiten und Zahlungssatz", () => {
    const doc = { ...sampleDocument({ taxTreatment: "reverse_charge" }), language: "en" as const };
    doc.buyer = { ...doc.buyer, land: "GB", ustId: "GB123456789" };
    const data = pdfData(doc);
    expect(data.title).toBe("Invoice");
    expect(data.meta).toEqual(
      expect.arrayContaining([
        { label: "Invoice number", value: "2026-034" },
        { label: "Invoice date", value: "2 Oct 2026" },
        { label: "Service period", value: "1 Sept 2026 – 30 Sept 2026" },
        { label: "Your VAT ID", value: "GB123456789" },
      ]),
    );
    expect(data.recipient.at(-1)).toBe("UNITED KINGDOM");
    expect(data.lines[0]).toMatchObject({ quantity: "152 hrs", unitPrice: "€95.00", net: "€14,440.00", rate: "–" });
    expect(data.lines[1]).toMatchObject({ quantity: "1 flat rate" });
    expect(data.totals.rows).toEqual([{ label: "Total net", value: "€14,629.90" }]);
    expect(data.totals.gross.label).toBe("Total amount");
    expect(data.payment).toBe("Please transfer the amount by 16 Oct 2026, quoting the invoice number.");
    expect(data.taxNote).toBe("Reverse charge: VAT liability of the recipient (Art. 196 VAT Directive).");
    expect(data.labels).toEqual({
      columns: { pos: "No.", description: "Description", quantity: "Qty", unitPrice: "Unit price", vat: "VAT", net: "Net" },
      page: ["Page", "of", ""],
    });
    expect(data.footer[0]).toContain("Phone +49 30 1234567");
    expect(data.footer[2]).toEqual(["Tax number 13/345/67890", "VAT ID DE123456789"]);
    expect(renderInvoicePdf(doc).byteLength).toBeGreaterThan(5000);
  });

  it("übersetzt Angebote und behält Deutsch als Vorgabe", () => {
    const { seller, buyer, lines, totals } = sampleDocument();
    const quote = { number: "AN-2026-007", issueDate: "2026-10-01", validUntil: "2026-10-31", seller, buyer, lines, totals };
    expect(quotePdfData({ ...quote, language: "en" })).toMatchObject({ title: "Quote", payment: "This quote is valid until 31 Oct 2026. We look forward to your order." });
    expect(quotePdfData(quote).labels.columns.pos).toBe("Pos.");
    expect(pdfData(sampleDocument()).labels.page).toEqual(["Seite", "von", ""]);
  });
});
