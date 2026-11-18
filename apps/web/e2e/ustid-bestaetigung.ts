import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { EVATR_PORT } from "./durchlaeufe.ts";
import { gehe, kontrasteInThemes, ohneAxeVerstoesse } from "./einrichtung.ts";

/*
 * Bestätigung der USt-IdNr. beim BZSt am Kontakt (#1385), gegen einen nachgebauten eVatR-Dienst auf EVATR_PORT; nur der
 * Server des Durchlaufs „belege-steuern“ hat die Abfrage eingeschaltet (playwright.config.ts). Die Antworten haben die
 * Form der Testabfrage vom 2026-11-18 mit den Beispielwerten der OpenAPI-Beschreibung.
 */

type Dienst = { server: Server; anfragen: Record<string, string>[]; ausfall: boolean };

async function evatrAttrappe(): Promise<Dienst> {
  const dienst: Dienst = { server: createServer(), anfragen: [], ausfall: false };
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
      response.writeHead(code, { "content-type": "application/json" });
      response.end(JSON.stringify(antwort));
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
      await expect(page.getByRole("status").filter({ hasText: "Gespeichert." })).toBeVisible();
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
}
