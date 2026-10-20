# haben-backup

Backup für [Haben](https://github.com/firsttris/haben), die selbst gehostete Buchhaltung: ein SQL-Dump der Datenbank und die Belegdateien, verschlüsselt mit [restic](https://restic.net). Basis ist `postgres:16`, `pg_dump` hat also dieselbe Major-Version wie die Datenbank von Haben.

- Compose: Dienst `backup` in [`deploy/compose.yml`](https://github.com/firsttris/haben/blob/main/deploy/compose.yml), sichert täglich um `BACKUP_TIME` (Standard 03:15).
- Podman Quadlets: [`haben-backup.container`](https://github.com/firsttris/haben/blob/main/deploy/quadlet/haben-backup.container), gestartet von `haben-backup.timer`.
- Aufbewahrung: 14 tägliche, 24 monatliche und 11 jährliche Stände (GoBD: 10 Jahre).
- Repository standardmäßig im Volume unter `/backups`, mit `RESTIC_REPOSITORY` (`sftp:…`, `s3:…`, `rest:…`) auf einem zweiten System.

| Befehl | |
| --- | --- |
| (keiner) | Zeitplan: `backup.sh` täglich um `BACKUP_TIME` |
| `backup.sh` | Ein Backup jetzt; alle `RESTORE_CHECK_DAYS` Tage (Standard 7) folgt ein Test-Restore |
| `restore-check.sh` / `restore-check.sh <id>` | Test-Restore jetzt: in eine Wegwerf-Datenbank einspielen, Hash-Kette, Siegel und Belege prüfen, nichts ersetzen |
| `restore.sh` | Verfügbare Stände anzeigen |
| `restore.sh latest` / `restore.sh <id>` | Datenbank und Belege ersetzen (App vorher stoppen, `/belege` schreibbar einhängen) |

Die Tags folgen Haben (`:latest`, `:0.2`, `:0.2.0`, `:next`). Einrichten, Wiederherstellen und Update zurücknehmen: [Betrieb und Installation › Backup und Wiederherstellen](https://firsttris.github.io/haben/installation.html#backup-und-wiederherstellen).
