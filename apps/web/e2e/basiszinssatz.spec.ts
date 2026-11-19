import { createHash } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";
import { HANDY, kopfUnterkante } from "./kopfzeile.ts";

/*
 * Einstellungen → Firma: Knopf „Bei der Bundesbank abrufen“, Prüfung von Basiszinssatz und Privatanteilen, Grenze der Gebühren (docs/einrichtung.md). Die echte Bundesbank fragt hier
 * niemand ab: Der Aufruf der Server-Funktion wird im Browser abgefangen und mit einem festen Ergebnis beantwortet, im Format,
 * das TanStack Start selbst schickt (seroval-JSON, Kopfzeile x-tss-serialized). Abruf und CSV prüfen die Vitest-Tests.
 */

test.use({ storageState: SESSION });
// Die Tests teilen sich eine Firma; einer, der sie speichert, darf keinem anderen dazwischenfunken
test.describe.configure({ mode: "serial" });

/** Ergebnis von fetchBaseRateFn, wie der Server es serialisiert */
const serverFnResult = (month: string, basisPoints: number, current: boolean) =>
  JSON.stringify({
    t: 10,
    i: 0,
    p: {
      k: ["result"],
      v: [
        {
          t: 10,
          i: 1,
          p: {
            k: ["month", "basisPoints", "current"],
            v: [
              { t: 1, s: month },
              { t: 0, s: basisPoints },
              { t: 2, s: current ? 2 : 3 },
            ],
          },
          o: 0,
        },
      ],
    },
    o: 0,
  });

/** Laufender Monat in Europe/Berlin, JJJJ-MM: gehört immer zum laufenden Halbjahr */
const thisMonth = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).format(new Date());

/** Name, unter dem TanStack Start die Server-Funktion fetchBaseRateFn (src/server/functions/dunning.ts) übersetzt */
const BASE_RATE_FN = { file: "src/server/functions/dunning.ts", export: "fetchBaseRateFn_createServerFn_handler" };

/**
 * Ist dieser Aufruf fetchBaseRateFn? Im gebauten Server ist die ID sha256(„<Datei>--<Export>“), im Entwicklungsserver
 * Base64url-JSON mit Datei und Export (start-plugin-core, start-compiler/compiler.js).
 */
function isBaseRateFn(url: string): boolean {
  const id = new URL(url).pathname.split("/").pop() ?? "";
  if (id === createHash("sha256").update(`${BASE_RATE_FN.file}--${BASE_RATE_FN.export}`).digest("hex")) return true;
  try {
    const fn = JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as { file?: string; export?: string };
    return fn.export === BASE_RATE_FN.export && (fn.file ?? "").includes(BASE_RATE_FN.file);
  } catch {
    return false;
  }
}

/** Knopf drücken; nur der Aufruf von fetchBaseRateFn geht an die Attrappe, alles andere an den Server */
async function lookUp(page: Page, body: string) {
  let calls = 0;
  await page.route("**/_serverFn/**", (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !isBaseRateFn(request.url())) return route.continue();
    calls += 1;
    return route.fulfill({ status: 200, headers: { "content-type": "application/json", "x-tss-serialized": "true" }, body });
  });
  await page.getByRole("button", { name: "Bei der Bundesbank abrufen" }).click();
  // Ruft der Knopf eine andere Server-Funktion auf, bleibt calls bei 0 und der Test schlägt hier fehl
  await expect.poll(() => calls).toBe(1);
  await page.unroute("**/_serverFn/**");
}

/** Klappt den Abschnitt der Firmendaten mit dieser Überschrift auf, falls er zu ist (#1253) */
async function aufklappen(page: Page, titel: string) {
  const abschnitt = page.locator("details", { has: page.getByRole("heading", { name: titel, exact: true }) });
  if (!(await abschnitt.evaluate((d) => (d as HTMLDetailsElement).open))) await abschnitt.locator("summary").click();
  await expect(abschnitt).toHaveAttribute("open", "");
  return abschnitt;
}

