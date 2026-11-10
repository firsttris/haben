import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** „Seit deinem letzten Besuch“ im SSO-Modus: Die Frist von 15 Minuten erzeugt viele Anmeldungen je Besuch (Postgres) */
describe.skipIf(!testDatabaseUrl)("Besuche der Steuerberatung im SSO-Modus (Postgres)", () => {
  let database: postgres.Sql;
  let zugang: typeof import("./index.ts");
  const HOUR = 3_600_000;
  // user_logins ist nur anhängbar: je Fall ein eigenes Konto
  let current = "";
  let run = 0;
  const newAccount = async () => {
    current = `kanzlei-${++run}`;
    await database`insert into "user"(id, name, email, role) values (${current}, 'Kanzlei', ${`${current}@example.de`}, null)`;
  };
  const base = Date.now();
  const hoursAgo = (hours: number) => new Date(base - hours * HOUR);
  const logins = async (...ages: number[]) => {
    for (const hours of ages)
      await database`insert into user_logins(user_id, role, method, at) values (${current}, 'steuerberatung', 'sso', ${hoursAgo(hours).toISOString()})`;
  };

  beforeAll(async () => {
    vi.stubEnv("OIDC_ONLY", "true");
    vi.stubEnv("OIDC_ISSUER", "https://idp.example.de");
    vi.stubEnv("OIDC_CLIENT_ID", "haben");
    vi.stubEnv("OIDC_CLIENT_SECRET", "test");
    vi.stubEnv("OIDC_GROUP_INHABER", "owner");
    vi.stubEnv("OIDC_GROUP_STEUERBERATUNG", "staff");
    database = await setupTestDb();
    zugang = await import("./index.ts");
  }, 60_000);
  beforeEach(async () => {
    await newAccount();
  });
  afterAll(async () => {
    await database?.end();
    await (await import("../../db/index.ts")).closeDatabase();
    vi.unstubAllEnvs();
  });

  it("zählt erneute Anmeldungen innerhalb eines Besuchs nicht als neuen Besuch", async () => {
    await logins(5, 2.5, 0.25, 0);
    expect((await zugang.changesSinceLastVisit(current)).since).toBeNull();
  });

  it("nimmt das Ende des vorigen Besuchs, nicht die vorletzte Anmeldung", async () => {
    await logins(24, 20, 19.75, 3, 2.75, 0.1);
    expect((await zugang.changesSinceLastVisit(current)).since).toEqual(hoursAgo(19.75));
  });

  it("beginnt erst nach mehr als sechs Stunden ohne Anmeldung einen neuen Besuch", async () => {
    await logins(6, 0);
    expect((await zugang.changesSinceLastVisit(current)).since).toBeNull();
    await newAccount();
    await logins(6.01, 0);
    expect((await zugang.changesSinceLastVisit(current)).since).toEqual(hoursAgo(6.01));
  });

  it("nimmt von mehreren früheren Besuchen den jüngsten", async () => {
    await logins(72, 48, 24, 0);
    expect((await zugang.changesSinceLastVisit(current)).since).toEqual(hoursAgo(24));
  });
});
