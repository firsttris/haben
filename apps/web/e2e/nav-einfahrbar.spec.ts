import { expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";
import { axeVerstoesse } from "./einrichtung.ts";

/**
 * Einfahrbare Seitenleiste am Desktop: prüft Einklappen auf 64 px, Beibehalten beim Neuladen ohne Sprung,
 * Tastaturbedienung der Gruppen-Flyouts (Enter, Tab, Esc), Barrierefreiheit (axe) und unverändertes Handymenü.
 */
test.use({ storageState: SESSION });

const nav = (page: Page) => page.getByRole("navigation", { name: "Hauptnavigation" });

test("klappt am Desktop ein, bleibt beim Neuladen schmal und bedient Flyouts per Tastatur", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });

  const navEl = nav(page);
  const breiteAusgeklappt = await navEl.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(breiteAusgeklappt).toBeGreaterThanOrEqual(220);

  await navEl.getByRole("button", { name: "Seitenleiste einklappen" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
  const breiteEingeklappt = await navEl.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(breiteEingeklappt).toBe(64);

  // Neuladen behält die schmale Leiste sofort bei
  // Der Server liefert die schmale Leiste schon fertig; bedienen lässt sie sich erst nach dem Hydrieren
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
  const breiteNachReload = await nav(page).evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(breiteNachReload).toBe(64);

  expect(await axeVerstoesse(page)).toEqual([]);

  // Gruppen-Flyout öffnen per Tastatur und per Esc zurück auf den Knopf schließen
  const verkaufBtn = nav(page).getByRole("button", { name: "Verkauf" });
  await verkaufBtn.focus();
  await page.keyboard.press("Enter");
  await expect(verkaufBtn).toHaveAttribute("aria-expanded", "true");

  const angeboteLink = nav(page).getByRole("link", { name: "Angebote" });
  await expect(angeboteLink).toBeVisible();
  await expect(angeboteLink).toBeFocused();
  expect(await axeVerstoesse(page)).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(verkaufBtn).toHaveAttribute("aria-expanded", "false");
  await expect(verkaufBtn).toBeFocused();

  // Klick auf einen Link navigiert und schließt das Flyout
  await verkaufBtn.click();
  await nav(page).getByRole("link", { name: "Rechnungen" }).click();
  await expect(page).toHaveURL(/\/rechnungen/);
  await expect(verkaufBtn).toHaveAttribute("aria-expanded", "false");
  await expect(verkaufBtn).toHaveAttribute("data-active", "true");

  // Konto & Darstellung Flyout öffnet sich und schließt per Esc
  const kontoBtn = nav(page).getByRole("button", { name: "Konto & Darstellung" });
  await kontoBtn.click();
  await expect(kontoBtn).toHaveAttribute("aria-expanded", "true");
  await expect(nav(page).getByRole("button", { name: "Abmelden" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(kontoBtn).toHaveAttribute("aria-expanded", "false");
  await expect(kontoBtn).toBeFocused();

  // Am Handy bleibt das gewohnte Menü unverändert
  await page.setViewportSize({ width: 375, height: 812 });
  const menuKnopf = nav(page).getByRole("button", { name: "Menü" });
  await expect(menuKnopf).toBeVisible();
  await expect(nav(page).getByRole("button", { name: "Seitenleiste ausklappen" })).toBeHidden();

  // Zurück am Desktop lässt sich die Leiste wieder ausklappen
  await page.setViewportSize({ width: 1280, height: 800 });
  await nav(page).getByRole("button", { name: "Seitenleiste ausklappen" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-nav");
  expect(await nav(page).evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBeGreaterThanOrEqual(220);
});

test("eingeklappt öffnen Lupe und Strg+K die Befehlspalette, ein offenes Flyout schließt dabei", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();

  const suche = nav(page).getByRole("button", { name: "Schnellsuche" });
  await expect(suche).toBeVisible();
  const passt = await suche.evaluate((knopf) => {
    const leiste = knopf.closest("nav")!.getBoundingClientRect();
    const rect = knopf.getBoundingClientRect();
    return { breite: Math.round(rect.width), drin: rect.left >= leiste.left && rect.right <= leiste.right };
  });
  expect(passt).toEqual({ breite: 40, drin: true });

  const dialog = page.getByRole("dialog", { name: "Befehlspalette" });
  await suche.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(suche).toBeFocused();

  const verkauf = nav(page).getByRole("button", { name: "Verkauf" });
  await verkauf.click();
  await expect(verkauf).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await expect(verkauf).toHaveAttribute("aria-expanded", "false");
  await dialog.getByRole("combobox").fill("Dauerbe");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/dauerbelege$/);
  await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
  await expect(nav(page).getByRole("button", { name: "Ausgaben" })).toHaveAttribute("data-active", "true");
});

test("eingeklappt: Überfahren öffnet die Gruppe, Hinweise statt title, aktiv anders als offen, Knopf ganz unten", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/rechnungen", { waitUntil: "networkidle" });

  // Ausgeklappt steht der Knopf als Letztes in der Leiste, unter der Versionsnummer
  const einklappen = nav(page).getByRole("button", { name: "Seitenleiste einklappen" });
  const version = nav(page).getByRole("link", { name: /^Haben \d/ });
  const obenAusgeklappt = async (el: typeof einklappen) => (await el.boundingBox())?.y ?? 0;
  expect(await obenAusgeklappt(einklappen)).toBeGreaterThan(await obenAusgeklappt(version));
  await einklappen.click();

  // Eingeklappt ebenso ganz unten, unter dem Avatar
  const ausklappen = nav(page).getByRole("button", { name: "Seitenleiste ausklappen" });
  const konto = nav(page).getByRole("button", { name: /Konto & Darstellung/ });
  expect(await obenAusgeklappt(ausklappen)).toBeGreaterThan(await obenAusgeklappt(konto));

  // Überfahren öffnet das Flyout, ohne den Fokus zu nehmen; Verlassen schließt es
  const ausgaben = nav(page).getByRole("button", { name: "Ausgaben" });
  await ausgaben.hover();
  await expect(ausgaben).toHaveAttribute("aria-expanded", "true");
  await expect(nav(page).getByRole("link", { name: "Belege", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest(".nav-flyout") ?? null)).toBeNull();

  // Die Gruppe der aktiven Seite (Verkauf, zu) sieht anders aus als die offene Gruppe (Ausgaben)
  const verkauf = nav(page).getByRole("button", { name: "Verkauf" });
  await expect(verkauf).toHaveAttribute("data-active", "true");
  const flaeche = (el: typeof verkauf) => el.evaluate((knopf) => getComputedStyle(knopf).backgroundColor);
  expect(await flaeche(verkauf)).not.toBe(await flaeche(ausgaben));

  // Flyout im Stil der Menüs: Ecken 8px, Kopf ohne Linie
  const flyout = nav(page).getByRole("group", { name: "Ausgaben" });
  expect(
    await flyout.evaluate((el) => ({
      ecken: getComputedStyle(el).borderTopLeftRadius,
      linie: getComputedStyle(el.querySelector(".nav-flyout-title")!).borderBottomWidth,
    })),
  ).toEqual({ ecken: "8px", linie: "0px" });

  await page.mouse.move(900, 600);
  await expect(ausgaben).toHaveAttribute("aria-expanded", "false");

  // Übersicht trägt keinen title, sondern einen Hinweis, der beim Überfahren und mit Fokus erscheint und mit Esc geht
  const uebersicht = nav(page).getByRole("link", { name: "Übersicht" });
  await expect(uebersicht).not.toHaveAttribute("title");
  const hinweis = nav(page).locator(".nav-tip", { hasText: /^Übersicht$/ });
  await uebersicht.hover();
  await expect(hinweis).toBeVisible();
  // Runde Ecken auf allen Seiten, 4px neben der Leiste wie das Flyout, und der Zeiger erreicht ihn über die Lücke
  expect(
    await hinweis.evaluate((el) => {
      const stil = getComputedStyle(el);
      return { links: Math.round(el.getBoundingClientRect().left), rand: stil.borderLeftWidth, ecke: stil.borderTopLeftRadius };
    }),
  ).toEqual({ links: 68, rand: "0px", ecke: "8px" });
  await hinweis.hover();
  await expect(hinweis).toBeVisible();
  await uebersicht.hover();
  await page.keyboard.press("Escape");
  await expect(hinweis).toBeHidden();
  await page.mouse.move(900, 600);
  await uebersicht.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(uebersicht).toBeFocused();
  await expect(hinweis).toBeVisible();
});

test("eingeklappt liefert schon der Server die schmale Leiste, damit beim Laden nichts nachrückt", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();
  const html = await (await page.request.get("/rechnungen")).text();
  expect(html).toContain("nav-rail-trigger");
});

test("eingeklappt: von Gruppe zu Gruppe bleibt das neue Flyout offen, das Schließen der alten trifft es nicht", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();
  const verkauf = nav(page).getByRole("button", { name: "Verkauf" });
  const ausgaben = nav(page).getByRole("button", { name: "Ausgaben" });
  await verkauf.hover();
  await expect(verkauf).toHaveAttribute("aria-expanded", "true");
  // Senkrecht nach unten aufs nächste Symbol, dann stehen bleiben: länger als der Verzug beim Schließen der alten Gruppe
  await ausgaben.hover();
  await expect(ausgaben).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(600);
  await expect(ausgaben).toHaveAttribute("aria-expanded", "true");
  await expect(verkauf).toHaveAttribute("aria-expanded", "false");
});

test("eingeklappt liegen Hinweis und Flyout über dem stehenden Seitenkopf", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/leistungen", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();
  const suche = nav(page).getByRole("button", { name: "Schnellsuche" });
  await suche.hover();
  const hinweis = suche.locator(".nav-tip");
  await expect(hinweis).toBeVisible();
  // Oben links im Hinweis, wo der Seitenkopf daneben liegt: Was dort oben aufliegt, muss der Hinweis sein
  const oben = await hinweis.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return document.elementFromPoint(rect.right - 8, rect.top + 4)?.closest(".nav-tip") === el;
  });
  expect(oben).toBe(true);

  // Die Lupe behält beim Überfahren die Fläche der Navigation, nicht die helle der Knöpfe auf der Seite
  const flaeche = () =>
    suche.evaluate((knopf) => {
      const probe = document.createElement("div");
      probe.style.background = "var(--nav-active)";
      knopf.closest("nav")!.append(probe);
      const soll = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return getComputedStyle(knopf).backgroundColor === soll;
    });
  // Nach dem Übergang (--fade)
  await expect.poll(flaeche).toBe(true);
});

