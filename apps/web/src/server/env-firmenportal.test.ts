import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Firmenportal (#504, Stufe 2): HABEN_FIRMENPORTAL_URL führt die Zeile „Zum Firmenportal“ ins Firmenportal. Nur mit SSO, weil das Firmenportal nur mit SSO
 * anmeldet, und nicht zusammen mit HABEN_FIRMEN, damit es genau einen Weg gibt.
 */

describe("HABEN_FIRMENPORTAL_URL", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of ["OIDC_ONLY", "HABEN_FIRMEN", "HABEN_FIRMENPORTAL_URL"]) vi.stubEnv(key, "");
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

  it("nimmt die Adresse des Firmenportals mit SSO an und speichert ihre Origin", async () => {
    sso();
    vi.stubEnv("HABEN_FIRMENPORTAL_URL", "https://firmenportal.example.de/");
    await expect(load()).resolves.toMatchObject({ HABEN_FIRMENPORTAL_URL: "https://firmenportal.example.de" });
  });

  it("startet ohne SSO nicht", async () => {
    vi.stubEnv("HABEN_FIRMENPORTAL_URL", "https://firmenportal.example.de");
    await expect(load()).rejects.toThrow(/HABEN_FIRMENPORTAL_URL.*OIDC_ONLY=true/s);
  });

  it("startet nicht zusammen mit HABEN_FIRMEN", async () => {
    sso();
    vi.stubEnv("HABEN_FIRMENPORTAL_URL", "https://firmenportal.example.de");
    vi.stubEnv("HABEN_FIRMEN", "Nord|https://nord.example.de;Süd|https://sued.example.de");
    await expect(load()).rejects.toThrow(/HABEN_FIRMENPORTAL_URL.*HABEN_FIRMEN/s);
  });

  it.each(["http://firmenportal.example.de", "https://firmenportal.example.de/firmen", "https://a:b@firmenportal.example.de", "javascript:alert(1)"])(
    "lehnt %s ab",
    async (adresse) => {
      sso();
      vi.stubEnv("HABEN_FIRMENPORTAL_URL", adresse);
      await expect(load()).rejects.toThrow("HABEN_FIRMENPORTAL_URL");
    },
  );

  it("ist ohne Angabe nicht gesetzt", async () => {
    sso();
    expect((await load()).HABEN_FIRMENPORTAL_URL).toBeUndefined();
  });
});
