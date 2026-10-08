# Code-Review Haben

Stand: 8. Oktober 2026, Commit `939be02` (v0.1.2). Geprüft wurden alle vier Pakete, die Web-App (Dienste, Server Functions, API-Routen, React-Seiten), Schema und Migrationen, Deploy und CI.

**Ausgangslage:** `pnpm lint` und `pnpm typecheck` sind sauber. `pnpm test` läuft mit Datenbank (PostgreSQL 16) komplett grün: 84 Testdateien, 580 Tests bestanden, 2 übersprungen (ERiC-Mock ohne C-Compiler).

**Gesamtbild:** Das Projekt ist für seinen Umfang (ca. 41.000 Zeilen) ungewöhnlich sauber. Die Grundentscheidungen tragen: ganze Cent, Fachlogik ohne I/O in `packages/core`, GoBD-Sperren per Trigger, Audit-Log aus der Transaktion, ERiC im Kindprozess, dateibasierte Ablage unter SHA-256. Die Autorisierung ist lückenlos (127 von 128 Server Functions mit `authMiddleware`, die eine Ausnahme bewusst öffentlich). Die unten aufgeführten Fehler sind fast alle Randfälle, Nebenläufigkeit oder Jahreswechsel. Drei Themen stechen heraus und sollten vor dem nächsten Release angegangen werden:

1. **Fehler leaken SQL, Bind-Parameter und Stacktrace in den Browser** (Abschnitt 2.1). Ein zentraler Fehlerübersetzer löst das und entfernt zugleich 16 Kopien von `asUserError`.
2. **Festgeschriebene Buchungen sind per `UPDATE journal_lines SET entry_id` entkernbar**, und der App-Nutzer ist Postgres-Superuser (Abschnitt 1.1, 2.2). Die GoBD-Garantie steht damit nur gegen Versehen, nicht gegen jemanden mit `DATABASE_URL`.
3. **Echtübermittlungen an ELSTER ohne Sperre** (UStVA und Jahreserklärung). Ein Doppelklick kann zweimal senden, und ein DB-Fehler nach dem Senden verliert den Nachweis (Abschnitt 1.1).

Legende: **Hoch** = fachlich oder rechtlich falsches Ergebnis bzw. Datenverlust möglich. **Mittel** = Fehler unter realistischen Bedingungen, begrenzte Wirkung. **Niedrig** = Robustheit, Konsistenz, Wartbarkeit. Mit ✔ markierte Befunde habe ich zusätzlich zum Review-Agenten selbst im Code nachgeprüft.

---

## Umsetzung

Alle Befunde wurden vor dem Fix im Code nachgeprüft und minimal behoben; Verhalten ist mit Tests belegt (neu u. a. Trigger-Negativtests, Race-Tests für Storno, Abschlag, Echtsendung, Mahnstufe und Lexoffice-Start, defektes ERiC-Archiv, Dekompressionslimit, DATEV-Spaltenzahl). Stand nach der Umsetzung: Lint und Typecheck sauber, 634 Tests grün (2 übersprungen), Build ok, E2E 21 von 21.

**Behoben** sind alle Punkte der Top-12-Liste und die übrigen Befunde aus 1.1 bis 6 und Anhang A, mit diesen Ausnahmen:

| Befund | Entscheidung |
|---|---|
| App-Rolle ist Superuser | Nicht umgebaut. Selbst gehostete Einnutzer-Installation, der Betreiber hat ohnehin Root auf dem Host; die Trigger schützen gegen Versehen und Programmfehler. Doku in `architektur.md` und `buchhaltung.md` präzisiert. |
| Testmerker Postfach (700000004 vs. 370000001) | Offen. Einzige erreichbare Quelle ist inoffiziell (digitalservicebund/erica: Datenabholung 370000001). Vor einer Änderung im ERiC-Entwicklerhandbuch prüfen. |
| E0200204 mit Cent | Offen, keine öffentliche Feldbeschreibung gefunden. |
| AES-GCM ohne AAD und Key-Version | Nicht umgebaut: bestehende Chiffrate wären ohne Datenmigration unlesbar; GCM mit zufälligem IV ist korrekt. |
| `text` statt `date` (Bescheiddatum, BRM-Fristen) | Bleibt: Rohdaten aus ELSTER, ein strengerer Typ könnte den Nachweis einer erfolgten Übermittlung verwerfen. |
| CHECK `gross = net + tax`, `quantity > 0` | Befund falsch: § 13b (brutto = netto) und Stornos (negative Mengen). Übernommen nur die sicheren CHECKs und FKs, jeweils `NOT VALID`. |
| Archiv-Abgleich O(n·m) | Befund übertrieben: Postgres plant einen Hash Anti Join (20.000 × 5.000 Zeilen in 45 ms). |
| BT-10 fällt auf Rechnungsnummer zurück | Zulässig nach BR-DE-15; für XRechnung verlangt `validate.ts` Leitweg-ID oder E-Mail. |
| E-Rechnungs-XML sprachabhängig | Bleibt deutsch, wie die übrigen Freitextfelder im XML. |
| SHA-Pinning der Actions, KoSIT-Prüfsumme | Nicht gemacht (kein Netz-Lookup); `firsttris/workflows` gehört demselben Besitzer. Top-level `permissions` ergänzt. |
| Graceful Shutdown | Nitro/srvx beendet bei SIGTERM schon geordnet; Scheduler-Läufe sind idempotent. |
| Protokoll vor Mailversand, verwaiste ERiC-Temp-Verzeichnisse | Bräuchte Schemaänderung bzw. Lock-Logik beim Start; Nutzen zu gering. |
| `openItems` in SQL, `invoiceSummary` als Aggregat, 12 Aufrufe in `ustYear` | Größerer Umbau ohne messbaren Bedarf; die Indizes sind gesetzt. |
| Positions-Editor teilen, Duplikate `quotes.ts`/`invoices.ts`, `bank.tsx` aufteilen, Postfach/VaSt im gemeinsamen Sendepanel | Varianten weichen fachlich ab; zusammengelegt würde es nicht kürzer. Gemeinsam sind jetzt `useAction`, `NoticeBanner`, `ElsterSubmit`, Formate und Titel. |
| `as`-Casts für `unit`/`taxRate`, Namenskonventionen in `functions/`, Hardware-Sonderfall in `euer.ts` | Reine Churn bzw. neue Struktur nötig. |

---

## Top 12 nach Dringlichkeit

