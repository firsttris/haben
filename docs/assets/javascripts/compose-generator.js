// @ts-check
/*
 * Logik des Compose-Generators (docs/compose-generator.md): .env, compose.override.yml und Startbefehle aus den Angaben
 * im Formular. Reines JavaScript ohne Build, weil die Doku-Seite nichts übersetzt; die Typen prüft `bun run typecheck`
 * über deploy/tsconfig.json, den Abgleich mit deploy/compose.env.example scripts/compose-generator/.
 *
 * compose.yml erzeugt der Generator nicht: Sie kommt unverändert aus deploy/compose.yml und wird bei jedem Update neu
 * geladen. Jede Abweichung steht deshalb im Override (wie deploy/compose.override.example.yml).
 */

/**
 * @typedef {object} Config
 * @property {string} domain
 * @property {"dockerhub" | "ghcr"} registry
 * @property {string} imageTag
 * @property {"caddy" | "proxy-docker" | "proxy-host"} proxyMode
 * @property {string} proxyNetwork
 * @property {string} dbPassword
 * @property {string} appDbPassword
 * @property {string} authSecret
 * @property {string} encryptionKey
 * @property {string} resticPassword
 * @property {boolean} ericAutoInstall
 * @property {boolean} arm64
 * @property {"none" | "anthropic" | "ollama" | "openai"} aiMode
 * @property {string} extractionBaseUrl
 * @property {string} extractionModel
 * @property {"local" | "s3" | "remote"} backupMode
 * @property {string} resticRepository
 * @property {string} backupTime
 * @property {string} restoreCheckDays
 * @property {boolean} oidcOnly
 * @property {string} oidcIssuer
 * @property {string} oidcClientId
 * @property {string} oidcDisplayName
 * @property {string} oidcGroupsClaim
 * @property {string} oidcGroupInhaber
 * @property {string} oidcGroupSteuerberatung
 */

/** @typedef {{ titel: string, variablen: [string, string][] }} EnvBlock */

/** Steht in der .env statt der Schlüssel von Anthropic, S3 und SSO: Die tippt niemand auf einer öffentlichen Seite ein. */
export const PLATZHALTER = "hier-eintragen";

/** @param {number} byteCount */
const randomBytes = (byteCount) => globalThis.crypto.getRandomValues(new Uint8Array(byteCount));

/** Wie `openssl rand -hex`: nur 0-9 und a-f, passt in die Datenbank-URL. @param {number} byteCount */
export const randomHex = (byteCount) => Array.from(randomBytes(byteCount), (b) => b.toString(16).padStart(2, "0")).join("");

/** Wie `openssl rand -base64`. @param {number} byteCount */
export const randomBase64 = (byteCount) => btoa(String.fromCharCode(...randomBytes(byteCount)));

/** Passwörter und Schlüssel in derselben Stärke wie in docs/installation.md (`-hex 24`, `-base64 32`). */
export const newSecrets = () => ({
  dbPassword: randomHex(24),
  appDbPassword: randomHex(24),
  authSecret: randomBase64(32),
  encryptionKey: randomBase64(32),
  resticPassword: randomBase64(32),
});

/**
 * Ein eigenes Datenbank-Passwort steht in der Verbindungs-URL; andere Zeichen als Buchstaben und Ziffern brechen sie.
 * @param {string} value
 * @returns {string | null} Meldung oder null
 */
export const passwordError = (value) => {
  if (value === "") return "Passwort fehlt.";
  return /^[A-Za-z0-9]+$/.test(value) ? null : "Nur Buchstaben und Ziffern, sonst bricht die Datenbank-URL.";
};

/** Domain ohne Protokoll und Schrägstriche. @param {string} raw */
export const normalizeDomain = (raw) =>
  raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

/**
 * Wert für die .env. Ohne Anführungszeichen liest Compose nur bis „ #“ und ersetzt „$…“; in doppelten gelten \\, \"
 * und $$ (mit docker compose config geprüft). Einfache gingen nicht: Ein \ am Ende ließe sich darin nicht schreiben.
 * Schlüssel in Base64 und Hex sowie Adressen ohne Sonderzeichen bleiben, wie sie sind.
 * @param {string} value
 */
const envValue = (value) =>
  /^[A-Za-z0-9._:/@+=,-]*$/.test(value) ? value : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "$$$$")}"`;

