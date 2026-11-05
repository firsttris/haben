import { describe, expect, it } from "vitest";
import { lohnsteuer } from "../lohnsteuer/index.ts";
import { sozialversicherung } from "../sozialversicherung/index.ts";
import { lohnabrechnung, type LohnabrechnungEingabe, type LohnStammdaten, monatsgrenzen } from "./index.ts";

/**
 * Abrechnung aus den Stammdaten. Lohnsteuer und Soli kommen aus Antworten des BMF-Steuerrechners
 * (packages/core/test-fixtures/lohnsteuer/bmf-2026-abruf.json, Abruf vom 04.11.2026), die SV-Beiträge aus den Beispielen
 * in sozialversicherung.test.ts; hier geprüft wird, welche Eingaben die Stammdaten ergeben und wie die Summen entstehen.
 */

/** Gesellschafter-Geschäftsführer, freiwillig gesetzlich versichert, kinderlos, evangelisch */
const GGF: LohnStammdaten = {
  art: "ggf",
  monatsgehalt: 6000_00,
  eintritt: "2024-01-01",
  austritt: null,
  steuerklasse: 1,
  faktor: 1000,
  kinderfreibetraege: 0,
  konfession: "ev",
  kv: { art: "gesetzlich", zusatzbeitrag: 290 },
  pflege: { kinderlosenzuschlag: true, kinderUnter25: 0 },
  umlagen: { u1: null, u2: 0 },
  minijob: { rvBefreit: false, pauschsteuer: false },
};

const MINIJOB: LohnStammdaten = {
  ...GGF,
  art: "minijob",
  monatsgehalt: 603_00,
  konfession: null,
  umlagen: { u1: 0, u2: 0 },
  minijob: { rvBefreit: false, pauschsteuer: true },
};

const ANGESTELLT: LohnStammdaten = {
  ...GGF,
  art: "beschaeftigt",
  monatsgehalt: 4000_00,
  konfession: null,
  kv: { art: "gesetzlich", zusatzbeitrag: 310 },
  pflege: { kinderlosenzuschlag: false, kinderUnter25: 4 },
  umlagen: { u1: 160, u2: 44 },
};

const eingabe = (stammdaten: LohnStammdaten, mehr: Partial<LohnabrechnungEingabe> = {}): LohnabrechnungEingabe => ({
  jahr: 2026,
  monat: 10,
  stammdaten,
  bundesland: "HB",
  ...mehr,
});

function rechne(e: LohnabrechnungEingabe) {
  const r = lohnabrechnung(e);
  if (!r.ok) throw new Error(r.meldung);
  return r;
}

describe("Stufe A: Gesellschafter-Geschäftsführer ohne SV-Pflicht", () => {
  it("rechnet Lohnsteuer ohne Renten- und Arbeitslosenversicherung und Kirchensteuer zu 9 %", () => {
    // BMF: LZZ 2, RE4 6.000 €, StKl I, KRV 1, ALV 1, KVZ 2,9 %, PVZ 1, R 1 → LSt 1.289,33 €, Soli 0, BK 1.289,33 €
    const r = rechne(eingabe(GGF));
    expect([r.lohnsteuer, r.soli]).toEqual([1289_33, 0]);
    expect(r.kirchensteuer).toBe(116_03); // 9 % von 1.289,33 € = 116,0397 €, Bruchteile eines Cents entfallen
    expect(r.sv.arbeitnehmer).toBe(0);
    expect(r.sv.arbeitgeber).toBe(0);
    expect(r.netto).toBe(6000_00 - 1289_33 - 116_03);
    expect(r.auszahlung).toBe(r.netto);
    expect(r).toMatchObject({
      stufe: "A",
      gegenpruefen: false,
      brutto: 6000_00,
      steuerBrutto: 6000_00,
      svBrutto: 0,
      pauschalBrutto: 0,
      svTage: 0,
      steuertage: 30,
    });
    expect(r.bestandteile).toEqual([
      {
        bezeichnung: "Geschäftsführergehalt",
        betrag: 6000_00,
        laufend: true,
        steuerpflichtig: true,
        pauschalBesteuert: false,
        svPflichtig: false,
        gesamtbrutto: true,
      },
    ]);
  });

  it("rechnet mit Soli und ohne Kirchensteuer", () => {
    // BMF: LZZ 2, RE4 9.000 €, StKl I, KRV 1, ALV 1, KVZ 2,5 % → LSt 2.562,33 €, Soli 103,11 €
    const r = rechne(
      eingabe({
        ...GGF,
        monatsgehalt: 9000_00,
        konfession: null,
        kv: { art: "gesetzlich", zusatzbeitrag: 250 },
        pflege: { kinderlosenzuschlag: false, kinderUnter25: 0 },
      }),
    );
    expect([r.lohnsteuer, r.soli, r.kirchensteuer]).toEqual([2562_33, 103_11, 0]);
  });

  it("Kirchensteuer 8 % in Bayern", () => {
    expect(rechne(eingabe(GGF, { bundesland: "BY" })).kirchensteuer).toBe(103_14); // 8 % von 1.289,33 € = 103,1464 €
  });

  it("gibt privat Versicherten den Basisbeitrag mit (PKV, PKPV), ohne Zuschuss", () => {
    const r = rechne(eingabe({ ...GGF, konfession: null, kv: { art: "privat", basisbeitrag: 600_00, arbeitgeberzuschuss: 0 } }));
    const pap = lohnsteuer(2026, { LZZ: 2, RE4: 6000_00, STKL: 1, KRV: 1, ALV: 1, PKV: 1, PKPV: 600_00, PKPVAGZ: 0 });
    expect(pap.ok && [pap.LSTLZZ, pap.SOLZLZZ]).toEqual([r.lohnsteuer, r.soli]);
  });

  it("rechnet mit dem Entgelt des Monats statt des Monatsgehalts", () => {
    expect(rechne(eingabe(GGF, { entgelt: 9000_00 })).brutto).toBe(9000_00);
  });
});

