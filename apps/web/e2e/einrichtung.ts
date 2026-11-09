import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page } from "@playwright/test";
import { day, USER, vorschauAnheften } from "./daten.ts";

/**
 * Was die Durchläufe app.spec.ts, rechnungen.spec.ts und belege-steuern.spec.ts gemeinsam brauchen (e2e/durchlaeufe.ts):
 * jeder fängt mit einer leeren Datenbank an und richtet sich dasselbe Unternehmen ein.
 */

/** Wie HABEN_SETUP_CODE in playwright.config.ts */
export const SETUP_CODE = "e2e-einrichtungscode";

/** Datum im DKB-Format: 14.09.26 */
export const dkb = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;

export type Kontakt = { name: string; street: string; zip: string; city: string; phone?: string };

export const CUSTOMERS: Kontakt[] = [
  { name: "Nordwerk Software GmbH", street: "Hafenstraße 5", zip: "20457", city: "Hamburg", phone: "+49 40 123456-0" },
  { name: "Alpenblick Media AG", street: "Sonnenstraße 12", zip: "80331", city: "München" },
  { name: "Rheinpixel GmbH", street: "Mediapark 8", zip: "50670", city: "Köln" },
];

export type Rechnung = { customer: string; date: string; lines: [string, string, string][]; gross: string };

export const INVOICES: Rechnung[] = [
  { customer: "Nordwerk Software GmbH · Hamburg", date: day(-40), lines: [["Softwareentwicklung", "96", "95,00"]], gross: "10.852,80" },
  {
    customer: "Alpenblick Media AG · München",
    date: day(-30),
    lines: [
      ["Beratung Architektur", "3", "960,00"],
      ["Workshop-Unterlagen", "1", "250,00"],
    ],
    gross: "3.724,70",
  },
  { customer: "Rheinpixel GmbH · Köln", date: day(-12), lines: [["Wartung und Support", "1", "1.450,00"]], gross: "1.725,50" },
];

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * Die eine Seite, mit der ein Durchlauf nacheinander arbeitet, und die Fehler, die der Browser dabei meldet. Ein eigener
 * Kontext statt browser.newPage(), sonst lehnt axe die Seite ab.
 */
export async function durchlaufSeite(browser: Browser): Promise<{ page: Page; pageErrors: string[] }> {
  const context = await browser.newContext();
  await vorschauAnheften(context);
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Ungültige SVG-Werte (etwa NaN in einem Diagramm) meldet der Browser nur in der Konsole, nicht als Seitenfehler
  page.on("console", (message) => {
    if (message.type() === "error" && /NaN/.test(message.text())) pageErrors.push(`${page.url()}: ${message.text()}`);
  });
  return { page, pageErrors };
}

export async function gehe(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** Konto anlegen und die Firmendaten speichern; danach steht der Durchlauf in den Einstellungen */
export async function einrichten(page: Page): Promise<void> {
  await gehe(page, "/");
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel("Einrichtungscode").fill(SETUP_CODE);
  await page.getByLabel("Name").fill(USER.name);
  await page.getByLabel("E-Mail").fill(USER.email);
  await page.getByLabel(/Passwort/).fill(USER.password);
  await page.getByRole("button", { name: "Konto anlegen" }).click();
  await page.getByRole("button", { name: "Später" }).click();
  await page.waitForURL("**/einstellungen");
  await page.waitForLoadState("networkidle");

  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("Name", { exact: true }).fill("Mustermann IT · Max Mustermann");
  await firma.getByLabel("E-Mail", { exact: true }).fill("rechnung@mustermann.example");
  await firma.getByLabel("Straße und Hausnummer").fill("Musterstraße 12");
  await firma.getByLabel("PLZ").fill("93047");
  await firma.getByLabel("Ort").fill("Regensburg");
  await firma.getByLabel("Bundesland").selectOption("BY");
  await firma.getByLabel(/^Steuernummer/).fill("198/113/10010");
  await firma.getByLabel("IBAN").fill("DE89370400440532013000");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
}

export async function kontaktAnlegen(page: Page, kontakt: Kontakt): Promise<void> {
  await gehe(page, "/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill(kontakt.name);
  await page.getByLabel("Straße und Hausnummer").fill(kontakt.street);
  await page.getByLabel("PLZ").fill(kontakt.zip);
  await page.getByLabel("Ort").fill(kontakt.city);
  if (kontakt.phone) await page.getByLabel("Telefon").fill(kontakt.phone);
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  if (kontakt.phone) await expect(page.getByLabel("Telefon")).toHaveValue(kontakt.phone);
}

/** Die Trefferliste eines Suchfelds (Combobox.tsx) */
export const trefferliste = (page: Page) => page.getByRole("listbox", { name: "Treffer" });

/** Kunden im Editor über die Suche wählen, Text wie im Feld: „Name · Ort“; ohne Text den ersten der Liste */
export async function kundeWaehlen(page: Page, kunde?: string): Promise<void> {
  const feld = page.getByRole("combobox", { name: "Kunde", exact: true });
  if (kunde === undefined) {
    await feld.click();
    await trefferliste(page).getByRole("option").first().click();
    return;
  }
  await feld.fill(kunde.split(" · ")[0]!);
  await trefferliste(page).getByRole("option").first().click();
  await expect(feld).toHaveValue(kunde);
}

/** Dialog für einen neuen Kunden über den letzten Eintrag der Trefferliste öffnen */
export async function neuenKontaktOeffnen(page: Page): Promise<void> {
  await page.getByRole("combobox", { name: "Kunde", exact: true }).click();
  await trefferliste(page).getByRole("option", { name: "Neuen Kontakt anlegen" }).click();
}

/** Artikel aus der Trefferliste einer Position übernehmen */
export async function artikelInPosition(page: Page, position: number, bezeichnung: string): Promise<void> {
  await page.getByLabel(`Beschreibung Position ${position}`).fill(bezeichnung);
  await trefferliste(page).getByRole("option", { name: bezeichnung }).first().click();
}

/** Artikel über „Aus dem Katalog einfügen“ als Position einfügen */
export async function artikelEinfuegen(page: Page, bezeichnung: string): Promise<void> {
  await page.getByLabel("Aus dem Artikelkatalog einfügen").fill(bezeichnung);
  await trefferliste(page).getByRole("option", { name: bezeichnung }).first().click();
}

export async function rechnungFestschreiben(page: Page, rechnung: Rechnung): Promise<void> {
  await gehe(page, "/rechnungen/neu");
  await kundeWaehlen(page, rechnung.customer);
  await page.getByLabel("Rechnungsdatum").fill(rechnung.date);
  for (const [i, [description, quantity, price]] of rechnung.lines.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Position hinzufügen" }).click();
    await page.getByLabel(`Beschreibung Position ${i + 1}`).fill(description);
    await page.getByLabel(`Menge Position ${i + 1}`).fill(quantity);
    await page.getByLabel(new RegExp(`Einzelpreis Position ${i + 1}`)).fill(price);
  }
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`${rechnung.gross} €`).first()).toBeVisible();
}