/** Wert für YAML, in Anführungszeichen, wenn er Sonderzeichen enthält. @param {string} value */
const yamlScalar = (value) => (/^[A-Za-z0-9._:/-]+$/.test(value) ? value : JSON.stringify(value));

/** @param {Config} cfg @returns {[string, string][]} */
const aiVariables = (cfg) => {
  const ollama = cfg.aiMode === "ollama";
  const compatible = ollama || cfg.aiMode === "openai";
  return [
    ["ANTHROPIC_API_KEY", cfg.aiMode === "anthropic" ? PLATZHALTER : ""],
    ["EXTRACTION_BASE_URL", compatible ? cfg.extractionBaseUrl || (ollama ? "http://host.docker.internal:11434/v1" : PLATZHALTER) : ""],
    ["EXTRACTION_MODEL", compatible ? cfg.extractionModel || (ollama ? "qwen2.5vl:7b" : PLATZHALTER) : ""],
    ["EXTRACTION_API_KEY", cfg.aiMode === "openai" ? PLATZHALTER : ""],
    ["EXTRACTION_EXTRA_BODY", ""],
  ];
};

/** @param {Config} cfg @returns {[string, string][]} */
const oidcVariables = (cfg) => {
  /** @param {string} value */
  const sso = (value) => (cfg.oidcOnly ? value : "");
  return [
    ["OIDC_ONLY", cfg.oidcOnly ? "true" : "false"],
    ["OIDC_ISSUER", sso(cfg.oidcIssuer || PLATZHALTER)],
    ["OIDC_CLIENT_ID", sso(cfg.oidcClientId || PLATZHALTER)],
    ["OIDC_CLIENT_SECRET", sso(PLATZHALTER)],
    ["OIDC_DISPLAY_NAME", sso(cfg.oidcDisplayName)],
    ["OIDC_GROUPS_CLAIM", sso(cfg.oidcGroupsClaim)],
    ["OIDC_GROUP_INHABER", sso(cfg.oidcGroupInhaber)],
    ["OIDC_GROUP_STEUERBERATUNG", sso(cfg.oidcGroupSteuerberatung)],
    ["HABEN_FIRMENPORTAL_URL", ""],
  ];
};

/**
 * Alle Variablen aus deploy/compose.env.example in deren Reihenfolge; leer heißt nicht gesetzt.
 * @param {Config} cfg
 * @returns {EnvBlock[]}
 */
export const envBlocks = (cfg) => [
  {
    titel: "Domain, Datenbank und Schlüssel; ENCRYPTION_KEY und RESTIC_PASSWORD zusätzlich im Passwortmanager sichern",
    variablen: [
      ["DOMAIN", cfg.domain],
      ["DB_PASSWORD", cfg.dbPassword],
      ["DATABASE_URL", `postgres://haben_app:${cfg.appDbPassword}@db:5432/haben`],
      // Den Platzhalter löst Compose aus der Zeile DB_PASSWORD auf, wie in deploy/compose.env.example
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Variable für Compose, kein Template-String
      ["MIGRATION_DATABASE_URL", "postgres://haben:${DB_PASSWORD}@db:5432/haben"],
      ["AUTH_SECRET", cfg.authSecret],
      ["ENCRYPTION_KEY", cfg.encryptionKey],
      ["RESTIC_PASSWORD", cfg.resticPassword],
    ],
  },
  {
    titel: "Backup",
    variablen: [
      ["RESTIC_REPOSITORY", cfg.backupMode === "local" ? "" : cfg.resticRepository || PLATZHALTER],
      ["AWS_ACCESS_KEY_ID", cfg.backupMode === "s3" ? PLATZHALTER : ""],
      ["AWS_SECRET_ACCESS_KEY", cfg.backupMode === "s3" ? PLATZHALTER : ""],
      ["BACKUP_TIME", cfg.backupTime],
      ["RESTORE_CHECK_DAYS", cfg.restoreCheckDays],
      ["RCLONE_CONFIG", ""],
    ],
  },
  {
    titel: "ELSTER",
    variablen: [
      ["ERIC_AUTO_INSTALL", cfg.ericAutoInstall ? "ja" : ""],
      ["ERIC_SHA256", ""],
      ["ERIC_HOME", ""],
      ["ERIC_WORKER_COMMAND", cfg.arm64 ? "/opt/haben-x86_64/worker.sh" : ""],
      ["ELSTER_HERSTELLER_ID", ""],
    ],
  },
  { titel: "KI-Auslesung von Belegen", variablen: aiVariables(cfg) },
  {
    titel: "Kontoabruf und mehrere Firmen",
    variablen: [
      ["ENABLE_BANKING_APP_ID", ""],
      ["FINTS_PRODUKT_ID", ""],
      ["HABEN_FIRMEN", ""],
    ],
  },
  { titel: "Single Sign-on", variablen: oidcVariables(cfg) },
];

