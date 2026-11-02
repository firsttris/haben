import { describe, expect, it } from "vitest";
import { defaultFetchFrom, fetchFromForConnect } from "./bank-connect.ts";

describe("Umsätze abrufen ab", () => {
  it("steht anfangs auf dem Jahresbeginn", () => {
    expect(defaultFetchFrom("2026-11-02")).toBe("2026-01-01");
  });

  it("schickt die Vorgabe nicht mit: dann schließt der Abruf nahtlos an Umsätze aus einer Datei an, auch aus dem Vorjahr", () => {
    expect(fetchFromForConnect("2026-01-01", "2026-11-02")).toBeNull();
    expect(fetchFromForConnect("", "2026-11-02")).toBeNull();
  });

  it("schickt einen selbst gewählten Tag mit (Umzug unter dem Jahr)", () => {
    expect(fetchFromForConnect("2026-11-01", "2026-11-02")).toBe("2026-11-01");
    expect(fetchFromForConnect("2025-12-01", "2026-11-02")).toBe("2025-12-01");
  });
});
