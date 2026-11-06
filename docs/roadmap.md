# Roadmap

Was als Nächstes geplant ist, was blockiert ist und woher die Unterlagen dafür kommen. Erledigtes steht in den jeweiligen Kapiteln der Doku.

## Geplant

Stand 6. November 2026, nach Abgleich mit Lexware Office und sevDesk und den offenen Issues. Die Reihenfolge: zuerst Fehler, dann kleine Wünsche aus dem Alltag, dann was Freiberuflern und kleinen GmbHs beim Buchen am meisten fehlt.

Erledigt aus der letzten Runde: Lohnsteuer-Anmeldung, Ausfüllliste für das SV-Meldeportal und Lohnsteuerbescheinigung ([Lohn](lohn.md)), E-Bilanz-Taxonomie 6.10 ([E-Bilanz](buchhaltung.md#e-bilanz-gmbh-und-ug)), Voranmeldung als offener Posten ([Umsatzsteuer](umsatzsteuer.md#zahlung-an-das-finanzamt)), degressive AfA ([Anlagen](anlagen.md#degressive-afa)), innergemeinschaftliche Lieferung und Erwerb, Ausfuhr ([Umsatzsteuer](umsatzsteuer.md#innergemeinschaftlicher-erwerb)), Dauerbelege ([Belege](belege.md#dauerbelege)), Barzahlung einer Rechnung ([Kasse](kasse.md#rechnung-bar-bezahlt)), Zugang für die Steuerberatung, Stufe 1 ([Steuerberatung](steuerberatung.md)), Belegerkennung mit lokalem Modell ([KI-Auslesung](belege.md#ki-auslesung)), Rabatte, optionale Positionen und Zahlungsplan ([Angebote](angebote.md#zahlungsplan)), Steuerzahlungen und Darlehen ([Bank](bank.md#darlehen)).

### Zuerst: Fehler

| # | Thema | Worum es geht | Aufwand |
| --- | --- | --- | --- |
| F1 | Darlehen: Stichtag der Übernahme | Die Restschuld eines übernommenen Darlehens enthält alle Tilgungen bis zum Stichtag; Haben zieht eine zugeordnete Tilgung vom Stichtag oder davor aber noch einmal ab. Zuordnungen bis zum Stichtag ablehnen ([#325](https://github.com/firsttris/haben/issues/325)) | S |
| F2 | Erstattungszinsen zur Gewerbesteuer | Haben lehnt sie ab und hält sie für steuerfrei. Sie sind aber Betriebseinnahmen (BFH, Urteil vom 26.09.2025, IV R 16/23); buchen wie Erstattungszinsen zur Umsatzsteuer. Erstattungszinsen zur Körperschaftsteuer bleiben steuerfrei (§ 10 Nr. 2 KStG) und weiter abgelehnt ([#312](https://github.com/firsttris/haben/issues/312)) | S |

### Danach

| # | Thema | Worum es geht | Aufwand |
| --- | --- | --- | --- |
| 1 | Kleine Wünsche aus dem Alltag | Telefonnummer am Kontakt ([#322](https://github.com/firsttris/haben/issues/322)); Platzhalter `{MM}` im Nummernformat, Monat und Jahr aus dem Rechnungsdatum, der Zähler bleibt jährlich ([#328](https://github.com/firsttris/haben/issues/328)); Kontakt direkt im Beleg und im Rechnungsentwurf anlegen, danach ist er ausgewählt, die Eingaben bleiben erhalten ([#330](https://github.com/firsttris/haben/issues/330)); „Ohne Rechnung buchen“ im Bankabgleich heißt „Direkt buchen“ ([#312](https://github.com/firsttris/haben/issues/312)) | S |
| 2 | Direkt buchen mit Kategorie und Steuersatz, weitere Kategorien | Einen Bankumsatz ohne Beleg auf eine Einnahme- oder Ausgabekategorie mit Steuersatz buchen, z. B. die Zahlung eines Privatkunden mit 19 % ([#324](https://github.com/firsttris/haben/issues/324)); dazu die fehlenden Kategorien Miete, sonstiger Betriebsbedarf, Reparatur sonstiger Anlagen, sonstige Fahrzeugkosten, Berufsgenossenschaft, Versorgungskassen – je mit Zuordnung für EÜR, E-Bilanz und HGB in SKR03 und SKR04; Miete auch für die Dauerbelege ([#312](https://github.com/firsttris/haben/issues/312)) | S–M |
| 3 | Vorschläge aus allen früheren Zuordnungen lernen | Kategorie und Buchungsart im Bankabgleich und bei Belegen aus allen früheren Zuordnungen vorschlagen, mit Begründung, ohne KI-Modell, immer zu bestätigen ([#295](https://github.com/firsttris/haben/issues/295)) | S–M |
| 4 | Gestaltung der Belege | Schrift aus einer festen Auswahl eingebetteter, PDF/A-tauglicher Schriften, Fußzeile in bis zu vier Spalten mit Platzhaltern, Briefpapier als PDF-Hintergrund; in der bestehenden Typst-Vorlage, PDF/A-3 und ZUGFeRD bleiben unverändert ([Rechnungen](rechnungen.md)) ([#113](https://github.com/firsttris/haben/issues/113)) | S–M |
| 5 | Eigene Sachkonten | Eigenes Konto mit Name und Nummer, das Steuer-, EÜR- und E-Bilanz-Zuordnung einer bestehenden Kategorie ausdrücklich erbt (auch „EÜR-neutral“); Buchungen behalten die damals gültige Zuordnung; danach lässt sich auch direkt auf ein eigenes Konto buchen. Vor dem Bau ist zu entscheiden, wie Konten und Kostenstellen an Beleg- und Buchungszeilen hängen (gemeinsam mit Platz 6 und 7) ([#270](https://github.com/firsttris/haben/issues/270)) | M |
| 6 | Kostenstellen | Kostenstellen je Beleg- und Rechnungszeile mit Aufteilung, Auswertung je Kostenstelle und Zeitraum, Weitergabe im DATEV-Export (KOST1/KOST2) ([#313](https://github.com/firsttris/haben/issues/313)) | M–L |
| 7 | Personenkonten im DATEV-Export | Debitoren- und Kreditorennummer am Kontakt, getrennt von Kunden- und Lieferantennummer, beide an einem Kontakt möglich, eindeutig in den Bereichen nach DATEV-Kontenrahmen (10000–69999, 70000–99999); der Buchungsstapel setzt sie statt der Sammelkonten ein, das Journal bleibt bei den Sammelkonten; Übernahme aus dem CSV-Import ([#327](https://github.com/firsttris/haben/issues/327)) | S–M |
| 8 | Belegerkennung: PDF-Text zuerst | Hat ein PDF eine Textschicht, liest Haben sie lokal aus (`pdftotext`) und gibt sie dem Modell mit, auf Wunsch ohne Bild für ein reines Textmodell; Kontaktvorschlag aus der E-Rechnung mit Anschrift, USt-IdNr. und IBAN des Verkäufers ([#329](https://github.com/firsttris/haben/issues/329), [#330](https://github.com/firsttris/haben/issues/330)) | S |
| 9 | Bank-CSV, Etsy und Export für die Betriebsprüfung | Bank-, Kreditkarten- und PayPal-Umsätze im allgemeinen CSV-Format mit Spaltenzuordnung; Etsy-Monatsabrechnung als Zahlungsdienstleister, die Beispieldatei liegt vor ([#296](https://github.com/firsttris/haben/issues/296)); Datenexport mit Beschreibung `index.xml` für die Prüfsoftware | S–M |
| 10 | Darlehen: Unterlagen und Restlaufzeit | Vertrag und Tilgungsplan am Darlehen ablegen, Verlauf der Raten mit Tilgung, Zins und Gebühr ([#312](https://github.com/firsttris/haben/issues/312)); Restlaufzeit zum Bilanzstichtag für Bilanz und E-Bilanz aufteilen (§ 268 Abs. 5 HGB), ohne die alten Buchungen umzudeuten ([#325](https://github.com/firsttris/haben/issues/325)) | S–M |
| 11 | Online-Kundenportal | Link für Kunden: Angebot annehmen, Rechnung als PDF und XML laden, per GiroCode oder Zahlungslink bezahlen | M |
| 12 | BWA und Liquiditätsplanung | Betriebswirtschaftliche Auswertung mit Vorjahresvergleich und Vorschau aus offenen Posten, mit Filter nach Kostenstelle | M |
| 13 | OSS | Rechnungen an Privatpersonen im EU-Ausland mit dem Steuersatz des Ziellands, Lieferschwelle, Datei für das BZSt-Online-Portal | M |
| 14 | Offene Posten ohne Bankumsatz verrechnen | Rechnung gegen Gutschrift oder Storno ausgleichen, zuerst Eingangsbelege desselben Lieferanten; vor dem Bau fachlich zu klären (Aufrechnung oder Aufhebung, Ist und Soll) ([#274](https://github.com/firsttris/haben/issues/274)) | M |

## Später oder vielleicht

Sinnvoll, aber nicht jetzt – in dieser Reihenfolge, wenn die Plätze oben erledigt sind:

| # | Thema | Worum es geht | Aufwand |
| --- | --- | --- | --- |
| S1 | Bankumsätze über eine gemeinsame Importschnittstelle | Ein Importvertrag für Enable Banking, CSV/CAMT, Zahlungsdienstleister und externe Connectoren (z. B. Vivid, PayPal), idempotent, ohne Zuordnung oder Buchung ([#306](https://github.com/firsttris/haben/issues/306)) | M–L |
| S2 | Absender- bzw. Markenprofile | Ein Unternehmen, mehrere Marken mit Logo, Farbe, Kontakt, Bankkonto, Texten und eigenem Mail-Absender; baut auf Platz 4 auf ([#245](https://github.com/firsttris/haben/issues/245)) | M |
| S3 | API ausbauen | Webhooks, Angebote, Artikel, offene Posten und weitere schreibende Endpunkte ([#297](https://github.com/firsttris/haben/issues/297)) | M |
| S4 | Eigene Rechnung beim Beleg-Upload erkennen | Eine hochgeladene eigene Ausgangsrechnung an der eigenen USt-IdNr. im XML erkennen statt sie als Ausgabe vorzuschlagen ([#104](https://github.com/firsttris/haben/issues/104)) | S |
| S5 | Ausgangsrechnungen aus Fremdsystemen | Rechnungen aus Shop oder Backoffice mit fremder Nummer und PDF übernehmen, als offener Posten ([#104](https://github.com/firsttris/haben/issues/104)) | M |
| S6 | Vollständigere Anlage EÜR | Häusliches Arbeitszimmer, Fahrten zwischen Wohnung und Betriebsstätte, Investitionsabzugsbetrag | M |
| S7 | Fahrtenbuch | Fahrten erfassen statt der 1-%-Regel | M |
| S8 | Weitere Rollen | Mitarbeitende, buchende Steuerberatung, Betriebsprüfer nur lesend; baut auf dem Zugang für die Steuerberatung auf | M |
| S9 | Lastschrift-Datei | Forderungen als SEPA-Lastschrift (pain.008) einziehen, mit Mandaten | M |
| S10 | MCP und OAuth | Connectors in claude.ai über OAuth, schreibender MCP-Server für Entwürfe ([#96](https://github.com/firsttris/haben/issues/96)) | M–L |
| S11 | Eigene Vorlagen | Vorlagen mit Editor und Vorschau, Textformatierung in Positionen ([#113](https://github.com/firsttris/haben/issues/113), Schritt 3) | L |
| S12 | ELStAM | An- und Abmeldung und Abruf der Lohnsteuerabzugsmerkmale; offen, ob es eine freigeschaltete Hersteller-ID braucht | M–L |
| S13 | Weitere Fälle im Lohn | Teilmonate, Einmalzahlungen, Kurzfristige, Auszubildende und weitere Fälle, die heute „nicht unterstützt“ sind | L |
| S14 | Gutschrift als Rechnungsersatz | Abrechnungsgutschrift nach § 14 Abs. 2 Satz 2 UStG ausstellen | M |
| S15 | Sammelrechnung aus Lieferscheinen | Mehrere Lieferscheine zu einer Rechnung zusammenfassen | M |
| S16 | Belege aus Cloud-Speichern | Belege aus Google Drive, Dropbox oder OneDrive übernehmen | M |
| S17 | E-Mail-Versand über Google oder Microsoft | Anmeldung per OAuth statt SMTP-Passwort | M |
| S18 | Module ausblenden | Nicht genutzte Bereiche in der Navigation ausblenden ([#266](https://github.com/firsttris/haben/issues/266)) | S–M |
| S19 | Kleinere Belegfunktionen | Tags, Pro-forma-Rechnung, freier Brief, eigene Kontaktfelder | S |
| S20 | § 13b für Bauleistungen | Bauleistungen als Leistender und als Empfänger | M |
| S21 | Weitere Anlagen und Wertpapiere | Sonstige Transportmittel als Anlage, betriebliche Wertpapiere mit Erwerb, Bestand und Verkauf (Folgearbeit aus [#312](https://github.com/firsttris/haben/issues/312)) | M |
| S22 | Postversand | Rechnungen per Brief über einen Druckdienstleister | M |
| S23 | Rechnungsanhänge erweitern | Zusätzliche Anhänge auch an Serien- und Korrekturrechnungen und über die API ([#272](https://github.com/firsttris/haben/issues/272)) | S |

## Bewusst nicht

| Thema | Grund |
| --- | --- |
| Lagerbestand | Kein Kern einer Buchhaltung; gehört in eine Warenwirtschaft (Lexware Office führt keinen, sevDesk nur als Zusatzmodul) |
| Zeiterfassung und Projekte | Gehört in eigene Werkzeuge; Rechnungen und Belege kommen über die [API](api.md) |
| Eigene Shop-Anbindungen | Abrechnungen der Zahlungsdienste, API und n8n decken das ab; auch Lexware Office bindet Shops nur über Partner an |
| Lastschrifteinzug über einen Zahlungsdienst | Gehört zum Zahlungsdienst; Lexware Office macht es nur über Partner |
| Native Apps | Haben ist eine installierbare Web-App mit Kamera und Teilen-Menü; zwei App-Stores zu pflegen lohnt nicht |
| CRM mit Aufgaben und Push-Erinnerungen, Mitarbeiterportal | Kein Kern einer Buchhaltung für kleine Betriebe |
| Mehrere Firmen in einer Installation | Eine Instanz je Firma; so bleiben Daten, Sperren und Audit getrennt |
| E-Mails als HTML mit Editor | Hoher Aufwand bei wenig Nutzen; Textvorlagen mit Platzhaltern gibt es |
| Eigenes lernendes Modell für Vorschläge | Vorschläge lernen ohne Modell aus allen früheren Zuordnungen (Platz 3); ein Modell kostet Pflege ohne deutlichen Gewinn |
| Zins- und Tilgungspläne berechnen | Den Plan liefert die Bank, die Rate lässt sich aufgeteilt buchen; Zinsmethoden, Sondertilgungen und Schlussraten je Vertrag nachzurechnen kostet viel Pflege für wenig Gewinn. Unterlagen am Darlehen siehe Platz 10 ([#326](https://github.com/firsttris/haben/issues/326)) |
| Frei vergebene Rechnungsnummer je Entwurf | Nummern vergibt Haben beim Festschreiben aus dem Nummernkreis; eine Nummer von Hand müsste Eindeutigkeit und Zähler selbst absichern ([#328](https://github.com/firsttris/haben/issues/328)) |
| Freie Buchung auf jedes Konto mit Steuerschlüssel | EÜR, Voranmeldung und E-Bilanz hängen an den Kategorien; direkt gebucht wird auf eine Kategorie oder ein eigenes Konto mit geerbter Zuordnung (Platz 2 und 5) ([#324](https://github.com/firsttris/haben/issues/324)) |
| Personenkonten im Journal | Offene Posten führt Haben je Rechnung und Beleg; Personenkonten braucht die Steuerberatung im DATEV-Export, dort setzt Haben sie ein (Platz 7) ([#327](https://github.com/firsttris/haben/issues/327)) |
| Texterkennung (OCR) vor dem Modell | Für Scans und Fotos liest ein Vision-Modell besser als OCR mit Textmodell; eine OCR-Engine wäre eine weitere Abhängigkeit im Container ([#329](https://github.com/firsttris/haben/issues/329)) |

## Nicht machbar ohne Zertifizierung oder Lizenz

| Thema | Warum nicht | Was Haben stattdessen tut |
| --- | --- | --- |
| Meldungen an die Sozialversicherung, Beitragsnachweise, Erstattungsanträge | Nur aus systemgeprüften Programmen (§ 95b SGB IV, Prüfung durch die ITSG) | [Ausfüllliste](lohn.md#sv-meldeportal) zum Eintragen im SV-Meldeportal der ITSG |
| Eigenes Geschäftskonto | Banklizenz | Abruf bestehender Konten über Enable Banking |
| DATEV-Online-Schnittstellen | Kostenpflichtige Partnerschaft mit DATEV | DATEV-Export (Buchungsstapel) |
| Hinterlegung des Jahresabschlusses als XML oder XBRL | Schema und XBRL-Vorgaben des Bundesanzeiger Verlags gibt es nur nach einer Freischaltung, ihre Nutzungsbedingungen untersagen die Weitergabe; die Testplattform nur auf Anfrage ([Hinterlegung](buchhaltung.md#xml-oder-xbrl-statt-pdf)) | Bilanz als PDF, das das Register gegen ein Entgelt je Zeichen umwandelt, oder Abtippen im Webformular |
| Kassensystem mit TSE | Elektronische Kassen brauchen eine zertifizierte technische Sicherheitseinrichtung (§ 146a AO) | Kein Kassensystem für den Ladenverkauf; das Kassenbuch führt Bargeld, das nicht über eine Registrierkasse läuft ([Kasse](kasse.md)) |

## Blockiert

| Thema | Was fehlt |
| --- | --- |
| Umsatzsteuererklärung mit Kz 21, 45 und 48 | Die Feldkennungen der Zeilen für nicht steuerbare sonstige Leistungen im übrigen Gemeinschaftsgebiet, übrige nicht steuerbare Umsätze und steuerfreie Umsätze ohne Vorsteuerabzug. Bis dahin sperrt Haben die Übermittlung, wenn solche Umsätze gebucht sind |
| Bescheide automatisch prüfen | Das Format der Bescheiddaten (ESB), um festgesetzte Steuer und neue Vorauszahlungen zu lesen und mit der Erklärung zu vergleichen. Automatischer Abruf und Einspruchsfrist sind fertig ([Finanzamt](finanzamt.md#automatisch-abrufen)) |
| Belege von ELSTER in die Erklärung übernehmen | Die Schemas der Belegarten (Lohnsteuerbescheinigung, Beiträge zur Kranken- und Pflegeversicherung, Rentenbezüge …), um Beträge sicher den Feldern der Erklärung zuzuordnen. Abrufen und Anzeigen ist fertig ([Jahreserklärungen](jahreserklaerung.md#belege-von-elster)) |
| Lohnsteuerbescheinigung ab 2026 über ERiC | Die Schnittstelle der LSTMitteilung (Verfahren ElsterKMV), die ab 2026 die Datenart LStB ablöst; sie steht nur auf esteuer.de, nicht im ERiC-Paket. Bis dahin übermittelst du im ELSTER-Portal und vermerkst die Übermittlung ([Lohn](lohn.md#lohnsteuerbescheinigung)) |
| Strukturierter Antrag auf Anpassung der Vorauszahlungen | Ob es dafür eine ERiC-Datenart gibt und wie ihr Schema aussieht. Bis dahin geht der Antrag als Sonstige Nachricht mit Steuerprognose ([Finanzamt](finanzamt.md#vorauszahlungen-herabsetzen)) |

Das alles steht in der **Jahresdokumentation** der Finanzverwaltung (Schemas und Feldlisten aller Datenarten). Es gibt sie nur im ELSTER-Entwicklerbereich unter developer.elster.de, nach der Registrierung als Softwarehersteller.

## Quellen

Bei der Suche nach Feldkennungen und Abläufen geprüft:

| Quelle | Lizenz | Was drin ist |
| --- | --- | --- |
| [viking](https://github.com/capocasa/viking) | MIT | UStVA, USt-Erklärung, EÜR, ESt mit Anlagen, Sonstige Nachricht, Bankverbindung, Postfach mit Otto; Vorbild für Haben |
| [erica](https://github.com/digitalservicebund/erica) (DigitalService, Steuerlotse) | MIT | Belegabruf (VaSt): Freischaltung beantragen, freischalten, Belege auflisten und abrufen; vereinfachte Einkommensteuererklärung |
| [EasyCash&Tax](https://github.com/Thomas-Mielke-Software/EasyCash) | GPL-3.0 | Feldkennungen der Anlage EÜR und AVEÜR |
| [finamt](https://github.com/spaceoctahedron/finamt) | AGPL-3.0 | Umsatzsteuererklärung |
| [elster-form-helper-api](https://github.com/dennismenken/elster-form-helper-api) | MIT | Zeilen und Texte der Vordrucke für USt, GewSt und KSt 2020–2025, aber keine Feldkennungen |
| [sturm](https://github.com/C-0711/sturm.0711.io) | ohne Lizenzangabe | Feldliste der Jahresdokumentation 2024 (Kontext, Kennung, Format) für alle Anlagen der Einkommensteuer; Haben übernimmt daraus nur die amtlichen Feldkennungen der Anlage N und der Arbeitnehmerzeilen der Anlage Vorsorgeaufwand |
| [lohnsteuer-bmf](https://pypi.org/project/lohnsteuer-bmf/) | MIT | Einkommensteuertarif und Parameter 2024–2026 nach BMF-Programmablaufplan; Referenz für die Tests der Steuerprognose |

Nicht gefunden wurden die Kennungen für Kz 21/45/48 der Umsatzsteuererklärung und ein Schema für den Antrag auf Anpassung der Vorauszahlungen, weder in diesen Projekten noch in Paketen auf npm oder PyPI.
