# Zuordnung der Roadmap zum GitHub Project

Arbeitsdatei für den Umzug der Roadmap aus `docs/roadmap.md` in das Project
<https://github.com/users/firsttris/projects/2>. Stand 11. November 2026, abgeglichen mit `main`
und allen 98 offenen Issues. Die Datei wird vor dem Pull Request wieder entfernt.

## Für den Agenten, der überträgt

- **Vorher im Project:** beim Feld „Bereich“ die Option **Buchhaltung** ergänzen (Bilanz, Konten,
  Kostenstellen, offene Posten); sie fehlt bisher.
- **Je Zeile eine Karte.** Spalte „Karte“ ist das Issue, aus dem die Karte wird. „Entwurf“ heißt:
  kein offenes Issue, als Draft Item anlegen (`gh project item-create`), Titel aus „Thema“, Text aus
  „Hinweis“. Keine Issues anlegen.
- **Weitere Issues** einer Zeile werden je eine eigene Karte direkt unter der Hauptkarte, mit
  demselben Status, Bereich und ohne Aufwand. Jedes Issue kommt nur einmal ins Board.
- **Reihenfolge:** innerhalb einer Spalte wie die Spalte „#“. Das CLI kann nicht umsortieren, das geht
  über GraphQL mit `updateProjectV2ItemPosition` (Feld `afterId`). Am einfachsten in dieser Reihenfolge
  hinzufügen und danach nur prüfen.
- **Status setzen,** auch bei „Geplant“: Der Workflow „Item added to project“ setzt einen Standardwert,
  der umgestellt werden kann.
- **Nichts kommentieren, labeln, schließen** und nichts am Repo ändern.

## Geplant

| # | Thema | Karte | Weitere Issues | Aufwand | Bereich | Hinweis |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | EÜR: Dezember-Vorauszahlung der Umsatzsteuer dem Vorjahr zuordnen | #583 | | S–M | Steuern | Frist: vor dem 10.01.2027 (§ 11 Abs. 2 Satz 2 EStG); Hinweis in Haben und `docs/bank.md` versprechen das heute schon |
| 2 | Soll: Steuer einer Abschlagsrechnung vor der Leistung erst mit dem Zahlungseingang | #622 | | S–M | Steuern | Mindest-Ist (§ 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG); vorher klären, woran Haben eine Anzahlung erkennt |
| 3 | Rücklastschrift und Zahlung nach dem Wechsel der Versteuerung | #623 | | S–M | Steuern | § 17, § 20 UStG, Abschnitt 13.6 UStAE vorher nachlesen |
| 4 | Datenbankrolle der App ohne Recht, Trigger abzuschalten | #619 | | M | Plattform | Schutz der GoBD-Sperren |
| 5 | sevDesk-Umzug vervollständigen | #345 | #472 | M | Umzug | Status **In Arbeit**: Dudeplayz; Testzugang zur API bis 05.12.2026 |
| 6 | Umzug aus WISO EÜR & Kasse, Stufe 1: Anleitung, CSV-Import mit Erinnerungswert und Anlagennummer | #565 | | S | Umzug | Melder stellt zum 01.01.2027 um; Importer als Stufe 2 bei # 19 |
| 7 | Einstellungen in eine neue Instanz übernehmen | #488 | | S–M | Plattform | |
| 8 | Direkt buchen: 0 %, nicht steuerbare Einnahmen, Mahngebühren und Verzugszinsen an Lieferanten | #324 | #610 | S | Bank und Kasse | Vor dem Bau gegen die freien Buchungen (#585) prüfen, was schon geht |
| 9 | Abweichende IBAN auf PDF-Belegen melden | #487 | | S | Belege | Dudeplayz übernimmt; Folge zu #410 |
| 10 | Falsch angelegtes Bankkonto ausblenden, auch aus CAMT-Importen | #580 | | S | Bank und Kasse | Erweitert „Fremdes Bankkonto ausschließen“ (#462, erledigt mit #576) |
| 11 | Oberfläche der Editoren überarbeiten | #355 | #358, #394, #396, #400, #617 | M | Oberfläche | Erledigt: #356, #357, #359, #376, #404; Befehlspalette #617 gegen #613 abgrenzen |
| 12 | Belegtexte am Handy über die Formatierknöpfe des Systems | #495 | | S | Rechnungen | Rest von „Gestaltung der Belege“; erst auf echten Geräten prüfen |
| 13 | Ansprechpartner am Kontakt | #424 | | S–M | Rechnungen | Kann starten: Gestaltung und eigene Layouts sind erledigt (#420, #421) |
| 14 | Rechnungen und Belege eines Kontakts mit Summen je Jahr | #587 | | S–M | Rechnungen | Nur lesend; Umsatz je Kunde später bei BWA (# 28) |
| 15 | Eigene Sachkonten, Sonderbuchungen ohne Bankumsatz | #270 | #502 | M | Buchhaltung | Vor dem Bau gegen #585 und #590 prüfen, was erledigt ist |
| 16 | Kostenstellen | #313 | | M–L | Buchhaltung | |
| 17 | Ausgangsrechnungen aus Fremdsystemen übernehmen | #104 | #496, #558 | M | Rechnungen | Bisher S5, hochgezogen; Bedarf auch aus #566 (Shopware, WISO, Invoice Ninja) |
| 18 | Umzug aus Papierkram.de | #416 | | M | Umzug | |
| 19 | Umzug aus WISO EÜR & Kasse, Stufe 2: Importer | Entwurf | | M | Umzug | Stufe 2 von #565, Beispieldaten liegen vor |
| 20 | Abrechenbare Leistungen | #417 | | M | Rechnungen | |
| 21 | Bank-CSV und Kreditkarte als eigenes Konto | #521 | | S–M | Bank und Kasse | Etsy erledigt (#506); CSV-Beispiele aus #554 liegen vor |
| 22 | Export für die Betriebsprüfung (Datenträgerüberlassung) | #546 | | S–M | Steuern | Vorher aktuelle Fassung des Beschreibungsstandards klären |
| 23 | Privatnutzung von Fahrrädern und E-Bikes | #530 | | S–M | Steuern | Drei Punkte vorher am UStAE klären |
| 24 | Kleinunternehmer: Steuerbefreiungen und nicht steuerbare Umsätze | #433 | | M | Steuern | |
| 25 | Unterlagen nachreichen, Restlaufzeit der Darlehen | #325 | | S–M | Belege | Teile aus #312 und #345 |
| 26 | Bilanzierendes Einzelunternehmen | #418 | #507 | M–L | Buchhaltung | |
| 27 | Online-Kundenportal, Stufe 1: PDF und XML laden, GiroCode | #577 | | M | Rechnungen | Annahme von Angeboten als spätere Stufe (§ 312j BGB) |
| 28 | BWA und Liquiditätsplanung | Entwurf | | M | Buchhaltung | Vorjahresvergleich, Vorschau aus offenen Posten, Filter nach Kostenstelle |
| 29 | OSS | Entwurf | | M | Steuern | Steuersatz des Ziellands, Lieferschwelle, Datei für das BZSt |
| 30 | Offene Posten ohne Bankumsatz verrechnen | #274 | | M | Buchhaltung | Vor dem Bau fachlich klären |
| 31 | Mehrere Betriebe | #484 | | L | Buchhaltung | Baut auf Kostenstellen auf |

