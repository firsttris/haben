import { ssoTestTls } from "./e2e/sso-tls.ts";
import { defineConfig } from "@playwright/test";
import { appDatabaseUrlFuer } from "./e2e/durchlaeufe.ts";

/** Getrennter Durchlauf: keine vorhandene Entwicklungsinstanz oder Datenbank wird verwendet. */
const database = process.env.E2E_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith("e2e")) throw new Error("Für SSO-E2E eine eigene E2E_DATABASE_URL mit Namen auf e2e setzen.");
const production = !!process.env.E2E_SERVER_COMMAND;
const tls = production ? ssoTestTls() : undefined;
const baseURL = `${production ? "https" : "http"}://localhost:3218`;
const issuer = `${production ? "https" : "http"}://127.0.0.1:3216`;
const tlsEnv = tls ? { SSO_E2E_TLS_CERT: tls.cert, SSO_E2E_TLS_KEY: tls.key, NODE_EXTRA_CA_CERTS: tls.cert } : {};
/** Portal (#504, Stufe 2) für e2e/sso-portal.spec.ts; HTTP genügt auf localhost, das Portal setzt Secure-Cookies */
const PORTAL = "http://localhost:3217";
export default defineConfig({
  testDir: "e2e",
  // sso-only zuerst: Es braucht eine frische Instanz, sso-portal richtet sie nur ein, falls nötig
  testMatch: ["sso-only.spec.ts", "sso-portal.spec.ts"],
  workers: 1,
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
        PORT: "3218",
        OIDC_ONLY: "true",
        OIDC_ISSUER: issuer,
        OIDC_CLIENT_ID: "haben",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_DISPLAY_NAME: "Test-SSO",
        OIDC_GROUP_INHABER: "haben-inhaber",
        OIDC_GROUP_STEUERBERATUNG: "haben-steuerberatung",
        DOCUMENTS_DIR: "test-results/oidc-belege",
        HABEN_PORTAL_URL: PORTAL,
      },
    },
    {
      command: "bun ../portal/src/main.ts",
      url: `${PORTAL}/gesund`,
      reuseExistingServer: false,
      env: {
        ...process.env,
        ...tlsEnv,
        PORT: "3217",
        PORTAL_URL: PORTAL,
        PORTAL_SECRET: "e2e-portal-secret-mindestens-32-zeichen",
        // Diese Instanz und zwei, die es nicht geben muss
        PORTAL_FIRMEN: `Studio Nord|${baseURL}|haben-inhaber;Werkstatt Süd|https://sued.example.de|haben-sued-inhaber;Atelier West|https://west.example.de|haben-west-inhaber`,
        OIDC_ISSUER: issuer,
        OIDC_CLIENT_ID: "haben",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_DISPLAY_NAME: "Test-SSO",
      },
    },
  ],
});
