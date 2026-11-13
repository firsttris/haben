import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { ANONYMOUS, firstLink, SESSION, YEAR } from "./daten.ts";

/*
 * Zugang für die Steuerberatung (Roadmap Platz 10, Stufe 1), mit den Daten aus app.spec.ts: Der Inhaber lädt ein, die
 * Steuerberatung legt ihren Zugang an, liest und lädt herunter, kann aber nichts ändern, auch nicht an der Oberfläche
 * vorbei. Danach sperrt der Inhaber den Zugang.
 */

test.use({ storageState: SESSION });

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const KANZLEI = { name: "Kanzlei Muster", email: "kanzlei@example.com", password: "kanzlei-passwort-e2e" };

async function axe(p: Page) {
  const { violations } = await new AxeBuilder({ page: p }).withTags(WCAG).analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${v.help} → ${n.target.join(" ")}`));
}

/** Der Inhaber erzeugt unter Einstellungen › Sicherheit einen Einladungslink */
async function invite(owner: Page, label: string): Promise<string> {
  await owner.goto("/einstellungen?bereich=sicherheit");
  await owner.getByLabel("Bezeichnung").fill(label);
  await owner.getByRole("button", { name: "Einladungslink erzeugen" }).click();
  const link = owner.getByRole("textbox", { name: /Einladungslink für/ });
  await expect(link).toHaveValue(/\/einladung\//);
  return link.inputValue();
}

/** Ein Aufruf, den der Inhaber gerade machen wollte, abgefangen statt gesendet: Adresse, Kopfzeilen, Inhalt */
async function captureServerFn(owner: Page, click: () => Promise<void>) {
  let captured: { url: string; headers: Record<string, string>; body: string } | undefined;
  await owner.route("**/_serverFn/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const { cookie: _cookie, ...headers } = await request.allHeaders();
    captured = { url: request.url(), headers, body: request.postData() ?? "" };
    await route.abort();
  });
  await click();
  await expect.poll(() => captured).toBeDefined();
  await owner.unroute("**/_serverFn/**");
  return captured!;
}

async function steuerberatung(browser: Browser) {
  const context = await browser.newContext(ANONYMOUS);
  return { context, page: await context.newPage() };
}

test("Einladung, lesen ja, ändern nein, sperren", async ({ page: owner, browser }) => {
  test.setTimeout(240_000);
  const url = await invite(owner, KANZLEI.name);

  // Ohne Konto: die Einladung einlösen
  const { context, page: stb } = await steuerberatung(browser);
  await stb.goto(url);
  await expect(stb.getByRole("heading", { name: "Zugang für die Steuerberatung" })).toBeVisible();
  expect(await axe(stb), "Einladung").toEqual([]);
  await stb.getByLabel("Name").fill(KANZLEI.name);
  await stb.getByLabel("E-Mail").fill(KANZLEI.email);
  await stb.getByLabel("Passwort (mindestens 12 Zeichen)").fill(KANZLEI.password);
  await stb.getByRole("button", { name: "Zugang anlegen" }).click();
  await expect(stb.getByRole("button", { name: "Passkey hinzufügen" })).toBeVisible();
  await stb.getByRole("button", { name: "Später" }).click();
  await stb.waitForURL(/\/steuerberatung$/);
  await expect(stb.getByRole("heading", { name: "Steuerberatung", level: 1 })).toBeVisible();
  await expect(stb.getByText("Erster Besuch")).toBeVisible();
  expect(await axe(stb), "/steuerberatung").toEqual([]);

  // Derselbe Link gilt nur einmal
  const again = await steuerberatung(browser);
  await again.page.goto(url);
  await expect(again.page.getByRole("heading", { name: "Einladung ungültig" })).toBeVisible();
  expect(await axe(again.page), "Einladung ungültig").toEqual([]);
  await again.context.close();

  // Lesen: Auswertungen, Journal, Konten, Belege, Rechnungen, Exporte
  const nav = stb.getByRole("navigation", { name: "Hauptnavigation" });
  // Mehrere Firmen (#504): Auch die Steuerberatung sieht, in welcher Firma sie gerade ist
  await expect(nav.getByRole("link", { name: "Haben Mustermann IT · Max Mustermann" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Einstellungen" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Bank" })).toHaveCount(0);
  for (const [path, heading] of [
    ["/auswertungen", /Auswertungen/],
    ["/buchungen", /Buchungen/],
    [`/konten?jahr=${YEAR}`, /Konten|Saldenliste/],
    ["/belege", /Belege/],
    ["/rechnungen", /Rechnungen/],
  ] as const) {
    await stb.goto(path);
    await expect(stb.getByRole("heading", { level: 1 }), path).toHaveText(heading);
  }
  const beleg = await firstLink(stb, "/belege", /^\/belege\/[0-9a-f-]{36}$/);
  expect(beleg, "app.spec.ts hat einen Beleg gebucht").not.toBeNull();
  await stb.goto(beleg!);
  await expect(stb.getByRole("link", { name: "Original herunterladen" })).toBeVisible();
  await expect(stb.getByRole("button", { name: /buchen|Speichern|Löschen|Stornieren/ })).toHaveCount(0);
  const rechnung = await firstLink(stb, "/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/);
  await stb.goto(rechnung!);
  await expect(stb.getByRole("link", { name: "PDF herunterladen" })).toBeVisible();
  await expect(stb.getByRole("button", { name: /Stornieren|senden/ })).toHaveCount(0);
  await expect(stb.getByRole("link", { name: "Neue Rechnung" })).toHaveCount(0);
  expect((await stb.request.get(`/api/export/${YEAR}`)).status()).toBe(200);
  expect((await stb.request.get(beleg!.replace("/belege/", "/api/beleg/"))).status()).toBe(200);

  // Ändern: keine Seite dafür, und der Server lehnt auch ab, was an der Oberfläche vorbei kommt
  await stb.goto("/einstellungen?bereich=elster");
  await stb.waitForURL(/\/steuerberatung$/);
  await stb.goto("/buchungen/neu");
  await stb.waitForURL(/\/steuerberatung$/);
  expect((await stb.request.get("/api/ueberweisung/00000000-0000-4000-8000-000000000000")).status()).toBe(403);

  // Eine schreibende Server Function, wie sie der Inhaber aufruft (Einladung zurückziehen), mit der Sitzung der Steuerberatung
  await invite(owner, "Zweite Kanzlei");
  await owner.reload();
  const revoke = owner.getByRole("button", { name: "Zurückziehen" }).first();
  const call = await captureServerFn(owner, () => revoke.click());
  const answer = await stb.evaluate(
    async ({ url, headers, body }) => {
      const response = await fetch(url, { method: "POST", headers, body });
      return { status: response.status, text: await response.text() };
    },
    { url: call.url, headers: call.headers, body: call.body },
  );
  expect(answer.status).toBe(403);
  expect(answer.text).toContain("Lesezugriff");
  await owner.reload();
  await expect(owner.getByRole("button", { name: "Zurückziehen" }).first()).toBeVisible();

  // Der Inhaber sieht die Anmeldung und sperrt den Zugang; die Sitzung endet sofort
  // Die Zeile des Kontos, nicht die der eingelösten Einladung darunter
  const row = owner.locator(".history-row", { hasText: KANZLEI.email }).filter({ hasText: "Steuerberatung" });
  await expect(row).toContainText("zuletzt angemeldet");
  await row.getByRole("button", { name: "Sperren" }).click();
  await expect(row).toContainText("gesperrt");
  await stb.goto("/steuerberatung");
  await stb.waitForURL(/\/login$/);
  await row.getByRole("button", { name: "Freigeben" }).click();
  await expect(row.getByRole("button", { name: "Sperren" })).toBeVisible();
  await context.close();
});
