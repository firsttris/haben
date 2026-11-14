import { describe, expect, it } from "vitest";
import { checkXml } from "./fake-client.ts";
import { buildEuerXml, buildUstErklaerungXml, euerTotals, euerVorzeichenMeldungen, ustErklaerungResult, type AveuerAnlage } from "./erklaerung.ts";
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
});

describe("Anlage EÜR (E77) mit AVEÜR", () => {
  const figures = {
    steuerpflichtig: 8_000_000,
    steuerfrei: 1_000_000,
    vereinnahmteUst: 1_520_000 + 57_000,
    privateKfz: 300_000,
    afaBeweglich: 900_000,
    gwg: 50_000,
    telekommunikation: 40_000,
    edv: 60_000,
    vorsteuer: 200_000,
    gezahlteUst: 1_200_000,
    kfzSonstige: 80_000,
    kfzSteuerVersicherung: 70_000,
    entnahmen: 2_400_000,
    einlagen: 10_000,
  };
  const anlagen: AveuerAnlage[] = [
    {
      gruppe: "kfz",
      bezeichnung: "Tesla Model 3",
      anschaffung: "2024-03-15",
      anschaffungskosten: 4_000_000,
      buchwertBeginn: 3_444_444,
      afa: 666_667,
      abgang: 0,
      buchwertEnde: 2_777_777,
    },
    {
      gruppe: "andere",
      bezeichnung: "MacBook Pro",
      anschaffung: "2025-02-01",
      anschaffungskosten: 233_333,
      buchwertBeginn: 233_333,
      afa: 233_333,
      abgang: 0,
      buchwertEnde: 0,
    },
    {
      gruppe: "sammelposten",
      bezeichnung: "Sammelposten 2025",
      anschaffung: "2025-06-01",
      anschaffungskosten: 90_000,
      buchwertBeginn: 90_000,
      afa: 18_000,
      abgang: 0,
      buchwertEnde: 72_000,
    },
    {
      gruppe: "sammelposten",
      bezeichnung: "Sammelposten 2023",
      anschaffung: "2023-06-01",
      anschaffungskosten: 50_000,
      buchwertBeginn: 30_000,
      afa: 10_000,
      abgang: 0,
      buchwertEnde: 20_000,
    },
  ];
  const allgemein = { artDesBetriebs: "Softwareentwicklung", einkunftsart: "selbstaendig" as const };

  it("baut Einnahmen, Ausgaben, Gewinn und Entnahmen", () => {
    const xml = buildEuerXml({ ...base, allgemein, figures, anlagen });
    expect(checkXml(xml)).toBeUndefined();
    expect(tag(xml, "DatenArt")).toBe("EUER");
    expect(datenartVersionFromXml(xml)).toBe("EUER_2025");
    expect(xml).toContain(`xmlns="http://finkonsens.de/elster/elstererklaerung/euer/e77/v2025" version="2025"`);
    expect(tag(xml, "E6000017")).toBe("Softwareentwicklung");
    expect(tag(xml, "E6000602")).toBe("140");
    expect(tag(xml, "E6000603")).toBe("3");
    expect(tag(xml, "E6000401")).toBe("80000,00");
    expect(tag(xml, "E6000601")).toBe("15770,00");
    expect(tag(xml, "E6000901")).toBe("3000,00");
    const { einnahmen, ausgaben, gewinn } = euerTotals(figures);
    expect(tag(xml, "E6001201")).toBe("108770,00");
    expect(einnahmen).toBe(10_877_000);
    expect(ausgaben).toBe(2_600_000);
    expect(tag(xml, "E6005301")).toBe("26000,00");
    expect(tag(xml, "E6007202")).toBe("82770,00");
    expect(gewinn).toBe(8_277_000);
    expect(tag(xml, "E6006601")).toBe("24000,00");
    expect(tag(xml, "E6006701")).toBe("100,00");
    expect(xml).not.toContain("<Kleinunternehmer>");
    expect(xml).not.toContain("<Fremdleistung>");
    const [allg, bein, baus, gewinnNode, zus, av, vorsatz] = order(xml, [
      "Allg",
      "BEin",
      "BAus",
      "Ermittlung_Gewinn",
      "Zus_Angabe_EinzelUntern",
      "AVEUER",
      "Vorsatz",
    ]);
    expect([allg, bein, baus, gewinnNode, zus, av, vorsatz]).toEqual([...[allg, bein, baus, gewinnNode, zus, av, vorsatz]].sort((a, b) => a! - b!));
    const [stfrei, vereinnahmt, kfz] = order(xml, ["USt_StFrei", "USt_Vereinnahmt_Unentgeltl", "Nutzung_Priv_Kfz"]);
    expect(stfrei! < vereinnahmt! && vereinnahmt! < kfz!).toBe(true);
  });

  it("Sachentnahme: Entnahme_Sonst/E6001001 hinter der Kfz-Nutzung, in der Summe der Einnahmen (2023 und 2025)", () => {
    for (const year of [2023, 2025]) {
      const xml = buildEuerXml({ ...base, year, allgemein, figures: { ...figures, sachentnahmen: 25_000 }, anlagen });
      expect(checkXml(xml)).toBeUndefined();
      expect(tag(xml, "E6001001")).toBe("250,00");
      expect(xml).toMatch(/<Entnahme_Sonst>\s*<Sum>\s*<E6001001>250,00<\/E6001001>/);
      expect(tag(xml, "E6001201")).toBe("109020,00");
      const [kfz, sonst, danach] = order(xml, ["Nutzung_Priv_Kfz", "Entnahme_Sonst", year >= 2024 ? "GesamtSum" : "Weitere_Angabe"]);
      expect(kfz! < sonst! && sonst! < danach!).toBe(true);
    }
    expect(buildEuerXml({ ...base, allgemein, figures, anlagen })).not.toContain("<Entnahme_Sonst>");
  });

  it("weist negative gezahlte und erstattete Umsatzsteuer ab (Zeile 18 und 58 ohne Vorzeichen)", () => {
    // E77-2025/2026: E6000701 und E6005101 sind "DezimalzahlNichtNeg...", ERiC meldet "Unzulässiges Vorzeichen"
    expect(() => buildEuerXml({ ...base, allgemein, figures: { ...figures, gezahlteUst: -19_000 }, anlagen: [] })).toThrow(/Zeile 58 \(Kz E6005101.*190,00/);
    expect(() => buildEuerXml({ ...base, allgemein, figures: { ...figures, erstatteteUst: -19_000 }, anlagen: [] })).toThrow(/Zeile 18 \(Kz E6000701.*190,00/);
    expect(euerVorzeichenMeldungen({ ...figures, gezahlteUst: -19_000 })).toHaveLength(1);
    // Positive Beträge bleiben unverändert im XML
    const xml = buildEuerXml({ ...base, allgemein, figures: { ...figures, gezahlteUst: 19_000 }, anlagen: [] });
    expect(tag(xml, "E6005101")).toBe("190,00");
    // Grenze: 0,00 und ein fehlender Wert sind keine negativen Beträge und dürfen nicht gemeldet werden
    expect(euerVorzeichenMeldungen({ ...figures, gezahlteUst: 0, erstatteteUst: 0 })).toEqual([]);
    expect(euerVorzeichenMeldungen({ ...figures, gezahlteUst: undefined, erstatteteUst: undefined })).toEqual([]);
    // Beide Zeilen negativ: zwei Meldungen in einem Wurf, beide im Text des Fehlers
    expect(euerVorzeichenMeldungen({ ...figures, gezahlteUst: -1, erstatteteUst: -1 })).toHaveLength(2);
    expect(() => buildEuerXml({ ...base, allgemein, figures: { ...figures, gezahlteUst: -1, erstatteteUst: -1 }, anlagen: [] })).toThrow(
      /Zeile 58[\s\S]*Zeile 18/,
    );
  });

  it("listet Anlagen je Gruppe in der AVEÜR", () => {
    const xml = buildEuerXml({ ...base, allgemein, figures, anlagen });
    expect(tag(xml, "E6007311")).toBe("Tesla Model 3");
    expect(tag(xml, "E6007326")).toBe("15.03.2024");
    expect(tag(xml, "E6007314")).toBe("34444,44");
    expect(tag(xml, "E6007320")).toBe("6666,67");
    expect(tag(xml, "E6007325")).toBe("27777,77");
    // Antrieb je Kfz und in der Summe sind Pflicht (ERiC: Zeile 47); ohne Angabe „nein“
    expect(tag(xml, "E6007327")).toBe("2");
    expect(tag(xml, "E6007328")).toBe("2");
    const elektro = buildEuerXml({ ...base, allgemein, figures, anlagen: anlagen.map((a) => (a.gruppe === "kfz" ? { ...a, elektro: true } : a)) });
    expect(tag(elektro, "E6007327")).toBe("1");
    expect(tag(elektro, "E6007328")).toBe("1");
    expect(tag(xml, "E6007351")).toBe("MacBook Pro");
    expect(tag(xml, "E6007364")).toBe("0,00");
    // Summe AfA beweglicher Wirtschaftsgüter = Zeile AfA der EÜR
    expect(tag(xml, "E6007372")).toBe("9000,00");
    expect(xml).not.toContain("<Buero>");
    expect(tag(xml, "E6007381")).toBe("Sammelposten 2025");
    expect(tag(xml, "E6007395")).toBe("720,00");
    expect(tag(xml, "E6017395")).toBe("500,00");
    expect(tag(xml, "E6017398")).toBe("200,00");
    expect(tag(xml, "E6017399")).toBe("280,00");
  });

  it("übermittelt den Wareneinkauf als Waren, Rohstoffe und Hilfsstoffe vor den Fremdleistungen", () => {
    const mitWaren = { ...figures, waren: 250_000, fremdleistungen: 80_000 };
    const xml = buildEuerXml({ ...base, allgemein, figures: mitWaren, anlagen: [] });
    expect(checkXml(xml)).toBeUndefined();
    // Pfad laut ERiC-Plugin libcheckEUER_2025: /EUER/BAus/Ware_Rohstoff_Hilfsstoff/Sum/E6001601
    expect(xml).toMatch(/<BAus>\s*<Ware_Rohstoff_Hilfsstoff>\s*<Sum>\s*<E6001601>2500,00<\/E6001601>/);
    const [waren, fremd] = order(xml, ["Ware_Rohstoff_Hilfsstoff", "Fremdleistung"]);
    expect(waren! < fremd!).toBe(true);
    expect(tag(xml, "E6005301")).toBe("29300,00");
  });

  it("übermittelt Löhne und Gehälter als Ausgaben für eigenes Personal nach den Fremdleistungen", () => {
    const mitLohn = { ...figures, fremdleistungen: 80_000, personal: 4_927_60 };
    const xml = buildEuerXml({ ...base, allgemein, figures: mitLohn, anlagen: [] });
    expect(checkXml(xml)).toBeUndefined();
    // Schema E77-2025 im ERiC-Paket: /EUER/BAus/Personal/Sum/E6001801 „Ausgaben für eigenes Personal (z. B. Gehälter,
    // Löhne und Versicherungsbeiträge)“, zwischen Fremdleistung und AfA
    expect(xml).toMatch(/<Personal>\s*<Sum>\s*<E6001801>4927,60<\/E6001801>/);
    const [fremd, personal, afa] = order(xml, ["Fremdleistung", "Personal", "AfA"]);
    expect(fremd! < personal! && personal! < afa!).toBe(true);
    expect(euerTotals(mitLohn).ausgaben).toBe(2_600_000 + 80_000 + 4_927_60);
  });

  it("übermittelt Pauschalen beschränkt abziehbar und als Nutzungseinlage, in der Reihenfolge des Formulars", () => {
    const withPauschalen = { ...figures, verpflegung: 4_200, tagespauschale: 126_000, fahrtNutzungseinlage: 37_200 };
    const xml = buildEuerXml({ ...base, allgemein, figures: withPauschalen, anlagen: [] });
    expect(checkXml(xml)).toBeUndefined();
    expect(xml).toMatch(/<Beschr_abziehbar>\s*<Abziehbar>\s*<Verpflegung>\s*<Sum>\s*<E6005002>42,00<\/E6005002>/);
    expect(xml).toMatch(/<Tagespauschale_1>\s*<E6006405>1260,00<\/E6006405>\s*<\/Tagespauschale_1>/);
    expect(xml).toMatch(/<Fahrtkosten_Nutzungseinlage>\s*<Sum>\s*<E6006103>372,00<\/E6006103>/);
    expect(xml).not.toContain("<Nicht_abziehbar>");
    const [sonst, beschr, kfz, summe] = order(xml, ["Sonst_unbeschraenkt", "Beschr_abziehbar", "KFZ_u_Fahrtkosten", "Summe_BAus"]);
    expect(sonst! < beschr! && beschr! < kfz! && kfz! < summe!).toBe(true);
    const [kfzSonst, nutzung] = order(xml, ["E6006003", "E6006103"]);
    expect(kfzSonst! < nutzung!).toBe(true);
    // Summe der Ausgaben enthält die Pauschalen
    expect(tag(xml, "E6005301")).toBe("27674,00");
    expect(euerTotals(withPauschalen).ausgaben).toBe(2_600_000 + 4_200 + 126_000 + 37_200);
  });

  it("übermittelt die Entfernungspauschale in Zeile 73 hinter den Fahrtkosten, nicht als Nutzungseinlage (#895)", () => {
    // Formularfeld „Abziehbare Aufwendungen für Wege zwischen Wohnung und Betriebsstätte“ (Zeile 73):
    // EUER/BAus/KFZ_u_Fahrtkosten/Entfernungspausch_Familienheimfahrt/Sum/E6003702, Pfad und Reihenfolge wie im Schema
    // E77-2025.xsd und E77-2026.xsd (ERiC-Dokumentation 44.3.6.0 und 45.1.5.0).
    const mitWegen = { ...figures, fahrtNutzungseinlage: 37_200, entfernungspauschale: 6_840 };
    const xml = buildEuerXml({ ...base, allgemein, figures: mitWegen, anlagen: [] });
    expect(checkXml(xml)).toBeUndefined();
    expect(xml).toMatch(/<Entfernungspausch_Familienheimfahrt>\s*<Sum>\s*<E6003702>68,40<\/E6003702>/);
    expect(xml).toMatch(/<Fahrtkosten_Nutzungseinlage>\s*<Sum>\s*<E6006103>372,00<\/E6006103>/);
    const [nutzung, wege, summe] = order(xml, ["E6006103", "E6003702", "Summe_BAus"]);
    expect(nutzung! < wege! && wege! < summe!).toBe(true);
    expect(euerTotals(mitWegen).ausgaben).toBe(2_600_000 + 37_200 + 6_840);
    // ohne Betrag keine Zeile
    expect(buildEuerXml({ ...base, allgemein, figures, anlagen: [] })).not.toContain("E6003702");
  });

  it("übermittelt Geschenke und Bewirtung, den nicht abziehbaren Teil nur nachrichtlich", () => {
    const mitBewirtung = { ...figures, geschenke: 15_000, bewirtung: 7_000, bewirtungNichtAbziehbar: 3_000 };
    const xml = buildEuerXml({ ...base, allgemein, figures: mitBewirtung, anlagen: [] });
    expect(checkXml(xml)).toBeUndefined();
    expect(xml).toMatch(/<Beschr_abziehbar>\s*<Nicht_abziehbar>\s*<Bewirtung>\s*<Sum>\s*<E6004101>30,00<\/E6004101>/);
    expect(xml).toMatch(/<Abziehbar>\s*<Geschenke>\s*<Sum>\s*<E6004002>150,00<\/E6004002>[\s\S]*<Bewirtung>\s*<Sum>\s*<E6004102>70,00<\/E6004102>/);
    // Der nicht abziehbare Teil mindert den Gewinn nicht
    expect(euerTotals(mitBewirtung).ausgaben).toBe(euerTotals(figures).ausgaben + 15_000 + 7_000);
  });

  it("übermittelt Gewerbesteuer und Nebenleistungen nur nachrichtlich als nicht abziehbar, nach Erstattungen auch negativ", () => {
    const mitGewst = { ...figures, gewerbesteuerNichtAbziehbar: 54_300 };
    const xml = buildEuerXml({ ...base, allgemein, figures: mitGewst, anlagen: [] });
    expect(checkXml(xml)).toBeUndefined();
    expect(xml).toMatch(/<Beschr_abziehbar>\s*<Nicht_abziehbar>\s*<Sonst>\s*<Sum>\s*<E6004301>543,00<\/E6004301>/);
    expect(euerTotals(mitGewst)).toEqual(euerTotals(figures));
    // Bewirtung steht vor „Sonst“ (Schema E77)
    const beide = buildEuerXml({ ...base, allgemein, figures: { ...mitGewst, bewirtung: 7_000, bewirtungNichtAbziehbar: 3_000 }, anlagen: [] });
    expect(beide).toMatch(/<Nicht_abziehbar>\s*<Bewirtung>[\s\S]*<\/Bewirtung>\s*<Sonst>/);
    const erstattet = buildEuerXml({ ...base, allgemein, figures: { ...figures, gewerbesteuerNichtAbziehbar: -20_000 }, anlagen: [] });
    expect(tag(erstattet, "E6004301")).toBe("-200,00");
  });

  it("übermittelt Schuldzinsen aus Darlehen in den Zeilen 55 und 56, zwischen Werbung und Vorsteuer", () => {
    const mitZinsen = { ...figures, werbung: 10_000, schuldzinsenAnlage: 48_000, schuldzinsen: 24_000, vorsteuer: 5_000 };
    const xml = buildEuerXml({ ...base, allgemein, figures: mitZinsen, anlagen: [] });
    expect(checkXml(xml)).toBeUndefined();
    expect(xml).toMatch(
      /<Werbung>[\s\S]*<\/Werbung>\s*<Schuldzins_AnlageVerm>\s*<Sum>\s*<E6004202>480,00<\/E6004202>[\s\S]*<Schuldzins_Uebrige>\s*<Sum>\s*<E6004303>240,00<\/E6004303>\s*<\/Sum>\s*<\/Schuldzins_Uebrige>\s*<Vorsteuer>/,
    );
    expect(euerTotals(mitZinsen).ausgaben).toBe(euerTotals({ ...mitZinsen, schuldzinsenAnlage: 0, schuldzinsen: 0 }).ausgaben + 72_000);
  });

  it("übermittelt Miete (Zeile 39) und Erhaltungsaufwendungen (Zeile 48) an ihrer Stelle im Schema E77 (#312)", () => {
    // Schema E77-2023 bis E77-2025 (ERiC 44.3.6.0): Raumkosten_u_sonst zwischen AfA und Sonst_unbeschraenkt, Erhaltungsaufwand
    // nach Rechtsberatung_StB_Buchf (und Miete_Leasing_bewegl_WG), vor Beitrag_Gebuehr_Abgabe_Versicherung
    const mitMiete = { ...figures, beratung: 50_00, beitraegeVersicherungen: 80_00, miete: 1_200_00, erhaltung: 300_00 };
    const xml = buildEuerXml({ ...base, allgemein, figures: mitMiete, anlagen: [] });
    expect(checkXml(xml)).toBeUndefined();
    expect(xml).toMatch(
      /<\/AfA>\s*<Raumkosten_u_sonst>\s*<Miete_Pacht>\s*<Sum>\s*<E6003201>1200,00<\/E6003201>\s*<\/Sum>\s*<\/Miete_Pacht>\s*<\/Raumkosten_u_sonst>\s*<Sonst_unbeschraenkt>/,
    );
    expect(xml).toMatch(
      /<\/Rechtsberatung_StB_Buchf>\s*<Erhaltungsaufwand>\s*<Sum>\s*<E6004313>300,00<\/E6004313>\s*<\/Sum>\s*<\/Erhaltungsaufwand>\s*<Beitrag_Gebuehr_Abgabe_Versicherung>/,
    );
    expect(euerTotals(mitMiete).ausgaben).toBe(euerTotals({ ...mitMiete, miete: 0, erhaltung: 0 }).ausgaben + 1_500_00);
    // Ohne Beträge entfällt der Abschnitt ganz
    expect(buildEuerXml({ ...base, allgemein, figures, anlagen: [] })).not.toContain("Raumkosten_u_sonst");
  });

  it("lässt die AVEÜR ohne Anlagen weg", () => {
    const xml = buildEuerXml({ ...base, allgemein: { artDesBetriebs: "Handel", einkunftsart: "gewerbe" }, figures: { steuerpflichtig: 100 }, anlagen: [] });
    expect(xml).not.toContain("<AVEUER>");
    expect(tag(xml, "E6000602")).toBe("120");
    expect(tag(xml, "E6000603")).toBe("2");
    expect(tag(xml, "E6006601")).toBe("0,00");
  });
});
