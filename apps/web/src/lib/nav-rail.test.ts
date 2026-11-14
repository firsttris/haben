import { afterEach, describe, expect, it, vi } from "vitest";
import { NAV_COLLAPSED_VALUE, NAV_KEY, NAV_SCRIPT, readNavCollapsed, saveNavCollapsed, subscribeNavCollapsed } from "./nav-rail.ts";

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

describe("nav-rail Zustand und Speicherung", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("speichert, liest und löscht den Einklapp-Zustand sicher", () => {
    const dataset: Record<string, string> = {};
    const store = new Map<string, string>();
    const target = new EventTarget();
    vi.stubGlobal("document", { documentElement: { dataset } });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal("window", target);

    expect(readNavCollapsed()).toBe(false);
    const events: boolean[] = [];
    const stop = subscribeNavCollapsed(() => events.push(readNavCollapsed()));

    saveNavCollapsed(true);
    expect(dataset.nav).toBe("collapsed");
    expect(store.get(NAV_KEY)).toBe(NAV_COLLAPSED_VALUE);
    expect(readNavCollapsed()).toBe(true);

    saveNavCollapsed(false);
    expect(dataset.nav).toBeUndefined();
    expect(store.has(NAV_KEY)).toBe(false);
    expect(events).toEqual([true, false]);

    // Speicherfehler beim Schreiben wirft nicht
    vi.stubGlobal("localStorage", {
      setItem() {
        throw new Error("quota");
      },
      removeItem() {
        throw new Error("quota");
      },
    });
    expect(() => saveNavCollapsed(true)).not.toThrow();
    stop();
  });
});
