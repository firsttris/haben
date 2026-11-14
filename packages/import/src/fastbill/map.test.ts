import { describe, expect, it } from "vitest";
import { fbNumber, isFbCancellation, isFbInvoiceImportable, mapFbCustomer, mapFbExpense, mapFbInvoice } from "./map.ts";
import type { FbExpense, FbInvoice } from "./types.ts";

// Erfundene Beträge und Namen; Feldnamen nach https://apidocs.fastbill.com/fastbill/en/invoice.html und expense.html

function invoice(overrides: Partial<FbInvoice> = {}): FbInvoice {
  return {
    INVOICE_ID: "11",
    TYPE: "outgoing",
    SUBTYPE: "standard",
    STATE: "unpaid",
    IS_CANCELED: "0",
    INVOICE_NUMBER: "RE-2025-7",
    INVOICE_TITLE: "Webdesign März",
    CUSTOMER_ID: "4",
    ORGANIZATION: "Muster GmbH",
    INVOICE_DATE: "2025-03-14",
    DUE_DATE: "2025-03-28",
    PAID_DATE: "0000-00-00 00:00:00",
    SERVICE_PERIOD_START: "2025-03-01",
    SERVICE_PERIOD_END: "2025-03-31",
    CURRENCY_CODE: "EUR",
    SUB_TOTAL: "1000.00",
    VAT_TOTAL: "190.00",
    TOTAL: "1190.00",
    VAT_ITEMS: [{ VAT_PERCENT: "19.00", COMPLETE_NET: "1000.00", VAT_VALUE: "190.00" }],
    ...overrides,
  };
}

function expense(overrides: Partial<FbExpense> = {}): FbExpense {
  return {
    INVOICE_ID: "11",
    ORGANIZATION: "Bürobedarf Beispiel",
    CATEGORY: "Büromaterial",
    INVOICE_NUMBER: "L-881",
    INVOICE_DATE: "2025-02-03",
    PAID_DATE: "2025-02-05",
    CURRENCY_CODE: "EUR",
    SUB_TOTAL: "50.00",
    VAT_TOTAL: "9.50",
    TOTAL: "59.50",
    NOTE: "Papier",
    DOCUMENT_URL: "https://my.fastbill.com/download/abc",
    ...overrides,
  };
}

describe("fbNumber", () => {
  it.each([
    ["119.00", 119],
    [119, 119],
    ["0,5", 0.5],
    ["", 0],
    [null, 0],
    ["abc", 0],
  ] as const)("%s → %s", (value, expected) => {
    expect(fbNumber(value)).toBe(expected);
  });
});

describe("mapFbCustomer", () => {
  it("bildet Firma, Adresse, Land und Nummer ab", () => {
    const c = mapFbCustomer({
      CUSTOMER_ID: 4,
      CUSTOMER_NUMBER: "10004",
      ORGANIZATION: " Muster GmbH ",
      ADDRESS: "Hauptstraße 1",
      ADDRESS_2: "Hinterhaus",
      ZIPCODE: "12345",
      CITY: "Musterstadt",
      COUNTRY_CODE: "at",
      EMAIL: "rechnung@example.de",
      VAT_ID: "ATU12345678",
    });
    expect(c).toEqual({
      fastbillId: "4",
      name: "Muster GmbH",
      role: "customer",
      kundennummer: "10004",
      strasse: "Hauptstraße 1, Hinterhaus",
      plz: "12345",
      ort: "Musterstadt",
      land: "AT",
      email: "rechnung@example.de",
      ustId: "ATU12345678",
    });
  });

  it("nimmt bei Privatkunden den Namen der Person, sonst eine Ersatzbezeichnung, und DE als Land", () => {
    expect(mapFbCustomer({ CUSTOMER_ID: "5", FIRST_NAME: "Erika", LAST_NAME: "Muster" })).toMatchObject({
      name: "Erika Muster",
      land: "DE",
      kundennummer: null,
    });
    expect(mapFbCustomer({ CUSTOMER_ID: "6" }).name).toBe("Kunde 6");
  });
});

describe("isFbInvoiceImportable", () => {
  it("lässt Entwürfe weg", () => {
    expect(isFbInvoiceImportable(invoice())).toBe(true);
    expect(isFbInvoiceImportable(invoice({ TYPE: "draft" }))).toBe(false);
    expect(isFbInvoiceImportable(invoice({ STATE: "draft" }))).toBe(false);
  });
});

