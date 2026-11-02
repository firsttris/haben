/*
 * ELSTER-Infrastruktur: das Gateway für jede Übermittlung (Zugang, Zertifikat und PIN, Sendesperre, Protokoll),
 * das Zertifikat und die Datenschutzhinweise der Finanzverwaltung.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { deactivateCertificate, saveCertificate } from "./certificate.ts";
export {
  ABRUF,
  isSimulated,
  loadActiveCertificate,
  prepareAbruf,
  PRODUKT_VERSION,
  protocolSubmission,
  SENDEN,
  signatur,
  uebermitteln,
  underSendLock,
  zugang,
  type ElsterVorgang,
} from "./elster-gateway.ts";
export { confirmElsterDatenschutz, elsterClient, elsterMode, ericStatus, startEricInstall } from "./elster.ts";
