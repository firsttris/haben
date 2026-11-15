import { describe, expect, it } from "vitest";
import { parseEtsyLedger, type EtsyLedgerEntry } from "./etsy-ledger.ts";

/*
 * Beispieldaten in der Form des echten Verlaufs (Juni 2023), Beträge und Typen wie dort, Kennungen erfunden:
 * im Repository stehen keine echten Bestellnummern. Die Zuordnung der Typen wurde gegen den vollständigen Verlauf und
 * alle 25 Gebührenrechnungen von Juli 2022 bis April 2026 geprüft (jede Rechnungssumme auf den Cent).
 */

/** Zeitstempel in Epoch-Sekunden; Etsy liefert sie so */
const am = (iso: string) => Math.floor(new Date(`${iso}T10:00:00Z`).getTime() / 1000);

const VERKAUF_1 = 5000000001;
const VERKAUF_2 = 5000000002;
const ERSTATTUNG = 6000000001;
const BESTELLUNG_1 = "1000000001";
const BESTELLUNG_2 = "1000000002";

const zeilen: EtsyLedgerEntry[] = [
  {
    entry_id: 900000001,
    amount: 2200,
    currency: "EUR",
    ledger_type: "PAYMENT_GROSS",
    reference_type: "shop_payment",
    reference_id: String(VERKAUF_1),
    created_timestamp: am("2023-06-07"),
  },
  {
    entry_id: 900000002,
    amount: -118,
    currency: "EUR",
    ledger_type: "PAYMENT_PROCESSING_FEE",
    reference_type: "processing_fee",
    reference_id: String(VERKAUF_1),
    created_timestamp: am("2023-06-07"),
  },
  {
    entry_id: 900000003,
    amount: -19,
    currency: "EUR",
    ledger_type: "listing",
    reference_type: "listing",
    reference_id: "1470058658",
    created_timestamp: am("2023-06-07"),
  },
  {
    entry_id: 900000004,
    amount: -19,
    currency: "EUR",
    ledger_type: "renew_sold_auto",
    reference_type: "listing",
    reference_id: "1470071198",
    created_timestamp: am("2023-06-07"),
  },
  {
    entry_id: 900000005,
    amount: -143,
    currency: "EUR",
    ledger_type: "transaction",
    reference_type: "transaction",
    reference_id: "3588992730",
    created_timestamp: am("2023-06-07"),
  },
  {
    entry_id: 900000006,
    amount: 2495,
    currency: "EUR",
    ledger_type: "PAYMENT_GROSS",
    reference_type: "shop_payment",
    reference_id: String(VERKAUF_2),
    created_timestamp: am("2023-06-13"),
  },
  {
    entry_id: 900000007,
    amount: -2130,
    currency: "EUR",
    ledger_type: "prolist",
    reference_type: "prolist",
    reference_id: "1170673972595",
    created_timestamp: am("2023-06-13"),
  },
  {
    entry_id: 900000008,
    amount: -374,
    currency: "EUR",
    ledger_type: "offsite_ads_fee",
    reference_type: "receipt",
    reference_id: BESTELLUNG_2,
    created_timestamp: am("2023-06-13"),
  },
  {
    entry_id: 900000009,
    amount: -145,
    currency: "EUR",
    ledger_type: "sales_tax",
    reference_type: "receipt",
    reference_id: BESTELLUNG_2,
    created_timestamp: am("2023-06-13"),
  },
  {
    entry_id: 900000010,
    amount: -2900,
    currency: "EUR",
    ledger_type: "prolist",
    reference_type: "prolist",
    reference_id: "1148556226084",
    created_timestamp: am("2023-06-15"),
  },
  {
    entry_id: 900000011,
    amount: -2121,
    currency: "EUR",
    ledger_type: "REFUND_GROSS",
    reference_type: "payment_adjustment",
    reference_id: String(ERSTATTUNG),
    created_timestamp: am("2023-06-16"),
  },
  {
    entry_id: 900000012,
    amount: 2006,
    currency: "EUR",
    ledger_type: "RECOUP",
    reference_type: "recoupment",
    reference_id: "131745422754",
    created_timestamp: am("2023-06-16"),
  },
  {
    entry_id: 900000013,
    amount: -3490,
    currency: "EUR",
    ledger_type: "DISBURSE2",
    reference_type: "disbursement",
    reference_id: "133244522577",
    created_timestamp: am("2023-06-20"),
  },
  {
    // Einstellgebühr für ein weiteres verkauftes Stück; im echten Verlauf −0,19 € und −0,18 €
    entry_id: 900000014,
    amount: -19,
    currency: "EUR",
    ledger_type: "transaction_quantity",
    reference_type: "transaction",
    reference_id: "3588992730",
    created_timestamp: am("2023-06-20"),
  },
  {
    entry_id: 900000015,
    amount: -18,
    currency: "EUR",
    ledger_type: "renew_expired",
    reference_type: "listing",
    reference_id: "1319289841",
    created_timestamp: am("2023-06-25"),
  },
  {
    entry_id: 900000016,
    amount: 2175,
    currency: "EUR",
    ledger_type: "billing_payment",
    reference_type: "billing",
    reference_id: "131745422999",
    created_timestamp: am("2023-06-28"),
  },
  {
    // Transaktionsgebühr auf das Porto (Rechnungsposition „Transaction Fees“), kein Versand
    entry_id: 900000017,
    amount: -23,
    currency: "EUR",
    ledger_type: "shipping_transaction",
    reference_type: "receipt",
    reference_id: BESTELLUNG_2,
    created_timestamp: am("2023-06-13"),
  },
];

