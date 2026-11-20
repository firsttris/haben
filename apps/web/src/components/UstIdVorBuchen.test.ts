import { describe, expect, it, vi } from "vitest";

vi.mock("../server/functions/ustid-bestaetigung.ts", () => ({ ustIdVorBuchenFn: {}, ustIdVorFestschreibenFn: {} }));
const { ustIdVorBuchenNoetig } = await import("./UstIdVorFestschreiben.tsx");

describe("USt-IdNr. des Lieferanten vor dem Buchen (#1490)", () => {
  it("prüft nur beim innergemeinschaftlichen Erwerb und bei § 13b für eine EU-Leistung", () => {
    expect(ustIdVorBuchenNoetig("ig_erwerb")).toBe(true);
    expect(ustIdVorBuchenNoetig("eu")).toBe(true);
    expect(ustIdVorBuchenNoetig("drittland")).toBe(false);
    expect(ustIdVorBuchenNoetig(null)).toBe(false);
  });
});
