import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";
import { HANDY } from "./kopfzeile.ts";

/**
 * Gestaltung der Belege (#113): Zahnrad in der Vorschau, Spalte neben dem Blatt, Speichern für alle künftigen Belege.
 * Mit der Sitzung aus app.spec.ts (Projekt „mit-daten“). Die Tests setzen die Gestaltung am Ende zurück.
 */

// Alle Tests ändern dasselbe Standardprofil und dasselbe Logo; nebeneinander überschrieben sie sich gegenseitig
test.describe.configure({ mode: "default" });

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const SCHMAL = { width: 1400, height: 800 };
const BREIT = { width: 1920, height: 1080 };

async function editor(browser: Browser, viewport: { width: number; height: number }, mode: "angeheftet" | "ueberblendung" = "ueberblendung"): Promise<Page> {
  const state = JSON.parse(readFileSync(SESSION, "utf8")) as {
    cookies: [];
    origins: { origin: string; localStorage: { name: string; value: string }[] }[];
  };
  const origins = state.origins.map((o) => ({
    ...o,
    localStorage: [...o.localStorage.filter((item) => item.name !== "haben-vorschau"), { name: "haben-vorschau", value: mode }],
  }));
  const page = await (await browser.newContext({ viewport, storageState: { ...state, origins } })).newPage();
  await page.goto("/rechnungen/neu");
  await page.waitForLoadState("networkidle");
  return page;
}

const head = (p: Page) => p.locator(".main > .page-head");
const vorschauKnopf = (p: Page) => head(p).getByRole("button", { name: "Vorschau", exact: true });
const seitenansicht = (p: Page) => p.getByRole("region", { name: "Vorschau", exact: true });
const dialog = (p: Page) => p.getByRole("dialog", { name: "Vorschau" });
const panel = (p: Page) => dialog(p).getByRole("complementary", { name: "Gestaltung" });
const blatt = (p: Page) => dialog(p).getByLabel("Vorschau der Rechnung");
const brand = (p: Page) => blatt(p).evaluate((el) => getComputedStyle(el).getPropertyValue("--brand").trim());

async function gestaltungOeffnen(p: Page): Promise<void> {
  await vorschauKnopf(p).click();
  await dialog(p).getByRole("button", { name: "Gestaltung" }).click();
  await expect(panel(p)).toBeVisible();
}

test("Die Knöpfe der angehefteten Vorschau stehen rechts, auch wenn sie in die zweite Zeile rutschen", async ({ browser }) => {
  const page = await editor(browser, SCHMAL, "angeheftet");
  const kopf = await page.locator(".preview-pane-head").boundingBox();
  const knoepfe = await page.locator(".preview-pane-actions").boundingBox();
  expect(knoepfe!.x + knoepfe!.width).toBeCloseTo(kopf!.x + kopf!.width, 0);
  await page.context().close();
});

test("Die Spalte Gestaltung zeigt Änderungen sofort und verwirft sie", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  const vorher = await brand(page);

  await panel(page).getByRole("button", { name: "Blau" }).click();
  await expect.poll(() => brand(page)).toBe("#1D4E89");
  await expect(panel(page).getByRole("button", { name: "Für alle Belege speichern" })).toBeEnabled();

  await panel(page).getByRole("button", { name: "Verwerfen" }).click();
  await expect.poll(() => brand(page)).toBe(vorher);
  await expect(panel(page).getByRole("button", { name: "Für alle Belege speichern" })).toBeDisabled();
  await page.context().close();
});

test("Die Farbkreise stehen nebeneinander, auch mit den Stilen der Auswertungen", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.addStyleTag({ content: readFileSync("src/styles/auswertungen.css", "utf8") });
  await gestaltungOeffnen(page);
  const blau = await panel(page).getByRole("button", { name: "Blau" }).boundingBox();
  const gruen = await panel(page).getByRole("button", { name: "Grün" }).boundingBox();
  expect(blau!.width).toBeGreaterThan(40);
  expect(blau!.x).toBeGreaterThanOrEqual(gruen!.x + gruen!.width);
  // Sieben Punkte in einer Zeile: Der Regenbogen rutscht nicht um
  const regenbogen = await panel(page).getByLabel("Eigene Farbe wählen").boundingBox();
  expect(regenbogen!.y).toBeCloseTo(gruen!.y, 0);
  await page.context().close();
});

