import { expect, type Locator, type Page, test } from "@playwright/test";
import { firstLink, SESSION, YEAR } from "./daten.ts";
import { kundeWaehlen, neuenKontaktOeffnen } from "./einrichtung.ts";
import { HANDY, kopfUnterkante, LAPTOP, leisteOberkante, sichtbar, statusBleibtSichtbar, zumEnde } from "./kopfzeile.ts";

/**
 * Fester Seitenkopf (#356): Titel, Status und Hauptaktionen bleiben beim Scrollen stehen, in den Einstellungen auch
 * die Bereiche. Was unter dem Kopf steht (Tabellenköpfe, Felder mit Fokus), verschwindet nicht dahinter.
 * Mit den Daten und der Sitzung aus app.spec.ts (Projekt „mit-daten“); geschrieben wird nichts.
 */

test.use({ storageState: SESSION });

for (const [geraet, viewport] of [
  ["Laptop", LAPTOP],
  ["Handy", HANDY],
] as const) {
  test(`Rechnungsentwurf am ${geraet}: Titel, Status und Aktionen bleiben beim Scrollen sichtbar`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/rechnungen/neu");
    const head = page.locator(".main > .page-head");
    const bar = page.locator(".main > .action-bar");
    await expect(head.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".shell")).not.toHaveAttribute("data-scrolled");
    await zumEnde(page);
    await expect(page.locator(".shell")).toHaveAttribute("data-scrolled");
    await sichtbar(head.getByRole("heading", { level: 1 }));
    await sichtbar(head.getByText("Entwurf", { exact: false }).first());
    if (geraet === "Handy") {
      await expect(head.locator(".actions")).toBeHidden();
      const weitere = bar.getByRole("button", { name: "Weitere Aktionen" });
      const vorschau = bar.getByRole("button", { name: "Vorschau", exact: true });
      const speichern = bar.getByRole("button", { name: "Entwurf speichern" });
      const festschreiben = bar.getByRole("button", { name: "Festschreiben" });
      await sichtbar(weitere);
      await sichtbar(vorschau);
      await sichtbar(speichern);
      await sichtbar(festschreiben);
      const weitereBox = await weitere.boundingBox();
      const vorschauBox = await vorschau.boundingBox();
      expect(weitereBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect(vorschauBox?.x ?? 0).toBeGreaterThan(weitereBox?.x ?? 0);
      // Bricht die Leiste um, füllt „Festschreiben“ die zweite Zeile; es bleibt rechts (DESIGN.md, Reihenfolge der Knöpfe)
      const rechtsBis = async (knopf: Locator) => ((await knopf.boundingBox())?.x ?? 0) + ((await knopf.boundingBox())?.width ?? 0);
      expect(await rechtsBis(festschreiben)).toBeGreaterThanOrEqual(await rechtsBis(speichern));
    } else {
      await expect(bar).toBeHidden();
      await sichtbar(head.getByRole("button", { name: "Vorschau", exact: true }));
      await sichtbar(head.getByRole("button", { name: "Speichern und als PDF" }));
      const speichern = head.getByRole("button", { name: "Entwurf speichern" });
      const festschreiben = head.getByRole("button", { name: "Festschreiben" });
      await sichtbar(speichern);
      await sichtbar(festschreiben);
      expect((await festschreiben.boundingBox())?.x ?? 0).toBeGreaterThan((await speichern.boundingBox())?.x ?? 0);
    }
  });

  test(`Einstellungen am ${geraet}: Kopf und Bereiche bleiben stehen, nur der Inhalt scrollt`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/einstellungen?bereich=firma");
    await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    await zumEnde(page);
    await sichtbar(page.getByRole("heading", { level: 1, name: "Einstellungen" }));
    const bereiche = page.getByRole("navigation", { name: "Bereiche der Einstellungen" });
    await sichtbar(bereiche.locator("[aria-current=page]"));
    const oben = await bereiche.evaluate((nav) => nav.getBoundingClientRect().top);
    expect(oben).toBeGreaterThanOrEqual((await kopfUnterkante(page)) - 1);
  });
}

