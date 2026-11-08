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

for (const [geraet, viewport] of [
  ["Laptop", LAPTOP],
  ["Handy", HANDY],
] as const) {
  test(`Kontaktdialog am ${geraet}: Fehlermeldung nach Klick auf den stehenden Knopf ist sichtbar`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // Erst nach der Hydration klicken, sonst öffnet der Knopf den Dialog nicht
    await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Neuen Kontakt anlegen" }).click();
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
    await page.getByRole("button", { name: "Neuen Kontakt anlegen" }).click();
    const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Kontakt anlegen" }).focus();
    const abgeschnitten: string[] = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Shift+Tab");
      const fokus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const form = el.closest<HTMLElement>(".contact-dialog > .contact-form");
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

/** Breite des Inhalts im Kopf, ohne dessen Innenabstand */
const kopfInnen = (head: Locator) =>
  head.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const stil = getComputedStyle(el);
    return { links: box.left + Number.parseFloat(stil.paddingLeft), rechts: box.right - Number.parseFloat(stil.paddingRight) };
  });

test("Aktionen unter dem Titel stehen rechtsbündig, wenn der Kopf umbricht", async ({ page }) => {
  // Oberhalb der Handy-Ansicht (721 px), aber zu schmal für Titel und Aktionen in einer Zeile
  await page.setViewportSize({ width: 740, height: 800 });
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

test("Aktionen am Handy füllen weiter die volle Breite des Kopfes", async ({ page }) => {
  await page.setViewportSize(HANDY);
  await page.goto("/rechnungen/neu");
  const head = page.locator(".main > .page-head");
  const aktionen = head.locator("> .actions");
  await expect(aktionen).toBeVisible();
  const { links, rechts } = await kopfInnen(head);
  const box = await aktionen.boundingBox();
  // styles.css: margin -4px, damit der Fokusrahmen in der scrollenden Zeile Platz hat
  expect(box?.x).toBeLessThanOrEqual(links);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThanOrEqual(rechts);
});
