---
title: "Roadmap: was als Nächstes kommt"
description: >-
  Was in Haben als Nächstes geplant ist, was blockiert ist und welche Wünsche aus den Issues
  zuerst umgesetzt werden.
---

# Roadmap

Was als Nächstes geplant ist, was blockiert ist und woher die Unterlagen dafür kommen. Erledigtes steht in den jeweiligen Kapiteln der Doku.

## Geplant

Stand 9. November 2026, nach Abgleich mit Lexware Office und sevDesk und den offenen Issues bis [#457](https://github.com/firsttris/haben/issues/457). Die Reihenfolge: zuerst kleine Wünsche aus dem Alltag, dann was Freiberuflern und kleinen GmbHs beim Buchen am meisten fehlt.

### Erledigt aus der letzten Runde

**Bank und Kasse**

- „Direkt buchen“ im Bankabgleich ([Bank](bank.md#direkt-buchen), [#312](https://github.com/firsttris/haben/issues/312))
- Direkt buchen auf eine Kategorie mit Steuersatz ([Bank](bank.md#auf-eine-kategorie-buchen), [#324](https://github.com/firsttris/haben/issues/324))
- Vorschläge für Kategorie und Buchungsart aus allen früheren Zuordnungen, ohne KI-Modell, mit Begründung und immer zu bestätigen: im Bankabgleich auch für Direktbuchungen auf eine Kategorie mit Steuersatz und für Zinserträge, bei Belegen auch für die Bezahlung ([Bank](bank.md#vorschläge-ohne-rechnung-und-geldtransit), [Belege](belege.md#vorschläge-aus-früheren-belegen), [#295](https://github.com/firsttris/haben/issues/295))
- Steuerzahlungen und Darlehen ([Bank](bank.md#darlehen), [#312](https://github.com/firsttris/haben/issues/312)); Erstattungszinsen zur Gewerbesteuer als Betriebseinnahme ([Steuerzahlungen](bank.md#steuerzahlungen), [#312](https://github.com/firsttris/haben/issues/312)); Stichtag übernommener Darlehen ([Darlehen](bank.md#darlehen), [#325](https://github.com/firsttris/haben/issues/325))
- Barzahlung einer Rechnung ([Kasse](kasse.md#rechnung-bar-bezahlt), [#276](https://github.com/firsttris/haben/issues/276))

**Belege**

- Dauerbelege ([Belege](belege.md#dauerbelege))
- Weitere Ausgabekategorien mit Konten für EÜR, E-Bilanz und HGB, Miete auch für Dauerbelege ([Kategorien](belege.md#kategorien), [#312](https://github.com/firsttris/haben/issues/312))
- Belegerkennung mit lokalem Modell ([KI-Auslesung](belege.md#ki-auslesung), [#128](https://github.com/firsttris/haben/issues/128))
- Belegerkennung mit dem Text aus der Textschicht des PDFs, auf Wunsch ohne Bilder für ein reines Textmodell, Lieferantenvorschlag aus der E-Rechnung und IBAN nur als Vorschlag mit Herkunft und Prüfziffer ([KI-Auslesung](belege.md#ki-auslesung), [#329](https://github.com/firsttris/haben/issues/329), [#330](https://github.com/firsttris/haben/issues/330))
- Abweichende IBAN der E-Rechnung am Beleg entscheiden, ohne Kontakt-IBAN erst nach Bestätigung, sonst unter Überweisungen gesperrt ([Belege](belege.md#abweichende-iban-in-der-e-rechnung), [#410](https://github.com/firsttris/haben/issues/410))
- Kontakt direkt im Beleg und im Rechnungsentwurf anlegen ([Belege](belege.md), [#330](https://github.com/firsttris/haben/issues/330))
- Eigene Ausgangsrechnung beim Beleg-Upload erkennen, bisher S4 ([Belege](belege.md#eigene-ausgangsrechnung-erkennen), [#104](https://github.com/firsttris/haben/issues/104))

**Rechnungen, Angebote und Kontakte**

- Rabatte, optionale Positionen und Zahlungsplan ([Angebote](angebote.md#zahlungsplan), [#114](https://github.com/firsttris/haben/issues/114))
- Zusätzliche PDF-Anhänge am Angebot, beim Senden einzeln an- oder abzuhaken, und Standardanhänge wie AGB oder Widerrufsbelehrung in den Einstellungen ([Angebote](angebote.md#anhänge), [#415](https://github.com/firsttris/haben/issues/415))
- Bestell-, Auftrags- und Lieferscheinnummer als BT-13, BT-14 und BT-16 ([Rechnungen](rechnungen.md#bestellnummer-auftrag-und-lieferschein), [#389](https://github.com/firsttris/haben/issues/389))
- Artikelnummer in der Position und als BT-155 ([Artikelkatalog](rechnungen.md#artikelkatalog), [#388](https://github.com/firsttris/haben/issues/388))
- Entwürfe von Rechnungen, Angeboten und Mahnungen als PDF mit „ENTWURF“ über jeder Seite, auch im Lohn ([Rechnungen](rechnungen.md#entwurf-als-pdf), [#342](https://github.com/firsttris/haben/issues/342))
- Monat `{MM}` im Nummernformat und durchlaufender Zähler je Nummernkreis ([Nummernformat](einrichtung.md#nummernformat), [#328](https://github.com/firsttris/haben/issues/328))
- Telefonnummer am Kontakt ([Kontakte](rechnungen.md#kontakte), [#322](https://github.com/firsttris/haben/issues/322))

**Steuern, Abschluss und Export**

- Voranmeldung als offener Posten ([Umsatzsteuer](umsatzsteuer.md#zahlung-an-das-finanzamt), [#269](https://github.com/firsttris/haben/issues/269))
- Innergemeinschaftliche Lieferung und Erwerb, Ausfuhr ([Umsatzsteuer](umsatzsteuer.md#innergemeinschaftlicher-erwerb), [#273](https://github.com/firsttris/haben/issues/273))
- Miete und Erhaltungsaufwand in der Anlage EÜR ([Anlage EÜR](jahreserklaerung.md#anlage-eür), [#312](https://github.com/firsttris/haben/issues/312))
- Degressive AfA ([Anlagen](anlagen.md#degressive-afa)); Anlagenart „Sonstige Transportmittel“ ([Anlagen](anlagen.md), [#312](https://github.com/firsttris/haben/issues/312))
- E-Bilanz-Taxonomie 6.10 ([E-Bilanz](buchhaltung.md#e-bilanz-gmbh-und-ug), [#213](https://github.com/firsttris/haben/issues/213))
- Personenkonten im DATEV-Export: Debitor und Kreditor am Kontakt, fest ab dem ersten Export, fehlende vergibt der Export des Inhabers, Schalter ab einem Jahr ([Personenkonten](auswertungen.md#personenkonten), [#327](https://github.com/firsttris/haben/issues/327))

**Lohn**

- Lohnsteuer-Anmeldung, Ausfüllliste für das SV-Meldeportal und Lohnsteuerbescheinigung ([Lohn](lohn.md), [#213](https://github.com/firsttris/haben/issues/213))

**Umzug aus sevDesk**

- Kunden- und Lieferantenrolle ([sevDesk](sevdesk.md), [#344](https://github.com/firsttris/haben/issues/344))
- Sperre bei unklarer Zahlungshistorie ([sevDesk](sevdesk.md), [#343](https://github.com/firsttris/haben/issues/343)); Einzelzahlungen mit Konto und Belegbezug, verdichtete Zahlungen repariert, Beitrag von Dudeplayz ([sevDesk](sevdesk.md), [#343](https://github.com/firsttris/haben/issues/343))
- Angebote, Auftragsbestätigungen und Lieferscheine im Archiv, Beitrag von Dudeplayz ([sevDesk](sevdesk.md), [#346](https://github.com/firsttris/haben/issues/346))

**Oberfläche und Zugänge**

- Seitenkopf mit Titel, Status und Hauptaktionen bleibt beim Scrollen stehen ([Barrierefreiheit](barrierefreiheit.md), [#356](https://github.com/firsttris/haben/issues/356))
- Vorschau angeheftet oder als Überblendung, Beitrag von Dudeplayz ([#357](https://github.com/firsttris/haben/issues/357))
- Zugang für die Steuerberatung, Stufe 1 ([Steuerberatung](steuerberatung.md))

Die Issues zu erledigten Plätzen bleiben offen, bis die Meldenden bestätigen, dass nichts fehlt; ohne Antwort schließen wir sie nach 14 Tagen.

### Reihenfolge

| # | Thema | Worum es geht | Aufwand |
| --- | --- | --- | --- |
| 1 | sevDesk-Umzug vervollständigen | Vorgänge, die in sevDesk nie eine Datei hatten, von fehlgeschlagenen Abrufen und fehlenden Zusatzanhängen unterscheiden ([#345](https://github.com/firsttris/haben/issues/345)); solange der Testzugang zur API läuft (bis 5. Dezember 2026) prüfen und mit anonymisierten Antworten als Testdaten sichern: Anlagenverzeichnis zum Fortführen der AfA, Mahnungen als Archivkopie, Vorlagen wiederkehrender Rechnungen, übermittelte Voranmeldungen; die Anleitung in zwei Wege teilen, über die API (ab Buchhaltung Pro) oder ganz von Hand ([sevDesk](sevdesk.md#ohne-rest-api)). Übernimmt Dudeplayz ([#345](https://github.com/firsttris/haben/issues/345#issuecomment-6726688950)) | M |
| 2 | Oberfläche der Editoren überarbeiten | Positionen im Angebot gezielt als regulär, optional oder Alternative zur Hauptposition anlegen (1a, 1b), Datenmodell unverändert ([#358](https://github.com/firsttris/haben/issues/358)); Kunde und Artikel mit Suche und Trefferliste, kurze Auswahlen bleiben nativ und bekommen nur Theme-Farben ([#359](https://github.com/firsttris/haben/issues/359)). Knopfzeilen einheitlich mit der Hauptaktion rechts ([#394](https://github.com/firsttris/haben/issues/394)), abschließende Aktionen in einer festen Leiste unten ([#396](https://github.com/firsttris/haben/issues/396)) oder gebündelt im Kopf ([#400](https://github.com/firsttris/haben/issues/400)), alle drei zusammen entscheiden ([#355](https://github.com/firsttris/haben/issues/355)); Bestätigungen in einem einheitlichen Dialog statt zweitem Klick oder `window.confirm` ([#404](https://github.com/firsttris/haben/issues/404)); Kennzahlentabelle der Voranmeldung am Handy lesbar ([#376](https://github.com/firsttris/haben/issues/376)). Erledigt sind der feste Seitenkopf ([#356](https://github.com/firsttris/haben/issues/356)) und die Vorschau ([#357](https://github.com/firsttris/haben/issues/357)). Eigenes CSS und eigene Komponenten ohne Bibliothek, barrierefrei nach WAI-ARIA, in kleinen PRs; Vorschläge von Dudeplayz ([#355](https://github.com/firsttris/haben/issues/355)) | M |
| 3 | Gestaltung der Belege | Schrift aus einer festen Auswahl eingebetteter, PDF/A-tauglicher Schriften, Fußzeile in bis zu vier Spalten mit Platzhaltern, Briefpapier als PDF-Hintergrund; in der bestehenden Typst-Vorlage, PDF/A-3 und ZUGFeRD bleiben unverändert ([Rechnungen](rechnungen.md)) ([#113](https://github.com/firsttris/haben/issues/113)) | S–M |
| 4 | Eigene Typst-Vorlage hochladen | Standardvorlage und Beschreibung der Daten herunterladen, außerhalb von Haben frei gestalten und wieder hochladen, ohne Editor in Haben; mehrere Vorlagen mit eigenem Namen nebeneinander, je Belegart wählbar, mitgelieferte Standardvorlagen bleiben; Farbe und weitere Einstellungen bekommt die Vorlage über die dokumentierten Daten; vor dem Speichern prüft Haben die Vorlage mit Beispieldaten als [Entwurfs-PDF](rechnungen.md#entwurf-als-pdf) und ob die Pflichtangaben nach § 14 Abs. 4 UStG darin stehen; nur mitgelieferte Schriften, keine Typst-Pakete aus dem Netz; PDF/A-3 und das ZUGFeRD-XML erzeugt Haben weiter selbst, festgeschriebene Belege behalten ihr PDF ([#113](https://github.com/firsttris/haben/issues/113)) | S–M |
| 5 | Gegenläufige Bankumsätze neutralisieren | Zwei Bankumsätze, die sich aufheben (etwa +1 € und −1 € einer Kartenprüfung bei PayPal), miteinander verrechnen und als erledigt markieren, ohne Buchung und ohne Wirkung auf EÜR und Voranmeldung; die Umsätze bleiben unverändert, mit Notiz und Nachweis im Änderungsprotokoll ([#457](https://github.com/firsttris/haben/issues/457)) | S |
| 6 | Kasse erweitern | Bareinnahme ohne Rechnung, auch als Tagessumme (etwa Barverkauf auf dem Markt, Kleinbeträge ohne Rechnungspflicht), mit Steuerbehandlung, Notiz und Storno wie gehabt ([#276](https://github.com/firsttris/haben/issues/276)); Barzahlung auch vor dem Rechnungsdatum einer Rechnung zuordnen; eine Barzahlung aufteilen, etwa Rechnungsbetrag und Trinkgeld als weitere Einnahme ([#455](https://github.com/firsttris/haben/issues/455)) | S–M |
| 7 | Ansprechpartner am Kontakt | Einen oder mehrere Ansprechpartner je Kontakt mit Name, E-Mail, Telefon und Funktion; im Angebot und in der Rechnung auswählbar, im PDF als „z. Hd.“ unter dem Firmennamen, in der E-Rechnung als Ansprechpartner des Käufers (BT-56); Firmenname und Anschrift bleiben unverändert. Nach Platz 3 und 4, weil die PDF-Vorlage dort umgebaut wird ([#424](https://github.com/firsttris/haben/issues/424)) | S–M |
| 8 | SEPA-Lastschrift | Gläubiger-ID in den Firmendaten, SEPA-Mandat am Kontakt (Mandatsreferenz, Datum, CORE/B2B, Erst- und Folgelastschrift, Mandat als PDF), Zahlungsart „Lastschrift“ an Rechnung und Vorlage mit Hinweis zum Einzug (Pre-Notification), Sammeldatei pain.008 aus fälligen offenen Posten, Sammelgutschrift im Bankabgleich auf die Rechnungen aufteilen, Rücklastschriften erkennen und die Rechnung wieder öffnen, Mandat nach 36 Monaten ohne Einzug ungültig; vorgezogen aus „Später“ ([#445](https://github.com/firsttris/haben/issues/445)) | M–L |
| 9 | Eigene Sachkonten | Eigenes Konto mit Name und Nummer, das Steuer-, EÜR- und E-Bilanz-Zuordnung einer bestehenden Kategorie ausdrücklich erbt (auch „EÜR-neutral“); Buchungen behalten die damals gültige Zuordnung; danach lässt sich auch direkt auf ein eigenes Konto buchen. Zuerst eigene Aufwandskonten, eigene Erlöskonten als zweite Stufe, weil sie zum Steuersatz und zum Steuerschlüssel der Voranmeldung passen müssen ([Entwurf in #270](https://github.com/firsttris/haben/issues/270#issuecomment-6725319195), [#270](https://github.com/firsttris/haben/issues/270)) | M |
| 10 | Kostenstellen | Kostenstellen je Beleg- und Rechnungszeile mit Aufteilung, Auswertung je Kostenstelle und Zeitraum, Weitergabe im DATEV-Export. Erste Stufe: KOST1 an Belegen, Aufteilungszeilen und Anlagen (AfA), Aufteilung über die vorhandene Aufteilung von Belegen, das Datenmodell schon mit KOST2. Zweite Stufe: Rechnungspositionen, dann auch die Erlöse in der Auswertung; KOST2 in der Oberfläche, sobald es gebraucht wird ([Entwurf in #270](https://github.com/firsttris/haben/issues/270#issuecomment-6725319195), [#313](https://github.com/firsttris/haben/issues/313)) | M–L |
| 11 | Umzug aus Papierkram.de | Übernahme über die Papierkram-API nach dem Muster von Lexware Office und sevDesk, nur lesend: Kontakte mit Ansprechpartnern, Rechnungen mit Originalnummer und PDF, Belege mit Dateien, Positionen und Zahlungsstand, Bankumsätze mit Zuordnungen, Angebote als Archiv, Gegenüberstellung je Jahr; gebaut auf echten, anonymisierten Antworten, die der Meldende beisteuert ([#416](https://github.com/firsttris/haben/issues/416)) | M |
| 12 | Abrechenbare Leistungen | Einträge mit Datum, Dauer (oder Start und Ende, gespeichert wird die Dauer), Kontakt, Projekt als freier Text, Beschreibung und Stundensatz mit Vorgabe je Kontakt; von Hand in Haben oder über die API erfassen, etwa aus Kimai, mit Anleitung; offene Einträge eines Kontakts und Zeitraums werden zum Rechnungsentwurf, jeder Eintrag ist danach mit der Rechnung verknüpft und nicht zweimal abrechenbar, nach einem Storno wieder offen; aus der Rechnung ist erkennbar, welche Einträge sie enthält. Nicht dabei: Stoppuhr, Projektverwaltung, Teamplanung ([#417](https://github.com/firsttris/haben/issues/417)) | M |
| 13 | Bank-CSV, Etsy und Export für die Betriebsprüfung | Bank-, Kreditkarten- und PayPal-Umsätze im allgemeinen CSV-Format mit Spaltenzuordnung; Etsy-Monatsabrechnung als Zahlungsdienstleister, die Beispieldatei liegt vor ([#296](https://github.com/firsttris/haben/issues/296)); Datenexport mit Beschreibung `index.xml` für die Prüfsoftware | S–M |
| 14 | Kleinunternehmer: Steuerbefreiungen und nicht steuerbare Umsätze | Auch als Kleinunternehmer eine Rechnung als steuerfrei nach § 4 UStG oder als nicht im Inland steuerbar ausstellen, statt sie fest als § 19 zu behandeln, getrennt in den Auswertungen und beim Gesamtumsatz; Vorsteuerabzug je Beleg statt nur nach dem Kleinunternehmer-Status, mit Aufteilung bei steuerfreien Umsätzen ohne Vorsteuerabzug. Vor dem Bau die Regeln mit Quellen klären: Gesamtumsatz (§ 19 Abs. 2 UStG), Ort der Leistung (§ 3a UStG), Vorsteuer (§ 15 Abs. 2 und 4 UStG) ([#433](https://github.com/firsttris/haben/issues/433)) | M |
| 15 | Unterlagen nachreichen, Restlaufzeit der Darlehen | Weitere Unterlagen an Beleg, Darlehen und übernommenen Vorgang hängen, auch nach dem Buchen: nur anhängen, mit Zeitpunkt, Person und Prüfsumme, Buchung und Original bleiben unverändert; „Nachweis fehlt noch“ getrennt von „andere Nachweise statt Rechnung“, etwa Police und Beitragsmitteilung ([#345](https://github.com/firsttris/haben/issues/345)); am Darlehen Vertrag und Tilgungsplan, Verlauf der Raten mit Tilgung, Zins und Gebühr ([#312](https://github.com/firsttris/haben/issues/312)); Restlaufzeit zum Bilanzstichtag für Bilanz und E-Bilanz aufteilen (§ 268 Abs. 5 HGB), ohne die alten Buchungen umzudeuten ([#325](https://github.com/firsttris/haben/issues/325)) | S–M |
| 16 | Bilanzierendes Einzelunternehmen | Gewinnermittlung „Bilanz“ als Einstellung neben der Rechtsform, für Gewerbetreibende ab den Grenzen des § 141 AO bzw. § 241a HGB oder freiwillig: Bilanz, GuV und E-Bilanz wie bei GmbH und UG, Eigenkapital über Privatkonten statt Gesellschafterverrechnung, Abschlussbuchungen ohne Umgehen der Festschreibung, Übergang von der EÜR zur Bilanz zum 1.1. mit Eröffnungsbilanz und Übergangsgewinn (R 4.6 EStR); vor dem Bau zu klären, wie sich die Einstellung zu den Sperren verhält, die heute an „GmbH oder UG“ hängen ([#418](https://github.com/firsttris/haben/issues/418)) | M–L |
| 17 | Online-Kundenportal | Link für Kunden: Angebot annehmen, Rechnung als PDF und XML laden, per GiroCode oder Zahlungslink bezahlen | M |
| 18 | BWA und Liquiditätsplanung | Betriebswirtschaftliche Auswertung mit Vorjahresvergleich und Vorschau aus offenen Posten, mit Filter nach Kostenstelle | M |
| 19 | OSS | Rechnungen an Privatpersonen im EU-Ausland mit dem Steuersatz des Ziellands, Lieferschwelle, Datei für das BZSt-Online-Portal | M |
| 20 | Offene Posten ohne Bankumsatz verrechnen | Rechnung gegen Gutschrift oder Storno ausgleichen, zuerst Eingangsbelege desselben Lieferanten; vor dem Bau fachlich zu klären (Aufrechnung oder Aufhebung, Ist und Soll) ([#274](https://github.com/firsttris/haben/issues/274)) | M |

## Später

Kommt nach den geplanten Plätzen, in dieser Reihenfolge:

| # | Thema | Worum es geht | Aufwand |
| --- | --- | --- | --- |
| S1 | Bankumsätze über eine gemeinsame Importschnittstelle | Ein Importvertrag für Enable Banking, CSV/CAMT, Zahlungsdienstleister und externe Connectoren (z. B. Vivid, PayPal), idempotent, ohne Zuordnung oder Buchung ([#306](https://github.com/firsttris/haben/issues/306)) | M–L |
| S2 | Absender- bzw. Markenprofile | Ein Unternehmen, mehrere Marken mit Logo, Farbe, Kontakt, Bankkonto, Texten und eigenem Mail-Absender; baut auf Platz 3 und 4 auf, je Profil mit eigener Vorlage ([#245](https://github.com/firsttris/haben/issues/245)) | M |
| S3 | API ausbauen | Webhooks, Angebote, Artikel, offene Posten und weitere schreibende Endpunkte ([#297](https://github.com/firsttris/haben/issues/297)); extern geprüfte Eingangsbelege in zwei Stufen: zuerst mit vorbereiteten Daten (Lieferant, Nummer, Datum, Beträge, Kategorie, Aufteilung) als „Zu prüfen“ anlegen, danach Buchen über die API mit eigenem Token-Recht, denselben Prüfungen wie in der Oberfläche, Schutz vor Doppelbuchung und Protokoll der externen Freigabe ([#439](https://github.com/firsttris/haben/issues/439)) | M |
| S5 | Ausgangsrechnungen aus Fremdsystemen | Rechnungen aus Shop oder Backoffice mit fremder Nummer und PDF übernehmen, als offener Posten ([#104](https://github.com/firsttris/haben/issues/104)) | M |
| S6 | Vollständigere Anlage EÜR | Häusliches Arbeitszimmer, Fahrten zwischen Wohnung und Betriebsstätte, Investitionsabzugsbetrag | M |
| S7 | Fahrtenbuch | Fahrten erfassen statt der 1-%-Regel | M |
| S8 | Weitere Rollen | Mitarbeitende, buchende Steuerberatung, Betriebsprüfer nur lesend; baut auf dem Zugang für die Steuerberatung auf | M |
| S10 | MCP und OAuth | Connectors in claude.ai über OAuth, schreibender MCP-Server für Entwürfe ([#96](https://github.com/firsttris/haben/issues/96)) | M–L |
| S11 | Vorlagen-Editor | Eigene Vorlagen in Haben bearbeiten mit Vorschau, Textformatierung in Positionen; baut auf Platz 4 auf ([#113](https://github.com/firsttris/haben/issues/113), Schritt 3) | L |
| S12 | ELStAM | An- und Abmeldung und Abruf der Lohnsteuerabzugsmerkmale; offen, ob es eine freigeschaltete Hersteller-ID braucht | M–L |
| S13 | Weitere Fälle im Lohn | Teilmonate, Einmalzahlungen, Kurzfristige, Auszubildende und weitere Fälle, die heute „nicht unterstützt“ sind | L |
| S14 | Gutschrift als Rechnungsersatz | Abrechnungsgutschrift nach § 14 Abs. 2 Satz 2 UStG ausstellen | M |
| S15 | Lieferschein als eigener Beleg, Sammelrechnung | Lieferschein mit eigenem Nummernkreis, unabhängig von Angebot und Rechnung; mehrere Lieferscheine zu einer Rechnung zusammenfassen, ihre Nummern in der E-Rechnung (BT-16 gibt es schon am Beleg) ([#390](https://github.com/firsttris/haben/issues/390)) | M |
| S16 | Belege aus Cloud-Speichern | Belege aus Google Drive, Dropbox oder OneDrive übernehmen | M |
| S17 | E-Mail-Versand über Google oder Microsoft | Anmeldung per OAuth statt SMTP-Passwort | M |
| S18 | Module ausblenden | Nicht genutzte Bereiche in der Navigation ausblenden ([#266](https://github.com/firsttris/haben/issues/266)) | S–M |
| S19 | Kleinere Belegfunktionen | Tags, Pro-forma-Rechnung, freier Brief, eigene Kontaktfelder | S |
| S20 | § 13b für Bauleistungen | Bauleistungen als Leistender und als Empfänger | M |
| S21 | Wertpapiere | Betriebliche Wertpapiere mit Erwerb, Bestand und Verkauf (Folgearbeit aus [#312](https://github.com/firsttris/haben/issues/312)) | M |
| S22 | Postversand | Rechnungen per Brief über einen Druckdienstleister | M |
| S23 | Rechnungsanhänge erweitern | Zusätzliche Anhänge auch an Serien- und Korrekturrechnungen und über die API ([#272](https://github.com/firsttris/haben/issues/272)) | S |
| S24 | Fremdwährung erweitern | Verrechnungskonto in Fremdwährung (z. B. PayPal-Guthaben in USD), Fremdwährung auch für Abschlags-, Schluss- und Serienrechnungen, Angebote und Mahnungen, eigenes Leistungsdatum am Beleg ([#109](https://github.com/firsttris/haben/issues/109), [#108](https://github.com/firsttris/haben/issues/108)) | M |
| S25 | Aufgeteilte Belege mit Sonderfällen | § 13b, Privatanteil, Fremdwährung und Anlagegut je Zeile eines aufgeteilten Belegs; heute lehnt Haben sie bei einer Aufteilung ab ([#271](https://github.com/firsttris/haben/issues/271)) | M |
| S26 | Weitere Zahlungsdienstleister | Abrechnungen von SumUp und Amazon, sobald Beispieldateien vorliegen; lieber kein Import als ein geratener ([#108](https://github.com/firsttris/haben/issues/108)) | S |
| S27 | Zeitstempel für das Audit-Log | Qualifizierter Zeitstempel nach RFC 3161 auf die Hash-Kette, zusätzlich zu den Siegeln ([#78](https://github.com/firsttris/haben/issues/78)) | S–M |
| S28 | Backup in der Wochenmail | Stand der Sicherung und des Test-Restores in der wöchentlichen Mail ([#95](https://github.com/firsttris/haben/issues/95)) | S |
| S29 | Installationsvorlagen | Vorlagen und Anleitungen für Unraid, TrueNAS, Synology und Coolify auf Basis von `deploy/compose.yml`, mit HTTPS, Schlüsseln, Backup und ERiC nur auf x86_64 ([#414](https://github.com/firsttris/haben/issues/414)) | S–M |

## Bewusst nicht

| Thema | Grund |
| --- | --- |
| Lagerbestand | Kein Kern einer Buchhaltung; gehört in eine Warenwirtschaft (Lexware Office führt keinen, sevDesk nur als Zusatzmodul) |
| Stoppuhr, Projektverwaltung und Teamplanung | Gehören in eigene Werkzeuge; abrechenbare Leistungen erfasst Haben schlicht selbst oder übernimmt sie über die API (Platz 12, [#417](https://github.com/firsttris/haben/issues/417)) |
| Eigene Shop-Anbindungen, Bestellungen und Versand | Abrechnungen der Zahlungsdienste, API und n8n decken das ab; auch Lexware Office bindet Shops nur über Partner an. Bestellungen mit Status, Druck-Buttons, Sendungsnummern und Webhook-Aktionen würden Haben zum Versandtool machen; eigene Seiten bekommen bewusst keine Anmeldung von Haben, weil eine fremde Seite mit der Sitzung festschreiben oder an ELSTER senden könnte ([#199](https://github.com/firsttris/haben/issues/199)) |
| Lastschrifteinzug über einen Zahlungsdienst | Gehört zum Zahlungsdienst; Lexware Office macht es nur über Partner |
| Native Apps | Haben ist eine installierbare Web-App mit Kamera und Teilen-Menü; zwei App-Stores zu pflegen lohnt nicht |
| CRM mit Aufgaben und Push-Erinnerungen, Mitarbeiterportal | Kein Kern einer Buchhaltung für kleine Betriebe |
| Mehrere Firmen in einer Installation | Eine Instanz je Firma; so bleiben Daten, Sperren und Audit getrennt, und ein Fehler macht keine fremde Buchhaltung sichtbar ([#66](https://github.com/firsttris/haben/issues/66)) |
| Vereine und gemeinnützige Körperschaften | Brauchen Sphären (ideeller Bereich, Vermögensverwaltung, Zweckbetrieb, wirtschaftlicher Geschäftsbetrieb), Zuwendungsbestätigungen, Anlage Gem und einen Vereinskontenrahmen wie SKR49; das wäre ein eigenes Programm ([#412](https://github.com/firsttris/haben/issues/412)) |
| Mehrere Geschäftsidentitäten mit eigenen Steuerdaten | Ein Unternehmer hat ein Unternehmen (§ 2 Abs. 1 Satz 2 UStG), auf der Rechnung steht sein vollständiger Name; Marken mit Logo, Kontakt und Bankkonto kommen als Profile (S2) ([#245](https://github.com/firsttris/haben/issues/245)) |
| E-Mails als HTML mit Editor | Hoher Aufwand (Editor, Vorschau, sicheres HTML, Darstellung in vielen Mailprogrammen) bei wenig Nutzen; auch kein schlichter HTML-Rahmen mit Logo und Signatur. Textvorlagen je Art und Sprache mit Platzhaltern gibt es ([#115](https://github.com/firsttris/haben/issues/115)) |
| Vorlagen mit HTML-Renderer | Ein Renderer wie WeasyPrint brächte Python in den Container und ein Risiko für PDF/A; auch kein eigener Renderer-Container, denn zwei Wege zu PDF/A und ZUGFeRD wären doppelt zu prüfen und zu pflegen. Die Gestaltung läuft über die Typst-Vorlage, auch mit eigenen Vorlagen (Platz 3 und 4, S11) ([#113](https://github.com/firsttris/haben/issues/113)) |
| Eigenes lernendes Modell für Vorschläge | Vorschläge lernen ohne Modell aus allen früheren Zuordnungen ([Bank](bank.md#vorschläge-ohne-rechnung-und-geldtransit), [Belege](belege.md#vorschläge-aus-früheren-belegen), [#295](https://github.com/firsttris/haben/issues/295)); ein Modell kostet Pflege ohne deutlichen Gewinn ([#107](https://github.com/firsttris/haben/issues/107)) |
| Zins- und Tilgungspläne berechnen | Den Plan liefert die Bank, die Rate lässt sich aufgeteilt buchen; Zinsmethoden, Sondertilgungen und Schlussraten je Vertrag nachzurechnen kostet viel Pflege für wenig Gewinn. Unterlagen am Darlehen siehe Platz 15 ([#326](https://github.com/firsttris/haben/issues/326)) |
| Frei vergebene Rechnungsnummer je Entwurf | Nummern vergibt Haben beim Festschreiben aus dem Nummernkreis; eine Nummer von Hand müsste Eindeutigkeit und Zähler selbst absichern ([#328](https://github.com/firsttris/haben/issues/328)) |
| Freie Buchung auf jedes Konto mit Steuerschlüssel | EÜR, Voranmeldung und E-Bilanz hängen an den Kategorien; direkt gebucht wird auf eine Kategorie oder ein eigenes Konto mit geerbter Zuordnung ([Direkt buchen](bank.md#auf-eine-kategorie-buchen), Platz 9) ([#324](https://github.com/firsttris/haben/issues/324)) |
| Personenkonten im Journal | Offene Posten führt Haben je Rechnung und Beleg; Personenkonten braucht die Steuerberatung im DATEV-Export, dort setzt Haben sie ein ([Personenkonten](auswertungen.md#personenkonten)) ([#327](https://github.com/firsttris/haben/issues/327)) |
| Texterkennung (OCR) vor dem Modell | Für Scans und Fotos liest ein Vision-Modell besser als OCR mit Textmodell; eine OCR-Engine wäre eine weitere Abhängigkeit im Container ([#128](https://github.com/firsttris/haben/issues/128), [#329](https://github.com/firsttris/haben/issues/329)) |
| Getrennte Verzeichnisse für Kunden und Lieferanten | Eine Firma ist oft beides und stünde sonst doppelt drin; ein Kontakt hat die Rollen Kunde und Lieferant ([#224](https://github.com/firsttris/haben/issues/224)) |
| Zweite Farbe auf Rechnungen | Text und Beträge in der Akzentfarbe lesen sich schlecht; die Grautöne leiten sich aus der Akzentfarbe ab ([#222](https://github.com/firsttris/haben/issues/222)) |
| Sachkonto je Bankkonto | Alle Bankkonten buchen auf das Bankkonto des Kontenrahmens; getrennte Salden im Kontenblatt lohnen den Aufwand nicht. Benennen vor dem Anlegen würde den Ablauf mit Enable Banking unterbrechen, und der Zweck eines Kontos setzt nicht die IBAN auf Rechnungen ([#105](https://github.com/firsttris/haben/issues/105)) |
| Fremdwährungsrechnung mit deutscher Umsatzsteuer bei Ist-Versteuerung | Gesperrt statt nachgebildet: Sonst änderte sich die Steuer einer festgeschriebenen Rechnung mit dem Kurs bei der Zahlung ([#109](https://github.com/firsttris/haben/issues/109)) |
| Andere Datenbank oder Aufteilung in Dienste | Unveränderbarkeit nach GoBD hängt an Triggern in PostgreSQL; ohne sie hinge sie nur an Berechtigungen und App-Code ([#63](https://github.com/firsttris/haben/issues/63)) |
| Eigener `dev`-Branch | Trunk-based auf `main`, Release Candidates als Tags mit `:next` ([#92](https://github.com/firsttris/haben/issues/92)) |
| Paket `packages/contracts` | Server-Funktionen mit Zod und die Schnittstellen der Module (`index.ts`) decken die Verträge ab ([#81](https://github.com/firsttris/haben/issues/81)) |

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
