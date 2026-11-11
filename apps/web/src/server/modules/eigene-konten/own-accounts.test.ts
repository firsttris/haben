import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Eigene Sachkonten (#270, Stufe 1), Verwaltung: anlegen mit Prüfung (Nummer, Aufwandsklasse, kein Systemkonto, nicht im
 * Journal bebucht), umbenennen, archivieren, löschen. Jede Änderung steht im Audit-Log. Alle Daten sind erfunden.
 */

describe.skipIf(!testDatabaseUrl)("Eigene Sachkonten (Postgres, #270)", () => {
  let sql: postgres.Sql;
  let konten: typeof import("./own-accounts.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    konten = await import("./own-accounts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate own_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, kontenrahmen) values (1, 'Testfirma', 'SKR03')`;
  });

  const konto = (overrides: Record<string, unknown> = {}) => ({
    account: "4999",
    name: "Software: Entwicklung",
    parentCategory: "software" as const,
    ...overrides,
  });

  it("legt ein Konto im Kontenrahmen der Firma an und listet es", async () => {
    const id = await konten.createOwnAccount(actor, konto());
    expect(await konten.listOwnAccounts()).toMatchObject([
      { id, kontenrahmen: "SKR03", account: "4999", name: "Software: Entwicklung", parentCategory: "software", archivedAt: null },
    ]);
    expect(await konten.loadOwnAccountParents("SKR03")).toEqual(new Map([["4999", "software"]]));
    expect((await konten.loadOwnAccountParents("SKR04")).size).toBe(0);
  });

  it("legt im SKR04 Konten der Klasse 6 an", async () => {
    await sql`update company set kontenrahmen = 'SKR04'`;
    await konten.createOwnAccount(actor, konto({ account: "6999" }));
    await expect(konten.createOwnAccount(actor, konto({ account: "4999" }))).rejects.toThrow(/6000 bis 6999/);
  });

  it("lehnt ab: Systemkonto, falsche Klasse, Elternkategorie, doppelte Nummer", async () => {
    await expect(konten.createOwnAccount(actor, konto({ account: "4964" }))).rejects.toThrow(/schon belegt/);
    await expect(konten.createOwnAccount(actor, konto({ account: "8999" }))).rejects.toThrow(/4000 bis 4999/);
    await expect(konten.createOwnAccount(actor, konto({ parentCategory: "anlage" }))).rejects.toThrow(/Elternkategorie/);
    await konten.createOwnAccount(actor, konto());
    await expect(konten.createOwnAccount(actor, konto({ name: "Anderes" }))).rejects.toThrow(/gibt es schon/);
    expect(await konten.listOwnAccounts()).toHaveLength(1);
  });

  it("lehnt eine Nummer ab, die im Journal schon bebucht ist", async () => {
    await sql.begin(async (tx) => {
      const [entry] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-03-02', 'Altbuchung', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values (${entry!.id}, '4999', 100, 0), (${entry!.id}, '1200', 0, 100)`;
      await tx`update journal_entries set locked_at = now() where id = ${entry!.id}`;
    });
    await expect(konten.createOwnAccount(actor, konto())).rejects.toThrow(/im Journal/);
    // Eine andere Nummer geht
    await konten.createOwnAccount(actor, konto({ account: "4998" }));
  });

  it("benennt um und archiviert; ein archiviertes Konto bleibt für bestehende Buchungen auflösbar", async () => {
    const id = await konten.createOwnAccount(actor, konto());
    await konten.renameOwnAccount(actor, id, "Software: Produktentwicklung");
    await konten.setOwnAccountArchived(actor, id, true);
    expect(await konten.listOwnAccounts()).toMatchObject([{ name: "Software: Produktentwicklung" }]);
    expect((await konten.listOwnAccounts())[0]!.archivedAt).not.toBeNull();
    expect((await konten.loadOwnAccountParents("SKR03")).get("4999")).toBe("software");
    await konten.setOwnAccountArchived(actor, id, false);
    expect((await konten.listOwnAccounts())[0]!.archivedAt).toBeNull();
    await expect(konten.renameOwnAccount(actor, id, "  ")).rejects.toThrow(/Name/);
    await expect(konten.renameOwnAccount(actor, "00000000-0000-4000-8000-000000000000", "X")).rejects.toThrow("Konto nicht gefunden.");
  });

  it("Nummer und Elternkategorie lassen sich nicht ändern", async () => {
    const id = await konten.createOwnAccount(actor, konto());
    await expect(sql`update own_accounts set account = '4998' where id = ${id}`).rejects.toThrow();
    await expect(sql`update own_accounts set parent_category = 'telefon' where id = ${id}`).rejects.toThrow();
  });

  it("löscht ein Konto; Anlegen, Umbenennen und Löschen stehen im Audit-Log, TRUNCATE ist gesperrt", async () => {
    const id = await konten.createOwnAccount(actor, konto());
    await konten.renameOwnAccount(actor, id, "Neuer Name");
    await konten.deleteOwnAccount(actor, id);
    expect(await konten.listOwnAccounts()).toHaveLength(0);
    const audit = await sql`select action, actor from audit_log where table_name = 'own_accounts' and row_id = ${id} order by id`;
    expect(audit.map((a) => a.action)).toEqual(["INSERT", "UPDATE", "DELETE"]);
    expect(new Set(audit.map((a) => a.actor))).toEqual(new Set([actor]));
    await expect(sql`truncate own_accounts`).rejects.toThrow();
  });
});
