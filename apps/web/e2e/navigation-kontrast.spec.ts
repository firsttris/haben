import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { THEMES } from "../src/lib/theme.ts";

/**
 * Die blassen Texte der Navigation (Gruppennamen, Rolle unter dem Namen, Version) tragen `opacity`; axe übergeht
 * den Gruppennamen (aria-hidden). Der Test rechnet den Kontrast selbst: Schriftfarbe mit Deckkraft auf `--nav`,
 * WCAG 2.2, 1.4.3, mindestens 4,5 : 1, in jeder Farbe hell und dunkel. Braucht keinen Server.
 */
const TEXTE = [".nav-group-label", ".nav-user-meta", ".nav-version", ".nav-link", ".nav-foot"];

for (const mode of ["light", "dark"]) {
  test(`blasse Texte der Navigation mit mindestens 4,5 : 1 (Modus ${mode})`, async ({ page }) => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const zuWenig: string[] = [];
    for (const { id } of THEMES) {
      await page.setContent(
        `<html data-theme="${id}" data-mode="${mode}"><style>${css}</style><body><nav class="nav">
          <a class="nav-link" href="#">Rechnungen</a>
          <div class="nav-group"><div class="nav-group-label">Verkauf</div></div>
          <div class="nav-foot"><div class="nav-user"><div class="nav-user-text"><span class="nav-user-name">Max</span>
          <span class="nav-user-meta">Geschäftsjahr 2026</span></div></div><a class="nav-version" href="#">Haben 1.0.0</a></div>
        </nav></body></html>`,
      );
      const werte = await page.evaluate((selektoren) => {
        const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
        const lum = ([r, g, b]: number[]) => {
          const c = [r!, g!, b!].map((v) => {
            const x = v / 255;
            return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
        };
        const nav = rgb(getComputedStyle(document.querySelector(".nav")!).backgroundColor);
        return selektoren.map((selektor) => {
          const el = document.querySelector<HTMLElement>(selektor)!;
          // Deckkraft aller Vorfahren bis zur Navigation zusammen
          let deckkraft = 1;
          for (let e: HTMLElement | null = el; e && !e.classList.contains("nav"); e = e.parentElement) deckkraft *= Number(getComputedStyle(e).opacity);
          const [r, g, b, a = 1] = rgb(getComputedStyle(el).color);
          const alpha = a * deckkraft;
          const sichtbar = [r!, g!, b!].map((v, i) => v * alpha + nav[i]! * (1 - alpha));
          const [hell, dunkel] = [lum(sichtbar), lum(nav)].sort((x, y) => y - x);
          return { selektor, kontrast: (hell! + 0.05) / (dunkel! + 0.05) };
        });
      }, TEXTE);
      for (const { selektor, kontrast } of werte) if (kontrast < 4.5) zuWenig.push(`${id} ${mode} ${selektor}: ${kontrast.toFixed(2)} : 1`);
    }
    expect(zuWenig).toEqual([]);
  });
}
