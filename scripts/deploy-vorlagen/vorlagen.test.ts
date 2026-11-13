// Die Vorlagen für einzelne Plattformen (#414) beschreiben denselben Stack wie deploy/compose.yml. Kommt dort eine
// Umgebungsvariable der App hinzu oder fällt weg, muss jede Vorlage sie übernehmen oder hier bewusst auslassen.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

type Service = { image?: string; environment?: Record<string, unknown>; volumes?: string[]; entrypoint?: string[] };
type Compose = { services: Record<string, Service> };

const root = join(import.meta.dirname, "../..");
const read = (path: string) => Bun.YAML.parse(readFileSync(join(root, path), "utf8")) as Compose;

const haupt = read("deploy/compose.yml");
const app = haupt.services.app;
const hauptVariablen = Object.keys(app.environment ?? {});

const vorlagen = [
  {
    datei: "deploy/synology/compose.yml",
    // Backup und Restore lesen diese Geheimnisse aus Dateien im Volume schluessel
    backupAlsDatei: { PGPASSWORD: "PGPASSFILE", RESTIC_PASSWORD: "RESTIC_PASSWORD_FILE" } as Record<string, string>,
    // Setzt der Einstiegspunkt der App aus den erzeugten Schlüsseln
    ausSchluesseln: ["DATABASE_URL", "BETTER_AUTH_SECRET", "HABEN_ENCRYPTION_KEY"],
    // Ohne Shell nicht einzurichten (Dateien einhängen, SSO-Anbieter, x86_64-Laufzeit) oder selten gebraucht;
    // wer sie braucht, ergänzt sie im Projekt nach docs/installation.md
    ausgelassen: [
      "OIDC_ONLY",
      "OIDC_ISSUER",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
      "OIDC_SCOPES",
      "OIDC_DISPLAY_NAME",
      "OIDC_GROUPS_CLAIM",
      "OIDC_GROUP_INHABER",
      "OIDC_GROUP_STEUERBERATUNG",
      "ERIC_HOME",
      "ERIC_SHA256",
      "ERIC_WORKER_COMMAND",
      "EXTRACTION_PROVIDER",
      "EXTRACTION_TIMEOUT_SECONDS",
      "EXTRACTION_MAX_PAGES",
      "EXTRACTION_INPUT",
      "EXTRACTION_EXTRA_BODY",
      "LAYOUTS_MAX_COUNT",
      "LAYOUTS_MAX_MB",
      "LAYOUTS_PACKAGES_URL",
      "ENABLE_BANKING_APP_ID",
      "ENABLE_BANKING_KEY_FILE",
    ],
  },
];

describe.each(vorlagen)("$datei", ({ datei, ausSchluesseln, ausgelassen, backupAlsDatei }) => {
  const vorlage = read(datei).services;
  const variablen = Object.keys(vorlage.app.environment ?? {});

  test("übernimmt jede Umgebungsvariable der App aus deploy/compose.yml oder lässt sie bewusst aus", () => {
    const fehlend = hauptVariablen.filter((name) => ![...variablen, ...ausSchluesseln, ...ausgelassen].includes(name));
    expect(fehlend).toEqual([]);
  });

  test("nennt keine Variable, die es in deploy/compose.yml nicht gibt", () => {
    const veraltet = [...variablen, ...ausSchluesseln, ...ausgelassen].filter((name) => !hauptVariablen.includes(name));
    expect(veraltet).toEqual([]);
  });

  // Ein zweites System als Repository (docs/installation.md, „Repository auf einem zweiten System“) braucht etwa für S3
  // AWS_ACCESS_KEY_ID und AWS_SECRET_ACCESS_KEY; fehlen sie in der Vorlage, schlägt das Backup dorthin fehl
  test("übernimmt jede Umgebungsvariable des Backups aus deploy/compose.yml", () => {
    const backupVariablen = Object.keys(vorlage.backup.environment ?? {});
    const fehlend = Object.keys(haupt.services.backup.environment ?? {}).filter((name) => !backupVariablen.includes(backupAlsDatei[name] ?? name));
    expect(fehlend).toEqual([]);
  });

  test("setzt die Variablen aus den Schlüsseln im Einstiegspunkt der App", () => {
    const skript = (vorlage.app.entrypoint ?? []).join("\n");
    for (const name of ausSchluesseln) expect(skript).toContain(`export ${name}=`);
  });

  test.each([
    { fall: "ohne getrennte Zugänge", adresse: "", migration: "", erwartet: "postgres://haben:test-db-passwort@db:5432/haben" },
    {
      fall: "mit getrennten Zugängen",
      adresse: "postgres://haben_app:test-app-passwort@db:5432/haben",
      migration: "postgres://haben:test-db-passwort@db:5432/haben",
      erwartet: "postgres://haben_app:test-app-passwort@db:5432/haben",
    },
  ])("übergibt die Datenbankzugänge $fall an haben-entrypoint", ({ adresse, migration, erwartet }) => {
    const ordner = mkdtempSync(join(tmpdir(), "haben-synology-"));
    try {
      writeFileSync(join(ordner, "db-passwort"), "test-db-passwort");
      writeFileSync(join(ordner, "auth-secret"), "test-auth-secret");
      writeFileSync(join(ordner, "encryption-key"), "test-encryption-key");
      writeFileSync(
        join(ordner, "haben-entrypoint"),
        '#!/bin/sh\nprintf "%s\\n" "$DATABASE_URL" "$MIGRATION_DATABASE_URL" "$BETTER_AUTH_SECRET" "$HABEN_ENCRYPTION_KEY"\n',
        { mode: 0o700 },
      );
      // Compose löst $$ zu $ auf; nur der Schlüsselpfad zeigt hier auf künstliche Dateien.
      const skript = (vorlage.app.entrypoint?.[2] ?? "").replaceAll("$$", "$").replaceAll("/run/haben", ordner);
      const lauf = spawnSync("sh", ["-c", skript], {
        env: { ...process.env, DATABASE_URL: adresse, MIGRATION_DATABASE_URL: migration, PATH: `${ordner}:${process.env.PATH}` },
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(lauf.error).toBeUndefined();
      expect(lauf.status).toBe(0);
      expect(lauf.stderr).toBe("");
      expect(lauf.stdout.trimEnd().split("\n")).toEqual([erwartet, migration, "test-auth-secret", "test-encryption-key"]);
    } finally {
      rmSync(ordner, { recursive: true, force: true });
    }
  });

  test("nutzt dieselben Images und hängt dieselben Verzeichnisse der App ein", () => {
    for (const name of ["db", "app", "backup"]) expect(vorlage[name]?.image).toBe(haupt.services[name].image);
    const ziele = (volumes: string[] = []) => volumes.map((v) => v.split(":")[1]).filter((ziel) => ziel.startsWith("/var/lib/haben"));
    expect(ziele(vorlage.app.volumes).sort()).toEqual(ziele(app.volumes).sort());
  });
});