async function openDunning(page: Page, ...weitere: string[]) {
  await page.goto("/einstellungen");
  await page.waitForLoadState("networkidle");
  await aufklappen(page, "Mahnwesen");
  for (const titel of weitere) await aufklappen(page, titel);
  const field = page.getByLabel("Basiszinssatz in %");
  await expect(field).toBeVisible();
  return field;
}

test("trägt den Satz des laufenden Halbjahrs ins Feld ein, gespeichert wird erst mit dem Formular", async ({ page }) => {
  const field = await openDunning(page);
  const before = await field.inputValue();
  const month = thisMonth();

  await lookUp(page, serverFnResult(month, 987, true));
  await expect(field).toHaveValue("9,87");
  await expect(
    page.getByText(`Basiszinssatz 9,87 % eingetragen (Bundesbank, Stand ${month.slice(5)}/${month.slice(0, 4)}). Gilt nach dem Speichern.`),
  ).toBeVisible();

  // Ohne Speichern bleibt der alte Wert
  await openDunning(page);
  await expect(field).toHaveValue(before);
});

test("lässt das Feld unverändert, solange die Bundesbank nur den Satz des vorigen Halbjahrs meldet", async ({ page }) => {
  const field = await openDunning(page);
  const before = await field.inputValue();
  const lastYear = `${Number(thisMonth().slice(0, 4)) - 1}-12`;

  await lookUp(page, serverFnResult(lastYear, 987, false));
  await expect(page.getByText(/^Die Bundesbank meldet 9,87 % mit Stand 12\/\d{4}, der Satz für das neue Halbjahr steht noch nicht/)).toBeVisible();
  await expect(field).toHaveValue(before);
});

test("Gebühr je Stufe: mehr als 1.000 € steht am Feld, gespeichert wird nichts", async ({ page }) => {
  await openDunning(page);
  const gebuehr = page.getByLabel("Gebühr Zahlungserinnerung (€)");
  const vorher = await gebuehr.inputValue();
  await gebuehr.fill("1.500,00");
  await page.getByRole("form", { name: "Firmendaten" }).getByRole("button", { name: "Speichern" }).click();
  await expect(gebuehr).toBeFocused();
  await expect(gebuehr).toHaveAccessibleDescription(/höchstens 1\.000,00\s€/);
  await expect(page.getByText("Firmendaten gespeichert.")).toHaveCount(0);
  await openDunning(page);
  await expect(page.getByLabel("Gebühr Zahlungserinnerung (€)")).toHaveValue(vorher);
});

test("Basiszinssatz: Unlesbares und Sätze außerhalb von −10 % bis 20 % stehen am Feld, gespeichert wird nichts (#1143)", async ({ page }) => {
  const field = await openDunning(page);
  const vorher = await field.inputValue();
  const speichern = page.getByRole("form", { name: "Firmendaten" }).getByRole("button", { name: "Speichern" });
  await field.fill("1,275");
  await speichern.click();
  await expect(field).toBeFocused();
  await expect(field).toHaveAccessibleDescription(/etwa 1,27 oder -0,88/);
  await field.fill("25 %");
  await speichern.click();
  await expect(field).toHaveAccessibleDescription(/von -10\s% bis 20\s%/);
  await expect(page.getByText("Firmendaten gespeichert.")).toHaveCount(0);
  await openDunning(page);
  await expect(page.getByLabel("Basiszinssatz in %")).toHaveValue(vorher);
});

test("Privatanteil: keine ganze Zahl von 0 bis 100 steht am Feld, gespeichert wird nichts (#1221)", async ({ page }) => {
  await openDunning(page, "Privatanteile");
  const telefon = page.getByLabel("Privatanteil Telefon in %");
  const vorher = await telefon.inputValue();
  await telefon.fill("20,5");
  await page.getByRole("form", { name: "Firmendaten" }).getByRole("button", { name: "Speichern" }).click();
  await expect(telefon).toBeFocused();
  await expect(telefon).toHaveAccessibleDescription(/ganze Zahl von 0 bis 100/);
  await expect(page.getByText("Firmendaten gespeichert.")).toHaveCount(0);
  await openDunning(page, "Privatanteile");
  await expect(page.getByLabel("Privatanteil Telefon in %")).toHaveValue(vorher);
});

