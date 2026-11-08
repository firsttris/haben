import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";
import { HANDY, kopfUnterkante, LAPTOP, sichtbar, zumEnde } from "./kopfzeile.ts";

/**
 * Vorschau der Belegeditoren (#357): Split-Button „Vorschau“ im Seitenkopf, Überblendung als <dialog>, Anheften neben
 * das Formular, Wahl je Gerät. Mit der Sitzung aus app.spec.ts (Projekt „mit-daten“); gespeichert wird nur im Browser.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const GROSS = { width: 1920, height: 1080 };

/** Die Sitzung ohne gespeicherte Wahl: app.spec.ts heftet für seine Prüfungen an (vorschauAnheften in daten.ts) */
async function editor(browser: Browser, viewport: { width: number; height: number }, path = "/rechnungen/neu"): Promise<Page> {
  const state = JSON.parse(readFileSync(SESSION, "utf8")) as {
    cookies: [];
    origins: { origin: string; localStorage: { name: string; value: string }[] }[];
  };
  const origins = state.origins.map((o) => ({ ...o, localStorage: o.localStorage.filter((item) => item.name !== "haben-vorschau") }));
  const page = await (await browser.newContext({ viewport, storageState: { ...state, origins } })).newPage();
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return page;
}

/** Eine gültige Position; ohne Preis zeigt die Vorschau „[Positionen]“ */
async function position(p: Page, beschreibung: string): Promise<void> {
  await p.getByLabel("Beschreibung Position 1").fill(beschreibung);
  await p.getByLabel("Menge Position 1").fill("2");
  await p.getByLabel(/Einzelpreis Position 1/).fill("10,00");
}

const head = (p: Page) => p.locator(".main > .page-head");
const vorschauKnopf = (p: Page) => head(p).getByRole("button", { name: "Vorschau", exact: true });
const pfeil = (p: Page) => head(p).getByRole("button", { name: "Weitere Vorschau-Optionen" });
const seitenansicht = (p: Page) => p.getByRole("region", { name: "Vorschau", exact: true });
const dialog = (p: Page) => p.getByRole("dialog", { name: "Vorschau" });

/** Lage des Dialogs, wenn er zu Ende gefahren ist */
async function lageNachDerFahrt(p: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  await expect.poll(() => dialog(p).evaluate((el) => getComputedStyle(el).transform)).toMatch(/^none$|^matrix\(1, 0, 0, 1, 0, 0\)$/);
  return dialog(p).evaluate((el) => {
    const { left, top, right, bottom } = el.getBoundingClientRect();
    return { left, top, right, bottom };
  });
}

