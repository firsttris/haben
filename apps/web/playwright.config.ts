import { defineConfig, devices } from "@playwright/test";

/**
 * Ende-zu-Ende-Tests gegen einen echten Server mit eigener, leerer Datenbank.
 * E2E_DATABASE_URL muss auf eine Datenbank zeigen, deren Name auf „e2e“ endet; sie wird geleert.
 * Lokal startet Playwright den Entwicklungsserver, in der CI den gebauten Server (E2E_SERVER_COMMAND).
 * Lokal ohne heruntergeladene Browser: PLAYWRIGHT_CHROMIUM_EXECUTABLE auf ein vorhandenes Chromium setzen.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // Datenbank leeren, migrieren, Server starten
    command: `tsx e2e/reset-db.ts && pnpm db:migrate && ${process.env.E2E_SERVER_COMMAND ?? `pnpm exec vite dev --port ${port}`}`,
    url: `${baseURL}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
      DOCUMENTS_DIR: process.env.E2E_DOCUMENTS_DIR ?? "test-results/e2e-belege",
      ERIC_DIR: "test-results/e2e-eric",
      HABEN_SCHEDULER: "off",
      ERIC_HOME: "",
      ELSTER_HERSTELLER_ID: "",
      ANTHROPIC_API_KEY: "",
    },
  },
});
