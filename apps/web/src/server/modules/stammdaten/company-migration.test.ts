import { describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Firmendaten nach dem Anwenden der Migrationen", () => {
  it("lädt die Firmendaten samt optionalem Gründungsdatum", async () => {
    const sql = await setupTestDb();
    try {
      await sql`insert into company (id, name) values (1, 'Testfirma')`;
      const { loadCompany } = await import("./company.ts");
      expect(await loadCompany()).toMatchObject({ name: "Testfirma", foundedOn: null, foundingYear: null });
    } finally {
      await sql.end();
    }
  }, 30_000);
});
