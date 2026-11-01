# haben-db

Datenbank für [Haben](https://github.com/firsttris/haben), die selbst gehostete Buchhaltung: das offizielle Image `postgres:18`, dazu die Programme der älteren PostgreSQL-Versionen ab 16.

Findet der Container beim Start im Volume einen Datenbestand einer älteren Version, hebt er ihn mit `pg_upgrade --copy` auf die Version des Images an und startet danach wie `postgres`. Ein Update auf ein neues PostgreSQL ist damit nur noch ein neues Image:

- Der alte Bestand bleibt unverändert erhalten und liegt danach in `<alte Version>/docker` im Volume, der neue in `<neue Version>/docker`.
- Schlägt das Upgrade fehl, bricht der Container ab und lässt alles, wie es war; das bisherige Image startet mit demselben Volume wie vorher.
- Kodierung, Locale, Prüfsummen, `pg_hba.conf` und Einstellungen aus `ALTER SYSTEM` übernimmt der neue Bestand vom alten.

Das Volume gehört nach `/var/lib/postgresql/data` (wie bei den älteren postgres-Images und in Habens `compose.yml` und Quadlet) oder nach `/var/lib/postgresql` (Vorgabe von `postgres` ab 18). Umgebungsvariablen wie beim offiziellen Image (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).

- Compose: Dienst `db` in [`deploy/compose.yml`](https://github.com/firsttris/haben/blob/main/deploy/compose.yml).
- Podman Quadlets: [`haben-db.container`](https://github.com/firsttris/haben/blob/main/deploy/quadlet/haben-db.container).
- Anleitung und Aufräumen danach: [Betrieb und Installation › PostgreSQL-Update](https://firsttris.github.io/haben/installation.html#postgresql-update).

Die Tags folgen Haben (`:latest`, `:0.2`, `:0.2.0`, `:next`).
