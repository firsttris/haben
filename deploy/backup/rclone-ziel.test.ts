import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL(".", import.meta.url));

const arbeit = mkdtempSync(join(tmpdir(), "rclone-ziel-"));
afterAll(() => rmSync(arbeit, { recursive: true, force: true }));

/**
 * Ersatz für rclone: `listremotes` liest die Abschnitte aus der Datei, die RCLONE_CONFIG nennt, so wie rclone es tut.
 * So läuft der Test ohne die Binärdatei und ohne echte Zugangsdaten, prüft aber dieselbe Eigenschaft: ob der
 * gesuchte Abschnitt in der Datei steht oder nicht.
 */
function falschesRclone(): string {
  const pfad = join(arbeit, "rclone");
  writeFileSync(
    pfad,
    [
      "#!/bin/sh",
      '[ "$1" = listremotes ] || exit 1',
      '[ -r "$RCLONE_CONFIG" ] || exit 0',
      // RCLONE_FAKE_FEHLER stellt eine Datei nach, die rclone nicht lesen kann (kaputt, gesperrt, verschlüsselt)
      '[ -n "$RCLONE_FAKE_FEHLER" ] && { echo "CRITICAL: Failed to load config file" >&2; exit 1; }',
      "sed -n 's/^\\[\\(.*\\)\\]$/\\1:/p' \"$RCLONE_CONFIG\"",
      "",
    ].join("\n"),
  );
  chmodSync(pfad, 0o755);
  return pfad;
}

function konfiguration(inhalt: string, rechte = 0o600, name = `conf-${Math.random().toString(36).slice(2)}`): string {
  const pfad = join(arbeit, name);
  writeFileSync(pfad, inhalt);
  chmodSync(pfad, rechte);
  return pfad;
}

/** configure_rclone mit einer Umgebung aufrufen */
function pruefe(env: Record<string, string>) {
  const skript = `source "${join(DIR, "rclone-ziel.sh")}"\nconfigure_rclone`;
  const r = spawnSync("bash", ["-c", skript], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", RCLONE_BIN: falschesRclone(), ...env },
  });
  return { code: r.status ?? -1, stdout: r.stdout.replace(/\n$/, ""), stderr: r.stderr };
}

const webdavConf = "[webdav]\ntype = webdav\nurl = https://cloud.example.de/remote.php/dav/files/nutzer\npass = obscured\n";

describe("configure_rclone", () => {
  it("prüft den Abschnitt aus der Konfiguration und meldet das Ziel", () => {
    const conf = konfiguration(webdavConf);
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav:haben", RCLONE_CONFIG: conf });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`rclone: Ziel webdav aus ${conf}`);
    expect(r.stderr).toBe("");
  });

  it("kennt jeden Abschnitt, nicht nur webdav", () => {
    const conf = konfiguration("[onedrive]\ntype = onedrive\ntoken = {}\n[mynas]\ntype = smb\nhost = nas\n");
    for (const name of ["onedrive", "mynas"]) {
      const r = pruefe({
        RESTIC_REPOSITORY: `rclone:${name}:haben`,
        RCLONE_CONFIG: conf,
      });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain(`Ziel ${name}`);
    }
  });

  it("bricht ab, wenn die Konfiguration fehlt", () => {
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav:haben", RCLONE_CONFIG: join(arbeit, "gibt-es-nicht") });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("keine Konfiguration");
    expect(r.stderr).toContain("RCLONE_CONFIG");
  });

  it("bricht ab, wenn der Abschnitt in der Konfiguration fehlt", () => {
    const conf = konfiguration(webdavConf);
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:haben:backup", RCLONE_CONFIG: conf });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Abschnitt haben fehlt");
  });

  it("meldet eine Datei, die rclone nicht lesen kann, als solche und nicht als fehlenden Abschnitt", () => {
    const conf = konfiguration(webdavConf);
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav:haben", RCLONE_CONFIG: conf, RCLONE_FAKE_FEHLER: "1" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("rclone kann");
    expect(r.stderr).not.toContain("Abschnitt webdav fehlt");
  });

  it("nimmt einen Abschnitt mit Parametern als Verbindungszeichenkette (remote,parameter=wert:pfad)", () => {
    // rclone-Doku, „Connection strings“: remote,parameter=value,parameter2=value2:path/to/dir
    const conf = konfiguration(webdavConf);
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav,vendor=nextcloud:haben", RCLONE_CONFIG: conf });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("schreibt Parameter einer Verbindungszeichenkette nicht ins Log, auch nicht bei fehlendem Abschnitt (#1349)", () => {
    const conf = konfiguration(webdavConf);
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:andere,pass=geheim123:haben", RCLONE_CONFIG: conf });
    expect(r.code).toBe(2);
    expect(r.stderr + r.stdout).not.toContain("geheim123");
  });

  it("nimmt nur den genauen Namen, nicht einen, der den gesuchten enthält", () => {
    const conf = konfiguration("[webdav-alt]\ntype = webdav\n[backup]\ntype = local\n");
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav:haben", RCLONE_CONFIG: conf });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Abschnitt webdav fehlt");
  });

  it("nutzt die Vorgabe /var/lib/haben-backup/rclone.conf, wenn RCLONE_CONFIG ungesetzt ist", () => {
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav:haben" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("/var/lib/haben-backup/rclone.conf");
  });

  it("warnt nicht, wenn nur die Gruppe lesen darf", () => {
    // In einem Pod gehören Gruppe und Datei dem fsGroup; 0440 ist dort der Normalfall und kein Fehler
    const conf = konfiguration(webdavConf, 0o640);
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav:haben", RCLONE_CONFIG: conf });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("warnt bei offenen Rechten, arbeitet aber weiter", () => {
    const conf = konfiguration(webdavConf, 0o644);
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav:haben", RCLONE_CONFIG: conf });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("chmod 600");
  });

  it("prüft nichts, wenn die Adresse alles selbst mitbringt", () => {
    const r = pruefe({ RESTIC_REPOSITORY: "rclone::webdav,url='https://cloud.example.de/dav':haben" });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("");
  });

  it("tut nichts, solange das Ziel nicht über rclone läuft", () => {
    for (const ziel of ["/backups", "sftp:backup@example.de:/srv/restic", "s3:s3.eu-central-1.amazonaws.com/bucket/haben", ""]) {
      const r = pruefe({ RESTIC_REPOSITORY: ziel });
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      expect(r.stdout).toBe("");
    }
  });

  it("bricht ab, wenn rclone im Image fehlt", () => {
    const conf = konfiguration(webdavConf);
    const r = pruefe({
      RESTIC_REPOSITORY: "rclone:webdav:haben",
      RCLONE_CONFIG: conf,
      RCLONE_BIN: join(arbeit, "kein-rclone"),
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("nicht vorhanden");
  });
});
