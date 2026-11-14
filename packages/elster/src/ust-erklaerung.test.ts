import { describe, expect, it } from "vitest";
import { checkXml } from "./fake-client.ts";
import { buildUstErklaerungXml, ustErklaerungLeer, ustErklaerungResult } from "./ust-erklaerung.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

const base = {
  year: 2025,
  steuernummer13: "2893081508152",
  bundesland: "BW",
  absender: { name: "Tris Software", strasse: "Hauptstr. 1", plz: "70173", ort: "Stuttgart" },
  herstellerId: "74931",
  produktVersion: "0.1.0",
  test: true,
};

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];
/** Reihenfolge der Elemente im XML */
const order = (xml: string, names: string[]) => names.map((n) => xml.indexOf(`<${n}>`));

describe("Umsatzsteuererklärung (E50)", () => {
  const figures = { base19: 10_000_049, tax19: 1_900_009, base7: 50_000, tax7: 3_500, vorsteuer: 120_000, vorauszahlungen: 1_700_000 };

  it("baut Kopf, Umsätze, Vorsteuer und Berechnung", () => {
    const xml = buildUstErklaerungXml({ ...base, versteuerung: "ist", figures });
    expect(checkXml(xml)).toBeUndefined();
    expect(tag(xml, "Verfahren")).toBe("ElsterErklaerung");
    expect(tag(xml, "DatenArt")).toBe("USt");
    expect(xml).toContain(`<Empfaenger id="L"><Ziel>BW</Ziel></Empfaenger>`);
    expect(xml).toContain(`<Empfaenger id="F">2893</Empfaenger>`);
    expect(xml).toContain(`xmlns="http://finkonsens.de/elster/elstererklaerung/ust/e50/v2025" version="2025"`);
    expect(hasTestmerker(xml)).toBe(true);
    expect(datenartVersionFromXml(xml)).toBe("USt_2025");
    expect(tag(xml, "E3002203")).toBe("2");
    expect(tag(xml, "E3003303")).toBe("100000");
    expect(tag(xml, "E3003304")).toBe("19000,09");
    expect(tag(xml, "E3004401")).toBe("500");
    expect(tag(xml, "E3006001")).toBe("19035,09");
    expect(tag(xml, "E3006901")).toBe("1200,00");
    // 19.035,09 − 1.200,00 = 17.835,09; abzüglich 17.000,00 Vorauszahlungen
    expect(tag(xml, "E3011101")).toBe("17835,09");
    expect(tag(xml, "E3011301")).toBe("17000,00");
    expect(tag(xml, "E3011401")).toBe("835,09");
    expect(tag(xml, "Unterfallart")).toBe("50");
    expect(tag(xml, "StNr")).toBe("2893081508152");
    // USt2A vor dem Vorsatz, Allg vor den Umsätzen
    const [allg, umsaetze, vost, berech, vorsatz] = order(xml, ["Allg", "Umsaetze", "Abz_VoSt", "Berech_USt", "Vorsatz"]);
    expect(allg! < umsaetze! && umsaetze! < vost! && vost! < berech! && berech! < vorsatz!).toBe(true);
    expect(ustErklaerungResult(figures)).toEqual({ steuer: 1_783_509, abschluss: 83_509 });
  });

  it("lässt leere Abschnitte weg und schreibt Überschüsse mit Minus", () => {
    const xml = buildUstErklaerungXml({
      ...base,
      test: false,
      versteuerung: "soll",
      figures: { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 50_000, vorauszahlungen: -40_000 },
    });
    expect(hasTestmerker(xml)).toBe(false);
    expect(tag(xml, "E3002203")).toBe("1");
    expect(xml).not.toContain("<Umsaetze>");
    expect(xml).not.toContain("<E3009201>");
    expect(tag(xml, "E3010601")).toBe("-500,00");
    expect(tag(xml, "E3011401")).toBe("-100,00");
  });

  it("lehnt eine leere Erklärung und alte Jahre ab", () => {
    const zero = { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 0, vorauszahlungen: 0 };
    expect(() => buildUstErklaerungXml({ ...base, versteuerung: "ist", figures: zero })).toThrow(/Nullerklärung/);
    expect(() => buildUstErklaerungXml({ ...base, year: 2021, versteuerung: "ist", figures })).toThrow(/ab 2023/);
  });

  it("schreibt steuerfreie Umsätze, § 13b, Erwerbe, Zusatzzeilen und Summen (2025)", () => {
    const xml = buildUstErklaerungXml({
      ...base,
      versteuerung: "soll",
      figures: {
        ...figures,
        kz41: 10_000,
        kz43: 20_000,
        kz89: 30_000,
        tax89: 5_700,
        kz93: 40_000,
        tax93: 2_800,
        kz46: 50_000,
        kz47: 9_500,
        kz84: 60_000,
        kz85: 11_400,
        kz21: 70_000,
        kz45: 80_000,
        kz61: 8_500,
        kz62: 3_000,
        kz67: 9_500,
      },
    });
    expect(checkXml(xml)).toBeUndefined();
    // Steuerfrei mit Vorsteuerabzug
    expect(tag(xml, "E3103301")).toBe("100"); // Kz 41
    expect(tag(xml, "E3103801")).toBe("200"); // Kz 43
    expect(xml).not.toContain("<E3104201>"); // Summenzeile entfällt ab 2025
    // Innergemeinschaftlicher Erwerb: Bemessung, Steuer, Summe
    expect(tag(xml, "E3100902")).toBe("300");
    expect(tag(xml, "E3100903")).toBe("57,00");
    expect(tag(xml, "E3101301")).toBe("400");
    expect(tag(xml, "E3101302")).toBe("28,00");
    expect(tag(xml, "E3101501")).toBe("85,00");
    // § 13b als Leistungsempfänger: EU (46/47), Drittland (84/85), Summe der Steuer
    expect(tag(xml, "E3102205")).toBe("500");
    expect(tag(xml, "E3102206")).toBe("95,00");
    expect(tag(xml, "E3102503")).toBe("600");
    expect(tag(xml, "E3102504")).toBe("114,00");
    expect(tag(xml, "E3102601")).toBe("209,00");
    // Ergänzende Angaben: im EU-Ausland Reverse Charge (21), nicht steuerbar Drittland (45)
    expect(tag(xml, "E3105702")).toBe("700");
    expect(tag(xml, "E3105801")).toBe("800");
    // Vorsteuer: Kz 61 (ig. Erwerb), 62 (Einfuhr), 67 (§ 13b) in der Summe
    expect(tag(xml, "E3006301")).toBe("85,00");
    expect(tag(xml, "E3006401")).toBe("30,00");
    expect(tag(xml, "E3006502")).toBe("95,00");
    expect(tag(xml, "E3006901")).toBe("1410,00"); // 1.200 + 85 + 30 + 95
    // Berechnung: Übertrag der Summen, Gesamtsteuer, verbleibende Umsatzsteuer
    expect(tag(xml, "E3009201")).toBe("19035,09");
    expect(tag(xml, "E3009401")).toBe("85,00");
    expect(tag(xml, "E3009502")).toBe("209,00");
    expect(tag(xml, "E3009801")).toBe("19329,09"); // 19.035,09 + 85 + 209
    expect(tag(xml, "E3009901")).toBe("1410,00");
    expect(tag(xml, "E3010201")).toBe("17919,09"); // 19.329,09 − 1.410
    // Gruppen in der Reihenfolge des Schemas: Umsaetze, Ums_stfrei, Ig_Erw, Ums_13b, Erg_Ang_Ums, Abz_VoSt, Berech_USt
    const reihenfolge = order(xml, ["Umsaetze", "Ums_stfrei", "Ig_Erw", "Ums_13b", "Erg_Ang_Ums", "Abz_VoSt", "Berech_USt"]);
    expect(reihenfolge).toEqual([...reihenfolge].sort((a, b) => a! - b!));
  });

  it("schreibt 2024 zusätzlich die Summenzeile der steuerfreien Umsätze mit Vorsteuerabzug", () => {
    const xml = buildUstErklaerungXml({
      ...base,
      year: 2024,
      versteuerung: "soll",
      figures: { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 10_000, vorauszahlungen: 0, kz43: 20_000, kz41: 5_000 },
    });
    expect(tag(xml, "E3103801")).toBe("200");
    expect(tag(xml, "E3104201")).toBe("200"); // USt_30415: Summe der Zeilen 41 bis 44
    const [weit, sum] = order(xml, ["E3103801", "E3104201"]);
    expect(weit! < sum!).toBe(true);
  });

  it("schreibt steuerfreie Umsätze ohne Vorsteuerabzug in die Zeilen 46 und 47, 2024 mit Summenzeile", () => {
    const xml = buildUstErklaerungXml({
      ...base,
      year: 2024,
      versteuerung: "soll",
      figures: { ...figures, kz43: 20_000, kz48Zeile46: 50_000, kz48Zeile47: 130_000, kz48Zeile47Nummern: "14, 21" },
    });
    expect(checkXml(xml)).toBeUndefined();
    expect(tag(xml, "E3104401")).toBe("500"); // Zeile 46: § 4 Nr. 12 (Vermietung)
    expect(tag(xml, "E3104501")).toBe("14, 21"); // Zeile 47: die Nummern als Text
    expect(tag(xml, "E3104502")).toBe("1300");
    expect(tag(xml, "E3104601")).toBe("1800"); // bis 2024: Summe der Zeilen 46 und 47
    // Reihenfolge im Schema: Ohne_VoSt_Abz hinter Mit_VoSt_Abz, Felder in der Reihenfolge des Vordrucks
    const [mit, ohne] = order(xml, ["Mit_VoSt_Abz", "Ohne_VoSt_Abz"]);
    expect(mit! < ohne!).toBe(true);
    const felder = order(xml, ["E3104401", "E3104501", "E3104502", "E3104601"]);
    expect(felder).toEqual([...felder].sort((a, b) => a! - b!));
  });

  it("schreibt Zeile 47 ohne die Summenzeile ab 2025 und ohne Zeile 46 nur die Textzeile", () => {
    const xml = buildUstErklaerungXml({
      ...base,
      year: 2025,
      versteuerung: "soll",
      figures: { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 0, vorauszahlungen: 0, kz48Zeile47: 80_000, kz48Zeile47Nummern: "8 i, 21" },
    });
    expect(tag(xml, "E3104501")).toBe("8 i, 21");
    expect(tag(xml, "E3104502")).toBe("800");
    expect(xml).not.toContain("<E3104601>");
    expect(xml).not.toContain("<Mit_VoSt_Abz>");
    // E3104501 und E3104502 gehen nur gemeinsam
    expect(tag(xml, "E3104401")).toBeUndefined();
  });

  it("zählt die Zeilen 46 und 47 bei der Prüfung auf eine leere Erklärung mit", () => {
    const leer = { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 0, vorauszahlungen: 0 };
    expect(ustErklaerungLeer({ ...leer, kz48Zeile46: 50_000 })).toBe(false);
    expect(ustErklaerungLeer({ ...leer, kz48Zeile47: 80_000 })).toBe(false);
  });

  it("lässt die 19/7-%-Zeile weg, wenn nur § 13b und Erwerbe zu erklären sind", () => {
    const xml = buildUstErklaerungXml({
      ...base,
      versteuerung: "soll",
      figures: { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 0, vorauszahlungen: 0, kz46: 50_000, kz47: 9_500, kz67: 9_500 },
    });
    expect(tag(xml, "E3102206")).toBe("95,00");
    expect(tag(xml, "E3102601")).toBe("95,00");
    expect(xml).not.toContain("<E3009201>");
    expect(tag(xml, "E3009801")).toBe("95,00");
    expect(tag(xml, "E3009901")).toBe("95,00");
    expect(tag(xml, "E3010201")).toBe("0,00");
  });

  it("schreibt Umsatzsteuer/Überschuss als 0,00, wenn der verbleibende Betrag 0 ist (USt_30914)", () => {
    // Nur Leistungen ins EU-Ausland (Kz 21) und ein EU-Abo nach § 13b mit vollem Vorsteuerabzug: Steuer 0
    const nur13b = { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 0, vorauszahlungen: 0, kz21: 3_000_000, kz46: 24_000, kz47: 4_560, kz67: 4_560 };
    // Umsatzsteuer gleich Vorsteuer
    const ausgeglichen = { base19: 10_000, tax19: 1_900, base7: 0, tax7: 0, vorsteuer: 1_900, vorauszahlungen: 0 };
    for (const figures of [nur13b, ausgeglichen]) {
      const xml = buildUstErklaerungXml({ ...base, versteuerung: "ist", figures });
      expect(tag(xml, "E3010201")).toBe("0,00");
      // Regel USt_30914: Ist E3010201 angegeben, muss E3010601 angegeben sein (auch mit 0)
      expect(tag(xml, "E3010601")).toBe("0,00");
    }
  });

  it("schreibt ein Jahr mit nur ergänzenden Angaben ohne Berechnungszeilen", () => {
    const xml = buildUstErklaerungXml({
      ...base,
      versteuerung: "soll",
      figures: { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 0, vorauszahlungen: 0, kz45: 80_000 },
    });
    expect(tag(xml, "E3105801")).toBe("800");
    for (const feld of ["E3009201", "E3009401", "E3009502", "E3009801", "E3009901", "E3010201"]) expect(xml).not.toContain(`<${feld}>`);
    expect(tag(xml, "E3011101")).toBe("0,00");
    expect(tag(xml, "E3011401")).toBe("0,00");
  });

  it("rechnet §-13b-Steuer, Erwerbsteuer und weitere Vorsteuer in das Ergebnis", () => {
    expect(
      ustErklaerungResult({
        base19: 0,
        tax19: 1_000,
        base7: 0,
        tax7: 0,
        vorsteuer: 400,
        vorauszahlungen: 200,
        tax89: 100,
        tax93: 50,
        kz47: 90,
        kz85: 60,
        kz61: 80,
        kz62: 20,
        kz67: 90,
      }),
    ).toEqual({ steuer: 1_000 + 100 + 50 + 90 + 60 - (400 + 80 + 20 + 90), abschluss: 1_000 + 100 + 50 + 90 + 60 - (400 + 80 + 20 + 90) - 200 });
  });

  it("erkennt eine Erklärung ohne Beträge als leer", () => {
    const leer = { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 0, vorauszahlungen: 0 };
    expect(ustErklaerungLeer(leer)).toBe(true);
    // Das Vorauszahlungssoll zählt nicht als Betrag der Erklärung
    expect(ustErklaerungLeer({ ...leer, vorauszahlungen: 50_000 })).toBe(true);
    // Jeder einzelne Betrag hebt die Leere auf, hier nur eine ergänzende Angabe
    expect(ustErklaerungLeer({ ...leer, kz45: 80_000 })).toBe(false);
  });
});
