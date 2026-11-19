import { ssoTestTls } from "./e2e/sso-tls.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { testLogos } from "../firmenportal/src/test-logos.ts";
import { appDatabaseUrlFuer } from "./e2e/durchlaeufe.ts";

/**
 * Erfundene Logos verschiedener Größen für das Firmenportal (#1036). Nicht in test-results/: Das leert Playwright erst
 * nach dem Laden der Konfiguration, und der Server des Firmenportals liest die Logos beim Start
 */
const PORTAL_LOGOS = join(tmpdir(), "haben-e2e-portal-logos");
mkdirSync(PORTAL_LOGOS, { recursive: true });
for (const logo of testLogos()) writeFileSync(join(PORTAL_LOGOS, logo.datei), logo.daten);

/** Getrennter Durchlauf: keine vorhandene Entwicklungsinstanz oder Datenbank wird verwendet. */
const database = process.env.E2E_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith("e2e")) throw new Error("Für SSO-E2E eine eigene E2E_DATABASE_URL mit Namen auf e2e setzen.");
const production = !!process.env.E2E_SERVER_COMMAND;
const tls = production ? ssoTestTls() : undefined;
const baseURL = `${production ? "https" : "http"}://localhost:3218`;
const issuer = `${production ? "https" : "http"}://127.0.0.1:3216`;
const tlsEnv = tls ? { SSO_E2E_TLS_CERT: tls.cert, SSO_E2E_TLS_KEY: tls.key, NODE_EXTRA_CA_CERTS: tls.cert } : {};
/**
 * Firmenportal (#504, Stufe 2) für e2e/sso-firmenportal.spec.ts. Im Produktionslauf wie Haben hinter TLS
 * (e2e/sso-firmenportal-server.ts); über HTTP speichert nur Chromium die Secure-Cookies auf localhost, Safari und WebKit nicht
 */
const PORTAL = `${production ? "https" : "http"}://localhost:3217`;
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  // sso-only zuerst, es braucht eine frische Instanz. Playwright ordnet Dateien sonst nach dem Namen, und
  // „sso-firmenportal“ stünde vor „sso-only“; die Abhängigkeit hält die Reihenfolge unabhängig davon
  projects: [
    { name: "sso-only", testMatch: "sso-only.spec.ts" },
    { name: "firmenportal", testMatch: ["sso-firmenportal.spec.ts", "sso-firmenportal-abmelden.spec.ts"], dependencies: ["sso-only"] },
  ],
  timeout: 60_000,
  use: {
    baseURL,
    locale: "de-DE",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, ...(tls ? { args: [`--ignore-certificate-errors-spki-list=${tls.spki}`] } : {}) }
      : tls
        ? { args: [`--ignore-certificate-errors-spki-list=${tls.spki}`] }
        : {},
  },
  webServer: [
    {
      command: "bun e2e/oidc-provider.ts",
      url: `${issuer}/.well-known/openid-configuration`,
      reuseExistingServer: false,
      ignoreHTTPSErrors: production,
      env: { ...process.env, ...tlsEnv },
    },
    {
      // Produktionslauf: TLS-Reverse-Proxy und lokaler TLS-Testanbieter; kein HTTP-Schalter im Betriebscode.
      command: "bun e2e/reset-db.ts && bun run db:migrate && bun e2e/start-server.ts",
      url: `${baseURL}/login`,
      ignoreHTTPSErrors: production,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        ...tlsEnv,
        DATABASE_URL: appDatabaseUrlFuer(undefined, "sso"),
        MIGRATION_DATABASE_URL: process.env.E2E_APP_DATABASE_URL ? database : "",
        E2E_SERVER_COMMAND: production ? "bun e2e/sso-production-server.ts" : "bun --preload ./e2e/oidc-preload.ts --bun vite dev --port 3218",
        E2E_DATABASE_URL: database,
        BETTER_AUTH_URL: baseURL,
        BETTER_AUTH_SECRET: "e2e-oidc-secret-mindestens-32-zeichen",
        HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        HABEN_SCHEDULER: "off",
        HABEN_UPDATE_CHECK: "off",
        // Keine Bestätigung von USt-IdNrn. beim BZSt aus den SSO-Tests (#1385)
        HABEN_EVATR: "off",
        PORT: "3218",
        OIDC_ONLY: "true",
        OIDC_ISSUER: issuer,
        OIDC_CLIENT_ID: "haben",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_DISPLAY_NAME: "Test-SSO",
        OIDC_GROUP_INHABER: "haben-inhaber",
        OIDC_GROUP_STEUERBERATUNG: "haben-steuerberatung",
        DOCUMENTS_DIR: "test-results/oidc-belege",
        HABEN_FIRMENPORTAL_URL: PORTAL,
      },
    },
    {
      command: production ? "bun e2e/sso-firmenportal-server.ts" : "bun ../firmenportal/src/main.ts",
      url: `${PORTAL}/gesund`,
      ignoreHTTPSErrors: production,
      reuseExistingServer: false,
      env: {
        ...process.env,
        ...tlsEnv,
        // Mit TLS lauscht das Firmenportal intern auf 3221, davor der Proxy auf 3217
        PORT: production ? "3221" : "3217",
        PORTAL_URL: PORTAL,
        PORTAL_SECRET: "e2e-portal-secret-mindestens-32-zeichen",
        // Diese Instanz mit einem Schriftzug als Logo, eine in eigener Farbe, eine ohne beides und vier mit Logos anderer
        // Formen (test-logos.ts); außer dieser Instanz muss es keine geben
        PORTAL_FIRMEN: [
          `Studio Nord|${baseURL}|haben-inhaber||breit.png`,
          "Werkstatt Süd|https://sued.example.de|haben-sued-inhaber|#B45309",
          "Atelier West|https://west.example.de|haben-west-inhaber",
          "Bäckerei Ost|https://ost.example.de|haben-ost-inhaber||hoch.png",
          "Kanzlei Klein|https://klein.example.de|haben-klein-inhaber||klein.png",
          "Lager Groß|https://gross.example.de|haben-gross-inhaber||gross.png",
          "Zentrale Voll|https://voll.example.de|haben-voll-inhaber||voll.png",
        ].join(";"),
        PORTAL_LOGOS,
        OIDC_ISSUER: issuer,
        OIDC_CLIENT_ID: "haben",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_DISPLAY_NAME: "Test-SSO",
      },
    },
  ],
});