| # | Bereich | Befund | Schwere |
|---|---|---|---|
| 1 | Server Functions | Rohe Fehler (Drizzle: `Failed query: <SQL> params: <…>`) werden von TanStack Start serialisiert und an den Browser geschickt ✔ | Hoch |
| 2 | Trigger | `journal_lines`/`document_amounts`: UPDATE auf einen neuen Elternschlüssel umgeht die Sperre ✔ | Hoch |
| 3 | Deploy | App-Rolle = Superuser und Owner, kann Trigger abschalten ✔ | Hoch |
| 4 | vat.ts / annual.ts | Echtübermittlung ohne Sperre, Protokoll erst nach dem externen Aufruf ✔ | Hoch |
| 5 | invoices.ts | Storno/Korrektur: Prüfungen außerhalb der Transaktion, Doppelstorno und doppelte Minderung möglich ✔ | Hoch |
| 6 | core/dunning.ts | 40-Euro-Pauschale wird zur Mahngebühr addiert statt angerechnet (§ 288 Abs. 5 S. 3 BGB) ✔ | Hoch |
| 7 | annual.ts / settings-guard.ts / datev-export.ts | Kontenrahmen aus `company` statt aus den Buchungen des Jahres; Jahreswechsel-Sperre greift zu früh ✔ | Hoch |
| 8 | import/datev-export.ts | Header deklariert Formatversion 13, Datei hat 120 statt 125 Spalten ✔ (Spaltenzahl) | Hoch |
| 9 | elster/install.ts | Defektes ERiC-Archiv erzeugt unhandled rejection, beendet den Server (reproduziert) | Hoch |
| 10 | deploy/backup.sh | `pg_dump \| gzip` ohne `pipefail`: leeres Backup gilt als Erfolg ✔ | Hoch |
| 11 | belege/$id.tsx | Nutzungsdauer „2,5“ wird zu NaN, Server meldet „fehlt“ | Hoch |
| 12 | auswertungen.tsx | Banner behauptet, AfA sei nicht in der EÜR; sie ist es | Hoch |

---

## 1. Korrektheit

### 1.1 Hoch

**Trigger: Kindzeilen lassen sich aus festgeschriebenen Buchungen herausziehen ✔**
`apps/web/drizzle/0003_rechnungen_trigger.sql:44-57` (`haben_reject_locked_journal_line`) und `0005_belege_trigger.sql:3-17` (`haben_reject_locked_document_amount`) prüfen bei UPDATE nur `NEW.entry_id` bzw. `NEW.document_id`. `UPDATE journal_lines SET entry_id = <ungesperrt> WHERE entry_id = <gesperrt>` wird akzeptiert; die gesperrte Buchung steht danach leer und unausgeglichen da. Die Variante für `invoice_lines` (Zeile 27-41) prüft korrekt OLD und NEW.
Fix: OLD-Elternschlüssel mitprüfen oder den Wechsel des Elternschlüssels bei UPDATE ganz verbieten. Dazu `haben_check_journal_balance` (Zeile 60-76) auch bei INSERT mit gesetztem `locked_at` laufen lassen oder als `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` anlegen.

**ELSTER-Echtübermittlung ohne Sperre und ohne Nachweis-Garantie ✔**
`apps/web/src/server/vat.ts:223-229, 258-293` (`submitReturn`) und `annual.ts:423-429, 489-504` (`submitAnnual`): Status wird ohne Sperre gelesen, dann läuft der ERiC-Kindprozess (Sekunden), erst danach wird geschrieben. Zwei parallele Requests senden beide echt; der zweite Schreibvorgang scheitert am Sperr-Trigger bzw. Unique-Index, und Transferticket, Request-XML und Protokoll-PDF dieser real erfolgten Übermittlung sind weg. Gleiches gilt bei einem DB-Fehler nach dem Senden.
Fix: Vor dem ERiC-Aufruf `pg_advisory_xact_lock` auf die Return-ID bzw. (Formular, Jahr), oder eine „pending“-Zeile einfügen, die der Unique-Index schützt. Bei Fehler beim Protokollieren Transferticket und XML wenigstens ins Log schreiben.

**Storno und Korrektur nicht gegen Nebenläufigkeit gesichert ✔**
`apps/web/src/server/invoices.ts:596-608` (`finalOriginal`) prüft „bereits storniert“ außerhalb jeder Transaktion; `finalizeInvoice` (Zeile 526-530) prüft bei `correctsId` nur `corrects.number`. Zwei parallele Stornos erzeugen zwei Stornorechnungen mit zwei Nummern. Auch ohne Race: Korrektur-Entwurf anlegen, Original stornieren, Korrektur festschreiben ergibt eine doppelte Minderung (Zeile 649-668). Dasselbe Muster bei Abschlägen: `deductionProblems` (Zeile 183-211) läuft nur vor der Transaktion, ein Abschlag ist zweimal abziehbar. Die UI hat Zweiklick und `disabled`, der Server verlässt sich darauf.
Fix: Original und Abschlagsrechnungen in `finalizeInvoice` mit `FOR UPDATE` sperren und den Zustand in der Transaktion erneut prüfen. Partieller Unique-Index `(corrects_id) WHERE kind = 'storno' AND status = 'final'`.

**Mahnwesen: Pauschale wird addiert statt angerechnet ✔**
`packages/core/src/dunning.ts:83`: `total = open + fee + flatFee + interest`. Nach § 288 Abs. 5 Satz 3 BGB ist die 40-Euro-Pauschale auf Rechtsverfolgungskosten (Mahngebühren) anzurechnen. Bei 1.000 € offen, 10 € Gebühr und Pauschale fordert die Mahnung 1.050 € statt zulässiger 1.040 €. `dunning.test.ts:19-27` fixiert die Doppelzählung.
Fix: `kosten = flatFee ? Math.max(fee, LATE_PAYMENT_FLAT_FEE) : fee` und in der Mahnung als „Mahngebühr, angerechnet auf Pauschale“ ausweisen.

**Kontenrahmen und Jahreswechsel ✔**
Drei zusammenhängende Stellen:
- `apps/web/src/server/annual.ts:200-218` (`privateMovements`) sucht Entnahmen und Einlagen mit den Konten des *aktuellen* Firmen-Kontenrahmens, obwohl `journal_entries.kontenrahmen` (`schema.ts:744`) je Buchung gespeichert ist. Nach einem erlaubten Wechsel SKR03 → SKR04 stehen Entnahmen und Einlagen in der Anlage EÜR des Vorjahres mit 0, ohne Hinweis.
- `settings-guard.ts:20-26` zählt nur Buchungen ab dem 1. Januar des laufenden Jahres. AfA wird auf den 31.12. des Vorjahres gebucht (`assets.ts:351`), Dezember-Belege auf ihr Belegdatum. Wer am 2. Januar wie empfohlen umstellt, bucht die Abschlussarbeiten des Altjahrs im neuen Kontenrahmen.
- `datev-export.ts:60-62` verlangt, dass alle Buchungen des Jahres dem aktuellen Kontenrahmen entsprechen. Das Vorjahr ist nach dem Wechsel nie mehr exportierbar.
Fix: Kontenrahmen aus den Buchungen des Jahres ableiten (`select distinct kontenrahmen … where date in year`), bei gemischten Rahmen eine Fehlermeldung. Sperre erst freigeben, wenn das Vorjahr abgeschlossen ist (AfA gebucht, keine ungebuchten Vorjahresbelege).

