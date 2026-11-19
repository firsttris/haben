import { waehleKategorie } from "./kategorie.ts";
import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { currentDay, day } from "./daten.ts";
import { databaseUrlFuer } from "./durchlaeufe.ts";
import { axeVerstoesse, bestaetigen, durchlaufSeite, einrichten, gehe, ohneAxeVerstoesse } from "./einrichtung.ts";

/**
 * Verrechnung zweier Eingangsbelege ohne Zahlung (#274), eigener Durchlauf mit leerer Datenbank (e2e/durchlaeufe.ts,
 * Projekt „verrechnung“): Rechnung und Gutschrift desselben Lieferanten entstehen über die Oberfläche, verrechnet und
 * wieder aufgehoben wird in der Karte der Beleg-Detailseite. axe prüft die Seite mit der Karte (WCAG 2.2 AA, Desktop
 * und Handy), damit die Karte nicht nur im Code, sondern auch im Browser ohne Verstoß bleibt. Dazu „Konflikt klären“ im Abruf
 * (#306): Dialog und Hinweis an beiden Umsätzen.
 */

test.describe.configure({ mode: "serial" });

let page: Page;
let pageErrors: string[] = [];
let rechnung: string;
let gutschrift: string;

const LIEFERANT = "Telekom Deutschland GmbH";
const RECHNUNG = { nummer: "VR-1001", datum: day(-20), netto: "100,00", betrag: "119,00 €" };
const GUTSCHRIFT = { nummer: "VR-1002", datum: day(-6), netto: "-30,00", betrag: "-35,70 €" };
/** Teilbetrag der Verrechnung: danach bleiben auf beiden Belegen Reste offen */
const VERECHNET = "20,00 €";
const GRUND = "Gutschrift VR-1002";

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
});

test.afterAll(async () => {
  await page.context().close();
});

/** Die Karte der Beleg-Detailseite (section mit aria-labelledby auf den Titel „Verrechnung“) */
const karte = () => page.getByRole("region", { name: "Verrechnung" });
/** Der offene Rest, den die Karte oben nennt */
const offen = () => karte().locator("p.small.muted .amount");

/**
 * Beleg als JPEG im Browser rendern, über die Ablagefläche der Belegliste ablegen, die Felder füllen und buchen;
 * liefert die Beleg-ID. Nummer und Art stehen auch im Bild, damit die beiden Belege nicht als Dublette gelten.
 */
async function belegAnlegen(browser: Browser, beleg: { nummer: string; datum: string; netto: string; art: string }): Promise<string> {
  const bild = await browser.newPage({ viewport: { width: 620, height: 460 } });
  await bild.setContent(`<body style="font: 15px sans-serif; padding: 36px">
    <h2>${LIEFERANT}</h2><p>${beleg.art} ${beleg.nummer} · ${beleg.datum}</p>
    <p>Mobilfunk Business · 1 Monat</p><p><strong>${beleg.netto} €</strong></p></body>`);
  const jpeg = await bild.screenshot({ type: "jpeg", quality: 80 });
  await bild.close();

  await gehe(page, "/belege");
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: `${beleg.nummer}.jpg`, mimeType: "image/jpeg", buffer: jpeg }]);
  await expect(page.getByText(`${beleg.nummer}.jpg: abgelegt.`)).toBeVisible();
  await page
    .getByRole("link", { name: new RegExp(beleg.nummer) })
    .first()
    .click();
  await page.waitForURL(/\/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const id = page.url().match(/\/belege\/([0-9a-f-]{36})/)![1]!;

  await page.getByLabel("Lieferant", { exact: true }).fill(LIEFERANT);
  await page.getByLabel("Rechnungsnummer").fill(beleg.nummer);
  await page.getByLabel("Belegdatum").fill(beleg.datum);
  await waehleKategorie(page.getByLabel("Kategorie"), "telefon");
  await page.getByLabel("Netto", { exact: true }).fill(beleg.netto);
  await page.locator(".doc-actions").getByRole("button", { name: "Bestätigen und buchen" }).click();
  await bestaetigen(page, "Buchen");
  await expect(page.locator(".page-head").getByText("Gebucht", { exact: true })).toBeVisible();
  return id;
}

