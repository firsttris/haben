/** Seiten, zu denen die Anmeldung zurückkehren darf (?weiter=…); nur eigene Pfade, kein offener Redirect */
const ERLAUBT = ["/oauth/autorisieren?"];

/** Ziel nach der Anmeldung aus der rohen Suchzeile der Login-Seite, oder null */
export function weiterNachAnmeldung(search: string): string | null {
  const ziel = new URLSearchParams(search).get("weiter");
  return ziel && ERLAUBT.some((anfang) => ziel.startsWith(anfang)) ? ziel : null;
}
