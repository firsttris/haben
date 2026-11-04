/*
 * Buchhaltung: Hauptbuch (ledger.post ist der einzige Schreiber des Journals), Kontennamen, Anlagenverzeichnis mit AfA
 * Pauschalen ohne Beleg, manuelle Buchungen, Jahresabschluss und Bilanz zur Hinterlegung (GmbH, UG).
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
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
export { HinterlegungError, hinterlegungAngabenSchema, hinterlegungPdf, hinterlegungStand, type HinterlegungStand } from "./hinterlegung.ts";
export { accountName, knownAccounts, loadJournal, transitBalance } from "./journal.ts";
export { kontenblatt, ledgerPeriodSchema, ledgerRange, openBooks, post, saldenliste } from "./ledger.ts";
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
export { createPauschale, listPauschalen, pauschaleInputSchema, reversePauschale } from "./pauschalen.ts";