test("Einrichtung", async () => {
  await einrichten(page);
});

test("Rechnung und Gutschrift desselben Lieferanten anlegen", async ({ browser }) => {
  rechnung = await belegAnlegen(browser, { ...RECHNUNG, art: "Rechnung" });
  gutschrift = await belegAnlegen(browser, { ...GUTSCHRIFT, art: "Gutschrift" });
  expect(rechnung).not.toBe(gutschrift);
});

test("Verrechnen: Gegenbeleg wählen, Teilbetrag und Grund eintragen, Datum stehen lassen", async () => {
  await gehe(page, `/belege/${rechnung}`);
  await expect(karte()).toBeVisible();
  await expect(offen()).toHaveText(RECHNUNG.betrag);

  await karte().getByRole("button", { name: "Mit einem Beleg verrechnen" }).click();
  // Ohne Angaben: die Fehler stehen an den Feldern, der Fokus im Gegenbeleg (DESIGN.md, Gesperrte Knöpfe)
  await karte().getByRole("button", { name: "Verrechnen", exact: true }).click();
  await expect(karte().getByLabel("Gegenbeleg")).toBeFocused();
  await expect(karte().getByLabel("Gegenbeleg")).toHaveAccessibleDescription(/Wähle den Gegenbeleg\./);
  await expect(karte().getByLabel("Grund", { exact: true })).toHaveAccessibleDescription(/Trag den Grund der Verrechnung ein/);
  await karte().getByLabel("Gegenbeleg").selectOption(gutschrift);
  // den ganzen Rest schlägt die Karte vor; verrechnet wird hier nur ein Teil, damit ein Rest offen bleibt
  await expect(karte().getByLabel("Betrag")).toHaveValue("35,70");
  await karte().getByLabel("Betrag").fill("20,00");
  // Pflichtfeld, vorbelegt mit heute: unangetastet absenden
  await expect(karte().getByLabel("Tag der Aufrechnung")).toHaveValue(currentDay());
  await karte().getByLabel("Grund", { exact: true }).fill(GRUND);
  await karte().getByRole("button", { name: "Verrechnen", exact: true }).click();

  await expect(karte().getByRole("status")).toContainText("Verrechnet: 20,00 EUR");
  const zeile = karte().getByRole("listitem");
  await expect(zeile).toHaveCount(1);
  await expect(zeile).toContainText(GRUND);
  await expect(zeile).toContainText(VERECHNET);
  await expect(offen()).toHaveText("99,00 €");

  // Die Gegenrichtung: die Gutschrift ist um denselben Betrag ausgeglichen
  await gehe(page, `/belege/${gutschrift}`);
  await expect(offen()).toHaveText("-15,70 €");
  await expect(karte().getByRole("listitem")).toContainText(VERECHNET);
});

test("Karte mit offenem Formular ohne axe-Verstöße", async () => {
  // Der Entwicklungsserver lädt beim ersten Aufruf Module nach und lädt die Seite dabei neu; dann noch einmal
  for (let versuch = 1; ; versuch++) {
    await gehe(page, `/belege/${rechnung}`);
    await karte().getByRole("button", { name: "Mit einem Beleg verrechnen" }).click();
    await expect(karte().getByLabel("Gegenbeleg")).toBeVisible();
    try {
      expect(await axeVerstoesse(page), "Verrechnungsformular").toEqual([]);
      return;
    } catch (error) {
      if (versuch >= 3 || !String(error).includes("Execution context was destroyed")) throw error;
    }
  }
});

test("Karte mit Verrechnung ohne axe-Verstöße und ohne Scrollen am Handy", async () => {
  await ohneAxeVerstoesse(page, [`/belege/${rechnung}`]);
});

