import { describe, expect, it } from "vitest";
import { leistungNichtAusgefuehrt, leistungsdatum, vorsteuerWartetAufAusfuehrung, type WarteAngabe } from "./leistungsdatum.ts";

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

describe("Vorsteuer wartet auf die Ausführung (#693)", () => {
  /** Rechnung vom 20.11. über die Bank, Leistung im Dezember */
  const rechnung: WarteAngabe = {
    belegdatum: "2026-11-20",
    leistungVon: "2026-12-01",
    leistungBis: "2026-12-31",
    reverseCharge: null,
    category: "edv",
    gross: 3_856,
    erstattetBezahltes: false,
  };

  it("Leistung nach dem Belegdatum: wartet", () => {
    expect(vorsteuerWartetAufAusfuehrung(rechnung)).toBe(true);
  });

  it("Leistung vor oder am Belegdatum und ohne Leistungsdatum: wartet nicht", () => {
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, leistungVon: "2026-11-01", leistungBis: "2026-11-19" })).toBe(false);
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, leistungVon: "2026-11-01", leistungBis: "2026-11-20" })).toBe(false);
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, leistungVon: null, leistungBis: null })).toBe(false);
  });

  it("ohne Belegdatum: wartet nicht", () => {
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, belegdatum: null })).toBe(false);
  });

  it("§ 13b, innergemeinschaftlicher Erwerb und Einfuhrumsatzsteuer haben ihren eigenen Zeitpunkt", () => {
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, reverseCharge: "eu" })).toBe(false);
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, reverseCharge: "drittland" })).toBe(false);
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, reverseCharge: "ig_erwerb" })).toBe(false);
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, category: "einfuhrumsatzsteuer" })).toBe(false);
  });

  it("Gutschrift (Brutto unter 0) und „erstattet bereits Bezahltes“ berichtigen nach § 17 UStG: wartet nicht", () => {
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, gross: -3_856 })).toBe(false);
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, gross: -3_856, erstattetBezahltes: true })).toBe(false);
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, erstattetBezahltes: true })).toBe(false);
  });

  it("Brutto 0 ist keine Gutschrift: wartet", () => {
    expect(vorsteuerWartetAufAusfuehrung({ ...rechnung, gross: 0 })).toBe(true);
  });
});
