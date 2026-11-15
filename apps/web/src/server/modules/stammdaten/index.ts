/*
 * Stammdaten: Firmendaten (mit Versteuerung und Kleinunternehmer je Jahr), Kunden mit SEPA-Lastschriftmandaten, Artikel, Textbausteine, Briefkopf (Logo, Akzentfarbe), Zeichen in der Navigation, persönliche
 * Angaben und Umsatzsteuer-Umrechnungskurse. Gespeichert werden die Firmendaten über auswertungen/settings-guard.ts, das
 * Kontenrahmen, Versteuerung und Kleinunternehmer gegen Buchungen und offene Rechnungen sperrt.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { insertImportedArticles, insertImportedContacts, planArticleImport, planContactImport } from "./csv-import.ts";
export { applyDatevContactImport, planDatevContactImport, type DatevContactImportPlan } from "./datev-kontakte-import.ts";
export { articleInputSchema, createArticle, listArticles, setArticleArchived, updateArticle } from "./articles.ts";
export { searchStammdaten, type ArticleHit, type TextBlockHit } from "./search-catalog.ts";
export {
  companyIssues,
  companySchema,
  editorContext,
  kleinunternehmerForMonth,
  kleinunternehmerForYear,
  kleinunternehmerHistory,
  kleinunternehmerStand,
  lastDayOfMonth,
  letterIssues,
  loadCompany,
  sellerIssues,
  setArchiveSearch,
  versteuerungForYear,
  journalAbJahr,
  setJournalAb,
  type Company,
  type CompanyInput,
} from "./company.ts";
export {
  contactRoleProblem,
  contactSchema,
  createContact,
  findContactsByUstId,
  getContact,
  listContactChoices,
  listContacts,
  searchContacts,
  setContactArchived,
  setContactIbanIfEmpty,
  updateContact,
  type Contact,
  type ContactChoice,
  type ContactHit,
  type ContactInput,
  type ContactRole,
  type UstIdMatch,
} from "./contacts.ts";
export {
  deleteExchangeRate,
  ExchangeRateFetchError,
  exchangeRateSchema,
  listExchangeRates,
  rateForMonth,
  NO_RATE,
  refreshExchangeRates,
  resolveExchangeRate,
  type RateFields,
  runDueExchangeRates,
  storeExchangeRates,
  type ExchangeRate,
} from "./exchange-rates.ts";
export { AccentColorError, loadDesign, loadLetterhead, saveAccentColor, saveDesign } from "./letterhead.ts";
export { loadLogo, logoInfo, MAX_LOGO_BYTES, removeLogo, saveLogo } from "./logo.ts";
export {
  loadNavMark,
  NavMarkError,
  navMarkSchema,
  readNavMark,
  readNavMarkLogo,
  saveNavMark,
  type NavMarkInput,
  type NavMarkSetting,
  type NavMarkStand,
} from "./nav-mark.ts";
export { backgroundInfo, loadBackground, MAX_BACKGROUND_BYTES, removeBackground, saveBackground } from "./background.ts";
export { customLayoutJob, dataForVersion, layoutRenderer } from "./layout-renderer.ts";
export { rendererFor } from "./layout-pakete.ts";
export { typstMeldung } from "./layout-pruefung.ts";
export {
  artFor,
  assignLayout,
  createLayout,
  customLayoutFor,
  deleteLayout,
  LayoutError,
  LayoutRenderError,
  MAX_LAYOUT_BYTES,
  reloadPackages,
  removeOrphanWorkspaces,
  renameLayout,
  replaceLayoutSource,
  withCustomLayout,
} from "./layouts.ts";
export { layoutOverview, layoutSource, listLayouts } from "./layout-liste.ts";
export { CustomerNumberError, customerNumbering, saveCustomerNumbering } from "./customer-numbers.ts";
export { personenkontoKey, vergibPersonenkonten } from "./personenkonten-vergabe.ts";
export { PlanTemplateError, planTemplatesProblem, savePlanTemplates } from "./plan-templates.ts";
export {
  addMandateFile,
  createMandate,
  findMandate,
  lastCollections,
  listMandates,
  MandateError,
  mandateFile,
  mandateInputSchema,
  mandateOptions,
  revocationInputSchema,
  revokeMandate,
  validMandateOn,
  type Mandate,
  type MandateOption,
} from "./sepa-mandate.ts";
export {
  ansprechpartnerSnapshot,
  ContactPersonError,
  contactPersonInputSchema,
  contactPersonOptions,
  contactPersonProblem,
  createContactPerson,
  listContactPersons,
  setContactPersonActive,
  updateContactPerson,
  type ContactPerson,
  type ContactPersonInput,
} from "./contact-persons.ts";
export { saveTaxpayer, taxpayerSchema } from "./taxpayer.ts";
export {
  createTextBlock,
  listTextBlocks,
  setTextBlockArchived,
  textBlockInputSchema,
  updateTextBlock,
  type TextBlock,
  type TextBlockInput,
} from "./text-blocks.ts";
