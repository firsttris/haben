import { describe, expect, it } from "vitest";
import { sichtbareZeilen, type BwaZeileBetraege } from "./bwa-ansicht.ts";

const zeile = (key: string, art: BwaZeileBetraege["art"], betrag: number, rest: Partial<BwaZeileBetraege> = {}) => ({
  key,
  art,
  betrag,
  kumuliert: 0,
  vergleich: null,
  vergleichKumuliert: null,
  ...rest,
});

describe("Sichtbare Zeilen der BWA (#1635)", () => {
  const zeilen = [
    zeile("erloese", "zeile", 100_00),
    zeile("bestandsveraenderung", "zeile", 0),
    zeile("summeErloese", "summe", 100_00),
    zeile("raumkosten", "zeile", 0, { kumuliert: 900_00 }),
    zeile("versicherungen", "zeile", 0, { vergleich: 50_00 }),
    zeile("fahrzeugkosten", "zeile", 0, { vergleich: 0, vergleichKumuliert: 120_00 }),
    zeile("summeKosten", "summe", 0),
    zeile("ergebnis", "ergebnis", 0),
  ];

  it("blendet ohne Schalter Zeilen aus, die in allen Spalten 0 sind", () => {
    expect(sichtbareZeilen(zeilen, false).map((z) => z.key)).toEqual([
      "erloese",
      "summeErloese",
      "raumkosten",
      "versicherungen",
      "fahrzeugkosten",
      "summeKosten",
      "ergebnis",
    ]);
  });

  it("zeigt mit Schalter alle Zeilen in der Reihenfolge der Form", () => {
    expect(sichtbareZeilen(zeilen, true)).toEqual(zeilen);
  });

  it("Summen und Ergebnis bleiben auch bei 0 sichtbar", () => {
    const nurNullen = [zeile("a", "zeile", 0), zeile("s", "summe", 0), zeile("e", "ergebnis", 0)];
    expect(sichtbareZeilen(nurNullen, false).map((z) => z.key)).toEqual(["s", "e"]);
  });
});
