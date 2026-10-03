# Roadmap

Was als Nächstes geplant ist, was blockiert ist und woher die Unterlagen dafür kommen. Erledigtes steht in den jeweiligen Kapiteln der Doku.

## Geplant

| Thema | Worum es geht | Stand |
| --- | --- | --- |
| Dauerfristverlängerung | Antrag auf Dauerfristverlängerung mit Sondervorauszahlung (USt 1 H) über ELSTER; Voranmeldungen dürfen dann einen Monat später kommen | geplant |
| Fristen und Erinnerungen | Kalender mit Voranmeldung, Vorauszahlungsterminen, Abgabefristen und Ablauf des Zertifikats, optional per E-Mail | geplant |
| Anlage N | Arbeitslohn, etwa eines angestellten Ehegatten, in der Einkommensteuererklärung | geplant |
| Abrufberechtigung für den Ehegatten | Berechtigung zum Belegabruf für eine andere Person beantragen und mit dem Freischaltcode aus dem Brief freischalten (Verfahren ElsterBRM, wie in erica); bis dahin über Mein ELSTER | geplant |
| Zusammenfassende Meldung | Meldung der innergemeinschaftlichen Leistungen an das BZSt, nur bei Kunden in anderen EU-Ländern nötig | bei Bedarf |

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
| [lohnsteuer-bmf](https://pypi.org/project/lohnsteuer-bmf/) | MIT | Einkommensteuertarif und Parameter 2024–2026 nach BMF-Programmablaufplan; Referenz für die Tests der Steuerprognose |

Nicht gefunden wurden die Kennungen für Kz 21/45/48 der Umsatzsteuererklärung und ein Schema für den Antrag auf Anpassung der Vorauszahlungen, weder in diesen Projekten noch in Paketen auf npm oder PyPI.
