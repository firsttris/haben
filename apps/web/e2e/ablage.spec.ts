import { expect, type Page, test } from "@playwright/test";
import { empfaengerStarten, type Empfaenger } from "../src/server/modules/ablage/test-empfaenger.ts";
import { CUSTOMERS, durchlaufSeite, einrichten, gehe, INVOICES, kontaktAnlegen, ohneAxeVerstoesse, rechnungFestschreiben } from "./einrichtung.ts";
import { HANDY, LAPTOP } from "./kopfzeile.ts";

/**
 * Ablage im Dokumentenarchiv (Projekt „ablage“, e2e/durchlaeufe.ts): unter Einstellungen › Export eine Adresse
 * einrichten, eine Rechnung festschreiben und an der Rechnung sehen, dass sie übertragen ist. Zwei nachgebaute
 * Archive mit verschiedenen Feldnamen und Kopfzeilen laufen im Testprozess; das eine antwortet mit einer id für den
 * Link, das andere nur mit einer Kennung als Text.
 */

test.describe.configure({ mode: "serial" });

let page: Page;
let mitId: Empfaenger;
let ohneId: Empfaenger;
let rechnungMitLink = "";

test.beforeAll(async ({ browser }) => {
  ({ page } = await durchlaufSeite(browser));
  mitId = await empfaengerStarten({ status: 201, body: { id: "4711" } });
  ohneId = await empfaengerStarten({ status: 200, body: "c4a1f0d2-task" });
});

test.afterAll(async () => {
  await page.context().close();
  await Promise.all([mitId?.close(), ohneId?.close()]);
});

const karte = () => page.getByRole("form", { name: "Ablage im Dokumentenarchiv" });

async function einstellen(werte: { url: string; feld: string; kopfzeile: string; wert: string; link?: string; titel?: string; pdf?: boolean }) {
  await gehe(page, "/einstellungen?bereich=export");
  const form = karte();
  await form.getByLabel("Adresse").fill(werte.url);
  await form.getByLabel("Feld für die Datei").fill(werte.feld);
  await form.getByLabel("Kopfzeile", { exact: true }).fill(werte.kopfzeile);
  await form.getByLabel("Wert der Kopfzeile").fill(werte.wert);
  await form.getByLabel("Link zum Dokument (optional)").fill(werte.link ?? "");
  if (werte.titel) {
    await form.getByRole("button", { name: "Feld hinzufügen" }).click();
    await form.getByLabel("Feld 1: Name").fill("title");
    await form.getByLabel("Feld 1: Wert").fill(werte.titel);
  }
  await form.getByLabel("Datei", { exact: true }).selectOption(werte.pdf ? "pdf" : "original");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Ablage gespeichert." })).toBeVisible();
}

