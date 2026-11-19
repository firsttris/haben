import { describe, expect, it } from "vitest";
import { abrufFaellig, abrufFenster, AUSSTEHEND_TAGE, naechsterAbrufStart } from "./abruf-regeln.ts";

describe("naechsterAbrufStart", () => {
  const jetzt = new Date("2026-11-07T10:00:00Z");
  it("beginnt zehn Tage vor dem Tag des Abrufs, nie vor dem bisherigen Start", () => {
    expect(naechsterAbrufStart("2026-10-01", jetzt)).toBe("2026-10-28");
    expect(naechsterAbrufStart("2026-11-06", jetzt)).toBe("2026-11-06");
  });
  it("beginnt am Tag der ältesten ausstehenden Zahlung, wenn sie vor dem Überlapp liegt", () => {
    expect(naechsterAbrufStart("2026-10-01", jetzt, "2026-10-21")).toBe("2026-10-21");
    expect(naechsterAbrufStart("2026-10-01", jetzt, "2026-11-06")).toBe("2026-10-28");
  });
  it("hält eine ausstehende Zahlung höchstens 45 Tage zurück und nie vor dem bisherigen Start", () => {
    expect(AUSSTEHEND_TAGE).toBe(45);
    expect(naechsterAbrufStart("2026-01-01", jetzt, "2026-08-01")).toBe("2026-09-23");
    expect(naechsterAbrufStart("2026-10-10", jetzt, "2026-08-01")).toBe("2026-10-10");
  });
});

describe("abrufFaellig", () => {
  const jetzt = new Date("2026-11-07T10:00:00Z");
  const vor = (stunden: number) => new Date(jetzt.getTime() - stunden * 3_600_000);
  it("ruft ohne letzten Abruf sofort ab", () => {
    expect(abrufFaellig("woechentlich", null, jetzt)).toBe(true);
  });
  it("richtet sich nach dem Rhythmus", () => {
    expect(abrufFaellig("stuendlich", { zeit: vor(1), fehlgeschlagen: false }, jetzt)).toBe(true);
    expect(abrufFaellig("taeglich", { zeit: vor(10), fehlgeschlagen: false }, jetzt)).toBe(false);
    expect(abrufFaellig("taeglich", { zeit: vor(21), fehlgeschlagen: false }, jetzt)).toBe(true);
    expect(abrufFaellig("woechentlich", { zeit: vor(48), fehlgeschlagen: false }, jetzt)).toBe(false);
  });
  it("versucht es nach einem Fehlschlag spätestens nach einem Tag erneut, auch wöchentlich", () => {
    expect(abrufFaellig("woechentlich", { zeit: vor(21), fehlgeschlagen: true }, jetzt)).toBe(true);
    expect(abrufFaellig("woechentlich", { zeit: vor(5), fehlgeschlagen: true }, jetzt)).toBe(false);
  });
});

describe("abrufFenster", () => {
  it("reicht vom Start bis zum Tag des Abrufs in UTC", () => {
    expect(abrufFenster("2026-11-01", new Date("2026-11-07T10:00:00Z"))).toEqual({ dateFrom: "2026-11-01", dateTo: "2026-11-07" });
  });
  it("beginnt nach Mitternacht in Deutschland nicht nach seinem Ende: Der Start ist der deutsche Tag, das Ende noch der UTC-Vortag", () => {
    // 0:30 Uhr in Berlin, in UTC noch der 19.: Der erste Start (today()) ist schon der 20.
    expect(abrufFenster("2026-11-20", new Date("2026-11-19T23:30:00Z"))).toEqual({ dateFrom: "2026-11-19", dateTo: "2026-11-19" });
  });
});
