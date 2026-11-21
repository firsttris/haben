import { describe, expect, it } from "vitest";
import { horizontEnde, imHorizont, liquiditaetsVorschau, postenAus, vorschauZeitraeume, wirkung, type LiquiditaetsPosten } from "./liquiditaet.ts";

const posten = (datum: string, betrag: number, richtung: "ein" | "aus", rest: Partial<LiquiditaetsPosten> = {}): LiquiditaetsPosten => ({
  datum,
  betrag,
  richtung,
  text: `${richtung} ${datum}`,
  quelle: { art: "rechnung", id: datum },
  sicherheit: "erwartet",
  ...rest,
});

// Freitag, 20.11.2026
const HEUTE = "2026-11-20";

describe("Horizont und Zeiträume", () => {
  it("endet nach 4 und 13 Wochen bzw. 6 und 12 Monaten, einschließlich des letzten Tags", () => {
    expect(horizontEnde(HEUTE, "4w")).toBe("2026-12-17");
    expect(horizontEnde(HEUTE, "13w")).toBe("2027-02-18");
    expect(horizontEnde(HEUTE, "6m")).toBe("2027-05-19");
    expect(horizontEnde(HEUTE, "12m")).toBe("2027-11-19");
    // Vom 31. aus: Monatsende statt eines Tags, den es nicht gibt
    expect(horizontEnde("2026-08-31", "6m")).toBe("2027-02-27");
  });

  it("teilt in Wochen von Montag bis Sonntag, die erste ab heute, die letzte bis zum Ende", () => {
    expect(vorschauZeitraeume(HEUTE, "4w")).toEqual([
      { von: "2026-11-20", bis: "2026-11-22" },
      { von: "2026-11-23", bis: "2026-11-29" },
      { von: "2026-11-30", bis: "2026-12-06" },
      { von: "2026-12-07", bis: "2026-12-13" },
      { von: "2026-12-14", bis: "2026-12-17" },
    ]);
    expect(vorschauZeitraeume("2026-11-23", "13w")).toHaveLength(13);
  });

  it("teilt in Kalendermonate, über den Jahreswechsel", () => {
    expect(vorschauZeitraeume(HEUTE, "6m")).toEqual([
      { von: "2026-11-20", bis: "2026-11-30" },
      { von: "2026-12-01", bis: "2026-12-31" },
      { von: "2027-01-01", bis: "2027-01-31" },
      { von: "2027-02-01", bis: "2027-02-28" },
      { von: "2027-03-01", bis: "2027-03-31" },
      { von: "2027-04-01", bis: "2027-04-30" },
      { von: "2027-05-01", bis: "2027-05-19" },
    ]);
    expect(vorschauZeitraeume("2027-01-01", "12m")).toHaveLength(12);
  });
});

describe("Posten", () => {
  it("rechnet Eingänge positiv und Ausgänge negativ; aus einem Betrag mit Vorzeichen wird die Richtung", () => {
    expect(wirkung(posten(HEUTE, 500, "ein"))).toBe(500);
    expect(wirkung(posten(HEUTE, 500, "aus"))).toBe(-500);
    const rest = { datum: HEUTE, text: "x", quelle: { art: "umsatzsteuer" as const, id: "2026-10" }, sicherheit: "geschaetzt" as const };
    expect(postenAus(-300, rest)).toEqual([{ ...rest, betrag: 300, richtung: "aus" }]);
    expect(postenAus(300, rest)[0]?.richtung).toBe("ein");
    expect(postenAus(0, rest)).toEqual([]);
  });

  it("rückt Überfälliges auf heute, lässt Späteres als den Horizont weg und sortiert Eingänge vor Ausgänge", () => {
    const liste = imHorizont(
      [posten("2026-12-01", 1, "aus"), posten("2026-11-02", 2, "aus"), posten("2026-12-01", 3, "ein"), posten("2027-01-01", 4, "ein")],
      HEUTE,
      "2026-12-17",
    );
    expect(liste.map((p) => [p.datum, p.betrag, p.ueberfaellig ?? false])).toEqual([
      [HEUTE, 2, true],
      ["2026-12-01", 3, false],
      ["2026-12-01", 1, false],
    ]);
  });
});

