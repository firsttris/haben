import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { ANONYMOUS, chunks, currentYear, fakeEigeneSeite, firstLink, SESSION, USER } from "./daten.ts";

/**
 * Barrierefreiheit und Tastaturbedienung, mit den Daten und der Sitzung aus app.spec.ts (Projekt „mit-daten“ in
 * playwright.config.ts). axe-core prüft jede Seite gegen WCAG 2.2 AA und die Best Practices von axe, die
 * Farbkontraste zusätzlich in allen übrigen Themes. Die Tastaturtests melden sich ohne Maus an, springen mit dem
 * Sprunglink zum Inhalt und tabben durch die Seiten: Jedes Element mit Fokus muss einen sichtbaren Rahmen haben.
 * Jede Seite ist ein eigener Test, damit sie sich auf die Worker verteilen; geschrieben wird nichts.
 */

test.use({ storageState: SESSION });
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const THEMES = ["wald", "ozean", "pflaume", "graphit", "nacht", "tiefsee"];

const YEAR = currentYear();

const PAGES = [
  "/",
  "/rechnungen",
  "/rechnungen/neu",
  "/rechnungen/mahnwesen",
  "/rechnungen/wiederkehrend",
  "/rechnungen/wiederkehrend/neu",
  "/angebote",
  "/angebote/neu",
  "/artikel",
  "/kontakte",
  "/kontakte/neu",
  "/belege",
  "/dauerbelege",
  "/dauerbelege/neu",
  "/ueberweisungen",
  "/lastschriften",
  "/pauschalen",
  "/anlagen",
  "/anlagen/neu",
  "/csv-import?art=anlagen",
  "/bank",
  "/kasse",
  "/darlehen",
  "/umsatzsteuer",
  // Quartal, das nicht zum eingestellten Zeitraum passt: mit Hinweis und gesperrtem Senden
  `/umsatzsteuer/${YEAR}-Q1`,
  // Zusammenfassende Meldung, hier leer; mit der Leistung ins EU-Ausland und der Testübermittlung prüft sie belege-steuern.spec.ts
  `/umsatzsteuer/zm/${YEAR + 1}-Q1`,
  `/jahreserklaerung/${YEAR}`,
  "/finanzamt",
  "/fristen",
  "/auswertungen",
  "/buchungen",
  "/buchungen/neu",
  `/abschluss/${YEAR - 1}`,
  "/ausschuettungen",
  `/lohn/bescheinigung/${YEAR}`,
  "/lohn",
  "/lohn/mitarbeiter/neu",
  "/sv-meldeportal",
  // Lohnsteuer-Anmeldung für das Kalenderjahr: passt meist nicht zum Anmeldungszeitraum, mit Hinweis
  `/lohn/anmeldung/${YEAR}`,
  `/konten?jahr=${YEAR}`,
  `/konten/1200?jahr=${YEAR}`,
  "/archiv",
  // Altbelege aus der Web-Sicherung in app.spec.ts, mit den Filtern Richtung und „Ohne Datei“
  "/archiv?ansicht=belege",
  "/archiv?ansicht=auftraege",
  "/archiv/auftrag/723bf34b-f8ab-48f0-b391-656af4b72a96",
  "/archiv?ansicht=belege&richtung=ausgabe&ohneDatei=true",
  "/textbausteine",
  "/einstellungen",
  "/einstellungen?bereich=rechnungen",
  "/einstellungen?bereich=gestaltung",
  "/einstellungen?bereich=elster",
  "/einstellungen?bereich=email",
  "/einstellungen?bereich=bank",
  "/einstellungen?bereich=ki",
  "/einstellungen?bereich=export",
  "/einstellungen?bereich=seiten",
  "/einstellungen?bereich=sicherheit",
  // So sieht die Steuerberatung Haben; ihre eigene Sicht und die Einladung prüft steuerberatung.spec.ts
  "/steuerberatung",
];