test("eingeklappt zeigt die Marke beim Überfahren „Haben“ und die Firma, in der man bucht", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  const firma = (await nav(page).locator(".brand-firma").textContent())?.trim();
  expect(firma).toBeTruthy();
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();
  const marke = nav(page).locator(".brand");
  await marke.hover();
  const text = marke.locator(".brand-text");
  await expect(text).toBeVisible();
  await expect(text).toContainText(firma!);
  expect(await text.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(40);
});

test("eingeklappt: ein Klick heftet das überfahrene Flyout an, Esc hält den Hinweis aus, solange der Zeiger auf dem Symbol bleibt", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();

  const geld = nav(page).getByRole("button", { name: "Geld" });
  await geld.hover();
  await expect(geld).toHaveAttribute("aria-expanded", "true");
  await geld.click();
  await page.mouse.move(900, 600);
  await page.waitForTimeout(600);
  await expect(geld).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(geld).toHaveAttribute("aria-expanded", "false");

  // Esc blendet den Hinweis aus; eine Bewegung innerhalb des Symbols (auf das svg) holt ihn nicht zurück
  const uebersicht = nav(page).getByRole("link", { name: "Übersicht" });
  const box = (await uebersicht.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 4);
  const hinweis = uebersicht.locator(".nav-tip");
  await expect(hinweis).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(hinweis).toBeHidden();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(100);
  await expect(hinweis).toBeHidden();
});

