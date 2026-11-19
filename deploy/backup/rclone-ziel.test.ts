import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL(".", import.meta.url));

const arbeit = mkdtempSync(join(tmpdir(), "rclone-ziel-"));
afterAll(() => rmSync(arbeit, { recursive: true, force: true }));

/**
 * Ersatz für rclone: `config show <abschnitt>` findet nur, was in RCLONE_FAKE_SECTIONS steht. So läuft der Test
 * ohne die Binärdatei und ohne echte Zugangsdaten.
 */
function falschesRclone(): string {
  const pfad = join(arbeit, "rclone");
  writeFileSync(
    pfad,
    [
      "#!/bin/sh",
      '[ "$1" = config ] || exit 1',
      'for s in $RCLONE_FAKE_SECTIONS; do [ "$s" = "$3" ] && exit 0; done',
      "exit 1",
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
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav:haben", RCLONE_CONFIG: conf, RCLONE_FAKE_SECTIONS: "webdav" });
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
        RCLONE_FAKE_SECTIONS: "onedrive mynas",
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
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:haben:backup", RCLONE_CONFIG: conf, RCLONE_FAKE_SECTIONS: "webdav" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Abschnitt haben fehlt");
  });

  it("nutzt die Vorgabe /var/lib/haben-backup/rclone.conf, wenn RCLONE_CONFIG ungesetzt ist", () => {
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav:haben" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("/var/lib/haben-backup/rclone.conf");
  });

  it("warnt bei offenen Rechten, arbeitet aber weiter", () => {
    const conf = konfiguration(webdavConf, 0o644);
    const r = pruefe({ RESTIC_REPOSITORY: "rclone:webdav:haben", RCLONE_CONFIG: conf, RCLONE_FAKE_SECTIONS: "webdav" });
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
      RCLONE_FAKE_SECTIONS: "webdav",
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("nicht vorhanden");
  });
});
