import { describe, expect, it } from "vitest";
import { parseEtsyLedger, type EtsyLedgerEntry } from "./etsy-ledger.ts";

/*
 * Beispieldaten in der Form des echten Verlaufs (Juni 2023), Beträge und Typen wie dort, Kennungen erfunden:
 * im Repository stehen keine echten Bestellnummern. Die echten Zahlen des Monats stehen in der Gebührenrechnung
 * (116,57 €) und wurden gegen den vollständigen Verlauf geprüft.
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
    entry_id: 900000014,
    amount: 0,
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
];

/** Wie der Payments-Abruf des Backoffice: Zahlungs- und Erstattungsnummer → Bestellnummer */
const orderFor = (referenceId: string) =>
  referenceId === String(VERKAUF_1) || referenceId === String(ERSTATTUNG) ? BESTELLUNG_1 : referenceId === String(VERKAUF_2) ? BESTELLUNG_2 : undefined;

const summe = (list: { amount: number }[]) => list.reduce((acc, t) => acc + t.amount, 0);

describe("Etsy-Zahlungsverlauf als Kontoauszug", () => {
  it("bündelt Gebühren, Werbung und Steuer je Monat und lässt Verkäufe einzeln", () => {
    const statement = parseEtsyLedger(zeilen, { orderFor });
    const gebuehren = statement.transactions.filter((t) => t.purpose.startsWith("Gebühr"));
    expect(gebuehren.map((t) => t.purpose).sort()).toEqual([
      "Gebühr · Einstellgebühren 2023-06",
      "Gebühr · Transaktionsgebühren 2023-06",
      "Gebühr · Werbung 2023-06",
      "Gebühr · Zahlungsabwicklung 2023-06",
    ]);
    // Einstellgebühren 19 + 19 + 18, Transaktionsgebühr 143, Zahlungsabwicklung 118, Werbung 2130 + 2900 + 374
    expect(summe(gebuehren)).toBe(-56 - 143 - 118 - 5404);
    for (const gebuehr of gebuehren) {
      expect(gebuehr.bookingDate).toBe("2023-06-30");
    }
    expect(statement.transactions.find((t) => t.purpose.includes("Werbung"))?.type).toBe("Werbung");
    expect(statement.transactions.find((t) => t.purpose.includes("Einstellgebühren"))?.bankReference).toBe("etsy-einstellgebuehren-2023-06");
  });

  it("bucht Verkauf und Erstattung einzeln mit der Bestellnummer", () => {
    const statement = parseEtsyLedger(zeilen, { orderFor });
    const verkaeufe = statement.transactions.filter((t) => t.type === "Verkauf");
    expect(verkaeufe.map((t) => t.amount)).toEqual([2200, 2495]);
    expect(verkaeufe[0]?.purpose).toBe(`Verkauf · Etsy Bestellung ${BESTELLUNG_1}`);
    expect(verkaeufe[0]?.bankReference).toBe("etsy-900000001");
    const erstattung = statement.transactions.filter((t) => t.type === "Erstattung");
    expect(erstattung).toHaveLength(1);
    expect(erstattung[0]?.amount).toBe(-2121);
    expect(erstattung[0]?.purpose).toBe(`Erstattung · Etsy Bestellung ${BESTELLUNG_1}`);
  });

  it("bündelt die Steuer des Käufers als eigene Monatszeile", () => {
    const statement = parseEtsyLedger(zeilen, { orderFor });
    const steuer = statement.transactions.filter((t) => t.type === "Umsatzsteuer");
    expect(steuer).toHaveLength(1);
    expect(steuer[0]?.amount).toBe(-145);
    expect(steuer[0]?.purpose).toBe("Umsatzsteuer · Sales Tax 2023-06");
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
    // 16 Zeilen, davon eine Mengenzeile ohne Betrag
    expect(statement.transactions).toHaveLength(15);
    // Fünf Gebührenzeilen, drei Werbezeilen einzeln, dazu die Steuerzeile des Käufers
    expect(statement.transactions.filter((t) => t.type === "Gebühr")).toHaveLength(5);
    expect(statement.transactions.filter((t) => t.type === "Werbung")).toHaveLength(3);
    expect(statement.transactions.filter((t) => t.type === "Umsatzsteuer")).toHaveLength(1);
    expect(summe(statement.transactions)).toBe(-2601);
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

  it("setzt den Zeitraum aus den Buchungstagen", () => {
    const statement = parseEtsyLedger(zeilen, { orderFor });
    expect(statement.periodFrom).toBe("2023-06-07");
    expect(statement.periodTo).toBe("2023-06-30");
    expect(statement.format).toBe("etsy-ledger");
    expect(statement.currency).toBe("EUR");
  });
});
