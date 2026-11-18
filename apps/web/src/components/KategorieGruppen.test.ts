import { EXPENSE_CATEGORIES } from "@haben/core";
import { describe, expect, it } from "vitest";
import { searchOptions } from "../lib/combobox.ts";
import { gruppeVon, KATEGORIE_GRUPPEN, kategorieRang } from "./KategorieGruppen.ts";

describe("Kategorien in Gruppen", () => {
  it("stellt jede Kategorie in genau eine Gruppe", () => {
    const gruppiert = KATEGORIE_GRUPPEN.flatMap((g) => g.kategorien);
    expect([...gruppiert].sort()).toEqual(Object.keys(EXPENSE_CATEGORIES).sort());
  });

  it("ordnet nach Gruppe und innerhalb der Gruppe wie aufgeführt, Unbekanntes zuletzt", () => {
    const sortiert = ["software", "fahrtkosten", "unbekannt", "buero", "porto", "telefon"].sort((a, b) => kategorieRang(a) - kategorieRang(b));
    expect(sortiert).toEqual(["buero", "porto", "telefon", "software", "fahrtkosten", "unbekannt"]);
  });

  it("nennt die Gruppe je Kategorie, eine ohne Gruppe steht unter „Weitere“", () => {
    expect(gruppeVon("kfzLeasing")).toBe("Fahrzeug");
    expect(gruppeVon("buero")).toBe("Büro und IT");
    expect(gruppeVon("unbekannt")).toBe("Weitere");
  });

  it("findet Kategorien nach Namen ohne Umlaut und nach ihrer Gruppe, wie das Suchfeld sie sucht", () => {
    const kategorien = Object.entries(EXPENSE_CATEGORIES).map(([value, { label }]) => ({ value, label }));
    const suche = (eingabe: string) => searchOptions(kategorien, eingabe, (c) => [c.label, gruppeVon(c.value)]).hits.map((c) => c.value);
    expect(suche("burobedarf")).toEqual(["buero"]);
    expect(suche("fahrzeug").sort()).toEqual([...KATEGORIE_GRUPPEN.find((g) => g.label === "Fahrzeug")!.kategorien].sort());
  });
});
