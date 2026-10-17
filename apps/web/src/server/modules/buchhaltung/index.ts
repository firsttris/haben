/*
 * Buchhaltung: Hauptbuch (ledger.post ist der einzige Schreiber des Journals), Kontennamen, Anlagenverzeichnis mit AfA
 * und Pauschalen ohne Beleg.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Lint-Regel haben/modulgrenzen, eslint/modulgrenzen.js).
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
export { accountName, loadJournal } from "./journal.ts";
export { kontenblatt, ledgerPeriodSchema, ledgerRange, openBooks, post, saldenliste } from "./ledger.ts";
export { createPauschale, listPauschalen, pauschaleInputSchema, reversePauschale } from "./pauschalen.ts";
