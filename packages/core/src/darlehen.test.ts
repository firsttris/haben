import { describe, expect, it } from "vitest";
import { darlehenEuerZeile, darlehenKonto, darlehenPosting, darlehenStichtagFehler, darlehenTeilFehler, darlehenZinskonto, type Darlehen } from "./darlehen.ts";
import { computeEuer } from "./euer.ts";
import { postenForSaldo } from "./hgb.ts";
import { restlaufzeitLautKonto } from "./bilanzvermerke.ts";
import { kapgSteuern } from "./koerperschaft.ts";

/* Darlehen (Roadmap Platz 13, Prüffall 2 aus #312); Konten nach dem DATEV-Kontenrahmen 2026 (SKR03 11174, SKR04 11175) */

const hausbank: Darlehen = { geber: "bank", laufzeit: "ohne", zweck: "betrieb" };
const balanced = (lines: { debit: number; credit: number }[]) => lines.reduce((s, l) => s + l.debit, 0) === lines.reduce((s, l) => s + l.credit, 0);

describe("Konten nach Darlehensgeber und Restlaufzeit", () => {
  it.each([
    ["SKR03", "bank", ["0630", "0631", "0640", "0650"]],
    ["SKR03", "sonstige", ["1705", "1706", "1707", "1708"]],
    ["SKR04", "bank", ["3150", "3151", "3160", "3170"]],
    ["SKR04", "sonstige", ["3560", "3561", "3564", "3567"]],
  ] as const)("%s %s", (kr, geber, konten) => {
    expect((["ohne", "bis1", "bis5", "ueber5"] as const).map((laufzeit) => darlehenKonto({ geber, laufzeit }, kr))).toEqual(konten);
    // Verbindlichkeiten in der Bilanz; die Restlaufzeit vermerkt das Konto selbst (§ 268 Abs. 5 HGB), ohne Angabe die Nutzerin
    for (const konto of konten) expect(postenForSaldo(kr, konto, -1)).toBe("passiva.C");
    expect(konten.map((k) => restlaufzeitLautKonto(kr, k))).toEqual([null, "bis1", "ueber1", "ueber1"]);
  });

  it("Zinskonto nach Verwendung und Restlaufzeit", () => {
    expect(darlehenZinskonto(hausbank, "SKR03")).toBe("2120");
    expect(darlehenZinskonto({ ...hausbank, laufzeit: "bis1" }, "SKR03")).toBe("2110");
    expect(darlehenZinskonto({ ...hausbank, zweck: "anlagevermoegen" }, "SKR03")).toBe("2126");
    expect(darlehenZinskonto(hausbank, "SKR04")).toBe("7320");
    expect(darlehenZinskonto({ ...hausbank, laufzeit: "bis1" }, "SKR04")).toBe("7310");
    expect(darlehenZinskonto({ ...hausbank, zweck: "anlagevermoegen" }, "SKR04")).toBe("7326");
  });
});

