import { describe, expect, it } from "vitest";
import { mapSevCreditNote, mapSevInvoice } from "./map.ts";
import type { SevCreditNote, SevDocumentPos, SevInvoice } from "./types.ts";

/* docs/sevdesk.md: Die Aufteilung nach Steuersatz kommt aus den Positionen. Heben sie sich brutto auf, zeigt die Steuer die Richtung. Beträge erfunden. */

const pos = (sumNet: string, sumTax: string, sumGross: string, taxRate: string) => ({ sumNet, sumTax, sumGross, taxRate }) as unknown as SevDocumentPos;

const storno = {
  invoiceDate: "2025-03-10",
  status: "1000",
  paidAmount: 0,
  payDate: null,
  id: "12",
  invoiceNumber: "X-1",
  invoiceType: "SR",
  sumNet: "-19.00",
  sumTax: "19.00",
  sumGross: "0.00",
} as unknown as SevInvoice;

const gutschrift = {
  status: "1000",
  paidAmount: 0,
  payDate: null,
  id: "21",
  creditNoteDate: "2025-03-10",
  creditNoteNumber: "GS-1",
  sumNet: "-19.00",
  sumTax: "19.00",
  sumGross: "0.00",
} as unknown as SevCreditNote;

const positiv = [pos("100.00", "19.00", "119.00", "19"), pos("-119.00", "0.00", "-119.00", "0")];
const negativ = [pos("-100.00", "-19.00", "-119.00", "19"), pos("119.00", "0.00", "119.00", "0")];

const gespiegelt = [
  { rate: 1900, net: -10_000, tax: -1_900 },
  { rate: 0, net: 11_900, tax: 0 },
];

describe("Positionen, deren Brutto-Summe null ist", () => {
  it("spiegelt positiv gelieferte Positionen einer Stornorechnung", () => {
    expect(mapSevInvoice(storno, positiv).voucher.taxes).toEqual(gespiegelt);
  });

  it("spiegelt positiv gelieferte Positionen einer Gutschrift", () => {
    expect(mapSevCreditNote(gutschrift, positiv).voucher.taxes).toEqual(gespiegelt);
  });

  it("lässt schon negativ gelieferte Positionen stehen", () => {
    expect(mapSevInvoice(storno, negativ).voucher.taxes).toEqual(gespiegelt);
    expect(mapSevCreditNote(gutschrift, negativ).voucher.taxes).toEqual(gespiegelt);
  });
});