/** Für die übrigen Themes: Seiten, auf denen zusammen jede Art von Link, Knopf, Hinweis und Tabelle vorkommt */
const THEME_PAGES = [
  "/",
  "/rechnungen",
  "/rechnungen/neu",
  "/bank",
  "/buchungen",
  `/konten/1200?jahr=${YEAR}`,
  "/fristen",
  "/auswertungen",
  `/jahreserklaerung/${YEAR}`,
  "/archiv",
  "/einstellungen?bereich=elster",
  "/einstellungen?bereich=export",
];

/** Anmelden nur mit der Tastatur: Tab, Enter und Tippen */
async function signInByKeyboard(p: Page) {
  await p.goto("/login");
  await p.waitForLoadState("networkidle");
  await tabTo(p, "Passwort verwenden");
  await p.keyboard.press("Enter");
  // Das E-Mail-Feld hat den Fokus, sobald der Knopf verschwunden ist
  await expect(p.getByLabel("E-Mail")).toBeFocused();
  await p.keyboard.type(USER.email);
  await p.keyboard.press("Tab");
  await expect(p.getByLabel("Passwort")).toBeFocused();
  await p.keyboard.type(USER.password);
  await p.keyboard.press("Enter");
  await p.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Tab drücken, bis das Element mit diesem Namen den Fokus hat */
async function tabTo(p: Page, name: string, max = 80) {
  for (let i = 0; i < max; i++) {
    await p.keyboard.press("Tab");
    const label = await p.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      // biome-ignore lint/performance/useDomNodeTextContent: gemeint ist der sichtbare Text
      return (el?.getAttribute("aria-label") ?? el?.innerText ?? "").trim();
    });
    if (label === name || label.endsWith(`\n${name}`)) return;
  }
  throw new Error(`„${name}“ ist mit Tab nicht erreichbar`);
}

async function open(p: Page, path: string) {
  const response = await p.goto(path);
  expect(response?.status(), `${path} lädt`).toBeLessThan(400);
  await p.waitForLoadState("networkidle");
  await expect(p.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

/** axe-Verstöße als lesbare Liste, damit der Fehler im Testbericht sagt, was wo kaputt ist */
async function axe(p: Page, rules?: string[]) {
  const builder = new AxeBuilder({ page: p }).withTags(WCAG);
  if (rules) builder.withRules(rules);
  const { violations } = await builder.analyze();
  return violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} (${v.impact}): ${v.help} → ${n.target.join(" ")} ${n.failureSummary?.split("\n").slice(1).join(" ") ?? ""}`.trim()),
  );
}

/** Theme vor dem ersten Laden setzen; das Skript im Kopf der Seite liest es aus localStorage */
async function withTheme(p: Page, theme: string) {
  await p.addInitScript((t) => localStorage.setItem("haben-theme", t), theme);
}

test("Anmeldeseite ohne Verstöße", async ({ browser }) => {
  const anonymous = await browser.newContext(ANONYMOUS);
  const p = await anonymous.newPage();
  await open(p, "/login");
  expect(await axe(p), "/login").toEqual([]);
  await p.getByRole("button", { name: "Passwort verwenden" }).click();
  expect(await axe(p), "/login mit Passwort").toEqual([]);
  await anonymous.close();
});

test("Anmelden nur mit der Tastatur", async ({ browser }) => {
  const anonymous = await browser.newContext(ANONYMOUS);
  await signInByKeyboard(await anonymous.newPage());
  await anonymous.close();
});

/** Seiten je Test: mehrere Seiten in einem Browser-Kontext laden die Skripte nur einmal */
const GROUP = 6;

for (const group of chunks(PAGES, GROUP)) {
  test(`Ohne axe-Verstöße (WCAG 2.2 AA): ${group.join(", ")}`, async ({ page }) => {
    await withTheme(page, "wald");
    for (const path of group) {
      await open(page, path);
      expect.soft(await axe(page), path).toEqual([]);
    }
  });
}

for (const theme of THEMES.filter((t) => t !== "wald")) {
  test(`Farbkontraste im Theme ${theme}`, async ({ page }) => {
    test.setTimeout(300_000);
    await withTheme(page, theme);
    for (const path of THEME_PAGES) {
      await open(page, path);
      expect.soft(await axe(page, ["color-contrast", "link-in-text-block"]), `${theme} ${path}`).toEqual([]);
    }
  });
}

// Die Adresse der eigenen Seite aus app.spec.ts steht erst zur Laufzeit fest; axe prüft auch den Inhalt im Rahmen
/** Seiten mit mehrzeiligen Feldern, Auswahlen und Eingaben; in dunklen Themes malt der Browser Felder ohne eigene Farbe grau */
const FIELD_PAGES = ["/rechnungen/neu", "/dauerbelege/neu", "/anlagen/neu", "/finanzamt", "/einstellungen", "/einstellungen?bereich=email"];

/** Sichtbare Felder, deren Hintergrund nicht die Theme-Fläche ist; berechnete Kennzahlen sind absichtlich transparent */
function fieldsOffSurface(p: Page) {
  return p.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--surface)";
    document.body.append(probe);
    const surface = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [...document.querySelectorAll<HTMLElement>("main input, main select, main textarea")]
      .filter((el) => !["checkbox", "radio", "hidden", "file", "range", "color"].includes((el as HTMLInputElement).type))
      .filter((el) => el.getClientRects().length > 0 && !el.closest(".search-box") && !el.matches(".kz-row input:read-only"))
      .filter((el) => getComputedStyle(el).backgroundColor !== surface)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.getAttribute("name") ?? (el as HTMLInputElement).labels?.[0]?.textContent?.trim().slice(0, 40) ?? el.id}: ${getComputedStyle(el).backgroundColor}`,
      );
  });
}

