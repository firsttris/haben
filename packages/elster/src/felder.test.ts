import { describe, expect, it } from "vitest";
import { buildEuerXml, buildUstErklaerungXml, type AveuerAnlage } from "./erklaerung.ts";
import { elsterFelder } from "./felder.ts";

const base = {
  year: 2025,
  steuernummer13: "2893081508152",
  bundesland: "BW",
  absender: { name: "Tris Software", strasse: "Hauptstr. 1", plz: "70173", ort: "Stuttgart" },
  herstellerId: "74931",
  produktVersion: "0.1.0",
  test: true,
};

describe("elsterFelder", () => {
  it("liest die Felder der Umsatzsteuererklärung mit Abschnitt, ohne Transferkopf", () => {
    const xml = buildUstErklaerungXml({
      ...base,
      versteuerung: "ist",
      figures: { base19: 10_000_049, tax19: 1_900_009, base7: 50_000, tax7: 3_500, vorsteuer: 120_000, vorauszahlungen: 1_700_000 },
    });
    const felder = elsterFelder(xml);
    const feld = (kennung: string) => felder.find((f) => f.kennung === kennung);
    expect(feld("E3003303")).toMatchObject({ wert: "100000", zeile: null });
    expect(feld("E3003303")!.pfad).toContain("Umsaetze");
    expect(feld("E3003304")?.wert).toBe("19000,09");
    expect(feld("E3002203")?.wert).toBe("2");
    expect(felder.every((f) => /^E\d{7}$/.test(f.kennung))).toBe(true);
    expect(felder.map((f) => f.kennung)).not.toContain("HerstellerID");
  });

  it("nummeriert Mehrfachzeilen wie die Anlagegüter einer Gruppe, einfache Felder bleiben ohne Zeile", () => {
    const anlagen: AveuerAnlage[] = [
      { gruppe: "andere", bezeichnung: "MacBook Pro", anschaffung: "2025-02-01", anschaffungskosten: 233_333, buchwertBeginn: 233_333, afa: 233_333, abgang: 0, buchwertEnde: 0 },
      { gruppe: "andere", bezeichnung: "Monitor & Dock", anschaffung: "2025-03-01", anschaffungskosten: 90_000, buchwertBeginn: 90_000, afa: 90_000, abgang: 0, buchwertEnde: 0 },
    ];
    const xml = buildEuerXml({
      ...base,
      allgemein: { artDesBetriebs: "Softwareentwicklung", einkunftsart: "selbstaendig" },
      figures: { steuerpflichtig: 8_000_000, vereinnahmteUst: 1_520_000, edv: 60_000 },
      anlagen,
    });
    const felder = elsterFelder(xml);
    expect(felder.find((f) => f.kennung === "E6000401")).toMatchObject({ wert: "80000,00", zeile: null });
    const namen = felder.filter((f) => f.wert === "MacBook Pro" || f.wert === "Monitor & Dock");
    expect(namen.map((f) => [f.wert, f.zeile])).toEqual([
      ["MacBook Pro", 1],
      ["Monitor & Dock", 2],
    ]);
    expect(namen[0]!.kennung).toBe(namen[1]!.kennung);
  });

  it("liest auch Nutzdaten ohne Umschlag und dekodiert Zeichenreferenzen", () => {
    const xml = `<?xml version="1.0"?><Anmeldungssteuern><X><E1234567>A &amp; B &#8222;C&#8220;</E1234567><Leer/></X></Anmeldungssteuern>`;
    expect(elsterFelder(xml)).toEqual([{ kennung: "E1234567", wert: "A & B „C“", pfad: ["Anmeldungssteuern", "X"], zeile: null }]);
  });
});
