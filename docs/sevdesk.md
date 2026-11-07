# Umzug aus sevDesk

Haben übernimmt deinen Bestand aus sevDesk, damit du das Abo kündigen kannst, ohne Daten zu verlieren. Der Umzug läuft auf der Seite **Archiv** unter „Umzug“: Wähle oben „Umzug aus sevDesk“. Die Schritte sind dieselben wie beim [Umzug aus Lexoffice](lexoffice.md); diese Seite beschreibt, was bei sevDesk anders ist.

Für eine GmbH oder UG gilt dasselbe wie beim [Umzug aus Lexoffice](lexoffice.md#umzug-einer-gmbh-oder-ug): Die Bestände über die offenen Posten hinaus übernimmst du mit einer Eröffnungsbuchung.

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

1. **Kontakte:** Organisationen und Personen mit Name, Kundennummer, erster Adresse samt Land, Haupt-E-Mail und USt-IdNr. Ansprechpartner einer Organisation werden keine eigenen Kontakte. Gibt es in Haben schon einen Kontakt mit demselben Namen und ohne sevDesk-Herkunft, verknüpft Haben ihn.
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

### Steuerarten im Abgleich

Für die Umsatzsteuer je Monat übersetzt Haben die Steuerregel von sevDesk in die Kennzahlen, wie bei Lexoffice:

| sevDesk | Abgleich |
| --- | --- |
| Regel 1 „Umsatzsteuerpflichtige Umsätze“ bzw. taxType `default` | Kz 81, Kz 86 |
| Regel 2 „Ausfuhren“ | Kz 43 |
| Regel 3 „Innergemeinschaftliche Lieferungen“ bzw. taxType `eu` | Kz 41 |
| Regel 4 „Steuerfreie Umsätze § 4 UStG“, Regel 11 „§ 19 UStG“ bzw. taxType `ss` | Steuerfrei |
| Regel 5 „Reverse Charge § 13b“ und alles andere | Andere Sätze |

Reverse Charge lässt sich ohne weitere Angaben nicht eindeutig Kz 21 oder Kz 60 zuordnen; vergleiche diese Umsätze von Hand.

### Zahlungen

Der aktuelle Abruf übernimmt den Zahlungsstand (`paidAmount`) als Quellsaldo. Einzelne Zahlungen mit verlässlicher Belegzuordnung werden noch nicht abgerufen. Haben erzeugt deshalb daraus keine Zahlung am letzten Zahldatum oder ersatzweise am Belegdatum. Bei vollständig bezahlten Vorgängen übernimmt Haben das Zahldatum (`payDate`) als „bezahlt am“; laut [sevDesk-OpenAPI](https://api.sevdesk.de/openapi.yaml) ist das der Tag, an dem der Vorgang bezahlt wurde. Danach liegt keine Zahlung mehr.

Sobald ein sevDesk-Vorgang bereits Zahlungen enthält, ist offen, wann sie bis zu diesem Tag eingingen. Für den [Stichtag](lexoffice.md#stichtag) heißt das:

- **Vor dem Stichtag vollständig bezahlt:** Der Vorgang war am Stichtag sicher bezahlt und erscheint nicht unter den offenen Posten.
- **Erst nach dem Stichtag vollständig bezahlt, teilweise bezahlt oder ohne Zahldatum:** Der Stand am Stichtag ist **unklar**, die aktive Übernahme gesperrt. In der Stichtagsliste steht statt eines vermeintlich genauen offenen Betrags „Unklar“.

Bei **Ist-Versteuerung** sperrt Haben den monatlichen Altbestandsabgleich für jedes Jahr, in das eine solche Zahlung fallen kann: bei vollständig bezahlten Vorgängen alle Jahre bis zum Zahldatum, bei Teilzahlungen und ohne Zahldatum alle Jahre. Spätere Jahre, etwa nach einem Wechsel von sevDesk zu Lexoffice, bleiben im Abgleich. Ebenso lehnt die zahlungsbezogene Zeitraumabfrage für KI-Assistenten nur Zeiträume ab, in die eine solche Zahlung fallen kann. Die Prüfung eines gesperrten Jahres bleibt offen. Bei **Soll-Versteuerung** bleibt der Abgleich nach Belegdatum verfügbar; der Stichtagsschutz gilt unabhängig davon. Quellbeträge und Originaldateien werden weiter archiviert.

Der Schutz greift auch für bereits importierte, zu einer Zahlung verdichtete Daten; das Zahldatum liest Haben dort aus den gespeicherten sevDesk-Originaldaten. Diese bleiben unverändert; die Verdichtung erscheint nicht mehr als belegte Einzelzahlung. Eine verlässliche Zahlungsrekonstruktion und die Reparatur bereits aktiv übernommener Posten sind noch nicht umgesetzt. Bereits übernommene Posten mit dem sevDesk-Bestand abgleichen; Haben korrigiert ihre versiegelten Buchungen nicht rückwirkend.

### Was die API nicht liefert

- **Keine Buchungen und keine Bankumsätze.** Lade den DATEV-Export aus sevDesk hoch (Schritt 4).
- **Keine Kategorienamen.** Je Beleg-Position steht nur die ID des Buchungskontos. Übernommene offene Ausgabebelege bekommen deshalb die Kategorie „Sonstiges“; ändere sie bei Bedarf in Haben. Aus demselben Grund erkennt der Abgleich bei GmbH und UG Gesellschafter, Kapital, Darlehen und Steuern vom Einkommen aus sevDesk nicht ([Einordnung](lexoffice.md#einordnung-bei-gmbh-und-ug)); sie zählen dort als Einnahme bzw. Ausgabe. Ziehe sie beim Vergleich mit sevDesk selbst ab.
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
