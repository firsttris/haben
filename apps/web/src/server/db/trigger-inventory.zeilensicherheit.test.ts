import { sql as query } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { checkTriggerIntegrity } from "./trigger-inventory.ts";

/*
 * Zeilensicherheit (Row Level Security): Der Eigentümer einer Tabelle kann sie einschalten und mit einer Policy Zeilen vor
 * anderen Rollen verbergen, auch vor der App-Anmeldung. Ein festgeschriebener Datensatz samt Siegel verschwände so aus der
 * App und aus den Prüfungen, die von Datensätzen oder Siegeln ausgehen. Haben selbst nutzt keine Zeilensicherheit; der
 * Sollbestand nennt, was eine frische Installation hat.
 * https://www.postgresql.org/docs/18/ddl-rowsecurity.html
 */
describe.skipIf(!testDatabaseUrl)("Zeilensicherheit im Sollbestand (Postgres)", () => {
  let sql: postgres.Sql;
  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function rolledBack(check: (tx: ReturnType<typeof drizzle>) => Promise<void>) {
    const rollback = new Error("Gegenprobe zurückrollen");
    try {
      await drizzle(sql).transaction(async (tx) => {
        await check(tx as unknown as ReturnType<typeof drizzle>);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  const befund = (tabelle: string, text: string) => ({ art: "sperre", tabelle, zeile: null, seq: null, befund: text });

  it.each([
    [["alter table public.vat_returns enable row level security"], [befund("vat_returns", "Zeilensicherheit auf vat_returns eingeschaltet")]],
    [["alter table public.seals force row level security"], [befund("seals", "Zeilensicherheit auf seals erzwungen")]],
    [["create policy probe on public.vat_returns using (true)"], [befund("vat_returns", "Policy probe auf vat_returns angelegt")]],
  ])("meldet %s", async (statements, expected) => {
    await rolledBack(async (tx) => {
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([]);
      for (const statement of statements) await tx.execute(query.raw(statement));
      expect((await checkTriggerIntegrity(tx)).problems).toEqual(expected);
    });
  });

  // Der Fall aus der Meldung: Für eine Rolle ohne Eigentum an den Tabellen verschwinden Voranmeldung und Siegel. Zwei Prüfungen
  // schlagen an: Der Sollbestand meldet die Zeilensicherheit, und weil das Audit-Log sichtbar bleibt, meldet
  // haben_integrity_problems das Siegel, das dort steht, aber fehlt (0311).
  it("meldet Zeilensicherheit, die eine festgeschriebene Voranmeldung samt Siegel vor der prüfenden Rolle verbirgt", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(query`insert into company (id, name) values (1, 'Probe') on conflict (id) do nothing`);
      const [{ id }] = (await tx.execute<{ id: string }>(
        query`insert into vat_returns (year, month, kz81, kz66, kz83) values (2026, 9, 10000, 950, 950) returning id`,
      )) as unknown as [{ id: string }];
      await tx.execute(query`update vat_returns set status = 'sent', transfer_ticket = 'et1234567890', sent_at = now(), locked_at = now() where id = ${id}`);
      await tx.execute(query`set constraints all immediate`);
      await tx.execute(query`create role probe_pruefung nologin`);
      await tx.execute(query`grant usage on schema public to probe_pruefung`);
      await tx.execute(query`grant select on all tables in schema public to probe_pruefung`);
      await tx.execute(query.raw(`alter table public.vat_returns enable row level security`));
      await tx.execute(query.raw(`create policy verbergen on public.vat_returns using (id <> '${id}')`));
      await tx.execute(query.raw(`alter table public.seals enable row level security`));
      await tx.execute(query.raw(`create policy verbergen on public.seals using (row_id <> '${id}')`));
      await tx.execute(query`set local role probe_pruefung`);
      expect(await tx.execute(query`select count(*)::integer as n from vat_returns where id = ${id}`)).toEqual([{ n: 0 }]);
      expect(await tx.execute(query`select art, tabelle, zeile, befund from haben_integrity_problems()`)).toEqual([
        { art: "siegel", tabelle: "vat_returns", zeile: id, befund: "Siegel fehlt, steht aber im Audit-Log" },
      ]);
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([
        befund("seals", "Zeilensicherheit auf seals eingeschaltet"),
        befund("seals", "Policy verbergen auf seals angelegt"),
        befund("vat_returns", "Zeilensicherheit auf vat_returns eingeschaltet"),
        befund("vat_returns", "Policy verbergen auf vat_returns angelegt"),
      ]);
    });
  });
});
