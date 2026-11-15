import { expect, type Locator, type Page } from "@playwright/test";
import { currentDay, currentYear } from "./daten.ts";
import { axeVerstoesse, bestaetigen, faktenZeigen, gehe, kontaktAnlegen, kundeWaehlen } from "./einrichtung.ts";

const CUSTOMER = { name: "Klintwerk Digital GmbH", street: "Werkstraße 8", zip: "24103", city: "Kiel" };
type Invoice = { number: string; path: string };

function receivablesKpi(page: Page): Locator {
  return page
    .locator(".card")
    .filter({ has: page.locator(".kpi-label").filter({ hasText: /^Offene Forderungen$/ }) })
    .locator(".kpi-value");
}

function position(page: Page, title: string, invoice: Invoice): Locator {
  return page
    .getByRole("region", { name: title, exact: true })
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: invoice.number, exact: true }) });
}

async function finalize(page: Page, title: "Abschlagsrechnung" | "Schlussrechnung"): Promise<Invoice> {
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await page.waitForURL(/\/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben", exact: true }).click();
  await faktenZeigen(page, "Nummer", "Kunde", "Betrag");
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const heading = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  expect(heading).toMatch(new RegExp(`^${title} .+`));
  return { number: heading.slice(title.length).trim(), path: new URL(page.url()).pathname };
}

async function request(page: Page, price: string, description: string): Promise<Invoice> {
  await gehe(page, "/rechnungen/neu");
  await page.getByLabel("Rechnungsart", { exact: true }).selectOption("abschlag");
  await kundeWaehlen(page, `${CUSTOMER.name} · ${CUSTOMER.city}`);
  await page.getByLabel("Rechnungsdatum", { exact: true }).fill(currentDay());
  await expect(page.getByRole("checkbox", { name: "Teilleistung bereits erbracht" })).not.toBeChecked();
  await page.getByLabel("Beschreibung Position 1").fill(description);
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill(price);
  return finalize(page, "Abschlagsrechnung");
}

async function finalInvoice(page: Page, advance: Invoice): Promise<Invoice> {
  await gehe(page, advance.path);
  await page.getByRole("link", { name: "Schlussrechnung erstellen", exact: true }).click();
  await page.waitForURL(/\/rechnungen\/neu\?schluss=/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Kunde", { exact: true })).toHaveValue(`${CUSTOMER.name} · ${CUSTOMER.city}`);
  const deduction = page.getByRole("checkbox", { name: `Abschlagsrechnung ${advance.number}` });
  await expect(deduction).toBeChecked();
  await page.getByLabel("Rechnungsdatum", { exact: true }).fill(currentDay());
  await page.getByLabel("Leistung von", { exact: true }).fill(currentDay());
  await page.getByLabel("Beschreibung Position 1").fill("Projekt Klintwerk vollständig erbracht");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("1000,00");
  return finalize(page, "Schlussrechnung");
}

async function cancelFinalInvoice(page: Page, invoice: Invoice): Promise<void> {
  await gehe(page, invoice.path);
  await page.getByRole("button", { name: "Stornieren", exact: true }).click();
  await faktenZeigen(page, "Nummer", "Kunde", "Betrag");
  await bestaetigen(page, "Stornieren");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Stornorechnung /, { timeout: 30_000 });
}

async function outstandingClaims(page: Page, advance: Invoice, final: Invoice, newRequest: Invoice): Promise<void> {
  const claims = page.getByRole("region", { name: "Offene Forderungen", exact: true });
  const requests = page.getByRole("region", { name: "Offene Anzahlungsanforderungen", exact: true });
  await expect(position(page, "Offene Forderungen", advance)).toContainText("357,00");
  const earned = position(page, "Offene Forderungen", final);
  await expect(earned).toContainText(CUSTOMER.name);
  await expect(earned).toContainText("833,00");
  await expect(earned).toContainText("Ersatzrechnung offen");
  await expect(earned.getByRole("link", { name: final.number, exact: true })).toHaveAttribute("href", final.path);
  await expect(position(page, "Offene Anzahlungsanforderungen", newRequest)).toContainText("59,50");
  await expect(requests.getByRole("link", { name: advance.number, exact: true })).toHaveCount(0);
  await expect(claims.getByRole("link", { name: newRequest.number, exact: true })).toHaveCount(0);
}

async function checkReports(page: Page, advance: Invoice, final: Invoice, newRequest: Invoice): Promise<void> {
  const previous = page.viewportSize();
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await gehe(page, `/auswertungen?jahr=${currentYear()}`);
      await outstandingClaims(page, advance, final, newRequest);
      expect(await axeVerstoesse(page), `Anzahlungs-OPOS bei ${width} px`).toEqual([]);
      if (width === 390) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "Offene Posten sind am Handy nicht breiter als die Seite").toBeLessThanOrEqual(1);
      }
    }
    await position(page, "Offene Forderungen", final).getByRole("link", { name: final.number, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${final.path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Schlussrechnung ${final.number}`);
  } finally {
    if (previous) await page.setViewportSize(previous);
  }
}

/** Eigene Belege im bestehenden GmbH-Durchlauf; keine Zahlungen oder Änderungen an dessen bisherigen Belegen. */
export async function anzahlungsbilanzPruefen(page: Page): Promise<void> {
  await kontaktAnlegen(page, CUSTOMER);
  await gehe(page, `/auswertungen?jahr=${currentYear()}`);
  const before = (await receivablesKpi(page).textContent()) ?? "";
  const advance = await request(page, "300,00", "Anzahlung Projekt Klintwerk vor Leistung");
  await gehe(page, `/auswertungen?jahr=${currentYear()}`);
  await expect(page.getByRole("region", { name: "Offene Anzahlungsanforderungen", exact: true })).toBeVisible();
  await expect(position(page, "Offene Anzahlungsanforderungen", advance)).toContainText("357,00");
  await expect(page.getByRole("region", { name: "Offene Forderungen", exact: true }).getByRole("link", { name: advance.number, exact: true })).toHaveCount(0);
  await expect(receivablesKpi(page)).toHaveText(before);
  const final = await finalInvoice(page, advance);
  await cancelFinalInvoice(page, final);
  const newRequest = await request(page, "50,00", "Anzahlung weiteres Klintwerk-Projekt vor Leistung");
  await checkReports(page, advance, final, newRequest);
}
