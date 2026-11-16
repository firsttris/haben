import { describe, expect, it } from "vitest";
import { computeEuer, type EuerPayment } from "./euer.ts";

// EÜR-Anleitung 2025, Zeilen 12/16/18/58: Eine Gegenaufhebung mindert die ursprüngliche Einnahme bzw. Ausgabe.
// Echte Erstattungen und Zahlungen bleiben eigenständig: https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
const amount = (euer: ReturnType<typeof computeEuer>, key: string) => [...euer.einnahmen, ...euer.ausgaben].find((line) => line.key === key)?.amount ?? 0;

describe("Originalrichtung einer Steuer-Gegenaufhebung", () => {
  it.each(["steuer", "zinsen233a"] as const)("%s: Gegenzeile im Folgejahr behält die Richtung bei geändertem KU-Status", (posten) => {
    const payments: EuerPayment[] = [
      { kind: "steuer", date: "2026-12-30", amount: 1_200, art: "ust", posten, group: "original" },
      { kind: "steuer", date: "2027-01-05", amount: -1_200, art: "ust", posten, group: "original", ...{ steuerErstattung: true } },
    ];
    const before = computeEuer(2026, payments, undefined, undefined, Array(12).fill(true));
    const after = computeEuer(2027, payments, undefined, undefined, [false]);
    expect(amount(before, posten === "steuer" ? "erstatteteUst" : "einnahmenKleinunternehmer")).toBe(1_200);
    expect(amount(after, posten === "steuer" ? "erstatteteUst" : "einnahmenSteuerfrei")).toBe(-1_200);
    expect(after.totalAusgaben).toBe(0);
    expect(after.gewinn).toBe(-1_200);
    expect(after.monthly.einnahmen[0]).toBe(posten === "steuer" ? 0 : -1_200);
  });

  it("eine Gegenzeile zu Nachzahlungszinsen mindert die Ausgabe statt eine Zinserstattung vorzutäuschen", () => {
    const euer = computeEuer(2026, [{ kind: "steuer", date: "2026-02-02", amount: 700, art: "ust", posten: "zinsen233a", ...{ steuerErstattung: false } }]);
    expect(amount(euer, "steuerNebenleistungen")).toBe(-700);
    expect(euer.totalEinnahmen).toBe(0);
    expect(euer.gewinn).toBe(700);
  });

  it.each(["steuer", "zinsen233a"] as const)("%s: echte Erstattung und Zahlung ohne Gegenbezug bleiben getrennt", (posten) => {
    const euer = computeEuer(
      2026,
      [
        { kind: "steuer", date: "2026-01-15", amount: 300, art: "ust", posten },
        { kind: "steuer", date: "2026-02-15", amount: -700, art: "ust", posten },
      ],
      undefined,
      undefined,
      [true, false],
    );
    expect(amount(euer, posten === "steuer" ? "erstatteteUst" : "einnahmenKleinunternehmer")).toBe(300);
    expect(amount(euer, posten === "steuer" ? "gezahlteUst" : "steuerNebenleistungen")).toBe(700);
    expect(euer.gewinn).toBe(-400);
  });
});
