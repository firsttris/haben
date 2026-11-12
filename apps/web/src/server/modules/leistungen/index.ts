/*
 * Abrechenbare Leistungen (#417): Zeiteinträge je Kunde, von Hand oder von außen (Kimai, Toggl) erfasst, später zu einem
 * Rechnungsentwurf abgerechnet.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  createServiceEntry,
  deleteServiceEntry,
  getServiceEntry,
  listEntryCustomers,
  type EntryCustomer,
  isRealDate,
  listServiceEntries,
  serviceEntrySchema,
  ServiceEntryError,
  updateServiceEntry,
  upsertExternalServiceEntry,
  type ExternalServiceEntryInput,
  type ServiceEntry,
  type ServiceEntryFilter,
  type ServiceEntryInput,
} from "./service-entries.ts";
