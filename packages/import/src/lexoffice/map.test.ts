import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  lexContactSchema,
  lexPaymentsSchema,
  lexSalesDocumentSchema,
  lexVoucherSchema,
} from "./types.ts";
import { lexDate, lexToCents, mapContact, mapPayments, mapSalesDocument, mapVoucher } from "./map.ts";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../test-fixtures/lexoffice/${name}`, import.meta.url), "utf8"));

const sales = (name: string) => lexSalesDocumentSchema.parse(fixture(name));
const voucher = (name: string) => lexVoucherSchema.parse(fixture(name));
const contact = (name: string) => lexContactSchema.parse(fixture(name));

describe("Grundbausteine", () => {
  it("rechnet Euro in Cent ohne Gleitkomma-Ausrutscher", () => {
    expect(lexToCents(1.005)).toBe(101);
    expect(lexToCents(0.285)).toBe(29);
    expect(lexToCents(1172.5)).toBe(117250);
    expect(lexToCents(-19.995)).toBe(-2000);
    expect(Object.is(lexToCents(-0), 0)).toBe(true);
  });

  it("nimmt das Kalenderdatum wie geschrieben, auch bei +02:00", () => {
    expect(lexDate("2023-06-17T00:00:00.000+02:00")).toBe("2023-06-17");
    expect(lexDate("2023-02-21T00:00:00.000+01:00")).toBe("2023-02-21");
    expect(lexDate("2023-02-21")).toBe("2023-02-21");
    expect(lexDate(null)).toBeNull();
    expect(lexDate("kaputt")).toBeNull();
  });
});

describe("mapSalesDocument", () => {
  it("bildet eine Rechnung mit zwei Steuersätzen ab", () => {
    const v = mapSalesDocument("invoice", sales("invoice-two-rates.json"), "e9066f04-8cc7-4616-93f8-ac9ecc8479c8");
    expect(v).toEqual({
      lexofficeId: "e9066f04-8cc7-4616-93f8-ac9ecc8479c8",
      type: "invoice",
      direction: "einnahme",
      number: "RE1019",
      date: "2023-02-21",
      dueDate: "2023-03-07",
      serviceFrom: "2023-02-01",
      serviceTo: "2023-02-17",
      status: "paid",
      contactLexofficeId: "97c5794f-8ab2-43ad-b459-c5980b055e4d",
      contactName: "Berliner Kindl GmbH",
      currency: "EUR",
      net: 98925,
      tax: 18325,
      gross: 117250,
      taxes: [
        { rate: 1900, net: 95000, tax: 18050 },
        { rate: 700, net: 3925, tax: 275 },
      ],
      categories: [],
      fileIds: [],
      remark: "Vielen Dank für Ihren Einkauf",
    });
  });

  it("gibt Gutschriften ein negatives Vorzeichen und behält den Tag bei +02:00", () => {
    const v = mapSalesDocument("creditnote", sales("creditnote.json"), "cn1");
    expect(v.date).toBe("2023-06-17");
    expect(v.direction).toBe("einnahme");
    expect([v.net, v.tax, v.gross]).toEqual([-10000, -1900, -11900]);
    expect(v.taxes).toEqual([{ rate: 1900, net: -10000, tax: -1900 }]);
    expect(v.dueDate).toBeNull();
    expect(v.serviceFrom).toBeNull();
  });

  it("Kleinunternehmer-Rechnung ohne taxAmounts → ein Eintrag mit Satz 0", () => {
    const v = mapSalesDocument("invoice", sales("invoice-small-business.json"), "sb1");
    expect([v.net, v.tax, v.gross]).toEqual([45000, 0, 45000]);
    expect(v.taxes).toEqual([{ rate: 0, net: 45000, tax: 0 }]);
    expect(v.contactLexofficeId).toBeNull();
    expect(v.contactName).toBe("Erika Mustermann");
    expect(v.serviceFrom).toBe("2021-11-27");
    expect(v.serviceTo).toBe("2021-11-27");
    expect(v.status).toBe("paidoff");
  });

  it("leitet Netto aus Brutto − Steuer ab, damit die Summe exakt stimmt", () => {
    const d = sales("invoice-two-rates.json");
    // absichtlich inkonsistent gerundete Summen
    const v = mapSalesDocument("invoice", { ...d, totalPrice: { currency: "EUR", totalNetAmount: 10.01, totalTaxAmount: 1.9, totalGrossAmount: 11.9 } }, "x");
    expect(v.net + v.tax).toBe(v.gross);
    expect(v.net).toBe(1000);
  });

  it("berechnet das Fälligkeitsdatum aus der Zahlungsfrist, wenn dueDate fehlt", () => {
    const d = sales("invoice-two-rates.json");
    const v = mapSalesDocument("invoice", { ...d, dueDate: null }, "x");
    expect(v.dueDate).toBe("2023-03-07");
  });
});

describe("mapVoucher", () => {
  it("Brutto-Beleg: Netto je Position = amount − taxAmount", () => {
    const v = mapVoucher(voucher("voucher-gross.json"), "a8a5");
    expect(v.type).toBe("purchaseinvoice");
    expect(v.direction).toBe("ausgabe");
    expect([v.net, v.tax, v.gross]).toEqual([11000, 1970, 12970]);
    expect(v.categories).toEqual([
      { categoryId: "16d04a28-b1d0-11e6-b4e8-8f6d5b2f9e0a", net: 10000, tax: 1900, rate: 1900 },
      { categoryId: "16d04a28-b1d0-11e6-b4e8-8f6d5b2f9e0b", net: 1000, tax: 70, rate: 700 },
    ]);
    expect(v.taxes).toEqual([
      { rate: 1900, net: 10000, tax: 1900 },
      { rate: 700, net: 1000, tax: 70 },
    ]);
    expect(v.fileIds).toEqual(["5a1d2b6e-3c4f-4e5a-9b8c-7d6e5f4a3b2c"]);
    expect(v.date).toBe("2023-07-31");
    expect(v.serviceFrom).toBe("2023-07-28");
    expect(v.dueDate).toBe("2023-08-14");
    expect(v.contactName).toBe("Bürobedarf Schmidt KG");
    expect(v.remark).toBe("Druckerpapier und Toner");
  });

  it("Netto-Beleg als Einkaufsgutschrift: negatives Vorzeichen", () => {
    const v = mapVoucher(voucher("voucher-net-creditnote.json"), "b1");
    expect(v.direction).toBe("ausgabe");
    expect([v.net, v.tax, v.gross]).toEqual([-5000, -950, -5950]);
    expect(v.categories).toEqual([{ categoryId: "16d04a28-b1d0-11e6-b4e8-8f6d5b2f9e0a", net: -5000, tax: -950, rate: 1900 }]);
    expect(v.contactLexofficeId).toBeNull();
    expect(v.dueDate).toBeNull();
  });

  it("ungeprüfter Beleg ohne Datum und Beträge → Anlagedatum, Nullbeträge", () => {
    const v = mapVoucher(voucher("voucher-unchecked.json"), "c0");
    expect(v.date).toBe("2024-01-05");
    expect(v.status).toBe("unchecked");
    expect([v.net, v.tax, v.gross]).toEqual([0, 0, 0]);
    expect(v.taxes).toEqual([]);
    expect(v.number).toBe("");
    expect(v.fileIds).toHaveLength(1);
  });

  it("liest den Status auch aus `status`", () => {
    const raw = { ...(fixture("voucher-gross.json") as object), voucherStatus: undefined, status: "open" };
    expect(mapVoucher(lexVoucherSchema.parse(raw), "x").status).toBe("open");
  });
});

describe("mapContact", () => {
  it("Firma: Name, Kundennummer, Adresszusatz, erste E-Mail", () => {
    expect(mapContact(contact("contact-company.json"))).toEqual({
      lexofficeId: "97c5794f-8ab2-43ad-b459-c5980b055e4d",
      name: "Berliner Kindl GmbH",
      kundennummer: "10308",
      lieferantennummer: null,
      strasse: "Jubiläumsweg 25 (Gebäude 10)",
      plz: "14089",
      ort: "Berlin",
      land: "DE",
      email: "office@kindl.de",
      ustId: "DE123456789",
      steuernummer: "12345/12345",
      isCustomer: true,
      isVendor: false,
      archived: false,
    });
  });

  it("Person: Vor- und Nachname ohne Anrede, Kunde und Lieferant", () => {
    const c = mapContact(contact("contact-person.json"));
    expect(c.name).toBe("Inge Musterfrau");
    expect(c.kundennummer).toBe("10309");
    expect(c.lieferantennummer).toBe("70001");
    expect(c.isCustomer && c.isVendor).toBe(true);
    expect(c.land).toBe("FR");
    expect(c.email).toBe("inge@example.org");
    expect(c.ustId).toBe("");
    expect(c.archived).toBe(true);
  });

  it("ohne Adresse: leere Felder und Land DE", () => {
    const c = mapContact(lexContactSchema.parse({ id: "x", roles: { vendor: {} }, person: { lastName: "Solo" } }));
    expect(c).toMatchObject({ name: "Solo", strasse: "", plz: "", ort: "", land: "DE", isVendor: true, lieferantennummer: null });
  });
});

describe("mapPayments", () => {
  it("rechnet Zahlungen in Cent und Tage", () => {
    expect(mapPayments(lexPaymentsSchema.parse(fixture("payments.json")))).toEqual({
      status: "balanced",
      openAmount: 0,
      paidDate: "2023-03-01",
      items: [
        { type: "partPaymentFinancialTransaction", date: "2023-02-28", amount: 100000 },
        { type: "manualPayment", date: "2023-03-01", amount: 17250 },
      ],
    });
  });
});
