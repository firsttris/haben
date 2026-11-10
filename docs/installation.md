---
title: "Installation mit Docker Compose oder Podman, Backup, Updates"
description: >-
  Haben selbst hosten: Installation mit Docker Compose oder Podman Quadlets, Umgebungsvariablen,
  Kontoabruf, Backup, Wiederherstellung und Updates.
---

# Betrieb und Installation

Diese Seite beschreibt, wie du Haben auf einem eigenen Server betreibst: mit Docker Compose (am einfachsten) oder mit Podman Quadlets unter systemd, dazu Umgebungsvariablen, Backup und Updates. Was du danach in der Oberfläche einrichtest, steht in [Erste Schritte](einrichtung.md).

## Überblick

Haben läuft als vier Container in einem eigenen Netz:

| Container (Compose / Quadlet) | Image | Aufgabe |
| --- | --- | --- |
| `db` / `haben-db` | `tristanteu/haben-db:latest` | Datenbank (`postgres:18`, hebt ältere Bestände beim Start selbst an, siehe [PostgreSQL-Update](#postgresql-update)), Volume `db` bzw. `haben-db` |
| `app` / `haben-app` | `tristanteu/haben:latest` | Die App auf Port 3000, Belegdateien im Volume `belege` bzw. `haben-belege`, ERiC im Volume `eric` bzw. `haben-eric`, ERiC-Logs im Volume `eric-log` bzw. `haben-eric-log` |
| `backup` / `haben-backup` | `tristanteu/haben-backup:latest` | Tägliches Backup von Datenbank und Belegen mit restic, Repository im Volume `backups` bzw. `haben-backups` oder auf einem zweiten System, siehe [Backup und Wiederherstellen](#backup-und-wiederherstellen) |
| `caddy` / `haben-caddy` | `caddy:2` | TLS und Reverse Proxy auf Port 80/443, Zertifikate im Volume `caddy` bzw. `haben-caddy`. Läuft bei dir schon ein Reverse Proxy, entfällt er, siehe [Eigener Reverse Proxy](#eigener-reverse-proxy) |

Es gibt zwei Wege, sie zu betreiben:

| Weg | Gut für | Dateien |
| --- | --- | --- |
| [Docker Compose](#docker-compose) | Schnell startklar, Docker oder Podman mit Compose, tägliches Backup im Container | `deploy/compose.yml`, `deploy/compose.env.example` |
| [Podman Quadlets](#podman-quadlets) | Rootless unter systemd, Secrets statt Datei, täglicher Backup-Timer, `podman auto-update` | `deploy/quadlet/*`, `deploy/Caddyfile`, `deploy/haben.env.example` |

Beide holen die Dateien per `curl`; das Repository musst du nicht klonen.

## Voraussetzungen

- Ein Linux-Server (x86_64, wenn du ERiC nutzen willst; auf arm64 geht ELSTER emuliert, siehe [ELSTER auf arm64](#elster-auf-arm64)) mit Docker und Compose 2.23 oder neuer, oder mit Podman und systemd. Die Quadlets sind für den Betrieb als normaler Nutzer (rootless) geschrieben, die Pfade nutzen `%h` bzw. `~/.config`.
- Eine Domain, die auf den Server zeigt, und erreichbare Ports 80 und 443. Caddy holt das TLS-Zertifikat selbst. Hast du schon einen Reverse Proxy (Apache, nginx, Nginx Proxy Manager, Traefik, HAProxy, Caddy), nutzt du den, siehe [Eigener Reverse Proxy](#eigener-reverse-proxy).
- HTTPS ist Pflicht: Passkeys und die Installation als App (PWA) funktionieren nur über eine sichere Verbindung.
- Für ELSTER ERiC für Linux x86_64; Haben lädt es auf Wunsch selbst herunter (siehe [ERiC einbinden](#eric-einbinden)). Auf arm64 (Raspberry Pi, Ampere, Jetson) zusätzlich ein statisches QEMU ab Version 9 und rund 750 MB Platz, siehe [ELSTER auf arm64](#elster-auf-arm64).

> [!NOTE]
> Nur Podman: Rootless Podman darf Ports unter 1024 standardmäßig nicht öffnen. Entweder du senkst die Grenze (`sysctl net.ipv4.ip_unprivileged_port_start=80`) oder du veröffentlichst Caddy auf anderen Ports und leitest weiter. Damit die Dienste ohne angemeldete Sitzung laufen, braucht der Nutzer außerdem `loginctl enable-linger`.

## Image

Das fertige Image gibt es für amd64 und arm64 auf Docker Hub und in der GitHub Container Registry:

| Image | Inhalt |
| --- | --- |
| `docker.io/tristanteu/haben:latest` | Letzte veröffentlichte Version (Standard in Compose und Quadlet) |
| `docker.io/tristanteu/haben:0.1` / `:0.1.0` | Feste Version, wenn du Updates selbst steuern willst |
| `docker.io/tristanteu/haben:next` | Neuester Release Candidate (`:0.2.0-rc.1` usw.) zum Testen, nur mit Backup |
| `docker.io/tristanteu/haben:edge` | Stand von `main`, nur zum Ausprobieren |
| `ghcr.io/firsttris/haben:…` | Dieselben Tags bei GitHub |
| `docker.io/tristanteu/haben-backup:…` / `ghcr.io/firsttris/haben-backup:…` | Backup-Container (`postgres:18` mit restic, `deploy/backup`), dieselben Tags wie die App |
| `docker.io/tristanteu/haben-db:…` / `ghcr.io/firsttris/haben-db:…` | Datenbank-Container (`postgres:18` mit `pg_upgrade` für ältere Bestände, `deploy/db`), dieselben Tags wie die App |

ERiC ist nicht enthalten, weil es nicht weitergegeben werden darf. Haben lädt es auf deinen Wunsch direkt von der Finanzverwaltung in das Volume `eric` (siehe [ERiC einbinden](#eric-einbinden)), oder du mountest es selbst. ERiC gibt es nur für Linux x86_64: Auf arm64 (z. B. Raspberry Pi) läuft alles außer der ELSTER-Übermittlung.

Selbst bauen geht auch, zum Beispiel für einen eigenen Stand. Dafür brauchst du das Repository; danach in `compose.yml` `image: haben` bzw. in `haben-app.container` `Image=localhost/haben:latest` eintragen:

```sh
git clone https://github.com/firsttris/haben.git && cd haben
podman build -t haben -f Containerfile .   # oder docker build
```

Das `Containerfile` baut die App in zwei Stufen auf Basis von `oven/bun` (Debian, slim); Laufzeit ist Bun, Node ist nicht im Image.

Das Image läuft als Nutzer `bun` (ID 1000) und setzt diese Werte schon selbst: `NODE_ENV=production`, `PORT=3000`, `DOCUMENTS_DIR=/var/lib/haben/belege`, `ERIC_LOG_DIR=/var/lib/haben/eric-log`, `ERIC_DIR=/var/lib/haben/eric`, `ERIC_WORKER_PATH` und `HABEN_EINVOICE_DIR`.

## Docker Compose

```sh
mkdir haben && cd haben
curl -O https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.yml
curl -o .env https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.env.example
```

In `.env` trägst du ein:

| Variable | Inhalt |
| --- | --- |
| `DOMAIN` | Domain ohne `https://`, z. B. `haben.example.de`. Caddy holt dafür das Zertifikat, die App nutzt `https://DOMAIN` als `BETTER_AUTH_URL` |
| `DB_PASSWORD` | Datenbank-Passwort, nur Buchstaben und Ziffern, weil es in der Verbindungs-URL steht: `openssl rand -hex 24` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32`, zusätzlich an einem zweiten Ort sichern |
| `RESTIC_PASSWORD` | Verschlüsselt das Backup: `openssl rand -base64 32`, ebenfalls an einem zweiten Ort sichern |
| `RESTIC_REPOSITORY` | optional: Backup auf einem zweiten System statt im Volume `backups`, siehe [Backup und Wiederherstellen](#backup-und-wiederherstellen) |
| `BACKUP_TIME`, `RESTORE_CHECK_DAYS`, `BACKUP_HOST`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | optional, siehe [Backup und Wiederherstellen](#backup-und-wiederherstellen) |
| `ERIC_AUTO_INSTALL`, `ERIC_SHA256`, `ERIC_HOME`, `ELSTER_HERSTELLER_ID`, `ANTHROPIC_API_KEY`, `EXTRACTION_PROVIDER`, `EXTRACTION_BASE_URL`, `EXTRACTION_MODEL`, `EXTRACTION_API_KEY`, `EXTRACTION_TIMEOUT_SECONDS`, `EXTRACTION_MAX_PAGES`, `EXTRACTION_INPUT`, `EXTRACTION_EXTRA_BODY`, `ENABLE_BANKING_APP_ID` | optional, siehe [Umgebungsvariablen](#umgebungsvariablen) |

```sh
docker compose up -d
docker compose logs -f app   # „Migrationen angewendet“, „Einrichtungscode …“, dann „Listening on …“
```

Den Einrichtungscode aus dem Log brauchst du beim ersten Aufruf, um das Konto anzulegen (siehe [Konto anlegen](einrichtung.md#konto-anlegen)).

Die Caddy-Konfiguration steckt in `compose.yml` selbst (mit Sicherheits-Headern und Upload-Grenze wie im `Caddyfile`). Caddy nimmt Anfragen bis 250 MB an; das reicht für eine Archivdatei bis 100 MB oder ein gutes Dutzend Belege auf einmal. Größere Mengen lädst du in mehreren Schritten hoch oder erhöhst `max_size`. ERiC lädst du unter **Einstellungen › ELSTER › ERiC** herunter oder mit `ERIC_AUTO_INSTALL=ja` in `.env` beim Start, siehe [ERiC einbinden](#eric-einbinden).

Der Dienst `backup` sichert Datenbank und Belege jeden Tag um 03:15 Uhr, siehe [Backup und Wiederherstellen](#backup-und-wiederherstellen).

**Updates:** `docker compose exec backup backup.sh && docker compose pull && docker compose up -d`. Migrationen laufen beim Start der App, siehe [Updates](#updates).

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
printf 'postgres://haben:%s@haben-db:5432/haben' "$DBPW" | podman secret create haben-database-url -
openssl rand -base64 32 | tr -d '\n' | podman secret create haben-auth-secret -
openssl rand -base64 32 | tr -d '\n' | podman secret create haben-encryption-key -
openssl rand -base64 32 | tr -d '\n' | podman secret create haben-restic-password -
```

| Secret | Variable im Container | Inhalt |
| --- | --- | --- |
| `haben-db-password` | `POSTGRES_PASSWORD` (in `haben-db`) | Passwort des Datenbanknutzers `haben` |
| `haben-database-url` | `DATABASE_URL` | Verbindung zur Datenbank, Passwort wie oben |
| `haben-auth-secret` | `BETTER_AUTH_SECRET` | Signiert die Sitzungen |
| `haben-encryption-key` | `HABEN_ENCRYPTION_KEY` | Schlüssel für ELSTER-Zertifikat und die API-Schlüssel für Lexoffice und sevDesk |
| `haben-restic-password` | `RESTIC_PASSWORD` (in `haben-backup`) | Verschlüsselt das Backup |
| `haben-anthropic-key` (optional) | `ANTHROPIC_API_KEY` | Für die KI-Auslesung, siehe unten |

> [!IMPORTANT]
> Sichere `HABEN_ENCRYPTION_KEY` getrennt vom Backup, zum Beispiel im Passwortmanager. Haben verschlüsselt damit das ELSTER-Zertifikat samt gespeicherter PIN, die Passwörter für SMTP und IMAP, Client Secret oder Zertifikatsschlüssel für Microsoft 365, den Schlüssel und die Sitzung des Bankabrufs und die API-Schlüssel für Lexoffice und sevDesk (AES-256-GCM). Ohne den Schlüssel sind sie nach einer Wiederherstellung nicht mehr lesbar. Das Backup sichert ihn nicht mit. Dasselbe gilt für das Passwort des Backups. Die Werte liest du aus mit `podman exec haben-app printenv HABEN_ENCRYPTION_KEY` (solange der Container läuft) und `podman secret inspect --showsecret haben-restic-password`.

### Konfiguration

In `~/.config/haben/haben.env` stehen die Werte, die nicht geheim sind. Mindestens die Domain anpassen:

```sh
BETTER_AUTH_URL=https://haben.example.de
```

Im `Caddyfile` dieselbe Domain eintragen (erste Zeile `haben.example.de {`). Caddy leitet alles an `haben-app:3000` weiter und setzt HSTS, `X-Content-Type-Options`, `Referrer-Policy` und `X-Frame-Options: SAMEORIGIN` (nicht `DENY`, sonst bleiben die eingebetteten Vorschauen leer).

> [!NOTE]
> Leere Zeilen wie `ELSTER_HERSTELLER_ID=` gelten als nicht gesetzt. Trag die Hersteller-ID erst ein, wenn du sie hast; sie muss dann genau fünf Ziffern haben.

### Starten

```sh
systemctl --user daemon-reload
systemctl --user start haben-db haben-app haben-caddy
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

Die Datei startet den mitgelieferten Caddy nicht mehr und hängt die App zusätzlich in dieses Netz, dort heißt sie `haben-app`. `docker compose up -d` startet dann nur `db` und `app`.

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

**Caddy:** Den Block aus `deploy/Caddyfile` in dein Caddyfile übernehmen, mit deiner Domain, und `caddy reload` ausführen:

```
haben.example.de {
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
	reverse_proxy haben-app:3000
}
```

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

Haben führt genau eine Buchhaltung: ein Unternehmen, ein Inhaber, auf Wunsch mit einem [Zugang für die Steuerberatung](steuerberatung.md), der nur lesen kann. Für ein zweites Gewerbe, für Partner oder Familie betreibst du je eine eigene Instanz. Jede hat ihre eigene Datenbank, eigene Belege, eigene Schlüssel und ein eigenes ELSTER-Zertifikat; sichern, umziehen und löschen lässt sich jede für sich. Am einfachsten geht das mit Compose, je Instanz ein Verzeichnis, alle hinter einem gemeinsamen Reverse Proxy.

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

Weitere Punkte:

- **ERiC** lädt jede Instanz einzeln (rund 300 MB). Wer Platz sparen will, entpackt es einmal nach `/opt/eric` und bindet es überall mit `ERIC_HOME` ein, siehe [ERiC einbinden](#eric-einbinden).
- **Hersteller-ID:** Für deine eigenen Instanzen nimmst du dieselbe ID. Betreibst du eine Instanz für jemand anderen, bist du für diese Person Softwarehersteller nach der ERiC-Lizenz, siehe [Hersteller-ID: wer ist Hersteller?](einrichtung.md#hersteller-id-wer-ist-hersteller). Wer Buchhaltungsdaten für andere hostet, ist zudem Auftragsverarbeiter nach DSGVO.
- **Quadlets** sind auf eine Instanz ausgelegt (feste Namen wie `haben-app`). Für mehrere Instanzen ist Compose einfacher.

Eine Instanz mit mehreren Mandanten gibt es bewusst nicht: Eine gemeinsame Datenbank würde jede Abfrage, die GoBD-Trigger, die Belegablage und das Backup um eine Mandantentrennung erweitern, und ein Fehler darin legte fremde Buchhaltungsdaten offen.

## Umgebungsvariablen

Die App prüft ihre Variablen in `apps/web/src/server/env.ts` beim ersten Zugriff. Ein Fehler steht dann im Log von `haben-app`.

| Variable | Pflicht | Bedeutung | Beispiel |
| --- | --- | --- | --- |
| `DATABASE_URL` | ja | PostgreSQL-Verbindung. Wird auch vom Migrationsschritt beim Start gelesen | `postgres://haben:…@haben-db:5432/haben` |
| `BETTER_AUTH_SECRET` | ja | Geheimnis für Sitzungen, mindestens 32 Zeichen | Ausgabe von `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | ja | Öffentliche Adresse, unter der Haben im Browser läuft. Bestimmt die Domain der Passkeys | `https://haben.example.de` |
| `OIDC_ONLY` | nein | Betriebsart: `false` (Vorgabe) ausschließlich lokale Anmeldung, `true` ausschließlich SSO. Andere Werte verhindern den Start | `false` |
| `OIDC_ISSUER` | bei `OIDC_ONLY=true` | Exakter Issuer des Anbieters; im Standardmodus ohne Wirkung | `https://auth.example.de` |
| `OIDC_CLIENT_ID` | bei `OIDC_ONLY=true` | ID des vertraulichen Clients | `haben` |
| `OIDC_CLIENT_SECRET` | bei `OIDC_ONLY=true` | Ursprüngliches Clientsecret, kein Hash | – |
| `OIDC_DISPLAY_NAME` | nein | Anzeigename der SSO-Anmeldung | `Authelia` |
| `OIDC_SCOPES` | nein | Scopes mit Leerzeichen; `openid` ist Pflicht, siehe unten | `openid profile email groups` |
| `OIDC_GROUPS_CLAIM` | nein | Name des Gruppen-Claims in UserInfo oder ID-Token, ein einzelner Name oder eine URL, kein Ausdruck. Vorgabe `groups` | `groups` |
| `OIDC_GROUP_INHABER` | bei `OIDC_ONLY=true` | Gruppe, deren Mitglieder Inhaber sind (exakt, groß-/kleinschreibungssensitiv) | `haben-inhaber` |
| `OIDC_GROUP_STEUERBERATUNG` | bei `OIDC_ONLY=true` | Gruppe für den Lesezugang der Steuerberatung; muss sich von der Inhaber-Gruppe unterscheiden | `haben-steuerberatung` |
| `HABEN_ENCRYPTION_KEY` | ja | Genau 32 Byte, base64-kodiert. Verschlüsselt ELSTER-Zertifikat, Zugangsdaten und die API-Schlüssel für Lexoffice und sevDesk | Ausgabe von `openssl rand -base64 32` |
| `HABEN_SETUP_CODE` | nein | Fester Einrichtungscode für das Anlegen des Kontos (mindestens 8 Zeichen). Ohne ihn erzeugt Haben bei jedem Start einen neuen und schreibt ihn ins Log, solange es kein Konto gibt | `mein-einrichtungscode` |
| `ERIC_HOME` | nein | Verzeichnis eines von Hand entpackten ERiC-Pakets; hat Vorrang vor dem heruntergeladenen. Ohne beides werden Prüfen und Senden simuliert | `/opt/eric` |
| `ERIC_DIR` | nein | Ziel für das von Haben heruntergeladene ERiC. Standard `data/eric`; im Image `/var/lib/haben/eric` (Volume) | `/var/lib/haben/eric` |
| `ERIC_AUTO_INSTALL` | nein | `ja`: fehlt ERiC, lädt der Container es beim Start (Zustimmung zu den Nutzungsbedingungen) | `ja` |
| `ERIC_VERSION` | nein | Version, die `ERIC_AUTO_INSTALL` bzw. `install-cli.ts` ohne Versionsangabe lädt. Standard ist die von Haben vorgeschlagene | `44.3.6.0` |
| `ERIC_DOWNLOAD_URL` | nein | Andere Download-Adresse für ERiC, nur zum Testen. Standard `https://download.elster.de/download/eric` | `http://localhost:4556/eric` |
| `ERIC_SHA256` | nein | Erwartete SHA-256 des ERiC-Pakets (64 Hex-Zeichen). Stimmt sie nicht, bricht die Installation ab. Die Prüfsumme eines Downloads steht danach im Log und in `HABEN_ERIC_SHA256` im ERiC-Verzeichnis | `3f5a…` |
| `ERIC_LOG_DIR` | nein | Logverzeichnis für ERiC. Ohne Angabe das temporäre Verzeichnis; im Image `/var/lib/haben/eric-log` | `/var/lib/haben/eric-log` |
| `ERIC_WORKER_PATH` | nein | Pfad zum ERiC-Worker (`packages/elster/src/worker.ts`). Im Image gesetzt, sonst nicht nötig | `/app/packages/elster/src/worker.ts` |
| `ERIC_WORKER_COMMAND` | nein | Befehl, der den ERiC-Worker statt der eigenen Laufzeit startet; `worker.ts` kommt als letztes Argument dazu. Mehrere Wörter durch Leerzeichen getrennt, ohne Anführungszeichen. Für ELSTER auf arm64 das Skript aus `deploy/eric-x86_64/einrichten.sh`, siehe [ELSTER auf arm64](#elster-auf-arm64) | `/opt/haben-x86_64/worker.sh` |
| `ELSTER_HERSTELLER_ID` | nein | Eigene Hersteller-ID, genau fünf Ziffern. Mit ERiC 43 nötig für Prüfen, Test- und Echtübermittlung; ohne ERiC läuft alles simuliert | `12345` |
| `DOCUMENTS_DIR` | nein | Ablage der Belegdateien. Standard `data/belege` (relativ zum Arbeitsverzeichnis); im Image `/var/lib/haben/belege` | `/var/lib/haben/belege` |
| `ANTHROPIC_API_KEY` | nein | Schaltet die KI-Auslesung von Belegen mit Claude ein | `sk-ant-…` |
| `EXTRACTION_BASE_URL` | nein | Basis-URL eines KI-Dienstes mit OpenAI-kompatibler Schnittstelle, selbst betrieben (Ollama) oder in der Cloud (OpenRouter, OpenAI, …). Ist sie gesetzt, liest nur dieser Dienst Belege aus, auch wenn `ANTHROPIC_API_KEY` gesetzt ist ([OpenAI-kompatible Schnittstelle](#ki-auslesung-über-openai-kompatible-schnittstelle)) | `http://host.docker.internal:11434/v1`, `https://openrouter.ai/api/v1` |
| `EXTRACTION_MODEL` | mit `EXTRACTION_BASE_URL` | Name des Vision-Modells beim Dienst, so wie der Dienst ihn schreibt. Fehlt er, startet die App nicht | `qwen2.5vl:7b` |
| `EXTRACTION_API_KEY` | nein | Schlüssel des Dienstes, falls er einen verlangt; geht als `Authorization: Bearer …` mit | `…` |
| `EXTRACTION_PROVIDER` | nein | Anbieter ausdrücklich wählen: `anthropic` oder `openai-compatible`. Ohne Angabe gilt der eigene Dienst, sobald `EXTRACTION_BASE_URL` gesetzt ist | `openai-compatible` |
| `EXTRACTION_TIMEOUT_SECONDS` | nein | Wartezeit auf den eigenen Dienst je Beleg, 5 bis 3600. Standard `300` | `600` |
| `EXTRACTION_MAX_PAGES` | nein | So viele PDF-Seiten gehen höchstens als Bild an den eigenen Dienst, 1 bis 20. Standard `4` | `2` |
| `EXTRACTION_INPUT` | nein | Was bei PDFs an den eigenen Dienst geht: `text-und-bild` (Text der Seiten aus der Textschicht und Seitenbilder), `text` (nur Text, für ein reines Textmodell) oder `bild` (nur Seitenbilder). Standard `text-und-bild`, siehe [KI-Auslesung](belege.md#ki-auslesung) | `text` |
| `EXTRACTION_EXTRA_BODY` | nein | Zusätzliche Felder im Request-Body an den eigenen Dienst, als JSON-Objekt. Für Modelle, die sonst ihr Antwortbudget mit Denken verbrauchen (`reasoning_tokens`), etwa DeepSeek über ein Gateway: `{"reasoning_effort":"none"}`. `model`, `messages`, `stream` und `response_format` setzt Haben selbst und überschreibt sie. Ohne Angabe geht der Body unverändert raus, siehe [KI-Auslesung](belege.md#ki-auslesung) | `{"reasoning_effort":"none"}` |
| `HABEN_SCHEDULER` | nein | `off` schaltet die stündlichen Hintergrundjobs ab (u. a. wiederkehrende Rechnungen, Dauerbelege, Kontoabruf, ELSTER-Postfach, Umrechnungskurse, Belege per E-Mail, Fristen-Erinnerungen), etwa für eine zweite Instanz auf derselben Datenbank | `off` |
| `ENABLE_BANKING_APP_ID` | nein | Application ID der Enable-Banking-Anwendung. Schaltet zusammen mit dem Schlüssel den automatischen Kontoabruf ein. Einfacher: unter Einstellungen › Bank hochladen; das geht dann vor | `0b7c3f1e-…` |
| `ENABLE_BANKING_KEY_FILE` | nein | Pfad zum privaten Schlüssel (PEM) der Anwendung. Bei Compose und Quadlets fest `/run/secrets/enablebanking.pem` | `/run/secrets/enablebanking.pem` |
| `ENABLE_BANKING_KEY` | nein | Alternativ der Schlüssel selbst; Zeilenumbrüche als `\n` erlaubt | `-----BEGIN PRIVATE KEY-----\n…` |
| `ENABLE_BANKING_API_URL` | nein | Andere Basis-URL der API, nur zum Testen. Standard `https://api.enablebanking.com` | `http://localhost:4555` |
| `GOOGLE_PLAY_TOKEN_URL`, `GOOGLE_PLAY_STORAGE_URL` | nein | Andere Adressen für Anmeldung und Cloud Storage beim Abruf der [Google-Play-Berichte](bank.md#google-play-und-app-store), nur zum Testen. Standard `https://oauth2.googleapis.com/token` bzw. `https://storage.googleapis.com` | `http://localhost:4556` |
| `APP_STORE_CONNECT_URL` | nein | Andere Basis-URL von App Store Connect beim Abruf der [Finanzberichte](bank.md#google-play-und-app-store), nur zum Testen. Standard `https://api.appstoreconnect.apple.com` | `http://localhost:4557` |
| `LEXOFFICE_API_URL` | nein | Andere Basis-URL der Lexware-Office-API. Standard `https://api.lexware.io/v1` | `https://api.lexoffice.io/v1` |
| `SEVDESK_API_URL` | nein | Andere Basis-URL der sevDesk-API, nur zum Testen oder falls sevDesk die Adresse ändert. Standard `https://my.sevdesk.de/api/v1`; Ablauf in [Umzug aus sevDesk](sevdesk.md) | `https://my.sevdesk.de/api/v1` |
| `PORT` | nein | Port des App-Servers, im Image `3000` | `3000` |
| `HABEN_EINVOICE_DIR` | nein | Verzeichnis von `packages/einvoice` (Typst-Vorlage und Schriften für das Rechnungs-PDF). Im Image gesetzt | `/app/packages/einvoice` |

Bei Compose setzt `compose.yml` diese Variablen aus `.env` (`DATABASE_URL` aus `DB_PASSWORD`, `BETTER_AUTH_URL` aus `DOMAIN`, `BETTER_AUTH_SECRET` aus `AUTH_SECRET`, `HABEN_ENCRYPTION_KEY` aus `ENCRYPTION_KEY`). Bei den Quadlets kommen die geheimen Werte aus Podman Secrets, der Rest aus `haben.env`; für den Datenbank-Container setzt das Quadlet `POSTGRES_USER=haben` und `POSTGRES_DB=haben`, das Passwort kommt aus dem Secret `haben-db-password`.

In den App-Container reicht `compose.yml` nur die Variablen durch, die dort unter `app` › `environment` stehen. Andere, etwa `HABEN_SETUP_CODE`, `HABEN_SCHEDULER`, `LEXOFFICE_API_URL` oder `SEVDESK_API_URL`, wirken in `.env` allein nicht; trag sie in der `compose.override.yml` beim Dienst `app` unter `environment` ein. Bei den Quadlets gelten alle Zeilen aus `haben.env`.

## Datenablage

| Was | Wo |
| --- | --- |
| Buchungen, Rechnungen (PDF und XML), Voranmeldungen mit ERiC-Protokoll, Audit-Log, verschlüsseltes ELSTER-Zertifikat, verschlüsselte API-Schlüssel für Lexoffice und sevDesk | PostgreSQL, Volume `haben-db` |
| Belegdateien und aus Lexoffice übernommene Dateien | Volume `haben-belege` (`DOCUMENTS_DIR`), abgelegt unter dem SHA-256 der Datei (`ab/abcdef…`) |
| ERiC, von Haben heruntergeladen | Volume `haben-eric` (Compose: `eric`), im Container `/var/lib/haben/eric` (`ERIC_DIR`). Lässt sich jederzeit neu laden, nicht im Backup |
| ERiC-Logs | Volume `haben-eric-log` (Compose: `eric-log`), im Container `/var/lib/haben/eric-log` (`ERIC_LOG_DIR`). Nur zur Fehlersuche, nicht im Backup |
| TLS-Zertifikate von Caddy | Volume `haben-caddy` |
| Backup (restic-Repository), wenn `RESTIC_REPOSITORY` nicht gesetzt ist | Volume `haben-backups` (Compose: `backups`), im Backup-Container `/backups` |

Belege und Rechnungen müssen nach GoBD zehn Jahre aufbewahrt werden. Beide Volumes mit Buchhaltungsdaten gehören deshalb ins Backup.

## Backup und Wiederherstellen

Ein Update lässt sich nicht einfach zurücknehmen: Migrationen ändern die Datenbank und laufen nicht rückwärts. Zurück geht es nur mit dem alten Image **und** dem Backup von vor dem Update. Deshalb läuft das Backup in beiden Varianten im selben Container, `tristanteu/haben-backup` (aus `deploy/backup`):

| | Compose | Quadlets |
| --- | --- | --- |
| Zeitplan | Dienst `backup`, täglich um `BACKUP_TIME` (Standard 03:15, Zeitzone Europe/Berlin) | `haben-backup.timer` startet `haben-backup.container` täglich um 03:15 Uhr, ein verpasster Lauf wird nachgeholt (`Persistent=true`) |
| Backup jetzt | `docker compose exec backup backup.sh` | `systemctl --user start haben-backup` |
| Protokoll | `docker compose logs backup` | `journalctl --user -u haben-backup` |
| Passwort des Backups | `RESTIC_PASSWORD` in `.env` | Secret `haben-restic-password` |
| Repository auf einem zweiten System | `RESTIC_REPOSITORY` in `.env` | `RESTIC_REPOSITORY` in `~/.config/haben/backup.env` |
| Test-Restore | alle `RESTORE_CHECK_DAYS` Tage (`.env`, Standard 7) | alle `RESTORE_CHECK_DAYS` Tage (`backup.env`, Standard 7) |

Ein Lauf

1. legt beim ersten Mal das restic-Repository an,
2. erzeugt mit `pg_dump` über das Netz einen SQL-Dump der Datenbank, packt ihn mit gzip und prüft ihn: Das Archiv muss sich entpacken lassen und mit der Abschlusszeile von `pg_dump` enden, sonst bricht das Backup mit Fehler ab,
3. sichert den Dump und die Belegdateien (Volume `belege` bzw. `haben-belege`, nur lesend eingehängt) verschlüsselt mit `restic backup --tag haben`,
4. räumt alte Stände auf: 14 tägliche, 24 monatliche und 11 jährliche Snapshots bleiben (`restic forget --prune`). Die Jahresstände decken die zehnjährige Aufbewahrung nach GoBD ab,
5. trägt das Ergebnis in die Datenbank ein; die App zeigt es unter Einstellungen › Export und warnt in der Übersicht, wenn ein Lauf fehlschlug oder seit zwei Tagen kein Backup durchlief,
6. spielt einmal pro Woche das neue Backup probeweise ein (siehe [Test-Restore](#test-restore)).

Die Volumes `caddy`, `eric` und `eric-log` und die Schlüssel sind nicht dabei. Mit Compose zeigt `docker compose ps` den Dienst `backup` als `unhealthy`, wenn der letzte Lauf fehlschlug oder seit zwei Tagen keiner durchlief.

> [!IMPORTANT]
> Sichere `HABEN_ENCRYPTION_KEY` (Compose: `ENCRYPTION_KEY`) und das Passwort des Backups (`RESTIC_PASSWORD` bzw. das Secret `haben-restic-password`) getrennt vom Server, zum Beispiel im Passwortmanager. Ohne das Passwort lässt sich das Backup nicht öffnen, ohne den Schlüssel sind ELSTER-Zertifikat, PIN, Mail-Zugänge, Bankabruf und die Schlüssel für Lexoffice und sevDesk darin nicht lesbar. Fehlt eins von beiden, ist das Backup wertlos.

### Repository auf einem zweiten System

Ohne `RESTIC_REPOSITORY` liegt das Backup im Volume `backups` bzw. `haben-backups` auf demselben Server. Das hilft gegen ein missglücktes Update, aber nicht gegen einen Plattenschaden, einen verlorenen Server oder ein versehentliches `docker compose down -v`, das die Volumes samt Backup löscht. Für den Ernstfall gehört das Repository auf ein zweites System. restic kennt dafür unter anderem:

| Ziel | `RESTIC_REPOSITORY` | Dazu |
| --- | --- | --- |
| SFTP | `sftp:backup@example.de:/srv/restic/haben` | SSH-Schlüssel einhängen: in `compose.yml` die Zeile `~/.ssh:/root/.ssh:ro` bei `backup` und `restore` einkommentieren bzw. `Volume=%h/.ssh:/root/.ssh:ro` in `haben-backup.container`. Der Host muss in `known_hosts` stehen |
| S3 (AWS, Hetzner, Backblaze …) | `s3:https://fsn1.your-objectstorage.com/bucket/haben` | `AWS_ACCESS_KEY_ID` und `AWS_SECRET_ACCESS_KEY` |
| restic REST-Server | `rest:https://nutzer:passwort@backup.example.de/haben` | – |

Mit Compose trägst du die Werte in `.env` ein, mit den Quadlets in `~/.config/haben/backup.env`, zum Beispiel:

```sh
RESTIC_REPOSITORY=s3:https://fsn1.your-objectstorage.com/bucket/haben
AWS_ACCESS_KEY_ID=…
AWS_SECRET_ACCESS_KEY=…
```

Unterstützt das Ziel schreibgeschützte Stände (etwa Object Lock bei S3), schützt das Backup auch gegen jemanden, der den Server übernommen hat.

### Test-Restore

Ein Backup, das sich im Ernstfall nicht einspielen lässt, merkt man sonst erst im Ernstfall. Deshalb folgt auf ein erfolgreiches Backup alle `RESTORE_CHECK_DAYS` Tage (Standard 7, `0` schaltet es ab) `restore-check.sh`. Es ersetzt nichts:

1. `restic check --read-data-subset 5%` liest einen Teil der Daten im Repository und prüft sie (`RESTORE_CHECK_SUBSET`),
2. der Dump aus dem Snapshot wird in eine Wegwerf-Datenbank `haben_restore_check_…` eingespielt (eigener Name je Lauf),
3. darin prüft es Hash-Kette und Siegel wie „Kette prüfen“ in der App, und der letzte Eintrag der Kette im Backup muss mit demselben Hash in der laufenden Datenbank stehen,
4. 20 zufällige Belege (`RESTORE_CHECK_FILES`) kommen aus dem Snapshot und müssen ihre SHA-256-Prüfsumme haben,
5. die Wegwerf-Datenbank wird wieder gelöscht, das Ergebnis steht in der App.

Der Datenbankserver braucht dafür kurzzeitig Platz für eine zweite Kopie der Datenbank. Von Hand: `docker compose exec backup restore-check.sh` bzw. mit den Quadlets `podman run` wie unten unter Wiederherstellen, mit `restore-check.sh` statt `restore.sh latest` und `/belege` nur lesend. Eine App, die älter ist als das Backup-Image, hat die Tabelle für das Ergebnis noch nicht; dann steht es nur im Protokoll, und der Test-Restore läuft sonntags.

### Wiederherstellen

`restore.sh` im Backup-Image stellt einen Stand wieder her. Es ersetzt Datenbank und Belege vollständig. Die App muss dafür gestoppt sein, sonst bricht es ab, ohne etwas zu ändern. Das Skript

1. fragt nach, ob Datenbank und Belege ersetzt werden sollen, und macht nur bei der Antwort `ja` weiter,
2. holt den Snapshot mit `restic restore` und prüft den Dump (lesbar, vollständig),
3. spielt den Dump in eine neue Datenbank `haben_restore` ein; ein Fehler bricht ab (`ON_ERROR_STOP`), die bisherige Datenbank bleibt dann unverändert,
4. löscht die Datenbank `haben` und benennt `haben_restore` in `haben` um,
5. ersetzt den Inhalt des Volumes mit den Belegen durch die Belegdateien aus dem Snapshot.

Mit Compose:

```sh
docker compose stop app
docker compose run --rm restore          # verfügbare Stände anzeigen
docker compose run --rm restore latest   # oder eine Snapshot-ID
docker compose start app
```

Mit den Quadlets:

```sh
systemctl --user stop haben-app
podman run --rm -it --network haben --env-file ~/.config/haben/backup.env -e PGHOST=haben-db \
  --secret haben-db-password,type=env,target=PGPASSWORD \
  --secret haben-restic-password,type=env,target=RESTIC_PASSWORD \
  -v haben-belege:/belege -v haben-backups:/backups \
  docker.io/tristanteu/haben-backup:latest restore.sh latest   # ohne latest: Stände anzeigen
systemctl --user start haben-app
```

Liegt das Repository per SFTP auf einem anderen System, gehört `-v ~/.ssh:/root/.ssh:ro` dazu. Danach meldest du dich an und prüfst Stichproben, etwa die letzte Rechnung, den letzten Beleg und die Bankumsätze.

Auf einem frischen System richtest du Haben zuerst wie oben ein, mit demselben `HABEN_ENCRYPTION_KEY`, demselben Passwort des Backups und demselben `RESTIC_REPOSITORY`. Dann startest du nur die Datenbank (`docker compose up -d db` bzw. `systemctl --user start haben-db`), stellst wie oben wieder her und startest danach alles. Lief die App schon, stoppst du sie vorher; `restore.sh` ersetzt die leere Datenbank dann genauso. Probiere die Wiederherstellung einmal aus, bevor du dich auf das Backup verlässt.

### Update zurücknehmen

1. Vor dem Update ein Backup machen (`docker compose exec backup backup.sh` bzw. `systemctl --user start haben-backup`), wie unter [Updates](#updates).
2. Geht nach dem Update etwas schief: die vorherige Version fest eintragen, in `compose.yml` etwa `image: tristanteu/haben:0.1.9`, im Quadlet `Image=docker.io/tristanteu/haben:0.1.9`.
3. Den Stand von vor dem Update einspielen, wie oben unter [Wiederherstellen](#wiederherstellen). Die Snapshot-ID zeigt `restore.sh` ohne Argument; `latest` passt nur, wenn seit dem Update kein Backup mehr lief.
4. Die App starten (`docker compose up -d` bzw. `systemctl --user daemon-reload && systemctl --user start haben-app`).

Nur das alte Image ohne das alte Backup reicht nicht: Die alte Version startet dann mit einer Datenbank, die schon migriert ist.

### Umzug vom Host-Skript der Quadlets

Bisher lief das Backup der Quadlets als `~/.config/haben/backup.sh` mit restic auf dem Host. Der Container ersetzt es, restic auf dem Host brauchst du danach nicht mehr. Das bestehende Repository und seine Stände bleiben nutzbar.

```sh
RAW=https://raw.githubusercontent.com/firsttris/haben/main/deploy
# Passwort des bisherigen Repositorys als Secret, ohne den Zeilenumbruch am Ende der Datei: restic nimmt
# RESTIC_PASSWORD wörtlich, nur RESTIC_PASSWORD_FILE schneidet ihn ab
tr -d '\n' < ~/.config/haben/restic-password | podman secret create haben-restic-password -
# Neue Units, die alte Service-Unit und die Skripte entfallen
for f in haben-backup.container haben-backups.volume; do curl -o ~/.config/containers/systemd/$f "$RAW/quadlet/$f"; done
rm ~/.config/systemd/user/haben-backup.service ~/.config/haben/backup.sh ~/.config/haben/restore.sh
```

Dann `~/.config/haben/backup.env` anpassen:

- Die Zeile `RESTIC_PASSWORD_FILE=…` löschen; das Passwort kommt jetzt aus dem Secret.
- `RESTIC_REPOSITORY` mit `sftp:`, `s3:` oder `rest:` bleibt stehen. Bei SFTP in `haben-backup.container` die Zeile `Volume=%h/.ssh:/root/.ssh:ro` einkommentieren.
- Liegt das Repository in einem Verzeichnis auf dem Host (`RESTIC_REPOSITORY=/srv/restic/haben`), die Zeile löschen und in `haben-backup.container` `Volume=haben-backups.volume:/backups` durch `Volume=/srv/restic/haben:/backups` ersetzen.

```sh
systemctl --user daemon-reload
systemctl --user start haben-backup && journalctl --user -u haben-backup -n 20
```

Die alten Stände zeigt `restore.sh` ohne Argument unter dem Hostnamen des Servers; einspielen lassen sie sich mit ihrer Snapshot-ID. Die neuen Stände laufen unter dem Host `haben`. Aufgeräumt wird je Host, die alten Stände werden also nach denselben Regeln weniger.

## Updates

Vor jedem Update ein Backup machen; nur damit lässt sich das Update zurücknehmen, siehe [Update zurücknehmen](#update-zurücknehmen). Mit Compose:

```sh
docker compose exec backup backup.sh   # Stand vor dem Update sichern
docker compose pull && docker compose up -d
```

Mit den Quadlets:

```sh
systemctl --user start haben-backup    # Stand vor dem Update sichern
podman auto-update                     # neue Images ziehen, haben-app und haben-db neu starten
podman pull docker.io/tristanteu/haben-backup:latest
```

`podman auto-update` erfasst nur laufende Container. Das Backup läuft bloß kurz, sein Image holst du deshalb mit `podman pull`.

`haben-app.container` und `haben-db.container` tragen `AutoUpdate=registry`; mit `systemctl --user enable --now podman-auto-update.timer` prüft Podman täglich selbst auf neue Images. Willst du Updates von Hand steuern, setze im Quadlet eine feste Version (`Image=docker.io/tristanteu/haben:0.1`) und ändere sie bewusst. Bei einem selbst gebauten Image: `git pull`, `podman build -t haben -f Containerfile .` und `systemctl --user restart haben-app`.

`podman auto-update` tauscht nur das Image. Lädst du neue Quadlet-Dateien wie `haben-app.container`, hole auch die `.volume`-Dateien, auf die sie verweisen (etwa `haben-eric-log.volume`), und führe danach `systemctl --user daemon-reload` aus.

### PostgreSQL-Update

Die Datenbank läuft im Image `tristanteu/haben-db` (aus `deploy/db`): das offizielle `postgres:18` plus die Programme der älteren Versionen ab 16. Findet der Container beim Start im Volume noch einen Datenbestand einer älteren Version, hebt er ihn mit `pg_upgrade` an und startet danach normal. Ein Update auf ein neues Postgres ist damit ein ganz normales Update wie oben, mit Backup vorher. Das Upgrade dauert bei einer Buchhaltung meist unter einer Minute; im Log steht es so:

```text
haben-db: Aktualisiere die Datenbank von PostgreSQL 16 (/var/lib/postgresql/data) auf 18 (/var/lib/postgresql/data/18/docker) …
haben-db: Upgrade auf PostgreSQL 18 fertig. Der alte Bestand liegt unverändert in /var/lib/postgresql/data/16/docker;
```

Im Volume liegt danach je Version ein Verzeichnis, `16/docker` mit dem alten und `18/docker` mit dem neuen Bestand. `pg_upgrade` kopiert, der alte Bestand bleibt also unverändert erhalten und braucht noch einmal so viel Platz wie die Datenbank. Läuft Haben einwandfrei, kann er weg:

```sh
docker compose exec db rm -rf /var/lib/postgresql/data/16   # Compose
podman exec haben-db rm -rf /var/lib/postgresql/data/16     # Quadlets
```

Schlägt das Upgrade fehl, bricht der Container mit der Meldung von `pg_upgrade` ab und lässt alles, wie es war: Mit dem bisherigen Image (`image: postgres:16` in `compose.yml`, `Image=docker.io/library/postgres:16` im Quadlet) startet die alte Datenbank wieder.

**Einmalig für Installationen mit Postgres 16.** Bis Haben 0.2 lief die Datenbank im offiziellen Image `docker.io/library/postgres:16`. Das steht in deiner `compose.yml` bzw. in `haben-db.container` und ändert sich durch ein Update der Images nicht: Die Datenbank bleibt auf 16, bis du die Datei einmal neu holst. Das muss nicht sofort sein, das Backup-Image kommt mit beiden Versionen zurecht. Für den Umstieg:

```sh
docker compose exec backup backup.sh   # Stand vor dem Update sichern
curl -O https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.yml
docker compose pull && docker compose up -d
docker compose logs db                 # „Upgrade auf PostgreSQL 18 fertig“
```

Hast du `compose.yml` angepasst statt eine `compose.override.yml` zu nutzen, ändere nur die Zeile `image: postgres:16` des Dienstes `db` in `image: tristanteu/haben-db:latest`. Mit den Quadlets:

```sh
systemctl --user start haben-backup    # Stand vor dem Update sichern
curl -o ~/.config/containers/systemd/haben-db.container \
  https://raw.githubusercontent.com/firsttris/haben/main/deploy/quadlet/haben-db.container
systemctl --user daemon-reload
systemctl --user restart haben-db haben-app
journalctl --user -u haben-db -n 20    # „Upgrade auf PostgreSQL 18 fertig“
```

Beim Start führt `deploy/entrypoint.sh` zuerst `src/server/db/migrate.ts` aus und wendet alle ausstehenden Migrationen an; erst danach startet der Server. Schlägt eine Migration fehl, startet die App nicht, und der Fehler steht im Log.

## ERiC einbinden

ERiC ist die Bibliothek der Finanzverwaltung für ELSTER. Sie ist kostenlos, darf aber nicht mit Haben weitergegeben werden. Deshalb lädt Haben sie auf deinen Wunsch direkt von `download.elster.de` auf deinen Server, nur den Teil für Linux x86_64 (rund 300 MB). Mit dem Download stimmst du den [Nutzungsbedingungen von ERiC](https://www.elster.de/elsterweb/entwickler/infoseite/eric) zu.

| Weg | So geht's |
| --- | --- |
| Per Knopf | **Einstellungen › ELSTER › ERiC**: Version prüfen, den Nutzungsbedingungen zustimmen, **Herunterladen und einrichten**. Der Download läuft im Hintergrund; danach prüft und sendet Haben ohne Neustart über ERiC |
| Beim Start | `ERIC_AUTO_INSTALL=ja` in `.env` bzw. `haben.env`. Fehlt ERiC, lädt der Container es vor dem Start der App; schlägt das fehl, startet die App trotzdem (simuliert) |
| Auf der Kommandozeile | `docker compose exec app bun /app/packages/elster/src/install-cli.ts --lizenz-akzeptiert [Version]` bzw. `podman exec haben-app …` |

Weil ERiC als native Bibliothek geladen wird, prüft Haben den Download: Er darf nur auf demselben Server weitergeleitet werden, ist auf 1 GB begrenzt, und seine SHA-256 steht danach im Log und in `HABEN_ERIC_SHA256` im Versionsordner. Mit `ERIC_SHA256` legst du die erwartete Prüfsumme fest, etwa die einer Installation, der du schon vertraust; weicht der Download ab, installiert Haben ihn nicht.

ERiC landet im Volume `eric` bzw. `haben-eric` (`ERIC_DIR=/var/lib/haben/eric`), je Version in einem Unterordner; die Datei `AKTUELL` zeigt auf die aktive. Eine neue Version ersetzt die alte erst, wenn sie vollständig entpackt ist. Die Version, die Haben vorschlägt, ist die zuletzt bekannte; die aktuelle steht auf der Infoseite. Die Finanzverwaltung stellt alte Versionen nach einiger Zeit ab, und Vordrucke eines neuen Jahres (etwa die Jahreserklärungen) brauchen meist eine neue Version. Dann einfach die neue Versionsnummer eintragen und erneut laden.

Zum Prüfen und Übermitteln brauchst du zusätzlich eine eigene Hersteller-ID; ERiC 43 nimmt die frühere Test-Hersteller-ID nicht mehr an. Vor der ersten Nutzung bestätigst du außerdem unter **Einstellungen › ELSTER › ERiC** die Datenschutzhinweise der Finanzverwaltung, wie es der ERiC-Lizenzvertrag verlangt. Siehe [Erste Schritte](einrichtung.md#elster-einrichten), dort auch, wer bei Haben als Hersteller gilt.

Lieber von Hand? Entpacke das Paket auf dem Host nach `/opt/eric`, sodass `/opt/eric/lib/libericapi.so` und `/opt/eric/lib/plugins/` existieren (bei älteren ERiC-Versionen `lib/plugins2/`), und binde es ein. `ERIC_HOME` hat Vorrang vor dem heruntergeladenen ERiC.

| | Compose | Quadlet |
| --- | --- | --- |
| Verzeichnis mounten | in `compose.yml` die Zeile `- /opt/eric:/opt/eric:ro` einkommentieren | in `haben-app.container` die Zeile `Volume=/opt/eric:/opt/eric:ro` einkommentieren |
| Variable | `ERIC_HOME=/opt/eric` in `.env` | `ERIC_HOME=/opt/eric` in `haben.env` einkommentieren |
| Neu starten | `docker compose up -d` | `systemctl --user daemon-reload && systemctl --user restart haben-app` |

ERiC läuft nie im App-Prozess. Jede Prüfung und jede Übermittlung startet einen kurzlebigen Kindprozess, der die Bibliothek lädt. Ohne ERiC nutzt Haben einen simulierten Client; die Oberfläche zeigt dann „ERiC ist nicht eingerichtet“ an, und nichts geht an das Finanzamt.

Der weitere Ablauf (Zertifikat, Testübermittlung, Hersteller-ID) steht in [Erste Schritte](einrichtung.md#elster-einrichten).

### ELSTER auf arm64

ERiC gibt die Finanzverwaltung nur als fertige Bibliothek heraus, für Server nur für Linux x86_64; selbst übersetzen lässt sie sich nicht. Auf einem arm64-Server (Raspberry Pi, Ampere, Jetson) läuft Haben trotzdem nativ: Emuliert wird nur der kurzlebige Kindprozess, der für jede Prüfung und Übermittlung ERiC lädt. `ERIC_WORKER_COMMAND` startet ihn mit QEMU als x86_64-Prozess, mit Bun und den Bibliotheken aus dem amd64-Image derselben Haben-Version.

Das kostet Zeit: Auf einem Jetson AGX Orin dauerte ein ERiC-Aufruf emuliert rund 25 Sekunden statt einer, fast alles davon das Laden von ERiC. Für gelegentliche Meldungen reicht das; nach 120 Sekunden bricht Haben einen Aufruf ab.

1. **QEMU besorgen:** ein statisch gebautes `qemu-x86_64` (User-Mode) ab Version 9; mit 8.2 stürzt Bun schon beim Start ab. Debian ab 13 hat es im Paket `qemu-user` (`/usr/bin/qemu-x86_64`), ältere Systeme wie Ubuntu 24.04 nur 8.2 in `qemu-user-static`. Das Programm aus dem Debian-Paket läuft auch dort, z. B. mit `apt-get download qemu-user` in einem Container mit `debian:trixie` und `dpkg-deb -x`.
2. **Laufzeit anlegen:** auf dem Host als root, mit derselben Version wie das App-Image. Das Skript kommt vom Tag dieser Version, damit Skript und App zusammenpassen:
   ```sh
   VERSION=x.y.z   # Version deines App-Images
   curl -O https://raw.githubusercontent.com/firsttris/haben/v$VERSION/deploy/eric-x86_64/einrichten.sh
   sudo QEMU=/pfad/zu/qemu-x86_64 sh einrichten.sh $VERSION /opt/haben-x86_64
   ```
   Das Skript lädt das amd64-Image von Haben, entpackt es nach `/opt/haben-x86_64/root` (rund 730 MB), kopiert QEMU daneben und legt `worker.sh` an, den Befehl für `ERIC_WORKER_COMMAND`. Den lokalen Tag des Images setzt es danach zurück: Lag das Image der App schon auf dem Rechner, zeigt der Tag wieder darauf, sonst wird er entfernt. So startet die App beim nächsten Mal nicht das amd64-Image.
3. **In der App einbinden** und neu starten:

   | | Compose | Quadlet |
   | --- | --- | --- |
   | Verzeichnis mounten | in `compose.yml` die Zeile `- /opt/haben-x86_64:/opt/haben-x86_64:ro` einkommentieren | in `haben-app.container` die Zeile `Volume=/opt/haben-x86_64:/opt/haben-x86_64:ro` einkommentieren |
   | Variable | `ERIC_WORKER_COMMAND=/opt/haben-x86_64/worker.sh` in `.env` | `ERIC_WORKER_COMMAND=/opt/haben-x86_64/worker.sh` in `haben.env` einkommentieren |
   | Neu starten | `docker compose up -d` | `systemctl --user daemon-reload && systemctl --user restart haben-app` |

4. **ERiC laden** wie oben unter [ERiC einbinden](#eric-einbinden); mit `ERIC_WORKER_COMMAND` bietet Haben den Download auch auf arm64 an.

Ausprobiert sind so bisher Prüfen, Belegabruf, Berechtigungen und Postfach mit echtem ERiC. **Eine echte Übermittlung an ELSTER unter QEMU hat noch niemand getestet.** Der Weg ist derselbe wie beim Prüfen, nur mit Zertifikat und Netz. Prüfe deine erste Meldung danach im ELSTER-Portal.

Nach jedem Update von Haben `einrichten.sh` mit der neuen Version wiederholen. `worker.sh` vergleicht beide Versionen und startet nicht, wenn sie verschieden sind; Haben zeigt dann „x86_64-Laufzeit für ERiC ist Version …“ an.

Warum ein Skript statt nur QEMU: `worker.sh` setzt vorher `ulimit -s unlimited`. Dann vergibt Linux den Speicher von unten, unterhalb der 47-Bit-Grenze, die Bun (JavaScriptCore) auf x86_64 voraussetzt; sonst landet er unter QEMU an höheren Adressen, und Bun bricht mit „MemoryExhaustion“ ab. Außerdem startet es `worker.ts` aus der x86_64-Laufzeit, weil deren `node_modules` koffi für x86_64 enthalten.

## KI-Auslesung (Anthropic)

Optional. Ist `ANTHROPIC_API_KEY` gesetzt, liest Haben Belege, die keine E-Rechnung sind, mit Claude aus:

```sh
printf '%s' 'sk-ant-…' | podman secret create haben-anthropic-key -
# in haben-app.container die Zeile "Secret=haben-anthropic-key,…" einkommentieren
systemctl --user daemon-reload && systemctl --user restart haben-app
```

Was an Anthropic geht und wann:

- Gesendet wird die Belegdatei selbst (PDF, JPEG, PNG oder WebP, base64-kodiert), zusammen mit einer festen Anweisung und der Liste der Ausgabenkategorien. Weitere Daten aus Haben (Firmendaten, Buchungen, Kontakte) gehen nicht mit.
- Das passiert automatisch direkt nach dem Hochladen, wenn die Datei keine lesbare E-Rechnung (ZUGFeRD, XRechnung) ist, und wenn du auf einem Beleg „Mit KI neu auslesen“ wählst.
- E-Rechnungen liest Haben immer lokal. HEIC-Fotos kann die KI nicht lesen.
- Die Felder werden nur vorbefüllt; gebucht wird erst nach deiner Bestätigung.

Ohne Schlüssel bleibt alles lokal, und du füllst die Felder von Hand aus. Mehr dazu in [Belege](belege.md).

## KI-Auslesung über OpenAI-kompatible Schnittstelle

Optional und statt Anthropic. Haben spricht jeden Dienst an, der die OpenAI-Schnittstelle `POST /v1/chat/completions` anbietet. Das kann ein selbst betriebenes Modell sein, etwa mit [Ollama](https://docs.ollama.com/api/openai-compatibility), LM Studio, vLLM oder Docker Model Runner (`docker model run`), oder ein Dienst in der Cloud wie [OpenRouter](https://openrouter.ai/docs/quickstart), OpenAI oder ein anderer Anbieter mit OpenAI-kompatibler API. Ein schon laufender Dienst genügt; einen Modell-Container bringt Haben nicht mit. Das Modell muss Bilder lesen können (Vision-Modell, z. B. aus der Qwen-VL-Familie wie `qwen2.5vl`). Ein reines Textmodell oder reine Texterkennung (OCR) genügt nicht: Haben braucht die Belegfelder, nicht nur den Text.

```sh
# .env (Compose) bzw. haben.env (Quadlets)
EXTRACTION_BASE_URL=http://host.docker.internal:11434/v1
EXTRACTION_MODEL=qwen2.5vl:7b
```

Für einen Dienst in der Cloud kommen Adresse, Modellname und Schlüssel vom Anbieter, etwa für OpenRouter:

```sh
EXTRACTION_BASE_URL=https://openrouter.ai/api/v1
EXTRACTION_MODEL=qwen/qwen2.5-vl-72b-instruct   # Modellname wie in der Modellliste des Anbieters, mit Bildeingabe
EXTRACTION_API_KEY=sk-or-…                      # Quadlets: als Secret haben-extraction-key
```

Was dabei passiert:

- **Nur dieser Dienst.** Ist `EXTRACTION_BASE_URL` gesetzt, gehen Belege ausschließlich an diese Adresse, auch wenn zusätzlich `ANTHROPIC_API_KEY` gesetzt ist. Ist der Dienst nicht erreichbar, zu langsam oder antwortet er falsch, steht der Fehler am Beleg; Haben weicht nie auf Anthropic oder einen anderen Anbieter aus. Leitet der Dienst auf eine andere Adresse um (HTTP 3xx), folgt Haben dem nicht und meldet es am Beleg.
- **Fotos** (JPEG, PNG, WebP) gehen als Bild an den Dienst. **PDFs** wandelt Haben vorher lokal mit `pdftoppm` (poppler-utils, im Image enthalten) in Seitenbilder um, höchstens `EXTRACTION_MAX_PAGES` Seiten (Standard 4, längere Seite 1600 Pixel); hat das PDF mehr Seiten, steht ein Hinweis am Beleg. HEIC-Fotos und XML-Dateien gehen nicht an den Dienst. Hat ein PDF eine Textschicht, liest Haben sie mit `pdftotext` aus und schickt den Text mit; mit `EXTRACTION_INPUT=text` nur den Text, ohne Bilder, für ein reines Textmodell (etwa `qwen3:8b` in Ollama). Ein Scan oder ein Foto geht dann gar nicht an den Dienst.
- **Daten.** Ein Beleg geht genau an die eingetragene Adresse. Bei einem selbst betriebenen Modell verlässt er deinen Server nicht; bei einem Dienst in der Cloud liest ihn dieser Anbieter und, bei Vermittlern wie OpenRouter, der Anbieter des gewählten Modells. Was sie speichern oder zum Training nutzen, regeln deren Bedingungen und Einstellungen, nicht Haben.
- **Antwortformat.** Haben verlangt strukturierte Ausgabe nach einem JSON-Schema (`response_format` mit `json_schema`); Ollama, LM Studio und vLLM können das, bei Cloud-Diensten hängt es vom Modell ab. Lehnt der Dienst das ab, fragt Haben denselben Dienst noch einmal ohne und prüft die Antwort selbst gegen dasselbe Schema. Ein JSON-Schema garantiert keine richtigen Werte: Haben prüft Beträge, Daten und Summen wie bei Claude.
- **Authentifizierung.** Ohne `EXTRACTION_API_KEY` schickt Haben keinen Schlüssel. Verlangt der Dienst einen (jeder Cloud-Dienst wie OpenRouter, vLLM mit `--api-key`, ein Proxy davor), setze ihn; bei den Quadlets als Secret `haben-extraction-key` (Zeile in `haben-app.container` einkommentieren). Er steht nirgends in der Oberfläche oder im Log.
- **Wartezeit.** Auf einer CPU braucht ein 7B-Vision-Modell für einen Beleg leicht ein bis mehrere Minuten; ein Cloud-Dienst antwortet meist in Sekunden. Haben wartet `EXTRACTION_TIMEOUT_SECONDS` (Standard 300) und meldet dann eine Zeitüberschreitung am Beleg.
- **Log.** Bei einem Fehler schreibt Haben nur Anbieter, Modell und die Art des Fehlers ins Log, etwa `KI-Auslesung fehlgeschlagen (openai-compatible, qwen2.5vl:7b): zeitueberschreitung`. Beleginhalte, Antworten des Modells und Schlüssel stehen nicht im Log. Welcher Anbieter gerade gilt, zeigt **Einstellungen › KI-Assistenten und API › Belegauslesung**.

### Den Dienst aus dem Container erreichen

Das betrifft nur selbst betriebene Dienste; ein Cloud-Dienst ist über seine öffentliche Adresse erreichbar. Im Container ist `localhost` der Container selbst, nicht der Server. Läuft Ollama direkt auf dem Server:

| Betrieb | Adresse | Was noch nötig ist |
| --- | --- | --- |
| Docker Compose unter Linux | `http://host.docker.internal:11434/v1` | in `compose.yml` beim Dienst `app` die Zeilen `extra_hosts: - host.docker.internal:host-gateway` einkommentieren; Ollama muss auf der Docker-Bridge lauschen: `OLLAMA_HOST=0.0.0.0:11434` (oder die Adresse der Bridge, meist `172.17.0.1`) |
| Docker Desktop (macOS, Windows) | `http://host.docker.internal:11434/v1` | nichts |
| Podman (Quadlets) | `http://host.containers.internal:11434/v1` | Ollama mit `OLLAMA_HOST=0.0.0.0:11434`; den Namen trägt Podman selbst im Container ein |
| Dienst auf einem anderen Rechner im Netz | `http://192.168.178.20:11434/v1` | Firewall für den Port öffnen, nur für den Server |

Lauscht Ollama auf `0.0.0.0`, ist es von allen Rechnern im Netz erreichbar und hat keine Anmeldung. Beschränke den Port mit der Firewall auf den Server, oder setze einen Reverse Proxy mit Schlüssel davor und trage den Schlüssel als `EXTRACTION_API_KEY` ein.

Prüfen, ob der Container den Dienst erreicht:

```sh
docker compose exec app bun -e 'fetch(process.env.EXTRACTION_BASE_URL + "/models").then(r => r.text()).then(console.log, console.error)'
# Quadlets: podman exec haben-app bun -e '…'
```

### Beispiel: Ollama als eigener Container

Wer Ollama nicht schon betreibt, kann es neben Haben starten, etwa in einer `compose.override.yml`. Das ist nur ein Beispiel; Haben braucht diesen Container nicht.

```yaml
services:
  ollama:
    image: ollama/ollama:latest
    restart: unless-stopped
    volumes:
      - ollama:/root/.ollama
    # Mit NVIDIA-GPU deutlich schneller; ohne GPU diese Zeilen weglassen
    # deploy:
    #   resources:
    #     reservations:
    #       devices: [{ driver: nvidia, count: all, capabilities: [gpu] }]
  app:
    environment:
      EXTRACTION_BASE_URL: http://ollama:11434/v1
      EXTRACTION_MODEL: qwen2.5vl:7b

volumes:
  ollama:
```

Das Modell lädst du einmal: `docker compose exec ollama ollama pull qwen2.5vl:7b` (rund 6 GB). Im selben Compose-Projekt erreicht Haben den Dienst unter seinem Namen `ollama`, ohne dass der Port nach außen offen ist.

**Grenzen.** Wie gut ein Beleg gelesen wird, hängt vom Modell ab. Ein lokales 7B-Modell liest saubere PDFs und gut ausgeleuchtete Fotos meist richtig, verliest sich aber eher als Claude bei Kassenzetteln, schrägen Fotos und kleinen Beträgen. Deshalb bleibt jeder Beleg „Zu prüfen“, bis du ihn bestätigst. Mehrseitige PDFs kosten je Seite Rechenzeit; bei Rechnungen stehen die Summen meist auf den ersten Seiten.

## Kontoabruf (Enable Banking)

Optional. Haben holt die Umsätze einmal täglich selbst über [Enable Banking](https://enablebanking.com), einen PSD2-Dienst mit Zugang zu fast allen deutschen Banken (DKB, Sparkassen, Volksbanken, N26 und viele mehr). Ohne Einrichtung bleibt der Import per CSV oder CAMT; beides geht auch nebeneinander.

1. Bei Enable Banking ein Konto anlegen und im Kontrollzentrum unter **API applications** eine Anwendung registrieren.
2. Als **Redirect URL** die Adresse `https://<deine Domain>/api/bank/callback` eintragen. Haben zeigt sie beim Verbinden auch an.
3. Den Schlüssel im Browser erzeugen lassen. Enable Banking lädt dann `<Application ID>.pem` herunter; die Application ID steht auch in der Übersicht.
4. Für eigene Konten genügt in der Regel der kostenlose eingeschränkte Produktionszugang: Die Anwendung wird aktiviert, indem du im Kontrollzentrum deine eigenen Konten verknüpfst, und darf danach nur diese abrufen. Die aktuellen Bedingungen stehen bei Enable Banking. Zum Ausprobieren gibt es eine Sandbox mit Testbanken.
5. Für die Produktionsumgebung verlangt Enable Banking außerdem eine **Privacy Policy URL** und eine **Terms of Service URL**. Haben bringt keine eigenen Seiten dafür mit: Die Instanz betreibst du selbst, also gehören dorthin deine Angaben, nicht die des Projekts. Trage die Datenschutzerklärung und das Impressum bzw. die AGB deiner eigenen Website ein, z. B. `https://<deine Domain>/datenschutz` und `https://<deine Domain>/impressum`. Die Adressen sollten erreichbar sein; im eingeschränkten Zugang bist du selbst der einzige Nutzer, der sie beim Zustimmen sieht.

Schlüssel und ID an Haben übergeben, am einfachsten in der Oberfläche: Unter **Einstellungen › Bank** die heruntergeladene `.pem`-Datei wählen; die Application ID übernimmt Haben aus dem Dateinamen. **Prüfen und speichern** fragt bei Enable Banking die Bankliste ab und speichert Schlüssel und ID nur, wenn das klappt. Der Schlüssel liegt danach verschlüsselt in der Datenbank wie das SMTP-Passwort; im Audit-Log steht nur die Application ID.

Alternativ über die Umgebung, etwa wenn du die Einrichtung automatisierst. Was in den Einstellungen gespeichert ist, geht vor:

```sh
# Compose: Datei neben compose.yml legen, Volume-Zeile in compose.yml einkommentieren, ID in .env
cp ~/Downloads/<Application ID>.pem ./enablebanking.pem && chown 1000:1000 enablebanking.pem && chmod 400 enablebanking.pem
echo 'ENABLE_BANKING_APP_ID=<Application ID>' >> .env
docker compose up -d

# Quadlets: Schlüssel als Secret, Zeile "Secret=haben-enablebanking-key,…" in haben-app.container einkommentieren
podman secret create haben-enablebanking-key ~/Downloads/<Application ID>.pem
# in haben.env: ENABLE_BANKING_APP_ID=<Application ID>
systemctl --user daemon-reload && systemctl --user restart haben-app
```

Danach erscheint unter **Bank** der Knopf **Bank verbinden**. Ablauf, Zustimmung und Dubletten stehen in [Bankimport und Abgleich](bank.md#automatischer-abruf).

Was an Enable Banking geht: beim Verbinden die gewählte Bank und die Rückleitungsadresse, danach nur Abrufe von Umsätzen und Kontoständen der freigegebenen Konten. Die Anmeldung bei der Bank geschieht auf deren Seite; Haben sieht weder Zugangsdaten noch TAN. Zahlungen auslösen kann Haben nicht.

## Lexware-Office-API

Für den Umzug ruft Haben die Public API von Lexware Office ab, standardmäßig unter `https://api.lexware.io/v1`. `LEXOFFICE_API_URL` brauchst du nur zum Testen oder falls Lexware die Adresse ändert; laut Code funktioniert auch `https://api.lexoffice.io/v1`. Den API-Schlüssel trägst du in der Oberfläche ein, nicht in der Umgebung. Ablauf und Voraussetzungen stehen in [Umzug aus Lexoffice](lexoffice.md).

## Als App installieren (PWA)

Haben bringt ein Web-App-Manifest und einen minimalen Service Worker mit. Der Service Worker speichert bewusst nichts zwischen; die Daten bleiben auf dem Server, offline funktioniert Haben nicht.

- Über „Zum Startbildschirm hinzufügen“ bzw. „App installieren“ im Browser installieren. Das klappt nur über HTTPS.
- Die installierte App hat Kurzbefehle für „Beleg hochladen“ und „Neue Rechnung“.
- Die App meldet sich als Teilen-Ziel an (`/api/belege/teilen`): Teilst du auf dem Handy ein PDF, Foto oder E-Rechnungs-XML mit Haben, wird es als Beleg hochgeladen. Höchstens 20 Dateien je Vorgang, je Datei bis 20 MB. Ob das Teilen-Menü Web-Apps anbietet, hängt vom Browser und Betriebssystem ab.

## Single Sign-on mit OpenID Connect

Haben kennt zwei strikt getrennte Betriebsarten:

| | Standardmodus (`OIDC_ONLY=false`, Vorgabe) | SSO-Modus (`OIDC_ONLY=true`) |
| --- | --- | --- |
| Anmeldung | Passwort und Passkeys | ausschließlich OIDC, etwa Authelia |
| Inhaber | genau einer, mit Einrichtungscode angelegt | jedes Mitglied der Inhaber-Gruppe, auch mehrere |
| Weitere Zugänge | per Einladung, Sperren und Entfernen in Haben | automatisch bei der ersten Anmeldung, Rolle aus der Gruppe |
| Verwaltung | **Einstellungen › Sicherheit** | Gruppen im Anmeldedienst; **Einstellungen › Zugänge** zeigt nur an |

Einen gemischten Modus gibt es nicht. Vorhandene `OIDC_*`-Werte allein schalten SSO nicht ein; im Standardmodus sind sämtliche OIDC-Wege gesperrt, im SSO-Modus sämtliche lokalen Anmelde- und Kontowege, auch bei direkten API-Aufrufen.

### Haben konfigurieren

```dotenv
# false: ausschließlich lokale Anmeldung
# true: ausschließlich SSO
OIDC_ONLY=true

OIDC_ISSUER=https://auth.example.de
OIDC_CLIENT_ID=haben
OIDC_CLIENT_SECRET=<urspruengliches-clientsecret>
OIDC_DISPLAY_NAME=Authelia

OIDC_GROUPS_CLAIM=groups
OIDC_GROUP_INHABER=haben-inhaber
OIDC_GROUP_STEUERBERATUNG=haben-steuerberatung
```

Mit `OIDC_ONLY=true` sind Issuer, Client-ID, Clientsecret und beide Gruppen Pflicht; fehlt etwas, startet Haben nicht. Die Gruppen müssen verschieden sein und werden exakt verglichen (Groß-/Kleinschreibung zählt, keine Leerzeichen am Rand). `OIDC_GROUPS_CLAIM` nennt genau einen Claim auf oberster Ebene, keinen Pfad oder Ausdruck; ein URL-förmiger Name wie `https://haben.example.de/groups` ist erlaubt.

In Docker Compose stehen die Werte in der geschützten `.env` neben `compose.yml`, bei Quadlets in `haben.env` und das Clientsecret als Podman-Secret `haben-oidc-client-secret` (die vorbereitete `Secret=`-Zeile in `haben-app.container` einkommentieren). In **Coolify** die Werte als Laufzeit-Umgebungsvariablen der Anwendung setzen, das Clientsecret als „Secret“ markieren und neu deployen. `BETTER_AUTH_URL` muss der öffentlichen Adresse im Browser entsprechen, einschließlich eines Ports.

Haben lädt `${OIDC_ISSUER}/.well-known/openid-configuration`; der dort genannte Issuer muss exakt dem konfigurierten Wert entsprechen, UserInfo wird verwendet, wenn der Anbieter einen entsprechenden Endpunkt nennt. Anbieter und Haben laufen über HTTPS; HTTP ist nur auf Loopback außerhalb des Betriebs erlaubt. Hat der Anbieter ein Zertifikat einer eigenen CA, deren Datei über `NODE_EXTRA_CA_CERTS` in den Haben-Container geben. Die feste Callback-Adresse lautet:

```text
https://haben.example.de/api/auth/callback/oidc
```

### Scopes und andere Anbieter

`OIDC_SCOPES` legt durch Leerzeichen getrennte Scopes genau fest und muss `openid` enthalten. Ohne Angabe fragt Haben `openid profile email` an und ergänzt `groups` nur, wenn Discovery diesen Scope ausdrücklich unterstützt. Gruppen werden bevorzugt aus UserInfo gelesen, sonst aus dem geprüften ID-Token. Ein vorhandener ungültiger oder verweigernder Gruppenclaim erlaubt keinen Rückgriff. Die E-Mail muss die Form `name@domain` haben, auch Intranet-Domains und Umlaute sind zulässig; `email_verified=false` ebenfalls. Konten werden niemals über gleiche E-Mail-Adressen verbunden.

Alle Anbieter verwenden einen vertraulichen Client, Code-Flow, PKCE S256, `client_secret_basic` und die exakte Haben-Callback-Adresse.

| Anbieter | Einstellungen |
| --- | --- |
| Pocket ID | Beide Benutzergruppen zuordnen, Scopes `openid profile email groups`, Claim `groups`. [Clientbeispiele](https://pocket-id.org/docs/client-examples) |
| Authentik | Asymmetrischen **Signing Key** auswählen, etwa RS256. Ohne Key verwendet Authentik HS256; das unterstützt Haben nicht. Scope-Mapping muss `groups` als Array liefern. Issuer exakt aus Discovery übernehmen, typischerweise `https://auth.example.de/application/o/haben/` einschließlich Schrägstrich. [Providerdoku](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/) |
| Keycloak | Issuer `https://auth.example.de/realms/<realm>`, Client-Authentifizierung, Standard Flow und PKCE S256. `OIDC_SCOPES=openid profile email` und Group-Membership-Mapper mit Claim `groups` in UserInfo oder ID-Token. Bei **Full group path** Werte wie `/haben-inhaber` konfigurieren. [Client Scopes und Mapper](https://www.keycloak.org/docs/latest/server_admin/#_client_scopes) |

Nicht unterstützt sind reines OAuth 2.0 ohne OIDC-Discovery und SAML, Clients ohne Secret oder mit anderer Authentifizierung als `client_secret_basic`, signierte UserInfo-Antworten (`application/jwt`) und Gruppen in anderer Form als einem Array aus Zeichenketten auf oberster Ebene. Verschachtelte Claims wie `realm_access.roles` und die Rollen-Claims von Zitadel brauchen daher einen Mapper oder eine Action, die einen flachen Claim liefert. Bei Entra ID fehlt `groups` ab 200 Gruppen im Token (Overage); Haben ruft Microsoft Graph nicht ab und weist solche Konten ab. Für Entra ID außerdem den optionalen Claim `email` einrichten.

Scheitert eine Anmeldung, steht die Ursache mit dem Präfix `SSO:` oder `Better Auth:` im Server-Log, etwa `SSO: Token-Endpunkt antwortete 401, invalid_client`, ohne Codes, Tokens oder Claims.

Authelia ist die reale Referenzintegration. Pocket ID, Authentik und Entra-/Keycloak-Claimvarianten werden mit einem kontrollierten Testanbieter nachgestellt; das ersetzt keinen vollständigen Durchlauf gegen diese Server. Versionen und tatsächlich ausgeführte Referenzprüfungen stehen im jeweiligen Prüfbericht.

### Authelia konfigurieren

Authelia muss bereits als OIDC-Anbieter eingerichtet sein (Signaturschlüssel, HMAC-Secret und die übrige Pflichtkonfiguration). Für Haben die beiden Gruppen anlegen, Benutzer jeweils **genau einer** davon zuordnen und diesen vertraulichen Client ergänzen:

```yaml
authentication_backend:
  # Gruppen bei jeder Anfrage neu lesen, damit erneute OIDC-Durchläufe aktuelle Gruppen liefern
  refresh_interval: always

identity_providers:
  oidc:
    # Übrige Pflichtkonfiguration des OIDC-Anbieters bleibt erforderlich.
    clients:
      - client_id: haben
        client_name: Haben
        client_secret: '<HASH-DES-CLIENTSECRETS>'
        public: false
        authorization_policy: two_factor
        require_pkce: true
        pkce_challenge_method: S256
        redirect_uris:
          - https://haben.example.de/api/auth/callback/oidc
        scopes:
          - openid
          - profile
          - email
          - groups
        response_types:
          - code
        grant_types:
          - authorization_code
        token_endpoint_auth_method: client_secret_basic
```

Mit der Dateibackend-Variante (`authentication_backend.file`) stehen die Gruppen in der Benutzerdatei:

```yaml
users:
  inhaberin:
    displayname: Inhaberin
    email: inhaberin@example.de
    password: '<HASH>'
    groups:
      - haben-inhaber
  kanzlei:
    displayname: Kanzlei Muster
    email: kanzlei@example.de
    password: '<HASH>'
    groups:
      - haben-steuerberatung
```

In Haben steht das **ursprüngliche Clientsecret**, in Authelia dessen **Hash** (`authelia crypto hash generate pbkdf2`, das Secret interaktiv eingeben). Authelia liefert Gruppen und E-Mail über den UserInfo-Endpunkt, nicht im ID-Token ([Authelia: Claims](https://www.authelia.com/integration/openid-connect/openid-connect-1.0-claims/)); Haben fragt ihn nach jedem geprüften ID-Token ab und verlangt dort dasselbe Subject. Eine E-Mail-Adresse der Form `name@domain` ist erforderlich; der Bestätigungsclaim vergibt keine Rechte. Änderungen an LDAP oder Benutzerdatei müssen Authelia erreichen (bei der Datei `watch: true` oder Neustart). Siehe auch [Authelia: OIDC-Clients](https://www.authelia.com/configuration/identity-providers/openid-connect/clients/).

### Einrichten und anmelden

Bei einer **neuen Instanz** zeigt `/setup` nur **Mit Authelia einrichten**, ohne Einrichtungscode, Passwort oder Passkey. Die erste erfolgreiche Anmeldung eines Mitglieds der Inhaber-Gruppe richtet Haben für diesen Issuer ein. Mitglieder der Steuerberatungs-Gruppe können eine Instanz nicht erstmals einrichten.

Danach entsteht jedes Konto mit genau einer passenden Gruppe automatisch bei der ersten Anmeldung, ohne Einladung. Mehrere Inhaber sind möglich. Abgewiesen wird, wer keiner oder beiden Haben-Gruppen angehört oder einen fehlenden oder ungültigen Gruppen-Claim hat (erwartet ist ein Array aus Zeichenketten); andere Gruppen spielen keine Rolle.

Bei **jeder** Anmeldung bestimmt Haben die Rolle neu. Ändert sie sich (Beförderung oder Herabstufung), enden alle bisherigen Sitzungen dieses Kontos. Wird eine bekannte Identität wegen ihrer Gruppen abgewiesen, enden ihre SSO-Sitzungen ebenfalls. Lokale Sperren gibt es im SSO-Modus nicht; den Zugang regelt die Gruppenzuordnung.

### Höchstens 15 Minuten alte Berechtigungen

Eine Haben-Sitzung trägt die beim Callback bestätigte Rolle mit fester Frist von 15 Minuten ab der Prüfung. Die Laufzeit der Tokens des Anbieters spielt keine Rolle, Haben verwirft sie nach dem Callback. Aktivität oder die Verlängerung der Sitzung durch Better Auth verlängern diese Frist nicht. Danach verweigert Haben geschützte Zugriffe und führt zur Anmeldeseite; ein Klick auf **Mit Authelia anmelden** prüft die Gruppen erneut, bei bestehender Authelia-Sitzung ohne neue Passworteingabe. Schreibende Anfragen werden nicht automatisch wiederholt.

Das heißt auch:

- Eine Änderung der Gruppen wirkt spätestens nach 15 Minuten, bei der nächsten Anmeldung sofort.
- Abmelden oder Sperren in Authelia beendet eine laufende Haben-Sitzung **nicht sofort**; es gibt keine zentrale Abmeldung. Die Berechtigung läuft spätestens nach 15 Minuten aus.
- Fällt der Anbieter aus, sind keine neuen und keine erneuten Anmeldungen möglich; es gibt keinen lokalen Rückfall. Ist er beim Start von Haben noch nicht erreichbar, holt Haben die Discovery bei der nächsten Anmeldung nach; ein Neustart ist nicht nötig.
- Haben speichert keine Access-, Refresh- oder ID-Tokens und fragt Authelia nicht im Hintergrund ab.
- API-, MCP- und Kalender-Tokens werden bei erkanntem Entzug des Verantwortlichen deaktiviert; siehe unten.

### Zugänge

**Einstellungen › Zugänge** ersetzt im SSO-Modus den Bereich **Sicherheit**. Er zeigt die Konten, die sich schon angemeldet haben, mit der zuletzt bestätigten Rolle und der letzten Anmeldung, und verweist für die Verwaltung auf Authelia. Er ist kein Abbild des Authelia-Verzeichnisses: Wer noch nie angemeldet war, erscheint nicht. Einladen, Sperren, Freigeben und Entfernen gibt es nicht, auch nicht über die Server-Schnittstelle. Alte Einladungslinks zeigen „Einladungen nicht verfügbar“; die Einladungen bleiben für einen späteren Standardbetrieb gespeichert. Alte Links auf `?bereich=sicherheit` führen nach **Zugänge**.

### Bestehende Instanz umstellen

Gespeicherte lokale Zugangsdaten bleiben beim Wechsel erhalten, alle Sitzungen der bisherigen Betriebsart werden ungültig. Haben führt Konten **nicht** anhand gleicher E-Mail-Adressen zusammen: Meldet sich jemand mit der E-Mail eines bestehenden, nicht zugeordneten Kontos an, lehnt Haben ab und verweist auf die Übernahme durch den Betreiber. Unverknüpfte lokale Konten erhalten im SSO-Modus keinen Zugang, verhindern aber den Start nicht.

Damit das bestehende Konto (und damit seine Belege, sein Audit-Verlauf und seine Konto-ID) weiterverwendet wird, ordnet der Betreiber es **bei gestoppter Anwendung** ausdrücklich einer Identität zu. Das Subject (`sub`) anhand der Identitätsausgabe des Anbieters nachweisen, siehe unten. Die Konto-ID steht unter `id` in der Haben-Tabelle `"user"`.

```sh
docker compose stop app
# erst prüfen, nichts ändern
docker compose run --rm --entrypoint bun app apps/web/src/server/db/sso-uebernahme.ts --konto <Konto-ID> --subject <sub>
# dann ausdrücklich übernehmen
docker compose run --rm --entrypoint bun app apps/web/src/server/db/sso-uebernahme.ts --konto <Konto-ID> --subject <sub> --uebernehmen
docker compose start app
```

Die Übernahme ordnet nur dem konfigurierten Issuer zu, verweigert ein schon vergebenes Subject und läuft nicht, solange Haben läuft. Sie steht im Änderungsprotokoll (`sso_takeovers`) und vergibt **keine** Rolle: Die kommt bei der nächsten Anmeldung aus der Gruppe. Bestehende exakte Issuer-/Subject-Zuordnungen melden weiterhin dasselbe Konto an; eine erneute Übernahme ist nicht erforderlich.

Führt der Anbieter dasselbe Konto mit einem **neuen Subject**, etwa weil es dort neu angelegt wurde, endet die Anmeldung mit dem Hinweis auf ein vorhandenes Konto. Dann bei gestoppter Anwendung `--ersetzen` angeben:

```sh
docker compose stop app
# erst prüfen, nichts ändern; die Ausgabe nennt das bisherige und das neue Subject
docker compose run --rm --entrypoint bun app apps/web/src/server/db/sso-uebernahme.ts --konto <Konto-ID> --subject <neues-sub> --ersetzen
# dann ausdrücklich ersetzen
docker compose run --rm --entrypoint bun app apps/web/src/server/db/sso-uebernahme.ts --konto <Konto-ID> --subject <neues-sub> --ersetzen --uebernehmen
docker compose start app
```

Die bisherige Identität dieses Issuers wird entfernt, ihre Sitzungen und die bestätigte Rolle enden, und `sso_takeovers` nennt das alte Subject. API-Tokens und Kalender-Abo gelten erst wieder nach der ersten Anmeldung mit dem neuen Subject. Vor dem Ersetzen belegen, dass das neue Subject dieselbe Person ist: Wer die Zuordnung bekommt, erhält das Konto mit allen Daten.

### Tokens nach Gruppenentzug

API/MCP-Tokens und das Kalender-Abo haben einen ursprünglichen Ersteller und einen aktuell verantwortlichen Inhaber. Verliert dieser bei einer geprüften Anmeldung die Inhaberrolle, deaktiviert Haben seine Tokens und erhält deren Hash, Rechte und Frist. **Ohne erneute Anmeldung erkennt Haben einen Gruppenentzug nicht. Deshalb gilt ein Token höchstens 30 Tage nach der letzten bestätigten Anmeldung seines Verantwortlichen;** danach zeigt die Verwaltung „unbestätigt“, bis er sich wieder anmeldet oder jemand den Zugang übernimmt. Dasselbe gilt nach einem Moduswechsel für Tokens eines Kontos, das in der neuen Betriebsart keine Identität hat. Die 15-Minuten-Frist betrifft interaktive Sitzungen.

Ein **anderer** aktuell berechtigter Inhaber kann deaktivierte oder unbestätigte Tokens in ihrer bisherigen Verwaltung ausdrücklich **übernehmen und reaktivieren**. Er wird verantwortlich; das bisherige Geheimnis beziehungsweise der Kalender-Link bleibt gültig. Ein späterer Entzug dieses neuen Verantwortlichen deaktiviert den Zugang erneut. Rückkehr in die Gruppe reaktiviert nichts automatisch. Gibt es keinen anderen aktuell bestätigten Inhaber, darf der Verantwortliche seine eigenen Tokens selbst reaktivieren, sonst blieben sie etwa nach einem vorübergehend fehlenden Gruppen-Claim unbrauchbar. Endgültig widerrufene oder abgelaufene Tokens bleiben unbrauchbar.

Beim Update werden bestehende Tokens dem bisherigen Inhaber zugeordnet und bleiben aktiv. Nur ohne Inhaber bleiben sie gespeichert, werden aber deaktiviert und benötigen eine ausdrückliche Übernahme. Die Verwaltung zeigt Verantwortlichen, Zustand und Grund; Verwaltungsereignisse stehen ohne Geheimnisse im Audit.

### Zurück zum Standardmodus

Auch rein per SSO eingerichtete Instanzen lassen sich ohne erreichbaren IdP auf lokale Anmeldung umstellen. Zuerst Backup erstellen und **alle Haben-Instanzen stoppen**. Dann ein vorhandenes Konto anhand seiner Konto-ID ausdrücklich als lokalen Inhaber vorbereiten:

```sh
docker compose stop app
# Nur prüfen, keine Änderungen:
docker compose run --rm --no-deps --entrypoint bun app apps/web/src/server/db/local-owner.ts --konto <Konto-ID>
# Ohne vorhandenen lokalen Zugang: Passwort über geschützten Eingabekanal übergeben.
docker compose run --rm --no-deps -T --entrypoint bun app apps/web/src/server/db/local-owner.ts --konto <Konto-ID> --uebernehmen --passwort-stdin < /geschuetzt/passwort
```

Die nur für dich lesbare Eingabedatei enthält ein Passwort mit mindestens 12 Zeichen. Kein Passwort in Kommandozeilenargumente, Shell-Historie oder Logs schreiben. Sind Passwort oder Passkey vorhanden, reicht `--uebernehmen` ohne Passworteingabe; ein übergebenes Passwort ersetzt ein vorhandenes. Konten der Steuerberatung werden nicht zum Inhaber. Ein anderer vorhandener lokaler Inhaber wird nicht ersetzt. Das Werkzeug erhält Konto-ID, SSO-Zuordnungen und Buchhaltungsdaten, protokolliert die Vorbereitung und entwertet Sitzungen. Danach `OIDC_ONLY=false` setzen und neu starten. Bis zum Moduswechsel bleibt lokale Anmeldung gesperrt; eine öffentliche Notanmeldung gibt es nicht.

Bei **Quadlet** mit `systemctl --user stop haben-app` stoppen. Einen einmaligen Container aus demselben Image mit der Netzwerk-, Umgebungsdatei- und Datenbank-Secret-Konfiguration aus `haben-app.container` starten, den Entrypoint auf `bun` setzen und `apps/web/src/server/db/local-owner.ts` mit den obigen Argumenten ausführen. Das Passwort ausschließlich über geschützte Standardeingabe übergeben. Anschließend `haben.env` ändern und `systemctl --user start haben-app` ausführen. Für die SSO-Übernahme denselben einmaligen Container mit `sso-uebernahme.ts --konto <ID> --subject <sub> --uebernehmen` verwenden.

In **Coolify** die Anwendung stoppen und den Betreiberbefehl auf dem Server als einmaligen Container aus demselben Image mit derselben Datenbankkonfiguration ausführen. Kein Exec in eine weiterhin laufende Haben-Instanz verwenden: Der exklusive Lock muss erfolgreich sein. Danach die Laufzeitvariable ändern und über Coolify neu starten. Weder Passwörter noch Secrets in Coolify-Befehlsprotokolle kopieren. Der Rückweg benötigt nur `DATABASE_URL`, nicht die Erreichbarkeit des IdP.

### Identitäten, Datenschutz und Betrieb

Beim Wechsel einer bestehenden Instanz erhält die erste erfolgreiche Inhaber-Anmeldung unmittelbar Zugriff auf vorhandene Daten. Deshalb Client, Issuer und Gruppen vor Aktivierung kontrollieren und bestehende Konten ausdrücklich übernehmen.

Das Subject muss belegbar zum Haben-Client gehören, etwa aus `authelia storage user identifiers export --config /config/configuration.yml`. Bei Keycloak ist es ohne eigenen Mapper die ID des Benutzers in der Admin-Konsole. Bei paarweisen Subjects den zum Client beziehungsweise Sector passenden Eintrag verwenden; E-Mail und Benutzername sind kein Ersatz für `sub`. Eine bereits gespeicherte exakte Kombination aus Issuer und Subject meldet weiterhin dasselbe Konto an. Eine erneute Übernahme derselben Zuordnung wird als bereits vorhanden abgewiesen, ein neues Subject braucht `--ersetzen`. Ein anderer Issuer, etwa nach einem Domainwechsel, benötigt neue ausdrückliche Zuordnungen je Konto.

Haben speichert Name und E-Mail beim ersten Login, Issuer und Subject, zuletzt bestätigte Rolle und Prüfzeitpunkt sowie IP und User-Agent der Sitzung. Vollständige Claims und Provider-Tokens werden nicht dauerhaft gespeichert. Uhren per NTP synchronisieren: Die Tokenprüfung bietet keine zusätzliche Ablauf-Toleranz. Backup und Restore müssen Datenbank, Secrets und denselben Issuer zusammen erhalten; abweichende Issuer benötigen eine bewusste Übernahme.

## Passkeys und Domain

Passkeys sind an den Hostnamen aus `BETTER_AUTH_URL` gebunden. Ziehst du Haben auf eine andere Domain um, funktionieren die alten Passkeys dort nicht mehr. Melde dich dann mit E-Mail und Passwort an und lege unter Einstellungen neue Passkeys an. `BETTER_AUTH_URL` muss genau die Adresse sein, die im Browser steht, inklusive `https://`.

## Häufige Probleme

**Die App zeigt nur einen Fehler, im Log steht ein Zod-Fehler zu einer Variablen.** Die Umgebung besteht die Prüfung in `env.ts` nicht. Häufig: `ELSTER_HERSTELLER_ID` hat nicht genau fünf Ziffern, `HABEN_ENCRYPTION_KEY` ist nicht genau 32 Byte base64 oder `BETTER_AUTH_SECRET` ist kürzer als 32 Zeichen.

**`haben-app` startet nicht, Fehler beim Mount von `/opt/eric`.** Podman bricht ab, wenn das Quellverzeichnis eines Bind-Mounts fehlt. Lege ERiC dort ab oder lass die `Volume`-Zeile auskommentiert.

**„DATABASE_URL fehlt“ oder Verbindungsfehler beim Start.** Das Secret `haben-database-url` fehlt oder das Passwort darin passt nicht zu `haben-db-password`. Beachte: Postgres übernimmt `POSTGRES_PASSWORD` nur beim ersten Anlegen des Volumes. Ein später geändertes Secret ändert das Passwort in der Datenbank nicht.

**Passkey-Anmeldung schlägt fehl.** Meist passt `BETTER_AUTH_URL` nicht zur aufgerufenen Adresse (anderer Hostname, `http` statt `https`, Port). Mit Passwort anmelden geht unabhängig davon. Die Anmeldung ist auf 20 Anfragen pro Minute begrenzt.

**„Haben ist bereits eingerichtet.“** Im Standardmodus hat Haben genau einen Inhaber. Ein zweites Konto entsteht nur über einen Einladungslink für die [Steuerberatung](steuerberatung.md), weder mit dem Einrichtungscode noch über die API.

**Die Oberfläche meldet „ERiC ist nicht eingerichtet“.** Unter **Einstellungen › ELSTER › ERiC** herunterladen. Hast du ERiC von Hand eingebunden, ist `ERIC_HOME` in der App nicht gesetzt; prüfe `.env` bzw. `haben.env` und starte die App neu.

**Der ERiC-Download scheitert.** Die Meldung steht unter **Einstellungen › ELSTER › ERiC**. „Gibt es nicht (mehr)“ heißt: Die Version ist zu alt oder vertippt; die aktuelle steht auf der Infoseite. Der Server muss `download.elster.de` per HTTPS erreichen und für die Dauer des Downloads etwa 600 MB im temporären Verzeichnis frei haben.

**Die Vorschau von Belegen, Rechnungen oder Angeboten bleibt leer oder zeigt „Verbindung abgelehnt“.** Die Vorschau ist ein eingebettetes Fenster (iframe) auf derselben Adresse. Setzt der Reverse Proxy `X-Frame-Options DENY`, verbietet das auch diese Einbettung. Stell den Header auf `SAMEORIGIN` um (so steht es im mitgelieferten `Caddyfile` und in `compose.yml`); vor Clickjacking durch fremde Seiten schützt die App selbst mit `Content-Security-Policy: frame-ancestors 'self'`. Bei Caddy mit einzeln gemounteter `Caddyfile` (Quadlet) reicht nach dem Bearbeiten `caddy reload` nicht: Editoren und `sed -i` legen eine neue Datei an, der Bind-Mount zeigt weiter auf die alte. Starte den Container neu (`systemctl --user restart haben-caddy` bzw. ohne `--user` bei rootful Podman).

**„download.elster.de nicht erreichbar: …“, obwohl der Server ins Internet kommt.** In Klammern steht der Grund. `EAI_AGAIN` oder `ENOTFOUND` heißt: Der Container löst keine Namen auf. Prüfen mit `podman exec haben-app bun -e 'require("dns").promises.lookup("download.elster.de").then(console.log,console.error)'` (Compose: `docker compose exec app bun -e …`). Kommt `EAI_AGAIN`, beantwortet der DNS-Dienst des Podman-Netzes (aardvark-dns) zwar `haben-db`, leitet externe Namen aber nicht weiter. Das passiert, wenn sich nach dem Start die DNS-Server des Hosts ändern (`/etc/resolv.conf`, z. B. nach einem Netzwerk-Neustart). Sofort hilft `podman network reload --all` (rootful) bzw. ein Neustart der Container. Dauerhaft trägst du in `haben.network` einen festen DNS-Server ein, etwa deinen Router: `DNS=192.168.178.1`. Danach Container stoppen, `podman network rm haben` und neu starten. `ECONNREFUSED` oder `ETIMEDOUT` deuten auf eine Firewall oder einen Proxy, ein Zertifikatsfehler auf einen TLS-Proxy mit eigener CA. Dieselben Gründe nennt Haben auch, wenn Enable Banking nicht erreichbar ist.

**ERiC ist eingerichtet, aber Prüfen oder Senden scheitert sofort.** Bei einem von Hand eingebundenen ERiC prüfe, ob unter `ERIC_HOME` die Dateien `lib/libericapi.so` und `lib/plugins/` (ältere Versionen: `lib/plugins2/`) liegen und ob das Paket für Linux x86_64 ist. Ein Absturz der Bibliothek beendet nur den Kindprozess; die App zeigt die Meldung an. Details stehen in den ERiC-Logs unter `ERIC_LOG_DIR`.

**Auf arm64: „ERiC-Prozess abgestürzt“ mit `ERIC_WORKER_COMMAND`.** Steht „x86_64-Laufzeit für ERiC ist Version …“ dabei, `einrichten.sh` mit der Version der App wiederholen. „QEMU internal SIGSEGV“ heißt: QEMU ist älter als Version 9. „MemoryExhaustion“ kommt, wenn der Worker ohne `worker.sh` direkt mit QEMU gestartet wird. Exit-Code 127: Der Pfad in `ERIC_WORKER_COMMAND` stimmt nicht oder das Verzeichnis ist nicht gemountet. Siehe [ELSTER auf arm64](#elster-auf-arm64).

**Echtübermittlung ist ausgegraut.** Es fehlt `ELSTER_HERSTELLER_ID`. Siehe [Erste Schritte](einrichtung.md#elster-einrichten).

**Belege werden nicht automatisch ausgelesen.** Ohne `ANTHROPIC_API_KEY` oder `EXTRACTION_BASE_URL` liest Haben nur E-Rechnungen. Ist eins davon gesetzt, steht der Grund eines Fehlers am Beleg. Welcher Anbieter gilt, zeigt **Einstellungen › KI-Assistenten und API**.

**„Der KI-Dienst unter … ist nicht erreichbar.“** Der Container erreicht den eigenen Dienst nicht. Meist steht `localhost` in `EXTRACTION_BASE_URL` (im Container ist das der Container selbst) oder der Dienst lauscht nur auf `127.0.0.1`. Siehe [Den Dienst aus dem Container erreichen](#den-dienst-aus-dem-container-erreichen).

**„Der KI-Dienst kennt das Modell … nicht.“** Das Modell ist beim Dienst nicht geladen (`ollama pull …`), der Name ist anders geschrieben als beim Anbieter (bei OpenRouter etwa mit Präfix wie `qwen/…`) oder die Basis-URL endet nicht auf `/v1` (bei OpenRouter `/api/v1`).

**„Die Antwort des KI-Dienstes passt nicht zum Belegschema.“** Das Modell hat kein gültiges JSON mit den Belegfeldern geliefert. Erneut auslesen hilft manchmal; sonst ein größeres oder ein anderes Vision-Modell wählen. Der Beleg wird nicht gebucht, die Felder füllst du von Hand aus.

**restic meldet beim Sichern der Belege „permission denied“.** Das passiert mit dem früheren Host-Skript `~/.config/haben/backup.sh`: Bei rootless Podman gehören die Dateien im Volume einer Unter-UID des Hosts, nicht deinem Nutzer. Das Backup läuft inzwischen im Container `haben-backup`, der das Volume selbst einhängt; stell um wie unter [Umzug vom Host-Skript der Quadlets](#umzug-vom-host-skript-der-quadlets). Prüfe danach mit `journalctl --user -u haben-backup`, ob der Lauf durchging.

**`systemctl --user enable haben-backup.timer` findet die Unit nicht.** Der Timer gehört nach `~/.config/systemd/user/`, nicht ins Quadlet-Verzeichnis; `haben-backup.container` dagegen ins Quadlet-Verzeichnis, daraus erzeugt Podman `haben-backup.service`. Danach `systemctl --user daemon-reload`.

Weiter: [Erste Schritte](einrichtung.md) · [Entwicklung](entwicklung.md) · [Zurück zur Übersicht](ueberblick.md)