// Das Angebot prüft rechnungen.spec.ts: seit #381 legt app.spec.ts keine Angebote mehr an
test("Rechnung am Handy: Status bleibt neben dem Titel sichtbar", async ({ page }) => {
  const rechnung = await firstLink(page, "/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/);
  expect(rechnung).not.toBeNull();
  await statusBleibtSichtbar(page, rechnung as string);
});

test("Umsatzsteuer-Voranmeldung am Handy: Status bleibt neben dem Titel sichtbar", async ({ page }) => {
  await statusBleibtSichtbar(page, `/umsatzsteuer/${YEAR}-Q1`);
});

for (const [geraet, viewport] of [
  ["Laptop", LAPTOP],
  ["Handy", HANDY],
] as const) {
  test(`Tab vorwärts und rückwärts durch den Rechnungsentwurf am ${geraet}: kein Feld mit Fokus liegt unter Kopf oder Leiste`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/rechnungen/neu");
    const felder = page.locator("#invoice-form").locator("select, input:not([type=hidden]), textarea");
    await felder.first().focus();
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el?.closest("#invoice-form")) return "ende";
        const box = el.getBoundingClientRect();
        return { name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName, top: box.top, bottom: box.bottom };
      });
      if (focus === "ende") break;
      expect(focus.top, `vorwärts: „${focus.name}“ liegt unter dem Kopf`).toBeGreaterThanOrEqual((await kopfUnterkante(page)) - 1);
      expect(focus.bottom, `vorwärts: „${focus.name}“ liegt unter der Aktionsleiste`).toBeLessThanOrEqual((await leisteOberkante(page)) + 1);
    }
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    // Rückwärts tabben bis zum ersten Feld
    await felder.last().focus();
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Shift+Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el?.closest("#invoice-form")) return "anfang";
        const box = el.getBoundingClientRect();
        return { name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName, top: box.top, bottom: box.bottom };
      });
      if (focus === "anfang") break;
      expect(focus.top, `rückwärts: „${focus.name}“ liegt unter dem Kopf`).toBeGreaterThanOrEqual((await kopfUnterkante(page)) - 1);
      expect(focus.bottom, `rückwärts: „${focus.name}“ liegt unter der Aktionsleiste`).toBeLessThanOrEqual((await leisteOberkante(page)) + 1);
    }
  });
}

test("Rechnungsentwurf am Handy: Weitere Aktionen in der Aktionsleiste per Tastatur bedienbar (Enter, Esc)", async ({ page }) => {
  await page.setViewportSize(HANDY);
  await page.goto("/rechnungen/neu");
  const bar = page.locator(".main > .action-bar");
  const weitere = bar.getByRole("button", { name: "Weitere Aktionen" });
  await weitere.focus();
  await page.keyboard.press("Enter");
  await expect(weitere).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu");
  const pdf = page.getByRole("menuitem", { name: "Speichern und als PDF" });
  await expect(pdf).toBeFocused();
  const menuBox = await menu.boundingBox();
  const weitereBox = await weitere.boundingBox();
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual((weitereBox?.y ?? 0) + 1);
  expect(menuBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(weitere).toBeFocused();
});

test("Saldenliste: der Tabellenkopf steht unter dem Seitenkopf, nicht dahinter", async ({ page }) => {
  await page.setViewportSize({ width: LAPTOP.width, height: 500 });
  await page.goto(`/konten?jahr=${YEAR}`);
  const th = page.locator(".sticky-head thead th").first();
  await expect(th).toBeVisible();
  // In die Mitte der Tabelle: dort muss ihr Kopf stehen bleiben; am Seitenende wäre die Tabelle schon vorbei
  const mitte = await page.locator(".sticky-head").evaluate((table) => {
    const box = table.getBoundingClientRect();
    return window.scrollY + box.top + box.height / 2 - 200;
  });
  await page.evaluate((y) => window.scrollTo(0, y), mitte);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  const oben = await th.evaluate((cell) => cell.getBoundingClientRect().top);
  expect(oben).toBeGreaterThanOrEqual((await kopfUnterkante(page)) - 1);
  await sichtbar(th);
});

test("Festschreiben in der Aktionsleiste am Handy: die Rückfrage erscheint im Fenster, auch weit unten auf der Seite", async ({ page }) => {
  await page.setViewportSize(HANDY);
  await page.goto("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100");
  await zumEnde(page);
  // Der Klick fragt nur nach, geschrieben wird nichts
  await page.locator(".main > .action-bar").getByRole("button", { name: "Festschreiben" }).click();
  await sichtbar(page.getByRole("dialog", { name: /festschreiben\?$/ }));
});

test("Einstellungen am Handy, rückwärts tabben: kein Feld mit Fokus liegt unter der Zeile der Bereiche", async ({ page }) => {
  await page.setViewportSize(HANDY);
  await page.goto("/einstellungen?bereich=firma");
  const felder = page.locator(".settings-content").locator("input:not([type=hidden]), select, textarea");
  await felder.last().focus();
  const bereiche = page.getByRole("navigation", { name: "Bereiche der Einstellungen" });
  let geprueft = 0;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Shift+Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el?.closest(".settings-content")) return "ende";
      const box = el.getBoundingClientRect();
      return { name: el.getAttribute("aria-label") ?? (el as HTMLInputElement).labels?.[0]?.textContent?.trim().slice(0, 40) ?? el.tagName, top: box.top };
    });
    if (focus === "ende") break;
    const unterkante = await bereiche.evaluate((nav) => nav.getBoundingClientRect().bottom);
    expect(focus.top, `„${focus.name}“ liegt unter der Zeile der Bereiche`).toBeGreaterThanOrEqual(unterkante - 1);
    geprueft++;
  }
  expect(geprueft).toBeGreaterThan(5);
});