test("Aufheben: der offene Rest ist wieder der volle Betrag", async () => {
  await gehe(page, `/belege/${rechnung}`);
  await expect(offen()).toHaveText("99,00 €");
  const zeile = karte().getByRole("listitem");
  await zeile.getByRole("button", { name: "aufheben" }).click();
  const formular = zeile.locator("form");
  // Pflichtfeld, vorbelegt mit heute: unangetastet absenden, dazu ein optionaler Grund
  await expect(formular.getByLabel("Tag der Aufhebung")).toHaveValue(currentDay());
  await formular.getByLabel("Grund (optional)").fill("versehentlich verrechnet");
  await formular.getByRole("button", { name: "Aufheben", exact: true }).click();

  await expect(karte().getByRole("status")).toContainText("Verrechnung aufgehoben");
  // Die aufgehobene Verrechnung verschwindet aus der Liste, statt einen zweiten "aufheben"-Knopf anzubieten
  await expect(karte().getByRole("listitem")).toHaveCount(0);
  // Aufgehoben wird per Gegenzeile: beide Belege tragen wieder ihren vollen offenen Rest
  await expect(offen()).toHaveText(RECHNUNG.betrag);
  await gehe(page, `/belege/${gutschrift}`);
  await expect(offen()).toHaveText(GUTSCHRIFT.betrag);
});

