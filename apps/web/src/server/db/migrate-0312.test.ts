import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));
const journal = (folder: string) => JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
const klar = { kind: "eingebaut", id: "klar" };
const fassungKlassisch = { klar: { fassung: "klassisch" } };

/*
 * Migration 0312 (#113, eingebaute Layouts): Bestehende Installationen behalten das bisherige Layout (Klar in der Fassung
 * „Klassisch“), ihre Schrift und ihre Akzentfarbe; neue starten mit Klar in der Fassung „Standard“ und den Vorgaben des Layouts.
 */
describe.skipIf(!testDatabaseUrl)("Migration 0312: bisheriges Layout für den Bestand (Postgres)", () => {
  async function bis0311(): Promise<postgres.Sql> {
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await admin`drop database if exists ${admin(name)} with (force)`;
    await admin`create database ${admin(name)}`;
    await admin.end();
    const previous = mkdtempSync(join(tmpdir(), "haben-migrationen-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = journal(MIGRATIONS);
    const idx = full.entries.findIndex((e: { idx: number }) => e.idx === 312);
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, idx) }));
    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: previous });
    return sql;
  }

  async function weiter(sql: postgres.Sql) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
  }

  it("schreibt bestehenden Profilen das bisherige Layout, die bisherige Schrift und die eigene Farbe fest, eigene Layouts bleiben", async () => {
    const sql = await bis0311();
    try {
      await sql`insert into company(id,name) values(1,'Testfirma')`;
      await sql`insert into letterhead_profiles(name,is_default,settings) values
        ('Standard', true, ${JSON.stringify({ accent: "#AA3355", layouts: { angebot: { kind: "eingebaut", id: "klassisch" }, mahnung: { kind: "eigen", id: "abc" } } })}::jsonb),
        ('Zweites', false, ${JSON.stringify({ accent: "#112233", font: "literata" })}::jsonb)`;
      await weiter(sql);
      const rows = await sql`select name, settings from letterhead_profiles order by name`;
      const [standard, zweites] = rows.map((row) => row.settings as Record<string, unknown>);
      expect(standard).toMatchObject({ accent: "#AA3355", font: "plex-sans", accentFromLayout: false });
      expect(standard!.layouts).toEqual({
        rechnung: klar,
        angebot: klar,
        auftragsbestaetigung: klar,
        lieferschein: klar,
        mahnung: { kind: "eigen", id: "abc" },
      });
      expect(standard!.layoutOptions).toEqual(fassungKlassisch);
      expect(zweites).toMatchObject({ accent: "#112233", font: "literata", accentFromLayout: false, layoutOptions: fassungKlassisch });
      const [a] = await sql`select actor from audit_log where table_name = 'letterhead_profiles' order by seq desc limit 1`;
      expect(a!.actor).toBe("system:migration");
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    } finally {
      await sql.end();
    }
  }, 120_000);

  it("legt für eine eingerichtete Firma ohne gespeicherte Gestaltung ein Profil mit dem bisherigen Stand an", async () => {
    const sql = await bis0311();
    try {
      await sql`insert into company(id,name) values(1,'Testfirma')`;
      await weiter(sql);
      const rows = await sql`select name, is_default, settings from letterhead_profiles`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.is_default).toBe(true);
      expect(rows[0]!.settings).toMatchObject({ accent: "#1F6F5C", font: "plex-sans", accentFromLayout: false });
      // Ohne gespeicherte Layouts gilt Klar (Vorgabe), mit der Fassung „Klassisch“
      expect((rows[0]!.settings as { layoutOptions: unknown }).layoutOptions).toEqual(fassungKlassisch);
    } finally {
      await sql.end();
    }
  }, 120_000);

  it("legt bei einer neuen Installation kein Profil an", async () => {
    const sql = await bis0311();
    try {
      await weiter(sql);
      expect(await sql`select id from letterhead_profiles`).toHaveLength(0);
    } finally {
      await sql.end();
    }
  }, 120_000);
});
