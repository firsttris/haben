import type { Page } from "@playwright/test";

/**
 * Was app.spec.ts anlegt und die Tests im Projekt „mit-daten“ (playwright.config.ts) danach lesen.
 */

/** Das Konto aus der Einrichtung in app.spec.ts */
export const USER = { name: "Max Mustermann", email: "max@example.com", password: "ein-sehr-langes-e2e-passwort" };

/**
 * Die Sitzung von USER am Ende von app.spec.ts. Playwright leert test-results vor jedem Lauf; der Punkt
 * am Anfang hält die Datei aus dem Artefakt der CI heraus (upload-artifact lässt versteckte Dateien weg).
 */
export const SESSION = "test-results/.sitzung.json";

// Alle Daten im selben Jahr: Anfang Januar rechnet der Test im Dezember des Vorjahres
const today = new Date();
const startOfYear = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
const base = today.getTime() - startOfYear.getTime() < 50 * 86_400_000 ? new Date(Date.UTC(today.getUTCFullYear() - 1, 11, 20)) : today;

/** Das Jahr, in dem app.spec.ts bucht */
export const YEAR = base.getUTCFullYear();

/** Datum `offset` Tage vom Bezugstag aus, als YYYY-MM-DD */
export const day = (offset: number) => new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

/** Ordner für die Screenshots im Artefakt der CI */
export const SHOTS = "test-results/screenshots";

/** Erste verlinkte Detailseite einer Liste, z. B. /rechnungen/<id> */
export async function firstLink(p: Page, list: string, pattern: RegExp): Promise<string | null> {
  await p.goto(list);
  await p.waitForLoadState("networkidle");
  return p.locator("a[href]").evaluateAll((links, source) => {
    const re = new RegExp(source);
    return links.map((a) => a.getAttribute("href") ?? "").find((h) => re.test(h)) ?? null;
  }, pattern.source);
}

/** Für browser.newContext(): ohne Sitzung, auch wenn die Datei sonst SESSION verwendet */
export const ANONYMOUS = { storageState: { cookies: [], origins: [] } };

/** `list` in Gruppen zu je `size`: ein Test je Gruppe, damit sich die Seiten auf die Worker verteilen */
export function chunks<T>(list: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
}
