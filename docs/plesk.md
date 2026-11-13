# Installations- und Betriebsanleitung: „Haben“ auf Ubuntu mit Plesk (Docker)

Diese Gesamtanleitung beschreibt die vollständige Einrichtung, die Backup-Integration und den sicheren Betrieb der Buchhaltungssoftware **Haben** auf einem Ubuntu-Server mit Plesk.

## Architektur-Überblick

* **Webserver & SSL:** Der Plesk-eigene NGINX übernimmt die Rolle des Reverse Proxys sowie die automatische Verwaltung der Let’s-Encrypt-Zertifikate. Der im Standard-Stack von Haben enthaltene Caddy-Webserver wird deaktiviert.

* **100 % Speicherplatz-Anrechnung im Plesk-Abonnement:** Während die Docker-Basis-Images (`tristanteu/haben`, `tristanteu/haben-db`, `tristanteu/haben-backup`) zentral unter `/var/lib/docker` liegen und serverweit für alle Instanzen nur ein einziges Mal Speicherplatz belegen, werden sämtliche beweglichen Container-Daten (`db`, `belege`, `eric`, `eric-log`, `backups`) als lokale Bind-Mounts unter `/var/www/vhosts/<hauptdomain>/private/haben_<subdomain>/volumes/` gespeichert. Der Plesk-Statistikprozess rechnet diesen Speicherverbrauch vollständig dem jeweiligen Plesk-Abonnement zu.

* **Nahtlose Plesk-Backup-Integration ohne Berechtigungsfehler:**

  * Der Haben-Backup-Container erstellt jede Nacht vor dem Plesk-Serverbackup ein konsistentes, mit Restic verschlüsseltes Abbild der Datenbank und aller Belege im Ordner `volumes/backups` und übergibt die Dateirechte automatisch an den Systembenutzer des Plesk-Abonnements (`UID`/`GID`).

  * Da die rohen Laufzeit-Ordner (wie `volumes/db` von PostgreSQL) zwingend gesperrte Systemrechte (`0700`) für den Container-internen Datenbankbenutzer benötigen und bereits vollständig im Restic-Backup enthalten sind, werden diese Laufzeit-Ordner über eine globale Regel im Plesk Backup-Manager ausgeschlossen. So sichert Plesk das gesamte Restic-Repository fehlerfrei ohne `Permission denied`-Warnungen.

* **Saubere Rechtetrennung:** Das Vorbereitungsskript läuft unprivilegiert unter dem jeweiligen Plesk-Abonnement-Benutzer. Dadurch gehören alle Konfigurationsdateien dem Webspace-Benutzer (`<benutzer>:psacln`) und lassen sich im Plesk-Dateimanager verwalten. Lediglich der Start und die Steuerung der Docker-Container erfolgen über `root`.

## 1. Vorarbeiten in der Plesk-Oberfläche

### 1.1 Voraussetzungen auf dem Server prüfen

1. Stellen Sie unter **Erweiterungen** sicher, dass die Erweiterung **Docker** in Plesk installiert ist.

2. Prüfen Sie unter **Tools & Einstellungen -> Dienste-Verwaltung**, ob der Dienst **Reverse Proxy Server (nginx)** aktiv ist.

### 1.2 Einmalige Backup-Ausschlussregel & Backup-Uhrzeit in Plesk prüfen

Da das Plesk-Serverbackup unter dem unprivilegierten Abonnement-Benutzer läuft, darf es nicht versuchen, die gesperrten Rohdatenbank-Dateien unter `volumes/db` direkt zu lesen, sondern soll stattdessen das konsistente Restic-Backup unter `volumes/backups` sichern.

1. Öffnen Sie in Plesk **Tools & Einstellungen -> Tools und Ressourcen -> Backup-Manager -> Zeitplan**.

2. Notieren Sie sich die **Startzeit** Ihres täglichen Plesk-Serverbackups (z. B. `02:00` Uhr). Die Backup-Zeit der Haben-Instanz (`BACKUP_TIME`) sollte mindestens **45 bis 60 Minuten vor** dieser Zeit liegen (z. B. `01:15` Uhr).

