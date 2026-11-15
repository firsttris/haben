import { createCipheriv, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { zipSync } from "fflate";
import postgres from "postgres";
import { databaseUrlFuer } from "./durchlaeufe.ts";
import { bestaetigen, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/**
 * Umzug aus FastBill: verbundener Zugang, Ausgaben, deren Beleg FastBill nur im Browser herausgibt, Skript kopieren, ZIP
 * hochladen und den Rest ohne Beleg freigeben, in eigener, leerer Datenbank (Projekt „fastbill-import“, e2e/durchlaeufe.ts).
 * Den Abruf über die API prüfen die Postgres-Tests in modules/archiv; hier stellt die Datenbank seinen Stand nach, damit kein
 * Test eine Adresse von FastBill aufruft.
 */
const URL_8101 = "https://my.fastbill.com/download/beleg-8101";
const URL_8102 = "https://my.fastbill.com/download/beleg-8102";
const PDF = Buffer.from("%PDF-1.4\n% Beleg Software\n%%EOF\n");

/** Wie apps/web/src/server/crypto.ts (AES-256-GCM, IV | Tag | Chiffrat) mit dem Schlüssel aus playwright.config.ts */
function verschluesseln(text: string): Buffer {
  const key = Buffer.from(process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"), "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

async function abrufNachstellen() {
  const sql = postgres(databaseUrlFuer("fastbill-import"), { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'e2e', true)`;
      await tx`insert into fastbill_connection (id, email, ciphertext, calls_per_hour)
        values (1, 'inhaber@example.de', ${verschluesseln("0123456789abcdef0123456789abcdef")}, 500)`;
      await tx`insert into lexoffice_imports (source, status, progress, finished_at) values ('fastbill', 'fertig',
        '{"phase":"fertig","contacts":0,"contactsLinked":0,"listed":2,"imported":0,"skipped":0,"files":0,"failed":[],"fastbillWaiting":2}', now())`;
      await tx`insert into fastbill_receipts (expense_id, status, number, date, supplier, gross, ciphertext) values
        ('8101', 'wartet', 'L-881', '2024-02-15', 'Software Beispiel', 595, ${verschluesseln(URL_8101)}),
        ('8102', 'wartet', 'L-882', '2024-03-01', 'Hosting Beispiel', 1190, ${verschluesseln(URL_8102)})`;
    });
  } finally {
    await sql.end();
  }
}

test("FastBill: wartende Ausgabenbelege per Skript nachreichen oder ohne Beleg freigeben", async ({ browser }) => {
  const { page, pageErrors } = await durchlaufSeite(browser);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await einrichten(page);
  await abrufNachstellen();
  await gehe(page, "/archiv");

  await expect(page.getByRole("button", { name: "Umzug aus FastBill", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Verbunden mit inhaber@example.de")).toBeVisible();
  await expect(page.getByText(/Tarif Pro, 500 Anfragen pro Stunde/)).toBeVisible();
  // Solange Ausgaben auf ihren Beleg warten, ist das Jahr nicht vollständig
  const jahr = page.getByRole("region", { name: "Geschäftsjahr 2024" });
  await expect(jahr).toContainText("Keine Ausgabe wartet auf ihren Beleg");
  await expect(jahr).toContainText("2 Ausgaben aus FastBill warten");

  const kasten = page.getByRole("region", { name: "Belege, die FastBill nur im Browser herausgibt" });
  await expect(kasten.locator(".progress-facts")).toContainText("warten auf Beleg2");
  // Das Skript bekommt die entschlüsselten Download-Adressen der wartenden Ausgaben eingesetzt
  await kasten.getByRole("button", { name: "Skript kopieren" }).click();
  await expect(kasten.getByRole("button", { name: "Kopiert" })).toBeVisible();
  const skript = await page.evaluate(() => navigator.clipboard.readText());
  expect(skript).toContain(
    JSON.stringify([
      { id: "8101", url: URL_8101 },
      { id: "8102", url: URL_8102 },
    ]),
  );
  expect(skript).toContain('location.hostname !== "my.fastbill.com"');

  // ZIP aus dem Skript: der Beleg zu 8101, dazu einer zu einer Ausgabe, die nicht wartet
  const manifest = Buffer.from(JSON.stringify({ format: "haben-fastbill-belege", version: 1 }));
  const zip = Buffer.from(zipSync({ "manifest.json": manifest, "belege/8101.pdf": PDF, "belege/9999.pdf": PDF }));
  await kasten.getByLabel("Belege aus dem Skript (ZIP)").setInputFiles({ name: "haben-fastbill-belege-1.zip", mimeType: "application/zip", buffer: zip });
  await kasten.getByRole("button", { name: "Hochladen" }).click();
  await expect(kasten.getByText(/1 Belege zugeordnet\..*1 gehörten zu keiner wartenden Ausgabe\./)).toBeVisible();
  await expect(kasten.locator(".progress-facts")).toContainText("Beleg bereit1");

  await kasten.getByRole("button", { name: "Rest ohne Beleg übernehmen" }).click();
  await bestaetigen(page, "Ohne Beleg übernehmen");
  await expect(kasten.locator(".progress-facts")).toContainText("ohne Beleg1");
  await expect(kasten.getByRole("button", { name: "Skript kopieren" })).toHaveCount(0);
  // Wartet keine Ausgabe mehr, muss der Kasten weiter sagen, dass erst „Erneut abrufen“ die Ausgaben ins Archiv bringt
  await expect(kasten.getByRole("status")).toContainText("2 Ausgaben kommen beim nächsten Abruf ins Archiv: Starte in Schritt 2 „Erneut abrufen“.");
  expect(pageErrors).toEqual([]);
});
