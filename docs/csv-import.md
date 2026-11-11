---
title: "CSV-Import für Kontakte, Artikel und Anlagen"
description: >-
  Kontakte, Artikel und Anlagen aus einer CSV-Datei übernehmen, etwa aus Lexware Office, einer
  anderen Buchhaltung oder Excel – mit Spaltenzuordnung und Vorschau.
---

# CSV-Import

Kontakte, Artikel und Anlagen übernimmst du aus einer CSV-Datei, etwa aus einem Export von Lexware Office, einer anderen Buchhaltung oder einer Excel-Liste. Den Import öffnest du unter **Kontakte**, **Artikel** oder **Anlagen** mit **CSV importieren**; oben auf der Seite wechselst du zwischen den drei Arten.

Rechnungen, Belege und Buchungen gehen nicht per CSV: Dafür gibt es den [Umzug aus Lexoffice](lexoffice.md), den [Umzug aus sevDesk](sevdesk.md) und den [vorbereiteten Betreiberimport](belegimport.md). Kontoauszüge kommen über den [Bankimport](bank.md).

## So gehst du vor

1. **Datei wählen.** Bis 5 MB und 5.000 Zeilen; die erste nicht leere Zeile enthält die Spaltennamen. Trennzeichen und Kodierung erkennt Haben selbst, du kannst sie aber festlegen.
2. **Vorschau.** Haben ordnet die Spalten nach ihren Namen den Feldern zu und prüft jede Zeile. Änderst du danach Trennzeichen, Kodierung oder Stichtag, verschwindet die Vorschau; übernommen wird nur, was eine Vorschau gezeigt hat.
3. **Spalten zuordnen.** Passt eine Zuordnung nicht, wählst du je Feld die richtige Spalte oder „nicht übernehmen“. Die Vorschau rechnet nach jeder Änderung neu.
4. **Übernehmen.** Der Knopf nennt, wie viele Datensätze neu angelegt werden. Danach steht da, wie viele übernommen und wie viele übersprungen wurden.

## Datei

| Einstellung | Was Haben macht |
| --- | --- |
| Trennzeichen | Semikolon, Komma oder Tabulator. Automatisch nimmt Haben das Zeichen, bei dem die ersten Zeilen gleichmäßig in mehrere Spalten zerfallen; bei Gleichstand das Semikolon, wie es das deutsche Excel schreibt. Felder in Anführungszeichen dürfen das Trennzeichen und Zeilenumbrüche enthalten. Hat eine Zeile mehr Werte als die Kopfzeile Spalten, stand ein Trennzeichen ohne Anführungszeichen in einem Feld; Haben übernimmt sie nicht, statt die Werte verschoben einzutragen. |
| Kodierung | UTF-8 mit oder ohne BOM und Windows-1252 („CSV (Trennzeichen-getrennt)“ aus Excel unter Windows). Ein BOM entscheidet immer, auch UTF-16 mit BOM wird erkannt. Automatisch liest Haben UTF-8 und, wenn die Datei kein gültiges UTF-8 ist, Windows-1252. Wählst du UTF-8 und die Datei ist es nicht, lehnt Haben sie mit einem Hinweis ab, statt Umlaute zu zerstören. |
| Zeilennummer | Die Vorschau zählt Datensätze wie die Datei, die Kopfzeile ist Zeile 1. Leere Zeilen fallen weg. |

### Werte

