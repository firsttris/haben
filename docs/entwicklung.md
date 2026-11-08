# Entwicklung

Diese Seite richtet sich an alle, die an Haben mitarbeiten wollen: lokale Umgebung, Befehle, Tests, Migrationen, Konventionen im Code und typische Erweiterungen. Den Aufbau im Detail beschreibt [Architektur](architektur.md).

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

In `apps/web/.env` trägst du mindestens `DATABASE_URL`, `BETTER_AUTH_SECRET` und `HABEN_ENCRYPTION_KEY` ein (beide mit `openssl rand -base64 32`). `BETTER_AUTH_URL` bleibt `http://localhost:3000`. Alle Variablen erklärt [Betrieb und Installation](installation.md#umgebungsvariablen).

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

Compose startet PostgreSQL 18 (dasselbe Image `tristanteu/haben-db` wie im Betrieb), installiert die Abhängigkeiten, wendet die Migrationen an und startet den Dev-Server. Der Projektordner ist in den Container eingehängt; Änderungen am Code lädt der Dev-Server beim Speichern neu. Nach einer Änderung an `bun.lock` reicht ein Neustart (`docker compose restart app`); nach einer Änderung an `deploy/dev/` oder einer neuen Bun-Version baut `docker compose up --build` den Container neu. Volumes aus der Zeit mit pnpm (Haben bis 0.2) leert der Container beim ersten Start selbst. Den Einrichtungscode für das erste Konto zeigt das Log (`docker compose logs app`).

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

Die Doku baut ein Container mit Python, wie in der CI mit Zensical. Er läuft unter der eigenen Nutzerkennung, damit `site/` und `.cache/` danach nicht `root` gehören. Git braucht er nicht, der Befehl geht also auch in einem Git-Worktree; ohne git im Container fehlt nur das Änderungsdatum unter den Seiten:

```sh
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/docs -w /docs python:3.15-slim sh -c 'pip install -q --user -r requirements-docs.txt && python -m zensical build --strict'
```

### Mehrere Umgebungen nebeneinander

`compose.yml` heißt fest `haben-dev`; ein zweiter Klon oder ein Git-Worktree mit demselben Namen würde Container und Datenbank des ersten übernehmen. Für jede weitere Umgebung deshalb einen eigenen Projektnamen und freie Ports wählen:

```sh
HABEN_DEV_PORT=3001 HABEN_DEV_DB_PORT=5433 docker compose -p haben-mein-branch up
```

Projektname und Ports gelten für jeden Befehl dieser Umgebung, also auch für `run`, `exec` und `down`. Das gilt auch für `run`: Es startet die Datenbank mit und gibt ihren Port frei, auf dem Standardport stößt es sonst mit einer laufenden Umgebung zusammen. `docker compose -p haben-mein-branch down -v` räumt die Umgebung samt Daten wieder ab.

## Befehle

| Befehl | Was er tut |
| --- | --- |
| `bun run dev` | Dev-Server der Web-App auf Port 3000 (Vite) |
| `bun run build` | Baut die Web-App (`apps/web/.output`) |
| `bun run typecheck` | `tsc -p .` in jedem Paket (TypeScript 7, der Compiler in Go) |
| `bun run lint` | Biome über das ganze Repository (Lint und Formatierung), danach die Prüfung der Modulgrenzen (`scripts/modulgrenzen/`) |
| `bun run format` | Formatiert JavaScript, TypeScript und JSON mit Biome |
| `bun run test` | Alle Tests mit Vitest (nicht `bun test`: das wäre der Test-Runner von Bun) |
| `bun run db:generate` | Migration aus Schemaänderungen erzeugen (drizzle-kit) |
| `bun run db:migrate` | Ausstehende Migrationen anwenden |
| `bun run e2e` | Ende-zu-Ende-Tests mit Playwright (braucht `E2E_DATABASE_URL`, siehe [Ende-zu-Ende-Tests mit Playwright](#ende-zu-ende-tests-mit-playwright)) |
| `bun run --cwd apps/web start` | Gebaute App starten (`.output/server/index.mjs`) |
| `bun run --cwd packages/einvoice kosit [ausgabeverzeichnis]` | Beispielrechnungen erzeugen und mit dem KoSIT-Validator prüfen |
| `pip install -r requirements-docs.txt && zensical serve` | Diese Dokumentation als Website lokal auf Port 8000 (Zensical); `zensical build --strict` wie in der CI. Das Änderungsdatum unter jeder Seite schreibt `scripts/doku-aenderungsdatum` aus dem letzten Commit der Datei, bis Zensical es selbst kann; Tests: `python -m unittest discover -s scripts/doku-aenderungsdatum`. Hinweise stehen im Stil von GitHub (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` allein in der ersten Zeile), damit sie auf GitHub und auf der Website als Kasten erscheinen; die deutschen Titel setzt `scripts/doku-hinweise`, Tests: `python -m unittest discover -s scripts/doku-hinweise` |
| `bun run docs:screenshots` | Nimmt die Bilder in README und Doku neu auf (`docs/screenshot-*.png`, siehe [Bilder für README und Doku](#bilder-für-readme-und-doku)) und danach das Vorschaubild |
| `bun run --cwd apps/elster-helfer build` | Baut die Erweiterung „Haben für Mein ELSTER“ nach `apps/elster-helfer/dist`; diesen Ordner lädt Chrome als entpackte Erweiterung |
| `bun run docs:social-preview` | Rendert `scripts/social-preview/social-preview.html` nach `docs/social-preview.png` (1280 × 640, Bild für Settings → Social preview) |

## Tests

Die Tests laufen mit Vitest. `vitest.config.ts` sammelt alle `*.test.ts` unter `apps/*/src`, `packages/*/src` und `scripts/` ein und führt die Dateien parallel aus, eine Datei je Worker.

```sh
bun run test
TEST_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_test bun run test
bun --bun vitest run packages/core     # nur ein Bereich
```

Die Integrationstests in `apps/web/src/server` brauchen `TEST_DATABASE_URL`. Ohne die Variable werden sie übersprungen. Mit ihr legt `apps/web/src/server/test-db.ts` zu Beginn des Laufs neben der Datenbank (`haben_test`) eine Vorlage `haben_test_vorlage` an und wendet dort einmal alle Migrationen an. Jeder Worker von Vitest hat eine eigene Datenbank (`haben_test_1`, `haben_test_2`, …); jede Testdatei legt sie als Kopie der Vorlage neu an (`CREATE DATABASE … TEMPLATE`, rund 0,1 s statt 0,6 s für die Migrationen). Der Benutzer braucht dafür das Recht, Datenbanken anzulegen (`CREATEDB`); der aus `compose.yml` hat es.

> [!IMPORTANT]
> `TEST_DATABASE_URL` niemals auf einen Server mit echten Daten zeigen lassen. Die Tests löschen und überschreiben die Datenbanken `<name>_vorlage` und `<name>_<Nummer>` daneben.

Die ERiC-Tests mit nachgebauter Bibliothek (`packages/elster/test-fixtures`) kompilieren eine kleine C-Bibliothek mit `cc`. Gibt es keinen Compiler, werden sie übersprungen.

Einige Tests brauchen Werkzeuge oder Daten, die nicht überall da sind. Fehlen sie, werden die Tests übersprungen oder schlagen fehl; ein grüner Lauf heißt dann nur, dass der Rest grün ist. Was übersprungen wurde, gehört deshalb in die Beschreibung des Pull Requests:

| Fehlt | Folge | Im Dev-Container | In der CI |
| --- | --- | --- | --- |
| `TEST_DATABASE_URL` | alle Postgres-Tests übersprungen | mit `-e`, siehe oben | ja |
| `pdftotext`, `pdftoppm` (poppler-utils) | Textebene und Seitenbilder von PDFs übersprungen | ja | ja |
| `zip`, `unzip` | Test des Pakets „Haben für Mein ELSTER“ schlägt fehl | ja | ja |
| `cc` | ERiC-Tests mit nachgebauter Bibliothek übersprungen | nein | ja |
| ERiC (`ERIC_HOME` oder `ERIC_DIR`) | Tests mit echtem ERiC übersprungen | nein | nein |
| Netz | Schema der Deutschen Kreditwirtschaft für SEPA übersprungen | ja | ja, sonst Fehler |
| `ERIC_DOKU` (Dokumentation von ERiC mit den Schemas der Lohnsteuerbescheinigung) | Schema-Test in `packages/elster/src/lstb.test.ts` übersprungen | nein | nein |
| Java, wenn `ERIC_DOKU` gesetzt ist | derselbe Schema-Test schlägt fehl; sonst braucht nur `kosit` Java (eigener Befehl, kein Test) | nein | `kosit` als eigener Job |
| Beispielantworten aus erica unter `/var/tmp/erica/tests/worker/samples/` | je ein Test in `vast.test.ts` und `berechtigung.test.ts` übersprungen | nein | nein |

### Tests mit echtem ERiC

ERiC darf nicht im Repository oder in der CI liegen. Ist es lokal da (`ERIC_HOME` oder per `install-cli.ts` nach `ERIC_DIR` geladen), laufen zwei Ebenen von Tests zusätzlich gegen das echte ERiC. Gesendet wird dabei nichts, ERiC prüft nur lokal Schema und Plausibilität (`ERIC_VALIDIERE`):

- `packages/elster/src/eric-echt.test.ts` baut jede Nachricht in vielen Varianten: Voranmeldung 2025 bis 2027 mit allen Kennzahlen, Umsatzsteuererklärung, Anlage EÜR mit AVEÜR und Einkommensteuer für 2023 bis 2026 mit allen Feldern, Sonstige Nachricht, Bankverbindung, Belegabruf, Abrufberechtigung und Postfach. Ohne ERiC wird die Datei übersprungen.
- Die Integrationstests in `apps/web/src/server` nutzen `EricGeprueftClient` (`test-eric.ts`). Mit ERiC lässt er jedes XML, das aus den Szenarien der Datenbank entsteht, zusätzlich von ERiC prüfen.

```sh
bun packages/elster/src/install-cli.ts --lizenz-akzeptiert   # einmalig, lädt nach ERIC_DIR (Standard data/eric)
ERIC_DIR=data/eric bun --bun vitest run packages/elster
ERIC_DIR=data/eric TEST_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_test bun run test
```

Die Lohnsteuer-Anmeldung prüft `packages/elster/src/eric-lsta.test.ts` mit ERiC (Monat, Quartal, Kalenderjahr, Berichtigung, Vorjahr, nur Minijob; 2027 erst ab ERiC 45). Körperschaft- und Gewerbesteuererklärung prüft `packages/elster/src/eric-kapg.test.ts` mit ERiC (Gewinn, Verlustvortrag mit Mindestbesteuerung, Verlustjahr, Gründung, Hinzurechnungen). Die E-Bilanz prüft `packages/elster/src/ebilanz/eric-ebilanz.test.ts` mit ERiC, darunter jedes Konto der Kontenzuordnung für SKR03 und SKR04 in einer Bilanz, je mit Kontennachweis in den Taxonomien 6.9 (Wirtschaftsjahre 2025 und 2026) und 6.10 (2027). Die Fälle für 6.10 laufen nur mit einem ERiC, das das Plugin `libcheckBilanz_6_10.so` hat (ab 45); mit ERiC 44 sind sie übersprungen (`hatJahresPlugin`). So auch der Fake-Client der Postgres-Tests (`test-eric.ts`): Er lässt ERiC nur prüfen, was es kennt.

Seit ERiC 39.4 ist die frühere Test-Hersteller-ID `74931` gesperrt, auch für die lokale Prüfung. Die Tests nehmen `ELSTER_HERSTELLER_ID`, sonst eine Platzhalter-ID; für die reine Prüfung reicht das. Die Schemas der Formulare stecken komprimiert in den Plugins unter `lib/plugins`; meldet ERiC ein unerwartetes Feld, lohnt der Blick dort hinein.

Für Belegabruf, Berechtigung und Postfach gibt es zusätzlich ein Kommando, das auch unter Einstellungen › ELSTER › ERiC als Knopf steckt (Exit-Code 1 bei Fehlern):

```sh
bun packages/elster/src/check-formats-cli.ts   # ERiC aus ERIC_HOME oder ERIC_DIR
```

| Bereich | Was getestet wird |
| --- | --- |
| `packages/core` | Beträge und Rundung, Rechnungssummen netto und brutto und Nummernformat, Termine der Dauerbelege (Monatsende, Schaltjahr, Fortsetzen nach einer Pause, Fälligkeit) und Prüfung der Vorlage (Vorsteuer nur mit Steuerausweis), Zeiträume und Fälligkeit der Voranmeldung, Feiertage je Bundesland, Steuerfälle von Rechnungen, Steuernummer-Umrechnung, Kennzahlen der UStVA, Buchungssätze für SKR03/SKR04 und Ist/Soll, Steuerzahlungen (Kontierung nach Steuerart und Teil, Rückstellung, EÜR), Zuordnungsvorschläge im Bankabgleich, Voranmeldung als offener Posten (Fälligkeit, Teilzahlung, Berichtigung, Säumniszuschlag nach § 240 AO, Zeitraum im Verwendungszweck), EÜR, Umsatzsteuer des Lexoffice-Altbestands, SEPA-Überweisung (pain.001) gegen die Schemas von ISO 20022 und der Deutschen Kreditwirtschaft (siehe unten), Skonto nach XRechnung, Lohnsteuer gegen Prüffälle des BMF, Beiträge zur Sozialversicherung, Lohnabrechnung aus den Stammdaten und Lohnkonto, Zeitraum, Frist und Kennzahlen der Lohnsteuer-Anmeldung, Ausfüllliste für das SV-Meldeportal (Beitragsnachweis, DEÜV-Meldungen, Bankarbeitstage gegen die Fälligkeitstabelle der TK, DEÜV-Fristen) |
| `packages/elster` | UStVA-XML (Kopf, Kennzahlen, Testmerker, Kz 09/10), XML der Umsatzsteuererklärung, der Anlage EÜR mit AVEÜR, der Einkommensteuer, der Sonstigen Nachricht und der Lohnsteuer-Anmeldung (2026 und 2027), Transfer-Ticket, simulierter Client, Kindprozess (Zertifikat mit `0600`, Timeout, Absturz), Mock-ERiC über koffi, ERiC-Download (Entpacken nur Linux, defektes Archiv, Umschalten erst bei vollständiger Version, Pfade im Archiv); mit echtem ERiC alle Nachrichten in vielen Varianten (siehe oben) |
| `packages/einvoice` | Rechnungs-PDF (PDF/A-3b), ZUGFeRD und XRechnung (CII, UBL) inklusive Storno, Leitweg-ID und Bruttopreisen, Pflichtangaben je Format, Einlesen fremder E-Rechnungen und eingebetteter XML |
| `packages/import` | DKB- (neu und alt), N26- und CAMT.053-Parser, Deduplizierung, Saldenprüfung, DATEV-Buchungsstapel, Lexoffice-API-Client (Paging, 429, Fehler) und Abbildung der Lexoffice-Daten |
| `apps/web` ohne DB | Umwandlung der KI-Auslesung in Felder und Beträge, Anbieterwahl und OpenAI-kompatibler Dienst gegen einen Testserver auf 127.0.0.1 (Erfolg, falsches JSON, Zeitüberschreitung, nicht erreichbar, kein Ausweichen auf Anthropic), PDF in Seitenbilder (nur mit `pdftoppm`), OpenAPI-Beschreibung der REST-API (Verweise, Rechte, Einheiten) |
| `apps/web` mit DB | Rechnungen festschreiben und sperren, zusätzliche Anhänge (Typ und Größe, Sperre, Siegel, Auswahl beim Versand, Jahresarchiv), Belege hochladen und buchen (auch mit selbst betriebenem Modell gegen einen Testserver: zu prüfen, Fehler am Beleg, nichts gebucht, E-Rechnung ohne KI), Dauerbelege (SKR03/SKR04, Ist/Soll, verpasste Termine, je Monat ein Beleg auch bei gleichzeitigen Läufen, Änderungen nur für künftige Belege, Pausieren, Beenden, Vorschlag und „Buchen und zuordnen“ im Bankabgleich), Bankimport und Zuordnung, Steuerzahlungen und Zinserträge (SKR03/SKR04, Ist/Soll, Einzelunternehmen und GmbH: Prüffälle Umsatzsteuer früherer Jahre und Gewerbesteuerbescheid, Voranmeldung unverändert, EÜR, Abgleich, DATEV, Rückstellung, E-Bilanz), Darlehen (Auszahlung, Rate mit Tilgung und Zins, Bestand, feste Grundlagen, Restlaufzeit), Einfuhrumsatzsteuer (Kz 62, EÜR, Kleinunternehmer abgelehnt), Voranmeldung (Entwurf, Test, Echt, Berichtigung, Audit-Log, Abgabevermerk mit Protokoll) und Berechnung aus Buchungen, Voranmeldung als offener Posten (SKR03/SKR04, Ist/Soll, Zahllast/Überschuss, Teilzahlung, Säumniszuschlag, Berichtigung, Dauerfristverlängerung), Auswertungen, Jahresexport, Lexoffice-Übernahme und offene Posten, REST-API (Token und Rechte, Fehlerformat, externe Referenz auch bei gleichzeitigen Anfragen, Entwurf gegen festgeschrieben), Lohnabrechnung (Entwurf, Festschreiben mit Sperre und Siegel, Storno mit neuer Abrechnung, Audit-Log, Lohnkonto), Lohnsteuer-Anmeldung (Kennzahlen nach Zahltag, Zeitraum, Senden, Sperre, Berichtigung nach Storno, Frist, Bankvorschlag), SV-Meldeportal (Liste aus festgeschriebenen Abrechnungen, Vermerk mit Protokoll nur anhängbar, Rücknahme, Änderung nach Storno, Fristen) |

### Schema der SEPA-Überweisung

`packages/core/src/sepa.test.ts` prüft die pain.001-Datei mit `xmllint-wasm` gegen zwei Schemas:

- ISO 20022 `pain.001.001.09.xsd` liegt in `packages/core/test-fixtures/sepa/`. ISO erlaubt, die Schemas frei weiterzugeben; die Datei stammt aus `raphaelm/python-sepaxml`, das sie unverändert von iso20022.org führt.
- Das Technical Validation Subset der Deutschen Kreditwirtschaft `pain.001.001.09_GBIC_5.xsd` (Anlage 3 des DFÜ-Abkommens, Version 3.9) veröffentlicht die DK auf ebics.de ohne Lizenzangabe. Es liegt deshalb nicht im Repository: Der Test lädt es von einem festen Commit eines Projekts, das es unverändert führt, und prüft den SHA-256. Ohne Netz wird diese Prüfung lokal übersprungen, in der CI (`CI` gesetzt) schlägt sie fehl.

Kommt eine neue Version der Anlage 3, gehören neues Schema, URL und Prüfsumme in den Test.

### KoSIT-Validator

Der CI-Job `kosit` erzeugt mit `packages/einvoice/scripts/kosit-check.ts` Beispielrechnungen in allen Formaten (19 %, gemischte Sätze, Storno, Korrektur, Leitweg-ID, nur Steuernummer, Nullsatz, Reverse Charge, Drittland, steuerfrei, Kleinunternehmer, Bruttopreise, Positions- und Gesamtrabatt) und prüft sie mit dem KoSIT-Validator und der XRechnung-Konfiguration. Lokal brauchst du Java 25 (wie in der CI) sowie den Validator und die Konfiguration von GitHub (`itplr-kosit/validator`, `itplr-kosit/validator-configuration-xrechnung`; welche Versionen CI nutzt, steht in `.github/workflows/ci.yml` unter `KOSIT_VALIDATOR` und `KOSIT_XRECHNUNG`):

```sh
KOSIT_JAR=/pfad/validator-<version>-standalone.jar \
KOSIT_CONFIG=/pfad/scenarios.xml \
bun run --cwd packages/einvoice kosit /tmp/haben-kosit
```

Ohne die Variablen sucht das Skript unter `/var/tmp/kosit/` (das `*-standalone.jar` in `validator/`, `xr/scenarios.xml`).

Neue Releases von Validator und XRechnung-Konfiguration bringt Renovate (`.github/renovate.json5`) als Pull Request, ebenso Bun, PostgreSQL, Caddy und restic; der `kosit`-Job des Pull Requests prüft die Rechnungen mit der neuen Version. ERiC verfolgt Renovate nicht: `DEFAULT_ERIC_VERSION` in `packages/elster/src/install.ts` hebst du von Hand, wenn eine Testübermittlung damit geklappt hat (siehe [Erste Schritte](einrichtung.md)).

### ERiC heben

1. Neue Version suchen: Die Pakete liegen unter `https://download.elster.de/download/eric/eric_<Hauptversion>/ERiC-<Version>-Linux-x86_64.jar`, die Dokumentation daneben als `ERiC-<Version>-Dokumentation.zip`. Ein `.x.1`-Release im Herbst ist BETA (Senden nur mit Testmerker), das Hauptrelease folgt im November.
2. Installieren, ohne das bisherige ERiC zu überschreiben: `ERIC_DIR=/var/tmp/eric-<Version> bun packages/elster/src/install-cli.ts --lizenz-akzeptiert <Version>`.
3. In der Dokumentation `ERiC-Releasenotes.pdf` (Änderungen seit der letzten Mindestversion), `Datenartversionmatrix.ods` (welche Datenart-Versionen es gibt) und die Schemas unter `Datenarten/` lesen; die Header unter `include/` mit denen der alten Version vergleichen (`diff -r`). Entfallene Datenart-Versionen und geänderte Signaturen passt du in `packages/elster` an, neue Jahre dort, wo Haben Jahre aufzählt (`KAPESTA_JAHRE`, `LSTA_JAHRE`, `GEWST_JAHRE`, `KST_JAHRE`, `EBILANZ_TAXONOMIEN`, `LSTB_SCHNITTSTELLEN`). Die Nutzdaten von ElsterLohn prüft ERiC nicht; `lstb.test.ts` prüft sie gegen die Schemas, wenn `ERIC_DOKU` auf das Verzeichnis `Dokumentation` des entpackten Dokumentationspakets zeigt (braucht `java`).
4. Die Tests mit dem neuen ERiC laufen lassen, auch die neuen Jahre in `eric-echt.test.ts`, und mit dem alten ERiC gegenprüfen. Fälle für ein Jahr, dessen Plugin (`lib/plugins/libcheck<Datenart>_<Jahr>.so`) dem geladenen ERiC fehlt, überspringen die Tests (`eric-plugins.ts`).
5. `DEFAULT_ERIC_VERSION` nur auf eine für Echtfälle freigegebene Version heben, kein BETA, und die Tabelle in [Erste Schritte › Welche ERiC-Version](einrichtung.md#welche-eric-version) nachziehen.

### Ende-zu-Ende-Tests mit Playwright

`apps/web/e2e/app.spec.ts` spielt den Betrieb in einer leeren Datenbank durch:
1. Konto und Firmendaten einrichten.
2. Kunden anlegen.
3. Rechnungen schreiben und festschreiben.
4. Einen Beleg hochladen und buchen. Das Belegbild entsteht im Test, mit erfundenen Daten.
5. Einen Kontoauszug importieren und die Umsätze zuordnen.
6. Prüfen, dass Kennzahlen und Salden unter **Konten** dazu passen, und den Filter im Journal testen.

Dazu legt er an, was die Tests im Projekt `mit-daten` vorfinden müssen: einen Auftrag im Archiv, eine eigene Seite, einen Mitarbeiter und einen Dauerbeleg. Alles andere spielen zwei weitere Durchläufe mit eigenem Server und eigener Datenbank daneben durch, damit diese Kette kurz bleibt:

- `rechnungen.spec.ts`: Rechnungen, Angebote, Versand per E-Mail, Kasse, REST-API und CSV-Import.
- `belege-steuern.spec.ts`: Belege, Bankabgleich, ELSTER, Voranmeldung und Zusammenfassende Meldung, Anlagen und Darlehen.

Beide richten sich mit `e2e/einrichtung.ts` dasselbe Unternehmen ein und prüfen am Ende die Seiten mit ihren Daten wie `barrierefreiheit.spec.ts` und `seiten.spec.ts`: axe am Desktop und am Handy, kein waagrechtes Scrollen auf dem Handy. Ports und Datenbanken der Durchläufe stehen in `e2e/durchlaeufe.ts`. Ein neuer Test gehört in den Durchlauf seines Themas; nach `app.spec.ts` nur, wenn `mit-daten` seine Daten braucht.

Am Ende speichert `app.spec.ts` die Sitzung (`test-results/.sitzung.json`). Danach laufen mit diesen Daten und dieser Sitzung die Dateien im Projekt `mit-daten` (`playwright.config.ts`), verteilt auf vier Worker; sie lesen nur, bis auf `steuerberatung.spec.ts`, das einen Zugang für die Steuerberatung anlegt und wieder sperrt. `elster-helfer.spec.ts`, `elster-helfer-erweiterung.spec.ts`, `langsame-anfrage.spec.ts` und `beenden.spec.ts` brauchen keine Daten und laufen im Projekt `ohne-daten` von Anfang an daneben. `beenden.spec.ts` startet den gebauten Server ein zweites Mal und prüft, dass er sich auf SIGTERM innerhalb von acht Sekunden beendet, bevor `podman stop` oder `docker stop` nach zehn Sekunden SIGKILL schickt. `elster-helfer.spec.ts` prüft die Logik der Erweiterung „Haben für Mein ELSTER“ (`src/fill.ts`, mit Vite gebaut) auf nachgebauten Formularseiten; `elster-helfer-erweiterung.spec.ts` baut die ganze Erweiterung, lädt sie in Chromium und prüft Popup und Inhaltsskript auf einer Seite unter der Adresse von Mein ELSTER.

`apps/web/e2e/gmbh.spec.ts` spielt dasselbe für eine GmbH durch (Projekt `gmbh`): Einrichtung mit Rechtsform und SKR04, manuelle Buchung mit Storno, Lohnabrechnung des Gesellschafter-Geschäftsführers mit PDF, Lohnkonto, Lohnsteuer-Anmeldung und Storno, ein Minijob mit Ausfüllliste für das SV-Meldeportal und Vermerk der Abgabe. Weil die Rechtsform ab der ersten Buchung fest ist, läuft es wie die beiden anderen Durchläufe gegen einen eigenen Server (`E2E_PORT` + 1, + 2, + 3) mit eigener Datenbank, deren Name aus `E2E_DATABASE_URL` folgt (`haben_e2e` → `haben_gmbh_e2e`, `haben_rechnungen_e2e`, `haben_belege_steuern_e2e`). `e2e/reset-db.ts` legt sie beim ersten Lauf an; dafür braucht der Datenbanknutzer das Recht `CREATEDB`.

`apps/web/e2e/seiten.spec.ts` lädt jede Seite am Desktop (1440 px) und am Handy (390 px) und prüft dabei:
- Die Seite antwortet ohne Fehler und hat eine Überschrift.
- Im Browser tritt kein Fehler auf, auch kein Hydration-Fehler.
- Am Handy ist die Seite nicht breiter als der Bildschirm.
- Das Handy-Menü lässt sich öffnen und bedienen.

Screenshots macht der Test nicht; die Bilder für README und Doku entstehen getrennt (siehe unten). Eine neue Seite gehört in die Liste in `seiten.spec.ts` und in `barrierefreiheit.spec.ts`.

`apps/web/e2e/kopfzeile.spec.ts` prüft am Laptop (1470 px) und am Handy, dass Titel, Status und Aktionen im Rechnungsentwurf, in der Rechnung und die Bereiche der Einstellungen beim Scrollen sichtbar bleiben, und dass weder Tabellenköpfe noch Felder mit Fokus beim Tabben hinter dem Kopf verschwinden. Das Angebot prüft `rechnungen.spec.ts`, weil nur dieser Durchlauf Angebote anlegt; die Prüfungen dazu stehen in `e2e/kopfzeile.ts`.

`apps/web/e2e/bestaetigung.spec.ts` prüft den `ConfirmDialog` am Festschreiben: modal, Fokus auf „Abbrechen“ und zurück auf den Auslöser, Esc und „Abbrechen“ ohne Wirkung, Doppelklick, axe auf Desktop und Handy in einem hellen und einem dunklen Theme. Bestätigt wird in den Durchläufen je Bereich mit `bestaetigen` aus `e2e/einrichtung.ts`.

`apps/web/e2e/barrierefreiheit.spec.ts` prüft mit denselben Daten Barrierefreiheit und Tastaturbedienung: axe-core (`@axe-core/playwright`) gegen WCAG 2.2 AA auf jeder Seite am Desktop und am Handy, Farbkontraste in allen Themes, Anmelden nur mit der Tastatur, Sprunglink, sichtbarer Fokus beim Tabben und das Handy-Menü mit Esc. Was genau, und worauf neue Oberflächen achten, steht unter [Barrierefreiheit und Tastatur](barrierefreiheit.md#wie-das-geprüft-wird). Eine einzelne Datei startest du mit `bun run e2e barrierefreiheit`; Playwright lässt `app.spec.ts` dann davor laufen, weil das Projekt `mit-daten` davon abhängt.

```sh
createdb haben_e2e            # einmalig; der Name muss auf „e2e“ enden, die Datenbank wird bei jedem Lauf geleert
E2E_DATABASE_URL=postgres://haben@localhost:5432/haben_e2e bun run e2e
```

Playwright startet selbst einen Server auf Port 3100 (`E2E_PORT`). Vorher leert es die Datenbank und spielt die Migrationen ein. Lokal ist das der Entwicklungsserver, in der CI der gebaute Server (`E2E_SERVER_COMMAND="bun .output/server/index.mjs"` nach `bun run build`). Chromium kommt einmalig mit `bun --bun playwright install chromium` in `apps/web`. Wer schon ein passendes Chromium hat, setzt stattdessen `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

In der CI laufen die Tests bei jedem Pull Request in drei Teilen parallel (Jobs `e2e-teil`, `bun run e2e --shard=<n>/3`). Jeder Teil mit Tests aus `mit-daten` spielt `app.spec.ts` vorher selbst durch. Der Job `e2e` fasst die Teile zu einem Ergebnis zusammen; ihn verlangen die Regeln für `main`. Lokal läuft ein Teil genauso, etwa `bun run e2e --shard=2/3`.

Playwright-Bericht und bei Fehlern Traces hängen je Teil als Artefakt `e2e-bericht-teil-<n>` am Lauf.

### Bilder für README und Doku

Die Bilder in README und Doku (`docs/screenshot-*.png`) entstehen aus denselben Daten: nach `app.spec.ts`
läuft im Projekt `mit-daten` `e2e/zz-doku-screenshots.spec.ts`, meldet sich an und ergänzt zuerst, was nur die Bilder
brauchen: Rechnungen über mehrere Monate mit Zahlungseingängen und Pauschalen. Dann fotografiert es Übersicht,
Rechnungseditor, Bankabgleich, Beleg, Voranmeldung, Auswertungen, Archiv und die Übersicht am Handy. Ohne
`DOKU_SCREENSHOTS=1` überspringt es sich selbst; die CI legt diese Daten also nie an und wird dadurch nicht langsamer.

```sh
E2E_DATABASE_URL=postgres://haben@localhost:5432/haben_e2e bun run docs:screenshots
```

Nach einer Änderung am Aussehen den Workflow **Update screenshots** (Actions → Run workflow) auf dem
Branch starten: er nimmt die Bilder im offiziellen Playwright-Image mit einer eigenen Datenbank auf und
committet, was sich geändert hat. Auf `main` pusht er wie *Bump version* mit dem Deploy Key aus `BUMP_DEPLOY_KEY`, weil das Ruleset dort Pushes mit dem `GITHUB_TOKEN` ablehnt; der Commit startet dann die CI auf `main`.

## Migrationen

Das Schema steht in `apps/web/src/server/db/schema.ts`, die Migrationen in `apps/web/drizzle/`.

1. Schema anpassen.
2. `bun run db:generate` erzeugt die SQL-Migration und den Snapshot in `drizzle/meta/`.
3. `bun run db:migrate` wendet sie lokal an. Im Container passiert das beim Start automatisch.

Trigger und Funktionen (Festschreibung, Versionierung, Audit-Log) kann drizzle-kit nicht aus dem Schema ableiten. Sie stehen in eigenen SQL-Migrationen, z. B. `0001_festschreibung.sql`, `0003_rechnungen_trigger.sql` oder `0010_lexoffice_trigger.sql`. Eine leere Migration dafür legst du so an und schreibst das SQL von Hand hinein:

```sh
cd apps/web && bun --bun drizzle-kit generate --custom --name=mein_trigger
```

Bestehende Migrationen änderst du nicht; sie sind auf laufenden Installationen schon angewendet.

## HGB-Taxonomie der E-Bilanz

Die E-Bilanz braucht von der Taxonomie nur je Position Pflichtgrad, Summe mit Gewicht, Soll/Haben und Periodentyp. Das steht als Auszug in `packages/elster/src/ebilanz/taxonomie-6-9.json` und `taxonomie-6-10.json`, erzeugt aus der Taxonomie von [esteuer.de](https://www.esteuer.de):

```sh
bun scripts/ebilanz/taxonomie.ts <Ordner>/de-gaap-ci-2025-04-01 packages/elster/src/ebilanz/taxonomie-6-9.json
bun scripts/ebilanz/taxonomie.ts <Ordner>/de-gaap-ci-2026-04-01 packages/elster/src/ebilanz/taxonomie-6-10.json
```

Welche Taxonomie für ein Wirtschaftsjahr gilt, steht in `ebilanzTaxonomie` (`packages/elster/src/ebilanz/taxonomie.ts`), nach dem BMF-Schreiben zur jeweiligen Taxonomie. Für eine neue Taxonomie (jährlich zum 1. April, bekannt gegeben im Juni) den Auszug neu erzeugen, ihn in `taxonomie.ts` eintragen, dort `ebilanzTaxonomie` und in `packages/elster/src/xml.ts` `EBILANZ_TAXONOMIEN` ergänzen und die Tests mit ERiC laufen lassen; `zuordnung.test.ts` meldet Positionen der Kontenzuordnung, die es nicht mehr gibt oder die keine Blätter mehr sind. Die Prüfregeln stehen im Technischen Leitfaden und im Änderungsnachweis auf esteuer.de, ihre Umsetzung in den ERiC-Releasenotes (Kapitel „Datenart Bilanz“), Beispiele in der ERiC-Dokumentation unter `Datenarten/ElsterBilanz/Bilanz/Beispiele/Taxonomie_<Version>`.

esteuer.de liefert ein falsches Zwischenzertifikat aus. Zum Herunterladen das richtige über die AIA-Adresse des Serverzertifikats holen (`openssl x509 -noout -text` zeigt sie unter „CA Issuers“, zurzeit `http://secure.globalsign.com/cacert/gsgccr46dvtlsca2025.crt`), nach PEM wandeln und zusammen mit den übrigen vertrauenswürdigen Zertifikaten an `curl --cacert` geben; die TLS-Prüfung bleibt an:

```sh
curl -sS -o r46.crt http://secure.globalsign.com/cacert/gsgccr46dvtlsca2025.crt
openssl x509 -inform DER -in r46.crt -out r46.pem
cat /etc/ssl/certs/ca-certificates.crt r46.pem > ca-esteuer.pem
curl -sS --cacert ca-esteuer.pem -O https://www.esteuer.de/download/taxonomie_20260615/germany-gaap-taxonomy-v6.10-2026-04-01-xbrl.zip
```

## Lohnsteuer: PAP jährlich aktualisieren

Die Lohnsteuer in `packages/core/src/lohnsteuer/` folgt dem Programmablaufplan (PAP) des BMF für die maschinelle Berechnung der Lohnsteuer. Er gilt für ein Kalenderjahr; für ein Jahr ohne PAP gibt `lohnsteuer()` den Fehler „Lohnsteuer {Jahr} ist noch nicht hinterlegt“ zurück und rechnet nicht mit den Werten des Vorjahres. Ab Dezember schlägt der Test „Jahreswechsel (echtes Datum)“ in `lohnsteuer.test.ts` fehl, bis der PAP des nächsten Jahres hinterlegt ist. Der BMF veröffentlicht ihn meist im November, unter Umständen im Lauf des Jahres eine geänderte Fassung. Beides meldet der Workflow [Jahreswerte prüfen](#jahreswerte-erinnerung-per-workflow) als Issue.

1. Das PAP-XML vom [BMF-Steuerrechner](https://www.bmf-steuerrechner.de/) laden (`/javax.faces.resource/daten/xmls/Lohnsteuer<Jahr>.xml.xhtml`) und unverändert als `Lohnsteuer<Jahr>.xml` neben `pap.ts` legen.
2. Mit dem XML des Vorjahres vergleichen (`diff`). Ändern sich nur Zahlen, reicht eine neue Datei `pap-<Jahr>.ts` nach dem Muster von `pap-2026.ts` mit Version, Stand und SHA-256 der Datei. Ändert sich der Ablauf einer Methode, die `pap.ts` überträgt (MPARA, MRE4JL, MRE4ABZ, MBERECH, MZTABFB, MLSTJAHR, UPEVP, MVSPKVPV, MVSPHB, UPMLST, MST5_6, UP5_6, UPTAB, MSOLZ, UPANTEIL), braucht das neue Jahr eine eigene Übertragung; die alte bleibt für Korrekturen früherer Jahre.
3. Das Jahr in `PAP_JAHRE` in `index.ts` eintragen und einen Test nach dem Muster von `pap-2026.test.ts` anlegen, der jeden Wert mit dem XML abgleicht.
4. Prüffälle gegen die externe Schnittstelle des BMF-Steuerrechners (`/interface/<Jahr>Version1.xhtml?code=LSt<Jahr>ext`) abrufen, mindestens Steuerklassen I bis VI in allen Lohnzahlungszeiträumen, mit Kindern, privat versichert und ohne Rentenversicherungspflicht, und als `packages/core/test-fixtures/lohnsteuer/bmf-<Jahr>.json` ablegen.
5. Den Tarif in `TARIFE` in `packages/core/src/income-tax.ts` ergänzen; die Gegenprobe in `pap.test.ts` vergleicht ihn mit UPTAB des PAP.

Die Rechnung läuft ohne Gleitkommazahlen über `dezimal.ts` (`bigint` mit Nachkommastellen) und rundet genau dort, wo der PAP `setScale` oder `divide` mit Rundung vorschreibt.

## Sozialversicherung: Werte jährlich aktualisieren

Die Beiträge zur Sozialversicherung in `packages/core/src/sozialversicherung/` rechnen mit den Rechengrößen und Beitragssätzen eines Kalenderjahres. Für ein Jahr ohne Werte gibt `sozialversicherung()` den Fehler „Die Sozialversicherungswerte {Jahr} sind noch nicht hinterlegt“ zurück und rechnet nicht mit den Werten des Vorjahres. Ab Dezember schlägt der Test „Jahreswechsel (echtes Datum)“ in `sozialversicherung.test.ts` fehl, bis die Werte des nächsten Jahres hinterlegt sind; die Regel dazu steht in `packages/core/src/jahressperre.ts` und gilt für die Lohnsteuer genauso. Sobald die Sozialversicherungsrechengrößen-Verordnung des nächsten Jahres auf gesetze-im-internet.de steht, öffnet der Workflow [Jahreswerte prüfen](#jahreswerte-erinnerung-per-workflow) ein Issue.

1. Die Werte des neuen Jahres sammeln, jeden mit Quelle: Sozialversicherungsrechengrößen-Verordnung (BBG KV/PV und RV/AV, Bundesgesetzblatt, meist im November), Bekanntmachung der Beitragssätze der Rentenversicherung, durchschnittlicher Zusatzbeitrag (BMG, Bundesanzeiger), Geringfügigkeitsgrenze und Faktor F (BMAS, Bundesanzeiger), Pflege- und Arbeitslosenversicherung, Insolvenzgeldumlage sowie Pauschalen und Umlagen der Minijob-Zentrale. Was sich nicht belegen lässt, bleibt offen; das Jahr wird dann nicht freigegeben.
2. In `werte.ts` ein `SV_<Jahr>` nach dem Muster von `SV_2026` anlegen, mit Quelle je Wert, und in `SV_JAHRE` in `index.ts` eintragen. `werte.test.ts` prüft, dass jeder Wert eine Quelle hat, dass der Faktor F zu 28 % durch den Gesamtsozialversicherungsbeitragssatz passt und dass BBG und Sätze mit dem PAP der Lohnsteuer desselben Jahres übereinstimmen.
3. Beispielrechnungen des neuen Jahres als Tests aufnehmen (Beratungsblatt der TK zum Übergangsbereich, Häufige Fragen der Minijob-Zentrale), mit Quelle und Link am Erwartungswert.
4. Ändert sich eine Regel (Formel des Übergangsbereichs, Rundung, Pauschalen), braucht das neue Jahr eine eigene Rechnung; die alte bleibt für Korrekturen früherer Jahre.

Gerechnet wird ohne Gleitkommazahlen: Entgelt in Cent mal Satz in Basispunkten mit `bigint`, kaufmännisch auf Cent gerundet erst am Ende (§ 1 Abs. 2 BVV). Beiträge, die Arbeitgeber und Beschäftigter je zur Hälfte tragen, rechnet Haben mit dem halben Satz und verdoppelt das gerundete Ergebnis (§ 2 Abs. 1 BVV), den Zusatzbeitrag der Kasse getrennt vom allgemeinen Satz wie im Beispiel 7 des TK-Beratungsblatts zum Übergangsbereich; sonst ist der Beitrag die Summe der getrennt gerundeten Anteile. Im Übergangsbereich trägt der Arbeitgeber den Gesamtbeitrag abzüglich des Anteils des Beschäftigten; Kinderlosenzuschlag und Kinderabschläge rechnet § 2 Abs. 2 BVV gesondert. Die Vorschriften stehen mit Link im Code; Gesetzestexte am besten bei gesetze-im-internet.de, Bekanntmachungen im Bundesanzeiger lesen, nicht in Ratgebern.

## Jahreswerte: Erinnerung per Workflow

Renovate meldet neue Versionen der Abhängigkeiten; was Haben an amtlichen Werten braucht, beobachtet der Workflow **Jahreswerte prüfen** (`.github/workflows/jahreswerte.yml`). Er läuft montags früh und auf Knopfdruck (**Actions → Jahreswerte prüfen → Run workflow**), führt `scripts/jahreswerte/pruefen.ts` aus und öffnet je Befund ein Issue mit dem Label `jahreswerte` und einer festen Kennung im Titel, z. B. `[jahreswerte:pap-2027]`. Gibt es schon ein offenes Issue mit der Kennung, entsteht kein zweites; hat sich der Befund geändert (neuere Version, anderer Hash), bekommt es einen Kommentar, und Titel und Text werden nachgezogen. Eine Quelle, die nicht antwortet (503, Verbindungsabbruch, keine Antwort binnen 30 Sekunden auch im zweiten Versuch), steht nur als Warnung im Lauf; der Workflow schlägt deshalb nicht fehl. Nach zehn Minuten ruft der Lauf nichts mehr ab, damit er vor dem Zeitlimit des Jobs (15 Minuten) mit Warnungen endet. Die Jahreswechsel-Tests (`fehlendeLohnsteuerJahre`, `fehlendeSozialversicherungJahre`) bleiben die letzte Sicherung: Sie schlagen ab Dezember fehl, wenn das nächste Jahr fehlt.

| Kennung | Quelle | Befund | Zu tun |
| --- | --- | --- | --- |
| `pap-<Jahr>` | [BMF-Steuerrechner](https://www.bmf-steuerrechner.de/), `Lohnsteuer<Jahr>.xml.xhtml` für das laufende und das nächste Jahr | Das XML eines Jahres ohne PAP in Haben ist erschienen | [Lohnsteuer: PAP jährlich aktualisieren](#lohnsteuer-pap-jährlich-aktualisieren) |
| `pap-<Jahr>-geaendert` | wie oben | Das XML eines hinterlegten Jahres hat einen anderen SHA-256 als in `pap-<Jahr>.ts` | neue Fassung vergleichen, Werte, Quelle und Hash nachziehen |
| `est-tarif-<Jahr>` | wie oben (der PAP enthält den Tarif, Methode UPTAB) | Es gibt den PAP des Jahres, aber `TARIFE` in `packages/core/src/income-tax.ts` hat das Jahr nicht | Schritt 5 der PAP-Aktualisierung |
| `sv-<Jahr>` | gesetze-im-internet.de, `/svbezgrv_<Jahr>/` (Titel „SVBezGrV <Jahr>“) | Die Sozialversicherungsrechengrößen-Verordnung eines Jahres ohne Werte in Haben ist erschienen | [Sozialversicherung: Werte jährlich aktualisieren](#sozialversicherung-werte-jährlich-aktualisieren) |
| `eric` | download.elster.de, `eric_<Haupt>/ERiC-<Version>-Linux-x86_64.jar` | Es gibt eine neuere Version als `DEFAULT_ERIC_VERSION`, die keine BETA ist | installieren, [Tests mit echtem ERiC](#tests-mit-echtem-eric), Testübermittlung, `DEFAULT_ERIC_VERSION` anheben; neue Datenarten des Jahres und Taxonomie der E-Bilanz im Paket ansehen |
| `eric-<Version>-entfernt` | wie oben | Die eingestellte Version ist nicht mehr herunterladbar | wie oben |
| `datev-skr03`, `datev-skr04` | DATEV-Shop, Produktseiten Art.-Nr. 11174 und 11175, Merkmal „Stand“ | Der Stand ist ein anderer als `HABEN_KONTENRAHMEN_STAND` in `scripts/jahreswerte/datev.ts` | Kontenzuordnung (`hgb.ts`, `posting.ts`, `ebilanz.ts`) mit der neuen Ausgabe abgleichen, Konstante anheben |
| `norm-<id>` | gesetze-im-internet.de, Einzelnormen aus `scripts/jahreswerte/normen.json` | Der Normtext hat einen anderen SHA-256 als in `normen.json`, oder die Seite antwortet mit 404 (Norm aufgehoben oder unter neuer Adresse) | siehe unten |

**ERiC:** Die Infoseite für Entwickler bei ELSTER ist nur nach Anmeldung lesbar, und download.elster.de hat kein Verzeichnis. Die Pakete selbst sind frei abrufbar; das Skript fragt deshalb Versionen oberhalb von `DEFAULT_ERIC_VERSION` (bis zwei Hauptversionen voraus, Neben 0 bis 9, Patch 0 bis 12) mit `Range: bytes=0-0` ab und meldet die höchste, die es gibt. Als vorhanden zählt 206 (oder 200 ohne HTML); eine Wartungsseite mit 200 ist nur eine Warnung. Pro Jahr gibt es ein technisches Release im Mai und das Hauptrelease im November (ERiC-Entwicklerhandbuch Kap. 2.3). Vor dem November-Release erscheint im Oktober `<Haupt>.1` als BETA, die nur mit Testmerker sendet (Kap. 5.4.3); das Hauptrelease ist `<Haupt>.2`. Am Paket lässt sich das nicht ablesen, der Status steht nur in den Releasenotes (PDF im Dokumentationspaket): BETA waren 41.1, 43.1 und 45.1, die Mai-Releases 42.1 und 44.1 nicht. Das Skript leitet daraus die Regel ab: `<Haupt>.0` und `<Haupt>.1` einer ungeraden (November-)Hauptversion oberhalb der eingestellten sind kein Befund und öffnen kein Issue; solange nichts Freigegebenes darüber liegt, nennt eine Warnung die neueste BETA. Wartungsreleases der eingestellten Hauptversion (etwa 44.3.7.0 bei 44.3.6.0), Mai-Releases und ab `<Haupt>.2` sind Befunde.

**Gesetzeswächter:** `scripts/jahreswerte/normen.json` nennt je Norm, auf die Haben sich stützt, die Seite bei gesetze-im-internet.de, wofür Haben sie braucht, die Stellen im Code und den SHA-256 des Normtexts (Überschrift, Absätze und Fußnoten, ohne Tags, Navigation und Fußzeile, Leerraum zusammengefasst; die Seiten sind ISO-8859-1, den Zeichensatz nennt nur das `meta`-Element). Meldet der Workflow eine Norm als geändert: Änderung lesen (Fußnote und „Textnachweis“ nennen das ändernde Gesetz und ab wann es gilt), die genannten Stellen prüfen und anpassen, dann den Hash aktualisieren – auch wenn sich in Haben nichts ändert, sonst bleibt der Befund:

```sh
bun scripts/jahreswerte/pruefen.ts --trocken --normen-schreiben   # aktuelle Hashes nach normen.json
```

Eine neue Norm kommt mit leerem `sha256` in die Liste und bekommt ihren Hash mit demselben Befehl. Der Befehl übernimmt die Hashes aller Normen; vorher sollte kein anderer Befund zu einer Norm offen sein.

Lokal ohne Issues, nur mit Ausgabe der Befunde und Warnungen:

```sh
bun scripts/jahreswerte/pruefen.ts --trocken
```

Nicht geprüft werden die Taxonomie der E-Bilanz (esteuer.de liefert eine unvollständige Zertifikatskette, die Bun ablehnt; neue Taxonomien kommen mit ERiC, siehe Befund `eric`), die Seiten des BMF (antworten oft mit 503) und der Basiszinssatz (§ 247 BGB, steht in den Einstellungen jeder Installation; nur der Normtext ist im Gesetzeswächter).

## Konventionen

- **Geld in ganzen Cent** (`Cents`), nie als Gleitkommazahl. Parser rechnen Dezimaltext direkt in Cent um.
- **Steuersätze in Basispunkten** (`BasisPoints`): 1900 = 19 %, 700 = 7 %.
- **Mengen in Tausendsteln**: 152 Stunden = 152000, 0,5 Tage = 500.
- **Formatierung mit Biome:** `bun run format` formatiert JavaScript, TypeScript und JSON (160 Zeichen breit, doppelte Anführungszeichen); `bun run lint` und die CI prüfen das. CSS und Markdown formatiert Biome nicht. Reine Formatier-Commits stehen in `.git-blame-ignore-revs`; damit `git blame` sie lokal überspringt, einmal `git config blame.ignoreRevsFile .git-blame-ignore-revs` und `git config blame.markIgnoredLines true`. Der Squash-Commit von #201 ändert auch `biome.jsonc`, `package.json` und diese Seite; solche Zeilen schreibt `git blame` einem älteren Commit zu und markiert sie mit `?`.
- **Lint mit Biome:** Abgeschaltete Regeln stehen mit Grund in `biome.jsonc`. Eine Ausnahme an einer Stelle steht direkt davor als `// biome-ignore lint/<gruppe>/<regel>: <Grund>`.
- **Imports mit `.ts`-Endung** (`allowImportingTsExtensions`). Der ERiC-Worker und das Migrationsskript laufen unter Bun direkt aus den Quellen, ohne Build.
- **Bun statt Node:** Die Skripte starten Vite, Vitest, Playwright, Biome, tsc und drizzle-kit mit `bun --bun`; ohne den Schalter nähme Bun das `node` aus deren Startzeile, falls eines installiert ist. Install-Skripte führt `bun install` nur für die Pakete in `trustedDependencies` aus (esbuild lädt sein Binary, koffi sein natives Modul für ERiC). `bunfig.toml` legt die Abhängigkeiten wie früher pnpm isoliert ab: Jedes Paket sieht nur, was es selbst einträgt.
- **Oberfläche auf Deutsch**, auch Fehlermeldungen, die beim Nutzer ankommen.
- **Gestaltung der Oberfläche:** Abstände auf dem 4px-Raster, Schriftgrößen aus 12, 13, 14, 16, 18, 24 und 28px, Beschriftungen und Tabellenköpfe in Satzschreibung statt Versalien mit Sperrung. Symbole kommen aus der `Icon`-Komponente, nicht als Emoji oder Unicode-Zeichen. Keine Verläufe, Leuchteffekte oder Endlos-Animationen; Farbe trägt Bedeutung (Akzent, Status, Diagrammreihen). Die Kennzahlenreihe zeigt nur Zahlen.
- **Seitenkopf:** Jede Seite beginnt mit `.page-head` als direktem Kind von `<main>`: Titel, Status und Hauptaktionen. Hat die ganze Seite einen Status (Rechnung, Angebot, Umsatzsteuer-Voranmeldung), steht er neben dem Titel (`.title-with-status`), damit er mit dem Kopf sichtbar bleibt. Er bleibt beim Scrollen stehen (#356). Seine gemessene Höhe steht in `--page-head-height` (`usePageHeadHeight` in `lib/use-page-head.ts`), seine Unterkante samt Handy-Navigation in `--below-head`. Was darunter ebenfalls stehen bleibt (Unternavigation, Belegansicht, Tabellenköpfe, Sprungleisten), nimmt `top: var(--below-head)` statt eines festen Abstands; `scroll-padding-top` hält Sprungziele und Felder mit Fokus unter dem Kopf. Auf dem Handy steht der Kopf kompakt: die Aktionen in einer Zeile, die seitlich scrollt; im Belegeditor (`.editor-actions`) brechen sie um, damit Speichern und Festschreiben sichtbar bleiben. Der Kontaktdialog (`ContactDialog`) folgt demselben Muster: Titel in Seitentitelgröße oben und die Knöpfe unten stehen, nur das Formular dazwischen scrollt; der Dialog ist selbst die Karte, das Formular darin hat keinen eigenen Rahmen.
- **Rückfragen:** Folgenreiches bestätigt der Dialog `ConfirmDialog` (#404), nie ein zweiter Klick auf denselben Knopf und nie `window.confirm`. Der Titel ist eine Frage mit dem Objekt („Entwurf löschen?“), darunter stehen die Folgen, rechts die Aktion mit ihrem Namen, nie „OK“. Der Kopf hat keine Trennlinie und kein Schließen-X; die Linie unter dem Titel gehört zu Formular-Dialogen wie `ContactDialog`, deren Inhalt scrollt. Geht es um Geld oder das Finanzamt, nennt `facts` über den Folgen, was bestätigt wird: beim Festschreiben einer Rechnung Nummer, Kunde und Betrag, bei ELSTER Steuerart, Zeitraum und Zahllast, beim Lohn Person, Brutto und Auszahlung, beim Beleg Lieferant, Datum und Betrag; ein Storno nennt dasselbe wie das, was es zurücknimmt. Ein Häkchen (`acknowledge`) gibt es nur beim Jahresabschluss, Eintippen gar nicht. Am Handy ist der Dialog ein Blatt von unten mit der Aktion über „Abbrechen“; an Griff oder Titel nach unten gewischt schließt es wie „Abbrechen“. Fokus beim Öffnen auf „Abbrechen“, danach zurück auf den Auslöser; Esc führt nichts aus. Rot (`danger`) sind Löschen, Stornieren, Entfernen, Widerrufen, Trennen, endgültiges Beenden und Abschließen, grün der erwartete nächste Schritt wie Festschreiben, Buchen und Senden. Der Dialog schließt vor der Aktion; das Ergebnis meldet die Seite. Tastenkürzel der Seite fragen `isDialogOpen()`.
- **Barrierefrei und per Tastatur bedienbar:** echte Knöpfe und Links, ein Label für jedes Feld, sichtbarer Fokus, Text in Akzentfarbe mit `var(--link)`. `barrierefreiheit.spec.ts` prüft das in der CI ([Barrierefreiheit und Tastatur](barrierefreiheit.md)).
- **Unveränderlichkeit (GoBD) in der Datenbank:** Festgeschriebene Rechnungen, Buchungen, gesendete Voranmeldungen, Bankumsätze und übernommene Lexoffice-Daten sperren Postgres-Trigger gegen `UPDATE` und `DELETE`. Korrekturen sind neue Datensätze (Storno, Gegenbuchung, berichtigte Anmeldung). Beim Festschreiben einer Buchung prüft ein Trigger Soll = Haben.
- **Audit-Log:** Änderungen laufen über `withActor` (`apps/web/src/server/db/actor.ts`), damit der Trigger sie dem Nutzer zuschreibt.
- **Server-Funktionen bleiben dünn:** In `apps/web/src/server/functions/` hängt jede Funktion mit Daten `authMiddleware` an, validiert die Eingabe mit Zod und ruft die Logik im passenden Modul unter `apps/web/src/server/modules/` auf. Fachlogik ohne Datenbank gehört nach `packages/core`.
- **Modulgrenzen:** Aus einem anderen Modul nur über dessen `index.ts` importieren; die Prüfung in `scripts/modulgrenzen/` bricht `bun run lint` und damit die CI sonst ab. Fehlt dort ein Name, ergänze ihn in der `index.ts`. Neuer Code gehört in das Modul, dessen Tabellen er schreibt ([Module im Server](architektur.md#module-im-server)).
- **ERiC nie im App-Prozess:** Jeder Aufruf geht über einen kurzlebigen Kindprozess (`packages/elster/src/worker.ts`).

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
| `packages/import` | Kontoauszugs-Parser, Exporte von Zahlungsdienstleistern, Deduplizierung, DATEV, Lexoffice- und sevDesk-Client, Kontoabruf über Enable Banking, CSV-Import von Kontakten, Artikeln und Anlagen (`csv-import/`) |
| `packages/einvoice` | Rechnungs-PDF mit Typst, E-Rechnung erzeugen und lesen |
| `apps/elster-helfer` | Browser-Erweiterung „Haben für Mein ELSTER“ (TypeScript, Vite) |
| `deploy` | Compose, Quadlets, Caddyfile, Startskript; `deploy/backup`: Backup-Image (backup.sh, restore.sh) |
| `docs`, `mkdocs.yml` | Diese Dokumentation; auf `main` baut `.github/workflows/docs.yml` sie nach https://firsttris.github.io/haben/ |

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

Images baut der Workflow `.github/workflows/release.yml`: die CI liegt hier, Image, Docker-Hub-Beschreibung und GitHub-Release kommen aus dem gemeinsamen [`docker-release.yml`](https://github.com/firsttris/workflows) in `firsttris/workflows`. Ein Tag `vX.Y.Z` veröffentlicht eine Version:

1. Der Tag muss zu `version` in der `package.json` im Wurzelverzeichnis passen.
2. Die komplette CI läuft (Lint, Typecheck, Tests, Build, KoSIT, Container-Test), außer die CI auf `main` hat denselben Code schon geprüft: ein Commit von *Bump version* ändert nur die Version, dann zählt der grüne Lauf des Commits davor.
3. Das Image wird für `linux/amd64` und `linux/arm64` gebaut und als `:x.y.z`, `:x.y` und `:latest` nach Docker Hub (`tristanteu/haben`) und GHCR (`ghcr.io/firsttris/haben`) geschoben. Die README landet mit absoluten Links als Beschreibung auf Docker Hub.
4. Erst danach entsteht das GitHub-Release mit erzeugten Notizen. Daran hängt die Erweiterung „Haben für Mein ELSTER“ als `haben-fuer-mein-elster-chrome-<Version>.zip`: Der Job `erweiterung` baut `apps/elster-helfer` (TypeScript mit Vite), packt `dist/` mit `scripts/elster-helfer/paket.ts` und setzt die Version aus dem Tag ins Manifest (bei einem Release Candidate die Ziffern in `version`, die volle Bezeichnung in `version_name`). Das Artefakt heißt `extension`, wie bei den anderen Erweiterungen; den Chrome Web Store kann später `browser-extension-stores.yml` aus `firsttris/workflows` daraus bedienen.

Den Tag legt einer von zwei Wegen an, nach demselben Schema wie in den anderen Projekten:

- ohne Checkout: Actions → *Bump version* → patch, minor oder major (`bump.yml`). Erhöht die Version in der `package.json`, committet sie als `Release vX.Y.Z` auf `main` und taggt; der Tag startet `release.yml`. Weil das Ruleset auf `main` Pull Request und grüne Checks verlangt, pusht der Workflow mit einem Deploy Key, der auf der Bypass-Liste des Rulesets steht (Secret `BUMP_DEPLOY_KEY`, Einrichtung in der [README von firsttris/workflows](https://github.com/firsttris/workflows#bump-version)). Der Release-Commit startet dabei auch die CI auf `main`.
- lokal, nur wer auf der Bypass-Liste des Rulesets steht:

```sh
bun run release:patch   # oder :minor, :major: erhöht die Version, legt Commit und Tag an und pusht beides
```

Von Hand gestartet (Actions → Release → Run workflow) laufen auf `main` dieselben Prüfungen, danach wird nur `:edge` veröffentlicht, ohne Release.

### Release Candidates

Größere Änderungen, etwa Migrationen oder Änderungen an Festschreibung, Audit-Log oder ELSTER, gehen vorher als Release Candidate raus. Alles bleibt auf `main`, die RCs sind nur Tags:

1. Actions → *Bump version* → `preminor` (oder `prepatch`, `premajor`): aus `0.1.9` wird `v0.2.0-rc.1`. Das Image heißt `:0.2.0-rc.1` und `:next`; `:latest` bleibt auf `0.1.9`, das GitHub-Release ist ein Pre-release.
2. Fehler gefunden: fixen, dann *Bump version* → `prerelease` → `v0.2.0-rc.2`.
3. Läuft stabil: *Bump version* → `patch` → `v0.2.0`, jetzt auch `:latest`.

Zwischen RC und fertiger Version nur Fixes mergen, sonst geht Ungetestetes mit raus. RCs nur mit Backup testen: Eine Migration aus einem RC ist danach schon auf den Testinstanzen angewendet und wird nicht mehr geändert.

Der Workflow braucht das Repository-Secret `DOCKER_PAT`, ein Docker-Hub-Zugriffstoken mit Schreibrecht für `tristanteu/haben`. Für GHCR reicht das eingebaute `GITHUB_TOKEN`; das Paket ist nach dem ersten Push privat und muss einmal in den Paket-Einstellungen auf öffentlich gestellt werden.

## Mitwirken

Vor einem Pull Request bitte dieselben Prüfungen wie in CI laufen lassen (ohne Bun auf dem Rechner siehe [Prüfungen ohne Bun auf dem Rechner](#prüfungen-ohne-bun-auf-dem-rechner)):

```sh
bun run lint
bun run typecheck
TEST_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_test bun run test
bun run build
```

- Neue Fachlogik mit Tests, Änderungen an Buchungen oder Steuerberechnung mit Testfällen für SKR03 und SKR04 sowie Ist und Soll.
- Schemaänderungen mit erzeugter Migration; Trigger in einer eigenen SQL-Migration.
- Änderungen an der E-Rechnung prüft der KoSIT-Job in CI.
- Texte in der Oberfläche auf Deutsch.
- Änderungen am Aussehen (UI/UX) mit Screenshots vorher und nachher in der Beschreibung des Pull Requests, in einem hellen und einem dunklen Theme, wo es darauf ankommt auch am Handy. Die Bilder für „vorher“ entstehen vor der ersten Änderung, sonst muss der alte Stand später eigens wieder aufgebaut werden. Hochgeladen werden sie als Anhang, also per Ziehen ins Textfeld auf GitHub. Ein Branch nur für Bilder ist eine Notlösung: nur im eigenen Fork, nie im Haupt-Repository (jeder Klon lädt ihn sonst mit), nur neue Commits, und mit dem Branch oder Fork verschwinden auch die Bilder.

### Branches, Titel und Commits

- **Branch:** Wer Schreibrecht hat, legt den Branch direkt in `firsttris/haben` an, alle anderen in ihrem Fork. Direkt auf `main` wird nicht gepusht.
- **Entwurf:** Ein Pull Request darf als Entwurf beginnen. Für Entwürfe läuft die CI nicht; sie startet mit „Ready for review“. Ändert ein Pull Request nur Markdown, `docs/` oder `LICENSE`, läuft sie gar nicht (`paths-ignore` in `ci.yml`), und die Doku baut erst auf `main`: dann den Doku-Build von oben lokal laufen lassen.
- **Titel:** `Bereich: was sich ändert (#Issue)`, etwa „Belege: eigene Ausgangsrechnung beim Upload erkennen (#104)“. Pull Requests werden per Squash gemergt; der Titel wird dann der Commit auf `main`.
- **Commits im Pull Request:** gern im Stil von [Conventional Commits](https://www.conventionalcommits.org/de/) mit Beschreibung auf Deutsch, etwa `fix(belege): Fremdwährung in der Rechnungswährung vergleichen` oder `test: …`. Das ist eine Empfehlung, keine Prüfung.

### Mit KI-Werkzeugen

Mit KI-Agenten zu arbeiten ist ausdrücklich in Ordnung; ein großer Teil von Haben ist so entstanden. Der Transparenz halber wird es gekennzeichnet, mehr nicht:

- im Commit mit einer Zeile `Co-Authored-By: <Werkzeug oder Modell> <Adresse>`, wie sie die Werkzeuge meist selbst setzen;
- in der Beschreibung des Pull Requests mit einer Zeile wie „🤖 Generated with <Werkzeug>“.

Das ändert nichts am Review. Verantwortlich für den Inhalt bleibt, wer den Pull Request einreicht. Weitere Angaben, etwa ein Link zur Session, sind erlaubt, aber nicht nötig.

### Issues schreiben

Für neue Issues gibt es Formulare unter **Issues → New issue**: Fehler melden, Funktionswunsch, Steuerfall oder Format, Umzug aus einem anderen Programm, Frage oder Hinweis zur Doku (`.github/ISSUE_TEMPLATE/`). Ein leeres Issue bleibt möglich. Die Formulare sind kurz gehalten: Jedes Formular hat nur ein Pflichtfeld, damit sich auch Gelegenheitsnutzer melden. In keinem Issue stehen echte Belegdaten, Steuernummern, IBANs, Zugangsdaten oder Zertifikate; Beispiele nutzen erfundene Beträge, Dateien nur anonymisiert.

Wer ein Issue mit einem KI-Agenten schreibt oder ein größeres Vorhaben genau beschreiben will, folgt derselben Gliederung ausführlicher (Claude Code: Skill `issue-schreiben` in `.claude/skills/`):

| Abschnitt | Inhalt |
| --- | --- |
| Anlass | Was soll möglich sein, und warum? Ein Alltagsbeispiel mit erfundenen Beträgen. Bei Fehlern: Schritte, erwartet und tatsächlich, Meldung im Wortlaut, Haben-Version. |
| Stand in Haben | Was Haben heute tut, **auf dem aktuellen `main` geprüft**, mit Commit und Links auf Doku oder Code. Nicht aus dem Gedächtnis. |
| Vorschlag | Was sich ändern soll, bei Bedarf in Stufen. Grenzen nennen: was ausdrücklich nicht dazugehört. |
| Akzeptanzkriterien | Drei bis sechs prüfbare Punkte als `- [ ]`, zu denen ein Test oder ein Blick in die Oberfläche Ja oder Nein sagt. Bei Buchungen und Steuer: SKR03 und SKR04, Ist und Soll. |
| Bezug | Verwandte Issues und Pull Requests, Platz in der [Roadmap](roadmap.md), Primärquellen mit Link (Gesetz, BMF-Schreiben, Formularanleitung, Formatbeschreibung), bei Fremdprogrammen die Hilfe-Seite. Quellen aus früheren Pull Requests dürfen mit Link auf den Pull Request übernommen werden. |

Ein Issue behandelt ein Thema. Es ist so lang wie nötig und kurz genug für ein bis zwei Bildschirme; Quellcode steht als Link, nicht als Auszug. Fachliche Aussagen belegt eine Quelle, nicht ein Ratgeber. Wo etwas unsicher ist oder die Steuerberatung entscheiden muss, steht das ausdrücklich im Issue. Der Titel nennt das Ergebnis, nicht den Anlass. Vor dem Schreiben suchen Agenten auch in den Pull Requests (`gh pr list --state all --search …`), weil Erledigtes oft nur dort steht. Der Ist-Stand wird nach `git fetch origin` auf `origin/main` gelesen, der geprüfte Commit genannt und mit Permalinks (`https://github.com/firsttris/haben/blob/<commit>/<pfad>#L<n>`) belegt. Gibt es das Thema schon, bekommt der Nutzer den Fund gemeldet; ein Issue entsteht nur zum fehlenden Teil. Ein Issue, das ein Agent geschrieben hat (außer einer bloßen Korrektur), endet nach einer Trennlinie mit dem Hinweis auf das Werkzeug, z. B. `_Generated with [Claude Code](https://claude.com/claude-code)_`. Anlegen und Kommentieren tut ein Agent nur auf Anweisung des Nutzers; beim Anlegen kommt der Typ als Label dazu (`fehler`, `wunsch`, `steuer`, `umzug`, `frage`), weitere Labels und den Platz in der Roadmap setzt der Maintainer.

### Review

Jeder Pull Request bekommt vor dem Merge ein unabhängiges **TDD-Review**. Mit Claude Code gibt es dafür den Skill `tdd-review` (`.claude/skills/tdd-review/SKILL.md`); mit anderen Werkzeugen gelten dieselben Schritte:

1. **Unabhängig:** Wer den Code geschrieben hat, reviewt ihn nicht selbst. Ein KI-Agent, der am Code mitgeschrieben hat, startet für das Review einen neuen Agenten ohne diesen Verlauf.
2. **Nur mit rotem Test:** Jeder Verdacht wird ein Test im bestehenden Framework (Vitest, Postgres-Test neben dem Modul, Playwright für die Oberfläche). Nur ein Test, der auf dem Stand des Pull Requests fehlschlägt, ist ein Befund; der Rest wird verworfen. Stil und Namen sind kein Befund.
3. **Im Pull Request:** Befunde mit Testname und Ausgabe des roten Tests als Kommentar, auch wenn es keine gibt.
4. **Red → Green:** Test und Fix als eigene Commits obendrauf. Bestehende Tests werden nicht abgeschwächt, Sperren und Siegel nicht gelockert, Commits von Beitragenden nicht umgeschrieben. Fixes gehen direkt auf den Branch des Pull Requests (im Repo oder im Fork mit „Allow edits by maintainers“); geht das nicht, bitten wir darum, „Allow edits by maintainers“ einzuschalten, und nur als letzter Ausweg gibt es einen eigenen Pull Request. Ein Branch, der nur hinter `main` liegt, braucht vor dem Merge kein Update.
5. **Grün:** alle Prüfungen von oben lokal und in der CI, dann ein Abschlusskommentar mit den behobenen Befunden.
6. **Merge:** nur durch einen Maintainer, immer per **Squash** und immer der Pull Request selbst, auch bei Beiträgen. GitHub zeigt ihn dann als gemergt, der Commit trägt den Namen des Beitragenden, und `main` bleibt linear. Nur beim eigenen Ersatz-Pull-Request steht `Co-authored-by:` mit dem Beitragenden in der Commit-Nachricht.

Haben steht unter der AGPL-3.0.

[Zurück zur Übersicht](ueberblick.md)
