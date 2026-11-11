import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { THEMES } from "../src/lib/theme.ts";
import { SESSION } from "./daten.ts";
import { axeVerstoesse } from "./einrichtung.ts";

/**
 * Mehrere Firmen (#504): Unter „Haben“ steht der Name aus den Firmendaten, damit man sieht, in welcher Instanz man
 * bucht. Mit den Daten und der Sitzung aus app.spec.ts (Projekt „mit-daten“); geschrieben wird nichts, lange Namen
 * setzt der Test nur in die Seite. Dass die Steuerberatung den Namen sieht, prüft steuerberatung.spec.ts.
 */

test.use({ storageState: SESSION });

const FIRMA = "Mustermann IT · Max Mustermann";
const LANG = "Garten- und Landschaftsbau Müller und Söhne GmbH & Co. KG";

const nav = (page: Page) => page.getByRole("navigation", { name: "Hauptnavigation" });

/** Firmenname in der Seite ersetzen; die Firmendaten bleiben, wie app.spec.ts sie angelegt hat. Das Aufklappen liest den Text beim Überfahren aus der Seite */
async function nameSetzen(page: Page, name: string): Promise<void> {
  await nav(page)
    .locator(".brand-firma")
    .evaluate((el, text) => {
      el.textContent = text;
    }, name);
}

test("zeigt den Namen der Firma unter „Haben“", async ({ page }) => {
  await page.goto("/");
  const marke = nav(page).getByRole("link", { name: `Haben ${FIRMA}` });
  await expect(marke).toBeVisible();
  // Den ganzen Namen zeigt das Aufklappen beim Überfahren (unten), kein title: der ist nicht gestaltbar und nicht per Tastatur zu erreichen
  await expect(marke.locator(".brand-firma")).not.toHaveAttribute("title");
  expect(await axeVerstoesse(page)).toEqual([]);
});

/** Zeilen des Namens und ob er abgeschnitten ist */
async function nameGemessen(page: Page): Promise<{ zeilen: number; gekuerzt: boolean }> {
  return nav(page)
    .locator(".brand-firma")
    .evaluate((el) => ({
      zeilen: Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)),
      gekuerzt: el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth,
    }));
}

// Firmen desselben Inhabers unterscheiden sich oft erst am Ende des Namens; am Desktop darf er deshalb zwei Zeilen
// nehmen, statt nach rund 20 Zeichen abzubrechen (Rückmeldung in #599)
test("am Desktop steht der Name ganz da, in höchstens zwei Zeilen", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page).getByText(FIRMA)).toBeVisible();
  expect(await nameGemessen(page)).toEqual({ zeilen: 2, gekuerzt: false });
  // Auch ein längerer Name (36 Zeichen) passt noch ganz hinein
  await nameSetzen(page, "Steuerberatungsgesellschaft Nord mbH");
  expect(await nameGemessen(page)).toEqual({ zeilen: 2, gekuerzt: false });
});

test("ein langer Firmenname wird nach zwei Zeilen gekürzt und läuft nicht aus der Navigation", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page).getByText(FIRMA)).toBeVisible();
  await nameSetzen(page, LANG);
  expect(await nameGemessen(page)).toEqual({ zeilen: 2, gekuerzt: true });
  const ueberlauf = await page.evaluate(() => {
    const navigation = document.querySelector<HTMLElement>("nav.nav")!;
    const marke = navigation.querySelector<HTMLElement>(".brand")!;
    return { nav: navigation.scrollWidth - navigation.clientWidth, marke: marke.scrollWidth - marke.clientWidth };
  });
  expect(ueberlauf).toEqual({ nav: 0, marke: 0 });
});

