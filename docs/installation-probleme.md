---
title: "Häufige Probleme beim Betrieb"
description: >-
  Lösungen für häufige Fehler beim Betrieb von Haben: Start, Umgebungsvariablen, ERiC, Netz, Proxy und Anmeldung.
---

# Häufige Probleme

**Die App zeigt nur einen Fehler, im Log steht ein Zod-Fehler zu einer Variablen.** Die Umgebung besteht die Prüfung in `env.ts` nicht. Häufig: `ELSTER_HERSTELLER_ID` hat nicht genau fünf Ziffern, `HABEN_ENCRYPTION_KEY` ist nicht genau 32 Byte base64 oder `BETTER_AUTH_SECRET` ist kürzer als 32 Zeichen.

**`haben-app` startet nicht, Fehler beim Mount von `/opt/eric`.** Podman bricht ab, wenn das Quellverzeichnis eines Bind-Mounts fehlt. Lege ERiC dort ab oder lass die `Volume`-Zeile auskommentiert.

**„DATABASE_URL fehlt“ oder Verbindungsfehler beim Start.** Prüfe die Adresse und das Passwort der darin genannten Datenbankrolle. Bei Quadlets enthält `haben-database-url` den App-Zugang; bei getrennten Rollen enthält `haben-migration-database-url` den Eigentümerzugang mit dem Passwort aus `haben-db-password`. Beachte: Postgres übernimmt `POSTGRES_PASSWORD` nur beim ersten Anlegen des Volumes. Ein später geändertes Secret ändert das Passwort in der Datenbank nicht.

