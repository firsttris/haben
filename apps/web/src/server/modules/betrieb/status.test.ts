import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const VERSION = (JSON.parse(readFileSync(new URL("../../../../../../package.json", import.meta.url), "utf8")) as { version: string }).version;
const COMMIT = "0123abc4567def890123abc4567def890123abcd";
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
    await leeren(sql)`truncate company_logo, company cascade`;
  });

  async function run(kind: "backup" | "restore_check", ok: boolean, at: string) {
    await sql`insert into backup_status (kind, ok, at, snapshot, bytes, message)
      values (${kind}, ${ok}, ${at}, ${ok ? "a1b2c3d4" : null}, ${ok ? 1234 : null}, ${ok ? "" : "Fatal: wrong password"})`;
  }

  it("ohne Sicherung und ohne ERiC: Version aus der package.json, keine Sicherung, ERiC fehlt", async () => {
    expect(await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false, commit: null })).toEqual({
      schema: 1,
      version: VERSION,
      commit: null,
      eric: { source: null, version: null },
      backup: { state: "keins", overdue: false, lastBackup: null, failed: [] },
      summary: { eric: "fehlt", backup: "keine" },
      zeichen: { farbe: null, logo: null },
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

  it("mit Commit aus dem Build: ganz im JSON, als kurze Kennung hinter der Version im Text", async () => {
    const s = await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false, commit: COMMIT });
    expect(s.commit).toBe(COMMIT);
    expect(status.statusAlsText(s)).toContain(`Version:          ${VERSION} (0123abc)\n`);
  });

  it("ohne Commit: nur die Version im Text", async () => {
    const s = await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false, commit: null });
    expect(status.statusAlsText(s)).toContain(`Version:          ${VERSION}\n`);
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

  it("liest den Commit aus HABEN_COMMIT, wie ihn das Image setzt; leer heißt null", () => {
    const mit = spawnSync(process.execPath, [CLI, "status", "--json"], { encoding: "utf8", timeout: 20_000, env: { ...process.env, HABEN_COMMIT: COMMIT } });
    expect(mit.status, mit.stderr).toBe(0);
    expect(JSON.parse(mit.stdout).commit).toBe(COMMIT);
    const ohne = spawnSync(process.execPath, [CLI, "status", "--json"], { encoding: "utf8", timeout: 20_000, env: { ...process.env, HABEN_COMMIT: "" } });
    expect(ohne.status, ohne.stderr).toBe(0);
    expect(JSON.parse(ohne.stdout).commit).toBeNull();
  });

  describe("Zeichen der Firma für das Firmenportal (#1036)", () => {
    const png = new Uint8Array(readFileSync(new URL("../../../../public/icon-192.png", import.meta.url)));
    const sha256 = createHash("sha256").update(png).digest("hex");
    let stammdaten: typeof import("../stammdaten/index.ts");
    let kennzeichen: typeof import("./kennzeichen.ts");

    beforeAll(async () => {
      stammdaten = await import("../stammdaten/index.ts");
      kennzeichen = await import("./kennzeichen.ts");
    });

    /** Ausgabe wie process.stdout, in einen Puffer */
    function puffer(isTTY = false) {
      const teile: Uint8Array[] = [];
      return {
        isTTY,
        teile,
        write(daten: Uint8Array, fertig: (fehler?: Error | null) => void) {
          teile.push(daten);
          fertig();
          return true;
        },
      };
    }

    it("ab Werk weder Farbe noch Logo, ohne dabei eine Firma anzulegen", async () => {
      expect((await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false })).zeichen).toEqual({ farbe: null, logo: null });
      expect(await sql`select id from company`).toHaveLength(0);
    });

    it("eigene Farbe: farbe wie gespeichert, kein Logo", async () => {
      await stammdaten.saveNavMark("test-user", { art: "farbe", farbe: "#1d4ed8" });
      expect((await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false })).zeichen).toEqual({ farbe: "#1D4ED8", logo: null });
    });

    it("Logo als Zeichen: Format und Prüfsumme; die Farbe bleibt für den Fall, dass das Logo fehlt", async () => {
      await stammdaten.saveNavMark("test-user", { art: "farbe", farbe: "#1D4ED8" });
      await stammdaten.saveLogo("test-user", png);
      await stammdaten.saveNavMark("test-user", { art: "logo" });
      expect((await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false })).zeichen).toEqual({
        farbe: "#1D4ED8",
        logo: { format: "png", sha256 },
      });
    });

    it("Logo gewählt, aber entfernt: kein Logo, wie in der Navigation", async () => {
      await stammdaten.saveLogo("test-user", png);
      await stammdaten.saveNavMark("test-user", { art: "logo" });
      await stammdaten.removeLogo("test-user");
      expect((await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false })).zeichen).toEqual({ farbe: null, logo: null });
    });

    it("Logo hochgeladen, aber nicht als Zeichen gewählt: kein Logo", async () => {
      await stammdaten.saveLogo("test-user", png);
      expect((await status.betriebsStatus({ now, ericHome: null, ericFromEnv: false })).zeichen.logo).toBeNull();
      const aus = puffer();
      const meldungen: string[] = [];
      expect(await kennzeichen.kennzeichenAusgeben(aus, (m) => meldungen.push(m))).toBe(3);
      expect(aus.teile).toHaveLength(0);
      expect(meldungen.join("")).toContain("Kein Logo als Zeichen gewählt");
    });

    it("haben kennzeichen schreibt das Logo unverändert nach stdout", async () => {
      await stammdaten.saveLogo("test-user", png);
      await stammdaten.saveNavMark("test-user", { art: "logo" });
      const r = spawnSync(process.execPath, [CLI, "kennzeichen"], { timeout: 20_000 });
      expect(r.status, r.stderr.toString()).toBe(0);
      expect(new Uint8Array(r.stdout)).toEqual(png);
      expect(createHash("sha256").update(r.stdout).digest("hex")).toBe(sha256);
    });

    it("haben kennzeichen ohne Logo als Zeichen: Exit-Code 3, nichts auf stdout", () => {
      const r = spawnSync(process.execPath, [CLI, "kennzeichen"], { encoding: "utf8", timeout: 20_000 });
      expect(r.status).toBe(3);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Kein Logo als Zeichen gewählt");
    });

    it("schreibt keine Binärdaten in ein Terminal und liest dann auch nichts", async () => {
      await stammdaten.saveLogo("test-user", png);
      await stammdaten.saveNavMark("test-user", { art: "logo" });
      const aus = puffer(true);
      const meldungen: string[] = [];
      expect(await kennzeichen.kennzeichenAusgeben(aus, (m) => meldungen.push(m))).toBe(2);
      expect(aus.teile).toHaveLength(0);
      expect(meldungen.join("")).toContain("haben kennzeichen > logo.png");
    });
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

  it("meldet auch bei haben kennzeichen eine nicht erreichbare Datenbank mit Exit-Code 1", () => {
    const r = spawnSync(process.execPath, [CLI, "kennzeichen"], { encoding: "utf8", timeout: 20_000, env: umgebung });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Das Logo konnte nicht gelesen werden");
    expect(r.stderr).not.toContain("test:test");
  });

  it("zeigt die Hilfe auch ohne die Umgebung der App", () => {
    const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH ?? "" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Aufruf: haben status [--json]");
    expect(r.stdout).toContain("haben kennzeichen > logo.png");
  });

  it.each([[[]], [["unbekannt"]], [["status", "zuviel"]], [["status", "--jsn"]], [["kennzeichen", "--json"]], [["kennzeichen", "logo.png"]]])(
    "lehnt %j mit dem Aufruf ab",
    (args) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 20_000, env: umgebung });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Aufruf: haben status [--json]");
    },
  );
});
