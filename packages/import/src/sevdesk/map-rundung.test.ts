import { describe, expect, it } from "vitest";
import { mapSevInvoice } from "./map.ts";

describe("mapSevInvoice Steuersätze", () => {
  // sevDesk rundet die Steuer im Kopf je Steuersatz auf die Summe, in den Positionen je Position.
  // Zwei 19-%-Positionen zu 1,03 € netto: je 0,20 € Steuer (0,1957), im Kopf 0,39 € (2,06 × 0,19 = 0,3914).
  // Dazu eine steuerfreie Position über 10,00 €.
  it("schiebt die Rundungsdifferenz der Steuer nicht in den 0-%-Satz", () => {
    const { voucher } = mapSevInvoice(
      {
        id: "1",
        invoiceNumber: "RE-1",
        invoiceDate: "2024-01-10",
        status: "200",
        invoiceType: "RE",
        sumNet: "12.06",
        sumTax: "0.39",
        sumGross: "12.45",
        paidAmount: 0,
      },
      [
        { id: 1, taxRate: "19", sumNet: "1.03", sumTax: "0.20", sumGross: "1.23" },
        { id: 2, taxRate: "19", sumNet: "1.03", sumTax: "0.20", sumGross: "1.23" },
        { id: 3, taxRate: "0", sumNet: "10.00", sumTax: "0", sumGross: "10.00" },
      ],
    );
    expect(voucher.tax).toBe(39);
    const zero = voucher.taxes.find((t) => t.rate === 0);
    const full = voucher.taxes.find((t) => t.rate === 1900);
    expect({ zero, full }).toEqual({
      zero: { rate: 0, net: 1000, tax: 0 },
      full: { rate: 1900, net: 206, tax: 39 },
    });
  });
});
