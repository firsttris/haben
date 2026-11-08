import { describe, expect, it } from "vitest";
import { ASSET_KINDS, assetAccount, assetIssues, depreciationAccount, depreciationSchedule } from "./afa.ts";
import { ebilanzPosition } from "./ebilanz.ts";
import { postenForSaldo } from "./hgb.ts";

/*
 * Anlagenart „Sonstige Transportmittel“ (Roadmap Platz 1, #312): DATEV-Kontenrahmen 2026 SKR03 0380, SKR04 0560
 * „Sonstige Transportmittel“, in der Gruppe der Fahrzeuge neben Pkw und Lkw; AfA auf „Abschreibungen auf Fahrzeuge“
 * (4832/6222). Nutzungsdauer nach dem einzelnen Wirtschaftsgut, ohne Pkw-Nutzungsdauer, Privatnutzung und Elektro-AfA.
 */

describe("Sonstige Transportmittel", () => {
  it("Art ohne vorgegebene Nutzungsdauer, linear", () => {
    expect(ASSET_KINDS.transport).toMatchObject({ usefulLifeYears: null, method: "linear" });
    expect(ASSET_KINDS.transport.label).toMatch(/Sonstige Transportmittel/);
  });

  it.each([
    ["SKR03", "0380", "4832"],
    ["SKR04", "0560", "6222"],
  ] as const)("%s: Anlagekonto %s, AfA %s; GWG und Sammelposten wie bei jeder Anlage", (kr, anlage, afa) => {
    expect(assetAccount("transport", "linear", kr)).toBe(anlage);
    expect(assetAccount("transport", "degressiv", kr)).toBe(anlage);
    expect(depreciationAccount("transport", "linear", kr)).toBe(afa);
    expect(assetAccount("transport", "gwg", kr)).toBe(kr === "SKR03" ? "0480" : "0670");
  });

  it("Bilanz (Sachanlagen) und E-Bilanz-Position „sonstige Transportmittel“", () => {
    expect(postenForSaldo("SKR03", "0380", 100_00)).toBe("aktiva.A");
    expect(postenForSaldo("SKR04", "0560", 100_00)).toBe("aktiva.A");
    expect(ebilanzPosition("SKR03", "0380", 100_00)).toBe("bs.ass.fixAss.tan.otherEquipm.otherTransportMeans");
    expect(ebilanzPosition("SKR04", "0560", 100_00)).toBe("bs.ass.fixAss.tan.otherEquipm.otherTransportMeans");
  });

  it("keine Elektro-AfA nach § 7 Abs. 2a EStG; Nutzungsdauer ist Pflicht", () => {
    const base = { acquisitionDate: "2026-04-10", cost: 6_000_00, usefulLifeMonths: 132, kind: "transport" as const };
    expect(assetIssues({ ...base, method: "elektro", usefulLifeMonths: null })).toContain("AfA nach § 7 Abs. 2a EStG nur für Fahrzeuge");
    expect(assetIssues({ ...base, method: "linear", usefulLifeMonths: null }).length).toBeGreaterThan(0);
    expect(assetIssues({ ...base, method: "linear" })).toEqual([]);
  });

  it("AfA monatsgenau über die Nutzungsdauer des Wirtschaftsguts (Anhänger, 11 Jahre laut AfA-Tabelle)", () => {
    const plan = depreciationSchedule({ acquisitionDate: "2026-04-10", cost: 6_600_00, method: "linear", usefulLifeMonths: 132, kind: "transport" });
    // 9 Monate von 132: 450 €
    expect(plan[0]).toMatchObject({ year: 2026, depreciation: 450_00 });
  });
});
