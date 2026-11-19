import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import postgres from "postgres";
import { currentDay, day } from "./daten.ts";
import { databaseUrlFuer, portFuer } from "./durchlaeufe.ts";
import { einrichten } from "./einrichtung.ts";
import { kategorieName } from "./kategorie.ts";

/** Beleg und zugeordnete Bankzahlung in eigener Datenbank; der Storno läuft durch die echte Oberfläche (#653). */
test.describe.configure({ mode: "serial" });
let page: Page;
let sql: ReturnType<typeof postgres>;
let closeDatabase: () => Promise<void>;
let documentId: string;
let transactionId: string;
let originalDocument: unknown;
let originalTransaction: unknown;
let unpaidDocumentId: string;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await einrichten(page);
  const url = databaseUrlFuer("beleg-storno");
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("Eigene E2E-Datenbank fehlt.");
  Object.assign(process.env, {
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
    BETTER_AUTH_URL: `http://localhost:${portFuer("beleg-storno")}`,
    HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    DOCUMENTS_DIR: `${process.env.E2E_DOCUMENTS_DIR ?? "test-results/e2e-belege"}-beleg-storno`,
  });
  sql = postgres(url, { max: 1, onnotice: () => {} });
  const bank = await import("../src/server/modules/bank/index.ts");
  documentId = await receipt(browser, "Codewerk Lizenzen GmbH", "L-4711");
  unpaidDocumentId = await receipt(browser, "Nordlicht Software GmbH", "B-4712");
  transactionId = await transaction("-119,00", "L-4711");
  await bank.allocate("e2e-storno", { kind: "document", transactionId, documentId, amount: -11_900 });
  [originalDocument] = await sql`select * from documents where id = ${documentId}`;
  [originalTransaction] = await sql`select * from bank_transactions where id = ${transactionId}`;
  closeDatabase = (await import("../src/server/db/index.ts")).closeDatabase;
});

async function receipt(browser: Browser, supplier: string, number: string, date = currentDay(), book = true, category = "software") {
  const documents = await import("../src/server/modules/belege/index.ts");
  const image = await browser.newPage({ viewport: { width: 620, height: 400 } });
  await image.setContent(`<body style="font: 16px sans-serif; padding: 32px"><h2>${supplier}</h2>
    <p>Rechnung ${number} · ${currentDay()}</p><p>Softwarelizenz 100,00 €</p><p>Umsatzsteuer 19 %: 19,00 €</p>
    <p><strong>Gesamt 119,00 €</strong></p></body>`);
  const bytes = await image.screenshot({ type: "jpeg", quality: 80 });
  await image.close();
  const { id } = await documents.uploadDocument("e2e-storno", { bytes, filename: `${number}.jpg` });
  await documents.updateDocument("e2e-storno", id, {
    supplierName: supplier,
    supplierUstId: "",
    invoiceNumber: number,
    documentDate: date,
    dueDate: null,
    category,
    payment: "bank",
    note: "",
    amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
  });
  if (book) await documents.bookDocument("e2e-storno", id);
  return id;
}

async function transaction(amount: string, purpose: string): Promise<string> {
  const bank = await import("../src/server/modules/bank/index.ts");
  const date = currentDay();
  const day = `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
  const csv =
    `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `"${day}";"${day}";"Gebucht";"Mustermann IT";"Codewerk Lizenzen GmbH";"${purpose}";"Ausgang";"DE02100100100006820101";"${amount}";"";"";""\n`;
  await bank.importStatement("e2e-storno", { bytes: new TextEncoder().encode(csv), filename: `${purpose}.csv` }, null);
  return (await sql`select id from bank_transactions where purpose = ${purpose}`)[0]!.id;
}

test.afterAll(async () => {
  await sql?.end();
  await closeDatabase?.();
  await page?.context().close();
  expect(errors).toEqual([]);
});

