import { describe, expect, it } from "vitest";
import { buildBankverbindungXml, germanDate, isValidIban, isValidIdnr } from "./bankverbindung.ts";
import { checkXml } from "./fake-client.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

const input = (overrides: Partial<Parameters<typeof buildBankverbindungXml>[0]> = {}) => ({
  steuernummer13: "2836216146249",
  bundesland: "BW",
  person: { idnr: "86095742719", anrede: "Herrn" as const, vorname: "Max", name: "Muster & Sohn", geburtsdatum: "1980-03-15" },
  iban: "DE89 3704 0044 0532 0130 00",
  herstellerId: "74931",
  produktVersion: "0.1.0",
  test: true,
  ...overrides,
});

describe("Prüfziffern", () => {
  it("prüft die Identifikationsnummer", () => {
    expect(isValidIdnr("86095742719")).toBe(true);
    expect(isValidIdnr("86095742718")).toBe(false);
    expect(isValidIdnr("06095742719")).toBe(false);
    expect(isValidIdnr("8609574271")).toBe(false);
    // Ziffernregel: genau eine Ziffer doppelt oder dreifach, dreifach nicht direkt hintereinander
    expect(isValidIdnr("41837509269")).toBe(false);
    expect(isValidIdnr("41837509365")).toBe(true);
    expect(isValidIdnr("41117509363")).toBe(false);
    expect(isValidIdnr("41137508167")).toBe(true);
    expect(isValidIdnr("41137501366")).toBe(false);
  });

  it("prüft die IBAN", () => {
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("DE88370400440532013000")).toBe(false);
  });

  it("formatiert das Datum deutsch", () => {
    expect(germanDate("1980-03-15")).toBe("15.03.1980");
    expect(() => germanDate("15.03.1980")).toThrow();
  });
});

describe("buildBankverbindungXml", () => {
  it("baut AenderungBankverbindung Version 20 wie viking", () => {
    const xml = buildBankverbindungXml(input());
    expect(checkXml(xml)).toBeUndefined();
    expect(datenartVersionFromXml(xml)).toBe("AenderungBankverbindung_20");
    expect(hasTestmerker(xml)).toBe(true);
    expect(xml).toContain("<Verfahren>ElsterNachricht</Verfahren>");
    expect(xml).toContain(`<Empfaenger id="L"><Ziel>BW</Ziel></Empfaenger>`);
    expect(xml).toContain(`<Empfaenger id="F">2836</Empfaenger>`);
    expect(xml).toContain("<Steuernummer>2836216146249</Steuernummer>");
    expect(xml).toContain("<Identifikationsnummer>86095742719</Identifikationsnummer>");
    expect(xml).toContain("<Name>Muster &amp; Sohn</Name>");
    expect(xml).toContain("<Geburtsdatum>15.03.1980</Geburtsdatum>");
    expect(xml).toContain("<IBAN>DE89370400440532013000</IBAN>");
    expect(xml).toContain("<Steuerart>Alle (übrigen)</Steuerart>");
    expect(xml).toContain("<DatenLieferant>Max Muster &amp; Sohn</DatenLieferant>");
  });

  it("lässt den Testmerker im Echtbetrieb weg", () => {
    expect(hasTestmerker(buildBankverbindungXml(input({ test: false })))).toBe(false);
  });

  it("lehnt ungültige Angaben ab", () => {
    expect(() => buildBankverbindungXml(input({ iban: "DE00370400440532013000" }))).toThrow(/IBAN/);
    expect(() => buildBankverbindungXml(input({ person: { ...input().person, idnr: "12345678901" } }))).toThrow(/Identifikationsnummer/);
    expect(() => buildBankverbindungXml(input({ steuernummer13: "123" }))).toThrow(/Steuernummer/);
  });
});