**DATEV-Export: Spaltenzahl passt nicht zur Formatversion ✔ (Spaltenzahl)**
`packages/import/src/datev-export.ts:97-128`: Kopfzeile deklariert Buchungsstapel Version 13, `DATEV_COLUMNS` hat 120 Spalten und endet mit „Land“. Das entspricht Version 9. Version 13 hat nach der DATEV-Spezifikation 125 Spalten (Abrechnungsreferenz, BVV-Position, EU-Mitgliedstaat u. UStID (Ursprung), EU-Steuersatz (Ursprung), Abw. Skontokonto). DATEV liest nach Position und prüft die Spaltenzahl gegen die Version. Die genaue Spezifikation konnte ich hier nicht gegenlesen, der Widerspruch im Code ist aber eindeutig.
Fix: Fünf Spalten ergänzen und `DATEV_COLUMNS.length === 125` im Test festnageln, oder Version 9 deklarieren.

**ERiC-Installation: defektes Archiv beendet den Server**
`packages/elster/src/install.ts:187-201, 211`: Bei einem korrupten Download ruft fflate `ondata(error)`, der Code zerstört den WriteStream und wirft in der Leseschleife, bevor `Promise.all(writes)` erreicht wird. Das Promise in `writes` rejected ohne Handler. Der Agent hat es reproduziert (`UNHANDLED REJECTION: invalid distance`). `installEric` läuft in `elster.ts:71` als Hintergrund-Promise im Serverprozess; Node beendet den Prozess bei unhandled rejection. Zusätzlich bleiben offene Streams ohne `destroy()` (FD-Leck) und das Verzeichnis `ERiC-<v>.neu` liegen.
Fix: `Promise.allSettled` bzw. `writes` mit `.catch(() => {})` entkoppeln, im Fehlerfall alle Streams `destroy()`, `fresh` aufräumen.

**Backup kann stillschweigend leer sein ✔**
`deploy/backup.sh:4,7`: `#!/bin/sh` mit `set -eu`, kein `pipefail`. `podman exec haben-db pg_dump … | gzip > "$dump"` liefert den Exit-Code von gzip. Scheitert `pg_dump`, wird ein leeres Archiv erfolgreich in restic gesichert. `restore.sh:33-35` löscht die Datenbank, bevor der Dump geprüft ist, und pipt ebenfalls ohne `pipefail`.
Fix: `#!/bin/bash` + `set -euo pipefail`, `gunzip -t "$dump"`, Mindestgröße prüfen. Restore erst in eine temporäre Datenbank einspielen und bei Erfolg umbenennen.

**Frontend: Nutzungsdauer mit Komma geht verloren**
`apps/web/src/routes/_app/belege/$id.tsx:245`: `Number(assetYears) > 0` wird geprüft, erst danach `replace(",", ".")`. Eingabe „2,5“ (deutsche Tastatur, `inputMode="decimal"`) ergibt NaN und `usefulLifeMonths: null`; der Server meldet „Nutzungsdauer fehlt“. `AssetForm.tsx:77` macht es richtig.
Fix: gemeinsame `parseYears()`.

**Frontend: Falsche fachliche Aussage in den Auswertungen**
`apps/web/src/routes/_app/auswertungen.tsx:63-66`: Banner behauptet, Anschaffungen über 800 € netto würden nicht abgebildet und Hardware zähle voll im Jahr der Zahlung. `reports.ts:160` übergibt `depreciationForEuer(year)` an `computeEuer`; AfA, GWG und Sammelposten sind enthalten. Der Nutzer wird über seine eigenen Gewinnzahlen falsch informiert.
Fix: Banner entfernen.

### 1.2 Mittel

| Datei | Befund | Fix |
|---|---|---|
| `server/bank.ts:482-492` ✔ | Beleg-Zuordnung liest den Beleg ohne `FOR UPDATE` (Rechnung in Zeile 445 korrekt gesperrt). Trigger prüft nur je Umsatz. Zwei gleichzeitige Zuordnungen überzahlen den Beleg. | `.for("update")` |
| `server/auth.ts:28-33` | Setup-Race: `before`-Hook zählt Nutzer ohne Sperre. Zwei parallele Sign-ups auf frischer Instanz legen zwei Konten an. | `CREATE UNIQUE INDEX user_single ON "user" ((true))` |
| `server/storage.ts:17-34` | `writeFile` + `rename` ohne `fsync`. Nach einem Crash kann die Datei leer sein; `loadFile` meldet dauerhaft „beschädigt“, `storeFile` heilt nicht, weil es bei `stat`-Treffer sofort zurückkehrt. | `fh.sync()`, Verzeichnis syncen; bei Treffer Hash prüfen, bei Abweichung überschreiben |
| `server/documents.ts:406-416` | `deleteDocument` prüft Mitnutzung nur gegen `archive_files` und `lexoffice_voucher_files`, nicht `postfach_documents`. Ein versehentlich als Beleg hochgeladener Bescheid verliert beim Löschen seine Datei. | zentrales `fileInUse(sha256)` in storage.ts |
| `core/money.ts:78`, `core/posting.ts:284` | `splitPrivateShare` und `paidTaxShares` nutzen `Math.round`, das negative Halbe nach +∞ rundet; `taxOf`/`lineNet` runden symmetrisch. Beleg und Storno heben sich um 1 Cent nicht auf (12,34 € mit 25 % privat: 9,25/3,09 gegen 9,26/3,08). | `roundHalfAwayFromZero` zentral in money.ts |
| `core/income-tax.ts:202-207, 226` | Altersvorsorgeaufwendungen ohne Höchstbetrag (§ 10 Abs. 3 EStG: 2025 29.344 €, Zusammenveranlagung doppelt). Steuerprognose und Vorauszahlungen zu niedrig. | Höchstbetrag je Jahr in `Tarif` |
| `server/recurring.ts:276-296` | Nur `InvoiceError`/`MailError` werden je Vorlage gefangen. Ein `ZodError` (ungültige Kontakt-E-Mail) bricht den ganzen Lauf ab, Folgevorlagen bleiben eine Stunde liegen. | try/catch je Vorlage, Fehler in `lastError` |
| `server/inbox.ts:328-329` | `getMailboxLock` wirft (falscher Ordner), kein `logout`. IMAP-Verbindung bleibt bis zum Socket-Timeout offen, stündlich wiederholt. | try/catch mit `client.logout()` |
| `server/lexoffice.ts:104-122, 126-131` | `startImport` ohne Sperre (zwei Läufe); zweiter Fehler in `finish()` ist eine unhandled rejection. | Partial-Unique-Index `status = 'laeuft'`; äußeres `.catch` |
| `elster/postfach.ts:70` vs. `vast.ts:16`, `berechtigung.ts:48` | Testmerker-Widerspruch für dasselbe Verfahren ElsterDatenabholung: Postfach `700000004`, Belegabruf und BRM `370000001`. Einer ist falsch. | gegen ERiC-Doku klären, eine Konstante je Verfahren |
| `einvoice/embedded.ts:110-120` | Eingebettete PDF-Streams ohne Dekompressionslimit. 20-MB-Upload mit Deflate 1000:1 kann mehrere GB anfordern. | `inflateSync(…, { maxOutputLength })`, `/Params /Size` prüfen |
| `import/common.ts:56-73`, `dkb.ts:118` | `applyStatedBalance` vor `finish()`: Ohne Von/Bis (neues DKB-Format) ist `periodTo` undefined, der Saldo vom Stichtag wird dem ersten Buchungstag zugeschrieben, nächster Import meldet falsche Lücke (reproduziert). | ohne Zeitraum `periodTo = stated.date` |
| `routes/_app/jahreserklaerung/$jahr.tsx:570-620` | `SubmitPanel`: Checkbox zeigt `testOnly \|\| !canSendLive`, gesendet wird `testOnly ? "test" : "send"`. Nach der Echtsendung geht „testweise senden“ als `send` raus und scheitert verwirrend. `finanzamt.tsx:391` rechnet korrekt `live = !testOnly && canSendLive`. | gleiche Logik, besser gemeinsame Komponente (siehe 3.) |
| `routes/_app/finanzamt.tsx:249` | `MessageForm key={betreff\|text}` remountet bei jeder Textänderung; PIN, Test-Schalter und Statusmeldung gehen verloren. | Text als abgeleiteter Default, Zustand hochziehen |
| `routes/_app/bank.tsx:459-466` | `SearchBox` synchronisiert nicht mit `initial`; Konto-Tab-Wechsel löst doppelten Loader aus, Suche klebt am neuen Konto. | `key={initial}` oder Effekt |
| `routes/_app/index.tsx:364-373` | `key={todo.title}`: zwei Bescheide desselben Jahres ergeben doppelte Keys. | stabile IDs |
| `components/InvoiceEditor.tsx:338-342` | „Entwurf löschen“ ohne Zweiklick, während alle anderen destruktiven Aktionen ihn haben. | `confirmingDelete` |
| `components/archiv/Migration.tsx:94-102`, `kontakte/$id.tsx:31-37` | `onRemove`, `cancel`, Archivieren ohne `catch`/`busy`: stille Fehler, Doppelklick möglich. | gemeinsamer `useAction`-Hook (siehe 5.) |

