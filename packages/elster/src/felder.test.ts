import { describe, expect, it } from "vitest";
import { buildEuerXml, buildUstErklaerungXml, type AveuerAnlage } from "./erklaerung.ts";
import { buildEstXml } from "./est.ts";
import { elsterFelder, meinElsterWerte, NUR_AUSLESEN } from "./felder.ts";
import { ustvaNutzdaten } from "./xml.ts";

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
      {
        gruppe: "andere",
        bezeichnung: "MacBook Pro",
        anschaffung: "2025-02-01",
        anschaffungskosten: 233_333,
        buchwertBeginn: 233_333,
        afa: 233_333,
        abgang: 0,
        buchwertEnde: 0,
      },
      {
        gruppe: "andere",
        bezeichnung: "Monitor & Dock",
        anschaffung: "2025-03-01",
        anschaffungskosten: 90_000,
        buchwertBeginn: 90_000,
        afa: 90_000,
        abgang: 0,
        buchwertEnde: 0,
      },
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
    expect(elsterFelder(xml)).toEqual([{ kennung: "E1234567", wert: "A & B „C“", pfad: ["Anmeldungssteuern", "X"], zeile: null, person: null }]);
  });
});

describe("Personen und Voranmeldung", () => {
  const estXml = () =>
    buildEstXml({
      ...base,
      personA: { idnr: "86095742719", vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", religion: "11", beruf: "IT-Berater" },
      personB: { idnr: "65929970489", vorname: "Erika", name: "Muster", geburtsdatum: "1987-09-01", religion: "02", beruf: "" },
      verheiratetSeit: "2015-06-20",
      anschrift: { strasse: "Hauptstraße 12a", plz: "77815", ort: "Bühl" },
      telefon: "07223 12345",
      iban: "DE89 3704 0044 0532 0130 00",
      gewinn: { einkunftsart: "selbstaendig", taetigkeit: "IT-Beratung", betrag: 8_543_250 },
      angaben: { vorsorge: { a: { pkv: 600_000, ppv: 40_049 }, b: { gkv: 300_000, gpv: 60_000 } }, sonderausgaben: {}, haushaltsnah: {}, kinder: [] },
    });

  it("ordnet Anlagen je Person der Person zu und zählt sie nicht als Mehrfachzeile", () => {
    const felder = elsterFelder(estXml());
    expect(felder.find((f) => f.kennung === "E0803202")).toMatchObject({ wert: "85433", person: "A", zeile: null });
    expect(felder.find((f) => f.kennung === "E2003104")).toMatchObject({ wert: "6000", person: "A", zeile: null });
    expect(felder.find((f) => f.kennung === "E2001805")).toMatchObject({ wert: "3000", person: "B", zeile: null });
    // Felder des Hauptvordrucks gehören keiner Person
    expect(felder.find((f) => f.kennung === "E0100401")?.person).toBeNull();
    expect(felder.map((f) => f.kennung)).not.toContain("Person");
  });

  it("Werte der Einkommensteuer tragen die Namen der Personen", () => {
    const werte = meinElsterWerte("est", 2025, estXml(), new Date("2026-03-01T00:00:00Z"), { personen: { A: "Max Muster", B: "Erika Muster" } });
    expect(werte).toMatchObject({ formular: "est", jahr: 2025, zeitraum: null, personen: { A: "Max Muster", B: "Erika Muster" } });
  });

  it("Voranmeldung: Kennzahlen mit Komma, ohne Kz 09, Zeitraum als eigenes Feld", () => {
    const xml = ustvaNutzdaten({
      period: { year: 2026, month: 10 },
      steuernummer13: "9198011310010",
      figures: { kz81: 290_040, kz86: 0, kz66: 17_355, kz83: 37_745 },
      datenlieferant: { name: "Testfirma", strasse: "Hauptstr. 1", plz: "10115", ort: "Berlin" },
      herstellerId: NUR_AUSLESEN,
    }).join("\n");
    const werte = meinElsterWerte("ustvaeru", 2026, xml, new Date("2026-11-02T10:00:00Z"), { zeitraum: "10" });
    expect(werte).toMatchObject({ formular: "ustvaeru", jahr: 2026, zeitraum: "10", personen: null });
    expect(werte.felder.map((f) => [f.kennung, f.wert])).toEqual([
      ["Zeitraum", "10"],
      ["Kz66", "173,55"],
      ["Kz81", "2900"],
      ["Kz83", "377,45"],
    ]);
  });
});
