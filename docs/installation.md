---
title: "Installation mit Docker Compose oder Podman"
description: >-
  Haben selbst hosten: Installation mit Docker Compose oder Podman Quadlets, Image, eigener
  Reverse Proxy und mehrere Instanzen.
---

# Installation

Was du nach der Installation in der Oberfläche einrichtest, steht in [Erste Schritte](einrichtung.md).

## Überblick

Haben läuft als vier Container in einem eigenen Netz:

| Container (Compose / Quadlet) | Image | Aufgabe |
| --- | --- | --- |
| `db` / `haben-db` | `tristanteu/haben-db:latest` | Datenbank (`postgres:18`, hebt ältere Bestände beim Start selbst an, siehe [PostgreSQL-Update](installation-backup.md#postgresql-update)), Volume `db` bzw. `haben-db` |
| `app` / `haben-app` | `tristanteu/haben:latest` | Die App auf Port 3000, Belegdateien im Volume `belege` bzw. `haben-belege`, ERiC im Volume `eric` bzw. `haben-eric`, ERiC-Logs im Volume `eric-log` bzw. `haben-eric-log` |
| `backup` / `haben-backup` | `tristanteu/haben-backup:latest` | Tägliches Backup von Datenbank und Belegen mit restic, Repository im Volume `backups` bzw. `haben-backups` oder auf einem zweiten System, siehe [Backup und Wiederherstellen](installation-backup.md#backup-und-wiederherstellen) |
| `caddy` / `haben-caddy` | `caddy:2` | TLS und Reverse Proxy auf Port 80/443, Zertifikate im Volume `caddy` bzw. `haben-caddy`. Läuft bei dir schon ein Reverse Proxy, entfällt er, siehe [Eigener Reverse Proxy](#eigener-reverse-proxy) |

Es gibt zwei Wege, sie zu betreiben, dazu Vorlagen für [Synology](synology.md), [TrueNAS SCALE](truenas.md), [Unraid](unraid.md) und [Coolify](coolify.md):

| Weg | Gut für | Dateien |
| --- | --- | --- |
| [Docker Compose](#docker-compose) | Schnell startklar, Docker oder Podman mit Compose, tägliches Backup im Container | `deploy/compose.yml`, `deploy/compose.env.example` |
| [Podman Quadlets](#podman-quadlets) | Rootless unter systemd, Secrets statt Datei, täglicher Backup-Timer, `podman auto-update` | `deploy/quadlet/*`, `deploy/Caddyfile`, `deploy/haben.env.example` |

Beide holen die Dateien per `curl`; das Repository musst du nicht klonen.

Für den laufenden Betrieb gibt es eigene Seiten:

| Seite | Inhalt |
| --- | --- |
| <a id="getrennte-datenbankrollen"></a><a id="umgebungsvariablen"></a><a id="datenablage"></a>[Konfiguration](installation-konfiguration.md) | Getrennte Datenbankrollen, alle Umgebungsvariablen, wo Datenbank, Belege und ERiC liegen |
| <a id="backup-und-wiederherstellen"></a><a id="repository-auf-einem-zweiten-system"></a><a id="wiederherstellen"></a><a id="updates"></a><a id="postgresql-update"></a>[Backup und Updates](installation-backup.md) | Tägliches Backup, zweites System, Test-Restore, Wiederherstellen, Updates, PostgreSQL-Update |
| <a id="eric-einbinden"></a><a id="elster-auf-arm64"></a><a id="ki-auslesung-anthropic"></a><a id="ki-auslesung-über-openai-kompatible-schnittstelle"></a><a id="kontoabruf-enable-banking"></a><a id="lexware-office-api"></a>[Anbindungen](installation-anbindungen.md) | ERiC (auch auf arm64), KI-Auslesung mit Anthropic oder einem eigenen Dienst, Kontoabruf, Lexware-Office-API |
| <a id="single-sign-on-mit-openid-connect"></a>[Single Sign-on](installation-sso.md) | Anmeldung über OpenID Connect mit Rollen aus Gruppen |
| <a id="häufige-probleme"></a>[Häufige Probleme](installation-probleme.md) | Fehler beim Start, mit ERiC, Netz, Proxy und Anmeldung |

## Voraussetzungen

- Ein Linux-Server (x86_64, wenn du ERiC nutzen willst; auf arm64 geht ELSTER emuliert, siehe [ELSTER auf arm64](installation-anbindungen.md#elster-auf-arm64)) mit Docker und Compose 2.23 oder neuer, oder mit Podman und systemd. Die Quadlets sind für den Betrieb als normaler Nutzer (rootless) geschrieben, die Pfade nutzen `%h` bzw. `~/.config`.
- Eine Domain, die auf den Server zeigt, und erreichbare Ports 80 und 443. Caddy holt das TLS-Zertifikat selbst. Hast du schon einen Reverse Proxy (Apache, nginx, Nginx Proxy Manager, Traefik, HAProxy, Caddy), nutzt du den, siehe [Eigener Reverse Proxy](#eigener-reverse-proxy).
- HTTPS ist Pflicht: Passkeys und die Installation als App (PWA) funktionieren nur über eine sichere Verbindung.
- Für ELSTER ERiC für Linux x86_64; Haben lädt es auf Wunsch selbst herunter (siehe [ERiC einbinden](installation-anbindungen.md#eric-einbinden)). Auf arm64 (Raspberry Pi, Ampere, Jetson) zusätzlich ein statisches QEMU ab Version 9 und rund 750 MB Platz, siehe [ELSTER auf arm64](installation-anbindungen.md#elster-auf-arm64).

> [!NOTE]
> Nur Podman: Rootless Podman darf Ports unter 1024 standardmäßig nicht öffnen. Entweder du senkst die Grenze (`sysctl net.ipv4.ip_unprivileged_port_start=80`) oder du veröffentlichst Caddy auf anderen Ports und leitest weiter. Damit die Dienste ohne angemeldete Sitzung laufen, braucht der Nutzer außerdem `loginctl enable-linger`.

## Image

Das fertige Image gibt es für amd64 und arm64 auf Docker Hub und in der GitHub Container Registry:

| Image | Inhalt |
| --- | --- |
| `docker.io/tristanteu/haben:latest` | Letzte veröffentlichte Version (Standard in Compose und Quadlet) |
| `docker.io/tristanteu/haben:x.y` / `:x.y.z` | Feste Version, wenn du Updates selbst steuern willst |
| `docker.io/tristanteu/haben:next` | Neuester Release Candidate (`:x.y.z-rc.1` usw.) zum Testen, nur mit Backup |
| `docker.io/tristanteu/haben:edge` | Stand von `main`, nur zum Ausprobieren |
| `ghcr.io/firsttris/haben:…` | Dieselben Tags bei GitHub |
| `docker.io/tristanteu/haben-backup:…` / `ghcr.io/firsttris/haben-backup:…` | Backup-Container (`postgres:18` mit restic, `deploy/backup`), dieselben Tags wie die App |
| `docker.io/tristanteu/haben-db:…` / `ghcr.io/firsttris/haben-db:…` | Datenbank-Container (`postgres:18` mit `pg_upgrade` für ältere Bestände, `deploy/db`), dieselben Tags wie die App |

ERiC ist nicht enthalten, weil es nicht weitergegeben werden darf. Haben lädt es auf deinen Wunsch direkt von der Finanzverwaltung in das Volume `eric` (siehe [ERiC einbinden](installation-anbindungen.md#eric-einbinden)), oder du mountest es selbst. ERiC gibt es nur für Linux x86_64: Auf arm64 (z. B. Raspberry Pi) läuft alles außer der ELSTER-Übermittlung.

Selbst bauen geht auch, zum Beispiel für einen eigenen Stand. Dafür brauchst du das Repository; danach in `compose.yml` `image: haben` bzw. in `haben-app.container` `Image=localhost/haben:latest` eintragen:

```sh
git clone https://github.com/firsttris/haben.git && cd haben
podman build -t haben -f Containerfile .   # oder docker build
```

Das `Containerfile` baut die App in zwei Stufen: gebaut wird auf `oven/bun` (Debian, slim), die Laufzeit-Stufe ist [Wolfi](https://github.com/wolfi-dev) (`cgr.dev/chainguard/wolfi-base`) mit dem Bun aus der Build-Stufe. Wolfi nutzt glibc wie Debian, was ERiC voraussetzt, liefert aber aktuelle Versionen der Systempakete, vor allem von poppler, das jedes hochgeladene PDF liest. Node ist nicht im Image, ebenso keine Build-Werkzeuge wie Vite oder esbuild: Installiert sind nur die Laufzeitabhängigkeiten ohne Peer-Abhängigkeiten. Der Digest von `wolfi-base` ist im `Containerfile` festgehalten, damit ein Build nachvollziehbar bleibt; Renovate hebt ihn jede Woche an. Die Pakete kommen aus dem freien Wolfi-Repository `packages.wolfi.dev`; wer selbst baut, braucht von dort und von `cgr.dev` Zugriff.

Das Image läuft als Nutzer `bun` (ID 1000) und setzt diese Werte schon selbst: `NODE_ENV=production`, `PORT=3000`, `DOCUMENTS_DIR=/var/lib/haben/belege`, `ERIC_LOG_DIR=/var/lib/haben/eric-log`, `ERIC_DIR=/var/lib/haben/eric`, `ERIC_WORKER_PATH`, `HABEN_EINVOICE_DIR` und `XDG_CACHE_HOME=/tmp/.cache` (Cache der Schriften für `pdftoppm`).

`compose.yml` und `haben-app.container` starten die App gehärtet: Das Dateisystem des Containers ist schreibgeschützt, beschreibbar sind nur die Volumes unter `/var/lib/haben` und `/tmp` (tmpfs, beim Neustart leer). Dazu kommen keine Capabilities (`cap_drop: [ALL]` bzw. `DropCapability=ALL`) und `no-new-privileges`. Haben braucht nichts davon; ein Angreifer, der über eine Lücke Code im Container ausführt, kann so weder Programme im Image verändern noch sich höhere Rechte verschaffen. Schreibt etwas Eigenes außerhalb dieser Verzeichnisse, hängst du dafür ein Volume ein, statt den Schreibschutz abzuschalten.

## Docker Compose

```sh
mkdir haben && cd haben
curl -O https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.yml
curl -o .env https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.env.example
chmod 600 .env   # enthält Passwörter und Schlüssel, nur für dich lesbar
```

In `.env` trägst du ein:

| Variable | Inhalt |
| --- | --- |
| `DOMAIN` | Domain ohne `https://`, z. B. `haben.example.de`. Caddy holt dafür das Zertifikat, die App nutzt `https://DOMAIN` als `BETTER_AUTH_URL` |
| `DB_PASSWORD` | Datenbank-Passwort, nur Buchstaben und Ziffern, weil es in der Verbindungs-URL steht: `openssl rand -hex 24` |
| `DATABASE_URL` | App-Verbindung aus der Vorlage: `APP_PASSWORT_EINTRAGEN` durch ein zweites Passwort (`openssl rand -hex 24`) ersetzen |
| `MIGRATION_DATABASE_URL` | Eigentümerverbindung aus der Vorlage; `${DB_PASSWORD}` übernimmt Compose aus der Zeile darüber |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32`, zusätzlich an einem zweiten Ort sichern |
| `RESTIC_PASSWORD` | Verschlüsselt das Backup: `openssl rand -base64 32`, ebenfalls an einem zweiten Ort sichern |
| `RESTIC_REPOSITORY` | optional: Backup auf einem zweiten System statt im Volume `backups`, siehe [Backup und Wiederherstellen](installation-backup.md#backup-und-wiederherstellen) |
| `BACKUP_TIME`, `RESTORE_CHECK_DAYS`, `BACKUP_HOST`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | optional, siehe [Backup und Wiederherstellen](installation-backup.md#backup-und-wiederherstellen) |
| `ERIC_AUTO_INSTALL`, `ERIC_SHA256`, `ERIC_HOME`, `ELSTER_HERSTELLER_ID`, `ANTHROPIC_API_KEY`, `EXTRACTION_PROVIDER`, `EXTRACTION_BASE_URL`, `EXTRACTION_MODEL`, `EXTRACTION_API_KEY`, `EXTRACTION_TIMEOUT_SECONDS`, `EXTRACTION_MAX_PAGES`, `EXTRACTION_INPUT`, `EXTRACTION_EXTRA_BODY`, `ENABLE_BANKING_APP_ID`, `LAYOUTS_MAX_COUNT`, `LAYOUTS_MAX_MB`, `LAYOUTS_PACKAGES_URL`, `ERIC_WORKER_COMMAND` | optional, siehe [Umgebungsvariablen](installation-konfiguration.md#umgebungsvariablen) |
| `OIDC_ONLY`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`, `OIDC_DISPLAY_NAME`, `OIDC_GROUPS_CLAIM`, `OIDC_GROUP_INHABER`, `OIDC_GROUP_STEUERBERATUNG` | nur für den SSO-Modus, siehe [Single Sign-on mit OpenID Connect](installation-sso.md) |

```sh
docker compose up -d --wait db
docker compose exec db createuser -U haben --login --no-superuser --no-createdb --no-createrole --pwprompt haben_app
# Zweimal das App-Passwort aus DATABASE_URL eingeben; die Rolle nur einmal anlegen.
docker compose up -d
docker compose logs -f app   # „Migrationen angewendet“, „Einrichtungscode …“, dann „Listening on …“
```

Den Einrichtungscode aus dem Log brauchst du beim ersten Aufruf, um das Konto anzulegen (siehe [Konto anlegen](einrichtung.md#konto-anlegen)).

Die Caddy-Konfiguration steckt in `compose.yml` selbst (mit Sicherheits-Headern und Upload-Grenze wie im `Caddyfile`). Caddy nimmt Anfragen bis 250 MB an; das reicht für eine Archivdatei bis 100 MB oder ein gutes Dutzend Belege auf einmal. Größere Mengen lädst du in mehreren Schritten hoch oder erhöhst `max_size`. ERiC lädst du unter **Einstellungen › ELSTER › ERiC** herunter oder mit `ERIC_AUTO_INSTALL=ja` in `.env` beim Start, siehe [ERiC einbinden](installation-anbindungen.md#eric-einbinden).

Der Dienst `backup` sichert Datenbank und Belege jeden Tag um 03:15 Uhr, siehe [Backup und Wiederherstellen](installation-backup.md#backup-und-wiederherstellen).

**Updates:** `docker compose exec backup backup.sh && docker compose pull && docker compose up -d`. Migrationen laufen beim Start der App, siehe [Updates](installation-backup.md#updates).

## Podman Quadlets

Die Quadlets betreiben Haben rootless unter systemd: Zugangsdaten als Podman Secrets, ein täglicher Backup-Timer mit restic und Updates über `podman auto-update`.

### Dateien ablegen

```sh
RAW=https://raw.githubusercontent.com/firsttris/haben/main/deploy
mkdir -p ~/.config/containers/systemd ~/.config/systemd/user ~/.config/haben
for f in haben.network haben-db.volume haben-belege.volume haben-eric-log.volume haben-eric.volume haben-caddy.volume \
         haben-backups.volume haben-db.container haben-app.container haben-caddy.container haben-backup.container; do
  curl -o ~/.config/containers/systemd/$f "$RAW/quadlet/$f"
done
curl -o ~/.config/systemd/user/haben-backup.timer "$RAW/quadlet/haben-backup.timer"
curl -o ~/.config/haben/Caddyfile "$RAW/Caddyfile"
curl -o ~/.config/haben/haben.env "$RAW/haben.env.example"
touch ~/.config/haben/backup.env   # optional RESTIC_REPOSITORY, siehe Backup und Wiederherstellen
```

Die `.container`-, `.volume`- und `.network`-Dateien verarbeitet der Quadlet-Generator von Podman. `haben-backup.timer` ist eine gewöhnliche systemd-Unit und gehört deshalb nach `~/.config/systemd/user/`; er startet `haben-backup.service`, den der Generator aus `haben-backup.container` erzeugt.

### Secrets anlegen

Zugangsdaten liegen nicht in `haben.env`, sondern als Podman Secrets. Die Quadlets reichen sie als Umgebungsvariablen in die Container.

```sh
DBPW="$(openssl rand -hex 24)"
printf '%s' "$DBPW" | podman secret create haben-db-password -
printf 'postgres://haben:%s@haben-db:5432/haben' "$DBPW" | podman secret create haben-migration-database-url -
APPPW="$(systemd-ask-password 'Passwort der App-Datenbankrolle haben_app')"
printf 'postgres://haben_app:%s@haben-db:5432/haben' "$APPPW" | podman secret create haben-database-url -
unset DBPW APPPW
openssl rand -base64 32 | tr -d '\n' | podman secret create haben-auth-secret -
openssl rand -base64 32 | tr -d '\n' | podman secret create haben-encryption-key -
openssl rand -base64 32 | tr -d '\n' | podman secret create haben-restic-password -
```

| Secret | Variable im Container | Inhalt |
| --- | --- | --- |
| `haben-db-password` | `POSTGRES_PASSWORD` (in `haben-db`) | Passwort des Datenbanknutzers `haben` |
| `haben-database-url` | `DATABASE_URL` | App-Verbindung als `haben_app`, eigenes Passwort |
| `haben-migration-database-url` | `MIGRATION_DATABASE_URL` | Eigentümerverbindung als `haben`, Passwort wie `haben-db-password` |
| `haben-auth-secret` | `BETTER_AUTH_SECRET` | Signiert die Sitzungen |
| `haben-encryption-key` | `HABEN_ENCRYPTION_KEY` | Schlüssel für ELSTER-Zertifikat und die API-Schlüssel für Lexoffice und sevDesk |
| `haben-restic-password` | `RESTIC_PASSWORD` (in `haben-backup`) | Verschlüsselt das Backup |
| `haben-anthropic-key` (optional) | `ANTHROPIC_API_KEY` | Für die KI-Auslesung, siehe [KI-Auslesung (Anthropic)](installation-anbindungen.md#ki-auslesung-anthropic) |
| `haben-extraction-key` (optional) | `EXTRACTION_API_KEY` | Schlüssel eines eigenen KI-Dienstes, falls er einen verlangt, siehe [OpenAI-kompatible Schnittstelle](installation-anbindungen.md#ki-auslesung-über-openai-kompatible-schnittstelle) |
| `haben-oidc-client-secret` (optional) | `OIDC_CLIENT_SECRET` | Clientsecret für den SSO-Modus, siehe [Single Sign-on](installation-sso.md) |
| `haben-enablebanking-key` (optional) | Datei `/run/secrets/enablebanking.pem` | Privater Schlüssel für den Kontoabruf, siehe [Kontoabruf](installation-anbindungen.md#kontoabruf-enable-banking) |

> [!IMPORTANT]
> Sichere `HABEN_ENCRYPTION_KEY` getrennt vom Backup, zum Beispiel im Passwortmanager. Haben verschlüsselt damit das ELSTER-Zertifikat samt gespeicherter PIN, die Passwörter für SMTP und IMAP, Client Secret oder Zertifikatsschlüssel für Microsoft 365, den Schlüssel und die Sitzung des Bankabrufs und die API-Schlüssel für Lexoffice und sevDesk (AES-256-GCM). Ohne den Schlüssel sind sie nach einer Wiederherstellung nicht mehr lesbar. Das Backup sichert ihn nicht mit. Dasselbe gilt für das Passwort des Backups. Die Werte liest du aus mit `podman exec haben-app printenv HABEN_ENCRYPTION_KEY` (solange der Container läuft) und `podman secret inspect --showsecret haben-restic-password`.

### Konfiguration

In `~/.config/haben/haben.env` stehen die Werte, die nicht geheim sind. Mindestens die Domain anpassen:

```sh
BETTER_AUTH_URL=https://haben.example.de
```

Im `Caddyfile` dieselbe Domain eintragen (erste Zeile `haben.example.de {`). Was es sonst einstellt (Weiterleitung an `haben-app:3000`, Sicherheits-Header, Upload-Grenze), steht in [`deploy/Caddyfile`](https://github.com/firsttris/haben/blob/main/deploy/Caddyfile); `X-Frame-Options` bleibt dort `SAMEORIGIN`, nicht `DENY`, sonst bleiben die eingebetteten Vorschauen leer.

> [!NOTE]
> Leere Zeilen wie `ELSTER_HERSTELLER_ID=` gelten als nicht gesetzt. Trag die Hersteller-ID erst ein, wenn du sie hast; sie muss dann genau fünf Ziffern haben.

### Starten

In `haben-app.container` die vorbereitete Zeile `Secret=haben-migration-database-url,type=env,target=MIGRATION_DATABASE_URL` einkommentieren.

```sh
systemctl --user daemon-reload
systemctl --user start haben-db
podman exec -it haben-db createuser -U haben --login --no-superuser --no-createdb --no-createrole --pwprompt haben_app
# Zweimal dasselbe App-Passwort wie für haben-database-url eingeben; nur einmal anlegen.
systemctl --user start haben-app haben-caddy
systemctl --user enable --now haben-backup.timer
```

Die Container-Units starten über `[Install] WantedBy=default.target` beim nächsten Boot von selbst, sobald `daemon-reload` gelaufen ist. Logs liest du mit `journalctl --user -u haben-app` (bzw. `haben-db`, `haben-caddy`).

Danach rufst du die Domain im Browser auf und legst das Konto an, siehe [Erste Schritte](einrichtung.md). Den Einrichtungscode dafür zeigt `journalctl --user -u haben-app`.

## Eigener Reverse Proxy

Läuft auf dem Server schon ein Reverse Proxy, etwa Apache, nginx, Nginx Proxy Manager, Traefik, HAProxy oder Caddy, braucht Haben keinen eigenen. Dein Proxy leitet die Domain an die App auf Port 3000 weiter. Er muss:

- HTTPS für die Domain bereitstellen. Die Domain ist dieselbe wie `DOMAIN` in `.env` bzw. `BETTER_AUTH_URL`; sonst funktionieren Passkeys nicht.
- die ganze Domain oder Subdomain an Haben geben. Unter einem Unterpfad wie `example.de/haben` läuft Haben nicht: Die Seite lädt ihre Skripte von `/assets/…` und leitet auf `/login` um, jeweils ab der Wurzel der Domain.
- an `haben-app:3000` weiterleiten (Proxy im selben Container-Netz) oder an `127.0.0.1:3000` (Proxy direkt auf dem Host).
- Anfragen bis 250 MB annehmen (Archivdateien bis 100 MB, mehrere Belege auf einmal), auch auf einer langsamen Leitung.
- bis zu 300 Sekunden auf eine Antwort warten. Eine Übermittlung an ELSTER wartet in der Anfrage auf ERiC, und ein Lauf darf bis zu 120 Sekunden dauern. Die Belegerkennung läuft dagegen im Hintergrund. Der Standard liegt bei nginx und Apache bei 60 Sekunden (im Apache-Paket von Debian bei 300), bei Nginx Proxy Manager bei 90; danach sieht der Browser einen Fehler 502 oder 504.
- `X-Forwarded-For` mit genau einer Adresse setzen, der des Clients. Haben begrenzt Anmeldeversuche je Client-Adresse; ohne den Header zählen alle Anfragen als eine Adresse. Apache, Caddy, Nginx Proxy Manager und Traefik setzen ihn von selbst, bei nginx und HAProxy trägst du ihn ein.
- die Sicherheits-Header setzen wie in den Beispielen: HSTS, `X-Content-Type-Options`, `Referrer-Policy` und `X-Frame-Options: SAMEORIGIN` (nicht `DENY`, sonst bleiben die eingebetteten Vorschauen leer). Haben setzt nur `Content-Security-Policy: frame-ancestors 'self'` selbst.

Port 3000 der App gehört nicht ins Internet: Dort könnte jeder `X-Forwarded-For` fälschen, und es gäbe kein HTTPS.

### Compose

Neben `compose.yml` eine `compose.override.yml` ablegen; Compose liest sie automatisch mit, `compose.yml` bleibt unverändert und lässt sich bei Updates neu herunterladen:

```sh
curl -o compose.override.yml https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.override.example.yml
```

Darin `DEIN_PROXY_NETZ` durch das Netz deines Proxy-Containers ersetzen. Das zeigt:

```sh
docker inspect DEIN_PROXY_CONTAINER -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

Die Datei startet den mitgelieferten Caddy nicht mehr und hängt die App zusätzlich in dieses Netz, dort heißt sie `haben-app`. `docker compose up -d` startet dann alles außer Caddy.

Läuft dein Proxy direkt auf dem Host statt in einem Container, nimmst du die Variante, die am Ende der Datei auskommentiert steht: Sie veröffentlicht die App nur auf `127.0.0.1:3000`, dorthin leitest du weiter.

### Quadlets

`haben-caddy.container`, `haben-caddy.volume` und das `Caddyfile` nicht ablegen und nur `haben-db` und `haben-app` starten. Die App hängt im Netz `haben`:

- Proxy als Podman-Container: ihn zusätzlich in das Netz `haben` hängen. In seiner Quadlet-Datei eine weitere Zeile `Network=haben.network`, sonst `podman network connect haben DEIN_PROXY_CONTAINER`. Weiterleiten an `haben-app:3000`.
- Proxy auf dem Host: in `haben-app.container` die Zeile `PublishPort=127.0.0.1:3000:3000` ergänzen und an `127.0.0.1:3000` weiterleiten.

### Beispiele

Getestet sind die Beispiele mit Apache 2.4, nginx 1.30, Nginx Proxy Manager 2.16, Traefik 3.7, HAProxy 3.4 und Caddy 2.11: Anmeldung, Upload von 200 MB, langsamer Upload, lange Antwort, Anfragen von fremden Seiten.

**Apache:** Braucht die Module `proxy`, `proxy_http`, `headers` und `ssl` (Debian und Ubuntu: `a2enmod proxy proxy_http headers ssl`). Das Beispiel gilt für Apache direkt auf dem Host, die App ist dafür auf `127.0.0.1:3000` veröffentlicht, siehe [Compose](#compose):

```apache
<VirtualHost *:80>
    ServerName haben.example.de
    Redirect permanent / https://haben.example.de/
</VirtualHost>

<VirtualHost *:443>
    ServerName haben.example.de
    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/haben.example.de/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/haben.example.de/privkey.pem

    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
    Header always set X-Content-Type-Options nosniff
    Header always set Referrer-Policy same-origin
    Header always set X-Frame-Options SAMEORIGIN

    ProxyPreserveHost On
    # Ohne die Zeile gilt Timeout: 60 Sekunden, im Debian-Paket 300
    ProxyTimeout 300
    RequestHeader set X-Forwarded-Proto "https"
    # Apache hängt die Client-Adresse an; ein mitgeschickter Wert soll nicht davorstehen
    RequestHeader unset X-Forwarded-For
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
</VirtualHost>
```

**Caddy:** Den Block aus [`deploy/Caddyfile`](https://github.com/firsttris/haben/blob/main/deploy/Caddyfile) in dein Caddyfile übernehmen, mit deiner Domain (bei Caddy direkt auf dem Host `reverse_proxy 127.0.0.1:3000`), und `caddy reload` ausführen.

**nginx:** Zertifikat wie für deine anderen Seiten (etwa certbot). Wichtig sind `client_max_body_size` (Standard ist 1 MB) und die `proxy_set_header`-Zeilen:

```nginx
server {
    listen 443 ssl;
    server_name haben.example.de;
    ssl_certificate     /etc/letsencrypt/live/haben.example.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/haben.example.de/privkey.pem;

    client_max_body_size 250M;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy same-origin always;
    add_header X-Frame-Options SAMEORIGIN always;

    location / {
        proxy_pass http://haben-app:3000;
        proxy_set_header Host $host;
        # Nur die echte Client-Adresse: $proxy_add_x_forwarded_for hängt an, was der Client mitschickt
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

nginx löst `haben-app` beim Start einmal auf: Läuft die App dann nicht, startet nginx gar nicht, und bekommt sie nach einem Update eine neue Adresse, antwortet nginx mit 502 bis zum nächsten `nginx -s reload`. Läuft nginx selbst als Container, löst du den Namen deshalb zur Laufzeit auf. Dafür ersetzt du die Zeile `proxy_pass` durch:

```nginx
resolver 127.0.0.11 valid=10s;
set $haben http://haben-app:3000;
proxy_pass $haben;
```

**Mehrere Adressen in `X-Forwarded-For`:** Haben wertet den Header nur aus, wenn genau eine Adresse darin steht. Bei mehreren zählen alle diese Anfragen zusammen als ein Client. Einen Proxy, der an einen vom Client mitgeschickten Wert anhängt (`$proxy_add_x_forwarded_for`, `option forwardfor`), umgeht also niemand; wer den Header fälscht, landet in diesem gemeinsamen Zähler. Wichtig wird das bei zwei Proxys hintereinander, etwa einem CDN vor nginx: Reicht der innere die ganze Kette weiter, teilen sich alle Nutzer den Zähler, und die Anmeldung meldet schon nach wenigen Versuchen zu viele Anfragen. Der innere Proxy setzt dann die echte Client-Adresse als einzigen Wert.

**Nginx Proxy Manager:** Neuer Proxy Host mit deiner Domain, Scheme `http`, Forward Hostname `haben-app`, Forward Port `3000`. Unter SSL ein Let's-Encrypt-Zertifikat anfordern und „Force SSL“ und „HSTS“ einschalten, unter Advanced diese Zeilen eintragen:

```nginx
proxy_read_timeout 300s;
more_set_headers "X-Content-Type-Options: nosniff";
more_set_headers "Referrer-Policy: same-origin";
more_set_headers "X-Frame-Options: SAMEORIGIN";
```

`add_header` wirkt hier nicht: Nginx Proxy Manager setzt in der Location eigene Header, und dann erbt sie keine aus dem Server-Block. Uploads nimmt Nginx Proxy Manager von sich aus bis 2 GB an. Sein HSTS-Header enthält `preload`.

**Traefik:** Router für die Domain mit TLS auf den Service `haben-app:3000`. Traefik begrenzt die Größe von Anfragen nur mit der Middleware `buffering` (`maxRequestBodyBytes`); nutzt du sie, dann mit mindestens 250 MB. Wichtig ist das Zeitlimit des Entrypoints in der statischen Konfiguration: Standard sind 60 Sekunden für die ganze Anfrage, ein längerer Upload bricht mit 502 ab.

```yaml
# traefik.yml
entryPoints:
  websecure:
    address: ":443"
    transport:
      respondingTimeouts:
        readTimeout: 600s
```

Die Sicherheits-Header setzt eine Middleware in der dynamischen Konfiguration, die du am Router einträgst:

```yaml
http:
  middlewares:
    haben-sicherheit:
      headers:
        stsSeconds: 31536000
        stsIncludeSubdomains: true
        contentTypeNosniff: true
        referrerPolicy: same-origin
        customFrameOptionsValue: SAMEORIGIN
```

**HAProxy:** `crt` zeigt auf eine Datei mit Zertifikat und Schlüssel. `option forwardfor` hängt nur an, deshalb setzt das Beispiel den Header selbst. `resolvers` und `init-addr none` braucht es nur, wenn HAProxy im Container läuft: Ohne sie bricht er ab, wenn die App beim Start nicht läuft. Auf dem Host steht in der Zeile `server` nur `127.0.0.1:3000`.

```
resolvers docker
    nameserver dns 127.0.0.11:53

defaults
    mode http
    timeout connect 5s
    timeout client 60s
    timeout server 300s

frontend haben
    bind :443 ssl crt /etc/haproxy/certs/haben.pem alpn h2,http/1.1
    http-request set-header X-Forwarded-For %[src]
    http-request set-header X-Forwarded-Proto https
    http-response set-header Strict-Transport-Security "max-age=31536000; includeSubDomains"
    http-response set-header X-Content-Type-Options nosniff
    http-response set-header Referrer-Policy same-origin
    http-response set-header X-Frame-Options SAMEORIGIN
    default_backend haben-app

backend haben-app
    server app haben-app:3000 resolvers docker init-addr none
```

## Mehrere Instanzen

Haben führt genau eine Buchhaltung: ein Unternehmen, im Standardmodus ein Inhaber (im [SSO-Modus](installation-sso.md) auch mehrere), auf Wunsch mit einem [Zugang für die Steuerberatung](steuerberatung.md), der nur lesen kann. Für ein zweites Gewerbe, für Partner oder Familie betreibst du je eine eigene Instanz. Jede hat ihre eigene Datenbank, eigene Belege, eigene Schlüssel und ein eigenes ELSTER-Zertifikat; sichern, umziehen und löschen lässt sich jede für sich. Am einfachsten geht das mit Compose, je Instanz ein Verzeichnis, alle hinter einem gemeinsamen Reverse Proxy. In welcher Instanz du gerade bist, zeigt die Navigation mit dem Namen aus den [Firmendaten](einrichtung.md#firmendaten).

Damit du die Instanzen in der Oberfläche auseinanderhältst, gib jeder ein eigenes [Zeichen in der Navigation](einrichtung.md#zeichen-in-der-navigation), etwa eine eigene Farbe.

### Mit dem Werkzeug

`deploy/instanzen/haben-instanzen.ts` legt Instanzen an, aktualisiert alle nacheinander und zeigt ihren Stand. Es läuft mit [Bun](https://bun.com) direkt aus einem Checkout des Repositorys, ohne `bun install` und ohne Build, und braucht dazu Docker mit Compose 2.23 oder neuer. Die Vorlagen (`compose.yml`, `compose.env.example`) nimmt es aus `deploy/` im Checkout:

```sh
git clone --depth 1 https://github.com/firsttris/haben.git ~/haben-werkzeug
cd ~/haben-werkzeug
bun deploy/instanzen/haben-instanzen.ts neu firma1 firma1.example.de
bun deploy/instanzen/haben-instanzen.ts neu firma2 firma2.example.de
```

Das Werkzeug selbst aktualisierst du mit `git pull` im Checkout; die Instanzen aktualisiert danach `update`. Eine neue Vorlage übernimmt `update` nicht: Die `compose.yml` jeder Instanz bleibt, wie sie beim Anlegen war, bis du sie aus `deploy/` neu kopierst.

Danach liegt unter `~/haben` (anders mit `--basis` oder `HABEN_INSTANZEN`):

```
~/haben/
  proxy/                   # gemeinsamer Caddy für alle Instanzen
    compose.yml
    Caddyfile              # import sites/*.caddy
    sites/firma1.caddy     # eine Datei je Domain
  firma1/
    compose.yml            # unverändert aus deploy/
    compose.override.yml   # eigener Caddy aus, App im Netz haben-proxy als haben-firma1
    .env                   # eigene Schlüssel, Rechte 600
  firma2/
    …
```

| Befehl | Was es tut |
| --- | --- |
| `neu <name> <domain>` | Verzeichnis, `.env` mit eigenen Zufallswerten für `DB_PASSWORD`, das Passwort der App-Rolle in `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY` und `RESTIC_PASSWORD`, dazu `COMPOSE_PROJECT_NAME=haben-<name>` und `BACKUP_HOST=haben-<name>`, die Override-Datei und der Eintrag im gemeinsamen Caddy. Startet den Proxy, dann die Datenbank, legt die App-Rolle `haben_app` an ([Getrennte Datenbankrollen](installation-konfiguration.md#getrennte-datenbankrollen)), startet die App und nennt den Einrichtungscode. Gibt es das Verzeichnis oder das Compose-Projekt `haben-<name>` schon (auch nur noch seine Volumes) oder gehört die Domain einer anderen Instanz oder einem übrig gebliebenen Eintrag in `proxy/sites/`, bricht es ab und ändert nichts; ebenso, wenn docker nicht antwortet. Der Name besteht aus a–z, 0–9 und `-`; `proxy`, `app` und Namen auf `app-1`, `db-1` o. Ä. sind vergeben |
| `update` | Je Instanz der Reihe nach: Backup, `docker compose pull`, `up -d`, warten, bis die App gesund ist. Schlägt ein Schritt fehl, etwa eine Migration, hält es an, nennt die Instanz und lässt die folgenden unverändert. Gestoppte Instanzen überspringt es und nennt sie am Ende; startet eine App ständig neu oder meldet Compose für eine Instanz einen Fehler, hält es dort an. Die Instanz, an der es anhält, bleibt, wie sie ist; zurück kommst du mit dem Backup, das `update` davor angelegt hat, siehe [Update zurücknehmen](installation-backup.md#update-zurücknehmen) |
| `status` | Je Instanz Version, Erreichbarkeit unter `https://<domain>/login`, ERiC-Version und letzte erfolgreiche Sicherung. Version, ERiC und Sicherung meldet die App selbst über `docker compose exec -T app haben status --json`; ein Image von vor diesem Befehl steht als „? (Image zu alt)“ in der Liste. Eine gestoppte Instanz steht als „gestoppt“ da, eine App, die ständig neu startet, als „startet neu“. Skripte lesen `haben status --json`; das Feld `schema` (derzeit `1`) steigt, wenn ein Feld entfällt oder seine Bedeutung ändert |
| `liste` | Name, Domain und Verzeichnis |

Das Werkzeug liest die Werte jeder Instanz nur aus ihrer `.env`: In der Shell gesetzte Variablen wie `COMPOSE_PROJECT_NAME`, `COMPOSE_FILE`, `DOMAIN` oder `ENCRYPTION_KEY` reicht es nicht an `docker compose` weiter. Wer eine Instanz löscht, entfernt auch ihre Datei in `proxy/sites/`.

`update` und `status` erfassen auch Instanzen, die du vorher von Hand nach dem Muster unten angelegt hast: Verzeichnisse `haben-…` unter der Basis mit gleichnamigem `COMPOSE_PROJECT_NAME`.

Optionen für `neu`:

| Option | Wirkung |
| --- | --- |
| `--hersteller-id ID` | setzt `ELSTER_HERSTELLER_ID` (fünf Ziffern). Ohne die Option bleibt sie leer; das Werkzeug trägt nie von sich aus eine ID ein |
| `--eric-home PFAD` | bindet ein von Hand entpacktes ERiC lesend ein und setzt `ERIC_HOME`; so teilen sich die Instanzen ein Paket statt je rund 300 MB, siehe [ERiC einbinden](installation-anbindungen.md#eric-einbinden). Ob ein gemeinsames ERiC als Weitergabe gilt, wenn du Instanzen [für andere betreibst](#für-andere-betreiben), ist nicht geklärt |
| `--eigener-proxy` | kein gemeinsamer Caddy: legt nur das Netz `haben-proxy` an und gibt den Block für deinen Proxy aus. Hänge den Proxy-Container in dieses Netz (`docker network connect haben-proxy <proxy>`) und leite an `haben-<name>:3000` weiter, siehe [Eigener Reverse Proxy](#eigener-reverse-proxy) |
| `--sso --oidc-issuer URL --oidc-client-id ID` | ausschließlich [Single Sign-on](installation-sso.md), mit Gruppen nur für diese Instanz (siehe unten); `--oidc-name` setzt den Anzeigenamen (Vorgabe Authelia). Dazu das Clientsecret aus genau einer Quelle (nächste Zeile) |
| `--oidc-client-secret-file PFAD` oder `--oidc-client-secret-stdin` | das Clientsecret für `--sso`: aus einer Datei, die nur du lesen kannst, oder von der Standardeingabe (`pass show haben/firma1 \| bun … --oidc-client-secret-stdin`); ohne Pipe fragt das Werkzeug am Terminal danach und zeigt die Eingabe nicht an. Ein Zeilenumbruch am Ende zählt nicht dazu. Als Argument gibt es das Secret nicht: Es stünde in der Prozessliste und in der Shell-Historie |
| `--nicht-starten` | legt nur die Dateien an, etwa um `.env` vor dem Start zu ergänzen. Den ersten Start machst du dann selbst: gemeinsamer Caddy bzw. Netz `haben-proxy`, Datenbank, App-Rolle, App; das Werkzeug nennt die Befehle, ebenso, wenn `neu` abbricht, bevor es die Rolle gibt |

`ENCRYPTION_KEY` und `RESTIC_PASSWORD` jeder Instanz sicherst du wie bei einer einzelnen zusätzlich an einem zweiten Ort; ohne sie sind Zertifikat, Zugangsdaten und Backup nach einem Verlust des Servers nicht mehr zu öffnen. Weitere Einstellungen (Backup auf einem zweiten System, KI-Auslesung, Kontoabruf) trägst du danach in die `.env` der Instanz ein und startest sie mit `docker compose up -d` in ihrem Verzeichnis neu.

**Mit SSO:** Jede Instanz ist ein eigener Client beim Anmeldedienst und bekommt eigene Gruppen, `haben-<name>-inhaber` und `haben-<name>-steuerberatung`. Teilen sich Instanzen einen Anmeldedienst und dieselben Gruppennamen, wäre jedes Mitglied der Inhaber-Gruppe Inhaber in allen Firmen. Das Werkzeug nennt nach `neu` die Gruppen und die Redirect-URI `https://<domain>/api/auth/callback/oidc`; den Client legst du wie unter [Authelia konfigurieren](installation-sso.md#authelia-konfigurieren) an, je Instanz mit eigener `client_id` und eigenem Secret. Wer in mehreren Firmen arbeitet, ist Mitglied in den Gruppen jeder dieser Firmen und meldet sich beim Anmeldedienst nur einmal an.

### Von Hand

Ohne Werkzeug legst du dieselben Dateien selbst an:

```
haben-firma1/
  compose.yml              # unverändert aus deploy/
  compose.override.yml     # aus deploy/compose.override.example.yml
  .env
haben-firma2/
  …
```

Je Instanz unterscheiden sich drei Dinge:

| Wo | Was | Beispiel |
| --- | --- | --- |
| `.env` | `COMPOSE_PROJECT_NAME`: trennt Container, Netz und Volumes der Instanzen (Vorrang vor `name: haben` in `compose.yml`) | `COMPOSE_PROJECT_NAME=haben-firma1` |
| `.env` | eigene `DOMAIN`, eigenes `DB_PASSWORD`, eigene Schlüssel (`AUTH_SECRET`, `ENCRYPTION_KEY`) | `DOMAIN=firma1.example.de` |
| `compose.override.yml` | eigener Name im Netz des Proxys: den Alias `haben-app` ersetzen | `aliases: [haben-firma1]` |

Der mitgelieferte Caddy belegt Port 80 und 443 und kann deshalb nur einmal laufen. Mit mehreren Instanzen nutzt jede die `compose.override.yml` aus [Eigener Reverse Proxy](#eigener-reverse-proxy), und ein gemeinsamer Proxy verteilt die Subdomains, etwa mit Caddy:

```
firma1.example.de {
	request_body {
		max_size 250MB
	}
	reverse_proxy haben-firma1:3000
}
firma2.example.de {
	request_body {
		max_size 250MB
	}
	reverse_proxy haben-firma2:3000
}
```

(Header wie im Beispiel unter [Eigener Reverse Proxy](#beispiele).) Starten, aktualisieren und sichern machst du im Verzeichnis der jeweiligen Instanz wie oben unter [Docker Compose](#docker-compose); die Volumes heißen dann `haben-firma1_belege` usw. statt `haben_belege`. Jede Instanz hat ihren eigenen Dienst `backup`. Teilen sich mehrere Instanzen ein restic-Repository, braucht jede in `.env` ein eigenes `BACKUP_HOST` (z. B. `BACKUP_HOST=haben-firma1`), sonst räumt das Aufräumen der einen die Stände der anderen ab und `restore latest` nimmt den falschen Stand.

### Weitere Punkte

- **ERiC** lädt jede Instanz einzeln (rund 300 MB). Wer Platz sparen will, entpackt es einmal nach `/opt/eric` und bindet es überall mit `ERIC_HOME` ein, siehe [ERiC einbinden](installation-anbindungen.md#eric-einbinden); mit dem Werkzeug über `--eric-home /opt/eric`.
- **Hersteller-ID:** Für deine eigenen Instanzen nimmst du dieselbe ID. Betreibst du eine Instanz für jemand anderen, kommen Pflichten dazu, siehe [Für andere betreiben](#für-andere-betreiben).
- **Quadlets** sind auf eine Instanz ausgelegt (feste Namen wie `haben-app`). Für mehrere Instanzen ist Compose einfacher.

Eine Instanz mit mehreren Mandanten gibt es bewusst nicht: Eine gemeinsame Datenbank würde jede Abfrage, die GoBD-Trigger, die Belegablage und das Backup um eine Mandantentrennung erweitern, und ein Fehler darin legte fremde Buchhaltungsdaten offen.

### Firma wechseln

Mit `HABEN_FIRMEN` kennt jede Instanz die übrigen: In der Navigation stehen unten unter **Firma wechseln** die anderen als Links; unter „Haben“ steht wie immer der Name aus den [Firmendaten](einrichtung.md#firmendaten) der Firma, in der du gerade arbeitest. Ein Klick öffnet die Instanz der anderen Firma unter ihrer eigenen Adresse; Daten wandern dabei nicht, jede Instanz hat ihre eigene Anmeldung. Mit [SSO](installation-sso.md) bist du dort meist sofort angemeldet, sonst meldest du dich einmal je Firma an (Passkeys gelten je Domain).

```dotenv
HABEN_FIRMEN='Studio Nord|https://nord.example.de;Werkstatt Süd|https://werkstatt.example.de'
```

Je Firma `Name|Adresse`, getrennt durch `;`, in der `.env` jeder Instanz dieselbe Liste samt ihr selbst; die eigene erkennt Haben an `DOMAIN` bzw. `BETTER_AUTH_URL`. Erlaubt sind nur `https://` mit Domain ohne Pfad (`http://` nur für `localhost`), Namen bis 60 Zeichen, jede Adresse und jeder Name einmal, höchstens 50 Firmen; sonst startet die App nicht und nennt den Fehler im Log. Nach einer Änderung startest du die App jeder Instanz neu (`docker compose up -d`). Die Liste zum Wechseln sieht nur der Inhaber; der [Zugang für die Steuerberatung](steuerberatung.md) sieht nur den Namen der eigenen Firma, nicht welche anderen es gibt.

### Für andere betreiben

Betreibst du Haben nicht nur für dich, sondern für andere, etwa als gehostete Instanz für Kunden, bist du nicht mehr nur Nutzer. Haben ist dafür gebaut, dass jeder seine Buchhaltung selbst betreibt; für andere übernimmst du Pflichten, die bei einer eigenen Instanz nicht anfallen. Diese Liste ist keine Rechtsberatung: Lass Vertrag, AGB und Auftragsverarbeitung von einer Anwältin oder einem Anwalt für IT- und Steuerrecht prüfen, bevor du anbietest.

- **Softwarehersteller nach der ERiC-Lizenz.** Mit deiner Hersteller-ID bist du für deine Kunden Hersteller im Sinne des ERiC-Lizenzvertrags (`lizenz.pdf` im ERiC-Paket): Du leistest den Support (§ 7), hältst die Mindestversion von ERiC ein (§ 5), und jeder Nutzer bestätigt vor der ersten Nutzung die Datenschutzhinweise der Finanzverwaltung (§ 5). Bei Verstößen kann das Landesamt die ID sperren (§ 9); dann sendet keine Instanz mehr, die sie trägt, auch deine eigene nicht. Hast du Haben verändert, brauchst du eine eigene ID (§ 4). Mehr unter [Hersteller-ID: wer ist Hersteller?](einrichtung-elster.md#hersteller-id-wer-ist-hersteller).
- **Auftragsverarbeiter nach DSGVO.** In einer Buchhaltung stehen Namen, Anschriften, Bankverbindungen, Steuernummern und Umsätze von Kunden und Lieferanten. Wer sie für andere hostet, verarbeitet sie in deren Auftrag und braucht mit jedem Kunden einen Vertrag nach Art. 28 DSGVO mit den technischen und organisatorischen Maßnahmen (Art. 32 DSGVO): Verschlüsselung, Backups, Zugriff, Löschung. Dasselbe gilt für Dienste, die du dazuschaltest, etwa die [KI-Auslesung](installation-anbindungen.md#ki-auslesung-anthropic) bei einem Cloud-Anbieter; sie sind dann deine Unterauftragsverarbeiter.
- **Jeder sendet mit seinem eigenen Zertifikat.** Haben übermittelt mit dem ELSTER-Zertifikat, das in der Instanz hinterlegt ist. Bleibt es das Zertifikat des Kunden, sendet er selbst. Sendest du für Kunden mit deinem eigenen Zertifikat, wie es Cloud-Dienste tun, ist das Datenübermittlung im Auftrag nach [§ 87d AO](https://www.gesetze-im-internet.de/ao_1977/__87d.html): Du musst deine Auftraggeber identifizieren, die Aufzeichnungen dazu fünf Jahre aufbewahren und ihnen die Daten zur Zustimmung vorlegen (siehe [Warum Lexoffice ohne dein Zertifikat sendet](einrichtung-elster.md#warum-lexoffice-ohne-dein-zertifikat-sendet)). Dafür ist Haben nicht gebaut.
- **Aufbewahrung und Datenzugriff.** Für die Bücher bleibt der Kunde verantwortlich. Er muss sie 8 bis 10 Jahre aufbewahren und dem Finanzamt bei einer Außenprüfung Zugriff geben (§ 147 Abs. 3 und 6 AO, siehe [Aufbewahrung](auswertungen.md#aufbewahrung)). Regle deshalb im Vertrag, wie er an seine Daten kommt, wenn er kündigt oder du den Dienst einstellst: mindestens das [Jahresarchiv](auswertungen.md) und das Änderungsprotokoll, rechtzeitig vor dem Löschen.
- **Du hast vollen Zugriff.** Die GoBD-Trigger schützen vor Versehen, nicht vor Absicht: Wer Server und Datenbank betreibt, kann sie abschalten (siehe [Architektur › Entwurfsentscheidungen](architektur.md#entwurfsentscheidungen)). Bei einer eigenen Instanz ist das der Steuerpflichtige selbst, hier bist du es. Sag das deinen Kunden. Den Nachweis, dass nachträglich nichts verändert wurde, tragen der wöchentliche Prüfwert des Änderungsprotokolls an die Adresse des Kunden und seine eigenen Exporte, nicht dein Wort.
- **Betrieb und Haftung.** Updates, Backups mit Test-Restore, Erneuerung von ERiC und Überwachung liegen bei dir. Fällt deine Instanz vor einer Frist aus, etwa am Tag der Voranmeldung, trifft der Verspätungszuschlag den Kunden. Leg im Vertrag fest, was du zusagst (Verfügbarkeit, Wiederherstellung, Haftung), und sag ihm, wie er im Notfall in Mein ELSTER abgibt (siehe [Abgabe an ELSTER](elster-abgabe.md)).
- **Nur Software, keine Steuerberatung.** Bucht der Kunde selbst, stellst du nur Software und Server bereit. Buchst du für ihn, erstellst seine Voranmeldung oder berätst ihn, ist das Hilfeleistung in Steuersachen, die das Steuerberatungsgesetz nur bestimmten Personen erlaubt (§§ 2 bis 6 StBerG).

Eine offizielle Aussage der Finanzverwaltung zum Betrieb freier Software für andere gibt es nicht. Wer es genau wissen will, fragt beim Bayerischen Landesamt für Steuern nach (siehe [Open Source und die Hersteller-ID](einrichtung-elster.md#open-source-und-die-hersteller-id)).

## Als App installieren (PWA)

Haben bringt ein Web-App-Manifest und einen minimalen Service Worker mit. Der Service Worker speichert bewusst nichts zwischen; die Daten bleiben auf dem Server, offline funktioniert Haben nicht.

- Über „Zum Startbildschirm hinzufügen“ bzw. „App installieren“ im Browser installieren. Das klappt nur über HTTPS.
- Die installierte App hat Kurzbefehle für „Beleg hochladen“ und „Neue Rechnung“.
- Die App meldet sich als Teilen-Ziel an (`/api/belege/teilen`): Teilst du auf dem Handy ein PDF, Foto oder E-Rechnungs-XML mit Haben, wird es als Beleg hochgeladen. Höchstens 20 Dateien je Vorgang, je Datei bis 20 MB. Ob das Teilen-Menü Web-Apps anbietet, hängt vom Browser und Betriebssystem ab.

## Passkeys und Domain

Passkeys sind an den Hostnamen aus `BETTER_AUTH_URL` gebunden. Ziehst du Haben auf eine andere Domain um, funktionieren die alten Passkeys dort nicht mehr. Melde dich dann mit E-Mail und Passwort an und lege unter Einstellungen neue Passkeys an. `BETTER_AUTH_URL` muss genau die Adresse sein, die im Browser steht, inklusive `https://`.
