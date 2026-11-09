import { describe, expect, it } from "vitest";
import { mapSevCreditNote } from "./map.ts";
import type { SevCreditNote, SevDocumentPos } from "./types.ts";

/* docs/sevdesk.md: Die Aufteilung nach Steuersatz kommt aus den Positionen und muss zur Summe des Belegs passen. Beträge erfunden. */

const pos = (sumNet: string, sumTax: string, sumGross: string, taxRate: string) => ({ sumNet, sumTax, sumGross, taxRate }) as unknown as SevDocumentPos;

const gutschrift = {
  status: "1000",
  paidAmount: 0,
  payDate: null,
  id: "21",
  creditNoteDate: "2025-03-10",
  creditNoteNumber: "GS-1",
  sumNet: "1300.00",
  sumTax: "211.00",
  sumGross: "1511.00",
} as unknown as SevCreditNote;

const gespiegelt = [
  { rate: 1900, net: -100_000, tax: -19_000 },
  { rate: 700, net: -30_000, tax: -2_100 },
];

describe("Gutschrift mit Rabattzeile", () => {
  it("behält die Rabattzeile als Minderung, wenn die Positionen positiv stehen", () => {
    const positionen = [pos("1000.00", "190.00", "1190.00", "19"), pos("500.00", "35.00", "535.00", "7"), pos("-200.00", "-14.00", "-214.00", "7")];
    expect(mapSevCreditNote(gutschrift, positionen).voucher.taxes).toEqual(gespiegelt);
  });

  it("behält die Rabattzeile als Minderung, wenn die Positionen schon negativ stehen", () => {
    const positionen = [pos("-1000.00", "-190.00", "-1190.00", "19"), pos("-500.00", "-35.00", "-535.00", "7"), pos("200.00", "14.00", "214.00", "7")];
    expect(mapSevCreditNote(gutschrift, positionen).voucher.taxes).toEqual(gespiegelt);
  });
});
