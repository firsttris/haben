import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { databaseUrlFuer, EVATR_PORT } from "./durchlaeufe.ts";
import { gehe, kontrasteInThemes, ohneAxeVerstoesse } from "./einrichtung.ts";

/*
 * Bestätigung der USt-IdNr. beim BZSt am Kontakt (#1385), gegen einen nachgebauten eVatR-Dienst auf EVATR_PORT; nur der
 * Server des Durchlaufs „belege-steuern“ hat die Abfrage eingeschaltet (playwright.config.ts). Die Antworten haben die
 * Form der Testabfrage vom 2026-11-18 mit den Beispielwerten der OpenAPI-Beschreibung.
 */

/** ausfall: 503 mit evatr-1001; verzoegerung: so viele Millisekunden bis zur Antwort, die Anfrage zählt sofort */
type Dienst = { server: Server; anfragen: Record<string, string>[]; ausfall: boolean; verzoegerung: number };

async function evatrAttrappe(): Promise<Dienst> {
  const dienst: Dienst = { server: createServer(), anfragen: [], ausfall: false, verzoegerung: 0 };
  dienst.server.on("request", (request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const anfrage = JSON.parse(body) as Record<string, string>;
      dienst.anfragen.push(anfrage);
      const kopf = { id: `e2e${dienst.anfragen.length}`, anfrageZeitpunkt: "2026-11-18T14:34:36.318854732+01:00" };
      const [code, antwort] = dienst.ausfall
        ? [503, { ...kopf, status: "evatr-1001" }]
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
      await expect(page).toHaveURL(/\/rechnungen\/neu$/);
      // Die Abfrage läuft auf dem Server zu Ende, die Seite bleibt
      await expect.poll(() => dienst.anfragen.length).toBe(2);
      await page.waitForTimeout(2_000);
      await expect(page).toHaveURL(/\/rechnungen\/neu$/);
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
}
