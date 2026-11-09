import { describe, expect, it } from "vitest";
import { plainFormattedText } from "./text-format.ts";

describe("Relative Windows-Pfade mit Unterstrichen", () => {
  it("erhält Backslashes auch hinter einem Ordnernamen mit Unterstrich", () => {
    const path = "backup_2026\\_archiv_\\2026";
    expect(plainFormattedText(path)).toBe(path);
  });
});
