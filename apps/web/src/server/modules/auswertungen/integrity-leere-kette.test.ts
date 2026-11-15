import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Integrität ohne einen einzigen Eintrag (#1137)", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const befunde = (tx: postgres.Sql | postgres.TransactionSql = sql) =>
    tx<{ art: string; tabelle: string; zeile: string | null; befund: string }[]>`
      select art, tabelle, zeile, befund from haben_integrity_problems()`;

  /**
   * Führt work wie ein Betreiber mit vollem Zugriff aus — Trigger abgeschaltet — und rollt danach zurück.
   * So entsteht der Zustand einer Instanz nach einem Reset, ohne die Testdatenbank zu verlieren.
   */
  async function imReset<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    let result: T;
    const rollback = new Error("rollback");
    await sql
      .begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        result = await work(tx);
        await tx`set local session_replication_role = origin`;
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
    return result!;
  }

  it("meldet nach einem Reset ohne Eintrag und ohne Kopf keinen Befund", async () => {
    const leer = await imReset(async (tx) => {
      await tx`delete from audit_log`;
      await tx`delete from audit_chain`;
      return befunde(tx);
    });
    expect(leer).toEqual([]);
  });

  it("nimmt einen Kopf 0 mit dem Vorgänger des ersten Eintrags als leere Kette an", async () => {
    const leer = await imReset(async (tx) => {
      await tx`delete from audit_log`;
      await tx`delete from audit_chain`;
      await tx`insert into audit_chain (id, seq, hash) values (1, 0, haben_audit_genesis())`;
      return befunde(tx);
    });
    expect(leer).toEqual([]);
  });

  it("meldet einen Kopf, der Einträge behauptet, die nicht mehr da sind", async () => {
    const [vorher] = await sql<{ seq: string }[]>`select seq from audit_chain`;
    expect(Number(vorher!.seq)).toBeGreaterThan(0);
    const abgerissen = await imReset(async (tx) => {
      await tx`delete from audit_log`;
      return befunde(tx);
    });
    expect(abgerissen).toEqual([
      {
        art: "kopf",
        tabelle: "audit_chain",
        zeile: null,
        befund: `Kopf steht bei ${Number(vorher!.seq)}, das Audit-Log endet bei 0`,
      },
    ]);
  });

  it("meldet Einträge ohne Kopf weiter als fehlenden Kopf", async () => {
    const ohneKopf = await imReset(async (tx) => {
      await tx`delete from audit_chain`;
      return befunde(tx);
    });
    expect(ohneKopf).toEqual([{ art: "kopf", tabelle: "audit_chain", zeile: null, befund: "Kopf der Kette fehlt" }]);
  });
});
