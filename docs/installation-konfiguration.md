---
title: "Umgebungsvariablen und Datenablage"
description: >-
  Alle Umgebungsvariablen von Haben und wo Datenbank, Belege, ERiC und Backups liegen.
---

# Konfiguration

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
| `ERIC_WORKER_COMMAND` | nein | Befehl, der den ERiC-Worker statt der eigenen Laufzeit startet; `worker.ts` kommt als letztes Argument dazu. Mehrere Wörter durch Leerzeichen getrennt, ohne Anführungszeichen. Für ELSTER auf arm64 das Skript aus `deploy/eric-x86_64/einrichten.sh`, siehe [ELSTER auf arm64](installation-anbindungen.md#elster-auf-arm64) | `/opt/haben-x86_64/worker.sh` |
| `ELSTER_HERSTELLER_ID` | nein | Eigene Hersteller-ID, genau fünf Ziffern. Mit ERiC 43 nötig für Prüfen, Test- und Echtübermittlung; ohne ERiC läuft alles simuliert | `12345` |
| `DOCUMENTS_DIR` | nein | Ablage der Belegdateien. Standard `data/belege` (relativ zum Arbeitsverzeichnis); im Image `/var/lib/haben/belege` | `/var/lib/haben/belege` |
| `ANTHROPIC_API_KEY` | nein | Schaltet die KI-Auslesung von Belegen mit Claude ein | `sk-ant-…` |
| `EXTRACTION_BASE_URL` | nein | Basis-URL eines KI-Dienstes mit OpenAI-kompatibler Schnittstelle, selbst betrieben (Ollama) oder in der Cloud (OpenRouter, OpenAI, …). Ist sie gesetzt, liest nur dieser Dienst Belege aus, auch wenn `ANTHROPIC_API_KEY` gesetzt ist ([OpenAI-kompatible Schnittstelle](installation-anbindungen.md#ki-auslesung-über-openai-kompatible-schnittstelle)) | `http://host.docker.internal:11434/v1`, `https://openrouter.ai/api/v1` |
| `EXTRACTION_MODEL` | mit `EXTRACTION_BASE_URL` | Name des Vision-Modells beim Dienst, so wie der Dienst ihn schreibt. Fehlt er, startet die App nicht | `qwen2.5vl:7b` |
| `EXTRACTION_API_KEY` | nein | Schlüssel des Dienstes, falls er einen verlangt; geht als `Authorization: Bearer …` mit | `…` |
| `EXTRACTION_PROVIDER` | nein | Anbieter ausdrücklich wählen: `anthropic` oder `openai-compatible`. Ohne Angabe gilt der eigene Dienst, sobald `EXTRACTION_BASE_URL` gesetzt ist | `openai-compatible` |
| `EXTRACTION_TIMEOUT_SECONDS` | nein | Wartezeit auf den eigenen Dienst je Beleg, 5 bis 3600. Standard `300` | `600` |
| `EXTRACTION_MAX_PAGES` | nein | So viele PDF-Seiten gehen höchstens als Bild an den eigenen Dienst, 1 bis 20. Standard `4` | `2` |
| `EXTRACTION_INPUT` | nein | Was bei PDFs an den eigenen Dienst geht: `text-und-bild` (Text der Seiten aus der Textschicht und Seitenbilder), `text` (nur Text, für ein reines Textmodell) oder `bild` (nur Seitenbilder). Standard `text-und-bild`, siehe [KI-Auslesung](belege.md#ki-auslesung) | `text` |
| `EXTRACTION_EXTRA_BODY` | nein | Zusätzliche Felder im Request-Body an den eigenen Dienst, als JSON-Objekt. Für Modelle, die sonst ihr Antwortbudget mit Denken verbrauchen (`reasoning_tokens`), etwa DeepSeek über ein Gateway: `{"reasoning_effort":"none"}`. `model`, `messages`, `stream` und `response_format` setzt Haben selbst und überschreibt sie. Ohne Angabe geht der Body unverändert raus, siehe [KI-Auslesung](belege.md#ki-auslesung) | `{"reasoning_effort":"none"}` |
| `LAYOUTS_MAX_COUNT` | nein | Höchstzahl eigener Belegvorlagen ([Eigene Belegvorlagen](belegvorlagen.md)), damit niemand die Installation überlädt. Ohne Angabe unbegrenzt | `20` |
| `LAYOUTS_MAX_MB` | nein | Speicher für eigene Belegvorlagen in MB, Quelltexte und freigegebene Pakete zusammen. Ohne Angabe unbegrenzt; eine einzelne Vorlage hat höchstens 256 KB | `50` |
| `LAYOUTS_PACKAGES_URL` | nein | Andere Quelle für die Typst-Pakete eigener Belegvorlagen, etwa ein Spiegel ohne Zugang ins Internet; darunter je Paket `<name>-<version>.tar.gz`. Standard `https://packages.typst.org/preview` | `https://spiegel.example/typst/preview` |
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
