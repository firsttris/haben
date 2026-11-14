import { describe, expect, it } from "vitest";
import { normalizeColumnName, suggestMapping, mappingProblem } from "./mapping.ts";
import { formulaProblem, parseImportAmount, parseImportCountry, parseImportDate, parseImportTaxRate, parseImportUnit } from "./values.ts";

const value = <T>(parsed: { ok: true; value: T } | { ok: false; error: string }) => (parsed.ok ? parsed.value : parsed.error);

describe("parseImportAmount", () => {
  it("liest deutsche Beträge in Cent", () => {
    expect(value(parseImportAmount("1.234,56", "Preis"))).toBe(123456);
    expect(value(parseImportAmount("12,5", "Preis"))).toBe(1250);
    expect(value(parseImportAmount("100 €", "Preis"))).toBe(10000);
    expect(value(parseImportAmount("-3.000,00", "Preis"))).toBe(-300000);
  });

  it("liest einen Punkt nur als Dezimalpunkt, wenn das eindeutig ist", () => {
    expect(value(parseImportAmount("12.50", "Preis"))).toBe(1250);
    expect(value(parseImportAmount("1.234.567", "Preis"))).toBe(123456700);
    expect(value(parseImportAmount("1.234,00", "Preis"))).toBe(123400);
  });

  it("lehnt „1.234“ ab: deutsch 1.234 €, englisch 1,234 € – lieber ablehnen als tausendfach falsch übernehmen", () => {
    expect(value(parseImportAmount("1.234", "Preis"))).toMatch(/mehrdeutig/);
    expect(value(parseImportAmount("-1.500 €", "Preis"))).toMatch(/mehrdeutig/);
  });

  it("rundet nicht: mehr als zwei Nachkommastellen sind kein Centbetrag", () => {
    expect(value(parseImportAmount("12,345", "Preis"))).toMatch(/kein Betrag/);
    expect(value(parseImportAmount("12.345,678", "Preis"))).toMatch(/kein Betrag/);
  });

  it("lehnt englische Tausendertrenner und Text ab", () => {
    expect(value(parseImportAmount("1,234.56", "Preis"))).toBe("Preis: „1,234.56“ ist kein Betrag wie 1.234,56");
    expect(value(parseImportAmount("zwölf", "Preis"))).toMatch(/kein Betrag/);
    expect(value(parseImportAmount("1,234", "Preis"))).toMatch(/kein Betrag/);
  });
});

describe("parseImportDate", () => {
  it("liest TT.MM.JJJJ und ISO", () => {
    expect(value(parseImportDate("15.03.2024", "Datum"))).toBe("2024-03-15");
    expect(value(parseImportDate("1.3.2024", "Datum"))).toBe("2024-03-01");
    expect(value(parseImportDate("2024-03-15", "Datum"))).toBe("2024-03-15");
  });

  it("lehnt zweistellige Jahre und unmögliche Tage ab", () => {
    expect(value(parseImportDate("15.03.24", "Datum"))).toMatch(/kein Datum wie 31.12.2025/);
    expect(value(parseImportDate("31.02.2024", "Datum"))).toBe("Datum: den 31.02.2024 gibt es nicht");
    expect(value(parseImportDate("03/15/2024", "Datum"))).toMatch(/kein Datum/);
  });
});

