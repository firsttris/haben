import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ohneZugangsdaten } from "../../apps/web/src/server/modules/betrieb/restic-ziel.ts";

const DIR = fileURLToPath(new URL(".", import.meta.url));

/** Eine Zeile durch message_without_credentials aus restic-ziel.sh, wie record_status und backup.sh sie aufrufen */
function messageWithoutCredentials(text: string) {
  const r = spawnSync("bash", ["-c", `source "${join(DIR, "restic-ziel.sh")}" && message_without_credentials`], { input: `${text}\n`, encoding: "utf8" });
  expect(r.stderr).toBe("");
  return r.stdout.replace(/\n$/, "");
}

/** Meldungen von restic und Go, wie sie in backup_status.message und im Log landen, und Ziele aus restic-ziel.test.ts der App */
const MELDUNGEN: [string, string][] = [
  ["rest:https://nutzer:ge@heim@backup.example:8000/haben", "rest:https://backup.example:8000/haben"],
  ["rest:https://nutzer:ab/cd+ef@backup.example/haben", "rest:https://backup.example/haben"],
  ["rest:https://nutzer:geheim@backup.example/haben?x@y", "rest:https://backup.example/haben?x@y"],
  ["rest:https://nutzer@example.com:ab/cd@backup.example/haben", "rest:https://backup.example/haben"],
  ["sftp://nutzer:ab/cd@backup.example:2222//srv/restic", "sftp://backup.example:2222//srv/restic"],
  ["rest:https://nutzer:ab/cd@[::1]:8000/haben", "rest:https://[::1]:8000/haben"],
  ["rest:https://nutzer:12/ab@h", "rest:https://h"],
  ["sftp:nutzer@backup.example:/srv/restic", "sftp:backup.example:/srv/restic"],
  ["rclone::sftp,host=backup.example,user=nutzer,pass=GEHEIM:haben", "rclone::sftp:haben"],
  ["rclone:fern,pass='a:GEHEIM':haben", "rclone:fern:haben"],
  ["rclone::webdav,url='https://nutzer:ab/cd@dav.example/haben':pfad", "rclone::webdav:pfad"],
  // Go url.Parse liest die Adresse nicht und nennt sie samt dem Teil des Passworts vor / ? # als Port: beides fällt weg
  [
    'Fatal: parsing repository location failed: parse "https://nutzer:ab/cd@backup.example/haben": invalid port ":ab" after host',
    'Fatal: parsing repository location failed: parse "https://": invalid port after host',
  ],
  ['Fatal: parse "https://nutzer:ab?cd@backup.example/haben": invalid port ":ab" after host', 'Fatal: parse "https://": invalid port after host'],
  // Bei # schneidet Go die Adresse vorher ab; ein @ im Rest des Passworts sähe wie das Ende der Zugangsdaten aus
  ['Fatal: parse "https://nutzer:ab": invalid port ":ab" after host', 'Fatal: parse "https://": invalid port after host'],
  ['Fatal: parse "https://nutzer:ab/@cd": invalid port ":ab" after host', 'Fatal: parse "https://": invalid port after host'],
  ['Fatal: parse "https://nutzer:geheim@backup.example:8OOO/haben": invalid port ":8OOO" after host', 'Fatal: parse "https://": invalid port after host'],
  ['Fatal: parse \\"https://nutzer:ab/cd@backup.example\\": invalid port', 'Fatal: parse \\"https://\\": invalid port'],
  // Leerraum, " oder Umlaut im Passwort: Go nennt die Adresse in Go-Schreibweise (\" für ")
  [
    'Fatal: parsing repository location failed: parse "https://nutzer:ab cd@backup.example/haben": net/url: invalid userinfo',
    'Fatal: parsing repository location failed: parse "https://": net/url: invalid userinfo',
  ],
  ['Fatal: parse "https://nutzer:ab\\"c d@backup.example/haben": net/url: invalid userinfo', 'Fatal: parse "https://": net/url: invalid userinfo'],
  ['Fatal: parse "https://nutzer:äb@backup.example/haben": net/url: invalid userinfo', 'Fatal: parse "https://": net/url: invalid userinfo'],
  ['Fatal: parse "https://nutzer:ab%zz@backup.example/haben": invalid URL escape "%zz"', 'Fatal: parse "https://": invalid URL escape'],
  // Meldungen mit mehreren Adressen, Leerraum oder " beenden eine Adresse
  ["rest:https://nutzer:ab/cd@backup.example: connection refused", "rest:https://backup.example: connection refused"],
  // Passwort mit Ziffern vor dem /: Go liest sie als Port, restic kommt bis zum Verbinden und nennt die Adresse mit „: “
  [
    'Fatal: unable to open repository at rest:https://nutzer:12/cd@backup.example:8000: Get "https://nutzer:12/cd@backup.example:8000/config": dial tcp',
    'Fatal: unable to open repository at rest:https://backup.example:8000: Get "https://backup.example:8000/config": dial tcp',
  ],
  ["Fatal: repository does not exist at rest:https://nutzer:12/cd@[::1]:8000: x", "Fatal: repository does not exist at rest:https://[::1]:8000: x"],
  ["a rest:https://u:ab/cd@h1/x und b s3:https://v:ef/gh@h2/y", "a rest:https://h1/x und b s3:https://h2/y"],
  ["(https://h/x)(https://u:p@g/y)", "(https://h/x)(https://g/y)"],
  [
    'Fatal: unable to open config file: Get "https://nutzer:***@backup.example/haben/config": EOF',
    'Fatal: unable to open config file: Get "https://backup.example/haben/config": EOF',
  ],
  [
    "Fatal: unable to open repository at sftp:nutzer@backup.example:/srv/restic: ssh: handshake failed",
    "Fatal: unable to open repository at sftp:backup.example:/srv/restic: ssh: handshake failed",
  ],
  ["Fatal: create repository at rclone::sftp,host=h,pass=GEHEIM:haben failed", "Fatal: create repository at rclone::sftp:haben failed"],
  // restic --json: exit_error mit \n vor dem Repository („unable to open config file: %v\n%v“), so in backup.err und last_error
  ["Fatal: unable to open config file: EOF\\nrclone::sftp,host=h,pass=GEHEIM:haben", "Fatal: unable to open config file: EOF\\nrclone::sftp:haben"],
  [
    "Fatal: unable to open config file: EOF\\nsftp:nutzer@backup.example:/srv/restic",
    "Fatal: unable to open config file: EOF\\nsftp:backup.example:/srv/restic",
  ],
  // Ohne Zugangsdaten bleibt alles stehen, auch ein @ im Pfad
  ...[
    "rest:https://h/haben@2026",
    "sftp://h//srv/a@b",
    "rest:https://[::1]:8000/a@b",
    "rest:https://h?x@y",
    "https://h/x,mail:a@b.de",
    "(https://h/x)(https://g/y@z)",
    "s3:s3.example.com/haben-backup",
    "b2:bucket:pfad",
    "Kette und Siegel geprüft, Mail an max@example.com",
    'pg_dump: error: connection to server at "db" (10.0.0.2), port 5432 failed',
  ].map((text): [string, string] => [text, text]),
];

