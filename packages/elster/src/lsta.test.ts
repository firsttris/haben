import type { LstaKennzahlen } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buildLStAXml, lstaAusfuellliste, type LStAInput } from "./lsta.ts";
import { datenartVersionFromXml } from "./xml.ts";

const null3 = { vorjahr: 0, lfdJahr: 0, folgejahr: 0 };

/** Gesellschafter-Geschäftsführer, 6.000 € brutto, StKl I, ev. 8 % (Bayern): Werte des BMF-Steuerrechners 2026 */
export const GGF_NOVEMBER: LstaKennzahlen = {
  kz42: { vorjahr: 0, lfdJahr: 1_289_33, folgejahr: 0 },
  kz49: null3,
  kirche: { kz61: { vorjahr: 0, lfdJahr: 103_14, folgejahr: 0 }, kz62: null3, kz63: null3 },
  kz48: 1_289_33,
  kz83: 1_392_47,
  kz86: 1,
};

const basis: LStAInput = {
  zeitraum: { year: 2026, zeitraum: 11 },
  steuernummer13: "9198011310134",
  kennzahlen: GGF_NOVEMBER,
  berichtigt: false,
  datenlieferant: { name: "Nordlicht Software GmbH", strasse: "Hafenallee 3", plz: "80331", ort: "München" },
  herstellerId: "12345",
  produktVersion: "0.1.0",
  test: true,
  erstellungsdatum: new Date(2026, 11, 3),
};

const ohneLeer = (xml: string) => xml.replace(/\n/g, "");

