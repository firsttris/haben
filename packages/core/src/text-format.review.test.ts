import { describe, expect, it } from "vitest";
import { parseTextFormatting, plainFormattedText } from "./text-format.ts";

describe("Formatierung um Pfade und URLs", () => {
  it.each([
    ["Windows-Pfad", "C:\\_archiv_\\2026"],
    ["URL mit Suchparameter", "https://example.org/?ordner=_archiv_"],
  ])("erhält den Inhalt eines fett ausgezeichneten %s", (_label, text) => {
    expect(plainFormattedText(text)).toBe(text);
    expect(parseTextFormatting(`*${text}*`)).toEqual([{ text, bold: true, italic: false, underline: false }]);
  });

  it.each([
    ["_", { bold: false, italic: true, underline: false }],
    ["__", { bold: false, italic: false, underline: true }],
    ["**", { bold: true, italic: false, underline: false }],
  ] as const)("schützt Pfade auch innerhalb von %s", (marker, style) => {
    const text = "C:\\_archiv_\\2026";
    expect(parseTextFormatting(`${marker}${text}${marker}`)).toEqual([{ text, ...style }]);
  });

  it("behält eine URL bei verschachtelten Auszeichnungen und abschließendem Satzzeichen", () => {
    const text = "https://example.org/_archiv_";
    expect(parseTextFormatting(`*_${text}_*.`)).toEqual([
      { text, bold: true, italic: true, underline: false },
      { text: ".", bold: false, italic: false, underline: false },
    ]);
  });
});
