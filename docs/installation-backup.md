---
title: "Backup, Wiederherstellen und Updates"
description: >-
  Tägliches Backup mit restic, Repository auf einem zweiten System, Test-Restore, Wiederherstellen, Updates und PostgreSQL-Update.
---

# Backup und Updates

## Backup und Wiederherstellen

Ein Update lässt sich nicht einfach zurücknehmen: Migrationen ändern die Datenbank und laufen nicht rückwärts. Zurück geht es nur mit dem alten Image **und** dem Backup von vor dem Update. Deshalb läuft das Backup in beiden Varianten im selben Container, `tristanteu/haben-backup` (aus `deploy/backup`):

| | Compose | Quadlets |
| --- | --- | --- |
| Zeitplan | Dienst `backup`, täglich um `BACKUP_TIME` (Standard 03:15, Zeitzone Europe/Berlin) | `haben-backup.timer` startet `haben-backup.container` täglich um 03:15 Uhr, ein verpasster Lauf wird nachgeholt (`Persistent=true`) |
| Backup jetzt | `docker compose exec backup backup.sh` | `systemctl --user start haben-backup` |
| Protokoll | `docker compose logs backup` | `journalctl --user -u haben-backup` |
| Stand | `docker compose exec app haben status`: Version (mit Commit, wenn das Image ihn kennt), ERiC und letzte erfolgreiche Sicherung, mit Hinweis, wenn der letzte Lauf fehlschlug oder seit zwei Tagen keiner gelang (`--json` für Skripte) | `podman exec haben-app haben status` |
| Passwort des Backups | `RESTIC_PASSWORD` in `.env` | Secret `haben-restic-password` |
| Repository auf einem zweiten System | `RESTIC_REPOSITORY` in `.env` | `RESTIC_REPOSITORY` in `~/.config/haben/backup.env` |
| Test-Restore | alle `RESTORE_CHECK_DAYS` Tage (`.env`, Standard 7) | alle `RESTORE_CHECK_DAYS` Tage (`backup.env`, Standard 7) |

Ein Lauf

1. legt beim ersten Mal das restic-Repository an,
2. erzeugt mit `pg_dump` über das Netz einen SQL-Dump der Datenbank, packt ihn mit gzip und prüft ihn: Das Archiv muss sich entpacken lassen und mit der Abschlusszeile von `pg_dump` enden, sonst bricht das Backup mit Fehler ab,
3. sichert den Dump und die Belegdateien (Volume `belege` bzw. `haben-belege`, nur lesend eingehängt) verschlüsselt mit `restic backup --tag haben`,
4. räumt alte Stände auf: 14 tägliche, 24 monatliche und 11 jährliche Snapshots bleiben (`restic forget --prune`). Die Jahresstände decken die zehnjährige Aufbewahrung nach § 147 Abs. 3 AO ab,
5. trägt das Ergebnis in die Datenbank ein; die App zeigt es unter Einstellungen › Export und warnt in der Übersicht, wenn ein Lauf fehlschlug oder seit zwei Tagen kein Backup durchlief,
6. spielt alle `RESTORE_CHECK_DAYS` Tage (Standard 7) das neue Backup probeweise ein (siehe [Test-Restore](#test-restore)).

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

Auf ein erfolgreiches Backup folgt alle `RESTORE_CHECK_DAYS` Tage (Standard 7, `0` schaltet es ab) `restore-check.sh`. Es ersetzt nichts:

1. `restic check --read-data-subset 5%` liest einen Teil der Daten im Repository und prüft sie (`RESTORE_CHECK_SUBSET`),
2. der Dump aus dem Snapshot wird in eine Wegwerf-Datenbank `haben_restore_check_…` eingespielt (eigener Name je Lauf),
3. darin prüft es Hash-Kette und Siegel wie „Kette prüfen“ in der App, und der letzte Eintrag der Kette im Backup muss mit demselben Hash in der laufenden Datenbank stehen,
4. 20 zufällige Belege (`RESTORE_CHECK_FILES`) kommen aus dem Snapshot und müssen ihre SHA-256-Prüfsumme haben,
5. die Wegwerf-Datenbank wird wieder gelöscht, das Ergebnis steht in der App.

`RESTORE_CHECK_SUBSET` (Standard `5%`) und `RESTORE_CHECK_FILES` (Standard 20) wirken nur bei den Quadlets in `backup.env`; `compose.yml` reicht sie nicht an den Dienst `backup` durch.

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

Auf einem frischen System richtest du Haben zuerst wie oben ein, mit demselben `HABEN_ENCRYPTION_KEY`, demselben Passwort des Backups und demselben `RESTIC_REPOSITORY`. Dann startest du nur die Datenbank (`docker compose up -d db` bzw. `systemctl --user start haben-db`) und legst die App-Rolle aus [Getrennte Datenbankrollen](installation-konfiguration.md#getrennte-datenbankrollen) an. Erst danach den Dump wiederherstellen und die App starten. [`pg_dump`](https://www.postgresql.org/docs/18/app-pgdump.html) sichert die Zugriffsrechte, aber keine Rollendefinitionen oder Rollenpasswörter: Die im Dump genannte Rolle muss vor dem Einspielen existieren. Ihre Zugangsdaten deshalb ebenfalls im Passwortmanager aufbewahren; beim neuen Ziel können sie neu gewählt werden, wenn `DATABASE_URL` dazu passt. Beim Start werden die Rechte erneut gesetzt, auch die Datenbankrechte, die der Dump ohne `--create` nicht enthält. Lief die App schon, stoppst du sie vorher; `restore.sh` ersetzt die leere Datenbank genauso. Probiere die Wiederherstellung einmal aus, bevor du dich auf das Backup verlässt.

### Update zurücknehmen

1. Vor dem Update ein Backup machen (`docker compose exec backup backup.sh` bzw. `systemctl --user start haben-backup`), wie unter [Updates](#updates).
2. Geht nach dem Update etwas schief: die vorherige Version fest eintragen, in `compose.yml` etwa `image: tristanteu/haben:x.y.z`, im Quadlet `Image=docker.io/tristanteu/haben:x.y.z`.
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

`haben-app.container` und `haben-db.container` tragen `AutoUpdate=registry`; mit `systemctl --user enable --now podman-auto-update.timer` prüft Podman täglich selbst auf neue Images. Willst du Updates von Hand steuern, setze im Quadlet eine feste Version (`Image=docker.io/tristanteu/haben:x.y`) und ändere sie bewusst. Bei einem selbst gebauten Image: `git pull`, `podman build -t haben -f Containerfile .` und `systemctl --user restart haben-app`.

`podman auto-update` tauscht nur das Image. Lädst du neue Quadlet-Dateien wie `haben-app.container`, hole auch die `.volume`-Dateien, auf die sie verweisen (etwa `haben-eric-log.volume`), und führe danach `systemctl --user daemon-reload` aus.

### PostgreSQL-Update

Die Datenbank läuft im Image `tristanteu/haben-db` (aus `deploy/db`): das offizielle `postgres:18` plus die Programme der älteren Versionen ab 16. Findet der Container beim Start im Volume noch einen Datenbestand einer älteren Version, hebt er ihn mit `pg_upgrade` an und startet danach normal. Ein Update auf ein neues Postgres ist damit ein normales Update wie oben, mit Backup vorher. Das Upgrade dauert bei einer Buchhaltung meist unter einer Minute; im Log steht es so:

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
