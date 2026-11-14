---
title: "Docker-Compose-Generator"
description: >-
  Erzeugt compose.yml, .env und passende Startbefehle für Haben direkt im Browser – mit
  automatisch generierten Schlüsseln und optionalem Reverse Proxy, ELSTER, KI und SSO.
hide:
  - toc
---

# Docker-Compose-Generator

Hier erstellst du `compose.yml`, `.env` und die passenden Startbefehle für deinen Server. Alle Passwörter und Schlüssel entstehen direkt in deinem Browser und verlassen dein Gerät nicht.

> [!IMPORTANT]
> **Schlüssel sichern:** Speichere `ENCRYPTION_KEY` und `RESTIC_PASSWORD` aus `.env` zusätzlich in deinem Passwortmanager. Ohne `ENCRYPTION_KEY` sind ELSTER-Zertifikat und API-Schlüssel nach einer Wiederherstellung verloren; ohne `RESTIC_PASSWORD` lässt sich kein Backup entschlüsseln.

<div id="cg-app" class="cg-layout">
  <form class="cg-panel" onsubmit="return false;">
    <fieldset class="cg-section">
      <div class="cg-section-title">1. Basis-Einrichtung</div>

      <div class="cg-field">
        <label for="cg-domain">Domain (ohne https://)</label>
        <input id="cg-domain" class="cg-input" type="text" value="haben.example.de" placeholder="haben.example.de" autocomplete="off">
        <span class="cg-hint">Muss auf deinen Server zeigen. Passkeys hängen an dieser Domain – später nicht mehr ändern.</span>
      </div>

      <div class="cg-grid-2">
        <div class="cg-field">
          <label for="cg-registry">Registry</label>
          <select id="cg-registry" class="cg-select">
            <option value="tristanteu" selected>Docker Hub (tristanteu)</option>
            <option value="ghcr">GitHub (ghcr.io/firsttris)</option>
          </select>
        </div>

        <div class="cg-field">
          <label for="cg-image-tag">Version (Image-Tag)</label>
          <select id="cg-image-tag" class="cg-select">
            <option value="latest" selected>latest (Empfohlen)</option>
            <option value="next">next (Release Candidate)</option>
            <option value="edge">edge (Entwicklungsstand)</option>
            <option value="custom">Feste Version (z. B. 1.2.3)</option>
          </select>
        </div>
      </div>

      <div id="cg-image-tag-custom-wrap" class="cg-field cg-hidden">
        <label for="cg-image-tag-custom">Fester Tag</label>
        <input id="cg-image-tag-custom" class="cg-input cg-input--mono" type="text" placeholder="1.2.3">
      </div>
    </fieldset>

    <fieldset class="cg-section">
      <div class="cg-section-title">2. HTTPS &amp; Reverse Proxy</div>
      <div class="cg-radio-group">
        <label class="cg-radio-card">
          <input type="radio" name="cg-proxy-mode" value="caddy" checked>
          <div>
            <strong>Eingebauter Caddy (Empfohlen)</strong>
            <span>Holt automatisch TLS-Zertifikate. Ports 80 und 443 müssen auf dem Server frei sein.</span>
          </div>
        </label>
        <label class="cg-radio-card">
          <input type="radio" name="cg-proxy-mode" value="proxy-docker">
          <div>
            <strong>Eigener Reverse Proxy im Docker-Netz</strong>
            <span>Für Traefik, Nginx Proxy Manager oder Caddy im Container; erzeugt zusätzlich <code>compose.override.yml</code>.</span>
          </div>
        </label>
        <label class="cg-radio-card">
          <input type="radio" name="cg-proxy-mode" value="proxy-host">
          <div>
            <strong>Eigener Reverse Proxy auf dem Host</strong>
            <span>Leitet von nginx oder Apache auf dem Server an <code>127.0.0.1:3000</code> weiter.</span>
          </div>
        </label>
      </div>

      <div id="cg-proxy-network-wrap" class="cg-field cg-hidden" style="margin-top: 0.75rem;">
        <label for="cg-proxy-network">Name des Proxy-Docker-Netzes</label>
        <input id="cg-proxy-network" class="cg-input cg-input--mono" type="text" value="proxy" placeholder="proxy">
        <span class="cg-hint">Den Namen zeigt <code>docker inspect DEIN_PROXY -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'</code>.</span>
      </div>
    </fieldset>

    <fieldset class="cg-section">
      <div class="cg-section-title">
        <span>3. Passwörter &amp; Schlüssel</span>
        <button id="cg-regen-all" type="button" class="cg-btn cg-btn--sm">Neu generieren</button>
      </div>

      <div class="cg-field">
        <label for="cg-db-password">DB_PASSWORD (Datenbank-Eigentümer)</label>
        <input id="cg-db-password" class="cg-input cg-input--mono" type="text" autocomplete="off">
      </div>
      <div class="cg-field">
        <label for="cg-app-db-password">App-Passwort für <code>haben_app</code> (in DATABASE_URL)</label>
        <input id="cg-app-db-password" class="cg-input cg-input--mono" type="text" autocomplete="off">
      </div>
      <div class="cg-field">
        <label for="cg-auth-secret">AUTH_SECRET</label>
        <input id="cg-auth-secret" class="cg-input cg-input--mono" type="text" autocomplete="off">
      </div>
      <div class="cg-field">
        <label for="cg-encryption-key">ENCRYPTION_KEY</label>
        <input id="cg-encryption-key" class="cg-input cg-input--mono" type="text" autocomplete="off">
      </div>
      <div class="cg-field">
        <label for="cg-restic-password">RESTIC_PASSWORD</label>
        <input id="cg-restic-password" class="cg-input cg-input--mono" type="text" autocomplete="off">
      </div>
    </fieldset>

    <fieldset class="cg-section">
      <div class="cg-section-title">4. Optionale Erweiterungen</div>

      <details class="cg-details">
        <summary>ELSTER (ERiC)</summary>
        <label class="cg-check">
          <input id="cg-eric-auto" type="checkbox">
          <span><strong>ERIC_AUTO_INSTALL=ja</strong> – ERiC beim Start automatisch von download.elster.de laden (Zustimmung zu den Nutzungsbedingungen von ERiC).</span>
        </label>
        <label class="cg-check">
          <input id="cg-arm64" type="checkbox">
          <span><strong>ARM64-Server (z. B. Raspberry Pi)</strong> – bindet <code>/opt/haben-x86_64</code> ein und setzt <code>ERIC_WORKER_COMMAND</code>.</span>
        </label>
      </details>

      <details class="cg-details">
        <summary>KI-Belegauslesung</summary>
        <div class="cg-field">
          <label for="cg-ai-mode">Anbieter</label>
          <select id="cg-ai-mode" class="cg-select">
            <option value="none" selected>Keine (Belege manuell erfassen)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="ollama">Lokales Modell auf dem Server (z. B. Ollama)</option>
            <option value="openai">OpenAI-kompatible Cloud (z. B. OpenRouter)</option>
          </select>
        </div>
        <div id="cg-ai-anthropic-wrap" class="cg-field cg-hidden">
          <label for="cg-anthropic-key">ANTHROPIC_API_KEY</label>
          <input id="cg-anthropic-key" class="cg-input cg-input--mono" type="password" placeholder="sk-ant-...">
        </div>
        <div id="cg-ai-url-wrap" class="cg-hidden">
          <div class="cg-field">
            <label for="cg-extraction-url">EXTRACTION_BASE_URL</label>
            <input id="cg-extraction-url" class="cg-input cg-input--mono" type="text" placeholder="http://host.docker.internal:11434/v1">
          </div>
          <div class="cg-field">
            <label for="cg-extraction-model">EXTRACTION_MODEL</label>
            <input id="cg-extraction-model" class="cg-input cg-input--mono" type="text" placeholder="qwen2.5vl:7b">
          </div>
        </div>
        <div id="cg-ai-key-wrap" class="cg-field cg-hidden">
          <label for="cg-extraction-key">EXTRACTION_API_KEY</label>
          <input id="cg-extraction-key" class="cg-input cg-input--mono" type="password" placeholder="sk-...">
        </div>
      </details>

      <details class="cg-details">
        <summary>Backup-Ziel &amp; Zeitplan</summary>
        <div class="cg-field">
          <label for="cg-backup-mode">Ziel für restic</label>
          <select id="cg-backup-mode" class="cg-select">
            <option value="local" selected>Lokales Volume (backups)</option>
            <option value="s3">S3-kompatibler Speicher</option>
            <option value="remote">SFTP oder restic REST-Server</option>
          </select>
        </div>
        <div id="cg-backup-repo-wrap" class="cg-field cg-hidden">
          <label for="cg-restic-repo">RESTIC_REPOSITORY</label>
          <input id="cg-restic-repo" class="cg-input cg-input--mono" type="text" placeholder="sftp:backup@example.de:/srv/restic/haben">
        </div>
        <div id="cg-backup-s3-wrap" class="cg-grid-2 cg-hidden">
          <div class="cg-field">
            <label for="cg-aws-key">AWS_ACCESS_KEY_ID</label>
            <input id="cg-aws-key" class="cg-input cg-input--mono" type="text">
          </div>
          <div class="cg-field">
            <label for="cg-aws-secret">AWS_SECRET_ACCESS_KEY</label>
            <input id="cg-aws-secret" class="cg-input cg-input--mono" type="password">
          </div>
        </div>
        <div class="cg-grid-2">
          <div class="cg-field">
            <label for="cg-backup-time">Uhrzeit (BACKUP_TIME)</label>
            <input id="cg-backup-time" class="cg-input cg-input--mono" type="text" value="03:15">
          </div>
          <div class="cg-field">
            <label for="cg-restore-days">Test-Restore alle … Tage</label>
            <input id="cg-restore-days" class="cg-input cg-input--mono" type="number" min="0" value="7">
          </div>
        </div>
      </details>

      <details class="cg-details">
        <summary>Single Sign-on (OpenID Connect)</summary>
        <label class="cg-check">
          <input id="cg-oidc-only" type="checkbox">
          <span><strong>OIDC_ONLY=true</strong> – Anmeldung ausschließlich über Authelia, Authentik oder Keycloak.</span>
        </label>
        <div id="cg-oidc-fields-wrap" class="cg-hidden">
          <div class="cg-field">
            <label for="cg-oidc-issuer">OIDC_ISSUER</label>
            <input id="cg-oidc-issuer" class="cg-input cg-input--mono" type="text" placeholder="https://auth.example.de">
          </div>
          <div class="cg-grid-2">
            <div class="cg-field">
              <label for="cg-oidc-client-id">OIDC_CLIENT_ID</label>
              <input id="cg-oidc-client-id" class="cg-input cg-input--mono" type="text" placeholder="haben">
            </div>
            <div class="cg-field">
              <label for="cg-oidc-client-secret">OIDC_CLIENT_SECRET</label>
              <input id="cg-oidc-client-secret" class="cg-input cg-input--mono" type="password">
            </div>
          </div>
          <div class="cg-grid-2">
            <div class="cg-field">
              <label for="cg-oidc-display-name">OIDC_DISPLAY_NAME</label>
              <input id="cg-oidc-display-name" class="cg-input" type="text" value="Authelia">
            </div>
            <div class="cg-field">
              <label for="cg-oidc-groups-claim">OIDC_GROUPS_CLAIM</label>
              <input id="cg-oidc-groups-claim" class="cg-input cg-input--mono" type="text" value="groups">
            </div>
          </div>
          <div class="cg-grid-2">
            <div class="cg-field">
              <label for="cg-oidc-group-inhaber">OIDC_GROUP_INHABER</label>
              <input id="cg-oidc-group-inhaber" class="cg-input cg-input--mono" type="text" value="haben-inhaber">
            </div>
            <div class="cg-field">
              <label for="cg-oidc-group-steuer">OIDC_GROUP_STEUERBERATUNG</label>
              <input id="cg-oidc-group-steuer" class="cg-input cg-input--mono" type="text" value="haben-steuerberatung">
            </div>
          </div>
        </div>
      </details>
    </fieldset>
  </form>

  <div class="cg-panel cg-output-sticky">
    <div class="cg-tabs" role="tablist" aria-label="Generierte Dateien">
      <button type="button" class="cg-tab" role="tab" aria-selected="true" data-cg-tab="env">.env</button>
      <button type="button" class="cg-tab" role="tab" aria-selected="false" data-cg-tab="compose">compose.yml</button>
      <button type="button" class="cg-tab" role="tab" aria-selected="false" data-cg-tab="override" hidden>compose.override.yml</button>
      <button type="button" class="cg-tab" role="tab" aria-selected="false" data-cg-tab="commands">Startbefehle</button>
    </div>

    <div data-cg-panel="env">
      <div class="cg-code-actions">
        <span class="cg-filename">.env</span>
        <div class="cg-code-actions-btns">
          <button type="button" class="cg-btn cg-btn--sm" data-cg-copy="env">Kopieren</button>
          <button type="button" class="cg-btn cg-btn--sm cg-btn--primary" data-cg-download="env">Herunterladen</button>
        </div>
      </div>
      <pre id="cg-out-env" class="cg-pre"></pre>
    </div>

    <div data-cg-panel="compose" class="cg-hidden">
      <div class="cg-code-actions">
        <span class="cg-filename">compose.yml</span>
        <div class="cg-code-actions-btns">
          <button type="button" class="cg-btn cg-btn--sm" data-cg-copy="compose">Kopieren</button>
          <button type="button" class="cg-btn cg-btn--sm cg-btn--primary" data-cg-download="compose">Herunterladen</button>
        </div>
      </div>
      <pre id="cg-out-compose" class="cg-pre"></pre>
    </div>

    <div data-cg-panel="override" class="cg-hidden">
      <div class="cg-code-actions">
        <span class="cg-filename">compose.override.yml</span>
        <div class="cg-code-actions-btns">
          <button type="button" class="cg-btn cg-btn--sm" data-cg-copy="override">Kopieren</button>
          <button type="button" class="cg-btn cg-btn--sm cg-btn--primary" data-cg-download="override">Herunterladen</button>
        </div>
      </div>
      <pre id="cg-out-override" class="cg-pre"></pre>
    </div>

    <div data-cg-panel="commands" class="cg-hidden">
      <div class="cg-code-actions">
        <span class="cg-filename">Erster Start im Terminal</span>
        <div class="cg-code-actions-btns">
          <button type="button" class="cg-btn cg-btn--sm" data-cg-copy="commands">Kopieren</button>
        </div>
      </div>
      <pre id="cg-out-commands" class="cg-pre"></pre>
    </div>

    <div class="cg-steps">
      <h3>Nächste Schritte</h3>
      <ol>
        <li>Dateien herunterladen und in einem Ordner <code>haben/</code> auf dem Server ablegen (Rechte der <code>.env</code> mit <code>chmod 600 .env</code> einschränken).</li>
        <li>Datenbank starten und einmalig die App-Rolle <code>haben_app</code> anlegen (Passwort: <code id="cg-step-app-password"></code> <button id="cg-copy-app-pw" type="button" class="cg-btn cg-btn--sm">Kopieren</button>).</li>
        <li>Mit <code>docker compose up -d</code> starten und mit <code>docker compose logs -f app</code> den Einrichtungscode ablesen.</li>
      </ol>
      <div class="cg-warning">
        Weitere Hinweise zu Firewall, Updates und Wiederherstellung stehen unter <a href="installation.html">Installation</a> und <a href="installation-backup.html">Backup und Updates</a>.
      </div>
    </div>
  </div>
</div>

<script>
if (typeof window.initComposeGenerator === "function") {
  window.initComposeGenerator();
}
</script>
