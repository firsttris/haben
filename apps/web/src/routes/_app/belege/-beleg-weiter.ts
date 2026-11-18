export const CONTINUE_KEY = "haben-belege-weiter";

/** Voreinstellung „nach dem Buchen weiter“: an, solange nichts anderes gemerkt ist; ohne Speicher (privates Fenster) einfach an */
export function readContinuePreference(): boolean {
  if (continueFallback !== null) return continueFallback;
  try {
    return window.localStorage.getItem(CONTINUE_KEY) !== "nein";
  } catch {
    return true;
  }
}

export const continueListeners = new Set<() => void>();

/** Ohne Speicher (privates Fenster) gilt die Wahl, bis die Seite neu geladen wird */
export let continueFallback: boolean | null = null;

export function subscribeContinuePreference(listener: () => void) {
  continueListeners.add(listener);
  return () => continueListeners.delete(listener);
}

export function writeContinuePreference(value: boolean) {
  try {
    window.localStorage.setItem(CONTINUE_KEY, value ? "ja" : "nein");
  } catch {
    continueFallback = value;
  }
  for (const listener of continueListeners) listener();
}
