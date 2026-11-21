import { type FintsTestbank, type FintsTestbankUmsatz, startFintsTestbank } from "@haben/import/fints-testbank";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { databaseUrlFuer, FINTS_BANK_PORT, FINTS_PRODUKT_E2E } from "./durchlaeufe.ts";
import { bestaetigen, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/**
 * Kontoabruf über FinTS (#654) in eigener, leerer Datenbank (Projekt „fints-abruf“, e2e/durchlaeufe.ts). Der Server
 * des Durchlaufs hat als einziger FINTS_PRODUKT_ID (playwright.config.ts); die Bank baut @haben/import/fints-testbank
 * nach: FinTS 3.0 mit PIN/TAN, chipTAN und pushTAN, Umsätze als MT940.
 */

test.describe.configure({ mode: "serial" });

/** Tag vor heute, nie vor dem 1. Januar: Der erste Abruf beginnt am Jahresanfang */
function tag(offset: number): string {
  const heute = new Date();
  const datum = Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate() + offset);
  return new Date(Math.max(datum, Date.UTC(heute.getFullYear(), 0, 1))).toISOString().slice(0, 10);
}

const GIRO = "DE02120300000000202051";
const TAGESGELD = "DE12500105170648489890";

let page: Page;
let pageErrors: string[] = [];
let bank: FintsTestbank;
const umsaetze: Record<string, FintsTestbankUmsatz[]> = {
  [GIRO]: [
    { tag: tag(-20), betrag: "1190,00", name: "Muster GmbH", iban: "DE89370400440532013000", zweck: "Rechnung RE-2026-0042", ref: "G1" },
    { tag: tag(-5), betrag: "-49,99", name: "Telekom Deutschland GmbH", zweck: "Mobilfunk", ref: "G2" },
  ],
  [TAGESGELD]: [],
};

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
  bank = await startFintsTestbank({
    produktId: FINTS_PRODUKT_E2E,
    bankname: "Testbank",
    port: FINTS_BANK_PORT,
    konten: [
      { iban: GIRO, nummer: "0000202051", name: "Girokonto" },
      { iban: TAGESGELD, nummer: "0648489890", name: "Tagesgeld" },
    ],
    umsaetze,
  });
});