// „Haben“ bleibt so groß und weiß wie ohne Firmennamen (18px, halbfett); der Name steht kleiner darunter, voll deckend
// und im Grau der Navigation (--nav-ink), damit „Haben“ die Hauptzeile bleibt
test("„Haben“ bleibt, wie es ist, der Name steht kleiner darunter", async ({ page }) => {
  for (const breite of [1280, 375]) {
    await page.setViewportSize({ width: breite, height: 812 });
    await page.goto("/");
    await expect(nav(page).getByText(FIRMA)).toBeVisible();
    const marke = await nav(page)
      .locator(".brand")
      .evaluate((el) => {
        const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let haben: Text | null = null;
        while (text.nextNode()) if (text.currentNode.textContent?.trim() === "Haben") haben = text.currentNode as Text;
        const bereich = document.createRange();
        bereich.selectNodeContents(haben!);
        const firma = el.querySelector<HTMLElement>(".brand-firma")!;
        const stil = getComputedStyle(haben!.parentElement!);
        return {
          haben: `${stil.fontSize} ${stil.fontWeight}`,
          firma: Number.parseFloat(getComputedStyle(firma).fontSize),
          deckung: getComputedStyle(firma).opacity,
          farbeHaben: stil.color,
          farbeFirma: getComputedStyle(firma).color,
          navInk: (() => {
            const probe = document.createElement("span");
            probe.style.color = "var(--nav-ink)";
            el.append(probe);
            const farbe = getComputedStyle(probe).color;
            probe.remove();
            return farbe;
          })(),
          darunter: firma.getBoundingClientRect().top >= bereich.getBoundingClientRect().bottom - 1,
        };
      });
    expect(marke.haben, `${breite}px`).toBe("18px 600");
    expect(marke.firma, `${breite}px`).toBeLessThan(18);
    expect(marke.firma, `${breite}px`).toBeGreaterThanOrEqual(12);
    expect(marke.deckung, `${breite}px`).toBe("1");
    expect(marke.farbeHaben, `${breite}px`).toBe("rgb(255, 255, 255)");
    expect(marke.farbeFirma, `${breite}px`).toBe(marke.navInk);
    expect(marke.darunter, `${breite}px`).toBe(true);
  }
});

// axe misst den Kontrast sonst nur im Standard-Theme; die Navigation hat in jedem Theme eigene Farben
test("Name und „Haben“ sind in jedem Theme kontrastreich genug", async ({ page }) => {
  const verstoesse: string[] = [];
  for (const { id } of THEMES.filter((t) => t.id !== "auto")) {
    for (const breite of [1280, 375]) {
      await page.setViewportSize({ width: breite, height: 812 });
      await page.goto("/");
      await page.evaluate((theme) => localStorage.setItem("haben-theme", theme), id);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", id);
      await expect(nav(page).getByText(FIRMA)).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).include("nav .brand").withRules(["color-contrast"]).analyze();
      verstoesse.push(...violations.flatMap((v) => v.nodes.map((n) => `${id} ${breite}px: ${n.target.join(" ")}`)));
    }
  }
  expect(verstoesse).toEqual([]);
});

// Der Seitenkopf klebt am Handy bei --nav-height (60px) unter der Navigation; mit dem Firmennamen darf die Leiste
// nicht höher werden, sonst verdeckt sie beim Scrollen den Kopf. Der Name bekommt deshalb nur eine Zeile unter „Haben“,
// dafür die ganze Breite neben dem Menüknopf. Auch ein langer Name auf 320px
test("am Handy steht der Name in einer Zeile, und die Leiste bleibt so hoch wie --nav-height", async ({ page }) => {
  const gemessen: Record<string, { leiste: number; ueberlauf: number; zeilen: number }> = {};
  let variable = 0;
  for (const [breite, name] of [
    [375, FIRMA],
    [320, LANG],
  ] as const) {
    await page.setViewportSize({ width: breite, height: 812 });
    await page.goto("/");
    await expect(nav(page).getByText(FIRMA)).toBeVisible();
    await nameSetzen(page, name);
    const werte = await page.evaluate(() => ({
      leiste: Math.round(document.querySelector<HTMLElement>("nav.nav")!.getBoundingClientRect().height),
      ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      variable: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")),
    }));
    const { zeilen } = await nameGemessen(page);
    gemessen[`${breite}px`] = { leiste: werte.leiste, ueberlauf: werte.ueberlauf, zeilen };
    variable = werte.variable;
  }
  expect(variable).toBe(60);
  expect(gemessen).toEqual({
    "375px": { leiste: 60, ueberlauf: 0, zeilen: 1 },
    "320px": { leiste: 60, ueberlauf: 0, zeilen: 1 },
  });
});