describe("parseImportTaxRate, parseImportUnit, parseImportCountry", () => {
  it("kennt nur die Steuersätze von Haben", () => {
    expect(["19", "19 %", "19,00", "19%"].map((r) => value(parseImportTaxRate(r)))).toEqual([1900, 1900, 1900, 1900]);
    expect(value(parseImportTaxRate("7"))).toBe(700);
    expect(value(parseImportTaxRate("0"))).toBe(0);
    expect(value(parseImportTaxRate("16"))).toMatch(/möglich sind 19 %, 7 % und 0 %/);
  });

  it("übersetzt Einheiten aus Lexware Office und Excel-Listen", () => {
    expect(["Stunde", "Std.", "h", "Tag", "Monat", "Stück", "pauschal", "km", ""].map((u) => value(parseImportUnit(u)))).toEqual([
      "Std.",
      "Std.",
      "Std.",
      "Tag",
      "Monat",
      "Stk.",
      "Psch.",
      "km",
      "Stk.",
    ]);
    expect(value(parseImportUnit("Liter"))).toMatch(/Einheit: „Liter“/);
  });

  it("erkennt eigene Einheiten (#748) an der Bezeichnung, ohne Rücksicht auf Groß- und Kleinschreibung", () => {
    expect(value(parseImportUnit("ue", ["UE", "m²"]))).toBe("UE");
    expect(value(parseImportUnit("m²", ["UE", "m²"]))).toBe("m²");
    // Geerbte Namen von Object sind keine Einheiten und keine Aliase
    for (const raw of ["toString", "valueOf", "constructor"]) expect(value(parseImportUnit(raw))).toMatch(/Einheit:/);
    expect(value(parseImportUnit("Karton", ["UE"]))).toMatch(/Std\., Tag, Monat, Stk\., Psch\., km, UE oder eine neue/);
  });

  it("liest Ländercode, ISO-Ziffern und Namen", () => {
    expect(["de", "276", "Deutschland", "Österreich", ""].map((c) => value(parseImportCountry(c)))).toEqual(["DE", "DE", "DE", "AT", "DE"]);
    expect(value(parseImportCountry("Atlantis"))).toMatch(/Ländercode wie DE/);
  });
});

describe("formulaProblem (CSV-Injection)", () => {
  it("meldet Texte, die eine Tabellenkalkulation als Formel ausführen würde", () => {
    for (const text of ['=HYPERLINK("http://böse.example","Klick")', "@SUM(A1)", "+cmd|' /C calc'!A0", "-2+3+cmd|' /C calc'!A0"]) {
      expect(formulaProblem(text, "Name")).toMatch(/^Name: beginnt mit/);
    }
  });

  it("lässt Telefonnummern, negative Zahlen und gewöhnlichen Text durch", () => {
    for (const text of ["+49 221 123456", "-12,50", "Müller GmbH", "Büro = Raum 3"]) expect(formulaProblem(text, "Name")).toBeNull();
  });
});

describe("Zuordnung der Spalten", () => {
  it("vergleicht Namen ohne Groß- und Kleinschreibung, Umlaute und Satzzeichen", () => {
    expect(normalizeColumnName("Straße")).toBe(normalizeColumnName("strasse"));
    expect(normalizeColumnName("USt-IdNr.")).toBe("ustidnr");
    expect(normalizeColumnName("Nutzungsdauer (Monate)")).not.toBe(normalizeColumnName("Nutzungsdauer"));
  });

  it("schlägt je Feld die passende Spalte vor und vergibt keine Spalte zweimal", () => {
    const fields = [
      { key: "firma", label: "Firma", aliases: ["Firmenname", "Name"] },
      { key: "nachname", label: "Nachname", aliases: ["Nachname", "Name"] },
      { key: "ort", label: "Ort", aliases: ["Ort"] },
    ];
    expect(suggestMapping(["Name", "ORT", "Sonstiges"], fields)).toEqual({ firma: 0, nachname: null, ort: 1 });
  });

  it("meldet eine Spalte, die zwei Feldern zugeordnet ist, und Spalten, die es nicht gibt", () => {
    const fields = [
      { key: "a", label: "Firma", aliases: [] },
      { key: "b", label: "Ort", aliases: [] },
    ];
    expect(mappingProblem({ a: 0, b: 0 }, ["Name"], fields)).toBe("Die Spalte „Name“ ist Firma und Ort zugeordnet");
    expect(mappingProblem({ a: 3, b: null }, ["Name"], fields)).toBe("Firma: Spalte gibt es nicht");
    expect(mappingProblem({ a: 0 }, ["Name"], fields)).toBeNull();
  });
});
