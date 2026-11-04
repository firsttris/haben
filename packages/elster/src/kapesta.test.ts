import { describe, expect, it } from "vitest";
import { buildKapEStAXml, tagDanach, zuflussTag, type KapEStAInput } from "./kapesta.ts";
import { datenartVersionFromXml } from "./xml.ts";

const basis: KapEStAInput = {
  steuernummer13: "2893081508152",
  bundesland: "BW",
  schuldner: { name: "Nordlicht GmbH", strasse: "Hauptstraße 12a", plz: "70173", ort: "Stuttgart" },
  ertrag: 1_000_000,
  kapest: 250_000,
  soli: 13_750,
  kirchensteuer: [],
  beschluss: { datum: "2026-06-15", betrag: 1_000_000 },
  herstellerId: "12345",
  produktVersion: "0.1.0",
  test: true,
};

describe("Kapitalertragsteuer-Anmeldung", () => {
  it("Zufluss am Auszahlungstag, sonst am Tag nach dem Beschluss, auch über Monats- und Jahresgrenzen", () => {
    expect(zuflussTag({ datum: "2026-06-15", betrag: 1, auszahlungstag: "2026-07-01" })).toBe("2026-07-01");
    expect(zuflussTag({ datum: "2026-06-30", betrag: 1 })).toBe("2026-07-01");
    expect(tagDanach("2025-12-31")).toBe("2026-01-01");
    expect(tagDanach("2028-02-28")).toBe("2028-02-29");
  });

  it("Jahr aus dem Zufluss; Testmerker für KapESt; Datenart-Version", () => {
    const xml = buildKapEStAXml({ ...basis, beschluss: { datum: "2025-12-31", betrag: 1_000_000 } });
    expect(xml).toContain('<KapEStA xmlns="http://finkonsens.de/elster/elsterkapest/kapesta/v2026" version="2026">');
    expect(xml).toContain("<AnmZtr>20260101</AnmZtr>");
    expect(xml).toContain("<TagNachBeschl>20260101</TagNachBeschl>");
    expect(xml).toContain("<Testmerker>160000001</Testmerker>");
    expect(xml).toContain("<KapESch25St>2500.00</KapESch25St>");
    expect(xml).toContain("<KapESchStSum>2500</KapESchStSum>");
    expect(datenartVersionFromXml(xml)).toBe("KapEStA_2026");
    expect(buildKapEStAXml({ ...basis, test: false })).not.toContain("Testmerker");
  });

  it("Kirchensteuer je Religionsschlüssel zusammengefasst, in der Reihenfolge des Schemas, mit Summe", () => {
    const xml = buildKapEStAXml({
      ...basis,
      kirchensteuer: [
        { religionsschluessel: "026300", betrag: 1_000 },
        { religionsschluessel: "010100", betrag: 500 },
        { religionsschluessel: "026300", betrag: 250 },
      ],
    });
    expect(xml.indexOf("<K010100>5.00</K010100>")).toBeGreaterThan(0);
    expect(xml.indexOf("<K026300>12.50</K026300>")).toBeGreaterThan(xml.indexOf("<K010100>"));
    expect(xml).toContain("<KSum>17.50</KSum>");
    expect(buildKapEStAXml(basis)).not.toContain("Kirchensteuerdaten");
  });

  it("lehnt unbekannte Jahre und Religionsschlüssel ab", () => {
    expect(() => buildKapEStAXml({ ...basis, beschluss: { datum: "2024-05-01", betrag: 1 } })).toThrow("nicht für 2024");
    expect(() => buildKapEStAXml({ ...basis, kirchensteuer: [{ religionsschluessel: "999999", betrag: 1 }] })).toThrow("gibt es nicht");
  });
});
