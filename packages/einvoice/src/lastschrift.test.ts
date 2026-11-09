import { describe, expect, it } from "vitest";
import { pdfData } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import type { InvoiceDocument } from "./types.ts";
import { validateForFormat } from "./validate.ts";
import { buildEInvoice } from "./xml.ts";

/*
 * Rechnung, die per SEPA-Lastschrift eingezogen wird (#445). Der Hinweis auf der Rechnung ist die Vorabankündigung
 * (Pre-notification) mit Betrag und Fälligkeit (SDD Core Rulebook v1.2, PT-04.02; Clarification Paper EPC132-17 v5.1,
 * Kap. 2.6: auch als Teil der Rechnung). Im XML Zahlungsart 59 (UNTDID 4461 „SEPA direct debit“) mit BT-89, BT-90 und
 * BT-91 (XRechnung BR-DE-25-a/b, BR-DE-30, BR-DE-31).
 */
const directDebit = {
  mandateReference: "KD-1042-01",
  creditorId: "DE98ZZZ09999999999",
  debtorIban: "DE02120300000000202051",
  collectionDate: "2026-11-30",
};
const doc = (overrides: Partial<InvoiceDocument> = {}): InvoiceDocument => ({ ...sampleDocument(), directDebit, ...overrides });

describe("Lastschrift auf der Rechnung", () => {
  it("kündigt Einzug, Betrag, Mandat und Gläubiger-ID an, statt zur Überweisung aufzufordern", () => {
    const d = doc();
    const { payment } = pdfData(d);
    expect(payment).toContain("Den Betrag von");
    expect(payment).toContain("ziehen wir am 30.11.2026 per SEPA-Lastschrift von Ihrem Konto DE02 1203 0000 0000 2020 51 ein");
    expect(payment).toContain("Mandatsreferenz KD-1042-01");
    expect(payment).toContain("Gläubiger-ID DE98ZZZ09999999999");
    expect(payment).not.toContain("Bitte überweisen Sie den Betrag bis");
    expect(payment).toContain("überweisen Sie den Betrag nicht");
  });

  it("auf Englisch", () => {
    const { payment } = pdfData(doc({ language: "en" }));
    expect(payment).toContain("will be collected by SEPA direct debit on 30 Nov 2026 from your account DE02 1203 0000 0000 2020 51");
    expect(payment).toContain("mandate reference KD-1042-01");
    expect(payment).toContain("creditor identifier DE98ZZZ09999999999");
  });

  it("ohne GiroCode: der Kunde soll nicht zusätzlich überweisen", () => {
    expect(pdfData(doc()).qr).toBeNull();
    expect(pdfData(sampleDocument()).qr).not.toBeNull();
  });

  it("CII: Zahlungsart 59 mit Mandat, Gläubiger-ID und Konto des Kunden, ohne Konto des Verkäufers", async () => {
    for (const format of ["xrechnung-cii", "zugferd"] as const) {
      const { xml } = await buildEInvoice(doc({ format }));
      expect(xml).toContain("<ram:CreditorReferenceID>DE98ZZZ09999999999</ram:CreditorReferenceID>");
      expect(xml).toMatch(/<ram:SpecifiedTradeSettlementPaymentMeans>\s*<ram:TypeCode>59<\/ram:TypeCode>/);
      expect(xml).toMatch(/<ram:PayerPartyDebtorFinancialAccount>\s*<ram:IBANID>DE02120300000000202051<\/ram:IBANID>/);
      expect(xml).toContain("<ram:DirectDebitMandateID>KD-1042-01</ram:DirectDebitMandateID>");
      // BR-DE-25-b: mit Lastschrift weder Überweisung (BG-17) noch Karte (BG-18)
      expect(xml).not.toContain("PayeePartyCreditorFinancialAccount");
      // Zahlungsbedingungen (BT-20): die Vorabankündigung statt „Zahlbar ohne Abzug“
      expect(xml).toMatch(/<ram:Description>Den Betrag von [^<]+ ziehen wir am 30\.11\.2026 per SEPA-Lastschrift/);
    }
  });

  it("UBL: PaymentMeansCode 59 mit PaymentMandate und Gläubiger-ID als Kennung des Verkäufers (schemeID SEPA)", async () => {
    const { xml } = await buildEInvoice(doc({ format: "xrechnung-ubl" }));
    expect(xml).toContain("<cbc:PaymentMeansCode>59</cbc:PaymentMeansCode>");
    expect(xml).toMatch(/<cac:PaymentMandate>\s*<cbc:ID>KD-1042-01<\/cbc:ID>\s*<cac:PayerFinancialAccount>\s*<cbc:ID>DE02120300000000202051<\/cbc:ID>/);
    expect(xml).toContain('<cbc:ID schemeID="SEPA">DE98ZZZ09999999999</cbc:ID>');
    expect(xml).not.toContain("PayeeFinancialAccount");
  });

  it("die Prüfung vor dem Festschreiben bleibt ohne Befund", () => {
    for (const format of ["xrechnung-cii", "xrechnung-ubl", "zugferd"] as const) expect(validateForFormat(doc({ format }))).toEqual([]);
  });
});