/** Die Rückfrage im ConfirmDialog mit dem Knopf der Aktion bestätigen */
export async function bestaetigen(page: Page, aktion: string): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name: aktion, exact: true }).click();
}

/** Die Zeilen über den Folgen im offenen ConfirmDialog, in dieser Reihenfolge (weitere dürfen dazwischen stehen) */
export async function faktenZeigen(page: Page, ...zeilen: string[]): Promise<void> {
  await expect(page.getByRole("dialog").locator("dt")).toContainText(zeilen);
}

/** Die Breiten aus barrierefreiheit.spec.ts (Desktop, Handy mit 320 px nach WCAG 1.4.10) und seiten.spec.ts (390 px) */
const DESKTOP = { width: 1440, height: 900 };
const HANDY_AXE = { width: 320, height: 720 };
const HANDY_BREITE = { width: 390, height: 844 };
const THEMES = ["ozean", "pflaume", "graphit", "nacht", "tiefsee"];

export async function axeVerstoesse(page: Page, rules?: string[]): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(WCAG);
  if (rules) builder.withRules(rules);
  const { violations } = await builder.analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${v.help} → ${n.target.join(" ")}`));
}

/**
 * Prüft Seiten mit den Daten eines Durchlaufs wie barrierefreiheit.spec.ts und seiten.spec.ts: WCAG 2.2 AA am Desktop
 * und am Handy, auf dem Handy kein waagrechtes Scrollen. Die beiden sehen nur die Daten von app.spec.ts, also leere
 * Listen für alles, was die übrigen Durchläufe anlegen.
 */
export async function ohneAxeVerstoesse(page: Page, paths: string[]): Promise<void> {
  for (const [geraet, viewport] of [
    ["Desktop", DESKTOP],
    ["Handy", HANDY_AXE],
  ] as const) {
    await page.setViewportSize(viewport);
    for (const path of paths) {
      await gehe(page, path);
      expect.soft(await axeVerstoesse(page), `${geraet} ${path}`).toEqual([]);
    }
  }
  await page.setViewportSize(HANDY_BREITE);
  for (const path of paths) {
    await gehe(page, path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect.soft(overflow, `${path} ist nicht breiter als das Handy`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize(DESKTOP);
}

/** Farbkontraste in den übrigen Themes wie die THEME_PAGES in barrierefreiheit.spec.ts, für Seiten, deren Daten hier entstehen */
export async function kontrasteInThemes(page: Page, paths: string[]): Promise<void> {
  for (const theme of THEMES) {
    await page.evaluate((t) => localStorage.setItem("haben-theme", t), theme);
    for (const path of paths) {
      await gehe(page, path);
      expect.soft(await axeVerstoesse(page, ["color-contrast", "link-in-text-block"]), `${theme} ${path}`).toEqual([]);
    }
  }
  await page.evaluate(() => localStorage.removeItem("haben-theme"));
}

/** Erfundene Mobilfunkrechnung als JPEG, gerendert im Browser */
export async function receiptJpeg(browser: Browser, title = "Funknetz Mobil GmbH"): Promise<Buffer> {
  const p = await browser.newPage({ viewport: { width: 620, height: 640 } });
  await p.setContent(`<body style="font: 14px sans-serif; padding: 40px">
    <h2>${title}</h2><p>Hafenallee 10 · 28217 Bremen · USt-IdNr. DE298765432</p>
    <h1>Mobilfunkrechnung</h1><p>Rechnungsnummer MF-0815 · Rechnungsdatum ${day(-9)}</p>
    <table style="width:100%"><tr><td>Tarif Business M</td><td align="right">38,57 €</td></tr>
    <tr><td>Umsatzsteuer 19 %</td><td align="right">7,33 €</td></tr><tr><th align="left">Rechnungsbetrag</th><th align="right">45,90 €</th></tr></table>
  </body>`);
  const jpeg = await p.screenshot({ type: "jpeg", quality: 80 });
  await p.close();
  return jpeg;
}
