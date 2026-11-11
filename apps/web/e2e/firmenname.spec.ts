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

/** Firmenname in der Seite ersetzen; die Firmendaten bleiben, wie app.spec.ts sie angelegt hat */
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
  await expect(marke.locator(".brand-firma")).toHaveAttribute("title", FIRMA);
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

// „Haben“ bleibt so groß wie ohne Firmennamen (18px, halbfett); der Name steht kleiner darunter, voll deckend
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
          darunter: firma.getBoundingClientRect().top >= bereich.getBoundingClientRect().bottom - 1,
        };
      });
    expect(marke.haben, `${breite}px`).toBe("18px 600");
    expect(marke.firma, `${breite}px`).toBeLessThan(18);
    expect(marke.firma, `${breite}px`).toBeGreaterThanOrEqual(12);
    expect(marke.deckung, `${breite}px`).toBe("1");
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