| Art | Format |
| --- | --- |
| Beträge | Deutsch, `1.234,56`, auch `12,5` oder `100 €`. Ein Punkt gilt nur als Dezimalpunkt, wenn er eindeutig ist (`12.50`). `1.234` lehnt Haben als mehrdeutig ab: deutsch sind das 1.234 €, englisch 1,234 €; schreibe `1.234,00` oder `1234`. `1.234.567` ist eindeutig. Englische Tausendertrenner wie `1,234.56` lehnt Haben ab. Gerechnet wird in ganzen Cent. |
| Datum | `TT.MM.JJJJ` oder `JJJJ-MM-TT`. Zweistellige Jahre lehnt Haben ab, weil eine Anschaffung von `99` 1999 oder 2099 sein könnte. |
| Steuersatz | `19`, `19 %`, `19,00`, `7`, `0`, auch `USt 19%` wie in der Artikelvorlage von Lexware Office. Andere Sätze (16 %, 5 %) kennt der Artikelkatalog nicht. |
| Land | Ländercode nach ISO 3166-1 (`DE`), die Ziffern daraus wie in Lexware Office (`276`) oder der deutsche Name (`Deutschland`, `Österreich`, `Schweiz` …). Leer ist Deutschland. |

### Formeln (CSV-Injection)

Ein Text, der mit `=` oder `@` beginnt, oder mit `+` oder `-` und danach nicht nur Ziffern, sähe in Excel oder LibreOffice wie eine Formel aus. Öffnet jemand später einen Export aus Haben, könnte die Tabellenkalkulation sie ausführen. Haben übernimmt solche Zeilen nicht und nennt das Feld; entferne das Zeichen am Anfang in der Datei. Telefonnummern wie `+49 221 …` und negative Zahlen sind kein Problem. Die Exporte von Haben setzen vor solche Texte zusätzlich ein `'`.

## Dubletten und Fehler

Haben legt nichts doppelt an und überschreibt nichts:

- **Dublette:** Gibt es den Datensatz schon in Haben (auch archiviert) oder steht er weiter oben in derselben Datei, überspringt Haben die Zeile. Die Vorschau nennt das Merkmal, etwa „Gibt es schon (Kundennummer 10001)“ oder „Wie Zeile 3 (E-Mail …)“.
- **Fehler:** Zeilen mit Fehlern übernimmt Haben nicht; die Vorschau nennt jeden Fehler mit dem Feld. Korrigiere die Datei und lade sie noch einmal: Was schon übernommen ist, zählt dann als Dublette.
- **Alles oder nichts:** Alle neuen Zeilen entstehen in einer Transaktion. Scheitert eine beim Speichern, wird keine angelegt.
- Die Vorschau zeigt bis zu 200 Zeilen, Fehler und Dubletten zuerst.
- Jede angelegte Zeile steht wie beim Anlegen von Hand im Änderungsprotokoll.

| Art | Wiedererkannt an |
| --- | --- |
| Kontakte | Kundennummer, Lieferantennummer, Debitor, Kreditor, jeder E-Mail-Adresse, USt-IdNr. oder Name (Groß- und Kleinschreibung egal) |
| Artikel | Artikelnummer; eine Zeile ohne Nummer an der Bezeichnung, auch gegen einen Artikel mit Nummer |
| Anlagen | Bezeichnung, Anschaffungsdatum und Anschaffungskosten zusammen |

Eine Debitor- oder Kreditornummer, die schon ein Kontakt trägt (auch ein archivierter) oder die weiter oben in der Datei steht, zeigt die Vorschau so als Dublette mit der Nummer; Haben überschreibt und vergibt sie nicht ein zweites Mal. Die Spalten „Debitorennummer“ und „Kreditorennummer“ ordnet Haben dem DATEV-Debitor bzw. -Kreditor zu; meint deine Datei damit Kunden- bzw. Lieferantennummer, ordnest du sie in der Vorschau dorthin um.

