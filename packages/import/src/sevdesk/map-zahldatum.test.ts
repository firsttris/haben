import { describe, expect, it } from "vitest";
import { mapSevInvoice } from "./map.ts";
import { sevInvoiceSchema } from "./types.ts";

// Review #348: payDate ist das Datum der vollständigen Zahlung in sevDesk – wie paidDate bei Lexoffice
// (packages/import/src/lexoffice/web/convert.ts: paidDate = letztes Zahldatum, wenn ausgeglichen).
describe("sevDesk-Zahldatum", () => {
  it("behält payDate einer ausgeglichenen Rechnung als paidDate (Archiv-Export, Spalte „bezahlt am“)", () => {
    const raw = sevInvoiceSchema.parse({
      id: "101",
      objectName: "Invoice",
      invoiceNumber: "RE-1001",
      invoiceDate: "2024-03-05T00:00:00+01:00",
      status: "1000",
      invoiceType: "RE",
      currency: "EUR",
      sumNet: "200.00",
      sumTax: "26.00",
      sumGross: "226.00",
      paidAmount: 226,
      payDate: "2024-03-12T10:22:00+01:00",
    });
    expect(mapSevInvoice(raw, []).payment.paidDate).toBe("2024-03-12");
  });
});