3. Aktivieren Sie im selben Dialog die Option **Bestimmte Dateien vom Backup ausschließen** und tragen Sie einmalig folgende globale Platzhalter-Regeln ein (diese gelten automatisch für alle jetzigen und zukünftigen Haben-Instanzen auf dem Server):

   ```
   /var/www/vhosts/*/private/haben_*/volumes/db
   /var/www/vhosts/*/private/haben_*/volumes/belege
   /var/www/vhosts/*/private/haben_*/volumes/eric
   /var/www/vhosts/*/private/haben_*/volumes/eric-log
   /var/www/vhosts/*/private/haben_*/volumes/caddy
   
   ```

4. Speichern Sie die Einstellungen mit **OK**. *(Falls Sie innerhalb einzelner Abonnements zusätzlich eigene Kunden-Backup-Zeitpläne nutzen, hinterlegen Sie dort analog die Pfade `/private/haben_*/volumes/db` usw.)*

### 1.3 SSH-Zugang für das Abonnement aktivieren

1. Öffnen Sie **Websites & Domains -> Hosting und DNS -> Webhosting-Zugang**.

2. Stellen Sie das Feld **Zugriff auf den Server über SSH** auf `/bin/bash` (wichtig: **nicht** `/bin/bash (chrooted)`), damit Standardwerkzeuge wie `curl`, `openssl` und die echten Systempfade für Docker zur Verfügung stehen.

### 1.4 Subdomain und HTTPS anlegen

1. Navigieren Sie zu **Websites & Domains -> Subdomain hinzufügen** und legen Sie Ihre gewünschte Subdomain an (z. B. `haben.ihre-domain.de`).

   > **Wichtig:** Legen Sie sich vorab endgültig auf diese Domain fest. Die Passkeys zur Anmeldung sind kryptografisch an die Domain gebunden, sodass sich die Adresse später nicht mehr ändern lässt.

2. Öffnen Sie für die neue Subdomain den Punkt **SSL/TLS-Zertifikate**, stellen Sie ein kostenloses Zertifikat über **Let’s Encrypt** aus und aktivieren Sie unter **Hosting-Einstellungen** die **Dauerhafte, SEO-sichere 301-Weiterleitung von HTTP zu HTTPS**.

### 1.5 NGINX für große Beleg-Uploads konfigurieren

1. Öffnen Sie für die Subdomain den Punkt **Einstellungen für Apache & nginx**.

2. Deaktivieren Sie im Abschnitt **Einstellungen für nginx** den **Proxymodus** (damit NGINX die Anfragen direkt ohne Umweg über den Apache-Webserver an den Container weiterleitet).

3. Tragen Sie im Eingabefeld **Maximale Größe einer Client-Anforderung** den Wert `250m` ein (erforderlich für Archivimporte bis 100 MB und Mehrfach-Beleg-Uploads).

4. Fügen Sie im Freitextfeld **Zusätzliche nginx-Anweisungen** ausschließlich die folgenden drei Zeilen ein (tragen Sie hier **kein** `client_max_body_size` ein, da Plesk diesen Wert bereits über das obige Eingabefeld in die Konfiguration schreibt):

   ```
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_read_timeout 300s;
   
   ```

5. Klicken Sie auf **Übernehmen**.

## 2. Vorbereitungsskript als Abonnement-Benutzer ausführen

Öffnen Sie in Ihrem Abonnement unter **Websites & Domains -> SSH-Terminal** das Terminal des Abonnement-Benutzers und wechseln Sie in den Ordner Ihrer neu angelegten Subdomain:

```
cd ~/haben.ihre-domain.de

```

### 2.1 Möglichkeiten zur Wahl der Backup-Zeit (`BACKUP_TIME`) und weiterer Parameter

Sie können die Uhrzeit für das nächtliche Restic-Backup der Docker-Instanz auf drei Arten festlegen:

1. **Interaktive Abfrage beim Skriptstart:** Wenn Sie keine Vorgabe machen, fragt Sie das Skript `prepare-haben.sh` beim Ausführen nach der gewünschten Uhrzeit (drücken Sie einfach **Enter** für den Standardwert `01:15` oder geben Sie z. B. `00:30` ein).

2. **Vorab über die optionale Datei `haben-setup.conf`:** Wenn Sie im Subdomain-Ordner vorab eine Datei `haben-setup.conf` anlegen, übernimmt das Skript alle dort gesetzten Werte ohne Rückfrage:

   ```
   # Optionale Konfigurationsdatei: haben-setup.conf
   DOMAIN="haben.ihre-domain.de"
   LOCAL_PORT=""                # Leer lassen für automatische freie Portsuche ab 3000
   BACKUP_TIME="01:15"          # Uhrzeit (HH:MM) für das nächtliche Restic-Backup
   RESTORE_CHECK_DAYS="7"       # Intervall in Tagen für den automatischen Test-Restore
   HABEN_SETUP_CODE=""          # Leer lassen für automatische Generierung
   
   ```

