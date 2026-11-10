import { describe, expect, it } from "vitest";
import { mapSevInvoice } from "./map.ts";
import type { SevDocumentPos, SevInvoice } from "./types.ts";

/*
 * test-fixtures/sevdesk/buchhaltung-1.0/storno-paar.json: Die Stornorechnung trägt Positionen mit beiden Vorzeichen
 * (README dort: „Vorzeichen und Null bleiben“). docs/sevdesk.md: Die Aufteilung nach Steuersatz kommt aus den Positionen,
 * und „im Umsatz heben sie sich auf“. Beträge erfunden.
 */

const pos = (sumNet: string, sumTax: string, sumGross: string, taxRate: string) => ({ sumNet, sumTax, sumGross, taxRate }) as unknown as SevDocumentPos;

const head = { invoiceDate: "2025-03-10", status: "1000", paidAmount: 0, payDate: null };

const rechnung = {
  invoice: { ...head, id: "11", invoiceNumber: "RE-1", invoiceType: "RE", sumNet: "1300.00", sumTax: "211.00", sumGross: "1511.00" } as unknown as SevInvoice,
  positions: [pos("1000.00", "190.00", "1190.00", "19"), pos("500.00", "35.00", "535.00", "7"), pos("-200.00", "-14.00", "-214.00", "7")],
};

const storno = {
  invoice: {
    ...head,
    id: "12",
    invoiceNumber: "RE-2",
    invoiceType: "SR",
    sumNet: "-1300.00",
    sumTax: "-211.00",
    sumGross: "-1511.00",
  } as unknown as SevInvoice,
  positions: [pos("-1000.00", "-190.00", "-1190.00", "19"), pos("-500.00", "-35.00", "-535.00", "7"), pos("200.00", "14.00", "214.00", "7")],
};

describe("Stornorechnung mit Positionen beider Vorzeichen", () => {
  it("spiegelt die Aufteilung der Rechnung je Steuersatz, auch bei einer Rabattzeile", () => {
    const original = mapSevInvoice(rechnung.invoice, rechnung.positions).voucher.taxes;
    expect(original).toEqual([
      { rate: 1900, net: 100_000, tax: 19_000 },
      { rate: 700, net: 30_000, tax: 2_100 },
    ]);
    expect(mapSevInvoice(storno.invoice, storno.positions).voucher.taxes).toEqual([
      { rate: 1900, net: -100_000, tax: -19_000 },
      { rate: 700, net: -30_000, tax: -2_100 },
    ]);
  });

  it("erkennt die Richtung an der Summe, wenn eine positiv gelieferte Stornorechnung eine Rabattzeile hat", () => {
    const positiv = { ...storno.invoice, sumNet: "1300.00", sumTax: "187.00", sumGross: "1487.00" } as SevInvoice;
    const positionen = [pos("1000.00", "190.00", "1190.00", "19"), pos("500.00", "35.00", "535.00", "7"), pos("-200.00", "-38.00", "-238.00", "19")];
    expect(mapSevInvoice(positiv, positionen).voucher.taxes).toEqual([
      { rate: 1900, net: -80_000, tax: -15_200 },
      { rate: 700, net: -50_000, tax: -3_500 },
    ]);
  });

  it("dreht die Vorzeichen um, wenn sevDesk alle Positionen positiv liefert", () => {
    const positiv = { ...storno.invoice, sumNet: "1300.00", sumTax: "211.00", sumGross: "1511.00" } as SevInvoice;
    expect(mapSevInvoice(positiv, [pos("1000.00", "190.00", "1190.00", "19"), pos("300.00", "21.00", "321.00", "7")]).voucher.taxes).toEqual([
      { rate: 1900, net: -100_000, tax: -19_000 },
      { rate: 700, net: -30_000, tax: -2_100 },
    ]);
  });
});
