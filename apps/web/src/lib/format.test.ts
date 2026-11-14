import { describe, expect, it } from "vitest";
import { daysUntil, formatZeitraumAbJahresanfang, parseUsefulLifeMonths } from "./format.ts";

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

describe("formatZeitraumAbJahresanfang", () => {
  it("schreibt beide Enden im gleichen Format", () => {
    // Der Anlass: „1. Januar bis 14.11.2026" mischt Monatsname und Zifferndatum und liest sich wie ein Datum.
    expect(formatZeitraumAbJahresanfang("2026-11-14")).toBe("01.01.2026–14.11.2026");
  });

  it("nimmt den Jahresanfang des Stichtags, nicht des laufenden Jahres", () => {
    expect(formatZeitraumAbJahresanfang("2025-03-31")).toBe("01.01.2025–31.03.2025");
  });

  it("zeigt den Jahresanfang selbst als Punkt, nicht als leeren Zeitraum", () => {
    expect(formatZeitraumAbJahresanfang("2026-01-01")).toBe("01.01.2026–01.01.2026");
  });

  it("bleibt am Jahreswechsel beim Jahr des Stichtags", () => {
    // 31.12.2026 23:30 UTC ist in Deutschland der 1. Januar 2027 — der Zeitraum muss dann 2027 sein.
    expect(formatZeitraumAbJahresanfang(new Date("2026-12-31T23:30:00Z"))).toBe("01.01.2027–01.01.2027");
  });
});
