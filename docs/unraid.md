---
title: "Haben auf Unraid installieren"
description: >-
  Haben auf Unraid mit drei Docker-Vorlagen: App, Datenbank und Backup, dazu Netzwerk, Ordner und Schlüssel aus einem
  Terminal-Befehl und HTTPS über einen Reverse Proxy.
---

# Unraid

Haben läuft auf Unraid als drei Container aus den Vorlagen in
[`deploy/unraid/`](https://github.com/firsttris/haben/tree/main/deploy/unraid): `haben-db`, `haben` und `haben-backup`,
mit denselben Images wie mit [Docker Compose](installation.md#docker-compose). In den Community Applications ist Haben
noch nicht; die Vorlagen holst du mit einem Befehl im Terminal.

## Voraussetzungen

- Unraid mit aktiviertem Docker.
- Für ELSTER ein Server mit Intel- oder AMD-Prozessor, siehe [ERiC einbinden](installation.md#eric-einbinden).
- Ein Reverse Proxy mit HTTPS, etwa Nginx Proxy Manager, SWAG oder Traefik aus den Community Applications, und eine
  Domain. Ohne HTTPS funktionieren Passkeys und die Installation als App nicht, und die Anmeldung ist nur unter der
  Adresse möglich, die du in `haben` einträgst.

## Vorbereiten

Im **Terminal** von Unraid (Symbol oben rechts):

```sh
docker network create haben
mkdir -p /mnt/user/appdata/haben/belege /mnt/user/appdata/haben/eric /mnt/user/appdata/haben/eric-log
chown -R 1000:1000 /mnt/user/appdata/haben/belege /mnt/user/appdata/haben/eric /mnt/user/appdata/haben/eric-log
for t in haben-db haben haben-backup; do
  wget -qO /boot/config/plugins/dockerMan/templates-user/my-$t.xml \
    https://raw.githubusercontent.com/firsttris/haben/main/deploy/unraid/$t.xml
done
echo "Datenbank-Passwort: $(openssl rand -hex 24)"
echo "AUTH_SECRET:        $(openssl rand -base64 32)"
echo "ENCRYPTION_KEY:     $(openssl rand -base64 32)"
echo "Backup-Passwort:    $(openssl rand -base64 32)"
```

- Das Netzwerk `haben` brauchen die Container, um sich beim Namen zu finden; im Standardnetz `bridge` geht das nicht.
- Die App läuft als Nutzer 1000, nicht als `nobody` (99) wie viele Unraid-Container. Ohne `chown` kann sie keine Belege
  speichern.
- Die vier Werte am Ende brauchst du gleich in den Vorlagen. **`ENCRYPTION_KEY` und das Backup-Passwort gehören
  zusätzlich in deinen Passwortmanager:** Ohne sie sind ELSTER-Zertifikat und gespeicherte Zugangsdaten nach einer
  Wiederherstellung verloren und das Backup wertlos.

## Container anlegen

Unter **Docker › Add Container** die Vorlagen in dieser Reihenfolge wählen, ausfüllen und mit **Apply** starten:

| Vorlage | Eintragen |
| --- | --- |
| `haben-db` | Datenbank-Passwort |
| `haben` | Adresse mit `https://`, etwa `https://haben.example.de` (Passkeys hängen daran, später nicht mehr ändern). In `DATABASE_URL` das Wort `DATENBANK-PASSWORT` durch das Datenbank-Passwort ersetzen. `AUTH_SECRET` und `ENCRYPTION_KEY` |
| `haben-backup` | Datenbank-Passwort und Backup-Passwort |

Weitere Einstellungen wie ERiC oder die KI-Auslesung stehen in `haben` unter **Show more settings**.

## Reverse Proxy

Der Proxy leitet deine Domain an `haben` weiter: an `haben:3000`, wenn er im Netzwerk `haben` hängt, sonst an
`IP-DES-SERVERS:3000`. Er muss Uploads bis 250 MB annehmen und bis zu 300 Sekunden auf eine Antwort warten; die Einträge
für Nginx Proxy Manager, Traefik und andere stehen unter [Eigener Reverse Proxy](installation.md#beispiele). Port 3000
gibst du im Router nicht frei.

## Konto anlegen

**Docker › `haben` › Logs** zeigt nach „Listening on …“ den Einrichtungscode. Ruf deine Domain auf, gib ihn ein und leg
dein Konto an; weiter geht es in [Erste Schritte](einrichtung.md).

## Backup

`haben-backup` sichert Datenbank und Belege jeden Tag um 03:15 Uhr mit restic nach `/mnt/user/appdata/haben/backups`, also
auf denselben Server. Gegen den Verlust des Servers trägst du unter **Show more settings** bei `RESTIC_REPOSITORY` ein
zweites System ein, siehe [Repository auf einem zweiten System](installation.md#repository-auf-einem-zweiten-system).
Das Plugin Appdata Backup ersetzt das nicht: Es stoppt die Container und kopiert ihre Ordner, ohne Test-Restore.

Ein Backup von Hand, etwa vor einem Update: **Docker › `haben-backup` › Console**, dort `backup.sh`.

Zum Wiederherstellen im Terminal, mit deinem Datenbank- und Backup-Passwort:

```sh
docker stop haben
docker run --rm -it --net haben -e PGHOST=haben-db -e PGPASSWORD='…' \
  -e RESTIC_REPOSITORY=/backups -e RESTIC_PASSWORD='…' \
  -v /mnt/user/appdata/haben/belege:/belege -v /mnt/user/appdata/haben/backups:/backups \
  --entrypoint restore.sh tristanteu/haben-backup:latest latest
docker start haben
```

Was dabei passiert, steht unter [Wiederherstellen](installation.md#wiederherstellen).

## Updates

Erst ein Backup von Hand wie oben, dann unter **Docker** mit **Check for Updates** und **apply update** alle drei
Container aktualisieren. Migrationen laufen beim Start der App, siehe [Updates](installation.md#updates).