test("Der Regenbogen-Punkt setzt eine eigene Farbe und zeigt sie an", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  await panel(page).getByLabel("Eigene Farbe wählen").fill("#123456");
  await expect.poll(() => brand(page)).toBe("#123456");
  await expect(panel(page)).toContainText("#123456");
  await panel(page).getByRole("button", { name: "Grün" }).click();
  await expect(panel(page)).not.toContainText("Eigene Farbe #");
  await page.context().close();
});

test("Das Logo lässt sich im Panel hochladen und entfernen, das Formular bleibt", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.getByLabel("Beschreibung Position 1").fill("Eingabe bleibt");
  await gestaltungOeffnen(page);
  await panel(page).getByLabel("Logodatei").setInputFiles("public/icon-192.png");
  await expect(panel(page).getByRole("status")).toContainText("Logo gespeichert");
  await expect(blatt(page).getByRole("img", { name: "Logo" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Entfernen" }).click();
  await expect(blatt(page).getByRole("img", { name: "Logo" })).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "Schließen" }).click();
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Eingabe bleibt");
  await page.context().close();
});

test("Schalter wirken auf das Blatt", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  await expect(blatt(page).locator(".sheet-fold").first()).toBeAttached();
  await panel(page).getByLabel("Falz- und Lochmarken").uncheck();
  await expect(blatt(page).locator(".sheet-fold")).toHaveCount(0);
  await page.context().close();
});

test("Die Spalte USt entfällt nur bei einem einzigen Steuersatz, sonst sagt das Panel warum", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("2");
  await page.getByLabel(/Einzelpreis Position 1/).fill("10,00");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 2").fill("Fachbuch");
  await page.getByLabel("Menge Position 2").fill("1");
  await page.getByLabel(/Einzelpreis Position 2/).fill("39,00");
  await page.getByLabel("Steuersatz Position 2").selectOption("700");
  await gestaltungOeffnen(page);
  const spalte = blatt(page).locator("th", { hasText: "USt" });
  await panel(page).getByLabel("Spalte USt je Position").uncheck();
  await expect(spalte).toHaveCount(1);
  await expect(panel(page).getByRole("status")).toContainText("mehrere Steuersätze");
  await page.context().close();
});

test("Schließen verwirft ungespeicherte Änderungen, die Vorschau zeigt wieder das, was das PDF zeigt", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  const vorher = await brand(page);
  await panel(page).getByRole("button", { name: "Rot" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await vorschauKnopf(page).click();
  await expect.poll(() => brand(page)).toBe(vorher);
  await page.context().close();
});

test("Speichern gilt nach dem Neuladen und lässt das Formular stehen", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.getByLabel("Beschreibung Position 1").fill("Eingabe bleibt");
  await gestaltungOeffnen(page);
  const vorher = await brand(page);

  await panel(page).getByRole("button", { name: "Violett" }).click();
  await panel(page).getByRole("button", { name: "Für alle Belege speichern" }).click();
  await expect(panel(page).getByRole("status")).toContainText("Gespeichert");
  await dialog(page).getByRole("button", { name: "Schließen" }).click();
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Eingabe bleibt");

  await page.reload();
  await page.waitForLoadState("networkidle");
  await gestaltungOeffnen(page);
  expect(await brand(page)).toBe("#6B3FA0");

  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const akzent = page.getByRole("form", { name: "Akzentfarbe" });
  await akzent.getByLabel("Hex-Wert").fill(vorher.toUpperCase());
  await akzent.getByRole("button", { name: "Übernehmen" }).click();
  await expect(akzent.getByRole("status")).toContainText("Akzentfarbe gespeichert.");
  await page.context().close();
});