/** Die Übertragung läuft nach dem Festschreiben im Hintergrund; bis sie da ist, die Seite neu laden */
async function archivStatus(): Promise<string> {
  const zeile = page.locator("dt", { hasText: /^Archiv$/ }).locator("xpath=following-sibling::dd[1]");
  await expect(async () => {
    await page.reload({ waitUntil: "networkidle" });
    await expect(zeile).not.toContainText("Wird übertragen", { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  return (await zeile.textContent()) ?? "";
}

test("Einrichtung mit drei Kunden", async () => {
  // Der Entwicklungsserver übersetzt beim ersten Aufruf; dessen Fehlermeldung bliebe sonst über der Seite
  await page.request.get("/setup", { timeout: 60_000 }).catch(() => {});
  await einrichten(page);
  for (const kunde of CUSTOMERS) await kontaktAnlegen(page, kunde);
});

test("schickt die festgeschriebene Rechnung an das Archiv und verlinkt sie", async () => {
  await einstellen({ url: mitId.url, feld: "datei", kopfzeile: "Authorization", wert: "Bearer e2e-archiv", link: "https://archiv.example/dokumente/{id}" });
  // Der Wert der Kopfzeile steht nach dem Speichern nicht mehr im Formular
  await expect(karte().getByLabel("Wert der Kopfzeile")).toHaveValue("");
  await expect(karte().getByLabel("Wert der Kopfzeile")).toHaveAttribute("placeholder", "unverändert lassen");

  await rechnungFestschreiben(page, INVOICES[0]!);
  rechnungMitLink = page.url();
  expect(await archivStatus()).toContain("Übertragen");
  await expect(page.getByRole("link", { name: "Im Archiv öffnen" })).toHaveAttribute("href", "https://archiv.example/dokumente/4711");

  expect(mitId.received).toHaveLength(1);
  const { headers, files } = mitId.received[0]!;
  expect(headers.authorization).toBe("Bearer e2e-archiv");
  expect(files.datei!.type).toBe("application/pdf");
  expect(new TextDecoder().decode(files.datei!.bytes.subarray(0, 5))).toBe("%PDF-");
});

test("schickt an ein anderes Archiv mit anderem Feld, Token und Titel", async () => {
  await einstellen({ url: ohneId.url, feld: "document", kopfzeile: "Authorization", wert: "Token e2e-zwei", titel: "{art} {nummer}", pdf: true });
  await rechnungFestschreiben(page, INVOICES[1]!);
  expect(await archivStatus()).toContain("Übertragen");
  await expect(page.getByRole("link", { name: "Im Archiv öffnen" })).toHaveCount(0);
  const { headers, fields, files } = ohneId.received[0]!;
  expect(headers.authorization).toBe("Token e2e-zwei");
  expect(fields.title).toMatch(/^Rechnung \S+$/);
  expect(Object.keys(files)).toEqual(["document"]);
});

test("zeigt einen Fehler an der Rechnung und in den Einstellungen", async () => {
  ohneId.standard = { status: 503, body: { fehler: "Wartung" } };
  await rechnungFestschreiben(page, INVOICES[2]!);
  expect(await archivStatus()).toContain("Fehlgeschlagen");
  await expect(page.getByText("HTTP 503")).toBeVisible();
  await gehe(page, "/einstellungen?bereich=export");
  await expect(karte().getByRole("listitem").filter({ hasText: "HTTP 503" })).toBeVisible();

  ohneId.standard = { status: 200, body: "c4a1f0d2-task" };
  await karte().getByRole("button", { name: "Jetzt übertragen" }).click();
  await expect(karte().getByRole("status").filter({ hasText: "1 übertragen." })).toBeVisible();
  await expect(karte().getByRole("listitem")).toHaveCount(0);
});

test("Einstellungen und Rechnung ohne Verstöße, hell und dunkel, am Desktop und am Handy", async () => {
  const rechnung = rechnungMitLink.replace(/^https?:\/\/[^/]+/, "");
  for (const modus of ["hell", "dunkel"] as const) {
    await page.evaluate((m) => localStorage.setItem("haben-modus", m), modus);
    await ohneAxeVerstoesse(page, ["/einstellungen?bereich=export", rechnung]);
  }
  await page.setViewportSize(HANDY);
  await gehe(page, rechnung);
  await expect(page.getByRole("link", { name: "Im Archiv öffnen" })).toBeVisible();
  const bilder = process.env.ABLAGE_BILDER;
  if (!bilder) return;
  // Nur lokal für den Pull Request: dieselben Ansichten wie vor der Änderung
  for (const modus of ["hell", "dunkel"] as const)
    for (const [groesse, viewport] of [
      ["desktop", LAPTOP],
      ["handy", HANDY],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.evaluate((m) => localStorage.setItem("haben-modus", m), modus);
      for (const [name, pfad] of [
        ["rechnung", rechnung],
        ["einstellungen-export", "/einstellungen?bereich=export"],
      ] as const) {
        await gehe(page, pfad);
        await page.screenshot({ path: `${bilder}/${name}-${modus}-${groesse}-nachher.png`, fullPage: true });
      }
    }
});
