# Haben

Buchhaltung für einen Freelancer mit EÜR und monatlicher Umsatzsteuer-Voranmeldung. Self-hosted, Open Source (AGPL-3.0), ersetzt Lexware/Lexoffice.

Stand: **Phase 1 bis 5** des Implementierungsplans: Fundament, ELSTER-Übermittlung, Ausgangsrechnungen, E-Rechnung, Belege, Bankabgleich, automatische Voranmeldung, Auswertungen und Jahresexport. Die Kennzahlen der Voranmeldung rechnet Haben aus den Buchungen; von Hand überschreiben geht weiterhin, mit Begründung.

## Phase 6: Umzug aus Lexoffice / Lexware Office

- Neue Seite „Archiv“ mit Umzug in vier Schritten: API-Schlüssel hinterlegen, alles abrufen, Exporte ablegen, Abgleich je Jahr
- Abruf über die Public API von Lexware Office (Tarif XL; `api.lexware.io`, abweichend per `LEXOFFICE_API_URL`): Kontakte, Ausgangsrechnungen, Gutschriften, Abschlagsrechnungen und Belege samt Original-PDF, E-Rechnungs-XML und angehängten Dateien, dazu Zahlungsstatus und Kategorien. Nur lesend; der Schlüssel liegt AES-verschlüsselt in der Datenbank
- Der Abruf läuft im Hintergrund mit etwa zwei Anfragen pro Sekunde, wiederholt bei 429 und Serverfehlern und setzt nach einem Abbruch fort; Fehler einzelner Belege stehen in einer Liste und werden beim nächsten Abruf erneut versucht. Gleichnamige Kontakte in Haben werden verknüpft statt doppelt angelegt
- Buchungen und Bankumsätze liefert die API nicht: Den DATEV-Buchungsstapel (EXTF, je Geschäftsjahr) liest Haben zeilenweise ein; sich überschneidende Zeiträume werden abgelehnt. IDEA-Export, ELSTER-Protokolle und Kontoauszüge kommen unverändert ins Archiv
- Alles Übernommene ist unveränderlich (Trigger) und steht mit Originaldateien im Jahresexport unter `lexoffice/`
- Abgleich je Jahr: Belege mit Datei, DATEV-Buchungen ohne passenden Beleg (über Belegfeld 1), fehlende Exporte, Summen, Umsatzsteuer je Monat zum Vergleich mit den übermittelten Voranmeldungen und die letzte Rechnungsnummer für den Nummernkreis
- Altbestand bleibt getrennt: Er fließt nicht in Bankabgleich, Voranmeldung und Auswertungen von Haben ein

## Phase 5: Automatische Voranmeldung, Auswertungen, Jahresexport

- Kz 81, 86 und 66 kommen aus den Buchungen: bei Ist-Versteuerung die Umsatzsteuer nach Datum des zugeordneten Zahlungseingangs (bei Teilzahlungen anteilig), bei Soll nach Rechnungsdatum; Vorsteuer nach Belegdatum. Kz 83 wie gehabt gerechnet
- Unter jeder Kennzahl lassen sich die Zahlungen, Rechnungen bzw. Belege dahinter aufklappen
- Manuell überschreiben bleibt möglich, nur mit Begründung; gespeichert werden Begründung und die berechneten Werte zum Vergleich. Ein berechneter Entwurf wird vor dem Senden auf den aktuellen Stand gebracht
- Vorprüfung vor dem Senden: Ausgaben ohne Beleg, nicht zugeordnete Zahlungseingänge, ungebuchte Belege, Rechnungsentwürfe im Zeitraum, Umsätze zu 0 %
- Auswertungen: EÜR nach Zufluss und Abfluss, offene Posten, Einnahmen und Ausgaben je Monat
- Jahresexport als ZIP für die Aufbewahrung: Belege und Rechnungen im Original, Journal, Bankumsätze, Voranmeldungen samt Protokollen, Stammdaten und Audit-Log als CSV, mit Prüfsummen

## Phase 4: Bankimport und Abgleich

