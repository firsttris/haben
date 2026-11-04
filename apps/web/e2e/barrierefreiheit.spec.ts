import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { ANONYMOUS, chunks, fakeEigeneSeite, firstLink, SESSION, USER } from "./daten.ts";

/**
 * Barrierefreiheit und Tastaturbedienung, mit den Daten und der Sitzung aus app.spec.ts (Projekt „mit-daten“ in
 * playwright.config.ts). axe-core prüft jede Seite gegen WCAG 2.2 AA und die Best Practices von axe, die
 * Farbkontraste zusätzlich in allen übrigen Themes. Die Tastaturtests melden sich ohne Maus an, springen mit dem
 * Sprunglink zum Inhalt und tabben durch die Seiten: Jedes Element mit Fokus muss einen sichtbaren Rahmen haben.
 * Jede Seite ist ein eigener Test, damit sie sich auf die Worker verteilen; geschrieben wird nichts.
 */

test.use({ storageState: SESSION });
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const THEMES = ["wald", "ozean", "pflaume", "graphit", "nacht", "tiefsee"];

const today = new Date();
const YEAR = today.getFullYear();

const PAGES = [
  "/",
  "/rechnungen",
  "/rechnungen/neu",
  "/rechnungen/mahnwesen",
  "/rechnungen/wiederkehrend",
  "/rechnungen/wiederkehrend/neu",
  "/angebote",
  "/angebote/neu",
  "/artikel",
  "/kontakte",
  "/kontakte/neu",
  "/belege",
  "/pauschalen",
  "/anlagen",
  "/anlagen/neu",
  "/bank",
  "/kasse",
  "/umsatzsteuer",
  // Quartal, das nicht zum eingestellten Zeitraum passt: mit Hinweis und gesperrtem Senden
  `/umsatzsteuer/${YEAR}-Q1`,
  `/jahreserklaerung/${YEAR}`,
  "/finanzamt",
  "/fristen",
  "/auswertungen",
  "/buchungen",
  "/buchungen/neu",
  `/abschluss/${YEAR - 1}`,
  "/ausschuettungen",
  `/konten?jahr=${YEAR}`,
  `/konten/1200?jahr=${YEAR}`,
  "/archiv",
  // Altbelege aus der Web-Sicherung in app.spec.ts, mit den Filtern Richtung und „Ohne Datei“
  "/archiv?ansicht=belege",
  "/archiv?ansicht=belege&richtung=ausgabe&ohneDatei=true",
  "/textbausteine",
  "/einstellungen",
  "/einstellungen?bereich=rechnungen",
  "/einstellungen?bereich=elster",
  "/einstellungen?bereich=email",
  "/einstellungen?bereich=bank",
  "/einstellungen?bereich=ki",
  "/einstellungen?bereich=export",
  "/einstellungen?bereich=seiten",
];

/** Für die übrigen Themes: Seiten, auf denen zusammen jede Art von Link, Knopf, Hinweis und Tabelle vorkommt */
const THEME_PAGES = [
  "/",
  "/rechnungen",
  "/rechnungen/neu",
  "/bank",
  "/buchungen",
  `/konten/1200?jahr=${YEAR}`,
  "/fristen",
  "/auswertungen",
  `/jahreserklaerung/${YEAR}`,
  "/archiv",
  "/einstellungen?bereich=elster",
  "/einstellungen?bereich=export",
];

/** Anmelden nur mit der Tastatur: Tab, Enter und Tippen */
async function signInByKeyboard(p: Page) {
  await p.goto("/login");
  await p.waitForLoadState("networkidle");
  await tabTo(p, "Passwort verwenden");
  await p.keyboard.press("Enter");
  // Das E-Mail-Feld hat den Fokus, sobald der Knopf verschwunden ist
  await expect(p.getByLabel("E-Mail")).toBeFocused();
  await p.keyboard.type(USER.email);
  await p.keyboard.press("Tab");
  await expect(p.getByLabel("Passwort")).toBeFocused();
  await p.keyboard.type(USER.password);
  await p.keyboard.press("Enter");
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Tab drücken, bis das Element mit diesem Namen den Fokus hat */
async function tabTo(p: Page, name: string, max = 80) {
  for (let i = 0; i < max; i++) {
    await p.keyboard.press("Tab");
    const label = await p.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      // biome-ignore lint/performance/useDomNodeTextContent: gemeint ist der sichtbare Text
      return (el?.getAttribute("aria-label") ?? el?.innerText ?? "").trim();
    });
    if (label === name || label.endsWith(`\n${name}`)) return;
  }
  throw new Error(`„${name}“ ist mit Tab nicht erreichbar`);
}

