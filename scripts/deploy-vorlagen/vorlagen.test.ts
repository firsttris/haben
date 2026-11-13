// Die Vorlagen für einzelne Plattformen (#414) beschreiben denselben Stack wie deploy/compose.yml. Kommt dort eine
// Umgebungsvariable der App oder des Backups hinzu oder fällt weg, muss jede Vorlage sie übernehmen oder hier bewusst
// auslassen.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

type ComposeService = { image?: string; environment?: Record<string, unknown> | string[]; volumes?: string[]; entrypoint?: string[] };
type Compose = { services: Record<string, ComposeService> };
/** Was die Tests von einem Container brauchen, gleich ob aus Compose oder einer Unraid-Vorlage */
type Dienst = { image: string; variablen: string[]; ziele: string[]; entrypoint: string };

const root = join(import.meta.dirname, "../..");
const text = (path: string) => readFileSync(join(root, path), "utf8");

// Liste („NAME=wert“ oder nur „NAME“) oder Objekt; Variablen, die Coolify selbst auswertet (SERVICE_URL_APP_3000), zählen nicht
const namen = (environment: ComposeService["environment"]) =>
  (Array.isArray(environment) ? environment.map((e) => e.split("=")[0]) : Object.keys(environment ?? {})).filter((name) => !name.startsWith("SERVICE_"));
const ausCompose = (service: ComposeService): Dienst => ({
  image: service.image ?? "",
  variablen: namen(service.environment),
  ziele: (service.volumes ?? []).map((v) => v.split(":")[1]),
  entrypoint: (service.entrypoint ?? []).join("\n"),
});
const compose = (path: string) => {
  const { services } = Bun.YAML.parse(text(path)) as Compose;
  return { app: ausCompose(services.app), db: ausCompose(services.db), backup: ausCompose(services.backup) };
};

// Unraid (dockerMan): je Container eine XML-Datei mit <Repository> und <Config Type="Variable|Path" Target="…">
const unraidVorlage = (path: string): Dienst => {
  const xml = text(path);
  const configs = [...xml.matchAll(/<Config ([^>]*?)\/?>/g)].map((m) => ({
    type: m[1].match(/Type="([^"]*)"/)?.[1],
    target: m[1].match(/Target="([^"]*)"/)?.[1] ?? "",
  }));
  return {
    image: xml.match(/<Repository>([^<]*)<\/Repository>/)?.[1] ?? "",
    variablen: configs.filter((c) => c.type === "Variable").map((c) => c.target),
    ziele: configs.filter((c) => c.type === "Path").map((c) => c.target),
    entrypoint: "",
  };
};
const unraid = () => ({
  app: unraidVorlage("deploy/unraid/haben.xml"),
  db: unraidVorlage("deploy/unraid/haben-db.xml"),
  backup: unraidVorlage("deploy/unraid/haben-backup.xml"),
});

const haupt = compose("deploy/compose.yml");

// SSO braucht einen eingerichteten Anbieter, ERiC von Hand oder emuliert eine Shell, der Kontoabruf eine eingehängte
// Schlüsseldatei; wer das braucht, ergänzt es nach docs/installation.md
const ohneShell = [
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
];

const vorlagen = [
  {
    name: "deploy/synology/compose.yml",
    dienste: compose("deploy/synology/compose.yml"),
    // Setzt der Einstiegspunkt der App aus den erzeugten Schlüsseln
    ausSchluesseln: ["DATABASE_URL", "BETTER_AUTH_SECRET", "HABEN_ENCRYPTION_KEY"],
    ausgelassen: ohneShell,
    // Backup und Restore lesen diese Geheimnisse aus Dateien im Volume schluessel
    backupAlsDatei: { PGPASSWORD: "PGPASSFILE", RESTIC_PASSWORD: "RESTIC_PASSWORD_FILE" } as Record<string, string>,
  },
  {
    name: "deploy/coolify/compose.yml",
    dienste: compose("deploy/coolify/compose.yml"),
    ausSchluesseln: [],
    // Ohne Datei zum Einhängen und ohne x86_64-Laufzeit auf dem Server
    ausgelassen: ["ERIC_HOME", "ERIC_WORKER_COMMAND", "ENABLE_BANKING_APP_ID", "ENABLE_BANKING_KEY_FILE"],
    backupAlsDatei: {} as Record<string, string>,
  },
  {
    name: "deploy/unraid/*.xml",
    dienste: unraid(),
    ausSchluesseln: [],
    ausgelassen: ohneShell,
    backupAlsDatei: {} as Record<string, string>,
  },
];

describe.each(vorlagen)("$name", ({ dienste, ausSchluesseln, ausgelassen, backupAlsDatei }) => {
  const bekannt = [...dienste.app.variablen, ...ausSchluesseln, ...ausgelassen];

  test("übernimmt jede Umgebungsvariable der App aus deploy/compose.yml oder lässt sie bewusst aus", () => {
    expect(haupt.app.variablen.filter((name) => !bekannt.includes(name))).toEqual([]);
  });

  test("nennt keine Variable der App, die es in deploy/compose.yml nicht gibt", () => {
    expect(bekannt.filter((name) => !haupt.app.variablen.includes(name))).toEqual([]);
  });

  // Ein zweites System als Repository (docs/installation.md, „Repository auf einem zweiten System“) braucht etwa für S3
  // AWS_ACCESS_KEY_ID und AWS_SECRET_ACCESS_KEY; fehlen sie in der Vorlage, schlägt das Backup dorthin fehl
  test("übernimmt jede Umgebungsvariable des Backups aus deploy/compose.yml", () => {
    const fehlend = haupt.backup.variablen.filter((name) => !dienste.backup.variablen.includes(backupAlsDatei[name] ?? name));
    expect(fehlend).toEqual([]);
  });

  test("setzt die Variablen aus den Schlüsseln im Einstiegspunkt der App", () => {
    for (const name of ausSchluesseln) expect(dienste.app.entrypoint).toContain(`export ${name}=`);
  });

  test("nutzt dieselben Images und hängt dieselben Verzeichnisse der App ein", () => {
    for (const name of ["db", "app", "backup"] as const) expect(dienste[name].image).toBe(haupt[name].image);
    const ziele = (dienst: Dienst) => dienst.ziele.filter((ziel) => ziel.startsWith("/var/lib/haben")).sort();
    expect(ziele(dienste.app)).toEqual(ziele(haupt.app));
  });
});