test("Firmendaten: Fehler stehen am Feld statt in der Blase des Browsers, der Fokus geht aufs erste", async ({ page }) => {
  await openDunning(page);
  const email = page.getByLabel("E-Mail", { exact: true });
  await email.fill("rechnung");
  await page.getByLabel("Gebühr Zahlungserinnerung (€)").fill("1.500,00");
  await page.getByRole("form", { name: "Firmendaten" }).getByRole("button", { name: "Speichern" }).click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAccessibleDescription(/gültige E-Mail-Adresse/);
  await expect(page.getByLabel("Gebühr Zahlungserinnerung (€)")).toHaveAccessibleDescription(/höchstens 1\.000,00\s€/);
});

test("Zugeklappter Abschnitt: Ein Fehler darin klappt ihn auf, der Fokus geht ins Feld (#1253)", async ({ page }) => {
  await openDunning(page, "Privatanteile");
  const telefon = page.getByLabel("Privatanteil Telefon in %");
  const vorher = await telefon.inputValue();
  await telefon.fill("150");
  for (const titel of ["Mahnwesen", "Privatanteile"]) await (await aufklappen(page, titel)).locator("summary").click();
  await expect(page.getByLabel("Privatanteil Telefon in %")).toBeHidden();
  await page.getByRole("form", { name: "Firmendaten" }).getByRole("button", { name: "Speichern" }).click();
  await expect(telefon).toBeVisible();
  await expect(telefon).toBeFocused();
  await expect(telefon).toHaveAccessibleDescription(/ganze Zahl von 0 bis 100/);
  await expect(page.getByText("Firmendaten gespeichert.")).toHaveCount(0);
  await openDunning(page, "Privatanteile");
  await expect(page.getByLabel("Privatanteil Telefon in %")).toHaveValue(vorher);
});

test("Zugeklappter Abschnitt: Der Wert steht in der Überschrift (#1253)", async ({ page }) => {
  await openDunning(page);
  // Nur die Überschrift prüfen, nichts speichern: Die Mahngebühr lesen andere Specs
  await page.getByLabel("Gebühr Zahlungserinnerung (€)").fill("2,50");
  const abschnitt = await aufklappen(page, "Mahnwesen");
  await abschnitt.locator("summary").click();
  await expect(abschnitt.locator("summary")).toContainText("Gebühren 2,50");
  await abschnitt.locator("summary").click();
  await page.getByLabel("Basiszinssatz in %").fill("0,25");
  await expect(abschnitt.locator("summary")).toContainText("Basiszinssatz 0,25 %");
});

test("Ein Link mit #company-dunning öffnet die Firma mit aufgeklapptem Mahnwesen (#1253)", async ({ page }) => {
  await page.goto("/einstellungen?bereich=firma#company-dunning");
  await expect(page.getByLabel("Basiszinssatz in %")).toBeVisible();
});

const speichern = (page: Page) => page.getByRole("form", { name: "Firmendaten" }).getByRole("button", { name: "Speichern" });

test("Felder zugeklappter Abschnitte (Frist, Auto-Abruf, Tageskurs, Privatanteil) gehen beim Speichern mit (#1253)", async ({ page }) => {
  const abschnitte = ["Mahnwesen", "Fremdwährung", "Privatanteile"];
  const frist = page.getByLabel("Zahlungsfrist in Mahnungen (Tage)");
  const auto = page.getByRole("checkbox", { name: "Basiszinssatz automatisch abrufen" });
  const kurs = page.getByRole("checkbox", { name: /^Tageskurs statt/ });
  const telefon = page.getByLabel("Privatanteil Telefon in %");
  const lesen = async () => ({
    frist: await frist.inputValue(),
    auto: await auto.isChecked(),
    kurs: await kurs.isChecked(),
    telefon: await telefon.inputValue(),
  });
  const laden = async () => {
    await page.goto("/einstellungen");
    await page.waitForLoadState("networkidle");
    for (const titel of abschnitte) await aufklappen(page, titel);
  };
  await laden();
  const alt = await lesen();
  try {
    await frist.fill("17");
    await auto.setChecked(!alt.auto);
    await kurs.setChecked(!alt.kurs);
    await telefon.fill("33");
    for (const titel of abschnitte) await (await aufklappen(page, titel)).locator("summary").click();
    await expect(frist).toBeHidden();
    await speichern(page).click();
    await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
    await laden();
    expect(await lesen()).toEqual({ frist: "17", auto: !alt.auto, kurs: !alt.kurs, telefon: "33" });
  } finally {
    // Den Ausgangswert verlässlich zurückschreiben, auch wenn eine Prüfung oben scheitert
    await laden();
    await frist.fill(alt.frist);
    await auto.setChecked(alt.auto);
    await kurs.setChecked(alt.kurs);
    await telefon.fill(alt.telefon);
    await speichern(page).click();
    await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
    await laden();
    expect(await lesen()).toEqual(alt);
  }
});

