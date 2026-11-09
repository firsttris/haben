import { describe, expect, it } from "vitest";
import { plainFormattedText } from "./text-format.ts";

describe("Windows-Pfad ab Laufwerkswurzel", () => {
  it("erhält den führenden Backslash und die Unterstriche eines verwurzelten Pfads", () => {
    const path = "\\_archiv_\\2026";
    expect(plainFormattedText(`Sicherung nach ${path}`)).toBe(`Sicherung nach ${path}`);
  });
});