for (const [geraet, viewport] of [
  ["Laptop", LAPTOP],
  ["Handy", HANDY],
] as const) {
  test(`Kontaktdialog am ${geraet}: Titel und Knöpfe bleiben stehen, nur das Formular scrollt`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
    // Öffnen und Abbrechen: geschrieben wird nichts
    await neuenKontaktOeffnen(page);
    const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
    const titel = dialog.getByRole("heading", { name: "Neuen Kunden anlegen" });
    const anlegen = dialog.getByRole("button", { name: "Kontakt anlegen" });
    await sichtbar(titel);
    await sichtbar(anlegen);
    // Wie der Seitenkopf: Der Titel hat die Größe der Seitentitel, nicht die einer Abschnittsüberschrift
    const groesse = (el: Locator) => el.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
    expect(await groesse(titel)).toBeGreaterThan(await groesse(dialog.getByRole("heading", { name: "Allgemein" })));
    expect(await groesse(titel)).toBeGreaterThanOrEqual(20);

    const unten = dialog.locator(".form-section select").last();
    await unten.focus();
    await sichtbar(titel);
    await sichtbar(anlegen);
    await sichtbar(dialog.getByRole("button", { name: "Abbrechen" }));
    await sichtbar(unten);
    // Rückwärts tabben: kein Feld mit Fokus liegt unter dem Titel oder den Knöpfen
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Shift+Tab");
      const fokus = page.locator(":focus");
      await sichtbar(fokus);
    }
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toBeHidden();
  });
}

for (const [geraet, viewport] of [
  ["Laptop", LAPTOP],
  ["Handy", HANDY],
] as const) {
  test(`Kontaktdialog am ${geraet}: Fehlermeldung nach Klick auf den stehenden Knopf ist sichtbar`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // Erst nach der Hydration klicken, sonst öffnet der Knopf den Dialog nicht
    await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
    await neuenKontaktOeffnen(page);
    const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
    await dialog.getByLabel("Name").first().fill("Prüfkunde");
    // Ganz oben im Formular beide Rollen abwählen, dann den stehenden Knopf klicken: die Meldung steht am Ende des
    // Formulars und muss ins Bild kommen; gespeichert wird nichts
    for (const box of await dialog.getByRole("checkbox").all()) if (await box.isChecked()) await box.uncheck();
    await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
    const meldung = dialog.getByRole("alert");
    await expect(meldung).toHaveText("Ein Kontakt ist Kunde oder Lieferant oder beides.");
    await sichtbar(meldung);
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
  });
}

for (const [geraet, viewport] of [
  ["Laptop", LAPTOP],
  ["Handy", HANDY],
  ["Handy quer", { width: HANDY.height, height: HANDY.width }],
] as const) {
  test(`Kontaktdialog am ${geraet}, rückwärts tabben: der Fokusrahmen wird oben nicht abgeschnitten`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // Erst nach der Hydration klicken, sonst öffnet der Knopf den Dialog nicht
    await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
    await neuenKontaktOeffnen(page);
    const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Kontakt anlegen" }).focus();
    const abgeschnitten: string[] = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Shift+Tab");
      const fokus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const form = el.closest<HTMLElement>(".form-dialog > .contact-form");
        if (!form || el.closest(".form-footer")) return null;
        // Fokusrahmen: 2 px Linie mit 2 px Abstand (styles.css, :focus-visible)
        const oben = el.getBoundingClientRect().top - 4 - (form.getBoundingClientRect().top + form.clientTop);
        return { name: el.getAttribute("name") ?? el.textContent?.trim() ?? el.tagName, oben };
      });
      if (fokus && fokus.oben < -0.5) abgeschnitten.push(`${fokus.name}: ${fokus.oben.toFixed(1)} px`);
    }
    expect(abgeschnitten, "Fokusrahmen oben abgeschnitten").toEqual([]);
    await page.keyboard.press("Escape");
  });
}