test("Änderungen, die während des Speicherns entstehen, bleiben als ungespeichert stehen", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  const vorher = await brand(page);
  let weiter = () => {};
  const gehalten = new Promise<void>((resolve) => {
    weiter = resolve;
  });
  await page.route("**/_serverFn/**", async (route) => {
    await gehalten;
    await route.continue();
  });

  await panel(page).getByRole("button", { name: "Violett" }).click();
  await panel(page).getByRole("button", { name: "Für alle Belege speichern" }).click();
  await panel(page).getByRole("button", { name: "Blau" }).click();
  weiter();
  await expect(panel(page).getByRole("status")).toContainText("Gespeichert");

  expect(await brand(page)).toBe("#1D4E89");
  await expect(panel(page).getByRole("button", { name: "Für alle Belege speichern" })).toBeEnabled();

  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const akzent = page.getByRole("form", { name: "Akzentfarbe" });
  await akzent.getByLabel("Hex-Wert").fill(vorher.toUpperCase());
  await akzent.getByRole("button", { name: "Übernehmen" }).click();
  await expect(akzent.getByRole("status")).toContainText("Akzentfarbe gespeichert.");
  await page.context().close();
});

test("Das Zahnrad der angehefteten Vorschau öffnet die Überblendung mit der Spalte", async ({ browser }) => {
  const page = await editor(browser, BREIT, "angeheftet");
  await seitenansicht(page).getByRole("button", { name: "Gestaltung" }).click();
  await expect(panel(page)).toBeVisible();
  await page.context().close();
});

test("Am Handy stehen Blatt und Gestaltung untereinander, ohne seitliches Scrollen", async ({ browser }) => {
  const page = await editor(browser, HANDY);
  await gestaltungOeffnen(page);
  const breite = await page.evaluate(() => document.querySelector("dialog")!.scrollWidth - document.querySelector("dialog")!.clientWidth);
  expect(breite).toBe(0);
  await page.context().close();
});

test("Die Einstellungen nennen je Belegart das eingebaute Layout", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Layouts" });
  await expect(karte.getByRole("row")).toHaveCount(6);
  await expect(karte.getByRole("row", { name: /Mahnung/ })).toContainText("Klassisch");
  await expect(karte.getByRole("row", { name: /Mahnung/ })).toContainText("Eingebaut");
  await page.context().close();
});

test("Spalte Gestaltung ohne Befund von axe", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.context().close();
});

const einstellungenNav = (p: Page) => p.getByRole("navigation", { name: "Bereiche der Einstellungen" });

async function bereichHinUndZurueck(page: Page): Promise<void> {
  await einstellungenNav(page)
    .getByRole("link", { name: /^Rechnungen/ })
    .click();
  await expect(page.getByRole("form", { name: "Nummernformat" })).toBeVisible();
  await einstellungenNav(page)
    .getByRole("link", { name: /^Beleggestaltung/ })
    .click();
  await expect(page.getByRole("region", { name: "Logo und Blatt" })).toBeVisible();
}

