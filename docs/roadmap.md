# Roadmap

Was als Nächstes geplant ist, was blockiert ist und woher die Unterlagen dafür kommen. Erledigtes steht in den jeweiligen Kapiteln der Doku.

## Geplant

Die Reihenfolge folgt einem Abgleich mit dem Funktionsumfang von Lexware Office und sevDesk und den offenen Issues (Stand November 2026): zuerst Pflichten der GmbH und Lohn, dann was Freiberuflern und kleinen GmbHs im Alltag am meisten fehlt. Erledigt sind aus der letzten Runde: SEPA-Überweisungen, Skonto, Zusammenfassende Meldung für sonstige Leistungen, CSV-Import, Lohnabrechnung mit Buchung.

| # | Thema | Worum es geht | Aufwand | Stand |
| --- | --- | --- | --- | --- |
| 1 | Lohnsteuer-Anmeldung | Über ERiC aus den festgeschriebenen Abrechnungen, mit Anmeldungszeitraum nach § 41a EStG, Frist und Berichtigung ([Lohnsteuer-Anmeldung](lohn.md#lohnsteuer-anmeldung), [Lohn – Umsetzungsplan](lohn-plan.md)) ([#213](https://github.com/firsttris/haben/issues/213)) | M | erledigt |
| 2 | Lohn: Ausfüllliste SV-Meldeportal | Beitragsnachweis je Monat und Einzugsstelle und DEÜV-Meldungen (Anmeldung, Abmeldung, Jahresmeldung, Sofortmeldung) zum Abtippen im [SV-Meldeportal](#nicht-machbar-ohne-zertifizierung-oder-lizenz), mit Fristen und Vermerk „im Portal abgegeben“ samt Protokoll ([SV-Meldeportal](lohn.md#sv-meldeportal)) ([#213](https://github.com/firsttris/haben/issues/213)) | S–M | erledigt |
| 3 | Lohn: Lohnsteuerbescheinigung | Elektronische Lohnsteuerbescheinigung je Arbeitnehmer und Jahr aus den festgeschriebenen Abrechnungen, Frist Ende Februar des Folgejahres, Ausdruck nach amtlichem Muster, Korrektur und Storno ([Lohnsteuerbescheinigung](lohn.md#lohnsteuerbescheinigung)). Ab 2026 übermittelt im ELSTER-Portal und in Haben vermerkt, bis die Schnittstelle der LSTMitteilung vorliegt (siehe Blockiert) ([#213](https://github.com/firsttris/haben/issues/213)) | M | erledigt |
| 4 | E-Bilanz-Taxonomie 6.10 | Neue Taxonomie ab Wirtschaftsjahr 2027 (BMF-Schreiben vom 8. Juni 2026) mit Kontennachweis je Konto zu Bilanz und GuV, auch in 6.9 ([E-Bilanz](buchhaltung.md#e-bilanz-gmbh-und-ug)) | M | erledigt |
| 5 | Voranmeldung als offener Posten | Abgabe außerhalb von Haben vermerken (Datum, Transferticket, Protokoll; danach festgeschrieben, Frist erledigt, Kennzahlen geprüft) und Zahllast bzw. Erstattung als offenen Posten mit Fälligkeit im Bankabgleich zuordnen, mit Dauerfristverlängerung, Teilzahlung und Berichtigung (Säumniszuschläge bleiben Betriebsausgaben); Protokoll im Jahresarchiv ([Abgabe vermerken](umsatzsteuer.md#abgabe-außerhalb-von-haben-vermerken), [Zahlung an das Finanzamt](umsatzsteuer.md#zahlung-an-das-finanzamt)) ([#269](https://github.com/firsttris/haben/issues/269)) | M | erledigt |
| 6 | Weitere AfA-Methoden | Degressive AfA mit Wechsel zur linearen, AfA-Staffel für Elektrofahrzeuge nach § 7 Abs. 2a EStG, Erinnerungswert ([Anlagen](anlagen.md#degressive-afa)) | M | erledigt |
| 7 | Innergemeinschaftliche Lieferung und Erwerb, Ausfuhr | Rechnung und Beleg mit eigener Steuerregelung, Kz 41, 43, 89/93 und 61, ZM mit Lieferungen ([Rechnungen](rechnungen.md#umsatzsteuer-auf-der-rechnung), [Belege](belege.md#innergemeinschaftlicher-erwerb--1a-ustg), [Voranmeldung](umsatzsteuer.md#innergemeinschaftlicher-erwerb)). Dreiecksgeschäfte und Monatsmeldungen der ZM bleiben bewusst draußen ([Grenzen](umsatzsteuer.md#grenzen)) ([#273](https://github.com/firsttris/haben/issues/273)) | M | erledigt |
| 8 | Dauerbelege | Wiederkehrende Ausgaben wie Miete, Versicherung, Leasing oder Abos einmal mit Vertrag erfassen; Haben legt im Intervall Belege „Zu prüfen“ an und schlägt sie im Bankabgleich vor, Vorsteuer nur mit Steuerausweis im Dokument ([Dauerbelege](belege.md#dauerbelege)) | S–M | erledigt |
| 9 | Barzahlung einer Rechnung in der Kasse | Bareinnahme einer Ausgangsrechnung im Kassenbuch zuordnen: Kasse an Forderungen wie im Bankabgleich, bei Ist mit der Umsatzsteuer im Monat der Bareinnahme, Teilzahlung, Skonto und Storno als Gegenzeile ([Rechnung bar bezahlt](kasse.md#rechnung-bar-bezahlt)) ([#276](https://github.com/firsttris/haben/issues/276)) | S–M | erledigt |
| 10 | Weitere Benutzer und Steuerberatung | Zweiter Zugang mit Rollen, zuerst für die Steuerberatung. Stufe 1: Rollen Inhaber und Steuerberatung (nur lesen), Einladung per Link statt Einrichtungscode, Sperren und Entfernen, jede Anmeldung im Audit-Log, Hinweis auf Änderungen seit dem letzten Besuch ([Zugang für die Steuerberatung](steuerberatung.md)). Offen für später: weitere Rollen (Mitarbeitende, buchende Steuerberatung), Lohn, Umsatzsteuer und Abschluss zum Ansehen, Rückfragen am Beleg Weitere Rollen siehe S8 | M–L | erledigt (Stufe 1) |
| 11 | Belegerkennung mit lokalem Modell | Auslesung über einen OpenAI-kompatiblen Endpunkt (z. B. Ollama, LM Studio, vLLM) mit einem Vision-Modell, ohne Cloud-Fallback; Anthropic bleibt wahlweise. Reine OCR genügt nicht, weil sie nur Text liefert und keine Belegfelder ([KI-Auslesung](belege.md#ki-auslesung), [Einrichtung](einrichtung.md#beispiel-ollama-mit-qwen-vl)) ([#128](https://github.com/firsttris/haben/issues/128)) | M | erledigt |
| 12 | Rabatte und Positionen im Angebot | Gesamt- und Positionsrabatt, optionale und alternative Positionen, Zahlungsplan mit Abschlägen aus dem Angebot ([#114](https://github.com/firsttris/haben/issues/114)) | S–M | geplant |
| 13 | Steuerzahlungen und Darlehen | Umsatz- und Gewerbesteuer für Vorjahre mit Steuerart und Bezugsjahr, private Steuern als Entnahme, abziehbare und nicht abziehbare Zinsen und Zuschläge, Darlehen mit Aufteilung der Rate in Tilgung, Zins und Gebühr, betriebliche Zinserträge, Einfuhrumsatzsteuer (Kz 62); SKR03 und SKR04 ([#312](https://github.com/firsttris/haben/issues/312)) | M | geplant |
| 14 | Weitere Ausgabe-Kategorien | Miete, sonstiger Betriebsbedarf, Reparatur sonstiger Anlagen, sonstige Fahrzeugkosten, Berufsgenossenschaft, Versorgungskassen – je mit Zuordnung für EÜR, E-Bilanz und HGB in SKR03 und SKR04; Miete auch für die Dauerbelege ([#312](https://github.com/firsttris/haben/issues/312)) | S | geplant |
| 15 | Gestaltung der Belege | Schrift aus einer festen Auswahl eingebetteter, PDF/A-tauglicher Schriften, Fußzeile in bis zu vier Spalten mit Platzhaltern, Briefpapier als PDF-Hintergrund; in der bestehenden Typst-Vorlage, PDF/A-3 und ZUGFeRD bleiben unverändert ([Rechnungen](rechnungen.md)) ([#113](https://github.com/firsttris/haben/issues/113), [#245](https://github.com/firsttris/haben/issues/245)) | S–M | geplant |
| 16 | Vorschläge aus allen früheren Zuordnungen lernen | Kategorie und Buchungsart im Bankabgleich und bei Belegen aus allen früheren Zuordnungen vorschlagen, mit Begründung, ohne KI-Modell, immer zu bestätigen ([#295](https://github.com/firsttris/haben/issues/295)) | S–M | geplant |
| 17 | Eigene Sachkonten | Einstieg: eigenes Konto mit Name und Nummer, das Steuer-, EÜR- und E-Bilanz-Zuordnung einer bestehenden Kategorie ausdrücklich erbt (auch „EÜR-neutral“); Buchungen behalten die damals gültige Zuordnung; vor dem Bau ist zu entscheiden, wie eigene Konten an Beleg- und Buchungszeilen hängen (gemeinsam mit Platz 18) ([#270](https://github.com/firsttris/haben/issues/270)) | M | geplant |
| 18 | Kostenstellen | Kostenstellen je Beleg- und Rechnungszeile mit Aufteilung, Auswertung je Kostenstelle und Zeitraum, Weitergabe im DATEV-Export (KOST1/KOST2) ([#313](https://github.com/firsttris/haben/issues/313)) | M–L | geplant |
| 19 | Bank-CSV und Export für die Betriebsprüfung | Bank-, Kreditkarten- und PayPal-Umsätze im allgemeinen CSV-Format mit Spaltenzuordnung; Datenexport mit Beschreibung `index.xml` für die Prüfsoftware | S | geplant |
| 20 | Online-Kundenportal | Link für Kunden: Angebot annehmen, Rechnung als PDF und XML laden, per GiroCode oder Zahlungslink bezahlen | M | geplant |
| 21 | BWA und Liquiditätsplanung | Betriebswirtschaftliche Auswertung mit Vorjahresvergleich und Vorschau aus offenen Posten, mit Filter nach Kostenstelle | M | geplant |
| 22 | OSS | Rechnungen an Privatpersonen im EU-Ausland mit dem Steuersatz des Ziellands, Lieferschwelle, Datei für das BZSt-Online-Portal | M | geplant |
| 23 | Offene Posten ohne Bankumsatz verrechnen | Rechnung gegen Gutschrift oder Storno ausgleichen; vor dem Bau fachlich zu klären (Aufrechnung oder Aufhebung, Ist und Soll) ([#274](https://github.com/firsttris/haben/issues/274)) | M | geplant |

## Später oder vielleicht

Sinnvoll, aber nicht jetzt – in dieser Reihenfolge, wenn die Plätze oben erledigt sind:

| # | Thema | Worum es geht | Aufwand |
| --- | --- | --- | --- |
| S1 | Bankumsätze über eine gemeinsame Importschnittstelle | Ein Importvertrag für Enable Banking, CSV/CAMT, Zahlungsdienstleister und externe Connectoren (z. B. Vivid, PayPal), idempotent, ohne Zuordnung oder Buchung ([#306](https://github.com/firsttris/haben/issues/306)) | M–L |
| S2 | Absender- bzw. Markenprofile | Ein Unternehmen, mehrere Marken mit Logo, Farbe, Kontakt, Bankkonto, Texten und eigenem Mail-Absender; baut auf Platz 15 auf ([#245](https://github.com/firsttris/haben/issues/245)) | M |
| S3 | API ausbauen | Webhooks, Angebote, Artikel, offene Posten und weitere schreibende Endpunkte ([#297](https://github.com/firsttris/haben/issues/297)) | M |
| S4 | Eigene Rechnung beim Beleg-Upload erkennen | Eine hochgeladene eigene Ausgangsrechnung an der eigenen USt-IdNr. im XML erkennen statt sie als Ausgabe vorzuschlagen ([#104](https://github.com/firsttris/haben/issues/104)) | S |
| S5 | Ausgangsrechnungen aus Fremdsystemen | Rechnungen aus Shop oder Backoffice mit fremder Nummer und PDF übernehmen, als offener Posten ([#104](https://github.com/firsttris/haben/issues/104)) | M |
| S6 | Vollständigere Anlage EÜR | Häusliches Arbeitszimmer, Fahrten zwischen Wohnung und Betriebsstätte, Investitionsabzugsbetrag | M |
| S7 | Fahrtenbuch | Fahrten erfassen statt der 1-%-Regel | M |
| S8 | Weitere Rollen | Mitarbeitende, buchende Steuerberatung, Betriebsprüfer nur lesend; baut auf Platz 10 auf | M |
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
| S21 | Weitere Anlagen und Wertpapiere | Sonstige Transportmittel als Anlage, betriebliche Wertpapiere mit Erwerb, Bestand und Verkauf ([#312](https://github.com/firsttris/haben/issues/312), Teil 3) | M |
| S22 | Postversand | Rechnungen per Brief über einen Druckdienstleister | M |

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
| Eigenes lernendes Modell für Vorschläge | Vorschläge lernen ohne Modell aus allen früheren Zuordnungen (Platz 16); ein Modell kostet Pflege ohne deutlichen Gewinn |

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