describe("Lohnsteuer-Anmeldung", () => {
  it("2026: Kennzahlen in Steuerfall/Lohnsteueranmeldung in der Reihenfolge des Schemas, Testmerker, Datenart LStA", () => {
    const xml = buildLStAXml(basis);
    expect(xml).toContain("<Verfahren>ElsterAnmeldung</Verfahren>");
    expect(xml).toContain("<DatenArt>LStA</DatenArt>");
    expect(xml).toContain("<Testmerker>700000004</Testmerker>");
    expect(xml).toContain('<Empfaenger id="F">9198</Empfaenger>');
    expect(datenartVersionFromXml(xml)).toBe("LStA_2026");
    expect(ohneLeer(xml)).toContain(
      '<Anmeldungssteuern xmlns="http://finkonsens.de/elster/elsteranmeldung/lsta/v2026" version="2026"><Erstellungsdatum>20261203</Erstellungsdatum><DatenLieferant>',
    );
    expect(ohneLeer(xml)).toContain(
      "<Steuerfall><Lohnsteueranmeldung><Jahr>2026</Jahr><Zeitraum>11</Zeitraum><Steuernummer>9198011310134</Steuernummer><Kz09>12345</Kz09>" +
        "<Kz42_lfdJahr>1289.33</Kz42_lfdJahr><Kz42>1289.33</Kz42><Kz48>1289.33</Kz48><Kz49>0.00</Kz49>" +
        "<Kz61_lfdJahr>103.14</Kz61_lfdJahr><Kz61>103.14</Kz61><Kz83>1392.47</Kz83><Kz86>1</Kz86></Lohnsteueranmeldung></Steuerfall>",
    );
    expect(buildLStAXml({ ...basis, test: false })).not.toContain("Testmerker");
  });

  it("Berichtigte Anmeldung mit Kz 10, Quartal und Kalenderjahr als Zeitraum 41–44 und 19", () => {
    expect(buildLStAXml({ ...basis, berichtigt: true })).toContain("<Kz09>12345</Kz09>\n<Kz10>1</Kz10>");
    expect(buildLStAXml({ ...basis, zeitraum: { year: 2026, zeitraum: 44 } })).toContain("<Zeitraum>44</Zeitraum>");
    expect(buildLStAXml({ ...basis, zeitraum: { year: 2026, zeitraum: 19 } })).toContain("<Zeitraum>19</Zeitraum>");
    expect(buildLStAXml({ ...basis, zeitraum: { year: 2026, zeitraum: 3 } })).toContain("<Zeitraum>03</Zeitraum>");
  });

  it("nur Minijob mit Pauschsteuer: Kz 42, 48, 49 und 83 mit 0, Zahl der Arbeitnehmer", () => {
    const xml = ohneLeer(
      buildLStAXml({ ...basis, kennzahlen: { kz42: null3, kz49: null3, kirche: { kz61: null3, kz62: null3, kz63: null3 }, kz48: 0, kz83: 0, kz86: 1 } }),
    );
    expect(xml).toContain("<Kz09>12345</Kz09><Kz42>0.00</Kz42><Kz48>0.00</Kz48><Kz49>0.00</Kz49><Kz83>0.00</Kz83><Kz86>1</Kz86>");
  });

  it("Vorjahr und Folgejahr aufgeteilt, Kirchensteuer rk und ak", () => {
    const k: LstaKennzahlen = {
      kz42: { vorjahr: 100_00, lfdJahr: 200_00, folgejahr: 0 },
      kz49: { vorjahr: 1_00, lfdJahr: 0, folgejahr: 0 },
      kirche: { kz61: null3, kz62: { vorjahr: 0, lfdJahr: 9_00, folgejahr: 0 }, kz63: { vorjahr: 8_00, lfdJahr: 0, folgejahr: 0 } },
      kz48: 300_00,
      kz83: 318_00,
      kz86: 2,
    };
    const xml = ohneLeer(buildLStAXml({ ...basis, zeitraum: { year: 2027, zeitraum: 1 }, kennzahlen: k }));
    expect(xml).toContain("<Kz42_Vorjahr>100.00</Kz42_Vorjahr><Kz42_lfdJahr>200.00</Kz42_lfdJahr><Kz42>300.00</Kz42>");
    expect(xml).toContain("<Kz49_Vorjahr>1.00</Kz49_Vorjahr><Kz49>1.00</Kz49><Kz62_lfdJahr>9.00</Kz62_lfdJahr><Kz62>9.00</Kz62>");
    expect(xml).toContain("<Kz63_Vorjahr>8.00</Kz63_Vorjahr><Kz63>8.00</Kz63><Kz83>318.00</Kz83>");
  });

  it("2027: neuer Aufbau mit Allgemein, Lohnsteueranmeldung und LStSoliKi (LStA-2027.xsd)", () => {
    const xml = ohneLeer(buildLStAXml({ ...basis, zeitraum: { year: 2027, zeitraum: 2 }, berichtigt: true }));
    expect(datenartVersionFromXml(xml)).toBe("LStA_2027");
    expect(xml).toContain(
      '<Anmeldungssteuern xmlns="http://finkonsens.de/elster/elsteranmeldung/lsta/v2027" version="2027"><Erstellungsdatum>20261203</Erstellungsdatum>' +
        "<Steuernummer>9198011310134</Steuernummer><Allgemein><Jahr>2027</Jahr><Zeitraum>02</Zeitraum></Allgemein><DatenLieferant>",
    );
    expect(xml).toContain("<Lohnsteueranmeldung><Kz09>12345</Kz09><Kz10>1</Kz10><Kz86>1</Kz86></Lohnsteueranmeldung><LStSoliKi><Kz42_lfdJahr>");
    expect(xml).toContain("<Kz83>1392.47</Kz83></LStSoliKi></Anmeldungssteuern>");
    expect(() => buildLStAXml({ ...basis, zeitraum: { year: 2027, zeitraum: 2 }, herstellerId: "12345*Haben*" })).toThrow("fünfstellige");
  });

  it("lehnt Jahre ohne Schema und falsche Summen ab", () => {
    expect(() => buildLStAXml({ ...basis, zeitraum: { year: 2025, zeitraum: 12 } })).toThrow("nicht für 2025");
    expect(() => buildLStAXml({ ...basis, zeitraum: { year: 2028, zeitraum: 1 } })).toThrow("nicht für 2028");
    expect(() => buildLStAXml({ ...basis, kennzahlen: { ...GGF_NOVEMBER, kz83: 1 } })).toThrow("Kz 83");
    expect(() => buildLStAXml({ ...basis, steuernummer13: "123" })).toThrow("13-stellig");
  });

  it("Ausfüllliste für Mein ELSTER: Felder mit Bezeichnung und Eingabe mit Komma, ohne Kz 09", () => {
    const liste = lstaAusfuellliste({ ...basis, berichtigt: true });
    expect(liste.zeitraum).toBe("November 2026");
    expect(liste.felder.map((f) => f.kennung)).toEqual(["Kz10", "Kz42_lfdJahr", "Kz42", "Kz48", "Kz49", "Kz61_lfdJahr", "Kz61", "Kz83", "Kz86"]);
    expect(liste.felder[1]).toEqual({
      kennung: "Kz42_lfdJahr",
      bezeichnung: "Summe der einzubehaltenden Lohnsteuer: laufendes Jahr (Kz 42)",
      eingabe: "1289,33",
    });
    expect(liste.felder.at(-1)).toEqual({ kennung: "Kz86", bezeichnung: "Zahl der Arbeitnehmer (Kz 86)", eingabe: "1" });
  });
});
