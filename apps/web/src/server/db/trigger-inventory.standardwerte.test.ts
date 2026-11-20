import { sql as query } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { checkTriggerIntegrity, readTriggerInventory } from "./trigger-inventory.ts";

/*
 * Standardwerte im Sollbestand (#1580): An einem älteren Siegel erwartet haben_integrity_problems in später angelegten
 * Spalten NULL oder den Standardwert aus dem Katalog (0310_siegel_unabgedeckte_spalten.sql). Wer den Standardwert per
 * DDL nachzieht, fällt dort nicht auf. Der Sollbestand nennt deshalb die Standardwerte aller Tabellen, die in ein
 * Siegel eingehen, und die Prüfung vergleicht sie mit dem Katalog.
 */
describe.skipIf(!testDatabaseUrl)("Standardwerte versiegelter Tabellen im Sollbestand (Postgres, #1580)", () => {
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

  it("nennt die Tabellen, die in ein Siegel eingehen, samt Kindtabellen und den Standardwerten ihrer Spalten", async () => {
    const { sealedTables, defaults } = await readTriggerInventory(drizzle(sql));
    // Über locked_at versiegelt, nur anhängbar, Kindtabelle, später versiegelte Kindtabelle
    expect(sealedTables).toEqual(expect.arrayContaining(["public.vat_returns", "public.allocations", "public.journal_lines", "public.vat_return_filings"]));
    expect(sealedTables).not.toContain("public.contacts");
    expect(defaults.filter((d) => !sealedTables.includes(d.table))).toEqual([]);
    expect(defaults).toContainEqual({ table: "public.vat_returns", column: "kz41", expression: "0" });
    expect(defaults).toContainEqual({ table: "public.invoices", column: "currency", expression: "'EUR'::text" });
    // 0191: ohne Standardwert angelegt
    expect(defaults.filter((d) => d.table === "public.journal_lines" && d.column === "basis")).toEqual([]);
    // Eine Tabelle ganz ohne Standardwerte gehört trotzdem zum Umfang
    expect(sealedTables).toContain("public.invoice_taxes");
    expect(defaults.filter((d) => d.table === "public.invoice_taxes")).toEqual([]);
  });

  it.each([
    ["vat_returns", "kz41", "set default 500000", "Standardwert von vat_returns.kz41 wurde verändert"],
    ["invoices", "currency", "drop default", "Standardwert von invoices.currency fehlt"],
    // Kindtabelle, Spalte ohne Standardwert: Die Prüfung der Siegel erwartet dort NULL
    ["journal_lines", "basis", "set default 0", "Zusätzlicher Standardwert von journal_lines.basis"],
    // Tabelle, die bisher keinen einzigen Standardwert hat
    ["invoice_taxes", "original_base", "set default 777", "Zusätzlicher Standardwert von invoice_taxes.original_base"],
  ])("meldet %s.%s nach „%s“", async (table, column, change, text) => {
    await rolledBack(async (tx) => {
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([]);
      await tx.execute(query.raw(`alter table public.${table} alter column ${column} ${change}`));
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([befund(table, text)]);
    });
  });

  // Der Ausdruck einer erzeugten Spalte steht wie ein Standardwert in pg_attrdef, und die Prüfung der Siegel liest ihn
  // dort ohne Unterschied (0310): Auch er gehört zum Vergleich.
  it("meldet eine Spalte, die durch eine erzeugte Spalte mit festem Wert ersetzt wurde", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(query`alter table public.journal_lines drop column basis, add column basis integer generated always as (99999) stored`);
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([befund("journal_lines", "Zusätzlicher Standardwert von journal_lines.basis")]);
    });
  });

  it("nimmt die Tabellen aus dem Sollbestand, nicht aus haben_seal_columns der geprüften Instanz", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(query`create or replace function public.haben_seal_columns(tbl text) returns jsonb language sql as $$ select '{}'::jsonb $$`);
      await tx.execute(query`alter table public.vat_returns alter column kz41 set default 500000`);
      expect((await checkTriggerIntegrity(tx)).problems).toEqual([
        befund("Funktionen", "Funktion public.haben_seal_columns(tbl text) wurde verändert"),
        befund("vat_returns", "Standardwert von vat_returns.kz41 wurde verändert"),
      ]);
    });
  });

  it("meldet Standardwerte anderer Tabellen nicht, etwa eine Anpassung des Betreibers", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(query`alter table public.contacts alter column name set default 'Unbekannt'`);
      expect(await checkTriggerIntegrity(tx)).toEqual({ problems: [], hints: [] });
    });
  });
});
