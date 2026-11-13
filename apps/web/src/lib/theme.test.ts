import { describe, expect, it } from "vitest";
import { MODE_KEY, THEME_KEY, THEME_SCRIPT } from "./theme.ts";

/** Führt das Inline-Skript mit nachgebautem window aus und liefert data-theme und data-mode */
function run(theme: string | null, mode: string | null = null, dark = false): { theme?: string; mode?: string } {
  const dataset: Record<string, string> = {};
  const window = {
    matchMedia: () => ({ matches: dark, addEventListener: () => {} }),
  } as Record<string, unknown>;
  const stored: Record<string, string | null> = { [THEME_KEY]: theme, [MODE_KEY]: mode };
  const localStorage = { getItem: (key: string) => stored[key] ?? null };
  new Function("window", "document", "localStorage", THEME_SCRIPT)(window, { documentElement: { dataset } }, localStorage);
  return { theme: dataset.theme, mode: dataset.mode };
}

describe("THEME_SCRIPT", () => {
  it("nimmt Farbe und Modus getrennt", () => {
    expect(run("ozean")).toEqual({ theme: "ozean", mode: "light" });
    expect(run("pflaume", "dunkel")).toEqual({ theme: "pflaume", mode: "dark" });
    expect(run("graphit", "hell", true)).toEqual({ theme: "graphit", mode: "light" });
  });

  it("fällt ohne oder mit unbekannter Wahl auf Wald hell zurück", () => {
    expect(run(null)).toEqual({ theme: "wald", mode: "light" });
    expect(run("<script>", "<script>")).toEqual({ theme: "wald", mode: "light" });
  });

  it("folgt bei System der Einstellung des Geräts", () => {
    expect(run("ozean", "system", false)).toEqual({ theme: "ozean", mode: "light" });
    expect(run("ozean", "system", true)).toEqual({ theme: "ozean", mode: "dark" });
  });

  it("übernimmt die früheren Themes Nacht, Tiefsee und Automatisch", () => {
    expect(run("nacht")).toEqual({ theme: "wald", mode: "dark" });
    expect(run("tiefsee")).toEqual({ theme: "ozean", mode: "dark" });
    expect(run("auto", null, true)).toEqual({ theme: "wald", mode: "dark" });
    expect(run("auto", null, false)).toEqual({ theme: "wald", mode: "light" });
  });

  it("lässt einen gespeicherten Modus vor dem früheren Theme gelten", () => {
    expect(run("nacht", "hell")).toEqual({ theme: "wald", mode: "light" });
  });
});