test("Beleg speichern, dann „Bestätigen und buchen“: der Dialog bleibt nach dem Neuladen offen", async ({ browser }) => {
  const id = await receipt(browser, "Review Flake GmbH", "R-1", currentDay(), false);
  await page.goto(`/belege/${id}`);
  await page.waitForLoadState("networkidle");
  let neuGeladen = false;
  const ladeBeleg = (url: URL) => url.pathname.startsWith("/_serverFn/") && decodeURIComponent(url.search).includes(id);
  await page.route(ladeBeleg, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((fertig) => setTimeout(fertig, 1500));
    const antwort = await route.fetch();
    neuGeladen = true;
    await route.fulfill({ response: antwort });
  });
  await page.getByLabel("Rechnungsnummer").fill("R-2");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.getByRole("button", { name: "Bestätigen und buchen", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Buchen", exact: true })).toBeVisible();
  await expect.poll(() => neuGeladen).toBe(true);
  await page.waitForTimeout(1000);
  await expect(dialog.getByRole("button", { name: "Buchen", exact: true })).toBeVisible();
  await page.unroute(ladeBeleg);
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
});

test("Bankzuordnung im Stornodialog bestätigen und zusammen mit dem Beleg zurücknehmen", async () => {
  await page.goto(`/belege/${documentId}`);
  await expect(page.locator(".page-head").getByText("Gebucht", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Beleg stornieren", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Beleg stornieren?" });
  await expect(dialog).toBeVisible();
  const explanation = await dialog.textContent();
  await expect(dialog).toContainText("zum ursprünglichen Buchungsdatum");
  await expect(dialog).toContainText("neu berechneten Werte früherer Zeiträume");
  await expect(dialog).toContainText("berichtigte Anmeldung");
  // Vorher/Nachher mit denselben echten Testdaten und demselben Ablauf, nur auf ausdrücklichen Screenshot-Aufruf.
  const phase = process.env.STORNO_SCREENSHOTS;
  if (phase) {
    await mkdir("test-results/storno-bilder", { recursive: true });
    for (const theme of ["light", "dark"])
      for (const [device, viewport] of [
        ["desktop", { width: 1440, height: 900 }],
        ["handy", { width: 390, height: 844 }],
      ] as const) {
        await page.setViewportSize(viewport);
        await page.evaluate((t) => {
          document.documentElement.dataset.mode = t;
        }, theme);
        await dialog.screenshot({ path: `test-results/storno-bilder/storno-${theme}-${device}-${phase}.png` });
      }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      document.documentElement.dataset.mode = "light";
    });
  }
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect((await sql`select id from document_cancellations where document_id = ${documentId}`).length).toBe(0);
  expect(Number((await sql`select sum(amount) as amount from allocations where document_id = ${documentId}`)[0]!.amount)).toBe(-11_900);

  await page.getByRole("button", { name: "Beleg stornieren", exact: true }).click();
  await dialog.getByRole("button", { name: /Stornieren/ }).click();
  await expect(page.locator(".page-head").getByText("Storniert", { exact: true })).toBeVisible();
  expect(explanation).toContain("Bankzuordnung");
  expect(Number((await sql`select sum(amount) as amount from allocations where document_id = ${documentId}`)[0]!.amount)).toBe(0);
  expect((await sql`select id from document_cancellations where document_id = ${documentId}`).length).toBe(1);
  expect((await sql`select * from documents where id = ${documentId}`)[0]).toEqual(originalDocument);
  expect((await sql`select * from bank_transactions where id = ${transactionId}`)[0]).toEqual(originalTransaction);
  await page.reload();
  await expect(page.locator(".page-head").getByText("Storniert", { exact: true })).toBeVisible();
  expect((await sql`select id from document_cancellations where document_id = ${documentId}`).length).toBe(1);
  await page.getByRole("link", { name: "Gegenbuchung", exact: true }).click();
  await expect(page.getByText(/Storno: Beleg L-4711/)).toBeVisible();
});

test("gebuchter Beleg erklärt die Aufteilung über Storno, ein stornierter nicht mehr (#1112)", async () => {
  await page.goto(`/belege/${unpaidDocumentId}`);
  await expect(page.getByText("Die Aufteilung auf mehrere Kategorien geht vor dem Buchen.")).toBeVisible();
  // Der Beleg aus dem ersten Test ist storniert: Er lässt sich nicht noch einmal stornieren, der Weg ist die Neuerfassung
  await page.goto(`/belege/${documentId}`);
  await expect(page.locator(".page-head").getByText("Storniert", { exact: true })).toBeVisible();
  await expect(page.getByText(/lässt sich stornieren/)).toHaveCount(0);
});