describe("mapFbInvoice", () => {
  it("bildet eine offene Rechnung in Cent mit Steuer je Satz ab", () => {
    const { voucher, payment } = mapFbInvoice(invoice());
    expect(voucher).toEqual({
      lexofficeId: "invoice/11",
      type: "invoice",
      direction: "einnahme",
      number: "RE-2025-7",
      date: "2025-03-14",
      dueDate: "2025-03-28",
      serviceFrom: "2025-03-01",
      serviceTo: "2025-03-31",
      status: "unpaid",
      contactLexofficeId: "4",
      contactName: "Muster GmbH",
      currency: "EUR",
      net: 100_000,
      tax: 19_000,
      gross: 119_000,
      taxes: [{ rate: 1900, net: 100_000, tax: 19_000 }],
      categories: [],
      fileIds: [],
      remark: "Webdesign März",
    });
    expect(payment).toEqual({ status: "open", openAmount: 119_000, paidDate: null, items: [] });
  });

  it("wertet eine bezahlte Rechnung mit Zahlungstag als ausgeglichen", () => {
    const { voucher, payment } = mapFbInvoice(invoice({ STATE: "paid", PAID_DATE: "2025-04-02 00:00:00" }));
    expect(voucher.status).toBe("paid");
    expect(payment).toEqual({ status: "balanced", openAmount: 0, paidDate: "2025-04-02", items: [] });
  });

  it("teilt gemischte Steuersätze nach VAT_ITEMS auf", () => {
    const { voucher } = mapFbInvoice(
      invoice({
        SUB_TOTAL: "200.00",
        VAT_TOTAL: "26.00",
        TOTAL: "226.00",
        VAT_ITEMS: [
          { VAT_PERCENT: "19", COMPLETE_NET: "100.00", VAT_VALUE: "19.00" },
          { VAT_PERCENT: "7", COMPLETE_NET: "100.00", VAT_VALUE: "7.00" },
        ],
      }),
    );
    expect(voucher.taxes).toEqual([
      { rate: 1900, net: 10_000, tax: 1900 },
      { rate: 700, net: 10_000, tax: 700 },
    ]);
  });

  it("nimmt ohne VAT_ITEMS die Positionen", () => {
    const { voucher } = mapFbInvoice(
      invoice({
        VAT_ITEMS: null,
        ITEMS: [
          { DESCRIPTION: "Beratung", VAT_PERCENT: "19", COMPLETE_NET: "600.00", VAT_VALUE: "114.00" },
          { DESCRIPTION: "Lizenz", VAT_PERCENT: "19", COMPLETE_NET: "400.00", COMPLETE_GROSS: "476.00" },
        ],
      }),
    );
    expect(voucher.taxes).toEqual([{ rate: 1900, net: 100_000, tax: 19_000 }]);
  });

  it("erkennt den Satz einer Rechnung ohne Aufteilung aus dem Kopf", () => {
    const { voucher } = mapFbInvoice(invoice({ VAT_ITEMS: [], ITEMS: [] }));
    expect(voucher.taxes).toEqual([{ rate: 1900, net: 100_000, tax: 19_000 }]);
  });

  it("bildet eine Abschlagsrechnung als downpaymentinvoice ab", () => {
    expect(mapFbInvoice(invoice({ SUBTYPE: "progress_invoice" })).voucher.type).toBe("downpaymentinvoice");
  });

  it("führt Gutschriften immer negativ, ohne Fälligkeit", () => {
    for (const total of ["119.00", "-119.00"]) {
      const { voucher, payment } = mapFbInvoice(
        invoice({
          TYPE: "credit",
          STATE: "issued",
          TOTAL: total,
          VAT_TOTAL: total.replace("119", "19"),
          VAT_ITEMS: [{ VAT_PERCENT: "19", COMPLETE_NET: "100.00", VAT_VALUE: "19.00" }],
        }),
      );
      expect(voucher).toMatchObject({ type: "creditnote", gross: -11_900, tax: -1900, net: -10_000, dueDate: null, status: "issued" });
      expect(voucher.taxes).toEqual([{ rate: 1900, net: -10_000, tax: -1900 }]);
      expect(payment).toMatchObject({ status: "open", openAmount: -11_900 });
    }
  });

  it("wertet eine stornierte Rechnung als storniert und nicht offen", () => {
    const { voucher, payment } = mapFbInvoice(invoice({ STATE: "canceled", IS_CANCELED: "1" }));
    expect(voucher).toMatchObject({ type: "invoice", status: "voided", gross: 119_000 });
    expect(payment).toEqual({ status: "balanced", openAmount: 0, paidDate: null, items: [] });
  });

  it("bildet die Stornorechnung als negative Gutschrift ab, die die Rechnung aufhebt", () => {
    const storno = invoice({
      INVOICE_ID: "12",
      INVOICE_NUMBER: "RE-2025-8",
      REFERENCED_INVOICE_ID: "11",
      TOTAL: "-1190.00",
      VAT_TOTAL: "-190.00",
      STATE: "paid",
    });
    expect(isFbCancellation(storno)).toBe(true);
    const { voucher, payment } = mapFbInvoice(storno);
    expect(voucher).toMatchObject({ lexofficeId: "invoice/12", type: "creditnote", status: "voided", gross: -119_000, dueDate: null });
    expect(payment).toMatchObject({ status: "balanced", openAmount: 0 });
  });

  it("hält eine Rechnung aus einem Angebot nicht für ein Storno", () => {
    const ausAngebot = invoice({ REFERENCED_INVOICE_ID: "900" });
    expect(isFbCancellation(ausAngebot)).toBe(false);
    expect(mapFbInvoice(ausAngebot).voucher).toMatchObject({ type: "invoice", status: "unpaid" });
  });

  it("übernimmt Fremdwährung, Kontakt 0 als kein Kontakt und den Namen der Person", () => {
    const { voucher } = mapFbInvoice(invoice({ CURRENCY_CODE: "chf", CUSTOMER_ID: "0", ORGANIZATION: "", FIRST_NAME: "Erika", LAST_NAME: "Muster" }));
    expect(voucher).toMatchObject({ currency: "CHF", contactLexofficeId: null, contactName: "Erika Muster" });
  });

  it("nimmt das Lieferdatum als Leistungszeitraum, wenn keiner gesetzt ist", () => {
    const { voucher } = mapFbInvoice(invoice({ SERVICE_PERIOD_START: null, SERVICE_PERIOD_END: null, DELIVERY_DATE: "2025-03-10" }));
    expect(voucher).toMatchObject({ serviceFrom: "2025-03-10", serviceTo: "2025-03-10" });
  });

  it("verlangt ein Belegdatum", () => {
    expect(() => mapFbInvoice(invoice({ INVOICE_DATE: "0000-00-00" }))).toThrow("FastBill-Beleg 11 hat kein Belegdatum");
  });
});