test("Eine gespeicherte Logo-Größe steht nach dem Wechsel des Bereichs noch da", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Logo und Blatt" });
  const groesse = karte.getByRole("group", { name: "Größe des Logos" });
  await groesse.getByRole("button", { name: "L", exact: true }).click();
  await karte.getByRole("button", { name: "Speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Gespeichert");
  await bereichHinUndZurueck(page);
  try {
    await expect(groesse.getByRole("button", { name: "L", exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await page.goto("/einstellungen?bereich=gestaltung");
    await page.waitForLoadState("networkidle");
    await groesse.getByRole("button", { name: "M", exact: true }).click();
    await karte.getByRole("button", { name: "Speichern" }).click();
    await expect(karte.getByRole("status").last()).toContainText("Gespeichert");
    await page.context().close();
  }
});

test("Ein hochgeladenes Logo steht nach dem Wechsel des Bereichs noch da", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Logo und Blatt" });
  const entfernen = karte.getByRole("button", { name: "Entfernen" });
  if (await entfernen.isVisible()) {
    await entfernen.click();
    await expect(karte.getByText("Noch kein Logo.")).toBeVisible();
    await page.reload();
    await page.waitForLoadState("networkidle");
  }
  await karte.getByLabel("Logodatei").setInputFiles("public/icon-192.png");
  await expect(karte.getByRole("img", { name: "Aktuelles Logo" })).toBeVisible();
  await bereichHinUndZurueck(page);
  await expect(karte.getByRole("img", { name: "Aktuelles Logo" })).toBeVisible();
  await page.context().close();
});

test("Die Vorschau im Editor zeigt die in den Einstellungen gespeicherte Farbe, auch nach Zurück im Browser", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.getByRole("link", { name: "Einstellungen" }).first().click();
  await einstellungenNav(page)
    .getByRole("link", { name: /^Beleggestaltung/ })
    .click();
  const akzent = page.getByRole("form", { name: "Akzentfarbe" });
  const vorher = await akzent.getByLabel("Hex-Wert").inputValue();
  await akzent.getByLabel("Hex-Wert").fill("#123456");
  await akzent.getByRole("button", { name: "Übernehmen" }).click();
  await expect(akzent.getByRole("status")).toContainText("Akzentfarbe gespeichert.");
  try {
    await page.goBack();
    await page.goBack();
    await page.waitForLoadState("networkidle");
    await gestaltungOeffnen(page);
    await expect.poll(() => brand(page)).toBe("#123456");
  } finally {
    await page.goto("/einstellungen?bereich=gestaltung");
    await page.waitForLoadState("networkidle");
    await akzent.getByLabel("Hex-Wert").fill(vorher);
    await akzent.getByRole("button", { name: "Übernehmen" }).click();
    await expect(akzent.getByRole("status")).toContainText("Akzentfarbe gespeichert.");
    await page.context().close();
  }
});

test("Die Knöpfe der Logo-Größe tragen ihre sichtbare Beschriftung im zugänglichen Namen (WCAG 2.5.3)", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  const gruppe = panel(page).getByRole("group", { name: "Größe des Logos" });
  for (const sichtbar of ["S", "M", "L"]) await expect(gruppe.getByRole("button", { name: sichtbar, exact: true })).toHaveCount(1);
  await page.context().close();
});

test("Eine gespeicherte Fußzeile steht nach dem Wechsel des Bereichs noch da", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Fußzeile" });
  await karte.getByLabel("Eigene Fußzeile").check();
  await karte.getByRole("button", { name: "4", exact: true }).click();
  await karte.getByLabel("Spalte 4").fill("Sprechzeiten Mo bis Fr");
  await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");
  await bereichHinUndZurueck(page);
  try {
    await expect(karte.getByLabel("Eigene Fußzeile")).toBeChecked();
    await expect(karte.getByLabel("Spalte 4")).toHaveValue("Sprechzeiten Mo bis Fr");
  } finally {
    await page.goto("/einstellungen?bereich=gestaltung");
    await page.waitForLoadState("networkidle");
    await karte.getByLabel("Eigene Fußzeile").uncheck();
    await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
    await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");
    await page.context().close();
  }
});

test("Eigene Fußzeile: Platzhalter, Prüfung und Übernahme aufs Blatt", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Fußzeile" });
  await karte.getByLabel("Eigene Fußzeile").check();
  await karte.getByRole("button", { name: "4", exact: true }).click();

  await karte.getByLabel("Spalte 3").fill("");
  await expect(karte.getByRole("alert")).toContainText("Steuernummer oder USt-IdNr.");
  await expect(karte.getByRole("button", { name: "Fußzeile speichern" })).toBeDisabled();
  await karte.getByLabel("Spalte 3").fill("{steuernummer}");
  await expect(karte.getByRole("alert")).toHaveCount(0);

  await karte.getByLabel("Spalte 4").fill("{fax}");
  await expect(karte.getByRole("alert")).toContainText("{fax}");
  await expect(karte.getByRole("button", { name: "Fußzeile speichern" })).toBeDisabled();

  await karte.getByLabel("Spalte 4").fill("Sprechzeiten Mo bis Fr ");
  await karte.getByRole("button", { name: "{email}" }).click();
  await expect(karte.getByLabel("Spalte 4")).toHaveValue(/\{email\}/);
  await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");

  await page.goto("/rechnungen/neu");
  await page.waitForLoadState("networkidle");
  await vorschauKnopf(page).click();
  await expect(blatt(page).locator(".sheet-foot")).toContainText("Sprechzeiten Mo bis Fr");

  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  await karte.getByLabel("Eigene Fußzeile").uncheck();
  await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");
  await page.context().close();
});