async function axe(p: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page: p }).withTags(WCAG).analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${v.help} → ${n.target.join(" ")}`));
}

test("Laptop: Überblendung ohne Verlust von Eingaben und Scrollposition, Fokus hinein und zurück", async ({ browser }) => {
  const page = await editor(browser, LAPTOP);
  // Ohne gespeicherte Wahl am 14-Zoll-Laptop: das Formular hat die volle Breite, Anheften wird angeboten
  await expect(seitenansicht(page)).toHaveCount(0);
  await expect(pfeil(page)).toBeVisible();
  const breite = await page.locator("#invoice-form").evaluate((form) => form.getBoundingClientRect().width);
  expect(breite).toBeGreaterThan(1000);

  await position(page, "Überblendung prüfen");
  await zumEnde(page);
  // Per Tastatur: click() von Playwright scrollt den Knopf im stehenden Kopf selbst „ins Bild“ und verschöbe die Seite
  await vorschauKnopf(page).focus();
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel("Vorschau der Rechnung")).toContainText("Überblendung prüfen");
  // Seitenleiste am rechten Rand über die ganze Höhe, links bleibt das abgedunkelte Formular sichtbar
  const lage = await lageNachDerFahrt(page);
  expect(lage.right).toBe(LAPTOP.width);
  expect(lage.top).toBe(0);
  expect(lage.bottom).toBe(LAPTOP.height);
  expect(lage.left).toBeGreaterThanOrEqual(96);
  // Das Blatt scrollt unter dem Kopf und schneidet an den runden Ecken ab, statt über sie zu laufen
  expect(await dialog(page).evaluate((el) => getComputedStyle(el).overflow)).toBe("hidden");
  // Modal: der Fokus steht im Dialog, der Rest der Seite ist nicht bedienbar
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
  expect(await axe(page), "Überblendung").toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(vorschauKnopf(page)).toBeFocused();
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Überblendung prüfen");
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

  // Auch der Knopf „Schließen“ und ein Klick neben das Blatt schließen
  await vorschauKnopf(page).click();
  await dialog(page).getByRole("button", { name: "Schließen" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await vorschauKnopf(page).click();
  await page.mouse.click(4, LAPTOP.height - 4);
  await expect(dialog(page)).toHaveCount(0);
  await expect(vorschauKnopf(page)).toBeFocused();
  await page.context().close();
});

test("Laptop: per Tastatur anheften, steht beim Scrollen fest, bleibt nach Neuladen, Vergrößern und Ausblenden", async ({ browser }) => {
  const page = await editor(browser, LAPTOP);
  await position(page, "Angeheftet prüfen");

  // Menü nach WAI-ARIA: Enter öffnet und setzt den Fokus auf den ersten Eintrag, Escape schließt zurück auf den Pfeil
  await pfeil(page).focus();
  await page.keyboard.press("Enter");
  await expect(pfeil(page)).toHaveAttribute("aria-expanded", "true");
  const eintrag = page.getByRole("menuitem", { name: "Neben Formular anheften" });
  await expect(eintrag).toBeFocused();
  expect(await axe(page), "Menü offen").toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(pfeil(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(eintrag).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(seitenansicht(page)).toBeVisible();
  await expect(pfeil(page)).toHaveAttribute("aria-expanded", "false");
  await expect(pfeil(page)).toBeFocused();
  await expect(seitenansicht(page).getByLabel("Vorschau der Rechnung")).toContainText("Angeheftet prüfen");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Angeheftet prüfen");
  // Formular und Vorschau nebeneinander, das Formular behält seine Mindestbreite (FORM_MIN_WIDTH)
  const [form, pane] = await Promise.all([page.locator("#invoice-form").boundingBox(), seitenansicht(page).boundingBox()]);
  expect(pane!.x).toBeGreaterThan(form!.x + form!.width);
  expect(form!.width).toBeGreaterThanOrEqual(640);

  // Beim Scrollen steht sie unter dem Kopf, das Blatt scrollt in ihrem eigenen Bereich
  await zumEnde(page);
  await sichtbar(seitenansicht(page).getByRole("button", { name: "Ausblenden" }));
  expect(await seitenansicht(page).evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual((await kopfUnterkante(page)) - 1);
  expect(await seitenansicht(page).evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(LAPTOP.height);
  const body = seitenansicht(page).locator(".preview-pane-body");
  expect(await body.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  // Eine einzelne Seite passt am Laptop gerade in die Karte; im niedrigeren Fenster muss sie in sich scrollen
  await page.setViewportSize({ width: LAPTOP.width, height: 560 });
  await expect.poll(() => body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // Verlauf nur an der Kante, hinter der es weitergeht; voll, sobald die Blattkante den Rand erreicht
  const verlauf = (kante: string) => body.evaluate((el, name) => Number((el.parentElement as HTMLElement).style.getPropertyValue(name)), kante);
  await expect.poll(() => verlauf("--fade-bottom")).toBe(1);
  expect(await verlauf("--fade-top")).toBe(0);
  await body.evaluate((el) => el.scrollTo(0, 6));
  await expect.poll(() => verlauf("--fade-top")).toBeGreaterThan(0);
  expect(await verlauf("--fade-top")).toBeLessThan(1);
  await body.evaluate((el) => el.scrollTo(0, 12));
  await expect.poll(() => verlauf("--fade-top")).toBe(1);
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(() => verlauf("--fade-bottom")).toBe(0);
  expect(await verlauf("--fade-top")).toBe(1);
  await body.evaluate((el) => el.scrollTo(0, 0));
  // Scrollt es, ist der Bereich per Tastatur erreichbar (WCAG 2.1.1)
  await expect(body).toHaveAttribute("tabindex", "0");
  expect(await axe(page), "angeheftet").toEqual([]);
  await page.setViewportSize(LAPTOP);

  // Je Gerät gemerkt
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(seitenansicht(page)).toBeVisible();
  await pfeil(page).click();
  await expect(page.getByRole("menuitem", { name: "Vorschau abheften" })).toBeVisible();
  await page.keyboard.press("Escape");

  const vergroessern = seitenansicht(page).getByRole("button", { name: "Vergrößern" });
  await vergroessern.click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(vergroessern).toBeFocused();

  await seitenansicht(page).getByRole("button", { name: "Ausblenden" }).click();
  await expect(seitenansicht(page)).toHaveCount(0);
  await expect(vorschauKnopf(page)).toBeFocused();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(pfeil(page)).toBeVisible();
  await expect(seitenansicht(page)).toHaveCount(0);
  await page.context().close();
});

/** Zählt an <html>, wie oft die angeheftete Vorschau zu fahren beginnt; ab dem nächsten Laden */
const fahrtenZaehlen = (p: Page) =>
  p.addInitScript(() => {
    document.addEventListener(
      "transitionrun",
      (event) => {
        if (!(event.target instanceof Element) || !event.target.matches(".preview-pane")) return;
        const html = document.documentElement;
        html.dataset.fahrten = String(Number(html.dataset.fahrten ?? 0) + 1);
      },
      true,
    );
  });
const fahrten = (p: Page) => p.evaluate(() => Number(document.documentElement.dataset.fahrten ?? 0));

test("Laptop: angeheftete Vorschau fährt auf Zuruf herein und hinaus, beim Laden und ohne Bewegung nicht", async ({ browser }) => {
  const page = await editor(browser, LAPTOP);
  await fahrtenZaehlen(page);
  await page.reload();
  await page.waitForLoadState("networkidle");

  const anheften = async () => {
    await pfeil(page).click();
    await page.getByRole("menuitem", { name: "Neben Formular anheften" }).click();
    await expect(seitenansicht(page)).toBeVisible();
  };
  await anheften();
  await expect.poll(() => fahrten(page)).toBe(1);
  // Die Fahrt von rechts zieht die Seite nicht in die Breite
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  // Beim Laden steht sie einfach da
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(seitenansicht(page)).toBeVisible();
  await page.waitForTimeout(100);
  expect(await fahrten(page)).toBe(0);

  // Hinaus: Der Fokus geht sofort zurück, erst nach der Fahrt bekommt das Formular wieder die volle Breite
  await seitenansicht(page).getByRole("button", { name: "Ausblenden" }).click();
  await expect(vorschauKnopf(page)).toBeFocused();
  await expect.poll(() => fahrten(page)).toBe(1);
  await expect(page.locator(".preview-pane")).toHaveCount(0);
  await expect.poll(() => page.locator("#invoice-form").evaluate((form) => form.getBoundingClientRect().width)).toBeGreaterThan(1000);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await anheften();
  await seitenansicht(page).getByRole("button", { name: "Ausblenden" }).click();
  await expect(page.locator(".preview-pane")).toHaveCount(0);
  expect(await fahrten(page)).toBe(1);
  await page.context().close();
});

test("Großer Bildschirm: ohne gespeicherte Wahl angeheftet", async ({ browser }) => {
  const page = await editor(browser, GROSS);
  await expect(seitenansicht(page)).toBeVisible();
  await page.context().close();
});

test("Handy: nur Überblendung, ohne Pfeil und ohne waagrechtes Scrollen", async ({ browser }) => {
  const page = await editor(browser, HANDY);
  await expect(vorschauKnopf(page)).toBeVisible();
  await expect(pfeil(page)).toHaveCount(0);
  await expect(seitenansicht(page)).toHaveCount(0);
  await vorschauKnopf(page).click();
  await expect(dialog(page)).toBeVisible();
  // Von unten über die ganze Breite, oben bleibt ein Streifen der Seite sichtbar
  const lage = await lageNachDerFahrt(page);
  expect(lage.left).toBe(0);
  expect(lage.right).toBe(HANDY.width);
  expect(lage.bottom).toBe(HANDY.height);
  expect(lage.top).toBeGreaterThan(0);
  expect(await dialog(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await axe(page), "Überblendung am Handy").toEqual([]);
  await dialog(page).getByRole("button", { name: "Schließen" }).click();
  await expect(vorschauKnopf(page)).toBeFocused();
  await page.context().close();
});

test("Angebot: dieselbe Vorschau", async ({ browser }) => {
  const page = await editor(browser, LAPTOP, "/angebote/neu");
  await vorschauKnopf(page).click();
  await expect(dialog(page).getByLabel("Vorschau des Angebots")).toBeVisible();
  await page.keyboard.press("Escape");
  await pfeil(page).click();
  await page.getByRole("menuitem", { name: "Neben Formular anheften" }).click();
  await expect(seitenansicht(page).getByLabel("Vorschau des Angebots")).toBeVisible();
  await page.context().close();
});

test("Gesperrter Speicher: Der Editor öffnet, Anheften gilt bis zum Neuladen", async ({ browser }) => {
  // Chrome mit gesperrten Websitedaten wirft schon beim Zugriff auf window.localStorage, nicht erst bei getItem
  const state = JSON.parse(readFileSync(SESSION, "utf8")) as { cookies: [] };
  const context = await browser.newContext({ viewport: LAPTOP, storageState: { cookies: state.cookies, origins: [] } });
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Access is denied for this document.", "SecurityError");
      },
    });
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/rechnungen/neu");
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Beschreibung Position 1")).toBeVisible();
  await pfeil(page).click();
  await page.getByRole("menuitem", { name: "Neben Formular anheften" }).click();
  await expect(seitenansicht(page)).toBeVisible();
  expect(pageErrors).toEqual([]);
  await context.close();
});
