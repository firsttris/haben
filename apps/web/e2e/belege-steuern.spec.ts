import { filePickerPruefen } from "./dateiauswahl.ts";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";
import postgres from "postgres";
import { day, YEAR } from "./daten.ts";
import { appDatabaseUrlFuer, databaseUrlFuer, ENABLE_BANKING_PORT } from "./durchlaeufe.ts";
import {
  bestaetigen,
  faktenZeigen,
  dkb,
  durchlaufSeite,
  einrichten,
  gehe,
  kontrasteInThemes,
  kundeWaehlen,
  lieferantWaehlen,
  neuenLieferantenOeffnen,
  ohneAxeVerstoesse,
  trefferliste,
  randImDialog,
} from "./einrichtung.ts";
import { LAPTOP, sichtbar } from "./kopfzeile.ts";
import { receiptJpeg } from "./belegbild.ts";

/**
 * Belege, Bank und Steuern in eigener, leerer Datenbank (Projekt „belege-steuern“, e2e/durchlaeufe.ts), parallel zu
 * app.spec.ts: ELSTER mit Zertifikat, Voranmeldung, Dauerfristverlängerung und Zusammenfassende Meldung, Belege mit
 * § 13b, Aufteilung und innergemeinschaftlichem Erwerb, Pauschalen, Skonto, Anlagen, Darlehen und Steuerzahlungen im
 * Bankabgleich, dazu Einstellungen ohne eigene Daten. Am Anfang dieselbe Einrichtung wie in app.spec.ts.
 */

test.describe.configure({ mode: "serial" });

let page: Page;
let pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
});

test.afterAll(async () => {
  await page.context().close();
});

const go = (path: string) => gehe(page, path);

/**
 * Nachgebaute Enable-Banking-API mit drei Banken; der Server des Durchlaufs fragt sie über ENABLE_BANKING_API_URL
 * (playwright.config.ts). N26 bietet Privat- und Geschäftskonto an, damit die Kontoart erscheint.
 */
async function enableBankingAttrappe(): Promise<Server> {
  const aspsps = [
    { name: "N26", country: "DE", psu_types: ["personal", "business"], maximum_consent_validity: 180 * 86_400 },
    { name: "Fyrst", country: "DE", psu_types: ["business"], maximum_consent_validity: 90 * 86_400 },
    { name: "DKB", country: "DE", psu_types: ["personal"], maximum_consent_validity: 180 * 86_400 },
  ];
  const server = createServer((request, response) => {
    const found = new URL(request.url ?? "/", "http://localhost").pathname === "/aspsps";
    response.writeHead(found ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(found ? { aspsps } : { message: "nicht nachgebaut" }));
  });
  await new Promise<void>((resolve) => server.listen(ENABLE_BANKING_PORT, "127.0.0.1", resolve));
  return server;
}

test("Einrichtung", async () => {
  await einrichten(page);
});

test("Beleg prüfen: Ein Fehler beim Speichern steht nicht hinter den stehenden Knöpfen (#356)", async ({ browser }) => {
  const vorher = page.viewportSize();
  await page.setViewportSize(LAPTOP);
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "meldung.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Funknetz Mobil GmbH") }]);
  await expect(page.getByText("meldung.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /meldung\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Lieferant", { exact: true }).fill("Funknetz Mobil GmbH");
  await page.getByLabel("Rechnungsnummer").fill("MF-0816");
  await page.getByLabel("Belegdatum").fill(day(-9));
  await page.getByLabel("Kategorie").selectOption("telefon");
  await page.getByLabel("Netto", { exact: true }).fill("38,57");
  // Oben im Formular, das in seiner Spalte scrollt; nur dann stehen die Knöpfe über dessen Ende
  const spalte = page.locator(".doc-editor > .stack");
  await spalte.evaluate((el) => el.scrollTo(0, 0));
  expect(await spalte.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
  const abbrechen = (route: Route) => (route.request().method() === "POST" ? route.abort() : route.continue());
  await page.route(/_serverFn/, abbrechen);
  await page.locator(".doc-actions").getByRole("button", { name: "Speichern" }).click();
  await sichtbar(page.locator(".doc-editor .banner-danger"));
  await page.unroute(/_serverFn/, abbrechen);
  // Der Beleg gehört nur diesem Test: die folgenden zählen die offenen Belege
  await page.locator(".doc-actions").getByRole("button", { name: "Löschen" }).click();
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
  if (vorher) await page.setViewportSize(vorher);
});

test("Steuerdaten hinterlegen und Belege von ELSTER testweise abrufen", async () => {
  await go("/einstellungen?bereich=persoenlich");
  const taxpayer = page.getByRole("form", { name: "Persönliche Angaben" });
  await taxpayer.getByLabel("Steuer-ID").fill("65929970489");
  await taxpayer.getByLabel("Vorname").fill("Max");
  await taxpayer.getByLabel("Nachname").fill("Mustermann");
  await taxpayer.getByLabel("Geburtsdatum").fill("1985-04-12");
  await taxpayer.getByLabel("Art").selectOption("zusammen");
  const ehegatte = taxpayer.getByRole("group", { name: "Ehegatte (Person B)" });
  await ehegatte.getByLabel("Anrede").selectOption("Frau");
  await ehegatte.getByLabel("Steuer-ID").fill("86095742719");
  await ehegatte.getByLabel("Vorname").fill("Erika");
  await ehegatte.getByLabel("Nachname").fill("Mustermann");
  await ehegatte.getByLabel("Geburtsdatum").fill("1987-03-01");
  await taxpayer.getByRole("button", { name: "Speichern" }).click();
  await expect(taxpayer.getByRole("status")).toBeVisible();
  await go("/einstellungen?bereich=elster");
  const cert = page.getByRole("form", { name: "ELSTER-Zertifikat" });
  await cert
    .getByLabel("Zertifikatsdatei")
    .setInputFiles({ name: "test.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("kein echtes Zertifikat") });
  await cert.getByRole("button", { name: "Hochladen" }).click();
  // Den Dateinamen zeigt schon die Dateiauswahl; „Entfernen“ gibt es erst, wenn das Zertifikat gespeichert ist
  await expect(cert.getByRole("button", { name: "Entfernen" })).toBeVisible();
  await expect(cert.getByText("test.pfx").first()).toBeVisible();
  const formate = page.getByRole("group", { name: "Formate prüfen" });
  await formate.getByRole("button", { name: "Formate mit ERiC prüfen" }).click();
  await expect(formate.getByRole("status")).toHaveText("Alle 8 Nachrichten sind gültig (simuliert, ohne ERiC).");

  // Ohne ERiC läuft der Abruf simuliert und liefert Beispielbelege
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const vast = page.getByRole("region", { name: `Belege von ELSTER ${YEAR - 1}` });
  await vast.getByLabel("Zertifikats-PIN").fill("123456");
  await vast.getByRole("button", { name: "Testweise abrufen" }).click();
  await expect(vast.getByRole("status")).toContainText("2 Belege bei ELSTER, 2 neu gespeichert.");
  await vast.getByText("Rentenbezugsmitteilung").click();
  await expect(vast.getByRole("cell", { name: "1.200,00 €" })).toBeVisible();

  // Berechtigung für die Belege des Ehegatten: beantragen und mit dem Code aus dem Brief freischalten
  await vast.getByLabel("Für").selectOption({ label: "Erika Mustermann" });
  const berechtigung = vast.getByRole("group", { name: "Berechtigung für Erika" });
  await expect(berechtigung).toContainText("noch keine (Test)");
  await vast.getByLabel("Zertifikats-PIN").fill("123456");
  await berechtigung.getByRole("button", { name: "Berechtigung beantragen" }).click();
  await expect(vast.getByRole("status")).toContainText("Erika bekommt von ELSTER einen Brief");
  await expect(berechtigung).toContainText("beantragt, wartet auf Freischaltung");
  await vast.getByLabel("Zertifikats-PIN").fill("123456");
  await berechtigung.getByLabel("Freischaltcode aus dem Brief").fill("ABCD-EFGH-1234");
  await berechtigung.getByRole("button", { name: "Freischalten" }).click();
  await expect(berechtigung).toContainText("genehmigt");
});

test("Anlage N: Arbeitslohn des Ehegatten in der Einkommensteuer", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const form = page.getByRole("form", { name: "Angaben zur Einkommensteuer" });
  const n = form.getByRole("group", { name: "Anlage N · Erika" });
  await n.getByLabel("Erika hatte Arbeitslohn aus einer Anstellung").check();
  const lstb = n.getByRole("group", { name: "Lohnsteuerbescheinigung 1 · Erika" });
  await lstb.getByLabel("Steuerklasse").selectOption("4");
  await lstb.getByLabel("Nr. 3 Bruttoarbeitslohn", { exact: true }).fill("42.000,00");
  await lstb.getByLabel("Nr. 4 Lohnsteuer", { exact: true }).fill("6.123,40");
  await lstb.getByLabel("Nr. 23a Rentenversicherung Arbeitnehmer", { exact: true }).fill("3.906,00");
  await lstb.getByLabel("Nr. 22a Rentenversicherung Arbeitgeber", { exact: true }).fill("3.906,00");
  await lstb.getByLabel("Nr. 25 Krankenversicherung", { exact: true }).fill("3.412,00");
  const wk = n.getByRole("group", { name: "Werbungskosten · Erika" });
  await wk.getByLabel("Erste Tätigkeitsstätte (PLZ, Ort, Straße)").fill("77815 Bühl, Industriestraße 4");
  await wk.getByLabel("Tage dort").fill("200");
  await wk.getByLabel("Einfache Entfernung in km").fill("25");
  await form.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toBeVisible();
  await expect(form.getByText(/N \(Erika\)/)).toBeVisible();
  await expect(form.getByText("Bereits einbehalten (Lohnsteuer, Soli, KiSt)")).toBeVisible();
  await expect(form.getByText("6.123,40\u00a0€").first()).toBeVisible();
});

test("Seiten nur von derselben Origin einbettbar", async () => {
  // Clickjacking-Schutz kommt von der App selbst, damit der Proxy SAMEORIGIN statt DENY setzen kann
  const html = await page.request.get("/rechnungen");
  expect(html.headers()["content-type"]).toContain("text/html");
  expect(html.headers()["content-security-policy"]).toBe("frame-ancestors 'self'");
  expect(html.headers()["x-frame-options"]).toBeUndefined();
});

test("Änderungsprotokoll: Kette prüfen, Prüfwert vergleichen", async () => {
  await go("/einstellungen?bereich=export");
  const card = page.getByRole("region", { name: "Änderungsprotokoll prüfen" });
  const pruefwert = (await card.locator("code").textContent())!;
  expect(pruefwert).toMatch(/^Nr\. \d+ · [0-9a-f]{64}$/);
  await card.getByRole("button", { name: "Kette prüfen" }).click();
  await expect(card.getByRole("status")).toContainText("Kette und Siegel sind unverändert");
  const field = card.getByLabel("Prüfwert aus Mail oder Jahresarchiv");
  await field.fill(pruefwert);
  await card.getByRole("button", { name: "Vergleichen" }).click();
  await expect(card.getByRole("status")).toContainText("stimmt und die Kette ist bis dorthin lückenlos");
  await field.fill(pruefwert.slice(0, -1) + (pruefwert.endsWith("0") ? "1" : "0"));
  await card.getByRole("button", { name: "Vergleichen" }).click();
  await expect(card.getByRole("alert")).toContainText("stimmt nicht");
});

test("Datenbankzugriff: tatsächliche Verbindungsrollen in den Einstellungen anzeigen (#619)", async () => {
  await go("/einstellungen?bereich=export");
  const card = page.getByRole("region", { name: "Datenbankzugriff", exact: true });
  await expect(card).toBeVisible();
  const sql = postgres(appDatabaseUrlFuer("belege-steuern"), { max: 1 });
  try {
    const [connection] = await sql<{ role: string; login_role: string }[]>`select current_user as role, session_user as login_role`;
    await expect(card.locator("dt")).toHaveText(["Aktuelle Rolle", "Anmelderolle"]);
    await expect(card.locator("dd")).toHaveText([connection!.role, connection!.login_role]);
    await expect(card).toContainText(/Appbetrieb mit eingeschränkten Rechten|Verbindung mit weitergehenden Rechten/);
    await expect(card.getByRole("link", { name: "Getrennte Datenbankrollen einrichten" })).toHaveAttribute(
      "href",
      "https://haben.app/installation-konfiguration.html#getrennte-datenbankrollen",
    );
    await expect(card.locator("input, textarea, select, button")).toHaveCount(0);
  } finally {
    await sql.end();
  }
});

test("Änderungsprotokoll: Kontenkollisionen getrennt von Manipulation melden (#787)", async () => {
  const sql = postgres(databaseUrlFuer("belege-steuern"), { max: 1 });
  try {
    // Bestand, dessen Nummern erst eine spätere Haben-Version reserviert hat; auch archivierte Konten wirken weiter.
    await sql`insert into own_accounts (kontenrahmen, account, name, parent_category, archived_at, created_by)
      values ('SKR03', '4920', 'Eigene Software 03', 'software', null, 'test-user'),
        ('SKR04', '6805', 'Eigene Software 04', 'software', now(), 'test-user')`;
    await go("/einstellungen?bereich=export");
    const card = page.getByRole("region", { name: "Änderungsprotokoll prüfen" });
    await card.getByRole("button", { name: "Kette prüfen" }).click();
    await expect(card.getByRole("status")).toContainText("2 Kontenkollisionen");
    await expect(card.getByRole("status")).toHaveClass(/banner-info/);
    await expect(card.getByRole("alert")).toHaveCount(0);
    const collisions = card.getByRole("region", { name: "Kontenkollisionen" });
    await expect(collisions).toContainText("SKR03 · 4920 · Eigene Software 03");
    await expect(collisions).toContainText("SKR04 · 6805 · Eigene Software 04");
    await expect(collisions).toContainText("Archivieren allein löst die Kollision nicht");
  } finally {
    await sql`delete from own_accounts where created_by = 'test-user' and name in ('Eigene Software 03', 'Eigene Software 04')`;
    await sql.end();
  }
});

test("Belege per E-Mail: Postfach einrichten, Fehler beim Abruf sichtbar", async () => {
  await go("/einstellungen?bereich=email");
  const card = page.getByRole("form", { name: "Belege per E-Mail" });
  // Port 1 auf dem eigenen Rechner: kein IMAP-Server, der Abruf scheitert sofort
  await card.getByLabel("IMAP-Server").fill("127.0.0.1");
  await card.getByLabel("Port", { exact: true }).fill("1");
  await card.getByLabel("Verschlüsselung").selectOption("starttls");
  await card.getByLabel("Benutzername").fill("belege@mustermann.example");
  await card.getByLabel("Passwort").fill("geheim");
  await card.getByLabel("Ordner").fill("Belege");
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card.getByRole("status")).toHaveText("Postfach gespeichert.");
  await card.getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(card.getByRole("alert")).toContainText("Abruf fehlgeschlagen");

  await go("/belege");
  await expect(page.getByText(/Belege per E-Mail: Anhänge an belege@mustermann\.example \(Ordner Belege\)/)).toBeVisible();
  await expect(page.getByText("Belege per E-Mail: Server nicht erreichbar.")).toBeVisible();
});

