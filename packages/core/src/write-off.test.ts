import { describe, expect, it } from "vitest";
import { computeInvoiceTotals } from "./invoice.ts";
import {
  documentPaymentPosting,
  documentWriteOffPosting,
  exchangeDifferenceBankPosting,
  exchangeDifferencePosting,
  invoicePaymentPosting,
  invoicePosting,
  invoiceWriteOffPosting,
  type PostingLine,
} from "./posting.ts";

/** Saldo je Konto (Soll − Haben) über mehrere Buchungen */
function balances(...postings: PostingLine[][]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of postings.flat()) result[line.account] = (result[line.account] ?? 0) + line.debit - line.credit;
  for (const [account, value] of Object.entries(result)) if (value === 0) delete result[account];
  return result;
}

// 100,00 € netto zu 19 %: 119,00 € brutto
const totals = computeInvoiceTotals([{ quantity: 1000, unitPrice: 10_000, taxRate: 1900 }]);

describe("invoiceWriteOffPosting", () => {
  it("Skonto bei Soll: Erlösschmälerung und fällige Umsatzsteuer gemindert, Forderung ausgeglichen", () => {
    const sale = invoicePosting(totals, "SKR03", "soll");
    const payment = invoicePaymentPosting(totals, 11_662, "SKR03", "soll");
    const skonto = invoiceWriteOffPosting("skonto", totals, 238, "SKR03", "soll");
    expect(skonto).toEqual([
      { account: "1400", debit: 0, credit: 238, taxCode: null },
      { account: "8730", debit: 200, credit: 0, taxCode: "USt19" },
      { account: "1776", debit: 38, credit: 0, taxCode: "USt19" },
    ]);
    // Forderung auf 0, Umsatzsteuer 19,00 − 0,38 = 18,62 = 19 % von 98,00
    expect(balances(sale, payment, skonto)).toEqual({ "1200": 11_662, "8400": -10_000, "8730": 200, "1776": -1_862 });
  });

  it("Skonto bei Ist: gemindert wird die nicht fällige Umsatzsteuer, fällig wird nur der bezahlte Teil", () => {
    const sale = invoicePosting(totals, "SKR03", "ist");
    const payment = invoicePaymentPosting(totals, 11_662, "SKR03", "ist");
    const skonto = invoiceWriteOffPosting("skonto", totals, 238, "SKR03", "ist");
    expect(balances(sale, payment, skonto)).toEqual({ "1200": 11_662, "8400": -10_000, "8730": 200, "1776": -1_862 });
  });

  it("Forderungsausfall in voller Höhe auf das Forderungsverlustkonto, SKR04", () => {
    const sale = invoicePosting(totals, "SKR04", "soll");
    const loss = invoiceWriteOffPosting("forderungsausfall", totals, 11_900, "SKR04", "soll");
    expect(balances(sale, loss)).toEqual({ "4400": -10_000, "6930": 10_000 });
  });

  it("ohne Umsatzsteuer (Kleinunternehmer) nur die Erlösschmälerung", () => {
    const ku = computeInvoiceTotals([{ quantity: 1000, unitPrice: 10_000, taxRate: 0 }]);
    expect(invoiceWriteOffPosting("skonto", ku, 200, "SKR03", "ist", "kleinunternehmer")).toEqual([
      { account: "1400", debit: 0, credit: 200, taxCode: null },
      { account: "8730", debit: 200, credit: 0, taxCode: "KU" },
    ]);
  });
});

describe("documentWriteOffPosting", () => {
  it("erhaltenes Skonto mindert Vorsteuer anteilig", () => {
    expect(documentWriteOffPosting(totals, -238, "SKR03", true)).toEqual([
      { account: "1600", debit: 238, credit: 0, taxCode: null },
      { account: "3730", debit: 0, credit: 200, taxCode: "VSt19" },
      { account: "1576", debit: 0, credit: 38, taxCode: "VSt19" },
    ]);
  });

  it("ohne Vorsteuerabzug mindert das Skonto den Aufwand brutto", () => {
    expect(documentWriteOffPosting(totals, -238, "SKR04", false)).toEqual([
      { account: "3300", debit: 238, credit: 0, taxCode: null },
      { account: "5730", debit: 0, credit: 238, taxCode: "keineVSt" },
    ]);
  });
});

describe("exchangeDifferencePosting", () => {
  it("Rechnung bei Ist: Kursverlust als Aufwand, Forderung ausgeglichen, die Umsatzsteuer wird voll fällig", () => {
    const sale = invoicePosting(totals, "SKR03", "ist");
    // Der Kunde zahlt umgerechnet 115,00 € statt 119,00 €
    const payment = invoicePaymentPosting(totals, 11_500, "SKR03", "ist");
    const difference = exchangeDifferencePosting({ kind: "invoice", totals, versteuerung: "ist" }, 400, "SKR03");
    expect(balances(sale, payment, difference)).toEqual({ "1200": 11_500, "2150": 400, "8400": -10_000, "1776": -1900 });
  });

  it("Rechnung, mehr erhalten: der Überschuss ist Ertrag aus Kursdifferenzen, die Umsatzsteuer bleibt", () => {
    const sale = invoicePosting(totals, "SKR04", "soll");
    const payment = invoicePaymentPosting(totals, 11_900, "SKR04", "soll");
    const extra = exchangeDifferenceBankPosting(150, "SKR04");
    expect(balances(sale, payment, extra)).toEqual({ "1800": 12_050, "4840": -150, "4400": -10_000, "3806": -1900 });
  });

  it("Beleg: weniger gezahlt ist Ertrag, mehr gezahlt Aufwand", () => {
    const less = exchangeDifferencePosting({ kind: "document" }, -300, "SKR03");
    expect(balances(documentPaymentPosting(-11_600, "SKR03"), less)).toEqual({ "1600": 11_900, "1200": -11_600, "2660": -300 });
    expect(balances(exchangeDifferenceBankPosting(-200, "SKR03"))).toEqual({ "1200": -200, "2150": 200 });
  });
});
