import { describe, expect, it } from "vitest";
import { kirchensteuerSatz } from "../income-tax.ts";
import { fehlendeLohnsteuerJahre, kirchensteuerSatzBasispunkte, LOHNSTEUER_JAHRE, type LohnsteuerEingabe, lohnkirchensteuer, lohnsteuer } from "./index.ts";

const MONAT: LohnsteuerEingabe = { LZZ: 2, RE4: 5000_00, STKL: 1 };

describe("lohnsteuer, Jahressperre", () => {
  it("rechnet nur Jahre mit hinterlegtem PAP, nie mit den Werten des Vorjahres", () => {
    expect(LOHNSTEUER_JAHRE).toEqual([2026]);
    expect(lohnsteuer(2026, MONAT).ok).toBe(true);
    expect(lohnsteuer(2027, MONAT)).toEqual({ ok: false, grund: "nicht-hinterlegt", meldung: "Lohnsteuer 2027 ist noch nicht hinterlegt." });
    expect(lohnsteuer(2025, MONAT)).toEqual({ ok: false, grund: "nicht-hinterlegt", meldung: "Lohnsteuer 2025 ist noch nicht hinterlegt." });
  });

  it("verlangt ab Dezember den PAP des Folgejahres", () => {
    expect(fehlendeLohnsteuerJahre(new Date("2026-01-01T12:00:00Z"))).toEqual([]);
    expect(fehlendeLohnsteuerJahre(new Date("2026-11-30T12:00:00Z"))).toEqual([]);
    expect(fehlendeLohnsteuerJahre(new Date("2026-12-01T12:00:00Z"))).toEqual([2027]);
    expect(fehlendeLohnsteuerJahre(new Date("2027-01-02T12:00:00Z"))).toEqual([2027]);
    expect(fehlendeLohnsteuerJahre(new Date("2025-12-31T12:00:00Z"))).toEqual([2025]);
  });

  // Liest als einziger Test das echte Datum: Ab Dezember schlägt er fehl, bis der PAP des nächsten Jahres
  // hinterlegt ist (docs/entwicklung.md, Abschnitt „Lohnsteuer: PAP jährlich aktualisieren“).
  it("Jahreswechsel (echtes Datum): PAP für dieses und ab Dezember das nächste Jahr ist hinterlegt", () => {
    expect(fehlendeLohnsteuerJahre(new Date())).toEqual([]);
  });
});

describe("lohnsteuer, nicht unterstützte Fälle", () => {
  it.each([
    ["SONSTB", { SONSTB: 1000_00 }, "sonstige Bezüge (SONSTB)"],
    ["MBV", { MBV: 1 }, "Vermögensbeteiligungen (MBV)"],
    ["VBEZ", { VBEZ: 500_00 }, "Versorgungsbezüge (VBEZ)"],
    ["ALTER1", { ALTER1: 1 }, "Altersentlastungsbetrag (ALTER1)"],
    ["LZZFREIB", { LZZFREIB: 100_00 }, "Freibetrag aus den ELStAM (LZZFREIB)"],
    ["LZZHINZU", { LZZHINZU: 100_00 }, "Hinzurechnungsbetrag aus den ELStAM (LZZHINZU)"],
    ["f", { STKL: 4, f: 950 }, "Faktorverfahren (f)"],
  ] as const)("lehnt %s ab, statt zu rechnen", (_, zusatz, text) => {
    expect(lohnsteuer(2026, { ...MONAT, ...zusatz })).toEqual({
      ok: false,
      grund: "nicht-unterstuetzt",
      meldung: `Lohnsteuer mit ${text} ist nicht unterstützt.`,
    });
  });

  it("nennt alle gesetzten Fälle und rechnet mit Nullwerten wie ohne sie", () => {
    const r = lohnsteuer(2026, { ...MONAT, SONSTB: 1, VBEZ: 1 });
    expect(r.ok === false && r.meldung).toBe("Lohnsteuer mit sonstige Bezüge (SONSTB), Versorgungsbezüge (VBEZ) ist nicht unterstützt.");
    expect(lohnsteuer(2026, { ...MONAT, SONSTB: 0, MBV: 0, VBEZ: 0, ALTER1: 0, LZZFREIB: 0, LZZHINZU: 0, f: 1000 })).toEqual(lohnsteuer(2026, MONAT));
  });

  it("rechnet Steuerklasse VI wie der BMF (Antwort der Schnittstelle, siehe pap.test.ts)", () => {
    expect(lohnsteuer(2026, { LZZ: 2, RE4: 1000_00, STKL: 6 })).toEqual({ ok: true, LSTLZZ: 11_458, SOLZLZZ: 0, BK: 0 });
  });
});

