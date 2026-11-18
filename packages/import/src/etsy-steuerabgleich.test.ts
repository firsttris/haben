import { describe, expect, it } from "vitest";
import { type EtsyLedgerEntry, parseEtsyLedger } from "./etsy-ledger.ts";

/*
 * Sales Tax über überlappende Abrufe (etsy-steuerabgleich.ts), ohne Datenbank: Was ein früherer Abruf schon übernommen
 * hat, kommt als `bekannt` mit der damals verrechneten Steuer herein. Gegen Postgres prüft das
 * apps/web/src/server/modules/etsy/abruf-ueberlappung.test.ts.
 */

const summe = (list: { amount: number }[]) => list.reduce((acc, t) => acc + t.amount, 0);

describe("Steuerabgleich des Etsy-Abrufs", () => {
  it("hält eine nachgetragene Steuer nicht für die schon verrechnete Steuer einer übernommenen Erstattung", () => {
    const bestellung = "1000000077";
    const zeit = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
    // Ein früherer Abruf hat Erstattung 110 mit ihrer Steuer +0,60 € verrechnet übernommen
    const bekannt = new Map([["110", { order: bestellung, verrechnet: 60 }]]);
    const entries: EtsyLedgerEntry[] = [
      // Von Etsy nachgetragen: Zeitstempel vor dem früheren Abruf, geliefert erst jetzt
      { entry_id: 112, amount: -500, currency: "EUR", ledger_type: "REFUND_GROSS", reference_id: "R2", created_timestamp: zeit("2023-06-20T11:00:00Z") },
      {
        entry_id: 113,
        amount: 30,
        currency: "EUR",
        ledger_type: "sales_tax_refund",
        reference_id: bestellung,
        created_timestamp: zeit("2023-06-20T11:00:00Z"),
      },
      { entry_id: 110, amount: -1000, currency: "EUR", ledger_type: "REFUND_GROSS", reference_id: "R1", created_timestamp: zeit("2023-06-20T12:00:00Z") },
      {
        entry_id: 111,
        amount: 60,
        currency: "EUR",
        ledger_type: "sales_tax_refund",
        reference_id: bestellung,
        created_timestamp: zeit("2023-06-20T12:00:00Z"),
      },
    ];

    const statement = parseEtsyLedger(entries, { orderFor: (r) => ({ R1: bestellung, R2: bestellung })[r], bekannt });

    const neu = statement.transactions.filter((t) => t.bankReference !== "etsy-110");
    expect(neu.reduce((summe, t) => summe + t.amount, 0)).toBe(-500 + 30);
  });

  it("erkennt zwei schon mit einem Verkauf verrechnete Steuerzeilen an ihrer Summe", () => {
    const bestellung = "1000000088";
    const zeit = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
    // Ein früherer Abruf hat beide Steuerzeilen mit dem einzigen Verkauf verrechnet: −1,00 € und −0,45 €
    const bekannt = new Map([["130", { order: bestellung, verrechnet: -145 }]]);
    const entries: EtsyLedgerEntry[] = [
      { entry_id: 130, amount: 2495, currency: "EUR", ledger_type: "PAYMENT_GROSS", reference_id: "P1", created_timestamp: zeit("2023-06-13T10:00:00Z") },
      { entry_id: 131, amount: -100, currency: "EUR", ledger_type: "sales_tax", reference_id: bestellung, created_timestamp: zeit("2023-06-13T10:00:00Z") },
      { entry_id: 132, amount: -45, currency: "EUR", ledger_type: "sales_tax", reference_id: bestellung, created_timestamp: zeit("2023-06-13T10:00:00Z") },
    ];

    const statement = parseEtsyLedger(entries, { orderFor: () => bestellung, bekannt });

    expect(statement.transactions.filter((t) => t.bankReference !== "etsy-130")).toEqual([]);
  });

  it("übernimmt bei schon verrechneter Steuer und gleicher Summe aus anderen Zeilen genau den Rest", () => {
    const bestellung = "1000000099";
    const zeit = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
    // Früher verrechnet: −1,00 € und −0,45 €; nachgetragen eine Zeile über −1,45 €, also dieselbe Summe
    const bekannt = new Map([["150", { order: bestellung, verrechnet: -145 }]]);
    const entries: EtsyLedgerEntry[] = [
      { entry_id: 150, amount: 2495, currency: "EUR", ledger_type: "PAYMENT_GROSS", reference_id: "P1", created_timestamp: zeit("2023-06-13T10:00:00Z") },
      { entry_id: 151, amount: -100, currency: "EUR", ledger_type: "sales_tax", reference_id: bestellung, created_timestamp: zeit("2023-06-13T10:00:00Z") },
      { entry_id: 152, amount: -45, currency: "EUR", ledger_type: "sales_tax", reference_id: bestellung, created_timestamp: zeit("2023-06-13T10:00:00Z") },
      { entry_id: 153, amount: -145, currency: "EUR", ledger_type: "sales_tax", reference_id: bestellung, created_timestamp: zeit("2023-06-13T14:00:00Z") },
    ];

    const statement = parseEtsyLedger(entries, { orderFor: () => bestellung, bekannt });

    const neu = statement.transactions.filter((t) => t.bankReference !== "etsy-150");
    expect(summe(neu)).toBe(-145);
    expect(neu.every((t) => t.type === "Umsatzsteuer")).toBe(true);
  });

  it("erkennt schon verrechnete Steuer auch bei mehr als 16 offenen Steuerzeilen am genauen Betrag", () => {
    const bestellung = "1000000111";
    const zeit = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
    // Früher mit dem Verkauf verrechnet: −1,00 €; dazu nachgetragen 16 Zeilen über je −0,01 €
    const bekannt = new Map([["160", { order: bestellung, verrechnet: -100 }]]);
    const nachgetragen: EtsyLedgerEntry[] = Array.from({ length: 16 }, (_, i) => ({
      entry_id: 200 + i,
      amount: -1,
      currency: "EUR",
      ledger_type: "sales_tax",
      reference_id: bestellung,
      created_timestamp: zeit("2023-06-13T14:00:00Z"),
    }));
    const entries: EtsyLedgerEntry[] = [
      { entry_id: 160, amount: 2495, currency: "EUR", ledger_type: "PAYMENT_GROSS", reference_id: "P1", created_timestamp: zeit("2023-06-13T10:00:00Z") },
      { entry_id: 161, amount: -100, currency: "EUR", ledger_type: "sales_tax", reference_id: bestellung, created_timestamp: zeit("2023-06-13T10:00:00Z") },
      ...nachgetragen,
    ];

    const statement = parseEtsyLedger(entries, { orderFor: () => bestellung, bekannt });

    expect(summe(statement.transactions.filter((t) => t.bankReference !== "etsy-160"))).toBe(-16);
  });

  it("erkennt schon verrechnete Steuer bei mehr als 16 offenen Steuerzeilen an der Summe aller", () => {
    const bestellung = "1000000112";
    const zeit = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
    // Früher mit dem Verkauf verrechnet: 17 Zeilen über je −0,01 €, zusammen −0,17 €
    const bekannt = new Map([["170", { order: bestellung, verrechnet: -17 }]]);
    const steuern: EtsyLedgerEntry[] = Array.from({ length: 17 }, (_, i) => ({
      entry_id: 300 + i,
      amount: -1,
      currency: "EUR",
      ledger_type: "sales_tax",
      reference_id: bestellung,
      created_timestamp: zeit("2023-06-13T10:00:00Z"),
    }));
    const entries: EtsyLedgerEntry[] = [
      { entry_id: 170, amount: 2495, currency: "EUR", ledger_type: "PAYMENT_GROSS", reference_id: "P1", created_timestamp: zeit("2023-06-13T10:00:00Z") },
      ...steuern,
    ];

    const statement = parseEtsyLedger(entries, { orderFor: () => bestellung, bekannt });

    expect(statement.transactions.filter((t) => t.bankReference !== "etsy-170")).toEqual([]);
  });
});
