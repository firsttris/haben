# Entwicklung

Diese Seite richtet sich an alle, die an Haben mitarbeiten wollen: lokale Umgebung, Befehle, Tests, Migrationen, Konventionen im Code und typische Erweiterungen. Den Aufbau im Detail beschreibt [Architektur](architektur.md).

## Voraussetzungen

- Node.js 22 (`engines.node` verlangt mindestens 22)
- pnpm 10 (das Repository legt `pnpm@10.28.0` über `packageManager` fest; mit `corepack enable` bekommst du die passende Version)
- PostgreSQL 16, lokal oder als Container
- Optional: ein C-Compiler (`cc`) für die ERiC-Tests mit nachgebauter Bibliothek, Java 21 für den KoSIT-Validator

## Lokale Umgebung

```sh
git clone https://github.com/firsttris/haben.git
cd haben
pnpm install
cp apps/web/.env.example apps/web/.env
```

In `apps/web/.env` trägst du mindestens `DATABASE_URL`, `BETTER_AUTH_SECRET` und `HABEN_ENCRYPTION_KEY` ein (beide mit `openssl rand -base64 32`). `BETTER_AUTH_URL` bleibt `http://localhost:3000`. Alle Variablen erklärt [Betrieb und Installation](installation.md#umgebungsvariablen).

> [!NOTE]
> Leere Zeilen wie `ELSTER_HERSTELLER_ID=` gelten als nicht gesetzt. Ohne ERiC (`ERIC_HOME` oder unter Einstellungen geladen nach `ERIC_DIR`) arbeitet Haben mit dem simulierten ELSTER-Client, ohne `ANTHROPIC_API_KEY` ohne KI-Auslesung. Für die Entwicklung reicht beides.

Datenbank anlegen und Migrationen anwenden. Das Migrationsskript liest `DATABASE_URL` aus der Umgebung, nicht aus der `.env`-Datei:

```sh
createdb haben
export DATABASE_URL=postgres://haben:haben@localhost:5432/haben
pnpm db:migrate
pnpm dev            # http://localhost:3000
```

Belegdateien landen ohne weitere Angabe in `apps/web/data/belege` (`DOCUMENTS_DIR`, von Git ignoriert).

## Befehle

| Befehl | Was er tut |
| --- | --- |
| `pnpm dev` | Dev-Server der Web-App auf Port 3000 (Vite) |
| `pnpm build` | Baut alle Pakete, die ein `build`-Skript haben (praktisch `apps/web`) |
| `pnpm typecheck` | `tsc -p .` in jedem Paket |
| `pnpm lint` | ESLint über das ganze Repository |
| `pnpm test` | Alle Tests mit Vitest |
| `pnpm db:generate` | Migration aus Schemaänderungen erzeugen (drizzle-kit) |
| `pnpm db:migrate` | Ausstehende Migrationen anwenden |
| `pnpm --filter @haben/web start` | Gebaute App starten (`.output/server/index.mjs`) |
| `pnpm --filter @haben/einvoice kosit [ausgabeverzeichnis]` | Beispielrechnungen erzeugen und mit dem KoSIT-Validator prüfen |

## Tests

Die Tests laufen mit Vitest. `vitest.config.ts` sammelt alle `*.test.ts` unter `apps/*/src` und `packages/*/src` ein und führt die Dateien nacheinander aus, weil sich die Integrationstests eine Datenbank teilen.

```sh
pnpm test
TEST_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_test pnpm test
pnpm vitest run packages/core          # nur ein Bereich
```

Die Integrationstests in `apps/web/src/server` brauchen `TEST_DATABASE_URL`. Ohne die Variable werden sie übersprungen. Mit ihr löscht `apps/web/src/server/test-db.ts` die Schemas `public` und `drizzle` und wendet alle Migrationen neu an.

> [!IMPORTANT]
> `TEST_DATABASE_URL` niemals auf eine Datenbank mit echten Daten zeigen lassen. Die Tests leeren sie vollständig.

Die ERiC-Tests mit nachgebauter Bibliothek (`packages/elster/test-fixtures`) kompilieren eine kleine C-Bibliothek mit `cc`. Gibt es keinen Compiler, werden sie übersprungen.

Mit echtem ERiC prüft ein Kommando die Nachrichten von Belegabruf, Berechtigung und Postfach gegen die Schemas von ERiC, ohne zu senden (Exit-Code 1 bei Fehlern):

```sh
node --experimental-strip-types packages/elster/src/check-formats-cli.ts   # ERiC aus ERIC_HOME oder ERIC_DIR
```

| Bereich | Was getestet wird |
| --- | --- |
| `packages/core` | Beträge und Rundung, Rechnungssummen und Nummernformat, Zeiträume und Fälligkeit der Voranmeldung, Feiertage je Bundesland, Steuerfälle von Rechnungen, Steuernummer-Umrechnung, Kennzahlen der UStVA, Buchungssätze für SKR03/SKR04 und Ist/Soll, Zuordnungsvorschläge im Bankabgleich, EÜR, Umsatzsteuer des Lexoffice-Altbestands |
| `packages/elster` | UStVA-XML (Kopf, Kennzahlen, Testmerker, Kz 10), XML der Umsatzsteuererklärung, der Anlage EÜR mit AVEÜR und der Sonstigen Nachricht, Transfer-Ticket, simulierter Client, Kindprozess (Zertifikat mit `0600`, Timeout, Absturz), Mock-ERiC über koffi und ERiC-Download (Entpacken nur Linux, Umschalten erst bei vollständiger Version, Pfade im Archiv) |
| `packages/einvoice` | Rechnungs-PDF (PDF/A-3b), ZUGFeRD und XRechnung (CII, UBL) inklusive Storno und Leitweg-ID, Pflichtangaben je Format, Einlesen fremder E-Rechnungen und eingebetteter XML |
| `packages/import` | DKB- (neu und alt), N26- und CAMT.053-Parser, Deduplizierung, Saldenprüfung, DATEV-Buchungsstapel, Lexoffice-API-Client (Paging, 429, Fehler) und Abbildung der Lexoffice-Daten |
| `apps/web` ohne DB | Umwandlung der KI-Auslesung in Felder und Beträge |
| `apps/web` mit DB | Rechnungen festschreiben und sperren, Belege hochladen und buchen, Bankimport und Zuordnung, Voranmeldung (Entwurf, Test, Echt, Berichtigung, Audit-Log) und Berechnung aus Buchungen, Auswertungen, Jahresexport, Lexoffice-Übernahme und offene Posten |

### KoSIT-Validator

Der CI-Job `kosit` erzeugt mit `packages/einvoice/scripts/kosit-check.ts` Beispielrechnungen in allen Formaten (19 %, gemischte Sätze, Storno, Korrektur, Leitweg-ID, nur Steuernummer, Nullsatz, Reverse Charge, Drittland, steuerfrei, Kleinunternehmer) und prüft sie mit dem KoSIT-Validator und der XRechnung-Konfiguration. Lokal brauchst du Java 21 sowie den Validator und die Konfiguration von GitHub (`itplr-kosit/validator`, `itplr-kosit/validator-configuration-xrechnung`; welche Versionen CI nutzt, steht in `.github/workflows/ci.yml`):

```sh
KOSIT_JAR=/pfad/validationtool-1.5.0-standalone.jar \
KOSIT_CONFIG=/pfad/scenarios.xml \
pnpm --filter @haben/einvoice kosit /tmp/haben-kosit
```

Ohne die Variablen sucht das Skript unter `/var/tmp/kosit/`.

### Ende-zu-Ende-Tests mit Playwright

`apps/web/e2e/app.spec.ts` spielt den Betrieb in einer leeren Datenbank durch:
1. Konto und Firmendaten einrichten.
2. Kunden anlegen.
3. Rechnungen schreiben und festschreiben.
4. Einen Beleg hochladen und buchen. Das Belegbild entsteht im Test, mit erfundenen Daten.
5. Einen Kontoauszug importieren und die Umsätze zuordnen.
6. Prüfen, dass Kennzahlen und Salden unter **Konten** dazu passen, und den Filter im Journal testen.

Zum Schluss lädt der Test jede Seite am Desktop (1440 px) und am Handy (390 px) und prüft dabei:
- Die Seite antwortet ohne Fehler und hat eine Überschrift.
- Im Browser tritt kein Fehler auf, auch kein Hydration-Fehler.
- Am Handy ist die Seite nicht breiter als der Bildschirm.
- Das Handy-Menü lässt sich öffnen und bedienen.

Von jeder Seite legt der Test einen Screenshot unter `apps/web/test-results/screenshots/{desktop,mobil}/` ab.

```sh
createdb haben_e2e            # einmalig; der Name muss auf „e2e“ enden, die Datenbank wird bei jedem Lauf geleert
E2E_DATABASE_URL=postgres://haben@localhost:5432/haben_e2e pnpm e2e
```

Playwright startet selbst einen Server auf Port 3100 (`E2E_PORT`). Vorher leert es die Datenbank und spielt die Migrationen ein. Lokal ist das der Entwicklungsserver, in der CI der gebaute Server (`E2E_SERVER_COMMAND="node .output/server/index.mjs"` nach `pnpm build`). Chromium kommt einmalig mit `pnpm --filter @haben/web exec playwright install chromium`. Wer schon ein passendes Chromium hat, setzt stattdessen `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

In der CI läuft der Job `e2e` bei jedem Pull Request. Screenshots, Playwright-Bericht und bei Fehlern Traces hängen als Artefakt `e2e-screenshots` am Lauf. So sieht man zu jeder Änderung, wie alle Seiten aussehen.

## Migrationen

Das Schema steht in `apps/web/src/server/db/schema.ts`, die Migrationen in `apps/web/drizzle/`.

1. Schema anpassen.
2. `pnpm db:generate` erzeugt die SQL-Migration und den Snapshot in `drizzle/meta/`.
3. `pnpm db:migrate` wendet sie lokal an. Im Container passiert das beim Start automatisch.

Trigger und Funktionen (Festschreibung, Versionierung, Audit-Log) kann drizzle-kit nicht aus dem Schema ableiten. Sie stehen in eigenen SQL-Migrationen, z. B. `0001_festschreibung.sql`, `0003_rechnungen_trigger.sql` oder `0010_lexoffice_trigger.sql`. Eine leere Migration dafür legst du so an und schreibst das SQL von Hand hinein:

```sh
pnpm --filter @haben/web exec drizzle-kit generate --custom --name=mein_trigger
```

Bestehende Migrationen änderst du nicht; sie sind auf laufenden Installationen schon angewendet.

## Konventionen

- **Geld in ganzen Cent** (`Cents`), nie als Gleitkommazahl. Parser rechnen Dezimaltext direkt in Cent um.
- **Steuersätze in Basispunkten** (`BasisPoints`): 1900 = 19 %, 700 = 7 %.
- **Mengen in Tausendsteln**: 152 Stunden = 152000, 0,5 Tage = 500.
- **Imports mit `.ts`-Endung** (`allowImportingTsExtensions`). Der ERiC-Worker und das Migrationsskript laufen per Type Stripping direkt aus den Quellen.
- **Oberfläche auf Deutsch**, auch Fehlermeldungen, die beim Nutzer ankommen.
- **Unveränderlichkeit (GoBD) in der Datenbank:** Festgeschriebene Rechnungen, Buchungen, gesendete Voranmeldungen, Bankumsätze und übernommene Lexoffice-Daten sperren Postgres-Trigger gegen `UPDATE` und `DELETE`. Korrekturen sind neue Datensätze (Storno, Gegenbuchung, berichtigte Anmeldung). Beim Festschreiben einer Buchung prüft ein Trigger Soll = Haben.
- **Audit-Log:** Änderungen laufen über `withActor` (`apps/web/src/server/db/actor.ts`), damit der Trigger sie dem Nutzer zuschreibt.
- **Server-Funktionen bleiben dünn:** In `apps/web/src/server/functions/` hängt jede Funktion mit Daten `authMiddleware` an, validiert die Eingabe mit Zod und ruft die Logik in `apps/web/src/server/*.ts` auf. Fachlogik ohne Datenbank gehört nach `packages/core`.
- **ERiC nie im App-Prozess:** Jeder Aufruf geht über einen kurzlebigen Kindprozess (`packages/elster/src/worker.ts`).

## Projektstruktur

| Pfad | Inhalt |
| --- | --- |
| `apps/web/src/routes` | Seiten (TanStack Router) und API-Routen unter `api/` |
| `apps/web/src/server` | Serverlogik je Bereich, `db/` mit Schema und Migrationsskript, `functions/` mit den Server-Funktionen |
| `apps/web/src/components`, `lib` | React-Komponenten, Auth-Client, Formatierung |
| `apps/web/drizzle` | SQL-Migrationen |
| `packages/core` | Beträge, Zeiträume, Steuernummer, UStVA, Buchungssätze, EÜR, Zuordnungsvorschläge |
| `packages/elster` | ERiC-Anbindung, XML für Voranmeldung und Jahreserklärungen, Worker |
| `packages/import` | Kontoauszugs-Parser, Deduplizierung, DATEV, Lexoffice-Client |
| `packages/einvoice` | Rechnungs-PDF mit Typst, E-Rechnung erzeugen und lesen |
| `deploy` | Quadlets, Caddyfile, Backup- und Startskript |

## Neues Bankformat

Die Parser liegen in `packages/import/src/`.

1. Eigene Datei anlegen, z. B. `meinebank.ts`, mit einer Erkennungsfunktion für die Kopfzeile (`isMeinebankHeader`) und einem Parser, der ein `ParsedStatement` liefert. `dkb.ts` und `n26.ts` sind gute Vorlagen; Hilfen für Beträge, Datum und IBAN stehen in `text.ts`, `table.ts` und `common.ts`.
2. Das Format in `StatementFormat` in `types.ts` ergänzen.
3. In `parse.ts` die Erkennung in `detect()` und den Fall in `parseStatement()` eintragen. Erkannt wird am Inhalt, nicht am Dateinamen.
4. Eine anonymisierte Beispieldatei unter `packages/import/test-fixtures/` ablegen und Tests in `parse.test.ts` ergänzen, auch für die Deduplizierung.

Das Format wird als Text in `bank_imports.format` gespeichert; eine Migration ist dafür nicht nötig. Liefert die Datei keine eigene IBAN, muss das Konto vor dem Import angelegt werden (wie bei N26).

## Neue Ausgabenkategorie

Die Kategorien stehen in `EXPENSE_CATEGORIES` in `packages/core/src/posting.ts`, je mit Bezeichnung und Aufwandskonto für SKR03 und SKR04. Ein neuer Eintrag erscheint automatisch in der Auswahl am Beleg, in der Anweisung für die KI-Auslesung, im Journal und in der EÜR. Die Kategorie steht als Text am Beleg, eine Migration ist nicht nötig. Für übernommene Lexoffice-Belege kannst du in `apps/web/src/server/legacy-open.ts` (`CATEGORY_HINTS`) ein Suchmuster ergänzen. Die Kontonummern stimmst du mit der Steuerberatung ab.

## Veröffentlichen

Images baut der Workflow `.github/workflows/release.yml`: die CI liegt hier, Image, Docker-Hub-Beschreibung und GitHub-Release kommen aus dem gemeinsamen [`docker-release.yml`](https://github.com/firsttris/workflows) in `firsttris/workflows`. Ein Tag `vX.Y.Z` veröffentlicht eine Version:

1. Der Tag muss zu `version` in der `package.json` im Wurzelverzeichnis passen.
2. Die komplette CI läuft (Lint, Typecheck, Tests, Build, KoSIT, Container-Test).
3. Das Image wird für `linux/amd64` und `linux/arm64` gebaut und als `:x.y.z`, `:x.y` und `:latest` nach Docker Hub (`tristanteu/haben`) und GHCR (`ghcr.io/firsttris/haben`) geschoben. Die README landet mit absoluten Links als Beschreibung auf Docker Hub.
4. Erst danach entsteht das GitHub-Release mit erzeugten Notizen.

Den Tag legt einer von zwei Wegen an, nach demselben Schema wie in den anderen Projekten:

- ohne Checkout: Actions → *Bump version* → patch, minor oder major (`bump.yml`). Erhöht die Version in der `package.json`, committet sie als `Release vX.Y.Z` auf `main`, taggt und startet `release.yml` auf dem Tag.
- lokal:

```sh
pnpm release:patch   # oder :minor, :major: erhöht die Version, legt Commit und Tag an und pusht beides
```

Von Hand gestartet (Actions → Release → Run workflow) laufen auf `main` dieselben Prüfungen, danach wird nur `:edge` veröffentlicht, ohne Release.

Der Workflow braucht das Repository-Secret `DOCKER_PAT`, ein Docker-Hub-Zugriffstoken mit Schreibrecht für `tristanteu/haben`. Für GHCR reicht das eingebaute `GITHUB_TOKEN`; das Paket ist nach dem ersten Push privat und muss einmal in den Paket-Einstellungen auf öffentlich gestellt werden.

## Mitwirken

Vor einem Pull Request bitte dieselben Prüfungen wie in CI laufen lassen:

```sh
pnpm lint
pnpm typecheck
TEST_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_test pnpm test
pnpm build
```

- Neue Fachlogik mit Tests, Änderungen an Buchungen oder Steuerberechnung mit Testfällen für SKR03 und SKR04 sowie Ist und Soll.
- Schemaänderungen mit erzeugter Migration; Trigger in einer eigenen SQL-Migration.
- Änderungen an der E-Rechnung prüft der KoSIT-Job in CI.
- Texte in der Oberfläche auf Deutsch.

Haben steht unter der AGPL-3.0.

[Zurück zur Übersicht](../README.md)