async function entwurfAusfuellen(page: Page): Promise<void> {
  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100");
}

/** Der Server antwortet nicht: geschrieben wird nichts, die Aktion endet mit einer Fehlermeldung */
const serverAntwortetNicht = (page: Page) => page.route(/_serverFn/, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));

for (const [geraet, viewport] of [
  ["Laptop", LAPTOP],
  ["Handy", HANDY],
] as const) {
  for (const knopf of ["Entwurf speichern", "Speichern und als PDF"]) {
    test(`Entwurf am ${geraet}: Fehler nach „${knopf}“ erscheint im Fenster`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await entwurfAusfuellen(page);
      await zumEnde(page);
      await serverAntwortetNicht(page);
      if (geraet === "Handy" && knopf === "Entwurf speichern") {
        await page.locator(".main > .action-bar").getByRole("button", { name: knopf }).click();
      } else if (geraet === "Handy") {
        await page.locator(".main > .action-bar").getByRole("button", { name: "Weitere Aktionen" }).click();
        await page.getByRole("menuitem", { name: knopf }).click();
      } else {
        await page.locator(".main > .page-head").getByRole("button", { name: knopf }).click();
      }
      await sichtbar(page.locator(".main").getByRole("alert"));
    });
  }
}

test("Kontakt am Handy: Fehler nach „Archivieren“ im stehenden Kopf erscheint im Fenster", async ({ page }) => {
  const pfad = await firstLink(page, "/kontakte", /^\/kontakte\/[0-9a-f-]{36}$/);
  expect(pfad).not.toBeNull();
  await page.setViewportSize(HANDY);
  await page.goto(pfad as string, { waitUntil: "networkidle" });
  await zumEnde(page);
  await serverAntwortetNicht(page);
  await page.locator(".main > .page-head").getByRole("button", { name: "Archivieren" }).click();
  await sichtbar(page.locator(".main").getByRole("alert"));
});

for (const [geraet, viewport] of [
  ["Laptop", { width: LAPTOP.width, height: 600 }],
  ["Handy", HANDY],
] as const) {
  test(`Dauerbeleg am ${geraet}: Hinweis nach „Beenden“ im stehenden Kopf erscheint im Fenster`, async ({ page }) => {
    const pfad = await firstLink(page, "/dauerbelege", /^\/dauerbelege\/[0-9a-f-]{36}$/);
    expect(pfad).not.toBeNull();
    await page.setViewportSize(viewport);
    await page.goto(pfad as string, { waitUntil: "networkidle" });
    await zumEnde(page);
    // Der Klick fragt nur nach, geschrieben wird nichts
    await page.locator(".main > .page-head").getByRole("button", { name: "Beenden" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Beenden" })).toBeVisible();
    await sichtbar(page.getByRole("dialog").getByText("Beenden ist endgültig"));
  });
}

/** Der längere Knopf der Rückfrage bricht die Aktionen um: Der Kopf wächst im selben Moment, in dem der Hinweis ins Bild kommt */
// 400 % Zoom: WCAG 1.4.10 rechnet mit 320×256, ein Fenster mit 1280×720 ergibt 320×180
for (const viewport of [
  { width: 320, height: 256 },
  { width: 320, height: 180 },
]) {
  test(`Entwurf bei 400 % Zoom (${viewport.width}×${viewport.height}): der Kopf verdeckt kein Feld mit Fokus`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
    await page.locator("#invoice-form").locator("select, input").first().focus();
    const verdeckt: string[] = [];
    let geprueft = 0;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const fokus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        if (!el.closest("#invoice-form")) return null;
        const box = el.getBoundingClientRect();
        return {
          name: el.getAttribute("aria-label") ?? (el as HTMLInputElement).labels?.[0]?.textContent?.trim().slice(0, 30) ?? el.tagName,
          top: box.top,
          bottom: box.bottom,
          mehrzeilig: el.tagName === "TEXTAREA",
        };
      });
      if (!fokus) continue;
      geprueft++;
      const navigation = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")));
      const kopf = Math.max(await kopfUnterkante(page), navigation);
      // Zu hohe Felder können nicht ganz im Bild stehen, und bei Textfeldern holt der Browser nur die Schreibmarke:
      // dann zählt, dass der Anfang zu sehen ist
      const passt = !fokus.mehrzeilig && fokus.bottom - fokus.top <= viewport.height - navigation;
      if (fokus.top < kopf - 1 || fokus.top >= viewport.height || (passt && fokus.bottom > viewport.height + 1)) {
        verdeckt.push(`${fokus.name}: ${Math.round(fokus.top)}–${Math.round(fokus.bottom)} (frei ab ${Math.round(kopf)})`);
      }
    }
    expect(geprueft).toBeGreaterThan(5);
    expect(verdeckt, "Feld mit Fokus verdeckt oder außerhalb").toEqual([]);
  });
}

