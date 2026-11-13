---
title: "Umzug aus sevDesk ohne Datenverlust"
description: >-
  Von sevDesk zu Haben wechseln: Rechnungen, Belege und Kontakte übernehmen, im unveränderlichen
  Archiv aufbewahren und das Abo kündigen.
---

# Umzug aus sevDesk

Haben übernimmt deinen Bestand aus sevDesk, damit du das Abo kündigen kannst, ohne Daten zu verlieren. Der Umzug läuft auf der Seite **Archiv** unter „Umzug“: Wähle oben „Umzug aus sevDesk“. Die Schritte sind dieselben wie beim [Umzug aus Lexoffice](lexoffice.md).

Für eine GmbH oder UG gilt dasselbe wie beim [Umzug aus Lexoffice](lexoffice.md#umzug-einer-gmbh-oder-ug): Die Bestände über die offenen Posten hinaus übernimmst du mit einer Eröffnungsbuchung.

Abgerufene Belege landen im selben unveränderlichen Archiv wie die aus Lexoffice. Abgleich je Jahr, offene Posten, die Ansicht **Belege**, die [Kontaktseite](kontakte.md#rechnungen-und-belege-am-kontakt) und der Jahresexport behandeln beide Quellen gleich.

> [!WARNING]
> Der Abruf ist gegen die öffentliche OpenAPI-Beschreibung von sevDesk gebaut und mit nachgestellten Antworten getestet. Gezielt angelegte Auftragsdokumente wurden inzwischen mit sevDesk V1 geprüft; ein vollständiger Umzug wurde damit noch nicht getestet. Die Datei eines Belegs holt Haben über `GET /Document/{id}/download`; dieser Endpunkt steht nicht in der aktuellen Beschreibung. Prüfe nach dem Abruf den Punkt „Jeder Beleg hat eine Datei“ im Abgleich und kündige erst, wenn er für jedes Jahr aufgeht.

## Voraussetzungen

- Einen **API-Token** von sevDesk. Du findest ihn unter **Erweiterungen › Integrationen** im Bereich „API-Token für Integrationen“ (je nach Tarif auch unter **Erweiterungen › API**): **Einblenden** und mit deinem Passwort bestätigen ([sevDesk-Hilfe](https://hilfe.sevdesk.de/de/articles/9374740-wo-finde-ich-meinen-api-token-in-sevdesk)). Die REST-API gehört laut sevDesk erst ab dem Tarif **Buchhaltung Pro** dazu ([Preisseite](https://sevdesk.de/preise/), [sevDesk-Hilfe zur API](https://hilfe.sevdesk.de/de/articles/9374668-sevdesk-api), Stand November 2026); in kleineren Tarifen ist sie womöglich nicht nutzbar, siehe [Ohne REST-API](#ohne-rest-api).
- Firmendaten, Kontenrahmen und Versteuerungsart (Ist oder Soll) sind in Haben eingerichtet, wie in sevDesk ([Einrichtung](einrichtung.md)).
- Der Server braucht Zugriff auf `https://my.sevdesk.de`.

> [!IMPORTANT]
> Mit dem API-Token lassen sich die Daten deines sevDesk-Kontos lesen und ändern. Entferne ihn nach dem Umzug in Haben (siehe [Vor der Kündigung](#vor-der-kündigung)); das löscht ihn nur in Haben, nicht in sevDesk.

### Ohne REST-API

Ist die REST-API nicht Teil deines Tarifs, gibt es zwei Wege:

- **Vorübergehend auf Buchhaltung Pro wechseln**, für die Dauer des Abrufs, und danach kündigen oder zurückwechseln. Laufzeit und Kündigungsfrist des höheren Tarifs prüfst du vorher bei sevDesk.
- **Nur über die Exporte:** Unter **Steuern › Mein Steuerberater** den Datei-Export **Buchungsdaten & Belegbilder** je Geschäftsjahr erstellen, mit Belegbildern und mit den Häkchen für festgeschriebene Daten und für offene Rechnungen und Belege; ohne sie fehlen diese im Export ([sevDesk-Hilfe: Export](https://hilfe.sevdesk.de/de/articles/9373838-export)). Die ZIP-Datei enthält den Buchungsstapel und die Stammdaten (Kontakte des Zeitraums) als DATEV-kompatible CSV sowie die Belegbilder der Ein- und Ausgangsrechnungen. Lege die ganze ZIP-Datei in Haben als **Sonstiges** ab (höchstens 100 MB je Datei, sonst kürzere Zeiträume exportieren) und daraus entpackt den Buchungsstapel noch einmal als **DATEV-Buchungsstapel**. Die Stammdaten (`EXTF_GP_Stamm_….csv`) kannst du auch einzeln als **Sonstiges** ablegen; dafür gibst du das Geschäftsjahr an. Dazu kommt der GoBD-Export ([Schritt 4](lexoffice.md#schritt-4-exporte-ablegen)), wie beim [Weg ohne API bei Lexoffice](lexoffice.md#nur-über-die-exporte). Dann fehlen die Belege als Datensätze mit Positionen und Zahlungen, die Belegbilder liegen nur als ZIP im Archiv. Kontakte legst du neu an, etwa per [CSV-Import](csv-import.md#kontakte); die Stammdaten aus sevDesk liest Haben nicht direkt ein. Offene Posten trägst du von Hand ein, und kein Jahr zeigt im Abgleich „vollständig“.

Stand ([#472](https://github.com/firsttris/haben/issues/472)): Haben kann die ZIP-Datei „Buchungsdaten & Belegbilder“ lesen, mit den Belegen nach Beleglink, ihren Beträgen und Belegbildern. Die Übernahme dieser Belege ins Archiv folgt; bis dahin gilt der Weg oben.

## Schritt 1: Verbindung zu sevDesk

Füge den Token ein und klicke „Prüfen und speichern“. Haben fragt damit die Version der Buchhaltung ab (`/Tools/bookkeepingSystemVersion`); klappt das, ist der Token gültig. Er wird wie der Lexoffice-Schlüssel mit AES-256-GCM verschlüsselt gespeichert und taucht weder im Änderungsprotokoll noch im Jahresexport auf. Auftrags-PDFs werden ausschließlich bei frisch ermittelter Buchhaltungsversion 1.0 automatisch abgerufen, siehe unten. Nach dem Umzug entfernst du den Token mit „Token entfernen“.

## Schritt 2: Kontakte, Rechnungen und Belege abrufen

„Alles abrufen“ startet den Abruf im Hintergrund, mit Fortschritt, Abbrechen und Fortsetzen wie bei Lexoffice. Es läuft immer nur ein Abruf, gleich aus welcher Quelle.

1. **Kontakte:** Organisationen und Personen mit Name, Rolle, erster Adresse samt Land, Haupt-E-Mail und USt-IdNr. Wer als Kunde angelegt wird, erhält auch seine Kundennummer. Ansprechpartner einer Organisation werden keine eigenen Kontakte. Gibt es in Haben schon einen Kontakt mit demselben Namen und ohne sevDesk-Herkunft, verknüpft Haben ihn.
2. **Belegliste:** alle Rechnungen, Gutschriften und Belege. Draußen bleiben Entwürfe, Vorlagen für wiederkehrende Rechnungen und Belege sowie Mahnungen.
3. **Positionen und Dateien:** je Beleg die Positionen (für die Aufteilung nach Steuersatz), das PDF der Rechnung bzw. Gutschrift, bei E-Rechnungen das XML und bei Belegen die hochgeladene Datei.

Haben ruft die PDFs mit `preventSendBy=true` ab; der Abruf markiert also keine Rechnung als versendet. Die Antwort der API wird je Beleg samt Positionen gespeichert, zum Nachweis.

### Kontaktrollen und Nummern prüfen

Die [sevDesk-OpenAPI](https://api.sevdesk.de/openapi.yaml) nennt die Kontaktkategorien **Lieferant (2)**, **Kunde (3)**, **Partner (4)** und **Interessent (28)**. Haben legt neue Lieferanten ausschließlich als Lieferanten und neue Kunden ausschließlich als Kunden an. Haben kennt keine eigene Partner- oder Interessentenrolle: Diese sowie Kontakte mit fehlender oder unbekannter Kategorie erhalten bei der Neuanlage zunächst nur die Kundenrolle. Der Import zeigt dazu einen Hinweis. Prüfe diese Kontakte unter **Kontakte**. Rollen aus einzelnen Rechnungen oder Belegen werden nicht zusätzlich abgeleitet.

Bei gleichnamigen verknüpften Kontakten und bei **Erneut abrufen** ergänzt Haben eine eindeutige Kunden- oder Lieferantenrolle auch für schon importierte Kontakte. Bestehende Rollen und Nummern bleiben erhalten; bei unklarer Kategorie bleiben bestehende Rollen unverändert. Ein weiterer Abruf ohne neue Rolle erzeugt keine neue Kontaktversion.

**Ältere Importe werden damit nur teilweise berichtigt:** Ein Lieferant, der früher fälschlich als Kunde angelegt wurde, erhält beim nächsten Abruf die Lieferantenrolle und hat danach beide Rollen. Ob die Kundenrolle irrtümlich importiert oder später bewusst vergeben wurde, ist nicht verlässlich erkennbar. Entferne sie gegebenenfalls selbst unter **Kontakte**. Prüfe dort auch alte Nummernzuordnungen; der erneute Abruf löscht oder ersetzt sie nicht.

`Contact.customerNumber` wird bei neu angelegten Kontakten mit Kundenrolle zur **Kundennummer**, also auch bei Partnern, Interessenten und unklaren Kategorien. Es ist kein DATEV-Personenkonto. Die eigene Nummer eines Lieferanten in sevDesk wird weder als Kundennummer noch als **Lieferantennummer** übernommen: Letztere kann in Haben deine Nummer beim Lieferanten bezeichnen. Der Import legt keine DATEV-Personenkonten an.

### Wie sevDesk-Belege abgebildet werden

| sevDesk | Haben-Archiv |
| --- | --- |
| Rechnung (RE, TR, ER) | Rechnung |
| Abschlagsrechnung (AR) | Abschlagsrechnung |
| Stornorechnung (SR) | Gutschrift, negativ; hebt die Rechnung aus `origin` auf, siehe [Stornierte Rechnungen](#stornierte-rechnungen) |
| Gutschrift | Gutschrift, negativ; Honorar und Provision als Ausgabe-Gutschrift, positiv (siehe unten) |
| Beleg „Einnahme“ (`creditDebit` D) | Einnahmebeleg, bei negativer Summe Einnahme-Gutschrift |
| Beleg „Ausgabe“ (`creditDebit` C) | Ausgabebeleg, bei negativer Summe Ausgabe-Gutschrift |

Die Richtung `creditDebit` beschreibt die OpenAPI nur als „credit (C) or debit (D)“; dass C die Ausgabe ist, ist mit echten Antworten der Buchhaltungsversionen 1.0 und 2.0 belegt ([#472](https://github.com/firsttris/haben/issues/472)). Frühere Abrufe hatten beide vertauscht. Die Archivkopie bleibt unverändert, Haben liest Richtung und Belegart von sevDesk-Belegen aus der gespeicherten API-Antwort; ein neuer Abruf ist nicht nötig. Wurde vor der Korrektur eine Einnahme als offener Ausgabebeleg übernommen, bleibt sie versiegelt und erscheint weiter als übernommen; prüfe sie und korrigiere sie in Haben.

**Gutschriften** folgen der Buchung von sevDesk, zur Laufzeit aus der gespeicherten Antwort ([#472](https://github.com/firsttris/haben/issues/472)). Honorar und Provision (`bookingCategory` `ROYALTY_ASSIGNED`, `ROYALTY_UNASSIGNED`, `PROVISION`) bucht sevDesk auf ein Aufwandskonto mit Vorsteuer; sie erscheinen als „Ausgabe-Gutschrift“ auf der Ausgabenseite und in Kz 66. Minderleistung und Buchungskonto (`UNDERACHIEVEMENT`, `ACCOUNTING_TYPE`) mindern die Einnahmen. Belegt ist das am DATEV-Export von sevDesk mit je einer Gutschrift in Buchhaltungsversion 1.0 und in 2.0 für `PROVISION` und `ROYALTY_ASSIGNED`; für `ROYALTY_UNASSIGNED` gibt es in 2.0 nur das Buchungskonto (4909), keine Buchung. In 2.0 nennt der Kopf der Gutschrift 0 % und die Steuerregel 9, der Steuersatz steht nur an den Positionen; Haben nimmt ihn wie in 1.0 aus den Positionen. Steuerlich ist das nicht geprüft. Bei `ACCOUNTING_TYPE` entscheidet in sevDesk das gewählte Konto; Haben kennt es beim Abruf nicht und führt sie immer als Einnahme, prüfe eine Gutschrift auf einem Aufwandskonto also von Hand. Offene Gutschriften aus Honorar und Provision werden nicht als offene Posten übernommen.

sevDesk lässt bei vielen Belegen den Namen des Lieferanten leer (`supplierName`). Haben zeigt dann den Namen, den der Beleg beim Speichern trug (`supplierNameAtSave`), und erst ohne ihn den Namen des verknüpften Kontakts. So bleibt ein alter Beleg richtig, wenn der Kontakt später umbenannt wird. Die Archivkopie bleibt unverändert.

Maßgeblich sind Brutto und Steuer aus dem Kopf des Belegs; Netto ergibt sich daraus. Die Aufteilung nach Steuersatz kommt aus den Positionen, Rundungsdifferenzen zum Kopf landen beim größten Satz, die der Steuer beim größten Satz mit Steuer. Fehlen die Positionen, leitet Haben den Satz aus Netto und Steuer im Kopf ab (19 oder 7 %, die Sätze 16 und 5 % aus 2020 nur, wenn beide nicht passen); auch das gilt für schon abgerufene Belege. Die Kennung eines Belegs ist Art und ID in sevDesk, etwa `invoice/123` oder `voucher/678`.

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

Haben übernimmt den Zahlungsstand (`paidAmount`) als Quellsaldo und dazu die **Einzelzahlungen**: sevDesk ordnet einen Bankumsatz über `CheckAccountTransactionLog` einem Vorgang zu, mit dem zugeordneten Betrag, dem Buchungsdatum und dem Zahlungskonto. Ein geteilter Umsatz, etwa eine Überweisung für zwei Rechnungen, erscheint je Vorgang mit seinem Anteil. Haben liest diese Zuordnungen nur; der Endpunkt ist in der OpenAPI nicht beschrieben, das Verhalten ist mit echten Antworten der Buchhaltungsversion 1.0 belegt ([#343](https://github.com/firsttris/haben/issues/343)). Bei vollständig bezahlten Vorgängen bleibt das Zahldatum (`payDate`) „bezahlt am“.

Die Einzelzahlungen gelten nur, wenn sie den Zahlungsstand genau ergeben und alle in dieselbe Richtung gehen. Eine Zuordnung über 0 € (`amountPaid` 0), wie sevDesk sie etwa beim Stornieren anlegt, zählt dabei nicht als Zahlung und erscheint nicht im Monat ([#472](https://github.com/firsttris/haben/issues/472)). Dann rechnet Haben mit ihnen: Bei **Ist-Versteuerung** fällt die Steuer in den Monat der jeweiligen Zahlung, zum [Stichtag](lexoffice.md#stichtag) ist offen, was danach bezahlt wurde, und die Belegansicht zeigt jede Zahlung mit Datum, Betrag und Konto. Der Jahresexport enthält sie unter `lexoffice/zahlungen.csv`.

Fehlen Einzelzahlungen, ergeben sie nicht den Zahlungsstand (etwa bei Skonto, Verrechnung mit einer Gutschrift oder Barzahlung ohne Umsatz) oder enthalten sie eine Rückbuchung, bleibt der Stand **unklar**, und die Belegansicht nennt den Grund:

- **Vor dem Stichtag vollständig bezahlt:** Der Vorgang war am Stichtag sicher bezahlt und erscheint nicht unter den offenen Posten.
- **Erst nach dem Stichtag vollständig bezahlt, teilweise bezahlt oder ohne Zahldatum:** Der Stand am Stichtag ist **unklar**, die aktive Übernahme gesperrt. In der Stichtagsliste steht statt eines vermeintlich genauen offenen Betrags „Unklar“.

Bei **Ist-Versteuerung** sperrt Haben dann den monatlichen Altbestandsabgleich für jedes Jahr, in das eine solche Zahlung fallen kann: bei vollständig bezahlten Vorgängen alle Jahre bis zum Zahldatum, bei Teilzahlungen und ohne Zahldatum alle Jahre. Spätere Jahre, etwa nach einem Wechsel von sevDesk zu Lexoffice, bleiben im Abgleich. Ebenso lehnt die zahlungsbezogene Zeitraumabfrage für KI-Assistenten nur Zeiträume ab, in die eine solche Zahlung fallen kann. Bei **Soll-Versteuerung** bleibt der Abgleich nach Belegdatum verfügbar; der Stichtagsschutz gilt unabhängig davon.

**Aufgehobene Zuordnungen:** Hebt man in sevDesk die Zuordnung eines Umsatzes auf, löscht sevDesk den Eintrag im `CheckAccountTransactionLog`; eine Gegenbuchung gibt es nicht. Der Zahlungsstand sinkt entsprechend, `payDate` bleibt dabei auf dem Tag der aufgehobenen Zahlung stehen (in Version 1.0 beobachtet). Haben wertet `payDate` deshalb nur bei vollständig bezahlten Vorgängen aus. Eine schon archivierte Kopie bleibt auf dem Stand ihres Abrufs, mit den damals belegten Zahlungen.

**Reparatur früherer Abrufe:** Ein neuer Abruf ergänzt die Einzelzahlungen auch für schon archivierte Vorgänge, deren Zahlungen bisher zu einer verdichtet oder gar nicht belegt waren. Die Archivkopie bleibt unverändert; die Zahlungen sind eigene, unveränderliche Nachträge, und jede sevDesk-Zuordnung kommt nur einmal an. Weil die Kopie den Zahlungsstand vom Tag ihres Abrufs zeigt, rechnet Haben dafür nur Zuordnungen, die sevDesk bis dahin angelegt hatte; spätere Zuordnungen stehen im Jahresexport, erklären den Stand der Kopie aber nicht. Schlägt der Abruf der Zahlungen fehl, bleibt die Sperre bestehen und der Fortschritt nennt den Fehler. Bereits aktiv übernommene Posten korrigiert Haben nicht rückwirkend; ihre Buchungen sind versiegelt.

#### Stornierte Rechnungen

sevDesk führt eine stornierte Rechnung und ihre Stornorechnung beide als „bezahlt“, ohne Zahlung. Erkennbar ist das Paar an `invoiceType` `SR` und dem Verweis `origin` auf die Rechnung. Haben wertet beide dann als storniert: nichts offen, keine Sperre wegen fehlender Einzelzahlungen, und im Umsatz heben sie sich auf. Das gilt nur für den vollen Betrag, nur wenn zu beiden keine Zahlung besteht und nur bei genau einer Stornorechnung zur Rechnung; sonst bleibt der Stand unklar. Einen Zahlungstag (`payDate`) an der Stornorechnung zählt Haben nicht als Zahlung, wenn sie `paidAmount` 0 nennt: sevDesk setzt ihn beim Stornieren teils, ohne dass Geld floss ([#472](https://github.com/firsttris/haben/issues/472)). Ebenso keine Zahlung ist eine Zuordnung über 0 € im Zahlungsverlauf (`amountPaid` 0), wie sevDesk sie beim Stornieren teils anlegt. An der stornierten Rechnung bleibt ein Zahlungstag ein Grund für „unklar“. Liegt das Storno nach dem [Stichtag](lexoffice.md#stichtag), war die Rechnung am Stichtag noch offen; sie erscheint dann gesperrt mit dem Grund „Storno nach dem Stichtag“. Auch das wertet Haben zur Laufzeit aus, frühere Abrufe sind damit abgedeckt. Die Aufteilung nach Steuersatz steht dagegen im Abruf: Hat eine früher abgerufene Stornorechnung mehrere Steuersätze und eine Rabattzeile, heben sich die Beträge nur in der Summe auf, nicht je Satz.

### Angebote, Auftragsbestätigungen und Lieferscheine

Haben archiviert die drei Auftragsarten aus sevDesk (`Order`: `AN`, `AB`, `LI`) getrennt von Rechnungen und Buchungsbelegen. Unter **Archiv → Auftragsdokumente** suchst du nach Nummer oder Kontakt und filterst nach Dokumentart und Jahr. Datum, Quellstatus, Positionen, Folgebeziehungen und die vollständigen API-Antworten bleiben erhalten. Auch **Entwürfe**, angenommene, abgelehnte und teilweise oder vollständig berechnete Vorgänge sind enthalten. Es entstehen keine bearbeitbaren Haben-Angebote und keine eigenen Nummern.

**Teilweise berechnet:** Der Quellstatus `750` und die Beziehungen zu Rechnungen oder anderen Auftragsdokumenten bleiben erhalten. Haben erzeugt aus einer Auftragsbestätigung weder eine zusätzliche Forderung noch eine Zahlung und berechnet keinen vermeintlichen Restbetrag. Rechnungen werden über ihren eigenen Import übernommen. Die Quellbeziehungen können in V1 als Liste oder als Objekt mit lückenhaften Zahlenschlüsseln geliefert werden; beide Formen bleiben unverändert erhalten.

**Fremdwährung:** Für einen Auftrag in Fremdwährung zeigt und exportiert Haben die `sum*ForeignCurrency`-Summen aus sevDesk. Fehlen sie, bleiben die entsprechenden Beträge leer; EUR-Basisbeträge werden nicht mit einem Fremdwährungscode ausgegeben. Die vollständigen Quellbeträge bleiben in den Originaldaten erhalten.

**Automatische PDFs nur für Buchhaltungsversion 1.0:** Haben ermittelt vor jedem fehlenden Auftrags-PDF die Version frisch über `/Tools/bookkeepingSystemVersion`. Nur exakt `1.0` ist freigegeben. Bei `2.0`, unbekannter Version oder fehlgeschlagener Versionsprüfung werden die Metadaten weiter archiviert; die PDFs bleiben als fehlend markiert und können manuell ergänzt werden. Die Adresse `/api/v1` unterscheidet diese Buchhaltungsversionen nicht. Eine gespeicherte frühere V1-Verbindung oder zusätzliche Aufrufdaten heben die Sperre nicht auf.

Die [sevDesk-API](https://api.sevdesk.de/#tag/Order) beschreibt `getPdf` mit „commit the order“. Deshalb wurde `preventSendBy=true` gezielt an sieben V1-Dokumenten geprüft: AN, AB und LI, einschließlich Entwürfen, abgelehntem Angebot und teilberechneter AB. Status, Version, Versanddatum/-art und Änderungszeit blieben unverändert. Laut Nutzerrückmeldung blieben auch alle getesteten Entwürfe weiter bearbeitbar; sichtbare Änderungs-/Verlaufseinträge entstanden nicht. Diese Ergebnisse gelten für die geprüften Fälle und **nicht für Buchhaltungsversion 2.0**.

**Nachweise und Fehler:** Vor einem PDF-Abruf vergleicht Haben den aktuellen Quellstand mit der Archivkopie. Bei Abweichungen wird das PDF nicht dem alten Stand zugeordnet; die übrigen Dokumente erhalten ihre PDFs weiterhin automatisch. Nach jedem begonnenen PDF-Abruf folgt eine Nachkontrolle, auch nach einer fehlgeschlagenen Antwort. Vorher-/Nachher-Antworten und Fehler bleiben unveränderlich im PDF-Abrufprotokoll erhalten. Eine PDF-Anfrage wird nicht automatisch wiederholt und folgt keiner Weiterleitung. Bei unerwarteten Änderungen, PDF-Fehlern oder fehlender Nachkontrolle setzt Haben weitere automatische Auftrags-PDFs im laufenden Import aus; die Metadaten werden weiter archiviert. Ein auffälliges PDF wird nicht als erfolgreiche Originaldatei zugeordnet. Der offene Punkt steht im Import und im Abrufprotokoll.

Ein neuer Abruf lädt fehlende PDFs nach, soweit die Versions- und Quellstandsprüfung das erlauben. Vorhandene Dateien, auch manuelle Nachträge, und archivierte Metadaten werden nicht ersetzt.

**Manuell ergänzen:** Auf der Detailseite kannst du ein Original-PDF bis 20 MB anhängen. Es erscheint als „manuell nachgereicht“ mit Zeitpunkt und Prüfsumme; frühere Dateien und Quelldaten werden nicht ersetzt. Fehlende PDFs bleiben sichtbar und verhindern den Vollständigkeitshinweis zum Umzug. Ein Anhang erzeugt weder eine Buchung noch einen aktiven offenen Posten. Diese Ergänzung betrifft nur Auftragsdokumente; das allgemeine Nachreichen von Unterlagen zu Belegen und Darlehen bleibt eine eigene Erweiterung.

Der Jahresexport enthält `sevdesk/auftraege.csv` sowie PDFs, Quelldaten und PDF-Abrufprotokolle unter `sevdesk/auftraege/`. Die Auftragsdaten verändern keine Umsatz-, Steuer- oder OP-Summen. Für KI-Assistenten stehen eigene lesende Archivwerkzeuge bereit.

### Grenzen des aktuellen Imports

- **Keine Buchungen und keine Bankumsätze.** Lade den DATEV-Export aus sevDesk hoch (Schritt 4).
- **Keine Kategorienamen.** Je Beleg-Position steht nur die ID des Buchungskontos. Übernommene offene Ausgabebelege bekommen deshalb die Kategorie „Sonstiges“; ändere sie bei Bedarf in Haben. Aus demselben Grund erkennt der Abgleich bei GmbH und UG Gesellschafter, Kapital, Darlehen und Steuern vom Einkommen aus sevDesk nicht ([Einordnung](lexoffice.md#einordnung-bei-gmbh-und-ug)); sie zählen dort als Einnahme bzw. Ausgabe. Ziehe sie beim Vergleich mit sevDesk selbst ab.
- Keine übermittelten Voranmeldungen, kein Anlagenverzeichnis ([Anlagen übernehmen](anlagen.md)), keine Mahnungen oder wiederkehrenden Vorlagen. Entwürfe von Rechnungen, Gutschriften und Belegen bleiben ebenfalls ausgeschlossen.

## Schritt 3 bis 5

Offene Posten, Exporte ablegen und Abgleich je Jahr funktionieren wie beim [Umzug aus Lexoffice](lexoffice.md#schritt-3-offene-posten-übernehmen). Unterschiede:

- sevDesk entfernt aus Belegnummern Zeichen, die im DATEV-Feld nicht erlaubt sind (etwa Punkt und Umlaute), und schreibt von längeren Nummern nur die letzten 36 ins Belegfeld 1 des DATEV-Exports. Der Abgleich „Jede Buchung mit Belegnummer findet ihren Beleg“ erkennt das.
- In Zahlungsbuchungen steht im Belegfeld 1 oft eine interne Kennung von sevDesk (UUID). Sie ist keine Belegnummer und zählt im Abgleich unter „ohne Belegnummer“.

- Eine offene Rechnung ohne Nummer bekommt in Haben die Nummer `SD-` plus die ID aus sevDesk.
- Den Export für die Betriebsprüfung (GoBD) aus sevDesk legst du als „IDEA-Export“ ab; danach richtet sich die Prüfung „IDEA-Export archiviert“.
- Im Jahresexport stehen die Belege aus sevDesk ebenfalls unter `lexoffice/`; die Spalte „Quelle“ in `belege.csv` sagt, woher ein Beleg stammt.

## Andere API-Adresse

Haben spricht standardmäßig mit `https://my.sevdesk.de/api/v1`. Mit der Umgebungsvariable `SEVDESK_API_URL` setzt du eine andere Basis-URL, etwa zum Testen gegen einen nachgestellten Server.

## Vor der Kündigung

- [ ] Abruf ist fertig, die Liste der fehlgeschlagenen Belege ist leer
- [ ] Jeder Beleg hat eine Datei (Abgleich je Jahr)
- [ ] Alle Auftragsdokumente sind vorhanden und deren Original-PDFs ergänzt
- [ ] Für jedes Geschäftsjahr: DATEV-Export, GoBD-Export, ELSTER-Protokolle und Kontoauszüge abgelegt, jeweils mit Jahr
- [ ] Einnahmen, Ausgaben, Umsatz- und Vorsteuer je Jahr mit sevDesk verglichen
- [ ] Offene Posten übernommen oder die Gründe geklärt
- [ ] Nächste Rechnungsnummer in Haben gesetzt
- [ ] Jahresexport für jedes übernommene Jahr heruntergeladen
- [ ] API-Token in Haben entfernt (das löscht ihn nur in Haben, nicht in sevDesk)
