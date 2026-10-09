import { describe, expect, it } from "vitest";
import { checkXml } from "./fake-client.ts";
import { buildNachrichtXml, splitStrasse } from "./nachricht.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

const input = {
  steuernummer13: "2893081508152",
  bundesland: "BW",
  absender: { name: "Tris & Co", strasse: "Hauptstraße 12a", plz: "70173", ort: "Stuttgart" },
  betreff: "Antrag auf Herabsetzung der Vorauszahlungen",
  text: "Sehr geehrte Damen und Herren,\n<bitte> herabsetzen.",
  herstellerId: "74931",
  produktVersion: "0.1.0",
  test: true,
};

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

describe("Sonstige Nachricht", () => {
  it("baut Kopf, Absender und Inhalt", () => {
    const xml = buildNachrichtXml(input);
    expect(checkXml(xml)).toBeUndefined();
    expect(tag(xml, "Verfahren")).toBe("ElsterNachricht");
    expect(datenartVersionFromXml(xml)).toBe("SonstigeNachrichten_21");
    expect(hasTestmerker(xml)).toBe(true);
    expect(xml).toContain(`<Empfaenger id="F">2893</Empfaenger>`);
    expect(tag(xml, "Strasse")).toBe("Hauptstraße");
    expect(tag(xml, "Hausnummer")).toBe("12");
    expect(tag(xml, "Hausnummernzusatz")).toBe("a");
    expect(tag(xml, "Name")).toBe("Tris &amp; Co");
    expect(tag(xml, "Text")).toBe("Sehr geehrte Damen und Herren,\n&lt;bitte&gt; herabsetzen.");
  });

  it("prüft Betreff, Text und Hausnummer", () => {
    expect(() => buildNachrichtXml({ ...input, betreff: "x".repeat(100) })).toThrow(/Betreff/);
    expect(() => buildNachrichtXml({ ...input, text: " " })).toThrow(/Text/);
    expect(() => buildNachrichtXml({ ...input, absender: { ...input.absender, strasse: "Am Markt" } })).toThrow(/Hausnummer/);
  });

  it("trennt Hausnummern", () => {
    expect(splitStrasse("Musterstraße 1")).toEqual({ strasse: "Musterstraße", hausnummer: "1" });
    expect(splitStrasse("Am Ring 12 - 14")).toEqual({ strasse: "Am Ring", hausnummer: "12", zusatz: "-14" });
    expect(splitStrasse("Allee 3 b")).toEqual({ strasse: "Allee", hausnummer: "3", zusatz: "b" });
    expect(splitStrasse("Postfach")).toBeNull();
  });
});