---

## 2. Sicherheit

### 2.1 Fehler leaken Interna in den Browser (Hoch) ✔
`apps/web/src/server/functions/*` werfen jeden nicht als Fachfehler erkannten Fehler roh weiter (16 Kopien von `asUserError`, 3 von `rethrow`, 3 Inline-Varianten). TanStack Start (`start-server-core/dist/esm/server-functions-handler.js:89-104`) serialisiert im `catch` den kompletten Fehler mit `toCrossJSONAsync` und schickt ihn als HTTP 500 an den Client, inklusive eigener Properties und Stack. Drizzle (`drizzle-orm/errors.js`) baut `DrizzleQueryError` mit `Failed query: <SQL>\nparams: <alle Bind-Parameter>` und `cause` = PostgresError. Die UI zeigt `error.message` 1:1 (`lib/format.ts:19-21`). Folge: SQL, Bind-Parameter (IBANs, Chiffrate), Server-Dateipfade im Browser. Auch `UnauthorizedError` aus `middleware.ts:15` geht so raus: Stacktrace an Unangemeldete, Status 500 statt 401. Auslöser ohne Angreifer: Race in `createAccount` (`bank.ts:52-54`, Unique auf IBAN), DB-Abbruch, vergessene Catches (`archive.ts:155`, `contacts.ts:39`, `articles.ts:19`, `quotes.ts:82`). Zod-Fehler zeigen in Zod 4 außerdem JSON der Issues als Meldung.
Fix: Basisklasse `UserError` für alle Fachfehler und ein zentraler Übersetzer in `authMiddleware` oder einem `authedFn`-Helfer: `UserError` → `Error(message)`, `ZodError` → Issue-Texte, `UnauthorizedError` → `setResponseStatus(401)`, alles andere → `console.error` + „Interner Fehler“.

### 2.2 App-Rolle ist Superuser und Owner (Hoch) ✔
`deploy/compose.yml:17-19, 34`, `deploy/quadlet/haben-db.container`: Die App verbindet sich als `POSTGRES_USER`, also Superuser und Eigentümer aller Tabellen. `ALTER TABLE … DISABLE TRIGGER ALL`, `DROP TRIGGER`, `SET session_replication_role = replica` sind mit der `DATABASE_URL` möglich. Die Doku-Aussage „greift auch bei direktem Datenbankzugriff“ gilt so nur eingeschränkt.
Fix: Zwei Rollen. Owner-Rolle nur für `migrate.ts` im Entrypoint, App-Rolle mit `GRANT SELECT, INSERT, UPDATE, DELETE` und `USAGE` auf Sequenzen, ohne Ownership. Nicht-Owner können Trigger nicht deaktivieren.

### 2.3 Weitere Punkte (Mittel/Niedrig)

| Datei | Befund | Fix |
|---|---|---|
| `routes/api/belege/teilen.ts:12`, `functions/documents.ts:68-73`, `functions/bank.ts:64-70`, `functions/archive.ts:85-88`, `deploy/Caddyfile` | Keine Request-Größenbegrenzung. `uploadDocuments` prüft Größe erst nach `arrayBuffer()`; `uploadArchiveFiles` erlaubt 50 × 100 MB. Nur angemeldet erreichbar. | Caddy `request_body { max_size }`, `f.size` vor dem Lesen prüfen, Dateianzahl begrenzen |
| `drizzle/0048_logo_trigger.sql:9-10` | `haben_audit` entfernt nur `ciphertext, pin_ciphertext, protocol_pdf, pdf, xml, logo`. `request_xml`, `response_xml`, `server_response_xml` (6 Tabellen) und `vast_requests.abholung` landen komplett im nicht löschbaren Audit-Log. Widerspricht `buchhaltung.md`. | Spalten ergänzen, Doku anpassen |
| `routes/api/rechnung/$id.$datei.ts:25-35`, `protokoll/$id.ts:41-49`, drei CSV-Routen | Bauen Header selbst statt `fileResponse`: PDF ohne `nosniff`/CSP, XML als `application/xml` inline (`beleg/$id.ts` liefert XML bewusst als `text/plain`). | überall `fileResponse`, kleines `csvResponse` |
| `server/export.ts:833` | `firma.json` im Jahresarchiv enthält `calendar_token_hash`; `withoutSecrets` filtert nur `ciphertext`. | in `SECRET_KEYS` aufnehmen |
| `server/file-response.ts:10` | `encodeURIComponent` lässt `' ( ) *` stehen; nach RFC 8187 keine `attr-char`. Strenge Clients verwerfen den Dateinamen. Keine Injection. | Zeichen nachkodieren |
| `server/crypto.ts` | Korrekt (zufälliger IV, GCM, Fehler werfen). Fehlt: AAD (Chiffrate zwischen Spalten tauschbar) und Key-Version (kein Rotationspfad). | `setAAD(purpose)`, 1 Byte Version |
| `elster/eric.ts:160, 319` | Ohne `ERIC_LOG_DIR` landen `eric.log` und Otto-Log in `os.tmpdir()`, werden nie gelöscht. | ins 0700-Temp-Verzeichnis des Aufrufs |
| `server/cash.ts:163-186` | CSV-Formel-Injection: Zellen mit `= + - @` am Anfang nicht neutralisiert. | Präfix `'` |
| `routes/api/belege/teilen.ts:9-12` | POST ohne Origin-Prüfung; Schutz hängt an `SameSite=Lax` von Better Auth (nicht dokumentiert). | `Sec-Fetch-Site`/`Origin` prüfen, in Doku aufnehmen |
| `server/vast.ts:43` | Gespeicherte Postfach-PIN wird stillschweigend auch für VaSt-Abruf und BRM-Anträge genutzt (Schema sagt „für den Postfachabruf“). | Text erweitern oder PIN für BRM immer verlangen |
| `.github/workflows/*.yml` | `firsttris/workflows@v1` (bewegliches Tag) mit `secrets: inherit`; Actions nur per Major-Tag; kein top-level `permissions`. KoSIT-JAR per curl ohne Prüfsumme. | auf SHA pinnen, Secrets explizit, `permissions: contents: read` |