3. **Nachträglich im laufenden Betrieb:** Über den Befehl `./haben-ctl.sh set-backup-time 00:45` lässt sich die Uhrzeit jederzeit nachträglich ändern (siehe Abschnitt 6).

### 2.2 Skript `prepare-haben.sh` anlegen und ausführen

Legen Sie im Subdomain-Ordner die Datei `prepare-haben.sh` mit folgendem Inhalt an:

```
#!/usr/bin/env bash
set -euo pipefail

# Sicherheitscheck: Ausführung nur als unprivilegierter Abonnement-Benutzer in /bin/bash
if [[ "$(id -u)" -eq 0 ]]; then
    echo "ABBRUCH: Bitte führen Sie dieses Skript als Abonnement-Benutzer aus, nicht als root!"
    exit 1
fi

if [[ "$HOME" == "/" ]]; then
    echo "ABBRUCH: Sie befinden sich in einer '/bin/bash (chrooted)' Umgebung."
    echo "Bitte stellen Sie unter 'Webhosting-Zugang' die Shell auf '/bin/bash' um."
    exit 1
fi

CONFIG_FILE="./haben-setup.conf"

# 1. Optionale Konfigurationsdatei des Administrators einlesen
if [[ -f "$CONFIG_FILE" ]]; then
    echo "==> Lade Vorgaben aus $CONFIG_FILE ..."
    source "$CONFIG_FILE"
fi

# Kommandozeilen-Parameter auswerten (z. B. --backup-time 00:45)
while [[ $# -gt 0 ]]; do
    case "$1" in
        --backup-time)
            BACKUP_TIME="$2"
            shift 2
            ;;
        --port)
            LOCAL_PORT="$2"
            shift 2
            ;;
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# 2. Abonnement-Verzeichnis ($HOME), Benutzer-IDs und Subdomain automatisch erkennen
VHOST_DIR="${VHOST_DIR:-$HOME}"
CURRENT_DIR="$(pwd)"
BACKUP_UID="$(id -u)"
BACKUP_GID="$(id -g)"

if [[ -z "${DOMAIN:-}" ]]; then
    if [[ "$CURRENT_DIR" != "$VHOST_DIR" && "$CURRENT_DIR" == "$VHOST_DIR/"* ]]; then
        REL_DIR="${CURRENT_DIR#$VHOST_DIR/}"
        CANDIDATE="${REL_DIR%%/*}"
        if [[ "$CANDIDATE" != "httpdocs" && "$CANDIDATE" != "private" && "$CANDIDATE" != "logs" ]]; then
            DOMAIN="$CANDIDATE"
        fi
    fi
fi

if [[ -z "${DOMAIN:-}" ]]; then
    cat << EOF > "$CONFIG_FILE"
# Konfigurationsdatei für die Haben-Installation
DOMAIN="haben.ihre-domain.de"
VHOST_DIR="${VHOST_DIR}"
LOCAL_PORT=""
BACKUP_TIME="01:15"
RESTORE_CHECK_DAYS="7"
HABEN_SETUP_CODE=""
EOF
    chmod 600 "$CONFIG_FILE"
    echo "HINWEIS: Subdomain konnte nicht erkannt werden. Bitte in $CONFIG_FILE eintragen."
    exit 0
fi

# 3. Interaktive Abfrage der Backup-Uhrzeit, falls nicht vorab gesetzt
if [[ -z "${BACKUP_TIME:-}" ]]; then
    if [[ -t 0 ]]; then
        read -rp "==> Uhrzeit für das tägliche Haben-Backup (HH:MM, ca. 1h vor Plesk-Backup) [01:15]: " INPUT_TIME
        BACKUP_TIME="${INPUT_TIME:-01:15}"
    else
        BACKUP_TIME="01:15"
    fi
fi

# 4. Projektnamen ohne doppeltes "haben_"-Präfix bilden
SAFE_NAME=$(echo "$DOMAIN" | tr '.-' '__')
if [[ "$SAFE_NAME" == haben_* ]]; then
    PROJECT_NAME="$SAFE_NAME"
else
    PROJECT_NAME="haben_${SAFE_NAME}"
fi

APP_DIR="${VHOST_DIR}/private/${PROJECT_NAME}"
VOLUMES_BASE_DIR="${APP_DIR}/volumes"
BACKUP_HOST_DIR="${VOLUMES_BASE_DIR}/backups"

echo "==> Erkanntes Abonnement-Verzeichnis: $VHOST_DIR (UID=${BACKUP_UID}, GID=${BACKUP_GID})"
echo "==> Erkannte Subdomain:               $DOMAIN"
echo "==> Geschütztes Instanz-Verzeichnis:  $APP_DIR"
echo "==> Tägliche Restic-Backup-Uhrzeit:   $BACKUP_TIME Uhr"

mkdir -p "$APP_DIR" "$VOLUMES_BASE_DIR" "$BACKUP_HOST_DIR"
chmod 700 "$APP_DIR"
cd "$APP_DIR"

# 5. Freien lokalen Port ab 3000 automatisch ermitteln
if [[ -z "${LOCAL_PORT:-}" ]]; then
    PORT=3000
    if command -v ss >/dev/null 2>&1; then
        while ss -tuln | grep -q ":${PORT} "; do
            PORT=$((PORT + 1))
        done
    fi
    LOCAL_PORT="$PORT"
fi

# 6. Kryptografische Schlüssel generieren (falls nicht in haben-setup.conf gesetzt)
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -base64 32)}"
RESTIC_PASSWORD="${RESTIC_PASSWORD:-$(openssl rand -base64 32)}"
HABEN_SETUP_CODE="${HABEN_SETUP_CODE:-$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 12)}"
RESTORE_CHECK_DAYS="${RESTORE_CHECK_DAYS:-7}"

# 7. Offizielle Vorlagen von GitHub laden
echo "==> Lade offizielle Haben-Vorlagen herunter ..."
curl -fsSL -O https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.env.example

# 8. Variablen in .env eintragen
set_env_var() {
    local key="$1"
    local val="$2"
    if grep -qE "^#?${key}=" .env; then
        sed -i "s|^#*\s*${key}=.*|${key}=${val}|" .env
    else
        echo "${key}=${val}" >> .env
    fi
}

set_env_var "COMPOSE_PROJECT_NAME" "$PROJECT_NAME"
set_env_var "DOMAIN" "$DOMAIN"
set_env_var "BETTER_AUTH_URL" "https://${DOMAIN}"
set_env_var "DB_PASSWORD" "$DB_PASSWORD"
set_env_var "AUTH_SECRET" "$AUTH_SECRET"
set_env_var "BETTER_AUTH_SECRET" "$AUTH_SECRET"
set_env_var "ENCRYPTION_KEY" "$ENCRYPTION_KEY"
set_env_var "HABEN_ENCRYPTION_KEY" "$ENCRYPTION_KEY"
set_env_var "RESTIC_PASSWORD" "$RESTIC_PASSWORD"
set_env_var "HABEN_SETUP_CODE" "$HABEN_SETUP_CODE"
set_env_var "BACKUP_TIME" "$BACKUP_TIME"
set_env_var "RESTORE_CHECK_DAYS" "$RESTORE_CHECK_DAYS"
set_env_var "BACKUP_HOST" "$PROJECT_NAME"
set_env_var "BACKUP_UID" "$BACKUP_UID"
set_env_var "BACKUP_GID" "$BACKUP_GID"

for opt_var in RESTIC_REPOSITORY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY ERIC_AUTO_INSTALL ERIC_HOME EXTRACTION_BASE_URL EXTRACTION_MODEL EXTRACTION_API_KEY ENABLE_BANKING_APP_ID; do
    if [[ -n "${!opt_var:-}" ]]; then
        set_env_var "$opt_var" "${!opt_var}"
    fi
done
chmod 600 .env

# 9. compose.override.yml erzeugen (Port-Binding, Backup-Rechte-Sync & alle Volumes im Abonnement)
echo "==> Erzeuge compose.override.yml ..."
VOLUME_NAMES=$(awk '/^volumes:/{flag=1; next} /^[a-zA-Z]/{flag=0} flag && /^  [a-zA-Z0-9_-]+:/{gsub(":", "", $1); print $1}' compose.yml)

cat << EOF > compose.override.yml
services:
  caddy:
    profiles:
      - disabled
  app:
    ports:
      - "127.0.0.1:${LOCAL_PORT}:3000"
  backup:
    entrypoint:
      - /bin/sh
      - -c
      - |
        (while true; do
          find /backups ! -user \${BACKUP_UID:-0} -exec chown \${BACKUP_UID:-0}:\${BACKUP_GID:-0} {} + 2>/dev/null || true
          sleep 60
        done) &
        exec entrypoint.sh zeitplan
EOF

if [[ -n "$VOLUME_NAMES" ]]; then
    echo "" >> compose.override.yml
    echo "volumes:" >> compose.override.yml
    for vol in $VOLUME_NAMES; do
        mkdir -p "${VOLUMES_BASE_DIR}/${vol}"
        cat << EOF >> compose.override.yml
  ${vol}:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ${VOLUMES_BASE_DIR}/${vol}
EOF
    done
fi

# 10. Verwaltungs- und Backup-Skript (haben-ctl.sh) erzeugen
cat << 'EOF' > haben-ctl.sh
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ./.env

fix_backup_perms() {
    if [[ -n "${BACKUP_UID:-}" && -n "${BACKUP_GID:-}" ]]; then
        chown -R "${BACKUP_UID}:${BACKUP_GID}" ./volumes/backups
    fi
}

case "${1:-help}" in
    start)
        docker compose up -d
        ;;
    stop)
        docker compose stop
        ;;
    backup)
        echo "==> Erstelle manuelles Restic-Backup (Datenbank & Belege) ..."
        docker compose exec -T backup backup.sh
        fix_backup_perms
        echo "==> Backup erfolgreich abgeschlossen."
        ;;
    set-backup-time)
        if [[ -z "${2:-}" || ! "${2}" =~ ^[0-2][0-9]:[0-5][0-9]$ ]]; then
            echo "Bitte gültige Uhrzeit im Format HH:MM angeben, z. B.: $0 set-backup-time 01:15"
            exit 1
        fi
        sed -i "s|^BACKUP_TIME=.*|BACKUP_TIME=${2}|" .env
        echo "==> Neue Backup-Zeit (${2} Uhr) in .env gespeichert. Starte Backup-Container neu ..."
        docker compose up -d backup
        ;;
    test-restore)
        echo "==> Führe zerstörungsfreien Test-Restore durch ..."
        docker compose exec -T backup test-restore.sh
        ;;
    snapshots)
        docker compose exec -T backup restic snapshots
        ;;
    restore-latest)
        echo "==> Stoppe App-Container und spiele neuesten Backup-Snapshot ein ..."
        docker compose stop app
        docker compose run --rm restore latest
        docker compose start app
        echo "==> Wiederherstellung erfolgreich abgeschlossen."
        ;;
    restore-id)
        if [[ -z "${2:-}" ]]; then
            echo "Bitte Snapshot-ID angeben: $0 restore-id <SNAPSHOT-ID>"
            exit 1
        fi
        docker compose stop app
        docker compose run --rm restore "$2"
        docker compose start app
        ;;
    update)
        echo "==> Sicherung vor dem Update wird erstellt ..."
        docker compose exec -T backup backup.sh
        fix_backup_perms
        echo "==> Lade aktuelle Images und starte Container neu ..."
        docker compose pull
        docker compose up -d
        echo "==> Update erfolgreich abgeschlossen."
        ;;
    *)
        echo "Verwendung: $0 {start|stop|backup|set-backup-time <HH:MM>|test-restore|snapshots|restore-latest|restore-id <ID>|update}"
        exit 1
        ;;
esac
EOF
chmod 700 haben-ctl.sh

# 11. Zugangsdaten-Datei für den Passwort-Manager im Ordner private/ speichern
CRED_FILE="${VHOST_DIR}/private/haben-zugangsdaten-${DOMAIN}.txt"
cat << EOF > "$CRED_FILE"
======================================================================
  HABEN BUCHHALTUNG - ZUGANGSDATEN & SCHLÜSSEL (FÜR PASSWORT-MANAGER)
  Erstellt am: $(date '+%Y-%m-%d %H:%M:%S')
======================================================================

[1. ZUGRIFFSDATEN & ERSTEINRICHTUNG]
URL der Anwendung:         https://${DOMAIN}
Ersteinrichtungs-URL:      https://${DOMAIN}/setup
Einmal-Einrichtungscode:   ${HABEN_SETUP_CODE}
Lokaler Proxy-Port:        127.0.0.1:${LOCAL_PORT} -> Container-Port 3000
Compose-Projektname:       ${PROJECT_NAME}
Tägliches Restic-Backup:   ${BACKUP_TIME} Uhr (Abonnement-UID: ${BACKUP_UID})

[2. KRITISCHE SCHLÜSSEL - ZWINGEND IM PASSWORT-MANAGER SICHERN!]
Ohne ENCRYPTION_KEY und RESTIC_PASSWORD sind Backups, ELSTER-Zertifikate
und API-Schlüssel nach einer Wiederherstellung unwiderruflich verloren!

ENCRYPTION_KEY:            ${ENCRYPTION_KEY}
RESTIC_PASSWORD:           ${RESTIC_PASSWORD}
DB_PASSWORD:               ${DB_PASSWORD}
AUTH_SECRET:               ${AUTH_SECRET}

[3. PFADE IM PLESK-ABONNEMENT]
Konfigurationsordner:      ${APP_DIR}
Container-Daten (Volumes): ${VOLUMES_BASE_DIR}
Backup-Speicherort:        ${BACKUP_HOST_DIR}

[4. BEFEHLE FÜR DIE ROOT-SHELL]
Container starten:         ${APP_DIR}/haben-ctl.sh start
Manuelles Backup:          ${APP_DIR}/haben-ctl.sh backup
Backup-Uhrzeit ändern:     ${APP_DIR}/haben-ctl.sh set-backup-time 01:15
Backup-Snapshots zeigen:   ${APP_DIR}/haben-ctl.sh snapshots
Letztes Backup einspielen: ${APP_DIR}/haben-ctl.sh restore-latest
Sicheres Update ausführen: ${APP_DIR}/haben-ctl.sh update
======================================================================
EOF
chmod 600 "$CRED_FILE"

echo ""
echo "==> Vorbereitung erfolgreich abgeschlossen!"
cat "$CRED_FILE"

```

