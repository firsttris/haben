import { expect, type Page, test } from "@playwright/test";
import { USER } from "./daten.ts";
import { einrichten, gehe } from "./einrichtung.ts";

async function anmelden(page: Page, password: string) {
  await gehe(page, "/login");
  await page.getByRole("button", { name: "Passwort verwenden" }).click();
  await page.getByLabel("E-Mail").fill(USER.email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Mit Passwort anmelden" }).click();
}

async function mitPasskeyAnmelden(page: Page) {
  await page.getByRole("button", { name: "Mit Passkey anmelden" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("Passwort ändern, Passkey-Sitzung abmelden und den Passkey weiterverwenden", async ({ page, browser, baseURL }) => {
  await einrichten(page);
  const second = await browser.newContext({ baseURL });
  try {
    const otherPage = await second.newPage();
    await anmelden(otherPage, USER.password);
    await expect(otherPage).not.toHaveURL(/\/login/);

    // Virtueller Chromium-Authenticator, damit Registrierung und Anmeldung die WebAuthn-Prüfung durchlaufen.
    // https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/
    const cdp = await second.newCDPSession(otherPage);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
    });
    await gehe(otherPage, "/einstellungen?bereich=sicherheit");
    const passkeys = otherPage.getByRole("region", { name: "Passkeys" });
    await passkeys.getByRole("button", { name: "Passkey hinzufügen" }).click();
    await expect(passkeys.getByText("Passkey hinzugefügt.")).toBeVisible();
    await second.clearCookies();
    await gehe(otherPage, "/login");
    await mitPasskeyAnmelden(otherPage);

    await gehe(page, "/einstellungen?bereich=sicherheit");
    const card = page.getByRole("region", { name: "Passwort ändern" });
    const newPassword = "mein-neues-e2e-passwort";
    await card.getByLabel("Bisheriges Passwort").fill("ein-falsches-passwort");
    await card.getByLabel("Neues Passwort", { exact: true }).fill(newPassword);
    await card.getByLabel("Neues Passwort bestätigen").fill(newPassword);
    await card.getByRole("button", { name: "Passwort ändern" }).click();
    await expect(card.getByRole("alert")).toHaveText("Das bisherige Passwort stimmt nicht.");

    await card.getByLabel("Bisheriges Passwort").fill(USER.password);
    await card.getByLabel("Neues Passwort bestätigen").fill("abweichendes-e2e-passwort");
    await card.getByRole("button", { name: "Passwort ändern" }).click();
    await expect(card.getByRole("alert")).toHaveText("Die neuen Passwörter stimmen nicht überein.");

    await card.getByLabel("Neues Passwort bestätigen").fill(newPassword);
    await card.getByRole("button", { name: "Passwort ändern" }).click();
    await expect(page).toHaveURL(/\/login/);
    await gehe(page, "/einstellungen?bereich=sicherheit");
    await expect(page).toHaveURL(/\/login/);

    await gehe(otherPage, "/einstellungen?bereich=sicherheit");
    await expect(otherPage).toHaveURL(/\/login/);
    await mitPasskeyAnmelden(otherPage);

    await cdp.send("WebAuthn.disable");
    await second.clearCookies();
    await anmelden(otherPage, USER.password);
    await expect(otherPage.getByRole("alert")).toBeVisible();
    await anmelden(otherPage, newPassword);
    await expect(otherPage).not.toHaveURL(/\/login/);
  } finally {
    await second.close();
  }
});
