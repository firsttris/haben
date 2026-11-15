import { describe, expect, it } from "vitest";
import { abziehbarerAnteil, VOLLER_ABZUG } from "./vorsteuerabzug.ts";

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
