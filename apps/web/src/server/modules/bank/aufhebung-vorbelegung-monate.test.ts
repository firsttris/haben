import { monthsOfPeriod } from "@haben/core";
import { describe, expect, it } from "vitest";
import { gesendeteMonate, monatsschluessel, vorbelegterAufhebungstag } from "./aufhebung-vorbelegung.ts";

describe("Monatsschlüssel einer Voranmeldung", () => {
  it("einzelner Monat", () => {
    expect(monatsschluessel(2026, 3)).toBe("2026-03");
  });
});

describe("gesendete Zeiträume als Zahlungsmonate (#782, Befund SteGun93)", () => {
  it("eine gesendete Quartalsmeldung markiert alle drei Zahlungsmonate als gemeldet", () => {
    // Q1 liegt als month = 41 in vat_returns
    expect(gesendeteMonate([{ jahr: 2026, monat: 41 }])).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("eine Monatsmeldung bleibt ein Monat", () => {
    expect(gesendeteMonate([{ jahr: 2026, monat: 5 }])).toEqual(["2026-05"]);
  });

  it("mehrere Meldungen werden in Zahlungsmonate aufgelöst, ohne Doppelung", () => {
    expect(
      gesendeteMonate([
        { jahr: 2026, monat: 41 },
        { jahr: 2026, monat: 2 },
      ]),
    ).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("die Monate kommen sortiert zurück", () => {
    const monate = gesendeteMonate([
      { jahr: 2026, monat: 43 },
      { jahr: 2026, monat: 41 },
    ]);
    expect(monate).toEqual(["2026-01", "2026-02", "2026-03", "2026-07", "2026-08", "2026-09"]);
  });

  it("ein gemeldetes Quartal belegt den Zahlungstag vor", () => {
    const gemeldet = gesendeteMonate([{ jahr: 2026, monat: 41 }]);
    expect(vorbelegterAufhebungstag("2026-03-15", gemeldet, "2026-11-13")).toBe("2026-11-13");
    expect(vorbelegterAufhebungstag("2026-04-15", gemeldet, "2026-11-13")).toBe("2026-04-15");
  });
});

describe("monthsOfPeriod deckt die Quartalsmonate", () => {
  it("Q1 ist Januar bis März", () => {
    expect(monthsOfPeriod({ year: 2026, month: 41 }).map((m) => m.month)).toEqual([1, 2, 3]);
  });
});
