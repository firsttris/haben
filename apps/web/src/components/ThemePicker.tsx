import { useSyncExternalStore } from "react";
import { DEFAULT_THEME, readTheme, saveTheme, subscribeTheme, THEMES, type ThemeId } from "../lib/theme.ts";

/** Auswahl des Farbschemas unten in der Navigation; auf dem Server gilt das Standardschema */
export function ThemePicker() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => DEFAULT_THEME);
  return (
    <label className="nav-theme">
      <span>Theme</span>
      <select value={theme} onChange={(event) => saveTheme(event.target.value as ThemeId)}>
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
