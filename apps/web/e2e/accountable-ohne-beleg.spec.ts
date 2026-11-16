import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { databaseUrlFuer, portFuer } from "./durchlaeufe.ts";
import { fragenUeberspringen, gehe } from "./einrichtung.ts";

/**
 * Belege ohne Datei aus dem Accountable-Stapel (#1235, #1236): Eine Buchung ohne Beleg-GUID aus dem DATEV-Export lässt sich
 * in der Belegansicht bestätigen, obwohl sie keinen Verlauf hat. Eine Buchung mit GUID, deren Datei nur im Export fehlt,
 * bleibt gesperrt. Der Lauf und die Bestätigung laufen im selben Prozess wie der Test, deshalb eigene Wegwerf-Datenbank
 * (Projekt „accountable-ohne-beleg“, e2e/durchlaeufe.ts).
 */
test.describe.configure({ mode: "serial" });
let page: Page;

/** Export wie von Accountable: äußerer ZIP mit Buchungsstapel, Belege.zip und PDF-Ordner */
const KOPF = '"EXTF";700;21;"Buchungsstapel";9;20261110112213284;"";"AC";"Test";"";"9999999";"12345";20250101;4;"20250101";"20251231";"Accountable";"SW";1;';
const SPALTEN =
  "Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext;Beleglink";

const zeile = (betrag: string, gegen: string, bu: string, ttmm: string, nr: string, text: string, link = "") =>
  [betrag, "H", "EUR", "", betrag, "EUR", "1200", gegen, bu, ttmm, nr, `${ttmm}2025`, "", text, link].join(";");

const BUCHUNGEN = [
  // Ohne Beleglink: der Arbeitszimmer-Anteil, für den es keinen Einzelbeleg gibt
  zeile("41,98", "4210", "9", "0106", "01062025_4198", "ER Arbeitszimmer Miete"),
  // Mit GUID, Datei fehlt im Export: darf nicht bestätigt werden
  zeile("62,34", "4964", "9", "0106", "01062025_6234", "ER Nebenkosten Büro", '"BEDI ""guid-nebenkosten"""'),
];

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://xml.datev.de/bedi/tps/document/v04.0" generatingSystem="Accountable" version="4.0">
  <content>
    <document type="1" processID="1" guid="guid-nebenkosten">
      <extension xsi:type="File" name="fehlt-im-export.pdf"/>
    </document>
  </content>
</archive>`;

function exportZip(): Uint8Array {
  return zipSync({
    "datev_skr03_10112026/EXTF_Buchungsstapel_2025Test.csv": strToU8([KOPF, SPALTEN, ...BUCHUNGEN].join("\n")),
    "datev_skr03_10112026/Belege.zip": zipSync({ "document.xml": strToU8(XML) }),
    "PDF/Einkäufe/fehlt-im-export_Wdn.pdf": strToU8("%PDF-1.4 beleg"),
  });
}

/**
 * Konto anlegen wie in e2e/einrichtung.ts, aber mit Wiederholung: Der erste Klick auf „Konto anlegen“ geht gelegentlich
 * an der Hydration vorbei, dann passiert nichts und der Lauf hängt. Nach jedem Klick wird geprüft, ob der Schritt
 * weitergegangen ist.
 */
async function einrichten(page: Page): Promise<void> {
  await gehe(page, "/");
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel("Einrichtungscode").fill("e2e-einrichtungscode");
  await page.getByLabel("Name").fill("Max Mustermann");
  await page.getByLabel("E-Mail").fill("max@mustermann.example");
  await page.getByLabel(/Passwort/).fill("ein-langes-testpasswort-2026");

  const passkey = page.getByRole("button", { name: "Später" });
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Konto anlegen" }).click();
    // Entweder erscheint der Passkey-Schritt oder eine Fehlermeldung
    await Promise.race([
      passkey.waitFor({ state: "visible", timeout: 25_000 }),
      page.locator(".field-error").first().waitFor({ state: "visible", timeout: 25_000 }),
    ]).catch(() => undefined);
    const fehler = await page.locator(".field-error").allInnerTexts();
    if (fehler.length > 0) throw new Error(`Konto nicht angelegt: ${fehler.join(" / ")}`);
    if (await passkey.isVisible()) break;
  }
  if (!(await passkey.isVisible())) throw new Error("Der Passkey-Schritt ist nach drei Versuchen nicht erschienen.");
  await passkey.click();
  await fragenUeberspringen(page);

  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("Name", { exact: true }).fill("Mustermann IT · Max Mustermann");
  await firma.getByLabel("E-Mail", { exact: true }).fill("rechnung@mustermann.example");
  await firma.getByLabel("Straße und Hausnummer").fill("Musterstraße 12");
  await firma.getByLabel("PLZ").fill("93047");
  await firma.getByLabel("Ort").fill("Regensburg");
  await firma.getByLabel("Bundesland").selectOption("BY");
  await firma.getByLabel(/^Steuernummer/).fill("198/113/10010");
  await firma.getByLabel("IBAN").fill("DE89370400440532013000");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await einrichten(page);
  const url = databaseUrlFuer("accountable-ohne-beleg");
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("Eigene E2E-Datenbank fehlt.");
  Object.assign(process.env, {
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
    BETTER_AUTH_URL: `http://localhost:${portFuer("accountable-ohne-beleg")}`,
    HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    DOCUMENTS_DIR: `${process.env.E2E_DOCUMENTS_DIR ?? "test-results/e2e-belege"}-accountable-ohne-beleg`,
  });
  const { analyseAccountableUpload, startAccountableImport } = await import("../src/server/modules/archiv/index.ts");
  const bytes = exportZip();
  analyseAccountableUpload(bytes, "Accountable_Test_skr03_10112026.zip");
  await startAccountableImport("e2e-import", { wait: true });
});