test("eingeklappt: ein per Fokus gezeigter und mit Esc ausgeblendeter Hinweis bleibt aus, wenn die Maus über die Seite zieht", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();
  const uebersicht = nav(page).getByRole("link", { name: "Übersicht" });
  const hinweis = uebersicht.locator(".nav-tip");
  await page.mouse.move(900, 600);
  await uebersicht.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(uebersicht).toBeFocused();
  await expect(hinweis).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(hinweis).toBeHidden();
  // Von Element zu Element auf der Seite, weit weg vom Symbol
  await page.mouse.move(400, 150, { steps: 10 });
  await page.mouse.move(1100, 700, { steps: 10 });
  await page.waitForTimeout(100);
  await expect(hinweis).toBeHidden();
});

test("eingeklappt gespeichert, aber schmal: Esc über der Marke geht an die Seite, weil kein Hinweis zu sehen ist", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
  // Steht für die Tasten der Seite, etwa Esc in der Belegansicht zurück zur Liste
  await page.evaluate(() => {
    const w = window as unknown as { escAnSeite: number };
    w.escAnSeite = 0;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) w.escAnSeite++;
    });
  });
  await nav(page).locator(".brand").hover();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as unknown as { escAnSeite: number }).escAnSeite)).toBe(1);
});

test("Strg+B klappt die Seitenleiste am Desktop ein und aus, nicht in Eingabefeldern", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  const einklappen = nav(page).getByRole("button", { name: "Seitenleiste einklappen" });
  await expect(einklappen).toHaveAttribute("aria-keyshortcuts", "Control+B Meta+B");
  await page.keyboard.press("Control+b");
  await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
  await page.keyboard.press("Control+b");
  await expect(page.locator("html")).not.toHaveAttribute("data-nav");

  // In einem Feld bleibt Strg+B beim Feld: Fett in den Textfeldern der Belege, außerhalb eines Dialogs
  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  const feld = page.locator(".format-field textarea").first();
  await feld.fill("Bitte zahlen");
  await feld.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 12));
  await page.keyboard.press("Control+b");
  await expect(feld).toHaveValue("Bitte *zahlen*");
  await expect(page.locator("html")).not.toHaveAttribute("data-nav");
});

