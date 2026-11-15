/**
 * Getrennte Datenbankrollen (docs/installation-konfiguration.md, „Getrennte Datenbankrollen“): Die Vorlage
 * compose.env.example verbindet die App als haben_app mit einem Platzhalter als Passwort, und die Rolle muss es vor
 * dem ersten Start der App geben. Das Werkzeug setzt ein eigenes Passwort je Instanz und legt die Rolle an.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { envWerte } from "./env-datei.ts";
import { umgebung, VORLAGEN } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

const roh = (name: string) => readFileSync(join(t.basis, name, ".env"), "utf8");
const env = (name: string) => envWerte(roh(name));
const appPasswort = (name: string) => /^postgres:\/\/haben_app:([0-9a-f]{48})@db:5432\/haben$/.exec(env(name).get("DATABASE_URL") ?? "")?.[1];
const CREATEUSER = "exec -T db createuser -U haben --login --no-superuser --no-createdb --no-createrole --pwprompt haben_app";

it("setzt je Instanz ein eigenes Passwort der App-Rolle statt des Platzhalters der Vorlage", async () => {
  expect(readFileSync(join(VORLAGEN, "compose.env.example"), "utf8")).toContain("APP_PASSWORT_EINTRAGEN");
  expect((await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten")).status).toBe(0);
  expect((await t.lauf("neu", "firma2", "firma2.example.de", "--nicht-starten")).status).toBe(0);
  expect(roh("firma1")).not.toContain("APP_PASSWORT_EINTRAGEN");
  expect(appPasswort("firma1")).toBeDefined();
  expect(appPasswort("firma1")).not.toBe(appPasswort("firma2"));
  expect(appPasswort("firma1")).not.toBe(env("firma1").get("DB_PASSWORD"));
  // Der Eigentümerzugang für Migrationen bleibt, wie die Vorlage ihn schreibt
  const migration = readFileSync(join(VORLAGEN, "compose.env.example"), "utf8")
    .split("\n")
    .filter((z) => z.startsWith("MIGRATION_DATABASE_URL=postgres://haben:"));
  expect(migration).toHaveLength(1);
  expect(roh("firma1").split("\n")).toContain(migration[0]);
});

it("startet erst die Datenbank, legt die App-Rolle an und startet dann die App; das Passwort geht nur über die Standardeingabe", async () => {
  const r = await t.lauf("neu", "firma1", "firma1.example.de");
  expect(r.status, r.stderr).toBe(0);
  const passwort = appPasswort("firma1") ?? "";
  expect(passwort).not.toBe("");
  const eigene = t.docker.aufrufe.filter((a) => a.startsWith("firma1 compose "));
  const stelle = (sub: string) => eigene.indexOf(`firma1 compose ${sub}`);
  expect(stelle("up -d --wait db")).toBeGreaterThanOrEqual(0);
  expect(stelle(CREATEUSER)).toBeGreaterThan(stelle("up -d --wait db"));
  expect(stelle("up -d")).toBeGreaterThan(stelle(CREATEUSER));
  // createuser --pwprompt fragt zweimal
  expect(t.docker.eingaben).toEqual([{ aufruf: `firma1 compose ${CREATEUSER}`, eingabe: `${passwort}\n${passwort}\n` }]);
  expect(t.docker.aufrufe.join("\n")).not.toContain(passwort);
  expect(r.stdout + r.stderr).not.toContain(passwort);
});

it("startet die App nicht, wenn sich die App-Rolle nicht anlegen lässt", async () => {
  t.docker.z.rolleKaputt.add("firma1");
  const r = await t.lauf("neu", "firma1", "firma1.example.de");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("haben_app");
  expect(r.stderr).not.toContain(appPasswort("firma1"));
  expect(t.docker.aufrufe).not.toContain("firma1 compose up -d");
});

it("nennt mit --nicht-starten die Schritte für die App-Rolle und legt sie nicht an", async () => {
  const r = await t.lauf("neu", "firma1", "firma1.example.de", "--nicht-starten");
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("docker compose up -d --wait db");
  expect(r.stdout).toContain("createuser -U haben --login --no-superuser --no-createdb --no-createrole --pwprompt haben_app");
  expect(r.stdout).not.toContain(appPasswort("firma1"));
  expect(t.docker.eingaben).toEqual([]);
});
