import { describe, expect, it } from "vitest";
import {
  firstByContact,
  isSevInvoiceImportable,
  isSevMainContact,
  isSevVoucherImportable,
  mapSevContact,
  mapSevCreditNote,
  mapSevInvoice,
  mapSevVoucher,
  sevNumber,
} from "./map.ts";
import { sevContactSchema, sevCreditNoteSchema, sevInvoiceSchema, sevVoucherSchema } from "./types.ts";

const invoice = (fields: Record<string, unknown>) =>
  sevInvoiceSchema.parse({
    id: "101",
    objectName: "Invoice",
    invoiceNumber: "RE-1001",
    contact: { id: "7", objectName: "Contact" },
    invoiceDate: "2024-03-05T00:00:00+01:00",
    timeToPay: "14",
    status: "1000",
    invoiceType: "RE",
    address: "Berliner Kindl GmbH\nHauptstr. 1\n10115 Berlin",
    currency: "EUR",
    sumNet: "200.00",
    sumTax: "26.00",
    sumGross: "226.00",
    paidAmount: 226,
    payDate: "2024-03-12T10:22:00+01:00",
    ...fields,
  });

describe("Grundbausteine", () => {
  it("liest Beträge als Text oder Zahl", () => {
    expect(sevNumber("119.00")).toBe(119);
    expect(sevNumber("19,5")).toBe(19.5);
    expect(sevNumber(7)).toBe(7);
    expect(sevNumber(null)).toBe(0);
    expect(sevNumber("kaputt")).toBe(0);
  });
});

describe("mapSevContact", () => {
  it("nimmt Firmennamen, sonst Vor- und Nachname, mit Adresse, Land und Haupt-E-Mail", () => {
    const org = sevContactSchema.parse({ id: 7, name: "Berliner Kindl GmbH", customerNumber: "1001", vatNumber: "DE123456789" });
    const person = sevContactSchema.parse({ id: "8", surename: "Erika", familyname: "Mustermann" });
    const addresses = firstByContact([
      { id: 1, contact: { id: "7", objectName: "Contact" }, street: "Hauptstr. 1", zip: "10115", city: "Berlin", country: { id: 1, objectName: "StaticCountry", code: "de" } },
    ]);
    const mails = firstByContact([
      { id: 1, contact: { id: 7 }, type: "EMAIL", value: "info@example.com", main: false },
      { id: 2, contact: { id: 7 }, type: "EMAIL", value: "rechnung@example.com", main: "1" },
    ]);
    expect(mapSevContact(org, addresses.get("7"), mails.get("7"))).toEqual({
      sevdeskId: "7",
      name: "Berliner Kindl GmbH",
      kundennummer: "1001",
      strasse: "Hauptstr. 1",
      plz: "10115",
      ort: "Berlin",
      land: "DE",
      email: "rechnung@example.com",
      ustId: "DE123456789",
      steuernummer: "",
    });
    expect(mapSevContact(person)).toMatchObject({ name: "Erika Mustermann", land: "DE", kundennummer: null });
  });

  it("erkennt Ansprechpartner einer Organisation", () => {
    expect(isSevMainContact(sevContactSchema.parse({ id: 9, parent: { id: 7, objectName: "Contact" } }))).toBe(false);
    expect(isSevMainContact(sevContactSchema.parse({ id: 7, parent: null }))).toBe(true);
  });
});

describe("mapSevInvoice", () => {
  it("teilt nach Steuersätzen auf und legt Rundungsdifferenzen auf den größten Satz", () => {
    const { voucher, payment } = mapSevInvoice(invoice({}), [
      { id: 1, taxRate: "19", sumNet: "100.00", sumTax: "19.00", sumGross: "119.00" },
      { id: 2, taxRate: "7", sumNet: "50.00", sumTax: "3.50" },
      { id: 3, taxRate: "7", sumNet: "50.00", sumTax: "3.49" },
    ]);
    expect(voucher).toMatchObject({
      lexofficeId: "invoice/101",
      type: "invoice",
      direction: "einnahme",
      number: "RE-1001",
      date: "2024-03-05",
      dueDate: "2024-03-19",
      status: "paid",
      contactLexofficeId: "7",
      contactName: "Berliner Kindl GmbH",
      net: 20000,
      tax: 2600,
      gross: 22600,
    });
    // 19 % hat 100 € netto, 7 % zusammen 100 € – bei Gleichstand bleibt der erste; die Steuerdifferenz von 1 Cent landet dort
    expect(voucher.taxes).toEqual([
      { rate: 1900, net: 10000, tax: 1901 },
      { rate: 700, net: 10000, tax: 699 },
    ]);
    expect(payment).toEqual({
      status: "balanced",
      openAmount: 0,
      paidDate: "2024-03-12",
      items: [{ type: "manualPayment", date: "2024-03-12", amount: 22600 }],
    });
  });

  it("nimmt bei einem Satz die Summen des Belegs", () => {
    const { voucher } = mapSevInvoice(invoice({ sumNet: "100", sumTax: "19", sumGross: "119" }), [
      { id: 1, taxRate: 19, sumNet: "99.99", sumTax: "19.00" },
    ]);
    expect(voucher.taxes).toEqual([{ rate: 1900, net: 10000, tax: 1900 }]);
  });

  it("führt offene und teilweise bezahlte Rechnungen mit offenem Betrag", () => {
    const open = mapSevInvoice(invoice({ status: "200", paidAmount: 0, payDate: null }), []);
    expect(open.voucher.status).toBe("open");
    expect(open.payment).toEqual({ status: "open", openAmount: 22600, paidDate: null, items: [] });
    const part = mapSevInvoice(invoice({ status: "750", paidAmount: "100.00", payDate: "2024-04-01" }), []);
    expect(part.payment).toMatchObject({ status: "partlyPaid", openAmount: 12600, items: [{ date: "2024-04-01", amount: 10000 }] });
  });

  it("macht aus Storno eine negative Gutschrift und aus AR eine Abschlagsrechnung", () => {
    const storno = mapSevInvoice(invoice({ invoiceType: "SR", sumNet: "200", sumTax: "26", sumGross: "226" }), []);
    expect(storno.voucher).toMatchObject({ type: "creditnote", net: -20000, tax: -2600, gross: -22600, dueDate: null });
    expect(storno.payment.items).toEqual([{ type: "manualPayment", date: "2024-03-12", amount: -22600 }]);
    expect(mapSevInvoice(invoice({ invoiceType: "AR" }), []).voucher.type).toBe("downpaymentinvoice");
  });

  it("lässt Entwürfe, Vorlagen und Mahnungen aus", () => {
    expect(isSevInvoiceImportable(invoice({ status: "100" }))).toBe(false);
    expect(isSevInvoiceImportable(invoice({ invoiceType: "WKR" }))).toBe(false);
    expect(isSevInvoiceImportable(invoice({ invoiceType: "MA" }))).toBe(false);
    expect(isSevInvoiceImportable(invoice({ status: "200" }))).toBe(true);
  });
});

