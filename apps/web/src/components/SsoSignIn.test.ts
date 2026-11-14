import { describe, expect, it } from "vitest";
import { ssoAutoStart } from "./SsoSignIn.tsx";

/* Aus dem Portal (#504) startet die Login-Seite die SSO-Anmeldung selbst, aber nie nach einem abgewiesenen Callback */

describe("ssoAutoStart", () => {
  it("startet mit ?anmelden=sso", () => {
    expect(ssoAutoStart("?anmelden=sso")).toBe(true);
  });

  it.each(["", "?anmelden=passwort", "?anmelden=sso&sso=gruppe", "?sso=fehler&anmelden=sso", "?anmelden=SSO"])("startet nicht bei %j", (search) => {
    expect(ssoAutoStart(search)).toBe(false);
  });
});
