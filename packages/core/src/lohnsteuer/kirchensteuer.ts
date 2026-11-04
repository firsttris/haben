import type { BasisPoints, Cents } from "../money.ts";
import type { Bundesland } from "../steuernummer.ts";

/**
 * Kirchenlohnsteuer aus der Bemessungsgrundlage BK des PAP. Der PAP rechnet nur die Bemessungsgrundlage
 * (Lohnsteuer mit Freibeträgen für Kinder, § 51a Abs. 2a EStG); den Satz legen die Kirchensteuergesetze der
 * Länder fest: 8 % in Baden-Württemberg und Bayern, 9 % in den übrigen Ländern.
 */

/** Kirchensteuersatz in Basispunkten: 800 in Baden-Württemberg und Bayern, sonst 900 */
export function kirchensteuerSatzBasispunkte(bundesland: Bundesland | null): BasisPoints {
  return bundesland === "BW" || bundesland === "BY" ? 800 : 900;
}

/** Kirchenlohnsteuer für den Lohnzahlungszeitraum in Cent; Bruchteile eines Cents bleiben außer Ansatz */
export function lohnkirchensteuer(BK: Cents, bundesland: Bundesland): Cents {
  if (!Number.isSafeInteger(BK) || BK < 0) throw new RangeError(`BK muss ein ganzer, nicht negativer Betrag in Cent sein: ${BK}`);
  return Math.floor((BK * kirchensteuerSatzBasispunkte(bundesland)) / 10_000);
}
