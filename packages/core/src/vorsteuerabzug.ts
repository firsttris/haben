import { roundHalfAwayFromZero, type BasisPoints, type Cents } from "./money.ts";

/** Voller Vorsteuerabzug in Basispunkten */
export const VOLLER_ABZUG: BasisPoints = 10_000;

/**
 * Abziehbarer Anteil der Vorsteuer eines Belegs. Kleinunternehmer ziehen nie ab: Ihre Umsätze sind steuerfrei
 * (§ 19 Abs. 1 Satz 1 UStG) und schließen den Abzug aus (§ 15 Abs. 2 Satz 1 Nr. 1, Abs. 3 Satz 2 UStG), auch gegen
 * eine Angabe am Beleg. Sonst gilt die Angabe am Beleg, ohne sie die Vorgabe der Firmendaten.
 */
export function abziehbarerAnteil(firma: { kleinunternehmer: boolean; ohneVorsteuerabzug: boolean }, amBeleg: BasisPoints | null): BasisPoints {
  if (firma.kleinunternehmer) return 0;
  return amBeleg ?? (firma.ohneVorsteuerabzug ? 0 : VOLLER_ABZUG);
}

/** Gebuchte Bestände ohne Anteil behalten ihren Boolean; heutige Firmendaten gehören nicht in historische Leser. */
export function gespeicherterAnteil(doc: { vorsteuerAnteil?: BasisPoints | null; vorsteuerAbzug?: boolean }, amSatz?: BasisPoints | null): BasisPoints {
  return amSatz ?? doc.vorsteuerAnteil ?? (doc.vorsteuerAbzug === false ? 0 : VOLLER_ABZUG);
}

/** § 15 Abs. 4 UStG (https://www.gesetze-im-internet.de/ustg_1980/__15.html): wirtschaftlich zugeordneter Teil. */
export function abziehbareSteuer(tax: Cents, anteil: BasisPoints): Cents {
  return roundHalfAwayFromZero((tax * anteil) / VOLLER_ABZUG);
}

/** Gemeinsamer Anschluss der bestehenden Boolean-Aufrufer und neuer Beleganteile. */
export function buchungsAnteil(abzug: boolean | BasisPoints, amSatz?: BasisPoints | null): BasisPoints {
  return gespeicherterAnteil({ vorsteuerAnteil: typeof abzug === "number" ? abzug : null, vorsteuerAbzug: abzug !== false }, amSatz);
}

/**
 * Anteile, die ein neuer Entwurf von einem vorhandenen Beleg übernimmt (Beleg duplizieren, #1295); null erbt. Gebucht
 * steht am Beleg der angewandte Anteil, auch wenn er nur aus den Firmendaten kam. Übernommen wird er deshalb nur, wo er
 * von der heutigen `vorgabe` (abziehbarerAnteil ohne Angabe am Beleg) abweicht, etwa ein Teilabzug nach § 15 Abs. 4
 * UStG; sonst folgt der Entwurf den Firmendaten. Ein Satz behält seinen Anteil nur, wo er von dem des Belegs abweicht.
 */
export function uebernommeneAnteile(
  beleg: { gebucht: boolean; vorsteuerAnteil?: BasisPoints | null; vorsteuerAbzug?: boolean },
  saetze: readonly (BasisPoints | null)[],
  vorgabe: BasisPoints,
): { beleg: BasisPoints | null; saetze: (BasisPoints | null)[] } {
  const anteil = beleg.gebucht ? gespeicherterAnteil(beleg) : (beleg.vorsteuerAnteil ?? null);
  return {
    beleg: anteil === vorgabe ? null : anteil,
    saetze: saetze.map((satz) => (satz === null || satz === anteil ? null : satz)),
  };
}