test("Eine Fußzeile über 400 Zeichen meldet das verständlich auf Deutsch", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Fußzeile" });
  await karte.getByLabel("Eigene Fußzeile").check();
  await karte.getByLabel("Spalte 1").fill(`{steuernummer} ${"x".repeat(380)}`);
  await karte.getByLabel("Spalte 1").focus();
  // Das maxLength des Felds wirkt nur beim Tippen: Die Platzhalter-Knöpfe kommen darüber hinweg
  await karte.getByRole("button", { name: "{kontoinhaber}" }).click();
  await karte.getByRole("button", { name: "{kontoinhaber}" }).click();
  const speichern = karte.getByRole("button", { name: "Fußzeile speichern" });
  if (await speichern.isEnabled()) await speichern.click();
  const meldung = karte.locator(".banner-danger, [role=alert]").first();
  try {
    await expect(meldung).toBeVisible();
    await expect(meldung).not.toContainText("Too big");
    await expect(meldung).toContainText(/Zeichen/);
  } finally {
    await page.context().close();
  }
});

test("Die Schrift wirkt sofort aufs Blatt", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  const schrift = () => blatt(page).evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await schrift()).toContain("IBM Plex Sans");

  await panel(page).getByLabel("Schrift").selectOption({ label: "IBM Plex Serif" });
  await expect.poll(schrift).toContain("IBM Plex Serif");
  await panel(page).getByRole("button", { name: "Verwerfen" }).click();
  await expect.poll(schrift).toContain("IBM Plex Sans");
  await page.context().close();
});

