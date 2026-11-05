/*
 * SV-Meldungen (docs/lohn-plan.md, PR 6): Ausfüllliste für das SV-Meldeportal und die Minijob-Zentrale, Vermerke „im
 * Portal abgegeben“ mit Protokoll und die Fristen dazu. Haben übermittelt nichts an die Sozialversicherung. Liest den
 * Lohn über dessen index.ts, schreibt nur die Tabelle sv_portal_filings.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { ausfuellliste, svFristen, type SvFrist } from "./seite.ts";
export { loadProtokoll, ruecknahmeSchema, SvMeldungError, vermerken, vermerkSchema, zuruecknehmen, type Protokoll } from "./vermerke.ts";
