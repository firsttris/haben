import { describe, expect, it } from "vitest";
import { checkXml } from "./fake-client.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";
import { buildZmXml, zmZeitraumSchluessel, type ZmXmlInput } from "./zm.ts";

const base: ZmXmlInput = {
  period: { year: 2025, month: 43 },
  ustId: "DE123456788",
  anschrift: { name: "Tris Software", strasse: "Hauptstraße 12a", plz: "70173", ort: "Stuttgart" },
  zeilen: [
    { ustId: "ATU12345678", art: "S", betrag: 150_099 },
    { ustId: "FR12345678901", art: "S", betrag: -20_000 },
  ],
  berichtigt: false,
  herstellerId: "12345",
  produktVersion: "0.1.0",
  test: true,
};

const nutzdaten = (xml: string) => xml.slice(xml.indexOf("<zm "), xml.indexOf("</zm>") + "</zm>".length);

describe("buildZmXml (Datenart ZMDO)", () => {
  it("Umschlag: ElsterExtern an das BZSt (Empfänger BF), Datenart ohne Jahr", () => {
    const xml = buildZmXml(base);
    expect(xml).toContain("<Verfahren>ElsterExtern</Verfahren>");
    expect(xml).toContain("<DatenArt>ZMDO</DatenArt>");
    expect(xml).toContain(`<Empfaenger id="L">BF</Empfaenger>`);
    expect(datenartVersionFromXml(xml)).toBe("ZMDO");
    expect(hasTestmerker(xml)).toBe(true);
    expect(hasTestmerker(buildZmXml({ ...base, test: false }))).toBe(false);
    expect(checkXml(xml)).toBeUndefined();
  });

  it("Nutzdaten in der Reihenfolge des Schemas, Beträge in vollen Euro", () => {
    expect(nutzdaten(buildZmXml(base))).toBe(
      [
        `<zm xmlns="http://www.elster.de/elsterxml/schema/v11" version="000005">`,
        "<unternehmer>",
        "<knri>DE123456788</knri>",
        "<zulassNr><zulnr1>N</zulnr1><zulnr2>1111111</zulnr2></zulassNr>",
        "<anschrift>",
        "<name>Tris Software</name>",
        "<strasse>Hauptstraße</strasse>",
        "<hausnr>12</hausnr>",
        "<hausnrzusatz>a</hausnrzusatz>",
        "<plz>70173</plz>",
        "<ort>Stuttgart</ort>",
        "<staat>DE</staat>",
        "</anschrift>",
        `<zm-zeilen meldeart="10" waehrung="1">`,
        "<anzeige>false</anzeige>",
        "<widerruf>false</widerruf>",
        "<mzr><quart>3</quart><jahr>2025</jahr></mzr>",
        `<zeile umsatzart="S"><knre>ATU12345678</knre><betrag>1500</betrag></zeile>`,
        `<zeile umsatzart="S"><knre>FR12345678901</knre><betrag>-200</betrag></zeile>`,
        "</zm-zeilen>",
        "</unternehmer>",
        "</zm>",
      ].join("\n"),
    );
  });

  it("Berichtigung: meldeart 11, eine Zeile mit 0 nimmt eine gemeldete zurück", () => {
    const xml = buildZmXml({ ...base, berichtigt: true, zeilen: [{ ustId: "ATU12345678", art: "S", betrag: 0 }] });
    expect(xml).toContain(`<zm-zeilen meldeart="11" waehrung="1">`);
    expect(xml).toContain(`<zeile umsatzart="S"><knre>ATU12345678</knre><betrag>0</betrag></zeile>`);
  });

  it("Straße ohne Hausnummer bleibt ganz", () => {
    const xml = buildZmXml({ ...base, anschrift: { ...base.anschrift, strasse: "Am Markt" } });
    expect(xml).toContain("<strasse>Am Markt</strasse>\n<plz>");
  });

  it("lehnt ab, was ERiC abweisen würde", () => {
    expect(() => buildZmXml({ ...base, ustId: "DE123456789" })).toThrow(/Prüfziffer/);
    expect(() => buildZmXml({ ...base, zeilen: [] })).toThrow(/keine Zusammenfassende Meldung/);
    expect(() => buildZmXml({ ...base, berichtigt: true, zeilen: [] })).toThrow(/nichts zu berichtigen/);
    expect(() => buildZmXml({ ...base, zeilen: [{ ustId: "ATU12345678", art: "S", betrag: 99 }] })).toThrow(/Nullmeldungen/);
    expect(() => buildZmXml({ ...base, zeilen: [{ ustId: "DE136695976", art: "S", betrag: 10_000 }] })).toThrow(/deutsche/);
    expect(() => buildZmXml({ ...base, zeilen: [base.zeilen[0]!, base.zeilen[0]!] })).toThrow(/doppelt/);
    expect(() => buildZmXml({ ...base, anschrift: { ...base.anschrift, plz: "" } })).toThrow(/PLZ/);
  });
});

describe("zmZeitraumSchluessel (Element quart)", () => {
  it("Quartale 1–4, Monate 21–32", () => {
    expect(zmZeitraumSchluessel({ year: 2025, month: 41 })).toBe(1);
    expect(zmZeitraumSchluessel({ year: 2025, month: 44 })).toBe(4);
    expect(zmZeitraumSchluessel({ year: 2025, month: 1 })).toBe(21);
    expect(zmZeitraumSchluessel({ year: 2025, month: 12 })).toBe(32);
  });
});