/** @param {Config} cfg */
export const envFile = (cfg) => {
  // Den Verweis auf DB_PASSWORD in MIGRATION_DATABASE_URL soll Compose auflösen
  const roh = new Set(["MIGRATION_DATABASE_URL"]);
  const kopf = [
    "# Erzeugt mit dem Compose-Generator (https://haben.app/compose-generator.html).",
    "# Was jede Variable bedeutet: https://haben.app/installation.html#docker-compose",
  ];
  const bloecke = envBlocks(cfg).map(({ titel, variablen }) =>
    [`# ${titel}`, ...variablen.map(([name, value]) => `${name}=${roh.has(name) ? value : envValue(value)}`)].join("\n"),
  );
  return `${[kopf.join("\n"), ...bloecke].join("\n\n")}\n`;
};

/** @param {Config} cfg @returns {[string, string[]][]} Dienst und seine Zeilen im Override */
const overrideServices = (cfg) => {
  /** @type {Map<string, string[]>} */
  const services = new Map();
  /** @param {string} service @param {string[]} lines */
  const add = (service, ...lines) => services.set(service, [...(services.get(service) ?? []), ...lines]);

  if (cfg.registry !== "dockerhub" || cfg.imageTag !== "latest") {
    const prefix = cfg.registry === "ghcr" ? "ghcr.io/speicherstadt" : "tristanteu";
    const images = { db: "haben-db", app: "haben", backup: "haben-backup", restore: "haben-backup" };
    for (const [service, image] of Object.entries(images)) add(service, `image: ${prefix}/${image}:${yamlScalar(cfg.imageTag)}`);
  }
  if (cfg.proxyMode !== "caddy") add("caddy", "profiles: [eigener-proxy]");
  if (cfg.proxyMode === "proxy-docker") add("app", "networks:", "  default:", "  proxy:", "    aliases: [haben-app]");
  if (cfg.proxyMode === "proxy-host") add("app", "ports:", '  - "127.0.0.1:3000:3000"');
  if (cfg.arm64) add("app", "volumes:", "  - /opt/haben-x86_64:/opt/haben-x86_64:ro");
  if (cfg.aiMode === "ollama") add("app", "extra_hosts:", "  - host.docker.internal:host-gateway");
  return [...services];
};

/**
 * compose.override.yml mit allen Abweichungen von deploy/compose.yml, leer ohne Abweichung.
 * @param {Config} cfg
 */
export const overrideFile = (cfg) => {
  const services = overrideServices(cfg);
  if (services.length === 0) return "";
  const lines = [
    "# Erzeugt mit dem Compose-Generator (https://haben.app/compose-generator.html).",
    "# compose.yml bleibt unverändert und wird bei Updates neu geladen; Abweichungen stehen nur hier.",
    "services:",
    ...services.flatMap(([service, own]) => [`  ${service}:`, ...own.map((line) => `    ${line}`)]),
  ];
  if (cfg.proxyMode === "proxy-docker") lines.push("", "networks:", "  proxy:", "    external: true", `    name: ${yamlScalar(cfg.proxyNetwork)}`);
  return `${lines.join("\n")}\n`;
};

/** Befehle für den ersten Start wie in docs/installation.md, „Docker Compose“. @param {boolean} withOverride */
export const startCommands = (withOverride) =>
  [
    "mkdir haben && cd haben",
    "curl -O https://raw.githubusercontent.com/Speicherstadt/haben/main/deploy/compose.yml",
    withOverride ? "# .env und compose.override.yml aus dem Generator hier ablegen" : "# .env aus dem Generator hier ablegen",
    "chmod 600 .env",
    "docker compose up -d --wait db",
    "docker compose exec db createuser -U haben --login --no-superuser --no-createdb --no-createrole --pwprompt haben_app",
    "# Zweimal das App-Passwort aus DATABASE_URL eingeben; die Rolle nur einmal anlegen.",
    "docker compose up -d",
    "docker compose logs -f app",
    "",
  ].join("\n");
