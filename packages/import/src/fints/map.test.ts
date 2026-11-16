import { Mt940Parser, type Statement, type Transaction } from "lib-fints";
import { describe, expect, it } from "vitest";
import { withDedupHashes } from "../dedup.ts";
import { fintsCents, fintsDay, fintsStatement, mapFintsTransaction } from "./map.ts";

/** Tagesauszug wie von einer Sparkasse oder Volksbank: zwei SEPA-Umsätze mit Strukturfeldern im :86: */
const MT940 = [
  ":20:STARTUMSE",
  ":25:12030000/0000202051",
  ":28C:00000/001",
  ":60F:C261001EUR1000,00",
  ":61:2610051005CR100,00NTRFNONREF//BANKREF1",
  ":86:166?00SEPA-GUTSCHRIFT?109310?20EREF+RE-2026-0042?21SVWZ+Rechnung RE-2026-0042 Dan?22ke?30BYLADEM1001?31DE89370400440532013000?32Muster GmbH",
  ":61:2610201020DR49,99NDDTNONREF//BANKREF2",
  ":86:105?00SEPA-LASTSCHRIFT?109248?20EREF+T-1?21MREF+M-42?22CRED+DE98ZZZ09999999999?23SVWZ+Telefon 10/2026?30DRESDEFF?31DE02120300000000202051?32Telekom Deutschland",
  ":62F:C261020EUR1050,01",
  "-",
].join("\r\n");

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    valueDate: new Date(2026, 9, 5),
    entryDate: new Date(2026, 9, 5),
    fundsCode: "R",
    amount: 100,
    transactionType: "NTRF",
    customerReference: "NONREF",
    bankReference: "B1",
    purpose: "Rechnung",
    remoteName: "Muster GmbH",
    remoteAccountNumber: "DE89370400440532013000",
    ...overrides,
  };
}

function statement(transactions: Transaction[], closing?: { date: Date; value: number; currency?: string }): Statement {
  return {
    openingBalance: { date: new Date(2026, 9, 1), currency: "EUR", value: 0 },
    transactions,
    closingBalance: closing ? { currency: "EUR", ...closing } : (undefined as never),
  };
}

