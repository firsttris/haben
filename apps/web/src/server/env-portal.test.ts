import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Portal (#504, Stufe 2): HABEN_PORTAL_URL führt „Firma wechseln“ ins Portal. Nur mit SSO, weil das Portal nur mit SSO
 * anmeldet, und nicht zusammen mit HABEN_FIRMEN, damit es genau einen Weg gibt.
 */

describe("HABEN_PORTAL_URL", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of ["OIDC_ONLY", "HABEN_FIRMEN", "HABEN_PORTAL_URL"]) vi.stubEnv(key, "");
    vi.stubEnv("DATABASE_URL", "postgres://test@localhost/test");
    vi.stubEnv("BETTER_AUTH_URL", "https://nord.example.de");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("HABEN_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());
  const load = async () => (await import("./env.ts")).env();
  const sso = () => {
    vi.stubEnv("OIDC_ONLY", "true");
    vi.stubEnv("OIDC_ISSUER", "https://auth.example.de");
    vi.stubEnv("OIDC_CLIENT_ID", "haben");
    vi.stubEnv("OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("OIDC_GROUP_INHABER", "haben-nord-inhaber");
    vi.stubEnv("OIDC_GROUP_STEUERBERATUNG", "haben-nord-steuerberatung");
  };

  it("nimmt die Adresse des Portals mit SSO an und speichert ihre Origin", async () => {
    sso();
    vi.stubEnv("HABEN_PORTAL_URL", "https://portal.example.de/");
    await expect(load()).resolves.toMatchObject({ HABEN_PORTAL_URL: "https://portal.example.de" });
  });

  it("startet ohne SSO nicht", async () => {
    vi.stubEnv("HABEN_PORTAL_URL", "https://portal.example.de");
    await expect(load()).rejects.toThrow(/HABEN_PORTAL_URL.*OIDC_ONLY=true/s);
  });

  it("startet nicht zusammen mit HABEN_FIRMEN", async () => {
    sso();
    vi.stubEnv("HABEN_PORTAL_URL", "https://portal.example.de");
    vi.stubEnv("HABEN_FIRMEN", "Nord|https://nord.example.de;Süd|https://sued.example.de");
    await expect(load()).rejects.toThrow(/HABEN_PORTAL_URL.*HABEN_FIRMEN/s);
  });

  it.each(["http://portal.example.de", "https://portal.example.de/firmen", "https://a:b@portal.example.de", "javascript:alert(1)"])(
    "lehnt %s ab",
    async (adresse) => {
      sso();
      vi.stubEnv("HABEN_PORTAL_URL", adresse);
      await expect(load()).rejects.toThrow("HABEN_PORTAL_URL");
    },
  );

  it("ist ohne Angabe nicht gesetzt", async () => {
    sso();
    expect((await load()).HABEN_PORTAL_URL).toBeUndefined();
  });
});
