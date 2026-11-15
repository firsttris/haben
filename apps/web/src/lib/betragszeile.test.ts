import { describe, expect, it } from "vitest";
import {
  aendereBetragszeile,
  betragszeileAus,
  betragszeileAusVorlage,
  bruttoLesbar,
  bruttoZerlegen,
  steuerausweisUmschalten,
  type Betragszeile,
} from "./betragszeile.ts";

const leer = (): Betragszeile => betragszeileAus(1, 1900, 0, 0, true, false);

describe("bruttoZerlegen", () => {
  it("zerlegt Brutto in Netto und enthaltene Steuer, Netto plus Steuer ergibt immer das Brutto", () => {
    expect(bruttoZerlegen(11_900, 1900)).toEqual({ net: 10_000, tax: 1_900 });
    expect(bruttoZerlegen(980, 1900)).toEqual({ net: 824, tax: 156 });
    expect(bruttoZerlegen(1_070, 700)).toEqual({ net: 1_000, tax: 70 });
    expect(bruttoZerlegen(2_500, 0)).toEqual({ net: 2_500, tax: 0 });
    for (const gross of [1, 99, 4_999, 123_457]) {
      const { net, tax } = bruttoZerlegen(gross, 1900);
      expect(net + tax).toBe(gross);
    }
  });

  it("rundet bei Gutschriften symmetrisch zur Null", () => {
    expect(bruttoZerlegen(-11_900, 1900)).toEqual({ net: -10_000, tax: -1_900 });
    expect(bruttoZerlegen(-980, 1900)).toEqual({ net: -824, tax: -156 });
  });
});

describe("bruttoLesbar", () => {
  it("leer und lesbare Beträge sind in Ordnung, unlesbare nicht", () => {
    expect(bruttoLesbar({ gross: "" })).toBe(true);
    expect(bruttoLesbar({ gross: "  " })).toBe(true);
    expect(bruttoLesbar({ gross: "1.190,00" })).toBe(true);
    expect(bruttoLesbar({ gross: "-11,90" })).toBe(true);
    expect(bruttoLesbar({ gross: "1190,005" })).toBe(false);
    expect(bruttoLesbar({ gross: "abc" })).toBe(false);
  });

  it("ein unlesbares Brutto lässt die vorigen Beträge stehen, deshalb muss es das Speichern sperren", () => {
    const row = aendereBetragszeile(leer(), { gross: "119,00" }, false);
    const vertippt = aendereBetragszeile(row, { gross: "1190,005" }, false);
    expect(vertippt).toMatchObject({ net: "100,00", tax: "19,00" });
    expect(bruttoLesbar(vertippt)).toBe(false);
  });
});