/** Wie der Payments-Abruf des Backoffice: Zahlungs- und Erstattungsnummer → Bestellnummer */
const orderFor = (referenceId: string) =>
  referenceId === String(VERKAUF_1) || referenceId === String(ERSTATTUNG) ? BESTELLUNG_1 : referenceId === String(VERKAUF_2) ? BESTELLUNG_2 : undefined;

const summe = (list: { amount: number }[]) => list.reduce((acc, t) => acc + t.amount, 0);

describe("Etsy-Zahlungsverlauf als Kontoauszug", () => {
  it("bündelt Gebühren und Werbung je Monat und Art wie die Positionen der Gebührenrechnung", () => {
    const statement = parseEtsyLedger(zeilen, { orderFor });
    const gebuehren = statement.transactions.filter((t) => t.purpose.startsWith("Gebühr"));
    const jeArt = Object.fromEntries(gebuehren.map((t) => [t.purpose, t.amount]));
    expect(jeArt).toEqual({
      // Einstellgebühr 19 und Mengengebühr 19 (Rechnungsposition „Listing Fees“)
      "Gebühr · Einstellgebühren (Listing Fees) 2023-06": -38,
      "Gebühr · Verlängerungen (Renew Expired Fees) 2023-06": -18,
      "Gebühr · Verlängerungen nach Verkauf (Renew Sold Fees) 2023-06": -19,
      // Transaktionsgebühr 143 und Portogebühr 23
      "Gebühr · Transaktionsgebühren (Transaction Fees) 2023-06": -166,
      "Gebühr · Zahlungsabwicklung (Processing Fees) 2023-06": -118,
      "Gebühr · Etsy Ads (Etsy Ads Fees) 2023-06": -5030,
      "Gebühr · Offsite Ads (Offsite Ads Fees) 2023-06": -374,
    });
    // Dieselbe Summe wie mit weniger Arten: Gebühren und Werbung des Monats zusammen
    expect(summe(gebuehren)).toBe(-5763);
    for (const gebuehr of gebuehren) {
      expect(gebuehr.bookingDate).toBe("2023-06-30");
    }
    expect(statement.transactions.find((t) => t.purpose.includes("Etsy Ads"))?.type).toBe("Werbung");
    expect(statement.transactions.find((t) => t.purpose.includes("Offsite Ads"))?.type).toBe("Werbung");
    expect(statement.transactions.find((t) => t.purpose.includes("Einstellgebühren"))?.bankReference).toBe("etsy-einstellgebuehren-2023-06");
  });

  it("bucht Verkauf und Erstattung einzeln mit der Bestellnummer", () => {
    const statement = parseEtsyLedger(zeilen, { orderFor });
    const verkaeufe = statement.transactions.filter((t) => t.type === "Verkauf");
    // Der zweite Verkauf ohne die Sales Tax derselben Bestellung (2495 − 145), siehe nächster Test
    expect(verkaeufe.map((t) => t.amount)).toEqual([2200, 2350]);
    expect(verkaeufe[0]?.purpose).toBe(`Verkauf · Etsy Bestellung ${BESTELLUNG_1}`);
    expect(verkaeufe[0]?.bankReference).toBe("etsy-900000001");
    const erstattung = statement.transactions.filter((t) => t.type === "Erstattung");
    expect(erstattung).toHaveLength(1);
    expect(erstattung[0]?.amount).toBe(-2121);
    expect(erstattung[0]?.purpose).toBe(`Erstattung · Etsy Bestellung ${BESTELLUNG_1}`);
  });

  it("verrechnet die Sales Tax mit dem Verkauf derselben Bestellung am selben Tag, wie der CSV-Import", () => {
    const statement = parseEtsyLedger(zeilen, { orderFor });
    expect(statement.transactions.filter((t) => t.type === "Umsatzsteuer")).toHaveLength(0);
    const verkauf = statement.transactions.find((t) => t.purpose.startsWith(`Verkauf · Etsy Bestellung ${BESTELLUNG_2}`));
    expect(verkauf?.amount).toBe(2350);
    // Der Zweck sagt, warum der Verkauf unter der Zahlung des Käufers liegt
    expect(verkauf?.purpose).toBe(`Verkauf · Etsy Bestellung ${BESTELLUNG_2} · Sales Tax 1,45 € von Etsy abgeführt`);
    expect(statement.warnings.join(" ")).not.toContain("Steuerzeile");
  });

  it("verrechnet die erstattete Sales Tax mit der Erstattung derselben Bestellung", () => {
    const statement = parseEtsyLedger(
      [
        { entry_id: 1, amount: 1486, currency: "EUR", ledger_type: "PAYMENT_GROSS", reference_id: String(VERKAUF_1), created_timestamp: am("2023-01-03") },
        { entry_id: 2, amount: -237, currency: "EUR", ledger_type: "sales_tax", reference_id: BESTELLUNG_1, created_timestamp: am("2023-01-03") },
        { entry_id: 3, amount: -1486, currency: "EUR", ledger_type: "REFUND_GROSS", reference_id: String(ERSTATTUNG), created_timestamp: am("2023-01-03") },
        { entry_id: 4, amount: 237, currency: "EUR", ledger_type: "sales_tax_refund", reference_id: BESTELLUNG_1, created_timestamp: am("2023-01-03") },
      ],
      { orderFor },
    );
    expect(statement.transactions.map((t) => [t.type, t.amount, t.purpose])).toEqual([
      ["Verkauf", 1249, `Verkauf · Etsy Bestellung ${BESTELLUNG_1} · Sales Tax 2,37 € von Etsy abgeführt`],
      ["Erstattung", -1249, `Erstattung · Etsy Bestellung ${BESTELLUNG_1} · Sales Tax 2,37 € von Etsy abgeführt`],
    ]);
  });

  it("lässt eine Sales Tax ohne Verkauf am selben Tag mit Bestellnummer einzeln stehen und meldet sie", () => {
    const statement = parseEtsyLedger(
      [{ entry_id: 5, amount: -106, currency: "EUR", ledger_type: "sales_tax", reference_id: BESTELLUNG_2, created_timestamp: am("2024-05-08") }],
      { orderFor },
    );
    expect(statement.transactions).toHaveLength(1);
    expect(statement.transactions[0]?.type).toBe("Umsatzsteuer");
    expect(statement.transactions[0]?.purpose).toBe(`Sales Tax · Etsy Bestellung ${BESTELLUNG_2}`);
    expect(statement.transactions[0]?.amount).toBe(-106);
    expect(statement.warnings.join(" ")).toContain("Steuerzeile ohne Verkauf");
  });

  it("bildet keine zweite Sammelzeile für einen Monat, der schon im Konto gebündelt steht", () => {
    const schon = new Set(["etsyads-2023-06", "offsiteads-2023-06", "einstellgebuehren-2023-06"]);
    const statement = parseEtsyLedger(zeilen, { orderFor, schonGebuendelt: schon });
    const gebuehren = statement.transactions.filter((t) => t.purpose.startsWith("Gebühr")).map((t) => t.purpose);
    expect(gebuehren.sort()).toEqual([
      "Gebühr · Transaktionsgebühren (Transaction Fees) 2023-06",
      "Gebühr · Verlängerungen (Renew Expired Fees) 2023-06",
      "Gebühr · Verlängerungen nach Verkauf (Renew Sold Fees) 2023-06",
      "Gebühr · Zahlungsabwicklung (Processing Fees) 2023-06",
    ]);
    // drei Werbezeilen und zwei Einstellgebühren
    expect(statement.warnings.join(" ")).toContain("5 Gebühren- und Werbezeile(n) aus einem schon gebündelten Monat");
    expect(statement.transactions.filter((t) => t.type === "Verkauf")).toHaveLength(2);
  });

  it("hält Auszahlung, Karteneinzug und Verrechnung von den Gebühren getrennt", () => {
    const statement = parseEtsyLedger(zeilen, { orderFor });
    const auszahlung = statement.transactions.find((t) => t.type === "Auszahlung");
    expect(auszahlung?.amount).toBe(-3490);
    expect(auszahlung?.purpose.startsWith("Auszahlung")).toBe(true);
    expect(statement.transactions.find((t) => t.type === "Karteneinzug")?.amount).toBe(2175);
    expect(statement.transactions.find((t) => t.type === "Verrechnung")?.amount).toBe(2006);
  });

  it("übernimmt ohne Bündelung jede Zeile einzeln", () => {
    const statement = parseEtsyLedger(zeilen, { orderFor, sammelzeilen: false });
    // 17 Zeilen; die Sales Tax geht im Verkauf derselben Bestellung auf
    expect(statement.transactions).toHaveLength(16);
    // Sieben Gebührenzeilen (mit Porto- und Mengengebühr) und drei Werbezeilen einzeln
    expect(statement.transactions.filter((t) => t.type === "Gebühr")).toHaveLength(7);
    expect(statement.transactions.filter((t) => t.type === "Werbung")).toHaveLength(3);
    expect(statement.transactions.filter((t) => t.type === "Umsatzsteuer")).toHaveLength(0);
    // Jeder Cent des Verlaufs kommt an, mit und ohne Bündelung
    expect(summe(statement.transactions)).toBe(summe(zeilen));
    expect(summe(parseEtsyLedger(zeilen, { orderFor }).transactions)).toBe(summe(zeilen));
  });

  it("meldet unbekannte Typen und überspringt Fremdwährung", () => {
    const statement = parseEtsyLedger(
      [
        ...zeilen,
        { entry_id: 900000099, amount: -100, currency: "EUR", ledger_type: "etwas_neues", created_timestamp: am("2023-06-29") },
        { entry_id: 900000098, amount: -500, currency: "USD", ledger_type: "PAYMENT_GROSS", created_timestamp: am("2023-06-29") },
      ],
      { orderFor },
    );
    expect(statement.warnings.join(" ")).toContain("unbekanntem Typ (etwas_neues)");
    expect(statement.warnings.join(" ")).toContain("nicht in Euro");
    expect(statement.transactions.some((t) => t.amount === -100 && t.type === "etwas_neues")).toBe(true);
    expect(statement.transactions.some((t) => t.amount === -500)).toBe(false);
  });

  it("lässt Gebühren eines noch laufenden Monats liegen", () => {
    // Bündeln nur bis Mai: die Juni-Gebühren kommen erst mit dem Abruf im Juli als Sammelzeile
    const statement = parseEtsyLedger(zeilen, { orderFor, gebuehrenBis: "2023-05-31" });
    expect(statement.transactions.filter((t) => t.purpose.startsWith("Gebühr"))).toHaveLength(0);
    expect(statement.transactions.filter((t) => t.type === "Umsatzsteuer")).toHaveLength(0);
    expect(statement.warnings.join(" ")).toContain("noch laufenden Monat");
    // Verkäufe, Erstattung und Auszahlung kommen trotzdem
    expect(statement.transactions.filter((t) => t.type === "Verkauf")).toHaveLength(2);
    expect(statement.transactions.filter((t) => t.type === "Auszahlung")).toHaveLength(1);
  });

  it("findet die Bestellnummer auch, wenn Etsy die Kennung als Zahl liefert", () => {
    const zahl = 5000000003;
    const statement = parseEtsyLedger(
      [
        {
          entry_id: 900000200,
          amount: 1000,
          currency: "EUR",
          ledger_type: "PAYMENT_GROSS",
          reference_id: zahl,
          created_timestamp: am("2023-06-10"),
        },
      ],
      { orderFor: (referenceId) => (referenceId === String(zahl) ? "1000000009" : undefined) },
    );
    expect(statement.transactions[0]?.purpose).toBe("Verkauf · Etsy Bestellung 1000000009");
  });

  it("setzt den Zeitraum aus den Buchungstagen", () => {
    const statement = parseEtsyLedger(zeilen, { orderFor });
    expect(statement.periodFrom).toBe("2023-06-07");
    expect(statement.periodTo).toBe("2023-06-30");
    expect(statement.format).toBe("etsy-ledger");
    expect(statement.currency).toBe("EUR");
  });
});
