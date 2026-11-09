import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Review PR #479: Konfiguration der Betriebsart, Zusagen aus env.ts-Kommentar und docs/installation.md */
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

describe("Review: Konfiguration der Betriebsart", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of OIDC_KEYS) vi.stubEnv(key, "");
    vi.stubEnv("DATABASE_URL", "postgres://test@localhost/test");
    vi.stubEnv("BETTER_AUTH_URL", "https://haben.example.de");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("HABEN_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());
  const load = async () => (await import("./env.ts")).env();

  // docs/installation.md: OIDC_ISSUER „im Standardmodus ohne Wirkung“; env.ts: Anbieterwerte „werden im Standardmodus nicht gelesen“
  it.each([
    ["OIDC_ISSUER", "auth.example.de"],
    ["OIDC_GROUPS_CLAIM", "realm_access.roles"],
    ["OIDC_DISPLAY_NAME", "x".repeat(81)],
  ])("startet im Standardmodus trotz ungültigem %s", async (key, value) => {
    vi.stubEnv(key, value);
    await expect(load()).resolves.toMatchObject({ OIDC_ONLY: false });
  });

  it.each(["TRUE", "True", "1", "yes", " true"])("verweigert OIDC_ONLY=%s mit Hinweis auf die Variable", async (value) => {
    vi.stubEnv("OIDC_ONLY", value);
    await expect(load()).rejects.toThrow("OIDC_ONLY");
  });
});
