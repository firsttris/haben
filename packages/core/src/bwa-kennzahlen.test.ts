import { describe, expect, it } from "vitest";
import { FORM43, type Form43Werte } from "./bwa.ts";
import { FORM01, type Form01Werte } from "./bwa-form01.ts";
import { anteil, anteilBasis, kennzahlen } from "./bwa-kennzahlen.ts";

/*
 * Erwartungen aus der DATEV-Musterauswertung BWA (2016), März 2016: Form 01 S. 3 (Spalten „% Ges.-Leistg.“, „% Ges.-Kosten“,
 * „Aufschlag“), Form 43 S. 32 („% Ges.-Erlöse“, „% Ges.-Kosten“). DATEV zeigt zwei Nachkommastellen, Haben rechnet in
 * Basispunkten: 56,92 % = 5692.
 */

const leer01 = () => Object.fromEntries(FORM01.map((d) => [d.key, 0])) as Form01Werte;
const leer43 = () => Object.fromEntries(FORM43.map((d) => [d.key, 0])) as Form43Werte;

/** Form 01, S. 3, Spalte Mrz/2016 */
const muster01: Form01Werte = {
  ...leer01(),
  umsatzerloese: 412_575_15,
  bestandsveraenderungen: 222_25,
  gesamtleistung: 412_797_40,
  material: 177_825_59,
  rohertrag: 234_971_81,
  sonstigeErloese: 294_12,
  betrieblicherRohertrag: 235_265_93,
  personal: 112_316_53,
  raum: 15_414_89,
  betrieblicheSteuern: 568_00,
  versicherungen: 2_371_52,
  kfz: 7_168_00,
  werbeReise: 4_497_19,
  warenabgabe: 1_422_70,
  abschreibungen: 6_124_62,
  sonstigeKosten: 11_835_35,
  gesamtkosten: 161_718_80,
  betriebsergebnis: 73_547_13,
  zinsaufwand: 7_962_48,
  neutralerAufwand: 7_962_48,
  zinsertrag: 61_51,
  neutralerErtrag: 61_51,
  ergebnisVorSteuern: 65_646_16,
  ertragsteuern: 13_550_00,
  vorlaeufigesErgebnis: 52_096_16,
};

/** Form 43, S. 32, Spalte Mrz/2016 */
const muster43: Form43Werte = {
  ...leer43(),
  erloese: 412_575_15,
  sonstigeErloese: 355_63,
  summeErloese: 412_930_78,
  umsatzsteuer: 72_579_81,
  material: 107_964_43,
  fremdleistungen: 69_861_16,
  personal: 112_316_53,
  raum: 15_414_89,
  steuernVersicherungenBeitraege: 2_371_52,
  kfz: 7_736_00,
  werbeReise: 4_497_19,
  warenabgabe: 1_422_70,
  abschreibungen: 6_124_62,
  verschiedeneKosten: 11_835_35,
  summeKosten: 339_544_39,
  sonstigeAufwendungen: 21_512_48,
  vorsteuer: 39_872_21,
  ustZahlung: 23_843_01,
};

const werteVon = (k: ReturnType<typeof kennzahlen>) => Object.fromEntries(k.map((z) => [z.key, z.wert]));

