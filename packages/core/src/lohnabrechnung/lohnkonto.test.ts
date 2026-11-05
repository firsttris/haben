import { describe, expect, it } from "vitest";
import { lohnkonto, lohnkontoCsv, type LohnkontoMitarbeiter, type LohnkontoZeile } from "./lohnkonto.ts";

const ERIKA: LohnkontoMitarbeiter = {
  vorname: "Erika",
  nachname: "Muster",
  geburtsdatum: "1980-04-12",
  anschrift: ["Lindenweg 1", "28195 Bremen"],
  steuerId: "86095742719",
  personalnummer: "1",
  eintritt: "2024-01-01",
  austritt: null,
  merkmale: "Steuerklasse I, Kinderfreibeträge 0, evangelisch",
  sozialversicherung: "Gesellschafter-Geschäftsführer ohne SV-Pflicht",
};

const zeile = (monat: number, mehr: Partial<LohnkontoZeile> = {}): LohnkontoZeile => ({
  zahltag: `2026-${String(monat).padStart(2, "0")}-28`,
  monat,
  storno: false,
  merkmale: "StKl I, Kfb 0, ev",
  brutto: 6000_00,
  steuerBrutto: 6000_00,
  steuerfrei: 0,
  pauschalBrutto: 0,
  lohnsteuer: 1289_33,
  soli: 0,
  kirchensteuer: 116_03,
  pauschsteuer: 0,
  svArbeitnehmer: 0,
  svArbeitgeber: 0,
  netto: 4594_64,
  ...mehr,
});

describe("Lohnkonto (§ 41 EStG, § 4 LStDV)", () => {
  it("ordnet nach Zahltag, rechnet ein Storno als negative Zeile in die Summe und nennt die Aufbewahrung", () => {
    const storno = zeile(10, {
      zahltag: "2026-11-03",
      storno: true,
      brutto: -6000_00,
      steuerBrutto: -6000_00,
      lohnsteuer: -1289_33,
      kirchensteuer: -116_03,
      netto: -4594_64,
    });
    const k = lohnkonto(2026, ERIKA, [zeile(11, { zahltag: "2026-11-27" }), storno, zeile(10)]);
    expect(k.zeilen.map((z) => [z.zahltag, z.storno])).toEqual([
      ["2026-10-28", false],
      ["2026-11-03", true],
      ["2026-11-27", false],
    ]);
    expect(k.summe.brutto).toBe(6000_00);
    expect(k.summe.lohnsteuer).toBe(1289_33);
    // § 41 Abs. 1 Satz 9 EStG: bis zum Ablauf des sechsten Kalenderjahres nach der letzten Lohnzahlung
    expect(k.aufbewahrenBis).toBe("2032-12-31");
  });

  it("ohne Zahlung keine Frist", () => {
    expect(lohnkonto(2026, ERIKA, []).aufbewahrenBis).toBeNull();
  });

  it("CSV mit Kopf zur Person, Spalten nach § 4 Abs. 2 LStDV und Summe", () => {
    const csv = lohnkontoCsv(lohnkonto(2026, ERIKA, [zeile(10)]));
    const zeilen = csv.replace(/^﻿/, "").split("\r\n");
    expect(zeilen[0]).toBe("Lohnkonto;2026");
    expect(zeilen).toContain("Geburtsdatum;12.04.1980");
    expect(zeilen).toContain("Anschrift;Lindenweg 1, 28195 Bremen");
    expect(zeilen).toContain(
      "Tag der Zahlung;Zeitraum;Art;Merkmale;Bruttoarbeitslohn;Steuerpflichtig;Steuerfrei;Pauschal besteuert;Lohnsteuer;Solidaritätszuschlag;Kirchensteuer;Pauschsteuer;SV Arbeitnehmer;SV Arbeitgeber;Netto",
    );
    expect(zeilen).toContain("28.10.2026;10/2026;Abrechnung;StKl I, Kfb 0, ev;6000,00;6000,00;0,00;0,00;1289,33;0,00;116,03;0,00;0,00;0,00;4594,64");
    expect(zeilen).toContain("Summe;;;;6000,00;6000,00;0,00;0,00;1289,33;0,00;116,03;0,00;0,00;0,00;4594,64");
  });
});
