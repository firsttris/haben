/*
 * Buchhaltung: Hauptbuch (ledger.post ist der einzige Schreiber des Journals), Kontennamen, Anlagenverzeichnis mit AfA
 * Pauschalen ohne Beleg, manuelle Buchungen, Jahresabschluss (GmbH, UG).
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { reverseLines, reverseLinesIn } from "./gegenbuchung.ts";
export { AbschlussError, closeYear, jahresabschluss, reportIssues as abschlussHinweise, type AbschlussHinweis } from "./abschluss.ts";
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
export { assetImportStichtagProblem, insertImportedAssets, planAssetImport } from "./asset-import.ts";
export { accountName, knownAccounts, loadJournal, transitBalance } from "./journal.ts";
export {
  searchAccounts,
  searchAssets,
  searchBookings,
  searchPauschalen,
  type AccountHit,
  type AssetHit,
  type BookingHit,
  type PauschaleHit,
} from "./search.ts";
export { kontenblatt, ledgerPeriodSchema, ledgerRange, openBooks, post, saldenliste, uebernahmen } from "./ledger.ts";
export {
  activeOpenings,
  firstEntryBefore,
  lockOpenings,
  openingAfter,
  openingCash,
  stapelOpeningCovering,
  takeoverBalances,
  type Eroeffnung,
} from "./eroeffnung.ts";
export {
  createManualEntry,
  ManualEntryError,
  manualEntrySchema,
  reverseManualEntry,
  type CashReversalCheck,
  type ManualEntryInput,
} from "./manual.ts";
export { periodReported, vatPeriodsOf } from "./gemeldet.ts";
export { createPauschale, listPauschalen, pauschaleInputSchema, reversePauschale } from "./pauschalen.ts";
