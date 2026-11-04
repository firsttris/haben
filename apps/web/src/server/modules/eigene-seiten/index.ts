/*
 * Eigene Seiten (#199): Menüeinträge für Seiten außerhalb von Haben, etwa eine Bestellübersicht aus n8n, im Rahmen
 * angezeigt. Haben bleibt Buchhaltung; was die Seite tut, liegt beim Nutzer.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  createCustomPage,
  CustomPageError,
  customPageInputSchema,
  deleteCustomPage,
  getCustomPage,
  listCustomPages,
  updateCustomPage,
  type CustomPage,
  type CustomPageInput,
} from "./pages.ts";
export { checkPageUrl, type PageUrlResult } from "./url.ts";
