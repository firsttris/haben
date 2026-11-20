import { sql as query } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { checkTriggerIntegrity } from "./trigger-inventory.ts";

/*
 * Fremde Objekte im Katalog: Die Prüffunktionen rufen eingebaute Funktionen wie to_jsonb ohne Schema auf. Eine Funktion
 * mit genau passenden Argumenttypen in public geht der eingebauten vor, egal wo public im Suchpfad steht; ein Superuser
 * kann solche Funktionen auch in pg_catalog anlegen. Selbst angelegte Objekte haben eine OID ab 16384. Eine frische
 * Installation hat außer dem Sollbestand und den Erweiterungen keine.
 * https://www.postgresql.org/docs/18/typeconv-func.html
 */
describe.skipIf(!testDatabaseUrl)("Fremde Funktionen, Operatoren und Casts (Postgres)", () => {
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

  const befund = (text: string) => ({ art: "sperre", tabelle: "Datenbank", zeile: null, seq: null, befund: text });

  it.each([
    [
      "create function public.to_jsonb(public.vat_returns) returns jsonb language sql stable as $$ select pg_catalog.to_jsonb($1) $$",
      "Zusätzliche Funktion public.to_jsonb(public.vat_returns) überdeckt eine gleichnamige Funktion",
    ],
    [
      `create function public.jsonb_build_array(bigint, text, text, text, text, text, jsonb, jsonb) returns jsonb language sql immutable as
        $$ select pg_catalog.jsonb_build_array($1, $2, $3, $4, $5, $6, $7, $8) $$`,
      "Zusätzliche Funktion public.jsonb_build_array(bigint, text, text, text, text, text, jsonb, jsonb) überdeckt eine gleichnamige Funktion",
    ],
    [
      "create aggregate public.jsonb_agg(jsonb) (sfunc = pg_catalog.jsonb_concat, stype = jsonb)",
      "Zusätzliche Funktion public.jsonb_agg(jsonb) überdeckt eine gleichnamige Funktion",
    ],
    [
      "create function public.haben_pick(text, jsonb) returns jsonb language sql as $$ select $2 $$",
      "Zusätzliche Funktion public.haben_pick(text, jsonb) überdeckt eine gleichnamige Funktion",
    ],
    [
      "create function pg_catalog.to_jsonb(public.vat_returns) returns jsonb language sql stable as $$ select '{}'::jsonb $$",
      "Zusätzliche Funktion pg_catalog.to_jsonb(public.vat_returns) im Systemschema pg_catalog",
    ],
    [
      "create operator public.|| (leftarg = jsonb, rightarg = jsonb, function = pg_catalog.jsonb_concat)",
      "Zusätzlicher Operator public.||(jsonb, jsonb) überdeckt einen gleichnamigen Operator",
    ],
    // Ein Cast in json für einen eigenen Typ ändert, was to_jsonb aus dem Wert macht
    ["create cast (public.vat_return_status as json) with inout", "Zusätzlicher Cast public.vat_return_status → json"],
  ])("meldet %s", async (statement, text) => {
    await rolledBack(async (tx) => {
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([]);
      await tx.execute(query.raw(statement));
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([befund(text)]);
    });
  });

  it("meldet ein Schema im Suchpfad der Verbindung, etwa mit dem Namen der Anmeldung", async () => {
    await rolledBack(async (tx) => {
      const [{ name }] = (await tx.execute<{ name: string }>(query`select current_user as name`)) as unknown as [{ name: string }];
      await tx.execute(query.raw(`create schema "${name}"`));
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([befund(`Schema ${name} im Suchpfad der Verbindung`)]);
    });
  });

  it("meldet, wenn pg_catalog im Suchpfad der Verbindung nicht vorn steht", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(query`set local search_path = public, pg_catalog`);
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([befund("pg_catalog steht im Suchpfad der Verbindung nicht vorn")]);
      expect(await tx.execute(query`select current_setting('search_path') as path`)).toEqual([{ path: "public, pg_catalog" }]);
    });
  });

  it("nennt eigene Funktionen und Operatoren mit eigenem Namen nur als Hinweis", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(query`create function public.betreiber_hilfe() returns integer language sql as $$ select 1 $$`);
      await tx.execute(query`create operator public.=== (leftarg = integer, rightarg = integer, function = pg_catalog.int4eq)`);
      expect(await checkTriggerIntegrity(tx)).toEqual({
        problems: [],
        hints: ["Zusätzliche Funktion public.betreiber_hilfe()", "Zusätzlicher Operator public.===(integer, integer)"],
      });
    });
  });

  // Der Fall aus der Meldung: Die Prüfung der Siegel rechnet mit der Überladung und meldet nichts, der Katalog schon
  it("meldet die Überladung, mit der eine geänderte Voranmeldung zum Siegel passt", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(query`insert into company (id, name) values (1, 'Probe') on conflict (id) do nothing`);
      const [{ id }] = (await tx.execute<{ id: string }>(
        query`insert into vat_returns (year, month, kz81, kz66, kz83) values (2026, 9, 10000, 950, 950) returning id`,
      )) as unknown as [{ id: string }];
      await tx.execute(query`update vat_returns set status = 'sent', transfer_ticket = 'et1234567890', sent_at = now(), locked_at = now() where id = ${id}`);
      await tx.execute(query`set constraints all immediate`);
      await tx.execute(
        query.raw(`create function public.to_jsonb(public.vat_returns) returns jsonb language sql stable as $$
          select case when $1.id = '${id}' then pg_catalog.to_jsonb($1) || pg_catalog.jsonb_build_object('kz81', 10000)
                      else pg_catalog.to_jsonb($1) end $$`),
      );
      await tx.execute(query`alter table vat_returns disable trigger user`);
      await tx.execute(query`update vat_returns set kz81 = 999 where id = ${id}`);
      await tx.execute(query`alter table vat_returns enable trigger user`);
      expect(await tx.execute(query`select tabelle, befund from haben_integrity_problems() where zeile = ${id}`)).toEqual([]);
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([
        befund("Zusätzliche Funktion public.to_jsonb(public.vat_returns) überdeckt eine gleichnamige Funktion"),
      ]);
    });
  });
});
