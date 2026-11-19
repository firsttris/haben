import { createServer, type Server } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { databaseUrlFuer, ETSY_PORT } from "./durchlaeufe.ts";
import { axeVerstoesse, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/**
 * Etsy Payments (#1133) in eigener, leerer Datenbank (Projekt „etsy-abruf“, e2e/durchlaeufe.ts): Zugang speichern,
 * bei Etsy freigeben, Verlauf abrufen, trennen und entfernen. Nur der Server dieses Durchlaufs fragt die nachgebaute
 * API unten (ETSY_API_URL, ETSY_TOKEN_URL, ETSY_AUTH_URL in playwright.config.ts): Die Freigabe leitet sofort mit Code
 * zurück, der Verlauf hat einen Verkauf mit Sales Tax.
 */

test.describe.configure({ mode: "serial" });

const SHOP = "35160089";
const BESTELLUNG = 3000000001;

let page: Page;
let pageErrors: string[] = [];
let etsy: Server;
/** Was Haben an die nachgebaute API geschickt hat: Pfad mit Abfrage, beim Token auch der Rumpf */
const anfragen: string[] = [];
/** Betrag des Verkaufs im Verlauf; ein späterer Abruf liefert ihn geändert (Konflikt, #306) */
let verkauf = 2495;

function verlauf() {
  const jetzt = Math.floor(Date.now() / 1000) - 60;
  return [
    {
      entry_id: 900,
      ledger_id: 1,
      sequence_number: 1,
      amount: verkauf,
      currency: "EUR",
      balance: verkauf,
      created_timestamp: jetzt,
      ledger_type: "PAYMENT_GROSS",
      reference_type: "shop_payment",
      reference_id: "5000000001",
    },
    {
      entry_id: 901,
      ledger_id: 1,
      sequence_number: 2,
      amount: -145,
      currency: "EUR",
      balance: 2350,
      created_timestamp: jetzt,
      ledger_type: "sales_tax",
      reference_type: "receipt",
      reference_id: String(BESTELLUNG),
    },
  ];
}

/** Nachgebaute Etsy-API: Freigabe, Token, Konto und Shop, Verlauf und Bestellbezug */
async function etsyAttrappe(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      anfragen.push(`${request.method} ${url.pathname}${url.search}${body ? ` ${body}` : ""}`);
      if (url.pathname === "/oauth/connect") {
        const ziel = new URL(url.searchParams.get("redirect_uri") ?? "");
        ziel.searchParams.set("code", "e2e-code");
        ziel.searchParams.set("state", url.searchParams.get("state") ?? "");
        response.writeHead(302, { location: ziel.toString() });
        response.end();
        return;
      }
      const json = (status: number, value: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (url.pathname === "/v3/public/oauth/token") return json(200, { access_token: "e2e-zugang", refresh_token: "e2e-erneuerung", expires_in: 3600 });
      if (url.pathname === "/v3/application/users/me") return json(200, { user_id: 77, shop_id: Number(SHOP) });
      if (url.pathname === "/v3/application/users/77/shops") return json(200, { shop_id: Number(SHOP), shop_name: "Werkstatt Nord" });
      if (url.pathname === `/v3/application/shops/${SHOP}/payment-account/ledger-entries`) return json(200, { count: 2, results: verlauf() });
      if (url.pathname === `/v3/application/shops/${SHOP}/payment-account/ledger-entries/payments`) {
        return json(200, { results: [{ receipt_id: BESTELLUNG, payment_id: 5000000001 }] });
      }
      json(404, { error: "nicht nachgebaut" });
    });
  });
  await new Promise<void>((resolve) => server.listen(ETSY_PORT, "127.0.0.1", resolve));
  return server;
}

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
  etsy = await etsyAttrappe();
});

