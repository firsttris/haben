import { expect, test, type Browser, type Page } from "@playwright/test";
import { receiptJpeg } from "./belegbild.ts";
import { currentYear } from "./daten.ts";
import { databaseUrlFuer, portFuer } from "./durchlaeufe.ts";
import { kontaktAnlegen, einrichten, rechnungFestschreiben } from "./einrichtung.ts";

/*
 * Was aus früheren Jahren noch offen ist (#1110): Die Tabellen der offenen Posten zeigen den Stand von heute,
 * unabhängig vom gewählten Jahr. Über der Tabelle steht, wie viele Posten aus früheren Jahren stammen, und die
 * Spalte „Jahr“ kennzeichnet sie. Am Handy gibt es die Spalte nicht, dort hängt der Vermerk an der Fälligkeit.
 * Beide Tabellen rechnen für sich (auswertungen.tsx): offene Forderungen aus Rechnungen, offene Verbindlichkeiten
 * aus gebuchten Belegen, die über die Bank zu zahlen sind. Eigener Durchlauf, damit die Belege und Rechnungen aus
 * dem Vorjahr nicht die Zahlen der übrigen Tests verschieben.
 */

test.describe.configure({ mode: "serial" });

const CUSTOMER = { name: "Klintwerk Digital GmbH", street: "Werkstraße 8", zip: "24103", city: "Kiel" };
const JAHR = currentYear();
const KUNDE = `${CUSTOMER.name} · ${CUSTOMER.city}`;
/** Lieferant eines Belegs, der aus dem Vorjahr noch offen ist */
const LIEFERANT = "Hafenwerft Druck GmbH";
/** Das Jahr, aus dem der Beleg stammt */
const BELEG_JAHR = JAHR - 1;
const BELEG_DATUM = `${BELEG_JAHR}-09-15`;
/** Netto und Steuer des Belegs; 297,50 € brutto steht in keiner anderen Zeile der Seite */
const BELEG = { net: 25_000, tax: 4_750, brutto: "297,50" };
/** Der Vorgang, unter dem die Servermodule buchen (GoBD-Trigger, wie in beleg-storno.spec.ts) */
const ACTOR = "e2e-vorjahre";
const THEMES = ["light", "dark"] as const;
const BREITEN = {
  desktop: { width: 1440, height: 900 },
  handy: { width: 390, height: 844 },
} as const;

let page: Page;
let closeDatabase: (() => Promise<void>) | undefined;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin", viewport: BREITEN.desktop })).newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await einrichten(page);
  await kontaktAnlegen(page, CUSTOMER);
  // Zwei Rechnungen aus früheren Jahren, beide ohne Zahlung: eine aus dem Vorjahr, eine aus dem Jahr davor
  await rechnungFestschreiben(page, { customer: KUNDE, date: `${JAHR - 1}-06-03`, lines: [["Wartung Altjahr", "1", "100,00"]], gross: "119,00" });
  await rechnungFestschreiben(page, { customer: KUNDE, date: `${JAHR - 2}-11-30`, lines: [["Lizenz Altjahr", "1", "200,00"]], gross: "238,00" });
  // Ein gebuchter, noch nicht bezahlter Beleg aus dem Vorjahr: er zählt in der zweiten Tabelle, nicht in der ersten
  await belegAusVorjahr(browser);
});

test.afterAll(async () => {
  await closeDatabase?.();
  await page?.context().close();
  expect(errors).toEqual([]);
});

/**
 * Beleg aus einem früheren Jahr anlegen, buchen und offen lassen. Über die Oberfläche wären das Upload, Beträge,
 * Speichern und „Bestätigen und buchen“; die offene Verbindlichkeit entsteht so genauso, ohne Direkt-SQL auf
 * documents, bank_transactions oder das Journal (GoBD-Trigger). Vorbild ist beleg-storno.spec.ts: erst die
 * Umgebung der eigenen Datenbank, dann die Servermodule dynamisch laden, damit sie sie benutzen.
 */
