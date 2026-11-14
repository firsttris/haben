import { expect, test, type Page } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { ANONYMOUS } from "./daten.ts";
import { ANDERE_FIRMEN, appDatabaseUrlFuer, FIRMEN_VIELE_PORT, habenFirmen } from "./durchlaeufe.ts";
import { axeVerstoesse, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";
import { serverEnvironment } from "./server-env.ts";

/**
 * Firma wechseln (#504) in eigener, leerer Datenbank (Projekt „firmen“, e2e/durchlaeufe.ts). Der Server hat
 * HABEN_FIRMEN mit sich selbst als „Studio Nord“ und zwei anderen Instanzen (playwright.config.ts). Der Inhaber
 * klappt in der Navigation die Zeile „Firma wechseln“ auf und wechselt über einen Link; die eigene Firma steht nicht
 * in der Liste, die Steuerberatung hat die Zeile nicht. Der Name unter „Haben“ kommt aus den Firmendaten
 * (firmenname.spec.ts, dort auch: ohne HABEN_FIRMEN keine Zeile), nicht aus HABEN_FIRMEN.
 */

test.describe.configure({ mode: "serial" });

const KANZLEI = { name: "Kanzlei Muster", email: "kanzlei@example.com", password: "kanzlei-passwort-e2e" };
const DESKTOP = { width: 1440, height: 900 };

let page: Page;
let pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
});

test.afterAll(async () => {
  expect(pageErrors).toEqual([]);
  await page.context().close();
});

const FIRMA = "Mustermann IT · Max Mustermann";
const [SUED, LANG] = ANDERE_FIRMEN as [(typeof ANDERE_FIRMEN)[number], (typeof ANDERE_FIRMEN)[number]];

const nav = (seite = page) => seite.getByRole("navigation", { name: "Hauptnavigation" });
const knopf = (seite = page) => nav(seite).getByRole("button", { name: "Firma wechseln" });
const auswahl = (seite = page) => nav(seite).getByRole("group", { name: "Firma wechseln" });

test("Inhaber klappt die Zeile auf und sieht nur die anderen Firmen", async () => {
  await einrichten(page);
  await gehe(page, "/");
  await expect(nav().getByRole("link", { name: `Haben ${FIRMA}` })).toBeVisible();
  await expect(knopf()).toHaveAttribute("aria-expanded", "false");
  await expect(auswahl()).toHaveCount(0);
  // Gleich nach der Marke in der Tab-Reihenfolge: Sprunglink, Marke, Zeile
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await expect(knopf()).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(knopf()).toHaveAttribute("aria-expanded", "true");
  expect(await auswahl().getAttribute("id")).toBe(await knopf().getAttribute("aria-controls"));
  await expect(auswahl().getByRole("link")).toHaveText([SUED.name, LANG.name]);
  await expect(auswahl().getByRole("link", { name: SUED.name })).toHaveAttribute("href", SUED.url);
  await expect(auswahl().getByRole("link", { name: SUED.name })).not.toHaveAttribute("target");
  // Die eigene Firma steht schon unter „Haben“: weder ihr Name aus HABEN_FIRMEN noch der aus den Firmendaten in der Liste
  await expect(nav().getByText("Studio Nord")).toHaveCount(0);
  await expect(auswahl().getByText(FIRMA)).toHaveCount(0);
  // Bei wenigen Firmen kein Suchfeld, der Fokus steht auf der ersten Firma
  await expect(auswahl().getByRole("searchbox")).toHaveCount(0);
  await expect(auswahl().getByRole("link", { name: SUED.name })).toBeFocused();
});

test("geöffnet ohne Verstöße gegen WCAG, hell und dunkel", async () => {
  for (const modus of ["hell", "dunkel"]) {
    await page.evaluate((m) => localStorage.setItem("haben-modus", m), modus);
    await gehe(page, "/");
    await knopf().click();
    await expect(auswahl().getByRole("link")).toHaveCount(2);
    expect(await axeVerstoesse(page), modus).toEqual([]);
  }
  await page.evaluate(() => localStorage.removeItem("haben-modus"));
});

