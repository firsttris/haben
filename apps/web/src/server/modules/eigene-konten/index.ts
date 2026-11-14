/*
 * Eigene Sachkonten (#270, Stufe 1): Aufwandskonten mit eigener Nummer und eigenem Namen, die wie ihre Elternkategorie zählen.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  createOwnAccount,
  deleteOwnAccount,
  documentOwnAccountProblems,
  listOwnAccounts,
  loadOwnAccountNumbers,
  loadOwnAccountParents,
  ownAccountAssignmentProblem,
  ownAccountName,
  ownAccountsOverview,
  ownAccountNames,
  refreshOwnAccountNames,
  OwnAccountError,
  renameOwnAccount,
  setOwnAccountArchived,
  type OwnAccount,
  type OwnAccountInput,
} from "./own-accounts.ts";
