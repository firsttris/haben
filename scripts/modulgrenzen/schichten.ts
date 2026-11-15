/*
 * Reihenfolge der Module im Server, von unten nach oben. Ein Modul importiert nur Module, die vor ihm stehen; so kann
 * kein Ring entstehen (regel.ts). Ein neues Modul kommt über alle Module, die es importiert, und unter alle, die es
 * importieren. Passt ein Import nicht in die Reihenfolge, gehört meist der Code woanders hin (docs/architektur.md,
 * „Module im Server“).
 */
export const SCHICHTEN = [
  "zugang",
  "eigene-seiten",
  "stammdaten",
  "eigene-konten",
  "elster",
  "betrieb",
  "mail",
  "buchhaltung",
  "rechnungen",
  "leistungen",
  "umsatzsteuer",
  "lohn",
  "bank",
  "belege",
  "sv-meldungen",
  "auswertungen",
  "koerperschaft",
  "ausschuettung",
  "jahreserklaerung",
  "finanzamt",
  "archiv",
  "datenimport",
  "stores",
  "mcp",
  "api",
] as const;
