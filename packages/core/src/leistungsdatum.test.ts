import { describe, expect, it } from "vitest";
import { leistungsdatum } from "./leistungsdatum.ts";

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