test("gebuchtes Anlagegut verspricht keinen Storno zum Aufteilen", async ({ browser }) => {
  // Anlagegüter lassen sich weder stornieren noch aufteilen (docs/belege.md, „Nicht stornieren lassen sich“)
  const documents = await import("../src/server/modules/belege/index.ts");
  const image = await browser.newPage({ viewport: { width: 620, height: 400 } });
  await image.setContent(`<body style="font: 16px sans-serif; padding: 32px"><h2>Rechenwerk Hardware</h2><p>Notebook 1.000,00 €</p></body>`);
  const bytes = await image.screenshot({ type: "jpeg", quality: 80 });
  await image.close();
  const { id } = await documents.uploadDocument("e2e-storno", { bytes, filename: "A-900.jpg" });
  await documents.updateDocument("e2e-storno", id, {
    supplierName: "Rechenwerk Hardware",
    supplierUstId: "",
    invoiceNumber: "A-900",
    documentDate: currentDay(),
    dueDate: null,
    category: "anlage",
    asset: { name: "Notebook", kind: "edv", method: "digital", usefulLifeMonths: null },
    payment: "bank",
    note: "",
    amounts: [{ taxRate: 1900, net: 100_000, tax: 19_000 }],
  });
  await documents.bookDocument("e2e-storno", id);
  await page.goto(`/belege/${id}`);
  await expect(page.getByText("Belege zu Anlagegütern lassen sich nicht stornieren.", { exact: false })).toBeVisible();
  await expect(page.getByText(/lässt sich stornieren/)).toHaveCount(0);
});

