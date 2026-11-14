import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { THEMES } from "../src/lib/theme.ts";

/**
 * Ist die Navigation höher als das Fenster, rollen am Desktop nur die Menüpunkte (.nav-body); die Marke mit dem
 * Firmennamen bleibt stehen. Die Leiste ist schmal, sitzt an der Kante der Navigation und hebt sich mit mindestens
 * 3 : 1 von --nav ab (WCAG 2.2, 1.4.11). Mit dem CSS der App in einer eigenen Seite, braucht keinen Server.
 */

const links = Array.from({ length: 40 }, (_, i) => `<a class="nav-link" href="#">Punkt ${i + 1}</a>`).join("");

async function navigationLaden(page: Page, theme = "wald", mode = "light"): Promise<void> {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  await page.setContent(
    `<html data-theme="${theme}" data-mode="${mode}"><style>${css}</style><body><div class="shell"><nav class="nav">
      <a class="brand" href="#"><span class="brand-text">Haben<span class="brand-firma">Muster GmbH</span></span></a>
      <div class="nav-body">${links}<div class="nav-spacer"></div><div class="nav-foot"><a class="nav-link" href="#">Abmelden</a></div></div>
    </nav><main class="main"></main></div></body></html>`,
  );
}

test("am Desktop rollen nur die Menüpunkte, die Marke bleibt stehen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await navigationLaden(page);
  const markeVorher = await page.locator(".brand").boundingBox();
  await page.getByRole("link", { name: "Abmelden" }).focus();
  const gemessen = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".nav")!;
    const body = document.querySelector<HTMLElement>(".nav-body")!;
    const abmelden = [...body.querySelectorAll<HTMLElement>(".nav-link")].at(-1)!.getBoundingClientRect();
    return {
      navRollt: nav.scrollTop,
      bodyRollt: body.scrollTop > 0,
      abmeldenSichtbar: abmelden.bottom <= innerHeight,
      leisteAnDerKante: Math.round(body.getBoundingClientRect().right) === Math.round(nav.getBoundingClientRect().right),
      breite: getComputedStyle(body).scrollbarWidth,
    };
  });
  expect(gemessen).toEqual({ navRollt: 0, bodyRollt: true, abmeldenSichtbar: true, leisteAnDerKante: true, breite: "thin" });
  expect(await page.locator(".brand").boundingBox()).toEqual(markeVorher);
});

// Mit Zoom oder Skalierung ist das Fenster auch zwischen 860 und 861 CSS-Pixel breit (hier 1,17-fach: 860,68). Dort
// darf keine der beiden Regeln fehlen, sonst schneidet .nav ab, .nav-body rollt nicht und mit Maus oder Touchpad ist
// der Fuß unerreichbar
test("auch zwischen 860 und 861 Pixel Breite rollt die Navigation bis zum Fuß", async ({ playwright }) => {
  const browser = await playwright.chromium.launch({ args: ["--force-device-scale-factor=1.17", "--window-size=860,600"] });
  try {
    const page = await (await browser.newContext({ viewport: null, deviceScaleFactor: undefined })).newPage();
    await navigationLaden(page);
    await page.mouse.move(100, 300);
    await page.mouse.wheel(0, 5000);
    // Chromium rollt nach dem Mausrad sanft über mehrere Frames, deshalb bis zum Ende des Rollens messen
    await expect
      .poll(() =>
        page.evaluate(() => {
          const breite = document.documentElement.getBoundingClientRect().width;
          const links = [...document.querySelectorAll<HTMLElement>(".nav-body .nav-link")];
          return { zwischen: breite > 860 && breite < 861, abmeldenSichtbar: links.at(-1)!.getBoundingClientRect().bottom <= innerHeight };
        }),
      )
      .toEqual({ zwischen: true, abmeldenSichtbar: true });
  } finally {
    await browser.close();
  }
});

test("am Handy rollt das offene Menü, die Leiste darüber nicht", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await navigationLaden(page);
  await page.locator(".nav").evaluate((nav) => nav.classList.add("open"));
  const gemessen = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".nav")!;
    const body = document.querySelector<HTMLElement>(".nav-body")!;
    return { nav: getComputedStyle(nav).overflowY, body: getComputedStyle(body).overflowY, rollbar: body.scrollHeight > body.clientHeight };
  });
  expect(gemessen).toEqual({ nav: "visible", body: "auto", rollbar: true });
});

for (const mode of ["light", "dark"]) {
  test(`Daumen der Leiste mit mindestens 3 : 1 gegen die Navigation (Modus ${mode})`, async ({ page }) => {
    const zuWenig: string[] = [];
    for (const { id } of THEMES) {
      await navigationLaden(page, id, mode);
      const kontrast = await page.evaluate(() => {
        const lum = (c: number[]) => {
          const [r, g, b] = c.map((v) => {
            const x = v / 255;
            return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        // Die Farbe des Daumens über ein Probeelement in rgb() auflösen lassen, color-mix ergibt sonst color(srgb …)
        const probe = document.createElement("canvas").getContext("2d")!;
        const daumen = getComputedStyle(document.querySelector(".nav-body")!).scrollbarColor.split(/\s(?![^(]*\))/)[0]!;
        probe.fillStyle = getComputedStyle(document.querySelector(".nav")!).backgroundColor;
        probe.fillRect(0, 0, 1, 1);
        probe.fillStyle = daumen;
        probe.fillRect(0, 0, 1, 1);
        const sichtbar = [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        const nav = (getComputedStyle(document.querySelector(".nav")!).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
        const [hell, dunkel] = [lum(sichtbar), lum(nav)].sort((x, y) => y - x);
        return (hell! + 0.05) / (dunkel! + 0.05);
      });
      if (kontrast < 3) zuWenig.push(`${id} ${mode}: ${kontrast.toFixed(2)} : 1`);
    }
    expect(zuWenig).toEqual([]);
  });
}
