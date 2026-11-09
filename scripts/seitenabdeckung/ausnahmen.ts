/*
 * Seiten, die eine Spec-Datei bewusst nicht aufruft, mit Grund. Eine neue Seite gehört in die Spec, nicht hierher.
 * Stand bei Einführung der Prüfung: Die mit „noch offen“ markierten Seiten fehlten schon vorher; wer eine davon in
 * die Spec aufnimmt, streicht sie hier (die Prüfung meldet sonst eine veraltete Ausnahme).
 */

/** Leiten nur auf eine andere Seite weiter, die selbst geprüft wird */
const REDIRECTS: Record<string, string> = {
  "/abschluss": "leitet auf /abschluss/$jahr weiter",
  "/jahreserklaerung": "leitet auf /jahreserklaerung/$jahr weiter",
  "/lohn/anmeldung": "leitet auf /lohn/anmeldung/$zeitraum weiter",
};

const OPEN = "noch offen";

export const EXCEPTIONS: Record<"seiten" | "barrierefreiheit", Record<string, string>> = {
  seiten: {
    ...REDIRECTS,
    "/angebote/$id": OPEN,
    "/angebote/neu": OPEN,
    "/anlagen/$id": OPEN,
    "/kontakte/neu": OPEN,
    "/umsatzsteuer/$zeitraum": OPEN,
    "/archiv/beleg/$id": OPEN,
    "/rechnungen/wiederkehrend/$id": OPEN,
    "/rechnungen/wiederkehrend/neu": OPEN,
  },
  barrierefreiheit: {
    ...REDIRECTS,
    "/belege/$id": "axe prüft gmbh.spec.ts am stornierten Beleg",
    "/angebote/$id": OPEN,
    "/anlagen/$id": OPEN,
    "/archiv/beleg/$id": OPEN,
    "/kontakte/$id": OPEN,
    "/rechnungen/$id": OPEN,
    "/rechnungen/mahnwesen/$id": OPEN,
    "/rechnungen/wiederkehrend/$id": OPEN,
  },
};
