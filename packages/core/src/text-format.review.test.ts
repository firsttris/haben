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
});