test("Briefpapier: hochladen, auf dem Blatt sehen, entfernen", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Briefpapier" });
  await expect(karte.getByText("Noch kein Briefpapier.")).toBeVisible();
  await karte.getByLabel("Datei für das Briefpapier").setInputFiles("public/icon-192.png");
  await expect(karte.getByRole("img", { name: "Aktuelles Briefpapier" })).toBeVisible();
  await karte.getByRole("button", { name: "Alle Seiten" }).click();
  await karte.getByRole("button", { name: "Speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Gespeichert");

  await page.goto("/rechnungen/neu");
  await page.waitForLoadState("networkidle");
  await vorschauKnopf(page).click();
  await expect.poll(() => blatt(page).evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("/api/briefpapier");

  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  await expect(karte.getByRole("button", { name: "Alle Seiten" })).toHaveAttribute("aria-pressed", "true");
  await karte.getByRole("button", { name: "Erste Seite" }).click();
  await karte.getByRole("button", { name: "Speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Gespeichert");
  await karte.getByRole("button", { name: "Entfernen" }).click();
  await expect(karte.getByText("Noch kein Briefpapier.")).toBeVisible();
  await page.context().close();
});

test("Nach dem Verringern der Spalten fügt ein Platzhalter-Knopf in eine sichtbare Spalte ein", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Fußzeile" });
  await karte.getByLabel("Eigene Fußzeile").check();
  await karte.getByRole("button", { name: "4", exact: true }).click();
  await karte.getByLabel("Spalte 4").click();
  await karte.getByRole("button", { name: "2", exact: true }).click();

  await karte.getByRole("button", { name: "{email}" }).click();

  const sichtbar = `${await karte.getByLabel("Spalte 1").inputValue()}\n${await karte.getByLabel("Spalte 2").inputValue()}`;
  await page.context().close();
  // Die Vorgabe in Spalte 1 hat schon ein {email}; der Klick muss ein zweites bringen
  expect((sichtbar.match(/\{email\}/g) ?? []).length).toBe(2);
});

test("Briefpapier mit eigenem Fuß: Fußzeile weglassen nur nach Rückfrage und nur mit Briefpapier", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Briefpapier" });
  const schalter = karte.getByLabel("Fußzeile steht auf dem Briefpapier");
  await expect(schalter).toBeDisabled();

  await karte.getByLabel("Datei für das Briefpapier").setInputFiles("public/icon-192.png");
  await expect(karte.getByRole("img", { name: "Aktuelles Briefpapier" })).toBeVisible();
  await expect(schalter).toBeEnabled();

  await schalter.click();
  const rueckfrage = page.getByRole("dialog", { name: "Fußzeile weglassen?" });
  await expect(rueckfrage.getByText(/Steuernummer oder USt-IdNr\. muss dann auf dem Briefpapier stehen/)).toBeVisible();
  await expect(schalter).not.toBeChecked();
  await rueckfrage.getByRole("button", { name: "Abbrechen" }).click();
  await expect(schalter).not.toBeChecked();

  await schalter.click();
  await rueckfrage.getByRole("button", { name: "Fußzeile weglassen" }).click();
  await expect(schalter).toBeChecked();
  await karte.getByRole("button", { name: "Speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Gespeichert");

  await page.goto("/rechnungen/neu");
  await page.waitForLoadState("networkidle");
  await vorschauKnopf(page).click();
  await expect(blatt(page).locator(".sheet-foot")).toHaveCount(0);

  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  await schalter.uncheck();
  await karte.getByRole("button", { name: "Speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Gespeichert");
  await karte.getByRole("button", { name: "Entfernen" }).click();
  await expect(karte.getByText("Noch kein Briefpapier.")).toBeVisible();
  await page.context().close();
});

test("Entfernen des Briefpapiers nimmt auch ein noch nicht gespeichertes „Fußzeile weglassen“ zurück", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Briefpapier" });
  const schalter = karte.getByLabel("Fußzeile steht auf dem Briefpapier");
  await karte.getByLabel("Datei für das Briefpapier").setInputFiles("public/icon-192.png");
  await expect(karte.getByRole("img", { name: "Aktuelles Briefpapier" })).toBeVisible();
  await schalter.click();
  await page.getByRole("dialog", { name: "Fußzeile weglassen?" }).getByRole("button", { name: "Fußzeile weglassen" }).click();
  await expect(schalter).toBeChecked();
  await karte.getByRole("button", { name: "Entfernen" }).click();
  await expect(karte.getByText("Noch kein Briefpapier.")).toBeVisible();
  await expect(schalter).not.toBeChecked();
  await page.context().close();
});

test("Vorschau: Ein hoher Fuß deckt den Hinweis auf einem vollen Blatt nicht zu", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Fußzeile" });
  const zeile = "Zahlbar innerhalb von vierzehn Tagen ohne Abzug";
  const spalte = Array.from({ length: 5 }, () => zeile).join("\n");
  await karte.getByLabel("Eigene Fußzeile").check();
  await karte.getByRole("button", { name: "4", exact: true }).click();
  for (const nummer of [1, 2, 3]) await karte.getByLabel(`Spalte ${nummer}`).fill(spalte);
  await karte.getByLabel("Spalte 4").fill("{steuernummer}");
  await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");
  try {
    await page.goto("/rechnungen/neu");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Hinweis auf der Rechnung (optional)").fill(Array.from({ length: 90 }, (_, i) => `Hinweiszeile ${i + 1}`).join("\n"));
    await vorschauKnopf(page).click();
    const foot = (await blatt(page).locator(".sheet-foot").boundingBox())!;
    const hinweis = (await blatt(page).getByText("Hinweiszeile 90").boundingBox())!;
    expect(hinweis.y + hinweis.height).toBeLessThanOrEqual(foot.y);
  } finally {
    await page.goto("/einstellungen?bereich=gestaltung");
    await page.waitForLoadState("networkidle");
    await karte.getByLabel("Eigene Fußzeile").uncheck();
    await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
    await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");
    await page.context().close();
  }
});