test("schließt mit Klick, Escape, Tab aus der Liste und Klick daneben", async () => {
  await gehe(page, "/");
  await knopf().click();
  await expect(auswahl()).toBeVisible();
  await knopf().click();
  await expect(auswahl()).toHaveCount(0);
  await expect(knopf()).toHaveAttribute("aria-expanded", "false");

  await knopf().click();
  await page.keyboard.press("Escape");
  await expect(auswahl()).toHaveCount(0);
  await expect(knopf()).toBeFocused();

  // Zurück auf die Zeile bleibt die Liste offen, hinter der letzten Firma schließt sie
  await page.keyboard.press("Enter");
  await expect(auswahl().getByRole("link", { name: SUED.name })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(knopf()).toBeFocused();
  await expect(auswahl()).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await expect(nav().getByRole("link", { name: "Übersicht" })).toBeFocused();
  await expect(auswahl()).toHaveCount(0);

  await knopf().click();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(auswahl()).toHaveCount(0);
});

// Review: Die Liste klappt im Fluss auf und schiebt die Menüpunkte nach unten. Schließt sie schon beim Drücken der
// Maustaste, rutschen die Menüpunkte unter dem Zeiger weg, bevor die Taste losgelassen ist, und der Klick geht verloren
test("ein Klick auf einen Menüpunkt unter der offenen Liste führt dorthin und schließt sie", async ({ browser }) => {
  await gehe(page, "/");
  await knopf().click();
  await expect(auswahl()).toBeVisible();
  await nav().getByRole("link", { name: "Belege", exact: true }).click();
  await expect(page).toHaveURL(/\/belege$/);
  await expect(auswahl()).toHaveCount(0);

  // Am Handy im Menü ebenso, mit dem Finger
  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 }, hasTouch: true });
  const handy = await context.newPage();
  await gehe(handy, "/");
  await nav(handy).getByRole("button", { name: "Menü" }).tap();
  await knopf(handy).tap();
  await expect(auswahl(handy)).toBeVisible();
  await nav(handy).getByRole("link", { name: "Belege", exact: true }).tap();
  await expect(handy).toHaveURL(/\/belege$/);
  await context.close();
});

test("ein Klick auf eine Firma führt im selben Tab zu ihrer Adresse", async () => {
  // Die andere Instanz gibt es im Test nicht
  await page.route(`${SUED.url}/**`, (route) => route.fulfill({ contentType: "text/html", body: "<title>Werkstatt Süd</title>" }));
  await gehe(page, "/");
  await knopf().click();
  await auswahl().getByRole("link", { name: SUED.name }).click();
  await expect(page).toHaveURL(`${SUED.url}/`);
  expect(page.context().pages()).toHaveLength(1);
  await page.unroute(`${SUED.url}/**`);
});

// HABEN_FIRMEN erlaubt Namen bis 60 Zeichen; ein langes zusammengesetztes Wort darf die Navigation nicht sprengen
test("ein langer Firmenname bricht um, ohne waagrechtes Scrollen", async () => {
  for (const viewport of [DESKTOP, { width: 320, height: 720 }]) {
    await page.setViewportSize(viewport);
    await gehe(page, "/");
    if (viewport.width < 861) await nav().getByRole("button", { name: "Menü" }).click();
    await knopf().click();
    await expect(auswahl().getByRole("link", { name: LANG.name })).toBeVisible();
    const ueberlauf = await auswahl()
      .getByRole("link", { name: LANG.name })
      .evaluate((link) => {
        const navigation = document.querySelector<HTMLElement>("nav.nav")!;
        const liste = link.closest("ul")!;
        return {
          seite: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          nav: navigation.scrollWidth - navigation.clientWidth,
          liste: liste.scrollWidth - liste.clientWidth,
          link: link.scrollWidth - link.clientWidth,
        };
      });
    expect(ueberlauf, `${viewport.width}px`).toEqual({ seite: 0, nav: 0, liste: 0, link: 0 });
  }
  await page.setViewportSize(DESKTOP);
});

