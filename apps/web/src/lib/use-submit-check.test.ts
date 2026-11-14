import { describe, expect, it } from "vitest";
import { datumFehler, monatFehler } from "./use-submit-check.ts";

describe("datumFehler", () => {
  it("meldet ein leeres Feld", () => {
    expect(datumFehler("", "2026-01-01", "2026-11-14")).toBe("Wähle das Datum.");
  });

  it("nimmt die Grenzen selbst noch an", () => {
    expect(datumFehler("2026-01-01", "2026-01-01", "2026-11-14")).toBeNull();
    expect(datumFehler("2026-11-14", "2026-01-01", "2026-11-14")).toBeNull();
  });

  it("nennt den erlaubten Zeitraum, wenn der Tag davor oder danach liegt", () => {
    const text = "Wähle einen Tag vom 01.01.2026 bis 14.11.2026.";
    expect(datumFehler("2025-12-31", "2026-01-01", "2026-11-14")).toBe(text);
    expect(datumFehler("2026-11-15", "2026-01-01", "2026-11-14")).toBe(text);
  });
});

describe("monatFehler", () => {
  it("meldet ein leeres Feld", () => {
    expect(monatFehler("", "2026-01", "2026-11")).toBe("Wähle den Monat.");
  });

  it("nimmt Monate innerhalb der Grenzen an", () => {
    expect(monatFehler("2026-01", "2026-01", "2026-11")).toBeNull();
    expect(monatFehler("2026-11", "2026-01", "2026-11")).toBeNull();
  });

  it("nennt die erlaubten Monate mit Namen", () => {
    expect(monatFehler("2025-12", "2026-01", "2026-11")).toBe("Wähle einen Monat von Januar 2026 bis November 2026.");
    expect(monatFehler("2026-12", "2026-01", "2026-01")).toBe("Wähle Januar 2026.");
  });
});
