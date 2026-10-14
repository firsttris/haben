/** Farbschemata der Oberfläche; die Wahl liegt nur im Browser (localStorage), nicht auf dem Server */
export const THEMES = [
  { id: "auto", label: "Automatisch (Wald/Nacht)" },
  { id: "wald", label: "Wald" },
  { id: "ozean", label: "Ozean" },
  { id: "pflaume", label: "Pflaume" },
  { id: "graphit", label: "Graphit" },
  { id: "nacht", label: "Nacht (dunkel)" },
  { id: "tiefsee", label: "Tiefsee (dunkel)" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const THEME_KEY = "haben-theme";
export const DEFAULT_THEME: ThemeId = "wald";

/**
 * Läuft als Inline-Skript im <head>, bevor die Seite gezeichnet wird, damit nichts aufblitzt.
 * „auto“ folgt der Systemeinstellung hell/dunkel, auch wenn sie sich später ändert.
 */
export const THEME_SCRIPT = `(function(){var k=${JSON.stringify(THEME_KEY)},d=${JSON.stringify(DEFAULT_THEME)},ids=${JSON.stringify(THEMES.map((t) => t.id))};
var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)");
function pick(){var t;try{t=localStorage.getItem(k)}catch(e){}return ids.indexOf(t)<0?d:t}
function apply(){var t=pick();document.documentElement.dataset.theme=t==="auto"?(m&&m.matches?"nacht":"wald"):t}
apply();if(m&&m.addEventListener)m.addEventListener("change",apply);window.__habenTheme=apply})();`;

export function readTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === stored) ? (stored as ThemeId) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const listeners = new Set<() => void>();

/** Für useSyncExternalStore: meldet Änderungen aus saveTheme */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function saveTheme(id: ThemeId) {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    // Privater Modus o. Ä.: gilt dann nur bis zum Neuladen
  }
  const apply = (window as { __habenTheme?: () => void }).__habenTheme;
  if (apply) apply();
  else document.documentElement.dataset.theme = id === "auto" ? "wald" : id;
  for (const listener of listeners) listener();
}
