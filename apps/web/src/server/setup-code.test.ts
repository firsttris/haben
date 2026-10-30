import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Einrichtungscode (Postgres)", () => {
  let sql: postgres.Sql;
  let auth: typeof import("./auth.ts").auth;
  let setupCode: typeof import("./setup-code.ts").setupCode;
  const body = { name: "Max Mustermann", email: "max@example.com", password: "ein-sehr-langes-passwort" };
  const signUp = (code?: string) =>
    auth().api.signUpEmail({ body, headers: new Headers(code === undefined ? {} : { "x-haben-setup-code": code }) });

  beforeAll(async () => {
    sql = await setupTestDb();
    ({ auth } = await import("./auth.ts"));
    ({ setupCode } = await import("./setup-code.ts"));
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("legt das erste Konto nur mit dem Code aus dem Log an", async () => {
    expect(setupCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await expect(signUp()).rejects.toThrow(/Einrichtungscode/);
    await expect(signUp("AAAA-BBBB-CCCC")).rejects.toThrow(/Einrichtungscode/);
    expect(await sql`select 1 from "user"`).toHaveLength(0);

    // Klein geschrieben und ohne Bindestriche gilt er auch
    await signUp(setupCode().replaceAll("-", "").toLowerCase());
    expect(await sql`select email from "user"`).toEqual([{ email: "max@example.com" }]);
  });
});
