---
title: "Suchen in Haben: Schnellsuche mit Strg+K"
description: >-
  Die Schnellsuche findet Seiten, Kontakte, Rechnungen, Belege, Bankumsätze, Buchungen und weitere
  Bereiche von jeder Seite aus, auch nach Betrag und Datum.
---

# Suchen

Die Schnellsuche findet von jeder Seite aus Seiten, Einstellungen und Einträge von Kontakten, Rechnungen und Belegen über Bankumsätze und Buchungen bis zu Meldungen und dem Umzugsarchiv.

## Öffnen

- **Tastatur:** `Strg+K` (am Mac `⌘+K`) oder `/` außerhalb von Eingabefeldern. Ist gerade ein anderer Dialog offen, öffnet sie nicht.
- **Desktop:** der Knopf **Schnellsuche** in der Navigation unter dem Firmennamen.
- **Handy:** die Lupe links neben **Menü**. Die Suche füllt dann den Bildschirm, **Abbrechen** schließt sie.

Mit `Pfeil hoch` und `runter` wählst du einen Treffer, `Enter` öffnet ihn, `Esc` schließt die Suche (weitere Kürzel unter [Barrierefreiheit und Tastatur](barrierefreiheit.md)).

## Was sie findet

Seiten erscheinen sofort, Daten ab zwei Zeichen. Je Bereich stehen bis zu fünf Treffer, eine genau passende Nummer zuerst; Gruppen aus mehreren Bereichen, etwa „Kasse und Pauschalen“, zeigen entsprechend mehr. Bei Kontakten, Rechnungen, Angeboten und Belegen öffnet **Alle anzeigen** die Liste mit demselben Suchbegriff, bei Bankumsätzen auch, wenn alle Treffer in einem Konto liegen. Den Zustand zeigt ein Treffer so wie seine Seite. Umlaute findet die Suche auch ohne Akzent oder Punkte („Muller“ findet „Müller“).

| Gruppe | Gesucht wird in | Der Treffer zeigt |
| --- | --- | --- |
| Seiten | Name der Seite und ihrer Gruppe, auch die Bereiche der Einstellungen und [eigene Seiten](eigene-seiten.md) | Gruppe in der Navigation |
| Kontakte, ohne archivierte | Name, Kunden- und Lieferantennummer, E-Mail, Ort, USt-IdNr., DATEV-Debitor und -Kreditor, Ende der IBAN ab vier Ziffern, Name und E-Mail der Ansprechpartner | Rolle, Kunden- und Lieferantennummer, Ort |
| Rechnungen | Nummer, Kunde, Bestellnummer, eigene Auftragsnummer, Betrag, Datum | Kunde, Datum, Betrag und Status mit Auskunft, etwa „seit 16 Tagen“ |
| Angebote | Nummer, Kunde, Betrag, Datum | Kunde, Datum, Betrag und Status |
| Belege | Lieferant, Rechnungsnummer, Dateiname, Betrag, Datum | Rechnungsnummer, Datum, Betrag und Status |
| Bankumsätze | Gegenseite, Verwendungszweck, Ende der IBAN ab vier Ziffern, Betrag (mit und ohne Vorzeichen), Datum | Datum, Konto, gekürzte IBAN, Betrag und Status, ohne „Vorschlag“ |
| Buchungen und Konten | Buchungstext, Datum, Kontonummer und -name (SKR03/SKR04 und eigene Konten), Betrag | Datum, Konten, Betrag und „storniert“ → Herkunft bzw. Kontenblatt |
| Wiederkehrende Vorgänge | Name, Kunde bei wiederkehrenden Rechnungen, Lieferant bei Dauerbelegen | Kunde/Lieferant, Intervall, nächster Termin und Status |
| Artikel, Textbausteine, Leistungen | Nummer und Bezeichnung der Artikel, Name und Text der Textbausteine, beide ohne archivierte; Text, Projekt, Kunde und Datum der Leistungen | Preis/Einheit, Art bzw. Kunde, Datum und Dauer |
| Anlagen und Darlehen | Name, bei Anlagen auch Anlagekonto und Notiz | Anlagekonto und Anschaffung bzw. Geber und Restschuld |
| Kasse und Pauschalen | Nummer, Text/Anlass, Art, Datum, Betrag | Nummer/Art, Datum, Betrag und „storniert“ |
| Mitarbeiter | Name und Personalnummer (nie Steuer-ID, SV-Nummer, IBAN oder Geburtsdatum) | Personalnummer und Art |
| Finanzamt und Meldungen | Zeitraum bei Voranmeldungen und ZM („03/2026“, „Q1 2026“), Bezeichnung im Postfach | je Zeitraum ein Treffer mit dem Status der Voranmeldung bzw. dem Ergebnis der letzten erfolgreichen Übermittlung der ZM, sonst des letzten Versuchs; im Postfach das Datum |
| Archiv aus dem Umzug | Nummer, Kontakt, Bemerkung, Betrag, Datum (abschaltbar unter Einstellungen › Export › Schnellsuche) | Kontakt, Datum, Betrag und „Archiv“ |

**Beträge** vergleicht die Suche mit dem Bruttobetrag bzw. dem gezahlten Betrag; ein Nettobetrag und der offene Rest einer teilweise bezahlten Rechnung finden nichts. Bei Buchungen zählt die Zeile mit dem Bruttobetrag, bei § 13b und innergemeinschaftlichem Erwerb die mit dem gezahlten Betrag, nicht die Netto- oder Steuerzeile. Mit Cent trifft sie genau: `1.234,56`, `1234,56`, `19.99` und `89,90 €`. Ein ganzer Euro wie `1190`, `1.190` oder `1190 €` findet alle Beträge dieses Euros, von 1.190,00 bis 1.190,99 €. Bei Bankumsätzen, Kasse, Archivbelegen und Buchungen zählen beide Vorzeichen. In den Listen der Rechnungen, Angebote und Belege gilt dasselbe.

**Daten** wie `14.11.2026` oder `2026-11-14` treffen das Datum in jeder Gruppe, die oben „Datum“ nennt.

## Zuletzt angesehen

Ohne Eingabe zeigt die Suche die zuletzt geöffneten Kontakte, Rechnungen, Angebote und Belege, bis zu acht, und darunter die Seiten. Gemerkt werden sie nur in deinem Browser, getrennt je Instanz und Rolle; Haben prüft beim Anzeigen erneut, ob du sie sehen darfst.

## Steuerberatung

Der [Zugang für die Steuerberatung](steuerberatung.md) findet nur, was er auch sonst lesen darf: die Seiten seiner Navigation, festgeschriebene Rechnungen, alle Belege (auch ungebuchte), Buchungen und Sachkonten. Kontakte, Angebote, Rechnungsentwürfe, Bankumsätze, Mitarbeiter und das Umzugsarchiv erscheinen nicht, auch nicht unter „Zuletzt angesehen“.
