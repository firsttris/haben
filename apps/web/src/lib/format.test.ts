import { describe, expect, it } from "vitest";
import { daysUntil, parseUsefulLifeMonths } from "./format.ts";

describe("parseUsefulLifeMonths", () => {
  it("liest Jahre mit Komma oder Punkt", () => {
    expect(parseUsefulLifeMonths("3")).toBe(36);
    expect(parseUsefulLifeMonths("2,5")).toBe(30);
    expect(parseUsefulLifeMonths("2.5")).toBe(30);
  });

  it("lehnt Leeres, Null und angebrochene Monate ab", () => {
    expect(parseUsefulLifeMonths("")).toBeNull();
    expect(parseUsefulLifeMonths("0")).toBeNull();
    expect(parseUsefulLifeMonths("-1")).toBeNull();
    expect(parseUsefulLifeMonths("2,3")).toBeNull();
    expect(parseUsefulLifeMonths("abc")).toBeNull();
  });
});

describe("daysUntil", () => {
  it("zählt Kalendertage in Deutschland, unabhängig von der Zeitzone des Prozesses", () => {
    // 08.11.2026 23:30 UTC ist in Deutschland schon der 9. November
    const now = new Date("2026-11-08T23:30:00Z");
    expect(daysUntil("2026-11-09", now)).toBe(0);
    expect(daysUntil("2026-11-10", now)).toBe(1);
    expect(daysUntil("2026-11-08", now)).toBe(-1);
  });
  it("nimmt bei einem Zeitpunkt dessen Tag in Deutschland", () => {
    const now = new Date("2026-11-09T11:00:00Z");
    expect(daysUntil(new Date("2026-11-08T23:30:00Z"), now)).toBe(0);
  });
});
