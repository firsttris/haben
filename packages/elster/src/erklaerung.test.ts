import { describe, expect, it } from "vitest";
import { checkXml } from "./fake-client.ts";
import { buildEuerXml, buildUstErklaerungXml, euerTotals, ustErklaerungResult, type AveuerAnlage } from "./erklaerung.ts";
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
    const xml = buildUstErklaerungXml({ ...base, test: false, versteuerung: "soll", figures: { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 50_000, vorauszahlungen: -40_000 } });
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
    { gruppe: "kfz", bezeichnung: "Tesla Model 3", anschaffung: "2024-03-15", anschaffungskosten: 4_000_000, buchwertBeginn: 3_444_444, afa: 666_667, abgang: 0, buchwertEnde: 2_777_777 },
    { gruppe: "andere", bezeichnung: "MacBook Pro", anschaffung: "2025-02-01", anschaffungskosten: 233_333, buchwertBeginn: 233_333, afa: 233_333, abgang: 0, buchwertEnde: 0 },
    { gruppe: "sammelposten", bezeichnung: "Sammelposten 2025", anschaffung: "2025-06-01", anschaffungskosten: 90_000, buchwertBeginn: 90_000, afa: 18_000, abgang: 0, buchwertEnde: 72_000 },
    { gruppe: "sammelposten", bezeichnung: "Sammelposten 2023", anschaffung: "2023-06-01", anschaffungskosten: 50_000, buchwertBeginn: 30_000, afa: 10_000, abgang: 0, buchwertEnde: 20_000 },
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
    const [allg, bein, baus, gewinnNode, zus, av, vorsatz] = order(xml, ["Allg", "BEin", "BAus", "Ermittlung_Gewinn", "Zus_Angabe_EinzelUntern", "AVEUER", "Vorsatz"]);
    expect([allg, bein, baus, gewinnNode, zus, av, vorsatz]).toEqual([...[allg, bein, baus, gewinnNode, zus, av, vorsatz]].sort((a, b) => a! - b!));
    const [stfrei, vereinnahmt, kfz] = order(xml, ["USt_StFrei", "USt_Vereinnahmt_Unentgeltl", "Nutzung_Priv_Kfz"]);
    expect(stfrei! < vereinnahmt! && vereinnahmt! < kfz!).toBe(true);
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

  it("übermittelt Geschenke und Bewirtung, den nicht abziehbaren Teil nur nachrichtlich", () => {
    const mitBewirtung = { ...figures, geschenke: 15_000, bewirtung: 7_000, bewirtungNichtAbziehbar: 3_000 };
    const xml = buildEuerXml({ ...base, allgemein, figures: mitBewirtung, anlagen: [] });
    expect(checkXml(xml)).toBeUndefined();
    expect(xml).toMatch(/<Beschr_abziehbar>\s*<Nicht_abziehbar>\s*<Bewirtung>\s*<Sum>\s*<E6004101>30,00<\/E6004101>/);
    expect(xml).toMatch(/<Abziehbar>\s*<Geschenke>\s*<Sum>\s*<E6004002>150,00<\/E6004002>[\s\S]*<Bewirtung>\s*<Sum>\s*<E6004102>70,00<\/E6004102>/);
    // Der nicht abziehbare Teil mindert den Gewinn nicht
    expect(euerTotals(mitBewirtung).ausgaben).toBe(euerTotals(figures).ausgaben + 15_000 + 7_000);
  });

  it("lässt die AVEÜR ohne Anlagen weg", () => {
    const xml = buildEuerXml({ ...base, allgemein: { artDesBetriebs: "Handel", einkunftsart: "gewerbe" }, figures: { steuerpflichtig: 100 }, anlagen: [] });
    expect(xml).not.toContain("<AVEUER>");
    expect(tag(xml, "E6000602")).toBe("120");
    expect(tag(xml, "E6000603")).toBe("2");
    expect(tag(xml, "E6006601")).toBe("0,00");
  });
});
