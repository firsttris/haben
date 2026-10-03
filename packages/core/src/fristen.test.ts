import { describe, expect, it } from "vitest";
import { abgabefrist, naechsterWerktag, tageBis, vorauszahlungstermine } from "./fristen.ts";

describe("Fristen", () => {
  it("verschiebt auf den nächsten Werktag, Feiertage je Bundesland", () => {
    expect(naechsterWerktag("2026-10-03", "BW")).toBe("2026-10-05"); // Samstag, Tag der Deutschen Einheit
    expect(naechsterWerktag("2026-10-05", "BW")).toBe("2026-10-05");
    expect(naechsterWerktag("2025-10-31", "SN")).toBe("2025-11-03"); // Reformationstag in Sachsen, dann Wochenende
    expect(naechsterWerktag("2025-10-31", "BW")).toBe("2025-10-31");
  });

  it("kennt die Abgabefristen ohne Steuerberater, auch die verlängerten", () => {
    expect(abgabefrist(2025, "BW")).toBe("2026-07-31");
    expect(abgabefrist(2024, "BW")).toBe("2025-07-31");
    expect(abgabefrist(2023, "BW")).toBe("2024-09-02");
    expect(abgabefrist(2022, "BW")).toBe("2023-10-02");
    expect(abgabefrist(2026, "BW")).toBe("2027-08-02"); // 31.7.2027 ist ein Samstag
  });

  it("legt die Vorauszahlungen auf den 10. von März, Juni, September und Dezember", () => {
    expect(vorauszahlungstermine(2026, "BW")).toEqual(["2026-03-10", "2026-06-10", "2026-09-10", "2026-12-10"]);
    expect(vorauszahlungstermine(2027, "BW")).toEqual(["2027-03-10", "2027-06-10", "2027-09-10", "2027-12-10"]);
    expect(vorauszahlungstermine(2028, "BW")[2]).toBe("2028-09-11"); // 10.9.2028 ist ein Sonntag
  });

  it("zählt Tage bis zur Frist", () => {
    expect(tageBis("2026-10-10", "2026-10-03")).toBe(7);
    expect(tageBis("2026-10-01", "2026-10-03")).toBe(-2);
  });
});
