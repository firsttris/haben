import { describe, expect, it } from "vitest";
import { abziehbarerAnteil, uebernommeneAnteile, VOLLER_ABZUG } from "./vorsteuerabzug.ts";

describe("abziehbarerAnteil", () => {
  const regulaer = { kleinunternehmer: false, ohneVorsteuerabzug: false };
  const ohneAbzug = { kleinunternehmer: false, ohneVorsteuerabzug: true };
  const ku = { kleinunternehmer: true, ohneVorsteuerabzug: false };

  it.each([
    { name: "reguläre Firma ohne Angabe: voll", firma: regulaer, amBeleg: null, erwartet: VOLLER_ABZUG },
    { name: "Firma ohne Vorsteuerabzug ohne Angabe: keiner", firma: ohneAbzug, amBeleg: null, erwartet: 0 },
    { name: "Firma ohne Vorsteuerabzug, am Beleg voll gewählt", firma: ohneAbzug, amBeleg: VOLLER_ABZUG, erwartet: VOLLER_ABZUG },
    { name: "reguläre Firma, am Beleg ohne gewählt", firma: regulaer, amBeleg: 0, erwartet: 0 },
    { name: "Kleinunternehmer zieht nie ab, auch gegen die Angabe am Beleg", firma: ku, amBeleg: VOLLER_ABZUG, erwartet: 0 },
  ])("$name", ({ firma, amBeleg, erwartet }) => {
    expect(abziehbarerAnteil(firma, amBeleg)).toBe(erwartet);
  });
});

describe("uebernommeneAnteile (Beleg duplizieren, #1295)", () => {
  const halb = 5_000;
  it.each([
    {
      name: "gebucht mit der Firmenvorgabe: das Duplikat erbt",
      beleg: { gebucht: true, vorsteuerAnteil: VOLLER_ABZUG },
      saetze: [VOLLER_ABZUG],
      vorgabe: VOLLER_ABZUG,
      erwartet: { beleg: null, saetze: [null] },
    },
    {
      name: "gebucht mit Teilabzug: bleibt am Beleg, die Sätze erben ihn",
      beleg: { gebucht: true, vorsteuerAnteil: halb },
      saetze: [halb, halb],
      vorgabe: VOLLER_ABZUG,
      erwartet: { beleg: halb, saetze: [null, null] },
    },
    {
      name: "gebucht, nur ein Satz mit Teilabzug",
      beleg: { gebucht: true, vorsteuerAnteil: VOLLER_ABZUG },
      saetze: [VOLLER_ABZUG, halb],
      vorgabe: VOLLER_ABZUG,
      erwartet: { beleg: null, saetze: [null, halb] },
    },
    {
      name: "Entwurf ohne Angabe, ein Satz gewählt",
      beleg: { gebucht: false, vorsteuerAnteil: null },
      saetze: [null, halb],
      vorgabe: VOLLER_ABZUG,
      erwartet: { beleg: null, saetze: [null, halb] },
    },
    {
      name: "heute Kleinunternehmer, gebucht ohne Abzug: erbt",
      beleg: { gebucht: true, vorsteuerAnteil: 0 },
      saetze: [0],
      vorgabe: 0,
      erwartet: { beleg: null, saetze: [null] },
    },
    {
      // Am gebuchten Beleg nicht von einer eigenen Angabe 0 % zu unterscheiden; der Hinweis am Entwurf lässt ihn prüfen
      name: "als Kleinunternehmer gebucht, heute regelbesteuert: bleibt ohne Abzug",
      beleg: { gebucht: true, vorsteuerAnteil: 0, vorsteuerAbzug: false },
      saetze: [0],
      vorgabe: VOLLER_ABZUG,
      erwartet: { beleg: 0, saetze: [null] },
    },
    {
      // Umgekehrt zum Wechsel aus der Kleinunternehmerregelung: voll gebucht, heute „ohne Vorsteuerabzug“ in den Firmendaten.
      // Der volle Anteil kommt als eigene Angabe mit und geht der Vorgabe vor; der Hinweis am Entwurf lässt ihn prüfen
      name: "voll gebucht, heute ohne Vorsteuerabzug: bleibt voll",
      beleg: { gebucht: true, vorsteuerAnteil: VOLLER_ABZUG },
      saetze: [VOLLER_ABZUG],
      vorgabe: 0,
      erwartet: { beleg: VOLLER_ABZUG, saetze: [null] },
    },
    {
      name: "ältere Buchung ohne Anteil und ohne Abzug: bleibt ohne Abzug",
      beleg: { gebucht: true, vorsteuerAnteil: null, vorsteuerAbzug: false },
      saetze: [null],
      vorgabe: VOLLER_ABZUG,
      erwartet: { beleg: 0, saetze: [null] },
    },
  ])("$name", ({ beleg, saetze, vorgabe, erwartet }) => {
    expect(uebernommeneAnteile(beleg, saetze, vorgabe)).toEqual(erwartet);
  });
});
