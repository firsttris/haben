/**
 * Farbe und Modus der Oberfläche, getrennt wählbar; die Wahl liegt nur im Browser (localStorage), nicht auf dem Server.
 * Jede Farbe gibt es hell und dunkel; `<html>` trägt die Farbe in data-theme und den Modus in data-mode (light, dark).
 */
export const THEMES = [
  { id: "wald", label: "Wald" },
  { id: "ozean", label: "Ozean" },
  { id: "pflaume", label: "Pflaume" },
  { id: "graphit", label: "Graphit" },
] as const;

export const MODES = [
  { id: "hell", label: "Hell" },
  { id: "dunkel", label: "Dunkel" },
  { id: "system", label: "System" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type ModeId = (typeof MODES)[number]["id"];

export const THEME_KEY = "haben-theme";
export const MODE_KEY = "haben-modus";
export const DEFAULT_THEME: ThemeId = "wald";
export const DEFAULT_MODE: ModeId = "hell";

/** Frühere Werte von THEME_KEY, als Farbe und Modus; gilt, solange kein Modus gespeichert ist */
const LEGACY: Record<string, [ThemeId, ModeId]> = {
  nacht: ["wald", "dunkel"],
  tiefsee: ["ozean", "dunkel"],
  auto: ["wald", "system"],
};

/**
 * Läuft als Inline-Skript im <head>, bevor die Seite gezeichnet wird, damit nichts aufblitzt.
 * „System“ folgt der Einstellung des Geräts, auch wenn sie sich später ändert.
 */
export const THEME_SCRIPT = `(function(){var tk=${JSON.stringify(THEME_KEY)},mk=${JSON.stringify(MODE_KEY)},themes=${JSON.stringify(THEMES.map((t) => t.id))},modes=${JSON.stringify(MODES.map((m) => m.id))},legacy=${JSON.stringify(LEGACY)};
var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)");
function get(k){try{return localStorage.getItem(k)}catch(e){return null}}
function apply(){var t=get(tk),mo=get(mk),l=Object.prototype.hasOwnProperty.call(legacy,t)?legacy[t]:null;
var theme=themes.indexOf(t)>=0?t:l?l[0]:${JSON.stringify(DEFAULT_THEME)};
if(modes.indexOf(mo)<0)mo=l?l[1]:${JSON.stringify(DEFAULT_MODE)};
var e=document.documentElement;e.dataset.theme=theme;e.dataset.mode=mo==="dunkel"||(mo==="system"&&m&&m.matches)?"dark":"light"}
apply();if(m&&m.addEventListener)m.addEventListener("change",apply);window.__habenTheme=apply})();`;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function legacy(): [ThemeId, ModeId] | null {
  const value = stored(THEME_KEY);
  return value !== null && Object.hasOwn(LEGACY, value) ? LEGACY[value]! : null;
}

export function readTheme(): ThemeId {
  const value = stored(THEME_KEY);
  if (THEMES.some((t) => t.id === value)) return value as ThemeId;
  return legacy()?.[0] ?? DEFAULT_THEME;
}

export function readMode(): ModeId {
  const value = stored(MODE_KEY);
  if (MODES.some((m) => m.id === value)) return value as ModeId;
  return legacy()?.[1] ?? DEFAULT_MODE;
}

const listeners = new Set<() => void>();

/** Für useSyncExternalStore: meldet Änderungen aus saveTheme und saveMode */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function save(theme: ThemeId, mode: ModeId) {
  try {
    // Beide Schlüssel, damit ein früheres „nacht“ nicht mehr als Modus mitzählt
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Privater Modus o. Ä.: gilt dann nur bis zum Neuladen
  }
  const apply = (window as { __habenTheme?: () => void }).__habenTheme;
  if (apply) apply();
  else {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode === "dunkel" ? "dark" : "light";
  }
  for (const listener of listeners) listener();
}

export function saveTheme(theme: ThemeId) {
  save(theme, readMode());
}

export function saveMode(mode: ModeId) {
  save(readTheme(), mode);
}
