---
title: "Umzug aus WISO EÜR & Kasse zum 1. Januar"
description: >-
  WISO EÜR & Kasse zum Jahreswechsel verlassen: Originalexporte sichern, Kontakte, Artikel
  und Anlagen per CSV übernehmen und offene Posten vor dem Start klären.
---

# Umzug aus WISO EÜR & Kasse

Für ein Einzelunternehmen mit EÜR bietet sich der Wechsel zum **1. Januar** an: Das letzte Jahr bleibt in WISO, das neue beginnt in Haben. Kontakte, Artikel und Anlagen kannst du heute über selbst vorbereitete CSV-Dateien mit Vorschau übernehmen.

> [!IMPORTANT]
> Haben bietet als Rechtsform nur Einzelunternehmen, GmbH und UG an. Eine Partnerschaft ist damit derzeit nicht abgedeckt; richte sie nicht ersatzweise als Einzelunternehmen ein. GmbH und UG bilanzieren in Haben, dieser EÜR-Ablauf gilt für sie nicht. Bei einem Wechsel der Gewinnermittlung klärst du zuerst die Eignung mit der Steuerberatung; siehe [Einrichtung](einrichtung.md#rechtsform-einzelunternehmen-gmbh-oder-ug).

## Was heute geht

| Bestand aus WISO | Weg nach Haben |
| --- | --- |
| Kontakte, Artikel und Anlagen | Noch kein automatischer Listenimport: aus den Listen eine CSV erstellen, [Spalten zuordnen und Vorschau prüfen](csv-import.md) |
| Originalexporte und PDF-Listen | Unverändert aufbewahren; optional als Originaldateien im Archiv ablegen |
| Buchungs-CSV und GoBD-Buchungsliste | Noch kein WISO-Import; weder durchsuchbare Archivbuchungen noch Journalbuchungen entstehen daraus |
| Offene Rechnungen und Eingangsbelege | Kein automatischer WISO-Umzug; vor dem Start einzeln klären |

Für WISO Steuer mit dem Modul EÜR sind gleiche Exportformate nicht bestätigt.

## 1. Das letzte WISO-Jahr abschließen und sichern

1. Erfasse die letzten Buchungen des Jahres und **buche die Jahres-AfA in WISO**, bevor du das endgültige Anlagenverzeichnis ausgibst. In der geprüften WISO-Liste waren die Werte laufender GWG vor der AfA-Buchung noch vorläufig.
2. Gib danach das Anlagenverzeichnis einschließlich der Anlagendetails und Abschreibungspläne neu aus. Beim Wechsel zum 01.01.2027 brauchst du den Restbuchwert **zum 31.12.2026**.
3. Sichere je Jahr den CSV-Export der Buchungen und den vollständigen Export für den Datenzugriff der Finanzverwaltung: `index.xml`, Firmenstammblatt, Kontenplan, Buchungsliste, Sachkonten, Summen- und Saldenliste sowie Umsatzsteuerjahresaufstellung.
4. Sichere die Kontakt- und gegebenenfalls Artikellisten, Originalrechnungen und Belege, Kontoauszüge, EÜR und die Übermittlungsprotokolle deiner Steueranmeldungen und Erklärungen.

Bewahre diese Originale unverändert mit eindeutiger Jahreszuordnung und einer getrennten Sicherung auf. Erstelle die CSV für Haben in einer Arbeitskopie; überschreibe weder Exportdateien noch Belege.

Optional legst du die WISO-Dateien zusätzlich unter **Archiv › Originaldateien › Datei ablegen** mit Art **Sonstiges** und dem zugehörigen Geschäftsjahr ab. Das speichert Dateien, liest aber keine WISO-Buchungen oder offenen Posten ein. Wähle dafür nicht **DATEV-Buchungsstapel**: Die WISO-Rohdateien sind kein DATEV-Stapel.

Ein unterjähriger Umstieg ist mit den geprüften Listen nicht geklärt: Sie zeigen den Restbuchwert zum 31.12. Für einen anderen Stichtag bräuchtest du einen verlässlichen Buchwert am Vortag und die passende bereits gebuchte AfA. Verwende dafür keinen Jahresendwert.

## 2. Haben für das neue Jahr einrichten

Trage vor der ersten Buchung die [Firmendaten](einrichtung.md#firmendaten) ein. Prüfe Kontenrahmen, Ist- oder Soll-Versteuerung und Kleinunternehmerstatus gegen den bisherigen Stand. Setze die nächste Rechnungsnummer so, dass keine bereits vergebene Nummer erneut verwendet wird.

Lege den ersten Tag der Buchhaltung in Haben fest und plane den [Bankimport](bank.md) ab diesem Tag. Bei einem Wechsel der Bankquelle beachtest du die dort beschriebenen [Dubletten](bank.md#dubletten).

## 3. Listen in CSV übertragen und prüfen

Erstelle für Kontakte, Anlagen und gegebenenfalls Artikel je eine eigene CSV mit Spaltennamen in der ersten Zeile. Übertrage die Werte aus der jeweiligen Liste; Seitenköpfe, Fußzeilen und Summenzeilen sind keine Datensätze. Bei umbrochenen Namen und Bezeichnungen kontrollierst du den vollständigen Eintrag am Original.

Öffne **CSV importieren** unter **Kontakte**, **Anlagen** oder **Artikel**. Prüfe die erkannten Spaltenzuordnungen sowie Fehler und Dubletten vor **Übernehmen**. Die genauen Dateiformate und Feldregeln stehen im [CSV-Import](csv-import.md#so-gehst-du-vor).

### Kontakte

- Übernimm die WISO-Kundennummer als **Kundennummer**, nicht ungeprüft als DATEV-Debitor. Bewahre führende Nullen bei der Vorbereitung als Text.
- Führe umgebrochene Namen zusammen. Trenne Firma, Vor- und Nachname nur, wenn die Zuordnung eindeutig ist. Ein Ansprechpartner unter der Anschrift ist kein weiterer Kunde.
- Lasse fehlende Angaben wie „k.A.“ leer. Prüfe die Rolle **Kunde**, **Lieferant** oder beide; Haben kennt keine eigene Interessentenrolle.
- Ergänze **Land** ausdrücklich, etwa `DE`, `LU`, `BE` oder `LV`. Die geprüfte PDF-Liste gibt das WISO-Länderfeld nicht aus. Ohne Land setzt der CSV-Import Deutschland.
- Präfixe wie `L - 1821` in der PLZ waren eigene Eingaben der WISO-Nutzer, keine verlässliche Länderkennzeichnung des Exports. Prüfe das tatsächliche Land und trenne es von der PLZ; bei Luxemburg etwa `Land = LU`, `PLZ = 1821`. Haben leitet das Land daraus nicht automatisch ab.

Umsatz, Saldo, Kreditlimit und Zahlungsdauer aus der Kontaktliste sind keine einzelnen Rechnungen oder Zahlungen. Daraus entstehen beim Kontaktimport keine offenen Posten.

### Anlagen

Wähle für die gesamte Datei den **Übernahmestichtag 01.01.** des ersten Haben-Jahres. Der Restbuchwert gehört zum **31.12. des Vorjahres nach gebuchter Jahres-AfA**.

| WISO-Liste oder Anlagendetails | CSV für Haben |
| --- | --- |
| Nr. und Bezeichnung | **Bezeichnung**, etwa `Konferenzstuhl [WISO 142]`; die Nummer zusätzlich in **Notiz** aufbewahren |
| Anschaffungsdatum | **Anschaffungsdatum**, nicht der Umzugstag |
| Anschaffungskosten | **Anschaffungskosten** wie in WISO geführt; [Vorsteueranteil beachten](csv-import.md#anlagen), nicht nach heutigem Kleinunternehmerstatus umrechnen; Veränderungen gesondert prüfen |
| ND | **Nutzungsdauer (Jahre)** bzw. Monate passend zum bisherigen Plan |
| Abschreibungsplan | **Art** und **Abschreibung** ausdrücklich passend wählen |
| RBW 31.12. des letzten WISO-Jahres | **Restbuchwert** |

**Identische Anlagen:** Haben erkennt Dubletten an Bezeichnung, Anschaffungsdatum und Anschaffungskosten zusammen. Acht gleiche Stühle vom selben Tag brauchen deshalb unterscheidbare Bezeichnungen mit ihrer jeweiligen WISO-Nummer. Die Notiz allein verhindert keine Dublette.

**Zugänge und Teilabgänge:** Übernimm die Spalte „Zugänge/Teilabgänge“ nicht pauschal als Zuschlag zu den Anschaffungskosten. Prüfe je Anlage Art und Zeitpunkt der Veränderung, die fortgeführten Kosten und den Buchwert anhand der Details. Unklare Fälle klärst du mit der Steuerberatung, statt den Plan passend zu rechnen.

**GWG und vollständig abgeschriebene Anlagen:** Wähle die Methode nach dem tatsächlichen Abschreibungsplan, nicht allein nach dem WISO-Konto. Vollständig abgeschriebene Anlagen musst du nicht übernehmen; die alten Nachweise bleiben in der Sicherung. Ein GWG aus dem Vorjahr mit positivem Restbuchwert wird vom CSV-Import abgelehnt. Prüfe zuerst, ob die letzte WISO-AfA wirklich gebucht und die Liste danach neu ausgegeben wurde.

**Erinnerungswert 1 €:** Der CSV-Import hat dafür keine Spalte. Bei abgelaufener linearer Nutzungsdauer lehnt er einen positiven Restbuchwert ab. Setze den Wert nicht künstlich auf 0. Prüfe eine [manuelle Übernahme mit Erinnerungswert](anlagen.md#erinnerungswert); Haben unterstützt ihn bei linearer, degressiver und Elektro-AfA, nicht bei GWG, Sammelposten oder Computern mit einjähriger Nutzungsdauer. Passt der bisherige Plan dazu nicht eindeutig, kläre die Übernahme mit der Steuerberatung.

Vergleiche nach der Übernahme Anzahl, Anschaffungskosten und Restbuchwerte mit dem endgültigen Verzeichnis je Anlagengruppe. Prüfe anschließend die einzelnen Abschreibungspläne in Haben. [Private Kfz-Nutzung](anlagen.md#private-nutzung-von-firmenwagen) und [Abgänge](anlagen.md#abgang) kommen nicht per CSV mit. Der Anlagenimport selbst bucht nichts; die Eröffnung entsteht erst mit der ersten AfA-Buchung ([CSV-Import](csv-import.md#was-der-import-bucht-nichts)).

### Artikel, falls benötigt

Übertrage Artikelnummer, Bezeichnung, Einheit, Preis und Steuersatz in die [Artikelfelder](csv-import.md#artikel). Ordne den Preis bewusst als netto oder brutto zu; der Steuersatz ist Pflicht. Prüfe nach der Übernahme einen häufig verwendeten Artikel in einer neuen Rechnung, bevor du sie festschreibst.

## 4. Offene Posten und erste Zahlungen klären

Erstelle zum 31.12. eine Liste der noch offenen Ausgangsrechnungen und Eingangsbelege mit Originalnummer, Datum, Kontakt, Steuerangaben, Gesamtbetrag, bisherigen Zahlungen und offenem Rest. Beziehe auch Dezemberrechnungen ein, die erst im Januar bezahlt werden. Halte Teilzahlungen mit ihrem tatsächlichen Datum fest.

Die WISO-Kontaktliste und die Buchungsdateien liefern derzeit keinen importierbaren offenen Posten. Die Übernahme unter **Archiv › Umzug › Offene Posten übernehmen** setzt bereits eingelesene Belegdatensätze voraus.

Kläre vor der ersten Zahlung mit der Steuerberatung, wie diese Posten in Haben erfasst und ausgeglichen werden, besonders bei Teilzahlungen und schon berücksichtigter Vorsteuer. Lege keine alte Rechnung als neue Leistung an und erfinde keine Zahlung für den bereits in WISO bezahlten Teil. Die [Grenzen freier Buchungen](buchhaltung.md#manuelle-und-freie-buchungen) gelten auch beim Umzug: Eine Journalbuchung ersetzt keinen offenen Posten im Nebenbuch.

Die laufenden Werte entstehen aus der Buchhaltung in Haben; ab dem eingestellten Stichjahr rechnen [EÜR](auswertungen.md#eür-nach-zufluss-und-abfluss) und [Voranmeldung](umsatzsteuer.md#wie-die-kennzahlen-entstehen) aus dem Journal.

## Vor dem endgültigen Wechsel

- [ ] Rechtsform und Gewinnermittlung passen zu Haben; offene Einschränkungen sind geklärt.
- [ ] WISO-Jahres-AfA gebucht, endgültiges Anlagenverzeichnis ausgegeben und Originale getrennt gesichert.
- [ ] Kontakte einschließlich Land, Anlagen einschließlich Dubletten und Erinnerungswert sowie benötigte Artikel geprüft.
- [ ] Offene Posten und deren Behandlung bei den ersten Zahlungen geklärt.
- [ ] Erste Bankumsätze, Rechnungsnummern, AfA-Pläne und Auswertungen kontrolliert.
- [ ] Zugriff auf die alten Daten und Originalbelege bleibt für Nachfragen und Prüfungen erhalten.

Grundlage der WISO-Hinweise: [anonymisierte Exportbeispiele](https://github.com/user-attachments/files/34634518/01_WISO_Beispieldateien_anonymisiert_2026-11-10.zip), [Rückmeldung zu AfA und Länderfeld](https://github.com/firsttris/haben/issues/565#issuecomment-6802857673) und [Klärung zum Jahreswechsel](https://github.com/firsttris/haben/issues/565#issuecomment-6808458708).
