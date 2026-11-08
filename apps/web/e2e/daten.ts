import type { BrowserContext, Page, PageScreenshotOptions } from "@playwright/test";

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

/**
 * Die Durchläufe sehen beim Tippen auf die Vorschau der Belegeditoren: angeheftet steht sie neben dem Formular
 * (#357). Am 1440 px breiten Testfenster wäre die Vorgabe sonst die Überblendung; die prüft vorschau.spec.ts.
 * Der Schlüssel ist PREVIEW_MODE_KEY aus src/lib/vorschau.ts.
 */
export async function vorschauAnheften(target: BrowserContext | Page): Promise<void> {
  await target.addInitScript(() => {
    try {
      localStorage.setItem("haben-vorschau", "angeheftet");
    } catch {
      // about:blank hat keinen localStorage
    }
  });
}

/** Das Jahr, in dem app.spec.ts bucht */
export const YEAR = base.getUTCFullYear();

/** Datum `offset` Tage vom Bezugstag aus, als YYYY-MM-DD */
export const day = (offset: number) => new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

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

/** Die eigene Seite, die app.spec.ts unter Einstellungen → Eigene Seiten einhängt */
export const EIGENE_SEITE = { name: "Bestellungen", url: "https://bestellungen.example/uebersicht" };

/**
 * Beantwortet die Adresse der eigenen Seite im Browser selbst: Im Test gibt es kein n8n, und .example löst nicht auf.
 * Ohne `<main>`: axe zählt Landmarks über den Rahmen hinweg, und die der fremden Seite gestaltet Haben nicht.
 */
export async function fakeEigeneSeite(p: Page): Promise<void> {
  await p.route(`${EIGENE_SEITE.url}**`, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="de"><head><title>Bestellungen</title></head><body><h1>Offene Bestellungen</h1>
        <p>3 Bestellungen warten auf den Versand.</p><button type="button">Briefmarke drucken</button></body></html>`,
    }),
  );
}

/**
 * Screenshot der ganzen Seite mit durchgehender Seitenleiste. `fullPage` von Playwright lässt das Fenster so hoch, wie es
 * ist; die Seitenleiste (sticky, `height: 100vh`) endete dann nach einer Fensterhöhe mitten im Bild, und ihre unteren
 * Einträge fehlten. Deshalb wird das Fenster für die Aufnahme so hoch wie die Seite und danach wieder wie vorher.
 */
export async function fullPageScreenshot(p: Page, options: Omit<PageScreenshotOptions, "fullPage">): Promise<void> {
  const viewport = p.viewportSize();
  if (!viewport) throw new Error("Screenshot ohne feste Fenstergröße");
  const height = await p.evaluate(() => document.documentElement.scrollHeight);
  await p.setViewportSize({ width: viewport.width, height: Math.max(height, viewport.height) });
  try {
    await p.screenshot(options);
  } finally {
    await p.setViewportSize(viewport);
  }
}
