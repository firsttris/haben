import { describe, expect, it } from "vitest";
import { COMBOBOX_LIMIT, moveActive, sameEntry, searchOptions } from "./combobox.ts";

interface Kunde {
  name: string;
  nummer: string | null;
  ort: string;
}

const felder = (k: Kunde) => [k.name, k.nummer, k.ort];
const kunde = (name: string, nummer: string | null, ort: string): Kunde => ({ name, nummer, ort });

const KUNDEN = [
  kunde("Rheinpixel GmbH", "10003", "Köln"),
  kunde("Nordwerk Software GmbH", "10001", "Hamburg"),
  kunde("Müller & Söhne OHG", null, "Regensburg"),
];

const namen = (query: string, items = KUNDEN) => searchOptions(items, query, felder).hits.map((k) => k.name);

describe("searchOptions", () => {
  it("zeigt ohne Eingabe alles in der gegebenen Reihenfolge", () => {
    expect(namen("")).toEqual(["Rheinpixel GmbH", "Nordwerk Software GmbH", "Müller & Söhne OHG"]);
    expect(namen("   ")).toHaveLength(3);
  });

  it("findet nach Name, Nummer und Ort", () => {
    expect(namen("nordw")).toEqual(["Nordwerk Software GmbH"]);
    expect(namen("10003")).toEqual(["Rheinpixel GmbH"]);
    expect(namen("hamburg")).toEqual(["Nordwerk Software GmbH"]);
  });

  it("verlangt jedes Wort, in beliebiger Reihenfolge und über Felder hinweg", () => {
    expect(namen("köln rhein")).toEqual(["Rheinpixel GmbH"]);
    expect(namen("rhein hamburg")).toEqual([]);
  });

  it("ignoriert Groß- und Kleinschreibung, Umlaute und ß", () => {
    expect(namen("MÜLLER")).toEqual(["Müller & Söhne OHG"]);
    expect(namen("muller")).toEqual(["Müller & Söhne OHG"]);
    expect(namen("koln")).toEqual(["Rheinpixel GmbH"]);
    const strasse = [kunde("Maß GmbH", null, "Weißenburg")];
    expect(namen("mass", strasse)).toEqual(["Maß GmbH"]);
    expect(namen("weiss", strasse)).toEqual(["Maß GmbH"]);
  });

  it("findet den angezeigten Text wieder, mit dem Trenner zwischen den Feldern", () => {
    expect(namen("Rheinpixel GmbH · Köln")).toEqual(["Rheinpixel GmbH"]);
  });

  it("stellt Treffer am Anfang des ersten Felds nach vorn, sonst bleibt die Reihenfolge", () => {
    const items = [kunde("Alpha Hamburg", null, ""), kunde("Hamburg Hafen", null, ""), kunde("Beta Hamburg", null, "")];
    expect(namen("hamburg", items)).toEqual(["Hamburg Hafen", "Alpha Hamburg", "Beta Hamburg"]);
  });

  it("stellt eine genau passende Nummer nach vorn", () => {
    const items = [kunde("Kunde 1200", "7", ""), kunde("Zuletzt", "1200", "")];
    expect(namen("1200", items)).toEqual(["Zuletzt", "Kunde 1200"]);
  });

  it("begrenzt die Treffer und nennt die Gesamtzahl", () => {
    const viele = Array.from({ length: 800 }, (_, i) => kunde(`Kunde ${i}`, String(i), "Köln"));
    const { hits, total } = searchOptions(viele, "köln", felder);
    expect(hits).toHaveLength(COMBOBOX_LIMIT);
    expect(total).toBe(800);
  });

  it("nennt ohne Treffer null", () => {
    expect(searchOptions(KUNDEN, "gibtesnicht", felder)).toEqual({ hits: [], total: 0 });
  });
});

describe("sameEntry", () => {
  it("vergleicht wie die Suche, ohne Rand und Schreibweise", () => {
    expect(sameEntry("  Müller Beratung ", "muller beratung")).toBe(true);
    expect(sameEntry("Beratung", "Beratung Softwarearchitektur")).toBe(false);
  });

  it("zählt Leerzeichen im Text nicht mehrfach", () => {
    expect(sameEntry("Beratung  Software", "Beratung Software")).toBe(true);
  });

  it("nennt leere Texte nicht gleich", () => {
    expect(sameEntry("", "  ")).toBe(false);
  });
});

describe("moveActive", () => {
  it("geht aus dem Feld heraus zum ersten oder letzten Eintrag", () => {
    expect(moveActive(-1, 3, "ArrowDown")).toBe(0);
    expect(moveActive(-1, 3, "ArrowUp")).toBe(2);
  });

  it("läuft an den Enden herum", () => {
    expect(moveActive(2, 3, "ArrowDown")).toBe(0);
    expect(moveActive(0, 3, "ArrowUp")).toBe(2);
  });

  it("bleibt ohne Einträge außerhalb der Liste", () => {
    expect(moveActive(-1, 0, "ArrowDown")).toBe(-1);
    expect(moveActive(-1, 0, "ArrowUp")).toBe(-1);
  });
});