## Später

| # | Thema | Karte | Weitere Issues | Aufwand | Bereich | Hinweis |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Bankumsätze über eine gemeinsame Importschnittstelle | #306 | #611 | M–L | Bank und Kasse | #611: PayPal und eBay per API |
| 2 | Absender- bzw. Markenprofile | #245 | | M | Rechnungen | |
| 3 | API ausbauen | #297 | #439 | M | Plattform | |
| 4 | Vollständigere Anlage EÜR | Entwurf | | M | Steuern | Arbeitszimmer, Fahrten Wohnung–Betrieb, Investitionsabzugsbetrag |
| 5 | Fahrtenbuch | Entwurf | | M | Steuern | |
| 6 | Weitere Rollen | #607 | | M | Plattform | Mitarbeitende, buchende Steuerberatung, Betriebsprüfer |
| 7 | MCP und OAuth | #96 | | M–L | Plattform | |
| 8 | Vorlagen-Editor | #113 | | L | Rechnungen | Schritt 3 von #113; Schritte 1 und 2 erledigt |
| 9 | ELStAM | Entwurf | | M–L | Lohn | |
| 10 | Weitere Fälle im Lohn | Entwurf | | L | Lohn | |
| 11 | Gutschrift als Rechnungsersatz | Entwurf | | M | Rechnungen | § 14 Abs. 2 Satz 2 UStG |
| 12 | Lieferschein als eigener Beleg, Sammelrechnung | #390 | | M | Rechnungen | |
| 13 | Belege aus Cloud-Speichern | Entwurf | | M | Belege | |
| 14 | E-Mail-Versand über Google | Entwurf | | M | Plattform | |
| 15 | Module ausblenden | #266 | | S–M | Oberfläche | |
| 16 | Kleinere Belegfunktionen | Entwurf | | S | Rechnungen | Tags, Pro-forma-Rechnung, freier Brief, eigene Kontaktfelder |
| 17 | § 13b für Bauleistungen | Entwurf | | M | Steuern | |
| 18 | Wertpapiere | Entwurf | | M | Buchhaltung | Folge aus #312 |
| 19 | Postversand | Entwurf | | M | Rechnungen | |
| 20 | Rechnungsanhänge erweitern | #272 | | S | Rechnungen | |
| 21 | Fremdwährung erweitern | #516 | | M | Rechnungen | |
| 22 | Aufgeteilte Belege mit Sonderfällen | Entwurf | | M | Belege | § 13b je Zeile erledigt (#531) |
| 23 | Weitere Zahlungsdienstleister | Entwurf | | S | Bank und Kasse | SumUp, Amazon; Google Play und App Store erledigt (#578) |
| 24 | Zeitstempel für das Audit-Log | Entwurf | | S–M | Plattform | RFC 3161 |
| 25 | Backup in der Wochenmail | Entwurf | | S | Plattform | |
| 26 | Installationsvorlagen | #414 | | S–M | Plattform | |
| 27 | Mehrere Instanzen mit einem Werkzeug | #504 | | S | Plattform | |
| 28 | Privatkonten je Gesellschafter | Entwurf | | M | Buchhaltung | GbR, PartG |
| 29 | Haben als App auf dem Mac (Doku) | #553 | | S | Plattform | Vom Melder auf eine Anleitung verkleinert |

## Rückmeldung

Umgesetzt, das Issue bleibt offen, bis die Meldenden bestätigen oder 14 Tage vergehen. Ohne Aufwand,
Reihenfolge egal.

| Karte | Bereich | Umgesetzt mit |
| --- | --- | --- |
| #114 | Rechnungen | Zahlungsplan im Angebot |
| #128 | Belege | Belegerkennung mit lokalem Modell |
| #273 | Steuern | Innergemeinschaftlicher Erwerb |
| #276 | Bank und Kasse | Kasse |
| #296 | Bank und Kasse | Etsy (#506) |
| #312 | Buchhaltung | Standardkonten |
| #322 | Rechnungen | Telefonnummer |
| #327 | Buchhaltung | Personenkonten |
| #328 | Rechnungen | Nummernformat |
| #330 | Belege | Kontakt im Entwurf anlegen |
| #342 | Rechnungen | Entwurf als PDF |
| #343 | Umzug | sevDesk-Zahlungen |
| #344 | Umzug | sevDesk-Rollen |
| #346 | Umzug | sevDesk-Archiv |
| #376 | Oberfläche | Kennzahlen am Handy (#568) |
| #389 | Rechnungen | BT-13, BT-14, BT-16 |
| #415 | Rechnungen | Anhänge am Angebot |
| #445 | Bank und Kasse | SEPA-Lastschrift |
| #455 | Bank und Kasse | Barzahlungen |
| #483 | Rechnungen | Knöpfe für Auszeichnung (#485, #517) |
| #457 | Bank und Kasse | Gegenläufige Umsätze verrechnen |
| #462 | Bank und Kasse | Fremdes Konto ausschließen (#576) |
| #486 | Bank und Kasse | Unbestätigte IBAN (#489) |
| #508 | Steuern | § 13b mit Aufteilung (#531) |
| #511 | Plattform | Apache als Proxy (#513, #519); Melder hat bestätigt |
| #518 | Rechnungen | Absenderzeile (#524) |
| #522 | Steuern | Frage zur Testübermittlung, Anlass für #525 (#572) |
| #525 | Steuern | ELSTER-Fehlertext (#572) |
| #554 | Bank und Kasse | Frage beantwortet; Rest bei Geplant # 21 |
| #555 | Bank und Kasse | Bankabruf (#559) |
| #564 | Umzug | JSON-Eingang (#561); Hinweis im Issue fehlt noch |
| #588 | Plattform | Container gehärtet (#593) |


## Nicht ins Board

| Issue | Warum |
| --- | --- |
| #146 | Renovate-Dashboard |
| #213 | Sammlung GmbH, Teile stehen einzeln im Board |
| #326 | Unter „Bewusst nicht“ (Zins- und Tilgungspläne) |
| #385 | Sammlung Doku, intern |
| #387 | Intern, entschieden |
| #434 | Frage, Kandidat für „Bewusst nicht“ (weitere Länder) |
| #497 | „Bewusst nicht“: Vereine (SKR42) |
| #514 | Frage beantwortet, liegt bei Enable Banking |
| #542 | Intern, weitgehend erledigt |
| #560 | „Bewusst nicht“ wie eigene Shop-Anbindungen |
| #566 | Sammlung Umzug |
| #609 | Intern, Folge zu #421 |

## Für die Doku-Seite danach

Nicht fürs Board, aber für den Pull Request, der `docs/roadmap.md` kürzt:

- „Bewusst nicht“: Die Zeile „Freie Buchung auf jedes Konto mit Steuerschlüssel“ widerspricht #585; neu
  fassen. Kandidaten für neue Zeilen: weitere Länder (#434), Anbindung einzelner Reiseportale (#560).
- „Erledigt aus der letzten Runde“ wandert in die Release Notes.
