export const NAV_KEY = "haben-nav";
export const NAV_COLLAPSED_VALUE = "eingeklappt";

const NAV_EVENT = "haben:nav";

/**
 * Setzt `data-nav="collapsed"` schon vor dem ersten Zeichnen im `<head>`, damit die schmale Seitenleiste beim
 * Neuladen nicht kurz aufspringt. Im Browser läuft dasselbe Skript wie in `THEME_SCRIPT`; ohne Zugriff auf
 * `localStorage` bleibt die Leiste ausgeklappt.
 */
export const NAV_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(NAV_KEY)});if(v===${JSON.stringify(NAV_COLLAPSED_VALUE)}||v==="collapsed"){document.documentElement.dataset.nav="collapsed";}}catch(e){}})();`;

export function readNavCollapsed(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.nav === "collapsed";
}

export function saveNavCollapsed(collapsed: boolean): void {
  if (typeof document !== "undefined") {
    if (collapsed) document.documentElement.dataset.nav = "collapsed";
    else delete document.documentElement.dataset.nav;
  }
  try {
    if (typeof localStorage !== "undefined") {
      if (collapsed) localStorage.setItem(NAV_KEY, NAV_COLLAPSED_VALUE);
      else localStorage.removeItem(NAV_KEY);
    }
  } catch {
    // Eingeschränkter Speichermodus (z. B. privates Fenster ohne Storage-Recht)
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NAV_EVENT));
}

export function subscribeNavCollapsed(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== NAV_KEY) return;
    const collapsed = event.newValue === NAV_COLLAPSED_VALUE || event.newValue === "collapsed";
    if (collapsed) document.documentElement.dataset.nav = "collapsed";
    else delete document.documentElement.dataset.nav;
    listener();
  };
  window.addEventListener(NAV_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(NAV_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
