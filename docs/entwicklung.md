---
title: "Entwicklung: an Haben mitarbeiten"
description: >-
  Lokale Entwicklungsumgebung mit Bun und PostgreSQL, Befehle, Tests, Migrationen und Konventionen
  für alle, die an Haben mitarbeiten wollen.
---

# Entwicklung

Den Aufbau im Detail beschreibt [Architektur](architektur.md).

## Voraussetzungen

- [Bun](https://bun.com) in der Version aus `packageManager` in `package.json` (Laufzeit und Paketmanager zugleich; Node, npm und pnpm braucht Haben nicht)
- PostgreSQL 18, lokal oder als Container
- Alternativ zu beiden: Docker oder Podman mit Compose, siehe [Mit Docker Compose](#mit-docker-compose)
- Optional: ein C-Compiler (`cc`) für die ERiC-Tests mit nachgebauter Bibliothek, Java 25 (wie in der CI) für den KoSIT-Validator

## Lokale Umgebung

```sh
git clone https://github.com/firsttris/haben.git
cd haben
bun install
cp apps/web/.env.example apps/web/.env
```

In `apps/web/.env` trägst du mindestens `DATABASE_URL`, `BETTER_AUTH_SECRET` und `HABEN_ENCRYPTION_KEY` ein (beide mit `openssl rand -base64 32`). `BETTER_AUTH_URL` bleibt `http://localhost:3000`. Alle Variablen erklärt [Konfiguration](installation-konfiguration.md#umgebungsvariablen).

> [!NOTE]
> Leere Zeilen wie `ELSTER_HERSTELLER_ID=` gelten als nicht gesetzt. Ohne ERiC (`ERIC_HOME` oder unter Einstellungen geladen nach `ERIC_DIR`) arbeitet Haben mit dem simulierten ELSTER-Client, ohne `ANTHROPIC_API_KEY` oder `EXTRACTION_BASE_URL` ohne KI-Auslesung. Für die Auslesung mit einem eigenen Modell genügt ein lokales Ollama mit `EXTRACTION_BASE_URL=http://localhost:11434/v1` und `EXTRACTION_MODEL=qwen2.5vl:7b`; PDFs brauchen dafür `pdftoppm` (Paket poppler-utils). Für die Entwicklung reicht beides.

Datenbank anlegen und Migrationen anwenden. Das Migrationsskript liest `DATABASE_URL` aus der Umgebung, nicht aus der `.env`-Datei:

```sh
createdb haben
export DATABASE_URL=postgres://haben:haben@localhost:5432/haben
bun run db:migrate
bun run dev        # http://localhost:3000
```

Den Einrichtungscode für das erste Konto schreibt der Server ins Terminal; mit `HABEN_SETUP_CODE` in `apps/web/.env` bleibt er fest.

Belegdateien landen ohne weitere Angabe in `apps/web/data/belege` (`DOCUMENTS_DIR`, von Git ignoriert).

## Mit Docker Compose

Ohne Bun und PostgreSQL auf dem eigenen Rechner startet `compose.yml` im Hauptordner die ganze Entwicklungsumgebung:

```sh
git clone https://github.com/firsttris/haben.git
cd haben
docker compose up   # http://localhost:3000
```

Compose startet PostgreSQL 18 (dasselbe Image `tristanteu/haben-db` wie im Betrieb), installiert die Abhängigkeiten, wendet die Migrationen an und startet den Dev-Server. Der Projektordner ist in den Container eingehängt; Änderungen am Code lädt der Dev-Server beim Speichern neu. Nach einer Änderung an `bun.lock` reicht ein Neustart (`docker compose restart app`); nach einer Änderung an `deploy/dev/` oder einer neuen Bun-Version baut `docker compose up --build` den Container neu. Den Einrichtungscode für das erste Konto zeigt das Log (`docker compose logs app`).

- **Schlüssel:** `BETTER_AUTH_SECRET` und `HABEN_ENCRYPTION_KEY` erzeugt der Container beim ersten Start zufällig und legt sie im Volume `daten` ab, zusammen mit den Belegen und einem heruntergeladenen ERiC. Feste Schlüssel stehen nicht im Repository.
- **`apps/web/.env`** ist nicht nötig. Liegt sie vor, gelten ihre übrigen Werte auch im Container (etwa `ANTHROPIC_API_KEY` oder `HABEN_SETUP_CODE`); Datenbank, Adresse, Schlüssel, Belegordner und ERiC setzt `compose.yml`.
- **`node_modules`** liegen in eigenen Volumes, damit der Container seine nativen Pakete für Linux hat, auch wenn der Rechner macOS ist. Fehlen die Ordner auf dem Rechner, legt Docker sie unter Linux leer und mit Besitzer root an; ein späteres `bun install` ohne Container scheitert dann an den Rechten. Wer beides nutzen will, führt `bun install` deshalb zuerst auf dem Rechner aus.
- **Ports:** Die App lauscht auf `127.0.0.1:3000`, die Datenbank auf `127.0.0.1:5432` (Benutzer und Passwort `haben`). Läuft dort schon etwas, wählen `HABEN_DEV_PORT` und `HABEN_DEV_DB_PORT` andere Ports, etwa `HABEN_DEV_DB_PORT=5433 docker compose up`.
- **Linux:** Der Benutzer im Container hat die ID 1000. Ist die eigene eine andere (`id -u`), baut `HABEN_DEV_UID=$(id -u) HABEN_DEV_GID=$(id -g) docker compose up --build` den Container passend, sonst kann der Dev-Server Dateien wie `src/routeTree.gen.ts` nicht schreiben. Die Volumes übernimmt der Container beim nächsten Start für die neue ID. Befehle im Container startest du als dieser Benutzer, damit neue Dateien dir gehören: `docker compose exec -u bun app bun …`.

Die Datenbank im Container eignet sich auch für die Tests vom Rechner aus. Die Testdatenbanken legst du einmal an:

```sh
docker compose exec db createdb -U haben haben_test
docker compose exec db createdb -U haben haben_e2e
```

`docker compose down` hält die Umgebung an, die Daten bleiben erhalten. `docker compose down -v` löscht Datenbank, Belege und Schlüssel.

### Prüfungen ohne Bun auf dem Rechner

Ist Bun nicht installiert, laufen die Prüfungen im selben Container. `run` startet dafür einen eigenen Container neben dem Dev-Server und die Datenbank mit; `-u bun` sorgt dafür, dass neue Dateien dir gehören:

```sh
docker compose run --rm -u bun app bun install --frozen-lockfile   # einmal, wenn `docker compose up` noch nie lief
docker compose run --rm -u bun app bun run lint
docker compose run --rm -u bun app bun run typecheck
docker compose run --rm -u bun app bun run build
docker compose exec db createdb -U haben haben_test                 # einmal, die Datenbank muss laufen
docker compose run --rm -u bun -e TEST_DATABASE_URL=postgres://haben:haben@db:5432/haben_test app bun run test
```

Im Container ist `db` der Name des Datenbankservers, nicht `localhost`. Die Ende-zu-Ende-Tests brauchen die Browser von Playwright, die der Container nicht hat; sie laufen in der CI oder mit Bun auf dem Rechner.

Mit [getrennten Datenbankrollen](installation-konfiguration.md#getrennte-datenbankrollen) bleibt `DATABASE_URL` die App-Anmeldung; `MIGRATION_DATABASE_URL` führt Migration und Rechtevergabe aus. `TEST_DATABASE_URL` braucht weiterhin einen Betreiber mit Superuser- und `CREATEDB`-Rechten für die isolierten Testdatenbanken. Für den abgesicherten Browserlauf bleibt `E2E_DATABASE_URL` die Betreiberbasis; `E2E_APP_DATABASE_URL` ergänzt die echte Serveranmeldung. Der E2E-Reset legt ausschließlich Testrollen namens `haben_e2e_app` oder `haben_e2e_app_<kennung>` an. Ohne die zusätzliche Adresse bleibt der bisherige Testweg erhalten.

Die Doku baut ein Container mit Python, wie in der CI mit Zensical. Er läuft unter der eigenen Nutzerkennung, damit `site/` und `.cache/` danach nicht `root` gehören. Git braucht er nicht, der Befehl geht also auch in einem Git-Worktree; ohne git im Container fehlt nur das Änderungsdatum unter den Seiten:

```sh
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/docs -w /docs python:3.15-slim sh -c 'pip install -q --user -r requirements-docs.txt && python -m zensical build --strict'
```

### Mehrere Umgebungen nebeneinander

`compose.yml` heißt fest `haben-dev`; ein zweiter Klon oder ein Git-Worktree mit demselben Namen würde Container und Datenbank des ersten übernehmen. Für jede weitere Umgebung deshalb einen eigenen Projektnamen und freie Ports wählen:

```sh
HABEN_DEV_PORT=3001 HABEN_DEV_DB_PORT=5433 docker compose -p haben-mein-branch up
```

Projektname und Ports gelten für jeden Befehl dieser Umgebung, auch für `run`, `exec` und `down`; `run` startet die Datenbank mit und stieße auf dem Standardport mit einer laufenden Umgebung zusammen. `docker compose -p haben-mein-branch down -v` räumt die Umgebung samt Daten wieder ab.

## Befehle

| Befehl | Was er tut |
| --- | --- |
| `bun run dev` | Dev-Server der Web-App auf Port 3000 (Vite) |
| `bun run build` | Baut die Web-App (`apps/web/.output`) |
| `bun run typecheck` | `tsc -p .` in jedem Paket (TypeScript 7, der Compiler in Go) |
| `bun run lint` | Biome über das ganze Repository (Lint und Formatierung), danach Modulgrenzen, Seitenabdeckung und Dateigröße ([Automatische Prüfungen der Regeln](mitwirken.md#automatische-prüfungen-der-regeln)) |
| `bun run format` | Formatiert JavaScript, TypeScript und JSON mit Biome |
| `bunx knip@5.88.1 --include files,dependencies,unlisted` | Unbenutzte Dateien und Abhängigkeiten (Einstiegspunkte in `knip.jsonc`); nicht in der CI, vor dem Löschen mit `git grep` gegenprüfen |
| `bun run test` | Alle Tests mit Vitest (nicht `bun test`: das wäre der Test-Runner von Bun) |
| `bun run db:generate` | Migration aus Schemaänderungen erzeugen (drizzle-kit) |
| `bun run db:migrate` | Ausstehende Migrationen anwenden |
| `bun run e2e` | Ende-zu-Ende-Tests mit Playwright (braucht `E2E_DATABASE_URL`, siehe [Ende-zu-Ende-Tests mit Playwright](#ende-zu-ende-tests-mit-playwright)) |
| `bun run --cwd apps/web start` | Gebaute App starten (`.output/server/index.mjs`) |
| `bun run --cwd packages/einvoice kosit [ausgabeverzeichnis]` | Beispielrechnungen erzeugen und mit dem KoSIT-Validator prüfen |
| `bun run --cwd packages/einvoice zugferd [ausgabeverzeichnis]` | ZUGFeRD-PDFs der Beispielrechnungen erzeugen und mit dem Mustang-Validator prüfen ([ZUGFeRD-PDFs](#zugferd-pdfs)) |
| `pip install -r requirements-docs.txt && zensical serve` | Diese Dokumentation als Website lokal auf Port 8000 (Zensical); `zensical build --strict` wie in der CI. Regeln für die Seiten unter der Tabelle |
| `bun run docs:screenshots` | Nimmt die Bilder in README und Doku neu auf (`docs/screenshot-*.png`, hell und dunkel, siehe [Bilder für README und Doku](#bilder-für-readme-und-doku)), danach Vorschaubild und Hero |
| `bun run --cwd apps/elster-helfer build` | Baut die Erweiterung „Haben für Mein ELSTER“ nach `apps/elster-helfer/dist`; diesen Ordner lädt Chrome als entpackte Erweiterung |
| `bun run docs:social-preview` | Rendert `scripts/social-preview/social-preview.html` nach `docs/social-preview.png` (1280 × 640, Bild für Settings → Social preview) |
| `bun run docs:hero` | Rendert `scripts/hero/hero.html` nach `docs/hero-hell.png` und `docs/hero-dunkel.png` (1280 × 360 bei doppelter Auflösung, Bild oben in der README; Slogan in IBM Plex Serif aus `packages/einvoice/fonts`) |

Seiten der Doku:

- **Front Matter:** `title:` (für Suchmaschinen, höchstens etwa 60 Zeichen; die Navigation nimmt den Namen aus `mkdocs.yml`) und `description:` (höchstens etwa 160 Zeichen, Pflicht). Daraus setzt `overrides/main.html` Beschreibung und Open Graph.
- **Hinweise** im Stil von GitHub (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` allein in der ersten Zeile); die deutschen Titel setzt `scripts/doku-hinweise`.
- **Kurz halten:** Die Doku sagt Menschen, was gilt und warum. Schritte für Agenten stehen in den Skills unter `.claude/skills/`, wie ein Skript intern entscheidet, in dessen Kommentaren. Keine Sätze, die nur wiederholen, ankündigen oder zusammenfassen.
- **Unterseiten statt langer Seiten:** Eine Seite bleibt unter etwa 8.000 Wörtern. Was nur ein Teil der Leser braucht (ein Anbieter, eine Rechtsform, ein Sonderfall, eine Nachschlagetabelle), steht auf einer eigenen Seite mit flachem Namen wie `bank-zahlungsdienstleister.md`, denn wegen `use_directory_urls: false` brechen in Unterordnern die relativen Bildpfade. Die Anker bleiben gleich; an der alten Stelle steht ein kurzer Abschnitt mit den alten Ankern als `<a id>` und einem Verweis, damit Links aus ausgelieferten Versionen und von außen weiter treffen. Navigation in `mkdocs.yml` und `ueberblick.md` ändern sich zusammen.
- Was der Build sonst ergänzt (Änderungsdatum, Weiterleitungen, kanonische Startseite), machen die Skripte `scripts/doku-*`; Tests mit `python -m unittest discover -s scripts/<ordner>`.

## Tests

Die Tests laufen mit Vitest (`vitest.config.ts`), jede Datei in einem eigenen Worker, in der CI in vier Teilen (`bun run test --shard=<n>/4`). Aus `apps/web` heraus gestartet gilt dieselbe Konfiguration (`apps/web/vitest.config.ts`), ohne die Server-Plugins der App.

```sh
bun run test
TEST_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_test bun run test
bun --bun vitest run packages/core     # nur ein Bereich
```

Die Integrationstests in `apps/web/src/server` brauchen `TEST_DATABASE_URL`, sonst werden sie übersprungen. Jeder Worker bekommt eine eigene Datenbank neben der genannten, geklont aus einer einmal migrierten Vorlage (`apps/web/src/server/test-db.ts`); der Benutzer braucht `CREATEDB` und, damit die Tests gesperrte Tabellen leeren können, Superuser-Rechte. Der aus `compose.yml` hat beides.

> [!IMPORTANT]
> `TEST_DATABASE_URL` niemals auf einen Server mit echten Daten zeigen lassen. Die Tests löschen und überschreiben die Datenbanken `<name>_vorlage` und `<name>_<Nummer>` daneben.

Einige Tests brauchen Werkzeuge oder Daten, die nicht überall da sind. Fehlen sie, werden die Tests übersprungen oder schlagen fehl; ein grüner Lauf heißt dann nur, dass der Rest grün ist. Was übersprungen wurde, gehört deshalb in die Beschreibung des Pull Requests:

| Fehlt | Folge | Im Dev-Container | In der CI |
| --- | --- | --- | --- |
| `AUTHELIA_TEST_ISSUER`, `AUTHELIA_TEST_USERS_FILE` | Reale Authelia-Referenztests ohne eigene Testinstanz übersprungen | nein | nein |
| `TEST_DATABASE_URL` | alle Postgres-Tests übersprungen | mit `-e`, siehe oben | ja |
| `pdftotext`, `pdftoppm`, `pdffonts`, `pdfimages` (poppler-utils) | Textebene, Seitenbilder, eingebettete Schriften und Bilder von PDFs übersprungen | ja | ja |
| `zip`, `unzip` | Test des Pakets „Haben für Mein ELSTER“ schlägt fehl | ja | ja |
| `cc` | ERiC-Tests mit nachgebauter Bibliothek übersprungen | nein | ja |
| ERiC (`ERIC_HOME` oder `ERIC_DIR`) | Tests mit echtem ERiC übersprungen | nein | nein |
| Netz | Schema der Deutschen Kreditwirtschaft für SEPA übersprungen | ja | ja, sonst Fehler |
| `ERIC_DOKU` (Dokumentation von ERiC mit den Schemas der Lohnsteuerbescheinigung) | Schema-Test in `packages/elster/src/lstb.test.ts` übersprungen | nein | nein |
| Java, wenn `ERIC_DOKU` gesetzt ist | derselbe Schema-Test schlägt fehl; sonst brauchen nur `kosit` und `zugferd` Java (eigene Befehle, keine Tests) | nein | `kosit` und `zugferd` als eigene Jobs |
| Beispielantworten aus erica unter `/var/tmp/erica/tests/worker/samples/` | je ein Test in `vast.test.ts` und `berechtigung.test.ts` übersprungen | nein | nein |

### Tests mit echtem ERiC

ERiC darf nicht im Repository oder in der CI liegen. Ist es lokal da (`ERIC_HOME` oder per `install-cli.ts` nach `ERIC_DIR` geladen), prüft ERiC zusätzlich lokal Schema und Plausibilität; gesendet wird nichts:

- `packages/elster/src/eric-*.test.ts` bauen jede Nachricht in vielen Varianten; ohne ERiC werden sie übersprungen. Fälle für ein Jahr, dessen Plugin dem geladenen ERiC fehlt, ebenso.
- Die Integrationstests in `apps/web/src/server` lassen über `EricGeprueftClient` (`test-eric.ts`) jedes XML aus ihren Szenarien von ERiC prüfen.

```sh
bun packages/elster/src/install-cli.ts --lizenz-akzeptiert   # einmalig, lädt nach ERIC_DIR (Standard data/eric)
ERIC_DIR=data/eric bun --bun vitest run packages/elster
ERIC_DIR=data/eric TEST_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_test bun run test
bun packages/elster/src/check-formats-cli.ts   # Belegabruf, Berechtigung, Postfach; auch als Knopf unter Einstellungen › ELSTER › ERiC
```

Ohne Linux x86_64 (arm64) laufen die Tests mit `ERIC_WORKER_COMMAND` wie unter [ELSTER auf arm64](installation-anbindungen.md#elster-auf-arm64); emuliert dauert ein Aufruf rund 25 Sekunden, alle Dateien zusammen rund 40 Minuten. Die Test-Hersteller-ID `74931` sperrt ERiC seit 39.4 auch für die lokale Prüfung; die Tests nehmen `ELSTER_HERSTELLER_ID` oder eine Platzhalter-ID.

### Schemas der SEPA-Überweisung und -Lastschrift

`sepa.test.ts` (pain.001.001.09) und `sepa-lastschrift.test.ts` (pain.008.001.08) in `packages/core/src` prüfen die Dateien gegen das Schema von ISO 20022 und gegen das Technical Validation Subset der Deutschen Kreditwirtschaft (Anlage 3 des DFÜ-Abkommens). Die ISO-Schemas dürfen frei weitergegeben werden und liegen in `packages/core/test-fixtures/sepa/`. Die der DK stehen auf ebics.de ohne Lizenzangabe; der Test lädt sie deshalb von einem festen Commit und prüft den SHA-256. Ohne Netz wird das lokal übersprungen, in der CI schlägt es fehl. Eine neue Version der Anlage 3 bringt neues Schema, URL und Prüfsumme in den Test.

### KoSIT-Validator

Der CI-Job `kosit` erzeugt die Beispielrechnungen aus `packages/einvoice/src/beispielrechnungen.ts` in allen Formaten und prüft sie mit dem KoSIT-Validator und der XRechnung-Konfiguration. Lokal mit Java 25 und Validator und Konfiguration von GitHub (`itplr-kosit/validator`, `itplr-kosit/validator-configuration-xrechnung`, Versionen in `.github/workflows/ci.yml` unter `KOSIT_VALIDATOR` und `KOSIT_XRECHNUNG`):

```sh
KOSIT_JAR=/pfad/validator-<version>-standalone.jar \
KOSIT_CONFIG=/pfad/scenarios.xml \
bun run --cwd packages/einvoice kosit /tmp/haben-kosit
```

Ohne die Variablen sucht das Skript unter `/var/tmp/kosit/` (das `*-standalone.jar` in `validator/`, `xr/scenarios.xml`). Neue Versionen von Validator, Konfiguration und Mustang bringt Renovate als Pull Request; dessen Jobs `kosit` und `zugferd` prüfen die Rechnungen damit.

### ZUGFeRD-PDFs

Der CI-Job `zugferd` erzeugt die ZUGFeRD-PDFs der Beispielrechnungen und prüft sie mit dem [Mustang-Validator](https://github.com/ZUGFeRD/mustangproject): das PDF als PDF/A-3 (veraPDF) und das eingebettete `factur-x.xml` nach Factur-X. Lokal mit Java und `Mustang-CLI-<version>.jar` aus den Releases von `ZUGFeRD/mustangproject` (Version in `.github/workflows/ci.yml` unter `MUSTANG`):

```sh
MUSTANG_JAR=/pfad/Mustang-CLI-<version>.jar bun run --cwd packages/einvoice zugferd /tmp/haben-zugferd
```

### Ende-zu-Ende-Tests mit Playwright

```sh
createdb haben_e2e            # einmalig; der Name muss auf „e2e“ enden, die Datenbank wird bei jedem Lauf geleert
E2E_DATABASE_URL=postgres://haben@localhost:5432/haben_e2e bun run e2e
bun run e2e barrierefreiheit  # eine Datei
```

Playwright startet selbst die Server ab Port 3100 (`E2E_PORT`), leert vorher die Datenbanken und spielt die Migrationen ein; lokal ist das der Entwicklungsserver, in der CI der gebaute (`E2E_SERVER_COMMAND`). Die Datenbanken der eigenen Durchläufe legt `e2e/reset-db.ts` neben der genannten an; dafür braucht der Benutzer `CREATEDB`. Chromium kommt einmalig mit `bun --bun playwright install chromium` in `apps/web`, oder ein vorhandenes über `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

Für den vollständigen Browserlauf mit getrennten App-Rollen braucht die eigene Testinstanz `max_connections=250`; die CI setzt dies bei der Initialisierung. Die parallelen Server und zusätzliche Server für Beenden und verzögerte Anfragen überschreiten das Standardlimit von 100 Verbindungen. Diese Einstellung betrifft nur die Testdatenbank.

Die Tests sind auf Projekte in `apps/web/playwright.config.ts` verteilt; was eine Datei prüft, steht in ihrem Kopf:

- **`app.spec.ts`** spielt den Betrieb in einer leeren Datenbank durch und legt an, was das Projekt `mit-daten` braucht.
- **`mit-daten`** liest mit diesen Daten und dieser Sitzung, darunter `seiten.spec.ts` (jede Seite am Desktop und am Handy) und `barrierefreiheit.spec.ts` ([Barrierefreiheit und Tastatur](barrierefreiheit.md#wie-das-geprüft-wird)). Playwright startet `app.spec.ts` mit, auch wenn nur eine dieser Dateien laufen soll.
- **Eigene Durchläufe** mit eigenem Server und eigener Datenbank für Themen, die eigene Daten brauchen, etwa eine GmbH oder eine festgeschriebene Erklärung; Ports und Datenbanken stehen in `e2e/durchlaeufe.ts`.
- **`ohne-daten`** für Tests, die keine Daten brauchen.

Ein neuer Test gehört in den Durchlauf seines Themas; nach `app.spec.ts` nur, wenn `mit-daten` seine Daten braucht. In der CI laufen die Tests in fünf Teilen (`bun run e2e --shard=<n>/5`) und SSO als sechster; Bericht und Traces hängen als Artefakt `e2e-bericht-teil-<n>` am Lauf.

### Bilder für README und Doku

Die Bilder in README und Doku (`docs/screenshot-*.png`) nimmt `e2e/zz-doku-screenshots.spec.ts` mit den Daten von `app.spec.ts` auf; `bun run docs:screenshots` startet nur diese beiden Dateien, nicht die ganze Suite. Ohne `DOKU_SCREENSHOTS=1` überspringt sich die Spec, die CI wird also nicht langsamer. Jedes Bild entsteht in Wald hell und dunkel (`screenshot-<name>-dunkel.png`); die README wählt per `<picture>` und `prefers-color-scheme`, die Doku per `#only-light` und `#only-dark`. Die Hinweise zur Einrichtung von ERiC und Hersteller-ID blendet die Spec aus, damit die Bilder Haben eingerichtet zeigen.

```sh
E2E_DATABASE_URL=postgres://haben@localhost:5432/haben_e2e bun run docs:screenshots
```

Nach einer Änderung am Aussehen startet man auf dem Branch den Workflow **Update screenshots** (Actions → Run workflow): Er nimmt die Bilder im Playwright-Image auf und committet, was sich geändert hat.

## Migrationen

Das Schema steht in `apps/web/src/server/db/schema.ts`, die Migrationen in `apps/web/drizzle/`.

1. Schema anpassen.
2. `bun run db:generate` erzeugt die SQL-Migration und den Snapshot in `drizzle/meta/`. Snapshots nie von Hand schreiben.
3. `bun run db:migrate` wendet sie lokal an. Im Container passiert das beim Start automatisch.

Trigger und Funktionen (Festschreibung, Versionierung, Audit-Log) kann drizzle-kit nicht aus dem Schema ableiten. Sie stehen in eigenen SQL-Migrationen, z. B. `0001_festschreibung.sql`, `0003_rechnungen_trigger.sql` oder `0010_lexoffice_trigger.sql`. Eine leere Migration dafür legst du so an und schreibst das SQL von Hand hinein:

```sh
cd apps/web && bun --bun drizzle-kit generate --custom --name=mein_trigger
```

Bestehende Migrationen änderst du nicht; sie sind auf laufenden Installationen schon angewendet.

## Jahreswerte

Lohnsteuer und Sozialversicherung rechnen mit den amtlichen Werten eines Kalenderjahres: dem Programmablaufplan (PAP) des BMF in `packages/core/src/lohnsteuer/` und den Rechengrößen und Beitragssätzen in `packages/core/src/sozialversicherung/`. Fehlen sie für ein Jahr, rechnet Haben nicht, auch nicht mit denen des Vorjahres, und ab Dezember schlagen die Jahreswechsel-Tests fehl (`packages/core/src/jahressperre.ts`). Ebenso hängen die E-Bilanz an der jährlichen Taxonomie, ELSTER an der ERiC-Version und die Kontenzuordnung an SKR03 und SKR04 von DATEV.

Was davon neu erscheint, beobachtet der Workflow **Jahreswerte prüfen** (`.github/workflows/jahreswerte.yml`, montags und auf Knopfdruck). Je Befund öffnet er ein Issue mit dem Label `jahreswerte` und einer Kennung im Titel, etwa `[jahreswerte:pap-2027]`; ein zweites zur selben Kennung gibt es nicht, ein geänderter Befund kommt als Kommentar. Eine Quelle, die nicht antwortet, ist nur eine Warnung. Die Schritte zum Nachziehen stehen im Skill [`jahreswerte`](https://github.com/firsttris/haben/blob/main/.claude/skills/jahreswerte/SKILL.md).

| Kennung | Befund |
| --- | --- |
| `pap-<Jahr>`, `pap-<Jahr>-geaendert`, `est-tarif-<Jahr>` | Der [BMF-Steuerrechner](https://www.bmf-steuerrechner.de/) hat einen PAP für ein Jahr ohne PAP in Haben, eine geänderte Fassung (anderer SHA-256) oder einen Tarif, der in `TARIFE` fehlt |
| `sv-<Jahr>` | Die Sozialversicherungsrechengrößen-Verordnung eines Jahres ohne Werte in Haben steht auf gesetze-im-internet.de |
| `eric`, `eric-<Version>-entfernt` | Auf download.elster.de gibt es eine neuere Version als `DEFAULT_ERIC_VERSION`, die keine BETA ist, oder die eingestellte ist weg; mit ihr kommen auch neue Taxonomien der E-Bilanz |
| `datev-skr03`, `datev-skr04` | Der Stand im DATEV-Shop ist ein anderer als `HABEN_KONTENRAHMEN_STAND` in `scripts/jahreswerte/datev.ts` |
| `norm-<id>` | Der Text einer Norm aus `scripts/jahreswerte/normen.json` hat einen anderen SHA-256, oder die Seite ist weg (Gesetzeswächter) |

Nicht geprüft werden die Seiten von esteuer.de (unvollständige Zertifikatskette) und des BMF (antworten oft mit 503) und der Basiszinssatz, der in den Einstellungen jeder Installation steht. Wie das Skript sucht, steht in `scripts/jahreswerte/`; lokal ohne Issues: `bun scripts/jahreswerte/pruefen.ts --trocken`.

## Konventionen

- **Geld in ganzen Cent** (`Cents`), nie als Gleitkommazahl. Parser rechnen Dezimaltext direkt in Cent um.
- **Steuersätze in Basispunkten** (`BasisPoints`): 1900 = 19 %, 700 = 7 %.
- **Mengen in Tausendsteln**: 152 Stunden = 152000, 0,5 Tage = 500.
- **Daten der Belegvorlagen:** Jedes Feld, das eine Vorlage bekommt, steht mit Beschreibung im Feldvertrag (`packages/einvoice/src/layout-schema.ts`). Danach schreibt `bun scripts/feldvertrag/schreiben.ts` den Skill `belegvorlage` und die Feldtabellen in [Eigene Belegvorlagen](belegvorlagen.md) neu. Felder kommen nur dazu: Wegfallen, umbenennen oder den Typ wechseln darf keines einer veröffentlichten Version, sonst brechen eigene Layouts. Steigt `LAYOUT_SCHEMA_VERSION`, friert `bun scripts/feldvertrag/einfrieren.ts` den neuen Stand einmal als `layout-schema.v<n>.json` ein; eine vorhandene Datei überschreibt es nie.
- **Formatierung mit Biome:** `bun run format` formatiert JavaScript, TypeScript und JSON (160 Zeichen breit, doppelte Anführungszeichen); `bun run lint` und die CI prüfen das. CSS und Markdown formatiert Biome nicht. Reine Formatier-Commits stehen in `.git-blame-ignore-revs`; damit `git blame` sie lokal überspringt, einmal `git config blame.ignoreRevsFile .git-blame-ignore-revs` und `git config blame.markIgnoredLines true`.
- **Lint mit Biome:** Abgeschaltete Regeln stehen mit Grund in `biome.jsonc`. Eine Ausnahme an einer Stelle steht direkt davor als `// biome-ignore lint/<gruppe>/<regel>: <Grund>`.
- **Imports mit `.ts`-Endung** (`allowImportingTsExtensions`). Der ERiC-Worker und das Migrationsskript laufen unter Bun direkt aus den Quellen, ohne Build.
- **Technik nach `tech-stack.md`** in [firsttris/workflows](https://github.com/firsttris/workflows). Abweichungen hier: schlichtes CSS mit Variablen in `apps/web/src/styles.css` statt Tailwind, eine eigene `Icon`-Komponente statt lucide, Typst für das PDF der Rechnung.
- **Wenige Abhängigkeiten:** Jedes Paket ist Angriffsfläche und ein Update, das gepflegt werden muss. Eine neue Abhängigkeit zur Laufzeit kommt nur dazu, wenn wenige Zeilen eigener Code oder ein vorhandenes Paket nicht reichen; der Pull Request nennt den Grund.
- **Funktional statt objektorientiert:** reine Funktionen, die Daten nehmen und Daten zurückgeben, Seiteneffekte am Rand; Abhängigkeiten werden übergeben. Funktionskomponenten und Hooks, keine Klassen (außer den Unterklassen von `UserError`), Fehler als Werte, wo der Code das schon so macht. Klare Namen, keine Doppelungen und kein toter Code, Kommentare sagen warum.
- **Eine Datei tut eine Sache:** ab etwa 400 Zeilen teilen, eine Funktion ab 80 Zeilen ohne Leerzeilen (Tests ausgenommen). Ältere größere Dateien stehen in `scripts/dateigroesse/altdateien.json`; Neues kommt möglichst in eine eigene Datei, geteilt werden sie nur in einem eigenen Pull Request, nicht nebenbei ([Automatische Prüfungen der Regeln](mitwirken.md#automatische-prüfungen-der-regeln)). Ein Refactor ändert kein Verhalten.
- **Bun statt Node:** Die Skripte starten Vite, Vitest, Playwright, Biome, tsc und drizzle-kit mit `bun --bun`; ohne den Schalter nähme Bun das `node` aus deren Startzeile, falls eines installiert ist. Install-Skripte führt `bun install` nur für die Pakete in `trustedDependencies` aus (esbuild lädt sein Binary, koffi sein natives Modul für ERiC). `bunfig.toml` legt die Abhängigkeiten wie früher pnpm isoliert ab: Jedes Paket sieht nur, was es selbst einträgt.
- **Oberfläche auf Deutsch**, auch Fehlermeldungen, die beim Nutzer ankommen.
- **Oberfläche:** Gestaltung, Knopfarten, Seitenkopf, Rückfragen, Vorschau der Belegeditoren und Barrierefreiheit stehen in [`DESIGN.md`](https://github.com/firsttris/haben/blob/main/DESIGN.md).
- **Unveränderlichkeit (GoBD) in der Datenbank:** Festgeschriebene Rechnungen, Buchungen, gesendete Voranmeldungen, Bankumsätze und übernommene Lexoffice-Daten sperren Postgres-Trigger gegen `UPDATE` und `DELETE`, ebenso gegen `TRUNCATE`; eine neue Tabelle mit Trigger gegen `DELETE` oder mit Audit-Trigger braucht auch einen vor `TRUNCATE` (`haben_reject_truncate`, sonst schlägt `apps/web/src/server/db/truncate.test.ts` fehl). Korrekturen sind neue Datensätze (Storno, Gegenbuchung, berichtigte Anmeldung). Beim Festschreiben einer Buchung prüft ein Trigger Soll = Haben. In versiegelten Tabellen (`invoices`, `journal_entries`, …) wird keine Spalte umbenannt, gelöscht oder neu berechnet; neue Spalten gehen. Eine Sperre oder ein Siegel wird nie gelockert, damit etwas funktioniert.
- **Audit-Log:** Änderungen laufen über `withActor` (`apps/web/src/server/db/actor.ts`), damit der Trigger sie dem Nutzer zuschreibt. Neue Tabellen bekommen einen Audit-Trigger.
- **Geheimnisse** (Schlüssel, Passwörter, Tokens) liegen mit AES-256-GCM verschlüsselt in einer Spalte namens `ciphertext`, die `haben_audit` auslässt.
- **Server-Funktionen bleiben dünn:** In `apps/web/src/server/functions/` hängt jede Funktion mit Daten `authMiddleware` an, validiert die Eingabe mit Zod und ruft die Logik im passenden Modul unter `apps/web/src/server/modules/` auf. Fachlogik ohne Datenbank gehört nach `packages/core`.
- **Modulgrenzen:** Aus einem anderen Modul nur über dessen `index.ts` importieren; die Prüfung in `scripts/modulgrenzen/` bricht `bun run lint` und damit die CI sonst ab ([Automatische Prüfungen der Regeln](mitwirken.md#automatische-prüfungen-der-regeln)). Fehlt dort ein Name, ergänze ihn in der `index.ts`. Neuer Code gehört in das Modul, dessen Tabellen er schreibt ([Module im Server](architektur.md#module-im-server)).
- **ERiC nie im App-Prozess:** Jeder Aufruf geht über einen kurzlebigen Kindprozess (`packages/elster/src/worker.ts`).
- **Quellen statt Gedächtnis:** Details richten sich nach der Quelle, und wo sie ein Detail entscheidet, steht sie im Kommentar und in der Commit-Nachricht. E-Rechnung: EN 16931 und XRechnung (Business Terms wie BT-22), geprüft vom KoSIT-Validator mit `itplr-kosit/validator-configuration-xrechnung` (Versionen in `.github/workflows/ci.yml`). ELSTER: die [Entwicklerdokumentation von ERiC](https://www.elster.de/elsterweb/entwickler/infoseite/eric). DATEV: die Formatbeschreibung für EXTF/Buchungsstapel; Exporte von Lexware Office weichen davon ab ([Lexoffice](lexoffice.md)). Kontenrahmen: SKR03 und SKR04 von DATEV in dem Stand, den `HABEN_KONTENRAHMEN_STAND` in `scripts/jahreswerte/datev.ts` nennt (Kontonummer, Bezeichnung, Funktion); DATEV entscheidet nur über Format und Kontenrahmen. Widerspricht eine Kontenfunktion dem Gesetz, einer ELSTER-Kennzahl oder der Taxonomie der E-Bilanz, gilt die Norm. [Enable Banking](https://enablebanking.com/docs/api/reference/), [Lexware Office](https://developers.lexware.io/docs/).
- **Neue Systemkonten:** Bei neuen Kategorien oder Kontenfunktionen prüfen, dass `reservedAccountNumbers` (`packages/core/src/own-accounts.ts`) die Nummern erfasst. Eine beim Anlegen freie Nummer kann bereits in `own_accounts` stehen, auch archiviert oder in einem früheren Kontenrahmen. „Kette prüfen“ meldet solche [Kontenkollisionen](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel). Bestehende Kontenzuordnungen und Buchungszeilen nicht automatisch umdeuten oder umschreiben; dafür braucht es einen gesondert abgestimmten Umgang mit dem Bestand.

## Projektstruktur

| Pfad | Inhalt |
| --- | --- |
| `apps/web/src/routes` | Seiten (TanStack Router) und API-Routen unter `api/` |
| `apps/web/src/server` | `modules/` mit der Serverlogik je Fachbereich (öffentlich über `index.ts`), `db/` mit Schema und Migrationsskript, `functions/` mit den Server-Funktionen, daneben gemeinsame Infrastruktur |
| `scripts/modulgrenzen/` | Prüfung der Modulgrenzen, läuft mit `bun run lint` |
| `scripts/jahreswerte/` | Prüfung der amtlichen Jahreswerte, Normen und ERiC-Version für den Workflow „Jahreswerte prüfen“ |
| `apps/web/src/components`, `lib` | React-Komponenten, Auth-Client, Formatierung |
| `apps/web/drizzle` | SQL-Migrationen |
| `packages/core` | Beträge, Zeiträume, Steuernummer, UStVA, Buchungssätze, EÜR, Zuordnungsvorschläge |
| `packages/elster` | ERiC-Anbindung, XML für Voranmeldung und Jahreserklärungen, Worker |
| `packages/import` | Kontoauszugs-Parser, Exporte von Zahlungsdienstleistern, Deduplizierung, DATEV, Lexoffice- und sevDesk-Client, BuchhaltungsButler-Exporte (`buchhaltungsbutler/`), Accountable-Export (`accountable/`), Finanzberichte von Google Play und App Store Connect (`stores/`), Kontoabruf über Enable Banking, CSV-Import von Kontakten, Artikeln und Anlagen (`csv-import/`) |
| `packages/einvoice` | Rechnungs-PDF mit Typst, E-Rechnung erzeugen und lesen |
| `apps/elster-helfer` | Browser-Erweiterung „Haben für Mein ELSTER“ (TypeScript, Vite) |
| `deploy` | Compose, Quadlets, Caddyfile, Startskript; `deploy/backup`: Backup-Image (backup.sh, restore.sh) |
| `docs`, `mkdocs.yml` | Diese Dokumentation; auf `main` baut `.github/workflows/docs.yml` sie nach https://haben.app/ |

## Neues Bankformat

Die Parser liegen in `packages/import/src/`.

1. Eigene Datei anlegen, z. B. `meinebank.ts`, mit einer Erkennungsfunktion für die Kopfzeile (`isMeinebankHeader`) und einem Parser, der ein `ParsedStatement` liefert. `dkb.ts` und `n26.ts` sind gute Vorlagen; Hilfen für Beträge, Datum und IBAN stehen in `text.ts`, `table.ts` und `common.ts`.
2. Das Format in `StatementFormat` in `types.ts` ergänzen.
3. In `parse.ts` die Erkennung in `detect()` und den Fall in `parseStatement()` eintragen. Erkannt wird am Inhalt, nicht am Dateinamen.
4. Eine anonymisierte Beispieldatei unter `packages/import/test-fixtures/` ablegen und Tests in `parse.test.ts` ergänzen, auch für die Deduplizierung.

Das Format wird als Text in `bank_imports.format` gespeichert; eine Migration ist dafür nicht nötig. Liefert die Datei keine eigene IBAN, muss das Konto vor dem Import angelegt werden (wie bei N26).

## Neue Ausgabenkategorie

Die Kategorien stehen in `EXPENSE_CATEGORIES` in `packages/core/src/posting.ts`, je mit Bezeichnung und Aufwandskonto für SKR03 und SKR04. Ein neuer Eintrag erscheint automatisch in der Auswahl am Beleg, in der Anweisung für die KI-Auslesung, im Journal und in der EÜR. Die Kategorie steht als Text am Beleg, eine Migration ist nicht nötig. Für übernommene Lexoffice-Belege kannst du in `apps/web/src/server/modules/archiv/legacy-open.ts` (`CATEGORY_HINTS`) ein Suchmuster ergänzen. Die Kontonummern stimmst du mit der Steuerberatung ab.

## Veröffentlichen

Ein Tag `vX.Y.Z` veröffentlicht eine Version über `.github/workflows/release.yml`:

1. Der Tag muss zu `version` in der `package.json` im Wurzelverzeichnis passen.
2. Die komplette CI läuft, außer die CI auf `main` hat denselben Code schon geprüft.
3. Das Image geht für `linux/amd64` und `linux/arm64` als `:x.y.z`, `:x.y` und `:latest` nach Docker Hub (`tristanteu/haben`) und GHCR (`ghcr.io/firsttris/haben`).
4. Danach entsteht das GitHub-Release mit erzeugten Notizen und der Erweiterung „Haben für Mein ELSTER“ als ZIP. Eine fertige Version schließt die umgesetzten Issues (siehe [Branches, Titel und Commits](mitwirken.md#branches-titel-und-commits)).

Den Tag legt Actions → *Bump version* (`bump.yml`) mit patch, minor oder major an: Er committet `Release vX.Y.Z` auf `main` und taggt, mit dem Deploy Key aus `BUMP_DEPLOY_KEY`, der auf der Bypass-Liste des Rulesets steht ([firsttris/workflows](https://github.com/firsttris/workflows#bump-version)). Wer selbst auf der Bypass-Liste steht, kann lokal `bun run release:patch` (oder `:minor`, `:major`) nehmen. Von Hand gestartet (Actions → Release → Run workflow) veröffentlicht der Workflow nur `:edge`, ohne Release.

Secrets: `DOCKER_PAT` (Docker-Hub-Token mit Schreibrecht für `tristanteu/haben`); für GHCR reicht `GITHUB_TOKEN`, das Paket muss nach dem ersten Push einmal auf öffentlich gestellt werden.

### Release Candidates

Größere Änderungen, etwa Migrationen oder Änderungen an Festschreibung, Audit-Log oder ELSTER, gehen vorher als Release Candidate raus. Alles bleibt auf `main`, die RCs sind nur Tags:

1. *Bump version* → `preminor` (oder `prepatch`, `premajor`): aus `0.1.9` wird `v0.2.0-rc.1`. Das Image heißt `:0.2.0-rc.1` und `:next`; `:latest` bleibt auf `0.1.9`, das GitHub-Release ist ein Pre-release.
2. Fehler gefunden: fixen, dann *Bump version* → `prerelease` → `v0.2.0-rc.2`.
3. Läuft stabil: *Bump version* → `patch` → `v0.2.0`, jetzt auch `:latest`.

Zwischen RC und fertiger Version nur Fixes mergen, sonst geht Ungetestetes mit raus. RCs nur mit Backup testen: Eine Migration aus einem RC ist danach schon auf den Testinstanzen angewendet und wird nicht mehr geändert. Ausgelöst wird ein Release nur auf Freigabe des Maintainers; die Schritte stehen im Skill [`release`](https://github.com/firsttris/haben/blob/main/.claude/skills/release/SKILL.md).

## Mitwirken

<a id="etwas-übernehmen"></a><a id="branches-titel-und-commits"></a><a id="mit-ki-werkzeugen"></a><a id="leitplanken-für-agenten"></a><a id="automatische-prüfungen-der-regeln"></a><a id="wenn-eine-prüfung-anschlägt"></a><a id="issues-schreiben"></a><a id="beiträge-annehmen"></a><a id="review"></a><a id="doku-prüfung"></a>Wie ein Beitrag entsteht und geprüft wird, steht unter [Mitwirken](mitwirken.md).

## SSO entwickeln und prüfen

Die SSO-Anbindung nutzt Better Auth 1.7.14 (`genericOAuth`, `addOAuthServerContext`, `getOAuthState`). Bei Updates besonders prüfen: Signatur- und Nonce-Prüfung vor `getUserInfo`, Reihenfolge von State, Codeaustausch und Kontoanlage im Callback (`oauth2/callback.mjs`), das Rate-Limit für `/sign-in/*` und dass Fehler weiterhin als Redirect mit `error` enden (darauf baut das Rollback in `auth-transaction.ts`). Keine Sicherheitsoption abschalten, um einen Anbieter passend zu machen. Aufbau: [SSO-Modus](architektur-anmeldung.md#sso-modus).

| Test | Was er prüft |
| --- | --- |
| `sso-groups.test.ts`, `sso-policy.test.ts`, `oidc-config.test.ts` | Gruppenentscheidung, Frist, wirksame Rolle und gesperrte Endpunkte je Betriebsart, Konfiguration (ohne Datenbank) |
| `sso.test.ts` | Ersteinrichtung, automatische Anlage, Claims, Parallelität, Replay, Datenbankfehler, Beförderung, Herabstufung, Gruppenentzug trotz Fehler-Redirect, feste Frist, gesperrte lokale Wege und Verwaltung |
| `sso-moduswechsel.test.ts` | Wechsel in beide Richtungen, laufende Callbacks, Übernahme bestehender Konten, fehlender lokaler Rückfallzugang |

Die Postgres-Tests starten mit `sso-test-provider.ts` einen Anbieter auf Loopback mit RSA-signierten ID-Tokens, JWKS, PKCE und Gruppen nur über UserInfo, wie Authelia. Sie brauchen `TEST_DATABASE_URL` und nur erfundene Identitäten.

### Browserprüfung

```sh
E2E_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_sso_e2e bun run --cwd apps/web e2e --config playwright.sso-only.config.ts
```

Die Datenbank muss auf `e2e` enden und wird geleert; die Ports 3216 (Testanbieter, `e2e/oidc-provider.ts`) und 3218 müssen frei sein, und `openssl` erzeugt die Testzertifikate. Was der Durchlauf prüft, steht im Kopf von `e2e/sso-only.spec.ts`; `SSO_ONLY_SCREENSHOT_DIR` legt Bilder in hell und dunkel, Desktop und Handy ab. Der Betriebscode bekommt keine Ausnahme für HTTP.

### Mit Authelia

`oidc-authelia.test.ts` läuft nur mit `AUTHELIA_TEST_ISSUER` gegen eine eigene Authelia-Instanz auf Loopback (geprüft mit Authelia 4.39) und wird sonst übersprungen. Die Instanz braucht TLS (dem Zertifikat der Test-CA über `NODE_EXTRA_CA_CERTS` vertrauen, die TLS-Prüfung bleibt an), den Client aus [Single Sign-on › Authelia konfigurieren](installation-sso.md#authelia-konfigurieren) mit Callback `http://localhost:3000/api/auth/callback/oidc`, Clientsecret `secret` und testweise `consent_mode: implicit`, `refresh_interval: always`, ein Dateibackend mit `watch: true` und die Testnutzer aus dem Kopf der Testdatei mit synthetischem TOTP-Schlüssel. Der Test ändert die Gruppen in der Benutzerdatei (`AUTHELIA_TEST_USERS_FILE`) bei bestehender Authelia-Sitzung und prüft, dass Haben die neue Rolle beim nächsten Durchlauf übernimmt und beim Entzug ablehnt.

```sh
NODE_EXTRA_CA_CERTS=/pfad/test-ca.crt AUTHELIA_TEST_ISSUER=https://127.0.0.1:9091 AUTHELIA_TEST_USERS_FILE=/pfad/users.yml   TEST_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_test bun run test apps/web/src/server/oidc-authelia.test.ts
```

Testinstanz, Schlüssel und Konten sind ausschließlich für den Test; niemals Werte daraus im Betrieb verwenden.


[Zurück zur Übersicht](ueberblick.md)
