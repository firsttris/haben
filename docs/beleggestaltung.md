---
title: "Beleggestaltung in Haben: Logo, Farbe, Briefpapier und Layouts"
description: >-
  Wie Rechnungen, Angebote und Mahnungen aussehen: Logo, Akzentfarbe, Schrift, Briefpapier,
  Fußzeile und die eingebauten Layouts mit ihren Optionen.
---

# Beleggestaltung

Wie Rechnungen, Angebote, Auftragsbestätigungen, Lieferscheine und Mahnungen aussehen: Logo, Farbe, Schrift, Briefpapier, Fußzeile und Layout. Alles hier gilt für das, was ab dann erzeugt wird, auch für Mahnung, Auftragsbestätigung und Lieferschein zu älteren Belegen; schon festgeschriebene PDFs bleiben unverändert.

## Logo

Unter **Einstellungen › Beleggestaltung › Logo und Blatt** oder über das Zahnrad in der [Vorschau](rechnungen.md#vorschau) lädst du dein Logo hoch, als PNG (gern mit transparentem Hintergrund) oder JPEG bis 1 MB.

- Es steht oben im Briefkopf von Rechnungen, Angeboten und Mahnungen, ohne Verzerrung; Größe und Stelle legst du unter [Logo und Blatt](#logo-und-blatt) fest. Es wird sofort gespeichert; **Entfernen** fragt vorher nach.
- Die Vorschau bei Rechnung, Angebot und Mahnung zeigt es ebenfalls.
- Im Änderungsprotokoll steht, wann sich das Logo geändert hat, mit SHA-256, aber ohne die Bilddaten.

## Akzentfarbe

Unter **Einstellungen › Beleggestaltung › Akzentfarbe** stellst du die Farbe der Spaltenköpfe und Linien ein, etwa passend zu deinem Logo. Ab Werk ist **Farbe des Layouts** an: Das [Layout](#layouts) bestimmt die Farbe, Atelier ein Gold, alle anderen das Grün `#1F6F5C`. Übernimmst du eine eigene Farbe, gilt sie für alle Layouts, bis du **Farbe des Layouts** wieder einschaltest.

- Text, Adressen, Beschriftungen, Positionen, dünne Linien und Fußzeile stehen in Grautönen, die Haben aus der Akzentfarbe ableitet: gleiche Helligkeit wie ab Werk, aber mit ihrem Farbton. Bei Blau sind sie leicht bläulich, bei einer grauen Akzentfarbe neutral grau; mit dem Standardgrün bleibt alles wie bisher.
- Du wählst sie mit dem Farbfeld oder trägst sie als Hex-Wert in der Form `#RRGGBB` ein; **Auf Standard zurücksetzen** stellt das Grün wieder her und schaltet wie jede eigene Farbe **Farbe des Layouts** aus.
- Die Vorschau im Editor zeigt sie ebenfalls.
- Ist eine eigene Farbe auf weißem Papier schwer zu lesen (Kontrast unter 4,5 : 1 nach WCAG), weist Haben darauf hin. Speichern geht trotzdem; eine dunklere Variante des Logo-Farbtons liest sich besser.
- Die Änderung steht im Änderungsprotokoll.

## Logo und Blatt

Unter **Einstellungen › Beleggestaltung › Logo und Blatt** oder über das Zahnrad in der [Vorschau](rechnungen.md#vorschau) legst du fest, wie das Blatt aussieht.

| Einstellung | Bedeutung |
| --- | --- |
| Schrift | **Wie im Layout** (ab Werk; jedes Layout bringt seine Schrift mit), IBM Plex Sans, IBM Plex Serif, Source Sans 3, Figtree, Fira Sans, Inter, Libre Franklin, Literata, Lora oder Nunito Sans; im PDF eingebettet, wie PDF/A es verlangt |
| Logo S, M, L | Höchstens 12 × 40 mm, 18 × 60 mm (ab Werk) oder 24 × 80 mm; auch L endet über dem Anschriftfeld |
| Logo links, Mitte, rechts | Stelle im Briefkopf; „Mitte“ steht mittig auf dem Blatt. Elegant mit Fuß in der Randspalte kennt keine Mitte und setzt das Logo dann rechts; in der Vorschau ist „Mitte“ dort aus. Ein eigenes Layout, das nur `look.logoLeft` kennt, setzt es bei „Mitte“ rechts |
| Falz- und Lochmarken | Striche am linken Rand für den Fensterumschlag nach DIN 5008 |
| GiroCode | QR-Code für die Überweisung, auf Rechnung und Mahnung |
| Kundennummer | Nur auf dem Blatt; das XML der E-Rechnung nennt sie weiter |
| Artikelnummer | Spalte „Art.-Nr.“, sobald eine Position eine Nummer hat; nur auf dem Blatt, das XML der E-Rechnung nennt sie weiter |
| Spalte USt je Position | Entfällt nur, wenn alle Positionen denselben Steuersatz haben; bei mehreren Sätzen bleibt sie stehen |

Pflichtangaben und Summen lassen sich hier nicht ausblenden; zur Fußzeile auf dem Briefpapier siehe [Briefpapier](#briefpapier).

## Briefpapier

Unter **Einstellungen › Beleggestaltung › Briefpapier** legst du ein Bild hinter den Beleg, etwa deinen gedruckten Briefbogen als Scan.

- Es geht PNG, JPEG oder PDF bis 2 MB, am besten im Format A4 hochkant mit mindestens 1240 × 1754 Pixeln. Ein abweichendes Seitenverhältnis wird beschnitten, damit die Seite voll bedeckt ist.
- Von einem PDF nimmt Haben die erste Seite und wandelt sie mit 200 dpi in ein Bild um, denn die Belege sind PDF/A-3 und können kein PDF einbetten. Beschädigte Dateien und Bilder im Farbraum CMYK lehnt Haben ab, weil sich aus ihnen kein PDF/A erzeugen lässt; speichere sie als RGB.
- **Erste Seite** (ab Werk) oder **Alle Seiten** legt fest, wo es erscheint. Die Vorschau zeigt es genauso, auf jeder Seite des Belegs.
- Logo und Falzmarken liegen über dem Bild. Hat dein Briefbogen schon ein Logo, entferne das hochgeladene.
- Trägt dein Briefbogen auch den Fuß, schalte **Fußzeile steht auf dem Briefpapier** ein. Haben fragt nach, denn dann druckt es nur noch die Seitenzahl: Steuernummer oder USt-IdNr. muss auf dem Briefpapier stehen (§ 14 Abs. 4 Nr. 2 UStG), bei Reverse Charge und innergemeinschaftlicher Lieferung die USt-IdNr. (§ 14a UStG), bei GmbH und UG auch die Angaben nach § 35a GmbHG. Prüfen kann Haben das im Bild nicht. Entfernst du das Briefpapier (nach einer Rückfrage), druckt Haben die Fußzeile wieder.
- Im Änderungsprotokoll steht, wann es sich geändert hat, mit SHA-256, aber ohne die Bilddaten.

## Fußzeile

Unter **Einstellungen › Beleggestaltung › Fußzeile** schaltest du von der automatischen Fußzeile auf eigene Spalten um. Ab Werk setzt Haben sie aus den Firmendaten zusammen: Kontakt, Bank, Steuernummern.

- Du wählst zwei bis vier Spalten mit je höchstens fünf Zeilen und schreibst freien Text mit Platzhaltern: `{firma}`, `{strasse}`, `{plz}`, `{ort}`, `{email}`, `{telefon}`, `{bank}`, `{kontoinhaber}`, `{iban}`, `{bic}`, `{steuernummer}`, `{ustid}`. Unten in der Karte siehst du, wie sie auf dem Blatt steht.
- Text lässt sich auszeichnen wie in den Belegtexten: markieren und **F**, **K** oder **U** wählen, oder die Zeichen tippen (`*fett*`, `_kursiv_`, `__unterstrichen__`). Das gilt für deinen Text, auch um Platzhalter herum; Zeichen aus den Firmendaten bleiben wörtlich.
- Fehlt der Wert zu einem Platzhalter, entfällt die ganze Zeile: Ohne Telefonnummer erscheint keine Zeile „Telefon“.
- Steuernummer oder USt-IdNr. muss auf der Rechnung stehen (§ 14 Abs. 4 Nr. 2 UStG). Haben speichert die Fußzeile nur, wenn `{steuernummer}` oder `{ustid}` vorkommt. Die Pflichtangaben einer GmbH oder UG stehen weiter darunter.
- Hat deine Firma die genannte Nummer nicht, setzt Haben die vorhandene ans Ende der letzten Spalte. Bei Reverse Charge und innergemeinschaftlicher Lieferung steht die USt-IdNr. immer auf der Rechnung (§ 14a UStG).
- Bricht eine Zeile um oder sind die Spalten hoch, wächst der untere Rand mit; es steht dann weniger Inhalt auf der Seite.
- Dein Text wird nicht übersetzt: Auf englischen Belegen steht er so, wie du ihn schreibst.

## Layouts

Unter **Einstellungen › Beleggestaltung › Layouts** wählst du ein Layout für alle Belegarten: ein eingebautes oder ein eigenes, das du hochgeladen hast. Unter **Je Belegart abweichend wählen** bekommt eine Belegart ein anderes, etwa das Angebot; weicht eine ab, steht die Tabelle offen und oben „Je Belegart verschieden“. Ein eigenes Layout ist entweder für Belege oder für Mahnungen; wählst du es für alle, behält die übrige Art ihr Layout. Wie man ein Layout schreibt, was Haben beim Hochladen prüft und wie Pakete freigegeben werden, steht unter [Eigene Belegvorlagen](belegvorlagen.md).

| Layout | Optionen |
| --- | --- |
| Klar (ab Werk) | Fassung Standard oder Klassisch (das bisherige Layout von Haben); in der Fassung Standard Kerndaten mit Linie oder auf einer Karte |
| Modern | Akzentfarbe farbig oder sparsam; Linie über dem Fuß (ab Werk ohne) |
| Strukturiert | Infoblock als Tabelle oder im Kasten |
| Elegant | Fuß in der Randspalte (ab Werk) oder unten; Kerndaten als Liste oder zweispaltig (nur mit Fuß unten) |
| Atelier | Fuß unten (ab Werk) oder in der Randspalte; Kerndaten als Liste oder zweispaltig (nur mit Fuß unten). Steht das Logo links, steht der Name rechts daneben; mit Fuß unten steht die Linie unter dem Kopf bei jeder Logogröße gleich hoch |

- Die Optionen stehen unter der Zuordnung, je eingebautem Layout einmal; sie gelten für jede Belegart mit diesem Layout. Ein Wert, den eine andere Option ausschließt, ist ausgegraut.
- In der [Vorschau](rechnungen.md#vorschau) zeigt das Zahnrad das Layout der Belegart mit seinen Optionen; eine Änderung dort siehst du sofort und speicherst sie mit **Gestaltung speichern**.
- Bestehende Installationen behalten beim Update ihr Layout: Klar in der Fassung Klassisch, ihre Schrift und ihre Akzentfarbe. Neu in Klassisch: Der Infoblock steht auf Höhe der Absenderzeile (58 mm) und auf der Fluchtlinie der Tabelle, weitere Referenzen stehen vor dem Betreff, und das Leistungsdatum steht als Datum.

Verwendet ein eigenes Layout eine Einstellung der Gestaltung nicht, etwa den GiroCode oder die Falz- und Lochmarken, steht darunter ein Hinweis mit dem Namen des Layouts. Wirkt die Einstellung auf keinen Beleg mehr, ist sie aus; siehe [Einstellungen, die das Layout nicht verwendet](belegvorlagen.md#hochladen-und-zuordnen).
