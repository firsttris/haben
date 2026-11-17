import { EXPENSE_CATEGORIES } from "@haben/core";
import { describe, expect, it } from "vitest";
import { KATEGORIE_GRUPPEN, kategorieRang } from "./KategorieGruppen.ts";

describe("Kategorien in Gruppen", () => {
  it("stellt jede Kategorie in genau eine Gruppe", () => {
    const gruppiert = KATEGORIE_GRUPPEN.flatMap((g) => g.kategorien);
    expect([...gruppiert].sort()).toEqual(Object.keys(EXPENSE_CATEGORIES).sort());
  });

  it("ordnet nach Gruppe und innerhalb der Gruppe wie aufgeführt, Unbekanntes zuletzt", () => {
    const sortiert = ["software", "fahrtkosten", "unbekannt", "buero", "porto", "telefon"].sort((a, b) => kategorieRang(a) - kategorieRang(b));
    expect(sortiert).toEqual(["buero", "porto", "telefon", "software", "fahrtkosten", "unbekannt"]);
  });
});
