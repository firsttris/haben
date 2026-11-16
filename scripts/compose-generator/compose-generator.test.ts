// Der Compose-Generator der Doku (docs/assets/javascripts/compose-generator.js) muss zu deploy/compose.yml,
// deploy/compose.env.example und docs/installation.md passen. Kommt dort eine Variable oder ein Dienst hinzu oder
// ändert sich ein Befehl, schlägt hier ein Test fehl, statt dass der Generator still eine veraltete .env erzeugt.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  type Config,
  envFile,
  newSecrets,
  normalizeDomain,
  overrideFile,
  PLATZHALTER,
  passwordError,
  startCommands,
} from "../../docs/assets/javascripts/compose-generator.js";

const root = join(import.meta.dirname, "../..");
const text = (path: string) => readFileSync(join(root, path), "utf8");

const standard: Config = {
  domain: "haben.example.de",
  registry: "dockerhub",
  imageTag: "latest",
  proxyMode: "caddy",
  proxyNetwork: "proxy",
  ...newSecrets(),
  ericAutoInstall: false,
  arm64: false,
  aiMode: "none",
  extractionBaseUrl: "",
  extractionModel: "",
  backupMode: "local",
  resticRepository: "",
  backupTime: "03:15",
  restoreCheckDays: "7",
  oidcOnly: false,
  oidcIssuer: "",
  oidcClientId: "",
  oidcDisplayName: "Authelia",
  oidcGroupsClaim: "groups",
  oidcGroupInhaber: "haben-inhaber",
  oidcGroupSteuerberatung: "haben-steuerberatung",
};

/** Zeilen „NAME=wert“ der .env als Objekt */
const variablen = (env: string) =>
  Object.fromEntries(
    env
      .split("\n")
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );

