import { describe, expect, it } from "vitest";
import { paragraph4Nummer, paragraph4NummerText, steuerfreiEinordnung } from "./paragraph4.ts";

describe("paragraph4Nummer", () => {
  it.each([
    ["Steuerfrei nach § 4 Nr. 21 UStG", { nummer: 21 }],
    ["§ 4 Nr. 21", { nummer: 21 }],
    ["§4 Nr.21", { nummer: 21 }],
    ["Steuerfrei nach § 4 Nummer 21 des UStG", { nummer: 21 }],
    ["§ 4 Ziff. 21 UStG", { nummer: 21 }],
    ["§ 4 Ziffer 21", { nummer: 21 }],
    ["§ 4 Nr. 8 a UStG", { nummer: 8, buchstabe: "a" }],
    ["§ 4 Nr. 8a", { nummer: 8, buchstabe: "a" }],
    ["§ 4 Nr. 8 Buchst. a", { nummer: 8, buchstabe: "a" }],
    ["§ 4 Nr. 8 Buchstabe a", { nummer: 8, buchstabe: "a" }],
    ["§ 4 Nr. 9 b", { nummer: 9, buchstabe: "b" }],
    ["Steuerfrei nach § 4 Nr. 12 UStG (Vermietung)", { nummer: 12 }],
    // ohne „§ 4“ bleibt die Nummer lesbar
    ["Nr. 21", { nummer: 21 }],
    ["befreit, Nr. 14", { nummer: 14 }],
  ])("erkennt %s", (text, erwartet) => {
    expect(paragraph4Nummer(text)).toEqual(erwartet);
  });

  it.each([
    // ein Bereich ist keine einzelne Nummer
    "Steuerfrei nach § 4 Nr. 8 bis 29 UStG",
    "§ 4 Nr. 8–29 UStG",
    "§ 4 Nr. 8 - 29",
    // mehrere Nummern in einem Text
    "§ 4 Nr. 21 und § 4 Nr. 14",
    "§ 4 Nr. 21, Nr. 14",
    // ein anderer Paragraph
    "§ 4a UStG",
    "§ 4b Abs. 2",
    "§ 14 Nr. 5 UStG",
    "§ 19 UStG (Kleinunternehmer)",
    // § 4 hat 29 Nummern
    "§ 4 Nr. 33",
    "§ 4 Nr. 0",
    // gar keine Nummer
    "Steuerfrei nach § 4 UStG",
    "§ 4",
    "Nachhilfe bar",
    "",
  ])("gibt null zurück bei %s", (text) => {
    expect(paragraph4Nummer(text)).toBeNull();
  });
});

describe("steuerfreiEinordnung", () => {
  it("ordnet Nummern den Zeilen 46 und 47 zu", () => {
    // Zeile 46: Vermietung und Verpachtung von Grundstücken
    expect(steuerfreiEinordnung({ nummer: 12 })).toEqual({ zeile: 46 });
    // Zeile 47: steuerfreie Umsätze, die nicht zum Gesamtumsatz gehören
    for (const nummer of [11, 13, 14, 19, 21, 27, 29]) expect(steuerfreiEinordnung({ nummer })).toEqual({ zeile: 47, nummer: { nummer } });
    expect(steuerfreiEinordnung({ nummer: 8, buchstabe: "i" })).toEqual({ zeile: 47, nummer: { nummer: 8, buchstabe: "i" } });
    expect(steuerfreiEinordnung({ nummer: 9, buchstabe: "b" })).toEqual({ zeile: 47, nummer: { nummer: 9, buchstabe: "b" } });
  });

  it("sperrt Nummern mit der Hilfsumsatz-Frage (Zeile 49)", () => {
    for (const buchstabe of ["a", "b", "c", "d", "e", "f", "g", "h"])
      expect(steuerfreiEinordnung({ nummer: 8, buchstabe })).toEqual({ gesperrt: "hilfsumsatz" });
    expect(steuerfreiEinordnung({ nummer: 9, buchstabe: "a" })).toEqual({ gesperrt: "hilfsumsatz" });
    expect(steuerfreiEinordnung({ nummer: 10 })).toEqual({ gesperrt: "hilfsumsatz" });
  });

  it("sperrt ohne lesbare oder unvollständige Nummer", () => {
    expect(steuerfreiEinordnung(null)).toEqual({ gesperrt: "nummer" });
    // 8 und 9 ohne Buchstabe: nicht zuordenbar
    expect(steuerfreiEinordnung({ nummer: 8 })).toEqual({ gesperrt: "nummer" });
    expect(steuerfreiEinordnung({ nummer: 9 })).toEqual({ gesperrt: "nummer" });
    // Nr. 1 bis 7 gehören zu den steuerfreien Umsätzen MIT Vorsteuerabzug (Ausfuhren, ig. Lieferungen)
    for (const nummer of [1, 3, 7]) expect(steuerfreiEinordnung({ nummer })).toEqual({ gesperrt: "nummer" });
  });
});

describe("paragraph4NummerText", () => {
  it("schreibt die Nummer mit Buchstabe wie im Feld E3104501", () => {
    expect(paragraph4NummerText({ nummer: 21 })).toBe("21");
    expect(paragraph4NummerText({ nummer: 8, buchstabe: "i" })).toBe("8 i");
  });
});
