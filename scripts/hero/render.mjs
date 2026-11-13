// Rendert hero.html in Wald hell und dunkel nach docs/hero-hell.png und docs/hero-dunkel.png (1280 × 360 bei 2×).
// Bricht ab, wenn etwas aus dem Bild ragt oder überläuft. Aufruf: bun run docs:hero
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const { chromium } = createRequire(path.join(root, "apps/web/package.json"))("@playwright/test");
const out = path.join(root, "docs");
await mkdir(out, { recursive: true });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
try {
  for (const [name, hash] of [
    ["hell", ""],
    ["dunkel", "#dunkel"],
  ]) {
    // Ein neues Dokument führt das Inline-Skript auch für die Hash-Variante aus.
    const page = await browser.newPage({
      viewport: { width: 1280, height: 360 },
      deviceScaleFactor: 2,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => errors.push(`Laden fehlgeschlagen: ${request.url()}`));
    await page.goto(`${pathToFileURL(path.join(here, "hero.html")).href}${hash}`);
    await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load('400 16px "IBM Plex Sans"'),
        document.fonts.load('500 16px "IBM Plex Sans"'),
        document.fonts.load('600 24px "IBM Plex Sans"'),
        document.fonts.load('600 58px "IBM Plex Serif"'),
        document.fonts.load('400 14px "IBM Plex Mono"'),
        document.fonts.load('500 13px "IBM Plex Mono"'),
      ]);
      await document.fonts.ready;
    });
    const problems = await page.evaluate(() => {
      const problems = [];
      for (const element of document.querySelectorAll("body, main, main *")) {
        const rect = element.getBoundingClientRect();
        if (rect.left < 0 || rect.top < 0 || rect.right > 1280 || rect.bottom > 360) {
          problems.push(`Außerhalb der Bildfläche: ${element.tagName}.${element.className}`);
        }
        // Große Schrift ragt mit Akzenten und Unterlängen ein paar Pixel aus ihrer Zeilenbox, ohne abgeschnitten zu werden
        if (element.scrollWidth > element.clientWidth + 4 || element.scrollHeight > element.clientHeight + 4) {
          problems.push(`Überlauf: ${element.tagName}.${element.className}`);
        }
      }
      return problems;
    });
    if (errors.length || problems.length) throw new Error([...errors, ...problems].join("\n"));
    const target = path.join(out, `hero-${name}.png`);
    await page.screenshot({ path: target, type: "png" });
    console.log("Geschrieben:", target);
    await page.close();
  }
} finally {
  await browser.close();
}