test.afterAll(async () => {
  await page.context().close();
  await bank?.schliessen();
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const abruf = () => page.getByRole("region", { name: "Automatischer Abruf" });
const freigabe = () => page.getByRole("form", { name: "Freigabe bei der Bank" });

async function zugangEingeben(pin = "12345") {
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  await form.getByLabel("Bankleitzahl").fill("12030000");
  await form.getByLabel("FinTS-Adresse der Bank").fill(bank.url);
  await form.getByLabel("Anmeldename").fill("max");
  await form.getByLabel("PIN").fill(pin);
  await form.getByRole("button", { name: "Verbinden" }).click();
}

test("Einrichtung", async () => {
  await einrichten(page);
});

test("Einstellungen › Bank zeigt, dass FinTS eingerichtet ist, ohne die Nummer", async () => {
  await gehe(page, "/einstellungen?bereich=bank");
  const karte = page.getByRole("region", { name: "Kontoabruf über FinTS" });
  await expect(karte.getByRole("status")).toHaveText("Eingerichtet. Unter Bank verbindest du deine Bank mit „Über FinTS verbinden“.");
  await expect(page.getByText(FINTS_PRODUKT_E2E)).toHaveCount(0);
});

test("prüft den Zugang im Formular, bevor Haben die Bank fragt", async () => {
  await gehe(page, "/bank");
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  await form.getByLabel("Bankleitzahl").fill("1203");
  await form.getByLabel("FinTS-Adresse der Bank").fill("http://bank.example/fints");
  await form.getByRole("button", { name: "Verbinden" }).click();
  await expect(form.getByText("Die Bankleitzahl hat acht Ziffern.")).toBeVisible();
  await expect(form.getByText("Die FinTS-Adresse beginnt mit https://.")).toBeVisible();
  await expect(form.getByText("Der Anmeldename fehlt.")).toBeVisible();
  await expect(form.getByText("Die PIN fehlt.")).toBeVisible();
  await expect(form.getByLabel("Bankleitzahl")).toBeFocused();
  expect(bank.zustand.anfragen).toHaveLength(0);
  await form.getByRole("button", { name: "Abbrechen" }).click();
});

test("verbindet mit TAN-Verfahren und TAN und holt die Umsätze beider Konten", async () => {
  bank.zustand.scaBeiAnmeldung = true;
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await expect(freigabe().getByText("Bitte geben Sie die TAN ein.")).toBeVisible();
  // Ohne TAN fragt das Formular, statt die Bank anzufragen
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(freigabe().getByText("Bitte die TAN eingeben.")).toBeVisible();
  await freigabe().getByLabel("TAN", { exact: true }).fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();

  await expect(abruf().getByText("Testbank verbunden, 2 neue Umsätze.")).toBeVisible();
  await expect(abruf().getByText(/Neu angelegt: Testbank Girokonto …2051, Testbank Tagesgeld …9890/)).toBeVisible();
  await expect(abruf().getByText("Testbank Girokonto …2051 · Testbank Tagesgeld …9890")).toBeVisible();
  await expect(abruf().getByText("Aktiv")).toBeVisible();
  const konten = page.getByRole("navigation", { name: "Konten" });
  await expect(konten.getByRole("link", { name: /Testbank Girokonto …2051/ })).toContainText("Abruf");
  await expect(konten.getByRole("link", { name: /Testbank Girokonto …2051/ })).toContainText("1.140,01 €");
  await expect(page.getByText("Mobilfunk").first()).toBeVisible();
});

test("„Jetzt abrufen“ fragt die TAN ab, wenn die Bank sie verlangt", async () => {
  umsaetze[GIRO]!.push({ tag: tag(-1), betrag: "250,00", name: "Kunde AG", zweck: "RE-2026-0050", ref: "G3" });
  bank.zustand.scaBeiUmsaetzen = true;
  await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
  await freigabe().getByLabel("TAN", { exact: true }).fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(abruf().getByText("Testbank, 1 neue Umsätze.")).toBeVisible();
  await expect(page.getByText("RE-2026-0050").first()).toBeVisible();
});

test("nach einer abgelehnten PIN den Zugang ändern", async () => {
  // Wie nach einer neuen PIN bei der Bank: der Abruf im Hintergrund hat aufgehört, die Verbindung steht auf „Fehler“
  const sql = postgres(databaseUrlFuer("fints-abruf"), { max: 1, onnotice: () => {} });
  try {
    await sql`update fints_connections set status = 'fehler', last_error = 'Abruf fehlgeschlagen: PIN ungültig. (9942)'`;
  } finally {
    await sql.end();
  }
  await gehe(page, "/bank");
  await expect(abruf().getByText("Abruf fehlgeschlagen: PIN ungültig. (9942)")).toBeVisible();
  await abruf().getByRole("button", { name: "Zugang ändern" }).click();
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  await expect(form.getByLabel("Bankleitzahl")).toHaveValue("12030000");
  await expect(form.getByLabel("FinTS-Adresse der Bank")).toHaveValue(bank.url);
  await expect(form.getByLabel("Anmeldename")).toHaveValue("max");
  await expect(form.getByLabel("PIN")).toHaveValue("");
  await form.getByLabel("PIN").fill("12345");
  await form.getByRole("button", { name: "Verbinden" }).click();
  // pushTAN: diesmal ohne TAN, die Bank verlangt bei der Anmeldung keine mehr
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "pushTAN 2.0" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText("Testbank verbunden, 0 neue Umsätze.")).toBeVisible();
  await expect(abruf().getByText("Aktiv")).toBeVisible();
  await expect(abruf().getByRole("button", { name: "Zugang ändern" })).toHaveCount(0);
  // Das Formular schließt wie beim ersten Verbinden, mit der PIN darin bleibt nichts stehen
  await expect(page.getByRole("form", { name: "Über FinTS verbinden" })).toHaveCount(0);
});

test("pushTAN: wartet auf die Freigabe in der App", async () => {
  bank.zustand.scaBeiUmsaetzen = true;
  await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(freigabe().getByText("Bitte bestätigen Sie den Zugriff in Ihrer Banking-App.")).toBeVisible();
  await expect(freigabe().getByLabel("TAN", { exact: true })).toHaveCount(0);
  await freigabe().getByRole("button", { name: "Freigegeben, weiter" }).click();
  await expect(freigabe().getByRole("status")).toHaveText("Noch nicht freigegeben. Bitte in der App der Bank bestätigen und dann weiter.");
  bank.zustand.freigegeben = true;
  await freigabe().getByRole("button", { name: "Freigegeben, weiter" }).click();
  await expect(abruf().getByText("Testbank, 0 neue Umsätze.")).toBeVisible();
});

test("pushTAN: fragt die TAN ab, wenn die Bank bei der Anmeldung eine aus der App verlangt (wie die Consorsbank)", async () => {
  Object.assign(bank.zustand, { scaBeiAnmeldung: true, appTanEintippen: true });
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "pushTAN 2.0" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await expect(freigabe().getByText("Bitte generieren Sie eine TAN mit Ihrer Banking App oder Ihrem TAN Generator und geben diese hier ein.")).toBeVisible();
  await expect(freigabe().getByRole("button", { name: "Freigegeben, weiter" })).toHaveCount(0);
  await freigabe().getByLabel("TAN", { exact: true }).fill("123456");
  // Verbinden ersetzt die Verbindung samt ID. Auch wenn die Seite langsam neu lädt, kommt die Meldung erst mit der neuen
  // Verbindung; sonst schickte „Trennen“ im nächsten Test die alte ID („Verbindung nicht gefunden.“). Die Verzögerung
  // endet erst dort: Endete sie mit der Meldung, ging der Abruf des Loaders oft unverzögert durch, und ohne den Fix blieb
  // „Trennen“ meist grün
  const neuLaden = (url: URL) => url.pathname.startsWith("/_serverFn/");
  await page.route(neuLaden, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((fertig) => setTimeout(fertig, 1500));
    await route.continue();
  });
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(abruf().getByText("Testbank verbunden, 0 neue Umsätze.")).toBeVisible();
  await expect(abruf().getByText("Aktiv")).toBeVisible();
  bank.zustand.appTanEintippen = false;
});

test("Trennen löscht die Verbindung, die Umsätze bleiben", async () => {
  await abruf().getByRole("button", { name: "Trennen" }).click();
  await bestaetigen(page, "Trennen");
  // Ende der Verzögerung aus dem Test davor; „wait“ lässt verzögerte Anfragen noch fertig laufen
  await page.unrouteAll({ behavior: "wait" });
  await expect(abruf().getByText("Testbank", { exact: true })).toHaveCount(0);
  await expect(abruf().getByText(/Noch keine Bank verbunden/)).toBeVisible();
  await expect(page.getByText("RE-2026-0050").first()).toBeVisible();
});