describe("Anteile der Zeilen (#1635)", () => {
  it("Form 01: Leistungsblock in % der Gesamtleistung, Kostenarten in % der Gesamtkosten (Musterauswertung S. 3)", () => {
    const a = (key: keyof Form01Werte) => anteil("form01", muster01, key);
    expect([a("umsatzerloese"), a("bestandsveraenderungen"), a("gesamtleistung"), a("material"), a("rohertrag")]).toEqual([9995, 5, 10000, 4308, 5692]);
    expect([a("sonstigeErloese"), a("betrieblicherRohertrag")]).toEqual([7, 5699]);
    expect([a("personal"), a("raum"), a("betrieblicheSteuern"), a("versicherungen"), a("kfz"), a("werbeReise")]).toEqual([6945, 953, 35, 147, 443, 278]);
    expect([a("warenabgabe"), a("abschreibungen"), a("sonstigeKosten"), a("gesamtkosten")]).toEqual([88, 379, 732, 10000]);
  });

  it("Form 01: neutraler Block, Steuern und Ergebnisse ohne Anteil", () => {
    for (const key of ["betriebsergebnis", "zinsaufwand", "neutralerAufwand", "zinsertrag", "neutralerErtrag", "unbesetzt"] as const)
      expect(anteilBasis("form01", key)).toBeNull();
    for (const key of ["ergebnisVorSteuern", "ertragsteuern", "vorlaeufigesErgebnis"] as const) expect(anteil("form01", muster01, key)).toBeNull();
  });

  it("Form 43: Erlöse in % der Summe der Erlöse, Kosten in % der Summe der Kosten (Musterauswertung S. 32)", () => {
    const a = (key: keyof Form43Werte) => anteil("form43", muster43, key);
    expect([a("erloese"), a("sonstigeErloese"), a("summeErloese")]).toEqual([9991, 9, 10000]);
    expect([a("material"), a("fremdleistungen"), a("personal"), a("raum"), a("steuernVersicherungenBeitraege"), a("kfz")]).toEqual([
      3180, 2057, 3308, 454, 70, 228,
    ]);
    expect([a("werbeReise"), a("warenabgabe"), a("abschreibungen"), a("verschiedeneKosten"), a("summeKosten")]).toEqual([132, 42, 180, 349, 10000]);
  });

  it("Form 43: Steuern, Buchwert, sonstige Aufwendungen, Summen der Ein- und Ausgaben und Ergebnisse ohne Anteil", () => {
    for (const key of [
      "umsatzsteuer",
      "ustErstattung",
      "summeEinnahmen",
      "buchwertAnlagenabgang",
      "sonstigeAufwendungen",
      "vorsteuer",
      "ustZahlung",
      "summeAusgaben",
      "ergebnis",
      "nichtAbziehbar",
      "gewinnEuer",
    ] as const)
      expect(anteil("form43", muster43, key)).toBeNull();
  });

  it("ohne Anteil, wenn die Bezugsgröße 0 oder negativ ist", () => {
    expect(anteil("form43", { ...leer43(), raum: 100_00 }, "raum")).toBeNull();
    expect(anteil("form43", { ...leer43(), erloese: -50_00, summeErloese: -50_00 }, "erloese")).toBeNull();
    expect(anteil("form01", { ...leer01(), material: 10_00, gesamtleistung: 0 }, "material")).toBeNull();
  });

  it("rundet kaufmännisch auf ganze Basispunkte, auch negative Anteile", () => {
    // 1/3 = 33,333 % → 3333; 2/3 = 66,667 % → 6667; −1/8 = −12,5 % → −1250
    const w = (erloese: number, sonstigeErloese: number) => ({ ...leer43(), erloese, sonstigeErloese, summeErloese: erloese + sonstigeErloese });
    expect(anteil("form43", w(1_00, 2_00), "erloese")).toBe(3333);
    expect(anteil("form43", w(1_00, 2_00), "sonstigeErloese")).toBe(6667);
    expect(anteil("form43", w(9_00, -1_00), "sonstigeErloese")).toBe(-1250);
    // 0,005 % = 0,5 Basispunkte → 1 (halbe Basispunkte weg von der Null)
    expect(anteil("form43", w(19_999_00, 1_00), "sonstigeErloese")).toBe(1);
    expect(anteil("form43", w(19_999_00, -1_00), "sonstigeErloese")).toBe(-1);
  });
});

describe("Kennzahlen der BWA (#1635)", () => {
  it("Form 01 rechnet die Musterauswertung S. 3 nach", () => {
    expect(werteVon(kennzahlen("form01", muster01))).toEqual({
      rohertragsquote: 5692,
      personalkostenquote: 2721,
      kostenquote: 3918,
      umsatzrendite: 1262,
      aufschlag: 13214,
    });
  });

  it("Form 43 rechnet die Musterauswertung S. 32 nach; Umsatzrendite netto ohne Umsatz- und Vorsteuer", () => {
    const k = werteVon(kennzahlen("form43", muster43));
    expect(k.personalkostenquote).toBe(2720);
    expect(k.kostenquote).toBe(8223);
    // (412.930,78 − 107.964,43 − 69.861,16) / 412.930,78 = 56,936 %
    expect(k.rohertragsquote).toBe(5694);
    // (412.930,78 − 339.544,39 − 0 − 21.512,48) / 412.930,78 = 12,562 %; DATEV rechnet brutto in % der Betriebseinnahmen
    expect(k.umsatzrendite).toBe(1256);
    expect(Object.keys(k)).toEqual(["rohertragsquote", "personalkostenquote", "kostenquote", "umsatzrendite"]);
  });

  it("Form 01 zeigt den Aufschlag nur bei Material- und Wareneinkauf", () => {
    const ohneMaterial = { ...muster01, material: 0, rohertrag: muster01.gesamtleistung };
    expect(kennzahlen("form01", ohneMaterial).map((k) => k.key)).toEqual(["rohertragsquote", "personalkostenquote", "kostenquote", "umsatzrendite"]);
    expect(kennzahlen("form01", ohneMaterial)[0]!.wert).toBe(10000);
  });

  it("ohne Wert bei Gesamtleistung bzw. Erlösen von 0 oder darunter, mit Label und Erklärung", () => {
    for (const k of [...kennzahlen("form01", leer01()), ...kennzahlen("form43", { ...leer43(), summeErloese: -1_00, personal: 5_00 })]) {
      expect(k.wert).toBeNull();
      expect(k.label).not.toBe("");
      expect(k.erklaerung).not.toBe("");
    }
  });

  it("Umsatzrendite darf negativ sein", () => {
    const verlust = { ...leer43(), erloese: 1_000_00, summeErloese: 1_000_00, raum: 1_200_00, summeKosten: 1_200_00 };
    expect(werteVon(kennzahlen("form43", verlust)).umsatzrendite).toBe(-2000);
  });
});
