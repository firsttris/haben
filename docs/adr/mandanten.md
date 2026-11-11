---
title: "Entwurf: Mehrere Mandanten in einer Installation"
description: >-
  Entscheidungsvorlage: Varianten für mehrere Gesellschaften in einer Haben-Installation, ihr Eingriff in
  GoBD-Trigger, Audit-Log und Nummernkreise, Empfehlung, Migrationspfad und Sicherheitskonzept.
---

# Entwurf: Mehrere Mandanten in einer Installation

**Status:** Entwurf zur Diskussion, nichts davon ist umgesetzt. **Stand:** `main` bei `93124e3` (10. November 2026).
**Bezug:** [#66](https://github.com/firsttris/haben/issues/66) (abgelehnt, „vorerst“), [Roadmap](../roadmap.md),
[Betrieb mehrerer Instanzen](../installation.md).

## Ausgangslage und Annahmen

Haben ist bewusst für eine Firma gebaut: `company` hat genau eine Zeile (`id = 1`, CHECK `company_single_row`), ebenso
`mail_settings`, `inbox_settings`, `enable_banking_settings`, `lexoffice_connection`, `sevdesk_connection`,
`company_logo`, `letterhead_background` und `vat_items_since`; es gibt genau einen lokalen Inhaber
(`user_inhaber_single`), die Hash-Kette des Audit-Logs hat einen Kopf (`audit_chain`, eine Zeile, ein Advisory Lock),
und alle Tabellen kennen keinen Mandanten. In #66 hat der Maintainer eine Mandantentrennung über `tenant_id` und Row
Level Security abgelehnt, mit drei Gründen: (1) fast alles wäre betroffen und ein Fehler legte fremde Buchhaltung
offen, (2) Backup, Wiederherstellung, Umzug und Löschung wären je Mandant aufwendig, (3) Hersteller-Rolle (ERiC) und
Auftragsverarbeitung (DSGVO) blieben gleich. Empfohlen wird dort: eine Instanz je Firma hinter einem Reverse Proxy.

**Use Case:** Eine Person verwaltet mehrere Gesellschaften (etwa Holding und operative GmbH) und will sich einmal
anmelden und zwischen ihnen wechseln. Jede Gesellschaft hat eigene Steuernummer, Kontenrahmen, Nummernkreise,
ELSTER-Zertifikat, Bank und Belege.

Annahmen (zu bestätigen):

- **A1** Eine Installation wird von einem Betreiber für eigene Gesellschaften betrieben; ein Hosting für fremde
  Mandanten ist nicht das Ziel (Hersteller- und DSGVO-Fragen bleiben wie in [#66](https://github.com/firsttris/haben/issues/66)).
- **A2** Es gibt weiter nur die zwei Rollen Inhaber und Steuerberatung. Der Inhaber darf alle Mandanten sehen. Eine
  Steuerberatung je Mandant ist eine spätere Stufe.
- **A3** Konsolidierung über Mandanten (Holding-Abschluss) und Buchungen zwischen den Gesellschaften in einer Sicht
  gehören nicht dazu; jede Gesellschaft bucht für sich.
- **A4** Bei genau einem Mandanten soll sich nichts ändern: kein neues Menü, kein neuer Betriebsschritt.

## Variante 0: Heutiger Weg (eine Instanz je Firma)

Mehrere Compose-Projekte hinter einem Reverse Proxy, je Firma eine Subdomain, eigene `.env`, eigenes Backup
([Installation](../installation.md)). Aufwand im Code: keiner. Lücken für den Use Case: mehrere Anmeldungen (mit dem
SSO-Modus lässt sich das mit einem Identity Provider mildern), ERiC je Instanz (über `ERIC_HOME` teilbar), mehrere
Container und Datenbanken zu pflegen, kein Wechsel innerhalb der Oberfläche. Diese Variante ist der Maßstab: Jede
Variante unten muss einen Nutzen bringen, der diese Lücken rechtfertigt.

## Optionen im Vergleich

### Option (a): `company_id` in allen fachlichen Tabellen

Eine Datenbank, eine Spalte `company_id` je Tabelle, Filter in jeder Abfrage, optional Row Level Security.

| Kriterium | Bewertung |
| --- | --- |
| Aufwand | Sehr hoch. Rund 115 Tabellen in `schema.ts`, 128 Dateien importieren `db`, 217 Aufrufe von `withActor`, 59 Dateien mit `db.select/insert/update/delete`. Jede Abfrage und jeder Eindeutigkeitsindex (Rechnungsnummer, `documents.sha256`, `debitor_nr`, externe Referenzen) braucht den Mandanten. |
| GoBD-Trigger | Hohes Risiko. Alle Sperren und Siegel (`*_locked`, Siegelfunktionen aus `0063`/`0064`) und die Soll-Haben-Prüfung müssten den Mandanten kennen, sonst prüfen oder versiegeln sie über Mandanten hinweg. Bestehende Migrationen dürfen nicht geändert werden, also wären es neue `CREATE OR REPLACE FUNCTION`-Migrationen auf versiegelten Tabellen. Genau dort gilt „Sperren nie lockern“. |
| Audit-Log | Hoch. `audit_log`/`audit_chain` sind eine Kette mit einem Kopf. Je Mandant eine Kette heißt: `seq` und Kopf je Mandant, Advisory Lock je Mandant, Prüfung (`integrity`) und wöchentlicher Prüfwert je Mandant. Bleibt es bei einer gemeinsamen Kette, verknüpft sie die Mandanten und jede Schreibtransaktion aller Mandanten läuft nacheinander. |
| Migration | Mittel bis hoch. `ADD COLUMN company_id … DEFAULT 1` ist ohne Zeilenänderung möglich (keine UPDATE-Trigger, Siegel bleiben gültig), aber Primärschlüssel der Einzeltabellen (`id = 1`) und alle Eindeutigkeitsindizes müssen umgebaut werden. |
| Eingriff in Code | Größter. Ein vergessener Filter ist ein Datenleck; genau das Risiko aus #66. RLS fängt es ab, braucht aber `SET LOCAL` je Transaktion und eine App-Rolle, die kein Tabelleneigentümer ist (heute verbindet die App als Eigentümer, `buchhaltung.md`). |
| Nebenwirkungen | Dateiablage unter SHA-256 ist mandantenübergreifend; `fileInUse` zählt nur eine Datenbank. Backup und Löschung eines Mandanten sind Abfragen statt Dateien. |

### Option (b): Postgres-Schema je Mandant

Eine Datenbank, ein Schema je Mandant (`mandant_<slug>`), `search_path` je Transaktion.

| Kriterium | Bewertung |
| --- | --- |
| Aufwand | Mittel. Der Anwendungscode bleibt weitgehend unberührt, wenn `search_path` zentral in `withActor` gesetzt wird. |
| GoBD-Trigger | Trigger und Funktionen müssen je Schema vorhanden sein. Die Migrationen sind aber nicht schemaneutral: 51 der 190 SQL-Dateien nennen `"public".` ausdrücklich (Fremdschlüssel, Funktionen). Sie ließen sich nicht unverändert je Schema abspielen; bestehende Migrationen zu ändern ist verboten. |
| Audit-Log | Kette je Schema möglich, aber der Advisory Lock `hashtext('haben.audit_chain')` ist datenbankweit und müsste je Schema schlüsseln. Better-Auth-Tabellen (`user` mit Audit-Trigger) liegen in `public` und schrieben in die Kette welchen Schemas? |
| Migration | Eigener Migrationslauf je Schema mit eigenem Journal; Drizzle kann das nicht ohne Eigenbau. |
| Eingriff in Code | Gering im Code, aber ein eigener Migrator, und ein falsch gesetzter `search_path` (Connection-Pool!) schreibt in den falschen Mandanten. |
| Nebenwirkungen | Ein `pg_dump` je Schema geht, Rollen und Rechte je Schema sind aufwendig; das Gesamtbackup bleibt eines. |

### Option (c): Datenbank je Mandant mit Mandantenwahl

Der bestehende Datenbankvertrag bleibt Wort für Wort gültig: jede Gesellschaft hat eine eigene Datenbank mit dem
unveränderten Schema (alle 190 Migrationen, alle Trigger, eigene Hash-Kette, eigene Siegel, eigene Nummernkreise).
Neu ist nur eine Schicht darüber: ein Verzeichnis der Mandanten und die Auswahl der Verbindung je Anfrage.

| Kriterium | Bewertung |
| --- | --- |
| Aufwand | Mittel, vor allem Infrastruktur: Mandantenverzeichnis, Verbindungsverwaltung, Auswahl je Anfrage, Scheduler-Schleife, Migrationsschleife, Dateiablage je Mandant, Backup je Datenbank. |
| GoBD-Trigger | **Keine Änderung.** Kein Trigger, keine Funktion, kein Siegel wird angefasst; jede Datenbank ist für sich ein vollständiges, unverändertes Haben. Soll = Haben, Festschreibung, Kontenrahmen-Prüfung gelten je Mandant genau wie heute. |
| Audit-Log | **Keine Änderung.** Eine Kette je Mandant; Prüfung, Prüfwert-Mail und Jahresarchiv bleiben je Datenbank richtig. Offen ist nur, wo Anmeldungen stehen (siehe Sicherheitskonzept). |
| Migration | Bestehende Installation = erster Mandant, keine Datenbewegung. Neue Mandanten starten mit einer frisch migrierten Datenbank. |
| Eingriff in Code | Klein, wenn `db` und `withActor` den Mandanten aus dem Anfragekontext lösen (`AsyncLocalStorage`, wie schon `runReadOnly` in `db/actor.ts`). Die 128 importierenden Dateien bleiben unverändert. |
| Nebenwirkungen | Mehr Verbindungen (Pool je Mandant, klein und träge anlegen). Keine SQL-Auswertung über Mandanten (A3). Migrationen laufen je Datenbank beim Start. `CREATE DATABASE` braucht das Recht `CREATEDB`, oder der Betreiber legt die Datenbank an. |

## Empfehlung

**Zuerst Variante 0 ausreizen, dann (c), wenn der Maintainer den Bedarf anerkennt. (a) und (b) nicht.**

Begründung: Die drei Einwände aus #66 treffen (c) am wenigsten.

1. *Risiko eines Datenlecks:* In (c) kann keine Abfrage zwei Mandanten mischen, weil jede Verbindung genau eine Datenbank
   sieht. Fehler bleiben auf „falscher Mandant gewählt“ beschränkt (zu prüfen in einem Test, siehe unten) und sind
   nicht „Filter vergessen“. Eine vergessene Zeile Code in 217 `withActor`-Aufrufen kann nichts leaken.
2. *Betrieb:* Backup, Wiederherstellung, Umzug und Löschung eines Mandanten bleiben Datenbank plus Ordner.
3. *Rechtliches:* ändert sich nicht (A1).

Gegen (a): größter Eingriff in genau die Trigger und Siegel, die nie gelockert werden sollen. Gegen (b): die
Migrationen sind nicht schemaneutral, ein eigener Migrator wäre nötig, und der Nutzen gegenüber (c) ist gering.

**Single-Tenant bleibt unverändert (A4):** Gibt es genau einen Mandanten, ist der Kontext leer, `db` zeigt auf
`DATABASE_URL`, die Oberfläche zeigt keine Mandantenwahl. Das Mandantenverzeichnis entsteht erst beim Anlegen des
zweiten Mandanten.

### Skizze von (c)

- **Verzeichnis:** Tabelle `tenants` (`id`, `slug`, `name`, `database_name`, `created_at`, nur anhängen/archivieren,
  Audit) in der bisherigen Datenbank. Diese bleibt Mandant 1 und hält weiter die Tabellen von Better Auth.
- **Verbindung:** `db` wird ein Proxy auf `currentTenant().db`. Pools je Mandant, `max` klein, Leerlauf-Timeout;
  `closeDatabase()` schließt alle. Die Datenbank-URL entsteht aus `DATABASE_URL` mit anderem Datenbanknamen; kein
  zusätzliches Geheimnis in einer Tabelle.
- **Fail closed:** Gibt es mehr als einen Mandanten und fehlt der Kontext, wirft `db` einen Fehler, statt still auf
  Mandant 1 zu fallen. Ein vergessener Kontext schreibt so nie in den falschen Mandanten.
- **Auswahl:** Cookie mit der Mandanten-ID, bei jeder Anfrage gegen die Mitgliedschaft des Kontos geprüft (A2: der
  Inhaber hat alle). API-Tokens (`mcp_tokens`) und das Kalender-Abo bekommen den Mandanten fest (Token gilt für genau
  einen Mandanten; das Kalender-Abo trägt die Mandanten-ID in der Adresse).
- **Dateien:** `DOCUMENTS_DIR/<slug>/ab/abcdef…`. Mandant 1 behält den bisherigen Ordner. Ein gemeinsamer Ordner wäre
  falsch: `fileInUse` zählt nur die eigene Datenbank und löschte eine Datei, die ein anderer Mandant noch braucht.

## Betroffene Bereiche

Wirkung bei Variante (c). Bei (a) wäre jede Zeile mit „Ja“ ein Umbau der Trigger oder Abfragen.

| Bereich | Heute | Bei (c) |
| --- | --- | --- |
| Tabellen (rund 115) | eine Datenbank | je Mandant eine Datenbank, Schema unverändert; die Tabellen von Better Auth (`user`, `session`, `account`, `passkey`, `invitations`, `user_logins`, `sso_*`, `token_events`) und `mcp_tokens`/`mcp_calls` gelten nur in der Hauptdatenbank |
| Festschreibung (`journal_entries`, `invoices`, `documents`, `vat_returns`, Lohn) | Trigger je Tabelle | unverändert, je Datenbank |
| Soll = Haben, Kontenrahmen = Firmendaten (`0065`) | Trigger | unverändert; `company` ist je Mandant eine Zeile, Kontenrahmen und Rechtsform sind je Mandant frei |
| Audit-Log und Hash-Kette, Siegel | eine Kette, ein Kopf, ein Advisory Lock | eine Kette je Mandant; wöchentlicher Prüfwert und Integritätsprüfung je Mandant |
| Nummernkreise (`invoice_number_counters`, `quote_number_counters`, `cash_entries`, Personalnummern, Debitoren/Kreditoren) | je Jahr, lückenlos, Advisory Lock | je Mandant und Jahr, unverändert; `number_year`-Kreis bleibt |
| Dateiablage `DOCUMENTS_DIR` | ein Ordner, SHA-256 | Unterordner je Mandant (siehe oben); Sicherung und Löschung je Mandant |
| ELSTER-Zertifikat, PIN, ERiC | `elster_certificates` (verschlüsselt), ERiC-Paket in `ERIC_DIR` | Zertifikat je Mandant in dessen Datenbank; das ERiC-Paket und die Hersteller-ID bleiben gemeinsam; temporäre Zertifikatsordner je Aufruf bleiben; Sendesperre (`underSendLock`) je Datenbank |
| Lexoffice und sevDesk | `*_connection` (eine Zeile), Importe | je Mandant eine Verbindung; laufende Importe (`running`-Maps) sind nach ID getrennt |
| SMTP und IMAP | `mail_settings`, `inbox_settings` | je Mandant; `quietCheckAt` in `mail.ts` ist Prozesszustand und muss je Mandant geführt werden |
| Bankverbindungen | `bank_accounts`, `bank_connections`, `enable_banking_settings` | je Mandant; Anwendungs-ID aus der Umgebung bleibt gemeinsam |
| Scheduler | ein Timer, `runScheduledJobs` mit Akteuren `system:*` | je Lauf eine Schleife über die Mandanten, je Mandant im eigenen Kontext, ein Fehler stoppt die anderen nicht; `running`-Sperre bleibt prozessweit |
| Wiederkehrende Rechnungen, Dauerbelege, Kontoabruf, Postfach, Kurse, Basiszins, IMAP, Fristenmails, Prüfwert-Mail | je Lauf | je Mandant, siehe Scheduler |
| Jahresexport und DATEV-Export | je Jahr, `export/$jahr` | je Mandant (Kontext der Anfrage); der Export enthält weiter keine Geheimnisse |
| Kalender-Abo-Token | in `company.calendar_token_hash` | je Mandant; Adresse trägt den Mandanten |
| API-Tokens (MCP, REST) | `mcp_tokens` | Spalte Mandant; ein Token gilt für genau einen |
| Verschlüsselung `HABEN_ENCRYPTION_KEY` | ein Schlüssel | zunächst ein Schlüssel für alle; ein Schlüssel je Mandant wäre eine spätere Stufe (offene Frage) |
| Backup (`deploy/backup`) | `pg_dump` einer Datenbank, Belegordner | Schleife über die Datenbanken laut Verzeichnis und über die Unterordner; Test-Restore je Mandant |
| Prozesszustand | `elster.ts` (Client je ERiC-Ordner), `bank-sync.ts` (Bankliste), `mail.ts` | prüfen, welcher Zustand je Mandant sein muss (Inventur im ersten Commit) |

## Migrationspfad bestehender Installationen

1. Update einer Installation ohne weiteren Mandanten: **nichts**. Die bisherige Datenbank ist Mandant 1, es gibt keine
   neue Spalte und keine Datenmigration. Es wird kein festgeschriebener Datensatz berührt, also bleiben Trigger,
   Siegel und Hash-Kette unverändert.
2. Eine neue Migration legt `tenants` an (kein Eingriff in vorhandene Tabellen, Audit-Trigger nach Regel) und trägt
   Mandant 1 mit `database_name` aus `DATABASE_URL` und Slug `standard` ein; Name aus `company.name`.
3. Zweiter Mandant: Anlegen in den Einstellungen → `CREATE DATABASE`, Migrationen, Ordner `DOCUMENTS_DIR/<slug>`,
   danach die Einrichtung wie die Erstinstallation (Firmendaten, Kontenrahmen).
4. Eine bestehende zweite Instanz lässt sich nachträglich als Mandant einhängen, indem ihre Datenbank mit `pg_dump`
   in eine neue Datenbank des Servers eingespielt und ihr Belegordner unter `DOCUMENTS_DIR/<slug>` abgelegt wird.
   Die Siegel stimmen weiter, weil nichts umgerechnet wird; die Prüfung der Hash-Kette bleibt je Mandant grün.
   (Zu prüfen: `HABEN_ENCRYPTION_KEY` beider Instanzen muss gleich sein, sonst lassen sich Zertifikat und Zugänge nicht lesen.)

## Sicherheitskonzept

- **Serverseitig erzwungen, nie nur im UI.** Die Auswahl des Mandanten geschieht in `authMiddleware`/`readMiddleware`
  und in `requireUser` (Sitzung → Konto → erlaubte Mandanten → Kontext), bevor ein Handler läuft. Ein Mandant, der nicht in der
  Mitgliedschaft des Kontos steht, wird wie „nicht gefunden“ abgelehnt (kein Hinweis auf seine Existenz).
- **Kein stilles Zurückfallen:** Mit mehr als einem Mandanten wirft `db` ohne Kontext. Hintergrundarbeit, die aus einer
  Anfrage startet, erbt den Kontext (`AsyncLocalStorage` überlebt Promises); der Scheduler setzt ihn je Mandant selbst.
- **Token und Kalender-Abo:** gebunden an einen Mandanten; der Mandant steht im Token-Datensatz, nicht in der Anfrage.
  Ein Token eines Mandanten kann nie in einem anderen lesen.
- **Rollen:** `rollen.test.ts` liest alle Server Functions und Routen aus dem Quelltext und bleibt die Absicherung; es wird
  um die Regel ergänzt, dass jede Funktion den Mandantenkontext über die Middleware bekommt. Die Steuerberatung bleibt
  schreibgeschützt (`runReadOnly`), je Mandant (A2: später).
- **Trennung der Geheimnisse:** Zertifikat, PIN und Zugangsdaten liegen verschlüsselt (`ciphertext`) in der Datenbank
  des jeweiligen Mandanten. Mit einem gemeinsamen Schlüssel ist die Trennung organisatorisch, nicht kryptografisch;
  das wird so dokumentiert.
- **Anmeldedaten und deren Audit:** Better Auth bleibt in der Hauptdatenbank (Mandant 1); An- und Abmeldungen stehen in
  deren Kette. Offen: ob das für Mandant 1 störend ist (siehe offene Fragen).
- **Row Level Security** wurde geprüft und ist für (c) nicht nötig. Sie wäre bei (a) das Sicherheitsnetz, bräuchte aber
  eine App-Rolle ohne Tabelleneigentum, `SET LOCAL` je Transaktion und eine Anpassung jedes Triggers; das ist der
  Aufwand, den (c) vermeidet.

## Tests (Umsetzung, nach Freigabe)

- Vitest in `packages/core`: keine neue Fachlogik erwartet, nur reine Funktionen für Slug und Datenbanknamen.
- Postgres-Tests (`TEST_DATABASE_URL`): zwei Mandanten; A schreibt, B sieht nichts (Rechnungen, Belege, Journal,
  Kontakte, Dateien); Nummernkreis, Hash-Kette und Siegel je Mandant lückenlos; `db` ohne Kontext wirft bei zwei
  Mandanten; Anfrage mit fremdem Mandanten wird abgelehnt; Token-Bindung; Scheduler läuft je Mandant und ein Fehler in
  einem hält die anderen nicht an; Migration einer bestehenden Ein-Mandanten-Datenbank ändert keinen festgeschriebenen
  Datensatz (Siegel- und Kettenprüfung vor und nach dem Update).
- Playwright: zweiten Mandanten anlegen, wechseln, Daten bleiben getrennt; bei einem Mandanten fehlt die Auswahl.

## Offene Fragen an den Maintainer

1. Ist die Ablehnung aus #66 bei einer Variante, die keinen Trigger und keine Abfrage ändert (c), noch gültig?
2. Soll die Hauptdatenbank zugleich Mandant 1 sein (keine Datenbewegung) oder getrennt vom Verzeichnis liegen?
3. Soll `CREATEDB` vorausgesetzt werden oder legt der Betreiber Datenbanken an?
4. Ein Schlüssel `HABEN_ENCRYPTION_KEY` für alle oder je Mandant?
5. Reicht für die erste Stufe „Inhaber sieht alle Mandanten“ (A2)?
6. Wo soll die Seite hin, als ADR in `docs/adr/` (neu) oder in die Architektur?

## Stufen der Umsetzung

1. Inventur des Prozesszustands und Mandantenverzeichnis (Schema, Migration, Audit-Trigger).
2. Verbindungen und Kontext (`db`, `withActor`, fail closed), Dateiablage je Mandant.
3. Auswahl in Middleware und Routen, Token-Bindung, Kalender-Abo.
4. Oberfläche: Mandant anlegen, wechseln; bei einem Mandanten unsichtbar.
5. Scheduler und Migrationslauf je Mandant.
6. Export, Backup-Skripte.
7. Doku (`architektur.md`, `einrichtung.md`, `installation.md`, `roadmap.md`).