async function belegAusVorjahr(browser: Browser): Promise<void> {
  const url = databaseUrlFuer("vorjahre");
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("Eigene E2E-Datenbank fehlt.");
  Object.assign(process.env, {
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
    BETTER_AUTH_URL: `http://localhost:${portFuer("vorjahre")}`,
    HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    DOCUMENTS_DIR: `${process.env.E2E_DOCUMENTS_DIR ?? "test-results/e2e-belege"}-vorjahre`,
  });
  const documents = await import("../src/server/modules/belege/index.ts");
  const { id } = await documents.uploadDocument(ACTOR, { bytes: await receiptJpeg(browser, LIEFERANT), filename: "vorjahr.jpg" });
  await documents.updateDocument(ACTOR, id, {
    supplierName: LIEFERANT,
    supplierUstId: "",
    invoiceNumber: "V-4711",
    documentDate: BELEG_DATUM,
    dueDate: null,
    category: "software",
    // „Bank“ macht den Beleg zur Verbindlichkeit; gebucht und ohne Zuordnung bleibt er offen
    payment: "bank",
    note: "",
    amounts: [{ taxRate: 1900, net: BELEG.net, tax: BELEG.tax }],
  });
  await documents.bookDocument(ACTOR, id);
  closeDatabase = (await import("../src/server/db/index.ts")).closeDatabase;
}

const forderungen = (p: Page) => p.getByRole("region", { name: "Offene Forderungen", exact: true });
const verbindlichkeiten = (p: Page) => p.getByRole("region", { name: "Offene Verbindlichkeiten", exact: true });
const zeile = (p: Page, jahr: number) =>
  forderungen(p)
    .getByRole("row")
    .filter({ has: p.locator("td.jahr", { hasText: String(jahr) }) });
const verbindlichkeit = (p: Page) =>
  verbindlichkeiten(p)
    .getByRole("row")
    .filter({ has: p.locator("td.jahr", { hasText: String(BELEG_JAHR) }) });

for (const theme of THEMES) {
  for (const [geraet, viewport] of Object.entries(BREITEN)) {
    test(`${theme}, ${geraet}: Vorjahresposten sind über der Tabelle gezählt und in der Zeile gekennzeichnet`, async () => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/auswertungen?jahr=${JAHR}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(`Auswertungen ${JAHR}`);

      // Die Zeile über der Tabelle nennt Zahl und Betrag, die Tabellen selbst bleiben beim Stand von heute
      const hinweis = forderungen(page).getByText(/offene[rn]? Posten? aus (einem |früheren )/);
      await expect(hinweis).toBeVisible();
      await expect(hinweis).toContainText("2 offene Posten aus früheren Jahren");
      await expect(hinweis).toContainText("357,00");

      for (const jahr of [JAHR - 1, JAHR - 2]) {
        await expect(zeile(page, jahr)).toHaveCount(1);
        if (geraet === "desktop") {
          // Die Spalte „Jahr“ trägt das Jahr des Postens und hebt das Vorjahr hervor
          await expect(zeile(page, jahr).locator("td.jahr")).toHaveText(String(jahr));
          await expect(zeile(page, jahr).locator("td.jahr")).toHaveClass(/vorjahr/);
        } else {
          // Am Handy fehlt die Spalte; der Vermerk steht sichtbar an der Fälligkeit (toContainText sähe auch Verstecktes)
          await expect(zeile(page, jahr).locator("td.jahr")).toBeHidden();
          await expect(zeile(page, jahr).locator(".vorjahr-handy")).toBeVisible();
          await expect(zeile(page, jahr).locator(".vorjahr-handy")).toContainText(`aus ${jahr}`);
        }
      }

      // Die zweite Tabelle zählt und summiert für sich: der gebuchte, unbezahlte Beleg aus dem Vorjahr
      const hinweisBelege = verbindlichkeiten(page).getByText(/offene[rn]? Posten? aus (einem |früheren )/);
      await expect(hinweisBelege).toBeVisible();
      await expect(hinweisBelege).toContainText("1 offener Posten aus einem früheren Jahr");
      await expect(hinweisBelege).toContainText(BELEG.brutto);

      const zeileBeleg = verbindlichkeit(page);
      await expect(zeileBeleg).toHaveCount(1);
      await expect(zeileBeleg).toContainText(LIEFERANT);
      await expect(zeileBeleg).toContainText(BELEG.brutto);
      if (geraet === "desktop") {
        // Auch hier trägt die Spalte „Jahr“ das Jahr des Belegs; der Vermerk an der Fälligkeit bleibt dem Handy
        await expect(zeileBeleg.locator("td.jahr")).toHaveText(String(BELEG_JAHR));
        await expect(zeileBeleg.locator("td.jahr")).toHaveClass(/vorjahr/);
        await expect(zeileBeleg.locator(".vorjahr-handy")).toBeHidden();
      } else {
        // Ohne die Spalte „Jahr“ hängt der Vermerk an der Fälligkeit
        await expect(zeileBeleg.locator("td.jahr")).toBeHidden();
        await expect(zeileBeleg.locator(".vorjahr-handy")).toBeVisible();
        await expect(zeileBeleg.locator(".vorjahr-handy")).toContainText(`aus ${BELEG_JAHR}`);
      }

      // Nichts ist abgeschnitten, auch nicht am schmalen Handy
      const ueberstand = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ueberstand, "waagerechter Überstand").toBeLessThanOrEqual(0);
    });
  }
}

