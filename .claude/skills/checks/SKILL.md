---
name: "checks"
description: "Prüfungen von Haben ausführen (lint, typecheck, Tests mit Postgres, build, Doku), mit Bun auf dem Rechner oder im Dev-Container aus compose.yml, mit eigener Compose-Instanz je Worktree. Vor jedem Push, im Review und immer, wenn Bun, PostgreSQL oder ein Werkzeug für die Tests fehlt."
---

# Prüfungen

Welche Prüfungen gelten, steht in `CLAUDE.md` (Checks); dieser Skill sagt, **wie** sie laufen, wenn nicht alles installiert ist. Die Anleitung für Menschen steht in `docs/entwicklung.md` unter „Mit Docker Compose“ und „Tests“.

## 1. Umgebung wählen

- `bun --version` gibt die Version aus `packageManager` in `package.json`: Prüfungen direkt mit Bun, Datenbank siehe Schritt 3.
- Kein Bun oder eine andere Version: **Dev-Container aus `compose.yml`**. Keine eigenen Ad-hoc-Container mit `oven/bun` o. Ä. bauen; der Dev-Container hat dieselben Werkzeuge wie die Doku beschreibt (`poppler-utils`, `zip`, `unzip`).
- Weder Bun noch Docker/Podman: der Person sagen, was fehlt, und nicht weiter raten.

## 2. Eigene Compose-Instanz

Das Projekt in `compose.yml` heißt fest `haben-dev`. Das gehört der Person; **nie** deren Container oder Volumes anfassen, stoppen oder löschen.

- In einem Git-Worktree, neben einer laufenden Umgebung oder bei parallelen Reviews: eigener Projektname und freie Ports, bei **jedem** Befehl gleich:

  ```sh
  export COMPOSE_PROJECT_NAME=haben-<branch-kurz> HABEN_DEV_PORT=3201 HABEN_DEV_DB_PORT=5632
  ```

  Ports vorher prüfen (`lsof -i :5632` oder `docker ps`). `run` startet die Datenbank mit und gibt ihren Port frei; ohne eigenen Port stößt es mit der laufenden Umgebung zusammen.
- Am Ende abräumen: `docker compose down -v` (mit denselben Variablen). Nur die eigene Instanz.

## 3. Prüfungen ausführen

Mit Bun auf dem Rechner wie in `CLAUDE.md`. Im Container:

```sh
docker compose run --rm -u bun app bun install --frozen-lockfile
docker compose run --rm -u bun app bun run lint
docker compose run --rm -u bun app bun run typecheck
docker compose run --rm -u bun app bun run build
docker compose up -d db && docker compose exec db createdb -U haben haben_test   # einmal je Instanz
docker compose run --rm -u bun -e TEST_DATABASE_URL=postgres://haben:haben@db:5432/haben_test app bun run test
```

- Im Container heißt der Datenbankserver `db`, nicht `localhost`.
- Einzelne Tests: `… app bun --bun vitest run <pfad>`.
- E2E (`bun run e2e`) braucht die Browser von Playwright, die der Container nicht hat: läuft in der CI; lokal nur mit Bun auf dem Rechner und `E2E_DATABASE_URL` auf eine Datenbank, deren Name auf `e2e` endet. Port 3100 ist der E2E-Server.
- Doku, wenn `docs/` oder `mkdocs.yml` geändert sind: ohne `mkdocs` auf dem Rechner der Zweizeiler aus `docs/entwicklung.md` („Prüfungen ohne Bun auf dem Rechner“). Er hängt das Git-Verzeichnis mit ein und läuft deshalb auch im Worktree.

Nie gegen eine Datenbank mit echten Daten testen; die Tests leeren `<name>`, `<name>_vorlage` und `<name>_<n>`.

## 4. Übersprungenes melden

Ein grüner Lauf beweist nur, was gelaufen ist. Die Ausgabe von Vitest nennt `skipped`; die Gründe stehen in der Tabelle in `docs/entwicklung.md` (Tests): ohne `TEST_DATABASE_URL` alle Postgres-Tests, ohne `pdftotext`/`pdftoppm` die PDF-Tests, ohne `cc` die Mock-ERiC-Tests, ohne ERiC die echten ERiC-Tests, ohne Netz das SEPA-Schema der DK. Ohne `zip` oder `unzip` schlägt der Paket-Test von `scripts/elster-helfer` fehl, das ist dann kein Fehler der Änderung.

Im Bericht und in der Beschreibung des Pull Requests: was lief, was übersprungen wurde und warum, und welche Prüfung nur die CI macht.