test.afterAll(async () => {
  await page.context().close();
  await new Promise((resolve) => etsy?.close(resolve));
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const karte = () => page.getByRole("region", { name: "Etsy Payments" });

test("Einrichtung", async () => {
  await einrichten(page);
});

test("Zugangsdaten speichern: Schlüssel gespeichert, Freigabe fehlt noch", async () => {
  await gehe(page, "/einstellungen?bereich=bank");
  await expect(karte().getByText("Nicht eingerichtet.")).toBeVisible();
  await expect(karte().getByRole("button", { name: "Verbinden" })).toBeDisabled();

  await karte().getByLabel("App-Schlüssel (keystring)").fill("e2eschluessel");
  await karte().getByLabel("Gemeinsames Geheimnis").fill("e2e-geheimnis");
  await karte().getByRole("button", { name: "Speichern" }).click();

  await expect(karte().getByText("Zugang gespeichert. Jetzt verbinden, damit Etsy die Freigabe zeigt.")).toBeVisible();
  await expect(karte().getByText("Nicht verbunden. Schlüssel gespeichert, die Freigabe bei Etsy fehlt noch.")).toBeVisible();
  // Das Geheimnis steht nicht im Feld und nicht im Klartext in der Datenbank
  await expect(karte().getByLabel("Gemeinsames Geheimnis (leer lassen zum Behalten)")).toHaveValue("");
  const sql = postgres(databaseUrlFuer("etsy-abruf"), { max: 1, onnotice: () => {} });
  try {
    const [zeile] = await sql`select keystring, position('e2e-geheimnis' in encode(ciphertext, 'escape')) as klartext from etsy_connections`;
    expect(zeile).toEqual({ keystring: "e2eschluessel", klartext: 0 });
  } finally {
    await sql.end();
  }
});

test("Verbinden: Etsy gibt frei, die Karte nennt den Shop", async () => {
  await karte().getByRole("button", { name: "Verbinden" }).click();
  await page.waitForURL("**/einstellungen?bereich=bank");
  await expect(karte().getByText(`Verbunden mit Werkstatt Nord (${SHOP}).`)).toBeVisible();

  const freigabe = anfragen.find((a) => a.startsWith("GET /oauth/connect"));
  expect(freigabe).toContain("code_challenge_method=S256");
  expect(freigabe).toContain("scope=transactions_r+shops_r");
  const token = anfragen.find((a) => a.startsWith("POST /v3/public/oauth/token"));
  expect(token).toContain("grant_type=authorization_code");
  expect(token).toContain("code_verifier=");
});

test("Jetzt abrufen: der Verkauf kommt mit dem Betrag ohne Sales Tax ins Konto des Zahlungsdienstleisters", async () => {
  const sql = postgres(databaseUrlFuer("etsy-abruf"), { max: 1, onnotice: () => {} });
  try {
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('Etsy Payments', 'zahlungsdienstleister', 'etsy', 3)`;
    await gehe(page, "/einstellungen?bereich=bank");
    await karte().getByRole("button", { name: "Jetzt abrufen" }).click();
    await expect(karte().getByText("Abruf durchgelaufen.")).toBeVisible();
    await expect(karte().getByText(/Letzter Abruf: /)).toBeVisible();

    const umsaetze = await sql`select amount, purpose from bank_transactions order by amount`;
    expect(umsaetze).toEqual([{ amount: 2350, purpose: `Verkauf · Etsy Bestellung ${BESTELLUNG} · Sales Tax 1,45 € von Etsy abgeführt` }]);
  } finally {
    await sql.end();
  }
});

test("Konflikt klären an der Karte: Etsy liefert den Verkauf anders, nach „Bisherigen behalten“ läuft der Abruf wieder (#306)", async () => {
  verkauf = 2595;
  await karte().getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(karte().getByRole("status").filter({ hasText: "Konflikt mit schon übernommenen Umsätzen: 900/main" }).first()).toBeVisible();

  await karte().getByRole("button", { name: "Konflikt klären" }).click();
  const dialog = page.getByRole("dialog", { name: "Konflikt klären" });
  await expect(dialog.getByText("Etsy liefert diesen Umsatz (900) jetzt anders als beim ersten Abruf.", { exact: false })).toBeVisible();
  await expect(dialog.getByText("Jetzt von Etsy")).toBeVisible();
  expect(await axeVerstoesse(page), "Dialog „Konflikt klären“ an der Etsy-Karte").toEqual([]);
  await dialog.getByRole("button", { name: "Klären" }).click();
  await expect(dialog).toBeHidden();
  await expect(karte().getByRole("status").filter({ hasText: "Geklärt; der nächste Abruf übernimmt das Konto wieder." })).toBeVisible();

  await karte().getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(karte().getByText("Abruf durchgelaufen.")).toBeVisible();
  await expect(karte().getByRole("button", { name: /Konflikt/ })).toHaveCount(0);
  await expect(karte().getByText("Geklärt; der nächste Abruf übernimmt das Konto wieder.")).toHaveCount(0);
  const sql = postgres(databaseUrlFuer("etsy-abruf"), { max: 1, onnotice: () => {} });
  try {
    expect(await sql`select decision from import_resolutions`).toEqual([{ decision: "keep" }]);
    expect(await sql`select count(*)::int as n from bank_transactions`).toEqual([{ n: 1 }]);
  } finally {
    await sql.end();
  }
});

test("Trennen behält den Schlüssel, Zugang entfernen löscht ihn", async () => {
  await karte().getByRole("button", { name: "Trennen" }).click();
  await expect(karte().getByText("Verbindung getrennt. Der Schlüssel bleibt gespeichert.")).toBeVisible();
  await expect(karte().getByText("Nicht verbunden. Schlüssel gespeichert, die Freigabe bei Etsy fehlt noch.")).toBeVisible();
  await expect(karte().getByRole("button", { name: "Jetzt abrufen" })).toBeDisabled();

  await karte().getByRole("button", { name: "Zugang entfernen" }).click();
  const dialog = page.getByRole("dialog", { name: "Etsy-Zugang entfernen?" });
  await dialog.getByRole("button", { name: "Entfernen" }).click();
  await expect(karte().getByText("Zugang entfernt. Übernommene Umsätze bleiben im Konto stehen.")).toBeVisible();
  await expect(karte().getByText("Nicht eingerichtet.")).toBeVisible();
  await expect(karte().getByLabel("App-Schlüssel (keystring)")).toHaveValue("");
});
