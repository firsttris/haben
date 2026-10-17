/*
 * Jahreserklärungen: Umsatzsteuererklärung, Anlage EÜR und Einkommensteuer, mit den Angaben zur Einkommensteuer.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Lint-Regel haben/modulgrenzen, eslint/modulgrenzen.js).
 */
export { annualOverview, loadAnnualProtocol, submitAnnual } from "./annual.ts";
export { estAngabenSchema, latestEstAngaben, prognose, saveEstAngaben } from "./income-tax.ts";
