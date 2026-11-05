import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkXml } from "./fake-client.ts";
import { buildLStBStornoXml, buildLStBXml, lstbOhneSchnittstelle } from "./lstb.ts";
import { LSTB_BASIS, LSTB_STORNO, LSTB_WERTE } from "./lstb.testdaten.ts";
import { datenartVersionFromXml, ElsterEingabeError, hasTestmerker } from "./xml.ts";

/**
 * Lohnsteuerbescheinigung bis 2025 (ElsterLohn, LStB 202501). Der Aufbau folgt lstb202501.xsd und den Beispielen
 * ELO_DatenLieferung_LStB_202501_Neu/_Korrektur.xml der ERiC-Dokumentation. ERiC prüft die Nutzdaten nicht; mit
 * ERIC_DOKU (Verzeichnis „Dokumentation“ eines entpackten ERiC-Dokumentationspakets) prüft der Schema-Validator des JDK
 * sie gegen das Schema (xmllint kann die Muster mit \p{…} in allg000008.xsd nicht übersetzen):
 *   ERIC_DOKU=…/ERiC-45.1.5.0/Dokumentation bunx vitest run packages/elster/src/lstb.test.ts
 */

const nutzdaten = (xml: string) => xml.slice(xml.indexOf("<Nutzdaten>") + "<Nutzdaten>".length, xml.indexOf("</Nutzdaten>")).trim();

const schemaDir = process.env.ERIC_DOKU ? join(process.env.ERIC_DOKU, "Datenarten/ElsterLohn/Schema") : "";
const mitSchema = Boolean(schemaDir && existsSync(schemaDir));

/** Prüft eine Datei gegen ein Schema mit javax.xml.validation (Java 11 startet eine einzelne Quelldatei direkt) */
const VALIDATOR = `
import javax.xml.XMLConstants;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.SchemaFactory;
public class XsdPruefen {
  public static void main(String[] a) throws Exception {
    SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI).newSchema(new java.io.File(a[0])).newValidator().validate(new StreamSource(new java.io.File(a[1])));
  }
}`;