test("Kontoabruf: Enable Banking in den Einstellungen, ein falscher Schlüssel wird abgelehnt", async () => {
  await go("/bank");
  await page.getByRole("link", { name: "Einstellungen › Bank" }).click();
  await page.waitForURL("**/einstellungen?bereich=bank");
  const card = page.getByRole("form", { name: "Automatischer Kontoabruf" });
  await expect(card.getByText("/api/bank/callback")).toBeVisible();
  // Die Application ID kommt aus dem Dateinamen der .pem
  await card
    .getByLabel("Privater Schlüssel (.pem)")
    .setInputFiles({ name: "0b7c3f1e-1234-4abc-9def-0123456789ab.pem", mimeType: "application/x-pem-file", buffer: Buffer.from("kein Schlüssel") });
  await expect(card.getByLabel("Application ID")).toHaveValue("0b7c3f1e-1234-4abc-9def-0123456789ab");
  await card.getByRole("button", { name: "Prüfen und speichern" }).click();
  await expect(card.getByRole("alert")).toContainText("keine gültige .pem-Datei");
});

test("Bank verbinden: die markierte Bank ist gewählt, auch als einziger Treffer der Suche (#555)", async () => {
  const api = await enableBankingAttrappe();
  try {
    await go("/einstellungen?bereich=bank");
    const card = page.getByRole("form", { name: "Automatischer Kontoabruf" });
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await card.getByLabel("Privater Schlüssel (.pem)").setInputFiles({
      name: "0b7c3f1e-1234-4abc-9def-0123456789ab.pem",
      mimeType: "application/x-pem-file",
      buffer: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })),
    });
    await card.getByRole("button", { name: "Prüfen und speichern" }).click();
    await expect(card.getByText("Zugang geprüft und verschlüsselt gespeichert")).toBeVisible();

    await go("/bank");
    await page.getByRole("button", { name: "Bank verbinden" }).click();
    const banken = page.getByRole("listbox");
    const weiter = page.getByRole("button", { name: "Weiter zur Bank" });
    // Markiert und gewählt ist dasselbe: zu Beginn die erste Bank der Liste
    await expect(banken.getByRole("option")).toHaveText(["DKB", "Fyrst", "N26"]);
    await expect(banken).toHaveValue("DKB");
    await expect(page.getByText("Du wirst zu DKB weitergeleitet")).toBeVisible();
    await expect(weiter).toBeEnabled();

    // Bleibt nach der Suche nur eine Bank, ist sie markiert und auch gewählt; vorher blieb der Knopf grau (#555)
    await page.getByLabel("Bank suchen").fill("N26");
    await expect(banken.getByRole("option")).toHaveText(["N26"]);
    await banken.getByRole("option", { name: "N26" }).click();
    await expect(weiter).toBeEnabled();
    await expect(page.getByText("Du wirst zu N26 weitergeleitet")).toBeVisible();
    await expect(page.getByRole("group", { name: "Kontoart" })).toBeVisible();

    // Ohne Klick: der einzige Treffer ist gewählt und bleibt es, wenn die Suche wieder alle zeigt
    await page.getByLabel("Bank suchen").fill("fyrst");
    await expect(banken.getByRole("option")).toHaveText(["Fyrst"]);
    await expect(page.getByText("Du wirst zu Fyrst weitergeleitet")).toBeVisible();
    await expect(weiter).toBeEnabled();
    await page.getByLabel("Bank suchen").fill("");
    await expect(banken.getByRole("option")).toHaveCount(3);
    await expect(banken).toHaveValue("Fyrst");
    await expect(page.getByText("Du wirst zu Fyrst weitergeleitet")).toBeVisible();

    // Kein Treffer: nichts gewählt
    await page.getByLabel("Bank suchen").fill("Sparkasse");
    await expect(banken.getByRole("option")).toHaveCount(0);
    await expect(weiter).toBeDisabled();
    await page.getByRole("button", { name: "Abbrechen" }).click();

    // Zugang wieder entfernen, damit die folgenden Tests die Bankseite wie zuvor sehen
    await go("/einstellungen?bereich=bank");
    await card.getByRole("button", { name: "Entfernen" }).click();
    await bestaetigen(page, "Entfernen");
    await expect(card.getByLabel("Privater Schlüssel (.pem)")).toBeVisible();
  } finally {
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Farbe und Modus wechseln, bleiben nach dem Neuladen, Version unten in der Navigation", async () => {
  await go("/");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("link", { name: /^Haben \d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/ })).toBeVisible();
  const html = page.locator("html");
  await nav.getByLabel("Farbe").selectOption("pflaume");
  await nav.getByLabel("Modus").selectOption("dunkel");
  await expect(html).toHaveAttribute("data-theme", "pflaume");
  await expect(html).toHaveAttribute("data-mode", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "pflaume");
  await expect(html).toHaveAttribute("data-mode", "dark");
  await expect(nav.getByLabel("Farbe")).toHaveValue("pflaume");
  await expect(nav.getByLabel("Modus")).toHaveValue("dunkel");
  await nav.getByLabel("Farbe").selectOption("wald");
  await nav.getByLabel("Modus").selectOption("hell");
  await expect(html).toHaveAttribute("data-theme", "wald");
  await expect(html).toHaveAttribute("data-mode", "light");
});

test("Fristen und Kalender-Abo", async () => {
  await go("/fristen");
  await expect(page.getByRole("heading", { name: "Fristen", level: 1 })).toBeVisible();
  // „Später“ zeigt erst sechs Fristen, der Rest klappt auf
  const spaeter = page.getByRole("region", { name: /^Später/ });
  await expect(spaeter.getByRole("row")).toHaveCount(7);
  await spaeter.getByRole("button", { name: /^Alle \d+ zeigen$/ }).click();
  await expect(spaeter.getByRole("button", { name: /^Alle \d+ zeigen$/ })).toHaveCount(0);
  expect(await spaeter.getByRole("row").count()).toBeGreaterThan(7);
  await expect(page.getByText(/Umsatzsteuer-Voranmeldung/).first()).toBeVisible();
  const abo = page.getByRole("region", { name: "Erinnerungen im Kalender" });
  await abo.getByRole("button", { name: "Kalender-Abo einrichten" }).click();
  const url = await abo.getByLabel(/Abo-Link/).inputValue();
  expect(url).toMatch(/\/api\/fristen\/kalender\?token=[\w-]{32}$/);
  const ics = await page.request.get(url);
  expect(ics.status()).toBe(200);
  expect(await ics.text()).toContain("BEGIN:VCALENDAR");
  expect((await page.request.get(url.replace(/token=.*/, "token=falsch"))).status()).toBe(404);

  // Neuer Link: Der alte stirbt erst nach der Rückfrage
  await go("/fristen");
  await abo.getByRole("button", { name: "Neuen Link erzeugen" }).click();
  const neuerLink = page.getByRole("dialog", { name: "Neuen Abo-Link erzeugen?" });
  await expect(neuerLink).toContainText("sofort ungültig");
  await neuerLink.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect((await page.request.get(url)).status()).toBe(200);
  await abo.getByRole("button", { name: "Neuen Link erzeugen" }).click();
  await bestaetigen(page, "Neuen Link erzeugen");
  const zweiterLink = await abo.getByLabel(/Abo-Link/).inputValue();
  expect(zweiterLink).not.toBe(url);
  expect((await page.request.get(url)).status()).toBe(404);

  // Beenden ebenso
  await go("/fristen");
  await abo.getByRole("button", { name: "Abo beenden" }).click();
  const beenden = page.getByRole("dialog", { name: "Kalender-Abo beenden?" });
  await expect(beenden).toContainText("nicht mehr");
  await beenden.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect((await page.request.get(zweiterLink)).status()).toBe(200);
  await abo.getByRole("button", { name: "Abo beenden" }).click();
  await bestaetigen(page, "Abo beenden");
  await expect(abo.getByRole("button", { name: "Kalender-Abo einrichten" })).toBeVisible();
  expect((await page.request.get(zweiterLink)).status()).toBe(404);
});

test("Pauschalen: Homeoffice, Fahrt, Verpflegung und Storno", async () => {
  await go("/pauschalen");
  await expect(page.getByRole("heading", { name: /^Pauschalen \d{4}$/, level: 1 })).toBeVisible();
  const neu = page.getByRole("region", { name: "Pauschale eintragen" });

  const homeoffice = neu.getByRole("form", { name: "Homeoffice-Pauschale" });
  await homeoffice.getByLabel("Tage im Homeoffice", { exact: true }).fill("12");
  await homeoffice.getByRole("button", { name: "72,00\u00a0€ buchen" }).click();
  await expect(neu.getByRole("status")).toHaveText("Homeoffice-Pauschale über 72,00\u00a0€ gebucht.");

  await neu.getByRole("button", { name: "Fahrt", exact: true }).click();
  const fahrt = neu.getByRole("form", { name: "Fahrt mit dem Privatfahrzeug" });
  await fahrt.getByLabel("Anlass und Ziel", { exact: true }).fill("Workshop Nordwerk, Karlsruhe");
  await fahrt.getByLabel("Kilometer einfach", { exact: true }).fill("42,5");
  await fahrt.getByRole("button", { name: "25,50\u00a0€ buchen" }).click();
  await expect(neu.getByRole("status")).toHaveText("Fahrt über 25,50\u00a0€ gebucht.");

  await neu.getByRole("button", { name: "Verpflegung", exact: true }).click();
  const verpflegung = neu.getByRole("form", { name: "Verpflegungsmehraufwand" });
  await verpflegung.getByLabel("Anlass und Ort", { exact: true }).fill("Kundenprojekt, München");
  await verpflegung.getByRole("combobox", { name: /^Reisetag/ }).selectOption("ganztag");
  await verpflegung.getByLabel("Frühstück", { exact: true }).check();
  await verpflegung.getByRole("button", { name: "22,40\u00a0€ buchen" }).click();
  await expect(neu.getByRole("status")).toHaveText("Verpflegungsmehraufwand über 22,40\u00a0€ gebucht.");

  const liste = page.getByRole("region", { name: /^Eingetragen in/ });
  await expect(liste.getByRole("row")).toHaveCount(4);
  const zeile = liste.getByRole("row").filter({ hasText: "Karlsruhe" });
  await zeile.getByRole("button", { name: "Stornieren" }).click();
  await faktenZeigen(page, "Datum", "Betrag");
  await bestaetigen(page, "Stornieren");
  await expect(zeile.getByText("storniert", { exact: true })).toBeVisible();
  await expect(page.getByText("94,40\u00a0€", { exact: true })).toBeVisible();
});