- Import von Kontoauszügen als Datei: DKB-CSV (neues und altes Format), N26-CSV und CAMT.053. Bank und Format erkennt Haben am Inhalt, auch die Zeichenkodierung
- Konten werden über die IBAN aus der Datei angelegt; für N26 (CSV ohne eigene IBAN) das Konto vorher anlegen und beim Import auswählen
- Deduplizierung über einen Hash aus Datum, Betrag, Gegen-IBAN und Verwendungszweck; echte Doppelbuchungen am selben Tag unterscheidet die Reihenfolge in der Datei. Überlappende Exporte lassen sich also gefahrlos mehrfach importieren
- Saldenprüfung: passt der Anfangssaldo nicht zum Endsaldo des vorigen Imports, meldet Haben eine Lücke
- Vorschläge mit Begründung: Betrag, Rechnungsnummer im Verwendungszweck, bekannte IBAN, Name, bei Belegen Datum ± 5 Tage. Die IBAN eines Kunden merkt sich Haben beim ersten Zahlungseingang
- Zuordnen per Tastatur (Enter, J/K), Teilzahlungen und Sammelüberweisungen über mehrere Zuordnungen je Umsatz
- Buchungen: Zahlungseingang Bank an Forderungen, bei Ist-Versteuerung wird der Steueranteil der Zahlung von „Umsatzsteuer nicht fällig“ auf „Umsatzsteuer“ umgebucht; Belegzahlung Verbindlichkeiten an Bank; ohne Beleg als Privatentnahme/-einlage, Geldtransit, Umsatzsteuer-Vorauszahlung oder Bankgebühren
- Importe, Umsätze und Zuordnungen sind unveränderlich; eine Zuordnung wird per Gegenzeile und Gegenbuchung aufgehoben
- Rechnungen zeigen jetzt „bezahlt“ und „teilbezahlt“; offene Forderungen rechnen mit den Zahlungen
- Neue Seite „Buchungen“: das Journal je Monat mit Konten, Soll, Haben und Steuerschlüssel

## Phase 3: Belege und Eingangsrechnungen

- Upload per Drag-and-drop, Dateiauswahl oder Kamera; als installierte App (PWA) auch über das Teilen-Menü des Handys
- Ablage im Dateisystem unter dem SHA-256 der Datei (`DOCUMENTS_DIR`); dieselbe Datei wird nie doppelt abgelegt. Der Dateityp wird am Inhalt erkannt
- E-Rechnungen (ZUGFeRD/Factur-X, XRechnung CII und UBL, ZUGFeRD 1.0) liest Haben direkt aus; das XML wird mit pdf-lib aus dem PDF gezogen
- Andere PDFs und Fotos liest Claude (Opus 5.5) mit festem JSON-Schema vor, wenn `ANTHROPIC_API_KEY` gesetzt ist. Die Datei geht dafür an die Anthropic-API; ohne Schlüssel bleibt alles lokal und die Felder werden von Hand ausgefüllt. Vorbefüllte Felder werden immer erst nach deiner Bestätigung gebucht
- Kategorie je Beleg (Software, Hosting, Telefon, Reisekosten …), abgebildet auf Aufwandskonto des Kontenrahmens; Haben schlägt die Kategorie vom letzten Beleg desselben Lieferanten vor
- Buchen: Aufwand und Vorsteuer an Verbindlichkeiten, bei privat bezahlten Belegen an Privateinlage; danach ist der Beleg gesperrt (Trigger). Ungebuchte Belege lassen sich löschen
- Die Umsatzsteuer-Seite zeigt die Vorsteuer aus gebuchten Belegen des Monats (nach Belegdatum) und übernimmt sie auf Wunsch in Kz 66

Belegdateien gehören ins Backup (`deploy/backup.sh` sichert das Volume `haben-belege` mit).

## Phase 2: Rechnungen