test("am Handy im Menü: Escape schließt erst die Liste, dann das Menü", async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gehe(page, "/");
  await expect(nav().getByText(FIRMA)).toBeVisible();
  const menue = nav().getByRole("button", { name: "Menü" });
  await expect(knopf()).toBeHidden();
  await menue.click();
  await knopf().click();
  const link = auswahl().getByRole("link", { name: SUED.name });
  await expect(link).toBeVisible();
  // Tippflächen von 44px wie die übrigen Zeilen des Menüs
  for (const zeile of [knopf(), link]) expect((await zeile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await axeVerstoesse(page)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(auswahl()).toHaveCount(0);
  await expect(menue).toHaveAttribute("aria-expanded", "true");
  await expect(knopf()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menue).toHaveAttribute("aria-expanded", "false");
  await expect(menue).toBeFocused();
  await page.setViewportSize(DESKTOP);
});

test("Steuerberatung sieht den Namen der Firma, aber keine Zeile zum Wechseln", async ({ browser }) => {
  await gehe(page, "/einstellungen?bereich=sicherheit");
  await page.getByLabel("Bezeichnung").fill(KANZLEI.name);
  await page.getByRole("button", { name: "Einladungslink erzeugen" }).click();
  const feld = page.getByRole("textbox", { name: /Einladungslink für/ });
  await expect(feld).toHaveValue(/\/einladung\//);
  const url = await feld.inputValue();

  const context = await browser.newContext(ANONYMOUS);
  const stb = await context.newPage();
  await stb.goto(url);
  await stb.getByLabel("Name").fill(KANZLEI.name);
  await stb.getByLabel("E-Mail").fill(KANZLEI.email);
  await stb.getByLabel("Passwort (mindestens 12 Zeichen)").fill(KANZLEI.password);
  await stb.getByRole("button", { name: "Zugang anlegen" }).click();
  await stb.getByRole("button", { name: "Später" }).click();
  await stb.waitForURL(/\/steuerberatung$/);
  await expect(nav(stb).getByText(FIRMA)).toBeVisible();
  await expect(knopf(stb)).toHaveCount(0);
  await expect(stb.getByText("Firma wechseln")).toHaveCount(0);
  await expect(stb.getByText(SUED.name)).toHaveCount(0);
  await context.close();
});

// Review Runde 2: Der Seitenkopf klebt am Handy bei --nav-height (60px) unter der Navigation; mit dem Firmennamen unter
// „Haben“ darf die Leiste nicht höher werden, sonst verdeckt sie beim Scrollen den Kopf. Auch ein langer Name auf 320px
test("am Handy bleibt die Leiste mit dem Firmennamen so hoch wie --nav-height", async () => {
  const hoehen: Record<string, number> = {};
  let variable = 0;
  for (const [breite, name] of [
    [375, FIRMA],
    [320, "Garten- und Landschaftsbau Müller und Söhne GmbH & Co. KG"],
  ] as const) {
    await page.setViewportSize({ width: breite, height: 812 });
    await gehe(page, "/");
    await nav()
      .locator(".brand-firma")
      .evaluate((el, text) => {
        el.textContent = text;
      }, name);
    const gemessen = await page.evaluate(() => ({
      leiste: Math.round(document.querySelector<HTMLElement>("nav.nav")!.getBoundingClientRect().height),
      variable: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")),
    }));
    hoehen[`${breite}px`] = gemessen.leiste;
    variable = gemessen.variable;
  }
  await page.setViewportSize(DESKTOP);
  expect(variable).toBe(60);
  expect(hoehen).toEqual({ "375px": 60, "320px": 60 });
});

/*
 * Ab 20 anderen Firmen hat die Liste ein Suchfeld. HABEN_FIRMEN liest der Server beim Start, deshalb ein zweiter auf
 * derselben Datenbank mit 20 anderen Firmen; die Sitzung des Inhabers gilt auch dort (gleiches Geheimnis, Cookies
 * hängen nicht am Port). Wie beenden.spec.ts nur gegen den gebauten Server (E2E_SERVER_COMMAND).
 */
test.describe("mit 20 anderen Firmen", () => {
  const command = process.env.E2E_SERVER_COMMAND;
  const adresse = `http://localhost:${FIRMEN_VIELE_PORT}`;
  const viele = [SUED, ...Array.from({ length: 19 }, (_, i) => ({ name: `Filiale ${i + 1}`, url: `https://filiale${i + 1}.example.de` }))];
  let server: ChildProcess;

  test.skip(!command, "nur gegen den gebauten Server (E2E_SERVER_COMMAND)");

  test.beforeAll(async () => {
    // exec: kill() trifft den Server selbst, nicht nur die Shell
    server = spawn("sh", ["-c", `exec ${command}`], {
      stdio: "ignore",
      env: serverEnvironment({
        ...process.env,
        DATABASE_URL: appDatabaseUrlFuer("firmen", "firmen-viele"),
        PORT: String(FIRMEN_VIELE_PORT),
        BETTER_AUTH_URL: adresse,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
        HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
        HABEN_SCHEDULER: "off",
        HABEN_SETUP_CODE: "e2e-einrichtungscode",
        HABEN_FIRMEN: habenFirmen(adresse, viele),
      }),
    });
    const erreichbar = () =>
      fetch(`${adresse}/login`).then(
        (antwort) => antwort.status < 500,
        () => false,
      );
    await expect.poll(erreichbar, { timeout: 30_000 }).toBe(true);
  });

  test.afterAll(() => {
    server?.kill("SIGKILL");
  });

  test("grenzt die Liste über das Suchfeld ein", async () => {
    await gehe(page, `${adresse}/`);
    await knopf().click();
    const suche = auswahl().getByRole("searchbox", { name: "Firma suchen" });
    await expect(suche).toBeFocused();
    await expect(auswahl().getByRole("link")).toHaveCount(20);
    expect(await axeVerstoesse(page)).toEqual([]);

    await page.keyboard.type("WERK");
    await expect(auswahl().getByRole("link")).toHaveText([SUED.name]);
    await suche.fill("Filiale 1");
    // Filiale 1 und 10 bis 19
    await expect(auswahl().getByRole("link")).toHaveCount(11);
    await suche.fill("gibt es nicht");
    await expect(auswahl().getByRole("link")).toHaveCount(0);
    await expect(auswahl().getByRole("status")).toHaveText("Keine Firma gefunden.");

    // Escape schließt die Liste, beim nächsten Öffnen ist die Suche leer
    await page.keyboard.press("Escape");
    await expect(knopf()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(suche).toHaveValue("");
    await expect(auswahl().getByRole("link")).toHaveCount(20);
    // Die Liste rollt in sich, die Navigation wird nicht breiter
    const gemessen = await auswahl()
      .getByRole("list")
      .evaluate((liste) => ({ rollt: liste.scrollHeight > liste.clientHeight, breiter: liste.scrollWidth - liste.clientWidth }));
    expect(gemessen).toEqual({ rollt: true, breiter: 0 });
  });
});
