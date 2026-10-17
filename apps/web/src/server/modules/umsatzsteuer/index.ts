/*
 * Umsatzsteuer-Voranmeldung: Zahlen aus den Buchungen, Vorprüfung, Entwürfe, Berichtigung und Übermittlung.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Lint-Regel haben/modulgrenzen, eslint/modulgrenzen.js).
 */
export { computeVatFigures, preflight, type PreflightIssue } from "./vat-figures.ts";
export { computedValues, createCorrection, recentSentReturns, returnsForPeriod, saveDraft, submissionsFor, submitReturn } from "./vat.ts";