describe("mapFbExpense", () => {
  it("bildet eine bezahlte Ausgabe mit Kategorie und Datei ab", () => {
    const { voucher, payment } = mapFbExpense(expense());
    expect(voucher).toEqual({
      lexofficeId: "expense/11",
      type: "purchaseinvoice",
      direction: "ausgabe",
      number: "L-881",
      date: "2025-02-03",
      dueDate: null,
      serviceFrom: null,
      serviceTo: null,
      status: "paid",
      contactLexofficeId: null,
      contactName: "Bürobedarf Beispiel",
      currency: "EUR",
      net: 5000,
      tax: 950,
      gross: 5950,
      taxes: [{ rate: 1900, net: 5000, tax: 950 }],
      categories: [{ categoryId: "Büromaterial", net: 5000, tax: 950, rate: 1900 }],
      fileIds: ["expense/11"],
      remark: "Papier",
    });
    expect(payment).toEqual({ status: "balanced", openAmount: 0, paidDate: "2025-02-05", items: [] });
  });

  it("hält eine negative Ausgabe als Gutschrift des Lieferanten, offen ohne Zahlungstag", () => {
    const { voucher, payment } = mapFbExpense(expense({ TOTAL: "-59.50", VAT_TOTAL: "-9.50", PAID_DATE: null }));
    expect(voucher).toMatchObject({ type: "purchasecreditnote", gross: -5950, net: -5000, status: "open" });
    expect(payment).toEqual({ status: "open", openAmount: -5950, paidDate: null, items: [] });
  });

  it("lässt Kategorie und Datei weg, wenn FastBill keine nennt", () => {
    const { voucher } = mapFbExpense(expense({ CATEGORY: "", DOCUMENT_URL: null }));
    expect(voucher).toMatchObject({ categories: [], fileIds: [] });
  });

  it("ohne Steuer steht der Beleg beim Satz 0", () => {
    const { voucher } = mapFbExpense(expense({ SUB_TOTAL: "12.00", VAT_TOTAL: "0.00", TOTAL: "12.00" }));
    expect(voucher.taxes).toEqual([{ rate: 0, net: 1200, tax: 0 }]);
  });
});