Starten Sie das Vorbereitungsskript als Abonnement-Benutzer:

```
bash prepare-haben.sh

```

*(Oder direkt mit Übergabe einer individuellen Backup-Uhrzeit: `bash prepare-haben.sh --backup-time 00:45`)*

### 2.3 Zugangsdaten extern im Passwort-Manager sichern

Öffnen Sie den **Plesk-Dateimanager**, wechseln Sie in das Verzeichnis `private/`, kopieren Sie den gesamten Inhalt der Datei `haben-zugangsdaten-<domain>.txt` in Ihren Passwort-Manager und löschen Sie diese Klartextdatei anschließend vom Server.

## 3. Container starten und mit Plesk verbinden

### 3.1 Container als `root` starten

Öffnen Sie eine SSH-Sitzung als `root` (oder nutzen Sie in Plesk **Tools & Einstellungen -> SSH-Terminal**) und führen Sie den Startbefehl aus dem Ausgabeblock `[4]` aus:

```
/var/www/vhosts/ihre-domain.de/private/haben_ihre_domain_de/haben-ctl.sh start

```

### 3.2 Bedeutung der 3 laufenden Container und der Volume-Anzeige in Plesk

Nach dem Start laufen im Hintergrund dauerhaft drei Container:

* **`...-app-1` (`tristanteu/haben:latest`):** Die eigentliche Buchhaltungsanwendung (lauscht lokal auf `127.0.0.1:3000`).