test("Der Link aus dem Mahnwesen öffnet per Navigation den Abschnitt (#1253)", async ({ page }) => {
  await page.goto("/rechnungen/mahnwesen");
  await page.waitForLoadState("networkidle");
  await page.locator("p.small").getByRole("link", { name: "Einstellungen", exact: true }).click();
  await expect(page).toHaveURL(/#company-dunning/);
  await expect(page.getByLabel("Basiszinssatz in %")).toBeVisible();
});

test("Der zugeklappte Abschnitt öffnet und schließt mit Enter und Leertaste (#1253)", async ({ page }) => {
  await page.goto("/einstellungen?bereich=firma");
  await page.waitForLoadState("networkidle");
  const summary = page.locator("details", { has: page.getByRole("heading", { name: "Mahnwesen", exact: true }) }).locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Basiszinssatz in %")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Basiszinssatz in %")).toBeHidden();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Basiszinssatz in %")).toBeVisible();
});

test("Der Name des Schalters zum Aufklappen enthält kein Pfeilzeichen (#1253)", async ({ page }) => {
  await page.goto("/einstellungen?bereich=firma");
  await page.waitForLoadState("networkidle");
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const namen = nodes.filter((n) => n.role?.value === "DisclosureTriangle").map((n) => String(n.name?.value));
  expect(namen.length).toBeGreaterThanOrEqual(3);
  expect(namen.filter((n) => n.includes("›"))).toEqual([]);
});

test("Zugeklappt rückwärts tabben am Handy: auch die Überschriften zum Aufklappen liegen nicht unter dem Kopf (#1253)", async ({ page }) => {
  await page.setViewportSize(HANDY);
  await page.goto("/einstellungen?bereich=firma");
  await page.waitForLoadState("networkidle");
  const felder = page.locator(".settings-content").locator("input:not([type=hidden]), select, textarea, summary");
  await felder.last().focus();
  let geprueft = 0;
  let summaries = 0;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Shift+Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el?.closest(".settings-content")) return "ende";
      return { tag: el.tagName, name: (el.textContent ?? "").trim().slice(0, 30), top: el.getBoundingClientRect().top };
    });
    if (focus === "ende") break;
    if (focus.tag === "SUMMARY") summaries++;
    expect(focus.top, `„${focus.name}“ liegt unter dem Kopf`).toBeGreaterThanOrEqual((await kopfUnterkante(page)) - 1);
    geprueft++;
  }
  expect(summaries).toBeGreaterThanOrEqual(3);
  expect(geprueft).toBeGreaterThan(8);
});

for (const [geraet, viewport] of [
  ["Laptop", { width: 1470, height: 800 }],
  ["Handy", HANDY],
] as const) {
  test(`Der Anker #company-dunning am ${geraet}: Die Überschrift liegt nach dem Sprung nicht unter dem Kopf (#1253)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/einstellungen?bereich=firma#company-dunning");
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Basiszinssatz in %")).toBeVisible();
    const ueberschrift = page.locator("#company-dunning");
    const kopf = await kopfUnterkante(page);
    // Der Sprung rollt noch, bis die Seite aufgeklappt ist: abwarten, bis die Überschrift steht
    await expect.poll(async () => (await ueberschrift.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(kopf - 1);
    await expect(ueberschrift).toBeInViewport();
  });
}
