import { describe, expect, it } from "vitest";
import { leistungNichtAusgefuehrt, leistungsdatum } from "./leistungsdatum.ts";

describe("Leistungsdatum (#693, #694, #622)", () => {
  it("Leistungszeitraum: der letzte Tag ist „ausgeführt am“", () => {
    expect(leistungsdatum({ belegdatum: "2026-03-05", leistungVon: "2026-02-01", leistungBis: "2026-02-28" })).toBe("2026-02-28");
  });

  it("nur „Leistung von“: dieser Tag", () => {
    expect(leistungsdatum({ belegdatum: "2026-03-05", leistungVon: "2026-02-01" })).toBe("2026-02-01");
  });

  it("ohne Angabe: das Belegdatum", () => {
    expect(leistungsdatum({ belegdatum: "2026-03-05" })).toBe("2026-03-05");
  });

  it("leere Angaben zählen wie keine Angabe", () => {
    expect(leistungsdatum({ belegdatum: "2026-03-05", leistungVon: null, leistungBis: null })).toBe("2026-03-05");
  });

  it("einpunktiger Zeitraum: von und bis gleich", () => {
    expect(leistungsdatum({ belegdatum: "2026-03-05", leistungVon: "2026-02-10", leistungBis: "2026-02-10" })).toBe("2026-02-10");
  });
});

describe("Leistung beim Buchen noch nicht ausgeführt (#693)", () => {
  it("Leistungszeitraum nach dem Belegdatum: noch nicht ausgeführt", () => {
    expect(leistungNichtAusgefuehrt({ belegdatum: "2026-11-20", leistungVon: "2026-12-01", leistungBis: "2026-12-31" })).toBe(true);
  });

  it("nur „Leistung von“ nach dem Belegdatum: noch nicht ausgeführt", () => {
    expect(leistungNichtAusgefuehrt({ belegdatum: "2026-11-20", leistungVon: "2026-12-01" })).toBe(true);
  });

  it("Leistung vor oder am Belegdatum: ausgeführt", () => {
    expect(leistungNichtAusgefuehrt({ belegdatum: "2026-11-20", leistungVon: "2026-11-01", leistungBis: "2026-11-20" })).toBe(false);
    expect(leistungNichtAusgefuehrt({ belegdatum: "2026-11-20", leistungVon: "2026-10-01", leistungBis: "2026-11-19" })).toBe(false);
  });

  it("ohne Angabe: ausgeführt, wie ohne Leistungsdatum", () => {
    expect(leistungNichtAusgefuehrt({ belegdatum: "2026-11-20" })).toBe(false);
    expect(leistungNichtAusgefuehrt({ belegdatum: "2026-11-20", leistungVon: null, leistungBis: null })).toBe(false);
  });
});
