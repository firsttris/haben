import { dunningAmounts } from "@haben/core";
import { describe, expect, it } from "vitest";
import { dunningPdfData, type DunningDocument } from "./dunning.ts";
import { sampleBuyer, sampleSeller } from "./samples.ts";

const doc: DunningDocument = {
  level: 2,
  date: "2026-10-16",
  dueDate: "2026-10-26",
  seller: { ...sampleSeller, kontoinhaber: "Beispiel Kontoinhaber" },
  buyer: sampleBuyer,
  invoice: { number: "2026-034", issueDate: "2026-09-02", dueDate: "2026-09-16", gross: 30000 },
  amounts: dunningAmounts({ open: 20000, dueDate: "2026-09-16", date: "2026-10-16", fee: 5000, flatFee: true, interestRate: 1027 }),
  intro: "Bitte zahlen.",
  closing: "Vielen Dank.",
  payments: [
    { date: "2026-09-10", amount: 10000, via: "bank", text: "Teilzahlung", reversed: false },
    { date: "2026-09-11", amount: 5000, via: "bar", text: "Aufgehobene Zahlung", reversed: true },
  ],
};

describe("Strukturierte Daten für eigene Mahnvorlagen", () => {
  it("liefert Zahlungsanweisung und Bankdaten aus denselben Werten wie Gesamtbetrag und Girocode", () => {
    const data = dunningPdfData(doc);
    expect(data.paymentDetails).toEqual({
      amount: data.total.value,
      dueDate: "26.10.2026",
      reference: "Rechnung 2026-034",
      accountHolder: "Beispiel Kontoinhaber",
      bank: sampleSeller.bank,
      iban: "DE89 3704 0044 0532 0130 00",
      bic: sampleSeller.bic,
    });
    expect(data.payment).toContain(data.paymentDetails.amount);
    expect(data.payment).toContain(data.paymentDetails.dueDate);
  });

  it("gibt Zahlungen einzeln aus und kennzeichnet eine Aufhebung ohne wirksame Forderungsminderung", () => {
    expect(dunningPdfData(doc).paymentHistory).toEqual([
      { date: "10.09.2026", amount: "100,00 €", effect: "-100,00 €", method: "Bank", note: "Teilzahlung", reversed: false },
      { date: "11.09.2026", amount: "50,00 €", effect: null, method: "Bar", note: "Aufgehobene Zahlung", reversed: true },
    ]);
  });

  it("stellt die bereits berechneten Forderungsbestandteile ohne neue Berechnung bereit", () => {
    const data = dunningPdfData(doc);
    expect(data.claimDetails).toEqual({
      originalAmount: "300,00 €",
      openAmount: "200,00 €",
      fee: "10,00 €",
      flatFee: "40,00 €",
      interest: data.rows.at(-1)!.value,
      interestRate: "10,27 %",
      interestDays: "30",
      invoiceDueDate: "16.09.2026",
      calculatedOn: "16.10.2026",
    });
  });

  it("erfindet weder Bankdaten noch Zahlungshistorie für ältere Aufrufer", () => {
    const data = dunningPdfData({
      ...doc,
      seller: { ...sampleSeller, iban: "", bic: "", bank: "" },
      invoice: { number: "2026-034", issueDate: "2026-09-02", dueDate: "2026-09-16" },
      payments: undefined,
    });
    expect(data.paymentDetails).toMatchObject({ iban: "", bic: "", bank: "", accountHolder: sampleSeller.name });
    expect(data.paymentHistory).toEqual([]);
    expect(data.claimDetails.originalAmount).toBeNull();
    expect(data.qr).toBeNull();
  });

  it("kennzeichnet nicht angesetzte Gebühren und Zinsen mit null", () => {
    const data = dunningPdfData({
      ...doc,
      amounts: dunningAmounts({ open: 20000, dueDate: "2026-09-16", date: "2026-10-16", fee: 0, flatFee: false, interestRate: null }),
    });
    expect(data.claimDetails).toMatchObject({ fee: null, flatFee: null, interest: null, interestRate: null, interestDays: "0" });
    expect(data.paymentDetails.amount).toBe("200,00 €");
  });
});