test("eingeklappt: Pfeiltasten wandern durch Leiste und Flyout, → öffnet, ← schließt", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();

  const uebersicht = nav(page).getByRole("link", { name: "Übersicht" });
  const verkauf = nav(page).getByRole("button", { name: "Verkauf" });
  await uebersicht.focus();
  await page.keyboard.press("ArrowDown");
  await expect(verkauf).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(verkauf).toHaveAttribute("aria-expanded", "true");
  await expect(nav(page).getByRole("link", { name: "Angebote" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(nav(page).getByRole("link", { name: "Rechnungen", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(nav(page).getByRole("link", { name: "Angebote" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(verkauf).toHaveAttribute("aria-expanded", "false");
  await expect(verkauf).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(uebersicht).toBeFocused();
  // Die Seite bekommt die Pfeile nicht (die Beleg-Ansicht blättert sonst mit ← und →)
  await expect(page).toHaveURL(/\/$/);
});

test("eingeklappt: → in ein überfahrenes Flyout heftet es an, die Maus schließt es danach nicht", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();

  const verkauf = nav(page).getByRole("button", { name: "Verkauf" });
  await verkauf.focus();
  await verkauf.hover();
  await expect(verkauf).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  const angebote = nav(page).getByRole("link", { name: "Angebote" });
  await expect(angebote).toBeFocused();
  await page.mouse.move(900, 600, { steps: 5 });
  // Länger als der Verzug, nach dem Verlassen ein überfahrenes Flyout schließt
  await page.waitForTimeout(600);
  await expect(verkauf).toHaveAttribute("aria-expanded", "true");
  await expect(angebote).toBeFocused();
});

test("eingeklappt: kein Pfeil aus Leiste oder Flyout erreicht die Seite", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();
  // Steht für die Tasten der Seite, etwa ← → in der Beleg-Ansicht (vorheriger, nächster Beleg)
  await page.evaluate(() => {
    const w = window as unknown as { pfeileAnSeite: string[] };
    w.pfeileAnSeite = [];
    window.addEventListener("keydown", (event) => {
      if (event.key.startsWith("Arrow")) w.pfeileAnSeite.push(event.key);
    });
  });

  const verkauf = nav(page).getByRole("button", { name: "Verkauf" });
  await verkauf.focus();
  await page.keyboard.press("ArrowRight");
  // → auf einem Link im Flyout, ← schließt, ein zweites ← auf dem Symbol
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(verkauf).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  // Symbol ohne Flyout
  await nav(page).getByRole("link", { name: "Übersicht" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  expect(await page.evaluate(() => (window as unknown as { pfeileAnSeite: string[] }).pfeileAnSeite)).toEqual([]);
});

test("eingeklappt: Marke und Lupe gehören zum Kreis der Symbole für ↑/↓", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("button", { name: "Seitenleiste einklappen" }).click();

  const marke = nav(page).locator(".brand");
  const lupe = nav(page).getByRole("button", { name: "Schnellsuche" });
  const ausklappen = nav(page).getByRole("button", { name: "Seitenleiste ausklappen" });
  await marke.focus();
  await page.keyboard.press("ArrowDown");
  await expect(lupe).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(marke).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(ausklappen).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(marke).toBeFocused();
});