describe("Meldungen ohne Zugangsdaten (restic-ziel.sh)", () => {
  it.each(MELDUNGEN)("%s", (text, erwartet) => {
    expect(messageWithoutCredentials(text)).toBe(erwartet);
    expect(ohneZugangsdaten(text), "gleiche Regel in der App").toBe(erwartet);
  });

  it("gibt in keinem anderen Skript RESTIC_REPOSITORY ungefiltert aus (#1349)", () => {
    const roh = readdirSync(DIR)
      .filter((datei) => datei.endsWith(".sh") && datei !== "restic-ziel.sh")
      .flatMap((datei) =>
        readFileSync(join(DIR, datei), "utf8")
          .split("\n")
          .filter((zeile) => /\$\{?RESTIC_REPOSITORY/.test(zeile) && !zeile.trimStart().startsWith("#"))
          .map((zeile) => `${datei}: ${zeile.trim()}`),
      );
    expect(roh).toEqual([]);
  });

  it("legt das Repository in keinem anderen Skript ohne init_repository an (#1349)", () => {
    const roh = readdirSync(DIR)
      .filter((datei) => datei.endsWith(".sh") && datei !== "restic-ziel.sh")
      .flatMap((datei) =>
        readFileSync(join(DIR, datei), "utf8")
          .split("\n")
          .filter((zeile) => /\brestic init\b/.test(zeile) && !zeile.trimStart().startsWith("#"))
          .map((zeile) => `${datei}: ${zeile.trim()}`),
      );
    expect(roh).toEqual([]);
  });
});

describe("Anlegen des Repositorys (init_repository, von backup.sh beim ersten Lauf)", () => {
  // Wie restic 0.19.1 init (cmd/restic/cmd_init.go): Es nennt das Repository über location.StripPassword, das für
  // sftp:, s3: und rclone: die Adresse unverändert lässt (location.NoPassword) und für rest: den Nutzer zeigt
  const stubs = mkdtempSync(join(tmpdir(), "haben-backup-"));
  writeFileSync(
    join(stubs, "restic"),
    [
      "#!/bin/sh",
      '[ "$1" = init ] || exit 2',
      'if [ -n "$INIT_FEHLER" ]; then echo "Fatal: create repository at $RESTIC_REPOSITORY failed: connection refused" >&2; exit 1; fi',
      'printf "created restic repository 1234567890 at %s\\n\\nPlease note that knowledge of your password is required to access\\n" "$RESTIC_REPOSITORY"',
    ].join("\n"),
  );
  chmodSync(join(stubs, "restic"), 0o755);
  afterAll(() => rmSync(stubs, { recursive: true, force: true }));

  const initRepository = (repository: string, fehler = false) =>
    spawnSync("bash", ["-c", `source "${join(DIR, "restic-ziel.sh")}" && init_repository`], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubs}:${process.env.PATH}`, RESTIC_REPOSITORY: repository, INIT_FEHLER: fehler ? "1" : "" },
    });

  const ZIELE = [
    ["rest:https://nutzer:ab/cd@backup.example/haben", "rest:https://backup.example/haben"],
    ["sftp:nutzer@backup.example:/srv/restic", "sftp:backup.example:/srv/restic"],
    ["rclone::sftp,host=backup.example,user=nutzer,pass=GEHEIM:haben", "rclone::sftp:haben"],
  ];

  it.each(ZIELE)("nennt %s ohne Zugangsdaten, auch in der Ausgabe von restic", (repository, ziel) => {
    const r = initRepository(repository);
    expect(r.stdout).toBe(
      `Lege das restic-Repository ${ziel} an …\ncreated restic repository 1234567890 at ${ziel}\n\nPlease note that knowledge of your password is required to access\n`,
    );
    expect(r.status, r.stderr).toBe(0);
  });

  it.each(ZIELE)("meldet einen Fehlschlag mit %s ohne Zugangsdaten", (repository, ziel) => {
    const r = initRepository(repository, true);
    expect(r.stderr).toBe(`Fatal: create repository at ${ziel} failed: connection refused\n`);
    expect(r.status).toBe(1);
  });
});

describe("Fehlerausgabe eines Laufs (stream_without_credentials)", () => {
  it("filtert jede Zeile, auch eine letzte ohne Zeilenumbruch", () => {
    const r = spawnSync("bash", ["-c", `source "${join(DIR, "restic-ziel.sh")}" && stream_without_credentials`], {
      input: "Fatal: at sftp:nutzer@h:/srv: x\nrest:https://n:ab/cd@h/p",
      encoding: "utf8",
    });
    expect(r.stdout).toBe("Fatal: at sftp:h:/srv: x\nrest:https://h/p\n");
  });

  it("geht in backup.sh und restore-check.sh in Log und Fehlerdatei (#1349)", () => {
    for (const datei of ["backup.sh", "restore-check.sh"])
      expect(readFileSync(join(DIR, datei), "utf8"), datei).toContain('exec 3>&2 2> >(stream_without_credentials | tee -a "$errlog" >&3)');
  });

  it("nennt das Repository nicht, wenn restic im Test-Restore scheitert", () => {
    // restic 0.19.1 nennt das Repository in „unable to open repository at %v: %v“ über location.StripPassword, das für
    // sftp:, s3: und rclone: nichts entfernt; psql und dropdb fehlen, der Lauf trägt nichts ein
    const stubs = mkdtempSync(join(tmpdir(), "haben-backup-"));
    try {
      writeFileSync(join(stubs, "restic"), '#!/bin/sh\necho "Fatal: unable to open repository at $RESTIC_REPOSITORY: dial tcp" >&2\nexit 1\n');
      // rclone gehört ins Image; ohne den Stub bräche die Vorprüfung ab, bevor restic überhaupt läuft
      writeFileSync(join(stubs, "rclone"), "#!/bin/sh\nexit 0\n");
      writeFileSync(join(stubs, "psql"), "#!/bin/sh\nexit 2\n");
      writeFileSync(join(stubs, "dropdb"), "#!/bin/sh\nexit 0\n");
      for (const name of ["restic", "rclone", "psql", "dropdb"]) chmodSync(join(stubs, name), 0o755);
      const r = spawnSync("bash", [join(DIR, "restore-check.sh")], {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${stubs}:${process.env.PATH}`,
          PGDATABASE: "haben",
          BACKUP_HOST: "haben",
          RESTIC_REPOSITORY: "rclone::sftp,host=backup.example,user=nutzer,pass=GEHEIM:haben",
        },
      });
      expect(r.stderr).toContain("Fatal: unable to open repository at rclone::sftp:haben: dial tcp");
      expect(r.stderr).not.toContain("GEHEIM");
      expect(r.status).toBe(1);
    } finally {
      rmSync(stubs, { recursive: true, force: true });
    }
  });
});