* **`...-db-1` (`tristanteu/haben-db:latest`):** Die PostgreSQL-Datenbank inklusive automatischem `pg_upgrade` bei Major-Versionswechseln.

* **`...-backup-1` (`tristanteu/haben-backup:latest`):** Ein Sidecar-Container mit integriertem Zeitplaner. Er wacht jede Nacht zur konfigurierten `BACKUP_TIME` auf, sichert Datenbank sowie Belege verschlüsselt mit Restic nach `volumes/backups`, übergibt die Dateirechte an den Plesk-Abonnement-Benutzer, führt alle 7 Tage einen automatischen Test-Restore durch und meldet über seinen Healthcheck (`healthy`/`unhealthy`), ob das Backup der letzten 48 Stunden erfolgreich war.

> **Hinweis zur Anzeige „Nicht bereitgestellt“ in der Plesk-Docker-Oberfläche:**
> In der Detailansicht der Container unter **Docker** zeigt Plesk oben die aktiven Compose-Volumes (z. B. `haben_..._belege auf /var/lib/haben/belege`) und direkt darunter dieselben Pfade nochmals als `Nicht bereitgestellt` an. Das ist ein rein kosmetischer Anzeigefehler der Plesk-GUI bei Docker-Compose-Projekten, da die Volumes über `compose.override.yml` eingebunden wurden und nicht über das Plesk-Formular.
> **Wichtig:** Klicken Sie in den Container-Einstellungen der Plesk-Docker-GUI niemals auf „OK“ oder „Übernehmen“, da Plesk sonst die Einstellungen der `compose.yml` überschreibt.