describe(".env", () => {
  // Auch die auskommentierten Zeilen der Vorlage (SSO, Firmenportal): Der Generator schreibt jede Variable, leer heißt nicht gesetzt
  const vorlage = [...text("deploy/compose.env.example").matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

  test.each([
    ["Standard", standard],
    ["alle Optionen", { ...standard, ericAutoInstall: true, arm64: true, aiMode: "openai", backupMode: "s3", oidcOnly: true } satisfies Config],
  ])("enthält jede Variable aus deploy/compose.env.example (%s)", (_, cfg) => {
    expect(Object.keys(variablen(envFile(cfg))).sort()).toEqual([...new Set(vorlage)].sort());
  });

  test("Datenbank-URLs wie in der Vorlage, mit dem App-Passwort", () => {
    const env = variablen(envFile(standard));
    expect(env.DATABASE_URL).toBe(`postgres://haben_app:${standard.appDbPassword}@db:5432/haben`);
    expect(env.MIGRATION_DATABASE_URL).toBe(variablen(text("deploy/compose.env.example")).MIGRATION_DATABASE_URL);
  });

  test("fremde Schlüssel stehen nur als Platzhalter darin", () => {
    const anthropic = variablen(envFile({ ...standard, aiMode: "anthropic" }));
    const openai = variablen(envFile({ ...standard, aiMode: "openai", extractionBaseUrl: "https://openrouter.ai/api/v1", extractionModel: "m" }));
    const s3 = variablen(envFile({ ...standard, backupMode: "s3", resticRepository: "s3:s3.example.de/bucket" }));
    const sso = variablen(envFile({ ...standard, oidcOnly: true, oidcIssuer: "https://auth.example.de", oidcClientId: "haben" }));
    expect(anthropic.ANTHROPIC_API_KEY).toBe(PLATZHALTER);
    expect(openai.EXTRACTION_API_KEY).toBe(PLATZHALTER);
    expect([s3.AWS_ACCESS_KEY_ID, s3.AWS_SECRET_ACCESS_KEY]).toEqual([PLATZHALTER, PLATZHALTER]);
    expect(sso.OIDC_CLIENT_SECRET).toBe(PLATZHALTER);
    expect([sso.OIDC_ONLY, sso.OIDC_ISSUER, sso.OIDC_CLIENT_ID]).toEqual(["true", "https://auth.example.de", "haben"]);
  });

  test("arm64: ERIC_WORKER_COMMAND ist das worker.sh aus deploy/eric-x86_64/einrichten.sh", () => {
    const anleitung = text("docs/installation-anbindungen.md");
    const env = variablen(envFile({ ...standard, arm64: true }));
    expect(anleitung).toContain(`\`ERIC_WORKER_COMMAND=${env.ERIC_WORKER_COMMAND}\` in \`.env\``);
    expect(text("deploy/eric-x86_64/einrichten.sh")).toContain("ERIC_WORKER_COMMAND=$ZIEL/worker.sh");
  });

  test("Ollama auf dem Server mit den Werten aus der Vorlage", () => {
    const env = variablen(envFile({ ...standard, aiMode: "ollama" }));
    expect([env.EXTRACTION_BASE_URL, env.EXTRACTION_MODEL]).toEqual(["http://host.docker.internal:11434/v1", "qwen2.5vl:7b"]);
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });
});

describe("Passwörter und Schlüssel", () => {
  test("eigene Datenbank-Passwörter nur aus Buchstaben und Ziffern", () => {
    expect(passwordError("Abc123")).toBeNull();
    expect(passwordError("")).toBe("Passwort fehlt.");
    for (const bad of ["ab@cd", "ab:cd", "ab/cd", "ab cd", "äb"]) expect(passwordError(bad)).not.toBeNull();
  });

  test("erzeugte Werte wie mit openssl rand in docs/installation.md", () => {
    const secrets = newSecrets();
    expect(secrets.dbPassword).toMatch(/^[0-9a-f]{48}$/);
    expect(passwordError(secrets.appDbPassword)).toBeNull();
    // HABEN_ENCRYPTION_KEY: genau 32 Byte, base64-kodiert (docs/installation-konfiguration.md)
    for (const key of [secrets.authSecret, secrets.encryptionKey, secrets.resticPassword]) expect(Buffer.from(key, "base64")).toHaveLength(32);
    expect(newSecrets().encryptionKey).not.toBe(secrets.encryptionKey);
  });

  test("Domain ohne Protokoll und Schrägstrich", () => {
    expect(normalizeDomain(" https://haben.example.de/ ")).toBe("haben.example.de");
  });
});

describe("compose.override.yml", () => {
  const dienste = [...text("deploy/compose.yml").matchAll(/^ {2}([a-z]+):$/gm)].map((m) => m[1]);

  test("ohne Abweichung keine Datei", () => {
    expect(overrideFile(standard)).toBe("");
  });

  test("nennt nur Dienste aus deploy/compose.yml", () => {
    const override = overrideFile({ ...standard, registry: "ghcr", imageTag: "1.2.3", proxyMode: "proxy-docker", arm64: true, aiMode: "ollama" });
    const genannt = [...override.matchAll(/^ {2}([a-z]+):$/gm)].map((m) => m[1]);
    expect(genannt.filter((d) => d !== "proxy")).toEqual(expect.arrayContaining(["db", "app", "backup", "restore", "caddy"]));
    for (const dienst of genannt.filter((d) => d !== "proxy")) expect(dienste).toContain(dienst);
  });

  test("Image und Tag für alle Dienste von Haben", () => {
    const override = overrideFile({ ...standard, registry: "ghcr", imageTag: "next" });
    expect(override).toContain("    image: ghcr.io/firsttris/haben-db:next");
    expect(override).toContain("    image: ghcr.io/firsttris/haben:next");
    expect(override.match(/image: ghcr\.io\/firsttris\/haben-backup:next/g)).toHaveLength(2);
    expect(override).not.toContain("caddy:");
  });

  test("eigener Proxy im Docker-Netz wie deploy/compose.override.example.yml", () => {
    const override = overrideFile({ ...standard, proxyMode: "proxy-docker", proxyNetwork: "traefik" });
    const vorlage = text("deploy/compose.override.example.yml");
    for (const zeile of ["profiles: [eigener-proxy]", "aliases: [haben-app]", "external: true"]) {
      expect(vorlage).toContain(zeile);
      expect(override).toContain(zeile);
    }
    expect(override).toContain("    name: traefik");
  });

  test("eigener Proxy auf dem Host nur auf 127.0.0.1", () => {
    expect(overrideFile({ ...standard, proxyMode: "proxy-host" })).toContain('    ports:\n      - "127.0.0.1:3000:3000"');
  });

  test("arm64 und Ollama mit den Zeilen, die deploy/compose.yml auskommentiert anbietet", () => {
    const compose = text("deploy/compose.yml");
    const override = overrideFile({ ...standard, arm64: true, aiMode: "ollama" });
    for (const zeile of ["- /opt/haben-x86_64:/opt/haben-x86_64:ro", "- host.docker.internal:host-gateway"]) {
      expect(compose).toContain(zeile);
      expect(override).toContain(zeile);
    }
  });
});

test("Startbefehle stehen so in docs/installation.md", () => {
  const anleitung = text("docs/installation.md");
  const befehle = startCommands(true)
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
  for (const befehl of befehle) expect(anleitung).toContain(befehl);
});
