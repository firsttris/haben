# Umzug aus sevDesk

Haben übernimmt deinen Bestand aus sevDesk, damit du das Abo kündigen kannst, ohne Daten zu verlieren. Der Umzug läuft auf der Seite **Archiv** unter „Umzug“: Wähle oben „Umzug aus sevDesk“. Die Schritte sind dieselben wie beim [Umzug aus Lexoffice](lexoffice.md); diese Seite beschreibt, was bei sevDesk anders ist.

Abgerufene Belege landen im selben unveränderlichen Archiv wie die aus Lexoffice. Abgleich je Jahr, offene Posten, die Ansicht **Belege** und der Jahresexport behandeln beide Quellen gleich.

> [!NOTE]
> Der Abruf ist gegen die öffentliche OpenAPI-Beschreibung von sevDesk gebaut und mit nachgestellten Antworten getestet. Ein Lauf gegen ein echtes Konto steht noch aus. Die Datei eines Belegs holt Haben über `GET /Document/{id}/download`; dieser Endpunkt steht nicht in der aktuellen Beschreibung. Prüfe nach dem Abruf den Punkt „Jeder Beleg hat eine Datei“ im Abgleich und kündige erst, wenn er für jedes Jahr aufgeht.

## Voraussetzungen

- Einen **API-Token** von sevDesk. Du findest ihn unter **Einstellungen → Benutzer**, beim jeweiligen Benutzer. Er gibt Zugriff auf alles, was dieser Benutzer sieht.
- Firmendaten, Kontenrahmen und Versteuerungsart (Ist oder Soll) sind in Haben eingerichtet, wie in sevDesk ([Einrichtung](einrichtung.md)).
- Der Server braucht Zugriff auf `https://my.sevdesk.de`.

## Schritt 1: Verbindung zu sevDesk

Füge den Token ein und klicke „Prüfen und speichern“. Haben fragt damit die Version der Buchhaltung ab (`/Tools/bookkeepingSystemVersion`); klappt das, ist der Token gültig. Er wird wie der Lexoffice-Schlüssel mit AES-256-GCM verschlüsselt gespeichert und taucht weder im Änderungsprotokoll noch im Jahresexport auf. Haben liest nur. Nach dem Umzug entfernst du den Token mit „Token entfernen“.

## Schritt 2: Kontakte, Rechnungen und Belege abrufen

„Alles abrufen“ startet den Abruf im Hintergrund, mit Fortschritt, Abbrechen und Fortsetzen wie bei Lexoffice. Es läuft immer nur ein Abruf, gleich aus welcher Quelle.

1. **Kontakte:** Organisationen und Personen mit Name, Kundennummer, erster Adresse samt Land, Haupt-E-Mail, USt-IdNr. und Steuernummer. Ansprechpartner einer Organisation werden keine eigenen Kontakte. Gibt es in Haben schon einen Kontakt mit demselben Namen und ohne sevDesk-Herkunft, verknüpft Haben ihn.
2. **Belegliste:** alle Rechnungen, Gutschriften und Belege. Draußen bleiben Entwürfe, Vorlagen für wiederkehrende Rechnungen und Belege sowie Mahnungen.
3. **Positionen und Dateien:** je Beleg die Positionen (für die Aufteilung nach Steuersatz), das PDF der Rechnung bzw. Gutschrift, bei E-Rechnungen das XML und bei Belegen die hochgeladene Datei.

Haben ruft die PDFs mit `preventSendBy=true` ab; der Abruf markiert also keine Rechnung als versendet. Die Antwort der API wird je Beleg samt Positionen gespeichert, zum Nachweis.

### Wie sevDesk-Belege abgebildet werden

| sevDesk | Haben-Archiv |
| --- | --- |
| Rechnung (RE, TR, ER) | Rechnung |
| Abschlagsrechnung (AR) | Abschlagsrechnung |
| Stornorechnung (SR) | Gutschrift, negativ |
| Gutschrift | Gutschrift, negativ |
| Beleg „Einnahme“ (C) | Einnahmebeleg, bei negativer Summe Einnahme-Gutschrift |
| Beleg „Ausgabe“ (D) | Ausgabebeleg, bei negativer Summe Ausgabe-Gutschrift |

Maßgeblich sind Brutto und Steuer aus dem Kopf des Belegs; Netto ergibt sich daraus. Die Aufteilung nach Steuersatz kommt aus den Positionen, Rundungsdifferenzen zum Kopf landen beim größten Satz, die der Steuer beim größten Satz mit Steuer. Die Kennung eines Belegs ist Art und ID in sevDesk, etwa `invoice/123` oder `voucher/678`.

### Zahlungen

sevDesk liefert über diese Schnittstelle keine einzelnen Zahlungen, nur den bezahlten Betrag (`paidAmount`) und das letzte Zahldatum (`payDate`). Haben führt den bezahlten Betrag als eine Zahlung an diesem Datum. Bei Ist-Versteuerung rechnet die Umsatzsteuer je Monat im Abgleich damit; wurde eine Rechnung in mehreren Raten bezahlt, landet alles im Monat der letzten Zahlung. Vergleiche diese Monate mit den übermittelten Voranmeldungen.

### Was die API nicht liefert

- **Keine Buchungen und keine Bankumsätze.** Lade den DATEV-Export aus sevDesk hoch (Schritt 4).
- **Keine Kategorienamen.** Je Beleg-Position steht nur die ID des Buchungskontos. Übernommene offene Ausgabebelege bekommen deshalb die Kategorie „Sonstiges“; ändere sie bei Bedarf in Haben.
- Keine übermittelten Voranmeldungen, kein Anlagenverzeichnis ([Anlagen übernehmen](anlagen.md)), keine Angebote, Aufträge und Lieferscheine.

## Schritt 3 bis 5

Offene Posten, Exporte ablegen und Abgleich je Jahr funktionieren wie beim [Umzug aus Lexoffice](lexoffice.md#schritt-3-offene-posten-übernehmen). Unterschiede:

- Eine offene Rechnung ohne Nummer bekommt in Haben die Nummer `SD-` plus die ID aus sevDesk.
- Den Export für die Betriebsprüfung (GoBD) aus sevDesk legst du als „IDEA-Export“ ab; danach richtet sich die Prüfung „IDEA-Export archiviert“.
- Im Jahresexport stehen die Belege aus sevDesk ebenfalls unter `lexoffice/`; die Spalte „Quelle“ in `belege.csv` sagt, woher ein Beleg stammt.

## Andere API-Adresse

Haben spricht standardmäßig mit `https://my.sevdesk.de/api/v1`. Mit der Umgebungsvariable `SEVDESK_API_URL` setzt du eine andere Basis-URL, etwa zum Testen gegen einen nachgestellten Server.

## Vor der Kündigung

- [ ] Abruf ist fertig, die Liste der fehlgeschlagenen Belege ist leer
- [ ] Jeder Beleg hat eine Datei (Abgleich je Jahr)
- [ ] Für jedes Geschäftsjahr: DATEV-Export, GoBD-Export, ELSTER-Protokolle und Kontoauszüge abgelegt, jeweils mit Jahr
- [ ] Einnahmen, Ausgaben, Umsatz- und Vorsteuer je Jahr mit sevDesk verglichen
- [ ] Offene Posten übernommen oder die Gründe geklärt
- [ ] Nächste Rechnungsnummer in Haben gesetzt
- [ ] Jahresexport für jedes übernommene Jahr heruntergeladen
- [ ] API-Token in Haben entfernt
