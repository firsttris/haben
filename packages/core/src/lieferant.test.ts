import { describe, expect, it } from "vitest";
import { type LieferantMerkmale, lieferantGruppen, ustIdVergleichbar } from "./lieferant.ts";

/*
 * Derselbe Lieferant (#1514): Gruppen für „Warum?“ der BWA (#1380), mit den Merkmalen der Vorschläge (#295). Erfundene Lieferanten.
 */

const m = (merkmale: Partial<LieferantMerkmale>): LieferantMerkmale => ({ kontaktId: null, ustIds: [], namen: [], ...merkmale });

/** Gruppen als Listen der Indizes, damit der Test nicht an den Schlüsseln hängt */
const gruppen = (eintraege: LieferantMerkmale[]) => {
  const je = new Map<string, number[]>();
  lieferantGruppen(eintraege).forEach((key, i) => {
    if (key !== null) je.set(key, [...(je.get(key) ?? []), i]);
  });
  return [...je.values()];
};

describe("USt-IdNr. vergleichbar", () => {
  it("wie updateDocument sie speichert: ohne Leerzeichen und groß", () => {
    expect(ustIdVergleichbar(" de 123 456 789 ")).toBe("DE123456789");
  });
});

describe("Gruppen derselben Lieferanten", () => {
  it("fasst Belege mit und ohne Kontakt über USt-IdNr. oder Namen zusammen", () => {
    expect(
      gruppen([
        m({ kontaktId: "k1", namen: ["Muster Hosting"], ustIds: ["DE999999999"] }),
        m({ namen: ["Muster Hosting GmbH"], ustIds: ["DE999999999"] }),
        m({ namen: ["muster hosting"] }),
        m({ kontaktId: "k2", namen: ["Papierladen"] }),
      ]),
    ).toEqual([[0, 1, 2], [3]]);
  });

  it("verbindet über mehrere Schritte: Kontakt, gleiche USt-IdNr., dann gleicher Name", () => {
    expect(
      gruppen([
        m({ kontaktId: "k1", namen: ["Muster Hosting"], ustIds: ["DE999999999"] }),
        m({ namen: ["MH Rechenzentrum"], ustIds: ["DE999999999"] }),
        m({ namen: ["MH Rechenzentrum"] }),
        m({ namen: ["Anderer Laden"] }),
      ]),
    ).toEqual([[0, 1, 2], [3]]);
  });

  it("Belege ohne Kontakt untereinander ebenso", () => {
    expect(gruppen([m({ namen: ["Tankstelle Süd"], ustIds: ["DE111111111"] }), m({ ustIds: ["DE111111111"] }), m({ namen: [" tankstelle süd"] })])).toEqual([
      [0, 1, 2],
    ]);
  });

  it("zwei Kontakte bleiben getrennt, auch mit gleichem Namen", () => {
    expect(gruppen([m({ kontaktId: "k1", namen: ["Muster"] }), m({ kontaktId: "k2", namen: ["Muster"] })])).toEqual([[0], [1]]);
  });

  it("ein Beleg ohne Kontakt, der zu zwei Kontakten passt, bleibt für sich und verbindet nichts", () => {
    expect(
      gruppen([
        m({ kontaktId: "k1", namen: ["Muster Hosting"], ustIds: ["DE999999999"] }),
        m({ kontaktId: "k2", namen: ["Muster Mail"] }),
        // USt-IdNr. von k1, Name von k2: nicht raten
        m({ namen: ["Muster Mail"], ustIds: ["DE999999999"] }),
        // Passt nur zu k2
        m({ namen: ["Muster Mail"] }),
        // Gleich mehrdeutig wie der erste: beide stehen zusammen, aber bei keinem Kontakt
        m({ namen: ["muster mail"], ustIds: ["DE 999999999"] }),
      ]),
    ).toEqual([[0], [1, 3], [2, 4]]);
  });

  it("ein mehrdeutiger Beleg steht bei gleichnamigen Belegen, die zu keinem Kontakt gehören", () => {
    expect(
      gruppen([
        // Zwei Kontakte mit derselben USt-IdNr., etwa nach einem Import
        m({ kontaktId: "k1", namen: ["Bar Nord"], ustIds: ["DE999999999"] }),
        m({ kontaktId: "k2", namen: ["Bar Süd"], ustIds: ["DE999999999"] }),
        m({ namen: ["Bar AG"], ustIds: ["DE999999999"] }),
        m({ namen: ["bar ag"] }),
      ]),
    ).toEqual([[0], [1], [2, 3]]);
  });

  it("verbinden erst Belege ohne Kontakt zwei Kontakte, bleiben sie zusammen für sich", () => {
    expect(
      gruppen([
        m({ kontaktId: "k1", namen: ["Muster Hosting"] }),
        m({ kontaktId: "k2", namen: ["Muster Mail"] }),
        m({ namen: ["Muster Hosting"], ustIds: ["DE222222222"] }),
        m({ namen: ["Muster Mail"], ustIds: ["DE222222222"] }),
      ]),
    ).toEqual([[0], [1], [2, 3]]);
  });

  it("ohne Kontakt, USt-IdNr. und Namen keine Gruppe", () => {
    expect(lieferantGruppen([m({}), m({ namen: [" "] })])).toEqual([null, null]);
  });
});
