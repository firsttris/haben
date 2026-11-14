import { describe, expect, it } from "vitest";
import { beschreibungXml, csvKopfzeile, DTD_DATEI, mitKopfzeile } from "./beschreibung.ts";

const enc = (s: string) => new TextEncoder().encode(s);

describe("csvKopfzeile", () => {
  it("liest die erste Zeile mit Anführungszeichen nach RFC 4180 und ohne BOM", () => {
    expect(csvKopfzeile(enc('﻿Nummer;"Name; ""Zusatz""";Betrag\r\n1;a;2'))).toEqual(["Nummer", 'Name; "Zusatz"', "Betrag"]);
  });
});

describe("mitKopfzeile", () => {
  it("reicht den Strom unverändert durch und meldet die Kopfzeile, auch wenn sie über zwei Stücke geht", async () => {
    let spalten: string[] = [];
    async function* quelle() {
      yield enc('A;"B\n');
      yield enc('C";D\r\n1;2;3\r\n');
    }
    const teile: Uint8Array[] = [];
    for await (const t of mitKopfzeile(quelle(), (s) => (spalten = s))) teile.push(t);
    expect(spalten).toEqual(["A", "B\nC", "D"]);
    expect(new TextDecoder().decode(Buffer.concat(teile))).toBe('A;"B\nC";D\r\n1;2;3\r\n');
  });
});

describe("beschreibungXml", () => {
  const b = {
    lieferant: { name: "Muster & Co", ort: "Regensburg", kommentar: "Archiv 2026" },
    medium: "Archiv 2026",
    tabellen: [
      { path: "z.csv", name: "z", beschreibung: "Z", spalten: [{ name: "Text", typ: { art: "text" as const } }] },
      {
        path: "a.csv",
        name: "a",
        beschreibung: "A",
        spalten: [
          { name: "Betrag", typ: { art: "zahl" as const, nachkommastellen: 2 } },
          { name: "Datum", typ: { art: "datum" as const } },
        ],
      },
    ],
  };

  it("schreibt Lieferant, Datenträger und je CSV eine Table mit den Spaltentypen", () => {
    const xml = beschreibungXml(b);
    expect(xml).toContain(`<!DOCTYPE DataSet SYSTEM "${DTD_DATEI}">`);
    expect(xml).toContain("<Name>Muster &amp; Co</Name>");
    expect(xml).toContain("<Numeric><Accuracy>2</Accuracy></Numeric>");
    expect(xml).toContain("<Date><Format>YYYY-MM-DD</Format></Date>");
    expect(xml).toContain("<AlphaNumeric/>");
    expect(xml.indexOf("<URL>a.csv</URL>")).toBeLessThan(xml.indexOf("<URL>z.csv</URL>"));
  });

  it("ergibt für gleiche Daten in anderer Reihenfolge dieselbe Datei", () => {
    expect(beschreibungXml({ ...b, tabellen: [...b.tabellen].reverse() })).toBe(beschreibungXml(b));
  });

  it("entfernt Zeichen, die XML 1.0 nicht kennt", () => {
    expect(beschreibungXml({ ...b, lieferant: { ...b.lieferant, name: "A\u0001B" } })).toContain("<Name>AB</Name>");
  });
});
