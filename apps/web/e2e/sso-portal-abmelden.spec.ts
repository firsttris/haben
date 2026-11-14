import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";
import { ladeKonfiguration } from "../../portal/src/env.ts";
import { portal } from "../../portal/src/server.ts";
import { listenAbdruck, SITZUNG_COOKIE, SITZUNG_MS, signieren } from "../../portal/src/sitzung.ts";

/*
 * Review #504: Abmelden im Portal leitet zur Abmeldung des Anmeldedienstes (end_session_endpoint, RP-Initiated
 * Logout). Das Formular POST /abmelden antwortet mit 303 auf eine andere Origin; die Content Security Policy des
 * Portals darf diese Weiterleitung nicht blockieren (form-action gilt in Chromium auch für Weiterleitungen).
 */

const PORTAL_PORT = 3220;
const PORTAL = `http://localhost:${PORTAL_PORT}`;
let anbieter: Server;
let portalServer: Server;
let issuer = "";

const lauschen = (server: Server, port: number) => new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

test.beforeAll(async () => {
  anbieter = createServer((req, res) => {
    const pfad = new URL(req.url!, issuer).pathname;
    if (pfad === "/.well-known/openid-configuration") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          end_session_endpoint: `${issuer}/logout`,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<title>Abgemeldet</title><h1>Beim Anmeldedienst abgemeldet</h1>");
  });
  await lauschen(anbieter, 0);
  issuer = `http://127.0.0.1:${(anbieter.address() as { port: number }).port}`;

  const geladen = ladeKonfiguration({
    PORTAL_URL: PORTAL,
    PORTAL_SECRET: "portal-test-secret-mindestens-32-zeichen",
    PORTAL_FIRMEN: "Studio Nord|https://nord.example.de|haben-nord-inhaber",
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: "haben-portal",
    OIDC_CLIENT_SECRET: "secret",
    OIDC_DISPLAY_NAME: "Test-SSO",
  });
  if ("fehler" in geladen) throw new Error(geladen.fehler.join("; "));
  const handler = portal(geladen.config);
  portalServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const teil of req) body += teil;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const antwort = await handler(new Request(`${PORTAL}${req.url}`, { method: req.method, headers, body: req.method === "POST" ? body : undefined }));
    const kopf: Record<string, string | string[]> = {};
    antwort.headers.forEach((wert, name) => {
      if (name !== "set-cookie") kopf[name] = wert;
    });
    kopf["set-cookie"] = antwort.headers.getSetCookie();
    res.writeHead(antwort.status, kopf);
    res.end(await antwort.text());
  });
  await lauschen(portalServer, PORTAL_PORT);
  (globalThis as { reviewSitzung?: string }).reviewSitzung = signieren(
    geladen.config.secret,
    { typ: "sitzung", sitzung: { sub: "inhaberin", firmen: [0], liste: listenAbdruck(geladen.config.firmen) } },
    Date.now() + SITZUNG_MS,
  );
});

test.afterAll(async () => {
  await new Promise((resolve) => portalServer?.close(resolve));
  await new Promise((resolve) => anbieter?.close(resolve));
});

test("Portal: Abmelden führt zur Abmeldung beim Anmeldedienst", async ({ page }) => {
  // __Host-Cookies lassen sich über http://localhost nicht mit addCookies setzen; die Sitzung kommt deshalb als Kopfzeile
  await page.setExtraHTTPHeaders({ cookie: `${SITZUNG_COOKIE}=${(globalThis as { reviewSitzung?: string }).reviewSitzung!}` });
  await page.goto(`${PORTAL}/`);
  await expect(page.getByRole("link", { name: "Studio Nord" })).toBeVisible();
  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL(`${issuer}/logout?client_id=haben-portal`, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Beim Anmeldedienst abgemeldet" })).toBeVisible();
});
