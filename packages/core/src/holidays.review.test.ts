import { describe, expect, it } from "vitest";
import { invoiceDueDate, publicHolidays } from "./holidays.ts";

describe("review: Internationaler Frauentag in Mecklenburg-Vorpommern", () => {
  it("ist erst ab 2023 gesetzlicher Feiertag in MV", () => {
    expect(publicHolidays(2022, "MV").has("2022-03-08")).toBe(false);
    // 22.02.2022 + 14 Tage = Dienstag, 08.03.2022: in MV damals ein Werktag
    expect(invoiceDueDate("2022-02-22", 14, "MV")).toBe("2022-03-08");
  });
});

describe("review: Feiertage mit Einführungsjahr", () => {
  it("Frauentag in Berlin erst ab 2019, Weltkindertag in Thüringen erst ab 2019", () => {
    expect(publicHolidays(2018, "BE").has("2018-03-08")).toBe(false);
    expect(publicHolidays(2019, "BE").has("2019-03-08")).toBe(true);
    expect(publicHolidays(2018, "TH").has("2018-09-20")).toBe(false);
    expect(publicHolidays(2019, "TH").has("2019-09-20")).toBe(true);
    expect(publicHolidays(2023, "MV").has("2023-03-08")).toBe(true);
  });
});
