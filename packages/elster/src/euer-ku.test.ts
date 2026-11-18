import { describe, expect, it } from "vitest";
import { buildEuerXml, euerTotals } from "./euer-erklaerung.ts";
import { EUER_FIELDS } from "./euer-felder.ts";

const input = {
  year: 2025,
  steuernummer13: "2893081508152",
  bundesland: "BW",
  absender: { name: "Musterpraxis", strasse: "Hauptstr. 1", plz: "70173", ort: "Stuttgart" },
  herstellerId: "74931",
  produktVersion: "0.1.0",
  test: true,
  allgemein: { artDesBetriebs: "Heilbehandlung", einkunftsart: "selbstaendig" as const },
  anlagen: [],
};

describe("Nachrichtliche KU-Umsätze in EÜR-Zeile 13", () => {
  it("übermittelt E6000201 getrennt von Zeile 12 und zählt sie nicht ein zweites Mal zum Gewinn", () => {
    const figures = { kleinunternehmer: 150_00, kleinunternehmerAbzuege: 100_00 };
    expect(EUER_FIELDS.kleinunternehmerAbzuege.kz).toBe("E6000201");
    expect(euerTotals(figures)).toEqual({ einnahmen: 150_00, ausgaben: 0, gewinn: 150_00 });
    const xml = buildEuerXml({ ...input, figures }).replace(/>\s+</g, "><");
    expect(xml).toContain("<Kleinunternehmer><Sum><E6000101>150,00</E6000101></Sum></Kleinunternehmer>");
    expect(xml).toContain("<Umsatz_nicht_steuerbar><Sum><E6000201>100,00</E6000201></Sum></Umsatz_nicht_steuerbar>");
    expect(xml).toContain("<E6001201>150,00</E6001201>");
    expect(xml).toContain("<E6007202>150,00</E6007202>");
    expect(xml.indexOf("<Kleinunternehmer>")).toBeLessThan(xml.indexOf("<Umsatz_nicht_steuerbar>"));
    expect(xml).not.toContain("<USt_StFrei>");
  });

  it("lässt einen fehlenden oder leeren Nachrichtsbetrag weg", () => {
    for (const figures of [{ kleinunternehmer: 100_00 }, { kleinunternehmer: 100_00, kleinunternehmerAbzuege: 0 }])
      expect(buildEuerXml({ ...input, figures })).not.toContain("<Umsatz_nicht_steuerbar>");
  });
});
