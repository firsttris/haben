import { describe, expect, it } from "vitest";
import { THEME_KEY, THEME_SCRIPT } from "./theme.ts";

/** Führt das Inline-Skript mit nachgebautem window aus und liefert das gesetzte data-theme */
function run(stored: string | null, dark = false): string | undefined {
  const dataset: Record<string, string> = {};
  const window = {
    matchMedia: () => ({ matches: dark, addEventListener: () => {} }),
  } as Record<string, unknown>;
  const localStorage = { getItem: (key: string) => (key === THEME_KEY ? stored : null) };
  new Function("window", "document", "localStorage", THEME_SCRIPT)(window, { documentElement: { dataset } }, localStorage);
  return dataset.theme;
}

describe("THEME_SCRIPT", () => {
  it("nimmt die gespeicherte Wahl", () => {
    expect(run("ozean")).toBe("ozean");
    expect(run("tiefsee")).toBe("tiefsee");
  });

  it("fällt ohne oder mit unbekannter Wahl auf Wald zurück", () => {
    expect(run(null)).toBe("wald");
    expect(run("<script>")).toBe("wald");
  });

  it("folgt bei automatisch der Systemeinstellung", () => {
    expect(run("auto", false)).toBe("wald");
    expect(run("auto", true)).toBe("nacht");
  });
});