### 3.3 Docker-Proxy-Regel in Plesk einrichten

1. Öffnen Sie **Websites & Domains -> haben.ihre-domain.de -> Docker-Proxy-Regeln** und klicken Sie auf **Regel hinzufügen**.

2. Wählen Sie den Container `haben_...-app-1` und verknüpfen Sie den internen Port `3000` mit dem vom Skript zugewiesenen Systemport (bei der ersten Instanz `3000`).

3. Rufen Sie im Browser `https://haben.ihre-domain.de/setup` auf, geben Sie Ihren `HABEN_SETUP_CODE` ein und legen Sie das Inhaber-Konto an.

## 4. Konfiguration des E-Mail-Versands (SMTP)

Der E-Mail-Versand (zum Versenden von Angeboten und E-Rechnungen direkt aus Haben) wird **nicht** in der `.env`-Datei konfiguriert, sondern nach der Anmeldung direkt in der Weboberfläche unter **Einstellungen -> E-Mail**:

* Der `app`-Container liest beim Start keine `SMTP_*`-Umgebungsvariablen aus der `.env` ein.

* Stattdessen speichert Haben die in der Weboberfläche eingetragenen SMTP-Zugangsdaten direkt in der PostgreSQL-Datenbank und verschlüsselt das SMTP-Passwort dort mit Ihrem `ENCRYPTION_KEY`.

