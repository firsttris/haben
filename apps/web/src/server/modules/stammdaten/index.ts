/*
 * Stammdaten: Firmendaten (mit Versteuerung und Kleinunternehmer je Jahr), Kunden, Artikel, Textbausteine, Briefkopf (Logo, Akzentfarbe), persönliche
 * Angaben, Umsatzsteuer-Umrechnungskurse und die Sperre von Kontenrahmen, Versteuerung und Kleinunternehmer (settings-guard).
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { insertImportedArticles, insertImportedContacts, planArticleImport, planContactImport } from "./csv-import.ts";
export { articleInputSchema, createArticle, listArticles, setArticleArchived, updateArticle } from "./articles.ts";
export {
  companyIssues,
  companySchema,
  editorContext,
  kleinunternehmerForMonth,
  kleinunternehmerForYear,
  kleinunternehmerHistory,
  lastDayOfMonth,
  letterIssues,
  loadCompany,
  sellerIssues,
  versteuerungForYear,
  type Company,
} from "./company.ts";
export {
  contactSchema,
  createContact,
  getContact,
  listContacts,
  setContactArchived,
  setContactIbanIfEmpty,
  updateContact,
  type Contact,
  type ContactInput,
  type ContactRole,
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
export { CustomerNumberError, customerNumbering, saveCustomerNumbering } from "./customer-numbers.ts";
export { personenkontoKey, vergibPersonenkonten } from "./personenkonten-vergabe.ts";
export { NumberFormatError, saveNumberFormats, type NumberFormats } from "./number-formats.ts";
export { PlanTemplateError, planTemplatesProblem, savePlanTemplates } from "./plan-templates.ts";
export { saveCompany, settingsLocks } from "./settings-guard.ts";
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
