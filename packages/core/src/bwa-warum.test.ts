import { describe, expect, it } from "vitest";
import { type WarumPosten, zerlegeAbweichung } from "./bwa-warum.ts";
import { bwaZeitraum, vorjahreszeitraum } from "./bwa-zeitraum.ts";

/*
 * „Warum?“ je Zeile der BWA (#1380, Teil 2): die Abweichung zum Vergleichszeitraum, zerlegt nach Kontakt. Beispiel aus dem
 * Issue mit erfundenen Beträgen: Software 2.400 € statt 900 €.
 */

const ZEITRAUM = { von: "2027-01-01", bis: "2027-05-31" };
const VERGLEICH = vorjahreszeitraum(ZEITRAUM);

const p = (datum: string, betrag: number, kontakt: Partial<WarumPosten["kontakt"]> = {}): WarumPosten => ({
  datum,
  betrag,
  kontakt: { id: null, name: "", ...kontakt },
});
const cloudwerk = { id: "k1", name: "Cloudwerk GmbH" };
const netzwerk = { id: "k2", name: "Netzwerk AG" };
const altanbieter = { id: "k3", name: "Altanbieter KG" };

describe("Abweichung einer BWA-Zeile nach Kontakt", () => {
  it("zerlegt die Abweichung in neu, gestiegen, gesunken und weggefallen; die Teile ergeben sie genau", () => {
    const posten = [
      // Vorjahr: 900 €
      p("2026-01-10", 30_000, cloudwerk),
      p("2026-02-10", 45_000, altanbieter),
      p("2026-03-10", 15_000, netzwerk),
      // Jahr: 2.400 €
      p("2027-01-10", 45_000, cloudwerk),
      p("2027-02-10", 45_000, cloudwerk),
      p("2027-03-10", 10_000, netzwerk),
      p("2027-04-10", 140_000, { id: "k4", name: "Neuland GmbH" }),
    ];
    const w = zerlegeAbweichung(posten, ZEITRAUM, VERGLEICH);
    expect(w.betrag).toBe(240_000);
    expect(w.vergleich).toBe(90_000);
    expect(w.abweichung).toBe(150_000);
    expect(w.teile.map((t) => [t.name, t.art, t.differenz])).toEqual([
      ["Neuland GmbH", "neu", 140_000],
      ["Cloudwerk GmbH", "gestiegen", 60_000],
      ["Altanbieter KG", "weggefallen", -45_000],
      ["Netzwerk AG", "gesunken", -5_000],
    ]);
    expect(w.teile.reduce((s, t) => s + t.differenz, 0)).toBe(w.abweichung);
  });

  it("zählt Vorgänge und den Betrag je Vorgang, damit eine Preiserhöhung von mehr Vorgängen zu unterscheiden ist", () => {
    const w = zerlegeAbweichung(
      [p("2026-01-05", 2_000, cloudwerk), p("2026-02-05", 2_000, cloudwerk), p("2027-01-05", 4_500, cloudwerk), p("2027-02-05", 4_500, cloudwerk)],
      ZEITRAUM,
      VERGLEICH,
    );
    expect(w.teile).toEqual([expect.objectContaining({ art: "gestiegen", anzahl: 2, anzahlVergleich: 2, jeVorgang: 4_500, jeVorgangVergleich: 2_000 })]);
  });

  it("lässt Kontakte ohne Änderung weg und nennt nur ihre Zahl", () => {
    const w = zerlegeAbweichung([p("2026-03-01", 10_000, netzwerk), p("2027-03-01", 10_000, netzwerk), p("2027-03-02", 500, cloudwerk)], ZEITRAUM, VERGLEICH);
    expect(w.teile.map((t) => t.name)).toEqual(["Cloudwerk GmbH"]);
    expect(w.unveraendert).toBe(1);
  });

  it("fasst Posten ohne Kontakt nach dem Namen am Beleg zusammen, ganz ohne Namen als „Ohne Kontakt“", () => {
    const w = zerlegeAbweichung(
      [
        // Gleicher Name in anderer Schreibweise ist derselbe Lieferant; es gilt die jüngste Schreibweise
        p("2027-01-01", 2_000, { name: " tankstelle süd " }),
        p("2027-02-01", 1_000, { name: "Tankstelle Süd" }),
        p("2027-02-02", 700),
        p("2027-02-03", 300),
      ],
      ZEITRAUM,
      VERGLEICH,
    );
    expect(w.teile.map((t) => [t.name, t.kontaktId, t.betrag])).toEqual([
      ["Tankstelle Süd", null, 3_000],
      ["Ohne Kontakt", null, 1_000],
    ]);
  });

  it("derselbe Kontakt bleibt einer, auch wenn sich sein Name geändert hat", () => {
    const w = zerlegeAbweichung([p("2026-01-01", 1_000, { id: "k1", name: "Cloudwerk" }), p("2027-01-01", 3_000, cloudwerk)], ZEITRAUM, VERGLEICH);
    expect(w.teile).toEqual([expect.objectContaining({ kontaktId: "k1", name: "Cloudwerk GmbH", art: "gestiegen", differenz: 2_000 })]);
  });

  it("fasst denselben Lieferanten mit und ohne Kontakt zusammen (#1514): Name und Link vom Kontakt, keine Differenz", () => {
    // Beispiel aus dem Issue: Vorjahr ohne Kontakt (übernommen), dieses Jahr mit Kontakt
    const w = zerlegeAbweichung(
      [
        p("2026-02-01", 48_000, { name: "Muster Hosting GmbH", ustIds: ["DE999999999"] }),
        p("2027-02-01", 48_000, { id: "k9", name: "Muster Hosting", ustIds: ["DE 999999999"] }),
        p("2027-03-01", 1_000, { name: "Papierladen" }),
      ],
      ZEITRAUM,
      VERGLEICH,
    );
    expect(w.teile.map((t) => [t.kontaktId, t.name, t.art, t.differenz])).toEqual([[null, "Papierladen", "neu", 1_000]]);
    expect(w.unveraendert).toBe(1);
  });

  it("jeder Teil hat einen eigenen Schlüssel, auch zwei Teile gleichen Namens ohne Kontakt", () => {
    // Zwei Kontakte mit derselben USt-IdNr. (etwa nach einem Import): Der Beleg mit ihr passt zu beiden, der ohne zu keinem
    const w = zerlegeAbweichung(
      [
        p("2027-01-01", 100, { id: "k1", name: "Bar Nord", ustIds: ["DE9"] }),
        p("2027-01-02", 200, { id: "k2", name: "Bar Süd", ustIds: ["DE9"] }),
        p("2026-02-01", 500, { name: "Bar AG", ustIds: ["DE9"] }),
        p("2026-03-01", 700, { name: "Bar AG" }),
        // Ohne Namen heißen beide „Ohne Kontakt“
        p("2027-02-01", 30, { ustIds: ["DE8"] }),
        p("2027-02-02", 40),
      ],
      ZEITRAUM,
      VERGLEICH,
    );
    expect(new Set(w.teile.map((t) => t.schluessel)).size).toBe(w.teile.length);
    expect(w.teile.reduce((s, t) => s + t.differenz, 0)).toBe(w.abweichung);
  });

  it("die Gruppe heißt wie ihr Kontakt, auch wenn ein Beleg ohne Kontakt jünger ist", () => {
    const w = zerlegeAbweichung(
      [p("2027-01-01", 1_000, { id: "k9", name: "Muster Hosting", namen: ["MH GmbH"] }), p("2027-04-01", 2_000, { name: "mh gmbh" })],
      ZEITRAUM,
      VERGLEICH,
    );
    expect(w.teile).toEqual([expect.objectContaining({ kontaktId: "k9", name: "Muster Hosting", betrag: 3_000, anzahl: 2 })]);
  });

  it("über der Höchstzahl laufen die kleineren Teile in „übrige“ zusammen, die Summe bleibt", () => {
    const posten = Array.from({ length: 8 }, (_, i) => p("2027-03-01", (i + 1) * 1_000, { id: `k${i}`, name: `Lieferant ${i}` }));
    const w = zerlegeAbweichung(posten, ZEITRAUM, VERGLEICH, { hoechstens: 3 });
    expect(w.teile.map((t) => t.name)).toEqual(["Lieferant 7", "Lieferant 6", "Lieferant 5"]);
    expect(w.uebrige).toEqual({ anzahlKontakte: 5, differenz: 15_000 });
    expect(w.teile.reduce((s, t) => s + t.differenz, 0) + w.uebrige!.differenz).toBe(w.abweichung);
  });

  it("zählt nur Posten in Zeitraum oder Vergleich, Grenzen eingeschlossen", () => {
    const w = zerlegeAbweichung(
      [
        p("2027-01-01", 100, cloudwerk),
        p("2027-05-31", 200, cloudwerk),
        p("2027-06-01", 400, cloudwerk),
        p("2026-05-31", 800, cloudwerk),
        p("2026-06-01", 1_600, cloudwerk),
      ],
      ZEITRAUM,
      VERGLEICH,
    );
    expect([w.betrag, w.vergleich]).toEqual([300, 800]);
  });

  it("überschneiden sich Zeitraum und Vergleich, zählt ein Posten aus der Überschneidung in beiden, wie in der BWA", () => {
    // Frei 2025–2026 gegen das Vorjahr 2024–2025: das Jahr 2025 liegt in beiden
    const zeitraum = { von: "2025-01-01", bis: "2026-12-31" };
    const w = zerlegeAbweichung(
      [p("2024-06-01", 10_000, cloudwerk), p("2025-06-01", 20_000, cloudwerk), p("2026-06-01", 30_000, cloudwerk)],
      zeitraum,
      vorjahreszeitraum(zeitraum),
    );
    expect([w.betrag, w.vergleich, w.abweichung]).toEqual([50_000, 30_000, 20_000]);
    expect(w.teile).toEqual([expect.objectContaining({ differenz: 20_000, anzahl: 2, anzahlVergleich: 2 })]);
  });

  it("die Art folgt den Vorgängen: gleichen sie sich aus, ist der Kontakt nicht neu bzw. weggefallen, sondern gestiegen bzw. gesunken", () => {
    const w = zerlegeAbweichung(
      [
        // Vergleich: Zahlung und Erstattung gleichen sich aus, im Zeitraum wieder ein Vorgang
        p("2026-02-01", 5_000, cloudwerk),
        p("2026-03-01", -5_000, cloudwerk),
        p("2027-02-01", 3_000, cloudwerk),
        // Umgekehrt: im Vergleich ein Vorgang, im Zeitraum gleichen sie sich aus
        p("2026-02-01", 2_000, netzwerk),
        p("2027-02-01", 4_000, netzwerk),
        p("2027-03-01", -4_000, netzwerk),
      ],
      ZEITRAUM,
      VERGLEICH,
    );
    expect(w.teile.map((t) => [t.name, t.art, t.differenz])).toEqual([
      ["Cloudwerk GmbH", "gestiegen", 3_000],
      ["Netzwerk AG", "gesunken", -2_000],
    ]);
  });

  it("Erlöse: ein Kunde mit weniger Umsatz ist „gesunken“, die Abweichung negativ", () => {
    const w = zerlegeAbweichung([p("2026-04-01", 500_000, cloudwerk), p("2027-04-01", 410_000, cloudwerk)], ZEITRAUM, VERGLEICH);
    expect(w.abweichung).toBe(-90_000);
    expect(w.teile).toEqual([expect.objectContaining({ art: "gesunken", differenz: -90_000 })]);
  });

  it("gleich große Teile stehen nach Namen, damit die Reihenfolge fest ist", () => {
    const w = zerlegeAbweichung([p("2027-02-01", 1_000, { id: "b", name: "Beta" }), p("2027-02-01", 1_000, { id: "a", name: "Alpha" })], ZEITRAUM, VERGLEICH);
    expect(w.teile.map((t) => t.name)).toEqual(["Alpha", "Beta"]);
  });

  it("bei vielen Posten ergeben Teile und „übrige“ immer genau die Abweichung, für jede Höchstzahl", () => {
    // Fester Pseudozufall (LCG), damit der Test wiederholbar bleibt
    let s = 42;
    const zufall = (n: number) => {
      s = (s * 1_103_515_245 + 12_345) % 2 ** 31;
      return s % n;
    };
    const posten = Array.from({ length: 400 }, () => {
      const k = zufall(25);
      return p(
        `${2026 + zufall(2)}-0${1 + zufall(9)}-1${zufall(10)}`,
        zufall(50_000) - 5_000,
        k < 20 ? { id: `k${k}`, name: `Kontakt ${k}` } : { name: k < 23 ? `Beleg ${k}` : "" },
      );
    });
    for (const hoechstens of [1, 3, 10, Infinity]) {
      const w = zerlegeAbweichung(posten, ZEITRAUM, VERGLEICH, { hoechstens });
      const summe = w.teile.reduce((sum, t) => sum + t.differenz, 0) + (w.uebrige?.differenz ?? 0);
      expect(summe, String(hoechstens)).toBe(w.abweichung);
      expect(w.teile.length).toBeLessThanOrEqual(hoechstens);
    }
  });

  it("ohne Posten keine Teile", () => {
    expect(zerlegeAbweichung([], bwaZeitraum("monat", 2027, 3), bwaZeitraum("monat", 2026, 3))).toEqual({
      betrag: 0,
      vergleich: 0,
      abweichung: 0,
      teile: [],
      unveraendert: 0,
      uebrige: null,
    });
  });
});
