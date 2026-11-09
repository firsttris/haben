import { describe, expect, it } from "vitest";
import { parseTextFormatting, plainFormattedText } from "./text-format.ts";

const run = (text: string, style: Partial<{ bold: boolean; italic: boolean; underline: boolean }> = {}) => ({
  text,
  bold: false,
  italic: false,
  underline: false,
  ...style,
});

describe("maskierte Zeichen hinter einem Wortzeichen", () => {
  // docs/rechnungen.md: „Mit `\*` bzw. `\_` lässt sich ein Zeichen wörtlich schreiben.“
  // `*` ist in Windows-Dateinamen unzulässig, „5\*“ kann also kein Pfad sein.
  it.each([
    ["Preis 5\\* zzgl. MwSt.", "Preis 5* zzgl. MwSt."],
    ["Betrag\\* netto", "Betrag* netto"],
  ])("liest %s ohne Backslash", (text, expected) => {
    expect(plainFormattedText(text)).toBe(expected);
  });

  it("maskiert auch innerhalb einer Auszeichnung", () => {
    expect(parseTextFormatting("_Preis 5\\*_")).toEqual([run("Preis 5*", { italic: true })]);
  });
});

describe("Auszeichnung hinter Klammer oder Anführungszeichen", () => {
  it.each([
    ["Leistungszeitraum (*01/2026*)", [run("Leistungszeitraum ("), run("01/2026", { bold: true }), run(")")]],
    ["„*Website/App*“", [run("„"), run("Website/App", { bold: true }), run("“")]],
    ["(_und/oder_)", [run("("), run("und/oder", { italic: true }), run(")")]],
  ])("formatiert %s", (text, expected) => {
    expect(parseTextFormatting(text)).toEqual(expected);
  });
});
