import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { day, USER } from "./daten.ts";
import { databaseUrlFuer } from "./durchlaeufe.ts";
import { bestaetigen, dkb, durchlaufSeite, faktenZeigen, gehe, kontaktAnlegen, rechnungFestschreiben, SETUP_CODE } from "./einrichtung.ts";

/**
 * Rückfragen vor Aktionen, die früher mit einem Klick auslösten (#404), in eigener, leerer Datenbank (Projekt
 * „rueckfragen“, e2e/durchlaeufe.ts). Eine GmbH, weil es die Steuerrückstellungen nur dort gibt. Jeder Test bricht
 * einmal ab, sieht, dass nichts passiert ist, und bestätigt dann.
 */

test.describe.configure({ mode: "serial" });

const VORJAHR = new Date().getFullYear() - 1;
const KUNDE = { name: "Hanse Logistik GmbH", street: "Kajen 4", zip: "20459", city: "Hamburg" };
const KUNDE_AUSWAHL = "Hanse Logistik GmbH · Hamburg";

let page: Page;
let pageErrors: string[] = [];
const sql = postgres(databaseUrlFuer("rueckfragen"), { max: 1, onnotice: () => {} });

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
});

test.afterAll(async () => {
  await sql.end();
  expect(pageErrors).toEqual([]);
  await page.context().close();
});

const go = (path: string) => gehe(page, path);
const rueckfrage = (titel: string) => page.getByRole("dialog", { name: titel, exact: true });

async function abbrechen(titel: string) {
  await rueckfrage(titel).getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(rueckfrage(titel)).toHaveCount(0);
}

