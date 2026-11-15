import { describe, expect, it } from "vitest";
import { mitHoechstens, PALETTE_GROUPS, paletteGroups, paletteModules } from "./search-plan.ts";

describe("paletteGroups (#617)", () => {
  it("fragt für Text und reine Ziffern alle Gruppen der Rolle", () => {
    expect(paletteGroups("Bergblick", "inhaber")).toEqual([...PALETTE_GROUPS]);
    // Ziffern können Nummer, Personalnummer, Konto oder IBAN-Ende sein
    expect(paletteGroups("4930", "inhaber")).toEqual([...PALETTE_GROUPS]);
    expect(paletteGroups("Bergblick", "steuerberatung")).toEqual(["invoices", "documents", "bookings", "accounts"]);
  });

  it("fragt für einen Betrag mit Cent oder Eurozeichen nur Gruppen mit Betrag", () => {
    const mitBetrag = ["invoices", "quotes", "documents", "bankTransactions", "bookings", "cashEntries", "pauschalen", "archive"];
    expect(paletteGroups("1.190,00", "inhaber")).toEqual(mitBetrag);
    expect(paletteGroups("19.99", "inhaber")).toEqual(mitBetrag);
    expect(paletteGroups("89 €", "inhaber")).toEqual(mitBetrag);
    expect(paletteGroups("1.190,00", "steuerberatung")).toEqual(["invoices", "documents", "bookings"]);
  });

  it("fragt für ein Datum nur Gruppen mit Datum", () => {
    const mitDatum = ["invoices", "quotes", "documents", "bankTransactions", "bookings", "serviceEntries", "cashEntries", "pauschalen", "archive"];
    expect(paletteGroups("14.11.2026", "inhaber")).toEqual(mitDatum);
    expect(paletteGroups("2026-11-14", "inhaber")).toEqual(mitDatum);
  });

  it("fragt unter zwei Zeichen nichts", () => {
    expect(paletteGroups(" B ", "inhaber")).toEqual([]);
  });
});

describe("paletteModules (#617)", () => {
  it("fasst die Gruppen eines Moduls zu einer Aufgabe zusammen und verliert keine Gruppe", () => {
    const module = paletteModules([...PALETTE_GROUPS]);
    expect(module.map((m) => m.modul)).toEqual(["stammdaten", "rechnungen", "belege", "bank", "buchhaltung", "leistungen", "lohn", "umsatzsteuer", "finanzamt", "archiv"]);
    expect(module.flatMap((m) => m.groups).sort()).toEqual([...PALETTE_GROUPS].sort());
    expect(module.find((m) => m.modul === "stammdaten")?.groups).toEqual(["contacts", "articles", "textBlocks"]);
  });

  it("fragt nur Module, deren Gruppen Rolle und Eingabe zulassen", () => {
    expect(paletteModules(paletteGroups("Bergblick", "steuerberatung"))).toEqual([
      { modul: "rechnungen", groups: ["invoices"] },
      { modul: "belege", groups: ["documents"] },
      { modul: "buchhaltung", groups: ["bookings", "accounts"] },
    ]);
    expect(paletteModules(paletteGroups("14.11.2026", "inhaber")).map((m) => m.modul)).toEqual([
      "rechnungen",
      "belege",
      "bank",
      "buchhaltung",
      "leistungen",
      "archiv",
    ]);
  });
});

describe("mitHoechstens", () => {
  it("führt höchstens n Aufgaben gleichzeitig aus und hält die Reihenfolge der Ergebnisse", async () => {
    let laufend = 0;
    let hoechstens = 0;
    const aufgaben = Array.from({ length: 21 }, (_, i) => async () => {
      laufend += 1;
      hoechstens = Math.max(hoechstens, laufend);
      await new Promise((r) => setTimeout(r, 2));
      laufend -= 1;
      return i;
    });
    expect(await mitHoechstens(4, aufgaben)).toEqual(Array.from({ length: 21 }, (_, i) => i));
    expect(hoechstens).toBe(4);
  });
});
