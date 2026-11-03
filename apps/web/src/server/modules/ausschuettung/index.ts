/*
 * Gewinnausschüttungen einer GmbH oder UG: Gewinnverwendungsbeschluss buchen, Kapitalertragsteuer, Soli und
 * Kirchensteuer je Gesellschafter einbehalten, Kapitalertragsteuer-Anmeldung über ELSTER.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  AusschuettungError,
  ausschuettungSchema,
  ausschuettungVorschlag,
  createAusschuettung,
  dividendsOfYear,
  kapestAnmeldungen,
  kapestSubmissions,
  loadKapEStProtocol,
  reverseAusschuettung,
  submitKapESt,
  type AusschuettungInput,
} from "./ausschuettung.ts";