test("Beleg duplizieren: neue Datei mit den Feldern des Originals und Datum heute, dieselbe Datei kein zweites Mal (#1295)", async ({ browser }) => {
  // Vor dem Abschluss des Jahres weiter unten, damit das Original gebucht ist
  const original = await receipt(browser, "Papierhaus Petersen", "P-1101", day(-10));
  const bild = await browser.newPage({ viewport: { width: 620, height: 400 } });
  await bild.setContent(`<body style="font: 16px sans-serif; padding: 32px"><h2>Papierhaus Petersen</h2><p>Rechnung P-1102</p><p>Gesamt 119,00 €</p></body>`);
  const datei = { name: "P-1102.jpg", mimeType: "image/jpeg", buffer: await bild.screenshot({ type: "jpeg", quality: 80 }) };
  await bild.close();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/belege/${original}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Datei für das Duplikat").setInputFiles(datei);

  await expect(page).toHaveURL(/dupliziert=/);
  const kopie = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(kopie).not.toBe(original);
  await expect(page.getByText(/^Dupliziert aus einem früheren Beleg/)).toBeVisible();
  await expect(page.getByLabel("Lieferant", { exact: true })).toHaveValue("Papierhaus Petersen");
  await expect(page.getByLabel("Rechnungsnummer", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Belegdatum", { exact: true })).toHaveValue(currentDay());
  await expect(page.getByLabel("Kategorie", { exact: true })).toHaveValue(kategorieName("software"));
  const [neu] =
    await sql`select filename, status, gross, sha256 = (select sha256 from documents where id = ${original}) as gleiche_datei from documents where id = ${kopie}`;
  expect(neu).toEqual({ filename: "P-1102.jpg", status: "neu", gross: 11_900, gleiche_datei: false });

  // Zurück zum Original und dieselbe Datei noch einmal: Haben zeigt den vorhandenen Entwurf statt eines zweiten
  await page.getByRole("link", { name: "früheren Beleg", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/belege/${original}$`));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Datei für das Duplikat").setInputFiles(datei);
  await expect(page).toHaveURL(new RegExp(`/belege/${kopie}\\?vorhanden=true`));
  await expect(page.getByText("Die gewählte Datei liegt schon in Haben; das ist ihr Beleg, dupliziert wurde nichts.")).toBeVisible();
  expect((await sql`select count(*)::int as n from documents where supplier_name = 'Papierhaus Petersen'`)[0]!.n).toBe(2);
});

test("Belegliste: Status sortiert nach dem angezeigten Status, Storniert und Gebucht stehen je für sich", async ({ browser }) => {
  // Vor dem Abschluss des Jahres weiter unten. Ein stornierter Beleg bleibt im Code „gebucht“; listDocuments liefert bei
  // gleichem Datum den zuletzt hochgeladenen zuerst, hier also Gebucht, Storniert, Gebucht
  const documents = await import("../src/server/modules/belege/index.ts");
  await receipt(browser, "Statuswerk Erster", "ST-1");
  const storniert = await receipt(browser, "Statuswerk Zweiter", "ST-2");
  await documents.cancelDocument("e2e-storno", storniert, { reason: "", allocationIds: [] }, currentDay());
  await receipt(browser, "Statuswerk Dritter", "ST-3");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/belege?sort=status&dir=auf");
  const zeilen = page.locator("a.table-row.document-cols");
  await expect(zeilen.filter({ hasText: "ST-3" })).toHaveCount(1);
  const status = (await zeilen.locator(":scope > div:nth-child(5) .status-label").allInnerTexts()).map((t) => t.trim());
  // Jeder angezeigte Status steht in einem Block, keiner taucht nach einem anderen noch einmal auf
  const bloecke = status.filter((t, i) => i === 0 || status[i - 1] !== t);
  expect(bloecke, status.join(" | ")).toEqual([...new Set(status)]);
});

test("ganze Aufteilung einschließlich weiterem Beleg vor dem Storno ausdrücklich anzeigen", async ({ browser }) => {
  const chosen = await receipt(browser, "Codewerk Lizenzen GmbH", "S-4801");
  const other = await receipt(browser, "Nordlicht Software GmbH", "S-4802");
  const tx = await transaction("-239,00", "Aufteilung S-4801 S-4802");
  const bank = await import("../src/server/modules/bank/index.ts");
  await bank.allocateSplit("e2e-storno", {
    transactionId: tx,
    parts: [
      { kind: "document", documentId: chosen, amount: -11_900 },
      { kind: "document", documentId: other, amount: -11_900 },
      { kind: "gebuehren", amount: -100 },
    ],
  });
  await page.goto(`/belege/${chosen}`);
  await page.getByRole("button", { name: "Beleg stornieren", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("S-4801");
  await expect(dialog).toContainText("S-4802");
  await expect(dialog).toContainText("auch die zu weiteren Vorgängen");
  await expect(dialog.getByText("Bankzuordnung", { exact: true })).toHaveCount(3);
  await dialog.getByRole("button", { name: "Stornieren", exact: true }).click();
  await expect(page.locator(".page-head").getByText("Storniert", { exact: true })).toBeVisible();
  expect((await bank.transactionDetail(tx))!.transaction.open).toBe(-23_900);
  expect((await sql`select id from document_cancellations where document_id = ${other}`).length).toBe(0);
  await page.goto(`/belege/${other}`);
  await expect(page.locator(".page-head").getByText("Gebucht", { exact: true })).toBeVisible();
});

test("Fehlermeldung bei abgeschlossenem Jahr bleibt vor der Aktionsleiste vollständig lesbar", async () => {
  const [original] = await sql`select * from documents where id = ${unpaidDocumentId}`;
  const [counts] = await sql`select (select count(*) from journal_entries) as journal, (select count(*) from document_cancellations) as cancellations`;
  await sql`insert into year_closings (year) values (${Number(currentDay().slice(0, 4))})`;
  const hidden: string[] = [];
  for (const theme of ["light", "dark"])
    for (const [device, viewport] of [
      ["desktop", { width: 1440, height: 900 }],
      ["handy", { width: 390, height: 844 }],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto(`/belege/${unpaidDocumentId}`);
      await page.evaluate((t) => {
        document.documentElement.dataset.mode = t;
      }, theme);
      await page.getByRole("button", { name: "Beleg stornieren", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Stornieren", exact: true }).click();
      const error = page.getByRole("alert");
      await expect(error).toContainText(/ist abgeschlossen/);
      // Sichtbarkeit im DOM reicht nicht: Die stehende Aktionsleiste darf die Meldung nicht überdecken.
      const readable = await error.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return [0.1, 0.5, 0.9].every((fraction) => element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height * fraction)));
      });
      if (!readable) hidden.push(`${theme}/${device}`);
      if (process.env.STORNO_SCREENSHOTS) {
        await mkdir("test-results/storno-bilder", { recursive: true });
        await page.screenshot({ path: `test-results/storno-bilder/storno-fehler-${theme}-${device}-${process.env.STORNO_SCREENSHOTS}.png` });
      }
    }
  expect((await sql`select * from documents where id = ${unpaidDocumentId}`)[0]).toEqual(original);
  expect((await sql`select (select count(*) from journal_entries) as journal, (select count(*) from document_cancellations) as cancellations`)[0]).toEqual(
    counts,
  );
  expect(hidden).toEqual([]);
});

test("Belegliste: ohne Sortierung ungebuchte zuerst, Spaltenkopf sortiert und nennt die Richtung (#1112)", async ({ browser }) => {
  // Ein ungebuchter Beleg aus dem Vorjahr: Nach Datum stünde er unten, die Liste zeigt offene zuerst (docs/belege.md, Liste und Status)
  await receipt(browser, "Altpapier Ahrens", "A-1", `${Number(currentDay().slice(0, 4)) - 1}-01-15`, false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/belege");
  const zeilen = page.locator("a.table-row.document-cols");
  // Ohne Sortierung stehen ungebuchte Belege oben, auch wenn ihr Datum älter ist (docs/belege.md, „Liste und Status“).
  // Mehrere ungebuchte Belege sind möglich, deshalb die Reihenfolge prüfen statt den ersten Namen:
  const texte = await zeilen.allInnerTexts();
  const altpapier = texte.findIndex((t) => t.includes("Altpapier Ahrens"));
  const gebuchtL4711 = texte.findIndex((t) => t.includes("L-4711"));
  expect(altpapier).toBeGreaterThanOrEqual(0);
  expect(gebuchtL4711).toBeGreaterThan(altpapier);

  // Die Richtung steht im Namen des Links wie in der Bankliste (BankSortierKopf), damit Screenreader sie vorlesen.
  // Keine festen Namen: in dieser Datei entstehen im Lauf mehrere Belege, teils mit gleichem Lieferanten (R-2 steht zu
  // Recht vor „Nordlicht“, S-4801/S-4802 verdoppeln Codewerk und Nordlicht). Geprüft wird die Ordnung selbst, nicht wer oben steht.
  const lieferanten = async () => (await zeilen.locator(":scope > div:nth-child(2) > span:first-child").allInnerTexts()).map((name) => name.trim());
  /** „ab“/„auf“: die Spalte steht in dieser Richtung sortiert; „gleich“, wenn alle Namen gleich sind */
  const ordnung = (namen: string[]) => {
    const auf = namen.slice(1).every((name, i) => (namen[i] ?? "").localeCompare(name, "de") <= 0);
    const ab = namen.slice(1).every((name, i) => (namen[i] ?? "").localeCompare(name, "de") >= 0);
    return auf && ab ? "gleich" : auf ? "auf" : ab ? "ab" : "gemischt";
  };
  await page.getByRole("link", { name: "Lieferant absteigend sortieren" }).click();
  await expect(page).toHaveURL(/sort=lieferant&dir=ab/);
  // Die Adresse steht früher als die neu gezeichnete Tabelle, deshalb auf die Ordnung warten statt einmal zu lesen
  await expect.poll(async () => ordnung(await lieferanten())).toBe("ab");
  const absteigend = await lieferanten();
  expect(absteigend.length).toBeGreaterThan(1);
  await page.getByRole("link", { name: "Lieferant aufsteigend sortieren, zurzeit absteigend sortiert" }).click();
  await expect(page).toHaveURL(/sort=lieferant&dir=auf/);
  await expect.poll(async () => ordnung(await lieferanten())).toBe("auf");
  const aufsteigend = await lieferanten();
  // Dieselben Belege, nur andersherum: der Kopf dreht die Richtung, er filtert nichts weg
  expect([...aufsteigend].sort()).toEqual([...absteigend].sort());
  const ersterName = aufsteigend[0] ?? "";
  expect(ersterName.length).toBeGreaterThan(0);
  await page.reload();
  await expect(zeilen.first()).toContainText(ersterName);
});

test("Belegliste: Filter „Zu prüfen“ und „Gebucht“ stehen in der Adresse, die Zahl zählt ungebuchte, Sortierung und Suche bleiben (#1253)", async ({
  browser,
}) => {
  await receipt(browser, "Filterwerk Offen", "FI-1", currentDay(), false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/belege");
  const zeilen = page.locator("a.table-row.document-cols");
  const filter = page.getByRole("navigation", { name: "Filter" });
  const offen = Number((await sql`select count(*) from documents where status = 'neu'`)[0]!.count);
  const gebucht = Number((await sql`select count(*) from documents where status = 'gebucht'`)[0]!.count);
  // Gebuchte Belege stammen aus den Tests davor; hier lässt sich nichts mehr buchen, weil das Jahr weiter oben abgeschlossen ist
  expect(offen).toBeGreaterThan(0);
  expect(gebucht).toBeGreaterThan(0);
  // Ohne Filter alle, „Alle“ ist gewählt und „Zu prüfen“ trägt die Zahl der ungebuchten
  await expect(zeilen).toHaveCount(offen + gebucht);
  await expect(filter.getByRole("link", { name: "Alle", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(filter.getByRole("link", { name: `Zu prüfen · ${offen}`, exact: true })).toBeVisible();

  await filter.getByRole("link", { name: /^Zu prüfen/ }).click();
  await expect(page).toHaveURL(/status=pruefen/);
  await expect(zeilen).toHaveCount(offen);
  await expect(zeilen.filter({ hasText: "FI-1" })).toHaveCount(1);
  expect(await belegSpalte(5)).not.toContain("Gebucht");
  // Nur der gewählte Filter ist aktuell, für Auge und Screenreader; „Alle“ passt zwar zur Adresse, ist es aber nicht
  await expect(filter.getByRole("link", { name: /^Zu prüfen/ })).toHaveAttribute("aria-current", "page");
  await expect(filter.getByRole("link", { name: "Alle", exact: true })).not.toHaveAttribute("aria-current", "page");
  await expect(filter.getByRole("link", { name: "Alle", exact: true })).not.toHaveClass(/active/);
  await expect(filter.locator("a[aria-current=page]")).toHaveCount(1);

  // Sortierung und Suche bleiben beim Wechsel des Filters
  await page.goto("/belege?status=pruefen&sort=lieferant&dir=auf");
  await filter.getByRole("link", { name: "Gebucht", exact: true }).click();
  await expect(page).toHaveURL(/status=gebucht/);
  await expect(page).toHaveURL(/sort=lieferant/);
  await expect(zeilen).toHaveCount(gebucht);
  await expect(zeilen.filter({ hasText: "FI-1" })).toHaveCount(0);
  // Erst nach dem Hydratisieren tippen, sonst setzt React das Feld zurück
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Belege durchsuchen").fill("FI-1");
  await expect(page.getByRole("region", { name: "Belegliste" })).toContainText("Kein Beleg passt zu „FI-1“ unter „Gebucht“.");

  await filter.getByRole("link", { name: "Alle", exact: true }).click();
  await expect(page).not.toHaveURL(/status=/);
  await expect(zeilen.filter({ hasText: "FI-1" })).toHaveCount(1);
});

/** Die Texte einer Spalte der Belegliste, je Zeile die erste Zeile der Zelle (darunter stehen Nummer oder eigenes Konto) */
async function belegSpalte(n: number) {
  const zeilen = page.locator("a.table-row.document-cols");
  return (await zeilen.locator(`:scope > div:nth-child(${n})`).allInnerTexts()).map((t) => (t.split("\n")[0] ?? "").trim());
}
const aufsteigend = (texte: string[]) => texte.every((t, i) => i === 0 || (texte[i - 1] ?? "").localeCompare(t, "de") <= 0);

test("Belegliste: Lieferant sortiert nach dem angezeigten Text, ohne Lieferant nach dem Dateinamen", async ({ browser }) => {
  // Ohne Lieferant zeigt die Liste den Dateinamen (supplierName ist dann leer, nicht null)
  const documents = await import("../src/server/modules/belege/index.ts");
  const image = await browser.newPage({ viewport: { width: 620, height: 400 } });
  await image.setContent("<body><h2>Zettel</h2></body>");
  const bytes = await image.screenshot({ type: "jpeg", quality: 80 });
  await image.close();
  await documents.uploadDocument("e2e-storno", { bytes, filename: "Zettel ohne Angaben.jpg" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/belege?sort=lieferant&dir=auf");
  await expect(page.locator("a.table-row.document-cols").filter({ hasText: "Zettel ohne Angaben.jpg" })).toHaveCount(1);
  const namen = await belegSpalte(2);
  expect(aufsteigend(namen), namen.join(" | ")).toBe(true);
});

test("Belegliste: Kategorie sortiert nach dem angezeigten Namen, nicht nach dem Schlüssel", async ({ browser }) => {
  // Entwürfe, das Jahr ist weiter oben abgeschlossen. Schlüssel „beratung“ vor „buchfuehrung“, angezeigt
  // „Buchführung und Steuerberatung“ vor „Rechts- und Beratungskosten“
  await receipt(browser, "Kanzlei Klar", "K-1", currentDay(), false, "beratung");
  await receipt(browser, "Steuerbüro Stark", "K-2", currentDay(), false, "buchfuehrung");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/belege?sort=kategorie&dir=auf");
  await expect(page.locator("a.table-row.document-cols").filter({ hasText: "Rechts- und Beratungskosten" })).toHaveCount(1);
  const kategorien = await belegSpalte(3);
  expect(aufsteigend(kategorien), kategorien.join(" | ")).toBe(true);
});

test("Kontaktliste: Spaltenkopf sortiert und nennt die Richtung (#1112)", async () => {
  const stammdaten = await import("../src/server/modules/stammdaten/index.ts");
  const kontakt = (name: string, plz: string, ort: string) =>
    stammdaten.createContact("e2e-storno", {
      kundennummer: "",
      name,
      strasse: "",
      plz,
      ort,
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
  await kontakt("Anker Werft GmbH", "80331", "München");
  await kontakt("Zeisig Druck GmbH", "20095", "Hamburg");
  await page.goto("/kontakte");
  const zeilen = page.getByRole("region", { name: "Kontaktliste" }).locator('a[href^="/kontakte/"]');
  // Ohne Auswahl nach Name aufsteigend; der Kopf sagt, was der nächste Klick tut
  await expect(zeilen.first()).toContainText("Anker Werft GmbH");
  await page.getByRole("link", { name: "Name absteigend sortieren, zurzeit aufsteigend sortiert" }).click();
  await expect(page).toHaveURL(/sort=name&dir=ab/);
  await expect(zeilen.first()).toContainText("Zeisig Druck GmbH");
  // Ort sortiert nach Postleitzahl und Ort, der erste Klick aufsteigend
  await page.getByRole("link", { name: "Ort aufsteigend sortieren" }).click();
  await expect(page).toHaveURL(/sort=ort&dir=auf/);
  await expect(zeilen.first()).toContainText("Zeisig Druck GmbH");
});

test("Kontaktliste: Rechnungsformat sortiert nach dem angezeigten Text", async () => {
  const stammdaten = await import("../src/server/modules/stammdaten/index.ts");
  const kontakt = (name: string, leitwegId: string, defaultFormat: "zugferd" | null) =>
    stammdaten.createContact("e2e-storno", {
      kundennummer: "",
      name,
      strasse: "",
      plz: "",
      ort: "",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId,
      defaultFormat,
    });
  // Mit Leitweg-ID zeigt die Spalte „XRechnung (Leitweg-ID)“, auch ohne eigenes Format
  await kontakt("Amt Aalen", "08136088-12345-06", null);
  await kontakt("Bäckerei Berger", "", "zugferd");
  await page.goto("/kontakte?sort=format&dir=auf");
  const zeilen = page.getByRole("region", { name: "Kontaktliste" }).locator('a[href^="/kontakte/"]');
  const formate = (await zeilen.locator(":scope > div:nth-child(4)").allInnerTexts()).map((t) => t.trim());
  expect(formate).toContain("XRechnung (Leitweg-ID)");
  expect(formate).toEqual([...formate].sort((a, b) => a.localeCompare(b, "de")));
});