test("Beleg mit § 13b: Steuer selbst berechnet, gezahlt wird netto", async ({ browser }) => {
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "cloud.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Cloud EMEA Ltd") }]);
  await expect(page.getByText("cloud.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /cloud\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/^USt-IdNr\. des Lieferanten/).fill("IE6388047V");
  await page.getByLabel("Netto", { exact: true }).fill("100");
  await expect(page.getByLabel("Vorsteuer", { exact: true })).toBeEditable();
  await page.getByLabel("Vorsteuer", { exact: true }).fill("0");
  await expect(page.getByText(/meist § 13b/)).toBeVisible();
  await page.getByRole("combobox", { name: /^Umsatzsteuer auf dem Beleg/ }).selectOption("eu");
  await expect(page.getByLabel("Steuer § 13b")).toHaveValue("19,00");
  await expect(page.getByLabel("Steuer § 13b")).not.toBeEditable();
  await expect(page.getByLabel("Steuer § 13b")).toHaveAttribute("readonly", "");
  await expect(page.getByText("Steuer § 13b (automatisch)", { exact: true })).toBeVisible();
  await expect(page.getByText(/Kz 46\/47/)).toBeVisible();
  await expect(page.getByText("Zu zahlen (netto)")).toBeVisible();
  await page.getByLabel("Netto", { exact: true }).fill("200");
  await expect(page.getByLabel("Steuer § 13b")).toHaveValue("38,00");
  await page.getByRole("combobox", { name: /^Satz/ }).selectOption("700");
  await expect(page.getByLabel("Steuer § 13b")).toHaveValue("14,00");
  await page.getByRole("combobox", { name: /^Umsatzsteuer auf dem Beleg/ }).selectOption("drittland");
  await expect(page.getByLabel("Steuer § 13b")).not.toBeEditable();
  const gespeichert = page.waitForResponse((r) => r.url().includes("/_serverFn/") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  expect((await gespeichert).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Speichern", exact: true })).toBeDisabled();
  // Altbestand: Die bisherige Maske erlaubte, selbst geschuldete Steuer manuell auf 0 zu setzen.
  const sql = postgres(databaseUrlFuer("belege-steuern"), { max: 1 });
  try {
    await sql`update document_amounts set tax = 0 where document_id = ${page.url().split("/").pop()!}`;
  } finally {
    await sql.end();
  }
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Steuer § 13b")).toHaveValue("14,00");
  // Die Korrektur ist ungespeichert, damit auch „Bestätigen und buchen“ sie zuerst persistiert.
  await expect(page.getByRole("button", { name: "Speichern", exact: true })).toBeEnabled();
  const korrigiert = page.waitForResponse((r) => r.url().includes("/_serverFn/") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  expect((await korrigiert).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Speichern", exact: true })).toBeDisabled();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Steuer § 13b")).toHaveValue("14,00");
  // Auch gespeicherte Zeilen müssen bei einer Änderung weiter automatisch rechnen.
  await page.getByLabel("Netto", { exact: true }).fill("300");
  await expect(page.getByLabel("Steuer § 13b")).toHaveValue("21,00");
  await page.getByRole("combobox", { name: /^Umsatzsteuer auf dem Beleg/ }).selectOption("");
  await expect(page.getByLabel("Vorsteuer", { exact: true })).toBeEditable();
  await page.getByLabel("Vorsteuer", { exact: true }).fill("20,99");
  await page.getByLabel("Netto", { exact: true }).fill("400");
  await expect(page.getByLabel("Vorsteuer", { exact: true })).toHaveValue("20,99");
  // Nicht buchen: der Beleg würde die folgenden Auswertungen verändern
  await page.getByRole("button", { name: "Löschen" }).click();
  // Esc bricht nur die Rückfrage ab und bleibt beim Beleg
  const url = page.url();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Löschen", exact: true })).toBeVisible();
  expect(page.url()).toBe(url);
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
});

test("Beleg auf mehrere Kategorien aufteilen: Zeilen hinzufügen und entfernen, Summen gegen den Beleg", async ({ browser }) => {
  // Beispiel aus #271, je 19 %: 100 € Handelsware, 50 € Software, 20 € Bürobedarf = 170 € netto, 32,30 € Vorsteuer
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "buerohaus.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Bürohaus Nord GmbH") }]);
  await expect(page.getByText("buerohaus.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /buerohaus\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Lieferant", { exact: true }).fill("Bürohaus Nord GmbH");
  await page.getByLabel("Belegdatum").fill(day(-5));
  await page.getByLabel("Kategorie").selectOption("wareneinkauf");
  const amounts = page.getByRole("group", { name: "Beträge je Steuersatz" });
  await amounts.getByLabel("Netto", { exact: true }).fill("170,00");
  await expect(amounts.getByLabel("Vorsteuer", { exact: true })).toHaveValue("32,30");

  await page.getByRole("button", { name: "Auf mehrere Kategorien aufteilen" }).click();
  const split = page.getByRole("group", { name: "Aufteilung auf Kategorien" });
  // Erste Zeile mit der bisherigen Kategorie und dem ganzen Netto, dazu eine leere
  await expect(split.getByLabel("Kategorie")).toHaveCount(2);
  await expect(split.getByLabel("Kategorie").first()).toHaveValue("wareneinkauf");
  await split.getByRole("textbox", { name: "Netto", exact: true }).first().fill("100,00");
  await split.getByLabel("Kategorie").nth(1).selectOption("software");
  await split.getByRole("textbox", { name: "Netto", exact: true }).nth(1).fill("50,00");
  await expect(split.getByText("19 %: Zeilen 150,00 € von 170,00 € netto · noch 20,00 € zu verteilen")).toBeVisible();
  // Bis eine Kategorie gewählt ist, lässt sich nicht speichern
  await split.getByRole("button", { name: "+ Zeile" }).click();
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await split.getByLabel("Kategorie").nth(2).selectOption("buero");
  await split.getByRole("textbox", { name: "Netto", exact: true }).nth(2).fill("20,00");
  await expect(split.getByText("19 %: Zeilen 170,00 € von 170,00 € netto · stimmt")).toBeVisible();
  // Vorsteuer anteilig: 19,00 + 9,50 + 3,80 = 32,30
  await expect(split.getByText("Vorsteuer 19,00")).toBeVisible();
  await expect(split.getByText("Vorsteuer 9,50")).toBeVisible();
  await expect(split.getByText("Vorsteuer 3,80")).toBeVisible();

  // Eine vierte Zeile mit gleicher Kategorie und gleichem Satz, wieder entfernt
  await split.getByRole("button", { name: "+ Zeile" }).click();
  await split.getByLabel("Kategorie").nth(3).selectOption("software");
  await split.getByRole("textbox", { name: "Netto", exact: true }).nth(3).fill("5,00");
  await expect(split.getByText("19 %: Zeilen 175,00 € von 170,00 € netto · 5,00 € zu viel")).toBeVisible();
  await split.getByRole("button", { name: "Zeile 4 der Aufteilung entfernen" }).click();
  await expect(split.getByLabel("Kategorie")).toHaveCount(3);

  // Gespeichert und neu geladen: die Zeilen bleiben, nichts fehlt mehr vor dem Buchen
  // Erst neu laden, wenn der Server das Speichern beantwortet hat: „Speichern“ ist schon während der Anfrage gesperrt
  const gespeichert = page.waitForResponse((r) => r.url().includes("/_serverFn/") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Speichern" }).click();
  expect((await gespeichert).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("aufgeteilt auf 3 Zeilen")).toBeVisible();
  await expect(split.getByRole("textbox", { name: "Netto", exact: true })).toHaveCount(3);
  await expect(split.getByRole("textbox", { name: "Netto", exact: true }).nth(2)).toHaveValue("20,00");
  await expect(page.getByText(/Vor dem Buchen/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bestätigen und buchen" })).toBeEnabled();

  // Barrierefrei auch mit Aufteilung, am Desktop und am Handy
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  for (const width of [1440, 390]) {
    await axePage.setViewportSize({ width, height: 900 });
    await axePage.goto(page.url());
    await axePage.waitForLoadState("networkidle");
    await expect(axePage.getByRole("group", { name: "Aufteilung auf Kategorien" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page: axePage })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      `Beleg mit Aufteilung bei ${width} px`,
    ).toEqual([]);
  }
  await context.close();

  // Aufheben: wieder eine Kategorie, die der ersten Zeile
  await split.getByRole("button", { name: "Aufteilung aufheben" }).click();
  await expect(split).toHaveCount(0);
  await expect(page.getByLabel("Kategorie")).toHaveValue("wareneinkauf");
  // Nicht buchen: der Beleg würde die folgenden Auswertungen verändern; Buchung, EÜR, UStVA und DATEV prüfen die
  // Integrationstests in server/modules/belege/splits.test.ts
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
});

test("Beleg mit § 13b aufteilen: Steuer § 13b je Zeile, innergemeinschaftlicher Erwerb bleibt gesperrt", async ({ browser }) => {
  // Erfundene Sammelrechnung (#508): 200 € Gebühren und 50 € Werbung zu 19 % nach § 13b, 47,50 € Steuer
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "gebuehren.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Beispiel Payments Ltd.") }]);
  await expect(page.getByText("gebuehren.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /gebuehren\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Lieferant", { exact: true }).fill("Beispiel Payments Ltd.");
  await page.getByLabel("Belegdatum").fill(day(-5));
  await page.getByLabel("Kategorie").selectOption("geldverkehr");
  await page.getByLabel("Netto", { exact: true }).fill("250,00");

  await page.getByRole("combobox", { name: /^Umsatzsteuer auf dem Beleg/ }).selectOption("ig_erwerb");
  await expect(page.getByRole("button", { name: "Auf mehrere Kategorien aufteilen" })).toBeDisabled();
  await expect(page.getByText("mit innergemeinschaftlichem Erwerb noch nicht möglich")).toBeVisible();

  await page.getByRole("combobox", { name: /^Umsatzsteuer auf dem Beleg/ }).selectOption("eu");
  await expect(page.getByLabel("Steuer § 13b")).toHaveValue("47,50");
  await page.getByRole("button", { name: "Auf mehrere Kategorien aufteilen" }).click();
  const split = page.getByRole("group", { name: "Aufteilung auf Kategorien" });
  await expect(split.getByLabel("Kategorie").first()).toHaveValue("geldverkehr");
  await split.getByRole("textbox", { name: "Netto", exact: true }).first().fill("200,00");
  await split.getByLabel("Kategorie").nth(1).selectOption("werbung");
  await split.getByRole("textbox", { name: "Netto", exact: true }).nth(1).fill("50,00");
  await expect(split.getByText("19 %: Zeilen 250,00 € von 250,00 € netto · stimmt")).toBeVisible();
  await expect(split.getByText("Steuer § 13b 38,00")).toBeVisible();
  await expect(split.getByText("Steuer § 13b 9,50")).toBeVisible();

  const gespeichert = page.waitForResponse((r) => r.url().includes("/_serverFn/") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Speichern" }).click();
  expect((await gespeichert).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("aufgeteilt auf 2 Zeilen")).toBeVisible();
  await expect(page.getByText(/Vor dem Buchen/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bestätigen und buchen" })).toBeEnabled();
  // Nicht buchen: Buchung, Voranmeldung, EÜR und DATEV prüfen die Integrationstests in server/modules/belege/splits-13b.test.ts
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
});

test("Beleg am Handy: Beträge sind auch mit 16 px Schrift ganz zu lesen", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const handy = await context.newPage();
  await handy.goto("/belege");
  await handy.waitForLoadState("networkidle");
  await handy
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "handy-betraege.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Bürohaus Nord GmbH") }]);
  await expect(handy.getByText("handy-betraege.jpg: abgelegt.")).toBeVisible();
  await handy
    .getByRole("link", { name: /handy-betraege\.jpg/ })
    .first()
    .click();
  await handy.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await handy.waitForLoadState("networkidle");

  /** Felder, deren Inhalt breiter ist als das Feld: Beim Betrag wären die letzten Ziffern nicht zu sehen */
  const abgeschnitten = (selektor: string) =>
    handy
      .locator(selektor)
      .evaluateAll((felder) =>
        (felder as HTMLInputElement[]).filter((f) => f.scrollWidth > f.clientWidth + 1).map((f) => `${f.value}: ${f.scrollWidth} > ${f.clientWidth}`),
      );

  await handy.getByLabel("Kategorie").selectOption("wareneinkauf");
  await handy.locator(".amount-row").getByLabel("Netto", { exact: true }).fill("500,00");
  await handy.locator(".amount-row").getByLabel("Vorsteuer", { exact: true }).fill("95,00");
  expect.soft(await abgeschnitten(".amount-row input[inputmode='decimal']"), "Netto und Vorsteuer des Belegs").toEqual([]);

  await handy.getByRole("button", { name: "Auf mehrere Kategorien aufteilen" }).click();
  const netto = handy.locator(".document-split-row input[inputmode='decimal']");
  await expect(netto.first()).toBeVisible();
  await netto.first().fill("1.234,56");
  expect.soft(await abgeschnitten(".document-split-row input[inputmode='decimal']"), "Netto in der Aufteilung").toEqual([]);

  // Nicht buchen: Die folgenden Tests zählen die Belege und Auswertungen
  await handy.getByRole("button", { name: "Löschen", exact: true }).click();
  await bestaetigen(handy, "Beleg löschen");
  await handy.waitForURL(/\/belege$/);
  await context.close();
});

