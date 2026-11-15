/*
 * Umstellung von Voranmeldung und EÜR auf das Journal als einzige Quelle (#1116): die Prüfung beim Update und, nur dafür,
 * die eingefrorene Rechnung aus den Nebenbüchern. Das Modul fällt weg, sobald ein Release das Update über die Version
 * voraussetzt, die es eingeführt hat.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { UMSTELLUNG_ACTOR, umstellungBefunde, umstellungPruefen, umstellungStand, type UmstellungErgebnis, type UmstellungStand } from "./pruefung.ts";
