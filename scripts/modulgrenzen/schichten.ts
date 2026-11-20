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
  "ablage",
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
  "umstellung",
  "finanzamt",
  "liquiditaet",
  "verfahrensdoku",
  "archiv",
  "datenimport",
  "instanzwechsel",
  "stores",
  "etsy",
  "paypal",
  "stripe",
  "mcp",
  "api",
] as const;

/**
 * Importe nach oben, die die Reihenfolge bewusst durchbrechen: je Datei unter modules/ das Modul, das sie importieren
 * darf, mit Grund. Jede Ausnahme ist ein Ring, der noch aufzulösen ist; neue kommen nur mit Zustimmung des Maintainers
 * dazu.
 */
export const AUSNAHMEN: readonly { datei: string; modul: string; grund: string }[] = [];