Explizit geprüft und in Ordnung: XXE (fast-xml-parser lehnt externe Entitäten ab), XML-Escaping in E-Rechnung und ELSTER-XML, Pfadtraversal (nur SHA-256-Regex), Kalender-Token (192 Bit, Hash, `timingSafeEqual`), Bank-`state`, Zip-Slip in `install.ts`, Zertifikat und PIN (0700/0600, nie im Log), Better-Auth-Konfiguration (Rate Limit, X-Forwarded-For, Origin-Check).

---

## 3. Architektur

**Gut:** Die Schichtung Routen → Functions → Dienste → Pakete ist konsequent, `packages/core` ist tatsächlich I/O-frei und mit BMF-Referenzwerten getestet (der Agent hat § 32a für 2024 bis 2026 per BigInt nachgerechnet: 0 Abweichungen). Keine Job-Queue, ein Prozess, eine Datenbank: für einen Einnutzer-Betrieb die richtige Entscheidung.

**Fehler in der Architektur:**

- **Schichtumkehr ✔**: `server/ledger.ts:5` und `server/export.ts:8` importieren `accountName` aus `functions/journal.ts`. Die Functions-Datei enthält 50 Zeilen Kontennamen und die komplette Journalabfrage. `accountName` gehört nach `packages/core` (zum Kontenrahmen), `loadJournal` in einen Dienst.
- **Fachlogik in `functions/`**: `certificate.ts:27-37` (komplette Zertifikatsverwaltung mit `encrypt` + Insert), `company.ts:24-26` (`tx.update(company)` ohne `where`, funktioniert nur weil eine Zeile existiert), `documents.ts:53-54`, `invoices.ts:70,104`, `quotes.ts:42` greifen direkt auf `db`/`withActor` zu. Die Doku sagt „keine Fachlogik“ in functions.
- **Zod-Parsing uneinheitlich**: `quotes.ts`, `cash.ts`, `pauschalen.ts`, `articles.ts` parsen im Dienst, `invoices.ts` erwartet geparste Eingaben. Die Doku beschreibt nur die zweite Variante.
- **Schema-Drift**: In SQL von Hand ergänzte Constraints (`0011`, `0016`, `0018`, `0020`: `invoices_recurring_fk`, `*_lexoffice_voucher_fk`, `documents_private_share_range`, `dunnings_level`) fehlen in `schema.ts` und im Snapshot. `drizzle-kit generate` erzeugt künftig Migrationen, die an unbekannten Constraints scheitern.
- **Storno-Verweise ohne FK**: `reverses_id`, `corrects_id`, `opening_entry_id` (7 Spalten) sind `uuid` ohne Referenz. Der Nachweis „Storno zu X“ ist nicht referenziell gesichert.
- **Zyklus `core/posting.ts` ↔ `core/dunning.ts`**: Mahnerlöskonto gehört in `ACCOUNTS`.
- **`holidays.ts` importiert `addDays` aus `invoice.ts`**: Feiertagslogik hängt am Rechnungsmodul.
- **`withActor` korrekt**, aber drei Schreibzugriffe laufen daran vorbei und erzeugen Audit-Einträge mit `actor = NULL`: `company.ts:45` (erste Firmenzeile), `documents.ts:289-293` (Status „läuft“ → „fehler“). `lexoffice.ts:156` und `inbox.ts:226` schreiben Spalten ohne Audit, das ist in Ordnung.
- **Soll = Haben nur beim Sperren**: `0003:60-76` prüft nur bei `UPDATE OF locked_at`. Ein INSERT mit gesetztem `locked_at` oder dauerhaft ungesperrte Buchungen mit beliebigen Zeilen erzwingt die DB nicht. Die App macht es richtig, die DB garantiert es nicht.
- **Kein Graceful Shutdown**: Kein `SIGTERM`-Handler, kein `HEALTHCHECK` im Containerfile. Laufende Scheduler-Jobs (Bankabruf, Mailversand) brechen hart ab. Transaktionen schützen die Daten, externe Aufrufe können halb passieren.
- **Dokumentation**: `cash_entries`, `articles`, `company_logo` fehlen im Datenmodell von `architektur.md`; die Aussage „XML wird im Audit weggelassen“ stimmt nur für die Spalte `xml`.

---

## 4. Performance

Die Tests laufen schnell und die Pfade sind für einen Einnutzer ausreichend. Mit zehn Jahren Aufbewahrungspflicht werden folgende Stellen spürbar:

