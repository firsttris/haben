/* Statischer Docker-Compose-Generator für Haben (docs/compose-generator.md).
   Alle Schlüssel entstehen lokal im Browser über crypto.getRandomValues. */

(() => {
  const HEX_ALPHABET = "0123456789abcdef";

  /** Erzeugt eine zufällige Hex-Zeichenkette (nur 0-9 und a-f, sicher für Datenbank-URLs). */
  function randomHex(byteCount) {
    const bytes = new Uint8Array(byteCount);
    window.crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) {
      out += HEX_ALPHABET[bytes[i] >> 4] + HEX_ALPHABET[bytes[i] & 0x0f];
    }
    return out;
  }

  /** Erzeugt eine Base64-Zeichenkette aus Zufallsbytes (wie openssl rand -base64). */
  function randomBase64(byteCount) {
    const bytes = new Uint8Array(byteCount);
    window.crypto.getRandomValues(bytes);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /** Bereinigt die Domain: entfernt Protokoll, Schrägstriche und Leerzeichen. */
  function normalizeDomain(raw) {
    return (
      (raw || "")
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "") || "haben.example.de"
    );
  }

  /** Maskiert einfache Werte für YAML, wenn Sonderzeichen vorkommen. */
  function yamlScalar(value) {
    if (/^[A-Za-z0-9._:/-]+$/.test(value)) {
      return value;
    }
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  /** Liest alle Formularfelder aus dem DOM in ein Konfigurationsobjekt. */
  function readConfig(root) {
    const val = (id) => root.querySelector(`#${id}`)?.value ?? "";
    const checked = (id) => Boolean(root.querySelector(`#${id}`)?.checked);
    const proxyMode = root.querySelector('input[name="cg-proxy-mode"]:checked')?.value || "caddy";

    const imageTagChoice = val("cg-image-tag");
    const customTag = val("cg-image-tag-custom").trim();
    const imageTag = imageTagChoice === "custom" ? customTag || "latest" : imageTagChoice || "latest";

    return {
      domain: normalizeDomain(val("cg-domain")),
      registry: val("cg-registry") || "tristanteu",
      imageTag,
      proxyMode,
      proxyNetwork: val("cg-proxy-network").trim() || "proxy",
      dbPassword: val("cg-db-password").trim() || randomHex(24),
      appDbPassword: val("cg-app-db-password").trim() || randomHex(24),
      authSecret: val("cg-auth-secret").trim() || randomBase64(32),
      encryptionKey: val("cg-encryption-key").trim() || randomBase64(32),
      resticPassword: val("cg-restic-password").trim() || randomBase64(32),
      ericAutoInstall: checked("cg-eric-auto"),
      arm64: checked("cg-arm64"),
      aiMode: val("cg-ai-mode") || "none",
      anthropicKey: val("cg-anthropic-key").trim(),
      extractionBaseUrl: val("cg-extraction-url").trim(),
      extractionModel: val("cg-extraction-model").trim(),
      extractionApiKey: val("cg-extraction-key").trim(),
      backupMode: val("cg-backup-mode") || "local",
      resticRepository: val("cg-restic-repo").trim(),
      awsAccessKey: val("cg-aws-key").trim(),
      awsSecretKey: val("cg-aws-secret").trim(),
      backupTime: val("cg-backup-time").trim() || "03:15",
      restoreCheckDays: val("cg-restore-days").trim() || "7",
      oidcOnly: checked("cg-oidc-only"),
      oidcIssuer: val("cg-oidc-issuer").trim(),
      oidcClientId: val("cg-oidc-client-id").trim(),
      oidcClientSecret: val("cg-oidc-client-secret").trim(),
      oidcDisplayName: val("cg-oidc-display-name").trim() || "Authelia",
      oidcGroupsClaim: val("cg-oidc-groups-claim").trim() || "groups",
      oidcGroupInhaber: val("cg-oidc-group-inhaber").trim() || "haben-inhaber",
      oidcGroupSteuer: val("cg-oidc-group-steuer").trim() || "haben-steuerberatung",
    };
  }

  /** Baut den Inhalt der .env-Datei passend zu deploy/compose.env.example. */
  function buildEnvFile(cfg) {
    const lines = [
      "# Domain, unter der Haben läuft (ohne https://). Passkeys hängen an dieser Domain.",
      `DOMAIN=${cfg.domain}`,
      "",
      "# Datenbank-Passwörter (nur Buchstaben und Ziffern für die Verbindungs-URL)",
      `DB_PASSWORD=${cfg.dbPassword}`,
      `DATABASE_URL=postgres://haben_app:${cfg.appDbPassword}@db:5432/haben`,
      `MIGRATION_DATABASE_URL=postgres://haben:\${DB_PASSWORD}@db:5432/haben`,
      "",
      "# Sitzungs- und Verschlüsselungsschlüssel (ENCRYPTION_KEY und RESTIC_PASSWORD sicher aufbewahren!)",
      `AUTH_SECRET=${cfg.authSecret}`,
      `ENCRYPTION_KEY=${cfg.encryptionKey}`,
      `RESTIC_PASSWORD=${cfg.resticPassword}`,
    ];

    appendBackupEnv(lines, cfg);
    appendElsterAndAiEnv(lines, cfg);
    appendOidcEnv(lines, cfg);
    return `${lines.join("\n")}\n`;
  }

  function appendBackupEnv(lines, cfg) {
    if (cfg.backupMode !== "local" && cfg.resticRepository) {
      lines.push(`RESTIC_REPOSITORY=${cfg.resticRepository}`);
    }
    if (cfg.backupMode === "s3") {
      lines.push(`AWS_ACCESS_KEY_ID=${cfg.awsAccessKey}`);
      lines.push(`AWS_SECRET_ACCESS_KEY=${cfg.awsSecretKey}`);
    }
    if (cfg.backupTime && cfg.backupTime !== "03:15") {
      lines.push(`BACKUP_TIME=${cfg.backupTime}`);
    }
    if (cfg.restoreCheckDays && cfg.restoreCheckDays !== "7") {
      lines.push(`RESTORE_CHECK_DAYS=${cfg.restoreCheckDays}`);
    }
  }

  function appendElsterAndAiEnv(lines, cfg) {
    if (cfg.ericAutoInstall) {
      lines.push("", "# ERiC beim Start von download.elster.de laden (Zustimmung zu den Nutzungsbedingungen)", "ERIC_AUTO_INSTALL=ja");
    }
    if (cfg.arm64) {
      lines.push("", "# ELSTER auf arm64 über statisches QEMU (nach deploy/eric-x86_64/einrichten.sh)", "ERIC_WORKER_COMMAND=/opt/haben-x86_64/start.sh");
    }
    if (cfg.aiMode === "anthropic" && cfg.anthropicKey) {
      lines.push("", "# KI-Belegauslesung mit Claude (Anthropic)", `ANTHROPIC_API_KEY=${cfg.anthropicKey}`);
    } else if (cfg.aiMode === "ollama") {
      lines.push(
        "",
        "# KI-Belegauslesung über lokales Modell (Ollama)",
        `EXTRACTION_BASE_URL=${cfg.extractionBaseUrl || "http://host.docker.internal:11434/v1"}`,
        `EXTRACTION_MODEL=${cfg.extractionModel || "qwen2.5vl:7b"}`,
      );
    } else if (cfg.aiMode === "openai") {
      lines.push(
        "",
        "# KI-Belegauslesung über OpenAI-kompatible Schnittstelle",
        `EXTRACTION_BASE_URL=${cfg.extractionBaseUrl}`,
        `EXTRACTION_MODEL=${cfg.extractionModel}`,
        `EXTRACTION_API_KEY=${cfg.extractionApiKey}`,
      );
    }
  }

  function appendOidcEnv(lines, cfg) {
    if (!cfg.oidcOnly) {
      return;
    }
    lines.push(
      "",
      "# Single Sign-on (ausschließlich OpenID Connect)",
      "OIDC_ONLY=true",
      `OIDC_ISSUER=${cfg.oidcIssuer}`,
      `OIDC_CLIENT_ID=${cfg.oidcClientId}`,
      `OIDC_CLIENT_SECRET=${cfg.oidcClientSecret}`,
      `OIDC_DISPLAY_NAME=${cfg.oidcDisplayName}`,
      `OIDC_GROUPS_CLAIM=${cfg.oidcGroupsClaim}`,
      `OIDC_GROUP_INHABER=${cfg.oidcGroupInhaber}`,
      `OIDC_GROUP_STEUERBERATUNG=${cfg.oidcGroupSteuer}`,
    );
  }

  /** Baut compose.yml auf Basis von deploy/compose.yml mit gewähltem Image/Tag und Optionen. */
  function buildComposeFile(cfg) {
    const prefix = cfg.registry === "ghcr" ? "ghcr.io/firsttris" : "tristanteu";
    const tag = yamlScalar(cfg.imageTag);
    const arm64Volume = cfg.arm64 ? "      - /opt/haben-x86_64:/opt/haben-x86_64:ro\n" : "";
    const ollamaHosts = cfg.aiMode === "ollama" ? "    extra_hosts:\n      - host.docker.internal:host-gateway\n" : "";

    return `# Erzeugt mit dem Haben Compose-Generator (https://haben.app/compose-generator.html)
# Braucht Docker Compose 2.23 oder neuer.
name: haben

x-backup: &backup
  image: ${prefix}/haben-backup:${tag}
  depends_on:
    db:
      condition: service_healthy
  environment:
    PGPASSWORD: \${DB_PASSWORD}
    RESTIC_REPOSITORY: \${RESTIC_REPOSITORY:-/backups}
    RESTIC_PASSWORD: \${RESTIC_PASSWORD:?RESTIC_PASSWORD fehlt in .env}
    BACKUP_HOST: \${BACKUP_HOST:-haben}
    BACKUP_TIME: \${BACKUP_TIME:-03:15}
    RESTORE_CHECK_DAYS: \${RESTORE_CHECK_DAYS:-7}
    AWS_ACCESS_KEY_ID: \${AWS_ACCESS_KEY_ID:-}
    AWS_SECRET_ACCESS_KEY: \${AWS_SECRET_ACCESS_KEY:-}

services:
  db:
    image: ${prefix}/haben-db:${tag}
    restart: unless-stopped
    environment:
      POSTGRES_USER: haben
      POSTGRES_DB: haben
      POSTGRES_PASSWORD: \${DB_PASSWORD:?DB_PASSWORD fehlt in .env}
    volumes:
      - db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "haben"]
      interval: 5s
      retries: 20
      start_period: 10m

  app:
    image: ${prefix}/haben:${tag}
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    environment:
      DATABASE_URL: \${DATABASE_URL:-postgres://haben:\${DB_PASSWORD}@db:5432/haben}
      MIGRATION_DATABASE_URL: \${MIGRATION_DATABASE_URL:-}
      OIDC_ONLY: \${OIDC_ONLY:-false}
      OIDC_ISSUER: \${OIDC_ISSUER:-}
      OIDC_CLIENT_ID: \${OIDC_CLIENT_ID:-}
      OIDC_CLIENT_SECRET: \${OIDC_CLIENT_SECRET:-}
      OIDC_SCOPES: \${OIDC_SCOPES:-}
      OIDC_DISPLAY_NAME: \${OIDC_DISPLAY_NAME:-}
      OIDC_GROUPS_CLAIM: \${OIDC_GROUPS_CLAIM:-groups}
      OIDC_GROUP_INHABER: \${OIDC_GROUP_INHABER:-}
      OIDC_GROUP_STEUERBERATUNG: \${OIDC_GROUP_STEUERBERATUNG:-}
      BETTER_AUTH_URL: https://\${DOMAIN:?DOMAIN fehlt in .env}
      BETTER_AUTH_SECRET: \${AUTH_SECRET:?AUTH_SECRET fehlt in .env}
      HABEN_ENCRYPTION_KEY: \${ENCRYPTION_KEY:?ENCRYPTION_KEY fehlt in .env}
      ERIC_HOME: \${ERIC_HOME:-}
      ERIC_AUTO_INSTALL: \${ERIC_AUTO_INSTALL:-}
      ERIC_SHA256: \${ERIC_SHA256:-}
      ERIC_WORKER_COMMAND: \${ERIC_WORKER_COMMAND:-}
      ELSTER_HERSTELLER_ID: \${ELSTER_HERSTELLER_ID:-}
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
      EXTRACTION_PROVIDER: \${EXTRACTION_PROVIDER:-}
      EXTRACTION_BASE_URL: \${EXTRACTION_BASE_URL:-}
      EXTRACTION_MODEL: \${EXTRACTION_MODEL:-}
      EXTRACTION_API_KEY: \${EXTRACTION_API_KEY:-}
      EXTRACTION_TIMEOUT_SECONDS: \${EXTRACTION_TIMEOUT_SECONDS:-}
      EXTRACTION_MAX_PAGES: \${EXTRACTION_MAX_PAGES:-}
      EXTRACTION_INPUT: \${EXTRACTION_INPUT:-}
      EXTRACTION_EXTRA_BODY: \${EXTRACTION_EXTRA_BODY:-}
      LAYOUTS_MAX_COUNT: \${LAYOUTS_MAX_COUNT:-}
      LAYOUTS_MAX_MB: \${LAYOUTS_MAX_MB:-}
      LAYOUTS_PACKAGES_URL: \${LAYOUTS_PACKAGES_URL:-}
      ENABLE_BANKING_APP_ID: \${ENABLE_BANKING_APP_ID:-}
      ENABLE_BANKING_KEY_FILE: /run/secrets/enablebanking.pem
      HABEN_FIRMEN: \${HABEN_FIRMEN:-}
    volumes:
      - belege:/var/lib/haben/belege
      - eric-log:/var/lib/haben/eric-log
      - eric:/var/lib/haben/eric
${arm64Volume}${ollamaHosts}
  backup:
    <<: *backup
    restart: unless-stopped
    volumes:
      - belege:/belege:ro
      - backups:/backups
    healthcheck:
      test: ["CMD-SHELL", "s=/var/lib/haben-backup/status; [ ! -f $$s ] || { grep -q '^ok' $$s && [ -n \\"$$(find $$s -mmin -2880)\\" ]; }"]
      interval: 5m

  restore:
    <<: *backup
    profiles: [restore]
    entrypoint: ["restore.sh"]
    volumes:
      - belege:/belege
      - backups:/backups

  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on:
      - app
    ports:
      - "80:80"
      - "443:443"
    configs:
      - source: caddyfile
        target: /etc/caddy/Caddyfile
    volumes:
      - caddy:/data

configs:
  caddyfile:
    content: |
      \${DOMAIN} {
        encode zstd gzip
        header {
          Strict-Transport-Security "max-age=31536000; includeSubDomains"
          X-Content-Type-Options nosniff
          Referrer-Policy same-origin
          X-Frame-Options SAMEORIGIN
        }
        request_body {
          max_size 250MB
        }
        reverse_proxy app:3000
      }

volumes:
  db:
  belege:
  eric-log:
  eric:
  caddy:
  backups:
`;
  }

  /** Baut compose.override.yml für einen eigenen Reverse Proxy (Docker-Netz oder Host). */
  function buildOverrideFile(cfg) {
    if (cfg.proxyMode === "proxy-docker") {
      return `# Eigener Reverse Proxy in einem Docker-Netz (leitet an haben-app:3000 weiter)
services:
  caddy:
    profiles: [eigener-proxy]
  app:
    networks:
      default:
      proxy:
        aliases: [haben-app]

networks:
  proxy:
    external: true
    name: ${yamlScalar(cfg.proxyNetwork)}
`;
    }
    if (cfg.proxyMode === "proxy-host") {
      return `# Eigener Reverse Proxy direkt auf dem Server (leitet an 127.0.0.1:3000 weiter)
services:
  caddy:
    profiles: [eigener-proxy]
  app:
    ports:
      - "127.0.0.1:3000:3000"
`;
    }
    return "";
  }

  /** Baut die passenden Shell-Befehle für den ersten Start. */
  function buildStartCommands(cfg) {
    const lines = [
      "mkdir -p haben && cd haben",
      "# compose.yml und .env (sowie ggf. compose.override.yml) hier ablegen",
      "chmod 600 .env",
      "docker compose up -d --wait db",
      `docker compose exec db createuser -U haben --login --no-superuser --no-createdb --no-createrole --pwprompt haben_app`,
      `# Beim Passwort-Prompt dieses App-Passwort eingeben: ${cfg.appDbPassword}`,
      "docker compose up -d",
      "docker compose logs -f app",
    ];
    return `${lines.join("\n")}\n`;
  }

  /** Lädt eine generierte Textdatei im Browser herunter. */
  function downloadText(filename, content) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /** Kopiert Text in die Zwischenablage und zeigt kurzes Feedback am Button. */
  async function copyWithFeedback(button, text) {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Kopiert";
    } catch {
      button.textContent = "Kopieren fehlgeschlagen";
    }
    window.setTimeout(() => {
      button.textContent = original;
    }, 1600);
  }

  /** Schaltet bedingte Formularbereiche passend zur Auswahl sichtbar. */
  function updateVisibility(root) {
    const toggle = (id, show) => {
      const el = root.querySelector(`#${id}`);
      if (el) {
        el.classList.toggle("cg-hidden", !show);
      }
    };

    const proxyMode = root.querySelector('input[name="cg-proxy-mode"]:checked')?.value || "caddy";
    const imageTagChoice = root.querySelector("#cg-image-tag")?.value || "latest";
    const aiMode = root.querySelector("#cg-ai-mode")?.value || "none";
    const backupMode = root.querySelector("#cg-backup-mode")?.value || "local";
    const oidcOnly = Boolean(root.querySelector("#cg-oidc-only")?.checked);

    toggle("cg-proxy-network-wrap", proxyMode === "proxy-docker");
    toggle("cg-image-tag-custom-wrap", imageTagChoice === "custom");
    toggle("cg-ai-anthropic-wrap", aiMode === "anthropic");
    toggle("cg-ai-url-wrap", aiMode === "ollama" || aiMode === "openai");
    toggle("cg-ai-key-wrap", aiMode === "openai");

    const urlInput = root.querySelector("#cg-extraction-url");
    const modelInput = root.querySelector("#cg-extraction-model");
    if (urlInput && modelInput) {
      if (aiMode === "openai") {
        urlInput.placeholder = "https://openrouter.ai/api/v1";
        modelInput.placeholder = "qwen/qwen2.5-vl-72b-instruct";
      } else {
        urlInput.placeholder = "http://host.docker.internal:11434/v1";
        modelInput.placeholder = "qwen2.5vl:7b";
      }
    }
    toggle("cg-backup-repo-wrap", backupMode !== "local");
    toggle("cg-backup-s3-wrap", backupMode === "s3");
    toggle("cg-oidc-fields-wrap", oidcOnly);

    const overrideTab = root.querySelector('[data-cg-tab="override"]');
    if (overrideTab) {
      const hasOverride = proxyMode !== "caddy";
      overrideTab.hidden = !hasOverride;
      if (!hasOverride && overrideTab.getAttribute("aria-selected") === "true") {
        activateTab(root, "env");
      }
    }
  }

  function activateTab(root, tabName) {
    root.querySelectorAll("[data-cg-tab]").forEach((tab) => {
      const active = tab.getAttribute("data-cg-tab") === tabName;
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    root.querySelectorAll("[data-cg-panel]").forEach((panel) => {
      const active = panel.getAttribute("data-cg-panel") === tabName;
      panel.classList.toggle("cg-hidden", !active);
    });
  }

  function regenerateSecrets(root) {
    const setVal = (id, value) => {
      const el = root.querySelector(`#${id}`);
      if (el) {
        el.value = value;
      }
    };
    setVal("cg-db-password", randomHex(24));
    setVal("cg-app-db-password", randomHex(24));
    setVal("cg-auth-secret", randomBase64(32));
    setVal("cg-encryption-key", randomBase64(32));
    setVal("cg-restic-password", randomBase64(32));
  }

  function renderOutputs(root) {
    updateVisibility(root);
    const cfg = readConfig(root);
    const files = {
      env: buildEnvFile(cfg),
      compose: buildComposeFile(cfg),
      override: buildOverrideFile(cfg),
      commands: buildStartCommands(cfg),
    };

    const setCode = (id, text) => {
      const el = root.querySelector(`#${id}`);
      if (el) {
        el.textContent = text;
      }
    };
    setCode("cg-out-env", files.env);
    setCode("cg-out-compose", files.compose);
    setCode("cg-out-override", files.override);
    setCode("cg-out-commands", files.commands);

    const appPassEl = root.querySelector("#cg-step-app-password");
    if (appPassEl) {
      appPassEl.textContent = cfg.appDbPassword;
    }
    root._cgFiles = files;
  }

  function bindEvents(root) {
    root.addEventListener("input", () => renderOutputs(root));
    root.addEventListener("change", () => renderOutputs(root));

    root.querySelectorAll("[data-cg-tab]").forEach((tab) => {
      tab.addEventListener("click", () => activateTab(root, tab.getAttribute("data-cg-tab")));
    });

    root.querySelector("#cg-regen-all")?.addEventListener("click", () => {
      regenerateSecrets(root);
      renderOutputs(root);
    });

    root.querySelectorAll("[data-cg-copy]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-cg-copy");
        const text = root._cgFiles?.[key] || "";
        if (text) {
          copyWithFeedback(btn, text);
        }
      });
    });

    root.querySelectorAll("[data-cg-download]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-cg-download");
        const names = { env: ".env", compose: "compose.yml", override: "compose.override.yml" };
        const text = root._cgFiles?.[key] || "";
        if (text && names[key]) {
          downloadText(names[key], text);
        }
      });
    });

    root.querySelector("#cg-copy-app-pw")?.addEventListener("click", (ev) => {
      const pw = root.querySelector("#cg-app-db-password")?.value || "";
      if (pw) {
        copyWithFeedback(ev.currentTarget, pw);
      }
    });
  }

  /** Initialisiert den Generator auf der Seite, falls das Container-Element vorhanden ist. */
  function initComposeGenerator() {
    const root = document.getElementById("cg-app");
    if (!root || root.dataset.cgReady === "true") {
      return;
    }
    root.dataset.cgReady = "true";
    regenerateSecrets(root);
    bindEvents(root);
    renderOutputs(root);
  }

  window.initComposeGenerator = initComposeGenerator;

  if (typeof document$ !== "undefined" && document$?.subscribe) {
    document$.subscribe(() => initComposeGenerator());
  } else {
    document.addEventListener("DOMContentLoaded", initComposeGenerator);
  }
})();
