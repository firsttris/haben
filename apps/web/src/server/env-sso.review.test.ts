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

  const sso = () => {
    vi.stubEnv("OIDC_ONLY", "true");
    vi.stubEnv("OIDC_ISSUER", "https://auth.example.de");
    vi.stubEnv("OIDC_CLIENT_ID", "haben");
    vi.stubEnv("OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("OIDC_GROUP_INHABER", "haben-inhaber");
    vi.stubEnv("OIDC_GROUP_STEUERBERATUNG", "haben-steuerberatung");
  };

  // OIDC Core 5.1.2: eigene Claims mit kollisionsfreiem Namen, üblich als URL; Auth0 empfiehlt das für eigene Claims
  it("nimmt einen URL-förmigen Claimnamen an", async () => {
    sso();
    vi.stubEnv("OIDC_GROUPS_CLAIM", "https://haben.example.de/groups");
    await expect(load()).resolves.toMatchObject({ OIDC_GROUPS_CLAIM: "https://haben.example.de/groups" });
  });

  it("lehnt einen Punkt außerhalb einer URL weiter ab: das sähe wie ein Pfad aus, Haben liest aber einen Claim wörtlich", async () => {
    sso();
    vi.stubEnv("OIDC_GROUPS_CLAIM", "realm_access.roles");
    await expect(load()).rejects.toThrow("OIDC_GROUPS_CLAIM");
  });

  it.each(["OIDC_ISSUER", "BETTER_AUTH_URL"])("nennt bei ungültiger URL in %s die Variable statt eines TypeError", async (key) => {
    sso();
    vi.stubEnv(key, "auth.example.de");
    await expect(load()).rejects.toThrow(key);
  });

  it.each(["TRUE", "True", "1", "yes", " true"])("verweigert OIDC_ONLY=%s mit Hinweis auf die Variable", async (value) => {
    vi.stubEnv("OIDC_ONLY", value);
    await expect(load()).rejects.toThrow("OIDC_ONLY");
  });
});
