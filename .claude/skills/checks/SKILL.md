---
name: "checks"
description: "Prüfungen von Haben ausführen (lint, typecheck, Tests mit Postgres, build, Doku), mit Bun auf dem Rechner oder im Dev-Container aus compose.yml, mit eigener Compose-Instanz je Worktree. Vor jedem Push, im Review und immer, wenn Bun, PostgreSQL oder ein Werkzeug für die Tests fehlt."
---

# Prüfungen

Welche Prüfungen gelten, steht in `docs/entwicklung.md` unter „Mitwirken“; die Befehle im Container unter „Prüfungen ohne Bun auf dem Rechner“, eigene Instanzen unter „Mehrere Umgebungen nebeneinander“. Hier nur, wie ein Agent die Umgebung wählt und was er zurückmeldet.

## 1. Umgebung wählen

- `bun --version` gibt die Version aus `packageManager` in `package.json`: Prüfungen direkt mit Bun.
- Kein Bun oder eine andere Version: **Dev-Container aus `compose.yml`**, keine eigenen Ad-hoc-Container mit `oven/bun` o. Ä.
- Weder Bun noch Docker/Podman: der Person sagen, was fehlt, und nicht weiter raten.
- Kein PostgreSQL 18, aber ein anderes installiert: Das geht für die Tests (`initdb` in den Scratchpad, `pg_ctl … -o '-p 5433'`).

## 2. Eigene Compose-Instanz

Das Projekt `haben-dev` gehört der Person; **nie** deren Container oder Volumes anfassen, stoppen oder löschen. In einem Worktree, neben einer laufenden Umgebung oder bei parallelen Reviews bei **jedem** Befehl dieselben Variablen:

```sh
export COMPOSE_PROJECT_NAME=haben-<branch-kurz> HABEN_DEV_PORT=3201 HABEN_DEV_DB_PORT=5632
```

Ports vorher prüfen (`lsof -i :5632` oder `docker ps`). Am Ende `docker compose down -v` mit denselben Variablen, nur die eigene Instanz.

## 3. Ausführen

- Die Befehle aus „Mitwirken“, im Container mit dem Präfix aus „Prüfungen ohne Bun“. Dort heißt der Datenbankserver `db`, nicht `localhost`.
- Einzelne Tests: `bun --bun vitest run <pfad>`.
- E2E braucht die Browser von Playwright, die der Container nicht hat: dann nur in der CI. Port 3100 ist der E2E-Server.
- Doku ohne Zensical: der Einzeiler aus „Prüfungen ohne Bun“, er läuft auch im Worktree.

## 4. Übersprungenes melden

Ein grüner Lauf beweist nur, was gelaufen ist. Vitest nennt `skipped`; die Gründe stehen in der Tabelle unter „Tests“. Im Bericht und in der Beschreibung des Pull Requests: was lief, was übersprungen wurde und warum, und welche Prüfung nur die CI macht.
