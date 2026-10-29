import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Barrierefreiheit und Tastaturbedienung, mit den Daten, die app.spec.ts davor angelegt hat (der Dateiname
 * sorgt für die Reihenfolge). axe-core prüft jede Seite gegen WCAG 2.2 AA und die Best Practices von axe,
 * die Farbkontraste zusätzlich in allen übrigen Themes. Die Tastaturtests melden sich ohne Maus an, springen mit dem
 * Sprunglink zum Inhalt und tabben durch die Seiten: Jedes Element mit Fokus muss einen sichtbaren Rahmen haben.
 */

test.describe.configure({ mode: "serial" });

const USER = { email: "max@example.com", password: "ein-sehr-langes-e2e-passwort" };
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
  `/jahreserklaerung/${YEAR}`,
  "/finanzamt",
  "/fristen",
  "/auswertungen",
  "/buchungen",
  `/konten?jahr=${YEAR}`,
  `/konten/1200?jahr=${YEAR}`,
  "/archiv",
  "/einstellungen",
  "/einstellungen?bereich=rechnungen",
  "/einstellungen?bereich=elster",
  "/einstellungen?bereich=email",
  "/einstellungen?bereich=export",
];

/** Für die übrigen Themes: Seiten, auf denen zusammen jede Art von Link, Knopf, Hinweis und Tabelle vorkommt */
const THEME_PAGES = ["/", "/rechnungen", "/rechnungen/neu", "/bank", "/buchungen", `/konten/1200?jahr=${YEAR}`, "/fristen", "/auswertungen", `/jahreserklaerung/${YEAR}`, "/archiv", "/einstellungen?bereich=elster", "/einstellungen?bereich=export"];

let context: BrowserContext;
let page: Page;

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
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id} (${v.impact}): ${v.help} → ${n.target.join(" ")} ${n.failureSummary?.split("\n").slice(1).join(" ") ?? ""}`.trim()));
}

async function setTheme(p: Page, theme: string) {
  await p.evaluate((t) => localStorage.setItem("haben-theme", t), theme);
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signInByKeyboard(page);
});

test.afterAll(async () => {
  await context.close();
});

test("Anmeldeseite ohne Verstöße", async ({ browser }) => {
  const anonymous = await browser.newContext();
  const p = await anonymous.newPage();
  await open(p, "/login");
  expect(await axe(p), "/login").toEqual([]);
  await p.getByRole("button", { name: "Passwort verwenden" }).click();
  expect(await axe(p), "/login mit Passwort").toEqual([]);
  await anonymous.close();
});

test("Alle Seiten ohne axe-Verstöße (WCAG 2.2 AA)", async () => {
  test.setTimeout(300_000);
  await setTheme(page, "wald");
  for (const path of PAGES) {
    await open(page, path);
    expect.soft(await axe(page), path).toEqual([]);
  }
});

test("Farbkontraste in allen Themes", async () => {
  test.setTimeout(300_000);
  for (const theme of THEMES.filter((t) => t !== "wald")) {
    await setTheme(page, theme);
    for (const path of THEME_PAGES) {
      await open(page, path);
      expect.soft(await axe(page, ["color-contrast", "link-in-text-block"]), `${theme} ${path}`).toEqual([]);
    }
  }
  await setTheme(page, "wald");
});

async function mobile(browser: Browser) {
  const storageState = await context.storageState();
  return browser.newContext({ viewport: { width: 390, height: 844 }, storageState, locale: "de-DE", timezoneId: "Europe/Berlin" });
}

test("Handy: Seiten und offenes Menü ohne Verstöße, Escape schließt das Menü", async ({ browser }) => {
  test.setTimeout(300_000);
  const phone = await mobile(browser);
  const p = await phone.newPage();
  for (const path of PAGES) {
    await open(p, path);
    expect.soft(await axe(p), `Handy ${path}`).toEqual([]);
  }
  await open(p, "/");
  const menu = p.getByRole("button", { name: "Menü" });
  await tabTo(p, "Menü");
  await p.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  expect(await axe(p), "Handy, Menü offen").toEqual([]);
  // Mit Tab ins Menü, Escape schließt es und der Fokus steht wieder auf dem Menüknopf
  await p.keyboard.press("Tab");
  await expect(p.getByRole("link", { name: "Übersicht" })).toBeFocused();
  await p.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await phone.close();
});

test("Sprunglink führt zum Inhalt, Seitenwechsel per Tastatur setzt den Fokus auf den Inhalt", async () => {
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

test("Jedes Element mit Tastaturfokus hat einen sichtbaren Rahmen", async () => {
  test.setTimeout(300_000);
  for (const path of ["/", "/rechnungen", "/rechnungen/neu", "/belege", "/bank", "/kasse", "/kontakte", "/auswertungen", "/fristen", "/einstellungen", "/einstellungen?bereich=export"]) {
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
});

test("Seitenwechsel über einen Link im Inhalt setzt den Fokus auf den Inhalt", async () => {
  // Von der Übersicht auf eine andere Seite: der Link verschwindet mit der Übersicht, der Fokus darf nicht verloren gehen
  await open(page, "/");
  await page.getByRole("main").getByRole("link", { name: "Neue Rechnung" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/rechnungen\/neu$/);
  await expect(page.getByRole("button", { name: "Entwurf speichern" })).toBeVisible();
  await expect(page.getByRole("main")).toBeFocused();
});