describe("Stufe B: Minijob mit Pauschsteuer", () => {
  it("keine Lohnsteuer; Pauschsteuer, Pauschalen und Umlagen trägt der Arbeitgeber, der Beschäftigte 3,6 % RV", () => {
    // Werte wie im Test der Minijob-Zentrale in sozialversicherung.test.ts: 603 € → AN 21,71 €, AG 187,95 €
    const r = rechne(eingabe(MINIJOB));
    expect([r.lohnsteuer, r.soli, r.kirchensteuer]).toEqual([0, 0, 0]);
    expect(r.sv.arbeitnehmer).toBe(21_71);
    expect(r.sv.arbeitgeber).toBe(187_95);
    expect(r.sv.pauschsteuer).toBe(12_06);
    expect(r.netto).toBe(603_00 - 21_71);
    expect(r).toMatchObject({ stufe: "B", gegenpruefen: false, steuerBrutto: 0, pauschalBrutto: 603_00, svBrutto: 603_00, svTage: 30 });
    expect(r.bestandteile[0]).toMatchObject({ steuerpflichtig: false, pauschalBesteuert: true, svPflichtig: true });
  });

  it("ohne Teilnahme am U1-Verfahren keine U1", () => {
    expect(rechne(eingabe({ ...MINIJOB, umlagen: { u1: null, u2: 0 } })).sv.umlagen.u1).toBe(0);
  });

  it("über 603 € ist kein Minijob", () => {
    expect(lohnabrechnung(eingabe(MINIJOB, { entgelt: 700_00 }))).toMatchObject({ ok: false, grund: "ungueltig" });
  });

  it("Lohnsteuer nach ELStAM statt Pauschsteuer ist nicht unterstützt", () => {
    expect(lohnabrechnung(eingabe({ ...MINIJOB, minijob: { rvBefreit: false, pauschsteuer: false } }))).toMatchObject({
      ok: false,
      grund: "nicht-unterstuetzt",
    });
  });
});