Bei Kontakten zählt auch der Name, wie beim [Abruf aus Lexware Office](lexoffice.md#kontakte-verknüpfen): Lieber einmal zu viel überspringen als einen Kunden doppelt anlegen. Einen zweiten Kunden mit gleichem Namen legst du von Hand an.

## Kontakte

| Feld | Spaltennamen, die Haben vorschlägt | Prüfung |
| --- | --- | --- |
| Kundennummer | Kundennummer, Kundennr | Leer: Bei Kunden vergibt Haben die nächste, wenn unter Einstellungen ein Format steht ([Kontakte](rechnungen.md#kontakte)) |
| Lieferantennummer | Lieferantennummer, Lieferantennr | |
| Debitor | Debitorennummer, Debitor, Debitorenkonto | DATEV-Personenkonto, nur Ziffern, 10000 bis 69999 ([Kontakte](rechnungen.md#kontakte)); macht wie die Kundennummer zum Kunden |
| Kreditor | Kreditorennummer, Kreditor, Kreditorenkonto | DATEV-Personenkonto, nur Ziffern, 70000 bis 99999; macht wie die Lieferantennummer zum Lieferanten |
| Firma | Firmenname, Firma, Unternehmen, Name | Fehlt sie, gilt „Vorname Nachname“; ohne beides ist die Zeile fehlerhaft |
| Vorname, Nachname | Vorname, Nachname | |
| Straße, PLZ, Ort, Land | Straße, PLZ, Ort, Land, auch „Straße (Rechnungsadresse)“ … und „Straße 1“ … wie bei Lexware Office | Land siehe [Werte](#werte). Die Lieferadresse („… (Lieferadresse)“, „Straße 2“ …) übernimmt Haben nicht |
| E-Mail | E-Mail, Email, E-Mail-Adresse, Geschäftlich (E-Mail), E-Mail 1 | Mehrere Adressen mit Komma oder Semikolon, höchstens fünf, wie im Formular |
| Telefon | Telefon, Telefonnummer, Rufnummer, Geschäftlich (Rufnummer), Telefon 1 | Ziffern, Leerzeichen und `+ ( ) / - .`, wie im Formular |
| USt-IdNr. | USt-IdNr., USt-ID, Umsatzsteuer-ID, Umsatzsteuer ID, Umsatzsteuernummer | Form wie `DE123456789`; die deutsche auch mit Prüfziffer (ISO 7064). Ob sie erteilt ist, weiß nur das BZSt |
| IBAN | IBAN | Prüfziffer nach ISO 13616; Leerzeichen fallen weg |
| Leitweg-ID | Leitweg-ID | |
| Rolle | Rolle, Typ, Kontaktart | „Kunde“, „Lieferant“ oder beides. Ohne Spalte: Lieferant, wenn nur eine Lieferantennummer oder ein Kreditor dasteht, beides bei Nummern für beide Rollen, sonst Kunde. Hat die Datei eine Spalte Lieferantennummer, aber keine Kundennummer (Lieferanten-Vorlage von Lexware Office), ist auch eine Zeile ohne Nummer ein Lieferant |

Rechnungsformat, Sprache und Skonto übernimmt Haben nicht; sie stehen wie bei einem neuen Kontakt auf „wie in den Einstellungen“, Deutsch und der Vorgabe aus den Firmendaten.

Die Namen folgen der [Mustervorlage für den Kontaktimport](https://help.lexware.de/de-form/articles/548267-anleitung-zum-import-von-kontakten-kunden-und-lieferanten) und dem [Kontakt-Export](https://help.lexware.de/de-form/articles/548116-kontakte-beim-account-wechsel-ubertragen-export-und-import-in-lexware-office) von Lexware Office und den Feldern der Lexware-API (`companyName`, `firstName` …). Weichen die Spaltennamen deiner Datei ab, ordnest du sie in der Vorschau zu.

## Artikel

| Feld | Spaltennamen, die Haben vorschlägt | Prüfung |
| --- | --- | --- |
| Artikelnummer | Artikelnummer, Art.-Nr., Produktnummer | |
| Bezeichnung | Bezeichnung, Titel, Artikelname, Name | Pflicht |
| Beschreibung | Beschreibung, Langtext | Mehrzeilig, bis 2000 Zeichen; der Text zur Position |
| Einheit | Einheit, Mengeneinheit | Std., Tag, Monat, Stk., Psch. oder km, auch ausgeschrieben („Stunde“, „Stück“, „pauschal“). Leer ist Stück |
| Nettopreis | Nettopreis, Preis netto, Einzelpreis, Preis | |
| Bruttopreis | Bruttopreis, Preis brutto | Nur ohne Nettopreis: dann ein Artikel mit Endpreis |
| Steuersatz | Umsatzsteuer, Steuersatz, Steuerart, USt, MwSt | Pflicht, ohne stille Vorgabe: Kleinunternehmer brauchen 0 %, alle anderen meist 19 % |
| Notiz | Notiz, Bemerkung | |

Die Namen folgen der [Mustervorlage für Produkte und Services](https://help.lexware.de/de-form/articles/548269-produkte-und-services-per-csv-datei-importieren) von Lexware Office. Deren Spalte „Verkaufspreis“ ist netto oder brutto, je nachdem, was in Lexware Office unter den Allgemeinen Einstellungen steht. Haben ordnet sie deshalb nicht selbst zu; du wählst sie in der Vorschau als Netto- oder Bruttopreis.

Stehen Netto- und Bruttopreis da, wie im Export von Lexware Office, gilt der Nettopreis, und der Bruttopreis muss auf einen Cent genau dazu passen. Sonst wäre unklar, welcher stimmt, und Haben übernimmt die Zeile nicht.

## Anlagen

Der Import ist eine [Übernahme aus der bisherigen Buchhaltung](anlagen.md#übernahme-aus-lexoffice) für viele Anlagen auf einmal, mit denselben Regeln wie **Anlage übernehmen**. Den **Übernahmestichtag** wählst du für die ganze Datei, in der Regel den 01.01. des ersten Jahres, das du in Haben buchst.

| Feld | Spaltennamen, die Haben vorschlägt | Prüfung |
| --- | --- | --- |
| Bezeichnung | Bezeichnung, Anlagegut, Wirtschaftsgut | Pflicht |
| Art | Art, Anlagenart, Kategorie | Fahrzeug (auch Pkw, Lkw), Computer (auch Hardware, Software, Laptop), Büromöbel, Sonstige Transportmittel (auch Anhänger, Lastenrad; ein Transporter ist ein Fahrzeug), Sonstiges. Leer ist Sonstiges |
| Abschreibung | Abschreibung, AfA-Art, AfA-Methode | linear, degressiv, Elektro (§ 7 Abs. 2a EStG, nur Fahrzeuge im Einzelunternehmen), GWG, Sammelposten oder digital (Computer mit einem Jahr). Leer: der Vorschlag zur Art ([Art und Abschreibung](anlagen.md#art-und-abschreibung)) |
| Anschaffungsdatum | Anschaffungsdatum, Kaufdatum, Zugangsdatum | Pflicht, vor dem Stichtag |
| Anschaffungskosten | Anschaffungskosten, AK, AHK | Pflicht, netto |
| Nutzungsdauer | Nutzungsdauer (Jahre), Nutzungsdauer (Monate) | Bei linearer und degressiver AfA Pflicht; in Jahren auch als Bruchteil, solange ganze Monate herauskommen (`2,5` = 30 Monate) |
| Degressiver Satz | Degressiver Satz, AfA-Satz | In Prozent (`25`, `23,07`); leer: der Höchstsatz ([Degressive AfA](anlagen.md#degressive-afa)) |
| Restbuchwert zum Stichtag | Restbuchwert, Buchwert | Buchwert am Tag vor dem Stichtag, also zum 31.12. des Vorjahres |
| Bisherige AfA | bisherige AfA, kumulierte AfA | Statt des Restbuchwerts: Anschaffungskosten minus bisherige AfA. Stehen beide da, müssen sie zusammenpassen |
| Notiz | Notiz, Bemerkung, Inventarnummer | |

Lexware Office liefert das Anlagenverzeichnis weder über die Schnittstelle noch als Datei; die Liste schreibst du aus dem Anlagenverzeichnis ab oder exportierst sie aus der bisherigen Buchhaltung.

### Was der Import bucht: nichts

Die Übernahme erzeugt keine Buchung. Wie bei einer von Hand übernommenen Anlage bucht Haben die Eröffnung (Anlagekonto an Saldenvortrag zum Stichtag) erst mit der ersten **AfA … buchen**. Bis dahin lässt sich jede übernommene Anlage auf ihrer Seite ändern oder löschen; ein Fehler in der Datei ist also ohne Storno zu beheben. Die AfA ab dem Stichtag steht sofort in der EÜR.

### Was der Import ablehnt

Haben übernimmt nur, was das Anlagenverzeichnis fachlich richtig abbilden kann. Diese Fälle lehnt der Import ab, weil Haben sonst im Jahr des Stichtags abschriebe, was in frühere Jahre gehört, oder ein schon gebuchtes Jahr änderte:

| Fall | Warum |
| --- | --- |
| Anschaffung am oder nach dem Stichtag | Das ist ein Zugang, keine Übernahme. Buche den Beleg mit der Kategorie **Anlagegut**; dann stimmen Vorsteuer und Anlagekonto ([Anschaffung per Beleg](anlagen.md#anschaffung-per-beleg)). |
| GWG oder Computer mit einem Jahr aus einem Vorjahr mit Restbuchwert über 0 | Beide sind im Anschaffungsjahr voll abgeschrieben. |
| Linear mit abgelaufener Nutzungsdauer und Restbuchwert über 0, Sammelposten nach fünf Jahren mit Restbuchwert | Der Rest müsste schon abgeschrieben sein. |
| Restbuchwert unter 0 oder über den Anschaffungskosten, Sammelposten oder GWG außerhalb der Grenzen | Wie im Formular ([Art und Abschreibung](anlagen.md#art-und-abschreibung)). |
| Degressive oder Elektro-AfA mit einem Restbuchwert, der nicht zum Plan passt, mit Stichtag nicht am 01.01. oder außerhalb der Zeiträume | Haben kann nicht nachrechnen, wie die bisherige Buchhaltung abgeschrieben hat, und nennt den rechnerischen Wert. Übernimm die Anlage dann linear mit Restbuchwert; das ist der Wechsel zur linearen AfA nach § 7 Abs. 3 EStG ([Übernahme](anlagen.md#übernahme-aus-lexoffice)). |
| Stichtag in einem Jahr, für das schon AfA gebucht ist, oder in einem abgeschlossenen Jahr | Der Import sperrt dann die ganze Datei: Er änderte die AfA eines Jahres, dessen EÜR, Bilanz oder Voranmeldungen womöglich schon abgegeben sind. Nachträge für frühere Jahre klärst du mit der Steuerberatung. |

Private Kfz-Nutzung und Abgang übernimmt der Import nicht. Beides trägst du danach auf der Seite der Anlage ein ([Private Nutzung](anlagen.md#private-nutzung-von-firmenwagen), [Abgang](anlagen.md#abgang)).

## Beispiele

Kontakte, wie Excel unter Windows sie speichert (Windows-1252, Semikolon):

```
Kundennummer;Firmenname;Vorname;Nachname;Straße;PLZ;Ort;Land;E-Mail;USt-IdNr.;IBAN
10001;Müller & Söhne GmbH;;;Hauptstraße 5;50667;Köln;DE;rechnung@mueller.example;DE136695976;DE89 3704 0044 0532 0130 00
10002;;Erika;Mustermann;Lindenweg 2;80331;München;Deutschland;erika@mustermann.example;;
```

Artikel (UTF-8, Komma):

```
Artikelnummer,Bezeichnung,Einheit,Nettopreis,Umsatzsteuer
B-01,Beratung,Stunde,"110,00",19
F-01,Fachbuch,Stück,"39,90",7
```

Anlagen zum Stichtag 01.01.2026:

```
Bezeichnung;Art;Anschaffungsdatum;Anschaffungskosten;Nutzungsdauer;Restbuchwert
VW Passat;Fahrzeug;15.03.2024;36.000,00;6;25.000,00
Schreibtisch;Büromöbel;01.07.2023;1.300,00;13;1.050,00
```

[Zurück zur Übersicht](ueberblick.md)