// Ist der Name länger als zwei Zeilen, klappt er beim Überfahren und mit Fokus auf „Haben“ nach unten ganz auf, in der
// Breite der Navigation und über den ersten Menüpunkten. Der Name in der Marke bleibt dabei, wo er ist („Haben“
// springt nicht); das Aufklappen ist ein zweites, für Hilfstechnik verborgenes Element (WCAG 1.4.13: es verschwindet mit
// Escape, bleibt beim Hinüberfahren und mit dem Zeiger darauf stehen)
const voll = (page: Page) => nav(page).locator(".brand-firma-voll");
const marke = (page: Page) => nav(page).locator(".brand");

test("ein langer Name klappt beim Überfahren nach unten ganz auf, ohne die Marke zu verschieben", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page).getByText(FIRMA)).toBeVisible();
  await nameSetzen(page, LANG);
  const lage = () =>
    page.evaluate(() => ({
      mark: document.querySelector(".brand-mark")!.getBoundingClientRect().top,
      firma: document.querySelector(".brand-firma")!.getBoundingClientRect().top,
    }));
  const vorher = await lage();
  await expect(voll(page)).toHaveCount(0);
  await marke(page).hover();
  await expect(voll(page)).toBeVisible();
  await expect(voll(page)).toHaveText(LANG);
  await expect(voll(page)).toHaveAttribute("aria-hidden", "true");
  expect(await lage()).toEqual(vorher);
  const gemessen = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".brand-firma-voll")!;
    const rahmen = el.getBoundingClientRect();
    const navigation = document.querySelector<HTMLElement>("nav.nav")!.getBoundingClientRect();
    const mitte = document.elementFromPoint(rahmen.left + rahmen.width / 2, rahmen.top + rahmen.height - 4);
    const zeichen = document.querySelector<HTMLElement>(".brand-mark")!.getBoundingClientRect();
    const haben = document.querySelector<HTMLElement>(".brand-text")!.getBoundingClientRect();
    const name = document.querySelector<HTMLElement>(".brand-firma")!.getBoundingClientRect();
    return {
      // Das Zeichen „H“ und die Zeile „Haben“ bleiben frei; der Text steht dort, wo vorher der gekürzte Name stand
      zeichenFrei: rahmen.left >= zeichen.right || rahmen.top >= zeichen.bottom,
      habenFrei: rahmen.top >= haben.top + (name.top - haben.top) - 6,
      textGleich: Math.abs(el.getBoundingClientRect().left - name.left) <= 8 + 1,
      ganz: el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth,
      inDerNavigation: rahmen.left >= navigation.left && rahmen.right <= navigation.right,
      oben: el.contains(mitte),
      hintergrund: getComputedStyle(el).backgroundColor,
      navAktiv: (() => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--nav-active)";
        document.querySelector(".nav")!.append(probe);
        const farbe = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return farbe;
      })(),
    };
  });
  expect(gemessen.zeichenFrei).toBe(true);
  expect(gemessen.habenFrei).toBe(true);
  expect(gemessen.textGleich).toBe(true);
  expect(gemessen.ganz).toBe(true);
  expect(gemessen.inDerNavigation).toBe(true);
  expect(gemessen.oben).toBe(true);
  expect(gemessen.hintergrund).toBe(gemessen.navAktiv);
  await page.mouse.move(900, 500);
  await expect(voll(page)).toHaveCount(0);
});