/** Tag wie auf der Seite: 15.11.2026 */
const deutsch = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Konflikt im Abruf (#306, 3b): Die Bank liefert einen schon übernommenen Umsatz mit anderem Betrag. Der Abruf selbst
 * braucht Enable Banking; den Stand danach (Bindung, Bewegung, abgelehnter Abruf, Konflikt) stellt der Test direkt in der
 * Datenbank des Durchlaufs nach und klärt ihn über die Oberfläche.
 */
test("Konflikt im Abruf klären: als weiteren Umsatz übernehmen, mit Hinweis an beiden Umsätzen (#306)", async () => {
  const iban = "DE02120300000000202051";
  const sql = postgres(databaseUrlFuer("verrechnung"), { max: 1, onnotice: () => {} });
  let bisher: string;
  try {
    const [konto] = await sql<{ id: string }[]>`insert into bank_accounts (name, iban) values ('Geschäftskonto', ${iban}) returning id`;
    const [abruf] = await sql<{ id: string }[]>`insert into bank_imports (bank_account_id, filename, sha256, format, period_from, period_to, added, skipped)
      values (${konto!.id}, 'Abruf Testbank', ${"a".repeat(64)}, 'enablebanking', ${day(-10)}, ${day(-1)}, 1, 0) returning id`;
    const [umsatz] = await sql<
      { id: string }[]
    >`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
      values (${konto!.id}, ${abruf!.id}, ${day(-3)}, -8900, 'Hosting Nord GmbH', 'Kundennummer 4711', 'e2e-hosting') returning id`;
    bisher = umsatz!.id;
    const [quelle] = await sql<{ id: string }[]>`insert into import_sources (bank_account_id, provider, external_account_id, account_kind, cutover_date)
      values (${konto!.id}, 'enablebanking', 'hash-e2e', 'bank', ${day(-10)}) returning id`;
    const [lieferung] = await sql<{ id: string }[]>`insert into import_batches (source_id, idempotency_key, fetch_id, part_index, part_last, coverage_from,
      coverage_to, blocking, fingerprint, bank_import_id, checkpoint, complete)
      values (${quelle!.id}, 'k1', 'f1', 0, true, ${day(-10)}, ${day(-1)}, 0, 'f1', ${abruf!.id}, ${day(-1)}, true) returning id`;
    const [bewegung] = await sql<{ id: string }[]>`insert into import_movements (source_id, batch_id, source_event_id, component, kind, booking_date, amount,
      currency, details, transaction_id)
      values (${quelle!.id}, ${lieferung!.id}, 'ER-1003', 'main', 'payment', ${day(-3)}, -8900, 'EUR', 'd1', ${bisher}) returning id`;
    const meldung = "Konflikt mit schon übernommenen Umsätzen: ER-1003/main: Betrag -89,00 € → -98,00 €; nichts überschrieben.";
    const [abgelehnt] = await sql<{ id: string }[]>`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped, warnings)
      values (${konto!.id}, 'Abruf Testbank', ${"b".repeat(64)}, 'enablebanking', 0, 0, ${sql.json([meldung])}) returning id`;
    const geliefert = { bookingDate: day(-3), amount: -9800, currency: "EUR", counterpartyName: "Hosting Nord GmbH", purpose: "Kundennummer 4711", index: 0 };
    await sql`insert into import_conflicts (movement_id, kind, booking_date, amount, currency, details, transaction, bank_import_id)
      values (${bewegung!.id}, 'payment', ${day(-3)}, -9800, 'EUR', 'd2', ${sql.json(geliefert)}, ${abgelehnt!.id})`;
    const konten = [{ uid: "u-e2e", iban, name: "Geschäftskonto", bankAccountId: konto!.id, identificationHash: "hash-e2e" }];
    await sql`insert into bank_connections (aspsp_name, aspsp_country, psu_type, status, accounts, last_error)
      values ('Testbank', 'DE', 'business', 'aktiv', ${sql.json(konten)}, ${`Geschäftskonto …2051: ${meldung}`})`;
  } finally {
    await sql.end();
  }

  await gehe(page, "/bank");
  const abruf = page.getByRole("region", { name: "Automatischer Abruf" });
  await expect(abruf).toContainText(`Bankabruf seit ${deutsch(day(-10))}`);
  await abruf.getByRole("button", { name: "Konflikt klären" }).click();
  const dialog = page.getByRole("dialog", { name: "Konflikt klären" });
  await expect(dialog).toContainText("−89,00 €");
  await expect(dialog).toContainText("−98,00 €");
  await expect(dialog).toContainText("Noch nicht zugeordnet");
  expect(await axeVerstoesse(page), "Dialog „Konflikt klären“").toEqual([]);
  await dialog.getByLabel("Als weiteren Umsatz übernehmen").check();
  await dialog.getByRole("button", { name: "Klären" }).click();
  await expect(dialog).toBeHidden();
  await expect(abruf.getByRole("button", { name: /Konflikt/ })).toHaveCount(0);

  // Am bisherigen Umsatz der Verweis auf den neuen, dort zurück auf den bisherigen
  await gehe(page, `/bank?umsatz=${bisher!}`);
  const hinweis = page.getByRole("note").filter({ hasText: "zusätzlich als eigener Umsatz" });
  await expect(hinweis).toContainText(`${deutsch(day(-3))}, −98,00 €`);
  await hinweis.getByRole("link").click();
  await expect(page.getByRole("note").filter({ hasText: "Bisheriger Umsatz" })).toContainText(`${deutsch(day(-3))}, −89,00 €`);
});

/**
 * Externe Quelle (#306, Schritt 4): Am Konto eines Zahlungsdienstleisters die Quelle für den REST-Import freigeben. Danach
 * zeigt die Zeile Anbieter, Kennung und Stichtag; einen Konflikt dieser Quelle (in der Datenbank nachgestellt, wie oben)
 * klärt der Knopf daneben, mit den Texten für einen Dienst.
 */
test("Externe Quelle am Konto freigeben, danach Konflikt dieser Quelle klären (#306)", async () => {
  const sql = postgres(databaseUrlFuer("verrechnung"), { max: 1, onnotice: () => {} });
  let konto: string;
  try {
    [{ id: konto }] = await sql<
      { id: string }[]
    >`insert into bank_accounts (name, purpose, provider) values ('eBay', 'zahlungsdienstleister', 'ebay') returning id`;
  } finally {
    await sql.end();
  }

  await gehe(page, `/bank?konto=${konto}`);
  await page.getByRole("button", { name: "Externe Quelle hinzufügen" }).click();
  const dialog = page.getByRole("dialog", { name: "Externe Quelle hinzufügen" });
  await dialog.getByLabel("Anbieter", { exact: true }).fill("haben-ebay");
  await dialog.getByLabel("Kennung des Kontos beim Anbieter").fill("verkaeufer-beispiel");
  await dialog.getByLabel("Stichtag (optional)").fill(day(-10));
  expect(await axeVerstoesse(page), "Dialog „Externe Quelle hinzufügen“").toEqual([]);
  await dialog.getByRole("button", { name: "Freigeben" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Externe Quelle: haben-ebay · verkaeufer-beispiel · seit ${deutsch(day(-10))} · noch keine Lieferung`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Externe Quelle hinzufügen" })).toHaveCount(0);

  const db = postgres(databaseUrlFuer("verrechnung"), { max: 1, onnotice: () => {} });
  try {
    const [quelle] = await db<{ id: string }[]>`select id from import_sources where provider = 'haben-ebay'`;
    const [lieferung] = await db<{ id: string }[]>`insert into bank_imports (bank_account_id, filename, sha256, format, period_from, period_to, added, skipped)
      values (${konto}, 'Lieferung haben-ebay l-1', ${"c".repeat(64)}, 'importvertrag-psp', ${day(-10)}, ${day(-1)}, 1, 0) returning id`;
    const [umsatz] = await db<
      { id: string }[]
    >`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, purpose, dedup_hash)
      values (${konto}, ${lieferung!.id}, ${day(-5)}, 4999, 'Erika Beispiel', 'Bestellung 01-00000-00001', 'e2e-ebay') returning id`;
    const [batch] = await db<{ id: string }[]>`insert into import_batches (source_id, idempotency_key, fetch_id, part_index, part_last, coverage_from,
      coverage_to, blocking, fingerprint, bank_import_id, checkpoint, complete)
      values (${quelle!.id}, 'l-1', 'l-1', 0, true, ${day(-10)}, ${day(-1)}, 0, 'f', ${lieferung!.id}, ${day(-1)}, true) returning id`;
    const [bewegung] = await db<{ id: string }[]>`insert into import_movements (source_id, batch_id, source_event_id, component, kind, booking_date, amount,
      currency, details, transaction_id)
      values (${quelle!.id}, ${batch!.id}, 'SALE-0001', 'main', 'payment', ${day(-5)}, 4999, 'EUR', 'd1', ${umsatz!.id}) returning id`;
    const [abgelehnt] = await db<{ id: string }[]>`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${konto}, 'Lieferung haben-ebay l-2', ${"d".repeat(64)}, 'importvertrag-psp', 0, 0) returning id`;
    const geliefert = {
      bookingDate: day(-5),
      amount: 5099,
      currency: "EUR",
      counterpartyName: "Erika Beispiel",
      purpose: "Bestellung 01-00000-00001",
      index: 0,
    };
    await db`insert into import_conflicts (movement_id, kind, booking_date, amount, currency, details, transaction, bank_import_id)
      values (${bewegung!.id}, 'payment', ${day(-5)}, 5099, 'EUR', 'd2', ${db.json(geliefert)}, ${abgelehnt!.id})`;
  } finally {
    await db.end();
  }

  await gehe(page, `/bank?konto=${konto}`);
  await expect(page.getByText(/Externe Quelle: haben-ebay · verkaeufer-beispiel · .* geliefert bis/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Konten" }).getByRole("link", { name: /eBay/ })).toContainText("REST-Import · zuletzt");
  await page.getByRole("button", { name: "Konflikt klären" }).click();
  const klaeren = page.getByRole("dialog", { name: "Konflikt klären" });
  await expect(klaeren).toContainText("Der Dienst liefert diesen Umsatz (SALE-0001)");
  await expect(klaeren).toContainText("Jetzt vom Dienst");
  await klaeren.getByRole("button", { name: "Klären" }).click();
  await expect(klaeren).toBeHidden();
  await expect(page.getByRole("button", { name: "Konflikt klären" })).toHaveCount(0);
});

test("Keine Fehler im Browser", () => {
  expect(pageErrors).toEqual([]);
});
