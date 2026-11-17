import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../apps/web/src/server/test-db.ts";

const SCRIPT = fileURLToPath(new URL("./backup-status.sh", import.meta.url));

/** record_status aus backup-status.sh mit psql gegen die Testdatenbank, wie backup.sh es im Container aufruft */
function recordStatus(repository: string, message: string) {
  const url = new URL(testDatabaseUrl!);
  execFileSync("bash", ["-c", `source "${SCRIPT}" && record_status backup true a1b2c3d4 1234 "$MELDUNG"`], {
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1),
      RESTIC_REPOSITORY: repository,
      MELDUNG: message,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe.skipIf(!testDatabaseUrl)("Backup-Container trägt das Ziel ein (Postgres)", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`delete from backup_status`;
  });

  it("schreibt das Ziel ohne Nutzer und Passwort aus der Adresse (#860)", async () => {
    recordStatus("rest:https://nutzer:geheim@backup.example:8000/haben", "3 Dateien");
    const [row] = await sql`select kind, ok, snapshot, message, target from backup_status`;
    expect(row).toMatchObject({ kind: "backup", ok: true, snapshot: "a1b2c3d4", message: "3 Dateien", target: "rest:https://backup.example:8000/haben" });
  });

  it("entfernt auch ein Passwort mit @ und Zugangsdaten in rclone- und sftp-Formen", async () => {
    recordStatus("rest:https://nutzer:ge@heim@backup.example:8000/haben", "");
    recordStatus("rclone::sftp,host=backup.example,user=nutzer,pass=GEHEIM:haben", "");
    recordStatus("rclone:fern,pass='a:GEHEIM':haben", "");
    recordStatus("sftp:nutzer@backup.example:/srv/restic", "");
    const rows = await sql`select target from backup_status order by id`;
    expect(rows.map((r) => r.target)).toEqual([
      "rest:https://backup.example:8000/haben",
      "rclone::sftp:haben",
      "rclone:fern:haben",
      "sftp:backup.example:/srv/restic",
    ]);
  });

  it("entfernt ein Passwort mit / ohne Prozentkodierung wie ohneZugangsdaten in der App", async () => {
    for (const repository of [
      "rest:https://nutzer:ab/cd+ef@backup.example/haben",
      "rest:https://nutzer:ab/cd@ef@backup.example:8000/haben",
      "rest:https://nutzer@example.com:ab/cd@backup.example/haben",
      "s3:https://SCHLUESSEL:ab/cd@s3.example.com/haben-backup",
      "sftp://nutzer:ab/cd@backup.example:2222//srv/restic",
      "rest:https://nutzer:ab/cd@[::1]:8000/haben",
      "rest:https://nutzer:ab%2Fcd@backup.example/haben",
      // RESTIC_REPOSITORY ist eine Adresse, keine Meldung: Leerraum und " beenden die Zugangsdaten nicht
      "rest:https://nutzer:ab cd@backup.example/haben",
      'rest:https://nutzer:ab"cd@backup.example/haben',
      "rest:https://nutzer:ab\tcd/ef@backup.example/haben",
    ])
      recordStatus(repository, "");
    const rows = await sql`select target from backup_status order by id`;
    expect(rows.map((r) => r.target)).toEqual([
      "rest:https://backup.example/haben",
      "rest:https://backup.example:8000/haben",
      "rest:https://backup.example/haben",
      "s3:https://s3.example.com/haben-backup",
      "sftp://backup.example:2222//srv/restic",
      "rest:https://[::1]:8000/haben",
      "rest:https://backup.example/haben",
      "rest:https://backup.example/haben",
      "rest:https://backup.example/haben",
      "rest:https://backup.example/haben",
    ]);
  });

  it("lässt ein @ im Pfad eines Ziels ohne Zugangsdaten stehen", async () => {
    const ziele = ["rest:https://h/haben@2026", "sftp://h//srv/a@b", "rest:https://[::1]:8000/a@b", "rest:https://h/haben?x@y", "rest:https://h?x@y"];
    for (const repository of ziele) recordStatus(repository, "");
    const rows = await sql`select target from backup_status order by id`;
    expect(rows.map((r) => r.target)).toEqual(ziele);
  });

  it("lässt ein Ziel ohne Zugangsdaten unverändert und ein leeres weg", async () => {
    recordStatus("s3:s3.example.com/haben-backup", "");
    recordStatus("", "");
    const rows = await sql`select target from backup_status order by id`;
    expect(rows.map((r) => r.target)).toEqual(["s3:s3.example.com/haben-backup", null]);
  });

  it("trägt bei einer App ohne Spalte target weiter ein, nur ohne Ziel", async () => {
    await sql`alter table backup_status drop column target`;
    try {
      recordStatus("/repo", "ältere App");
      const [row] = await sql`select message from backup_status`;
      expect(row?.message).toBe("ältere App");
    } finally {
      await sql`alter table backup_status add column target text`;
    }
  });
});
