import { defineConfig } from "@playwright/test";

/** Getrennter Durchlauf: keine vorhandene Entwicklungsinstanz oder Datenbank wird verwendet. */
const database = process.env.E2E_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith("e2e")) throw new Error("Für SSO-E2E eine eigene E2E_DATABASE_URL mit Namen auf e2e setzen.");
export default defineConfig({
  testDir: "e2e",
  testMatch: "sso-only.spec.ts",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3218",
    locale: "de-DE",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: [
    { command: "bun e2e/oidc-provider.ts", url: "http://127.0.0.1:3216/.well-known/openid-configuration", reuseExistingServer: false },
    {
      // E2E_SERVER_COMMAND wie in playwright.config.ts, z. B. der gebaute Server (PORT=3218 bun .output/server/index.mjs)
      command: `bun e2e/reset-db.ts && bun run db:migrate && ${process.env.E2E_SERVER_COMMAND ?? "bun --preload ./e2e/oidc-preload.ts --bun vite dev --port 3218"}`,
      url: "http://localhost:3218/login",
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        DATABASE_URL: database,
        E2E_DATABASE_URL: database,
        BETTER_AUTH_URL: "http://localhost:3218",
        BETTER_AUTH_SECRET: "e2e-oidc-secret-mindestens-32-zeichen",
        HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        HABEN_SCHEDULER: "off",
        PORT: "3218",
        OIDC_ONLY: "true",
        OIDC_ISSUER: "http://127.0.0.1:3216",
        OIDC_CLIENT_ID: "haben",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_DISPLAY_NAME: "Test-SSO",
        OIDC_GROUP_INHABER: "haben-inhaber",
        OIDC_GROUP_STEUERBERATUNG: "haben-steuerberatung",
        DOCUMENTS_DIR: "test-results/oidc-belege",
      },
    },
  ],
});
