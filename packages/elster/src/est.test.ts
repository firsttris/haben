import { describe, expect, it } from "vitest";
import { buildEstXml, kindZeitraum, type EstXmlInput } from "./est.ts";
import { checkXml } from "./fake-client.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

const estInput = (overrides: Partial<EstXmlInput> = {}): EstXmlInput => ({
  year: 2025,
  steuernummer13: "2836216146249",
  bundesland: "BW",
  herstellerId: "74931",
  produktVersion: "0.1.0",
  test: true,
  personA: { idnr: "86095742719", vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", religion: "11", beruf: "IT-Berater" },
  personB: { idnr: "86095742719", vorname: "Erika", name: "Muster", geburtsdatum: "1987-09-01", religion: "02", beruf: "" },
  verheiratetSeit: "2015-06-20",
  anschrift: { strasse: "Hauptstraße 12a", plz: "77815", ort: "Bühl" },
  telefon: "07223 12345",
  iban: "DE89 3704 0044 0532 0130 00",
  gewinn: { einkunftsart: "selbstaendig", taetigkeit: "IT-Beratung", betrag: 8_543_250 },
  angaben: {
    vorsorge: { a: { pkv: 600_000, ppv: 40_049, pkvErstattung: 50_000 }, b: { gkv: 300_000, gpv: 60_000 }, sonstige: 25_000 },
    sonderausgaben: { kirchensteuerGezahlt: 12_000, spenden: 10_000 },
    krankheitskosten: 150_000,
    haushaltsnah: { handwerker: 80_000 },
    kinder: [{ idnr: "86095742719", vorname: "Lena", geburtsdatum: "2025-03-05", familienkasse: "Familienkasse BW", kinderbetreuung: 200_000 }],
    kap: { ertraegeMitSteuerabzug: 120_000, sparerPauschbetrag: 100_000, kapitalertragsteuer: 5_000, soli: 275 },
  },
  ...overrides,
});

describe("buildEstXml", () => {
  it("baut E10 mit Hauptvordruck, Zusammenveranlagung und Anlagen", () => {
    const xml = buildEstXml(estInput());
    expect(checkXml(xml)).toBeUndefined();
    expect(datenartVersionFromXml(xml)).toBe("ESt_2025");
    expect(hasTestmerker(xml)).toBe(true);
    expect(xml).toContain("<DatenArt>ESt</DatenArt>");
    expect(xml).toContain(`<E10 xmlns="http://finkonsens.de/elster/elstererklaerung/est/e10/v2025" version="2025">`);
    expect(xml).toContain("<E0100081>86095742719</E0100081>");
    expect(xml).toContain("<E0100401>12.04.1985</E0100401>");
    expect(xml).toContain("<E0101104>Hauptstraße</E0101104>");
    expect(xml).toContain("<E0101206>12</E0101206>");
    expect(xml).toContain("<E0101207>a</E0101207>");
    expect(xml).toContain("<E0100701>20.06.2015</E0100701>");
    expect(xml).toMatch(/<Vlg_Art>\s*<E0101201>X<\/E0101201>/);
    expect(xml).toContain("<E0100801>Erika</E0100801>");
    expect(xml).toContain("<E0102102>DE89370400440532013000</E0102102>");
    // Anlage S mit Gewinn in vollen Euro
    expect(xml).toMatch(/<S>\s*<Person>PersonA<\/Person>\s*<Gewinn>\s*<Freiber_T>\s*<E0803101>IT-Beratung<\/E0803101>\s*<E0803202>85433<\/E0803202>/);
    expect(xml).not.toContain("<G>");
    // Vorsorge je Person
    expect(xml).toMatch(/<Beitr_p_KV_PV_Inl>\s*<Person>PersonA<\/Person>\s*<E2003104>6000<\/E2003104>\s*<E2003202>400<\/E2003202>\s*<E2003302>500<\/E2003302>/);
    expect(xml).toMatch(/<Beitr_g_KV_PV_Inl>\s*<Person>PersonB<\/Person>\s*<And_Pers>\s*<E2001805>3000<\/E2001805>\s*<E2002105>600<\/E2002105>/);
    expect(xml).not.toContain("<AVor>");
    // Kind, im Jahr geboren, mit Betreuungskosten im gemeinsamen Haushalt
    expect(xml).toContain("<E0500703>05.03-31.12</E0500703>");
    expect(xml).toContain("<K_Verh_B>");
    expect(xml).toContain("<Gem_HH_Elt>");
    expect(xml).not.toContain("<Elt_k_ZV>");
    // KAP mit Cent bei den Steuern
    expect(xml).toContain("<E1904701>50,00</E1904701>");
    expect(xml).toContain("<E1904901>2,75</E1904901>");
    expect(xml).toContain("<E1901401>1000</E1901401>");
    // §35a mit Einzelposten und Summe
    expect(xml).toMatch(/<Handw_L>\s*<Einz>\s*<E0111217>Handwerkerleistungen<\/E0111217>\s*<E0111214>800<\/E0111214>\s*<\/Einz>\s*<Sum>\s*<E0111215>800/);
    expect(xml).toMatch(/<Unterfallart>10<\/Unterfallart>[\s\S]*<StNr>2836216146249<\/StNr>[\s\S]*<Zeitraum>2025<\/Zeitraum>/);
  });

  it("hält die Reihenfolge der Anlagen ein", () => {
    const xml = buildEstXml(estInput({ gewinn: { einkunftsart: "gewerbe", taetigkeit: "Handel", betrag: -100_000 } }));
    const order = ["<ESt1A>", "<SA>", "<AgB>", "<HA_35a>", "<Kind>", "<G>", "<KAP>", "<VOR>", "<Vorsatz>"].map((tag) => xml.indexOf(tag));
    expect(order.every((pos) => pos > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(xml).toContain("<E0800302>-1000</E0800302>");
  });

  it("lässt bei Einzelveranlagung Ehegatte und K_Verh_B weg", () => {
    const xml = buildEstXml(estInput({ personB: undefined, verheiratetSeit: undefined }));
    expect(xml).not.toContain("<B>");
    expect(xml).not.toContain("<Vlg_Art>");
    expect(xml).not.toContain("<E0100701>");
    expect(xml).not.toContain("<K_Verh_B>");
    expect(xml).not.toContain("PersonB");
    expect(xml).toContain("<K_gem_HH_Elt>");
    expect(xml).toContain("<E0506604>2000</E0506604>");
  });

  it("lässt leere Anlagen ganz weg", () => {
    const xml = buildEstXml(
      estInput({ angaben: { vorsorge: { a: {} }, sonderausgaben: {}, haushaltsnah: {}, kinder: [] }, iban: undefined, telefon: undefined }),
    );
    for (const tag of ["<SA>", "<AgB>", "<HA_35a>", "<Kind>", "<KAP>", "<VOR>", "<BV>", "<E0100008>"]) expect(xml).not.toContain(tag);
    expect(checkXml(xml)).toBeUndefined();
  });

  it("prüft Pflichtangaben", () => {
    expect(() => buildEstXml(estInput({ personA: { ...estInput().personA, idnr: "12345678901" } }))).toThrow(/Person A/);
    expect(() => buildEstXml(estInput({ verheiratetSeit: undefined }))).toThrow(/Heiratsdatum/);
    expect(() => buildEstXml(estInput({ anschrift: { strasse: "Am Markt", plz: "1", ort: "X" } }))).toThrow(/Hausnummer/);
    expect(() => buildEstXml(estInput({ year: 2022 }))).toThrow();
  });

  it("berechnet den Zeitraum des Kindes", () => {
    expect(kindZeitraum(2025, "2025-11-30")).toBe("30.11-31.12");
    expect(kindZeitraum(2025, "2019-02-01")).toBe("01.01-31.12");
  });
});
