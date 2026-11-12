// Rendert hell-dunkel.html nach docs/screenshot-hell-dunkel.png (1440 × 900), aus den Bildern der Übersicht.
// Aufruf: bun run docs:hell-dunkel (nach den Screenshots; braucht bun install und den Chromium von Playwright)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
// Playwright ist eine Abhängigkeit von apps/web, nicht vom Wurzelpaket
const { chromium } = createRequire(path.join(root, "apps/web/package.json"))("@playwright/test");
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.join(here, "hell-dunkel.html")}`);
await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
const out = path.join(root, "docs/screenshot-hell-dunkel.png");
await page.screenshot({ path: out, type: "png" });
await browser.close();
console.log("written", out);