describe("fintsCents", () => {
  it("rechnet Beträge mit höchstens zwei Nachkommastellen genau in Cent", () => {
    expect(fintsCents(1234.56)).toBe(123456);
    expect(fintsCents(-49.99)).toBe(-4999);
    expect(fintsCents(0.1 + 0.2 - 0.3 + 0.07)).toBeNull();
    expect(fintsCents(0.07)).toBe(7);
    expect(fintsCents(1_000_000)).toBe(100_000_000);
    expect(fintsCents(-0)).toBe(0);
  });

  it("lehnt mehr als zwei Nachkommastellen und keine Zahl ab", () => {
    expect(fintsCents(1.005)).toBeNull();
    expect(fintsCents(Number.NaN)).toBeNull();
    expect(fintsCents(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("fintsDay", () => {
  it("nimmt den Tag aus den lokalen Feldern, wie lib-fints ihn anlegt", () => {
    expect(fintsDay(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(fintsDay(new Date(2026, 11, 31, 12))).toBe("2026-12-31");
    expect(fintsDay(new Date(Number.NaN))).toBeUndefined();
    expect(fintsDay(undefined)).toBeUndefined();
  });
});

describe("mapFintsTransaction", () => {
  it("übernimmt Gegenpartei, Referenzen und Lastschriftdaten", () => {
    const mapped = mapFintsTransaction(
      tx({
        amount: -49.99,
        entryDate: new Date(2026, 9, 20),
        valueDate: new Date(2026, 9, 21),
        remoteName: "Telekom  Deutschland",
        remoteAccountNumber: "DE02 1203 0000 0000 2020 51",
        bookingText: "SEPA-LASTSCHRIFT",
        e2eReference: "T-1",
        mandateReference: "M-42",
        remoteIdentifier: "DE98ZZZ09999999999",
        bankReference: "NONREF",
      }),
      "EUR",
      3,
    );
    expect(mapped).toEqual({
      bookingDate: "2026-10-20",
      valueDate: "2026-10-21",
      amount: -4999,
      currency: "EUR",
      counterpartyName: "Telekom Deutschland",
      counterpartyIban: "DE02120300000000202051",
      purpose: "Rechnung",
      type: "SEPA-LASTSCHRIFT",
      bankReference: "NONREF",
      endToEndId: "T-1",
      creditorId: "DE98ZZZ09999999999",
      mandateReference: "M-42",
      index: 3,
    });
  });

  it("lässt NOTPROVIDED, alte Kontonummern und die Kennung ohne Mandat weg", () => {
    const mapped = mapFintsTransaction(
      tx({ e2eReference: "NOTPROVIDED", bankReference: "", remoteAccountNumber: "0532013000", remoteIdentifier: "DE98ZZZ09999999999" }),
      "EUR",
      0,
    );
    expect(mapped?.endToEndId).toBeUndefined();
    expect(mapped?.bankReference).toBeUndefined();
    expect(mapped?.counterpartyIban).toBeUndefined();
    expect(mapped?.creditorId).toBeUndefined();
  });

  it("gibt null ohne gültigen Betrag oder Tag", () => {
    expect(mapFintsTransaction(tx({ amount: 1.005 }), "EUR", 0)).toBeNull();
    expect(mapFintsTransaction(tx({ entryDate: new Date(Number.NaN), valueDate: new Date(Number.NaN) }), "EUR", 0)).toBeNull();
  });
});

describe("fintsStatement", () => {
  it("liest einen MT940-Auszug über lib-fints wie eine Datei", () => {
    const statements = new Mt940Parser(MT940).parse();
    const result = fintsStatement({ iban: "DE02120300000000202051", accountName: "Girokonto", statements, dateFrom: "2026-10-01", dateTo: "2026-10-20" });
    expect(result.format).toBe("fints");
    expect(result.accountIban).toBe("DE02120300000000202051");
    expect(result.periodFrom).toBe("2026-10-01");
    expect(result.periodTo).toBe("2026-10-20");
    expect(result.transactions.map((t) => [t.bookingDate, t.amount, t.counterpartyName, t.counterpartyIban, t.purpose])).toEqual([
      ["2026-10-05", 10000, "Muster GmbH", "DE89370400440532013000", "Rechnung RE-2026-0042 Danke"],
      ["2026-10-20", -4999, "Telekom Deutschland", "DE02120300000000202051", "Telefon 10/2026"],
    ]);
    expect(result.transactions[1]).toMatchObject({ endToEndId: "T-1", mandateReference: "M-42", creditorId: "DE98ZZZ09999999999", type: "SEPA-LASTSCHRIFT" });
    expect(result.closingBalance).toBe(105001);
    expect(result.openingBalance).toBe(100000);
    expect(result.warnings).toEqual([]);
  });

  it("sortiert nach Buchungstag und behält die Reihenfolge der Bank an einem Tag", () => {
    const day = (d: number) => new Date(2026, 9, d);
    const result = fintsStatement({
      iban: "DE02120300000000202051",
      statements: [
        statement([tx({ entryDate: day(7), purpose: "c" }), tx({ entryDate: day(5), purpose: "a" })]),
        statement([tx({ entryDate: day(5), purpose: "b" })]),
      ],
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
    expect(result.transactions.map((t) => [t.purpose, t.index])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("gibt gleichen Umsätzen bei jedem Abruf denselben Hash", () => {
    const zweiGleiche = [tx({ purpose: "Kaffee", amount: -3 }), tx({ purpose: "Kaffee", amount: -3 })];
    const erster = withDedupHashes(
      fintsStatement({ iban: "DE02120300000000202051", statements: [statement(zweiGleiche)], dateFrom: "2026-10-01", dateTo: "2026-10-05" }).transactions,
    );
    const zweiter = withDedupHashes(
      fintsStatement({ iban: "DE02120300000000202051", statements: [statement([...zweiGleiche])], dateFrom: "2026-09-28", dateTo: "2026-10-06" }).transactions,
    );
    expect(new Set(erster.map((t) => t.dedupHash)).size).toBe(2);
    expect(zweiter.map((t) => t.dedupHash)).toEqual(erster.map((t) => t.dedupHash));
  });

  it("nimmt den spätesten Endsaldo, der zum Abruf passt, und meldet übersprungene Umsätze", () => {
    const result = fintsStatement({
      iban: "DE02120300000000202051",
      statements: [
        statement([tx({ amount: 100, entryDate: new Date(2026, 9, 5) })], { date: new Date(2026, 9, 5), value: 600 }),
        statement([tx({ amount: 1.005, bankReference: "KAPUTT" })], { date: new Date(2026, 9, 6), value: 600 }),
        statement([], { date: new Date(2026, 10, 2), value: 999 }),
      ],
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
    expect(result.transactions).toHaveLength(1);
    expect(result.warnings).toEqual(["Umsatz KAPUTT ohne gültiges Datum oder Betrag übersprungen."]);
    expect(result.statedBalance).toEqual({ date: "2026-10-06", amount: 60000 });
    expect(result.openingBalance).toBe(50000);
  });

  it("setzt das Jahr des Buchungstags aus MT940 nach der Wertstellung, auch wenn die Buchung im Folgemonat liegt", () => {
    // :61: nennt die Wertstellung mit Jahr (JJMMTT), den Buchungstag ohne (MMTT): Kartenzahlung am 30.04., gebucht am 02.05.;
    // Entgelt mit Wertstellung 31.12., gebucht am 04.01. des Folgejahres
    const auszug = (zeilen: string[]) => [":20:STARTUMSE", ":25:12030000/0000202051", ":28C:00000/001", ...zeilen, "-"].join("\r\n");
    const statements = new Mt940Parser(
      [
        auszug([":60F:C260430EUR1000,00", ":61:2604300502DR12,50NMSCNONREF", ":86:106?00KARTENZAHLUNG?20SVWZ+Baeckerei 30.04.", ":62F:C260502EUR987,50"]),
        auszug([":60F:C261231EUR987,50", ":61:2612310104DR3,00NCHGNONREF", ":86:805?00ENTGELT?20SVWZ+Kontofuehrung 4. Quartal", ":62F:C270104EUR984,50"]),
      ].join("\r\n"),
    ).parse();
    const result = fintsStatement({ iban: "DE02120300000000202051", statements, dateFrom: "2026-04-01", dateTo: "2027-01-04" });
    expect(result.transactions.map((t) => [t.bookingDate, t.valueDate, t.amount])).toEqual([
      ["2026-05-02", "2026-04-30", -1250],
      ["2027-01-04", "2026-12-31", -300],
    ]);
  });

  it("übernimmt keinen Saldo in Fremdwährung und meldet einen Stichtag nach dem Abruf", () => {
    const fremd = fintsStatement({
      iban: "DE02120300000000202051",
      statements: [statement([], { date: new Date(2026, 9, 5), value: 10, currency: "USD" })],
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
    expect(fremd.statedBalance).toBeUndefined();
    const spaeter = fintsStatement({
      iban: "DE02120300000000202051",
      statements: [statement([], { date: new Date(2026, 10, 2), value: 10 })],
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
    expect(spaeter.closingBalance).toBeUndefined();
    expect(spaeter.warnings[0]).toMatch(/passt nicht zum Zeitraum/);
  });
});
