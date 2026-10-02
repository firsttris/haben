# Betrieb und Installation

Diese Seite beschreibt, wie du Haben auf einem eigenen Server betreibst: mit Docker Compose (am einfachsten) oder mit Podman Quadlets unter systemd, dazu Umgebungsvariablen, Backup und Updates. Was du danach in der Oberfläche einrichtest, steht in [Erste Schritte](einrichtung.md).

## Überblick

Haben läuft als drei Container in einem eigenen Netz:

| Container (Compose / Quadlet) | Image | Aufgabe |
| --- | --- | --- |
| `db` / `haben-db` | `postgres:16` | Datenbank, Volume `db` bzw. `haben-db` |
| `app` / `haben-app` | `tristanteu/haben:latest` | Die App auf Port 3000, Belegdateien im Volume `belege` bzw. `haben-belege`, ERiC-Logs im Volume `eric-log` bzw. `haben-eric-log` |
| `caddy` / `haben-caddy` | `caddy:2` | TLS und Reverse Proxy auf Port 80/443, Zertifikate im Volume `caddy` bzw. `haben-caddy` |

Es gibt zwei Wege, sie zu betreiben:

| Weg | Gut für | Dateien |
| --- | --- | --- |
| [Docker Compose](#docker-compose) | Schnell startklar, Docker oder Podman mit Compose | `deploy/compose.yml`, `deploy/compose.env.example` |
| [Podman Quadlets](#podman-quadlets) | Rootless unter systemd, Secrets statt Datei, täglicher Backup-Timer, `podman auto-update` | `deploy/quadlet/*`, `deploy/Caddyfile`, `deploy/haben.env.example`, `deploy/backup.sh` |

Beide holen die Dateien per `curl`; das Repository musst du nicht klonen.

## Voraussetzungen

- Ein Linux-Server (x86_64, wenn du ERiC nutzen willst) mit Docker und Compose 2.23 oder neuer, oder mit Podman und systemd. Die Quadlets sind für den Betrieb als normaler Nutzer (rootless) geschrieben, die Pfade nutzen `%h` bzw. `~/.config`.
- Eine Domain, die auf den Server zeigt, und erreichbare Ports 80 und 443. Caddy holt das TLS-Zertifikat selbst.
- HTTPS ist Pflicht: Passkeys und die Installation als App (PWA) funktionieren nur über eine sichere Verbindung.
- Für ELSTER das ERiC-Paket für Linux x86_64 (siehe [ERiC einbinden](#eric-einbinden)).
- Für das Backup mit Quadlets `restic` auf dem Host.

> [!NOTE]
> Nur Podman: Rootless Podman darf Ports unter 1024 standardmäßig nicht öffnen. Entweder du senkst die Grenze (`sysctl net.ipv4.ip_unprivileged_port_start=80`) oder du veröffentlichst Caddy auf anderen Ports und leitest weiter. Damit die Dienste ohne angemeldete Sitzung laufen, braucht der Nutzer außerdem `loginctl enable-linger`.

## Image

Das fertige Image gibt es für amd64 und arm64 auf Docker Hub und in der GitHub Container Registry:

| Image | Inhalt |
| --- | --- |
| `docker.io/tristanteu/haben:latest` | Letzte veröffentlichte Version (Standard in Compose und Quadlet) |
| `docker.io/tristanteu/haben:0.1` / `:0.1.0` | Feste Version, wenn du Updates selbst steuern willst |
| `docker.io/tristanteu/haben:edge` | Stand von `main`, nur zum Ausprobieren |
| `ghcr.io/firsttris/haben:…` | Dieselben Tags bei GitHub |

ERiC ist nicht enthalten, weil es nicht weitergegeben werden darf; es wird zur Laufzeit nach `/opt/eric` gemountet. ERiC gibt es nur für Linux x86_64: Auf arm64 (z. B. Raspberry Pi) läuft alles außer der ELSTER-Übermittlung.

Selbst bauen geht auch, zum Beispiel für einen eigenen Stand. Dafür brauchst du das Repository; danach in `compose.yml` `image: haben` bzw. in `haben-app.container` `Image=localhost/haben:latest` eintragen:

```sh
git clone https://github.com/firsttris/haben.git && cd haben
podman build -t haben -f Containerfile .   # oder docker build
```

Das `Containerfile` baut die App in zwei Stufen auf Basis von `node:22-bookworm-slim`.

Das Image läuft als Nutzer `node` und setzt diese Werte schon selbst: `NODE_ENV=production`, `PORT=3000`, `DOCUMENTS_DIR=/var/lib/haben/belege`, `ERIC_LOG_DIR=/var/lib/haben/eric-log`, `ERIC_WORKER_PATH` und `HABEN_EINVOICE_DIR`.

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
| `ERIC_HOME`, `ELSTER_HERSTELLER_ID`, `ANTHROPIC_API_KEY` | optional, siehe [Umgebungsvariablen](#umgebungsvariablen) |

```sh
docker compose up -d
docker compose logs -f app   # „Migrationen angewendet“, dann „Listening on …“
```

Die Caddy-Konfiguration steckt in `compose.yml` selbst (mit Sicherheits-Headern wie im `Caddyfile`). Für ERiC entpackst du das Paket nach `/opt/eric`, kommentierst in `compose.yml` die Zeile `- /opt/eric:/opt/eric:ro` ein und setzt `ERIC_HOME=/opt/eric` in `.env`.

**Updates:** `docker compose pull && docker compose up -d`. Migrationen laufen beim Start der App.

**Backup:** Sichere die Datenbank und das Volume mit den Belegen, zum Beispiel per Cronjob:

```sh
docker compose exec -T db pg_dump -U haben haben | gzip > haben-$(date +%F).sql.gz
docker run --rm -v haben_belege:/belege:ro -v "$PWD":/backup alpine tar czf /backup/belege-$(date +%F).tar.gz -C /belege .
```

Beides gehört anschließend auf ein zweites System, etwa mit restic wie im Quadlet-Backup unten. Zum Wiederherstellen erst nur `docker compose up -d db` starten, den Dump mit `gunzip -c … | docker compose exec -T db psql -U haben -d haben` einspielen, die Belege mit `tar xzf` ins Volume `haben_belege` entpacken und danach `docker compose up -d` ausführen.

## Podman Quadlets

Die Quadlets betreiben Haben rootless unter systemd: Zugangsdaten als Podman Secrets, ein täglicher Backup-Timer mit restic und Updates über `podman auto-update`.

### Dateien ablegen

```sh
RAW=https://raw.githubusercontent.com/firsttris/haben/main/deploy
mkdir -p ~/.config/containers/systemd ~/.config/systemd/user ~/.config/haben
for f in haben.network haben-db.volume haben-belege.volume haben-eric-log.volume haben-caddy.volume \
         haben-db.container haben-app.container haben-caddy.container; do
  curl -o ~/.config/containers/systemd/$f "$RAW/quadlet/$f"
done
curl -o ~/.config/systemd/user/haben-backup.service "$RAW/quadlet/haben-backup.service"
curl -o ~/.config/systemd/user/haben-backup.timer "$RAW/quadlet/haben-backup.timer"
curl -o ~/.config/haben/Caddyfile "$RAW/Caddyfile"
curl -o ~/.config/haben/haben.env "$RAW/haben.env.example"
curl -o ~/.config/haben/backup.sh "$RAW/backup.sh" && chmod +x ~/.config/haben/backup.sh
curl -o ~/.config/haben/restore.sh "$RAW/restore.sh" && chmod +x ~/.config/haben/restore.sh
```

Die `.container`-, `.volume`- und `.network`-Dateien verarbeitet der Quadlet-Generator von Podman. `haben-backup.service` und `haben-backup.timer` sind gewöhnliche systemd-Units und gehören deshalb nach `~/.config/systemd/user/`.

### Secrets anlegen

Zugangsdaten liegen nicht in `haben.env`, sondern als Podman Secrets. Die Quadlets reichen sie als Umgebungsvariablen in die Container.

```sh
DBPW="$(openssl rand -hex 24)"
printf '%s' "$DBPW" | podman secret create haben-db-password -
printf 'postgres://haben:%s@haben-db:5432/haben' "$DBPW" | podman secret create haben-database-url -
openssl rand -base64 32 | tr -d '\n' | podman secret create haben-auth-secret -
openssl rand -base64 32 | tr -d '\n' | podman secret create haben-encryption-key -
```

| Secret | Variable im Container | Inhalt |
| --- | --- | --- |
| `haben-db-password` | `POSTGRES_PASSWORD` (in `haben-db`) | Passwort des Datenbanknutzers `haben` |
| `haben-database-url` | `DATABASE_URL` | Verbindung zur Datenbank, Passwort wie oben |
| `haben-auth-secret` | `BETTER_AUTH_SECRET` | Signiert die Sitzungen |
| `haben-encryption-key` | `HABEN_ENCRYPTION_KEY` | Schlüssel für ELSTER-Zertifikat und Lexoffice-API-Schlüssel |
| `haben-anthropic-key` (optional) | `ANTHROPIC_API_KEY` | Für die KI-Auslesung, siehe unten |

> [!IMPORTANT]
> Sichere `HABEN_ENCRYPTION_KEY` getrennt vom Backup, zum Beispiel im Passwortmanager. Haben verschlüsselt damit das ELSTER-Zertifikat und den Lexoffice-API-Schlüssel (AES-256-GCM). Ohne den Schlüssel sind beide nach einer Wiederherstellung nicht mehr lesbar. Das Backup-Skript sichert ihn nicht mit. Den Wert liest du aus, solange der Container läuft: `podman exec haben-app printenv HABEN_ENCRYPTION_KEY`.

### Konfiguration

In `~/.config/haben/haben.env` stehen die Werte, die nicht geheim sind. Mindestens die Domain anpassen:

```sh
BETTER_AUTH_URL=https://haben.example.de
```

Im `Caddyfile` dieselbe Domain eintragen (erste Zeile `haben.example.de {`). Caddy leitet alles an `haben-app:3000` weiter und setzt HSTS, `X-Content-Type-Options`, `Referrer-Policy` und `X-Frame-Options`.

> [!NOTE]
> Leere Zeilen wie `ELSTER_HERSTELLER_ID=` gelten als nicht gesetzt. Trag die Hersteller-ID erst ein, wenn du sie hast; sie muss dann genau fünf Ziffern haben.

### Starten

```sh
systemctl --user daemon-reload
systemctl --user start haben-db haben-app haben-caddy
systemctl --user enable --now haben-backup.timer
```

Die Container-Units starten über `[Install] WantedBy=default.target` beim nächsten Boot von selbst, sobald `daemon-reload` gelaufen ist. Logs liest du mit `journalctl --user -u haben-app` (bzw. `haben-db`, `haben-caddy`).

Danach rufst du die Domain im Browser auf und legst das Konto an, siehe [Erste Schritte](einrichtung.md).

## Umgebungsvariablen

Die App prüft ihre Variablen in `apps/web/src/server/env.ts` beim ersten Zugriff. Ein Fehler steht dann im Log von `haben-app`.

| Variable | Pflicht | Bedeutung | Beispiel |
| --- | --- | --- | --- |
| `DATABASE_URL` | ja | PostgreSQL-Verbindung. Wird auch vom Migrationsschritt beim Start gelesen | `postgres://haben:…@haben-db:5432/haben` |
| `BETTER_AUTH_SECRET` | ja | Geheimnis für Sitzungen, mindestens 32 Zeichen | Ausgabe von `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | ja | Öffentliche Adresse, unter der Haben im Browser läuft. Bestimmt die Domain der Passkeys | `https://haben.example.de` |
| `HABEN_ENCRYPTION_KEY` | ja | Genau 32 Byte, base64-kodiert. Verschlüsselt ELSTER-Zertifikat und Lexoffice-Schlüssel | Ausgabe von `openssl rand -base64 32` |
| `ERIC_HOME` | nein | Verzeichnis des entpackten ERiC-Pakets. Leer oder nicht gesetzt: Prüfen und Senden werden simuliert | `/opt/eric` |
| `ERIC_LOG_DIR` | nein | Logverzeichnis für ERiC. Ohne Angabe das temporäre Verzeichnis; im Image `/var/lib/haben/eric-log` | `/var/lib/haben/eric-log` |
| `ERIC_WORKER_PATH` | nein | Pfad zum ERiC-Worker (`packages/elster/src/worker.ts`). Im Image gesetzt, sonst nicht nötig | `/app/packages/elster/src/worker.ts` |
| `ELSTER_HERSTELLER_ID` | nein | Eigene Hersteller-ID, genau fünf Ziffern. Ohne sie ist nur die Testübermittlung möglich | `12345` |
| `DOCUMENTS_DIR` | nein | Ablage der Belegdateien. Standard `data/belege` (relativ zum Arbeitsverzeichnis); im Image `/var/lib/haben/belege` | `/var/lib/haben/belege` |
| `ANTHROPIC_API_KEY` | nein | Schaltet die KI-Auslesung von Belegen ein | `sk-ant-…` |
| `HABEN_SCHEDULER` | nein | `off` schaltet die stündlichen Hintergrundjobs ab (wiederkehrende Rechnungen), etwa für eine zweite Instanz auf derselben Datenbank | `off` |
| `LEXOFFICE_API_URL` | nein | Andere Basis-URL der Lexware-Office-API. Standard `https://api.lexware.io/v1` | `https://api.lexoffice.io/v1` |
| `PORT` | nein | Port des App-Servers, im Image `3000` | `3000` |
| `HABEN_EINVOICE_DIR` | nein | Verzeichnis von `packages/einvoice` (Typst-Vorlage und Schriften für das Rechnungs-PDF). Im Image gesetzt | `/app/packages/einvoice` |

Bei Compose setzt `compose.yml` diese Variablen aus `.env` (`DATABASE_URL` aus `DB_PASSWORD`, `BETTER_AUTH_URL` aus `DOMAIN`, `BETTER_AUTH_SECRET` aus `AUTH_SECRET`, `HABEN_ENCRYPTION_KEY` aus `ENCRYPTION_KEY`). Bei den Quadlets kommen die geheimen Werte aus Podman Secrets, der Rest aus `haben.env`; für den Datenbank-Container setzt das Quadlet `POSTGRES_USER=haben` und `POSTGRES_DB=haben`, das Passwort kommt aus dem Secret `haben-db-password`.

## Datenablage

| Was | Wo |
| --- | --- |
| Buchungen, Rechnungen (PDF und XML), Voranmeldungen mit ERiC-Protokoll, Audit-Log, verschlüsseltes ELSTER-Zertifikat, verschlüsselter Lexoffice-Schlüssel | PostgreSQL, Volume `haben-db` |
| Belegdateien und aus Lexoffice übernommene Dateien | Volume `haben-belege` (`DOCUMENTS_DIR`), abgelegt unter dem SHA-256 der Datei (`ab/abcdef…`) |
| ERiC-Logs | Volume `haben-eric-log` (Compose: `eric-log`), im Container `/var/lib/haben/eric-log` (`ERIC_LOG_DIR`). Nur zur Fehlersuche, nicht im Backup |
| TLS-Zertifikate von Caddy | Volume `haben-caddy` |

Belege und Rechnungen müssen nach GoBD zehn Jahre aufbewahrt werden. Beide Volumes mit Buchhaltungsdaten gehören deshalb ins Backup.

## Backup

Für Compose steht das Backup oben bei [Docker Compose](#docker-compose). Mit den Quadlets läuft `deploy/backup.sh` über `haben-backup.timer` täglich um 03:15 Uhr (`Persistent=true`: ein verpasster Lauf wird nachgeholt). Das Skript

1. erzeugt mit `podman exec haben-db pg_dump -U haben --format=plain haben` einen SQL-Dump und packt ihn mit gzip,
2. sichert den Dump und das Verzeichnis des Volumes `haben-belege` mit `podman unshare restic backup --tag haben`. Im rootless Podman gehören die Belegdateien einer Unter-UID des Containers; `podman unshare` führt restic im Benutzer-Namensraum aus, wo sie lesbar sind und ihre Besitzer behalten,
3. räumt alte Stände auf: 14 tägliche, 24 monatliche und 11 jährliche Snapshots bleiben (`restic forget --prune`).

Die Volumes `haben-caddy` und `haben-eric-log` und der Schlüssel `HABEN_ENCRYPTION_KEY` sind nicht dabei.

Die Unit liest `~/.config/haben/backup.env`. Darin stehen die Angaben für restic:

```sh
RESTIC_REPOSITORY=sftp:backup@example.de:/srv/restic/haben
RESTIC_PASSWORD_FILE=/home/haben/.config/haben/restic-password
```

Das Repository legst du einmal mit `restic init` an. Einen Lauf von Hand startest du mit `systemctl --user start haben-backup.service`, das Ergebnis steht in `journalctl --user -u haben-backup`.

### Wiederherstellen

Für die Quadlets liegt `deploy/restore.sh` bei. Du hast es beim [Ablegen der Dateien](#dateien-ablegen) neben `backup.sh` nach `~/.config/haben/` geladen. Es erwartet dieselben Angaben für restic wie das Backup, also `RESTIC_REPOSITORY` und `RESTIC_PASSWORD_FILE` aus `backup.env` in der Umgebung, und einen laufenden Container `haben-db`:

```sh
set -a; . ~/.config/haben/backup.env; set +a
restic snapshots --tag haben          # verfügbare Stände anzeigen
~/.config/haben/restore.sh latest     # oder eine Snapshot-ID
```

Das Skript fragt nach, ob Datenbank und Belege ersetzt werden sollen, und macht nur bei der Antwort `ja` weiter. Dann

1. holt es den Snapshot mit `podman unshare restic restore` in ein temporäres Verzeichnis,
2. stoppt `haben-app.service`,
3. löscht die Datenbank `haben`, legt sie leer neu an und spielt den Dump mit `psql` ein; ein Fehler im Dump bricht ab (`ON_ERROR_STOP`),
4. ersetzt den Inhalt des Volumes `haben-belege` durch die Belegdateien aus dem Snapshot,
5. startet die App wieder.

Danach meldest du dich an und prüfst Stichproben, etwa die letzte Rechnung, den letzten Beleg und die Bankumsätze. Das Skript ersetzt den aktuellen Stand vollständig.

Auf einem frischen System richtest du zuerst die Quadlets wie oben ein, mit denselben Secrets, startest nur `haben-db` und rufst dann `restore.sh` auf. `HABEN_ENCRYPTION_KEY` muss derselbe sein wie vorher, sonst sind ELSTER-Zertifikat und Lexoffice-Schlüssel nicht lesbar.

Von Hand geht es so, ebenfalls auf einem System mit leeren Volumes:

```sh
restic snapshots --tag haben
restic restore latest --tag haben --target ~/haben-restore

# Datenbank: nur haben-db starten, die App noch nicht (sie würde sonst Migrationen in die leere DB schreiben)
systemctl --user start haben-db
gunzip -c "$(find ~/haben-restore -name haben.sql.gz)" | podman exec -i haben-db psql -U haben -d haben

# Belegdateien zurück ins Volume, Eigentümer ist der Nutzer node (UID 1000) im Container
ziel="$(podman volume inspect haben-belege --format '{{.Mountpoint}}')"
quelle="$(find ~/haben-restore -type d -path '*haben-belege/_data' | head -n1)"
podman unshare cp -a "$quelle/." "$ziel/"
podman unshare chown -R 1000:1000 "$ziel"

systemctl --user start haben-app haben-caddy
```

Restic legt Dateien mit ihrem ursprünglichen absoluten Pfad ab, deshalb die `find`-Aufrufe. Setze vor dem Start der App dasselbe `HABEN_ENCRYPTION_KEY` wie vorher. Für Docker Compose steht der Weg oben bei [Docker Compose](#docker-compose). Probiere die Wiederherstellung einmal aus, bevor du dich auf das Backup verlässt.

## Updates

Mit Compose: `docker compose pull && docker compose up -d`. Mit den Quadlets:

```sh
systemctl --user start haben-backup.service   # Stand vor dem Update sichern
podman auto-update                             # neues Image ziehen und haben-app neu starten
```

`haben-app.container` trägt `AutoUpdate=registry`; mit `systemctl --user enable --now podman-auto-update.timer` prüft Podman täglich selbst auf neue Images. Willst du Updates von Hand steuern, setze im Quadlet eine feste Version (`Image=docker.io/tristanteu/haben:0.1`) und ändere sie bewusst. Bei einem selbst gebauten Image: `git pull`, `podman build -t haben -f Containerfile .` und `systemctl --user restart haben-app`.

`podman auto-update` tauscht nur das Image. Lädst du neue Quadlet-Dateien wie `haben-app.container`, hole auch die `.volume`-Dateien, auf die sie verweisen (etwa `haben-eric-log.volume`), und führe danach `systemctl --user daemon-reload` aus.

Beim Start führt `deploy/entrypoint.sh` zuerst `src/server/db/migrate.ts` aus und wendet alle ausstehenden Migrationen an; erst danach startet der Server. Schlägt eine Migration fehl, startet die App nicht, und der Fehler steht im Log.

## ERiC einbinden

ERiC lädst du als registrierter Entwickler bei ELSTER herunter. Das Paket entpackst du auf dem Host nach `/opt/eric`, sodass `/opt/eric/lib/libericapi.so` und `/opt/eric/lib/plugins2/` existieren. Dann bindest du es ein:

| | Compose | Quadlet |
| --- | --- | --- |
| Verzeichnis mounten | in `compose.yml` die Zeile `- /opt/eric:/opt/eric:ro` einkommentieren | in `haben-app.container` die Zeile `Volume=/opt/eric:/opt/eric:ro` einkommentieren |
| Variable | `ERIC_HOME=/opt/eric` in `.env` | `ERIC_HOME=/opt/eric` in `haben.env` einkommentieren |
| Neu starten | `docker compose up -d` | `systemctl --user daemon-reload && systemctl --user restart haben-app` |

ERiC läuft nie im App-Prozess. Jede Prüfung und jede Übermittlung startet einen kurzlebigen Kindprozess, der die Bibliothek lädt. Ohne `ERIC_HOME` nutzt Haben einen simulierten Client; die Oberfläche zeigt dann „ERiC ist nicht eingerichtet“ an, und nichts geht an das Finanzamt.

Beides ist ab Werk auskommentiert, damit Haben auch ohne ERiC startet. Der weitere Ablauf (Zertifikat, Testübermittlung, Hersteller-ID) steht in [Erste Schritte](einrichtung.md#elster-einrichten).

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

## Lexware-Office-API

Für den Umzug ruft Haben die Public API von Lexware Office ab, standardmäßig unter `https://api.lexware.io/v1`. `LEXOFFICE_API_URL` brauchst du nur zum Testen oder falls Lexware die Adresse ändert; laut Code funktioniert auch `https://api.lexoffice.io/v1`. Den API-Schlüssel trägst du in der Oberfläche ein, nicht in der Umgebung. Ablauf und Voraussetzungen stehen in [Umzug aus Lexoffice](lexoffice.md).

## Als App installieren (PWA)

Haben bringt ein Web-App-Manifest und einen minimalen Service Worker mit. Der Service Worker speichert bewusst nichts zwischen; die Daten bleiben auf dem Server, offline funktioniert Haben nicht.

- Über „Zum Startbildschirm hinzufügen“ bzw. „App installieren“ im Browser installieren. Das klappt nur über HTTPS.
- Die installierte App hat Kurzbefehle für „Beleg hochladen“ und „Neue Rechnung“.
- Die App meldet sich als Teilen-Ziel an (`/api/belege/teilen`): Teilst du auf dem Handy ein PDF, Foto oder E-Rechnungs-XML mit Haben, wird es als Beleg hochgeladen. Höchstens 20 Dateien je Vorgang, je Datei bis 20 MB. Ob das Teilen-Menü Web-Apps anbietet, hängt vom Browser und Betriebssystem ab.

## Passkeys und Domain

Passkeys sind an den Hostnamen aus `BETTER_AUTH_URL` gebunden. Ziehst du Haben auf eine andere Domain um, funktionieren die alten Passkeys dort nicht mehr. Melde dich dann mit E-Mail und Passwort an und lege unter Einstellungen neue Passkeys an. `BETTER_AUTH_URL` muss genau die Adresse sein, die im Browser steht, inklusive `https://`.

## Häufige Probleme

**Die App zeigt nur einen Fehler, im Log steht ein Zod-Fehler zu einer Variablen.** Die Umgebung besteht die Prüfung in `env.ts` nicht. Häufig: `ELSTER_HERSTELLER_ID` hat nicht genau fünf Ziffern, `HABEN_ENCRYPTION_KEY` ist nicht genau 32 Byte base64 oder `BETTER_AUTH_SECRET` ist kürzer als 32 Zeichen.

**`haben-app` startet nicht, Fehler beim Mount von `/opt/eric`.** Podman bricht ab, wenn das Quellverzeichnis eines Bind-Mounts fehlt. Lege ERiC dort ab oder lass die `Volume`-Zeile auskommentiert.

**„DATABASE_URL fehlt“ oder Verbindungsfehler beim Start.** Das Secret `haben-database-url` fehlt oder das Passwort darin passt nicht zu `haben-db-password`. Beachte: Postgres übernimmt `POSTGRES_PASSWORD` nur beim ersten Anlegen des Volumes. Ein später geändertes Secret ändert das Passwort in der Datenbank nicht.

**Passkey-Anmeldung schlägt fehl.** Meist passt `BETTER_AUTH_URL` nicht zur aufgerufenen Adresse (anderer Hostname, `http` statt `https`, Port). Mit Passwort anmelden geht unabhängig davon. Die Anmeldung ist auf 20 Anfragen pro Minute begrenzt.

**„Haben ist bereits eingerichtet.“** Haben hat genau ein Konto. Ein zweites lässt sich nicht anlegen, auch nicht über die API.

**Die Oberfläche meldet „ERiC ist nicht eingerichtet“.** `ERIC_HOME` ist in der App nicht gesetzt. Prüfe `.env` bzw. `haben.env` und starte die App neu.

**ERiC ist eingerichtet, aber Prüfen oder Senden scheitert sofort.** Prüfe, ob unter `ERIC_HOME` die Dateien `lib/libericapi.so` und `lib/plugins2/` liegen und ob das Paket für Linux x86_64 ist. Ein Absturz der Bibliothek beendet nur den Kindprozess; die App zeigt die Meldung an. Details stehen in den ERiC-Logs unter `ERIC_LOG_DIR`.

**Echtübermittlung ist ausgegraut.** Es fehlt `ELSTER_HERSTELLER_ID`. Siehe [Erste Schritte](einrichtung.md#elster-einrichten).

**Belege werden nicht automatisch ausgelesen.** Ohne `ANTHROPIC_API_KEY` liest Haben nur E-Rechnungen. Ist der Schlüssel gesetzt, steht der Grund eines Fehlers am Beleg.

**restic meldet beim Sichern der Belege „permission denied“.** Bei rootless Podman gehören die Dateien im Volume einer Unter-UID des Hosts, nicht deinem Nutzer. Das aktuelle `backup.sh` ruft restic deshalb über `podman unshare` auf. Tritt der Fehler auf, hast du vermutlich noch ein älteres Skript; lade `backup.sh` neu herunter. Prüfe danach mit `restic ls latest`, ob die Belege im Snapshot sind.

**`systemctl --user enable haben-backup.timer` findet die Unit nicht.** Timer und Service gehören nach `~/.config/systemd/user/`, nicht ins Quadlet-Verzeichnis. Danach `systemctl --user daemon-reload`.

Weiter: [Erste Schritte](einrichtung.md) · [Entwicklung](entwicklung.md) · [Zurück zur Übersicht](../README.md)
