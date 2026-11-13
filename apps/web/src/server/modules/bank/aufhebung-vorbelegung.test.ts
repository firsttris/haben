import { describe, expect, it } from "vitest";
import { monatsschluessel, vorbelegterAufhebungstag } from "./aufhebung-vorbelegung.ts";

describe("Vorbelegter Tag der Aufhebung (#782)", () => {
  const heute = "2026-07-20";

  it("nicht gemeldeter Zeitraum: der Buchungstag ist vorbelegt, die Korrektur bleibt im März", () => {
    expect(vorbelegterAufhebungstag("2026-03-12", [], heute)).toBe("2026-03-12");
  });

  it("gemeldeter Zeitraum: heute ist vorbelegt, die abgegebene Voranmeldung bleibt unberührt", () => {
    expect(vorbelegterAufhebungstag("2026-03-12", ["2026-03"], heute)).toBe(heute);
  });

  it("andere gemeldete Monate ändern nichts", () => {
    expect(vorbelegterAufhebungstag("2026-03-12", ["2026-01", "2026-02"], heute)).toBe("2026-03-12");
  });

  it("Zahlung in der Zukunft: heute, auch wenn der Zeitraum nicht gemeldet ist", () => {
    expect(vorbelegterAufhebungstag("2026-08-05", [], heute)).toBe(heute);
  });

  it("Monatsschlüssel ist zweistellig", () => {
    expect(monatsschluessel(2026, 3)).toBe("2026-03");
    expect(monatsschluessel(2025, 12)).toBe("2025-12");
  });
});