* Dadurch sind Ihre E-Mail-Einstellungen automatisch Bestandteil jedes Backups und können jederzeit ohne Neustart des Containers angepasst werden.

## 5. Weitere Instanz für eine zusätzliche Firma anlegen (Mandantentrennung)

Da Haben zur strikten GoBD-konformen Trennung für jede Firma eine eigene Instanz vorsieht, unterstützt das Skript den Parallelbetrieb beliebig vieler Instanzen (im selben oder in getrennten Plesk-Abonnements):

1. Legen Sie in Plesk eine neue Subdomain an (z. B. `haben-firma2.ihre-domain.de`), aktivieren Sie Let’s Encrypt und tragen Sie die NGINX-Einstellungen aus Abschnitt 1.5 ein. *(Die Backup-Ausschlussregel mit Platzhaltern `*` aus Abschnitt 1.2 greift automatisch auch für neue Instanzen.)*

2. Kopieren Sie `prepare-haben.sh` in das Verzeichnis der neuen Subdomain und führen Sie `bash prepare-haben.sh` als Abonnement-Benutzer aus.

3. Das Skript erkennt automatisch, dass Port `3000` bereits belegt ist, und weist der zweiten Instanz automatisch den nächsten freien Port **`127.0.0.1:3001:3000`** sowie ein eigenes Verzeichnis `private/haben_firma2_...` zu.

4. Starten Sie die neue Instanz als `root` über deren `haben-ctl.sh start` und verknüpfen Sie die zweite Subdomain in Plesk unter **Docker-Proxy-Regeln** mit dem neuen Container auf Systemport **`3001`**.

## 6. Backups, Updates, Backup-Uhrzeit ändern und Wiederherstellung im Betrieb

### Speicherort der Backups

Durch die Bind-Mount-Konfiguration speichert der Backup-Container das verschlüsselte Restic-Repository direkt im Plesk-Abonnement unter:
`/var/www/vhosts/<hauptdomain>/private/haben_<subdomain>/volumes/backups`

Der Container bewahrt automatisch 14 Tages-, 24 Monats- und 11 Jahresstände auf. Da alle Dateien in diesem Ordner automatisch dem Abonnement-Benutzer übergeben werden, sichert das reguläre Plesk-Serverbackup dieses Verzeichnis jede Nacht ohne Warnmeldungen mit auf Ihren externen Backup-Speicher.

