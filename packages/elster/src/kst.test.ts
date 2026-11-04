import { describe, expect, it } from "vitest";
import { buildGewStXml } from "./gewst.ts";
import { buildKstXml, kstBerechnung, type KstXmlInput } from "./kst.ts";

const ohne = { kst: 0, soli: 0, kapest: 0, gewst: 0, sonstige: 0 };

describe("Körperschaftsteuer: Rechnung der Erklärung in vollen Euro", () => {
  it("Einkünfte aus Jahresüberschuss und nicht abziehbaren Aufwendungen, 15 % abgerundet", () => {
    const b = kstBerechnung({
      year: 2025,
      jahresergebnis: 5_800_099,
      hinzurechnungen: { kst: 100_050, soli: 5_500, kapest: 0, gewst: 0, sonstige: 30_000 },
      verlustvortrag: 0,
      verlustruecktrag: 0,
    });
    // 58.000 + 1.000 + 55 + 300 = 59.355 (Cents fallen je Zeile weg)
    expect(b).toMatchObject({ einkuenfte: 59_355, zvE: 59_355, kst: 8903, verlust: null });
  });

  it.each([
    // Vortrag kleiner als der Sockel: voll verrechnet
    [5_000_000, 1_000_000, { sockel: 10_000, quote: 0 }, 0],
    // 3 Mio. € Einkünfte, 5 Mio. € Vortrag: 1 Mio. € plus 70 % von 2 Mio. €
    [300_000_000, 500_000_000, { sockel: 1_000_000, quote: 1_400_000 }, 2_600_000],
  ])("Mindestbesteuerung: Einkünfte %i, Vortrag %i", (jahresergebnis, verlustvortrag, verlustabzug, ende) => {
    const b = kstBerechnung({ year: 2025, jahresergebnis, hinzurechnungen: ohne, verlustvortrag, verlustruecktrag: 0 });
    expect(b.verlustabzug).toEqual(verlustabzug);
    expect(b.verlust?.ende).toBe(ende);
    expect(b.zvE).toBe(jahresergebnis / 100 - verlustabzug.sockel - verlustabzug.quote);
  });

  it("Verlustjahr: Rücktrag höchstens 1 Mio. €, der Rest kommt zum Vortrag", () => {
    const b = kstBerechnung({ year: 2025, jahresergebnis: -2_000_000, hinzurechnungen: ohne, verlustvortrag: 500_000, verlustruecktrag: 300_000 });
    expect(b).toMatchObject({ einkuenfte: -20_000, zvE: -20_000, kst: 0 });
    expect(b.verlust).toEqual({ anfang: 5_000, laufend: 20_000, ruecktrag: 3_000, zwischensumme: 22_000, ende: 22_000 });
  });
});

describe("Erklärungen der GmbH: Prüfungen vor dem XML", () => {
  const envelope = {
    steuernummer13: "2893081508152",
    bundesland: "BW",
    absender: { name: "Nordlicht GmbH", strasse: "Hauptstraße 1", plz: "70173", ort: "Stuttgart" },
    herstellerId: "12345",
    produktVersion: "0.1.0",
    test: true,
  };
  const kst: KstXmlInput = {
    ...envelope,
    year: 2025,
    rechtsform: "gmbh",
    sitz: "Stuttgart",
    anteilseigner: [{ name: "Erika", strasse: "Weg 1", plzOrt: "70173 Stuttgart", beteiligung: 2_500_000, anteil: 10_000, geaendert: false }],
    jahresergebnis: 0,
    hinzurechnungen: ohne,
    verlustvortrag: 0,
    verlustruecktrag: 0,
    einlagekonto: 0,
    leistungen: [],
    eigenkapital: 0,
    nennkapital: 0,
    vertraege: [],
  };

  it("Körperschaftsteuer nur für bekannte Jahre, mit Anteilseignern, Gründung im Jahr", () => {
    expect(() => buildKstXml({ ...kst, year: 2024 })).toThrow("nicht für 2024");
    expect(() => buildKstXml({ ...kst, anteilseigner: [] })).toThrow("Anteilseigner");
    expect(() => buildKstXml({ ...kst, gruendung: "2024-05-01" })).toThrow("nicht in 2025");
    const xml = buildKstXml({ ...kst, gruendung: "2025-03-15" });
    expect(xml).toContain("<E8002606>15.03.2025</E8002606>");
    expect(xml).toContain("<E8122105>100,0000</E8122105>");
    expect(xml).toContain("<DatenArt>KSt</DatenArt>");
  });

  it("Gewerbesteuer nur für bekannte Jahre, mit Gegenstand; Rechte nur mit Anteil an beschränkt Steuerpflichtige", () => {
    const gewst = {
      ...envelope,
      year: 2025,
      rechtsform: "gmbh" as const,
      gegenstand: "Software",
      betriebsstaette: { plz: "70173", ort: "Stuttgart" },
      gewinn: 100_000,
      hinzurechnungen: { zinsen: 0, beweglich: 0, unbeweglich: 0, rechte: 0 },
      rechteBeschraenktStpfl: 0,
      verlustvortrag: 0,
    };
    expect(() => buildGewStXml({ ...gewst, year: 2023 })).toThrow("nicht für 2023");
    expect(() => buildGewStXml({ ...gewst, gegenstand: " " })).toThrow("Gegenstand");
    expect(buildGewStXml(gewst)).not.toContain("E4004103");
    expect(buildGewStXml({ ...gewst, hinzurechnungen: { ...gewst.hinzurechnungen, rechte: 50_000 } })).toContain("<E4004103>0</E4004103>");
  });
});
