import { EXPENSE_CATEGORIES } from "@haben/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KATEGORIE_GRUPPEN, KategorieOptionen } from "./KategorieOptionen.tsx";

const categories = Object.entries(EXPENSE_CATEGORIES).map(([value, { label }]) => ({ value, label }));

describe("Kategorien in Gruppen", () => {
  it("stellt jede Kategorie in genau eine Gruppe", () => {
    const gruppiert = KATEGORIE_GRUPPEN.flatMap((g) => g.kategorien);
    expect([...gruppiert].sort()).toEqual(Object.keys(EXPENSE_CATEGORIES).sort());
  });

  it("zeigt alle Kategorien einmal, mit unveränderten Werten und Namen, in Gruppen", () => {
    const html = renderToStaticMarkup(createElement(KategorieOptionen, { categories }));
    expect(html.match(/<optgroup /g)).toHaveLength(KATEGORIE_GRUPPEN.length);
    expect(html).toContain('<optgroup label="Büro und IT">');
    expect(html).toContain('<optgroup label="Fahrzeug">');
    for (const { value } of categories) expect(html.match(new RegExp(`<option value="${value}">`, "g")), value).toHaveLength(1);
    expect(html).toContain("Kfz: Laden, Tanken, Wartung");
  });

  it("nimmt eine Kategorie ohne Gruppe unter „Weitere“ auf, statt sie zu verlieren", () => {
    const html = renderToStaticMarkup(createElement(KategorieOptionen, { categories: [...categories, { value: "neu", label: "Neue Kategorie" }] }));
    expect(html).toContain('<optgroup label="Weitere"><option value="neu">Neue Kategorie</option></optgroup>');
  });

  it("lässt Gruppen weg, aus denen nichts zur Wahl steht (Aufteilung ohne Anlagegut)", () => {
    const ohneAnlage = categories.filter((c) => c.value !== "anlage" && c.value !== "einfuhrumsatzsteuer");
    expect(renderToStaticMarkup(createElement(KategorieOptionen, { categories: ohneAnlage }))).not.toContain("Anlagegut und Zoll");
  });
});