for (const theme of THEMES.filter((t) => t === "nacht" || t === "tiefsee")) {
  test(`Eingabefelder auf der Theme-Fläche im Theme ${theme}`, async ({ page }) => {
    await withTheme(page, theme);
    for (const path of FIELD_PAGES) {
      await open(page, path);
      await page.evaluate(() => {
        for (const d of document.querySelectorAll("details")) d.open = true;
      });
      expect.soft(await fieldsOffSurface(page), `${path}: Felder ohne Theme-Fläche`).toEqual([]);
    }
  });

  // Die Kennzahlen der Voranmeldung sind erst nach „Manuell überschreiben“ Eingabefelder (Review #364)
  test(`Kennzahlen der Voranmeldung auf der Theme-Fläche im Theme ${theme}`, async ({ page }) => {
    await withTheme(page, theme);
    let path = "";
    for (const candidate of [`/umsatzsteuer/${YEAR}-Q1`, `/umsatzsteuer/${YEAR}-03`, `/umsatzsteuer/${YEAR - 1}-03`, `/umsatzsteuer/${YEAR + 1}-03`]) {
      await open(page, candidate);
      if (await page.getByRole("button", { name: "Manuell überschreiben" }).count()) {
        path = candidate;
        break;
      }
    }
    expect(path, "Voranmeldung zum manuellen Überschreiben").not.toBe("");
    await page.getByRole("button", { name: "Manuell überschreiben" }).click();
    await expect(page.locator(".kz-row input").first()).toBeVisible();
    expect(await fieldsOffSurface(page), `${path}: Felder ohne Theme-Fläche`).toEqual([]);
  });
}