test("Ohne Vorjahresposten steht die Zeile nicht da", async () => {
  await page.setViewportSize(BREITEN.desktop);
  await page.emulateMedia({ colorScheme: "light" });
  // Im Jahr davor gibt es nur den Posten aus dem Jahr davor: für 2025 ist nichts vor 2025 offen
  await page.goto(`/auswertungen?jahr=${JAHR - 2}`);
  await page.waitForLoadState("networkidle");
  await expect(forderungen(page).getByText(/Posten? aus einem früheren Jahr|Posten aus früheren Jahren/)).toHaveCount(0);
  // Der Beleg aus dem Vorjahr ist an diesem Stichtag nicht aus einem früheren Jahr
  await expect(verbindlichkeiten(page).getByText(/Posten? aus einem früheren Jahr|Posten aus früheren Jahren/)).toHaveCount(0);
});

/*
 * Der Schalter „Heute“ / „31.12.“ (#1110, Schritt 2): Er steht für ein vergangenes Jahr in der Jahresleiste, der Stand
 * steht in der Adresse, und ein Wechsel des Jahres nimmt ihn mit — eine Ansicht zeigt durchgehend denselben Tag.
 * Ob Zahlungen nach dem Stichtag zurückgerechnet werden, prüft stichtag-offene-posten.test.ts an der Datenbank;
 * hier geht es um die Bedienung und die Adresse.
 */
test("Der Stichtag 31.12. steht in der Adresse und bleibt beim Jahreswechsel", async () => {
  await page.setViewportSize(BREITEN.desktop);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/auswertungen?jahr=${BELEG_JAHR}`);
  await page.waitForLoadState("networkidle");

  const schalter = page.getByRole("group", { name: "Stand der offenen Posten" });
  const heute = schalter.getByRole("link", { name: "Heute", exact: true });
  const jahresende = schalter.getByRole("link", { name: `31.12.${BELEG_JAHR}`, exact: true });
  await expect(schalter).toBeVisible();
  await expect(heute).toHaveAttribute("aria-current", "page");
  expect(await jahresende.getAttribute("aria-current")).toBeNull();

  await jahresende.click();
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).searchParams.get("stichtag")).toBe("31.12.");
  await expect(jahresende).toHaveAttribute("aria-current", "page");
  expect(await heute.getAttribute("aria-current")).toBeNull();
  await expect(page.getByText(`Stand 31.12.${BELEG_JAHR}: die offenen Posten`, { exact: false })).toBeVisible();

  // Der Abschlussstand zeigt dieselben Posten: am 31.12. waren Rechnung und Beleg noch offen
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`Auswertungen ${BELEG_JAHR}`);
  await expect(zeile(page, BELEG_JAHR)).toHaveCount(1);
  await expect(verbindlichkeit(page)).toHaveCount(1);

  // Ein anderes Jahr erbt den Stichtag; im laufenden Jahr gibt es den Schalter nicht
  await page
    .getByRole("navigation", { name: "Jahr wählen" })
    .getByRole("link", { name: String(BELEG_JAHR - 1), exact: true })
    .click();
  await page.waitForLoadState("networkidle");
  const adresse = new URL(page.url());
  expect(adresse.searchParams.get("jahr")).toBe(String(BELEG_JAHR - 1));
  expect(adresse.searchParams.get("stichtag")).toBe("31.12.");

  await page.goto(`/auswertungen?jahr=${JAHR}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("group", { name: "Stand der offenen Posten" })).toHaveCount(0);
});
