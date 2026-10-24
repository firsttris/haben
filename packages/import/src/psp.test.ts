import { describe, expect, it } from "vitest";
import { detectStatementFormat, parseStatement, withDedupHashes } from "./index.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const brief = (s: ReturnType<typeof parseStatement>) => s.transactions.map((t) => [t.bookingDate, t.amount, t.counterpartyName, t.purpose]);

describe("PayPal", () => {
  const german = [
    `"Datum","Uhrzeit","Zeitzone","Name","Typ","Status","Währung","Brutto","Gebühr","Netto","Absender E-Mail-Adresse","Empfänger E-Mail-Adresse","Transaktionscode","Rechnungsnummer","Guthaben"`,
    `"01.10.2026","10:15:00","CEST","Nordwerk Software GmbH","Website-Zahlung","Abgeschlossen","EUR","119,00","-2,61","116,39","a@b.example","shop@example.com","1AB23456CD789012E","RE-2026-041","116,39"`,
    `"02.10.2026","09:00:00","CEST","Kunde US","Website-Zahlung","Abgeschlossen","USD","50,00","-1,99","48,01","","","2XY","",""`,
    `"03.10.2026","11:00:00","CEST","Alpenblick","Website-Zahlung","Ausstehend","EUR","20,00","0,00","20,00","","","3ZZ","",""`,
    `"05.10.2026","08:00:00","CEST","DKB","Allgemeine Abbuchung","Abgeschlossen","EUR","-1.000,00","0,00","-1.000,00","","","4WD","",""`,
  ].join("\n");

  it("erkennt den deutschen Export, trennt Brutto und Gebühr, überspringt Fremdwährung und Ausstehendes", () => {
    expect(detectStatementFormat(bytes(german))).toBe("paypal-csv");
    const statement = parseStatement(bytes(german), "paypal.csv");
    expect(brief(statement)).toEqual([
      ["2026-10-01", 11_900, "Nordwerk Software GmbH", "Website-Zahlung · RE-2026-041 · 1AB23456CD789012E"],
      ["2026-10-01", -261, "PayPal", "Gebühr · 1AB23456CD789012E"],
      ["2026-10-05", -100_000, "DKB", "Allgemeine Abbuchung · 4WD"],
    ]);
    expect(statement.accountIban).toBeUndefined();
    expect(statement.warnings).toEqual([
      "1 Zeile übersprungen: nicht abgeschlossen (ausstehend, abgelehnt, storniert).",
      "1 Zeile übersprungen: nicht in Euro.",
    ]);
  });

  it("englische Spalten mit Dezimalpunkt und Datum Tag/Monat", () => {
    const english = [
      `"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","Transaction ID"`,
      `"30/09/2026","10:15:00","CEST","Nordwerk","Express Checkout Payment","Completed","EUR","1,190.00","-24.08","1,165.92","9AB"`,
    ].join("\n");
    expect(brief(parseStatement(bytes(english)))).toEqual([
      ["2026-09-30", 119_000, "Nordwerk", "Express Checkout Payment · 9AB"],
      ["2026-09-30", -2_408, "PayPal", "Gebühr · 9AB"],
    ]);
  });
});

describe("Stripe", () => {
  it("Saldenverlauf (alter Export): Zahlung, Gebühr negativ, Auszahlung", () => {
    const csv = [
      `id,Type,Source,Amount,Fee,Net,Currency,Created (UTC),Available On (UTC),Description`,
      `txn_1,charge,ch_1,119.00,1.92,117.08,eur,2026-10-01 10:00:00,2026-10-08 00:00:00,Rechnung RE-2026-042`,
      `txn_2,payout,po_1,-117.08,0.00,-117.08,eur,2026-10-08 06:00:00,2026-10-08 00:00:00,STRIPE PAYOUT`,
      `txn_3,charge,ch_2,10.00,0.50,9.50,usd,2026-10-02 10:00:00,2026-10-09 00:00:00,US`,
    ].join("\n");
    expect(detectStatementFormat(bytes(csv))).toBe("stripe-csv");
    const statement = parseStatement(bytes(csv));
    expect(brief(statement)).toEqual([
      ["2026-10-01", 11_900, "Rechnung RE-2026-042", "charge · Rechnung RE-2026-042 · txn_1"],
      ["2026-10-01", -192, "Stripe", "Gebühr · txn_1"],
      ["2026-10-08", -11_708, "Stripe", "payout · STRIPE PAYOUT · txn_2"],
    ]);
    // Mit „Customer Facing Amount“ (ab 2019 im alten Export): der Betrag ist keine Gegenpartei
    const withAmount = [
      `id,Type,Source,Amount,Fee,Net,Currency,Created (UTC),Available On (UTC),Description,Customer Facing Amount,Customer Facing Currency`,
      `txn_1,charge,ch_1,119.00,1.92,117.08,eur,2026-10-01 10:00:00,2026-10-08 00:00:00,Rechnung RE-2026-042,119.00,eur`,
    ].join("\n");
    expect(parseStatement(bytes(withAmount)).transactions[0]?.counterpartyName).toBe("Rechnung RE-2026-042");
    expect(statement.warnings).toEqual(["1 Zeile übersprungen: nicht in Euro."]);
  });

  it("neuer Export mit reporting_category", () => {
    const csv = [`balance_transaction_id,created_utc,available_on_utc,currency,gross,fee,net,reporting_category,description`, `txn_9,2026-10-03 08:00:00,2026-10-10 00:00:00,eur,59.50,1.08,58.42,charge,Abo`].join("\n");
    expect(brief(parseStatement(bytes(csv)))).toEqual([
      ["2026-10-03", 5_950, "Abo", "charge · Abo · txn_9"],
      ["2026-10-03", -108, "Stripe", "Gebühr · txn_9"],
    ]);
  });
});

