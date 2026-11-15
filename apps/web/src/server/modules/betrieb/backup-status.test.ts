import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Stand des Backups (Postgres)", () => {
  let status: typeof import("./backup-status.ts");
  let sql: postgres.Sql;
  const now = new Date("2026-10-20T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

  beforeAll(async () => {
    sql = await setupTestDb();
    status = await import("./backup-status.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`delete from backup_status`;
  });

  async function run(kind: "backup" | "restore_check", ok: boolean, at: Date, message = "") {
    await sql`insert into backup_status (kind, ok, at, snapshot, bytes, message)
      values (${kind}, ${ok}, ${at.toISOString()}, ${ok ? "a1b2c3d4" : null}, ${ok ? 1234 : null}, ${message})`;
  }

  it("ohne Eintrag: kein Backup eingerichtet", async () => {
    expect(await status.backupOverview(now)).toEqual({ state: "keins", overdue: false, lastBackup: null, lastCheck: null, failed: [] });
  });

  it("Backup von heute Nacht und Test-Restore: in Ordnung", async () => {
    await run("backup", true, hoursAgo(9));
    await run("restore_check", true, hoursAgo(9), "12 Tabellen");
    const o = await status.backupOverview(now);
    expect(o.state).toBe("ok");
    expect(o.lastBackup).toMatchObject({ ok: true, snapshot: "a1b2c3d4", bytes: 1234 });
    expect(o.lastCheck?.message).toBe("12 Tabellen");
  });

  it("letztes Backup älter als zwei Tage: veraltet", async () => {
    await run("backup", true, hoursAgo(49));
    expect((await status.backupOverview(now)).state).toBe("veraltet");
  });

  it("nur fehlgeschlagene Läufe: Fehler, kein erfolgreiches Backup", async () => {
    await run("backup", false, hoursAgo(1), "Fatal: wrong password");
    const o = await status.backupOverview(now);
    expect(o.state).toBe("fehler");
    expect(o.lastBackup).toBeNull();
    expect(o.failed).toEqual([{ kind: "backup", run: expect.objectContaining({ message: "Fatal: wrong password" }) }]);
  });

  it("ein Fehlschlag nach einem Erfolg zählt, ein Erfolg danach hebt ihn auf", async () => {
    await run("backup", true, hoursAgo(30));
    await run("backup", false, hoursAgo(6), "Dump unvollständig");
    expect((await status.backupOverview(now)).state).toBe("fehler");
    await run("backup", true, hoursAgo(1));
    expect((await status.backupOverview(now)).state).toBe("ok");
  });

  it("fehlgeschlagener Test-Restore ist ein Fehler, auch wenn das Backup läuft", async () => {
    await run("backup", true, hoursAgo(2));
    await run("restore_check", false, hoursAgo(2), "Hash-Kette: 1 Befund");
    const o = await status.backupOverview(now);
    expect(o.state).toBe("fehler");
    expect(o.failed.map((f) => f.kind)).toEqual(["restore_check"]);
  });

  it("ein alter Fehlschlag verdeckt nicht, dass seitdem kein Backup lief", async () => {
    await run("backup", true, hoursAgo(120));
    await run("restore_check", false, hoursAgo(120), "Beleg fehlt");
    const o = await status.backupOverview(now);
    expect(o.state).toBe("fehler");
    expect(o.overdue).toBe(true);
  });

  it("die Tabelle steht nicht im Audit-Log", async () => {
    const before = await sql`select count(*)::int as n from audit_log`;
    await run("backup", true, hoursAgo(1));
    const after = await sql`select count(*)::int as n from audit_log`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
