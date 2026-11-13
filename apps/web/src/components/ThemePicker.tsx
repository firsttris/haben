import { useSyncExternalStore } from "react";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODES,
  type ModeId,
  readMode,
  readTheme,
  saveMode,
  saveTheme,
  subscribeTheme,
  THEMES,
  type ThemeId,
} from "../lib/theme.ts";

/** Farbe und Modus unten in der Navigation; auf dem Server gilt Wald hell */
export function ThemePicker() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => DEFAULT_THEME);
  const mode = useSyncExternalStore(subscribeTheme, readMode, () => DEFAULT_MODE);
  return (
    <div className="nav-theme">
      <label>
        <span>Farbe</span>
        {/* biome-ignore lint/plugin: Auswahl auf der dunklen Navigation mit eigenem Aussehen (`.nav-theme select`), das `<label>` darum ist der Feldname */}
        <select value={theme} onChange={(event) => saveTheme(event.target.value as ThemeId)}>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Modus</span>
        {/* biome-ignore lint/plugin: wie die Farbe daneben */}
        <select value={mode} onChange={(event) => saveMode(event.target.value as ModeId)}>
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
