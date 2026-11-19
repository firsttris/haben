/*
 * PayPal: Abruf der Transaction Search über die API ins Konto des Zahlungsdienstleisters (#1512).
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  deletePayPalConnection,
  loadPayPalConnection,
  PayPalError,
  paypalClientFor,
  paypalSettingsSchema,
  paypalSummary,
  savePayPalConnection,
  setPayPalClientFactory,
} from "./connections.ts";
export { importPayPal, type PayPalImportOptions, type PayPalImportResult } from "./import.ts";
export { PAYPAL_SYNC_ACTOR, type PayPalSyncResult, runDuePayPalSyncs, syncPayPal } from "./sync.ts";
