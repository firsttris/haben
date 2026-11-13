import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const VERSION = (JSON.parse(readFileSync(new URL("../../../../../../package.json", import.meta.url), "utf8")) as { version: string }).version;
const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));

describe.skipIf(!testDatabaseUrl)("haben status (Postgres)", () => {
  let status: typeof import("./status.ts");
  let sql: postgres.Sql;
  let eric: string;
  // 20. Oktober: Sommerzeit, 01:15 UTC ist 03:15 in Berlin
  const now = new Date("2026-10-20T12:00:00Z");

  beforeAll(async () => {
    sql = await setupTestDb();
    status = await import("./status.ts");
    eric = mkdtempSync(join(tmpdir(), "haben-eric-"));
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
    rmSync(eric, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await sql`delete from backup_status`;
  });

  async function run(kind: "backup" | "restore_check", ok: boolean, at: string) {
    await sql`insert into backup_status (kind, ok, at, snapshot, bytes, message)
      values (${kind}, ${ok}, ${at}, ${ok ? "a1b2c3d4" : null}, ${ok ? 1234 : null}, ${ok ? "" : "Fatal: wrong password"})`;
  }

  it("ohne Sicherung und ohne ERiC: Version aus der package.json, keine Sicherung, ERiC fehlt", async () => {
    expect(await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false })).toEqual({
      version: VERSION,
      eric: { source: null, version: null },
      backup: { state: "keins", overdue: false, lastBackup: null, failed: [] },
      summary: { eric: "fehlt", backup: "keine" },
    });
  });

  it("mit erfolgreicher Sicherung und heruntergeladenem ERiC: Zeitpunkt in deutscher Zeit und ERiC-Version", async () => {
    await run("backup", true, "2026-10-20T01:15:00Z");
    writeFileSync(join(eric, "HABEN_ERIC_VERSION"), "44.3.6.0\n");
    const s = await status.betriebsStatus({ now, ericHome: eric, ericFromEnv: false });
    expect(s.eric).toEqual({ source: "download", version: "44.3.6.0" });
    expect(s.backup).toEqual({ state: "ok", overdue: false, lastBackup: "2026-10-20T01:15:00.000Z", failed: [] });
    expect(s.summary).toEqual({ eric: "44.3.6.0", backup: "2026-10-20 03:15" });
  });

  it("nach einer fehlgeschlagenen Sicherung: letzte erfolgreiche mit Hinweis auf den Fehlschlag", async () => {
    await run("backup", true, "2026-10-19T01:15:00Z");
    await run("backup", false, "2026-10-20T01:15:00Z");
    const s = await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false });
    expect(s.backup).toEqual({
      state: "fehler",
      overdue: false,
      lastBackup: "2026-10-19T01:15:00.000Z",
      failed: [{ kind: "backup", at: "2026-10-20T01:15:00.000Z" }],
    });
    expect(s.summary.backup).toBe("2026-10-19 03:15 (letztes Backup fehlgeschlagen)");
  });

  it("gelungene Sicherung, fehlgeschlagener Test-Restore: nennt den Test-Restore, nicht das Backup", async () => {
    await run("backup", true, "2026-10-20T01:15:00Z");
    await run("restore_check", false, "2026-10-20T01:20:00Z");
    const s = await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false });
    expect(s.backup.lastBackup).toBe("2026-10-20T01:15:00.000Z");
    expect(s.summary.backup).toBe("2026-10-20 03:15 (Test-Restore fehlgeschlagen)");
  });

  it("nennt das Format der Ausgabe, damit Skripte eine Änderung erkennen", async () => {
    expect((await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false })).schema).toBe(1);
  });

  it("nur fehlgeschlagene Sicherungen: keine erfolgreiche", async () => {
    await run("backup", false, "2026-10-20T01:15:00Z");
    expect((await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false })).summary.backup).toBe("keine (letztes Backup fehlgeschlagen)");
  });

  it("ERiC über ERIC_HOME ohne Versionsdatei: von Hand eingebunden", async () => {
    const vonHand = mkdtempSync(join(tmpdir(), "haben-eric-hand-"));
    try {
      const s = await status.betriebsStatus({ now, ericHome: vonHand, ericFromEnv: true });
      expect(s.eric).toEqual({ source: "env", version: null });
      expect(s.summary.eric).toBe("von Hand");
    } finally {
      rmSync(vonHand, { recursive: true, force: true });
    }
  });

  it("gibt als Befehl JSON aus und liest ERiC aus ERIC_HOME der Umgebung", async () => {
    await run("backup", true, "2026-10-20T01:15:00Z");
    writeFileSync(join(eric, "HABEN_ERIC_VERSION"), "44.3.6.0\n");
    const r = spawnSync(process.execPath, [CLI, "status", "--json"], { encoding: "utf8", timeout: 20_000, env: { ...process.env, ERIC_HOME: eric } });
    expect(r.status, r.stderr).toBe(0);
    const s = JSON.parse(r.stdout);
    expect(s).toMatchObject({ version: VERSION, eric: { source: "env", version: "44.3.6.0" }, backup: { lastBackup: "2026-10-20T01:15:00.000Z" } });
  });

  it("gibt ohne --json Text aus", () => {
    const r = spawnSync(process.execPath, [CLI, "status"], { encoding: "utf8", timeout: 20_000, env: { ...process.env, ERIC_HOME: "" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`Version:          ${VERSION}`);
    expect(r.stdout).toContain("Letzte Sicherung: keine");
  });
});

describe("haben ohne Datenbank", () => {
  const umgebung = {
    ...process.env,
    DATABASE_URL: "postgres://test:test@127.0.0.1:1/nicht_erreichbar",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
    HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  };

  it("meldet eine nicht erreichbare Datenbank ohne Verbindungsangaben und mit Exit-Code 1", () => {
    const r = spawnSync(process.execPath, [CLI, "status", "--json"], { encoding: "utf8", timeout: 20_000, env: umgebung });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Der Stand konnte nicht gelesen werden");
    expect(r.stderr).not.toContain("test:test");
  });

  it("zeigt die Hilfe auch ohne die Umgebung der App", () => {
    const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH ?? "" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Aufruf: haben status [--json]");
  });

  it.each([[[]], [["unbekannt"]], [["status", "zuviel"]], [["status", "--jsn"]]])("lehnt %j mit dem Aufruf ab", (args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 20_000, env: umgebung });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Aufruf: haben status [--json]");
  });
});
