import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import postgres from "postgres";
import { spawn } from "node:child_process";

/*
 * SSO-Modus im Browser (playwright.sso-only.config.ts): Ersteinrichtung nur durch die Inhaber-Gruppe, automatische
 * Anlage der Steuerberatung, reine Zugangsübersicht, alte Direktlinks, Gruppenentzug und erneute Prüfung nach Ablauf.
 */

const BASE = `${process.env.E2E_SERVER_COMMAND ? "https" : "http"}://localhost:3218`;

async function capture(page: Page, view: string) {
  const output = process.env.SSO_ONLY_SCREENSHOT_DIR;
  if (!output) return;
  await mkdir(output, { recursive: true });
  const original = page.viewportSize();
  // Wie die Auswahl unten in der Navigation: Modus im Browser speichern, Seite neu laden (nur GET-Seiten)
  for (const [scheme, modus] of [
    ["light", "hell"],
    ["dark", "dunkel"],
  ] as const) {
    await page.evaluate((m) => localStorage.setItem("haben-modus", m), modus);
    await page.reload({ waitUntil: "networkidle" });
    for (const [size, viewport] of [
      ["desktop", { width: 1280, height: 900 }],
      ["handy", { width: 375, height: 812 }],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${output}/${view}-${scheme}-${size}.png`, fullPage: true, animations: "disabled" });
    }
  }
  await page.evaluate(() => localStorage.setItem("haben-modus", "hell"));
  if (original) await page.setViewportSize(original);
}

/**
 * Startet die SSO-Anmeldung. Better Auth lässt je Adresse nur 3 Anmeldeversuche in 10 Sekunden zu, und im Test kommen
 * alle Browser von derselben Adresse; der Zähler beginnt erst nach 10 Sekunden Ruhe neu, deshalb so lange warten.
 */
let lastStart = 0;
async function startSso(page: Page, button: string) {
  const wait = lastStart + 10_500 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  lastStart = Date.now();
  await page.getByRole("button", { name: button }).click();
}

async function providerLogin(page: Page, email: string, groups: string) {
  await expect(page.getByRole("heading", { name: "Testanbieter" })).toBeVisible();
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Gruppen").fill(groups);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
}

/**
 * Kalte Kompilierung des Dev-Servers (langsames Dateisystem im Container) blendet sonst Vites Fehlerhinweis ein. Die
 * Seiten einmal vorab laden; der eigentliche Durchlauf sieht danach nur noch fertige Module.
 */
async function warmUp(page: Page) {
  for (const path of ["/setup", "/login", "/einladung/vorwaermen", "/einstellungen", "/steuerberatung"]) {
    await page.goto(path, { waitUntil: "networkidle", timeout: 120_000 });
  }
}

async function noAxeViolations(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test("SSO-Modus: Einrichtung, automatische Anlage, Zugänge, Gruppenentzug und erneute Prüfung", async ({ page, browser }) => {
  const sql = postgres(process.env.E2E_DATABASE_URL!);
  const kanzlei = await browser.newContext();
  const guest = await kanzlei.newPage();
  test.setTimeout(300_000);
  try {
    await warmUp(page);
    // Neue Instanz: Einrichtung nur über SSO, ohne Code, Passwort oder Passkey
    await page.goto("/login", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("button", { name: "Mit Test-SSO einrichten" })).toBeVisible();
    await expect(page.getByLabel(/Einrichtungscode|Passwort|E-Mail/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Passkey|Passwort/ })).toHaveCount(0);
    await noAxeViolations(page);
    await capture(page, "sso-setup");

    // Die Steuerberatung kann die Instanz nicht erstmals einrichten
    await guest.goto(`${BASE}/setup`, { waitUntil: "networkidle" });
    await startSso(guest, "Mit Test-SSO einrichten");
    await providerLogin(guest, "kanzlei@example.de", "haben-steuerberatung");
    await guest.waitForURL(/\/setup\?sso=nicht-eingerichtet/);
    await expect(guest.getByRole("alert")).toContainText("noch nicht eingerichtet");
    await noAxeViolations(guest);
    await capture(guest, "sso-setup-abgewiesen");

    // Der Inhaber richtet ein
    await startSso(page, "Mit Test-SSO einrichten");
    await providerLogin(page, "inhaberin@example.de", "familie, haben-inhaber");
    await page.waitForURL(`${BASE}/`);

    // Danach entsteht die Steuerberatung ohne Einladung bei der ersten Anmeldung
    await guest.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await expect(guest.getByRole("button", { name: /Passkey|Passwort/ })).toHaveCount(0);
    await expect(guest.getByLabel(/Passwort|E-Mail/)).toHaveCount(0);
    await noAxeViolations(guest);
    await capture(guest, "sso-login");
    await startSso(guest, "Mit Test-SSO anmelden");
    await providerLogin(guest, "kanzlei@example.de", "haben-steuerberatung");
    await guest.waitForURL(`${BASE}/steuerberatung`);
    await guest.waitForLoadState("networkidle");
    await expect(guest.getByRole("region", { name: "Passkeys" })).toHaveCount(0);
    await expect(guest.getByRole("link", { name: /Sicherheit/ })).toHaveCount(0);
    await noAxeViolations(guest);
    await capture(guest, "sso-steuerberatung");

    // Zugänge: nur ansehen, alte Sicherheitslinks führen dorthin
    await page.goto("/einstellungen?bereich=sicherheit", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/bereich=zugaenge/);
    const navigation = page.getByRole("navigation", { name: "Bereiche der Einstellungen" });
    await expect(navigation.getByRole("link", { name: /^Sicherheit/ })).toHaveCount(0);
    await expect(navigation.getByRole("link", { name: /^Zugänge/ })).toBeVisible();
    const zugaenge = page.getByRole("region", { name: "Zugänge" });
    await expect(zugaenge).toContainText("kanzlei@example.de");
    await expect(zugaenge).toContainText("inhaberin@example.de");
    await expect(zugaenge).toContainText("in Test-SSO über die Gruppen");
    await expect(page.getByRole("button", { name: /Sperren|Freigeben|Entfernen|Einladungslink/ })).toHaveCount(0);
    await expect(page.getByLabel("Bezeichnung")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Passkeys" })).toHaveCount(0);
    await noAxeViolations(page);
    await capture(page, "sso-zugaenge");

    // Alte Einladungslinks verraten nichts
    const anonym = await browser.newContext();
    const fremd = await anonym.newPage();
    await fremd.goto(`${BASE}/einladung/alter-link-ohne-bedeutung`, { waitUntil: "networkidle" });
    await expect(fremd.getByRole("heading", { name: "Einladungen nicht verfügbar" })).toBeVisible();
    await expect(fremd.getByLabel(/Passwort|Name/)).toHaveCount(0);
    await noAxeViolations(fremd);
    await capture(fremd, "sso-einladung");

    // Gruppenentzug: die nächste Anmeldung (anderes Gerät) wird abgewiesen, die laufende Sitzung endet mit
    await fremd.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await startSso(fremd, "Mit Test-SSO anmelden");
    await providerLogin(fremd, "kanzlei@example.de", "familie");
    await fremd.waitForURL(/\/login\?sso=gruppe/);
    await expect(fremd.getByRole("alert")).toContainText("in Test-SSO keiner Haben-Gruppe");
    await noAxeViolations(fremd);
    await capture(fremd, "sso-gruppe-entzogen");
    await anonym.close();
    const [sessions] = await sql`select count(*)::int as n from session s join "user" u on u.id = s.user_id where u.email = 'kanzlei@example.de'`;
    expect(sessions!.n).toBe(0);
    await guest.goto(`${BASE}/steuerberatung`, { waitUntil: "networkidle" });
    await expect(guest).toHaveURL(/\/login/);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("region", { name: "Zugänge" })).toContainText("kein Zugang");

    // Abgelaufene Berechtigung: Zugriff verweigert, Weg zur erneuten SSO-Anmeldung, keine automatische Schleife
    await sql`update session set sso_expires_at = now() - interval '1 second' where user_id = (select id from "user" where email = 'inhaberin@example.de')`;
    await page.goto("/einstellungen?bereich=zugaenge", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/login/);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "Mit Test-SSO anmelden" })).toBeVisible();
    await startSso(page, "Mit Test-SSO anmelden");
    await providerLogin(page, "inhaberin@example.de", "haben-inhaber");
    await page.waitForURL(`${BASE}/`);

    expect(await sql`select id from account where provider_id <> 'oidc'`).toHaveLength(0);
    expect(await sql`select id from passkey`).toHaveLength(0);
    expect(await sql`select id from account where access_token is not null or refresh_token is not null or id_token is not null`).toHaveLength(0);
  } finally {
    await kanzlei.close();
    await sql.end();
  }
});

test("SSO: API/MCP und Kalender nach Herabstufung übernehmen und reaktivieren", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await startSso(page, "Mit Test-SSO anmelden");
  await providerLogin(page, "token-a@example.de", "haben-inhaber");
  await page.waitForURL(`${BASE}/`);
  await page.goto(`${BASE}/einstellungen?bereich=ki`, { waitUntil: "networkidle" });
  const enabled = page.getByLabel("Zugang für KI-Assistenten und API einschalten");
  if (!(await enabled.isChecked())) await enabled.click();
  await expect(enabled).toBeChecked();
  const card = page.getByRole("region", { name: "API-Tokens", exact: true });
  await card.getByLabel("Name", { exact: true }).fill("Automation");
  await card.locator('input[name="scopes"][value="kontakte:lesen"]').check();
  await card.getByRole("button", { name: "Token anlegen", exact: true }).click();
  const secret = await card.getByLabel("Token für „Automation“ (wird nur jetzt angezeigt)").inputValue();
  await page.reload({ waitUntil: "networkidle" });
  await capture(page, "tokens-aktiv-nachher");
  await page.goto(`${BASE}/fristen`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Kalender-Abo einrichten", exact: true }).click();
  const calendarUrl = await page.getByLabel("Abo-Link (wird nur jetzt angezeigt)").inputValue();
  await page.reload({ waitUntil: "networkidle" });

  const other = await browser.newContext();
  const owner = await other.newPage();
  try {
    await owner.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await startSso(owner, "Mit Test-SSO anmelden");
    await providerLogin(owner, "token-b@example.de", "haben-inhaber");
    await owner.waitForURL(`${BASE}/`);
    // Andere geprüfte Anmeldung derselben Identität: neue Rolle entzieht die alte Sitzung und deaktiviert Tokens.
    const changed = await browser.newContext();
    try {
      const login = await changed.newPage();
      await login.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await startSso(login, "Mit Test-SSO anmelden");
      await providerLogin(login, "token-a@example.de", "haben-steuerberatung");
      await login.waitForURL(`${BASE}/steuerberatung`);
    } finally {
      await changed.close();
    }
    const access = () =>
      owner.evaluate(
        async ({ token, url }) => {
          const headers = { authorization: `Bearer ${token}` };
          return [
            (await fetch("/api/v1/kontakte", { headers })).status,
            (
              await fetch("/api/mcp", {
                method: "POST",
                headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
                body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method: "initialize",
                  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "E2E", version: "1" } },
                }),
              })
            ).status,
            (await fetch(url)).status,
          ];
        },
        { token: secret, url: calendarUrl },
      );
    expect(await access()).toEqual([401, 401, 404]);
    await owner.goto(`${BASE}/einstellungen?bereich=ki`, { waitUntil: "networkidle" });
    await expect(owner.getByText("Inhaberrolle entzogen", { exact: false })).toBeVisible();
    await noAxeViolations(owner);
    await capture(owner, "tokens-deaktiviert-nachher");
    await owner.getByRole("button", { name: "Übernehmen und reaktivieren", exact: true }).click();
    await owner.getByRole("dialog").getByRole("button", { name: "Übernehmen und reaktivieren", exact: true }).click();
    await expect(owner.getByText("Verantwortlich: token-b", { exact: true })).toBeVisible();
    await capture(owner, "tokens-uebernommen-nachher");
    await owner.goto(`${BASE}/fristen`, { waitUntil: "networkidle" });
    await expect(owner.getByRole("status")).toContainText("Kalender-Abo deaktiviert");
    await expect(owner.getByRole("button", { name: "Abo beenden", exact: true })).toBeVisible();
    await noAxeViolations(owner);
    await capture(owner, "kalender-deaktiviert-nachher");
    await owner.getByRole("button", { name: "Übernehmen und reaktivieren", exact: true }).click();
    await owner.getByRole("dialog").getByRole("button", { name: "Übernehmen und reaktivieren", exact: true }).click();
    await expect(owner.getByText("Das Abo ist eingerichtet.", { exact: false })).toBeVisible();
    await capture(owner, "kalender-uebernommen-nachher");
    expect(await access()).toEqual([200, 200, 200]);
  } finally {
    await other.close();
  }
});

test("Produktionsserver beendet sich bei fehlgeschlagener Datenbank-Startprüfung", async () => {
  test.skip(!process.env.E2E_SERVER_COMMAND, "Nur gegen den Produktionsbuild");
  const child = spawn("bun", [".output/server/index.mjs"], {
    env: {
      ...process.env,
      DATABASE_URL: "postgres://test@127.0.0.1:1/startup_failure",
      BETTER_AUTH_URL: BASE,
      BETTER_AUTH_SECRET: "x".repeat(32),
      HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      OIDC_ONLY: "false",
      PORT: "3298",
    },
    stdio: "ignore",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await Promise.race([
      new Promise<number | null>((resolve) => child.once("exit", resolve)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Server beendet sich nicht")), 15_000);
      }),
    ]);
    expect(code).not.toBe(0);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
});
