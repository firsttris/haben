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
- je Einnahme oder Ausgabe ohne Beleg (Buchung auf einem Erlös-, Ertrags-, Aufwands- oder Steuerkonto der GuV) eine Buchung ohne Beleg, damit die Summen im Abgleich vollständig sind; Zahlungen, Geldtransit und Umbuchungen ohne Beleg stehen nur im DATEV-Buchungsstapel,
- Rechnungsnummer, Rechnungsdatum, Gegenpartei, Betrag und Steuersatz,
- die zugehörigen Original-PDFs, auch mehrere Dateien einer Buchung,
- die unveränderten Originalexporte mit ihren SHA-256-Prüfsummen.

Die Zuordnung erfolgt über die Buchungsnummer: `127` wird mit `127.pdf` verknüpft, Dateien wie `97_1.pdf` und `97_2.pdf` mit derselben Buchung. Einnahmen, Ausgaben und Gutschriften ergeben sich aus Soll und Haben im konfigurierten Kontenrahmen; welches Konto Erlös, Aufwand, Anlage oder Bilanzkonto ist, folgt den Bilanz- und GuV-Posten des DATEV-Kontenrahmens. Ein Anlagekauf zählt als Ausgabe mit Vorsteuer, auch wenn er über ein Kreditorenkonto läuft. Eine Erstattung auf ein Aufwandskonto mindert die Ausgaben. Buchungen nur zwischen Bilanzkonten (Geldtransit, Privates, Kapital, Steuerzahlungen, Darlehen) oder auf ein Debitoren- oder Kreditorenkonto sind weder Einnahme noch Ausgabe; Zinsen, Kfz-Steuer und andere Erträge und Aufwendungen der GuV zählen mit. Körperschaft- und Gewerbesteuer einer GmbH oder UG stehen im Abgleich getrennt (§ 10 Nr. 2 KStG, § 4 Abs. 5b EStG). Erlöse auf Automatikkonten ohne BU-Schlüssel und ohne Steuersatz im Export tragen den Satz des Automatikkontos. Ein Beleg zu einer neutralen Buchung steht im Abgleich getrennt (Einzelunternehmen unter „Privat und Geldtransit“, GmbH und UG unter „Geldtransit“) und trägt keine Umsatzsteuer. Erlöse auf Automatikkonten ohne BU-Schlüssel (etwa SKR03 8400, SKR04 4400) zählen als regulär besteuert.

**Kontenrahmen, Rechtsform und Versteuerungsart kommen aus den Firmendaten in Haben.** Sie werden nicht aus den Exporten erraten. Vorhandene Kontakte werden nur verknüpft, wenn der Name genau und ohne Mehrdeutigkeit übereinstimmt; neue Kontaktdatensätze entstehen aus den Belegdaten nicht.

Ein erneuter Import überspringt bereits vorhandene Belege und Originalexporte. Einen sich mit einem anderen DATEV-Stapel überschneidenden Zeitraum kannst du nicht doppelt einlesen.

## Grenzen

- **Keine aktiven Neubuchungen:** Die Altbelege erzeugen keine neuen Buchungen, Zahlungen, offenen Posten oder ELSTER-Meldungen.
- **Keine Zahlungshistorie:** Der Export liefert keine verlässlichen Einzelzahlungen. Der Status lautet deshalb „archiviert“; bezahlte oder offene Beträge werden nicht geschätzt.
- **Keine Rechnungspositionen:** Die Exporte enthalten Kopfdaten und Kontierungen, aber keine vollständigen Positionen wie Artikel, Menge und Einzelpreis.
- **Keine vollständigen Kontakte:** Für Stammdaten verwendest du bei Bedarf den [CSV-Import](csv-import.md).
- **Keine monatliche Ist-Versteuerung aus Zahlungen:** Ohne Einzelzahlungen lässt sich die Zahlungsperiode nicht rekonstruieren. Bei Ist-Versteuerung zeigt der Abgleich für Jahre mit Einnahmen aus BuchhaltungsButler deshalb einen Hinweis statt Monatswerten. Vergleiche historische Steuerwerte mit den Originalauswertungen.

Ergänze je Geschäftsjahr noch den Datenexport für die Betriebsprüfung, ELSTER-Protokolle und Kontoauszüge unter **Exporte ablegen**. Danach vergleichst du im **Abgleich je Jahr** Buchungen, Dateien und Summen mit BuchhaltungsButler.

## Dateigröße

Der BB-Import akzeptiert einzelne Exportdateien bis 500 MB. Der mitgelieferte Caddy begrenzt HTTP-Anfragen standardmäßig auf 250 MB. Bei größeren Archiven muss diese Grenze angepasst oder der Belegexport aufgeteilt werden. Andere Archivdateien bleiben bei der Grenze von 100 MB.