test("Die Meldung „Fußzeile gespeichert“ bleibt stehen, wenn sich die Spalten ändern", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Fußzeile" });
  await karte.getByLabel("Eigene Fußzeile").check();
  await karte.getByLabel("Spalte 1").fill("Sprechzeiten Mo bis Fr");
  await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  try {
    await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert", { timeout: 1000 });
  } finally {
    await karte.getByLabel("Eigene Fußzeile").uncheck();
    await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
    await page.waitForLoadState("networkidle");
    await page.context().close();
  }
});

test("Eigene Fußzeile: Auszeichnungen stehen fett auf dem Blatt, die Zeichen nicht", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Fußzeile" });
  await karte.getByLabel("Eigene Fußzeile").check();
  await karte.getByLabel("Spalte 1").fill("*Fettzeile*");
  await expect(karte.locator(".footer-preview strong")).toHaveText("Fettzeile");
  await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");
  try {
    await page.goto("/rechnungen/neu");
    await page.waitForLoadState("networkidle");
    await vorschauKnopf(page).click();
    await expect(blatt(page).locator(".sheet-foot strong")).toHaveText("Fettzeile");
    await expect(blatt(page).locator(".sheet-foot")).not.toContainText("*Fettzeile*");
  } finally {
    await page.goto("/einstellungen?bereich=gestaltung");
    await page.waitForLoadState("networkidle");
    await karte.getByLabel("Eigene Fußzeile").uncheck();
    await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
    await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");
    await page.context().close();
  }
});

test("Zwei Platzhalter nacheinander landen beide an der Schreibmarke", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Fußzeile" });
  await karte.getByLabel("Eigene Fußzeile").check();
  const feld = karte.getByLabel("Spalte 1");
  await feld.fill("Tel. \nEnde");
  await feld.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(5, 5);
  });

  await karte.getByRole("button", { name: "{plz}" }).click();
  await karte.getByRole("button", { name: "{ort}" }).click();

  const wert = await feld.inputValue();
  await page.context().close();
  expect(wert).toBe("Tel. {plz}{ort}\nEnde");
});

test("Vorschau: Die Steuerzeile bricht auch in einer breiten Schrift nicht um", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.getByLabel("Beschreibung Position 1").fill("Workshop");
  await page.getByLabel("Menge Position 1").fill("400");
  await page.getByLabel(/Einzelpreis Position 1/).fill("12345,67");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 2").fill("Fachbuch");
  await page.getByLabel("Menge Position 2").fill("400");
  await page.getByLabel(/Einzelpreis Position 2/).fill("4990,00");
  await page.getByLabel("Steuersatz Position 2").selectOption({ index: 1 });
  await gestaltungOeffnen(page);
  await panel(page).getByLabel("Schrift").selectOption({ label: "Inter" });
  const zeile = blatt(page).locator(".sheet-totals dt", { hasText: "19 %" });
  const normal = blatt(page).locator(".sheet-totals dt").first();
  await expect(zeile).toBeVisible();
  const hoch = (await zeile.boundingBox())!.height;
  expect(hoch).toBeLessThan((await normal.boundingBox())!.height * 1.5);
  await page.context().close();
});

test("Ein Platzhalter-Knopf ohne Klick ins Feld lässt den vorhandenen Text vorne stehen", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Fußzeile" });
  await karte.getByLabel("Eigene Fußzeile").check();
  const feld = karte.getByLabel("Spalte 1");
  const vorher = await feld.inputValue();

  await karte.getByRole("button", { name: "{telefon}" }).click();

  const nachher = await feld.inputValue();
  await page.context().close();
  expect(nachher.startsWith(vorher)).toBe(true);
});