- Kontakte mit Kundennummer, USt-IdNr., IBAN und Leitweg-ID. Jede Änderung legt eine neue Version an; löschen geht nicht, archivieren schon
- Rechnungseditor mit Positionen, Steuersatz je Position (19 / 7 / 0 %), Leistungszeitraum, Zahlungsziel und Live-Vorschau
- Fortlaufender Nummernkreis je Jahr (`2026-034`), Nummer erst beim Festschreiben, lückenlos. Unter Einstellungen lässt sich die nächste Nummer setzen, um nach Lexoffice weiterzuzählen; zurücksetzen geht nicht
- PDF mit Typst (`packages/einvoice/templates/rechnung.typ`, DIN 5008, IBM Plex Sans), daraus mit `@e-invoice-eu/core` ZUGFeRD (EN 16931, PDF/A-3) oder XRechnung 3.0 (CII oder UBL)
- Festschreiben in einer Transaktion: Nummer, PDF, XML (mit SHA-256), Sperre und Buchung „Forderung an Erlöse + USt“. Bei Ist-Versteuerung auf „Umsatzsteuer nicht fällig“; fällig wird sie mit dem Zahlungseingang (Phase 4)
- Stornorechnung (hebt auf, sofort festgeschrieben) und Rechnungskorrektur (mindert, als Entwurf), beide mit Bezug auf das Original (BT-25); im XML als Gutschrift (381)
- Postgres-Trigger sperren festgeschriebene Rechnungen, Positionen und Buchungen; beim Festschreiben einer Buchung muss Soll = Haben sein
- CI prüft alle Beispielrechnungen mit dem KoSIT-Validator (`pnpm --filter @haben/einvoice kosit`)

Noch nicht: „bezahlt“ (kommt mit dem Bankabgleich), Kleinunternehmer und Reverse Charge, E-Mail-Versand.

**Kontonummern prüfen:** Die Buchungen nutzen SKR03 bzw. SKR04 (Einstellung „Kontenrahmen“), u. a. 1400/1200 Forderungen, 8400/4400 Erlöse 19 %, 1766/3816 Umsatzsteuer nicht fällig 19 %, 1576/1406 Vorsteuer 19 %, 1600/3300 Verbindlichkeiten, 1800/2100 Privatentnahmen, 1360/1460 Geldtransit, 1780/3820 USt-Vorauszahlungen und die Aufwandskonten der Belegkategorien. Alle Bankkonten laufen auf ein Finanzkonto (1200 bzw. 1800). Die Zuordnung steht in `packages/core/src/posting.ts` und sollte einmal mit Lexoffice oder dem Steuerberater abgeglichen werden.

## Phase 1: Umsatzsteuer-Voranmeldung

- Ersteinrichtung mit genau einem Konto, Anmeldung per Passkey (Passwort als Rückfallebene)
- Firmendaten mit Steuernummer und Bundesland; die Umrechnung ins 13-stellige ELSTER-Format übernimmt Haben
- ELSTER-Zertifikat (.pfx) hochladen, AES-256-GCM-verschlüsselt in der Datenbank; die PIN wird nur beim Senden abgefragt und nie gespeichert
- Voranmeldung je Monat: Entwurf, „Nur prüfen“ (ERiC-Plausibilitätsprüfung), Testübermittlung, Echtübermittlung
- Jede Prüfung und Übermittlung landet mit Transfer-Ticket und ERiC-Protokoll-PDF im Verlauf
- Gesendete Voranmeldungen sind festgeschrieben (Postgres-Trigger lehnt `UPDATE`/`DELETE` ab); eine Korrektur ist eine neue, berichtigte Anmeldung (Kz 10)
- Audit-Log mit altem und neuem Wert jeder Änderung, nur anhängen
- Warnung 30 Tage vor Ablauf des Zertifikats

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `apps/web` | TanStack Start (React, Server Functions), Drizzle, Better Auth |
| `packages/core` | Beträge in Cent, Zeiträume und Fälligkeiten, Steuernummer-Umrechnung, UStVA-Berechnung |
| `packages/elster` | ERiC-Anbindung hinter `ElsterClient`, UStVA-XML, Worker-Prozess |
| `packages/import` | Parser für Kontoauszüge (DKB, N26, CAMT.053), Deduplizierung, Saldenprüfung |
| `packages/einvoice` | Rechnungs-PDF (Typst), E-Rechnung erzeugen (ZUGFeRD, XRechnung) und eingehende E-Rechnungen lesen |

Geldbeträge sind immer ganze Cent, Steuersätze Basispunkte (1900 = 19 %).

ERiC läuft nie im App-Prozess. Jeder Aufruf startet einen kurzlebigen Kindprozess (`packages/elster/src/worker.ts`), der ERiC per `koffi` lädt. Stürzt die native Bibliothek ab, bekommt die App nur eine Fehlermeldung. Ohne `ERIC_HOME` nutzt Haben einen simulierten Client, und die Oberfläche zeigt das deutlich an.

