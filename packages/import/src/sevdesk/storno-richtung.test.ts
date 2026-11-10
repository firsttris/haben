import { describe, expect, it } from "vitest";
import { mapSevCreditNote, mapSevInvoice } from "./map.ts";
import type { SevCreditNote, SevDocumentPos, SevInvoice } from "./types.ts";

/*
 * Review #528: Die Richtung der Positionen kommt allein aus der Netto-Summe. docs/sevdesk.md: Der Kopf ist maßgeblich, die
 * Stornorechnung und die Gutschrift sind negativ, die Aufteilung nach Steuersatz kommt aus den Positionen. Beträge erfunden.
 */

const pos = (sumNet: string, sumTax: string, sumGross: string, taxRate: string) => ({ sumNet, sumTax, sumGross, taxRate }) as unknown as SevDocumentPos;

const head = { invoiceDate: "2025-03-10", status: "1000", paidAmount: 0, payDate: null, id: "12", invoiceNumber: "SR-1", invoiceType: "SR" };
const storno = (sumNet: string, sumTax: string, sumGross: string) => ({ ...head, sumNet, sumTax, sumGross }) as unknown as SevInvoice;
const gutschrift = (sumNet: string, sumTax: string, sumGross: string) =>
  ({
    status: "1000",
    paidAmount: 0,
    payDate: null,
    id: "21",
    creditNoteDate: "2025-03-10",
    creditNoteNumber: "GS-1",
    sumNet,
    sumTax,
    sumGross,
  }) as unknown as SevCreditNote;

describe("Richtung der Positionen bei Netto-Summe null", () => {
  const positionen = [pos("100.00", "19.00", "119.00", "19"), pos("-100.00", "-7.00", "-107.00", "7")];
  const gespiegelt = [
    { rate: 1900, net: -10_000, tax: -1_900 },
    { rate: 700, net: 10_000, tax: 700 },
  ];

  it("Stornorechnung: positive Positionen, die sich netto aufheben, werden gespiegelt", () => {
    expect(mapSevInvoice(storno("0.00", "12.00", "12.00"), positionen).voucher.taxes).toEqual(gespiegelt);
  });

  it("Gutschrift: positive Positionen, die sich netto aufheben, werden gespiegelt", () => {
    expect(mapSevCreditNote(gutschrift("0.00", "12.00", "12.00"), positionen).voucher.taxes).toEqual(gespiegelt);
  });

  it("Stornorechnung: Positionen nur mit Steuer behalten die Steuer je Satz negativ", () => {
    const nurSteuer = [pos("0.00", "19.00", "19.00", "19"), pos("0.00", "7.00", "7.00", "7")];
    expect(mapSevInvoice(storno("0.00", "26.00", "26.00"), nurSteuer).voucher.taxes).toEqual([
      { rate: 1900, net: 0, tax: -1_900 },
      { rate: 700, net: 0, tax: -700 },
    ]);
  });
});

describe("Richtung der Positionen, wenn Netto und Brutto verschiedene Vorzeichen haben", () => {
  const gespiegelt = [
    { rate: 1900, net: -10_000, tax: -1_900 },
    { rate: 0, net: 10_100, tax: 0 },
  ];

  it("Stornorechnung: schon negative Positionen bleiben, auch wenn netto ein Plus steht", () => {
    const positionen = [pos("-100.00", "-19.00", "-119.00", "19"), pos("101.00", "0.00", "101.00", "0")];
    expect(mapSevInvoice(storno("1.00", "-19.00", "-18.00"), positionen).voucher.taxes).toEqual(gespiegelt);
  });

  it("Stornorechnung: positive Positionen werden gedreht, auch wenn netto ein Minus steht", () => {
    const positionen = [pos("100.00", "19.00", "119.00", "19"), pos("-101.00", "0.00", "-101.00", "0")];
    expect(mapSevInvoice(storno("-1.00", "19.00", "18.00"), positionen).voucher.taxes).toEqual(gespiegelt);
  });
});
