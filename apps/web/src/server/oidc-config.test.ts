import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OIDC_KEYS = [
  "OIDC_ONLY",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_DISPLAY_NAME",
  "OIDC_GROUPS_CLAIM",
  "OIDC_GROUP_INHABER",
  "OIDC_GROUP_STEUERBERATUNG",
];

describe("Konfiguration der Betriebsart", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of OIDC_KEYS) vi.stubEnv(key, "");
    vi.stubEnv("DATABASE_URL", "postgres://test@localhost/test");
    vi.stubEnv("BETTER_AUTH_URL", "https://haben.example.de");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("HABEN_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());
  const sso = () => {
    vi.stubEnv("OIDC_ONLY", "true");
    vi.stubEnv("OIDC_ISSUER", "https://auth.example.de");
    vi.stubEnv("OIDC_CLIENT_ID", "haben");
    vi.stubEnv("OIDC_CLIENT_SECRET", "test-secret");
    vi.stubEnv("OIDC_GROUP_INHABER", "haben-inhaber");
    vi.stubEnv("OIDC_GROUP_STEUERBERATUNG", "haben-steuerberatung");
  };
  const load = async () => (await import("./env.ts")).env();

  it("ist ohne OIDC_ONLY im Standardmodus", async () => {
    const config = await load();
    expect(config.OIDC_ONLY).toBe(false);
    expect(config.OIDC_GROUPS_CLAIM).toBe("groups");
  });

  it("schaltet SSO nicht allein durch Anbieterwerte ein und prüft sie im Standardmodus nicht", async () => {
    vi.stubEnv("OIDC_ISSUER", "https://auth.example.de");
    vi.stubEnv("OIDC_CLIENT_ID", "haben");
    expect((await load()).OIDC_ONLY).toBe(false);
    const { ssoOnly } = await import("./sso-policy.ts");
    expect(ssoOnly()).toBe(false);
  });

  it("nimmt eine vollständige SSO-Konfiguration an", async () => {
    sso();
    expect(await load()).toMatchObject({ OIDC_ONLY: true, OIDC_GROUPS_CLAIM: "groups", OIDC_GROUP_INHABER: "haben-inhaber" });
  });

  it.each(["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_GROUP_INHABER", "OIDC_GROUP_STEUERBERATUNG"])(
    "verlangt im SSO-Modus %s",
    async (key) => {
      sso();
      vi.stubEnv(key, "");
      await expect(load()).rejects.toThrow(key);
    },
  );

  it.each([" ", " haben-inhaber", "haben-inhaber "])("lehnt die Gruppe %j mit Leerzeichen ab", async (group) => {
    sso();
    vi.stubEnv("OIDC_GROUP_INHABER", group);
    await expect(load()).rejects.toThrow("OIDC_GROUP_INHABER");
  });

  it("verlangt zwei verschiedene Gruppen", async () => {
    sso();
    vi.stubEnv("OIDC_GROUP_STEUERBERATUNG", "haben-inhaber");
    await expect(load()).rejects.toThrow("OIDC_GROUP_STEUERBERATUNG");
  });

  it.each(["groups[0]", "a.b c", "$.groups", "groups;drop", "x".repeat(101)])("lehnt den Claimnamen %j als Ausdruck ab", async (claim) => {
    sso();
    vi.stubEnv("OIDC_GROUPS_CLAIM", claim);
    await expect(load()).rejects.toThrow("OIDC_GROUPS_CLAIM");
  });

  it.each(["http://auth.example.de", "https://user:secret@auth.example.de", "https://auth.example.de?query=1", "https://auth.example.de#fragment"])(
    "lehnt den unsicheren Issuer %s ab",
    async (issuer) => {
      sso();
      vi.stubEnv("OIDC_ISSUER", issuer);
      await expect(load()).rejects.toThrow();
    },
  );

  it("lässt HTTP auf Loopback nur außerhalb von production zu", async () => {
    sso();
    vi.stubEnv("OIDC_ISSUER", "http://127.0.0.1:4555");
    vi.stubEnv("NODE_ENV", "test");
    expect((await load()).OIDC_ISSUER).toBe("http://127.0.0.1:4555");
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    await expect(load()).rejects.toThrow();
  });

  it.each(["yes", "1", "TRUE", "no"])("lehnt den ungültigen Wert OIDC_ONLY=%s ab", async (value) => {
    sso();
    vi.stubEnv("OIDC_ONLY", value);
    await expect(load()).rejects.toThrow();
  });
});