test.afterAll(async () => {
  await page.context().close();
});

test("Buchung ohne Beleg-GUID lässt sich in der Belegansicht bestätigen", async () => {
  const { db, schema } = await import("../src/server/db/index.ts");
  const vouchers = await db
    .select({ id: schema.lexofficeVouchers.id, number: schema.lexofficeVouchers.number, raw: schema.lexofficeVouchers.raw })
    .from(schema.lexofficeVouchers);
  const ohneBeleg = vouchers.find((v) => v.raw.guid === null || v.raw.guid === undefined);
  if (!ohneBeleg) throw new Error("Der Lauf hat keine Buchung ohne Beleg-GUID abgelegt.");

  await gehe(page, `/archiv/beleg/${ohneBeleg.id}`);
  const karte = page.getByRole("region", { name: "Dateistand" });
  // Ohne Verlauf: die Karte erscheint allein wegen der Bestätigung
  await expect(karte).toContainText("Buchung ohne Beleg");
  await expect(karte.getByLabel("Was du geprüft hast")).toBeVisible();
  await karte.getByLabel("Was du geprüft hast").fill("Kein Einzelbeleg vorhanden, Arbeitszimmeranteil");
  await karte.getByRole("button", { name: "Buchung ohne Beleg bestätigen" }).click();
  const dialog = page.getByRole("dialog", { name: "Beleg ohne Datei bestätigen?" });
  await expect(dialog).toContainText("keinen Einzelbeleg");
  await dialog.getByRole("button", { name: "Ohne Datei bestätigen" }).click();
  await expect(karte).toContainText("ohne Datei, bestätigt");
  await expect(karte.getByRole("button", { name: "Buchung ohne Beleg bestätigen" })).toHaveCount(0);

  // Der Verlauf hält fest, wer bestätigt hat und was geprüft wurde
  const [zeile] = await db
    .select({ state: schema.legacyFileStates.state, message: schema.legacyFileStates.message })
    .from(schema.legacyFileStates)
    .where(eq(schema.legacyFileStates.voucherId, ohneBeleg.id));
  expect(zeile?.state).toBe("bestaetigt_ohne_datei");
  expect(zeile?.message).toContain("Arbeitszimmeranteil");
});

test("Buchung mit Beleg-GUID bleibt ohne Bestätigung", async () => {
  const { db, schema } = await import("../src/server/db/index.ts");
  const vouchers = await db
    .select({ id: schema.lexofficeVouchers.id, number: schema.lexofficeVouchers.number, raw: schema.lexofficeVouchers.raw })
    .from(schema.lexofficeVouchers);
  const mitGuid = vouchers.find((v) => typeof v.raw.guid === "string" && v.raw.guid.length > 0);
  if (!mitGuid) throw new Error("Der Lauf hat keine Buchung mit Beleg-GUID abgelegt.");

  await gehe(page, `/archiv/beleg/${mitGuid.id}`);
  // Ohne Verlauf und ohne Bestätigung gibt es keine Karte; der Knopf darf also nirgends stehen
  await expect(page.getByRole("region", { name: "Dateistand" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /ohne (Datei|Beleg) bestätigen/ })).toHaveCount(0);

  // Und der Server lehnt es ab, wenn es doch jemand versucht: hier kann ein Einzelbeleg existieren
  const dateistand = await import("../src/server/modules/archiv/dateistand.ts");
  await expect(dateistand.confirmWithoutFile("e2e-import", mitGuid.id, "Prüfung im Test")).rejects.toThrow("Beleg-GUID");
});
