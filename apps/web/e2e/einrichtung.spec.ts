import { expect, type Locator, type Page, test } from "@playwright/test";
import { USER } from "./daten.ts";
import { durchlaufSeite, gehe, SETUP_CODE } from "./einrichtung.ts";

/**
 * Eigener Durchlauf zu #266: Fragen zur Einrichtung nach dem ersten Konto, ausgeblendete Bereiche in Navigation und
 * Einstellungen, direkte Links und erneutes Durchgehen mit Rückfrage. Braucht eine leere Datenbank, weil die Fragen
 * nur bei der Ersteinrichtung von selbst kommen.
 */
test.describe.configure({ mode: "serial" });
let page: Page;
let pageErrors: string[] = [];

const menue = () => page.locator("#hauptmenue .nav-variante-voll");
const frage = (name: string | RegExp) => page.getByRole("group", { name });
const antworten = (gruppe: Locator, antwort: string | RegExp) => gruppe.getByRole("radio", { name: antwort }).check();

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test.afterAll(() => {
  expect(pageErrors).toEqual([]);
});

test("Ersteinrichtung fragt Rechtsform und Bereiche, „weiß ich nicht“ erinnert auf der Übersicht", async () => {
  await gehe(page, "/");
  // Der Hinweis am Code sagt, wer ihn hat, und führt zur Anleitung
  await expect(page.getByText("Den Code hat, wer Haben installiert hat.")).toBeVisible();
  await expect(page.getByRole("link", { name: "So findest du ihn" })).toHaveAttribute("href", /\/einrichtung\.html#konto-anlegen$/);
  await page.getByLabel("Einrichtungscode").fill(SETUP_CODE);
  await page.getByLabel("Name").fill(USER.name);
  await page.getByLabel("E-Mail").fill(USER.email);
  await page.getByLabel(/Passwort/).fill(USER.password);
  await page.getByRole("button", { name: "Konto anlegen" }).click();
  await page.getByRole("button", { name: "Später" }).click();
  await page.waitForURL("**/einrichtung");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Haben einrichten");
  await expect(page.getByText(/Bei „Weiß ich nicht“ bleibt die bisherige Angabe/)).toBeVisible();

  await antworten(frage("Wie bist du selbständig?"), "Mit Gewerbeanmeldung");
  // Kleinunternehmer bleibt bei „Weiß ich nicht“; Versteuerung und Voranmeldung fragt Haben dann trotzdem
  await expect(frage("Bist du Kleinunternehmer?").getByRole("radio", { name: "Weiß ich nicht" })).toBeChecked();
  await antworten(frage("Wie oft gibst du die Voranmeldung ab?"), "Vierteljährlich");
  await antworten(frage("Arbeitest du mit einer Steuerberatung?"), "Ja");
  await page.getByLabel("Kontenrahmen der Steuerberatung").selectOption("SKR04");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByRole("heading", { name: "Start in Haben" })).toBeFocused();

  await antworten(frage(/neu an/), /wechsle/);
  await expect(page.getByRole("link", { name: /Umzug/ })).toBeVisible();
  await page.getByRole("button", { name: "Weiter" }).click();

  await antworten(frage("Hast du Angestellte oder Minijobber?"), "Nein");
  await antworten(frage("Nimmst du Bargeld ein?"), "Nein");
  await antworten(frage("Schreibst du Angebote?"), "Ja");
  await page.getByRole("button", { name: "Fertig" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  // Personal und Kasse fehlen in Navigation und Schnellsuche, alles andere ist da
  for (const fehlt of ["Lohn", "SV-Meldeportal", "Kasse"]) await expect(menue().getByRole("link", { name: fehlt, exact: true })).toHaveCount(0);
  for (const da of ["Angebote", "Rechnungen", "Lastschriften", "Belege", "Anlagen", "Bank", "Darlehen", "Umsatzsteuer", "Jahreserklärung"]) {
    await expect(menue().getByRole("link", { name: da, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Kleinunternehmer klären")).toBeVisible();
  await expect(page.getByText("Rechtsform festlegen")).toHaveCount(0);
  await expect(page.getByText("Haben einrichten")).toHaveCount(0);

  // Die Antworten stehen in den Firmendaten
  await gehe(page, "/einstellungen?bereich=firma");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await expect(firma.getByLabel("Einkunftsart (für die Anlage EÜR)")).toHaveValue("gewerbe");
  await expect(firma.getByLabel("Kontenrahmen (wie in Lexoffice)")).toHaveValue("SKR04");
  await expect(firma.getByLabel("Kleinunternehmer nach § 19 UStG")).not.toBeChecked();
});

test("Ausgeblendete Bereiche bleiben über direkte Links erreichbar", async () => {
  for (const [pfad, titel] of [
    ["/kasse", /Kassenbuch/],
    ["/lohn", /Lohn/],
  ] as const) {
    const antwort = await page.goto(pfad);
    expect(antwort?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(titel);
  }
});

test("Einstellungen › Bereiche schaltet sofort wieder ein", async () => {
  await gehe(page, "/einstellungen?bereich=bereiche");
  const karte = page.getByRole("region", { name: "Bereiche im Menü" });
  await expect(karte.getByRole("checkbox", { name: /Kasse/ })).not.toBeChecked();
  // Der Name bleibt gleich, der Zustand steht in der Beschreibung (WCAG 4.1.2: der Haken trägt ihn schon)
  await expect(karte.getByRole("checkbox", { name: "Kasse", exact: true })).toHaveAccessibleDescription(/^Ausgeblendet · Im Menü: Kasse$/);
  await karte.getByRole("checkbox", { name: /Kasse/ }).check();
  await expect(page.getByText("Kasse steht wieder im Menü.")).toBeVisible();
  await expect(menue().getByRole("link", { name: "Kasse", exact: true })).toBeVisible();
  await karte.getByRole("checkbox", { name: /Personal/ }).check();
  await expect(menue().getByRole("link", { name: "Lohn", exact: true })).toBeVisible();
  await expect(karte.getByRole("checkbox", { name: /Personal/ })).toBeChecked();
});

test("Fragen erneut durchgehen: vorausgefüllt, geänderte Rechtsform erst nach Rückfrage", async () => {
  await gehe(page, "/einstellungen?bereich=bereiche");
  await page.getByRole("link", { name: "Fragen erneut durchgehen" }).click();
  await page.waitForURL("**/einrichtung");
  await expect(frage("Wie bist du selbständig?").getByRole("radio", { name: "Mit Gewerbeanmeldung" })).toBeChecked();
  await expect(frage("Wie oft gibst du die Voranmeldung ab?").getByRole("radio", { name: "Vierteljährlich" })).toBeChecked();

  await antworten(frage("Wie bist du selbständig?"), "GmbH");
  await page.getByRole("button", { name: "Weiter" }).click();
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(frage("Nimmst du Bargeld ein?").getByRole("radio", { name: "Ja" })).toBeChecked();
  await page.getByRole("button", { name: "Fertig" }).click();
  const dialog = page.getByRole("dialog", { name: "Angaben zur Firma ändern?" });
  await expect(dialog).toContainText("Rechtsform");
  await expect(dialog).toContainText("GmbH (bisher Einzelunternehmen)");
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toHaveCount(0);

  // Abgebrochen: nichts geändert
  await gehe(page, "/einstellungen?bereich=firma");
  await expect(page.getByRole("form", { name: "Firmendaten" }).getByLabel("Rechtsform")).toHaveValue("einzelunternehmen");
});

test("Am Handy ohne waagrechtes Scrollen, hell und dunkel", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const modus of ["hell", "dunkel"]) {
    await page.evaluate((m) => localStorage.setItem("haben-modus", m), modus);
    for (const pfad of ["/einrichtung", "/einstellungen?bereich=bereiche"]) {
      await gehe(page, pfad);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${pfad} (${modus})`).toBe(0);
    }
  }
});