test("der aufgeklappte Name bleibt unter dem Zeiger und mit Fokus, Escape schließt ihn", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page).getByText(FIRMA)).toBeVisible();
  await nameSetzen(page, LANG);
  await marke(page).hover();
  await expect(voll(page)).toBeVisible();
  // Mit dem Zeiger auf dem aufgeklappten Namen bleibt er offen
  await voll(page).hover();
  await expect(voll(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(voll(page)).toHaveCount(0);
  // Mit der Tastatur: Fokus auf „Haben“ öffnet, Escape schließt, Verlassen des Links ebenso
  await page.mouse.move(900, 500);
  await marke(page).focus();
  await expect(voll(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(voll(page)).toHaveCount(0);
  await marke(page).blur();
  await marke(page).focus();
  await expect(voll(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(voll(page)).toHaveCount(0);
});

// WCAG 1.4.13 („persistent“): Steht der Fokus per Tastatur auf „Haben“, schließt ein Zeiger, der darüberfährt und wieder
// weggeht, den Namen nicht. Nach einem Mausklick (Fokus ohne Tastaturfokus) schließt das Verlassen ihn dagegen, sonst
// bliebe er nach jedem Klick offen
test("mit Tastaturfokus bleibt der Name offen, auch wenn der Zeiger darüberfährt und weggeht", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page).getByText(FIRMA)).toBeVisible();
  await nameSetzen(page, LANG);
  await page.mouse.move(900, 500);
  for (let i = 0; i < 10 && !(await marke(page).evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(marke(page)).toBeFocused();
  await expect(voll(page)).toBeVisible();
  await marke(page).hover();
  await page.mouse.move(900, 500);
  await expect(voll(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(voll(page)).toHaveCount(0);
});

test("nach einem Mausklick schließt das Verlassen des Zeigers den Namen", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page).getByText(FIRMA)).toBeVisible();
  await nameSetzen(page, LANG);
  await marke(page).hover();
  await expect(voll(page)).toBeVisible();
  await marke(page).click();
  await page.mouse.move(900, 500);
  await expect(voll(page)).toHaveCount(0);
});

test("ein Name, der in zwei Zeilen passt, klappt nicht auf", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page).getByText(FIRMA)).toBeVisible();
  await marke(page).hover();
  await expect(voll(page)).toHaveCount(0);
  await marke(page).focus();
  await expect(voll(page)).toHaveCount(0);
});

test("am Handy klappt nichts auf, auch bei einem langen Namen", async ({ page }) => {
  for (const breite of [375, 320]) {
    await page.setViewportSize({ width: breite, height: 812 });
    await page.goto("/");
    await expect(nav(page).getByText(FIRMA)).toBeVisible();
    await nameSetzen(page, LANG);
    await marke(page).hover();
    await expect(voll(page), `${breite}px`).not.toBeVisible();
    await marke(page).focus();
    await expect(voll(page), `${breite}px`).not.toBeVisible();
  }
});

// Escape gehört zuerst dem aufgeklappten Namen: In der Belegansicht führt Escape sonst zurück zur Liste, und wer nur den
// Namen schließen wollte, verlässt den Beleg. Ist der Name nicht offen, bleibt Escape bei der Seite
async function ersterBeleg(page: Page): Promise<string> {
  await page.goto("/belege");
  const zeile = page.locator('a.table-row[href^="/belege/"]').first();
  await expect(zeile).toBeVisible();
  await zeile.click();
  await expect(page).toHaveURL(/\/belege\/[^/?]+$/);
  return new URL(page.url()).pathname;
}

test("Escape schließt in der Belegansicht nur den aufgeklappten Namen und bleibt im Beleg", async ({ page }) => {
  const pfad = await ersterBeleg(page);
  await expect(nav(page).getByText(FIRMA)).toBeVisible();
  await nameSetzen(page, LANG);
  await marke(page).hover();
  await expect(voll(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(voll(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(new URL(page.url()).pathname).toBe(pfad);
  // Mit Tastaturfokus auf „Haben“ ebenso
  await page.mouse.move(900, 500);
  await marke(page).focus();
  await expect(voll(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(voll(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(new URL(page.url()).pathname).toBe(pfad);
});

test("Escape bei geschlossenem Namen führt in der Belegansicht weiter zur Liste", async ({ page }) => {
  await ersterBeleg(page);
  await expect(nav(page).getByText(FIRMA)).toBeVisible();
  await expect(voll(page)).toHaveCount(0);
  await page.mouse.move(900, 500);
  // Die Seite reagiert erst nach dem Hydrieren auf Escape; bis dahin wiederholen, es geht nur ums Ergebnis
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/belege$/, { timeout: 1_000 });
  }).toPass();
});