/** Nutzdaten gegen das Adapter-Schema; gibt die Fehlermeldung zurück, leer wenn gültig */
function gegenSchema(xml: string, adapter: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lstb-"));
  try {
    const file = join(dir, "nutzdaten.xml");
    writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n${nutzdaten(xml)}`);
    writeFileSync(join(dir, "XsdPruefen.java"), VALIDATOR);
    execFileSync("java", [join(dir, "XsdPruefen.java"), join(schemaDir, adapter), file], { stdio: "pipe" });
    return "";
  } catch (error) {
    return String((error as { stderr?: Buffer }).stderr ?? error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("buildLStBXml (ElsterLohn, LStB 2025)", () => {
  it("Umschlag: an die Clearingstelle, Land im NutzdatenHeader, Testmerker 220000000", () => {
    const xml = buildLStBXml(LSTB_BASIS);
    expect(xml).toContain("<Verfahren>ElsterLohn</Verfahren>");
    expect(xml).toContain("<DatenArt>LStB</DatenArt>");
    expect(xml).toContain("<Testmerker>220000000</Testmerker>");
    expect(xml).toContain(`<Empfaenger id="L"><Ziel>CS</Ziel></Empfaenger>`);
    expect(xml).toContain(`<Empfaenger id="L">HB</Empfaenger>`);
    expect(datenartVersionFromXml(xml)).toBe("ElsterLohn");
    expect(hasTestmerker(buildLStBXml({ ...LSTB_BASIS, test: false }))).toBe(false);
    expect(checkXml(xml)).toBeUndefined();
  });

  it("Nutzdaten in der Reihenfolge des Schemas, Beträge mit Punkt, leere Zeilen entfallen", () => {
    expect(nutzdaten(buildLStBXml(LSTB_BASIS))).toBe(
      [
        `<Lohnsteuerbescheinigung xmlns="http://finkonsens.de/rms/elo/lstb/v202501" version="202501" art="ELStAM">`,
        `<Anweisung art="Neu"><KmId>2025-LST-86095742719-01013112-2475081508152-7-NEU-001</KmId></Anweisung>`,
        `<Dauer jahr="2025"><Anfang>0101</Anfang><Ende>3112</Ende></Dauer>`,
        "<Allgemein><IdNr>86095742719</IdNr><Ordnungsmerkmal>7</Ordnungsmerkmal><Person><Familienname><Name>Beispiel</Name><Vorname>Max</Vorname></Familienname>",
        "<Geburtsdatum>19850327</Geburtsdatum><Adresse><Str>Lindenweg</Str><Hausnummer>1</Hausnummer><HNrZusatz>a</HNrZusatz><Ort>Bremen</Ort><PLZ>28195</PLZ></Adresse></Person></Allgemein>",
        `<Besteuerungsmerkmale><ELStAM gueltig_ab="2025-01-01"><Steuerklasse>1</Steuerklasse><Kirchensteuerabzug konfession="ev"/></ELStAM>`,
        `<ELStAM gueltig_ab="2025-07-01"><Steuerklasse>3</Steuerklasse><Kinder>1.5</Kinder><Kirchensteuerabzug konfession="rk"/></ELStAM></Besteuerungsmerkmale>`,
        "<Besteuerungsgrundlagen><BruttoArbLohn>48000.00</BruttoArbLohn><LSteuer>5412.00</LSteuer><Soli>0.00</Soli><ArbnKiSteuer>487.08</ArbnKiSteuer>",
        "<ArbgAnteilRenVers>4464.00</ArbgAnteilRenVers><ArbnAnteilRenVers>4464.00</ArbnAnteilRenVers><ArbnAnteilKrankVers>4248.00</ArbnAnteilKrankVers>",
        "<ArbnAnteilPflegVers>864.00</ArbnAnteilPflegVers><ArbnAnteilArblVers>624.00</ArbnAnteilArblVers>",
        "<Arbeitgeber><ArbGName>Nordlicht Software GmbH</ArbGName><ArbGFANr>2475</ArbGFANr><ArbGFAName>Finanzamt Bremen</ArbGFAName><ArbGStNr>2475081508152</ArbGStNr>",
        "<Adresse><Str>Hafenallee</Str><Hausnummer>3</Hausnummer><Ort>Bremen</Ort><PLZ>28217</PLZ></Adresse></Arbeitgeber></Besteuerungsgrundlagen></Lohnsteuerbescheinigung>",
      ].join(""),
    );
  });

  it("Korrektur mit RefKmId und Grund; privater Basisbeitrag in Zeile 28; Faktor", () => {
    const xml = buildLStBXml({
      ...LSTB_BASIS,
      anweisung: { art: "Korrektur", kmId: "K-2", refKmId: "N-1", korrekturGrund: "Einfache Berichtigung" },
      werte: { ...LSTB_WERTE, pkvBasis: { letzterMonat: 650_00, jahr: 7_800_00 }, merkmale: [{ ...LSTB_WERTE.merkmale[0]!, steuerklasse: 4, faktor: 912 }] },
    });
    expect(xml).toContain(
      `<Anweisung art="Korrektur"><KmId>K-2</KmId><RefKmId>N-1</RefKmId><KorrekturGrund>Einfache Berichtigung</KorrekturGrund></Anweisung>`,
    );
    expect(xml).toContain("<BeitrPrKrankVers>7800.00</BeitrPrKrankVers>");
    expect(xml).toContain(`<Steuerklasse faktor="0.912">4</Steuerklasse>`);
  });

  it("lehnt Jahre ohne Schnittstelle ab, ab 2026 mit Hinweis auf ElsterKMV", () => {
    expect(() => buildLStBXml({ ...LSTB_BASIS, werte: { ...LSTB_WERTE, jahr: 2026 } })).toThrow(ElsterEingabeError);
    expect(lstbOhneSchnittstelle(2026)).toContain("LSTMitteilung");
    expect(lstbOhneSchnittstelle(2024)).toContain("2025");
    expect(lstbOhneSchnittstelle(2025)).toBeNull();
    expect(() => buildLStBStornoXml({ ...LSTB_STORNO, jahr: 2026 })).toThrow(/ElsterKMV/);
  });

  it("lehnt fehlende und zu lange Angaben ab, statt abzuschneiden", () => {
    expect(() => buildLStBXml({ ...LSTB_BASIS, arbeitnehmer: { ...LSTB_BASIS.arbeitnehmer, idnr: "" } })).toThrow(/Steuer-ID/);
    expect(() => buildLStBXml({ ...LSTB_BASIS, arbeitgeber: { ...LSTB_BASIS.arbeitgeber, finanzamt: "" } })).toThrow(/Finanzamts/);
    expect(() => buildLStBXml({ ...LSTB_BASIS, arbeitgeber: { ...LSTB_BASIS.arbeitgeber, name: "x".repeat(61) } })).toThrow(/60/);
    expect(() => buildLStBXml({ ...LSTB_BASIS, arbeitnehmer: { ...LSTB_BASIS.arbeitnehmer, plz: "1234" } })).toThrow(/Postleitzahl/);
  });
});

describe("buildLStBStornoXml (LStBStorno Version 2)", () => {
  it("verweist auf die stornierte Mitteilung", () => {
    expect(nutzdaten(buildLStBStornoXml(LSTB_STORNO))).toBe(
      [
        `<LStBStorno xmlns="http://finkonsens.de/rms/elo/lstbstorno/v2" version="2">`,
        `<Anweisung art="Storno"><KmId>2025-LST-86095742719-01013112-2475081508152-7-STO-002</KmId><RefKmId>2025-LST-86095742719-01013112-2475081508152-7-NEU-001</RefKmId></Anweisung>`,
        "<Zuflussjahr>2025</Zuflussjahr><Allgemein><IdNr>86095742719</IdNr><Ordnungsmerkmal>7</Ordnungsmerkmal></Allgemein>",
        "<Arbeitgeber><ArbGName>Nordlicht Software GmbH</ArbGName><ArbGStNr>2475081508152</ArbGStNr></Arbeitgeber></LStBStorno>",
      ].join(""),
    );
  });
});

describe.skipIf(!mitSchema)("gegen das Schema (ERIC_DOKU)", () => {
  it("Neu, Korrektur mit Zeile 28 und Faktor, Storno", () => {
    expect(gegenSchema(buildLStBXml(LSTB_BASIS), "lstb202501_adapter.xsd")).toBe("");
    const korrektur = buildLStBXml({
      ...LSTB_BASIS,
      anweisung: { art: "Korrektur", kmId: "2025-LST-K-2", refKmId: LSTB_BASIS.anweisung.kmId, korrekturGrund: "Einfache Berichtigung" },
      werte: {
        ...LSTB_WERTE,
        soli: 12_34,
        pkvBasis: { letzterMonat: 650_00, jahr: 7_800_00 },
        merkmale: [{ ...LSTB_WERTE.merkmale[0]!, steuerklasse: 4, faktor: 912 }],
      },
    });
    expect(gegenSchema(korrektur, "lstb202501_adapter.xsd")).toBe("");
    expect(gegenSchema(buildLStBStornoXml(LSTB_STORNO), "lstb_storno_000002_adapter.xsd")).toBe("");
  });
});
