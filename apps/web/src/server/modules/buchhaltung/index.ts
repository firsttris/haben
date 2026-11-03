/*
 * Buchhaltung: Hauptbuch (ledger.post ist der einzige Schreiber des Journals), Kontennamen, Anlagenverzeichnis mit AfA
 * Pauschalen ohne Beleg und manuelle Buchungen (GmbH, UG).
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  assetInputSchema,
  assetUpdateSchema,
  bookDepreciation,
  canBookYear,
  createAsset,
  deleteAsset,
  depreciationForEuer,
  getAsset,
  listAssets,
  pendingDepreciation,
  privateUseForMonth,
  updateAsset,
  withdrawalsForEuer,
} from "./assets.ts";
export { accountName, knownAccounts, loadJournal, transitBalance } from "./journal.ts";
export { kontenblatt, ledgerPeriodSchema, ledgerRange, openBooks, post, saldenliste } from "./ledger.ts";
export { createManualEntry, ManualEntryError, manualEntrySchema, reverseManualEntry, type ManualEntryInput } from "./manual.ts";
export { createPauschale, listPauschalen, pauschaleInputSchema, reversePauschale } from "./pauschalen.ts";