describe("aendereBetragszeile", () => {
  it("rechnet aus dem Brutto Netto und Vorsteuer", () => {
    const row = aendereBetragszeile(leer(), { gross: "119,00" }, false);
    expect(row).toMatchObject({ net: "100,00", tax: "19,00", gross: "119,00", basis: "gross", taxTouched: false });
  });

  it("lässt Netto und Vorsteuer stehen, solange das Brutto nicht lesbar ist, und leert sie mit dem Brutto", () => {
    const row = aendereBetragszeile(leer(), { gross: "119,00" }, false);
    expect(aendereBetragszeile(row, { gross: "119,0x" }, false)).toMatchObject({ net: "100,00", tax: "19,00", gross: "119,0x" });
    expect(aendereBetragszeile(row, { gross: "" }, false)).toMatchObject({ net: "", tax: "", gross: "" });
  });

  it("ein anderer Satz rechnet vom eingegebenen Brutto aus neu", () => {
    const row = aendereBetragszeile(leer(), { gross: "107,00" }, false);
    expect(aendereBetragszeile(row, { taxRate: 700 }, false)).toMatchObject({ net: "100,00", tax: "7,00", gross: "107,00" });
    expect(aendereBetragszeile(row, { taxRate: 0 }, false)).toMatchObject({ net: "107,00", tax: "0,00", gross: "107,00" });
  });

  it("ein anderer Satz rechnet vom eingegebenen Netto aus neu, das Brutto folgt", () => {
    const row = aendereBetragszeile(leer(), { net: "100,00" }, false);
    expect(row).toMatchObject({ tax: "19,00", gross: "119,00", basis: "net" });
    expect(aendereBetragszeile(row, { taxRate: 700 }, false)).toMatchObject({ net: "100,00", tax: "7,00", gross: "107,00" });
  });

  it("Vorsteuer von Hand: Netto bleibt, das Brutto folgt, Netto ist wieder die Grundlage", () => {
    const row = aendereBetragszeile(leer(), { gross: "119,00" }, false);
    const korrigiert = aendereBetragszeile(row, { tax: "18,99", taxTouched: true }, false);
    expect(korrigiert).toMatchObject({ net: "100,00", tax: "18,99", gross: "118,99", basis: "net", taxTouched: true });
    // Von Hand geänderte Vorsteuer bleibt beim nächsten Netto stehen, wie bisher
    expect(aendereBetragszeile(korrigiert, { net: "200,00" }, false)).toMatchObject({ tax: "18,99", gross: "218,99" });
  });

  it("ein neues Brutto gilt wieder als Vorschlag und überschreibt die von Hand geänderte Vorsteuer", () => {
    const row = aendereBetragszeile(aendereBetragszeile(leer(), { net: "100,00" }, false), { tax: "18,00", taxTouched: true }, false);
    expect(aendereBetragszeile(row, { gross: "238,00" }, false)).toMatchObject({ net: "200,00", tax: "38,00", taxTouched: false });
  });

  it("bei selbst geschuldeter Steuer zählt nur das Netto, die Steuer wird immer berechnet", () => {
    const row = aendereBetragszeile(leer(), { net: "100,00" }, true);
    expect(row).toMatchObject({ net: "100,00", tax: "19,00", basis: "net" });
    expect(aendereBetragszeile(row, { gross: "50,00" }, true)).toMatchObject({ net: "100,00", tax: "19,00" });
  });

  it("gespeicherte Beträge zeigen das Brutto, eine leere Zeile bleibt leer", () => {
    expect(betragszeileAus(7, 700, 1_000, 70, false, true)).toEqual({
      key: 7,
      taxRate: 700,
      net: "10,00",
      tax: "0,70",
      gross: "10,70",
      taxTouched: true,
      basis: "net",
    });
    expect(leer()).toMatchObject({ net: "", tax: "", gross: "" });
  });
});

describe("Dauerbeleg: Haken für den Steuerausweis und gespeicherte Zeilen (#1059)", () => {
  const brutto = (row: Betragszeile, gross: string) => aendereBetragszeile(row, { gross }, false);

  it("Haken aus und wieder an lässt ein eingegebenes Brutto stehen (45,00 € zu 19 %: taxOf des Netto wäre 7,19 €)", () => {
    let row = steuerausweisUmschalten(betragszeileAusVorlage(1, { taxRate: 1900, net: 0, tax: 0 }, false), true);
    row = brutto(row, "45,00");
    expect(row).toMatchObject({ net: "37,82", tax: "7,18", gross: "45,00" });
    row = steuerausweisUmschalten(steuerausweisUmschalten(row, false), true);
    expect(row).toMatchObject({ net: "37,82", tax: "7,18", gross: "45,00" });
  });

  it("Haken aus: Grundlage ist wieder das Netto, ein anderer Satz rechnet es nicht aus dem verborgenen Brutto", () => {
    let row = brutto(betragszeileAusVorlage(1, { taxRate: 1900, net: 0, tax: 0 }, true), "119,00");
    row = aendereBetragszeile(steuerausweisUmschalten(row, false), { taxRate: 700 }, false);
    expect(row.net).toBe("100,00");
  });

  it("gespeichert ohne Steuerausweis: nach dem Setzen des Hakens folgt die Steuer dem Netto", () => {
    let row = steuerausweisUmschalten(betragszeileAusVorlage(1, { taxRate: 1900, net: 50000, tax: 0 }, false), true);
    expect(row).toMatchObject({ tax: "95,00", gross: "595,00" });
    row = aendereBetragszeile(row, { net: "600,00" }, false);
    expect(row).toMatchObject({ tax: "114,00", gross: "714,00" });
  });

  it("gespeichert aus einem Brutto (37,82 € + 7,18 €): die Steuer gilt nicht als von Hand geändert", () => {
    const row = aendereBetragszeile(betragszeileAusVorlage(1, { taxRate: 1900, net: 3782, tax: 718 }, true), { net: "40,00" }, false);
    expect(row).toMatchObject({ net: "40,00", tax: "7,60", gross: "47,60" });
  });

  it("gespeichert mit abweichender Steuer laut Vertrag: bleibt von Hand geändert", () => {
    const row = aendereBetragszeile(betragszeileAusVorlage(1, { taxRate: 1900, net: 10000, tax: 1800 }, true), { net: "200,00" }, false);
    expect(row).toMatchObject({ tax: "18,00", gross: "218,00" });
  });
});
