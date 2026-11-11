import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Eigene Sachkonten (#270): Die EÜR aus dem Journal rechnet nach Kontonummer (euerZuordnung). Die Buchungen kommen aus einer
 * Stelle (buchungen); sie löst ein eigenes Konto dort auf das Konto seiner Elternkategorie auf, damit die EÜR, die Zuordnung
 * zu Zeilen und der Abgleich ein eigenes Konto wie die Kategorie zählen. Alle Daten sind erfunden.
 */

describe.skipIf(!testDatabaseUrl)("Journal für die EÜR mit eigenen Konten (Postgres, #270)", () => {
  let sql: postgres.Sql;
  let loader: typeof import("./euer-journal-buchungen.ts");
  let konten: typeof import("../eigene-konten/index.ts");
  let dbModule: typeof import("../../db/index.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    loader = await import("./euer-journal-buchungen.ts");
    konten = await import("../eigene-konten/index.ts");
    dbModule = await import("../../db/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate own_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, kontenrahmen) values (1, 'Testfirma', 'SKR03')`;
  });

  async function buchen(kontenrahmen: string, aufwand: string) {
    await sql.begin(async (tx) => {
      const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-03-02', 'Eingangsrechnung', 'manuell', gen_random_uuid(), ${kontenrahmen}) returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, ${aufwand}, 10000, 0), (${e!.id}, '1200', 0, 10000)`;
      await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
    });
  }

  const konten_ = async () => (await loader.buchungen(dbModule.db, undefined)).flatMap((b) => b.zeilen.map((z) => z.account)).sort();

  it("zeigt ein eigenes Konto als Konto seiner Elternkategorie, alles andere unverändert", async () => {
    await konten.createOwnAccount(actor, { account: "4999", name: "Software: Entwicklung", parentCategory: "software" });
    await buchen("SKR03", "4999");
    expect(await konten_()).toEqual(["1200", "4964"]);
  });

  it("löst auch ein archiviertes Konto auf, für Buchungen, die schon darauf liegen", async () => {
    const id = await konten.createOwnAccount(actor, { account: "4999", name: "Software: Entwicklung", parentCategory: "bewirtung" });
    await buchen("SKR03", "4999");
    await konten.setOwnAccountArchived(actor, id, true);
    expect(await konten_()).toEqual(["1200", "4650"]);
  });

  it("dieselbe Nummer in einer Buchung des anderen Kontenrahmens bleibt, wie sie ist", async () => {
    await konten.createOwnAccount(actor, { account: "4999", name: "Software: Entwicklung", parentCategory: "software" });
    // Nach einem Wechsel des Kontenrahmens hat das Konto keine Entsprechung im neuen Rahmen
    await sql`update company set kontenrahmen = 'SKR04'`;
    await buchen("SKR04", "4999");
    expect(await konten_()).toEqual(["1200", "4999"]);
  });
});
