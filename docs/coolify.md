---
title: "Haben mit Coolify installieren"
description: >-
  Haben in Coolify als Docker-Compose-Dienst: Datei einfügen, Domain eintragen, deployen. Schlüssel und HTTPS erzeugt
  Coolify selbst.
---

# Coolify

[Coolify](https://coolify.io/) startet Haben aus einer Datei,
[`deploy/coolify/compose.yml`](https://github.com/firsttris/haben/blob/main/deploy/coolify/compose.yml): App, Datenbank
und das tägliche Backup mit denselben Images wie mit [Docker Compose](installation.md#docker-compose). Die Schlüssel
erzeugt Coolify beim Anlegen, Domain und HTTPS übernimmt sein Proxy statt des mitgelieferten Caddy.

## Dienst anlegen

1. Im Projekt **+ New › Docker Compose** wählen und den Inhalt von
   [`deploy/coolify/compose.yml`](https://raw.githubusercontent.com/firsttris/haben/main/deploy/coolify/compose.yml)
   einfügen.
2. Beim Dienst `app` die Domain eintragen, mit `https://`, etwa `https://haben.example.de`. Ohne eigene Domain vergibt
   Coolify eine eigene; Passkeys hängen an der Domain, deshalb vor dem ersten Start festlegen.
3. **Deploy.** Im Log von `app` steht nach „Listening on …“ der Einrichtungscode. Ruf die Domain auf, gib ihn ein und leg
   dein Konto an; weiter geht es in [Erste Schritte](einrichtung.md).

Die übrigen Einstellungen aus [Umgebungsvariablen](installation.md#umgebungsvariablen), etwa `ERIC_AUTO_INSTALL=ja` oder
die KI-Auslesung, trägst du unter **Environment Variables** ein. ELSTER geht nur auf einem Server mit Intel- oder
AMD-Prozessor, siehe [ERiC einbinden](installation.md#eric-einbinden).

## Schlüssel sichern

Unter **Environment Variables** stehen die erzeugten Werte. Zwei davon gehören zusätzlich in deinen Passwortmanager:

| Variable in Coolify | entspricht | wofür |
| --- | --- | --- |
| `SERVICE_REALBASE64_ENCRYPTION` | `ENCRYPTION_KEY` | ELSTER-Zertifikat und gespeicherte Zugangsdaten |
| `SERVICE_REALBASE64_RESTIC` | `RESTIC_PASSWORD` | das Backup |

Ohne sie ist nach dem Verlust des Servers das Backup wertlos. Ändere keinen der erzeugten Werte, nachdem Haben einmal
lief.

## Lange Uploads

Der Proxy von Coolify ist Traefik. Er bricht eine Anfrage nach 60 Sekunden ab; ein großer Upload über eine langsame
Leitung endet dann mit Fehler 502. Unter **Server › Proxy** in der Konfiguration bei `command` diese Zeile ergänzen und den
Proxy neu starten:

```yaml
- '--entrypoints.https.transport.respondingTimeouts.readTimeout=600s'
```

## Backup

Der Dienst `backup` sichert Datenbank und Belege jeden Tag um 03:15 Uhr in das Volume `backups` auf demselben Server.
Gegen den Verlust des Servers trägst du unter **Environment Variables** bei `RESTIC_REPOSITORY` ein zweites System ein,
für S3 dazu `AWS_ACCESS_KEY_ID` und `AWS_SECRET_ACCESS_KEY`, siehe
[Repository auf einem zweiten System](installation.md#repository-auf-einem-zweiten-system).

Ein Backup von Hand, etwa vor einem Update: im **Terminal** von Coolify den Container `backup` wählen und `backup.sh`
ausführen.

Zum Wiederherstellen per SSH auf dem Server in den Ordner des Dienstes wechseln; die ID steht in der Adresse des Dienstes
in Coolify hinter `/service/`:

```sh
cd /data/coolify/services/<id>
docker compose stop app
docker compose run --rm restore latest
docker compose start app
```

Was dabei passiert, steht unter [Wiederherstellen](installation.md#wiederherstellen).

## Updates

Erst ein Backup von Hand wie oben, dann den Dienst neu deployen; Coolify holt dabei die aktuellen Images. Migrationen
laufen beim Start der App, siehe [Updates](installation.md#updates).
