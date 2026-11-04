import { describe, expect, it } from "vitest";
import { buildDauerfristXml, type DauerfristXmlInput } from "./dauerfrist.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

const base: DauerfristXmlInput = {
  year: 2026,
  steuernummer13: "9198011310010",
  sondervorauszahlung: 400_050,
  datenlieferant: { name: "Erika Mustermann", strasse: "Hauptstr. 1", plz: "10115", ort: "Berlin" },
  herstellerId: "12345",
  produktVersion: "0.1.0",
  test: true,
  erstellungsdatum: new Date(2026, 1, 2),
};

const nutzdaten = (xml: string) => xml.slice(xml.indexOf("<Steuerfall>"), xml.indexOf("</Steuerfall>") + "</Steuerfall>".length);

describe("buildDauerfristXml (USt 1 H)", () => {
  it("monatlich: Anmeldung der Sondervorauszahlung in vollen Euro", () => {
    const xml = buildDauerfristXml(base);
    expect(nutzdaten(xml)).toBe(
      [
        "<Steuerfall>",
        "<Umsatzsteuersondervorauszahlung>",
        "<Jahr>2026</Jahr>",
        "<Steuernummer>9198011310010</Steuernummer>",
        "<Kz09>12345</Kz09>",
        "<Kz38>4000</Kz38>",
        "</Umsatzsteuersondervorauszahlung>",
        "</Steuerfall>",
      ].join("\n"),
    );
    expect(xml).toContain("<DatenArt>UStVA</DatenArt>");
    expect(xml).toContain('<Empfaenger id="F">9198</Empfaenger>');
    expect(datenartVersionFromXml(xml)).toBe("UStVA_2026");
    expect(hasTestmerker(xml)).toBe(true);
  });

  it("berichtigt mit Kz 10, auch mit 0 €", () => {
    const xml = buildDauerfristXml({ ...base, sondervorauszahlung: 0, berichtigt: true });
    expect(xml).toContain("<Kz10>1</Kz10>\n<Kz38>0</Kz38>");
  });

  it("vierteljährlich: Antrag nur mit Kz 09", () => {
    const xml = buildDauerfristXml({ ...base, sondervorauszahlung: null, test: false });
    expect(nutzdaten(xml)).toContain(
      "<Dauerfristverlaengerung>\n<Jahr>2026</Jahr>\n<Steuernummer>9198011310010</Steuernummer>\n<Kz09>12345</Kz09>\n</Dauerfristverlaengerung>",
    );
    expect(xml).not.toContain("Kz38");
    expect(hasTestmerker(xml)).toBe(false);
  });

  it("lehnt ab, was ERiC ablehnen würde", () => {
    expect(() => buildDauerfristXml({ ...base, sondervorauszahlung: -100 })).toThrow("nicht negativ");
    expect(() => buildDauerfristXml({ ...base, sondervorauszahlung: null, berichtigt: true })).toThrow("nicht berichtigen");
    expect(() => buildDauerfristXml({ ...base, steuernummer13: "123" })).toThrow("13-stellig");
  });
});
