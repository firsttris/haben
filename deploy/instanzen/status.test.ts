/** Spalte Version aus `haben status --json` (#887): mit Commit die kurze Kennung dahinter, ohne nur die Version */
import { describe, expect, it } from "vitest";
import { standAus } from "./status.ts";

const antwort = (s: object) => ({ code: 0, stdout: JSON.stringify(s), stderr: "" });
const summary = { eric: "44.3.6.0", backup: "2026-11-10 03:15" };

describe("standAus", () => {
  it("hängt die kurze Kennung des Commits an die Version", () => {
    expect(standAus(antwort({ version: "0.8.2", commit: "0123abc4567def890123abc4567def890123abcd", summary })).version).toBe("0.8.2 (0123abc)");
  });

  it.each([
    ["ein Image ohne das Feld", { version: "0.8.2", summary }],
    ["ein Image ohne Angabe beim Bauen", { version: "0.8.2", commit: null, summary }],
  ])("zeigt für %s nur die Version", (_, s) => {
    expect(standAus(antwort(s)).version).toBe("0.8.2");
  });
});
