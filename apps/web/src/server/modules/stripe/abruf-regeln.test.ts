import { describe, expect, it } from "vitest";
import { abrufFaellig, minusDays, naechsterAbrufStart, OVERLAP_DAYS } from "./abruf-regeln.ts";

describe("naechsterAbrufStart", () => {
  it("beginnt drei Tage vor heute", () => {
    expect(OVERLAP_DAYS).toBe(3);
    expect(naechsterAbrufStart("2026-01-01", new Date("2026-11-07T10:00:00Z"))).toBe("2026-11-04");
  });

  it("geht nie vor den bisherigen Start zurück", () => {
    expect(naechsterAbrufStart("2026-11-06", new Date("2026-11-07T10:00:00Z"))).toBe("2026-11-06");
  });

  it("rechnet über Monats- und Jahresgrenzen", () => {
    expect(minusDays("2026-01-02", 3)).toBe("2025-12-30");
    expect(naechsterAbrufStart("2025-01-01", new Date("2026-01-02T00:30:00Z"))).toBe("2025-12-30");
  });

  it("nimmt den Tag in UTC, auch kurz nach Mitternacht in Deutschland", () => {
    // 01:30 am 8.11. in Berlin ist 00:30 UTC am selben Tag; 23:30 am 7.11. in Berlin ist 22:30 UTC am 7.11.
    expect(naechsterAbrufStart("2026-01-01", new Date("2026-11-07T22:30:00Z"))).toBe("2026-11-04");
  });
});

describe("abrufFaellig", () => {
  const jetzt = new Date("2026-11-07T12:00:00Z");
  const vor = (stunden: number, fehlgeschlagen = false) => ({ zeit: new Date(jetzt.getTime() - stunden * 3_600_000), fehlgeschlagen });

  it("ruft ohne bisherigen Abruf ab", () => {
    expect(abrufFaellig("woechentlich", null, jetzt)).toBe(true);
  });

  it("hält den Abstand je Rhythmus ein", () => {
    expect(abrufFaellig("stuendlich", vor(1), jetzt)).toBe(true);
    expect(abrufFaellig("stuendlich", vor(0.5), jetzt)).toBe(false);
    expect(abrufFaellig("taeglich", vor(21), jetzt)).toBe(true);
    expect(abrufFaellig("taeglich", vor(10), jetzt)).toBe(false);
    expect(abrufFaellig("woechentlich", vor(24 * 7), jetzt)).toBe(true);
    expect(abrufFaellig("woechentlich", vor(24 * 3), jetzt)).toBe(false);
  });

  it("versucht es nach einem Fehlschlag spätestens nach einem Tag erneut, auch beim wöchentlichen Rhythmus", () => {
    expect(abrufFaellig("woechentlich", vor(21, true), jetzt)).toBe(true);
    expect(abrufFaellig("woechentlich", vor(10, true), jetzt)).toBe(false);
  });
});
