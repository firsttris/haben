import { describe, expect, it } from "vitest";
import { parseDateSearch } from "./search-date.ts";

describe("parseDateSearch", () => {
  it("erkennt deutsche Datumsangaben mit ein- und zweistelligen Tagen und Monaten", () => {
    expect(parseDateSearch("14.11.2026")).toBe("2026-11-14");
    expect(parseDateSearch(" 1.2.2026 ")).toBe("2026-02-01");
    expect(parseDateSearch("29.02.2024")).toBe("2024-02-29");
  });

  it("erkennt ISO-Daten", () => {
    expect(parseDateSearch("2026-11-14")).toBe("2026-11-14");
  });

  it("lehnt ungültige Kalendertage und Nicht-Daten ab", () => {
    expect(parseDateSearch("31.02.2026")).toBeNull();
    expect(parseDateSearch("29.02.2025")).toBeNull();
    expect(parseDateSearch("14.13.2026")).toBeNull();
    expect(parseDateSearch("RE-2026")).toBeNull();
    expect(parseDateSearch("1.234,56")).toBeNull();
    expect(parseDateSearch("")).toBeNull();
  });
});
