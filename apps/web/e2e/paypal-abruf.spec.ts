import { createServer, type Server } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { databaseUrlFuer, PAYPAL_PORT } from "./durchlaeufe.ts";
import { durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/**
 * PayPal über die Transaction Search (#1512) in eigener, leerer Datenbank (Projekt „paypal-abruf“, e2e/durchlaeufe.ts):
 * Zugang prüfen und speichern, abrufen, erneut abrufen ohne Dubletten, entfernen. Nur der Server dieses Durchlaufs fragt
 * die nachgebaute API unten (PAYPAL_API_URL in playwright.config.ts). Sie kennt nur die Client-ID unten und liefert eine
 * Zahlung mit Gebühr und eine Abbuchung per Hand (T0403).
 */

test.describe.configure({ mode: "serial" });

const CLIENT_ID = "e2e-paypal-app-AB12";
const SECRET = "e2e-paypal-geheimnis";
const KONTO = "BEISPIELHAENDLER1";

let page: Page;
let pageErrors: string[] = [];
let paypal: Server;
/** Was Haben an die nachgebaute API geschickt hat: Methode und Pfad */
const anfragen: string[] = [];

/** Zeitstempel wie in der API, zwei Tage vor jetzt, damit der Tag sicher im Fenster liegt */
const vorZweiTagen = () => `${new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 19)}+0000`;

function transaktionen() {
  const zeit = vorZweiTagen();
  return [
    {
      transaction_info: {
        transaction_id: "9XY12345AB678901C",
        transaction_event_code: "T0006",
        transaction_initiation_date: zeit,
        transaction_amount: { currency_code: "EUR", value: "100.00" },
        fee_amount: { currency_code: "EUR", value: "-3.00" },
        transaction_status: "S",
        invoice_id: "RE-2026-117",
      },
      payer_info: { email_address: "erika@example.org", payer_name: { given_name: "Erika", surname: "Beispiel" } },
    },
    {
      transaction_info: {
        transaction_id: "7UT34567CD890124E",
        transaction_event_code: "T0403",
        transaction_initiation_date: zeit,
        transaction_amount: { currency_code: "EUR", value: "-50.00" },
        transaction_status: "S",
      },
    },
  ];
}

/** Nachgebaute API: Anmeldung (nur mit CLIENT_ID und SECRET), Saldo mit Kontokennung, Transaktionen */
async function paypalAttrappe(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    request.resume();
    request.on("end", () => {
      anfragen.push(`${request.method} ${url.pathname}`);
      const json = (status: number, value: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (url.pathname === "/v1/oauth2/token") {
        const richtig = `Basic ${Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64")}`;
        if (request.headers.authorization !== richtig) return json(401, { error: "invalid_client", error_description: "Client Authentication failed" });
        return json(200, { access_token: "e2e-zugang", token_type: "Bearer", expires_in: 3600 });
      }
      if (request.headers.authorization !== "Bearer e2e-zugang") return json(401, { name: "AUTHENTICATION_FAILURE" });
      if (url.pathname === "/v1/reporting/balances") return json(200, { account_id: KONTO, balances: [] });
      if (url.pathname === "/v1/reporting/transactions") return json(200, { transaction_details: transaktionen(), page: 1, total_pages: 1 });
      json(404, { name: "RESOURCE_NOT_FOUND" });
    });
  });
  await new Promise<void>((resolve) => server.listen(PAYPAL_PORT, "127.0.0.1", resolve));
  return server;
}

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
  paypal = await paypalAttrappe();
});

