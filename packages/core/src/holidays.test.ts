import { describe, expect, it } from "vitest";
import { easterSunday, invoiceDueDate, publicHolidays } from "./holidays.ts";

describe("Feiertage", () => {
  it("Ostersonntag", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });

  it("Landesfeiertage", () => {
    expect(publicHolidays(2026, "BY").get("2026-06-04")).toBe("Fronleichnam");
    expect(publicHolidays(2026, "NI").has("2026-06-04")).toBe(false);
    expect(publicHolidays(2026, "SN").get("2026-11-18")).toBe("Buß- und Bettag");
    expect(publicHolidays(2026, null).has("2026-10-31")).toBe(false);
  });
});

describe("invoiceDueDate", () => {
  it("verschiebt auf den nächsten Werktag", () => {
    // 2026-10-17 + 14 = Samstag 31.10. → Montag 02.11. (in NI ist der 31.10. ohnehin Feiertag)
    expect(invoiceDueDate("2026-10-17", 14, "NI")).toBe("2026-11-02");
    // Allerheiligen in NW fällt 2027 auf einen Montag
    expect(invoiceDueDate("2027-10-18", 14, "NW")).toBe("2027-11-02");
    expect(invoiceDueDate("2027-10-18", 14, "NI")).toBe("2027-11-01");
    // Karfreitag und Ostermontag
    expect(invoiceDueDate("2026-03-20", 14, null)).toBe("2026-04-07");
  });

  it("sofort fällig bleibt das Rechnungsdatum", () => {
    expect(invoiceDueDate("2026-10-03", 0, null)).toBe("2026-10-03");
  });
});
