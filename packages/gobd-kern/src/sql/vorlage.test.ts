import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANWEISUNGSGRENZE, akteurEinstellung, vorlageSql } from "./vorlage.ts";

/*
 * Die Vorlage gegen eine eigene, frische Datenbank neben TEST_DATABASE_URL; ohne sie übersprungen. Der Benutzer braucht
 * CREATEDB und, um Manipulationen nachzustellen (session_replication_role), Superuser-Rechte.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("SQL-Vorlage gegen Postgres", () => {
  const name = `gobd_kern_${randomBytes(4).toString("hex")}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const ziel = new URL(url!);
    ziel.pathname = `/${name}`;
    sql = postgres(ziel.toString(), { max: 4, onnotice: () => {} });
    for (const anweisung of vorlageSql({ praefix: "kern" }).split(ANWEISUNGSGRENZE)) await sql.unsafe(anweisung);
    await sql.unsafe(`
      CREATE TABLE notizen (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), text text NOT NULL, geheim text);
      CREATE TABLE belege (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), betrag_cent bigint NOT NULL, locked_at timestamptz);
      CREATE TABLE eingaenge (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sha256 text NOT NULL);
      SELECT kern_audit_table('notizen', 'geheim');
      SELECT kern_seal_table('belege', 'locked_at');
      SELECT kern_seal_table('eingaenge');
    `);
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  /** Schreibt wie eine App: Transaktion mit Akteur */
  const mitAkteur = <T>(akteur: string, arbeit: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`select set_config(${akteurEinstellung("kern")}, ${akteur}, true)`;
      return arbeit(tx);
    }) as Promise<T>;

  const befunde = () => sql`select art, tabelle, befund from kern_integrity_problems(100)`;

  it("hat nach dem Einrichten eine gültige Kette ohne Befund", async () => {
    expect(await befunde()).toEqual([]);
    const [kopf] = await sql`select seq from audit_chain`;
    expect(Number(kopf!.seq)).toBeGreaterThan(0); // die Anmeldung der versiegelten Tabellen steht schon im Log
  });

  it("schreibt jede Änderung mit Akteur ins Audit-Log, ohne ausgelassene Spalten, und verkettet sie", async () => {
    const [n] = await mitAkteur("anna", (tx) => tx`insert into notizen (text, geheim) values ('Hallo', 'pst') returning id`);
    await mitAkteur("ben", (tx) => tx`update notizen set text = 'Hallo Welt' where id = ${n!.id}`);
    const eintraege = await sql`select actor, action, new_value, seq, prev_hash, row_hash from audit_log where table_name = 'notizen' order by seq`;
    expect(eintraege.map((e) => [e.actor, e.action])).toEqual([
      ["anna", "INSERT"],
      ["ben", "UPDATE"],
    ]);
    expect(eintraege[0]!.new_value).not.toHaveProperty("geheim");
    const [kopf] = await sql`select seq, hash from audit_chain`;
    const [letzter] = await sql`select seq, row_hash from audit_log order by seq desc limit 1`;
    expect(kopf!.seq).toBe(letzter!.seq);
    expect(Buffer.from(kopf!.hash).equals(Buffer.from(letzter!.row_hash))).toBe(true);
    expect(await befunde()).toEqual([]);
  });

  it("lehnt Ändern, Löschen und Leeren von Audit-Log, Kopf und Siegeln ab", async () => {
    await expect(sql`update audit_log set actor = 'x'`).rejects.toThrow(/darf nur ergänzt werden/);
    await expect(sql`delete from audit_log`).rejects.toThrow(/darf nur ergänzt werden/);
    await expect(sql`truncate audit_log`).rejects.toThrow(/darf nur ergänzt werden/);
    await expect(sql`update audit_chain set seq = 1`).rejects.toThrow(/nur vom Audit-Log fortgeschrieben/);
    await expect(sql`truncate seals`).rejects.toThrow(/darf nur ergänzt werden/);
    await expect(sql`truncate notizen`).rejects.toThrow(/darf nicht geleert werden/);
  });

  it("lässt einen Entwurf ändern und löschen, versiegelt ihn beim Festschreiben und sperrt ihn danach", async () => {
    const [entwurf] = await mitAkteur("anna", (tx) => tx`insert into belege (betrag_cent) values (11900) returning id`);
    await mitAkteur("anna", (tx) => tx`update belege set betrag_cent = 11950 where id = ${entwurf!.id}`);
    expect(await sql`select 1 from seals where row_id = ${entwurf!.id}`).toHaveLength(0);
    await mitAkteur("anna", (tx) => tx`update belege set locked_at = now() where id = ${entwurf!.id}`);
    expect(await sql`select 1 from seals where row_id = ${entwurf!.id}`).toHaveLength(1);
    await expect(sql`update belege set betrag_cent = 1 where id = ${entwurf!.id}`).rejects.toThrow(/ist festgeschrieben/);
    await expect(sql`delete from belege where id = ${entwurf!.id}`).rejects.toThrow(/ist festgeschrieben/);
    await expect(sql`truncate belege`).rejects.toThrow(/darf nicht geleert werden/);

    const [anderer] = await mitAkteur("anna", (tx) => tx`insert into belege (betrag_cent) values (500) returning id`);
    await mitAkteur("anna", (tx) => tx`delete from belege where id = ${anderer!.id}`);
    expect(await befunde()).toEqual([]);
  });

  it("versiegelt Zeilen ohne Spalte zum Festschreiben ab dem Einfügen", async () => {
    const [e] = await mitAkteur("system:mail", (tx) => tx`insert into eingaenge (sha256) values (${"ab".repeat(32)}) returning id`);
    expect(await sql`select 1 from seals where row_id = ${e!.id}`).toHaveLength(1);
    await expect(sql`update eingaenge set sha256 = 'x' where id = ${e!.id}`).rejects.toThrow(/darf nur ergänzt werden/);
    await expect(sql`delete from eingaenge where id = ${e!.id}`).rejects.toThrow(/darf nur ergänzt werden/);
  });

  it("lehnt Änderungen mit Audit-Eintrag außerhalb von READ COMMITTED ab", async () => {
    await expect(sql.begin("isolation level repeatable read", (tx) => tx`insert into notizen (text) values ('x')`)).rejects.toThrow(/nur unter READ COMMITTED/);
  });

  it("lehnt Ändern und Löschen der angemeldeten versiegelten Tabellen ab", async () => {
    await expect(sql`delete from sealed_tables where table_name = 'belege'`).rejects.toThrow(/darf nur ergänzt werden/);
    await expect(sql`update sealed_tables set locked_column = null where table_name = 'belege'`).rejects.toThrow(/darf nur ergänzt werden/);
    expect(await befunde()).toEqual([]);
  });

  it("quotiert Tabellen- und Spaltennamen in den Anmelde-Funktionen und der Prüfung", async () => {
    await sql.unsafe(`
      CREATE TABLE "we'ird""tab" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "ge'heim" text, "lock'ed""at" timestamptz);
      SELECT kern_seal_table('"we''ird""tab"', 'lock''ed"at');
    `);
    await mitAkteur("anna", (tx) => tx.unsafe(`insert into "we'ird""tab" ("ge'heim", "lock'ed""at") values ('x', now())`));
    await expect(sql.unsafe(`update "we'ird""tab" set "ge'heim" = 'y'`)).rejects.toThrow(/ist festgeschrieben/);
    expect(await sql`select 1 from seals where table_name = ${"we'ird\"tab"}`).toHaveLength(1);
    expect(await befunde()).toEqual([]);
  });

  it("meldet eine an den Triggern vorbei geänderte versiegelte Zeile und einen veränderten Eintrag im Audit-Log", async () => {
    const [b] = await mitAkteur("anna", (tx) => tx`insert into belege (betrag_cent, locked_at) values (2000, now()) returning id`);
    expect(await befunde()).toEqual([]);
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update belege set betrag_cent = 1 where id = ${b!.id}`;
      await tx`update audit_log set actor = 'mallory' where seq = 1`;
    });
    const gefunden = await befunde();
    expect(gefunden).toContainEqual({ art: "siegel", tabelle: "belege", befund: "Inhalt passt nicht zum Siegel" });
    expect(gefunden).toContainEqual({ art: "kette", tabelle: "audit_log", befund: "Inhalt passt nicht zum Hash" });
  });

  it("meldet eine an den Triggern vorbei aus sealed_tables genommene Tabelle", async () => {
    const [b] = await mitAkteur("anna", (tx) => tx`insert into belege (betrag_cent, locked_at) values (3000, now()) returning id`);
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from sealed_tables where table_name = 'belege'`;
      await tx`update belege set betrag_cent = 1 where id = ${b!.id}`;
    });
    expect(await befunde()).toContainEqual({ art: "siegel", tabelle: "belege", befund: "Angemeldete Tabelle fehlt in sealed_tables" });
  });
});

describe("vorlageSql", () => {
  it("lehnt ein Präfix ab, das kein einfacher Bezeichner ist", () => {
    expect(() => vorlageSql({ praefix: "x; drop table audit_log" })).toThrow(/Ungültiges Präfix/);
    expect(() => vorlageSql({ praefix: "Groß" })).toThrow(/Ungültiges Präfix/);
    expect(akteurEinstellung("belegt")).toBe("belegt.actor");
  });

  it("nennt kein Produkt: Funktionen und Sperre tragen nur das Präfix", () => {
    const text = vorlageSql({ praefix: "abc" });
    expect(text).not.toMatch(/haben/i);
    expect(text).toContain("hashtext('abc.audit_chain')");
    expect(text).toContain("current_setting('abc.actor', true)");
  });
});
