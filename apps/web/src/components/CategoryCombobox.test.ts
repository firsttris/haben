import { EXPENSE_CATEGORY_KEYS, kategorieMitKonto } from "@haben/core";
import { describe, expect, it } from "vitest";
import { searchOptions } from "../lib/combobox.ts";
import { kategorieSuchfelder } from "./CategoryCombobox.tsx";
import { gruppeVon, kategorieRang } from "./KategorieGruppen.ts";

/* Suche in der Kategorieauswahl mit der Nummer des Kontos vor der Bezeichnung (#1438) */

const eintraege = (kr: "SKR03" | "SKR04") =>
  [...EXPENSE_CATEGORY_KEYS].sort((a, b) => kategorieRang(a) - kategorieRang(b)).map((value) => ({ value, label: kategorieMitKonto(kr, value) }));
const suche = (kr: "SKR03" | "SKR04", text: string) =>
  searchOptions(eintraege(kr), text, (e) => kategorieSuchfelder(e.label, gruppeVon(e.value))).hits.map((e) => e.value);

describe("Suche nach Nummer, Bezeichnung und Gruppe", () => {
  it("findet nach der Nummer, in SKR04 und SKR03 je die richtige", () => {
    expect(suche("SKR04", "6805")).toEqual(["telefon"]);
    expect(suche("SKR03", "4920")).toEqual(["telefon"]);
    expect(suche("SKR03", "6805")).toEqual([]);
  });

  it("findet nach der Bezeichnung, auch mitten im Wort und ohne Groß- und Kleinschreibung", () => {
    expect(suche("SKR04", "Telefon")).toEqual(["telefon"]);
    expect(suche("SKR04", "tanken")).toEqual(["kfzBetrieb"]);
  });

  it("findet die angezeigte Zeile „Nummer · Bezeichnung“ und nach Gruppe", () => {
    expect(suche("SKR04", "6805 · Telefon")).toEqual(["telefon"]);
    expect(suche("SKR04", "Fahrzeug")).toContain("kfzBetrieb");
  });

  it("stellt einen genauen Namen vor Treffer über den Namen der Gruppe, damit Enter die richtige wählt", () => {
    // „Werbung und Bewirtung“ ist die Gruppe von Werbung, Bewirtung und Geschenken
    expect(suche("SKR04", "Bewirtung")[0]).toBe("bewirtung");
    expect(suche("SKR03", "Bewirtung")[0]).toBe("bewirtung");
    expect(suche("SKR04", "Beiträge")[0]).toBe("beitraege");
    expect(suche("SKR04", "Fremdleistung")[0]).toBe("fremdleistung");
  });

  it("lässt ein Label ohne Nummer, wie es ist (Einnahmen)", () => {
    expect(kategorieSuchfelder("Erlöse", "Einnahmen")).toEqual(["Erlöse", "Einnahmen"]);
    expect(kategorieSuchfelder("6805 · Telefon", "Büro und IT")).toEqual(["Telefon", "6805", "Büro und IT"]);
  });
});
