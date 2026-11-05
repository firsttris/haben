/*
 * Ausfüllliste für das SV-Meldeportal und die Minijob-Zentrale (docs/lohn-plan.md, PR 6): Beitragsnachweis je Monat und
 * Einzugsstelle, DEÜV-Meldungen je Person und ihre Fristen. Haben übermittelt nichts an die Sozialversicherung; das
 * Portal kennt keinen Datei-Import und verbietet automatisches Befüllen (SV-Meldeportal, Fragen und Antworten 9.7).
 */
export {
  beitragsnachweis,
  beitragsnachweisGegenstand,
  einzugsstelle,
  gerechneteBeitragsgruppen,
  gerechnetePersonengruppe,
  MINIJOB_ZENTRALE,
  schluesselHinweise,
  type Beitragsnachweis,
  type BeitragsnachweisEingabe,
} from "./beitragsnachweis.ts";
export {
  abmeldung,
  anmeldung,
  jahresmeldung,
  meldungen,
  meldungGegenstand,
  sofortmeldung,
  vollerEuro,
  type DeuevMeldung,
  type MeldungArt,
  type MeldungenEingabe,
} from "./meldungen.ts";
export { abmeldungFrist, anmeldungFrist, beitragstermine, istBankarbeitstag, jahresmeldungFrist, type Beitragstermine } from "./termine.ts";
export { betragText, datumText, type Abschnitt, type Einzugsstelle, type Feld, type SvAbrechnung, type SvPerson } from "./typen.ts";