describe("Log beim Start des Zeitplans (entrypoint.sh)", () => {
  // Statt zu warten und zu sichern endet der Zeitplan nach der ersten Runde: sleep kehrt sofort zurück, backup.sh
  // beendet den Zeitplan mit SIGTERM wie docker stop
  const stubs = mkdtempSync(join(tmpdir(), "haben-backup-"));
  writeFileSync(join(stubs, "sleep"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(stubs, "backup.sh"), '#!/bin/sh\nkill -TERM "$PPID"\n');
  // rclone ist im Image; die Vorprüfung bricht ohne die Binärdatei ab, bevor die Zeile mit dem Ziel erscheint
  writeFileSync(join(stubs, "rclone"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(stubs, "sleep"), 0o755);
  chmodSync(join(stubs, "backup.sh"), 0o755);
  chmodSync(join(stubs, "rclone"), 0o755);
  afterAll(() => rmSync(stubs, { recursive: true, force: true }));

  it.each([
    ["rest:https://nutzer:ab/cd@backup.example/haben", "rest:https://backup.example/haben"],
    ["sftp:nutzer@backup.example:/srv/restic", "sftp:backup.example:/srv/restic"],
    ["rclone::sftp,host=backup.example,user=nutzer,pass=GEHEIM:haben", "rclone::sftp:haben"],
  ])("nennt %s ohne Zugangsdaten", (repository, ziel) => {
    const r = spawnSync("bash", [join(DIR, "entrypoint.sh")], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, PATH: `${stubs}:${process.env.PATH}`, BACKUP_TIME: "03:15", TZ: "Europe/Berlin", RESTIC_REPOSITORY: repository },
    });
    expect(r.stdout.split("\n")[0]).toBe(`Backup täglich um 03:15 (Europe/Berlin) nach ${ziel}`);
    expect(r.status, r.stderr).toBe(0);
  });
});
