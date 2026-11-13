// Die Vorlagen für einzelne Plattformen (#414) beschreiben denselben Stack wie deploy/compose.yml. Kommt dort eine
// Umgebungsvariable der App hinzu oder fällt weg, muss jede Vorlage sie übernehmen oder hier bewusst auslassen.
import { readFileSync } from "node:fs";
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

describe.each(vorlagen)("$datei", ({ datei, ausSchluesseln, ausgelassen }) => {
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

  test("setzt die Variablen aus den Schlüsseln im Einstiegspunkt der App", () => {
    const skript = (vorlage.app.entrypoint ?? []).join("\n");
    for (const name of ausSchluesseln) expect(skript).toContain(`export ${name}=`);
  });

  test("nutzt dieselben Images und hängt dieselben Verzeichnisse der App ein", () => {
    for (const name of ["db", "app", "backup"]) expect(vorlage[name]?.image).toBe(haupt.services[name].image);
    const ziele = (volumes: string[] = []) => volumes.map((v) => v.split(":")[1]).filter((ziel) => ziel.startsWith("/var/lib/haben"));
    expect(ziele(vorlage.app.volumes).sort()).toEqual(ziele(app.volumes).sort());
  });
});