| Datei | Befund | Fix |
|---|---|---|
| `db/schema.ts` (ganze Datei) | Keine Indizes auf FK-Spalten außer `datev_bookings`, `lexoffice_*`, `contact_versions`, Auth. Betroffen: `journal_lines(entry_id, account)`, `journal_entries(date, source_type/source_id)`, `allocations(transaction_id, invoice_id, document_id)`, `bank_transactions(bank_account_id, booking_date)`, `invoice_lines(invoice_id)`, `dunnings(invoice_id)`, `invoices(corrects_id)`, `audit_log(at, table_name/row_id)`. Jede Buchungsansicht und `haben_check_journal_balance` scannen sequenziell. | eine Migration mit `index()` auf diese Spalten |
| `server/bank.ts:202, 258-340` | `openItems()` lädt bei jedem `transactionDetail` alle finalen Rechnungen und alle gebuchten Belege inklusive `extraction`-JSON, filtert „offen“ in JS. `openAmountSql` ist eine korrelierte Subquery ohne Index. `settings-guard.ts:27` ruft `openItems()` nur zum Zählen. | offen-Filter per `having` in SQL, Spalten einschränken |
| `server/archive.ts:171-214`, `lexoffice.ts:435-441` | `matchedSql`: korrelierte `exists` mit `regexp_replace` auf beiden Seiten je Zeile, auch im `count()`. 20.000 Buchungen × 5.000 Belege = 10⁸ Regex-Vergleiche pro Seitenaufruf. | generierte Spalte `number_norm` mit Index |
| `server/annual.ts:60-61, 381-385` | `ustYear` ruft `computeVatFigures` zwölfmal parallel (40 bis 50 Queries, Pool `max: 10`); `loadCompany()` fünfmal. | Datumsspanne statt `VatPeriod`, `company` durchreichen |
| `routes/_app/einstellungen.tsx:575-579` | ERiC-Download pollt alle 2 s `router.invalidate()`; der Loader führt 7 Server Functions aus, minutenlang. | nur `getEricStatus` pollen |
| `server/invoices.ts:339-383`, `dunning.ts:67-72` | `listInvoices` lädt alles, um eine Rechnung zu finden; `invoiceSummary` Vollscan. | `invoiceStatus(id)`, SQL-Aggregat |
| `server/cash.ts:30-49` | `assertNeverNegative` lädt die ganze Kassentabelle je Zeile. | `group by date` ab Vorsaldo |
| `server/legacy-open.ts:145-153, 299-311` | `takeOverAll` ruft je Posten `openLegacyItems()` (4 Vollabfragen): O(N²). | einmal laden |
| `server/berechtigung.ts:198` | `select()` lädt alle XML-Spalten nur für die Statusableitung. | Spalten einschränken |
| `server/mail.ts:206-209` | `sentReminderKeys` lädt alle `ok`-Zeilen des Mail-Logs (wächst unbegrenzt). | `where kind = 'fristen'` |
| `import/parse.ts:236-244` | Datei bis zweimal komplett geparst zur Trennzeichen-Erkennung. | an den ersten Zeilen erkennen |
| `components/ExportCard.tsx`, `DatevCard.tsx` | `getExportYears` zweimal clientseitig pro Seitenaufruf, Fehler mit `() => {}` verschluckt. | in den Loader |

---

## 5. Vereinfachung (KISS)

Die größten Hebel, geordnet nach Aufwand/Nutzen:

1. **`authedFn()` + `UserError`** (`server/middleware.ts`). 127 Server Functions folgen exakt demselben Muster; 49 × `.catch(asUserError)`, 33 × `return { ok: true }`, 16 identische `asUserError`-Kopien, 3 × `rethrow`, 3 Inline-Varianten (`annual.ts` nutzt alle drei Stile). Ein Helfer spart rund 250 Zeilen und schließt zugleich das Fehlerleck aus 2.1, weil die Übersetzung nicht mehr vergessen werden kann.

2. **`useAction()`-Hook + `NoticeBanner`** im Frontend. 20 × handgeschriebenes `async function run()`, 42 × `useState(false)` für `busy`, 40 × Fehler-State, 12 × lokal definierter `type Notice`, 20 × inline `className={\`banner banner-${tone}\`}`, zwei verschiedene `NoticeBanner`-Komponenten (`einstellungen.tsx:42`, `finanzamt.tsx:460`). Genau dort, wo das Muster fehlt oder lückenhaft ist, entstehen die stillen Fehler aus 1.2. `pauschalen.tsx:150 useSubmit` zeigt bereits die Richtung.

3. **Ein ELSTER-Sendepanel** statt fünf. `umsatzsteuer/$zeitraum.tsx:612-706`, `jahreserklaerung/$jahr.tsx:534-631`, `finanzamt.tsx:345-432`, Postfach (470 ff.), `VastBelege.tsx:63 ff.`: PIN-Feld, Test-Schalter, Zweiklick, busy, Notice, Zertifikatshinweis. Die Kopien sind bereits auseinandergelaufen (Test/Echt-Fehler in 1.2, `KIND_LABEL` dreimal mit abweichendem Text). `finanzamt.tsx:SendPanel` ist das beste Modell.

4. **Ein ELSTER-Umschlag** statt sieben. TransferHeader/NutzdatenHeader sind in `xml.ts:126-151`, `erklaerung.ts:86-114`, `nachricht.ts:40-67`, `bankverbindung.ts:73-99`, `postfach.ts:63-89`, `vast.ts:64-80`, `berechtigung.ts:41-63` nahezu identisch ausgeschrieben, mit zwei Mini-Buildern und fünf String-Arrays. Dazu drei Kopien der XML-Lese-Helfer (`Node`, `asNodes`, `findDeep`, `text`, `int` in postfach.ts, vast.ts, berechtigung.ts), drei `germanDate`, vier Steuernummer-Prüfungen.

5. **Positions-Editor teilen**: `InvoiceEditor.tsx:67-108, 577-684` und `RecurringForm.tsx:44-53, 91-134, 282-352` sind kopiert, mit Drift (RecurringForm fehlt `touched`/`attempted`). `FORMATS` ist viermal definiert.

6. **Dienst-Duplikate**: `quotes.ts` vs. `invoices.ts` (`lineRows`, `draftValues`, `lockDraft`, Zähler-Upsert, `sha256`, `newDefaults`); `functions/invoices.ts:67-81` vs. `functions/quotes.ts:40-52` (`editorContext`); `einvoice/pdf.ts:38-98` vs. `quote.ts:27-75` (80 % identisch, `confirmationPdfData` filtert Meta über Label-Text und bricht still bei Umbenennung).

7. **Zentrale Zod-Schemas**: Vier Cent-Schemas mit vier verschiedenen Grenzen, `yearSchema` achtmal, Datum teils per Regex (`income-tax.ts:11` akzeptiert `2026-99-99`), teils `z.iso.date()`, E-Mail ohne `.max()` mit veraltetem `z.string().email()`. Ein `server/schemas.ts` oder `core` mit `cents`, `isoDate`, `year`, `uuid`, `email`.

8. **Datums-Helfer in `core`**: vier Implementierungen von „nächster Werktag“ (`period.ts:129`, `holidays.ts:205`, `fristen.ts:218-222`, `einspruch.ts:103-113`), zwei `addDays`, `MONTHS` in `period.ts` nicht exportiert und sechsmal im Frontend neu definiert.

9. **Tote Exporte** (repo-weit gegrept): `core`: `assertCents`, `scheduleForYear`, `ustvaInputSchema`, `TAX_RATES`, `PRIVATE_USE_RATES`, `TAX_CODES`-Daten (nur als `keyof` genutzt, `RC13b rate: 1900` falsch). `elster`: `TEST_STEUERNUMMER_BUFA`, `POSTFACH_DATENART_LABEL`, `FAKE_HINWEIS`, `parseTransferTicket`, `ERIC_OK/…` (index.ts:11-12). `import`: `transactionHash`, `detectStatementFormat`, `datevAccountTotals`, `bookedBalance`, `mapEnableBankingTransaction`, `parseRetryAfter` (ungetestet). `einvoice`: `TITLES`. `web`: `getInvoiceMails`, `kindOptions`/`methodOptions` (assets.ts), `normalizeVoucherNumber`, `OpenPositions`, `loadTaxpayer`, `RENEW_WARNING_DAYS`, `extractionSchema`, `fillTemplate`, `textToHtml`, `IMAP_PRESETS`, `fristenMail`, `SourcesToggle`-Prop `_versteuerung`.

