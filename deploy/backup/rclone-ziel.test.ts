import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL(".", import.meta.url));

const arbeit = mkdtempSync(join(tmpdir(), "rclone-ziel-"));
afterAll(() => rmSync(arbeit, { recursive: true, force: true }));

/** Ein Ersatz für rclone, damit der Test ohne die Binärdatei läuft: obscure gibt den Wert erkennbar zurück */
function falschesRclone(): string {
  const pfad = join(arbeit, "rclone");
  writeFileSync(pfad, '#!/bin/sh\n[ "$1" = obscure ] && { echo "VERSCHLEIERT($2)"; exit 0; }\nexit 1\n');
  chmodSync(pfad, 0o755);
  return pfad;
}

type Lauf = { code: number; stdout: string; stderr: string; conf: string | null };

/** configure_rclone mit einer Umgebung aufrufen und die erzeugte Konfiguration zurückgeben */
function konfiguriere(env: Record<string, string>): Lauf {
  const conf = join(arbeit, `rclone-${Math.random().toString(36).slice(2)}.conf`);
  const skript = [
    `source "${join(DIR, "rclone-ziel.sh")}"`,
    "configure_rclone",
  ].join("\n");
  const r = spawnSync("bash", ["-c", skript], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      RCLONE_BIN: falschesRclone(),
      RCLONE_CONFIG: conf,
      ...env,
    },
  });
  let inhalt: string | null = null;
  try {
    inhalt = readFileSync(conf, "utf8");
  } catch {
    inhalt = null;
  }
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr, conf: inhalt };
}

const webdav = {
  RESTIC_REPOSITORY: "rclone:webdav:haben",
  RCLONE_WEBDAV_URL: "https://cloud.example.de/remote.php/dav/files/nutzer/haben",
  RCLONE_WEBDAV_USER: "nutzer",
  RCLONE_WEBDAV_PASS: "geheim",
};

describe("configure_rclone", () => {
  it("schreibt den Abschnitt webdav mit verschleiertem Passwort", () => {
    const r = konfiguriere({ ...webdav, RCLONE_WEBDAV_VENDOR: "nextcloud" });
    expect(r.code).toBe(0);
    expect(r.conf).toBe(
      [
        "[webdav]",
        "type = webdav",
        "url = https://cloud.example.de/remote.php/dav/files/nutzer/haben",
        "user = nutzer",
        "pass = VERSCHLEIERT(geheim)",
        "vendor = nextcloud",
        "",
      ].join("\n"),
    );
  });

  it("lässt vendor weg, wenn es nicht gesetzt ist", () => {
    const r = konfiguriere(webdav);
    expect(r.code).toBe(0);
    expect(r.conf).not.toContain("vendor");
  });

  it("legt die Datei auf 600 an", () => {
    const r = konfiguriere(webdav);
    expect(r.code).toBe(0);
    const conf = join(arbeit, "rechte.conf");
    spawnSync("bash", [
      "-c",
      `source "${join(DIR, "rclone-ziel.sh")}"; configure_rclone`,
    ], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", RCLONE_BIN: falschesRclone(), RCLONE_CONFIG: conf, ...webdav },
    });
    expect(statSync(conf).mode & 0o777).toBe(0o600);
    rmSync(conf, { force: true });
  });

  it("nennt die fehlende Variable, statt restic scheitern zu lassen", () => {
    const r = konfiguriere({ RESTIC_REPOSITORY: "rclone:webdav:haben", RCLONE_WEBDAV_URL: "https://cloud.example.de/dav" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("RCLONE_WEBDAV_USER fehlt");
  });

  it("weist eine Adresse mit Zugangsdaten ab, damit sie nicht im Log landet", () => {
    const r = konfiguriere({ ...webdav, RESTIC_REPOSITORY: "rclone::webdav,url='https://nutzer:geheim@cloud.example.de/dav':haben" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("RCLONE_WEBDAV_PASS");
  });

  it("weist einen anderen Abschnittsnamen ab", () => {
    const r = konfiguriere({ ...webdav, RESTIC_REPOSITORY: "rclone:fern:haben" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("rclone:webdav:");
  });

  it("tut nichts, solange das Ziel nicht über rclone läuft", () => {
    for (const ziel of ["/backups", "sftp:backup@example.de:/srv/restic", "s3:s3.eu-central-1.amazonaws.com/bucket/haben", ""]) {
      const r = konfiguriere({ RESTIC_REPOSITORY: ziel });
      expect(r.code).toBe(0);
      expect(r.conf).toBeNull();
      expect(r.stderr).toBe("");
    }
  });

  it("weist eine Adresse mit Zugangsdaten ab, statt sie in die Datei zu schreiben", () => {
    const r = konfiguriere({ ...webdav, RCLONE_WEBDAV_URL: "https://nutzer:geheim@cloud.example.de/dav" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("RCLONE_WEBDAV_USER");
    expect(r.conf).toBeNull();
  });

  it("entfernt die Variablen, damit rclones eigene Umgebungskonfiguration nicht dazwischenfunkt", () => {
    const r = konfiguriere(webdav);
    expect(r.code).toBe(0);
    const pruefung = spawnSync(
      "bash",
      ["-c", `source "${join(DIR, "rclone-ziel.sh")}"; configure_rclone > /dev/null; [ -n "\${RCLONE_WEBDAV_PASS:-}" ] && echo LEAK || echo frei`],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", RCLONE_BIN: falschesRclone(), RCLONE_CONFIG: join(arbeit, "env.conf"), ...webdav },
      },
    );
    expect(pruefung.stdout.trim()).toBe("frei");
  });

  it("meldet das Ziel im Log, aber nicht das Passwort", () => {
    const r = konfiguriere(webdav);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("cloud.example.de/remote.php/dav/files/nutzer/haben");
    expect(r.stdout).not.toContain("geheim");
  });
});
