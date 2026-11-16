/*
 * Ablage im Dokumentenarchiv: festgeschriebene Rechnungen als Kopie an eine Adresse weitergeben (multipart/form-data),
 * allgemein für jedes Archiv, ohne Sonderlogik je Produkt. Belege aus einem Archiv kommen über die REST-API (Modul api).
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  AblageError,
  archiveTargetSchema,
  archiveTargetSummary,
  deleteArchiveTarget,
  saveArchiveTarget,
  type ArchiveTargetInput,
} from "./einstellungen.ts";
export { archiveTargetOverview, deliverInvoices, deliverSoon, deliveryForInvoice, runDueArchiveDeliveries, type DeliveryStatus } from "./lauf.ts";
