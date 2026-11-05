# Roadmap

Was als Nächstes geplant ist, was blockiert ist und woher die Unterlagen dafür kommen. Erledigtes steht in den jeweiligen Kapiteln der Doku.

## Geplant

Die Reihenfolge folgt einem Abgleich mit dem Funktionsumfang von Lexware Office und den offenen Issues (Stand November 2026): zuerst Pflichten der GmbH und Lohn, dann was Freiberuflern und kleinen GmbHs im Alltag am meisten fehlt. Erledigt sind aus der letzten Runde: SEPA-Überweisungen, Skonto, Zusammenfassende Meldung für sonstige Leistungen, CSV-Import, Lohnabrechnung mit Buchung.

| # | Thema | Worum es geht | Aufwand | Stand |
| --- | --- | --- | --- | --- |
| 1 | Lohnsteuer-Anmeldung | Über ERiC aus den festgeschriebenen Abrechnungen, mit Anmeldungszeitraum nach § 41a EStG, Frist und Berichtigung ([Lohnsteuer-Anmeldung](lohn.md#lohnsteuer-anmeldung), [Lohn – Umsetzungsplan](lohn-plan.md)) | M | erledigt |
| 2 | Lohn: Ausfüllliste SV-Meldeportal | Beitragsnachweis und DEÜV-Meldungen zum Abtippen im [SV-Meldeportal](#nicht-machbar-ohne-zertifizierung-oder-lizenz), mit Fristen und Vermerk „abgegeben“ | S–M | geplant |
| 3 | Lohn: Lohnsteuerbescheinigung | Elektronische Lohnsteuerbescheinigung über ERiC bis Ende Februar des Folgejahres | M | geplant |
| 4 | E-Bilanz-Taxonomie 6.10 | Neue Taxonomie ab Wirtschaftsjahr 2027 mit Kontennachweis zu Bilanz und GuV ([Buchhaltung](buchhaltung.md)) | M | geplant |
| 5 | Voranmeldung als offener Posten | Zahllast und Erstattung der Umsatzsteuer-Voranmeldung im Bankabgleich zuordnen, auch für außerhalb von Haben abgegebene Voranmeldungen ([Abgabe vermerken](umsatzsteuer.md#abgabe-außerhalb-von-haben-vermerken), [Zahlung an das Finanzamt](umsatzsteuer.md#zahlung-an-das-finanzamt)) | M | erledigt |
| 6 | Weitere AfA-Methoden | Degressive AfA mit Wechsel zur linearen, Sonderabschreibung für E-Fahrzeuge, Erinnerungswert ([Anlagen](anlagen.md)) | M | geplant |
| 7 | Innergemeinschaftliche Lieferung und Erwerb, Ausfuhr | Rechnung und Beleg mit eigener Steuerregelung, Kz 41, 43, 89/93 und 61, ZM mit Lieferungen und Dreiecksgeschäften | M | geplant |
| 8 | Dauerbelege | Wiederkehrende Ausgaben wie Miete oder Versicherung einmal erfassen, Haben legt sie im Intervall an | S–M | geplant |
| 9 | Barzahlung einer Rechnung in der Kasse | Bareinnahme einer Ausgangsrechnung im Kassenbuch zuordnen ([Kasse](kasse.md)) | S–M | geplant |
| 10 | Weitere Benutzer und Steuerberatung | Zweiter Zugang mit Rollen, zuerst für die Steuerberatung. Entschieden: kommt; die bisherige Entscheidung „genau ein Nutzer“ ([Architektur](architektur.md#anmeldung)) wird dafür aufgegeben. Zu klären beim Bau: Rollen, Einladung statt Einrichtungscode, Audit je Nutzer | M–L | geplant |
| 11 | Belegerkennung mit lokalem Modell | Auslesung über einen OpenAI-kompatiblen Endpunkt (z. B. Ollama, LM Studio, vLLM) mit einem Vision-Modell, ohne Cloud-Fallback; Anthropic bleibt wahlweise. Reine OCR genügt nicht, weil sie nur Text liefert und keine Belegfelder | M | geplant |
| 12 | Rabatte und Positionen im Angebot | Gesamt- und Positionsrabatt, optionale und alternative Positionen, Zahlungsplan mit Abschlägen aus dem Angebot | S–M | geplant |
| 13 | Bank-CSV und Export für die Betriebsprüfung | Bank-, Kreditkarten- und PayPal-Umsätze im allgemeinen CSV-Format mit Spaltenzuordnung; Datenexport mit Beschreibung `index.xml` für die Prüfsoftware | S | geplant |
| 14 | Online-Kundenportal | Link für Kunden: Angebot annehmen, Rechnung als PDF und XML laden, per GiroCode oder Zahlungslink bezahlen | M | geplant |
| 15 | BWA und Liquiditätsplanung | Betriebswirtschaftliche Auswertung mit Vorjahresvergleich und Vorschau aus offenen Posten | M | geplant |
| 16 | OSS | Rechnungen an Privatpersonen im EU-Ausland mit dem Steuersatz des Ziellands, Lieferschwelle, Datei für das BZSt-Online-Portal | M | geplant |
| 17 | Offene Posten ohne Bankumsatz verrechnen | Rechnung gegen Gutschrift oder Storno ausgleichen; vor dem Bau fachlich zu klären (Aufrechnung oder Aufhebung, Ist und Soll) | M | geplant |

## Später oder vielleicht

Sinnvoll, aber nicht jetzt: eigene Drucklayouts, Absenderprofile und Textformatierung in Belegen; Webhooks und Angebote in der API, schreibender MCP-Server; Belege aus Cloud-Speichern; E-Mail-Versand über die Anmeldung bei Google oder Microsoft; ELStAM (offen, ob es eine freigeschaltete Hersteller-ID braucht); § 13b für Bauleistungen; weitere Fälle im Lohn; eigene Sachkonten neben den Kategorien (braucht eine Entscheidung zur Architektur); Module ausblenden; Sammelrechnung aus Lieferscheinen; Lastschrift-Datei (pain.008); Fahrtenbuch; vollständigere Anlage EÜR (häusliches Arbeitszimmer, Fahrten Wohnung–Betrieb, Investitionsabzugsbetrag).

## Bewusst nicht

| Thema | Grund |
| --- | --- |
| Lagerbestand | Kein Kern einer Buchhaltung; auch Lexware Office führt keinen |
| Zeiterfassung und Projekte | Gehört in eigene Werkzeuge; Rechnungen und Belege kommen über die [API](api.md) |
| Eigene Shop-Anbindungen | Abrechnungen der Zahlungsdienste, API und n8n decken das ab; auch Lexware Office bindet Shops nur über Partner an |
| Lastschrifteinzug über einen Zahlungsdienst | Gehört zum Zahlungsdienst; Lexware Office macht es nur über Partner |
| Native Apps | Haben ist eine installierbare Web-App mit Kamera und Teilen-Menü; zwei App-Stores zu pflegen lohnt nicht |
| CRM mit Aufgaben und Push-Erinnerungen, Mitarbeiterportal | Kein Kern einer Buchhaltung für kleine Betriebe |
| Mehrere Firmen in einer Installation | Eine Instanz je Firma; so bleiben Daten, Sperren und Audit getrennt |
| E-Mails als HTML mit Editor | Hoher Aufwand bei wenig Nutzen; Textvorlagen mit Platzhaltern gibt es |
| Eigenes lernendes Modell für Vorschläge | Die Regeln lernen schon aus früheren Zuordnungen; ein Modell kostet Pflege ohne deutlichen Gewinn |

## Nicht machbar ohne Zertifizierung oder Lizenz

| Thema | Warum nicht | Was Haben stattdessen tut |
| --- | --- | --- |
| Meldungen an die Sozialversicherung, Beitragsnachweise, Erstattungsanträge | Nur aus systemgeprüften Programmen (§ 95b SGB IV, Prüfung durch die ITSG) | Werte zum Eintragen im SV-Meldeportal der ITSG |
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
