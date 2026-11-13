import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseSplitRows, splitRow } from "./DocumentSplits.tsx";
import { EigenesKontoWahl, type OwnAccountChoice, passendesKonto } from "./EigenesKontoWahl.tsx";

/*
 * Auswahl eines eigenen Sachkontos (#270) am Beleg und in der Aufteilung: nur Konten der gewählten Kategorie, ein archiviertes
 * nur, wenn es schon gewählt ist, und ein Konto fällt beim Wechsel der Kategorie weg. Alle Daten sind erfunden.
 */

const konto = (id: string, account: string, parentCategory: string, archived = false): OwnAccountChoice => ({
  id,
  account,
  name: `Konto ${account}`,
  parentCategory,
  archived,
});

const KONTEN = [konto("a", "4999", "software"), konto("b", "4998", "software", true), konto("c", "4997", "telefon")];

const render = (category: string, value = "", accounts = KONTEN) =>
  renderToStaticMarkup(createElement(() => EigenesKontoWahl({ accounts, category, value, onChange: () => undefined })));

describe("EigenesKontoWahl", () => {
  it("zeigt nur die Konten der gewählten Kategorie", () => {
    const html = render("software");
    expect(html).toContain("4999 Konto 4999");
    expect(html).not.toContain("4997");
  });

  it("nennt als Leerwert das Konto der Kategorie", () => {
    expect(render("software")).toContain(">Konto der Kategorie</option>");
  });

  it("zeigt ein archiviertes Konto nicht zur Wahl", () => {
    expect(render("software")).not.toContain("4998");
  });

  it("zeigt ein archiviertes Konto, wenn der Beleg es schon hat, mit dem Zusatz „archiviert“", () => {
    expect(render("software", "b")).toContain("4998 Konto 4998 (archiviert)");
  });

  it("zeigt nichts ohne Kategorie und nichts ohne passendes Konto", () => {
    expect(render("")).toBe("");
    expect(render("buero")).toBe("");
    expect(render("software", "", [])).toBe("");
  });

  it("zeigt nichts, wenn zur Kategorie nur ein archiviertes Konto da ist, das der Beleg nicht hat", () => {
    expect(render("software", "", [konto("b", "4998", "software", true)])).toBe("");
  });
});

describe("passendesKonto", () => {
  it("behält das Konto bei derselben Kategorie", () => {
    expect(passendesKonto(KONTEN, "software", "a")).toBe("a");
  });

  it("lässt das Konto beim Wechsel der Kategorie weg", () => {
    expect(passendesKonto(KONTEN, "telefon", "a")).toBe("");
  });

  it("lässt ein unbekanntes oder leeres Konto weg", () => {
    expect(passendesKonto(KONTEN, "software", "z")).toBe("");
    expect(passendesKonto(KONTEN, "software", "")).toBe("");
  });

  it("behält auch ein archiviertes Konto, das der Beleg schon hat", () => {
    expect(passendesKonto(KONTEN, "software", "b")).toBe("b");
  });
});

describe("Zeilen der Aufteilung mit eigenem Konto", () => {
  it("gibt das Konto je Zeile weiter, leer als null", () => {
    const rows = [splitRow("software", 1900, "60,00", "a"), splitRow("buero", 1900, "40,00")];
    expect(parseSplitRows(rows)).toEqual([
      { category: "software", taxRate: 1900, net: 6000, ownAccountId: "a" },
      { category: "buero", taxRate: 1900, net: 4000, ownAccountId: null },
    ]);
  });
});
