// Rendert hero.html nach docs/hero-hell.png und docs/hero-dunkel.png (1280 × 360 bei doppelter Auflösung).
// Aufruf: bun run docs:hero (braucht bun install und den Chromium von Playwright)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
// Playwright ist eine Abhängigkeit von apps/web, nicht vom Wurzelpaket
const { chromium } = createRequire(path.join(root, "apps/web/package.json"))("@playwright/test");
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 360 }, deviceScaleFactor: 2 });
for (const [hash, name] of [
  ["", "hero-hell.png"],
  ["#nacht", "hero-dunkel.png"],
]) {
  await page.goto(`file://${path.join(here, "hero.html")}${hash}`);
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(root, "docs", name);
  await page.screenshot({ path: out, type: "png" });
  console.log("written", out);
}
await browser.close();