## Entwicklung

Voraussetzungen: Node 22, pnpm 10, PostgreSQL 16.

```sh
pnpm install
cp apps/web/.env.example apps/web/.env   # Werte eintragen
pnpm db:migrate                           # liest DATABASE_URL
pnpm dev                                  # http://localhost:3000
```

Prüfungen wie in CI:

```sh
pnpm lint
pnpm typecheck
TEST_DATABASE_URL=postgres://…/haben_test pnpm test   # ohne TEST_DATABASE_URL werden die DB-Tests übersprungen
pnpm build
KOSIT_JAR=… KOSIT_CONFIG=…/scenarios.xml pnpm --filter @haben/einvoice kosit   # braucht Java 21
```

Schemaänderungen: `apps/web/src/server/db/schema.ts` anpassen, dann `pnpm db:generate`. Trigger und Funktionen stehen in eigenen SQL-Migrationen (`drizzle/0001_festschreibung.sql`).

## ELSTER einrichten

1. Als Entwickler bei ELSTER registrieren und das ERiC-Paket für Linux x86_64 laden. ERiC darf nicht weitergegeben werden und liegt deshalb nicht im Repo oder Image.
2. ERiC entpacken, z. B. nach `/opt/eric` (darin `lib/libericapi.so` und `lib/plugins2/`), und `ERIC_HOME` setzen.
3. In Mein ELSTER eine Zertifikatsdatei (.pfx) beantragen und in Haben unter Einstellungen hochladen.
4. Zuerst **Nur prüfen**, dann **Testübermittlung**. Die läuft mit der Test-Hersteller-ID 74931 und Testmerker 700000004 und geht nicht an das Finanzamt.
5. Nach erfolgreicher Testübermittlung die eigene Hersteller-ID beantragen und als `ELSTER_HERSTELLER_ID` eintragen. Erst dann ist die Echtübermittlung freigeschaltet.

**Vor dem ersten echten Lauf gegen `ericapi.h` des installierten ERiC prüfen** (in `packages/elster/src/eric.ts`): die Layouts von `eric_druck_parameter_t` (Version 2) und `eric_verschluesselungs_parameter_t` (Version 3), die Flag-Kombination `ERIC_VALIDIERE | ERIC_SENDE | ERIC_DRUCKE` und den Namespace bzw. die Elementreihenfolge im UStVA-XML. Die ERiC-Bindung ist nur gegen eine nachgebaute Bibliothek getestet. Die erste Plausibilitätsprüfung mit echtem ERiC zeigt, ob das stimmt. ERiC-Updates erst nach erfolgreicher Testübermittlung einspielen.

## Betrieb (Podman Quadlets + Caddy)

```sh
podman build -t haben -f Containerfile .
mkdir -p ~/.config/containers/systemd ~/.config/haben
cp deploy/quadlet/* ~/.config/containers/systemd/
cp deploy/Caddyfile deploy/backup.sh ~/.config/haben/
cp deploy/haben.env.example ~/.config/haben/haben.env   # Domain und ERiC eintragen

printf '%s' "$(openssl rand -hex 24)" | podman secret create haben-db-password -
printf 'postgres://haben:PASSWORT@haben-db:5432/haben' | podman secret create haben-database-url -
openssl rand -base64 32 | tr -d '\n' | podman secret create haben-auth-secret -
openssl rand -base64 32 | tr -d '\n' | podman secret create haben-encryption-key -

systemctl --user daemon-reload
systemctl --user start haben-db haben-app haben-caddy
systemctl --user enable --now haben-backup.timer
```

Der App-Container wendet beim Start ausstehende Migrationen an. `HABEN_ENCRYPTION_KEY` gehört zusätzlich ins Backup: Ohne ihn ist das gespeicherte Zertifikat nicht mehr lesbar. Das Backup (`deploy/backup.sh`) läuft täglich mit `pg_dump` und restic.

Passkeys sind an die Domain gebunden. `BETTER_AUTH_URL` muss die Adresse sein, unter der Haben im Browser läuft.

## Lizenz

AGPL-3.0. Wer Haben für andere betreibt, muss ihnen den Quellcode anbieten; der Link steht in der Navigation.
