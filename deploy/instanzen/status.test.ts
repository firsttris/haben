/**
 * Spalten aus `haben status --json`: Version mit der kurzen Kennung des Commits (#887), Speicher (#951); ein Image ohne
 * die Felder zeigt nur die Version bzw. „?“
 */
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

describe("standAus: Speicher", () => {
  it("zeigt die Kurzfassung der App", () => {
    expect(standAus(antwort({ version: "0.9.0", summary: { ...summary, speicher: "Datenbank 45,2 MB, Belege 1,3 GB" } })).speicher).toBe(
      "Datenbank 45,2 MB, Belege 1,3 GB",
    );
  });

  it("zeigt für ein Image ohne das Feld ein Fragezeichen und die übrigen Werte wie bisher", () => {
    expect(standAus(antwort({ version: "0.8.2", summary }))).toEqual({ version: "0.8.2", eric: "44.3.6.0", sicherung: "2026-11-10 03:15", speicher: "?" });
  });

  it("zeigt ohne Antwort der App auch beim Speicher ein Fragezeichen", () => {
    expect(standAus({ code: 1, stdout: "", stderr: "Der Stand konnte nicht gelesen werden" }).speicher).toBe("?");
    expect(standAus({ code: 0, stdout: "kein JSON", stderr: "" }).speicher).toBe("?");
  });
});
