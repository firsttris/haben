import { expect, type Locator, test } from "@playwright/test";
import { firstLink, SESSION, YEAR } from "./daten.ts";
import { HANDY, kopfUnterkante, LAPTOP, sichtbar, statusBleibtSichtbar, zumEnde } from "./kopfzeile.ts";

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
    await expect(head.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".shell")).not.toHaveAttribute("data-scrolled");
    await zumEnde(page);
    await expect(page.locator(".shell")).toHaveAttribute("data-scrolled");
    await sichtbar(head.getByRole("heading", { level: 1 }));
    await sichtbar(head.getByText("Entwurf", { exact: false }).first());
    await sichtbar(head.getByRole("button", { name: "Entwurf speichern" }));
    await sichtbar(head.getByRole("button", { name: "Festschreiben" }));
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

test("Tab durch den langen Rechnungsentwurf: kein Feld mit Fokus liegt unter dem Kopf", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await page.goto("/rechnungen/neu");
  await page.locator("#invoice-form").locator("select, input").first().focus();
  const viewportHeight = LAPTOP.height;
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      // Am Ende der Seite verlässt der Fokus den Inhalt (Adressleiste, dann Sprunglink): bis dahin ist alles geprüft
      if (!el?.closest(".main")) return "ende";
      if (el.closest(".page-head")) return null;
      const box = el.getBoundingClientRect();
      return { name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName, top: box.top, bottom: box.bottom };
    });
    if (focus === "ende") break;
    if (!focus) continue;
    const kopf = await kopfUnterkante(page);
    expect(focus.top, `„${focus.name}“ liegt unter dem Kopf`).toBeGreaterThanOrEqual(kopf - 1);
    expect(focus.top, `„${focus.name}“ liegt unter dem Fensterrand`).toBeLessThan(viewportHeight);
  }
  // Der Test ist bis weit nach unten getabbt, sonst hätte der Kopf nie stehen müssen
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
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

test("Festschreiben im stehenden Kopf: die Rückfrage erscheint dort, wo geklickt wurde", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await page.goto("/rechnungen/neu");
  await page.getByLabel("Kunde").selectOption({ index: 1 });
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100");
  await zumEnde(page);
  // Nur der erste Klick: er fragt nach, geschrieben wird nichts
  await page.locator(".main > .page-head").getByRole("button", { name: "Festschreiben" }).click();
  await expect(page.getByRole("button", { name: "Jetzt festschreiben" })).toBeVisible();
  await sichtbar(page.getByRole("alert").filter({ hasText: "Noch einmal klicken zum Festschreiben" }));
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
      return { name: el.getAttribute("aria-label") ?? el.closest("label")?.textContent?.trim().slice(0, 40) ?? el.tagName, top: box.top };
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
    await page.goto("/rechnungen/neu");
    // Öffnen und Abbrechen: geschrieben wird nichts
    await page.getByRole("button", { name: "Neuen Kontakt anlegen" }).click();
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
