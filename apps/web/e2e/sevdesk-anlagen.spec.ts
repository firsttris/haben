import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import anlagen from "../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/asset-mit-kontoart.json" with { type: "json" };
import { SEVDESK_PORT } from "./durchlaeufe.ts";
import { durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/*
 * Anlagen aus sevDesk (#472) in eigener, leerer Datenbank (Projekt „sevdesk-anlagen“, e2e/durchlaeufe.ts): Token speichern,
 * Vorschlag zum 01.01. abrufen, fehlende Art wählen, übernehmen. Die nachgebaute API liefert die anonymisierten Testdaten,
 * mit erfundenen Bezeichnungen statt „<anon>“.
 */

const NAMEN = ["Motorrad", "Tacker", "Regalsystem Lager", "Anhänger", "Laserdrucker"];
let sevdesk: Server;
test.beforeAll(async () => {
  sevdesk = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const first = (url.searchParams.get("offset") ?? "0") === "0";
    const body =
      request.method !== "GET"
        ? null
        : path === "/Tools/bookkeepingSystemVersion"
          ? { objects: { version: "1.0" } }
          : path === "/Asset"
            ? { objects: first ? anlagen.objects.map((a, i) => ({ ...a, name: NAMEN[i] })) : [] }
            : null;
    response.writeHead(body ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(body ?? { error: { message: "nicht nachgebaut" } }));
  });
  await new Promise<void>((resolve) => sevdesk.listen(SEVDESK_PORT, "127.0.0.1", resolve));
});
test.afterAll(() => new Promise<void>((resolve) => sevdesk.close(() => resolve())));

test("sevDesk: Anlagen als Vorschlag abrufen, Art wählen und übernehmen", async ({ browser }) => {
  const { page, pageErrors } = await durchlaufSeite(browser);
  await einrichten(page);
  await gehe(page, "/archiv");
  await page.getByRole("button", { name: "Umzug aus sevDesk", exact: true }).click();
  await page.getByLabel("API-Token").fill("0123456789abcdef0123456789abcdef");
  await page.getByRole("button", { name: "Prüfen und speichern" }).click();

  const karte = page.getByRole("region", { name: "Anlagen übernehmen" });
  await karte.getByLabel("Übernahmestichtag").fill("2026-01-01");
  await karte.getByRole("button", { name: "Anlagen abrufen" }).click();
  const tabelle = karte.getByRole("table", { name: "Anlagen aus sevDesk" });
  const zeile = (name: string) => tabelle.getByRole("row").filter({ hasText: name });
  await expect(zeile("Motorrad")).toContainText("9.142,86 €");
  await expect(zeile("Motorrad")).toContainText("Konto 0320");
  await expect(zeile("Tacker")).toContainText("Nicht nötig");
  await expect(karte.getByLabel("Tacker übernehmen")).toHaveCount(0);
  await expect(karte.getByLabel("Laserdrucker übernehmen")).not.toBeChecked();

  // Ohne Art keine Übernahme
  await karte.getByLabel("Laserdrucker übernehmen").check();
  await karte.getByRole("button", { name: "4 Anlagen übernehmen" }).click();
  await expect(karte.getByRole("alert")).toHaveText("Laserdrucker (Nr. 1005): Art wählen.");

  await karte.getByLabel("Art von Laserdrucker").selectOption("edv");
  await karte.getByRole("button", { name: "4 Anlagen übernehmen" }).click();
  await expect(karte.getByRole("status")).toContainText("4 Anlagen übernommen.");
  for (const name of ["Motorrad", "Regalsystem Lager", "Anhänger", "Laserdrucker"]) await expect(zeile(name)).toContainText("Übernommen");
  await expect(karte.getByRole("button", { name: /Anlagen? übernehmen/ })).toHaveCount(0);

  await karte.getByRole("link", { name: "Zum Anlagenverzeichnis" }).click();
  await expect(page.getByText("Laserdrucker")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
