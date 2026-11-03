import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

/**
 * Ende-zu-Ende-Tests gegen einen echten Server mit eigener, leerer Datenbank.
 * E2E_DATABASE_URL muss auf eine Datenbank zeigen, deren Name auf „e2e“ endet; sie wird geleert.
 * Lokal startet Playwright den Entwicklungsserver, in der CI den gebauten Server (E2E_SERVER_COMMAND).
 * Lokal ohne heruntergeladene Browser: PLAYWRIGHT_CHROMIUM_EXECUTABLE auf ein vorhandenes Chromium setzen.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";

const chromium = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  // Mehrere Browser gegen denselben Server: „ablauf“ läuft für sich nacheinander, „mit-daten“ danach
  // verteilt auf die Worker, „ohne-daten“ von Anfang an daneben
  fullyParallel: true,
  workers: 4,
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
  projects: [
    // Der Betrieb in der leeren Datenbank, Schritt für Schritt (test.describe.configure serial in der Datei)
    { name: "ablauf", testMatch: "app.spec.ts", use: chromium },
    // Liest nur, was „ablauf“ angelegt hat, mit dessen Sitzung (e2e/daten.ts). Playwright startet „ablauf“ auch
    // mit, wenn nur eine dieser Dateien laufen soll
    { name: "mit-daten", testMatch: ["barrierefreiheit.spec.ts", "seiten.spec.ts", "zz-doku-screenshots.spec.ts"], dependencies: ["ablauf"], use: chromium },
    // Braucht keine Daten aus der App
    {
      name: "ohne-daten",
      testMatch: ["elster-helfer.spec.ts", "elster-helfer-erweiterung.spec.ts", "langsame-anfrage.spec.ts", "beenden.spec.ts"],
      use: chromium,
    },
  ],
  webServer: {
    // Datenbank leeren, migrieren, Server starten
    command: `bun e2e/reset-db.ts && bun run db:migrate && ${process.env.E2E_SERVER_COMMAND ?? `bun --bun vite dev --port ${port}`}`,
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
      // muss zu SETUP_CODE in e2e/app.spec.ts passen
      HABEN_SETUP_CODE: "e2e-einrichtungscode",
      // Vorlage und Schriften für das Rechnungs-PDF; der gebaute Server findet sie sonst nicht
      HABEN_EINVOICE_DIR: fileURLToPath(new URL("../../packages/einvoice", import.meta.url)),
      ERIC_HOME: "",
      ELSTER_HERSTELLER_ID: "",
      ANTHROPIC_API_KEY: "",
    },
  },
});
