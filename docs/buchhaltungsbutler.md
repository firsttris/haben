---
title: "Umzug aus BuchhaltungsButler mit PDF-Belegen"
description: >-
  Buchungen, Belege und PDFs aus BuchhaltungsButler in Haben archivieren: Exporte, Testlauf,
  Zuordnung, Grenzen und Abgleich je Geschäftsjahr.
---

# Umzug aus BuchhaltungsButler

Der Umzug aus BuchhaltungsButler läuft über **Archiv → Umzug → Umzug aus BuchhaltungsButler**. Haben liest die Exportdateien direkt ein – ein API-Zugang ist nicht nötig. Der Altbestand wird wie bei Lexoffice und sevDesk unveränderlich archiviert und nicht als neue, zu prüfende Belege in die laufende Buchhaltung gestellt.

## Exporte

Je Geschäftsjahr brauchst du:

- den **BB Standardexport** als `BB_Buchungsstapel.csv`,
- den **DATEV-Buchungsstapel** als `EXTF_Buchungsstapel.csv`,
- die **Belegdateien** als `Belege.zip`.

Diese drei Dateien kannst du getrennt auswählen. Alternativ verwendest du `datenexport.zip`, das den BB Standardexport und `Belege.zip` enthält, zusammen mit dem separaten EXTF-Buchungsstapel.