test.afterAll(async () => {
  await page.context().close();
  await new Promise((resolve) => paypal?.close(resolve));
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const karte = () => page.getByRole("region", { name: "PayPal" });

async function mitDatenbank<T>(arbeit: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrlFuer("paypal-abruf"), { max: 1, onnotice: () => {} });
  try {
    return await arbeit(sql);
  } finally {
    await sql.end();
  }
}

test("Einrichtung", async () => {
  await einrichten(page);
});

test("Falsche Zugangsdaten: PayPal lehnt ab, nichts wird gespeichert, das Secret steht in keiner Meldung", async () => {
  await gehe(page, "/einstellungen?bereich=bank");
  await expect(karte().getByText("Nicht eingerichtet.")).toBeVisible();
  await expect(karte().getByRole("button", { name: "Jetzt abrufen" })).toBeDisabled();

  await karte().getByLabel("Client-ID", { exact: true }).fill(CLIENT_ID);
  await karte().getByLabel("Secret", { exact: true }).fill("falsches-geheimnis");
  await karte().getByRole("button", { name: "Speichern" }).click();

  const meldung = karte().getByText(/PayPal nimmt die Zugangsdaten nicht an: Anmeldung abgelehnt/);
  await expect(meldung).toBeVisible();
  await expect(meldung).not.toContainText("falsches-geheimnis");
  await expect(karte().getByText("Nicht eingerichtet.")).toBeVisible();
  expect(await mitDatenbank((sql) => sql`select count(*)::int as n from paypal_connections`)).toEqual([{ n: 0 }]);
});

test("Zugang speichern: Haben prüft ihn bei PayPal und nennt das Konto", async () => {
  const abrufAb = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  await karte().getByLabel("Client-ID", { exact: true }).fill(CLIENT_ID);
  await karte().getByLabel("Secret", { exact: true }).fill(SECRET);
  await karte().getByLabel("Abruf ab").fill(abrufAb);
  await karte().getByRole("button", { name: "Speichern" }).click();

  await expect(karte().getByText("Zugang gespeichert.")).toBeVisible();
  await expect(karte().getByText(`Verbunden mit ${KONTO} (Client-ID …AB12).`)).toBeVisible();
  await expect(karte().getByText("Noch kein Abruf.")).toBeVisible();
  // Client-ID und Secret stehen nicht in den Feldern und nicht im Klartext in der Datenbank
  await expect(karte().getByLabel("Secret (leer lassen zum Behalten)")).toHaveValue("");
  await expect(karte().getByLabel("Client-ID (leer lassen zum Behalten)")).toHaveValue("");
  const [zeile] = await mitDatenbank(
    (sql) =>
      sql`select account_id, key_hint, abruf_start::text, position(${SECRET} in encode(ciphertext, 'escape')) as secret, position(${CLIENT_ID} in encode(ciphertext, 'escape')) as client from paypal_connections`,
  );
  expect(zeile).toEqual({ account_id: KONTO, key_hint: "AB12", abruf_start: abrufAb, secret: 0, client: 0 });
  expect(anfragen).toContain("GET /v1/reporting/balances");
});

test("Jetzt abrufen: Zahlung, Gebühr und Abbuchung per Hand kommen ins Konto des Zahlungsdienstleisters, ein zweiter Abruf legt nichts doppelt an", async () => {
  await mitDatenbank((sql) => sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('PayPal', 'zahlungsdienstleister', 'paypal', 3)`);
  await gehe(page, "/einstellungen?bereich=bank");
  await karte().getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(karte().getByText("Abruf durchgelaufen.")).toBeVisible();
  await expect(karte().getByText(/Letzter Abruf: /)).toBeVisible();
  expect(anfragen).toContain("GET /v1/reporting/transactions");

  const umsaetze = () => mitDatenbank((sql) => sql`select amount, counterparty_name from bank_transactions order by amount`);
  // Die Abbuchung per Hand (T0403) ist als Auszahlung eingeordnet: PayPal ist die Gegenseite, nicht leer wie bei einem unbekannten Code
  const erwartet = [
    { amount: -5_000, counterparty_name: "PayPal" },
    { amount: -300, counterparty_name: "PayPal" },
    { amount: 10_000, counterparty_name: "Erika Beispiel" },
  ];
  expect(await umsaetze()).toEqual(erwartet);

  await karte().getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(karte().getByText("Abruf durchgelaufen.")).toBeVisible();
  expect(await umsaetze()).toEqual(erwartet);
});

test("Zugang entfernen löscht Client-ID und Secret, die Umsätze bleiben", async () => {
  await karte().getByRole("button", { name: "Zugang entfernen" }).click();
  const dialog = page.getByRole("dialog", { name: "PayPal-Zugang entfernen?" });
  await dialog.getByRole("button", { name: "Entfernen" }).click();
  await expect(karte().getByText("Zugang entfernt. Übernommene Umsätze bleiben im Konto stehen.")).toBeVisible();
  await expect(karte().getByText("Nicht eingerichtet.")).toBeVisible();
  expect(await mitDatenbank((sql) => sql`select count(*)::int as n from paypal_connections`)).toEqual([{ n: 0 }]);
  expect(await mitDatenbank((sql) => sql`select count(*)::int as n from bank_transactions`)).toEqual([{ n: 3 }]);
});