/** Breite des Inhalts im Kopf, ohne dessen Innenabstand */
const kopfInnen = (head: Locator) =>
  head.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const stil = getComputedStyle(el);
    return { links: box.left + Number.parseFloat(stil.paddingLeft), rechts: box.right - Number.parseFloat(stil.paddingRight) };
  });

test("Aktionen unter dem Titel stehen rechtsbündig, wenn der Kopf umbricht", async ({ page }) => {
  // Mit Seitenleiste (ab 861 px), aber zu schmal für Titel und Aktionen in einer Zeile
  await page.setViewportSize({ width: 861, height: 800 });
  await page.goto("/rechnungen/neu");
  const head = page.locator(".main > .page-head");
  const titel = head.getByRole("heading", { level: 1 });
  const aktionen = head.locator("> .actions");
  await expect(titel).toBeVisible();
  const titelBox = await titel.boundingBox();
  const aktionenBox = await aktionen.boundingBox();
  // Sonst prüft der Test nichts: die Aktionen müssen wirklich unter dem Titel stehen
  expect(aktionenBox?.y).toBeGreaterThanOrEqual((titelBox?.y ?? 0) + (titelBox?.height ?? 0));
  const { rechts } = await kopfInnen(head);
  // Rechte Kante des letzten Knopfs, nicht des Containers: der kann die volle Breite einnehmen
  const ende = await aktionen.locator("> *").evaluateAll((kinder) => Math.max(...kinder.map((k) => k.getBoundingClientRect().right)));
  expect(Math.abs(ende - rechts)).toBeLessThanOrEqual(1);
});

test("Bank: Importknöpfe unter dem Titel stehen rechtsbündig, wenn der Kopf umbricht", async ({ page }) => {
  // Mit Seitenleiste (ab 861 px) zu schmal für Titel, Kontowahl und Knöpfe in einer Zeile
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/bank");
  const head = page.locator(".main > .page-head");
  const titel = head.getByRole("heading", { level: 1 });
  const importieren = head.getByRole("button", { name: "CSV / CAMT importieren" });
  await expect(importieren).toBeVisible();
  const titelBox = await titel.boundingBox();
  const knopfBox = await importieren.boundingBox();
  // Sonst prüft der Test nichts: die Knöpfe müssen wirklich unter dem Titel stehen
  expect(knopfBox?.y).toBeGreaterThanOrEqual((titelBox?.y ?? 0) + (titelBox?.height ?? 0));
  const { rechts } = await kopfInnen(head);
  expect(Math.abs((knopfBox?.x ?? 0) + (knopfBox?.width ?? 0) - rechts)).toBeLessThanOrEqual(1);
});

// Am Handy stehen die Aktionen des Rechnungsentwurfs in der Leiste (#396, #355 Variante E); dass die Aktionen im Kopf des
// Mahnungseditors die Breite füllen, prüft app.spec.ts, weil es nur dort eine überfällige Rechnung gibt
test("Aktionen am Handy füllen weiter die volle Breite des Kopfes", async ({ page }) => {
  await page.setViewportSize(HANDY);
  await page.goto("/rechnungen/neu");
  const bar = page.locator(".main > .action-bar");
  const aktionen = bar.locator("> .actions");
  await expect(aktionen).toBeVisible();
  const { links, rechts } = await kopfInnen(bar);
  const box = await aktionen.boundingBox();
  // Die Zeile reicht in der Leiste von Innenkante zu Innenkante
  expect(box?.x).toBeLessThanOrEqual(links);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThanOrEqual(rechts);
});