**Passkey-Anmeldung schlägt fehl.** Meist passt `BETTER_AUTH_URL` nicht zur aufgerufenen Adresse (anderer Hostname, `http` statt `https`, Port). Mit Passwort anmelden geht unabhängig davon. Je Client-Adresse sind Passkey-Anmeldungen auf 20 pro Minute begrenzt, Anmeldungen mit Passwort auf 3 in 10 Sekunden ([Anmeldung](architektur-anmeldung.md#anmeldung)).

**„Haben ist bereits eingerichtet.“** Im Standardmodus hat Haben genau einen Inhaber. Ein zweites Konto entsteht nur über einen Einladungslink für die [Steuerberatung](steuerberatung.md), weder mit dem Einrichtungscode noch über die API.

**Die Oberfläche meldet „ERiC ist nicht eingerichtet“.** Unter **Einstellungen › ELSTER › ERiC** herunterladen. Hast du ERiC von Hand eingebunden, ist `ERIC_HOME` in der App nicht gesetzt; prüfe `.env` bzw. `haben.env` und starte die App neu.

**Der ERiC-Download scheitert.** Die Meldung steht unter **Einstellungen › ELSTER › ERiC**. „Gibt es nicht (mehr)“ heißt: Die Version ist zu alt oder vertippt; die aktuelle steht auf der Infoseite. Der Server muss `download.elster.de` per HTTPS erreichen und während der Installation rund 800 MB im Volume `eric` bzw. `haben-eric` frei haben (siehe [ERiC einbinden](installation-anbindungen.md#eric-einbinden)).

**Die Vorschau von Belegen, Rechnungen oder Angeboten bleibt leer oder zeigt „Verbindung abgelehnt“.** Die Vorschau ist ein eingebettetes Fenster (iframe) auf derselben Adresse. Setzt der Reverse Proxy `X-Frame-Options DENY`, verbietet das auch diese Einbettung. Stell den Header auf `SAMEORIGIN` um (so steht es im mitgelieferten `Caddyfile` und in `compose.yml`); vor Clickjacking durch fremde Seiten schützt die App selbst mit `Content-Security-Policy: frame-ancestors 'self'`. Bei Caddy mit einzeln gemounteter `Caddyfile` (Quadlet) reicht nach dem Bearbeiten `caddy reload` nicht: Editoren und `sed -i` legen eine neue Datei an, der Bind-Mount zeigt weiter auf die alte. Starte den Container neu (`systemctl --user restart haben-caddy` bzw. ohne `--user` bei rootful Podman).

**„download.elster.de nicht erreichbar: …“, obwohl der Server ins Internet kommt.** In Klammern steht der Grund. `EAI_AGAIN` oder `ENOTFOUND` heißt: Der Container löst keine Namen auf. Prüfen mit `podman exec haben-app bun -e 'require("dns").promises.lookup("download.elster.de").then(console.log,console.error)'` (Compose: `docker compose exec app bun -e …`). Kommt `EAI_AGAIN`, beantwortet der DNS-Dienst des Podman-Netzes (aardvark-dns) zwar `haben-db`, leitet externe Namen aber nicht weiter. Das passiert, wenn sich nach dem Start die DNS-Server des Hosts ändern (`/etc/resolv.conf`, z. B. nach einem Netzwerk-Neustart). Sofort hilft `podman network reload --all` (rootful) bzw. ein Neustart der Container. Dauerhaft trägst du in `haben.network` einen festen DNS-Server ein, etwa deinen Router: `DNS=192.168.178.1`. Danach Container stoppen, `podman network rm haben` und neu starten. `ECONNREFUSED` oder `ETIMEDOUT` deuten auf eine Firewall oder einen Proxy, ein Zertifikatsfehler auf einen TLS-Proxy mit eigener CA. Dieselben Gründe nennt Haben auch, wenn Enable Banking nicht erreichbar ist.

**ERiC ist eingerichtet, aber Prüfen oder Senden scheitert sofort.** Bei einem von Hand eingebundenen ERiC prüfe, ob unter `ERIC_HOME` die Dateien `lib/libericapi.so` und `lib/plugins/` (ältere Versionen: `lib/plugins2/`) liegen und ob das Paket für Linux x86_64 ist. Ein Absturz der Bibliothek beendet nur den Kindprozess; die App zeigt die Meldung an. Details stehen in den ERiC-Logs unter `ERIC_LOG_DIR`.

**Auf arm64: „ERiC-Prozess abgestürzt“ mit `ERIC_WORKER_COMMAND`.** Steht „x86_64-Laufzeit für ERiC ist Version …“ dabei, `einrichten.sh` mit der Version der App wiederholen. „QEMU internal SIGSEGV“ heißt: QEMU ist älter als Version 9. „MemoryExhaustion“ kommt, wenn der Worker ohne `worker.sh` direkt mit QEMU gestartet wird. Exit-Code 127: Der Pfad in `ERIC_WORKER_COMMAND` stimmt nicht oder das Verzeichnis ist nicht gemountet. Siehe [ELSTER auf arm64](installation-anbindungen.md#elster-auf-arm64).

**Echtübermittlung ist ausgegraut.** Es fehlt `ELSTER_HERSTELLER_ID`. Siehe [ELSTER einrichten](einrichtung-elster.md).

**Belege werden nicht automatisch ausgelesen.** Ohne `ANTHROPIC_API_KEY` oder `EXTRACTION_BASE_URL` liest Haben nur E-Rechnungen. Ist eins davon gesetzt, steht der Grund eines Fehlers am Beleg. Welcher Anbieter gilt, zeigt **Einstellungen › KI-Assistenten und API**.

**„Der KI-Dienst unter … ist nicht erreichbar.“** Der Container erreicht den eigenen Dienst nicht. Meist steht `localhost` in `EXTRACTION_BASE_URL` (im Container ist das der Container selbst) oder der Dienst lauscht nur auf `127.0.0.1`. Siehe [Den Dienst aus dem Container erreichen](installation-anbindungen.md#den-dienst-aus-dem-container-erreichen).

**„Der KI-Dienst kennt das Modell … nicht.“** Das Modell ist beim Dienst nicht geladen (`ollama pull …`), der Name ist anders geschrieben als beim Anbieter (bei OpenRouter etwa mit Präfix wie `qwen/…`) oder die Basis-URL endet nicht auf `/v1` (bei OpenRouter `/api/v1`).

**„Die Antwort des KI-Dienstes passt nicht zum Belegschema.“** Das Modell hat kein gültiges JSON mit den Belegfeldern geliefert. Erneut auslesen hilft manchmal; sonst ein größeres oder ein anderes Vision-Modell wählen. Der Beleg wird nicht gebucht, die Felder füllst du von Hand aus.

**restic meldet beim Sichern der Belege „permission denied“.** Das passiert mit dem früheren Host-Skript `~/.config/haben/backup.sh`: Bei rootless Podman gehören die Dateien im Volume einer Unter-UID des Hosts, nicht deinem Nutzer. Das Backup läuft inzwischen im Container `haben-backup`, der das Volume selbst einhängt; stell um wie unter [Umzug vom Host-Skript der Quadlets](installation-backup.md#umzug-vom-host-skript-der-quadlets). Prüfe danach mit `journalctl --user -u haben-backup`, ob der Lauf durchging.

**`systemctl --user enable haben-backup.timer` findet die Unit nicht.** Der Timer gehört nach `~/.config/systemd/user/`, nicht ins Quadlet-Verzeichnis; `haben-backup.container` dagegen ins Quadlet-Verzeichnis, daraus erzeugt Podman `haben-backup.service`. Danach `systemctl --user daemon-reload`.

Weiter: [Erste Schritte](einrichtung.md) · [Entwicklung](entwicklung.md) · [Zurück zur Übersicht](ueberblick.md)
