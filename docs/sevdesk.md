---
title: "Umzug aus sevDesk ohne Datenverlust"
description: >-
  Von sevDesk zu Haben wechseln: Rechnungen, Belege und Kontakte übernehmen, im unveränderlichen
  Archiv aufbewahren und das Abo kündigen.
---

# Umzug aus sevDesk

Haben übernimmt deinen Bestand aus sevDesk, damit du das Abo kündigen kannst, ohne Daten zu verlieren. Der Umzug läuft auf der Seite **Archiv** unter „Umzug“: Wähle oben „Umzug aus sevDesk“. Die Schritte sind dieselben wie beim [Umzug aus Lexoffice](lexoffice.md), dazu kommt [Schritt 4](#schritt-4-anlagen-übernehmen) für die Anlagen.

Für eine GmbH oder UG gilt dasselbe wie beim [Umzug aus Lexoffice](lexoffice.md#umzug-einer-gmbh-oder-ug): Die Bestände über die offenen Posten hinaus übernimmst du mit einer Eröffnungsbuchung.

Abgerufene Belege landen im selben unveränderlichen Archiv wie die aus Lexoffice. Abgleich je Jahr, offene Posten, die Ansicht **Belege**, die [Kontaktseite](kontakte.md#rechnungen-und-belege-am-kontakt) und der Jahresexport behandeln beide Quellen gleich.

> [!WARNING]
> Der Abruf ist gegen die öffentliche OpenAPI-Beschreibung von sevDesk gebaut und mit nachgestellten Antworten getestet. Gezielt angelegte Auftragsdokumente wurden inzwischen mit sevDesk V1 geprüft, der PDF-Abruf auch an einem Entwurf in V2; ein vollständiger Umzug wurde damit noch nicht getestet. Die Datei eines Belegs holt Haben über `GET /Document/{id}/download`; dieser Endpunkt steht nicht in der aktuellen Beschreibung. Prüfe nach dem Abruf den Punkt „Jeder Beleg hat eine Datei“ im Abgleich und kündige erst, wenn er für jedes Jahr aufgeht.

## Voraussetzungen

- Einen **API-Token** von sevDesk. Du findest ihn unter **Erweiterungen › Integrationen** im Bereich „API-Token für Integrationen“ (je nach Tarif auch unter **Erweiterungen › API**): **Einblenden** und mit deinem Passwort bestätigen ([sevDesk-Hilfe](https://hilfe.sevdesk.de/de/articles/9374740-wo-finde-ich-meinen-api-token-in-sevdesk)). Die REST-API gehört laut sevDesk erst ab dem Tarif **Buchhaltung Pro** dazu ([Preisseite](https://sevdesk.de/preise/), [sevDesk-Hilfe zur API](https://hilfe.sevdesk.de/de/articles/9374668-sevdesk-api), Stand November 2026); in kleineren Tarifen ist sie womöglich nicht nutzbar, siehe [Ohne REST-API](#ohne-rest-api).
- Firmendaten, Kontenrahmen und Versteuerungsart (Ist oder Soll) sind in Haben eingerichtet, wie in sevDesk ([Einrichtung](einrichtung.md)).
- Der Server braucht Zugriff auf `https://my.sevdesk.de`.

> [!IMPORTANT]
> Mit dem API-Token lassen sich die Daten deines sevDesk-Kontos lesen und ändern. Entferne ihn nach dem Umzug in Haben (siehe [Vor der Kündigung](#vor-der-kündigung)); das löscht ihn nur in Haben, nicht in sevDesk.

### Ohne REST-API

Ist die REST-API nicht Teil deines Tarifs, gibt es zwei Wege:

- **Vorübergehend auf Buchhaltung Pro wechseln**, für die Dauer des Abrufs, und danach kündigen oder zurückwechseln. Laufzeit und Kündigungsfrist des höheren Tarifs prüfst du vorher bei sevDesk.
- **Nur über die Exporte:** Unter **Steuern › Mein Steuerberater** den Datei-Export **Buchungsdaten & Belegbilder** je Geschäftsjahr erstellen, mit Belegbildern und mit den Häkchen für festgeschriebene Daten und für offene Rechnungen und Belege; ohne sie fehlen diese im Export ([sevDesk-Hilfe: Export](https://hilfe.sevdesk.de/de/articles/9373838-export)). Die ZIP-Datei enthält den Buchungsstapel und die Stammdaten (Kontakte des Zeitraums) als DATEV-kompatible CSV sowie die Belegbilder der Ein- und Ausgangsrechnungen. Lade sie unter „Umzug aus sevDesk“ bei **Ohne API: Export hochladen** hoch (höchstens 100 MB je Datei, sonst kürzere Zeiträume exportieren), siehe [Export übernehmen](#export-übernehmen). Die Stammdaten (`EXTF_GP_Stamm_….csv`) übernimmst du mit Debitor und Kreditor über den [CSV-Import der Kontakte](csv-import.md#kontakte-aus-datev). Dazu kommt der GoBD-Export ([Schritt 4](lexoffice.md#schritt-4-exporte-ablegen)), wie beim [Weg ohne API bei Lexoffice](lexoffice.md#nur-über-die-exporte).

#### Export übernehmen

„Hochladen und prüfen“ liest die ZIP-Datei und zeigt, was übernommen wird; angelegt ist dann noch nichts. Eine ZIP-Datei, die nicht der Export von sevDesk ist, lehnt Haben mit Grund ab. „Übernehmen“ legt danach unveränderlich ab:

- die ZIP-Datei als **Sonstiges** und den Buchungsstapel daraus als **DATEV-Buchungsstapel**,
- je Beleg einen Beleg im Archiv mit seinem Belegbild, zu finden unter **Belege** mit der Quelle „sevDesk-Export“. Ein Beleg ist eine Buchung mit Beleglink; Buchungen mit Netto oder Steuer in der Beleginfo, aber ohne Beleglink, werden ein Beleg ohne Belegbild.

Einnahme oder Ausgabe richtet sich nach der Buchung, nicht nach dem Ordner in sevDesk:

- **Erlöskonto:** Einnahme; im Soll gebucht, etwa eine Gutschrift, mindert sie die Einnahmen. Das gilt auch für einen Beleg aus dem Rechnungseingang auf einem Erlöskonto; der Hinweis „Richtung prüfen“ nennt ihn.
- **Aufwandskonto:** Ausgabe. Eine Gutschrift aus dem Rechnungsausgang im Soll mit Vorsteuer (BU 8 oder 9), etwa für Honorar oder Provision, ist eine Abrechnung im Gutschriftverfahren (§ 14 Abs. 2 Satz 2 UStG): Ausgabe-Gutschrift mit Vorsteuer wie beim Abruf über die API, ohne Hinweis.
- **Andere Konten** (Darlehen, Privat, Steuern, Zinsen, Anlagen): Einnahme, wenn das Konto im Haben steht (Geld kommt herein), sonst Ausgabe, immer mit positivem Betrag.

Ein Beleg in Fremdwährung ohne Netto und Steuer in der Beleginfo hat keinen Euro-Betrag. Haben legt ihn nicht an, nennt ihn im Fortschritt mit Grund und behält ihn nur in ZIP-Datei und Buchungsstapel; trage ihn bei Bedarf von Hand ein.

Einnahmen, Ausgaben und Umsatzsteuer eines Jahres nimmt der [Abgleich](#schritt-3-5-und-6) aus dem Buchungsstapel nach Kontenbereich, nicht aus diesen Belegen; ein Darlehen zählt dort also weder als Einnahme noch als Ausgabe. Offene Posten legt der Export nicht an, weil er keinen Zahlungsstand je Beleg kennt; trage sie von Hand ein.

Doppelt angelegt wird nichts:

- Ein zweiter Upload derselben oder einer neueren ZIP-Datei überspringt Belege, die es schon gibt; ein fehlendes Belegbild hängt er an.
- Liegen ZIP-Datei oder Buchungsstapel schon im Archiv, etwa auf dem früheren Weg als **Sonstiges** und **DATEV-Buchungsstapel**, bleibt es bei der vorhandenen Datei. Belegt ein anderer Buchungsstapel den Zeitraum schon, legt Haben den aus der ZIP-Datei nicht an und sagt das.
- In einem Jahr mit Belegen aus der API legt der Export keine Belege an.

#### Abgleich für Jahre aus dem Export

Statt „Belege und Rechnungen per API abgerufen“ zeigt der Abgleich „Belege aus dem sevDesk-Export übernommen“, mit Zahlen für die Zustände eines Belegs:

- **mit Datei:** Beleglink und Belegbild im Export;
- **Datei fehlt im Export:** Die Buchung hat einen Beleglink, die Datei fehlt in der ZIP-Datei. Das hält „Jeder Beleg hat eine Datei“ offen;
- **ohne Belegbild im Export:** Belegdaten ohne Beleglink. Kein Fehler, denn auch sevDesk hat dazu kein Bild.

In Buchhaltungsversion 2.0 hat auch ein Beleg ohne Bild einen Beleglink; seine Kennung steht dann in keiner `document.xml`. Haben zählt ihn heute noch als „Datei fehlt im Export“ ([#1374](https://github.com/firsttris/haben/issues/1374)). Prüfe solche Belege in sevDesk, bevor du den Punkt als Fehler behandelst.

Bei „Jede Buchung mit Belegnummer findet ihren Beleg“ findet eine Buchung mit Beleglink ihren Beleg nur über dessen Kennung, auch die weiteren Zeilen desselben Belegs. Zwei Belege mit derselben Nummer zählen so getrennt; Zahlungen ohne Beleglink finden ihren Beleg weiter über die Nummer.

Ein Jahr aus dem Export wird bei **Soll-Versteuerung** vollständig, wenn alle Prüfungen aufgehen. Bei **Ist-Versteuerung** bleibt „Zahlungshistorie vollständig“ offen: Der Export ordnet Zahlungen keinem Beleg zu, die Umsatzsteuer je Monat lässt sich daraus nicht ableiten. Vergleiche sie mit den Voranmeldungen in sevDesk.

#### Was der Export anders enthält als die API

Verglichen an einem Konto mit Buchhaltungsversion 1.0 und SKR03, Jahr 2024: 210 Belege aus dem Export gegen 218 Rechnungen, Belege und Gutschriften aus der API ([#472](https://github.com/firsttris/haben/issues/472)). Version 2.0 ist nicht verglichen.

- **Vollständigkeit:**
  - Jeder Beleg aus dem Export hat seine Entsprechung in der API, mit gleichem Datum.
  - Umgekehrt fehlen nur Vorlagen wiederkehrender Belege (in der API `voucherType` RV); sie sind keine Belege.
  - Belege auf Darlehens-, Privat- und Zinskonten stehen mit Netto und Steuer in der Beleginfo im Stapel, aber ohne Belegbild (19 von 218).
- **Belegbilder:** Der Export hat auch Bilder, wo die API keine Datei meldet (8 Belege, alle zu einem wiederkehrenden Beleg).
- **Belegnummern:** Wiederkehrende Belege teilen ihre Nummer (bis zu 9 Belege je Nummer); erst das Datum unterscheidet sie. Zeichen außerhalb des DATEV-Zeichensatzes fehlen (siehe [Schritt 3, 5 und 6](#schritt-3-5-und-6)).
- **Fremdwährung:** Im Umsatz steht der Betrag in der Fremdwährung, Netto und Steuer in der Beleginfo stehen in Euro. `Kurs` und `Basis-Umsatz` sind leer.
- **Gutschriften für Honorar und Provision** liegen im Ordner Rechnungsausgang, sind aber auf einem Aufwandskonto im Soll mit BU 9 gebucht (Konten 31xx, 47xx, 49xx; Exporte vom November 2026), siehe [Export übernehmen](#export-übernehmen).
- **Was nur die API hat:** Positionen, Steuerregel, Zahlungsstand und die Zuordnung der Zahlungen zu Belegen, Angebote und Aufträge.
- **Kopf des Stapels:** Der Kontenrahmen steht nicht darin; Haben nimmt den aus den Firmendaten. Ein Export umfasst höchstens ein Wirtschaftsjahr.

## Schritt 1: Verbindung zu sevDesk

Füge den Token ein und klicke „Prüfen und speichern“. Haben fragt damit die Version der Buchhaltung ab (`/Tools/bookkeepingSystemVersion`); klappt das, ist der Token gültig. Er wird wie der Lexoffice-Schlüssel mit AES-256-GCM verschlüsselt gespeichert und taucht weder im Änderungsprotokoll noch im Jahresexport auf. Auftrags-PDFs werden nur bei frisch ermittelter Buchhaltungsversion 1.0 oder 2.0 automatisch abgerufen, siehe unten. Nach dem Umzug entfernst du den Token mit „Token entfernen“.

## Schritt 2: Kontakte, Rechnungen und Belege abrufen

„Alles abrufen“ startet den Abruf im Hintergrund, mit Fortschritt, Abbrechen und Fortsetzen wie bei Lexoffice. Es läuft immer nur ein Abruf, gleich aus welcher Quelle.

1. **Kontakte:** Organisationen und Personen mit Name, Rolle, erster Adresse samt Land, Haupt-E-Mail und USt-IdNr. Wer als Kunde angelegt wird, erhält auch seine Kundennummer. Ansprechpartner einer Organisation werden keine eigenen Kontakte. Gibt es in Haben schon einen Kontakt mit demselben Namen und ohne sevDesk-Herkunft, verknüpft Haben ihn.
2. **Artikel:** alle Artikel mit Nummer, Bezeichnung, Beschreibung, Einheit, Preis, Steuersatz und internem Kommentar; inaktive kommen archiviert an, siehe [Artikel](#artikel).
3. **Belegliste:** alle Rechnungen, Gutschriften und Belege. Draußen bleiben Entwürfe; Mahnungen, Voranmeldungen und die Vorlagen für wiederkehrende Belege und Rechnungen holen eigene Schritte.
4. **Positionen und Dateien:** je Beleg die Positionen (für die Aufteilung nach Steuersatz), das PDF der Rechnung bzw. Gutschrift, bei E-Rechnungen das XML und bei Belegen die hochgeladene Datei.
5. **Mahnungen:** jede gespeicherte Mahnstufe mit PDF, siehe [Mahnungen](#mahnungen).
6. **Voranmeldungen:** jede übermittelte Umsatzsteuer-Voranmeldung mit Protokoll, nur zum Nachweis, siehe [Übermittelte Voranmeldungen](#übermittelte-voranmeldungen).
7. **Vorlagen für wiederkehrende Belege:** als angehaltene [Dauerbelege](belege.md#dauerbelege), siehe [unten](#vorlagen-für-wiederkehrende-belege).
8. **Dateien aus Vorlagen:** Belege, die sevDesk aus einer Vorlage für wiederkehrende Belege anlegt, tragen in der API keine eigene Datei, nur den Verweis auf die Vorlage (`origin`). Hat ein Beleg keine Datei und seine Vorlage eine, hängt Haben diese an, auch an Belege aus früheren Abrufen:
    - Nur, wenn sevDesk den Beleg nach dem Hochladen der Datei angelegt hat: Eine später an die Vorlage gehängte Datei, etwa ein Zahlplan, gehört nicht zu früheren Monaten. Ältere Belege bleiben ohne Datei und zählen im Abgleich „Jeder Beleg hat eine Datei“ weiter als Beleg ohne Datei.
    - Eine eigene Datei des Belegs ersetzt Haben nie, die Archivkopie bleibt unverändert, und ein weiterer Abruf hängt nichts doppelt an.
    - Hat der Beleg in sevDesk inzwischen eine eigene Datei, etwa nach dem ersten Abruf hochgeladen, bekommt er die Datei der Vorlage nicht. Hat er sie schon, kommt die eigene Datei dazu (Punkt 9); die Datei der Vorlage bleibt.
    - Die Belegansicht nennt die Datei „aus der Vorlage“.
9. **Fehlende und neue Dateien:** Zu früher übernommenen Belegen holt jeder Abruf die Dateien noch einmal, deren Abruf fehlgeschlagen war, und hängt sie an denselben Beleg. Nennt sevDesk an einem Beleg eine Datei, die Haben noch nicht hat, weil sie erst nach dem ersten Abruf hochgeladen wurde, hängt der Abruf sie zusätzlich an, auch an einen als „ohne Datei“ bestätigten Beleg. Die Belegansicht zeigt sie als nachgeladen, siehe [Dateistand](#dateistand).
10. **Wiederkehrende Rechnungen:** die Vorlagen mit ihren Positionen, als pausierte [wiederkehrende Rechnungen](rechnungen.md#wiederkehrende-rechnungen), siehe [unten](#wiederkehrende-rechnungen).

Haben ruft die PDFs mit `preventSendBy=true` ab; der Abruf markiert also keine Rechnung als versendet. Die Antwort der API wird je Beleg samt Positionen gespeichert, zum Nachweis.

### Dateistand

Fehlt einem Beleg eine Datei, hält Haben fest, warum. Fortschritt, Belegliste, Belegansicht, Abgleich und Jahresexport zeigen den Stand ([#345](https://github.com/firsttris/haben/issues/345)):

| Stand | Wann | Im Abgleich |
| --- | --- | --- |
| Abruf fehlgeschlagen | sevDesk nennt eine Datei (`document`), gibt sie aber nicht heraus, oder eine Rechnung bzw. Gutschrift kommt ohne PDF | offen; ein neuer Abruf versucht es noch einmal. Nennt sevDesk die Datei dann nicht mehr, ist nichts mehr offen, wenn der Beleg eine andere Datei hat; sonst gilt „Ohne Datei, zu prüfen“, auch nach einer früheren Bestätigung |
| Ohne Datei, zu prüfen | Ein Beleg nennt keine Datei | offen, bis du es bestätigst |
| Ohne Datei, bestätigt | Du hast in der Quelle nachgesehen und es in der Belegansicht bestätigt | zählt getrennt, blockiert nicht |
| Ohne Beleg | Die Buchung nennt keinen Einzelbeleg oder ihre Datei fehlt im Export: der Accountable-Stapel, oder WISO und die Lexoffice-Sicherung, die das Merkmal ohne GUID setzen | zählt nicht als fehlende Datei; im Accountable-Stapel ohne Beleg-GUID und ohne „Dokument Vorhanden“ bestätigst du es auf Wunsch, sonst bleibt es ein Merkmal der Buchung |
| Anhang fehlt | Das PDF ist da, das XML der E-Rechnung kam mit einem Fehler | offen; ein neuer Abruf versucht es noch einmal, meldet sevDesk dann ohne Fehler kein XML, ist nichts mehr offen |

Ein Beleg ohne Verweis auf eine Datei hat nicht sicher nie eine gehabt: In der API unterscheidet ihn kein Feld von einem Beleg, dessen Datei entfernt wurde. Deshalb bestätigst du „ohne Datei“ selbst; Haben speichert dazu deinen Namen, die Uhrzeit und deine Notiz. Eine Rechnung oder Gutschrift lässt sich nicht als „ohne Datei“ bestätigen: Jede fertige hat in sevDesk ein PDF. Die Bestätigung ändert nichts an der Steuer; für den Vorsteuerabzug braucht es weiter die Rechnung ([§ 15 Abs. 1 Nr. 1 UStG](https://www.gesetze-im-internet.de/ustg_1980/__15.html)).

Weitere Anhänge eines Belegs nennt die API nicht, nur die eine Datei unter `document`. Ob einem Beleg in sevDesk mehr Dateien gehören, sieht Haben deshalb nicht. Eine dort später hochgeladene Datei erkennt Haben am geänderten `document` in der Belegliste ([Schritt 2, Punkt 9](#schritt-2-kontakte-rechnungen-und-belege-abrufen)); Archivkopie und frühere Dateien bleiben. Ein Stand wird nie überschrieben: Jede Feststellung, Bestätigung und nachgeladene Datei ist eine neue Zeile, der Jahresexport führt sie in `lexoffice/dateistand.csv`. Offene Posten ohne Datei übernimmt Haben nicht; die Liste nennt den Grund nach dem Stand.

### Artikel

Haben legt jeden Artikel aus sevDesk einmal an und merkt sich seine ID. Ein weiterer Abruf überspringt ihn, auch wenn du ihn in Haben geändert hast. Gibt es in Haben schon einen Artikel mit derselben Nummer (ohne Nummer: derselben Bezeichnung) und ohne sevDesk-Herkunft, verknüpft Haben ihn und lässt ihn, wie er ist.

- **Preis:** der Nettopreis; ist nur ein Bruttopreis gesetzt, ein Artikel mit Endpreis.
- **Einheit:** an der Bezeichnung wie beim [CSV-Import](csv-import.md#artikel), auch eigene Einheiten, sonst am Code nach UN/ECE, etwa „Tag(e)“ als „Tag“. Fehlt die Einheit in Haben, etwa „%“ oder „kg“, bleibt der Artikel draußen: unter **Einstellungen › Rechnungen › Einheiten** anlegen und erneut abrufen.
- **Steuersatz:** 19, 7 oder 0 %; einen Artikel mit anderem Satz übernimmt Haben nicht.
- **Nicht übernommen:** Einkaufspreis, Lagerbestand, Bild und Kategorie; Haben hat dafür keine Felder. Die offenen Punkte des Abrufs nennen, bei wie vielen Artikeln Einkaufspreis, Lagerbestand oder Bild gesetzt war, und jeden Artikel, der draußen blieb, mit Grund.

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
| Gutschrift | Gutschrift, negativ; Honorar, Provision und Buchungskonto auf einem Aufwandskonto als Ausgabe-Gutschrift, positiv (siehe unten) |
| Beleg „Einnahme“ (`creditDebit` D) | Einnahmebeleg, bei negativer Summe Einnahme-Gutschrift |
| Beleg „Ausgabe“ (`creditDebit` C) | Ausgabebeleg, bei negativer Summe Ausgabe-Gutschrift |

Die Richtung `creditDebit` beschreibt die OpenAPI nur als „credit (C) or debit (D)“; dass C die Ausgabe ist, ist mit echten Antworten der Buchhaltungsversionen 1.0 und 2.0 belegt ([#472](https://github.com/firsttris/haben/issues/472)). Frühere Abrufe hatten beide vertauscht. Die Archivkopie bleibt unverändert, Haben liest Richtung und Belegart von sevDesk-Belegen aus der gespeicherten API-Antwort; ein neuer Abruf ist nicht nötig. Wurde vor der Korrektur eine Einnahme als offener Ausgabebeleg übernommen, bleibt sie versiegelt und erscheint weiter als übernommen; prüfe sie und korrigiere sie in Haben.

**Gutschriften** folgen der Buchung von sevDesk, zur Laufzeit aus der gespeicherten Antwort ([#472](https://github.com/firsttris/haben/issues/472)). Honorar und Provision (`bookingCategory` `ROYALTY_ASSIGNED`, `ROYALTY_UNASSIGNED`, `PROVISION`) bucht sevDesk auf ein Aufwandskonto mit Vorsteuer; sie erscheinen als „Ausgabe-Gutschrift“ auf der Ausgabenseite und in Kz 66. Minderleistung (`UNDERACHIEVEMENT`) mindert die Einnahmen. Belegt ist das am DATEV-Export von sevDesk mit je einer Gutschrift in Buchhaltungsversion 1.0 und 2.0 für `PROVISION`, `ROYALTY_ASSIGNED` und `ROYALTY_UNASSIGNED`; Minderleistung bucht 2.0 auf Erlösschmälerungen (8720 in SKR03), 1.0 auf das Erlöskonto. In 2.0 nennt der Kopf der Gutschrift 0 % und die Steuerregel 9, der Steuersatz steht nur an den Positionen; Haben nimmt ihn wie in 1.0 aus den Positionen. Steuerlich ist das nicht geprüft. Offene Gutschriften aus Honorar und Provision werden nicht als offene Posten übernommen.

**Gutschriften auf ein Buchungskonto** (`ACCOUNTING_TYPE`, nur Buchhaltungsversion 1.0) bucht sevDesk nach dem gewählten Konto: auf einem Erlöskonto als Minderung der Einnahmen (DATEV: Soll 8200, BU 3, belegt am DATEV-Export von sevDesk), auf einem Aufwandskonto als Ausgabe mit Vorsteuer wie Honorar (DATEV: Soll auf dem gewählten Aufwandskonto, etwa 4930 in SKR03, gegen das Personenkonto, BU 9, belegt am DATEV-Export von sevDesk, [#472](https://github.com/firsttris/haben/issues/472)). Die Gutschrift nennt nur die ID des Kontos. Seine Nummern holt Haben deshalb nach den Belegen über `GET /AccountingType/{id}`, auch für früher abgerufene Gutschriften; der Endpunkt steht in der OpenAPI nur im Abschnitt „Accounting type“, nicht unter den Pfaden. Die Antwort wird unverändert gespeichert. Die Nummer für SKR03 zählt nach SKR03, die für SKR04 nach SKR04, gleich welcher Kontenrahmen in Haben eingerichtet ist; nennen beide dieselbe Art oder fehlt eine, gilt diese Art. Mit Aufwandskonto erscheint die Gutschrift als „Ausgabe-Gutschrift“ in Kz 66 und wird kein offener Posten.

In allen anderen Fällen bleibt die Gutschrift, wie gespeichert, eine Minderung der Einnahmen und gilt als **unklar**: ohne Antwort von sevDesk, ohne Kontonummer, bei einem Widerspruch zwischen beiden Nummern, bei einer Nummer außerhalb von Erlös- und Aufwandskonten und bei mehreren Ständen eines Kontos mit verschiedener Art. Die Belegansicht nennt dann „Buchungskonto nicht erkannt“, die Liste markiert die Zeile, und der Abgleich zeigt den Punkt „Buchungskonto jeder Gutschrift erkannt“ als offen und sperrt den Monatsabgleich der Umsatzsteuer für das Jahr der Gutschrift, bei Ist-Versteuerung auch für das Jahr ihrer Zahlung. Bestand aus einem Abruf vor dieser Erweiterung bleibt unklar, bis du **Erneut abrufen** startest; rufe deshalb vor dem Kündigen von sevDesk noch einmal ab.

Ist sevDesk schon gekündigt oder klärt auch ein neuer Abruf das Konto nicht, legst du die Kontoart in der Belegansicht der Gutschrift **von Hand** fest: **Als Erlöskonto festlegen** oder **Als Aufwandskonto festlegen**, nachdem du in sevDesk oder im DATEV-Export nachgesehen hast, auf welches Konto gebucht ist ([#888](https://github.com/firsttris/haben/issues/888)). Danach rechnet Haben wie mit einem erkannten Konto, der Punkt im Abgleich und die Sperre fallen weg, und die Belegansicht nennt das Buchungskonto „von Hand festgelegt“. Die Archivkopie bleibt unverändert; die Entscheidung ist ein eigener Nachtrag im Änderungsprotokoll, und eine spätere ersetzt sie. Ein Kontostamm mit erkannter Art, den ein späterer Abruf bringt, geht vor: Nennt er dieselbe Art, gilt sie; nennt er eine andere, bleibt die Gutschrift unklar, bis du seine Art festlegst, und die Belegansicht nennt beide.

**Kategorien** folgen dem Buchungskonto je Position ([#472](https://github.com/firsttris/haben/issues/472)). Die Position nennt nur die ID des Kontos; seine Nummern holt Haben wie bei den Gutschriften über `GET /AccountingType/{id}`, je Konto einmal, in Buchhaltungsversion 2.0 nicht. Die Nummern zählen wie oben nach SKR03 bzw. SKR04; beide müssen dasselbe ergeben.

| Nummer des Kontos | Kategorie in Haben |
| --- | --- |
| Konto einer Ausgabenkategorie außer Anlagegut und Einfuhrumsatzsteuer, etwa SKR03 4930 / SKR04 6815 | diese Kategorie, hier Bürobedarf |
| Verbindlichkeiten gegenüber Gesellschaftern, Gezeichnetes Kapital, Darlehen, Körperschaft-, Gewerbesteuer und Soli, Privatentnahmen, -einlagen und -steuern | Name des DATEV-Kontos; bei GmbH und UG [eingeordnet](lexoffice.md#einordnung-bei-gmbh-und-ug) wie in Lexoffice |
| Erlöskonto | Erlöse |
| anderes Konto, keine Nummer, Widerspruch, keine Antwort | „Sonstiges“, in der Belegansicht mit dem Konto |

Ein übernommener offener Ausgabebeleg bekommt die Kategorie der Position mit dem größten Nettobetrag, wenn sie eine Ausgabenkategorie ist, sonst „Sonstiges“. Die Archivkopie bleibt unverändert; Bestand aus einem früheren Abruf bekommt seine Kategorien mit **Erneut abrufen**.

sevDesk lässt bei vielen Belegen den Namen des Lieferanten leer (`supplierName`). Haben zeigt dann den Namen, den der Beleg beim Speichern trug (`supplierNameAtSave`), und erst ohne ihn den Namen des verknüpften Kontakts. So bleibt ein alter Beleg richtig, wenn der Kontakt später umbenannt wird. Die Archivkopie bleibt unverändert.

Maßgeblich sind Brutto und Steuer aus dem Kopf des Belegs; Netto ergibt sich daraus. Die Aufteilung nach Steuersatz kommt aus den Positionen, Rundungsdifferenzen zum Kopf landen beim größten Satz, die der Steuer beim größten Satz mit Steuer. Fehlen die Positionen, leitet Haben den Satz aus Netto und Steuer im Kopf ab (19 oder 7 %, die Sätze 16 und 5 % aus 2020 nur, wenn beide nicht passen); auch das gilt für schon abgerufene Belege. Die Kennung eines Belegs ist Art und ID in sevDesk, etwa `invoice/123` oder `voucher/678`.

### Vorlagen für wiederkehrende Belege

Eine Vorlage für wiederkehrende Belege (`voucherType` RV) wird ein [Dauerbeleg](belege.md#dauerbelege), **angehalten**: Haben legt daraus keine Belege an, bis du ihn geprüft und fortgesetzt hast. Die Seite des Dauerbelegs zeigt unter „Aus sevDesk übernommen“, was du prüfen musst. Ein neuer Abruf legt eine übernommene Vorlage nicht noch einmal an und ändert sie nicht.

| sevDesk | Dauerbeleg |
| --- | --- |
| Status 100, nächster Termin (`recurringNextVoucher`) | angehalten, nächster Beleg an diesem Termin |
| Status 50, ohne nächsten Termin | angehalten, nächster Beleg am Start (`recurringStartDate`) |
| Status 1000, mit Ende (`recurringEndDate`) | beendet, wenn das Ende vorbei ist, sonst angehalten mit diesem Ende |
| Intervall `recurringInterval` (`P0Y1M`, `P0Y3M`, `P0Y6M`, `P1Y`) | monatlich, vierteljährlich, halbjährlich, jährlich |
| Lieferant, Belegnummer, Beträge je Steuersatz, Datei | Lieferant (mit Kontakt, wenn er Lieferant ist), Vertrags- oder Kundennummer, Beträge, Vertrag |

Die [OpenAPI](https://api.sevdesk.de/openapi.yaml) beschreibt die Status nur für Belege (50 Entwurf, 100 offen, 1000 bezahlt), nicht für Vorlagen; die Zuordnung oben ist aus echten Antworten der Buchhaltungsversion 1.0 abgeleitet, 2.0 liefert dieselben Status 50 und 100. In 2.0 liefert `GET /Voucher` die Vorlagen auch ohne Filter; Haben zählt sie nicht als Belege ([#472](https://github.com/firsttris/haben/issues/472)). Kategorie und Bezahlung kennt die Vorlage nicht: Haben setzt „Sonstiger Aufwand“ und das Geschäftskonto, ändere beides vor dem Fortsetzen. Hat die Vorlage keine Datei, lädst du vor dem Fortsetzen den Vertrag oder die Dauerrechnung hoch ([Ändern, pausieren, beenden](belege.md#ändern-pausieren-beenden)).

Nicht übernommen werden Vorlagen für Einnahmen, in anderer Währung als Euro, mit negativer Summe, mit einem anderen Intervall (etwa wöchentlich) oder einem Steuersatz außer 19, 7 und 0 %. Der Abruf nennt sie mit Grund in der Liste der fehlgeschlagenen Belege; lege sie bei Bedarf selbst an.

### Steuerarten im Abgleich

Für die Umsatzsteuer je Monat übersetzt Haben die Steuerregel von sevDesk in die Kennzahlen. Die Regeln nennt die [OpenAPI](https://api.sevdesk.de/openapi.yaml) unter „VAT rules“, mit Kennzahl nur bei Regel 5 (Kz 60) und 21 (Kz 21); die übrigen ordnet Haben nach der Anleitung zur Voranmeldung zu (siehe „Kennzahlen selbst prüfen“). Die ältere taxType steht dort als Vorgänger.

**Einnahmen:**

| sevDesk | Abgleich |
| --- | --- |
| Regel 1 „Umsatzsteuerpflichtige Umsätze“ bzw. taxType `default` | Kz 81, Kz 86 |
| Regel 2 „Ausfuhren“ | Kz 43 |
| Regel 3 „Innergemeinschaftliche Lieferungen“ bzw. taxType `eu` | Kz 41 |
| Regel 4 „Steuerfreie Umsätze § 4 UStG“, Regel 11 „§ 19 UStG“ bzw. taxType `ss` | Steuerfrei |
| Regel 5 „Reverse Charge gem. § 13b UStG“ | Kz 60 |
| Regel 17 „Nicht im Inland steuerbare Leistung“ bzw. taxType `noteu` | Kz 45 |
| Regel 18 bis 20 „One Stop Shop“ | OSS, nicht in der Voranmeldung |
| Regel 21 „Reverse Charge gem. § 18b UStG“ | Kz 21 |
| eigene Steuerart (taxType `custom`) | Kennzahlen der Steuerart |
| alles andere | Andere Sätze |

Regel 17 bucht sevDesk im DATEV-Export auf 8338 (SKR03), das Konto für nicht steuerbare Leistungen im Drittland ([#472](https://github.com/firsttris/haben/issues/472)). Ob eine Rechnung mit `noteu` eine Leistung oder eine Lieferung ins Drittland war, sagt sevDesk nicht; die OpenAPI ordnet `noteu` der Regel 17 zu. War es eine Ausfuhrlieferung, gehört sie in Kz 43: vergleiche solche Rechnungen mit der übermittelten Voranmeldung.

**Ausgaben:** Vorsteuer Kz 66 wie im Beleg. Bei Reverse Charge rechnet Haben wie sevDesk 19 % auf das Netto:

| sevDesk | Abgleich |
| --- | --- |
| Regel 12 „Reverse Charge gem. § 13b Abs. 2 UStG mit Vorsteuerabzug“ | Kz 84, 85 und 67 |
| Regel 14 „Reverse Charge gem. § 13b Abs. 1 EU Umsätze“ | Kz 46, 47 und 67 |
| Regel 8 „Innergemeinschaftliche Erwerbe“, Regel 13 „Reverse Charge gem. § 13b UStG ohne Vorsteuerabzug“ | noch keine eigenen Kennzahlen |

Regel 12 trennt Umsätze nach § 13b Abs. 2 Nr. 3 UStG (Kz 73/74) nicht ab; Haben zählt sie in Kz 84/85.

**Eigene Steuerarten:** Ein Beleg mit taxType `custom` verweist per `taxSet` auf eine Steuerart, die in sevDesk die Kennzahlen der Voranmeldung nennt: `vatReportFieldNet` für die Bemessungsgrundlage, `vatReportFieldTax` für die Steuer, mehrere durch Komma. Die [OpenAPI](https://api.sevdesk.de/openapi.yaml) nennt nur taxType `custom` („Using custom tax set“), den Endpunkt `GET /TaxSet` beschreibt sie nicht; das Verhalten ist mit echten Antworten der Buchhaltungsversion 1.0 und 2.0 belegt ([#472](https://github.com/firsttris/haben/issues/472)). Haben ruft die Steuerarten bei jedem Abruf ab (`GET /TaxSet`), speichert sie unverändert und nimmt im Abgleich die des jüngsten Abrufs, auch für früher abgerufene Belege.

- **Ausgaben:** Das Netto zählt in die genannte Kennzahl der Bemessungsgrundlage (Kz 46, 84, 89 oder 93). Die Steuer rechnet Haben wie sevDesk je Beleg aus Netto und Satz der Steuerart und zählt sie in jede genannte Steuerkennzahl (Kz 47, 85, 67, 61 oder 66), bei Reverse Charge also als Steuer (Kz 47) und Vorsteuer (Kz 67); als Vorsteuer Kz 66 zählt die Steuer im Beleg dann nicht.
- **Einnahmen:** Die Kennzahl der Bemessungsgrundlage ordnet den Umsatz zu wie die Regeln oben, etwa Kz 41 oder 60.

Bei einer Steuerart ohne Kennzahlen, etwa für Bezüge von Kleinunternehmern (§ 19 UStG), zählen Einnahmen unter „Steuerfrei“, und bei Ausgaben zählt die Steuer im Beleg als Vorsteuer Kz 66. Fehlt die Steuerart, weil ihr Abruf scheiterte, oder nennt sie eine Kennzahl, die Haben nicht kennt (bei Einnahmen jede Steuerkennzahl), stehen Einnahmen unter „Andere Sätze“ und Ausgaben netto unter „Andere Bezüge“, ihre Steuer im Beleg als Kz 66; ein neuer Abruf holt die Steuerarten nach. Rechnungen und Gutschriften trugen im geprüften Konto keine eigene Steuerart; trügen sie eine, gilt dasselbe.

**Kennzahlen selbst prüfen:** Haben übernimmt die Kennzahlen so, wie die Steuerart in sevDesk sie nennt, und prüft nicht, ob sie stimmen. Stimmt der Abgleich mit der übermittelten Voranmeldung, heißt das nur, dass beide dieselbe Steuerart verwendet haben. Vergleiche deshalb die Kennzahlen jeder eigenen Steuerart mit der Anleitung zur Umsatzsteuer-Voranmeldung 2026 (Vordruck USt 1 E, Zeilen 30 bis 32, im [BMF-Schreiben vom 29. Dezember 2025](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/2025-12-29-vordruckmuster-USt-voranmeldung-2026.html)), vor allem bei [§ 13b UStG](https://www.gesetze-im-internet.de/ustg_1980/__13b.html):

- Kz 46/47: nur sonstige Leistungen nach § 3a Abs. 2 UStG von Unternehmern aus dem übrigen EU-Gebiet (§ 13b Abs. 1).
- Kz 84/85: Werklieferungen und die übrigen sonstigen Leistungen im Ausland ansässiger Unternehmer, also auch aus dem Drittland (§ 13b Abs. 2 Nr. 1), und die Fälle aus § 13b Abs. 2 Nr. 2 und 4 bis 12, etwa Bauleistungen und Gebäudereinigung.
- Kz 73/74: Umsätze, die unter das Grunderwerbsteuergesetz fallen (§ 13b Abs. 2 Nr. 3); eine eigene Steuerart mit dieser Kennzahl steht unter „Andere Bezüge“.

Meldet eine Steuerart etwa Leistungen aus dem Drittland in Kz 46/47, hat sevDesk die Voranmeldungen mit dieser Steuerart ebenso gefüllt, und der Abgleich zeigt dieselben Werte. Ob und wie die Voranmeldungen zu berichtigen sind, klärst du mit deiner Steuerberatung oder dem Finanzamt.

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

**Automatische PDFs nur für Buchhaltungsversion 1.0 und 2.0:** Haben ermittelt vor jedem fehlenden Auftrags-PDF die Version frisch über `/Tools/bookkeepingSystemVersion`. Freigegeben sind genau `1.0` und `2.0`. Bei unbekannter Version oder fehlgeschlagener Versionsprüfung werden die Metadaten weiter archiviert; die PDFs bleiben als fehlend markiert und können manuell ergänzt werden. Die Adresse `/api/v1` unterscheidet diese Buchhaltungsversionen nicht. Eine früher gespeicherte Version oder zusätzliche Aufrufdaten heben die Sperre nicht auf.

Die [sevDesk-API](https://api.sevdesk.de/#tag/Order) beschreibt `getPdf` mit „commit the order“. Deshalb wurde `preventSendBy=true` gezielt an sieben V1-Dokumenten geprüft: AN, AB und LI, einschließlich Entwürfen, abgelehntem Angebot und teilberechneter AB. Status, Version, Versanddatum/-art und Änderungszeit blieben unverändert. Laut Nutzerrückmeldung blieben auch alle getesteten Entwürfe weiter bearbeitbar; sichtbare Änderungs-/Verlaufseinträge entstanden nicht. In Buchhaltungsversion 2.0 ist der Abruf an einem Angebot im Entwurf geprüft: Status, Version, Versanddatum und Änderungszeit blieben gleich, das Angebot blieb bearbeitbar, im Verlauf entstand nichts ([#472](https://github.com/firsttris/haben/issues/472)). Diese Ergebnisse gelten für die geprüften Fälle.

**Nachweise und Fehler:** Vor einem PDF-Abruf vergleicht Haben den aktuellen Quellstand mit der Archivkopie. Bei Abweichungen wird das PDF nicht dem alten Stand zugeordnet; die übrigen Dokumente erhalten ihre PDFs weiterhin automatisch. Nach jedem begonnenen PDF-Abruf folgt eine Nachkontrolle, auch nach einer fehlgeschlagenen Antwort. Vorher-/Nachher-Antworten und Fehler bleiben unveränderlich im PDF-Abrufprotokoll erhalten. Eine PDF-Anfrage wird nicht automatisch wiederholt und folgt keiner Weiterleitung. Bei unerwarteten Änderungen, PDF-Fehlern oder fehlender Nachkontrolle setzt Haben weitere automatische Auftrags-PDFs im laufenden Import aus; die Metadaten werden weiter archiviert. Ein auffälliges PDF wird nicht als erfolgreiche Originaldatei zugeordnet. Der offene Punkt steht im Import und im Abrufprotokoll.

Ein neuer Abruf lädt fehlende PDFs nach, soweit die Versions- und Quellstandsprüfung das erlauben. Vorhandene Dateien, auch manuelle Nachträge, und archivierte Metadaten werden nicht ersetzt.

**Manuell ergänzen:** Auf der Detailseite kannst du ein Original-PDF bis 20 MB anhängen. Es erscheint als „manuell nachgereicht“ mit Zeitpunkt und Prüfsumme; frühere Dateien und Quelldaten werden nicht ersetzt. Fehlende PDFs bleiben sichtbar und verhindern den Vollständigkeitshinweis zum Umzug. Ein Anhang erzeugt weder eine Buchung noch einen aktiven offenen Posten. Diese Ergänzung betrifft nur Auftragsdokumente; das allgemeine Nachreichen von Unterlagen zu Belegen und Darlehen bleibt eine eigene Erweiterung.

Der Jahresexport enthält `sevdesk/auftraege.csv` sowie PDFs, Quelldaten und PDF-Abrufprotokolle unter `sevdesk/auftraege/`. Die Auftragsdaten verändern keine Umsatz-, Steuer- oder OP-Summen. Für KI-Assistenten stehen eigene lesende Archivwerkzeuge bereit.

### Mahnungen

sevDesk führt jede Mahnstufe als eigene Rechnung der Art `MA`, die mit `origin` auf die gemahnte Rechnung zeigt; `GET /Invoice` liefert sie nur mit dem Filter `invoiceType=MA`. Ihre Summen sind 0, der gemahnte Betrag steht in `reminderTotal`, Positionen hat sie keine. Haben archiviert jede gespeicherte Stufe (ohne Entwürfe) mit Datum, Frist, gemahntem Betrag, Antwort der API und PDF, getrennt von den Belegen. Fehlt das PDF beim Abruf, holt es der nächste Abruf nach. Die Belegansicht der gemahnten Rechnung zeigt ihre Stufen unter **Mahnungen**. Der Jahresexport enthält sie im Jahr ihres Datums als `sevdesk/mahnungen.csv` und unter `sevdesk/mahnungen/` mit PDF und Quelldaten.

Mahnungen sind keine Forderung: Sie zählen nicht in Umsatz, Umsatzsteuer, EÜR, offene Posten und Abgleich.

Übernimmst du eine offene Rechnung aktiv, zählt ihre höchste Stufe aus sevDesk im [Mahnwesen](rechnungen-zahlung.md#mahnwesen). Laut OpenAPI zählt `dunningLevel` die versendeten Mahnungen und beginnt mit 1 als Zahlungserinnerung. Stufe 1 gilt deshalb als Zahlungserinnerung, Stufe 2 als 1. Mahnung; danach schlägt Haben die letzte Mahnung vor. Ob eine höhere Stufe in sevDesk schon die letzte Mahnung war, ist nicht belegt; sie zählt wie Stufe 2. Eine Mahnung in Haben entsteht dabei nicht.

Mahngebühren und Zinsen übernimmt Haben nicht, sie stehen nur in der gespeicherten Antwort: In den Testdaten aus beiden Buchhaltungsversionen ist die Gebühr (`reminderCharge`) 0, wie sevDesk Gebühren und Zinsen füllt, ist nicht belegt. Gebühren, die der Kunde zahlt, ordnest du im Bankabgleich zu ([Gebühren und Zinsen buchen](rechnungen-zahlung.md#mahnwesen)).

### Übermittelte Voranmeldungen

Haben archiviert jede Voranmeldung, die sevDesk an ELSTER übermittelt hat (`GET /VatReport`), mit Zeitraum, Zeitpunkt der Übermittlung, Ist- oder Soll-Versteuerung, Transferticket, Kennzahlen und dem Übermittlungsprotokoll als PDF. Die Antwort der API bleibt unverändert gespeichert, auch die Kennzahlen (`reportingValues`). Berichtigte Anmeldungen kommen mit, Testübermittlungen (`testCase` 1) nicht. Fehlt das Protokoll beim Abruf, holt es der nächste Abruf nach.

Unter **Archiv › Voranmeldungen** stehen sie je Steuerjahr mit Kz 83; **Kennzahlen** klappt alle Werte und das Transferticket auf. Der Zeitraum verlinkt auf dieselbe Voranmeldung in Haben, zum Vergleich. Der Jahresexport enthält sie im Jahr ihres Zeitraums als `sevdesk/voranmeldungen.csv` und unter `sevdesk/voranmeldungen/` mit Protokoll und Quelldaten.

Die Voranmeldungen aus sevDesk sind nur ein Nachweis: Haben rechnet sie nicht neu, sendet sie nicht und zählt sie nicht als [Voranmeldung in Haben](umsatzsteuer.md). Für denselben Zeitraum kannst du in Haben weiter eine eigene anlegen, senden oder vermerken; das Archiv ersetzt und sperrt sie nicht. Im Abgleich je Jahr zählen ihre Protokolle bei „ELSTER-Protokolle archiviert“ mit; unter [Schritt 5](#schritt-3-5-und-6) musst du sie nicht ablegen.

### Wiederkehrende Rechnungen

sevDesk liefert die Vorlagen nur mit dem Filter `invoiceType=WKR`; belegt ist das in Buchhaltungsversion 1.0 und 2.0. Haben legt jede als wiederkehrende Rechnung an, **pausiert** und mit „Entwurf anlegen“, ohne E-Mail-Versand und mit Zahlungsart Überweisung. Sie erzeugt nichts, bis du sie geprüft und **Aktiv** gesetzt hast. Das gilt für jeden Status in sevDesk: deaktiviert (50), aktiv (100) und beendet (1000). Ein Enddatum übernimmt Haben, auch wenn es vor dem nächsten Termin liegt; die Vorlage erzeugt dann auch aktiviert nichts mehr.

| sevDesk | Haben |
| --- | --- |
| `header` | Bezeichnung |
| `headText`, `footText` | Einleitung, Hinweis; Absätze aus HTML werden zu Zeilen |
| Positionen: Bezeichnung, Text, Menge, Preis, Steuersatz | Positionen; Einheit immer „Stk.“, sevDesk nennt sie nur als Kennung |
| `showNet` | Preise netto oder brutto |
| `timeToPay` | Zahlungsziel |
| `accountIntervall` | Intervall: nur 1, 3, 6 oder 12 Monate |
| `accountNextInvoice`, sonst `accountStartDate` | Nächste Rechnung am |
| `accountEndDate` | Endet nach dem |
| `taxType` `default`, `eu`, `noteu`, Kleinunternehmer | Umsatzsteuer regulär, innergemeinschaftliche Lieferung, Drittland, Kleinunternehmer; alles außer regulär mit Hinweis zum Prüfen |

**Nicht übernommen** und als offener Punkt im Abruf genannt werden Vorlagen mit Wochen- oder Tagesintervall (etwa `P0Y0M1W`), in Fremdwährung, mit einem Steuersatz außer 19, 7 oder 0 %, mit Rabatt an einer Position, ohne Positionen, mit einer anderen Steuerart oder ohne übernommenen Kunden. Lege sie in Haben von Hand an. Skonto der Vorlage übernimmt Haben nicht und nennt es.

**Platzhalter** wie `[%KONTAKTPERSON%]`, `[%ZAHLUNGSZIEL%]` oder `[%Rechnungsnummer%]` stehen als Text in der Vorlage; Haben ersetzt sie nicht. Der Abruf und die Seite der Vorlage listen, welche vorkommen. Ersetze sie vor dem Aktivieren, etwa durch die [Platzhalter von Haben](rechnungen.md#wiederkehrende-rechnungen) oder festen Text.

**Nachfällig oder vorschüssig** steht in sevDesk in keinem Feld der Vorlage. Haben liest es an den Rechnungen ab, die sevDesk aus ihr erzeugt hat (`origin` zeigt auf die Vorlage): Rechnungsdatum gleich Ende des Leistungszeitraums heißt nachfällig, gleich Anfang vorschüssig. Belegt ist das für das Monatsintervall in Version 1.0, an 39 Rechnungen einer nachfälligen Vorlage und einer Rechnung einer vorschüssigen, und in Version 2.0 an vorschüssigen Vorlagen mit Monats- und Quartalsintervall. Weicht das Rechnungsdatum einer erzeugten Rechnung vom Beginn und vom Ende des Zeitraums ab, etwa weil sie später fertiggestellt wurde, bleibt die Vorlage unklar, und du setzt den Leistungszeitraum selbst.

| Ergebnis | Leistungszeitraum in Haben |
| --- | --- |
| vorschüssig | Laufend |
| nachfällig, monatlich | Laufend; liegt der nächste Termin am Monatsende, bleiben alle Termine am Monatsende |
| nachfällig, mehrere Monate | Keiner, mit Hinweis: Haben hat keinen Zeitraum, der im Rechnungsmonat endet |
| unklar (keine erzeugte Rechnung oder widersprüchlich) | Keiner, mit Hinweis |

Ist es unklar, sieh in sevDesk an der Vorlage nach und setze den Leistungszeitraum selbst. Die Seite der Vorlage zeigt unter „Aus sevDesk übernommen“ den Status in sevDesk, das Ergebnis, die Platzhalter und die Hinweise. Prüfe vor dem Aktivieren „Nächste Rechnung am“: Liegt der Termin in der Vergangenheit, holt Haben die verpassten Termine nach.

Ein neuer Abruf überspringt übernommene Vorlagen, auch wenn du sie in Haben gelöscht hast. Die Antwort der API bleibt je Vorlage gespeichert.

### Grenzen des aktuellen Imports

- **Keine Buchungen und keine Bankumsätze.** Lade den DATEV-Export aus sevDesk hoch (Schritt 5).
- **Kategorien nur aus Buchungskonten mit Nummer.** Eigene Konten ohne Nummer und Konten aus Buchhaltungsversion 2.0 (`accountDatev`) bleiben „Sonstiges“; ändere übernommene Belege bei Bedarf in Haben. Bei GmbH und UG zählen solche Positionen im Abgleich als Einnahme bzw. Ausgabe; ziehe Gesellschafter, Kapital, Darlehen und Steuern vom Einkommen darunter beim Vergleich mit sevDesk selbst ab.
- Entwürfe von Rechnungen, Gutschriften und Belegen bleiben ausgeschlossen.

## Schritt 4: Anlagen übernehmen

Mit verbundenem Token liest Haben das Anlagenverzeichnis aus sevDesk und schlägt jede Anlage zur [Übernahme mit Restbuchwert](anlagen.md#übernahme-aus-lexoffice) vor. Übernommen wird nur, was du anhakst. Gebucht wird nichts, bis du die AfA des Jahres buchst.

1. **Übernahmestichtag** wählen: ein 1. Januar, in der Regel der erste Tag in Haben. Vorgeschlagen ist der 1. Januar des Jahres, in dem die offenen Posten gebucht werden.
2. **Anlagen abrufen.** Die Liste zeigt je Anlage Anschaffung, Kosten, Restbuchwert zum Stichtag und die Art in Haben.
3. Restbuchwerte mit dem Anlagenverzeichnis in sevDesk vergleichen, fehlende Arten wählen, **Anlagen übernehmen**.

sevDesk liefert keine bisherige AfA und keine AfA-Methode, nur Anschaffungsdatum, Nettokaufpreis, Nutzungsdauer in Jahren und Verkaufsdatum. sevDesk schreibt linear ab oder, bei Nutzungsdauer 0, sofort als GWG ([sevDesk: Abschreibungen](https://sevdesk.de/funktion-abschreibungen/)); Sammelposten und degressive AfA gibt es dort nicht. Haben rechnet den Restbuchwert deshalb linear und monatsgenau nach ([§ 7 Abs. 1 EStG](https://www.gesetze-im-internet.de/estg/__7.html)), mit demselben Plan, mit dem es danach weiter abschreibt.

| In sevDesk | Vorschlag in Haben |
| --- | --- |
| Nutzungsdauer über 0, Restbuchwert über 0 | Übernehmen, linear über die restliche Nutzungsdauer |
| Nutzungsdauer 0 (GWG), am Stichtag voll abgeschrieben, vor dem Stichtag verkauft | Nicht nötig |
| Am oder nach dem Stichtag angeschafft | Von Hand: als Beleg mit der Kategorie Anlagegut |
| Gebäude, unbekannter Status, Nutzungsdauer 0 über 800 €, Kaufpreis und gebuchter Betrag verschieden | Von Hand mit **Anlage übernehmen** |

Die Art folgt aus dem Buchungskonto in sevDesk: Pkw und Fahrzeug werden **Fahrzeug**, eigene Kategorien nach ihrem Namen („Sonstige Transportmittel“, „Sonstige Betriebs- und Geschäftsausstattung“). Sonst, etwa bei „Kleingeräte“ oder in Buchhaltungsversion 2.0, wählst du die Art; das Anlagekonto in SKR03 oder SKR04 ergibt sich daraus ([Art und Abschreibung](anlagen.md#art-und-abschreibung)). Führte sevDesk die Anlage auf einem anderen Anlagekonto, steht das als Hinweis da. Bei Nutzungsdauer 1 Jahr schreibt Haben wie sevDesk linear über 12 Monate ab; hat sevDesk einen Computer voll im Anschaffungsjahr abgeschrieben, übernimm ihn von Hand. Ist eine Anlage nach dem Stichtag verkauft, trägst du den Abgang danach auf ihrer Seite ein.

Jede übernommene Anlage trägt in der Notiz Nummer und Kennung aus sevDesk. Ein neuer Abruf zeigt sie als übernommen, auch mit geänderter Bezeichnung. Ist für das Jahr des Stichtags schon AfA gebucht oder das Jahr abgeschlossen, sperrt Haben die Übernahme wie beim [CSV-Import](csv-import.md#was-der-import-ablehnt).

## Schritt 3, 5 und 6

Offene Posten, Exporte ablegen und Abgleich je Jahr funktionieren wie beim [Umzug aus Lexoffice](lexoffice.md#schritt-3-offene-posten-übernehmen). Unterschiede:

- sevDesk entfernt aus Belegnummern Zeichen, die im DATEV-Feld nicht erlaubt sind (etwa Punkt und Umlaute), und schreibt von längeren Nummern nur die letzten 36 ins Belegfeld 1 des DATEV-Exports. Der Abgleich „Jede Buchung mit Belegnummer findet ihren Beleg“ erkennt das.
- In Zahlungsbuchungen steht im Belegfeld 1 oft eine interne Kennung von sevDesk (UUID). Sie ist keine Belegnummer und zählt im Abgleich unter „ohne Belegnummer“.

- Eine offene Rechnung ohne Nummer bekommt in Haben die Nummer `SD-` plus die ID aus sevDesk.
- Den Export für die Betriebsprüfung (GoBD) aus sevDesk legst du als „IDEA-Export“ ab; danach richtet sich die Prüfung „IDEA-Export archiviert“.
- Im Jahresexport stehen die Belege aus sevDesk ebenfalls unter `lexoffice/`; die Spalte „Quelle“ in `belege.csv` sagt, woher ein Beleg stammt.

## Andere API-Adresse

Haben spricht standardmäßig mit `https://my.sevdesk.de/api/v1`. Mit der Umgebungsvariable `SEVDESK_API_URL` setzt du eine andere Basis-URL, etwa zum Testen gegen einen nachgestellten Server.

## Vor der Kündigung

- [ ] Abruf ist fertig, die Liste der fehlgeschlagenen Belege ist leer, kein Buchungskonto ist unklar (sonst noch einmal abrufen oder die Kontoart von Hand festlegen)
- [ ] Jeder Beleg hat eine Datei oder ist in sevDesk geprüft als ohne Datei bestätigt (Abgleich je Jahr)
- [ ] Alle Auftragsdokumente sind vorhanden und deren Original-PDFs ergänzt
- [ ] Übernommene wiederkehrende Rechnungen geprüft und aktiviert, in sevDesk deaktiviert
- [ ] Übernommene Dauerbelege geprüft und fortgesetzt, in sevDesk deaktiviert
- [ ] Für jedes Geschäftsjahr: DATEV-Export, GoBD-Export, ELSTER-Protokolle (außer denen der [übermittelten Voranmeldungen](#übermittelte-voranmeldungen)) und Kontoauszüge abgelegt, jeweils mit Jahr
- [ ] Einnahmen, Ausgaben, Umsatz- und Vorsteuer je Jahr mit sevDesk verglichen
- [ ] Offene Posten übernommen oder die Gründe geklärt
- [ ] Nächste Rechnungsnummer in Haben gesetzt
- [ ] Jahresexport für jedes übernommene Jahr heruntergeladen
- [ ] API-Token in Haben entfernt (das löscht ihn nur in Haben, nicht in sevDesk)