describe("Vorschau", () => {
  it("für morgen: Kontostand plus/minus der heute und morgen fälligen Posten", () => {
    const vorschau = liquiditaetsVorschau({
      heute: HEUTE,
      horizont: "4w",
      start: 1_200_000,
      posten: [posten(HEUTE, 100_000, "aus"), posten("2026-11-21", 250_000, "ein"), posten("2026-11-22", 50_000, "aus")],
    });
    expect(vorschau.verlauf).toEqual([
      { datum: HEUTE, stand: 1_100_000 },
      { datum: "2026-11-21", stand: 1_350_000 },
      { datum: "2026-11-22", stand: 1_300_000 },
    ]);
  });

  it("summiert je Woche, trägt den Stand weiter und findet den Tiefpunkt", () => {
    const vorschau = liquiditaetsVorschau({
      heute: HEUTE,
      horizont: "4w",
      start: 1_000_000,
      posten: [
        posten("2026-11-23", 300_000, "aus"),
        posten("2026-11-25", 900_000, "aus"),
        posten("2026-11-27", 400_000, "ein"),
        posten("2026-12-10", 50_000, "ein"),
        // Nach dem Horizont: zählt nicht
        posten("2026-12-18", 5_000_000, "aus"),
      ],
    });
    const [erste, zweite, dritte, vierte] = vorschau.zeitraeume;
    expect(erste).toMatchObject({ anfang: 1_000_000, eingaenge: 0, ausgaenge: 0, ende: 1_000_000, tiefpunkt: { datum: HEUTE, stand: 1_000_000 } });
    expect(zweite).toMatchObject({
      anfang: 1_000_000,
      eingaenge: 400_000,
      ausgaenge: 1_200_000,
      ende: 200_000,
      tiefpunkt: { datum: "2026-11-25", stand: -200_000 },
    });
    expect(zweite?.posten).toHaveLength(3);
    expect(dritte).toMatchObject({ anfang: 200_000, ende: 200_000 });
    expect(vierte).toMatchObject({ anfang: 200_000, eingaenge: 50_000, ende: 250_000 });
    expect(vorschau.tiefpunkt).toEqual({ datum: "2026-11-25", stand: -200_000 });
    expect(vorschau).toMatchObject({ eingaenge: 450_000, ausgaenge: 1_200_000, ende: 250_000, bis: "2026-12-17" });
  });

  it("ohne Posten ist der Tiefpunkt der Stand heute", () => {
    const vorschau = liquiditaetsVorschau({ heute: HEUTE, horizont: "12m", start: 500, posten: [] });
    expect(vorschau.tiefpunkt).toEqual({ datum: HEUTE, stand: 500 });
    expect(vorschau.zeitraeume).toHaveLength(13);
    expect(vorschau.ende).toBe(500);
  });

  it("je Monat; Sicherheit und privat bleiben am Posten", () => {
    const est = posten("2026-12-10", 120_000, "aus", { sicherheit: "erwartet", privat: true, quelle: { art: "vorauszahlung", id: "x" } });
    const ust = posten("2027-01-11", 31_000, "aus", { sicherheit: "geschaetzt", quelle: { art: "umsatzsteuer", id: "2026-11" } });
    const vorschau = liquiditaetsVorschau({ heute: HEUTE, horizont: "6m", start: 0, posten: [ust, est] });
    expect(vorschau.zeitraeume[1]?.posten).toEqual([est]);
    expect(vorschau.zeitraeume[2]?.posten).toEqual([ust]);
    expect(vorschau.zeitraeume[2]?.ende).toBe(-151_000);
  });
});
