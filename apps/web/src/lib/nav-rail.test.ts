import { describe, expect, it } from "vitest";
import { NAV_COLLAPSED_VALUE, NAV_KEY, NAV_SCRIPT } from "./nav-rail.ts";

/** Führt das Inline-Skript mit nachgebautem Speicher aus und liefert data-nav */
function run(value: string | null): string | undefined {
  const dataset: Record<string, string> = {};
  const localStorage = { getItem: (key: string) => (key === NAV_KEY ? value : null) };
  new Function("document", "localStorage", NAV_SCRIPT)({ documentElement: { dataset } }, localStorage);
  return dataset.nav;
}

describe("NAV_SCRIPT", () => {
  it("lässt die Seitenleiste ohne gespeicherte Wahl ausgeklappt", () => {
    expect(run(null)).toBeUndefined();
    expect(run("ausgeklappt")).toBeUndefined();
    expect(run("<script>")).toBeUndefined();
  });

  it("setzt data-nav=collapsed sofort, wenn eingeklappt gespeichert ist", () => {
    expect(run(NAV_COLLAPSED_VALUE)).toBe("collapsed");
    expect(run("collapsed")).toBe("collapsed");
  });

  it("fängt fehlgeschlagenen Zugriff auf localStorage still ab", () => {
    const dataset: Record<string, string> = {};
    const localStorage = {
      getItem() {
        throw new Error("denied");
      },
    };
    expect(() => new Function("document", "localStorage", NAV_SCRIPT)({ documentElement: { dataset } }, localStorage)).not.toThrow();
    expect(dataset.nav).toBeUndefined();
  });
});
