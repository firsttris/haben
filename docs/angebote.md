---
title: "Angebote schreiben und mit einem Klick zur Rechnung machen"
description: >-
  Angebote im selben Editor wie Rechnungen schreiben, als PDF versenden und nach der Annahme mit
  einem Klick in eine E-Rechnung umwandeln.
---

# Angebote

Unter **Angebote** schreibst du Angebote mit demselben Editor wie Rechnungen. Nimmt der Kunde an, machst du daraus mit einem Klick eine Rechnung.

## Angebot schreiben

Einleitung, Texte zu Positionen und Hinweis unterstützen [fett, kursiv und unterstrichen](rechnungen.md#fett-kursiv-und-unterstrichen), mit derselben Darstellung in Vorschau und PDF.

**Neues Angebot** öffnet den Editor:

- Kunde und, wenn er Personen hat, ein [Ansprechpartner](kontakte.md#ansprechpartner) („z. Hd.“ im PDF und in Auftragsbestätigung und Lieferschein)
- Angebotsdatum
- **Gültig bis**, vorbelegt mit 30 Tagen
- optional der geplante Leistungszeitraum
- optional **Bestellnummer**, **Eigene Auftragsnummer** und **Lieferscheinnummer**; sie stehen im Kopfblock des PDFs und gehen in die Rechnung aus dem Angebot über ([wie bei der Rechnung](rechnungen.md#bestellnummer-auftrag-und-lieferschein))
- Umsatzsteuer: dieselbe Auswahl wie bei der [Rechnung](rechnungen.md#umsatzsteuer-auf-der-rechnung), etwa regulär, Kleinunternehmer, Reverse Charge, steuerfrei
- Sprache, vorbelegt vom Kunden (siehe [Rechnungen auf Englisch](rechnungen.md#rechnungen-auf-englisch))
- Preise netto oder brutto inklusive Umsatzsteuer, wie bei der [Rechnung](rechnungen.md#nettopreise-oder-bruttopreise)
- Einleitung über den Positionen, Positionen und ein Hinweis, beide auch aus [Textbausteinen](rechnungen.md#textbausteine); die Einleitung ist mit der Standard-Einleitung für Angebote aus den [Firmendaten](einrichtung.md) vorbelegt
- zu jeder Position optional ein mehrzeiliger **Text zur Position** wie bei der [Rechnung](rechnungen.md#positionen); er steht im PDF unter der Bezeichnung und geht in die Rechnung aus dem Angebot über
- zu jeder Position optional die **Art.-Nr.**, aus dem Artikelkatalog übernommen; sie steht im PDF, in Auftragsbestätigung und Lieferschein und geht in die Rechnung aus dem Angebot über (in der E-Rechnung BT-155, siehe [Positionen](rechnungen.md#positionen))
- **Positionsrabatt** und **Gesamtrabatt** in Prozent oder als Betrag wie bei der [Rechnung](rechnungen.md#rabatte); die Rechnung aus dem Angebot übernimmt beide
- je Position die **Art**: zählt zur Summe, **optional** oder **Alternative** zur Position davor (Auswahl hinter der Bezeichnung, siehe unten)
- optional ein **Zahlungsplan** (siehe unten)
- optional **Anhänge**: weitere PDF-Dateien wie AGB oder eine Leistungsbeschreibung (siehe unten)

**Vorschau** im Kopf zeigt das Angebot, von rechts über das Formular oder neben ihm angeheftet ([wie bei der Rechnung](rechnungen.md#vorschau)). Der Entwurf lässt sich beliebig speichern, ändern und löschen. **Entwurf als PDF** lädt ihn als PDF aus der Vorlage des festgeschriebenen Angebots, mit „ENTWURF“ über jeder Seite und statt der Nummer, ohne eine Nummer zu vergeben ([wie bei der Rechnung](rechnungen.md#entwurf-als-pdf)).

### Optionale und alternative Positionen

Wie in Lexware Office bietest du in einem Angebot Wahlmöglichkeiten an:

- **Optional** ist eine Zusatzleistung, die der Kunde dazu bestellen kann, etwa eine Schulung. Er kann keine, eine oder mehrere optionale Positionen nehmen.
- Eine **Alternative** ist eine andere Variante der Position direkt darüber, ihrer Hauptposition, etwa „Website mit Shop“ statt „Website“. Unter einer Hauptposition können mehrere Alternativen stehen; der Kunde nimmt genau eine Variante.

Beide zählen nicht zur Angebotssumme, auch nicht für Gesamtrabatt und Zahlungsplan. Im PDF stehen sie mit Preis und dem Hinweis „Optional, nicht in der Angebotssumme“ bzw. „Alternative zu Pos. 1, nicht in der Angebotssumme“. Mindestens eine Position muss zur Summe zählen, und eine Alternative braucht ihre Hauptposition direkt darüber.

Auf dem festgeschriebenen Angebot hältst du unter **Auswahl des Kunden** fest, was er nimmt: optionale Positionen per Haken, je Hauptposition eine Variante. Die Auswahl gilt mit **Angenommen**, **Rechnung erstellen**, den Abschlägen und **Auswahl speichern**. Rechnung, Abschläge, Zahlungsplan, Auftragsbestätigung und Lieferschein übernehmen nur die gewählten Positionen, als normale Positionen; ohne Auswahl die Hauptpositionen. Sobald eine Rechnung zum Angebot festgeschrieben ist, ist die Auswahl fest (auch in der Datenbank); nach dem Storno dieser Rechnung lässt sie sich wieder ändern.

### Zahlungsplan

Bei größeren Aufträgen legst du im Abschnitt **Zahlungsplan** fest, in welchen Teilen abgerechnet wird, z. B.:

| Nr. | Bezeichnung | Anteil | Fällig bei |
| --- | --- | --- | --- |
| 1 | Anzahlung | 30 % | Auftragserteilung |
| 2 | Abschlag | 40 % | Lieferung |
| 3 | Schlussrechnung | Rest | Abnahme |

- Je Zahlung ein **Prozentsatz** des Angebotsbetrags oder ein **fester Betrag**. Der Betrag gilt im Preismodus des Angebots, bei Bruttopreisen also brutto.
- Die letzte Zahlung ist immer der **Rest**; ihn rechnet die Schlussrechnung ab.
- Die **Fälligkeit** ist Text, etwa „Lieferung“; ein Datum schlägt Haben daraus nicht vor.
- Haben zeigt je Zahlung Netto und Brutto und prüft, dass der Plan den Angebotsbetrag nicht übersteigt.
- **Vorlage übernehmen** setzt einen Plan aus den [Vorlagen](einrichtung.md#vorlagen-für-den-zahlungsplan) ein, ab Werk 30/40/30 und 50/50.
- Der Plan steht im Angebots-PDF unter den Summen; mit **Zahlungsplan auch in der Auftragsbestätigung** auch dort.

**Mehrere Steuersätze:** Jede Zahlung teilt sich anteilig je Steuersatz auf. Ein Prozentsatz gilt für jeden Satz gleich, ein fester Betrag im Verhältnis der Nettobeträge je Satz; den Rundungsrest trägt der größte Satz. Bei einem Angebot über 7.000 € zu 19 % und 3.000 € zu 7 % ergeben 30 % also 2.100 € und 900 €, ein fester Abschlag von 2.000 € 1.400 € und 600 €.

### Anhänge

Mit einem Angebot gehen oft weitere Unterlagen mit: AGB, Widerrufsbelehrung, eine Leistungsbeschreibung oder eine auftragsspezifische Vereinbarung. Solche PDF-Dateien hängst du im Entwurf an das Angebot; beim Versand per E-Mail wählst du, welche mitgehen. Anhängen und Entfernen gehen genau wie [an einer Rechnung](rechnungen.md#zusätzliche-anhänge).

Was mit fast jedem Angebot mitgeht, etwa AGB oder Widerrufsbelehrung, hinterlegst du einmal als [Standardanhang](einrichtung.md#standardanhänge-für-angebote): Jedes neue Angebot hat diese Dateien dann schon beim ersten Speichern unter **Anhänge**, beim Senden sind sie vorausgewählt, und im Entwurf nimmst du heraus, was für dieses Angebot nicht passt. Sie hängen nur an Angeboten, die du danach neu anlegst: Ein schon bestehender Entwurf bekommt sie nicht; dort hängst du sie bei Bedarf selbst an.

Es gelten dieselben Regeln wie bei Rechnungen, mit höchstens zehn Dateien je Angebot. Hängt dieselbe Datei an mehreren Angeboten oder Rechnungen, liegt sie nur einmal im Belegverzeichnis.

Mit dem Festschreiben sind die Anhänge zusammen mit dem Angebot gesperrt: Die Datenbank lehnt Hinzufügen, Ändern und Entfernen ab. Auf der Seite des festgeschriebenen Angebots stehen sie weiter unter **Anhänge** zum Ansehen und Herunterladen. Das PDF des Angebots bleibt, wie es ist; die Anhänge gehen nur als eigene Dateien in der E-Mail mit. In die Rechnung aus dem Angebot gehen sie nicht über.

**Festschreiben** vergibt die Nummer und erzeugt das PDF:

- Angebote haben einen eigenen Nummernkreis: ab Werk `AN-2026-001`, `AN-2026-002` und so weiter, je Jahr neu oder auf Wunsch durchlaufend. Das Format lässt sich ändern, siehe [Nummernformat](einrichtung.md#nummernformat).
- Das PDF hat dasselbe Layout wie die Rechnung, mit Angebotsnummer, Gültigkeit und dem Satz „Dieses Angebot gilt bis zum …“.
- Ein E-Rechnungs-XML gibt es für Angebote nicht.

Gebucht wird nichts: Ein Angebot ist kein Geschäftsvorfall.

Ein festgeschriebenes Angebot ändert sich nicht mehr, so wie eine Rechnung. Für eine geänderte Fassung legt **Kopieren** einen neuen Entwurf an, mit Kunde, Einleitung, Positionen (samt Art und Rabatt), Hinweis, Bestell-, Auftrags- und Lieferscheinnummer, Umsatzsteuer, Preismodus, Sprache, Gesamtrabatt, Zahlungsplan und [Anhängen](#anhänge); im neuen Entwurf lassen sich die Anhänge wieder ändern. Datum und Gültigkeit sind dabei neu, die Dauer der Gültigkeit bleibt gleich; der Leistungszeitraum bleibt leer.

## Per E-Mail senden

**Angebot senden** schickt das PDF über deinen [E-Mail-Zugang](einrichtung.md):

- Empfänger, Betreff und Text sind vorbelegt und lassen sich ändern. Betreff und Text kommen aus der Vorlage Angebot (siehe [Vorlagen](rechnungen.md#per-e-mail-versenden)).
- Hat das Angebot [Anhänge](#anhänge), stehen sie unter **Zusätzliche Anhänge mitsenden**, alle angehakt. Was nicht mitgehen soll, hakst du ab; sie kommen nach dem PDF des Angebots in die E-Mail.
- Auf Wunsch geht eine Blindkopie an dich.
- Jeder Versand steht beim Angebot mit Empfänger und den Dateinamen der tatsächlich versandten Anhänge, in der Liste markiert ✉ versendete Angebote.

Für Kunden mit Sprache Englisch sind Angebot und E-Mail englisch, siehe [Rechnungen auf Englisch](rechnungen.md#rechnungen-auf-englisch).

## Antwort und Rechnung

Auf der Seite des Angebots hältst du die Antwort des Kunden fest:

| Status | Bedeutung |
| --- | --- |
| Entwurf | noch nicht festgeschrieben |
| Offen | festgeschrieben, Gültigkeit läuft |
| Abgelaufen | keine Antwort und „Gültig bis“ ist vorbei |
| Angenommen | als angenommen markiert |
| Abgelehnt | als abgelehnt markiert |
| Abgerechnet | aus dem Angebot ist eine Rechnung entstanden |

**Rechnung erstellen** legt einen Rechnungsentwurf an und markiert das Angebot als angenommen. Der Entwurf übernimmt:

- Kunde, Einleitung, Positionen mit ihrem Text, Leistungszeitraum und Umsatzsteuer aus dem Angebot,
- Bestell- und Lieferscheinnummer aus dem Angebot, als eigene Auftragsnummer (in der E-Rechnung BT-14) die des Angebots, sonst die Angebotsnummer,
- Datum heute,
- Zahlungsziel aus den Firmendaten, Skonto wie bei einer neuen Rechnung (vom Kunden, sonst aus den Firmendaten),
- E-Rechnungsformat des Kunden bzw. das Standardformat,
- den Hinweis „Gemäß unserem Angebot AN-2026-001 vom …“.

Vor dem Festschreiben passt du den Entwurf an, etwa die tatsächlich geleisteten Stunden. Die Rechnung zeigt das Angebot, aus dem sie stammt.

Jedes Angebot lässt sich nur einmal abrechnen. Löschst du den Rechnungsentwurf, kannst du das Angebot wieder abrechnen. Ein abgelehntes Angebot rechnet Haben nicht ab; mit **Antwort zurücknehmen** setzt du es wieder auf offen.

### In Abschlägen abrechnen

Bei größeren Aufträgen rechnest du das Angebot in Teilen ab (siehe [Abschlags- und Schlussrechnung](rechnungen.md#abschlags--und-schlussrechnung)):

- **Mit Zahlungsplan** steht auf dem Angebot die Übersicht **Zahlungsplan**: je Zahlung Plan (netto und brutto), die Rechnung dazu mit Link und Betrag und der Status **Offen**, **Entwurf**, **Festgeschrieben** oder **Bezahlt**. **Abschlagsrechnung erstellen** legt zu einer Zahlung den Entwurf an, mit Kunde, Preismodus und Umsatzsteuer aus dem Angebot und je Steuersatz einer Position wie „2. Abschlag 40 % gemäß Angebot AN-2026-004 vom 01.10.2026“, den Betrag anteilig aus dem Auftrag nach der Auswahl des Kunden. Den Betrag kannst du im Entwurf noch ändern; die Übersicht zeigt dann Plan und Ist. Je Zahlung gibt es eine Abschlagsrechnung; nach ihrem Storno oder dem Löschen des Entwurfs wieder eine neue. Beim Rest steht **Schlussrechnung erstellen**. Darunter der Fortschritt: „Abgerechnet 7.000,00 € von 10.000,00 € (70 %), offen 3.000,00 €“, gerechnet aus den festgeschriebenen, nicht stornierten Rechnungen zum Angebot.
- **Ohne Zahlungsplan** legt **Abschlagsrechnung erstellen** einen Entwurf mit Rechnungsart „Abschlagsrechnung“ an, mit Kunde, Umsatzsteuer und Preismodus aus dem Angebot und einer Position „Abschlag gemäß Angebot AN-2026-004 vom …“. Den Betrag trägst du selbst ein, z. B. 30 % der Angebotssumme. Das Angebot gilt als angenommen, bleibt aber offen für weitere Abschläge.
- **Schlussrechnung erstellen** erscheint, sobald ein Abschlag festgeschrieben ist. Der Entwurf übernimmt alle Positionen des Angebots und zieht die festgeschriebenen Abschläge **dieses** Angebots ab, nicht die anderer Aufträge desselben Kunden. Erst die Schlussrechnung rechnet das Angebot ab.
- Unter **Rechnungen zu diesem Angebot** stehen alle Abschläge, die Schlussrechnung bzw. die Rechnung aus dem Angebot mit Datum, Betrag und Status, darunter wie viel schon in Abschlägen abgerechnet ist.

## Auftragsbestätigung und Lieferschein

Bei einem angenommenen Angebot stehen unter **Antwort des Kunden** zwei weitere PDFs:

- **Auftragsbestätigung:** dieselben Positionen, Preise und Rabatte wie im Angebot, nach der Auswahl des Kunden bei optionalen und alternativen Positionen, datiert auf den Tag der Annahme, mit Bezug auf das Angebot, Bestell-, Auftrags- und Lieferscheinnummer und der Auftragssumme; auf Wunsch mit dem Zahlungsplan, gerechnet auf die Auftragssumme.
- **Lieferschein:** die gewählten Positionen mit Menge und Text zur Position, ohne Preise, mit Bestell- und Auftragsnummer, mit einem Feld für die Empfangsbestätigung des Kunden. Als Lieferdatum gilt das Ende des Leistungszeitraums, sonst der Tag der Annahme.

Beide entstehen bei jedem Abruf neu aus dem festgeschriebenen Angebot und buchen nichts. Positionen und Beträge bleiben gleich, solange die Antwort „angenommen“ bleibt; die Sprache folgt dem Angebot. Gestaltung, Layout und die Pflichtangaben aus den Firmendaten kommen dagegen aus dem aktuellen Stand der Einstellungen, ändern sie sich, sieht auch ein erneut abgerufenes PDF anders aus (siehe [Pflichtangaben einer GmbH oder UG](rechnungen.md#pflichtangaben-einer-gmbh-oder-ug)). Einen Lieferschein gibt es auch zu jeder festgeschriebenen Rechnung, nicht zu Storno und Korrektur (Schaltfläche **Lieferschein** auf der Rechnung).

## Aufbewahrung

Angebote sind Handelsbriefe (§ 257 HGB, § 147 AO) und werden sechs Jahre aufbewahrt.

- In der Datenbank sind sie nach dem Festschreiben gesperrt, mit Rabatten, Art der Positionen, Zahlungsplan und Anhängen. Ein Trigger lässt nur noch die Antwort des Kunden und den Verweis auf die Rechnung zu. Die Auswahl des Kunden steht in einer eigenen Tabelle mit Änderungsprotokoll und ist fest, sobald eine Rechnung zum Angebot festgeschrieben ist.
- Im [Jahresarchiv](auswertungen.md#jahresexport) liegen sie unter `angebote/`: die PDFs plus `angebote.csv` mit Beträgen, Antwort, Rechnungsnummer und SHA-256, die Anhänge unter `angebote/anhaenge/` mit `anhaenge.csv`.
