# Roadmap

Was als Nächstes geplant ist, was blockiert ist und woher die Unterlagen dafür kommen. Erledigtes steht in den jeweiligen Kapiteln der Doku.

## Geplant

Die Reihenfolge folgt einem Abgleich mit dem Funktionsumfang von Lexware Office (Stand November 2026): zuerst, was Freiberuflern und kleinen GmbHs im Alltag am meisten fehlt.

| # | Thema | Worum es geht | Aufwand | Stand |
| --- | --- | --- | --- | --- |
| 1 | Lohn | Lohnabrechnung, Buchung, Lohnsteuer-Anmeldung und -Bescheinigung über ELSTER, zuerst für den Gesellschafter-Geschäftsführer, dann für Angestellte und Minijobs; für die Sozialversicherung eine Ausfüllliste zum [SV-Meldeportal](#nicht-machbar-ohne-zertifizierung-oder-lizenz). Lohnsteuer nach dem Programmablaufplan, Beiträge zur Sozialversicherung und die [Lohnabrechnung](lohn.md) mit Entgeltabrechnung und Lohnkonto stehen; Plan: [Lohn – Recherche und Umsetzungsplan](lohn-plan.md) | L | in Arbeit |
| 2 | Überweisungen als SEPA-Datei | Offene Belege gesammelt als pain.001 ausgeben, die man im Online-Banking hochlädt; die Abbuchung ordnet der Bankabgleich danach zu ([Belege](belege.md#überweisen-sepa-datei)). Später prüfen: Zahlungsauslösung über Enable Banking, das schon den Kontoabruf macht | S | erledigt |
| 3 | Skonto | Skonto in den Zahlungsbedingungen der Rechnung, auf PDF und in der E-Rechnung (BT-20) | S | geplant |
| 4 | Weitere Benutzer und Steuerberatung | Zweiter Zugang mit Rollen, zuerst lesend für die Steuerberatung, später volle Rollen. Weicht von der bisherigen Entscheidung „genau ein Nutzer“ ab ([Architektur](architektur.md)); vor dem Bau zu klären | M | geplant |
| 5 | Zusammenfassende Meldung | Meldung der innergemeinschaftlichen Leistungen je USt-IdNr. und Quartal über ELSTER | M | geplant |
| 6 | Texterkennung ohne Cloud | Belege lokal erkennen (z. B. Tesseract im Worker); die KI bleibt wahlweise | M | geplant |
| 7 | Online-Kundenportal | Link für Kunden: Angebot annehmen, Rechnung als PDF und XML laden, per GiroCode oder Zahlungslink bezahlen | M | geplant |
| 8 | BWA und Liquiditätsplanung | Betriebswirtschaftliche Auswertung mit Vorjahresvergleich und Vorschau aus offenen Posten | M | geplant |
| 9 | CSV-Import | Kontakte, Artikel und Anlagen aus CSV übernehmen | S | geplant |

Danach: Alternativpositionen und Gesamtrabatt, Kundenhistorie mit Aufgaben und Notizen, OSS-Meldung, innergemeinschaftliche Lieferungen und Ausfuhr, Lastschrift-Datei (pain.008), Abrechnungen von Amazon und weiteren Shops, Fahrtenbuch, vollständigere Anlage EÜR (Bewirtung, Geschenke, Fahrten Wohnung–Betrieb, Investitionsabzugsbetrag).

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