### Steuerbefehle für den Administrator (als `root`)

Wechseln Sie in das Instanz-Verzeichnis (`cd /var/www/vhosts/.../private/haben_...`) und nutzen Sie das generierte Skript `haben-ctl.sh`:

* **Manuelles Zwischen-Backup sofort ausführen (korrigiert anschließend sofort die Dateirechte):**

  ```
  ./haben-ctl.sh backup
  
  ```

* **Backup-Uhrzeit der Instanz nachträglich ändern (z. B. auf 00:45 Uhr):**

  ```
  ./haben-ctl.sh set-backup-time 00:45
  
  ```

* **Vorhandene Backup-Stände (Snapshots) mit ID und Zeitstempel auflisten:**

  ```
  ./haben-ctl.sh snapshots
  
  ```

* **Zerstörungsfreien Test-Restore in eine temporäre Prüfdatenbank starten:**

  ```
  ./haben-ctl.sh test-restore
  
  ```

* **Sicheres Update durchführen (erstellt vorab automatisch ein Backup):**

  ```
  ./haben-ctl.sh update
  
  ```

* **Neuestes Backup im laufenden Betrieb zurückspielen:**

  ```
  ./haben-ctl.sh restore-latest
  
  ```

* **Einen bestimmten älteren Snapshot anhand seiner ID zurückspielen:**

  ```
  ./haben-ctl.sh restore-id <SNAPSHOT-ID>
  
  ```

## 7. Notfall-Wiederherstellung auf einem anderen Server (Disaster Recovery)

Bei einem Komplettausfall des Servers benötigen Sie zur Wiederherstellung auf einem neuen Plesk-Server lediglich:

1. Das gesicherte Verzeichnis **`volumes/backups`** (aus Ihrem Plesk-Serverbackup).

2. Ihre im Passwort-Manager gesicherten Schlüssel **`ENCRYPTION_KEY`** und **`RESTIC_PASSWORD`**.

### Schritt-für-Schritt-Wiederherstellung

1. **Subdomain & Grundstruktur auf dem neuen Server vorbereiten:**
   Legen Sie auf dem neuen Plesk-Server exakt dieselbe Subdomain an (damit alle Passkeys gültig bleiben), richten Sie die NGINX- und Backup-Ausschluss-Einstellungen aus Abschnitt 1 ein und führen Sie als Abonnement-Benutzer `bash prepare-haben.sh` aus. *(Starten Sie die Container noch nicht!)*

2. **Alte Schlüssel in die neue `.env` übertragen:**
   Öffnen Sie die Datei `/var/www/vhosts/.../private/haben_.../.env` und ersetzen Sie die neu generierten Schlüssel durch Ihre gesicherten Werte aus dem Passwort-Manager:

   ```
   ENCRYPTION_KEY=Ihr_Alter_Encryption_Key_Aus_Dem_Passwortmanager
   HABEN_ENCRYPTION_KEY=Ihr_Alter_Encryption_Key_Aus_Dem_Passwortmanager
   RESTIC_PASSWORD=Ihr_Altes_Restic_Passwort_Aus_Dem_Passwortmanager
   
   ```

3. **Backup-Repository kopieren:**
   Kopieren Sie den Inhalt Ihres gesicherten Backup-Ordners auf den neuen Server nach `/var/www/vhosts/.../private/haben_.../volumes/backups`.

4. **Datenbank starten und Restore einspielen (als `root`):**

   ```
   cd /var/www/vhosts/ihre-domain.de/private/haben_ihre_domain_de
   
   # 1. Leere Datenbank starten, bis sie den Status 'healthy' erreicht
   docker compose up -d db
   
   # 2. Neuesten Backup-Stand (Datenbank + Belege) entschlüsseln und einspielen
   docker compose run --rm restore latest
   
   # 3. Gesamten Stack regulär starten
   ./haben-ctl.sh start
   
   ```

5. **Proxy-Regel verbinden:**
   Richten Sie in Plesk unter **Docker-Proxy-Regeln** die Weiterleitung auf den lokalen Port (Standard `3000`) ein. Alle Buchungen, PDF-Belege, ELSTER-Zertifikate, E-Mail-Einstellungen und Benutzerkonten stehen sofort wieder im ursprünglichen Zustand bereit.
