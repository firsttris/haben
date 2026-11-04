import { expect, test } from "@playwright/test";
import { ANONYMOUS, USER } from "./daten.ts";

/*
 * Passkey-Autofill auf der Anmeldeseite. Es braucht ein Feld mit autocomplete="webauthn", sonst wirft
 * startAuthentication von @simplewebauthn/browser, noch bevor der Browser gefragt wird. Das Feld gibt es erst im
 * Passwort-Formular. Bricht das Autofill ab, hat niemand etwas getan, und die Seite zeigt keinen Fehler.
 */

test.use(ANONYMOUS);

declare global {
  interface Window {
    conditionalRequests: number;
  }
}

test.beforeEach(async ({ page }) => {
  // Headless gibt es keinen Passkey; ein abgebrochenes Autofill sieht so aus, wie der Browser es meldet
  await page.addInitScript(() => {
    window.conditionalRequests = 0;
    const get = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = (options) => {
      if (options?.mediation !== "conditional") return get(options);
      window.conditionalRequests++;
      return Promise.reject(new DOMException("Abgebrochen", "NotAllowedError"));
    };
  });
  await page.goto("/login", { waitUntil: "networkidle" });
});

test("Beim Öffnen steht kein Fehler auf der Seite", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Mit Passkey anmelden" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Das Passwort-Formular bietet das Autofill an, ein Abbruch bleibt ohne Fehler", async ({ page }) => {
  await page.getByRole("button", { name: "Passwort verwenden" }).click();
  await expect(page.getByLabel("E-Mail")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.conditionalRequests)).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Ein falsches Passwort zeigt weiter einen Fehler", async ({ page }) => {
  await page.getByRole("button", { name: "Passwort verwenden" }).click();
  await page.getByLabel("E-Mail").fill(USER.email);
  await page.getByLabel("Passwort").fill("falsches-passwort");
  await page.getByRole("button", { name: "Mit Passwort anmelden" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});
