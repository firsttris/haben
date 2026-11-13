// Rendert social-preview.html nach docs/social-preview.png (1280 × 640).
// Aufruf: bun run docs:social-preview (braucht bun install und den Chromium von Playwright)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
// Playwright ist eine Abhängigkeit von apps/web, nicht vom Wurzelpaket
const { chromium } = createRequire(path.join(root, "apps/web/package.json"))("@playwright/test");
const out = path.join(root, "docs/social-preview.png");
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.join(here, "social-preview.html")}`);
await page.evaluate(async () => {
  await Promise.all([
    document.fonts.load('600 46px "IBM Plex Serif"'),
    document.fonts.load('400 20px "IBM Plex Sans"'),
    document.fonts.load('600 17px "IBM Plex Sans"'),
    document.fonts.load('600 56px "IBM Plex Sans"'),
  ]);
  await document.fonts.ready;
});
await page.screenshot({ path: out, type: "png" });
await browser.close();
console.log("written", out);