describe("lohnsteuer, ungültige Eingaben", () => {
  it.each([
    ["Cent-Bruchteile", { RE4: 100.5 }, "RE4 muss ein ganzer, nicht negativer Betrag in Cent sein."],
    ["negativer Lohn", { RE4: -1 }, "RE4 muss ein ganzer, nicht negativer Betrag in Cent sein."],
    ["Steuerklasse 7", { STKL: 7 }, "STKL muss eine Steuerklasse von 1 bis 6 sein."],
    ["Zeitraum 5", { LZZ: 5 }, "LZZ muss 1 (Jahr), 2 (Monat), 3 (Woche) oder 4 (Tag) sein."],
    ["ZKF mit zwei Dezimalstellen", { ZKF: 250 }, "ZKF muss in Tausendsteln mit höchstens einer Dezimalstelle angegeben sein (1,5 = 1500)."],
    ["KRV = 2", { KRV: 2 }, "KRV, ALV und PKV müssen 0 oder 1 sein."],
    ["PVA = 5", { PVA: 5 }, "PVS und PVZ müssen 0 oder 1, PVA 0 bis 4 sein."],
    ["KVZ in Prozent", { KVZ: 2.9 }, "KVZ muss ein ganzer, nicht negativer Satz in Basispunkten sein."],
  ])("lehnt %s ab", (_, zusatz, meldung) => {
    expect(lohnsteuer(2026, { ...MONAT, ...(zusatz as Partial<LohnsteuerEingabe>) })).toEqual({ ok: false, grund: "ungueltig", meldung });
  });

  it.each([
    ["negative sonstige Bezüge", { SONSTB: -1 }],
    ["Cent-Bruchteile bei Versorgungsbezügen", { VBEZ: 0.5 }],
    ["ALTER1 = 2", { ALTER1: 2 }],
    ["negativer Faktor", { f: -1000 }],
    ["Freibetrag NaN", { LZZFREIB: Number.NaN }],
    ["negativer Lohn neben sonstigen Bezügen", { RE4: -1, SONSTB: 1 }],
  ])("meldet %s als ungültig, nicht als nicht unterstützt", (_, zusatz) => {
    const r = lohnsteuer(2026, { ...MONAT, ...(zusatz as Partial<LohnsteuerEingabe>) });
    expect(r.ok === false && r.grund).toBe("ungueltig");
  });
});

describe("lohnkirchensteuer", () => {
  it("nimmt 8 % in Bayern und Baden-Württemberg, sonst 9 %, und schneidet Bruchteile eines Cents ab", () => {
    expect(lohnkirchensteuer(80_708, "BY")).toBe(6456);
    expect(lohnkirchensteuer(80_708, "BW")).toBe(6456);
    expect(lohnkirchensteuer(80_708, "NW")).toBe(7263);
    expect(lohnkirchensteuer(80_708, "SN")).toBe(7263);
    expect(lohnkirchensteuer(0, "HH")).toBe(0);
    expect(() => lohnkirchensteuer(-1, "HH")).toThrow(RangeError);
  });

  it("nutzt denselben Satz wie die Steuerprognose", () => {
    for (const land of ["BY", "BW", "BE", "NW", null] as const) {
      expect(kirchensteuerSatz(land)).toBe(kirchensteuerSatzBasispunkte(land) / 10_000);
    }
    expect(kirchensteuerSatz("BY")).toBe(0.08);
    expect(kirchensteuerSatz("HE")).toBe(0.09);
  });
});