In BuchhaltungsButler findest du den Export unter **Abschluss → Buchungssätze und Belege exportieren**. Wähle den Zeitraum und aktiviere **Belege anhängen**. Der [BuchhaltungsButler-Hilfeartikel zum Export](https://wissen.buchhaltungsbutler.de/hc/de/articles/11445407988637-Buchungss%C3%A4tze-und-Belegbilder-in-unterschiedlichen-Formaten-exportieren) beschreibt die Formate.

## Testlauf und Import

1. Wähle die Exportdateien aus.
2. Starte den **Testlauf**. Er schreibt nichts in die Datenbank.
3. Prüfe Jahr, Anzahl der Buchungen, Belege und PDFs sowie etwaige Hinweise.
4. Bestätige anschließend **Diese Daten importieren**.

Der Testlauf bricht ab, wenn beispielsweise:

- Buchungsnummern fehlen oder doppelt sind,
- BB- und DATEV-Export bei Betrag, Datum, Konten oder Steuerschlüssel abweichen,
- ein PDF fehlt, kein PDF-Signaturheader hat oder nicht zugeordnet werden kann,
- die Kontenrichtung einer Buchung nicht eindeutig ist.

Erst ein fehlerfreier Testlauf lässt den Import zu.

## Was Haben übernimmt

- alle Zeilen des DATEV-Buchungsstapels,
- je Buchung mit Beleg-URL einen historischen Archivbeleg,
- Rechnungsnummer, Rechnungsdatum, Gegenpartei, Betrag und Steuersatz,
- die zugehörigen Original-PDFs, auch mehrere Dateien einer Buchung,
- die unveränderten Originalexporte mit ihren SHA-256-Prüfsummen.

Die Zuordnung erfolgt über die Buchungsnummer: `127` wird mit `127.pdf` verknüpft, Dateien wie `97_1.pdf` und `97_2.pdf` mit derselben Buchung. Buchungen ohne Beleg stehen nur im DATEV-Buchungsstapel.

Ob ein Archivbeleg Rechnung, Gutschrift, Eingangsrechnung oder Eingangsgutschrift ist, ergibt sich aus Soll und Haben im konfigurierten Kontenrahmen: mit BU-Schlüssel aus der Steuerart (2 und 3 Umsatzsteuer, 8 und 9 Vorsteuer), sonst aus den Bilanz- und GuV-Posten des DATEV-Kontenrahmens. Der Steuersatz kommt aus der Beleginfo, sonst aus dem BU-Schlüssel oder dem Automatikkonto (etwa SKR03 8400, SKR04 4400). Geldtransit, Privates und Zahlungen über Personenkonten tragen keine Umsatzsteuer.

## Abgleich je Jahr

Für Jahre aus BuchhaltungsButler rechnet der Abgleich Einnahmen, Ausgaben und Umsatzsteuer aus dem DATEV-Buchungsstapel desselben Exports, wie bei einem Umzug nur über DATEV. Die Archivbelege zählen dort nur als vorhandene Belege und Dateien: Ob eine Buchung Einnahme, Ausgabe oder weder noch ist, ließe sich aus den Konten allein nur schätzen, etwa bei Anlagenverkäufen, Bestandskonten, Ertragsteuern oder Erstattungen. Aus demselben Grund gibt es für diese Jahre keine Umsatzsteuer je Monat und keine Aufstellung von Privatem und Geldtransit; die Belege erscheinen auch nicht in der Zeitraumabfrage für die Umsatzsteuer.

Wechselst du unter dem Jahr, etwa von Lexware Office oder sevDesk zu BuchhaltungsButler, zählt der Abgleich für dieses Jahr die Belege aus Lexware Office oder sevDesk und dazu die Buchungen aus dem DATEV-Stapel des BuchhaltungsButler-Imports; erkennbar ist dieser Stapel an der Notiz „BuchhaltungsButler-Originalexport“ unter **Originaldateien**. Die Umsatzsteuer je Monat zeigt dann nur die Monate aus Lexware Office oder sevDesk. Die letzte Rechnungsnummer eines Jahres nennt der Abgleich auch aus den BuchhaltungsButler-Belegen, damit du den Nummernkreis in Haben fortsetzen kannst.

Die Summen aus dem Buchungsstapel sind eine Näherung nach Kontenklassen, wie unter [Lexoffice, Abgleich je Jahr](lexoffice.md#schritt-5-abgleich-je-jahr) beschrieben. Weitere Erträge und Aufwendungen außerhalb dieser Klassen, etwa Zinsen oder Kfz-Steuer (SKR03 Klasse 2, SKR04 Klasse 7), zählen dort nicht mit.

**Kontenrahmen, Rechtsform und Versteuerungsart kommen aus den Firmendaten in Haben.** Sie werden nicht aus den Exporten erraten. Vorhandene Kontakte werden nur verknüpft, wenn der Name genau und ohne Mehrdeutigkeit übereinstimmt; neue Kontaktdatensätze entstehen aus den Belegdaten nicht.

Ein erneuter Import überspringt bereits vorhandene Belege und Originalexporte. Einen sich mit einem anderen DATEV-Stapel überschneidenden Zeitraum kannst du nicht doppelt einlesen.

## Grenzen

- **Keine aktiven Neubuchungen:** Die Altbelege erzeugen keine neuen Buchungen, Zahlungen, offenen Posten oder ELSTER-Meldungen.
- **Keine Zahlungshistorie:** Der Export liefert keine verlässlichen Einzelzahlungen. Der Status lautet deshalb „archiviert“; bezahlte oder offene Beträge werden nicht geschätzt.
- **Keine Rechnungspositionen:** Die Exporte enthalten Kopfdaten und Kontierungen, aber keine vollständigen Positionen wie Artikel, Menge und Einzelpreis.
- **Keine vollständigen Kontakte:** Für Stammdaten verwendest du bei Bedarf den [CSV-Import](csv-import.md).
- **Keine Umsatzsteuer je Monat:** Die Summen des DATEV-Buchungsstapels gelten für das ganze Jahr, und ohne Einzelzahlungen lässt sich bei Ist-Versteuerung die Zahlungsperiode nicht rekonstruieren. Vergleiche historische Steuerwerte mit den Originalauswertungen und den ELSTER-Protokollen.

Ergänze je Geschäftsjahr noch den Datenexport für die Betriebsprüfung, ELSTER-Protokolle und Kontoauszüge unter **Exporte ablegen**. Danach vergleichst du im **Abgleich je Jahr** Buchungen, Dateien und Summen mit BuchhaltungsButler.

## Dateigröße

Der BB-Import akzeptiert einzelne Exportdateien bis 500 MB. Der mitgelieferte Caddy begrenzt HTTP-Anfragen standardmäßig auf 250 MB. Bei größeren Archiven muss diese Grenze angepasst oder der Belegexport aufgeteilt werden. Andere Archivdateien bleiben bei der Grenze von 100 MB.