describe("Prüffall 2: Rate von 1.000 € aus 800 € Tilgung und 200 € Zinsen", () => {
  it("Buchungen: Tilgung erfolgsneutral, Zinsen Aufwand, zusammen die ganze Abbuchung", () => {
    const lines = [...darlehenPosting(hausbank, "tilgung", -800_00, "SKR03"), ...darlehenPosting(hausbank, "zins", -200_00, "SKR03")];
    expect(lines).toEqual([
      { account: "1200", debit: 0, credit: 800_00, taxCode: null },
      { account: "0630", debit: 800_00, credit: 0, taxCode: null },
      { account: "1200", debit: 0, credit: 200_00, taxCode: null },
      { account: "2120", debit: 200_00, credit: 0, taxCode: null },
    ]);
    expect(balanced(lines)).toBe(true);
    expect(darlehenPosting({ ...hausbank, geber: "sonstige" }, "tilgung", -800_00, "SKR04")[1]!.account).toBe("3560");
  });

  it("EÜR: nur die Zinsen als Schuldzinsen, die Tilgung nicht", () => {
    const euer = computeEuer(2026, [
      { kind: "darlehen", date: "2026-03-31", amount: -800_00, zweck: "betrieb", teil: "tilgung", group: "r" },
      { kind: "darlehen", date: "2026-03-31", amount: -200_00, zweck: "betrieb", teil: "zins", group: "r" },
    ]);
    expect(euer.ausgaben.find((l) => l.key === "schuldzinsen")?.amount).toBe(200_00);
    expect(euer.totalAusgaben).toBe(200_00);
    expect(euer.monthly.ausgaben[2]).toBe(200_00);
  });

  it("Auszahlung erfolgsneutral; Zinsen und Gebühr für Anlagevermögen in eigener Zeile", () => {
    const euer = computeEuer(2026, [
      { kind: "darlehen", date: "2026-01-15", amount: 20_000_00, zweck: "anlagevermoegen", teil: "auszahlung" },
      { kind: "darlehen", date: "2026-01-15", amount: -150_00, zweck: "anlagevermoegen", teil: "gebuehr" },
      { kind: "darlehen", date: "2026-02-15", amount: -80_00, zweck: "anlagevermoegen", teil: "zins" },
    ]);
    expect(euer.totalEinnahmen).toBe(0);
    expect(euer.ausgaben.find((l) => l.key === "schuldzinsenAnlage")?.amount).toBe(230_00);
    expect(darlehenEuerZeile("betrieb", "tilgung")).toBeNull();
  });

  it("Richtung und Bestand: Tilgung höchstens bis zum Bestand, Auszahlung nur als Eingang", () => {
    expect(darlehenTeilFehler("tilgung", -800_00, 10_000_00)).toBeNull();
    expect(darlehenTeilFehler("tilgung", -800_00, 500_00)).toMatch(/höher als der Bestand des Darlehens \(500,00\s€\)/);
    expect(darlehenTeilFehler("tilgung", 800_00, 10_000_00)).toMatch(/Ausgang/);
    expect(darlehenTeilFehler("auszahlung", -1, 0)).toMatch(/Eingang/);
    expect(darlehenTeilFehler("zins", 20_00, 0)).toBeNull();
  });

  it("Stichtag nach Tagesabschluss: Auszahlung und Tilgung bis einschließlich Stichtag stecken in der Restschuld (#325)", () => {
    expect(darlehenStichtagFehler("tilgung", "2026-11-30", "2026-11-30")).toMatch(/zum 30\.11\.2026 .* vom 30\.11\.2026 .* als Tilgung/);
    expect(darlehenStichtagFehler("auszahlung", "2026-11-29", "2026-11-30")).toMatch(/als Auszahlung/);
    expect(darlehenStichtagFehler("tilgung", "2026-12-01", "2026-11-30")).toBeNull();
    // Zinsen und Gebühren ändern den Bestand nicht, ein neues Darlehen hat keinen Stichtag
    expect(darlehenStichtagFehler("zins", "2026-11-15", "2026-11-30")).toBeNull();
    expect(darlehenStichtagFehler("gebuehr", "2026-11-15", "2026-11-30")).toBeNull();
    expect(darlehenStichtagFehler("tilgung", "2020-01-01", null)).toBeNull();
  });
});

describe("GmbH: Zinsen zur Finanzierung des Anlagevermögens in der Hinzurechnung nach § 8 Nr. 1 a GewStG", () => {
  it.each([
    ["SKR03", "2126"],
    ["SKR04", "7326"],
  ] as const)("%s", (kr, konto) => {
    const s = kapgSteuern(kr, 2026, [{ account: konto, saldo: 30_000_000 }], 0, { hebesatz: 400, verlustvortragKst: 0, verlustvortragGewst: 0 });
    expect(s.gewstHinzurechnungen.find((z) => z.art === "zinsen")?.brutto).toBe(30_000_000);
  });
});