test("Lieferant im Kontaktverzeichnis und im Beleg auswählen", async ({ browser }) => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Hetzner Online GmbH");
  await page.getByLabel("Kunde", { exact: true }).uncheck();
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByLabel("USt-IdNr.").fill("DE812871812");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  // Filter in der Liste: Lieferanten zeigt ihn, Kunden nicht; im Rechnungseditor steht er nicht zur Auswahl
  await go("/kontakte?rolle=lieferant");
  await expect(page.getByRole("region", { name: "Kontaktliste" })).toContainText("Hetzner Online GmbH");
  await go("/kontakte?rolle=kunde");
  await expect(page.getByRole("region", { name: "Kontaktliste" })).not.toContainText("Hetzner Online GmbH");
  await go("/rechnungen/neu");
  // Nur Kunden in der Suche: Für den Lieferanten bleibt allein das Anlegen
  await page.getByRole("combobox", { name: "Kunde", exact: true }).fill("Hetzner");
  await expect(trefferliste(page).getByRole("option")).toHaveText("„Hetzner“ als neuen Kunden anlegen");

  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "hetzner.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Hetzner Online GmbH") }]);
  await expect(page.getByText("hetzner.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /hetzner\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await lieferantWaehlen(page, "Hetzner Online GmbH · DE812871812");
  await expect(page.getByLabel("Lieferant", { exact: true })).toHaveValue("Hetzner Online GmbH");
  await expect(page.getByLabel(/^USt-IdNr\. des Lieferanten/)).toHaveValue("DE812871812");

  // Lieferant direkt im Beleg anlegen (#330): Name und USt-IdNr. vom Beleg, Rolle Lieferant, Eingaben bleiben
  await page.getByLabel("Rechnungsnummer").fill("H-2026-77");
  const dialog = page.getByRole("dialog", { name: "Neuen Lieferanten anlegen" });
  await neuenLieferantenOeffnen(page);
  await expect(dialog.getByLabel("Name oder Firma")).toHaveValue("Hetzner Online GmbH");
  await expect(dialog.getByLabel("Lieferant", { exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Kunde", { exact: true })).not.toBeChecked();
  // Gleiche USt-IdNr.: Haben bietet den vorhandenen Kontakt an, statt eine Dublette anzulegen
  await expect(dialog.getByRole("status")).toContainText("gibt es schon „Hetzner Online GmbH“");
  await dialog.getByRole("button", { name: "„Hetzner Online GmbH“ wählen" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Aus den Kontakten" })).toHaveValue(/\S/);

  await neuenLieferantenOeffnen(page);
  await dialog.getByLabel("Name oder Firma").fill("Druckerei Süd GmbH");
  await dialog.getByLabel("USt-IdNr.").fill("");
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Lieferant", { exact: true })).toHaveValue("Druckerei Süd GmbH");
  await expect(page.getByRole("combobox", { name: "Aus den Kontakten" })).toHaveValue("Druckerei Süd GmbH");
  await expect(page.getByLabel("Rechnungsnummer")).toHaveValue("H-2026-77");
  // Nicht buchen: Beleg löschen und die Lieferanten archivieren, damit die folgenden Tests unverändert rechnen
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
  for (const name of ["Hetzner Online GmbH", "Druckerei Süd GmbH"]) {
    await go("/kontakte?rolle=lieferant");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    // Reiner Lieferant ohne gebuchten Beleg (#587): Abschnitt für Belege mit Hinweis, keiner für Rechnungen
    await expect(page.getByRole("region", { name: "Ausgaben und Belege", exact: true })).toContainText("Noch keine gebuchten Belege von diesem Kontakt.");
    await expect(page.getByRole("region", { name: "Umsatz und Rechnungen", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Archivieren" }).click();
    await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
  }
});

test("Dauerbeleg: Lieferanten suchen und direkt anlegen, ohne die Eingaben zu verlieren", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Suchfirma Nord GmbH");
  await page.getByLabel("Kunde", { exact: true }).uncheck();
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByLabel("Ort").fill("Kiel");
  await page.getByLabel("Lieferantennummer").fill("L-4711");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  // Ein Kunde mit USt-IdNr.: Wer ihn als Lieferanten anlegen will, bekommt einen Hinweis, aber keine Wahl
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Kundenfirma Ost AG");
  await page.getByLabel("USt-IdNr.").fill("DE123456789");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  await go("/dauerbelege/neu");
  await page.getByLabel("Bezeichnung").fill("Wartung Server");
  const kontakte = page.getByRole("combobox", { name: "Aus den Kontakten" });
  // Gesucht wird auch nach der Lieferantennummer; die Zeile zeigt Nummer und Ort
  await kontakte.fill("L-4711");
  await expect(trefferliste(page).getByRole("option")).toHaveCount(2);
  await expect(trefferliste(page).getByRole("option").first()).toContainText("Suchfirma Nord GmbH");
  await expect(trefferliste(page).getByRole("option").first()).toContainText("L-4711 · Kiel");
  await trefferliste(page).getByRole("option").first().click();
  await expect(kontakte).toHaveValue("Suchfirma Nord GmbH · Kiel");
  await expect(page.getByLabel("Lieferant", { exact: true })).toHaveValue("Suchfirma Nord GmbH");

  // Der getippte Name geht in den Dialog; nach dem Speichern ist der neue Lieferant gewählt
  await neuenLieferantenOeffnen(page, "Neufirma Süd");
  const dialog = page.getByRole("dialog", { name: "Neuen Lieferanten anlegen" });
  await expect(dialog.getByLabel("Name oder Firma")).toHaveValue("Neufirma Süd");
  await expect(dialog.getByLabel("Lieferant", { exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Kunde", { exact: true })).not.toBeChecked();
  // Gleiche USt-IdNr. wie bei einem Kunden, auch mit Leerzeichen: Der Server findet ihn unter allen Kontakten. Er ist kein
  // Lieferant, also nur der Hinweis mit Link; ihn als Lieferanten zu wählen gäbe es nicht
  await dialog.getByLabel("USt-IdNr.").fill("de 123 456 789");
  await expect(dialog.getByRole("status")).toContainText("gibt es schon „Kundenfirma Ost AG“ (Kunde)");
  await expect(dialog.getByRole("link", { name: "„Kundenfirma Ost AG“ öffnen" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "„Kundenfirma Ost AG“ wählen" })).toHaveCount(0);
  await dialog.getByLabel("USt-IdNr.").fill("");
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await dialog.getByLabel("Ort").fill("Köln");
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();
  await expect(kontakte).toHaveValue("Neufirma Süd · Köln");
  await expect(page.getByLabel("Lieferant", { exact: true })).toHaveValue("Neufirma Süd");
  await expect(page.getByLabel("Bezeichnung")).toHaveValue("Wartung Server");
  // Der Dialog schickt das Formular nicht ab: Es steht noch auf der Seite „Neuer Dauerbeleg“
  await expect(page).toHaveURL(/\/dauerbelege\/neu$/);

  // Nicht speichern; die Lieferanten archivieren, damit die folgenden Tests unverändert rechnen
  for (const name of ["Suchfirma Nord GmbH", "Neufirma Süd", "Kundenfirma Ost AG"]) {
    await go("/kontakte");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Archivieren" }).click();
    await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
  }
});

test("Dialog „Neuen Lieferanten anlegen“: Der wählbare Lieferant wird angeboten, auch wenn ein Kunde mit derselben USt-IdNr. davor steht", async () => {
  // Sechs Kunden (Niederlassungen) vor dem Lieferanten: Der Server liefert nur fünf Treffer, der Lieferant fehlt also, wenn
  // die gewünschte Rolle nicht bis dorthin gelangt
  const KUNDEN = ["AAA", "AAB", "AAC", "AAD", "AAE", "AAF"].map((k) => `${k} Wahl Kunde GmbH`);
  for (const [name, kunde, lieferant] of [...KUNDEN.map((n) => [n, true, false] as const), ["ZZZ Wahl Lieferant GmbH", false, true] as const]) {
    await go("/kontakte/neu");
    await page.getByLabel("Name oder Firma").fill(name);
    if (!kunde) await page.getByLabel("Kunde", { exact: true }).uncheck();
    if (lieferant) await page.getByLabel("Lieferant", { exact: true }).check();
    await page.getByLabel("USt-IdNr.").fill("DE100000020");
    await page.getByRole("button", { name: "Kontakt anlegen" }).click();
    await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  }

  await go("/dauerbelege/neu");
  await neuenLieferantenOeffnen(page, "Probe Neu");
  const dialog = page.getByRole("dialog", { name: "Neuen Lieferanten anlegen" });
  await dialog.getByLabel("USt-IdNr.").fill("DE100000020");
  // Der Server nennt beide; der Hinweis nimmt den, den man als Lieferanten wählen kann, nicht den Kunden davor
  await expect(dialog.getByRole("status")).toContainText("gibt es schon „ZZZ Wahl Lieferant GmbH“ (Lieferant)");
  await expect(dialog.getByRole("button", { name: "„ZZZ Wahl Lieferant GmbH“ wählen" })).toBeVisible();

  // Nicht speichern; beide archivieren, damit die folgenden Tests unverändert rechnen
  for (const name of [...KUNDEN, "ZZZ Wahl Lieferant GmbH"]) {
    await go("/kontakte");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Archivieren" }).click();
    await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
  }
});

test("Kontaktformular: Gleiche USt-IdNr. wird gemeldet, auch beim archivierten Kontakt; der eigene Kontakt meldet sich nicht", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Altbestand USt GmbH");
  await page.getByLabel("USt-IdNr.").fill("DE555555555");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();

  // Ein Kontakt mit beiden Rollen: Im normalen Formular fehlt ihm keine Rolle, der Hinweis sagt das nicht
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Beides USt GmbH");
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByLabel("USt-IdNr.").fill("DE777777777");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Dritter USt GmbH");
  await page.getByLabel("USt-IdNr.").fill("DE777777777");
  const beides = page.getByRole("status").filter({ hasText: "gibt es schon" });
  await expect(beides).toContainText("gibt es schon „Beides USt GmbH“ (Kunde, Lieferant)");
  await expect(beides).not.toContainText("Ergänze dort die Rolle");
  await expect(beides.getByRole("link", { name: "„Beides USt GmbH“ öffnen" })).toBeVisible();

  // Im normalen Formular, nicht nur im Dialog: Der archivierte Kontakt kann man nicht wählen, nur wiederherstellen
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Neubestand USt GmbH");
  await page.getByLabel("USt-IdNr.").fill("DE555555555");
  const hinweis = page.getByRole("status").filter({ hasText: "gibt es schon" });
  await expect(hinweis).toContainText("gibt es schon „Altbestand USt GmbH“ (Kunde, archiviert)");
  await expect(hinweis).toContainText("Stelle ihn unter Kontakte wieder her");
  await expect(hinweis).not.toContainText("Ergänze dort die Rolle");
  await expect(hinweis.getByRole("link", { name: "„Altbestand USt GmbH“ öffnen" })).toBeVisible();
  await page.getByLabel("USt-IdNr.").fill("DE666666666");
  await expect(hinweis).toHaveCount(0);
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  // Beim Bearbeiten nennt der Server den eigenen Kontakt nicht (excludeId), wohl aber einen fremden mit derselben USt-IdNr.
  await page.waitForTimeout(1000);
  await expect(hinweis).toHaveCount(0);
  await page.getByLabel("USt-IdNr.").fill("DE555555555");
  await expect(hinweis).toContainText("gibt es schon „Altbestand USt GmbH“");
  await page.getByLabel("USt-IdNr.").fill("DE666666666");
  await expect(hinweis).toHaveCount(0);

  // Nicht speichern; den neuen Kontakt und den mit beiden Rollen archivieren, damit die folgenden Tests unverändert rechnen
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
  await go("/kontakte");
  await page.getByRole("link", { name: /Beides USt GmbH/ }).click();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Auswertungen, Umsatzsteuer und Jahreserklärung laden", async () => {
  await go("/auswertungen");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Beträge rechtsbündig, Monate mittig: TanStack Redact 0.3.1 setzt das SVG-Attribut textAnchor nicht um,
  // deshalb steht es im Stil, und dieser Test prüft, was der Browser daraus macht
  const anchors = await page.locator(".chart .tick").evaluateAll((ticks) => ticks.map((tick) => getComputedStyle(tick).textAnchor));
  expect(anchors).toContain("end");
  expect(anchors).toContain("middle");
  await go("/umsatzsteuer");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await go(`/jahreserklaerung/${YEAR - 1}`);
  await expect(page.getByRole("heading", { name: /Steuerjahr/ })).toBeVisible();
  // Ohne eigene Hersteller-ID: Werte für die Erweiterung, die Mein ELSTER ausfüllt
  await expect(
    page.getByRole("region", { name: /^Anlage EÜR \d{4} in Mein ELSTER$/ }).getByRole("button", { name: "Werte für Mein ELSTER kopieren" }),
  ).toBeVisible();
  await go("/finanzamt");
  await expect(page.getByRole("heading", { name: "Finanzamt", level: 1 })).toBeVisible();
});

test("Voranmeldung als XML für den Import in Mein ELSTER herunterladen", async () => {
  await go("/umsatzsteuer");
  const save = page.getByRole("button", { name: "Entwurf speichern" });
  if (await save.isEnabled()) {
    await save.click();
    await expect(save).toBeDisabled();
  }
  const link = page.getByRole("link", { name: "XML für Mein ELSTER" });
  await expect(link).toBeVisible();
  // Zweiter Weg ohne Hersteller-ID: Werte für die Erweiterung
  await expect(page.getByRole("button", { name: "Werte für Mein ELSTER kopieren" })).toBeEnabled();
  const response = await page.request.get((await link.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/xml; charset=ISO-8859-15");
  expect(response.headers()["content-disposition"]).toMatch(/filename="UStVA_\d{4}-\d{2}\.xml"/);
  const xml = new TextDecoder("iso-8859-15").decode(await response.body());
  expect(xml).toMatch(
    /^<\?xml version="1.0" encoding="ISO-8859-15" standalone="no"\?>\n<Anmeldungssteuern xmlns="http:\/\/finkonsens.de\/elster\/elsteranmeldung\/ustva\/v\d{4}"/,
  );
  expect(xml).not.toContain("<TransferHeader");
});

test("Voranmeldung vierteljährlich: Zeitraum einstellen, Quartal prüfen und testweise senden", async () => {
  // Im Folgejahr, damit die übrigen Seiten und Bilder beim monatlichen Zeitraum bleiben
  const next = YEAR + 1;
  await go(`/umsatzsteuer/${next}-01`);
  const card = page.getByRole("form", { name: `Voranmeldungszeitraum ${next}` });
  await expect(card).toContainText("monatlich");
  await card.getByRole("combobox", { name: "Zeitraum" }).selectOption("vierteljaehrlich");
  await card.getByLabel("Gilt ab").selectOption("1");
  await card.getByRole("button", { name: "Zeitraum speichern" }).click();
  await expect(card.getByRole("status")).toContainText(`Voranmeldungszeitraum ${next} gespeichert.`);
  // Der Januar passt nicht mehr dazu
  await expect(page.getByText(`Für Januar ${next} passt die Voranmeldung nicht zum eingestellten Zeitraum (vierteljährlich).`)).toBeVisible();

  await go(`/umsatzsteuer/${next}-Q1`);
  await expect(page.getByRole("heading", { level: 1, name: `1. Quartal ${next}` })).toBeVisible();
  // 10. April oder der nächste Werktag danach (§ 108 Abs. 3 AO)
  await expect(page.getByText("Fällig am", { exact: false })).toContainText(`April ${next}`);
  // axe prüft das Quartal und den Bereich Voranmeldungszeitraum in barrierefreiheit.spec.ts

  // Die Voranmeldung, nicht der Antrag auf Dauerfristverlängerung daneben. Nach Prüfen und Senden zeigt die Seite die
  // Meldung, bevor React die neu geladenen Daten einsetzt; mit ihnen baut sich das Formular neu auf (Schlüssel aus dem
  // Stand des Entwurfs) und verliert PIN und Auswahl. Erst weiter, wenn der Verlauf den neuen Eintrag zeigt
  const elster = page.getByRole("form", { name: "An ELSTER übermitteln" });
  const history = page.getByRole("region", { name: `Verlauf 1. Quartal ${next}` });
  await elster.getByRole("button", { name: "Nur prüfen" }).click();
  await expect(page.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await expect(history).toContainText(/Prüfung\s*OK/);
  const testSend = elster.getByRole("button", { name: "Prüfen und testweise senden" });
  await elster.getByLabel("Zertifikats-PIN").fill("123456");
  await testSend.click();
  await expect(page.getByText(/Testübermittlung erfolgreich/)).toBeVisible();
  await expect(history).toContainText(/Testübermittlung\s*OK/);

  // Zurück auf monatlich: Der Entwurf des Quartals bleibt mit seinem Verlauf, lässt sich aber nicht mehr senden
  const frequency = page.getByRole("form", { name: `Voranmeldungszeitraum ${next}` });
  await frequency.getByRole("combobox", { name: "Zeitraum" }).selectOption("monatlich");
  await frequency.getByRole("button", { name: "Zeitraum speichern" }).click();
  await expect(frequency.getByRole("status")).toContainText(`Voranmeldungszeitraum ${next} gespeichert.`);
  await expect(frequency).toContainText("Eingestellt: monatlich");
  await expect(page.getByText(`Für 1. Quartal ${next} passt die Voranmeldung nicht zum eingestellten Zeitraum (monatlich).`)).toBeVisible();
});

test("Dauerfristverlängerung: Sondervorauszahlung prüfen und testweise senden, Kz 39 im Dezember", async () => {
  // Im Folgejahr, damit die übrigen Seiten und Bilder ohne Dauerfristverlängerung bleiben
  const next = YEAR + 1;
  await go(`/umsatzsteuer/${next}-01`);
  const card = page.getByRole("region", { name: `Dauerfristverlängerung ${next}` });
  await expect(card).toContainText("Nicht eingetragen");
  const amount = card.getByRole("textbox", { name: "Sondervorauszahlung (Kz 38, volle Euro)" });
  await amount.fill("1.234,56");
  await expect(card.getByText("Betrag in vollen Euro, nicht negativ.")).toBeVisible();
  await amount.fill("1.234");
  const submit = card.getByRole("form", { name: "Sondervorauszahlung an ELSTER" });
  await submit.getByRole("button", { name: "Nur prüfen" }).click();
  await expect(submit.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await submit.getByLabel("Zertifikats-PIN").fill("123456");
  await submit.getByRole("button", { name: "Prüfen und testweise senden" }).click();
  await expect(submit.getByText(/Testübermittlung erfolgreich/)).toBeVisible();
  await expect(card.getByRole("list", { name: `Verlauf Dauerfristverlängerung ${next}` })).toContainText("Testübermittlung OK");

  // Außerhalb von Haben beantragt: von Hand eintragen, dann zieht der Dezember die Sondervorauszahlung ab
  const manual = card.getByRole("form", { name: "Außerhalb von Haben" });
  await manual.getByRole("checkbox", { name: `Dauerfristverlängerung besteht für ${next}` }).check();
  await manual.getByRole("button", { name: "Stand speichern" }).click();
  await expect(manual.getByRole("status")).toContainText(`Dauerfristverlängerung für ${next} eingetragen.`);
  await expect(card).toContainText("Voranmeldungen sind einen Monat später fällig");

  await go(`/umsatzsteuer/${next}-12`);
  await expect(page.getByText("Abzug der festgesetzten Sondervorauszahlung")).toBeVisible();
  await expect(page.locator("#kz-39")).toHaveText(/1\.234,00/);
  // Dezember mit Dauerfristverlängerung: fällig im Februar
  await expect(page.getByText("Fällig am", { exact: false })).toContainText(`Februar ${next + 1}`);

  // Wieder beenden, damit Fristen und Bilder ohne Verlängerung bleiben
  await go(`/umsatzsteuer/${next}-01`);
  const again = page.getByRole("region", { name: `Dauerfristverlängerung ${next}` }).getByRole("form", { name: "Außerhalb von Haben" });
  await again.getByRole("checkbox", { name: `Dauerfristverlängerung besteht für ${next}` }).uncheck();
  await again.getByRole("button", { name: "Stand speichern" }).click();
  await expect(again.getByRole("status")).toContainText(`Dauerfristverlängerung ab ${next} beendet.`);
});

test("Zusammenfassende Meldung: Leistung ins EU-Ausland, Quartal prüfen und testweise senden", async () => {
  // Im Folgejahr wie die Dauerfristverlängerung, damit die Zahlen des laufenden Jahres und die Bilder gleich bleiben
  const next = YEAR + 1;
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("USt-IdNr.").fill("DE136695976");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Donaublick GmbH");
  await page.getByLabel("Straße und Hausnummer").fill("Praterstraße 3");
  await page.getByLabel("PLZ").fill("1020");
  await page.getByLabel("Ort").fill("Wien");
  await page.getByLabel("Land (ISO-Code)").fill("AT");
  await page.getByLabel("USt-IdNr.").fill("ATU12345678");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Donaublick GmbH · Wien");
  await page.getByLabel("Rechnungsdatum").fill(`${next}-02-10`);
  await page.getByRole("combobox", { name: "Umsatzsteuer", exact: true }).selectOption("reverse_charge");
  await page.getByLabel("Beschreibung Position 1").fill("Beratung Cloud-Architektur");
  await page.getByLabel("Menge Position 1").fill("2");
  await page.getByLabel(/Einzelpreis Position 1/).fill("1.200,50");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });

  // Die Voranmeldung des Monats verweist auf die Meldung des Quartals
  await go(`/umsatzsteuer/${next}-02`);
  await page.getByRole("link", { name: "Zur Zusammenfassenden Meldung" }).click();
  await expect(page).toHaveURL(new RegExp(`/umsatzsteuer/zm/${next}-Q1$`));
  await expect(page.getByRole("heading", { name: `1. Quartal ${next}` })).toBeVisible();
  const zeilen = page.getByRole("table", { name: `Meldezeilen 1. Quartal ${next}` });
  await expect(zeilen).toContainText("ATU12345678");
  await expect(zeilen).toContainText("Sonstige Leistung");
  await expect(zeilen).toContainText("2.401 €");

  const submit = page.getByRole("form", { name: "Meldung an das BZSt" });
  await submit.getByRole("button", { name: "Nur prüfen" }).click();
  await expect(submit.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await submit.getByLabel("Zertifikats-PIN").fill("123456");
  await submit.getByRole("button", { name: "Prüfen und testweise senden" }).click();
  await expect(submit.getByText(/Testübermittlung erfolgreich/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Verlauf" })).toContainText("Testübermittlung OK");
  // Eine Testübermittlung zählt nicht als gemeldet: weiter als Erstmeldung
  await expect(page.getByRole("form", { name: "Meldung an das BZSt" })).toBeVisible();
});

test("Innergemeinschaftliche Lieferung: Kz 41 in der Voranmeldung und Umsatzart L in der Zusammenfassenden Meldung", async () => {
  // Nach der Zusammenfassenden Meldung oben: USt-IdNr. in den Firmendaten und der Kunde in Wien sind angelegt
  const next = YEAR + 1;
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Donaublick GmbH · Wien");
  await page.getByLabel("Rechnungsdatum").fill(`${next}-05-12`);
  await page.getByRole("combobox", { name: "Umsatzsteuer", exact: true }).selectOption("ig_lieferung");
  await expect(page.getByText(/Gelangensnachweis \(§ 17a UStDV\)/)).toBeVisible();
  await page.getByLabel("Beschreibung Position 1").fill("Industrierechner");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("3.000,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });

  await go(`/umsatzsteuer/${next}-05`);
  await expect(page.getByText("Steuerfreie innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.")).toBeVisible();
  await expect(page.locator("#kz-41")).toHaveText(/3\.000,00/);
  await page.getByRole("link", { name: "Zur Zusammenfassenden Meldung" }).click();
  await expect(page).toHaveURL(new RegExp(`/umsatzsteuer/zm/${next}-Q2$`));
  const zeilen = page.getByRole("table", { name: `Meldezeilen 2. Quartal ${next}` });
  await expect(zeilen).toContainText("ATU12345678");
  await expect(zeilen).toContainText("Innergemeinschaftliche Lieferung");
  await expect(zeilen).toContainText("3.000 €");
  await expect(page.getByText(/Gelangensnachweis \(§ 17a UStDV\)/)).toBeVisible();
});

test("Beleg mit innergemeinschaftlichem Erwerb: 500 € netto, 95 € Erwerbsteuer, gezahlt wird netto", async ({ browser }) => {
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "hardware-nl.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Hollandse Hardware B.V.") }]);
  await expect(page.getByText("hardware-nl.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /hardware-nl\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/^USt-IdNr\. des Lieferanten/).fill("NL123456789B01");
  await page.getByLabel("Kategorie").selectOption("wareneinkauf");
  await page.getByLabel("Netto", { exact: true }).fill("500");
  await page.getByLabel("Vorsteuer", { exact: true }).fill("0");
  await expect(page.getByText(/bei Ware ein innergemeinschaftlicher Erwerb/)).toBeVisible();
  await page.getByRole("combobox", { name: /^Umsatzsteuer auf dem Beleg/ }).selectOption("ig_erwerb");
  const tax = page.getByLabel(/^Erwerbsteuer/);
  await expect(tax).toHaveValue("95,00");
  await expect(tax).toHaveAttribute("readonly", "");
  await expect(page.getByText("Erwerbsteuer (automatisch)", { exact: true })).toBeVisible();
  await page.getByLabel("Netto", { exact: true }).fill("600");
  await expect(tax).toHaveValue("114,00");
  await page.getByRole("combobox", { name: /^Satz/ }).selectOption("700");
  await expect(tax).toHaveValue("42,00");
  await expect(page.getByText(/Kz 89 \(19 %\)/)).toBeVisible();
  await expect(page.getByText("Zu zahlen (netto)")).toBeVisible();
  // Nicht buchen: der Beleg würde die folgenden Auswertungen und Bilder verändern
  await page.getByRole("button", { name: "Löschen" }).click();
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
});

test("Skonto: Vorgabe und Kunde, Rechnung mit Skonto, Zahlung mit Skonto abgleichen", async ({ browser }) => {
  // Vorgabe in den Firmendaten: 2 % in 10 Tagen
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByRole("button", { name: "Skontostufe hinzufügen" }).click();
  await firma.getByLabel("Stufe 1: Skonto in %").fill("2");
  await firma.getByLabel("Stufe 1: Frist in Tagen").fill("10");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(firma.getByRole("status")).toContainText("Firmendaten gespeichert.");

  // Ein Kunde mit eigenem Skonto: 3 % in 7 Tagen
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Kontor Lindner KG");
  await page.getByLabel("Straße und Hausnummer").fill("Speicherstadt 4");
  await page.getByLabel("PLZ").fill("20457");
  await page.getByLabel("Ort").fill("Hamburg");
  await page.getByRole("combobox", { name: /^Skonto/ }).selectOption("eigen");
  await page.getByRole("button", { name: "Skontostufe hinzufügen" }).click();
  await page.getByLabel("Stufe 1: Skonto in %").fill("3");
  await page.getByLabel("Stufe 1: Frist in Tagen").fill("7");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  // Neue Rechnung: erst die Vorgabe der Firma, mit dem Kunden dessen Skonto; Datum und Betrag stehen daneben
  const issueDate = day(-2);
  await go("/rechnungen/neu");
  await expect(page.getByLabel("Stufe 1: Skonto in %")).toHaveValue("2");
  await kundeWaehlen(page, "Kontor Lindner KG · Hamburg");
  await expect(page.getByLabel("Stufe 1: Skonto in %")).toHaveValue("3");
  await expect(page.getByLabel("Stufe 1: Frist in Tagen")).toHaveValue("7");
  await page.getByLabel("Rechnungsdatum").fill(issueDate);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung Lagerlogistik");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("1.000,00");
  const until = new Date(`${issueDate}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 7);
  const untilText = until.toISOString().slice(0, 10).split("-").reverse().join(".");
  // 3 % von 1.190,00 € = 35,70 €
  await expect(page.getByText(`bis ${untilText}: 35,70 € Skonto, zu zahlen 1.154,30 €`)).toBeVisible();
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText(`Bei Zahlung bis zum ${untilText} gewähren wir 3 % Skonto (35,70 €)`);
  // Eine Frist über das Zahlungsziel hinaus lässt sich nicht speichern
  await page.getByLabel("Stufe 1: Frist in Tagen").fill("30");
  await expect(page.getByText("Die Skontofrist von 30 Tagen ist länger als das Zahlungsziel von 14 Tagen.")).toBeVisible();
  await page.getByLabel("Stufe 1: Frist in Tagen").fill("7");

  // Editor mit Skontostufe für axe, am Desktop und am Handy (WCAG 2.2 AA wie barrierefreiheit.spec.ts)
  async function axe(path: string, ready: (p: Page) => Promise<void>) {
    const context = await browser.newContext({ storageState: await page.context().storageState() });
    const axePage = await context.newPage();
    for (const width of [1440, 390]) {
      await axePage.setViewportSize({ width, height: 900 });
      await axePage.goto(new URL(path, page.url()).toString());
      await axePage.waitForLoadState("networkidle");
      await ready(axePage);
      const { violations } = await new AxeBuilder({ page: axePage })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        `${path} bei ${width} px`,
      ).toEqual([]);
    }
    await context.close();
  }

  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const invoicePath = new URL(page.url()).pathname;
  await axe(invoicePath, (p) => expect(p.getByLabel("Stufe 1: Skonto in %")).toHaveValue("3"));
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const number = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/\d{4}-\d{3}/)?.[0] ?? "";
  expect(number).not.toBe("");

  // Zahlung in der Frist mit 3 % Skonto
  const csv =
    "﻿" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n"Kontostand vom ${dkb(day(0))}:";"1.154,30 €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      dkb(day(0)),
      dkb(day(0)),
      "Gebucht",
      "Kontor Lindner KG",
      "Max Mustermann",
      `RE ${number} abzgl. 3 % Skonto`,
      "Eingang",
      "DE75512108001245126199",
      "1.154,30",
      "",
      "",
      "",
    ]
      .map((v) => `"${v}"`)
      .join(";") +
    "\n";
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "skonto.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: /Kontor Lindner KG/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await expect(panel.getByRole("heading", { name: "Kontor Lindner KG" })).toBeVisible();
  await expect(panel.getByText("Betrag stimmt mit 3 % Skonto (35,70 €), in der Frist")).toBeVisible();
  await axe(new URL(page.url()).pathname + new URL(page.url()).search, (p) =>
    expect(p.getByRole("button", { name: "Zuordnen, Rest 35,70 € als Skonto" })).toBeVisible(),
  );
  await panel.getByRole("button", { name: "Zuordnen, Rest 35,70 € als Skonto" }).click();
  // Ohne weiteren offenen Umsatz bleibt der Umsatz offen im Blick, nur ohne die Zuordnung
  await expect(panel.getByRole("button", { name: "Zuordnen, Rest 35,70 € als Skonto" })).toBeHidden();
  await page.waitForLoadState("networkidle");

  // Die Rechnung ist bezahlt, das Skonto ausgebucht
  await go(invoicePath);
  await expect(page.getByText("Bezahlt").first()).toBeVisible();
  await expect(page.getByText("Skonto gewährt").first()).toBeVisible();

  // Vorgabe wieder entfernen, damit die übrigen Tests ohne Skonto rechnen
  await go("/einstellungen");
  await firma.getByRole("button", { name: "Skontostufe 1 entfernen" }).click();
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(firma.getByRole("status")).toContainText("Firmendaten gespeichert.");
});

test("Voranmeldung außerhalb von Haben abgegeben: Abgabe vermerken, Zahllast im Bankabgleich zuordnen", async () => {
  // Ein Monat vor dem Vorjahr ohne Buchungen, damit die übrigen Seiten, Bilder und die Sondervorauszahlung unverändert bleiben
  const year = YEAR - 2;
  const yy = String(year).slice(2);
  await go(`/umsatzsteuer/${year}-06`);
  await page.getByRole("button", { name: "Manuell überschreiben" }).click();
  await page.getByLabel("Steuerpflichtige Umsätze 19 %").fill("1.000,00");
  await page.getByLabel("Begründung der Abweichung (Pflicht)").fill("Rechnung aus der alten Buchhaltung, dort nicht gemeldet");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await expect(page.getByText("Entwurf gespeichert.")).toBeVisible();

  const vermerk = page.getByRole("form", { name: "Außerhalb von Haben abgegeben" });
  // Ein geleertes Datum ist eine unfertige Eingabe, die Seite bleibt stehen (Codex-Review #443)
  await vermerk.getByLabel("Tag der Abgabe").fill("");
  await expect(vermerk.getByRole("button", { name: "Abgabe vermerken" })).toBeDisabled();
  await vermerk.getByLabel("Tag der Abgabe").fill(`${year}-07-09`);
  await vermerk.getByLabel("Transferticket").fill("et7f3k9m2q8w4x1z");
  const protokollFeld = vermerk.locator(".field", { has: page.getByText("Übermittlungsprotokoll (PDF)", { exact: true }) });
  const protokollDialog = await filePickerPruefen(page, protokollFeld, "Übermittlungsprotokoll");
  await protokollDialog.setFiles({
    name: "Uebermittlungsprotokoll.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% Übermittlungsprotokoll Juni\n%%EOF\n"),
  });
  await expect(protokollFeld.locator(".file-picker-name")).toHaveText("Uebermittlungsprotokoll.pdf");
  // Kz 83 laut Protokoll weicht ab: Haben lehnt ab
  await vermerk.getByLabel("Kz 83 laut Protokoll").fill("200,00");
  await vermerk.getByRole("button", { name: "Abgabe vermerken" }).click();
  await bestaetigen(page, "Abgabe vermerken");
  await expect(vermerk.getByRole("alert")).toContainText("weicht von der Voranmeldung");
  await vermerk.getByLabel("Kz 83 laut Protokoll").fill("190,00");
  // Festschreiben ist endgültig; die Rückfrage zeigt, was gleich gilt, und Abbrechen lässt alles offen
  await vermerk.getByRole("button", { name: "Abgabe vermerken" }).click();
  const vermerkRueckfrage = page.getByRole("dialog", { name: "Voranmeldung als abgegeben vermerken?" });
  await faktenZeigen(page, "Tag der Abgabe", "Transferticket", "Kz 83");
  await expect(vermerkRueckfrage).toContainText(`09.07.${year}`);
  await expect(vermerkRueckfrage).toContainText("et7f3k9m2q8w4x1z");
  await expect(vermerkRueckfrage).toContainText("190,00");
  await vermerkRueckfrage.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(page.getByText(`Abgegeben 09.07.${year} (vermerkt)`)).toHaveCount(0);
  await vermerk.getByRole("button", { name: "Abgabe vermerken" }).click();
  await bestaetigen(page, "Abgabe vermerken");
  await expect(page.getByText(`Abgegeben 09.07.${year} (vermerkt)`)).toBeVisible();
  await expect(page.getByRole("region", { name: `Verlauf Juni ${year}` })).toContainText("Abgabe vermerkt");
  const zahlung = page.getByRole("region", { name: "Zahlung an das Finanzamt" });
  await expect(zahlung).toContainText("offen 190,00");
  const protokoll = await page.request.get((await page.getByRole("link", { name: "Protokoll" }).first().getAttribute("href"))!);
  expect(protokoll.headers()["content-type"]).toContain("application/pdf");

  // Lastschrift des Finanzamts: Haben schlägt die Voranmeldung vor, gebucht wird Umsatzsteuer an Bank mit Bezug
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n"Kontostand vom ${dkb(day(0))}:";"16.067,10 €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      `10.07.${yy}`,
      `10.07.${yy}`,
      "Gebucht",
      "Max Mustermann",
      "Finanzamt Regensburg",
      `USt 06/${yy} StNr 198/113/10010`,
      "Ausgang",
      "DE76750000000075001007",
      "-190,00",
      "",
      "",
      "",
    ]
      .map((v) => `"${v}"`)
      .join(";") +
    "\n";
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "finanzamt.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: /Finanzamt Regensburg/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await expect(panel.getByRole("heading", { name: "Finanzamt Regensburg" })).toBeVisible();
  await expect(panel.getByText(`Voranmeldung USt 06/${year}`)).toBeVisible();
  await expect(panel.getByText("Zeitraum im Verwendungszweck")).toBeVisible();
  await panel.getByRole("button", { name: "Zuordnen", exact: true }).click();
  // Ohne weiteren offenen Umsatz bleibt der Umsatz im Blick, nur ohne die Zuordnung
  await expect(panel.getByRole("button", { name: "Zuordnen", exact: true })).toBeHidden();
  await page.waitForLoadState("networkidle");

  await go(`/umsatzsteuer/${year}-06`);
  await expect(page.getByRole("region", { name: "Zahlung an das Finanzamt" })).toContainText("ausgeglichen");
  await expect(page.getByRole("region", { name: "Zahlung an das Finanzamt" })).toContainText("Lastschrift 190,00");
});

test("Anlage übernehmen: degressive AfA mit Höchstsatz, Restbuchwert geprüft, Wechsel zur linearen", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  await form.getByLabel("Bezeichnung").fill("Drehbank degressiv");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Betriebs- und Geschäftsausstattung" });
  await form.getByLabel("Anschaffungsdatum").fill("2024-04-10");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("50.000,00");
  await form.getByRole("combobox", { name: "Abschreibung", exact: true }).selectOption("degressiv");
  await form.getByLabel("Nutzungsdauer in Jahren").fill("10");
  // Wachstumschancengesetz: April bis Dezember 2024 höchstens das Doppelte des linearen Satzes und 20 %
  await expect(form.getByText("Höchstens 20 %; leer lassen für den Höchstsatz.")).toBeVisible();
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("30.000,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await expect(page.getByRole("alert")).toContainText("Restbuchwert passt nicht zur degressiven AfA (rechnerisch 34.000,00 €)");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("34.000,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
  const plan = page.getByRole("region", { name: "Abschreibungsplan" });
  await expect(plan).toContainText("Degressiv mit Wechsel zur linearen (§ 7 Abs. 2 EStG), 10 Jahre, 20 %");
  await expect(plan.locator(".table-row", { hasText: /^2026/ })).toContainText("6.800,00");

  // Wechsel zur linearen AfA ab 2027: 27.200 € über die Restnutzungsdauer von 87 Monaten
  const angaben = page.getByRole("region", { name: "Angaben" });
  await angaben.getByLabel("Linear ab Jahr (optional)").fill("2027");
  await angaben.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert." })).toBeVisible();
  await expect(plan).toContainText("linear ab 2027");
  await expect(plan.locator(".table-row", { hasText: /^2027/ })).toContainText("3.751,72");
  await expect(angaben.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen")).not.toBeChecked();
});

test("Elektrofahrzeug übernehmen: AfA nach § 7 Abs. 2a EStG mit Erinnerungswert", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  await form.getByLabel("Bezeichnung").fill("E-Transporter");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Fahrzeug" });
  await form.getByLabel("Anschaffungsdatum").fill("2025-08-01");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("40.000,00");
  await form.getByRole("combobox", { name: "Abschreibung", exact: true }).selectOption("elektro");
  await expect(form.getByText("Nur für reine Elektrofahrzeuge, angeschafft vom 01.07.2025 bis 31.12.2027")).toBeVisible();
  await form.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen").check();
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  // 75 % im Anschaffungsjahr: Restbuchwert 10.000 €
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("10.000,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const plan = page.getByRole("region", { name: "Abschreibungsplan" });
  await expect(plan).toContainText("Elektrofahrzeug 75/10/5/5/3/2 % (§ 7 Abs. 2a EStG), Erinnerungswert 1 €");
  await expect(plan.locator(".table-row", { hasText: /^2026/ })).toContainText("4.000,00");
  // Letztes Jahr der Staffel: 2 % abzüglich des Erinnerungswerts
  await expect(plan.locator(".table-row", { hasText: /^2030/ })).toContainText("799,00");
});

test("Sonstige Transportmittel übernehmen: Konto 0380, eigene Nutzungsdauer statt der Pkw-Nutzungsdauer, keine Elektro-AfA (#312)", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  await form.getByLabel("Bezeichnung").fill("Kofferanhänger");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Fahrzeug" });
  await expect(form.getByLabel("Nutzungsdauer in Jahren")).toHaveValue("6");
  // Die sechs Jahre für Pkw gehen nicht mit: die Nutzungsdauer kommt vom einzelnen Wirtschaftsgut
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Transportmittel (z. B. Anhänger, Lastenrad, Boot)" });
  await expect(form.getByLabel("Nutzungsdauer in Jahren")).toHaveValue("");
  await expect(form.getByRole("combobox", { name: "Abschreibung", exact: true }).locator("option[value=elektro]")).toHaveCount(0);
  await form.getByLabel("Nutzungsdauer in Jahren").fill("11");
  await form.getByLabel("Anschaffungsdatum").fill("2025-04-10");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("6.600,00");
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  // 2025: 9 von 132 Monaten = 450 €
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("6.150,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Konto 0380/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Abschreibungsplan" }).locator(".table-row", { hasText: /^2026/ })).toContainText("600,00");
});

test("Beleg als Anlagegut: Wechsel von Fahrzeug zu Sonstige Transportmittel lässt die sechs Jahre für Pkw nicht stehen (#312)", async ({ browser }) => {
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "anhaenger.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Anhänger Center") }]);
  await expect(page.getByText("anhaenger.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /anhaenger\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Kategorie").selectOption("anlage");
  await page.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Fahrzeug" });
  await expect(page.getByLabel("Nutzungsdauer in Jahren")).toHaveValue("6");
  await page.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Transportmittel (z. B. Anhänger, Lastenrad, Boot)" });
  await expect(page.getByLabel("Nutzungsdauer in Jahren")).toHaveValue("");
  // Nicht buchen: der Beleg würde die folgenden Auswertungen verändern
  await page.getByRole("button", { name: "Löschen" }).click();
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
});

test("Anlage anlegen: Erinnerungswert angehakt, dann zu Computer gewechselt, wird ohne Erinnerungswert gespeichert", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  await form.getByLabel("Bezeichnung").fill("Notebook mit Haken");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Betriebs- und Geschäftsausstattung" });
  await form.getByLabel("Nutzungsdauer in Jahren").fill("5");
  await form.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen").check();
  // Computer: Nutzungsdauer ein Jahr, ohne Erinnerungswert; das ausgeblendete Häkchen darf nicht mitgehen
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Computer, Hardware und Software" });
  await expect(form.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen")).toHaveCount(0);
  await form.getByLabel("Anschaffungsdatum").fill("2025-03-01");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("1.500,00");
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("0,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("region", { name: "Abschreibungsplan" })).not.toContainText("Erinnerungswert");
});

test("Steuerzahlung im Bankabgleich: Gewerbesteuerbescheid auf Steuer und Verspätungszuschlag aufteilen, in der EÜR nur nachrichtlich", async () => {
  const bezugsjahr = String(YEAR - 2);
  const csv =
    "﻿" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      dkb(day(0)),
      dkb(day(0)),
      "Gebucht",
      "Max Mustermann",
      "Stadtkasse Regensburg",
      `GewSt ${bezugsjahr} Bescheid`,
      "Ausgang",
      "DE91750500000000123456",
      "-543,00",
      "",
      "",
      "",
    ]
      .map((v) => `"${v}"`)
      .join(";") +
    "\n";
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "gewerbesteuer.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: /Stadtkasse Regensburg/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await expect(panel.getByRole("heading", { name: "Stadtkasse Regensburg" })).toBeVisible();

  // Eine Zahlung, zwei Teile: die Steuer für ein Vorjahr und der Verspätungszuschlag, beide zur Gewerbesteuer
  await panel.getByRole("button", { name: "Aufteilen" }).click();
  const form = panel.getByRole("form", { name: "Umsatz aufteilen" });
  const rows = form.locator(".split-row");
  for (const [index, posten, betrag] of [
    [0, "steuer", "-500,00"],
    [1, "verspaetung", "-43,00"],
  ] as const) {
    const row = rows.nth(index);
    // Ziel des Teils: die erste Auswahl der Zeile („Teil 1“, „Teil 2“)
    await row.locator("select").first().selectOption("steuer");
    await row.getByLabel("Steuerart").selectOption("gewst");
    await row.getByLabel("Bezugsjahr").fill(bezugsjahr);
    await row.getByLabel("Teil der Zahlung").selectOption(posten);
    await row.getByLabel("Betrag").fill(betrag);
  }
  await expect(form.getByText("Keine Betriebsausgabe, auch nicht Zinsen und Zuschläge darauf (§ 4 Abs. 5b EStG)").first()).toBeVisible();
  await form.getByRole("button", { name: "Aufteilen und buchen" }).click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText(`Steuer: Gewerbesteuer ${bezugsjahr} · Zahlung`)).toBeVisible();
  await expect(panel.getByText(`Steuer: Gewerbesteuer ${bezugsjahr} · Verspätungszuschlag (§ 152 AO) oder Zwangsgeld (§ 329 AO)`)).toBeVisible();

  // Keine Betriebsausgabe: die EÜR nennt die Gewerbesteuer nur nachrichtlich
  await go("/auswertungen");
  const nachrichtlich = page.getByRole("row", { name: /Nachrichtlich: Gewerbesteuer/ });
  await expect(nachrichtlich).toContainText("543,00");
});

test("Darlehen: anlegen, Auszahlung zuordnen, Rate in Tilgung und Zinsen aufteilen, Bestand sinkt um die Tilgung", async () => {
  await go("/darlehen");
  const neu = page.getByRole("form", { name: "Darlehen anlegen" });
  await neu.getByLabel("Name").fill("Hausbank Investitionskredit");
  await neu.getByRole("button", { name: "Darlehen anlegen" }).click();
  await expect(page.getByRole("row", { name: /Hausbank Investitionskredit/ })).toContainText("0630");

  const csv =
    "﻿" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      [dkb(day(-1)), "Hausbank Regensburg", "Max Mustermann", "Auszahlung Darlehen 4711", "Eingang", "10.000,00"],
      [dkb(day(0)), "Max Mustermann", "Hausbank Regensburg", "Rate Darlehen 4711", "Ausgang", "-1.000,00"],
    ]
      .map(([date, from, to, purpose, type, amount]) =>
        [date, date, "Gebucht", from, to, purpose, type, "DE27750500000000654321", amount, "", "", ""].map((v) => `"${v}"`).join(";"),
      )
      .join("\n") +
    "\n";
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "darlehen.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/2 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  const panel = page.getByRole("complementary", { name: "Zuordnung" });

  // Auszahlung: ohne Rechnung als Darlehen, erfolgsneutral
  await page
    .getByRole("link", { name: /Auszahlung Darlehen 4711/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  // Erst weiter, wenn rechts der gewählte Umsatz steht; sonst gehört das Formular noch zum vorigen
  await expect(panel.getByText("Auszahlung Darlehen 4711")).toBeVisible();
  if (await panel.getByRole("button", { name: "Direkt buchen" }).isVisible()) await panel.getByRole("button", { name: "Direkt buchen" }).click();
  await panel.getByLabel("Buchen als").selectOption("darlehen");
  await expect(panel.getByLabel("Teil der Rate")).toHaveValue("auszahlung");
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");

  // Rate: 800 € Tilgung und 200 € Zinsen
  await page
    .getByRole("link", { name: /Rate Darlehen 4711/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Rate Darlehen 4711")).toBeVisible();
  await panel.getByRole("button", { name: "Aufteilen" }).click();
  const form = panel.getByRole("form", { name: "Umsatz aufteilen" });
  const rows = form.locator(".split-row");
  for (const [index, teil, betrag] of [
    [0, "tilgung", "-800,00"],
    [1, "zins", "-200,00"],
  ] as const) {
    const row = rows.nth(index);
    await row.locator("select").first().selectOption("darlehen");
    await row.getByLabel("Teil der Rate").selectOption(teil);
    await row.getByLabel("Betrag").fill(betrag);
  }
  await form.getByRole("button", { name: "Aufteilen und buchen" }).click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Darlehen: Darlehen Hausbank Investitionskredit · Tilgung")).toBeVisible();
  await expect(panel.getByText("Darlehen: Darlehen Hausbank Investitionskredit · Zinsen")).toBeVisible();

  await go("/darlehen");
  await expect(page.getByRole("row", { name: /Hausbank Investitionskredit/ })).toContainText("9.200,00");
});

test("Beleg: Kategorie und Bezahlung aus früheren Belegen des Lieferanten, mit Begründung, übernehmen auf Klick (#295)", async ({ browser }) => {
  const beleg = async (n: number) => {
    await go("/belege");
    await page
      .locator("input[type=file][multiple]")
      .setInputFiles([{ name: `kiosk-${n}.jpg`, mimeType: "image/jpeg", buffer: await receiptJpeg(browser, `Kiosk am Markt ${n}`) }]);
    await expect(page.getByText(`kiosk-${n}.jpg: abgelegt.`)).toBeVisible();
    await page
      .getByRole("link", { name: new RegExp(`kiosk-${n}\\.jpg`) })
      .first()
      .click();
    await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Lieferant", { exact: true }).fill("Kiosk am Markt");
    await page.getByLabel("Rechnungsnummer").fill(`Q-${n}`);
    await page.getByLabel("Belegdatum").fill(day(-3));
    await page.getByLabel("Netto", { exact: true }).fill("10,00");
  };
  // Zwei Belege als Telefon, privat bezahlt
  for (const n of [1, 2]) {
    await beleg(n);
    await page.getByLabel("Kategorie").selectOption("telefon");
    await page.getByLabel("Privat bezahlt (Privateinlage)").check();
    await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
    await bestaetigen(page, "Buchen");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Der Beleg ist festgeschrieben/)).toBeVisible();
  }
  // Der dritte: Hinweise mit Anzahl und Tag der letzten Buchung, gewählt wird erst mit „übernehmen“
  await beleg(3);
  await page.locator(".doc-actions").getByRole("button", { name: "Speichern" }).click();
  await page.waitForLoadState("networkidle");
  const heute = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
  const kategorie = page.locator(".field").filter({ has: page.getByLabel("Kategorie") });
  await expect(kategorie).toContainText(`Bisher 2× als Telefon gebucht, zuletzt am ${heute}`);
  const bezahlung = page.getByRole("group", { name: "Bezahlung" });
  await expect(bezahlung).toContainText(`Bisher 2× privat bezahlt, zuletzt am ${heute}`);
  await expect(bezahlung.getByLabel("Über das Geschäftskonto (Zuordnung beim Bankabgleich)")).toBeChecked();
  await bezahlung.getByRole("button", { name: "übernehmen" }).click();
  await expect(bezahlung.getByLabel("Privat bezahlt (Privateinlage)")).toBeChecked();
  await expect(bezahlung.getByRole("button", { name: "übernehmen" })).toBeHidden();
  await kategorie.getByRole("button", { name: "übernehmen" }).click();
  await expect(page.getByLabel("Kategorie")).toHaveValue("telefon");
  // Nichts ist gebucht, bis bestätigt wird
  await expect(page.getByText(/Der Beleg ist festgeschrieben/)).toBeHidden();
  await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
  await bestaetigen(page, "Buchen");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Der Beleg ist festgeschrieben/)).toBeVisible();
});

test("Direkt buchen auf eine Kategorie: Zahlung eines Privatkunden mit 19 %, Ausgabe ohne Vorsteuer (#324)", async () => {
  const zeile = (name: string, zweck: string, betrag: string) =>
    [dkb(day(0)), dkb(day(0)), "Gebucht", betrag.startsWith("-") ? "Max Mustermann" : name, betrag.startsWith("-") ? name : "Max Mustermann", zweck]
      .concat([betrag.startsWith("-") ? "Ausgang" : "Eingang", "", betrag, "", "", ""])
      .map((v) => `"${v}"`)
      .join(";");
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `${zeile("Erika Beispiel", "Reparatur Notebook", "119,00")}\n${zeile("Kiosk am Markt", "Prepaid-Aufladung", "-35,70")}\n`;
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "direkt.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/2 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  const panel = page.getByRole("complementary", { name: "Zuordnung" });

  // Eingang: Erlöse mit 19 %, Netto und Steuer werden angezeigt
  await page
    .getByRole("link", { name: /Erika Beispiel/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByRole("heading", { name: "Erika Beispiel" })).toBeVisible();
  if (await panel.getByRole("button", { name: "Direkt buchen" }).isVisible()) await panel.getByRole("button", { name: "Direkt buchen" }).click();
  await panel.getByLabel("Buchen als").selectOption("kategorie");
  await expect(panel.getByRole("combobox", { name: "Kategorie", exact: true })).toHaveValue("erloese");
  await expect(panel.getByRole("combobox", { name: "Steuersatz", exact: true })).toHaveValue("1900");
  await expect(panel.getByText("100,00 € netto, 19,00 € Umsatzsteuer")).toBeVisible();
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");

  // Ausgang: Telefon, brutto ohne Vorsteuer; einen Steuersatz gibt es dort nicht
  await page
    .getByRole("link", { name: /Kiosk am Markt/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByRole("heading", { name: "Kiosk am Markt" })).toBeVisible();
  if (await panel.getByRole("button", { name: "Direkt buchen" }).isVisible()) await panel.getByRole("button", { name: "Direkt buchen" }).click();
  await panel.getByLabel("Buchen als").selectOption("kategorie");
  await panel.getByRole("combobox", { name: "Kategorie", exact: true }).selectOption("telefon");
  await expect(panel.getByRole("combobox", { name: "Steuersatz", exact: true })).toBeHidden();
  await expect(panel.getByText(/ohne Vorsteuer/)).toBeVisible();
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Direkt: Telefon")).toBeVisible();

  // In der Voranmeldung des Monats als Direktbuchung unter Kz 81, verlinkt auf den Bankumsatz mit seiner Zuordnung
  await go(`/umsatzsteuer/${day(0).slice(0, 7)}`);
  await page
    .getByRole("button", { name: /Direktbuchung/ })
    .first()
    .click();
  await page.getByRole("link", { name: "Direkt gebucht · Erika Beispiel" }).click();
  await page.waitForURL(/\/bank\?/);
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Direkt: Erlöse 19 %")).toBeVisible();
});

/** Beleg mit abweichender IBAN aus dem Test unten, für die Prüfung mit axe */
let ibanBeleg = "";

test("Abweichende IBAN der E-Rechnung: Warnung am Beleg, gesperrt unter Überweisungen bis zur Entscheidung (#410)", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Netzwerk Hosting GmbH");
  await page.getByLabel("Kunde", { exact: true }).uncheck();
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByLabel("IBAN").fill("DE75 5121 0800 1245 1261 99");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  // Auftraggeberkonto für Überweisungen: das Girokonto aus dem Bankabgleich weiter oben

  // E-Rechnung mit IBAN DE02 1203 … (BT-84), anders als im Kontakt
  await go("/belege");
  const xml = readFileSync(new URL("../../../packages/einvoice/test-fixtures/incoming/cii-prefixes.xml", import.meta.url));
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: "RE-2026-0815.xml", mimeType: "application/xml", buffer: xml }]);
  await expect(page.getByText("RE-2026-0815.xml: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /Netzwerk Hosting GmbH RE-2026\/0815/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  // Der Abgleich läuft, sobald der Kontakt am Beleg hängt
  await expect(page.getByRole("region", { name: "Bankverbindung prüfen" })).toHaveCount(0);
  await lieferantWaehlen(page, "Netzwerk Hosting GmbH");
  await page.getByLabel("Kategorie").selectOption("software");
  await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
  await bestaetigen(page, "Buchen");
  await expect(page.getByText(/Gebucht .*festgeschrieben/)).toBeVisible();
  ibanBeleg = new URL(page.url()).pathname;
  const pruefen = page.getByRole("region", { name: "Bankverbindung prüfen" });
  await expect(pruefen).toContainText("DE75 5121 0800 1245 1261 99");
  await expect(pruefen).toContainText("DE02 1203 0000 0000 2020 51");

  // Ohne Entscheidung nicht auswählbar, auch nicht über „Alle auswählen“
  await go("/ueberweisungen");
  const zeile = page.locator(".table-row").filter({ hasText: "Netzwerk Hosting GmbH" });
  await expect(zeile.getByRole("checkbox")).toBeDisabled();
  await expect(zeile).toContainText("am Beleg entscheiden");
  // „Alle auswählen“ nimmt nur wählbare Zeilen; ist keine andere offen, ist der Knopf selbst gesperrt
  const alle = page.getByRole("button", { name: "Alle auswählen" });
  if (await alle.isEnabled()) await alle.click();
  await expect(zeile.getByRole("checkbox")).not.toBeChecked();
  await zeile.getByRole("link", { name: /am Beleg entscheiden/ }).click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");

  // Am gebuchten Beleg entscheiden: die IBAN der E-Rechnung nur für diesen Beleg
  await pruefen.getByRole("button", { name: "IBAN der E-Rechnung nur für diesen Beleg" }).click();
  await expect(pruefen).toContainText("Es gilt die IBAN der E-Rechnung, nur für diesen Beleg. Entschieden von");
  await go("/ueberweisungen");
  await expect(zeile.getByRole("checkbox")).toBeEnabled();
  await expect(zeile).toContainText("DE02 1203 0000 0000 2020 51");
  await expect(zeile).toContainText("Am Beleg entschieden: IBAN der E-Rechnung nur für diesen Beleg");
  // Der Kontakt bleibt, wie er war
  await go("/kontakte");
  await page
    .getByRole("link", { name: /Netzwerk Hosting GmbH/ })
    .first()
    .click();
  await expect(page.getByLabel("IBAN")).toHaveValue(/DE75\s?5121/);
});

test("Vorschlag aus früheren Direktbuchungen: Kategorie vorbelegt, mit Begründung, gebucht erst auf Klick (#295)", async () => {
  // „Kiosk am Markt“ ist aus dem Test davor einmal als Telefon gebucht; zwei weitere Aufladungen kommen dazu
  const zeile = (datum: string, zweck: string, betrag: string) =>
    [datum, datum, "Gebucht", "Max Mustermann", "Kiosk am Markt", zweck, "Ausgang", "", betrag, "", "", ""].map((v) => `"${v}"`).join(";");
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `${zeile(dkb(day(0)), "Prepaid-Aufladung Mai", "-15,00")}\n${zeile(dkb(day(1)), "Prepaid-Aufladung Juli", "-20,00")}\n`;
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "kiosk.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/2 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  const panel = page.getByRole("complementary", { name: "Zuordnung" });

  // Erst ein Telefon-Umsatz: noch kein Vorschlag (nur eine frühere Zuordnung), also von Hand
  await page
    .getByRole("link", { name: /Prepaid-Aufladung Mai/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Prepaid-Aufladung Mai")).toBeVisible();
  await expect(panel.getByText("Vorschlag ohne Rechnung")).toBeHidden();
  if (await panel.getByRole("button", { name: "Direkt buchen" }).isVisible()) await panel.getByRole("button", { name: "Direkt buchen" }).click();
  await panel.getByLabel("Buchen als").selectOption("kategorie");
  await panel.getByRole("combobox", { name: "Kategorie", exact: true }).selectOption("telefon");
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");

  // Danach: zweimal so gebucht, die Liste zeigt „Vorschlag“, rechts Begründung und vorbelegte Felder
  await expect(page.getByRole("link", { name: /Prepaid-Aufladung Juli/ }).first()).toContainText("Vorschlag");
  await page
    .getByRole("link", { name: /Prepaid-Aufladung Juli/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Prepaid-Aufladung Juli")).toBeVisible();
  await expect(panel.getByText("Vorschlag ohne Rechnung")).toBeVisible();
  await expect(panel.getByText("Ausgabe: Telefon")).toBeVisible();
  await expect(panel.getByText(`2 von 2 Umsätzen von dieser Gegenpartei so gebucht, zuletzt am ${day(0).split("-").reverse().join(".")}`)).toBeVisible();
  await expect(panel.getByLabel("Buchen als")).toHaveValue("kategorie");
  await expect(panel.getByRole("combobox", { name: "Kategorie", exact: true })).toHaveValue("telefon");
  // Nichts ist gebucht, bis bestätigt wird
  await expect(panel.getByText("Direkt: Telefon")).toBeHidden();
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");
  // Danach springt die Auswahl zum nächsten offenen Umsatz; unter „Alle“ steht der gebuchte mit seiner Zuordnung
  await go("/bank?filter=alle");
  await page
    .getByRole("link", { name: /Prepaid-Aufladung Juli/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Prepaid-Aufladung Juli")).toBeVisible();
  await expect(panel.getByText("Direkt: Telefon")).toBeVisible();
});

test("Gelernte Erlöse als Kleinunternehmer, § 19 inzwischen aufgegeben: das Formular zeigt, was gebucht wird (#295)", async () => {
  // Drei Zahlungen eines Privatkunden im Vormonat, als noch die Kleinunternehmerregelung galt
  const datum = day(-40);
  const zeile = (zweck: string, betrag: string) =>
    [dkb(datum), dkb(datum), "Gebucht", "Paula Privat", "Max Mustermann", zweck, "Eingang", "DE02100100100006820199", betrag, "", "", ""]
      .map((v) => `"${v}"`)
      .join(";");
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `${zeile("Fenster putzen 1", "100,00")}\n${zeile("Fenster putzen 2", "200,00")}\n${zeile("Fenster putzen 3", "300,00")}\n`;
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "paula.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/3 neue Umsätze/)).toBeVisible({ timeout: 30_000 });

  // Stand im Änderungsprotokoll: im Vormonat Kleinunternehmer, heute nicht mehr (Ausschalten geht jederzeit).
  // Zwei Zahlungen von damals als Erlöse ohne Steuer zugeordnet.
  const sql = postgres(databaseUrlFuer("belege-steuern"), { max: 1 });
  try {
    await sql`insert into audit_log (at, actor, table_name, row_id, action, new_value)
      values (${`${datum}T12:00:00Z`}::timestamptz, 'e2e', 'company', '1', 'UPDATE', ${sql.json({ kleinunternehmer: true })}),
             (now(), 'e2e', 'company', '1', 'UPDATE', ${sql.json({ kleinunternehmer: false })})`;
    for (const zweck of ["Fenster putzen 1", "Fenster putzen 2"]) {
      await sql`insert into allocations (transaction_id, kind, amount, category, tax_rate)
        select id, 'kategorie', amount, 'erloese', 0 from bank_transactions where purpose = ${zweck}`;
    }
  } finally {
    await sql.end();
  }

  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await go("/bank");
  await page
    .getByRole("link", { name: /Fenster putzen 3/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Fenster putzen 3")).toBeVisible();
  // Vorgeschlagen und vorbelegt sind Erlöse ohne Steuer; das Formular darf nicht „19 %“ zeigen
  await expect(panel.getByText("Einnahme: Erlöse (Kleinunternehmer)")).toBeVisible();
  await expect(panel.getByLabel("Buchen als")).toHaveValue("kategorie");
  await expect(panel.getByRole("combobox", { name: "Steuersatz", exact: true })).not.toHaveValue("1900");
  await expect(panel.getByText("Als Kleinunternehmer ohne Umsatzsteuer (§ 19 UStG).")).toBeVisible();
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");
  // Gebucht wie angezeigt: ohne Steuer, wie am Tag der Zahlung
  await go("/bank?filter=alle");
  await page
    .getByRole("link", { name: /Fenster putzen 3/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Fenster putzen 3")).toBeVisible();
  await expect(panel.getByText("Direkt: Erlöse (Kleinunternehmer)")).toBeVisible();
});

test("Neuer Lieferant aus der E-Rechnung: Anschrift vorbelegt, IBAN nur als Vorschlag zum Übernehmen (#329)", async () => {
  await go("/belege");
  // Eigene Rechnungsnummer, damit die Datei keine Dublette eines anderen Tests ist
  const xml = readFileSync(new URL("../../../packages/einvoice/test-fixtures/incoming/cii-prefixes.xml", import.meta.url), "utf8").replaceAll(
    "RE-2026/0815",
    "RE-2026/0816",
  );
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: "RE-2026-0816.xml", mimeType: "application/xml", buffer: Buffer.from(xml) }]);
  await expect(page.getByText("RE-2026-0816.xml: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /Netzwerk Hosting GmbH RE-2026\/0816/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await neuenLieferantenOeffnen(page);
  const dialog = page.getByRole("dialog", { name: "Neuen Lieferanten anlegen" });
  await expect(dialog.getByLabel("Name oder Firma")).toHaveValue("Netzwerk Hosting GmbH");
  await expect(dialog.getByLabel("Straße und Hausnummer")).not.toHaveValue("");
  await expect(dialog.getByLabel("PLZ")).not.toHaveValue("");
  await expect(dialog.getByLabel("Ort")).not.toHaveValue("");
  // Die IBAN steht nicht von selbst im Feld, nur als Vorschlag mit Herkunft und Prüfziffer
  const iban = dialog.getByLabel("IBAN");
  await expect(iban).toHaveValue("");
  await expect(dialog.getByText(/Vorschlag vom Beleg: DE02 1203 0000 0000 2020 51, aus der E-Rechnung \(BT-84\)\. Prüfziffer stimmt\./)).toBeVisible();
  await dialog.getByRole("button", { name: "IBAN übernehmen" }).click();
  await expect(iban).toHaveValue("DE02120300000000202051");
  await expect(iban).toBeFocused();
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Aus den Kontakten" })).toHaveValue(/\S/);
});

test("IBAN aus der E-Rechnung ohne Kontakt-IBAN: gesperrt bis zur Bestätigung, auf Wunsch auch in den Kontakt (#410)", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Hosting Süd GmbH");
  await page.getByLabel("Kunde", { exact: true }).uncheck();
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  const kontaktUrl = page.url();

  await go("/belege");
  const xml = readFileSync(new URL("../../../packages/einvoice/test-fixtures/incoming/cii-prefixes.xml", import.meta.url), "utf8").replaceAll(
    "RE-2026/0815",
    "RE-2026/0817",
  );
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: "RE-2026-0817.xml", mimeType: "application/xml", buffer: Buffer.from(xml) }]);
  await expect(page.getByText("RE-2026-0817.xml: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /RE-2026\/0817/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await lieferantWaehlen(page, "Hosting Süd GmbH");
  await page.getByLabel("Kategorie").selectOption("software");
  // Auf dem Beleg bleiben: Ein anderer Test lässt einen Beleg offen, zu dem Haben sonst weiterspringt
  await page.getByLabel("Nach dem Buchen zum nächsten offenen Beleg").uncheck();
  await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
  await bestaetigen(page, "Buchen");
  await expect(page.getByText(/Gebucht .*festgeschrieben/)).toBeVisible();
  const belegUrl = page.url();
  const offen = page.getByRole("region", { name: "IBAN aus der E-Rechnung, noch nicht bestätigt" });
  await expect(offen).toContainText("DE02 1203 0000 0000 2020 51");

  // Bis zur Bestätigung gesperrt, auch für „Alle auswählen“
  await go("/ueberweisungen");
  const zeile = page.locator(".table-row").filter({ hasText: "RE-2026/0817" });
  await expect(zeile.getByRole("checkbox")).toBeDisabled();
  await expect(zeile).toContainText("noch nicht bestätigt");
  const alle = page.getByRole("button", { name: "Alle auswählen" });
  if (await alle.isEnabled()) await alle.click();
  await expect(zeile.getByRole("checkbox")).not.toBeChecked();

  // Übernehmen und zusätzlich in den Kontakt: danach gilt die IBAN des Kontakts, der Hinweis entfällt
  await go(new URL(belegUrl).pathname);
  await offen.getByLabel("Auch im Kontakt des Lieferanten eintragen").check();
  await offen.getByRole("button", { name: "Übernehmen" }).click();
  await expect(offen).toHaveCount(0);
  await go("/ueberweisungen");
  await expect(zeile.getByRole("checkbox")).toBeEnabled();
  await expect(zeile).toContainText("DE02 1203 0000 0000 2020 51");
  await go(new URL(kontaktUrl).pathname);
  await expect(page.getByLabel("IBAN")).toHaveValue(/DE02\s?1203/);
});

test("Jahreserklärung: Abgabe außerhalb von Haben vermerken, mit Protokoll und ohne zweiten Vermerk", async () => {
  const jahr = YEAR - 1;
  await go(`/jahreserklaerung/${jahr}`);
  const ust = page.getByRole("region", { name: "Umsatzsteuererklärung", exact: true });
  // Die Karte traegt Formular und Jahr im Namen, weil sie auf der Seite zweimal vorkommt (USt und EÜR)
  const karte = ust.getByRole("region", { name: `Abgabe außerhalb von Haben: Umsatzsteuererklärung ${jahr}`, exact: true });
  await karte.getByRole("button", { name: "Abgabe vermerken", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: `Umsatzsteuererklärung ${jahr} als abgegeben vermerken` });
  await randImDialog(dialog, [dialog.getByLabel("Transferticket", { exact: true }), dialog.getByRole("button", { name: "Vermerken", exact: true })]);
  // Der Abgabetag liegt im Folgejahr: eine Jahreserklärung kann nicht vor dem Jahresende abgegeben werden
  await dialog.getByLabel("Tag der Abgabe", { exact: true }).fill(`${jahr + 1}-01-02`);
  await dialog.getByLabel("Transferticket", { exact: true }).fill("et9f3k2m7q1x");
  await dialog.getByLabel("Betrag", { exact: true }).fill("0,00");
  await dialog.getByLabel("Begründung", { exact: true }).fill("Umsatzsteuererklärung extern mit WISO abgegeben.");
  const protokollFeld = dialog.locator(".field", { has: page.getByText("Übermittlungsprotokoll (PDF, optional)", { exact: true }) });
  const protokollDialog = await filePickerPruefen(page, protokollFeld, "Übermittlungsprotokoll");
  await protokollDialog.setFiles({
    name: "Uebermittlungsprotokoll.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% Übermittlungsprotokoll\n%%EOF\n"),
  });
  // Weicht der Betrag vom gerechneten Wert ab, verlangt der Dialog eine ausdrueckliche Bestaetigung
  const haken = dialog.getByLabel("Abweichung geprüft und bewusst übernommen");
  if (await haken.count()) await haken.check();
  await dialog.getByRole("button", { name: "Vermerken", exact: true }).click();

  // Danach gilt die Erklärung als abgegeben; Tag und Begründung stehen in der Karte, ein zweiter Vermerk fehlt
  await expect(ust.getByText(`Außerhalb abgegeben 02.01.${jahr + 1}`)).toBeVisible();
  await expect(karte).toContainText("Ein zweiter Vermerk ist nicht möglich.");
  await expect(karte).toContainText("Umsatzsteuererklärung extern mit WISO abgegeben.");
  await expect(karte.getByRole("button", { name: "Abgabe vermerken" })).toHaveCount(0);
  const protokoll = await page.request.get((await karte.getByRole("link", { name: "Übermittlungsprotokoll" }).getAttribute("href"))!);
  expect(protokoll.headers()["content-type"]).toContain("application/pdf");

  // Auch nach dem Neuladen bleibt der Vermerk stehen
  await go(`/jahreserklaerung/${jahr}`);
  await expect(page.getByRole("region", { name: "Umsatzsteuererklärung", exact: true }).getByText(`Außerhalb abgegeben 02.01.${jahr + 1}`)).toBeVisible();
});

test("Vorgabe „Ohne Vorsteuerabzug“: der Beleg folgt ihr und weicht gespeichert ab (#852)", async ({ browser }) => {
  // Vorgabe in den Firmendaten setzen
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("Ohne Vorsteuerabzug (steuerfreie Umsätze nach § 4 UStG)", { exact: true }).check();
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(firma.getByRole("status")).toContainText("Firmendaten gespeichert.");

  // Ein neuer Beleg zeigt das Kästchen angehakt
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "apotheke.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Linden-Apotheke") }]);
  await expect(page.getByText("apotheke.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /apotheke\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const ohne = page.getByLabel("Ohne Vorsteuerabzug", { exact: true });
  await expect(ohne).toBeChecked();
  await expect(page.getByText(/Vorgabe in den Firmendaten: ohne Vorsteuerabzug/)).toBeVisible();

  // Am Beleg abweichend abgewählt: bleibt nach dem Speichern und Neuladen ab
  await ohne.uncheck();
  const gespeichert = page.waitForResponse((r) => r.url().includes("/_serverFn/") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  expect((await gespeichert).ok()).toBe(true);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(ohne).not.toBeChecked();

  // Aufräumen: Beleg löschen und Vorgabe zurücknehmen, damit spätere Tests regulär rechnen
  await page.getByRole("button", { name: "Löschen" }).click();
  await bestaetigen(page, "Beleg löschen");
  // Danach steht Haben auf dem nächsten offenen Beleg oder in der Liste
  await page.waitForURL(/\/belege(\/[0-9a-f-]{36})?$/);
  await go("/einstellungen");
  await firma.getByLabel("Ohne Vorsteuerabzug (steuerfreie Umsätze nach § 4 UStG)", { exact: true }).uncheck();
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(firma.getByRole("status")).toContainText("Firmendaten gespeichert.");
});

test("Seiten mit den Daten dieses Durchlaufs ohne axe-Verstöße", async () => {
  await ohneAxeVerstoesse(page, [
    "/belege",
    "/pauschalen",
    "/anlagen",
    "/darlehen",
    "/bank",
    "/auswertungen",
    "/umsatzsteuer",
    `/umsatzsteuer/zm/${YEAR + 1}-Q1`,
    "/finanzamt",
    "/fristen",
    "/einstellungen?bereich=elster",
    "/ueberweisungen",
    ibanBeleg,
  ]);
  // Mit hinterlegtem Zertifikat; barrierefreiheit.spec.ts sieht die Seite ohne
  await kontrasteInThemes(page, ["/einstellungen?bereich=elster"]);
});

test("Keine Fehler im Browser", async () => {
  expect(pageErrors).toEqual([]);
});
