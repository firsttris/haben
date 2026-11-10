import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Review: Ist die Datenbank bei der ersten Startprüfung nicht erreichbar (Neustart von Postgres, Compose-Reihenfolge),
 * darf das Ergebnis nicht für die ganze Laufzeit hängen bleiben. Sonst antwortet jede Anfrage an /api/auth/* auch nach
 * der Erholung der Datenbank mit einem Fehler, und niemand kann sich anmelden.
 */
let failNext = true;
vi.mock("./db/index.ts", () => {
  const chain = (rows: unknown[]) => {
    const query = { from: () => query, where: () => query, limit: async () => rows };
    return query;
  };
  return {
    schema: { user: { id: "id", role: "role", lockedAt: "lockedAt" }, session: {}, account: {}, passkey: {} },
    db: {
      select: () => {
        if (failNext) {
          failNext = false;
          throw new Error("ECONNREFUSED");
        }
        return chain([]);
      },
      delete: () => ({ where: async () => undefined }),
    },
  };
});

describe("Startprüfung der Betriebsart (Review)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prüft nach einem vorübergehenden Datenbankfehler erneut, statt den Fehler dauerhaft zu behalten", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test@localhost/test");
    vi.stubEnv("BETTER_AUTH_URL", "https://haben.example.de");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("HABEN_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
    vi.stubEnv("OIDC_ONLY", "false");
    const { modeStartupProblem } = await import("./sso-mode.ts");
    await expect(modeStartupProblem()).rejects.toThrow("ECONNREFUSED");
    // Die Datenbank ist wieder da
    await expect(modeStartupProblem()).resolves.toBeNull();
  });
});