---

## 6. Clean Code

- **Typ-Casts statt Typen**: 68 `as`-Casts im Frontend, 8 in `core/posting.ts`, rund 10 in Diensten, überwiegend `taxRate as 1900 | 700 | 0` und `unit as UnitLabel`. Ursache: Schema liefert `number`/`string`. Fix: `smallint("tax_rate").$type<TaxRate>()`, `type TaxRate = (typeof TAX_RATES)[number]`, Zod-Enums. `elster/eric.ts` erzwingt mit `type Fn = (...args: unknown[]) => unknown` Casts an jeder FFI-Stelle; typisierte Signaturen je Funktion an einer Stelle.
- **Namensgebung in `functions/`**: 13 Functions mit `Fn`-Suffix nur zur Kollisionsvermeidung, 115 ohne; `remove*` (7) neben `delete*` (3); `getRecurringList` vs. `getInvoices`; `getOverview` ohne Hinweis auf USt.
- **Magic Values**: `610001002` in `fake-client.ts:17`; 20-Stunden-Intervall doppelt (`postfach.ts`, `bank-sync.ts`); `"2026-01-01"` als Fallback in `AssetForm.tsx:82`; „800 €“ als Text statt `GWG_LIMIT` (`posting.ts:59`); Sonderfall `c === "hardware"` fest in `computeEuer` (`euer.ts:317`).
- **Irreführende Kommentare**: `eric.ts:37-39` „nur bei send“ (gilt auch für postfach/vast); `dunning.ts:49` „kaufmännisch gerundet“ bei `Math.round` mit negativen Werten; `est.ts:143-148` ebenso; verwaiste Kommentare in `auswertungen.tsx:303-307`.
- **Kleinigkeiten**: `bank.tsx:606` `useState(tx.amount < 0 ? "privat" : "privat")`; `bank.tsx:647-657` `useEffect` ohne Deps; `legacy-open.ts:58` `const open = openAmount` nach Verwendung; `contacts.ts:68` `and()` mit einem Argument; `documents.ts:256` `Parameters<Parameters<…>>` statt `Tx`; `InvoiceEditor.tsx:457` `split("-").reverse().join(".")` statt `formatDate`; `buchungen.tsx:131` Filter-Chips kennen `kasse` nicht; `export.ts:203-210` `ALLOCATION_LABELS` ohne `mahnerloes` (als `Record<AllocationKind, string>` typisieren, dann meldet TS fehlende Keys).
- **Datei-Größen**: `export.ts` 1.093, `bank.tsx` 824 (6 Komponenten), `invoices.ts` 713 (Abschlag, Liste, Festschreiben in einer Datei), `InvoiceEditor.tsx` 733. `einstellungen.tsx` (840) ist dagegen bereits in Cards aufgeteilt und in Ordnung.
- **Lint-Konfiguration**: `no-non-null-assertion` ist abgeschaltet; `react-hooks` nur für `.tsx`. Beides vertretbar, aber `@typescript-eslint/no-floating-promises` (type-aware) würde mehrere der stillen Fehler aus 1.2 automatisch finden.

---

## 7. Was gut gelöst ist

Damit die Liste oben nicht täuscht, die Stärken, die die Agenten explizit verifiziert haben:

- **Geld**: durchgängig Cent, Basispunkte, Tausendstel; kein `parseFloat`/`toFixed` auf Beträgen, auch nicht im Frontend. Vorschau-Summen kommen aus `core`, keine abweichende Rundung.
- **Steuerlogik**: § 32a-Tarif, Soli, Kinderfreibeträge, Vorsorge-Höchstbeträge 2.800/1.900, § 35a, Feiertage inkl. Buß- und Bettag, § 108 AO, 4-Tage-Fiktion ab 2025, AfA (monatsgenau, Übernahme, Abgang, Sammelposten), SKR03/SKR04-Konten, Steuernummer-Umrechnung aller 16 Länder: nachgerechnet und korrekt. Buchungssätze in allen geprüften Varianten ausgeglichen.
- **Transaktionen**: `withActor` überall, `FOR UPDATE` auf Entwürfen, atomare Nummernzähler per Upsert, Advisory-Locks in Kasse und Pauschalen, Unique-Index für wiederkehrende Termine. Postfach bestätigt erst nach dem Commit.
- **Trigger**: Lock, Append-only und Audit sauber getrennt; `locked_at` nicht zurücksetzbar; `allocations_check` serialisiert mit `FOR UPDATE`; alle Zeitstempel `timestamptz`; Migrationsjournal lückenlos.
- **Sicherheit**: Autorisierung lückenlos; Datei-Routen prüfen Sitzung → UUID → Existenz → 404; `fileResponse` mit `nosniff`, `no-store`, CSP, `filename*`; Kalender-Token und Bank-`state` kryptographisch sauber; Zertifikat in `mkdtemp` 0700/0600 mit Cleanup, PIN nie im Log; XXE abgewehrt; Zip-Slip abgewehrt.
- **ERiC-Isolation**: stderr gelesen (kein Pipe-Deadlock), `settled`-Guard, SIGKILL bei Timeout, koffi-Puffer im `finally` freigegeben, Mock-ERiC-Tests über echte `.so`.
- **Betrieb**: Container multi-stage, non-root, keine Secrets im Image; Compose wartet auf DB-Health; Backup sichert Dump vor Dateien (richtige Reihenfolge); Export-Stream mit Backpressure, Prüfsummen und `FEHLER.txt`; Scheduler überlappungsfrei mit Fehlerisolation je Job; Lexoffice-Import abbrechbar, fortsetzbar, dublettenfrei.
- **Frontend**: `router.invalidate()` konsequent nach Mutationen, Zweiklick und `disabled` bei kritischen Aktionen (keine Doppelbuchung gefunden), `key={id-updatedAt}` als Remount-Muster, `sw.js` cached bewusst nichts, Hooks sauber.
- **Doku und Tests**: `architektur.md` und `entwicklung.md` beschreiben den Code zutreffend, Fixtures sind anonymisiert, KoSIT-Validierung in CI, E2E mit Desktop und Mobil.

---

## Anhang A: Weitere Befunde (Niedrig)

**packages/core**
- `dunning.ts:51` Zinsen fix 365 Tage auch im Schaltjahr (act/act wäre korrekt; sonst als Vereinfachung dokumentieren).
- `invoice.ts:162-166` `parseQuantity` löscht alle Punkte: „1.5“ wird zu 15 Stück; `parseEuro` macht es richtig.
- `private-use.ts:113-123` Elektro 0,25 %: Erlöszeile trägt `USt19` auf 150 €, USt rechnet auf 480 € Basis. DATEV-Export (`export.ts:514`) zeigt inkonsistenten Schlüssel.
- `steuernummer.ts:298` 13-stellige Eingaben ungeprüft (Länderpräfix, Stelle 5 = 0).
- `period.ts:127` `dueDate` liefert `Date`, alle anderen Fristfunktionen ISO-Strings.
- `euer.ts:347-359` vs. `ledger.ts:279-283` `csvField` + BOM doppelt, abweichende Regex.