for (const [device, viewport] of [
  ["Desktop", { width: 1440, height: 900 }],
  ["Handy", { width: 320, height: 720 }],
] as const) {
  test(`Eigene Seite ohne axe-Verstöße (${device})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await withTheme(page, "wald");
    await fakeEigeneSeite(page);
    const path = await firstLink(page, "/einstellungen?bereich=seiten", /^\/seiten\/[0-9a-f-]{36}$/);
    expect(path, "app.spec.ts hat eine eigene Seite angelegt").not.toBeNull();
    await open(page, path!);
    await expect(page.frameLocator("iframe").getByRole("heading", { name: "Offene Bestellungen" })).toBeVisible();
    expect(await axe(page), path!).toEqual([]);
  });
}

// Stammdaten des Minijobbers aus app.spec.ts; die Adresse steht erst zur Laufzeit fest
test("Stammdaten eines Mitarbeiters ohne axe-Verstöße", async ({ page }) => {
  await withTheme(page, "wald");
  const path = await firstLink(page, "/lohn", /^\/lohn\/mitarbeiter\/[0-9a-f-]{36}$/);
  expect(path, "app.spec.ts hat einen Mitarbeiter angelegt").not.toBeNull();
  await open(page, path!);
  expect(await axe(page), path!).toEqual([]);
});

// Dauerbeleg aus app.spec.ts mit angelegtem Beleg
test("Dauerbeleg ohne axe-Verstöße", async ({ page }) => {
  await withTheme(page, "wald");
  const path = await firstLink(page, "/dauerbelege", /^\/dauerbelege\/[0-9a-f-]{36}$/);
  expect(path, "app.spec.ts hat einen Dauerbeleg angelegt").not.toBeNull();
  await open(page, path!);
  expect(await axe(page), path!).toEqual([]);
});

test.describe("Handy", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  for (const group of chunks(PAGES, GROUP)) {
    test(`Ohne axe-Verstöße: ${group.join(", ")}`, async ({ page }) => {
      await withTheme(page, "wald");
      for (const path of group) {
        await open(page, path);
        expect.soft(await axe(page), `Handy ${path}`).toEqual([]);
      }
    });
  }

  test("Offenes Menü ohne Verstöße, Escape schließt das Menü", async ({ page }) => {
    await withTheme(page, "wald");
    await open(page, "/");
    const menu = page.getByRole("button", { name: "Menü" });
    await tabTo(page, "Menü");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(await axe(page), "Handy, Menü offen").toEqual([]);
    // Mit Tab ins Menü, Escape schließt es und der Fokus steht wieder auf dem Menüknopf
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Übersicht" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
  });
});

test("Sprunglink führt zum Inhalt, Seitenwechsel per Tastatur setzt den Fokus auf den Inhalt", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Zum Inhalt springen" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  // Der nächste Tab landet im Inhalt, nicht wieder in der Navigation
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("main")))).toBe(true);

  await open(page, "/");
  await tabTo(page, "Rechnungen");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/rechnungen$/);
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Rechnungen", level: 1 })).toBeVisible();
});

const FOCUS_PAGES = [
  "/",
  "/rechnungen",
  "/rechnungen/neu",
  "/belege",
  "/bank",
  "/kasse",
  "/kontakte",
  "/auswertungen",
  "/fristen",
  "/einstellungen",
  "/einstellungen?bereich=export",
];

for (const group of chunks(FOCUS_PAGES, GROUP)) {
  test(`Jedes Element mit Tastaturfokus hat einen sichtbaren Rahmen: ${group.join(", ")}`, async ({ page }) => {
    for (const path of group) await visibleFocus(page, path);
  });
}

async function visibleFocus(page: Page, path: string) {
  await open(page, path);
  const seen = new Set<string>();
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const id = el.outerHTML.slice(0, 120);
      // Versteckte Dateiauswahl: den Rahmen trägt der sichtbare Knopf daneben
      const shown = el.classList.contains("visually-hidden") && el.nextElementSibling ? (el.nextElementSibling as HTMLElement) : el;
      const style = getComputedStyle(shown);
      const ring = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
      // Das Suchfeld zeigt den Fokus am umgebenden Kasten
      const box = el.closest(".search-box");
      const boxRing = box ? getComputedStyle(box).outlineStyle !== "none" : false;
      // SVG-Elemente (Monate im Diagramm) markieren den Fokus selbst
      const svg = el instanceof SVGElement && getComputedStyle(el.querySelector(".hit") ?? el).strokeWidth !== "0px";
      return { id, visible: ring || boxRing || svg };
    });
    if (!focus || seen.has(focus.id)) break;
    seen.add(focus.id);
    expect.soft(focus.visible, `${path}: sichtbarer Fokus auf ${focus.id}`).toBe(true);
  }
  expect(seen.size, `${path}: mit Tab erreichbare Elemente`).toBeGreaterThan(5);
}

test("Seitenwechsel über einen Link im Inhalt setzt den Fokus auf den Inhalt", async ({ page }) => {
  // Von der Übersicht auf eine andere Seite: der Link verschwindet mit der Übersicht, der Fokus darf nicht verloren gehen
  await open(page, "/");
  await page.getByRole("main").getByRole("link", { name: "Neue Rechnung" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/rechnungen\/neu$/);
  await expect(page.getByRole("button", { name: "Entwurf speichern" })).toBeVisible();
  await expect(page.getByRole("main")).toBeFocused();
});

test("Archiv: Nur der gewählte Bereich und die gewählten Filter tragen aria-current", async ({ page }) => {
  // TanStack Router setzt aria-current="page" selbst, sobald die Suchparameter eines Links nur teilweise passen;
  // „Alle“ und „Umzug“ setzen ihren Parameter auf undefined und galten deshalb immer als aktiv
  await open(page, "/archiv?ansicht=belege&richtung=ausgabe&ohneDatei=true");
  const current = (scope: ReturnType<Page["getByRole"]>) =>
    scope.getByRole("link").evaluateAll((links) => links.filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent));
  expect(await current(page.getByRole("navigation", { name: "Bereich wählen" }))).toEqual(["Belege"]);
  expect(await current(page.getByRole("group", { name: "Richtung" }))).toEqual(["Ausgaben", "Ohne Datei"]);

  await open(page, "/archiv?ansicht=belege");
  expect(await current(page.getByRole("group", { name: "Richtung" }))).toEqual(["Alle"]);
});

test("Feld aus der gemeinsamen Komponente: Nur der Name klickt, der Hinweis gehört zur Beschreibung", async ({ page }) => {
  await open(page, "/kontakte/neu");
  const feld = page.getByRole("textbox", { name: "Ort", exact: true });
  const flaeche = await feld.boundingBox();
  if (!flaeche) throw new Error("Feld ohne Fläche");

  // Auf Höhe des Feldnamens am rechten Rand des Felds: dort steht nichts mehr
  await page.mouse.click(flaeche.x + flaeche.width - 8, flaeche.y - 14);
  await expect(feld).not.toBeFocused();
  await page.getByText("Ort", { exact: true }).click();
  await expect(feld).toBeFocused();

  const email = page.getByRole("textbox", { name: "E-Mail", exact: true });
  await expect(email).toHaveAccessibleDescription(/Mehrere Adressen/);
});

/** Felder, die nicht über `Field` gebaut sind: ein umschließendes `label.field`, oder ein Feldname, dessen `for` ins Leere zeigt */
function fieldsOffComponent(p: Page) {
  return p.evaluate(() => {
    const where = (el: Element) => `${el.tagName.toLowerCase()}.${el.className} „${(el.textContent ?? "").trim().slice(0, 40)}“`;
    const wrapping = [...document.querySelectorAll("label.field")].map((el) => `umschließendes ${where(el)}`);
    const dangling = [...document.querySelectorAll(".field")].flatMap((field) => {
      const name = field.querySelector(":scope > .field-label");
      if (!name) return [];
      const id = name.getAttribute("for");
      const target = id ? document.getElementById(id) : null;
      const labels = target && "labels" in target ? [...((target as HTMLInputElement).labels ?? [])] : [];
      return labels.includes(name as HTMLLabelElement) ? [] : [`Feldname ohne Feld: ${where(name)} (for=${id})`];
    });
    return [...wrapping, ...dangling];
  });
}

// Was nur hinter einem Zustand erscheint (Dialoge, aufgeklappte Bereiche, Fehler), sieht dieser Test nicht; dafür gilt das AST-Inventar der Umstellung
for (const group of chunks(PAGES, GROUP)) {
  test(`Alle Felder stammen aus der gemeinsamen Komponente: ${group.join(", ")}`, async ({ page }) => {
    for (const path of group) {
      await open(page, path);
      expect.soft(await fieldsOffComponent(page), path).toEqual([]);
    }
  });
}

/** Verweise (`aria-describedby`, `aria-labelledby`, `list`), deren Ziel im Dokument fehlt, als lesbare Liste */
function danglingReferences(p: Page) {
  return p.evaluate(() =>
    ["aria-describedby", "aria-labelledby", "list"].flatMap((name) =>
      [...document.querySelectorAll(`[${name}]`)].flatMap((el) =>
        (el.getAttribute(name) ?? "")
          .split(/\s+/)
          .filter((id) => id && !document.getElementById(id))
          .map((id) => `${el.tagName.toLowerCase()} ${name}→${id}`),
      ),
    ),
  );
}

test("Felder mit zustandsabhängigem Hinweis verweisen auf vorhandene Ziele: Zahlungsart Lastschrift", async ({ page }) => {
  await open(page, "/rechnungen/wiederkehrend/neu");
  const zahlungsart = page.getByLabel("Zahlungsart");
  for (const art of ["ueberweisung", "lastschrift"]) {
    await zahlungsart.selectOption(art);
    expect(await danglingReferences(page), art).toEqual([]);
  }
  await expect(zahlungsart).toHaveAccessibleDescription(/Jede Rechnung nimmt das jüngste Mandat/);
});

/** Seiten mit dem Dateiwähler `FilePicker`; der Knopf daneben ist nur ein `span`, der Klick muss den Dialog selbst öffnen */
const FILE_PICKER_PAGES = [
  "/dauerbelege/neu",
  "/csv-import?art=kontakte",
  "/einstellungen?bereich=bank",
  "/einstellungen?bereich=elster",
  "/archiv",
  "/archiv/auftrag/723bf34b-f8ab-48f0-b391-656af4b72a96",
];

test("Dateiwähler: Ein Klick auf „Datei wählen“ öffnet an jeder Stelle den Dialog und der Feldname benennt das Feld", async ({ page }) => {
  for (const path of FILE_PICKER_PAGES) {
    await open(page, path);
    const pickers = page.locator(".file-picker");
    expect(await pickers.count(), `${path} hat einen Dateiwähler`).toBeGreaterThan(0);
    for (let i = 0; i < (await pickers.count()); i++) {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5_000 }), pickers.nth(i).locator(".btn").click()]);
      expect(chooser, `${path} Nr. ${i + 1}`).toBeTruthy();
      const input = pickers.nth(i).locator("input[type=file]");
      expect(await input.evaluate((el: HTMLInputElement) => el.labels?.length ?? 0), `${path} Nr. ${i + 1}: Feldname`).toBeGreaterThan(0);
    }
  }
});

test("Dateiwähler im Graph-Versand: Klick öffnet den Dialog, Hinweis gehört zum Eingabefeld", async ({ page }) => {
  await open(page, "/einstellungen?bereich=email");
  await page.getByLabel("Versandweg").selectOption("graph");
  for (const name of ["Zertifikat", "Privater Schlüssel"]) {
    const feld = page
      .locator(".field", { has: page.getByText(name, { exact: false }) })
      .locator(".file-picker")
      .first();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5_000 }), feld.locator(".btn").click()]);
    expect(chooser, name).toBeTruthy();
  }
});