async function open(p: Page, path: string) {
  const response = await p.goto(path);
  expect(response?.status(), `${path} lädt`).toBeLessThan(400);
  await p.waitForLoadState("networkidle");
  await expect(p.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

/** axe-Verstöße als lesbare Liste, damit der Fehler im Testbericht sagt, was wo kaputt ist */
async function axe(p: Page, rules?: string[]) {
  const builder = new AxeBuilder({ page: p }).withTags(WCAG);
  if (rules) builder.withRules(rules);
  const { violations } = await builder.analyze();
  return violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} (${v.impact}): ${v.help} → ${n.target.join(" ")} ${n.failureSummary?.split("\n").slice(1).join(" ") ?? ""}`.trim()),
  );
}

/** Theme vor dem ersten Laden setzen; das Skript im Kopf der Seite liest es aus localStorage */
async function withTheme(p: Page, theme: string) {
  await p.addInitScript((t) => localStorage.setItem("haben-theme", t), theme);
}

test("Anmeldeseite ohne Verstöße", async ({ browser }) => {
  const anonymous = await browser.newContext(ANONYMOUS);
  const p = await anonymous.newPage();
  await open(p, "/login");
  expect(await axe(p), "/login").toEqual([]);
  await p.getByRole("button", { name: "Passwort verwenden" }).click();
  expect(await axe(p), "/login mit Passwort").toEqual([]);
  await anonymous.close();
});

test("Anmelden nur mit der Tastatur", async ({ browser }) => {
  const anonymous = await browser.newContext(ANONYMOUS);
  await signInByKeyboard(await anonymous.newPage());
  await anonymous.close();
});

/** Seiten je Test: mehrere Seiten in einem Browser-Kontext laden die Skripte nur einmal */
const GROUP = 6;

for (const group of chunks(PAGES, GROUP)) {
  test(`Ohne axe-Verstöße (WCAG 2.2 AA): ${group.join(", ")}`, async ({ page }) => {
    await withTheme(page, "wald");
    for (const path of group) {
      await open(page, path);
      expect.soft(await axe(page), path).toEqual([]);
    }
  });
}

for (const theme of THEMES.filter((t) => t !== "wald")) {
  test(`Farbkontraste im Theme ${theme}`, async ({ page }) => {
    test.setTimeout(300_000);
    await withTheme(page, theme);
    for (const path of THEME_PAGES) {
      await open(page, path);
      expect.soft(await axe(page, ["color-contrast", "link-in-text-block"]), `${theme} ${path}`).toEqual([]);
    }
  });
}

// Die Adresse der eigenen Seite aus app.spec.ts steht erst zur Laufzeit fest; axe prüft auch den Inhalt im Rahmen
for (const [device, viewport] of [
  ["Desktop", { width: 1440, height: 900 }],
  ["Handy", { width: 320, height: 720 }],
] as const) {
  test(`Eigene Seite ohne axe-Verstöße (${device})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await withTheme(page, "wald");
    await fakeEigeneSeite(page);
    const path = await firstLink(page, "/einstellungen?bereich=seiten", /^\/seiten\/[0-9a-f-]{36}$/);
    expect(path, "app.spec.ts hat eine eigene Seite angelegt").not.toBeNull();
    await open(page, path!);
    await expect(page.frameLocator("iframe").getByRole("heading", { name: "Offene Bestellungen" })).toBeVisible();
    expect(await axe(page), path!).toEqual([]);
  });
}

