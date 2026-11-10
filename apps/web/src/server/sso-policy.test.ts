import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ISSUER = "https://auth.example.de";

async function policy(sso: boolean) {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgres://test@localhost/test");
  vi.stubEnv("BETTER_AUTH_URL", "https://haben.example.de");
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
  vi.stubEnv("HABEN_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubEnv("OIDC_ONLY", sso ? "true" : "false");
  vi.stubEnv("OIDC_ISSUER", ISSUER);
  vi.stubEnv("OIDC_CLIENT_ID", "haben");
  vi.stubEnv("OIDC_CLIENT_SECRET", "secret");
  vi.stubEnv("OIDC_GROUP_INHABER", "haben-inhaber");
  vi.stubEnv("OIDC_GROUP_STEUERBERATUNG", "haben-steuerberatung");
  return import("./sso-policy.ts");
}

describe("Wirksame Rolle je Betriebsart", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-11-08T12:00:00Z") }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  const soon = () => new Date(Date.now() + 60_000);

  it("nimmt im Standardmodus nur lokale Sitzungen mit lokaler Rolle eines ungesperrten Kontos", async () => {
    const { effectiveRole } = await policy(false);
    expect(effectiveRole({ oidcIssuer: null }, { role: "inhaber" })).toBe("inhaber");
    expect(effectiveRole({ oidcIssuer: null }, { role: "steuerberatung", lockedAt: new Date() })).toBeNull();
    expect(effectiveRole({ oidcIssuer: null }, { role: null })).toBeNull();
    // Eine SSO-Sitzung gilt nach dem Zurückschalten nicht mehr, auch mit lokaler Rolle
    expect(effectiveRole({ oidcIssuer: ISSUER, ssoRole: "inhaber", ssoExpiresAt: soon() }, { role: "inhaber" })).toBeNull();
  });

  it("nimmt im SSO-Modus nur die bestätigte externe Rolle dieses Issuers, nie die lokale", async () => {
    const { effectiveRole } = await policy(true);
    expect(effectiveRole({ oidcIssuer: ISSUER, ssoRole: "steuerberatung", ssoExpiresAt: soon() }, { role: "inhaber" })).toBe("steuerberatung");
    expect(effectiveRole({ oidcIssuer: ISSUER, ssoRole: "inhaber", ssoExpiresAt: soon() }, { role: null })).toBe("inhaber");
    // Lokale Sperren gehören nur zum Standardmodus
    expect(effectiveRole({ oidcIssuer: ISSUER, ssoRole: "inhaber", ssoExpiresAt: soon() }, { role: "steuerberatung", lockedAt: new Date() })).toBe("inhaber");
    expect(effectiveRole({ oidcIssuer: null }, { role: "inhaber" })).toBeNull();
    expect(effectiveRole({ oidcIssuer: "https://anderer.example", ssoRole: "inhaber", ssoExpiresAt: soon() }, { role: null })).toBeNull();
    expect(effectiveRole({ oidcIssuer: ISSUER, ssoRole: "admin", ssoExpiresAt: soon() }, { role: null })).toBeNull();
    expect(effectiveRole({ oidcIssuer: ISSUER, ssoRole: "inhaber", ssoExpiresAt: null }, { role: null })).toBeNull();
  });

  it("verweigert im SSO-Modus nach exakt abgelaufener Frist", async () => {
    const { effectiveRole } = await policy(true);
    const expires = new Date(Date.now() + 15 * 60_000);
    const session = { oidcIssuer: ISSUER, ssoRole: "inhaber", ssoExpiresAt: expires.toISOString() };
    vi.setSystemTime(expires.getTime() - 1);
    expect(effectiveRole(session, { role: null })).toBe("inhaber");
    vi.setSystemTime(expires);
    expect(effectiveRole(session, { role: null })).toBeNull();
  });
});

describe("Endpunkte je Betriebsart", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    "/sign-in/email",
    "/sign-up/email",
    "/change-password",
    "/set-password",
    "/reset-password",
    "/request-password-reset",
    "/passkey/generate-register-options",
    "/passkey/verify-authentication",
    "/sign-in/passkey",
    "/link-social",
    "/unlink-account",
    "/get-access-token",
    "/refresh-token",
  ])("sperrt im SSO-Modus %s", async (path) => {
    const { pathAllowed } = await policy(true);
    expect(pathAllowed(path, true)).toBe(false);
  });
  it.each(["/sign-in/social", "/callback/oidc", "/link-social", "/unlink-account", "/get-access-token"])("sperrt im Standardmodus %s", async (path) => {
    const { pathAllowed } = await policy(false);
    expect(pathAllowed(path, false)).toBe(false);
  });
  it("lässt die eigene Anmeldung jeder Betriebsart zu", async () => {
    const { pathAllowed } = await policy(true);
    expect(pathAllowed("/sign-in/social", true)).toBe(true);
    expect(pathAllowed("/callback/oidc", true)).toBe(true);
    expect(pathAllowed("/sign-in/email", false)).toBe(true);
    expect(pathAllowed("/passkey/verify-authentication", false)).toBe(true);
  });
});
