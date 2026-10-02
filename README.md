# Haben

Buchhaltung für einen Freelancer mit EÜR und monatlicher Umsatzsteuer-Voranmeldung. Self-hosted, Open Source (AGPL-3.0), ersetzt Lexware/Lexoffice.

Stand: **Phase 1 und 2** des Implementierungsplans: Fundament, ELSTER-Übermittlung, Ausgangsrechnungen und E-Rechnung. Die Kennzahlen der Voranmeldung (Kz 81, 86, 66) gibst du noch selbst ein, Kz 83 rechnet Haben. Ab Phase 5 kommen sie automatisch aus den Buchungen.

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

**Kontonummern prüfen:** Die Buchungen nutzen SKR03 bzw. SKR04 (Einstellung „Kontenrahmen“), u. a. 1400/1200 Forderungen, 8400/4400 Erlöse 19 %, 1766/3816 Umsatzsteuer nicht fällig 19 %. Die Zuordnung steht in `packages/core/src/posting.ts` und sollte einmal mit Lexoffice oder dem Steuerberater abgeglichen werden.

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
| `packages/einvoice` | Rechnungs-PDF (Typst) und E-Rechnung (ZUGFeRD, XRechnung) |

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