**packages/elster**
- `process-client.ts:134-156` Timeout nach eingetroffener `message`, aber vor `close`, verwirft ein vorliegendes `result` mit TransferTicket. Bei `type: "result"` sofort `finish()`.
- `install.ts:115-122` Neuinstallation derselben Version: `AKTUELL` zeigt zwischen zwei `rename` kurz ins Leere, `elsterClient()` erzeugt in dem Moment den Fake-Client.
- `xml.ts:56-58` `hasTestmerker` kennt nur zwei Werte; `xml.ts:60-67` `escapeXml` entfernt keine XML-1.0-ungültigen Steuerzeichen (ERiC-Parserfehler statt klarer Meldung).
- `est.ts:143-148, 402` `Math.round` bei negativen Beträgen; `est.ts:616 vs. 621` Bruttoarbeitslohn einmal mit Cent, einmal in Euro.
- `berechtigung.ts:78, 91` Jahre lexikografisch sortiert, ungeprüft. `postfach.ts:172` redundante `anzahltreffer`-Prüfung.
- Worker bleibt bei Tod des Elternprozesses mit PIN im Speicher zurück; verwaiste `haben-eric-*`-Temp-Verzeichnisse beim Start räumen.

**packages/import und einvoice**
- `enablebanking/client.ts:217-237` kein Retry bei 429/5xx (Lexoffice-Client hat Backoff); ein 503 kostet 20 Stunden, weil `lastSyncAt` gesetzt wird.
- `csv.ts:24-25` `"` mitten im ungequoteten Feld schaltet in den Quoted-Modus und verschluckt den Rest.
- `camt.ts:52-56` max. 2 Nachkommastellen (ISO 20022 bis 5): Import bricht ab. `camt.ts:212` `creditorId` in v08 unter `Cdtr/Pty` nicht gefunden.
- `lexoffice/map.ts:199-211` Schlussrechnung mit Abschlag anderer Steuerrate: Σ `taxes` ≠ `net`/`tax`.
- `enablebanking/map.ts:20, 76-98` Status doppelt geprüft; RJCT/OTHR als „vorgemerkt“; `BALANCE_PREFERENCE` enthält XPCD/ITAV/CLAV als gebuchten Saldo.
- `einvoice/format.ts:18-40` `paymentSentence` nur deutsch, landet bei `language: "en"` im XML (`xml.ts:218/223`). `einvoice/xml.ts:117` BT-10 fällt auf die eigene Rechnungsnummer zurück.

**apps/web Server**
- `bank.ts:332`, `reports.ts:244`, `export.ts:755`: `toISOString().slice(0, 10)` auf Zeitstempeln liefert das UTC-Datum; `today(date)` aus `today.ts` nimmt bereits ein `Date`. Alle anderen Datums-Rechnungen sind reine String-Arithmetik und korrekt.
- `extraction.ts:69-77, 100-106` `isoDate` nur Format (`2025-13-45` passiert), `decimalToCents` ohne Obergrenze, Strings ohne Längenlimit; roher Postgres-Fehler landet in `extractionError`.
- `dunning.ts:106-155` `createDunning` ohne Sperre, `level` nicht gegen `nextLevel` geprüft.
- `bank-sync.ts:146-147, 195-205` `state` ohne Ablauf, nicht atomar verbraucht.
- `mail.ts:128-155` Protokoll nach Versand; Insert-Fehler wiederholt die Erinnerung. `recurring.ts:276` Dedup per Regex auf Fehlertext statt `code === "23505"`.
- `inbox.ts:335-338` Mail komplett geladen, bevor das Größenlimit greift.
- `income-tax.ts:72-77` Kinder-IdNr ohne Prüfziffer; `income-tax.ts:109-110` `safeParse`-Fehler liefert stilles `EMPTY`.
- `lexoffice.ts:218-220` `imported` zählt auch `onConflictDoNothing`.
- `export.ts:119-156` fflate kennt kein ZIP64: über 4 GB oder 65.535 Einträge entsteht ein stilles kaputtes Archiv.
- `db/migrate.ts` kein Advisory Lock gegen parallele Container-Starts.
- `functions/invoice-mail.ts:262` `subject` erlaubt CR/LF (nodemailer schützt, Defense in depth).

**apps/web Frontend**
- `finanzamt.tsx:482, 554` `today` per `toISOString()` (UTC) statt aus dem Loader.
- `bank.tsx:111-133` `role="tablist"` auf Links ohne `tabpanel`; `pauschalen.tsx:77-85` zeigt das richtige Muster.
- `login.tsx:50-59`, `setup.tsx:28-36` ohne `finally`: `busy` bleibt bei Netzfehler `true`.
- `mahnwesen/$id.tsx:23-24` eigener `Intl.NumberFormat` statt `formatDecimal`.

**Schema und Deploy**
- Fehlende CHECKs: `allocations` (`kind` ↔ FK), `kind IN ('storno','korrektur') ⇒ corrects_id NOT NULL`, `quantity > 0`, `tax_rate`-Bereich, `gross = net + tax`, `quotes.decision`.
- `0048:16` `row_id = NULL` für Tabellen mit PK `year` (Zähler, `income_tax_inputs`).
- `schema.ts:294, 358-360` `bescheiddatum`, `genehmigen_bis` als `text` statt `date`.
- `quadlet/haben-app.container:9-11` `:latest` + `AutoUpdate=registry`: Migration ohne vorheriges Backup, kein Down-Pfad. `haben-db.container` ohne `Notify=healthy`.
- `Caddyfile` ohne `request_body max_size`, ohne CSP für App-Seiten. `.dockerignore` ohne `apps/web/data`, `test-results`, `*.test.ts`.

---

## Anhang B: Methodik

- Toolchain: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` ohne und mit `TEST_DATABASE_URL` (lokales PostgreSQL 16).
- Acht parallele Review-Durchgänge je Bereich (core; einvoice + import; elster; Dienste A; Dienste B; Functions + API + Auth; React; Schema + Migrationen + Deploy + CI). Jeder hat seine Dateien vollständig gelesen, tote Exporte repo-weit gegrept und Rechen- oder Parser-Befunde mit kleinen Skripten (`node --experimental-strip-types`) nachgestellt.
- Die mit ✔ markierten Befunde habe ich zusätzlich selbst im Code bzw. in den installierten Bibliotheken (`@tanstack/start-server-core`, `drizzle-orm`) nachgeprüft.
- Nicht geprüft: tatsächliche Annahme der DATEV-Datei durch DATEV, der korrekte ELSTER-Testmerker für das Postfach (beides braucht die externe Spezifikation), Laufzeitverhalten unter Last.
