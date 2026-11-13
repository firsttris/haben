---
title: "Haben auf TrueNAS SCALE installieren"
description: >-
  Haben auf TrueNAS SCALE als eigene App aus einer YAML-Datei: Adresse eintragen, installieren, HTTPS über Nginx Proxy
  Manager. Die Schlüssel erzeugt die App beim ersten Start.
---

# TrueNAS SCALE

Haben läuft auf TrueNAS SCALE als eigene App aus einer Datei,
[`deploy/truenas/compose.yml`](https://github.com/firsttris/haben/blob/main/deploy/truenas/compose.yml). Du änderst darin
eine Zeile, die Adresse. Die Schlüssel erzeugt die App beim ersten Start selbst, HTTPS übernimmt ein Reverse Proxy.

Gestartet werden dieselben Images wie mit [Docker Compose](installation.md#docker-compose): App, Datenbank und das
tägliche Backup, dazu der kurze Dienst `schluessel`, der die Schlüssel anlegt.

## Voraussetzungen

- TrueNAS SCALE 24.10 oder neuer; ältere Versionen nutzen für Apps noch Kubernetes statt Docker.
- Ein Reverse Proxy mit HTTPS und eine Domain, etwa die App Nginx Proxy Manager aus dem Katalog. Ohne HTTPS
  funktionieren Passkeys und die Installation als App nicht.

## App installieren

1. **Apps › Discover Apps › Custom App › Install via YAML**, Name `haben`.
2. Den Inhalt von [`deploy/truenas/compose.yml`](https://raw.githubusercontent.com/firsttris/haben/main/deploy/truenas/compose.yml)
   einfügen und in der Zeile `BETTER_AUTH_URL` deine Adresse eintragen, mit `https://`, etwa
   `BETTER_AUTH_URL: https://haben.example.de`. Passkeys hängen an dieser Adresse; später nicht mehr ändern.
3. Speichern. Der erste Start lädt die Images, das dauert ein paar Minuten.

Ist Port 3000 schon belegt, änderst du die linke Zahl in `3000:3000` und nimmst sie auch im Proxy.

## Schlüssel sichern

**Apps › haben › Workloads**: Das Log des Containers `haben-schluessel` zeigt `ENCRYPTION_KEY` und `RESTIC_PASSWORD`.
Trag beide in deinen Passwortmanager ein, bevor du weitermachst.

> [!IMPORTANT]
> Ohne `ENCRYPTION_KEY` lassen sich ELSTER-Zertifikat und gespeicherte Zugangsdaten nach einer Wiederherstellung nicht mehr
> öffnen, ohne `RESTIC_PASSWORD` ist das Backup wertlos. Beide liegen sonst nur auf dem Server selbst.

## Reverse Proxy

Im Proxy einen Eintrag für deine Domain anlegen, Ziel `IP-DES-SERVERS`, Port `3000`, mit einem Let's-Encrypt-Zertifikat.
Er muss Uploads bis 250 MB annehmen und bis zu 300 Sekunden auf eine Antwort warten; die Einträge für Nginx Proxy Manager
und andere stehen unter [Eigener Reverse Proxy](installation.md#beispiele). Port 3000 gibst du im Router nicht frei.

## Konto anlegen

Im Log des Containers `haben-app` steht nach „Listening on …“ der Einrichtungscode. Ruf deine Adresse auf, gib ihn ein und
leg dein Konto an; weiter geht es in [Erste Schritte](einrichtung.md). ERiC für ELSTER lädst du unter
**Einstellungen › ELSTER › ERiC** per Knopf herunter, siehe [ERiC einbinden](installation.md#eric-einbinden).

## Backup

Der Container `haben-backup` sichert Datenbank und Belege jeden Tag um 03:15 Uhr mit restic in das Volume `backups` auf
demselben Server. Gegen den Verlust des Servers trägst du in der App (**Edit**) bei `RESTIC_REPOSITORY` ein zweites System
ein, für S3 dazu `AWS_ACCESS_KEY_ID` und `AWS_SECRET_ACCESS_KEY`, siehe
[Repository auf einem zweiten System](installation.md#repository-auf-einem-zweiten-system).

Ein Backup von Hand, etwa vor einem Update: in der Shell des Containers `haben-backup` (**Workloads**) `backup.sh`
ausführen.

Zum Wiederherstellen in **System › Shell**:

```sh
sudo docker stop haben-app
sudo docker exec -it haben-backup restore.sh latest
sudo docker start haben-app
```

Was dabei passiert, steht unter [Wiederherstellen](installation.md#wiederherstellen).

## Updates

Erst ein Backup von Hand wie oben, dann unter **Apps › haben** mit **Update** bzw. **Pull Images** die aktuellen Images
holen. Migrationen laufen beim Start der App, siehe [Updates](installation.md#updates).
