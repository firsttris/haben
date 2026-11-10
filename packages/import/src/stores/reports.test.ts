import { gzipSync, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { StatementParseError } from "../errors.ts";
import { microsToCents, parseAppStoreFinanceDetail, parseGooglePlayEarnings, parseMicros } from "./reports.ts";

/*
 * Nachgebaute Berichte nach den Spaltenbeschreibungen der Stores (echte Dateien lagen nicht vor):
 * Google https://support.google.com/googleplay/android-developer/answer/6135870 („Earnings“),
 * Apple https://developer.apple.com/help/app-store-connect/reference/reporting/financial-report-fields/ („Detailed“).
 */

const GOOGLE_HEADER = [
  "Description",
  "Transaction Date",
  "Transaction Time",
  "Tax Type",
  "Transaction Type",
  "Refund Type",
  "Product Title",
  "Package ID",
  "Product Type",
  "SKU ID",
  "Hardware",
  "Buyer Country",
  "Buyer State",
  "Buyer Postcode",
  "Buyer Currency",
  "Amount (Buyer Currency)",
  "Currency Conversion Rate",
  "Merchant Currency",
  "Amount (Merchant Currency)",
  "Base Plan or Purchase Option ID",
  "Offer ID",
  "Group ID",
  "First USD 1M Eligible",
  "Service Fee %",
  "Fee Description",
  "Promotion ID",
  "Sales Channel",
];

function googleRow(date: string, type: string, buyer: string, merchant: string, currency = "EUR") {
  const row = Object.fromEntries(GOOGLE_HEADER.map((h) => [h, ""]));
  Object.assign(row, {
    Description: "GPA.1234-1234-1234-12345",
    "Transaction Date": date,
    "Transaction Time": "12:00:00 PM PDT",
    "Transaction Type": type,
    "Product Title": "Meine App, Pro",
    "Package ID": "com.example.app",
    "Product Type": "One-time product",
    "Buyer Country": "US",
    "Buyer Currency": "USD",
    "Amount (Buyer Currency)": buyer,
    "Currency Conversion Rate": "0.92",
    "Merchant Currency": currency,
    "Amount (Merchant Currency)": merchant,
  });
  return GOOGLE_HEADER.map((h) => {
    const value = row[h]!;
    return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",");
}

const googleCsv = (rows: string[]) => [GOOGLE_HEADER.join(","), ...rows].join("\n");
const zip = (csv: string, name = "earnings_202610_1234.csv") => zipSync({ [name]: strToU8(csv) });

/** UTF-16LE mit BOM, wie Google die CSV-Dateien laut Hilfe ablegt */
function utf16(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    bytes[2 + i * 2] = text.charCodeAt(i) & 0xff;
    bytes[3 + i * 2] = text.charCodeAt(i) >> 8;
  }
  return bytes;
}

describe("Google Play: Einnahmenbericht", () => {
  const rows = [
    googleRow("Oct 1, 2026", "Charge", "4.99", "4.591234"),
    googleRow("Oct 1, 2026", "Google fee", "-0.75", "-0.688685"),
    googleRow("Oct 15, 2026", "Charge", "9.99", "9.19"),
    googleRow("Oct 15, 2026", "Google fee", "-1.50", "-1.38"),
    googleRow("Oct 20, 2026", "Charge refund", "-4.99", "-4.591234"),
    googleRow("Oct 20, 2026", "Google fee refund", "0.75", "0.688685"),
    googleRow("Oct 31, 2026", "Tax", "-0.10", "-0.09"),
    googleRow("Nov 1, 2026", "Charge", "1.99", "1.83"),
  ];

  it("fasst den Monat netto zu einem Umsatz zusammen und rundet erst die Summe", () => {
    const { statement, settlements } = parseGooglePlayEarnings(zip(googleCsv(rows)), { period: "2026-10" });
    // 4,591234 − 0,688685 + 9,19 − 1,38 − 4,591234 + 0,688685 − 0,09 + 1,83 = 9,55
    expect(statement.transactions).toEqual([
      {
        bookingDate: "2026-10-31",
        amount: 955,
        currency: "EUR",
        counterpartyName: "Google Play",
        purpose: "Google Play Einnahmen 10/2026: Umsätze 11,02 €, Gebühren -1,38 €, Steuern -0,09 €; 8 Vorgänge vom 2026-10-01 bis 2026-11-01",
        type: "Monatsabrechnung",
        bankReference: "googleplay-earnings-2026-10",
        index: 0,
      },
    ]);
    expect(statement.format).toBe("googleplay-earnings");
    expect(statement.warnings).toEqual([]);
    expect(settlements[0]).toMatchObject({ period: "2026-10", currency: "EUR", net: 955, euro: 955, lines: 8 });
  });

  it("liest UTF-16, leitet den Monat aus den Vorgängen ab und kennzeichnet Korrekturdateien", () => {
    const { statement } = parseGooglePlayEarnings(zipSync({ "earnings_202610.csv": utf16(googleCsv(rows)) }), { part: "2" });
    expect(statement.transactions[0]).toMatchObject({ bookingDate: "2026-10-31", amount: 955, bankReference: "googleplay-earnings-2026-10-2" });
    expect(statement.transactions[0]!.purpose).toContain("(Korrektur)");
  });

  it("meldet unbekannte Zeilenarten und nimmt sie mit Betrag in den Nettobetrag", () => {
    const { statement } = parseGooglePlayEarnings(
      zip(googleCsv([googleRow("Oct 2, 2026", "Charge", "1", "1.00"), googleRow("Oct 3, 2026", "Chargeback fee", "", "-15.00")])),
      {
        period: "2026-10",
      },
    );
    expect(statement.transactions[0]!.amount).toBe(-1400);
    expect(statement.warnings).toEqual(["Unbekannte Zeilenart „Chargeback fee“ (1×): mit ihrem Betrag im Nettobetrag enthalten."]);
  });

  it("bricht bei anderer Auszahlungswährung, falschem Betrag oder fremder Datei ab", () => {
    expect(() => parseGooglePlayEarnings(zip(googleCsv([googleRow("Oct 2, 2026", "Charge", "1", "1.00", "USD")])))).toThrow(/nur Berichte in Euro/);
    expect(() => parseGooglePlayEarnings(zip(googleCsv([googleRow("Oct 2, 2026", "Charge", "1", "1,00")])))).toThrow(StatementParseError);
    expect(() => parseGooglePlayEarnings(zip(googleCsv([googleRow("2026-10-02", "Charge", "1", "1.00")])))).toThrow(/Ungültiges Datum/);
    expect(() => parseGooglePlayEarnings(zip("Order Number,Charged Amount\n1,2"))).toThrow(/kein Einnahmenbericht/);
    expect(() => parseGooglePlayEarnings(zip(googleCsv([])))).toThrow(/keine Vorgänge/);
  });
});

const APPLE_HEADER = [
  "Vendor Name",
  "Start Date",
  "End Date",
  "Transaction Date",
  "Settlement Date",
  "Apple Identifier",
  "SKU",
  "Title",
  "Developer Name",
  "Product Type Identifier",
  "Country of Sale",
  "Quantity",
  "Partner Share",
  "Extended Partner Share",
  "Partner Share Currency",
  "Customer Price",
  "Customer Currency",
  "Sale or Return",
  "Promo Code",
  "Order Type",
  "Region",
];

function appleRow(country: string, quantity: string, share: string, extended: string, currency: string, saleOrReturn = "S") {
  const row: Record<string, string> = Object.fromEntries(APPLE_HEADER.map((h) => [h, ""]));
  Object.assign(row, {
    "Vendor Name": "Muster Apps",
    "Start Date": "09/28/2026",
    "End Date": "11/01/2026",
    "Transaction Date": "10/05/2026",
    "Settlement Date": "10/06/2026",
    "Apple Identifier": "1234567890",
    SKU: "pro",
    Title: "Pro-Version",
    "Developer Name": "Muster Apps",
    "Product Type Identifier": "IA1",
    "Country of Sale": country,
    Quantity: quantity,
    "Partner Share": share,
    "Extended Partner Share": extended,
    "Partner Share Currency": currency,
    "Customer Price": "4.99",
    "Customer Currency": currency,
    "Sale or Return": saleOrReturn,
  });
  return APPLE_HEADER.map((h) => row[h]).join("\t");
}

const appleReport = (rows: string[], footer: string[] = []) => gzipSync(strToU8([APPLE_HEADER.join("\t"), ...rows, ...footer].join("\n")));

describe("App Store: Finanzbericht Detailed (Z1)", () => {
  const rows = [
    appleRow("DE", "3", "3.49", "10.47", "EUR"),
    appleRow("FR", "-1", "3.49", "-3.49", "EUR", "R"),
    appleRow("US", "5", "3.50", "17.50", "USD"),
    appleRow("JP", "1", "490", "490.00", "JPY"),
  ];
  const rates = (currency: string, month: string) =>
    (({ "USD 2026-10": "1.0812", "JPY 2026-10": "161.5" }) as Record<string, string>)[`${currency} ${month}`] ?? null;

  it("legt je Währung einen Umsatz in Euro an, Fremdwährung zum Umrechnungskurs des Monats", () => {
    const { statement, settlements } = parseAppStoreFinanceDetail(appleReport(rows, ["", "Total_Rows\t4", "Total_Amount\t514.48"]), {
      period: "2026-10",
      rateFor: rates,
    });
    expect(statement.format).toBe("appstore-finance");
    expect(statement.transactions.map((t) => [t.bookingDate, t.amount, t.bankReference])).toEqual([
      ["2026-11-01", 698, "appstore-finance-2026-10-EUR"],
      // 490 JPY / 161,5 = 3,034 €; 17,50 USD / 1,0812 = 16,185 €
      ["2026-11-01", 303, "appstore-finance-2026-10-JPY"],
      ["2026-11-01", 1619, "appstore-finance-2026-10-USD"],
    ]);
    expect(statement.transactions[0]!.purpose).toBe("App Store Erlösanteil Fiskalmonat 10/2026 (2026-09-28 bis 2026-11-01) in EUR; 1 Verkäufe, 1 Rückgaben");
    expect(statement.transactions[2]!.purpose).toContain("in USD = 17,50 USD zum Kurs 1,0812 (10/2026)");
    expect(statement.warnings).toEqual(["2 Zeilen ohne gültiges Start- und Enddatum (Summen- oder Fußzeilen) übersprungen."]);
    expect(settlements.map((s) => [s.currency, s.net, s.euro, s.rate])).toEqual([
      ["EUR", 698, 698, null],
      ["JPY", 49000, 303, "161.5"],
      ["USD", 1750, 1619, "1.0812"],
    ]);
  });

  it("lässt eine Währung ohne Kurs aus dem Konto und sagt es", () => {
    const { statement, settlements } = parseAppStoreFinanceDetail(appleReport(rows), { period: "2026-10" });
    expect(statement.transactions.map((t) => t.bankReference)).toEqual(["appstore-finance-2026-10-EUR"]);
    expect(statement.warnings).toHaveLength(2);
    expect(statement.warnings[0]).toContain("Für JPY fehlt der Umsatzsteuer-Umrechnungskurs 10/2026");
    expect(settlements.find((s) => s.currency === "USD")!.euro).toBeNull();
  });

  it("liest auch die ungepackte Datei und bricht bei fremder Datei oder kaputtem Betrag ab", () => {
    const plain = strToU8([APPLE_HEADER.join("\t"), rows[0]].join("\r\n"));
    expect(parseAppStoreFinanceDetail(plain).statement.transactions[0]).toMatchObject({ amount: 1047 });
    expect(() => parseAppStoreFinanceDetail(strToU8("Provider\tSKU\tUnits\n"))).toThrow(/kein Finanzbericht/);
    expect(() => parseAppStoreFinanceDetail(appleReport([appleRow("DE", "1", "1", "1,00", "EUR")]))).toThrow(/Ungültiger Betrag/);
    expect(() => parseAppStoreFinanceDetail(appleReport([], ["Total_Rows\t0"]))).toThrow(/keine Vorgänge/);
  });
});

describe("Beträge", () => {
  it("summiert in Millionstel und rundet halbe Cent vom Nullpunkt weg", () => {
    expect(parseMicros("12345.67")).toBe(12_345_670_000);
    expect(parseMicros("-0.005")).toBe(-5000);
    expect(parseMicros("1,234.5")).toBe(1_234_500_000);
    expect(parseMicros("1.2345678")).toBeNull();
    expect(parseMicros("")).toBeNull();
    expect(microsToCents(-5000)).toBe(-1);
    expect(microsToCents(4999)).toBe(0);
  });
});