describe("Stufe C: versicherungspflichtig beschäftigt, als Entwurf zum Gegenprüfen", () => {
  it("rechnet Lohnsteuer und Beiträge mit Sachsen, Zusatzbeitrag und Kinderabschlägen", () => {
    // BMF: LZZ 2, RE4 4.000 €, StKl I, PVS 1, KVZ 3,1 %, PVA 3 → LSt 533,75 €; vier Kinder unter 25 = drei Abschläge
    const r = rechne(eingabe(ANGESTELLT, { bundesland: "SN" }));
    expect([r.lohnsteuer, r.soli, r.kirchensteuer]).toEqual([533_75, 0, 0]);
    const sv = sozialversicherung(2026, {
      personengruppe: "beschaeftigt",
      entgelt: 4000_00,
      kv: { art: "gesetzlich", zusatzbeitrag: 310 },
      pflege: { kinderlosenzuschlag: false, kinderUnter25: 4 },
      sachsen: true,
      umlagen: { u1: 160, u2: 44 },
    });
    expect({ ok: true, ...r.sv }).toEqual(sv);
    expect(r.netto).toBe(4000_00 - 533_75 - r.sv.arbeitnehmer);
    expect(r).toMatchObject({ stufe: "C", gegenpruefen: true, svBrutto: 4000_00, steuerBrutto: 4000_00 });
    expect(r.hinweise[0]).toMatch(/^Entwurf, gegenprüfen/);
  });

  it("gibt das Monatsgehalt als regelmäßiges Entgelt mit: ein Monat in einem anderen Bereich wird nicht gerechnet", () => {
    const midijob = { ...ANGESTELLT, monatsgehalt: 1500_00 };
    expect(rechne(eingabe(midijob)).sv.bemessung.arbeitnehmer).not.toBeNull();
    expect(lohnabrechnung(eingabe(midijob, { entgelt: 2500_00 }))).toMatchObject({ ok: false, grund: "nicht-unterstuetzt" });
    expect(lohnabrechnung(eingabe(midijob, { entgelt: 500_00 }))).toMatchObject({ ok: false, grund: "nicht-unterstuetzt" });
  });

  it("privat Versicherte sind nicht unterstützt", () => {
    expect(lohnabrechnung(eingabe({ ...ANGESTELLT, kv: { art: "privat", basisbeitrag: 500_00, arbeitgeberzuschuss: 250_00 } }))).toMatchObject({
      ok: false,
      grund: "nicht-unterstuetzt",
    });
  });
});

describe("Fehlerwerte statt Rechnung", () => {
  it.each([
    ["Eintritt im Monat", { ...GGF, eintritt: "2026-10-15" }, "nicht-unterstuetzt"],
    ["Austritt im Monat", { ...GGF, austritt: "2026-10-15" }, "nicht-unterstuetzt"],
    ["Eintritt nach dem Monat", { ...GGF, eintritt: "2026-11-01" }, "ungueltig"],
    ["Austritt vor dem Monat", { ...GGF, austritt: "2026-09-30" }, "ungueltig"],
    ["Steuerklasse VI", { ...GGF, steuerklasse: 6 as const }, "nicht-unterstuetzt"],
    ["Faktorverfahren", { ...GGF, steuerklasse: 4 as const, faktor: 950 }, "nicht-unterstuetzt"],
    [
      "Zuschuss zur PKV des Geschäftsführers",
      { ...GGF, kv: { art: "privat" as const, basisbeitrag: 600_00, arbeitgeberzuschuss: 300_00 } },
      "nicht-unterstuetzt",
    ],
    ["Monatsgehalt in Euro", { ...GGF, monatsgehalt: 6000.5 }, "ungueltig"],
    ["kein Gehalt", { ...GGF, monatsgehalt: 0 }, "ungueltig"],
  ])("%s", (_, stammdaten, grund) => {
    expect(lohnabrechnung(eingabe(stammdaten))).toMatchObject({ ok: false, grund });
  });

  it("Austritt am Monatsende ist ein ganzer Monat", () => {
    expect(lohnabrechnung(eingabe({ ...GGF, austritt: "2026-10-31" })).ok).toBe(true);
  });

  it("ein Jahr ohne PAP und Werte ist nicht hinterlegt", () => {
    expect(lohnabrechnung(eingabe(GGF, { jahr: 2031 }))).toMatchObject({ ok: false, grund: "nicht-hinterlegt" });
  });

  it("ungültiger Monat", () => {
    expect(lohnabrechnung(eingabe(GGF, { monat: 13 }))).toMatchObject({ ok: false, grund: "ungueltig" });
  });
});

describe("monatsgrenzen", () => {
  it("kennt Schaltjahre", () => {
    expect(monatsgrenzen(2028, 2)).toEqual({ erster: "2028-02-01", letzter: "2028-02-29" });
    expect(monatsgrenzen(2026, 12)).toEqual({ erster: "2026-12-01", letzter: "2026-12-31" });
  });
});