describe("Shopify Payments", () => {
  const header = `Transaction Date,Type,Order,Card Brand,Card Source,Payout Status,Payout Date,Payout ID,Available On,Amount,Fee,Net,Checkout,Payment Method Name,Presentment Amount,Presentment Currency,Currency`;

  it("Transaktionen mit Gebühr, Auszahlung als ein Teil je ausgezahlter Transaktion", () => {
    const csv = [
      `Transaction Date,Type,Order,Card Brand,Card Source,Payout Status,Payout Date,Payout ID,Available On,Amount,Fee,Net,Checkout,Payment Method Name,Presentment Amount,Presentment Currency,Currency`,
      `2026-10-01 12:00:00 +0200,charge,#1001,visa,online,paid,2026-10-04,98765,2026-10-04,49.90,1.27,48.63,c1,card,49.90,EUR,EUR`,
      `2026-10-02 09:00:00 +0200,charge,#1002,mastercard,online,paid,2026-10-04,98765,2026-10-04,29.90,0.82,29.08,c2,card,29.90,EUR,EUR`,
      `2026-10-03 09:00:00 +0200,refund,#1001,visa,online,pending,,,,-49.90,0.00,-49.90,c1,card,-49.90,EUR,EUR`,
    ].join("\n");
    expect(detectStatementFormat(bytes(csv))).toBe("shopify-payments-csv");
    expect(brief(parseStatement(bytes(csv)))).toEqual([
      ["2026-10-01", 4_990, "Bestellung #1001", "charge · Bestellung #1001"],
      ["2026-10-01", -127, "Shopify Payments", "Gebühr · charge · Bestellung #1001"],
      ["2026-10-02", 2_990, "Bestellung #1002", "charge · Bestellung #1002"],
      ["2026-10-02", -82, "Shopify Payments", "Gebühr · charge · Bestellung #1002"],
      ["2026-10-03", -4_990, "Bestellung #1001", "refund · Bestellung #1001"],
      ["2026-10-04", -4_863, "Shopify Payments", "Auszahlung 98765 · charge · Bestellung #1001 · 2026-10-01"],
      ["2026-10-04", -2_908, "Shopify Payments", "Auszahlung 98765 · charge · Bestellung #1002 · 2026-10-02"],
    ]);
  });

  const hashes = (text: string) => new Map(withDedupHashes(parseStatement(bytes(text)).transactions).map((t) => [t.purpose, t.dedupHash]));

  it("dieselbe Zahlung vor und nach der Auszahlung exportiert: gleicher Hash, der Auszahlungsteil kommt dazu", () => {
    const early = hashes([header, `2026-10-01 12:00:00 +0200,charge,#1001,visa,online,pending,,,2026-10-04,49.90,1.27,48.63,c1,card,49.90,EUR,EUR`].join("\n"));
    const late = hashes([header, `2026-10-01 12:00:00 +0200,charge,#1001,visa,online,paid,2026-10-04,98765,2026-10-04,49.90,1.27,48.63,c1,card,49.90,EUR,EUR`].join("\n"));
    expect(late.get("charge · Bestellung #1001")).toBe(early.get("charge · Bestellung #1001"));
    expect([...late.keys()].filter((p) => !early.has(p))).toEqual(["Auszahlung 98765 · charge · Bestellung #1001 · 2026-10-01"]);
  });

  it("Auszahlung über die Monatsgrenze: die Teile aus beiden Exporten ergeben zusammen den Eingang auf der Bank", () => {
    const september = [header, `2026-09-30 12:00:00 +0200,charge,#1001,visa,online,paid,2026-10-02,98765,2026-10-02,49.90,1.27,48.63,c1,card,49.90,EUR,EUR`].join("\n");
    const october = [header, `2026-10-01 09:00:00 +0200,charge,#1002,visa,online,paid,2026-10-02,98765,2026-10-02,29.90,0.82,29.08,c2,card,29.90,EUR,EUR`].join("\n");
    const both = [header, september.split("\n")[1], october.split("\n")[1]].join("\n");
    const parts = (text: string) => parseStatement(bytes(text)).transactions.filter((t) => t.type === "Auszahlung");
    expect([...parts(september), ...parts(october)].reduce((s, t) => s + t.amount, 0)).toBe(-7_771);
    // Ein überlappender Export bringt keine neuen Teile: dieselben Hashes
    const separate = new Set([...hashes(september).values(), ...hashes(october).values()]);
    expect([...hashes(both).values()].every((h) => separate.has(h))).toBe(true);
  });
});
