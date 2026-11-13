---
title: "Haben auf Synology installieren (Container Manager)"
description: >-
  Haben auf einer Synology-NAS ohne Kommandozeile: eine Datei in den Container Manager einfügen, Adresse
  eintragen, Reverse Proxy mit Let's-Encrypt-Zertifikat von DSM.
---

# Synology

Haben läuft auf einer Synology im Container Manager als Projekt aus einer einzigen Datei,
[`deploy/synology/compose.yml`](https://github.com/firsttris/haben/blob/main/deploy/synology/compose.yml). Du änderst darin
eine Zeile, die Adresse. Die Schlüssel erzeugt das Projekt beim ersten Start selbst, HTTPS übernimmt der Reverse Proxy von
DSM. Eine Kommandozeile brauchst du dafür nicht, nur zum Wiederherstellen eines Backups.

Gestartet werden dieselben Images wie mit [Docker Compose](installation.md#docker-compose): App, Datenbank und das
tägliche Backup, dazu der kurze Dienst `schluessel`, der die Schlüssel anlegt.

## Voraussetzungen

- DSM 7.2 oder neuer mit dem Paket **Container Manager** (Paket-Zentrum). Es gibt ihn für Modelle mit Intel- oder
  AMD-Prozessor und für einige mit ARMv8, etwa DS223 und DS124.
- Für die Übermittlung an ELSTER ein Modell mit Intel- oder AMD-Prozessor. Auf ARM läuft alles andere, ELSTER nur
  emuliert und mit Shell, siehe [ELSTER auf arm64](installation-anbindungen.md#elster-auf-arm64).
- Eine Adresse mit HTTPS, sonst funktionieren Passkeys und die Installation als App nicht. Am einfachsten ist ein Name bei
  Synology DDNS (`deinname.synology.me`) mit dem Zertifikat von Let's Encrypt, das DSM selbst holt und erneuert, auch
  [nur fürs Heimnetz](#nur-im-heimnetz-ohne-internet).

## Adresse und Zertifikat

1. **Systemsteuerung › Externer Zugriff › DDNS › Hinzufügen:** Dienstanbieter Synology, Hostname etwa
   `deinname.synology.me`. Hast du schon einen DDNS-Namen, nimmst du den.
2. **Systemsteuerung › Sicherheit › Zertifikat › Hinzufügen › Zertifikat von Let's Encrypt abrufen:** Domain
   `deinname.synology.me`, als alternativen Namen `*.deinname.synology.me`. Das Platzhalter-Zertifikat gilt dann auch für
   `haben.deinname.synology.me`.

Haben bekommt so eine eigene Subdomain, etwa `https://haben.deinname.synology.me`. Unter einem Unterpfad wie
`deinname.synology.me/haben` läuft es nicht. Leg dich vorher fest: Passkeys hängen an dieser Adresse.

## Projekt anlegen

1. **File Station:** im Ordner `docker` einen Ordner `haben` anlegen (gibt es `docker` nicht, legt der Container Manager
   ihn bei der Installation an).
2. **Container Manager › Projekt › Erstellen:** Projektname `haben`, Pfad `/docker/haben`, Quelle „docker-compose.yml
   erstellen“.
3. Den Inhalt von [`deploy/synology/compose.yml`](https://raw.githubusercontent.com/firsttris/haben/main/deploy/synology/compose.yml)
   in das Feld kopieren und in der Zeile `BETTER_AUTH_URL` deine Adresse eintragen, mit `https://`, etwa
   `BETTER_AUTH_URL: https://haben.deinname.synology.me`.
4. Die Webportal-Einstellungen überspringen, „Projekt nach der Erstellung starten“ anhaken und fertigstellen. Der erste
   Start lädt die Images, das dauert ein paar Minuten.

## Schlüssel sichern

**Container Manager › Container › `haben-schluessel` › Details › Protokoll** zeigt `ENCRYPTION_KEY` und
`RESTIC_PASSWORD`. Trag beide in deinen Passwortmanager ein, bevor du weitermachst.

> [!IMPORTANT]
> Ohne `ENCRYPTION_KEY` lassen sich ELSTER-Zertifikat und gespeicherte Zugangsdaten nach einer Wiederherstellung nicht mehr
> öffnen, ohne `RESTIC_PASSWORD` ist das Backup wertlos. Beide liegen sonst nur auf der Synology selbst.

## Reverse Proxy

**Systemsteuerung › Anmeldeportal › Erweitert › Reverse Proxy › Erstellen:**

| Feld | Quelle | Ziel |
| --- | --- | --- |
| Protokoll | HTTPS | HTTP |
| Hostname | `haben.deinname.synology.me` | `127.0.0.1` |
| Port | 443 | 3000 |

Dazu HSTS aktivieren. In den erweiterten Einstellungen den Proxy-Lese-Timeout auf 300 Sekunden setzen: Eine Übermittlung an
ELSTER wartet in der Anfrage auf ERiC, mit dem Standard bräche sie nach 60 Sekunden ab.

Danach unter **Systemsteuerung › Sicherheit › Zertifikat › Einstellungen** für `haben.deinname.synology.me` das
Zertifikat aus dem ersten Abschnitt wählen.

Die App ist nur auf der Synology selbst unter `127.0.0.1:3000` erreichbar, nicht im Netz; `localhost:3000` oder die IP
der Synology im Browser deines Rechners führen deshalb nicht zu Haben. Als Ziel `127.0.0.1` statt `localhost`: Der Port
ist nur auf dieser IPv4-Adresse veröffentlicht, `localhost` kann auf `::1` (IPv6) zeigen. Ist Port 3000 schon belegt,
änderst du im Projekt die linke Zahl in `127.0.0.1:3000:3000` und nimmst sie auch im Reverse Proxy.

## Nur im Heimnetz oder auch aus dem Internet

Über Synology DDNS zeigt `haben.deinname.synology.me` auf die öffentliche Adresse deines Anschlusses, also von außen auf
deinen Router. Ob Haben nur zu Hause oder auch unterwegs erreichbar ist, entscheidest du mit einem der beiden Wege. Ohne
einen davon endet der Aufruf mit einer Zeitüberschreitung (`ERR_CONNECTION_TIMED_OUT`).

### Nur im Heimnetz, ohne Internet

Im Router gibst du nichts frei. Stattdessen zeigt derselbe Name im Heimnetz auf die Synology:

- **Ein Rechner:** in der hosts-Datei eine Zeile mit der IP der Synology im Heimnetz und dem Namen, etwa
  `192.168.178.20 haben.deinname.synology.me`. Unter Windows ist das `C:\Windows\System32\drivers\etc\hosts`, mit dem
  Editor als Administrator geöffnet, unter macOS und Linux `/etc/hosts`.
- **Alle Geräte, auch Handys:** ein DNS-Eintrag im Heimnetz, etwa mit dem Paket **DNS Server** der Synology, mit Pi-hole
  oder AdGuard Home, den der Router als DNS-Server verteilt. Fragt stattdessen eine Fritzbox diesen DNS-Server für ihre
  Geräte, lässt sie die Antwort mit einer Adresse aus dem Heimnetz nur durch, wenn der Name beim DNS-Rebind-Schutz als
  Ausnahme eingetragen ist.

Das Zertifikat bleibt gültig, weil der Name derselbe ist. Die IP der Synology oder ein selbst signiertes Zertifikat
reichen nicht: Der Browser warnt, und Passkeys gehen nur unter dem Namen aus `BETTER_AUTH_URL`, siehe
[Passkeys und Domain](installation.md#passkeys-und-domain).

### Auch aus dem Internet

Der Router leitet Port 443 an die Synology weiter (Fritzbox: **Internet › Freigaben**). Die Anmeldeseite ist dann aus dem
Internet erreichbar. Ein Gerät im Heimnetz erreicht Haben über die öffentliche Adresse nur, wenn der Router solche
Anfragen ins Heimnetz zurückleitet; nicht jeder kann das, dann hilft der Eintrag aus dem Weg oben zusätzlich. Ohne eigene
öffentliche IPv4-Adresse (DS-Lite, bei manchen Kabelanschlüssen) geht die Freigabe über IPv4 nicht.

## Konto anlegen

**Container Manager › Container › `haben-app` › Details › Protokoll** zeigt nach „Listening on …“ den
Einrichtungscode. Ruf deine Adresse auf, gib den Code ein und leg dein Konto an; weiter geht es in
[Erste Schritte](einrichtung.md).

ERiC für ELSTER lädst du unter **Einstellungen › ELSTER › ERiC** per Knopf herunter, siehe
[ERiC einbinden](installation-anbindungen.md#eric-einbinden).

## Backup

Der Container `haben-backup` sichert Datenbank und Belege jeden Tag um 03:15 Uhr mit restic in das Volume `backups`, also
auf dieselbe Synology. Ob es lief, zeigt Haben unter **Einstellungen › Export**; die Übersicht warnt, wenn ein Lauf fehlschlug. Gegen einen Defekt der Synology hilft nur
ein zweiter Ort: Trag im Projekt (**Projekt › haben › YAML-Konfiguration**) bei `RESTIC_REPOSITORY` ein zweites System
ein, etwa einen S3-Speicher (dazu `AWS_ACCESS_KEY_ID` und `AWS_SECRET_ACCESS_KEY`) oder einen restic REST-Server, siehe
[Repository auf einem zweiten System](installation-backup.md#repository-auf-einem-zweiten-system). SFTP braucht einen
eingehängten SSH-Schlüssel und damit die Kommandozeile.

Ein Backup von Hand, etwa vor einem Update: **Container › `haben-backup` › Details › Terminal**, dort `backup.sh`
ausführen.

Zum Wiederherstellen brauchst du SSH (**Systemsteuerung › Terminal & SNMP › SSH-Dienst aktivieren**). Im Projektordner:

```sh
cd /volume1/docker/haben
sudo docker compose stop app
sudo docker compose run --rm restore latest
sudo docker compose start app
```

Was dabei passiert und wie du einen älteren Stand wählst, steht unter [Wiederherstellen](installation-backup.md#wiederherstellen).

## Updates

Erst ein Backup von Hand wie oben, dann im **Container Manager › Projekt › haben** das Projekt stoppen, unter **Image** die
Images `tristanteu/haben`, `tristanteu/haben-db` und `tristanteu/haben-backup` aktualisieren und das Projekt wieder
starten. Migrationen laufen beim Start der App, siehe [Updates](installation-backup.md#updates).
