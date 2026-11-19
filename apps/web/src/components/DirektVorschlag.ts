import { AUFLADUNG, kategorieAnzeige, kategorieArt, type Kontenrahmen } from "@haben/core";
import type { KategorieWahl } from "./KategorieFelder.tsx";

/**
 * Titel der Vorschlagskarte im Zuordnungsdialog (#1369): Eine Aufladung nennt ihre Art, denn die gewählte Kategorie ist
 * nur der Aufwand, zu dem sie gehört — „Ausgabe: Telefon“ verriete nicht, dass der Vorschlag eine Aufladung ist. Jede
 * andere Art mit Kategorie nennt die Kategorie wie bisher, Ausgaben mit der Nummer ihres Kontos („Ausgabe: 4920 · Telefon“,
 * #1438); ohne Kategorie bleibt es bei ihrem Namen aus der Liste (null).
 */
export function vorschlagTitel(direct: { kind: string; kategorie?: KategorieWahl | null }, kontenrahmen: Kontenrahmen): string | null {
  if (direct.kind === AUFLADUNG.kind) return AUFLADUNG.text;
  if (!direct.kategorie) return null;
  return `${kategorieArt(direct.kategorie.kategorie) === "einnahme" ? "Einnahme" : "Ausgabe"}: ${kategorieAnzeige(direct.kategorie, kontenrahmen)}`;
}
