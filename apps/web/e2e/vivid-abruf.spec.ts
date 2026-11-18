import { createServer, type Server } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import { VIVID_PORT } from "./durchlaeufe.ts";
import { bestaetigen, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/**
 * Kontoabruf über die Vivid Business API (#1393) in eigener, leerer Datenbank (Projekt „vivid-abruf“,
 * e2e/durchlaeufe.ts). Die API baut ein kleiner Server auf VIVID_PORT nach, mit den Routen und Fehlern aus der
 * OpenAPI-Beschreibung von Vivid (api.json); der Server von Haben spricht über VIVID_API_URL mit ihm.
 */

test.describe.configure({ mode: "serial" });

const SCHLUESSEL = "vivid_sk_v1_e2e";
const IBAN = "DE89370400440532013000";

/** Zeitpunkt vor heute um 10 Uhr UTC, nie vor dem 1. Januar und nie vor den 90 Tagen, die Vivid herausgibt */
function zeit(offset: number): string {
  const heute = new Date();
  const datum = Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate() + offset, 10);
  return new Date(Math.max(datum, Date.UTC(heute.getFullYear(), 0, 1, 10))).toISOString();
}

const umsatz = (id: string, offset: number, amount: string, over: Record<string, unknown> = {}) => ({
  id,
  account_id: "konto-haupt",
  type: "card_payment",
  state: "completed",
  amount,
  currency: "EUR",
  show_at: zeit(offset),
  created_at: zeit(offset),
  merchant: { name: "Kaffee Beispiel", city: "Leipzig", country: "DE" },
  card: { last_4: "4242" },
  ...over,
});

const api = {
  anfragen: [] as { path: string; key: string | undefined }[],
  umsaetze: [
    umsatz("u-1", -3, "-12.50"),
    umsatz("u-2", -1, "-8.00", { state: "pending" }),
    umsatz("u-3", -2, "1190.00", { type: "transfer", merchant: null, card: null }),
  ],
};

let page: Page;
let pageErrors: string[] = [];
let server: Server;

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
  server = createServer((request, response) => {
    const send = (status: number, body: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const path = (request.url ?? "").replace(/^\/sme-integration/, "");
    api.anfragen.push({ path, key: request.headers.authorization });
    if (request.headers.authorization !== SCHLUESSEL) return send(401, { trace_id: "t", errors: [{ code: "invalid_key", message: "unknown key" }] });
    if (path === "/api/v1/accounts/current/list")
      return send(200, {
        accounts: [{ id: "konto-haupt", name: "Hauptkonto", currency: "EUR", state: "active", account_details: [{ iban: IBAN, type: "local" }] }],
      });
    if (path === "/api/v1/transactions/list") return send(200, { transactions: api.umsaetze, next_cursor: null });
    return send(404, { trace_id: "t", errors: [{ code: "not_found", message: "no such route" }] });
  });
  await new Promise<void>((resolve) => server.listen(VIVID_PORT, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await page.context().close();
  await new Promise((resolve) => server?.close(resolve));
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const abruf = () => page.getByRole("region", { name: "Automatischer Abruf" });
const formular = () => page.getByRole("form", { name: "Vivid verbinden" });

test("Einrichtung", async () => {
  await einrichten(page);
});

test("verlangt den Schlüssel im Formular, bevor Haben Vivid fragt", async () => {
  await gehe(page, "/bank");
  await abruf().getByRole("button", { name: "Vivid verbinden" }).click();
  await formular().getByRole("button", { name: "Verbinden" }).click();
  await expect(formular().getByText("Der API-Schlüssel fehlt.")).toBeVisible();
  await expect(formular().getByLabel("API-Schlüssel")).toBeFocused();
  expect(api.anfragen).toHaveLength(0);
});

test("meldet einen Schlüssel, den Vivid nicht annimmt", async () => {
  await formular().getByLabel("API-Schlüssel").fill("vivid_sk_v1_falsch");
  await formular().getByRole("button", { name: "Verbinden" }).click();
  await expect(formular().getByRole("alert")).toHaveText("Vivid hat den Schlüssel nicht angenommen: Der API-Schlüssel ist ungültig.");
});

test("verbindet, legt das Konto an und holt die gebuchten Umsätze ohne die vorgemerkte Zahlung", async () => {
  await formular().getByLabel("API-Schlüssel").fill(SCHLUESSEL);
  await formular().getByRole("button", { name: "Verbinden" }).click();
  await expect(abruf().getByText("Vivid verbunden: 2 neue Umsätze.")).toBeVisible();
  await expect(abruf().getByText(/Neu angelegt: Vivid Hauptkonto …3000/)).toBeVisible();
  await expect(abruf().getByText("Aktiv")).toBeVisible();
  const konten = page.getByRole("navigation", { name: "Konten" });
  await expect(konten.getByRole("link", { name: /Vivid Hauptkonto …3000/ })).toContainText("Abruf");
  await expect(page.getByText("Kaffee Beispiel").first()).toBeVisible();
  // Den Schlüssel schickt Haben unverändert, ohne „Bearer“
  expect(api.anfragen.at(-1)?.key).toBe(SCHLUESSEL);
});

test("„Jetzt abrufen“ übernimmt die inzwischen gebuchte Zahlung einmal", async () => {
  api.umsaetze = api.umsaetze.map((u) => (u.id === "u-2" ? { ...u, state: "completed", amount: "-8.40" } : u));
  await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(abruf().getByText("Vivid: 1 neuer Umsatz.")).toBeVisible();
  await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(abruf().getByText("Vivid: 0 neue Umsätze.")).toBeVisible();
});

test("Trennen löscht die Verbindung, die Umsätze bleiben", async () => {
  await abruf().getByRole("button", { name: "Trennen" }).click();
  await bestaetigen(page, "Trennen");
  await expect(abruf().getByText("Vivid Business", { exact: true })).toHaveCount(0);
  await expect(abruf().getByText(/Noch keine Bank verbunden/)).toBeVisible();
  await expect(page.getByText("Kaffee Beispiel").first()).toBeVisible();
});
