import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { YEAR } from "./daten.ts";
import { databaseUrlFuer, EVATR_PORT } from "./durchlaeufe.ts";
import { gehe, kontrasteInThemes, kundeWaehlen, ohneAxeVerstoesse } from "./einrichtung.ts";

/*
 * Bestätigung der USt-IdNr. beim BZSt am Kontakt (#1385), gegen einen nachgebauten eVatR-Dienst auf EVATR_PORT; nur der
 * Server des Durchlaufs „belege-steuern“ hat die Abfrage eingeschaltet (playwright.config.ts). Die Antworten haben die
 * Form der Testabfrage vom 2026-11-18 mit den Beispielwerten der OpenAPI-Beschreibung.
 */

/**
 * ausfall: 503 mit evatr-1001; status: diese Antwort statt evatr-0000 (evatr-2001 mit 404); verzoegerung: so viele
 * Millisekunden bis zur Antwort, die Anfrage zählt sofort
 */
type Dienst = { server: Server; anfragen: Record<string, string>[]; ausfall: boolean; status: string | null; verzoegerung: number };

async function evatrAttrappe(): Promise<Dienst> {
  const dienst: Dienst = { server: createServer(), anfragen: [], ausfall: false, status: null, verzoegerung: 0 };
  dienst.server.on("request", (request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const anfrage = JSON.parse(body) as Record<string, string>;
      dienst.anfragen.push(anfrage);
      // Zeitpunkt von jetzt: Eine feste Antwort wäre nach 30 Tagen nicht mehr frisch, und die Tests kippten (Review #1458)
      const kopf = { id: `e2e${dienst.anfragen.length}`, anfrageZeitpunkt: new Date().toISOString() };
      const [code, antwort] = dienst.ausfall
        ? [503, { ...kopf, status: "evatr-1001" }]
        : dienst.status
          ? [dienst.status === "evatr-2001" ? 404 : 200, { ...kopf, status: dienst.status }]
          : [200, { ...kopf, status: "evatr-0000", ...(anfrage.firmenname ? { ergFirmenname: "A", ergStrasse: "B", ergPlz: "A", ergOrt: "A" } : {}) }];
      setTimeout(() => {
        response.writeHead(code, { "content-type": "application/json" });
        response.end(JSON.stringify(antwort));
      }, dienst.verzoegerung);
    });
  });
  await new Promise<void>((resolve) => dienst.server.listen(EVATR_PORT, "127.0.0.1", resolve));
  return dienst;
}

