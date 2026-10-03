import { describe, expect, it } from "vitest";
import { formatWert } from "./vast.ts";

describe("formatWert", () => {
  it("zeigt Beträge in Euro und Datumsangaben als Datum", () => {
    expect(formatWert(["Teilleistung", "Betrag"], "22000.20")).toMatch(/^22\.000,20\s€$/);
    expect(formatWert(["Bruttoarbeitslohn"], "1000.00")).toMatch(/^1\.000,00\s€$/);
    expect(formatWert(["Leistung", "Beginn"], "20100112")).toBe("12.01.2010");
  });

  it("lässt Schlüssel, Monate und IdNr unverändert", () => {
    expect(formatWert(["Krankenversicherung", "Beitragsart"], "01")).toBe("01");
    expect(formatWert(["Krankenversicherung", "Beginn"], "01")).toBe("01");
    expect(formatWert(["LeistungsEmpfaenger", "IdNr"], "65929970489")).toBe("65929970489");
    expect(formatWert(["Steuerklasse"], "3")).toBe("3");
  });
});