/** Kontoauszug im DKB-Format mit den Zeilen [Gegenpartei, Zweck, Betrag] */
function auszug(zeilen: [string, string, string][]): string {
  const kopf =
    `"Girokonto";"DE89 3704 0044 0532 0130 00"\n""\n"Kontostand vom ${dkb(day(0))}:";"20.000,00 €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const tag = dkb(day(-2));
  return `﻿${kopf}${zeilen
    .map(([partei, zweck, betrag]) =>
      [
        tag,
        tag,
        "Gebucht",
        ...(betrag.startsWith("-") ? ["Nordlicht Software GmbH", partei] : [partei, "Nordlicht Software GmbH"]),
        zweck,
        betrag.startsWith("-") ? "Ausgang" : "Eingang",
        "DE02120300000000202051",
        betrag,
        "",
        "",
        "",
      ]
        .map((v) => `"${v}"`)
        .join(";"),
    )
    .join("\n")}\n`;
}

test("Einrichtung als GmbH, eine Rechnung im Vorjahr und zwei im laufenden", async () => {
  await go("/");
  await page.getByLabel("Einrichtungscode").fill(SETUP_CODE);
  await page.getByLabel("Name").fill(USER.name);
  await page.getByLabel("E-Mail").fill(USER.email);
  await page.getByLabel(/Passwort/).fill(USER.password);
  await page.getByRole("button", { name: "Konto anlegen" }).click();
  await page.getByRole("button", { name: "Später" }).click();
  await page.waitForURL("**/einstellungen");
  await page.waitForLoadState("networkidle");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("Name", { exact: true }).fill("Nordlicht Software GmbH");
  await firma.getByLabel("E-Mail", { exact: true }).fill("rechnung@nordlicht.example");
  await firma.getByLabel("Straße und Hausnummer").fill("Hafenallee 3");
  await firma.getByLabel("PLZ").fill("28217");
  await firma.getByLabel("Ort").fill("Bremen");
  await firma.getByLabel("Bundesland").selectOption("HB");
  await firma.getByLabel(/^Steuernummer/).fill("60/145/12345");
  await firma.getByLabel("IBAN").fill("DE89370400440532013000");
  await firma.getByLabel("Rechtsform").selectOption("gmbh");
  await firma.getByLabel(/^Kontenrahmen/).selectOption("SKR04");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();

  await kontaktAnlegen(page, KUNDE);
  await rechnungFestschreiben(page, { customer: KUNDE_AUSWAHL, date: `${VORJAHR}-06-15`, lines: [["Projekt", "1", "100.000,00"]], gross: "119.000,00" });
  await rechnungFestschreiben(page, { customer: KUNDE_AUSWAHL, date: day(-20), lines: [["Wartung", "1", "1.000,00"]], gross: "1.190,00" });
  await rechnungFestschreiben(page, { customer: KUNDE_AUSWAHL, date: day(-18), lines: [["Ausfall", "1", "500,00"]], gross: "595,00" });
});

test("Rückstellungen buchen fragt mit Stichtag und Beträgen nach", async () => {
  await go(`/abschluss/${VORJAHR}`);
  const steuern = page.getByRole("form", { name: "Angaben zur Körperschaft- und Gewerbesteuer" });
  await steuern.getByLabel("Hebesatz der Gemeinde (%)").fill("400");
  await steuern.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(page.getByText("Angaben gespeichert.")).toBeVisible();

  const knopf = page.getByRole("button", { name: `Rückstellungen zum 31.12.${VORJAHR} buchen` });
  await knopf.click();
  const titel = `Steuerrückstellungen ${VORJAHR} buchen?`;
  await faktenZeigen(page, "Stichtag", "Körperschaftsteuer und Soli", "Gewerbesteuer");
  await expect(rueckfrage(titel)).toContainText(`31.12.${VORJAHR}`);
  await expect(rueckfrage(titel)).toContainText("Gegenbuchung");
  await abbrechen(titel);
  await expect(knopf).toBeVisible();

  await knopf.click();
  await bestaetigen(page, "Rückstellungen buchen");
  await expect(page.getByText(`Steuerrückstellungen zum 31.12.${VORJAHR} gebucht.`)).toBeVisible();
  await expect(knopf).toHaveCount(0);
});

test("Bankabgleich: Zuordnung und Aufteilung aufheben fragen nach", async () => {
  await go("/bank");
  await page.locator('input[type=file][aria-label="Kontoauszugsdateien"]').setInputFiles([
    {
      name: "rueckfragen.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        auszug([
          ["Hanse Logistik GmbH", "Wartung", "1.190,00"],
          ["Stadtkasse Bremen", "Gewerbesteuer", "-543,00"],
        ]),
      ),
    },
  ]);
  await expect(page.getByText(/2 neue Umsätze/)).toBeVisible({ timeout: 30_000 });

  await go("/bank");
  await page
    .getByRole("link", { name: /Hanse Logistik GmbH/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  // Nach dem Zuordnen springt der Abgleich zum nächsten offenen Umsatz, also zurück zu diesem
  const ersterUmsatz = page.url();
  await panel
    .getByRole("button", { name: /^Zuordnen/ })
    .first()
    .click();
  await expect(panel.getByRole("heading", { name: "Stadtkasse Bremen" })).toBeVisible();
  await go(ersterUmsatz);
  const aufheben = panel.getByRole("button", { name: "Aufheben", exact: true });
  await expect(aufheben).toBeVisible();
  await aufheben.click();
  await faktenZeigen(page, "Zuordnung", "Betrag");
  await expect(rueckfrage("Zuordnung aufheben?")).toContainText("Rechnung");
  await expect(rueckfrage("Zuordnung aufheben?")).toContainText("1.190,00");
  await expect(rueckfrage("Zuordnung aufheben?")).toContainText("Gegenbuchung");
  await expect(rueckfrage("Zuordnung aufheben?")).toContainText("Skonto");
  await abbrechen("Zuordnung aufheben?");
  await expect(panel.getByText("aufgehoben")).toHaveCount(0);
  await aufheben.click();
  await bestaetigen(page, "Zuordnung aufheben");
  await expect(panel.getByText("aufgehoben", { exact: true })).toBeVisible();

  await go("/bank");
  await page
    .getByRole("link", { name: /Stadtkasse Bremen/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await panel.getByRole("button", { name: "Aufteilen" }).click();
  const form = panel.getByRole("form", { name: "Umsatz aufteilen" });
  const rows = form.locator(".split-row");
  for (const [index, posten, betrag] of [
    [0, "steuer", "-500,00"],
    [1, "verspaetung", "-43,00"],
  ] as const) {
    const row = rows.nth(index);
    await row.locator("select").first().selectOption("steuer");
    await row.getByLabel("Steuerart").selectOption("gewst");
    await row.getByLabel("Bezugsjahr").fill(String(VORJAHR));
    await row.getByLabel("Teil der Zahlung").selectOption(posten);
    await row.getByLabel("Betrag").fill(betrag);
  }
  await form.getByRole("button", { name: "Aufteilen und buchen" }).click();
  const aufteilung = panel.getByRole("button", { name: "Aufteilung aufheben" });
  await expect(aufteilung).toBeVisible();
  await aufteilung.click();
  await faktenZeigen(page, "Zuordnung", "Betrag");
  // Die Summe aller Teile, nicht nur der erste
  await expect(rueckfrage("Aufteilung aufheben?")).toContainText("543,00");
  await expect(rueckfrage("Aufteilung aufheben?")).toContainText("alle Teile");
  await expect(rueckfrage("Aufteilung aufheben?")).not.toContainText("Skonto");
  await abbrechen("Aufteilung aufheben?");
  await expect(panel.getByText("aufgehoben")).toHaveCount(0);
  await aufteilung.click();
  await bestaetigen(page, "Aufteilung aufheben");
  await expect(panel.getByText("aufgehoben · Teil einer Aufteilung").first()).toBeVisible();
});

test("Bankabgleich: gegenläufige Umsätze verrechnen ohne Buchung, Aufheben fragt nach (#457)", async () => {
  await go("/bank");
  await page.locator('input[type=file][aria-label="Kontoauszugsdateien"]').setInputFiles([
    {
      name: "kartenpruefung.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        auszug([
          ["PAYPAL *EBAY DE", "Kartenpruefung", "-1,00"],
          ["PAYPAL *EBAY DE", "Rueckbuchung Kartenpruefung", "1,00"],
        ]),
      ),
    },
  ]);
  await expect(page.getByText(/2 neue Umsätze/)).toBeVisible({ timeout: 30_000 });

  await go("/bank");
  await page.getByRole("link", { name: /Rueckbuchung Kartenpruefung/ }).click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await panel.getByRole("button", { name: "Mit Gegenumsatz verrechnen" }).click();
  const form = panel.getByRole("form", { name: "Mit Gegenumsatz verrechnen" });
  await expect(form.getByLabel("Gegenumsatz")).toContainText("−1,00 €");
  // Ohne Notiz bleibt der Knopf gesperrt
  await expect(form.getByRole("button", { name: "Verrechnen" })).toBeDisabled();
  await form.getByLabel("Notiz").fill("PayPal-Autorisierung mit automatischer Rückbuchung");
  await form.getByRole("button", { name: "Verrechnen" }).click();
  await expect(panel.getByText("ohne Buchung · PayPal-Autorisierung mit automatischer Rückbuchung")).toBeVisible();
  // Beide Umsätze erledigt, keine Buchung
  await expect(page.getByRole("link", { name: /Kartenpruefung/ })).toHaveCount(0);
  await go("/bank?filter=zugeordnet");
  await expect(page.getByRole("link", { name: /Kartenpruefung/ }).filter({ hasText: "Verrechnet" })).toHaveCount(2);
  expect(await sql`select count(*)::int as n from journal_entries e where e.description like '%PAYPAL%'`).toEqual([{ n: 0 }]);

  await page.getByRole("link", { name: /Rueckbuchung Kartenpruefung/ }).click();
  await page.waitForLoadState("networkidle");
  const aufheben = panel.getByRole("button", { name: "Aufheben", exact: true });
  await aufheben.click();
  await faktenZeigen(page, "Gegenumsatz", "Notiz");
  await expect(rueckfrage("Verrechnung aufheben?")).toContainText("−1,00 €");
  await expect(rueckfrage("Verrechnung aufheben?")).toContainText("gebucht wird nichts");
  await abbrechen("Verrechnung aufheben?");
  await expect(panel.getByText(/^aufgehoben · /)).toHaveCount(0);
  await aufheben.click();
  await bestaetigen(page, "Verrechnung aufheben");
  await expect(panel.getByText("aufgehoben · PayPal-Autorisierung mit automatischer Rückbuchung")).toBeVisible();
  await go("/bank?filter=offen");
  await expect(page.getByRole("link", { name: /Kartenpruefung/ })).toHaveCount(2);
});

test("Ausbuchung aufheben fragt mit Art und Betrag nach", async () => {
  await go("/rechnungen");
  await page
    .getByRole("link", { name: /595,00/ })
    .first()
    .click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Ausbuchen" });
  await karte.getByRole("button", { name: "Ausbuchen" }).click();
  const aufheben = karte.getByRole("button", { name: "Aufheben", exact: true });
  await expect(aufheben).toBeVisible();

  await aufheben.click();
  await faktenZeigen(page, "Art", "Betrag");
  await expect(rueckfrage("Ausbuchung aufheben?")).toContainText("595,00");
  await expect(rueckfrage("Ausbuchung aufheben?")).toContainText("Gegenbuchung");
  await abbrechen("Ausbuchung aufheben?");
  await expect(karte.getByText("aufgehoben")).toHaveCount(0);

  await aufheben.click();
  await bestaetigen(page, "Ausbuchung aufheben");
  await expect(karte.getByText("aufgehoben")).toBeVisible();
});

test("ELSTER-Zertifikat entfernen fragt nach", async () => {
  await go("/einstellungen?bereich=elster");
  const zertifikat = page.getByRole("form", { name: "ELSTER-Zertifikat" });
  await zertifikat
    .getByLabel("Zertifikatsdatei")
    .setInputFiles({ name: "test.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("kein echtes Zertifikat") });
  await zertifikat.getByRole("button", { name: "Hochladen" }).click();
  const entfernen = zertifikat.getByRole("button", { name: "Entfernen" });
  await expect(entfernen).toBeVisible();

  await entfernen.click();
  await expect(rueckfrage("Zertifikat test.pfx entfernen?")).toContainText(".pfx-Datei");
  await abbrechen("Zertifikat test.pfx entfernen?");
  await expect(entfernen).toBeVisible();

  await entfernen.click();
  await bestaetigen(page, "Zertifikat entfernen");
  await expect(page.getByText("Zertifikat entfernt.")).toBeVisible();
  await expect(entfernen).toHaveCount(0);
});

test("MCP-Token widerrufen fragt nach", async () => {
  await go("/einstellungen?bereich=ki");
  await page.getByRole("checkbox", { name: "Zugang für KI-Assistenten und API einschalten" }).click();
  const tokens = page.getByRole("region", { name: "API-Tokens" });
  await tokens.getByLabel("Name", { exact: true }).fill("Claude am Laptop");
  await tokens.getByRole("button", { name: "Token anlegen" }).click();
  const widerrufen = tokens.getByRole("button", { name: "Widerrufen" });
  await expect(widerrufen).toBeVisible();

  await widerrufen.click();
  await expect(rueckfrage("Token „Claude am Laptop“ widerrufen?")).toContainText("neues Token");
  await abbrechen("Token „Claude am Laptop“ widerrufen?");
  await expect(tokens.getByText("aktiv", { exact: true })).toBeVisible();

  await widerrufen.click();
  await bestaetigen(page, "Widerrufen");
  await expect(tokens.getByText("widerrufen", { exact: true })).toBeVisible();
  await expect(widerrufen).toHaveCount(0);
});

test("Passkey entfernen fragt nach", async () => {
  const [konto] = await sql<{ id: string }[]>`select id from "user" limit 1`;
  await sql`insert into passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at)
    values ('e2e-passkey', 'Laptop', 'kein-schluessel', ${konto!.id}, 'e2e-credential', 0, 'singleDevice', false, now())`;
  await go("/einstellungen?bereich=sicherheit");
  const karte = page.getByRole("region", { name: "Passkeys" });
  const entfernen = karte.getByRole("button", { name: "Entfernen" });
  await expect(entfernen).toBeVisible();

  await entfernen.click();
  await expect(rueckfrage("Passkey „Laptop“ entfernen?")).toContainText("Passwort");
  await abbrechen("Passkey „Laptop“ entfernen?");
  await expect(karte.getByText("Laptop")).toBeVisible();

  await entfernen.click();
  await bestaetigen(page, "Entfernen");
  await expect(page.getByText("Passkey entfernt.")).toBeVisible();
  await expect(karte.getByText("Laptop")).toHaveCount(0);
});

test("Stichjahr vorziehen fragt nach; danach rechnet das laufende Jahr aus dem Journal", async () => {
  const jahr = new Date().getFullYear();
  // Wie eine bestehende Instanz nach Migration 0192: Stichjahr im nächsten Jahr
  await sql`update company set journal_ab = ${jahr + 1}`;
  await go("/einstellungen?bereich=firma");
  const karte = page.getByRole("region", { name: "Voranmeldung und EÜR aus dem Journal" });
  await expect(karte).toContainText(`Stichjahr ${jahr + 1}`);
  await expect(karte).toContainText(`${jahr} rechnet noch aus den Nebenbüchern`);
  const vorziehen = karte.getByRole("button", { name: `Ab ${jahr} aus dem Journal` });

  await vorziehen.click();
  await faktenZeigen(page, "Bisher", "Neu");
  await abbrechen(`Stichjahr auf ${jahr} vorziehen?`);
  expect(await sql`select journal_ab from company`).toEqual([{ journal_ab: jahr + 1 }]);

  await vorziehen.click();
  await bestaetigen(page, "Vorziehen");
  await expect(page.getByText(`Voranmeldung und EÜR rechnen jetzt ab ${jahr} aus dem Journal.`)).toBeVisible();
  await expect(karte).toContainText(`Stichjahr ${jahr} · aus dem Journal`);
  await expect(vorziehen).toHaveCount(0);
  expect(await sql`select journal_ab from company`).toEqual([{ journal_ab: jahr }]);
});

test("Umzug: laufenden Abruf abbrechen und Verbindung entfernen fragen nach", async () => {
  await sql`insert into lexoffice_connection (ciphertext, organization_name) values (${Buffer.from([0])}, 'Testfirma')`;
  const [lauf] = await sql<{ id: string }[]>`insert into lexoffice_imports (source, status, progress)
    values ('lexoffice', 'laeuft', '{"phase":"belege","contacts":0,"contactsLinked":0,"listed":10,"imported":3,"skipped":0,"files":0,"failed":[]}'::jsonb)
    returning id`;
  await go("/archiv");

  const abbruch = page.getByRole("button", { name: "Abbrechen", exact: true });
  await abbruch.click();
  await expect(rueckfrage("Abruf abbrechen?")).toContainText("neu starten");
  await expect(rueckfrage("Abruf abbrechen?")).toContainText("übersprungen");
  let abgebrochen = false;
  page.on("request", (anfrage) => {
    if (anfrage.method() === "POST" && anfrage.url().includes("_serverFn") && anfrage.postData()?.includes(lauf!.id)) abgebrochen = true;
  });
  await abbrechen("Abruf abbrechen?");
  expect(abgebrochen).toBe(false);

  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  const anfrage = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("_serverFn") && (r.postData() ?? "").includes(lauf!.id));
  await bestaetigen(page, "Abruf abbrechen");
  await anfrage;
  await sql`update lexoffice_imports set status = 'abgebrochen', finished_at = now() where id = ${lauf!.id}`;

  await go("/archiv");
  const entfernen = page.getByRole("button", { name: "Schlüssel entfernen" });
  await entfernen.click();
  await expect(rueckfrage("API-Schlüssel entfernen?")).toContainText("bleiben erhalten");
  await abbrechen("API-Schlüssel entfernen?");
  await expect(entfernen).toBeVisible();

  await entfernen.click();
  await bestaetigen(page, "Schlüssel entfernen");
  await expect(page.getByLabel("API-Schlüssel", { exact: true })).toBeVisible();
  await expect(entfernen).toHaveCount(0);
});

test("Umzug: Die Frage eines inzwischen beendeten Abrufs kommt beim nächsten Abruf nicht von selbst wieder", async () => {
  await sql`insert into lexoffice_connection (ciphertext, organization_name) values (${Buffer.from([0])}, 'Testfirma')`;
  const fortschritt = '{"phase":"belege","contacts":0,"contactsLinked":0,"listed":10,"imported":3,"skipped":0,"files":0,"failed":[]}';
  const [lauf] = await sql<{ id: string }[]>`insert into lexoffice_imports (source, status, progress)
    values ('lexoffice', 'laeuft', ${fortschritt}::jsonb) returning id`;
  await go("/archiv");

  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(rueckfrage("Abruf abbrechen?")).toBeVisible();

  // Der Lauf endet, während die Frage offen steht: Die Frage verschwindet, ohne dass jemand sie beantwortet hat
  const statusAntwort = page.waitForResponse((r) => r.url().includes("_serverFn") && r.request().method() === "GET", { timeout: 10_000 });
  await sql`update lexoffice_imports set status = 'fertig', finished_at = now() where id = ${lauf!.id}`;
  const antwort = await statusAntwort;
  await expect(rueckfrage("Abruf abbrechen?")).toHaveCount(0, { timeout: 10_000 });

  // Später ein neuer Abruf. Der Start-Aufruf bräuchte einen echten Schlüssel; hier legt er nur den Lauf an wie der Server
  await page.route(
    (url) => url.pathname.includes("_serverFn"),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await sql`insert into lexoffice_imports (source, status, progress) values ('lexoffice', 'laeuft', ${fortschritt}::jsonb)`;
      return route.continue({ url: antwort.url(), method: "GET" });
    },
  );
  await page.getByRole("button", { name: "Erneut abrufen" }).click();
  await expect(page.getByText("Läuft: Belege und Dateien")).toBeVisible({ timeout: 10_000 });

  await expect(rueckfrage("Abruf abbrechen?")).toHaveCount(0);
});
