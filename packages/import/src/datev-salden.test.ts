import { describe, expect, it } from "vitest";
import { datevSalden, hasOpeningBalances } from "./index.ts";

const b = (amount: number, side: "S" | "H", account: string, contraAccount: string, buKey = "") => ({ amount, side, account, contraAccount, buKey });

describe("Salden je Konto aus dem Buchungsstapel", () => {
  it("teilt Automatikkonten und BU-Schlüssel in netto und Steuer auf (SKR03)", () => {
    expect(
      datevSalden(
        [
          b(11900, "S", "1200", "8400"), // Erlös 19 % über Automatik
          b(10700, "H", "8300", "1200"), // Erlös 7 %, Konto und Gegenkonto vertauscht
          b(1190, "S", "4930", "1200", "9"), // Bürobedarf mit 19 % Vorsteuer
          b(2140, "S", "4940", "1200", "08"), // Fachliteratur mit 7 % Vorsteuer, BU zweistellig
          b(5000, "S", "1200", "8120"), // steuerfrei
        ],
        "SKR03",
      ),
    ).toEqual([
      { account: "1200", saldo: 11900 + 10700 - 1190 - 2140 + 5000 },
      { account: "1571", saldo: 140 },
      { account: "1576", saldo: 190 },
      { account: "1771", saldo: -700 },
      { account: "1776", saldo: -1900 },
      { account: "4930", saldo: 1000 },
      { account: "4940", saldo: 2000 },
      { account: "8120", saldo: -5000 },
      { account: "8300", saldo: -10000 },
      { account: "8400", saldo: -10000 },
    ]);
  });

  it("nimmt bei BU 40 den Betrag netto und lässt gebuchte Steuer stehen (SKR04)", () => {
    expect(
      datevSalden(
        [
          b(10000, "S", "1800", "4400", "40"),
          b(1900, "S", "1800", "3806"),
          b(11900, "S", "1800", "4400"), // Automatik 19 %
          b(5350, "S", "5300", "1800"), // Wareneingang 7 % über Automatik
        ],
        "SKR04",
      ),
    ).toEqual([
      { account: "1401", saldo: 350 },
      { account: "1800", saldo: 10000 + 1900 + 11900 - 5350 },
      { account: "3806", saldo: -1900 - 1900 },
      { account: "4400", saldo: -10000 - 10000 },
      { account: "5300", saldo: 5000 },
    ]);
  });

  it("bucht Debitoren und Kreditoren auf die Sammelkonten (SKR03)", () => {
    expect(
      datevSalden(
        [
          b(11900, "S", "10001", "8400"), // Ausgangsrechnung an Debitor
          b(11900, "S", "1200", "10001"), // Zahlungseingang
          b(5950, "H", "70001", "4930", "9"), // Eingangsrechnung von Kreditor
        ],
        "SKR03",
      ),
    ).toEqual([
      { account: "1200", saldo: 11900 },
      { account: "1576", saldo: 950 },
      { account: "1600", saldo: -5950 },
      { account: "1776", saldo: -1900 },
      { account: "4930", saldo: 5000 },
      { account: "8400", saldo: -10000 },
    ]);
  });

  it("bucht Debitoren und Kreditoren auf die Sammelkonten (SKR04)", () => {
    expect(datevSalden([b(11900, "S", "10001", "4400"), b(1190, "H", "70001", "6815", "9")], "SKR04")).toEqual([
      { account: "1200", saldo: 11900 },
      { account: "1406", saldo: 190 },
      { account: "3300", saldo: -1190 },
      { account: "3806", saldo: -1900 },
      { account: "4400", saldo: -10000 },
      { account: "6815", saldo: 1000 },
    ]);
  });

  it("kürzt fünfstellige Sachkonten und erkennt sechsstellige Personenkonten (Sachkontenlänge 5)", () => {
    expect(
      datevSalden(
        [
          { ...b(11900, "S", "100001", "84000"), accountLength: 5 },
          { ...b(11900, "S", "12000", "100001"), accountLength: 5 },
        ],
        "SKR03",
      ),
    ).toEqual([
      { account: "1200", saldo: 11900 },
      { account: "1776", saldo: -1900 },
      { account: "8400", saldo: -10000 },
    ]);
  });

  it("ergibt in der Summe immer null", () => {
    const salden = datevSalden([b(11900, "S", "1200", "8400"), b(2140, "S", "4940", "1200", "8"), b(333, "H", "8300", "1200")], "SKR03");
    expect(salden.reduce((s, r) => s + r.saldo, 0)).toBe(0);
  });
});

describe("Eröffnungsbilanz im Stapel", () => {
  it("erkennt Buchungen gegen die Saldenvortragskonten", () => {
    expect(hasOpeningBalances([b(500000, "S", "1200", "9000")])).toBe(true);
    expect(hasOpeningBalances([b(500000, "H", "9008", "10001")])).toBe(true);
    expect(hasOpeningBalances([b(11900, "S", "1200", "8400")])).toBe(false);
  });
});