describe("mapSevCreditNote", () => {
  it("führt Gutschriften negativ", () => {
    const note = sevCreditNoteSchema.parse({
      id: 5,
      creditNoteNumber: "GS-0001",
      creditNoteDate: "2024-05-02T00:00:00+02:00",
      status: "1000",
      address: "Kunde AG",
      sumNet: "10.00",
      sumTax: "1.90",
      sumGross: "11.90",
    });
    const { voucher, payment } = mapSevCreditNote(note, [{ id: 1, taxRate: "19", sumNet: "10", sumTax: "1.9" }]);
    expect(voucher).toMatchObject({ lexofficeId: "creditnote/5", type: "creditnote", net: -1000, tax: -190, gross: -1190, contactName: "Kunde AG" });
    expect(voucher.taxes).toEqual([{ rate: 1900, net: -1000, tax: -190 }]);
    expect(payment).toMatchObject({ openAmount: 0, items: [{ date: "2024-05-02", amount: -1190 }] });
  });
});

describe("mapSevVoucher", () => {
  const base = {
    id: "301",
    voucherDate: "2024-02-10T00:00:00+01:00",
    supplier: { id: "12", objectName: "Contact" },
    supplierName: "Bürohaus GmbH",
    description: "B-2024-17",
    document: { id: "880", objectName: "Document" },
    status: "100",
    sumNet: "100.00",
    sumTax: "19.00",
    sumGross: "119.00",
    paidAmount: 0,
    creditDebit: "D",
    voucherType: "VOU",
    currency: "EUR",
    paymentDeadline: "2024-02-24T00:00:00+01:00",
  };

  it("bildet Ausgaben mit Kategorien, Datei und offenem Betrag ab", () => {
    const { voucher, payment } = mapSevVoucher(sevVoucherSchema.parse(base), [
      { id: 1, accountDatev: { id: 4930, objectName: "AccountDatev" }, taxRate: "19", net: true, sumNet: "100", sumTax: "19", sumGross: "119" },
    ]);
    expect(voucher).toMatchObject({
      lexofficeId: "voucher/301",
      type: "purchaseinvoice",
      direction: "ausgabe",
      number: "B-2024-17",
      date: "2024-02-10",
      dueDate: "2024-02-24",
      status: "open",
      contactLexofficeId: "12",
      contactName: "Bürohaus GmbH",
      net: 10000,
      tax: 1900,
      gross: 11900,
      taxes: [{ rate: 1900, net: 10000, tax: 1900 }],
      categories: [{ categoryId: "4930", net: 10000, tax: 1900, rate: 1900 }],
      fileIds: ["880"],
    });
    expect(payment).toEqual({ status: "open", openAmount: 11900, paidDate: null, items: [] });
  });

  it("erkennt Einnahmen und Gutschriften", () => {
    expect(mapSevVoucher(sevVoucherSchema.parse({ ...base, creditDebit: "C" }), []).voucher.type).toBe("salesinvoice");
    const credit = mapSevVoucher(sevVoucherSchema.parse({ ...base, sumNet: "-10", sumTax: "-1.90", sumGross: "-11.90" }), []);
    expect(credit.voucher).toMatchObject({ type: "purchasecreditnote", gross: -1190, taxes: [{ rate: 0, net: -1000, tax: -190 }] });
  });

  it("lässt Entwürfe und Vorlagen wiederkehrender Belege aus", () => {
    expect(isSevVoucherImportable(sevVoucherSchema.parse({ ...base, status: "50" }))).toBe(false);
    expect(isSevVoucherImportable(sevVoucherSchema.parse({ ...base, voucherType: "RV" }))).toBe(false);
    expect(isSevVoucherImportable(sevVoucherSchema.parse(base))).toBe(true);
  });
});