/** Im serialisierten Durchlauf belege-steuern registriert, nach den Kontakten mit gleicher USt-IdNr. */
export function ustIdBestaetigungPruefen(getPage: () => Page) {
  test("Kontakt: USt-IdNr. beim BZSt bestätigen, nach dem Anlegen, auf Knopfdruck und nach dem Speichern (#1385)", async () => {
    const page = getPage();
    const dienst = await evatrAttrappe();
    try {
      await gehe(page, "/einstellungen");
      const firma = page.getByRole("form", { name: "Firmendaten" });
      await firma.getByLabel("USt-IdNr.").fill("DE136695976");
      await firma.getByRole("button", { name: "Speichern" }).click();
      await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
      await page.waitForLoadState("networkidle");

      // Anlegen: Die Kontaktseite fragt gleich, erst einfach, dann mit Name und Anschrift
      await gehe(page, "/kontakte/neu");
      await page.getByLabel("Name oder Firma").fill("Alpenblick GmbH");
      await page.getByLabel("Straße und Hausnummer").fill("Hauptplatz 1");
      await page.getByLabel("PLZ").fill("8010");
      await page.getByLabel("Ort").fill("Graz");
      await page.getByLabel("Land (z. B. DE)").fill("AT");
      await page.getByLabel("USt-IdNr.").fill("ATU87654321");
      await page.getByRole("button", { name: "Kontakt anlegen" }).click();
      const karte = page.getByRole("region", { name: "Bestätigung beim BZSt" });
      await expect(karte.getByRole("status").filter({ hasText: "Antwort des BZSt gespeichert." })).toBeVisible();
      await expect(page).not.toHaveURL(/bestaetigen/);
      expect(dienst.anfragen).toEqual([
        { anfragendeUstid: "DE136695976", angefragteUstid: "ATU87654321" },
        { anfragendeUstid: "DE136695976", angefragteUstid: "ATU87654321", firmenname: "Alpenblick GmbH", strasse: "Hauptplatz 1", plz: "8010", ort: "Graz" },
      ]);
      await expect(karte).toContainText("Gültig");
      await expect(karte.getByRole("definition").nth(1)).toContainText("Stimmt nicht");
      await expect(karte.getByText("Alle Abfragen (2)")).toBeVisible();

      // Die letzte Antwort als PDF (#1491)
      const pdfLink = karte.getByRole("link", { name: /^PDF der Abfrage vom .*, mit Name und Anschrift$/ });
      const pdf = await page.request.get((await pdfLink.getAttribute("href")) ?? "");
      expect(pdf.headers()["content-type"]).toBe("application/pdf");

      // Ausfall des Dienstes: Hinweis, nichts gespeichert, kein zweiter Versuch
      dienst.ausfall = true;
      await karte.getByRole("button", { name: "Beim BZSt bestätigen" }).click();
      await expect(karte.getByRole("status").filter({ hasText: "evatr-1001" })).toContainText("später noch einmal");
      expect(dienst.anfragen).toHaveLength(3);
      await expect(karte.getByText("Alle Abfragen (2)")).toBeVisible();

      // Speichern mit neuer Anschrift fragt neu, Speichern ohne Änderung nicht
      dienst.ausfall = false;
      await page.getByLabel("Straße und Hausnummer").fill("Hauptplatz 2");
      await page.getByRole("button", { name: "Speichern", exact: true }).click();
      await expect(karte.getByText("Alle Abfragen (4)")).toBeVisible();
      expect(dienst.anfragen.at(-1)).toMatchObject({ strasse: "Hauptplatz 2" });
      await page.getByRole("button", { name: "Speichern", exact: true }).click();
      // Die Karte zeigt daneben noch ihre eigene Meldung; gemeint ist die des Formulars
      await expect(page.getByRole("form", { name: "Kontakt" }).getByRole("status")).toContainText("Gespeichert.");
      await page.waitForLoadState("networkidle");
      expect(dienst.anfragen).toHaveLength(5);

      // Die Karte ohne axe-Verstöße, am Desktop und am Handy, in allen Themes
      const pfad = new URL(page.url()).pathname;
      await ohneAxeVerstoesse(page, [pfad]);
      await kontrasteInThemes(page, [pfad]);

      // Nicht in den Zahlen der folgenden Tests
      await gehe(page, pfad);
      await page.getByRole("button", { name: "Archivieren" }).click();
      await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
    } finally {
      await new Promise((resolve) => dienst.server.close(resolve));
    }
  });

  test("Kontakt: Wechsel zu einem anderen Kontakt und Verlassen der Seite lösen nichts aus (#1385)", async () => {
    const page = getPage();
    const dienst = await evatrAttrappe();
    const sql = postgres(databaseUrlFuer("belege-steuern"), { max: 1 });
    const namen = ["Talblick GmbH", "Inland Werkstatt GmbH", "Seeblick GmbH"];
    try {
      // Nie bestätigt, wie aus einem Import: ohne Kontaktseite angelegt
      await sql.begin(async (tx) => {
        await tx`select set_config('haben.actor', 'e2e', true)`;
        await tx`insert into contacts (name, strasse, plz, ort, land, ust_id) values ('Talblick GmbH', 'Hauptplatz 2', '8010', 'Graz', 'AT', 'ATU22334455')`;
      });

      // Ein Kontakt ohne USt-IdNr. hat keine Karte; sein Speichern darf beim nächsten Kontakt keine Abfrage auslösen
      await gehe(page, "/kontakte/neu");
      await page.getByLabel("Name oder Firma").fill("Inland Werkstatt GmbH");
      await page.getByRole("button", { name: "Kontakt anlegen" }).click();
      await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
      await page.getByRole("button", { name: "Speichern", exact: true }).click();
      await expect(page.getByRole("form", { name: "Kontakt" }).getByRole("status")).toContainText("Gespeichert.");
      // In derselben Seite zum anderen Kontakt, über die Schnellsuche
      await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("button", { name: "Suche", exact: true }).click();
      const palette = page.getByRole("dialog", { name: "Befehlspalette" });
      await palette.getByRole("combobox").fill("Talblick");
      await expect(palette.getByRole("option", { name: /Talblick GmbH/ })).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { level: 1, name: "Talblick GmbH" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Bestätigung beim BZSt" })).toContainText("Noch nicht bestätigt.");
      await page.waitForLoadState("networkidle");
      expect(dienst.anfragen).toHaveLength(0);

      // Anlegen und gleich zu „Rechnung schreiben“, während das BZSt langsam antwortet: die neue Rechnung bleibt offen
      dienst.verzoegerung = 1_500;
      await gehe(page, "/kontakte/neu");
      await page.getByLabel("Name oder Firma").fill("Seeblick GmbH");
      await page.getByLabel("Ort").fill("Klagenfurt");
      await page.getByLabel("Land (z. B. DE)").fill("AT");
      await page.getByLabel("USt-IdNr.").fill("ATU33445566");
      await page.getByRole("button", { name: "Kontakt anlegen" }).click();
      await expect.poll(() => dienst.anfragen.length).toBe(1);
      await page.getByRole("link", { name: "Rechnung schreiben" }).click();
      await expect(page).toHaveURL(/\/rechnungen\/neu\?kunde=[0-9a-f-]{36}$/);
      // Die Abfrage läuft auf dem Server zu Ende, die Seite bleibt
      await expect.poll(() => dienst.anfragen.length).toBe(2);
      await page.waitForTimeout(2_000);
      await expect(page).toHaveURL(/\/rechnungen\/neu\?kunde=[0-9a-f-]{36}$/);
    } finally {
      // Nicht in den Zahlen der folgenden Tests
      await sql.begin(async (tx) => {
        await tx`select set_config('haben.actor', 'e2e', true)`;
        await tx`update contacts set archived_at = now() where name in ${tx(namen)} and archived_at is null`;
      });
      await sql.end();
      await new Promise((resolve) => dienst.server.close(resolve));
    }
  });

  test("Festschreiben: Hinweis bei ungültiger USt-IdNr., keiner nach gültiger Antwort, und frisch keine Abfrage (#1385)", async () => {
    const page = getPage();
    const dienst = await evatrAttrappe();
    const sql = postgres(databaseUrlFuer("belege-steuern"), { max: 1 });
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('haben.actor', 'e2e', true)`;
        await tx`insert into contacts (name, strasse, plz, ort, land, ust_id) values ('Bergsee GmbH', 'Seestraße 4', '6020', 'Innsbruck', 'AT', 'ATU44556677')`;
      });
      await gehe(page, "/rechnungen/neu");
      await kundeWaehlen(page, "Bergsee GmbH · Innsbruck");
      await page.getByRole("combobox", { name: "Umsatzsteuer", exact: true }).selectOption("reverse_charge");
      await page.getByLabel("Beschreibung Position 1").fill("Beratung");
      await page.getByLabel(/Einzelpreis Position 1/).fill("500,00");
      await page.getByRole("button", { name: "Entwurf speichern" }).click();
      await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
      await page.waitForLoadState("networkidle");
      const dialog = page.getByRole("dialog", { name: "Rechnung festschreiben?" });

      // Laut BZSt nicht vergeben: Hinweis in der Rückfrage, Festschreiben bliebe möglich
      dienst.status = "evatr-2001";
      await page.getByRole("button", { name: "Festschreiben", exact: true }).first().click();
      await expect(dialog.getByRole("status")).toContainText("Laut BZSt ist ATU44556677 nicht gültig: Nicht vergeben.");
      await expect(dialog.getByRole("button", { name: "Festschreiben", exact: true })).toBeEnabled();
      expect(dienst.anfragen).toHaveLength(1);
      await dialog.getByRole("button", { name: "Abbrechen" }).click();

      // Gültig: Haben fragt neu, einfach und qualifiziert, und sagt nichts
      dienst.status = null;
      await page.getByRole("button", { name: "Festschreiben", exact: true }).first().click();
      await expect.poll(() => dienst.anfragen.length).toBe(3);
      await expect(dialog.getByText("Frage beim BZSt")).toHaveCount(0);
      await expect(dialog).not.toContainText("Laut BZSt");
      await dialog.getByRole("button", { name: "Abbrechen" }).click();

      // Eine gültige Antwort von eben reicht: keine weitere Abfrage
      await page.getByRole("button", { name: "Festschreiben", exact: true }).first().click();
      await expect(dialog.getByText("Frage beim BZSt")).toHaveCount(0);
      await page.waitForLoadState("networkidle");
      expect(dienst.anfragen).toHaveLength(3);
      await dialog.getByRole("button", { name: "Abbrechen" }).click();
    } finally {
      // Nicht in den Zahlen der folgenden Tests: Entwurf weg, Kontakt archiviert
      await sql.begin(async (tx) => {
        await tx`select set_config('haben.actor', 'e2e', true)`;
        const entwuerfe = await tx`select i.id from invoices i join contacts c on c.id = i.contact_id where c.name = 'Bergsee GmbH' and i.status = 'draft'`;
        for (const { id } of entwuerfe) {
          await tx`delete from invoice_lines where invoice_id = ${id}`;
          await tx`delete from invoices where id = ${id}`;
        }
        await tx`update contacts set archived_at = now() where name = 'Bergsee GmbH' and archived_at is null`;
      });
      await sql.end();
      await new Promise((resolve) => dienst.server.close(resolve));
    }
  });
}

/**
 * Nach dem Test „Zusammenfassende Meldung: Leistung ins EU-Ausland“ registriert: Dessen Meldung im 1. Quartal des Folgejahres
 * nennt ATU12345678, die noch niemand bestätigt hat (beim Anlegen und Festschreiben lief kein nachgebauter Dienst).
 */
export function zmBestaetigungPruefen(getPage: () => Page) {
  test("Zusammenfassende Meldung: gemeldete USt-IdNr. beim BZSt bestätigen (#1385)", async () => {
    const page = getPage();
    const dienst = await evatrAttrappe();
    try {
      await gehe(page, `/umsatzsteuer/zm/${YEAR + 1}-Q1`);
      const hinweis = page.getByRole("status").filter({ hasText: "ATU12345678:" });
      await expect(hinweis).toHaveText("ATU12345678: beim BZSt noch nicht bestätigt.");
      const zeilen = page.getByRole("region", { name: "Meldezeilen" });
      await expect(zeilen).toContainText("1 gemeldete USt-IdNr.: letzte Antwort des BZSt nicht gültig oder älter als 30 Tage.");
      await zeilen.getByRole("button", { name: "Beim BZSt bestätigen" }).click();
      await expect(zeilen.getByRole("status")).toContainText("1 gemeldete USt-IdNr. beim BZSt angefragt");
      expect(dienst.anfragen).toEqual([{ anfragendeUstid: "DE136695976", angefragteUstid: "ATU12345678" }]);
      await expect(hinweis).toHaveCount(0);
      await expect(zeilen).toContainText("Jede gemeldete USt-IdNr. hat eine gültige Bestätigung des BZSt aus den letzten 30 Tagen.");
      await expect(zeilen.getByRole("button", { name: "Beim BZSt bestätigen" })).toHaveCount(0);
    } finally {
      await new Promise((resolve) => dienst.server.close(resolve));
    }
  });
}
