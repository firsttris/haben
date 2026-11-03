import { type BrowserContext, chromium, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * Die gebaute Erweiterung „Haben für Mein ELSTER“ (apps/elster-helfer/dist) in Chromium: Werte im Popup übernehmen,
 * dann trägt das Inhaltsskript sie auf einer nachgebauten Formularseite unter der Adresse von Mein ELSTER ein. Prüft,
 * was elster-helfer.spec.ts nicht kann: dass Manifest, Bündel und Chrome-APIs zusammen funktionieren.
 */

const PROJEKT = fileURLToPath(new URL("../../elster-helfer", import.meta.url));
const DIST = `${PROJEKT}/dist`;

/** Chrome leitet die ID einer entpackten Erweiterung aus ihrem absoluten Pfad ab: SHA-256, Ziffern 0–f als a–p */
function erweiterungsId(pfad: string): string {
  const hex = createHash("sha256").update(pfad).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join("");
}

const WERTE = {
  format: "haben-mein-elster",
  version: 1,
  formular: "euer",
  jahr: 2025,
  zeitraum: null,
  personen: null,
  erstellt: "2026-11-03T10:00:00.000Z",
  felder: [
    { kennung: "E6000401", wert: "80000,00", pfad: ["E77", "BEin"], zeile: null, person: null },
    { kennung: "E6007202", wert: "82770,00", pfad: ["E77", "Gewinn"], zeile: null, person: null },
  ],
};

const SEITE = `<!doctype html><html lang="de"><body><main>
  <label for="a">Umsatzsteuerpflichtige Betriebseinnahmen (Euro, Cent)</label>
  <input id="a" name="fields[eruEUERBEinUSt_StPflichtSumE6000401]">
</main></body></html>`;

// Der zweite Test nutzt die Werte, die der erste im Popup übernimmt: ein Browser, der Reihe nach
test.describe.configure({ mode: "serial" });

let context: BrowserContext;

test.beforeAll(async () => {
  execFileSync(process.execPath, ["run", "build"], { cwd: PROJEKT, stdio: "ignore" });
  // Erweiterungen laufen nur im vollen Chromium, nicht in der Headless-Shell
  const browser = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chromium" };
  context = await chromium.launchPersistentContext("", {
    ...browser,
    headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
});

test.afterAll(async () => {
  await context?.close();
});

test("Werte im Popup übernehmen, das Inhaltsskript trägt sie in Mein ELSTER ein", async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${erweiterungsId(DIST)}/popup.html`);
  await expect(popup.getByRole("heading", { name: "Haben für Mein ELSTER" })).toBeVisible();
  await expect(popup.getByRole("status")).toHaveText("Keine Werte geladen.");

  await popup.getByLabel("Werte aus Haben").fill(JSON.stringify(WERTE));
  await popup.getByRole("button", { name: "Werte übernehmen" }).click();
  await expect(popup.getByRole("status")).toHaveText("Geladen: Anlage EÜR 2025, 2 Werte. In Mein ELSTER das Formular öffnen.");

  const seite = await context.newPage();
  await seite.route("https://www.elster.de/**", (route) => route.fulfill({ contentType: "text/html", body: SEITE }));
  await seite.goto("https://www.elster.de/eportal/interpreter/eingabe/euer-2025/seite1");

  await expect(seite.getByLabel("Umsatzsteuerpflichtige Betriebseinnahmen (Euro, Cent)")).toHaveValue("80000,00");
  const leiste = seite.getByRole("complementary", { name: "Haben für Mein ELSTER" });
  await expect(leiste).toContainText("EUER 2025: 1 eingetragen, 1 noch auf anderen Seiten.");
});

test("auf einem anderen Formular trägt sie nichts ein", async () => {
  const seite = await context.newPage();
  await seite.route("https://www.elster.de/**", (route) => route.fulfill({ contentType: "text/html", body: SEITE }));
  await seite.goto("https://www.elster.de/eportal/interpreter/eingabe/ust-2025/seite1");

  await expect(seite.getByRole("complementary", { name: "Haben für Mein ELSTER" })).toContainText(
    "Geladen sind Werte für EUER 2025, dies ist UST 2025. Nichts eingetragen.",
  );
  await expect(seite.getByLabel("Umsatzsteuerpflichtige Betriebseinnahmen (Euro, Cent)")).toHaveValue("");
});