test.describe("Handy", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  for (const group of chunks(PAGES, GROUP)) {
    test(`Ohne axe-Verstöße: ${group.join(", ")}`, async ({ page }) => {
      await withTheme(page, "wald");
      for (const path of group) {
        await open(page, path);
        expect.soft(await axe(page), `Handy ${path}`).toEqual([]);
      }
    });
  }

  test("Offenes Menü ohne Verstöße, Escape schließt das Menü", async ({ page }) => {
    await withTheme(page, "wald");
    await open(page, "/");
    const menu = page.getByRole("button", { name: "Menü" });
    await tabTo(page, "Menü");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(await axe(page), "Handy, Menü offen").toEqual([]);
    // Mit Tab ins Menü, Escape schließt es und der Fokus steht wieder auf dem Menüknopf
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Übersicht" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
  });
});

test("Sprunglink führt zum Inhalt, Seitenwechsel per Tastatur setzt den Fokus auf den Inhalt", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Zum Inhalt springen" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  // Der nächste Tab landet im Inhalt, nicht wieder in der Navigation
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("main")))).toBe(true);

  await open(page, "/");
  await tabTo(page, "Rechnungen");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/rechnungen$/);
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Rechnungen", level: 1 })).toBeVisible();
});

const FOCUS_PAGES = [
  "/",
  "/rechnungen",
  "/rechnungen/neu",
  "/belege",
  "/bank",
  "/kasse",
  "/kontakte",
  "/auswertungen",
  "/fristen",
  "/einstellungen",
  "/einstellungen?bereich=export",
];

for (const group of chunks(FOCUS_PAGES, GROUP)) {
  test(`Jedes Element mit Tastaturfokus hat einen sichtbaren Rahmen: ${group.join(", ")}`, async ({ page }) => {
    for (const path of group) await visibleFocus(page, path);
  });
}

async function visibleFocus(page: Page, path: string) {
  await open(page, path);
  const seen = new Set<string>();
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const id = el.outerHTML.slice(0, 120);
      // Versteckte Dateiauswahl: den Rahmen trägt der sichtbare Knopf daneben
      const shown = el.classList.contains("visually-hidden") && el.nextElementSibling ? (el.nextElementSibling as HTMLElement) : el;
      const style = getComputedStyle(shown);
      const ring = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
      // Das Suchfeld zeigt den Fokus am umgebenden Kasten
      const box = el.closest(".search-box");
      const boxRing = box ? getComputedStyle(box).outlineStyle !== "none" : false;
      // SVG-Elemente (Monate im Diagramm) markieren den Fokus selbst
      const svg = el instanceof SVGElement && getComputedStyle(el.querySelector(".hit") ?? el).strokeWidth !== "0px";
      return { id, visible: ring || boxRing || svg };
    });
    if (!focus || seen.has(focus.id)) break;
    seen.add(focus.id);
    expect.soft(focus.visible, `${path}: sichtbarer Fokus auf ${focus.id}`).toBe(true);
  }
  expect(seen.size, `${path}: mit Tab erreichbare Elemente`).toBeGreaterThan(5);
}

test("Seitenwechsel über einen Link im Inhalt setzt den Fokus auf den Inhalt", async ({ page }) => {
  // Von der Übersicht auf eine andere Seite: der Link verschwindet mit der Übersicht, der Fokus darf nicht verloren gehen
  await open(page, "/");
  await page.getByRole("main").getByRole("link", { name: "Neue Rechnung" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/rechnungen\/neu$/);
  await expect(page.getByRole("button", { name: "Entwurf speichern" })).toBeVisible();
  await expect(page.getByRole("main")).toBeFocused();
});

test("Archiv: Nur der gewählte Bereich und die gewählten Filter tragen aria-current", async ({ page }) => {
  // TanStack Router setzt aria-current="page" selbst, sobald die Suchparameter eines Links nur teilweise passen;
  // „Alle“ und „Umzug“ setzen ihren Parameter auf undefined und galten deshalb immer als aktiv
  await open(page, "/archiv?ansicht=belege&richtung=ausgabe&ohneDatei=true");
  const current = (scope: ReturnType<Page["getByRole"]>) =>
    scope.getByRole("link").evaluateAll((links) => links.filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent));
  expect(await current(page.getByRole("navigation", { name: "Bereich wählen" }))).toEqual(["Belege"]);
  expect(await current(page.getByRole("group", { name: "Richtung" }))).toEqual(["Ausgaben", "Ohne Datei"]);

  await open(page, "/archiv?ansicht=belege");
  expect(await current(page.getByRole("group", { name: "Richtung" }))).toEqual(["Alle"]);
});
