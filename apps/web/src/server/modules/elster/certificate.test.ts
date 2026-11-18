import { germanDay } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { makeTestPfx } from "./test-zertifikat.ts";

const PIN = "4711-geheim";
const pfx = makeTestPfx(PIN);

describe.skipIf(!testDatabaseUrl || !pfx)("ELSTER-Zertifikat hochladen (Postgres, #1366)", () => {
  let sql: postgres.Sql;
  let certificate: typeof import("./certificate.ts");
  const upload = (pin: string, validUntil: string | null) =>
    certificate.saveCertificate("test-user", { filename: "test.pfx", bytes: pfx!.pfx, validUntil, pin });

  beforeAll(async () => {
    sql = await setupTestDb();
    certificate = await import("./certificate.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate elster_certificates`;
  });

  it("mit PIN gilt das Datum aus der Datei; die PIN steht weder in der Tabelle noch im Änderungsprotokoll", async () => {
    const expected = germanDay(pfx!.notAfter);
    expect(await upload(PIN, "2027-01-01")).toEqual({ validUntil: expected, readFromFile: true });
    const [row] = await sql`select valid_until::text, pin_ciphertext from elster_certificates where active`;
    expect(row).toEqual({ valid_until: expected, pin_ciphertext: null });
    const audit =
      await sql`select coalesce(old_value::text, '') || coalesce(new_value::text, '') as data from audit_log where table_name = 'elster_certificates'`;
    expect(audit.length).toBeGreaterThan(0);
    for (const { data } of audit) expect(data).not.toContain(PIN);
  });

  it("mit falscher PIN gilt der Eintrag, ohne ihn bleibt das Datum leer", async () => {
    expect(await upload("falsch", "2027-01-01")).toEqual({ validUntil: "2027-01-01", readFromFile: false });
    expect(await upload("falsch", null)).toEqual({ validUntil: null, readFromFile: false });
    // Das neue ersetzt das alte Zertifikat wie bisher
    expect(await sql`select valid_until from elster_certificates where active`).toEqual([{ valid_until: null }]);
  });
});
