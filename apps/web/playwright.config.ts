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
const gmbhPort = port + 1;
/** Neben der E2E-Datenbank, Name endet wie verlangt auf „e2e“: haben_e2e → haben_gmbh_e2e */
const gmbhDatabaseUrl = databaseUrl.replace(/e2e(\?.*)?$/i, "gmbh_e2e$1");

const chromium = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

/** Datenbank leeren, migrieren, Server starten */
function webServer(serverPort: number, serverDatabaseUrl: string, suffix = "") {
  const serverURL = `http://localhost:${serverPort}`;
  return {
    command: `bun e2e/reset-db.ts && bun run db:migrate && ${process.env.E2E_SERVER_COMMAND ?? `bun --bun vite dev --port ${serverPort}`}`,
    url: `${serverURL}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "pipe" as const,
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: serverDatabaseUrl,
      PORT: String(serverPort),
      BETTER_AUTH_URL: serverURL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
      DOCUMENTS_DIR: `${process.env.E2E_DOCUMENTS_DIR ?? "test-results/e2e-belege"}${suffix}`,
      ERIC_DIR: `test-results/e2e-eric${suffix}`,
      HABEN_SCHEDULER: "off",
      // muss zu SETUP_CODE in e2e/app.spec.ts passen
      HABEN_SETUP_CODE: "e2e-einrichtungscode",
      // Vorlage und Schriften für das Rechnungs-PDF; der gebaute Server findet sie sonst nicht
      HABEN_EINVOICE_DIR: fileURLToPath(new URL("../../packages/einvoice", import.meta.url)),
      ERIC_HOME: "",
      ELSTER_HERSTELLER_ID: "",
      ANTHROPIC_API_KEY: "",
      EXTRACTION_PROVIDER: "",
      EXTRACTION_BASE_URL: "",
    },
  };
}

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
    {
      name: "mit-daten",
      testMatch: ["anmelden.spec.ts", "barrierefreiheit.spec.ts", "seiten.spec.ts", "steuerberatung.spec.ts", "zz-doku-screenshots.spec.ts"],
      dependencies: ["ablauf"],
      use: chromium,
    },
    // Braucht keine Daten aus der App
    // GmbH mit eigenem Server und eigener Datenbank, von Anfang an daneben
    { name: "gmbh", testMatch: "gmbh.spec.ts", use: { ...chromium, baseURL: `http://localhost:${gmbhPort}` } },
    {
      name: "ohne-daten",
      testMatch: ["elster-helfer.spec.ts", "elster-helfer-erweiterung.spec.ts", "langsame-anfrage.spec.ts", "beenden.spec.ts"],
      use: chromium,
    },
  ],
  // Zweiter Server mit eigener Datenbank für das Szenario einer GmbH (gmbh.spec.ts): Die Rechtsform ist ab der ersten
  // Buchung fest, der Durchlauf in app.spec.ts ist ein Einzelunternehmen
  webServer: [webServer(port, databaseUrl), webServer(gmbhPort, gmbhDatabaseUrl, "-gmbh")],
});
