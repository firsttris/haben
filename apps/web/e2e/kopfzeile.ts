import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Prüfungen zum festen Seitenkopf, für kopfzeile.spec.ts und für Durchläufe mit eigenen Daten
 * (das Angebot in rechnungen.spec.ts).
 */

/** Laptop mit 14 Zoll (#355) und Handy */
export const LAPTOP = { width: 1470, height: 800 };
export const HANDY = { width: 375, height: 812 };

export async function zumEnde(p: Page): Promise<void> {
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // Sonst prüft der Test nichts: die Seite muss lang genug sein, dass der Kopf ohne Fixierung verschwände
  expect(await p.evaluate(() => window.scrollY)).toBeGreaterThan(200);
}

export function kopfUnterkante(p: Page): Promise<number> {
  return p.locator(".main > .page-head").evaluate((head) => head.getBoundingClientRect().bottom);
}

/** Ganz im Fenster und von nichts verdeckt: In der Mitte des Elements liegt das Element selbst */
export async function sichtbar(element: Locator): Promise<void> {
  await expect(element).toBeInViewport({ ratio: 1 });
  const obenauf = await element.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  });
  expect(obenauf, "verdeckt").toBe(true);
}

/** Titel und Status einer Detailseite bleiben am Handy beim Scrollen neben dem Titel sichtbar */
export async function statusBleibtSichtbar(p: Page, path: string): Promise<void> {
  const vorher = p.viewportSize();
  await p.setViewportSize(HANDY);
  try {
    await p.goto(path);
    const head = p.locator(".main > .page-head");
    await expect(head.getByRole("heading", { level: 1 })).toBeVisible();
    await zumEnde(p);
    await sichtbar(head.getByRole("heading", { level: 1 }));
    await sichtbar(head.locator(".pill").first());
  } finally {
    if (vorher) await p.setViewportSize(vorher);
  }
}
