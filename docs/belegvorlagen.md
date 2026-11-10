---
title: "Eigene Belegvorlagen: Layouts in Typst"
description: >-
  Eigene Layouts für Rechnung, Angebot, Lieferschein und Mahnung in Typst: welche Daten Haben der Vorlage übergibt,
  welche Schriften gehen, was beim Hochladen geprüft wird und warum alte Layouts nicht brechen.
---

# Eigene Belegvorlagen

Haben setzt Belege mit Typst aus einer Vorlage. Neben dem eingebauten Layout kannst du eigene hochladen und je Belegart zuordnen. Die Vorlage bekommt die Daten des Belegs fertig formatiert, sie rechnet nichts; das PDF/A-3 und die eingebettete E-Rechnung erzeugt Haben selbst.

## Mit einem KI-Agenten

Die Anleitung für Agenten gibt es als Skill, der ohne das Repository von Haben auskommt: alle Felder, Schriften, Pflichtangaben und Prüfungen stehen darin. Haben bietet ihn unter **Einstellungen › Beleggestaltung › Layouts** als „Anleitung für KI-Agenten“ zum Herunterladen an, dazu die eingebauten Layouts als Grundlage (eine Datei je Art, ohne Importe), Beispieldaten und den Feldvertrag als JSON Schema. Im Repository liegt er unter `.claude/skills/belegvorlage/SKILL.md`.

## Hochladen und zuordnen

Unter **Einstellungen › Beleggestaltung › Layouts**:

- **Hochladen:** Name, Art (Belege oder Mahnung) und die `.typ`-Datei, bis 256 KB. Haben setzt das Layout mit jedem Beispiel seiner Art, darunter Entwurf, Bruttopreise mit 40 Positionen, Fremdwährung, Kleinunternehmer, Storno und Lieferschein, und liest das PDF. Fehlt eine Pflichtangabe (Absender, Empfänger, Nummer und Daten, Positionen, Summen mit Umsatzsteuer, Hinweis ohne Steuerausweis, Steuernummer oder USt-IdNr., bei GmbH und UG die Angaben nach § 35a GmbHG) oder auf einer Seite der Vermerk „ENTWURF“, oder braucht ein Lauf länger als 5 Sekunden, wird nichts gespeichert und die Meldung nennt den Grund.
- **Grenzen des Betreibers:** Mit `HABEN_LAYOUTS_MAX` (Anzahl) und `HABEN_LAYOUTS_MAX_MB` (Speicher samt Paketen) begrenzt der Betreiber die eigenen Layouts, ohne Angabe gilt keine Grenze ([Installation](installation.md)). Ist sie erreicht, lehnt Haben das Hochladen mit dem Grund ab.
- **Zuordnen:** Je Belegart wählst du das eingebaute oder ein eigenes Layout. Storno und Korrektur folgen der Rechnung, Mahnungen brauchen ein Layout der Art Mahnung. Das gilt für alles, was ab dann erzeugt wird, auch für Entwürfe und die Vorschau; festgeschriebene Belege behalten ihr PDF.
- **Ersetzen, umbenennen, löschen:** Ersetzen prüft wie das Hochladen. Nach dem Löschen gilt dort, wo das Layout zugeordnet war, wieder das eingebaute.
- **Fehler beim Erzeugen:** Lässt sich ein zugeordnetes Layout nicht setzen, etwa nach einem Update von Typst, meldet Haben das mit dem Namen des Layouts. Es fällt nicht still auf das eingebaute zurück; wähle dann ein anderes Layout.

### Pakete

Ein Layout darf Typst-Pakete aus `@preview` mit fester Version importieren, nur nach Freigabe:

- Beim Hochladen nennt Haben jedes Paket mit Version und fragt nach. Erst nach der Bestätigung lädt es genau diese Pakete einmal in einen eigenen Ordner des Layouts (`DOCUMENTS_DIR/vorlagen/<id>/pakete`, im Backup). Ein Layout sieht die Pakete eines anderen nicht.
- Gesetzt wird immer ohne Netz. Das Festschreiben hängt so nie an einem fremden Server.
- Ändert sich der Quelltext, fragt Haben erneut, auch für eine neue Version eines Pakets.
- Fehlen die Pakete, etwa nach einer Wiederherstellung der Datenbank ohne das Volume, zeigt die Liste das an. Nachgeladen wird nur, wenn du **Pakete neu laden** klickst; bis dahin lässt sich mit dem Layout nichts erzeugen.

Typst lädt Pakete beim Kompilieren; den Download macht deshalb ein eigener Prozess, der nur die freigegebenen Importe kompiliert, nicht das Layout.

## Sicherheit

Ein Layout ist Code, den Haben auf dem Server ausführt; hochladen kann nur, wer Inhaber ist. Gesetzt wird in einem eigenen Prozess: ohne die Umgebung der App (keine Datenbank, keine Schlüssel), ohne Netz, mit einem eigenen, sonst leeren Ordner als Projektwurzel und nach 5 Sekunden hart beendet. Typst liest keine Datei außerhalb dieses Ordners. Bei jedem Update des Typst-Compilers prüft `render-client.test.ts` diese Grenzen erneut.

## Abwärtskompatibilität

Ein eigenes Layout soll mit jeder neuen Version von Haben weiter funktionieren. Deshalb gilt für die Felder, die eine Vorlage bekommt (Feldvertrag):

- **Version je Layout:** Ein Layout gehört zu einer Version des Feldvertrags (heute Version 1); Haben merkt sich die Version beim Hochladen.
- **Nur Ergänzen:** Neue Felder kommen dazu. Ein Feld fällt nicht weg, wird nicht umbenannt, wechselt nicht den Typ und bleibt da, wenn es immer da war. Ein Test vergleicht dazu mit dem eingefrorenen Stand jeder Version.
- **Alte Layouts als Testfälle:** Unter `packages/einvoice/templates/kompatibel/` liegen Vorlagen je Version. Sie müssen mit den heutigen Daten weiter ein PDF ergeben; das fängt auch Updates von Typst ab.
- **Bruch nur mit neuer Version:** Lässt sich ein Bruch nicht vermeiden, gibt es eine neue Version, und Layouts der alten bekommen ihre Daten über einen Adapter weiter im alten Format.

Für Beiträge: Jedes neue Feld bekommt im Feldvertrag (`packages/einvoice/src/layout-schema.ts`) eine Beschreibung, danach schreibt `bun scripts/feldvertrag/schreiben.ts` Skill und Feldtabellen neu (siehe [Entwicklung](entwicklung.md#konventionen)).

## Felder

Feldvertrag Version 1. Ein Feld mit „Immer da: nein“ kann fehlen; in Typst mit `d.at("feld", default: none)` lesen.

<!-- feldvertrag:anfang (bun scripts/feldvertrag/schreiben.ts) -->

### Beleg: Rechnung, Storno, Korrektur, Angebot, Auftragsbestätigung, Lieferschein

| Feld | Typ | Immer da | Bedeutung |
| --- | --- | --- | --- |
| `docTitle` | `string` | ja | Titel des PDF-Dokuments, z. B. „Rechnung 2026-001“ |
| `author` | `string` | ja | Verfasser im PDF, der Firmenname |
| `title` | `string` | ja | Überschrift auf dem Blatt, z. B. „Rechnung“ oder „Angebot“ |
| `reference` | `null \| string` | ja | Bezugszeile unter der Überschrift, etwa auf die stornierte Rechnung |
| `senderLine` | `string` | ja | Kleine Absenderzeile über dem Anschriftfeld |
| `recipient` | `string[]` | ja | Anschrift des Empfängers, eine Zeile je Eintrag |
| `meta` | `object[]` | ja | Angaben rechts neben der Anschrift: Nummer, Datum, Leistungsdatum, Kundennummer, Referenzen |
| `meta[].label` | `string` | ja | Bezeichnung, links |
| `meta[].value` | `string` | ja | Wert, rechts |
| `payment` | `null \| string` | ja | Satz zur Zahlung, etwa Fälligkeit, Skonto oder Lastschrift |
| `qr` | `null \| string` | nein | GiroCode als SVG; null oder fehlt, wenn keiner gedruckt wird |
| `footer` | `string[][]` | ja | Spalten der Fußzeile, je Spalte die Zeilen als Text |
| `footerFormatted` | `null \| object[][][]` | ja | Eigene Fußzeile mit Auszeichnungen, je Spalte und Zeile; null bei der automatischen Fußzeile |
| `footerFormatted[][][].text` | `string` | ja | Text des Abschnitts |
| `footerFormatted[][][].bold` | `boolean` | ja | fett |
| `footerFormatted[][][].italic` | `boolean` | ja | kursiv |
| `footerFormatted[][][].underline` | `boolean` | ja | unterstrichen |
| `legal` | `null \| string` | ja | Pflichtangaben einer GmbH oder UG (§ 35a GmbHG) in einer Zeile; null ohne |
| `accent` | `string` | ja | Akzentfarbe #RRGGBB |
| `palette` | `object` | ja | Grautöne #RRGGBB, aus der Akzentfarbe abgeleitet |
| `palette.ink` | `string` | ja | Text |
| `palette.muted` | `string` | ja | Beschriftungen |
| `palette.rule` | `string` | ja | Linien |
| `look` | `object` | ja | Einstellungen der Gestaltung |
| `look.logoHeight` | `number` | ja | Größte Höhe des Logos in mm |
| `look.logoWidth` | `number` | ja | Größte Breite des Logos in mm |
| `look.logoLeft` | `boolean` | ja | Logo links statt rechts |
| `look.foldMarks` | `boolean` | ja | Falz- und Lochmarken drucken |
| `look.backgroundPages` | `"erste" \| "alle"` | ja | Briefpapier nur auf der ersten oder auf allen Seiten |
| `font` | `object` | ja | Gewählte Schrift; Familien, wie Typst sie nennt |
| `font.regular` | `string` | ja | Familie für normalen Text |
| `font.medium` | `string` | ja | Familie für mittelfett |
| `font.semibold` | `string` | ja | Familie für halbfett |
| `logo` | `string` | nein | Dateiname des Logos neben der Vorlage, z. B. logo.png; fehlt ohne Logo |
| `background` | `string` | nein | Dateiname des Briefpapiers neben der Vorlage; fehlt ohne Briefpapier |
| `draft` | `string` | nein | Vermerk über jeder Seite, wenn es ein Entwurf ist, z. B. „ENTWURF“; fehlt sonst |
| `qrPlaceholder` | `null \| string` | nein | Entwurf: Text im Platzhalter an der Stelle des GiroCodes; null ohne GiroCode |
| `labels` | `object` | ja | Beschriftungen in der Sprache des Belegs |
| `labels.columns` | `object` | ja | Köpfe der Positionstabelle in der Sprache des Belegs |
| `labels.columns.pos` | `string` | ja | Kopf der Spalte Position |
| `labels.columns.itemNumber` | `string` | ja | Kopf der Spalte Artikelnummer |
| `labels.columns.description` | `string` | ja | Kopf der Spalte Bezeichnung |
| `labels.columns.quantity` | `string` | ja | Kopf der Spalte Menge |
| `labels.columns.unitPrice` | `string` | ja | Kopf der Spalte Einzelpreis |
| `labels.columns.vat` | `string` | ja | Kopf der Spalte Steuersatz |
| `labels.columns.net` | `string` | ja | Kopf der Spalte Betrag |
| `labels.page` | `string[]` | ja | Teile von „Seite x von y“, z. B. ["Seite", "von"] |
| `itemNumbers` | `boolean` | ja | Spalte Artikelnummer zeigen |
| `hideVatColumn` | `boolean` | nein | Spalte Steuersatz weglassen (ein einziger Satz, abgewählt); fehlt auf dem Lieferschein |
| `lines` | `object[]` | ja | Positionen |
| `lines[].pos` | `string` | ja | Positionsnummer |
| `lines[].itemNumber` | `string` | ja | Artikelnummer; leer ohne |
| `lines[].description` | `string` | ja | Bezeichnung |
| `lines[].detail` | `null \| string` | ja | Text zur Position ohne Auszeichnungszeichen; null ohne |
| `lines[].detailFormatted` | `null \| object[]` | ja | Text zur Position mit Auszeichnungen; null ohne |
| `lines[].detailFormatted[].text` | `string` | ja | Text des Abschnitts |
| `lines[].detailFormatted[].bold` | `boolean` | ja | fett |
| `lines[].detailFormatted[].italic` | `boolean` | ja | kursiv |
| `lines[].detailFormatted[].underline` | `boolean` | ja | unterstrichen |
| `lines[].quantity` | `string` | ja | Menge mit Einheit, z. B. „8 Std.“ |
| `lines[].unitPrice` | `string` | ja | Einzelpreis; leer auf dem Lieferschein |
| `lines[].rate` | `string` | ja | Steuersatz, z. B. „19 %“; „–“ ohne Steuerausweis, leer auf dem Lieferschein |
| `lines[].net` | `string` | ja | Betrag der Zeile, bei Bruttopreisen brutto; leer auf dem Lieferschein |
| `lines[].discount` | `null \| string` | nein | Rabatt der Position als Satz, z. B. „abzüglich 10 % Rabatt (95,00 €)“; null ohne |
| `lines[].tag` | `string` | nein | Angebot: Kennzeichen über der Bezeichnung, etwa „Optional“ oder „Alternative zu Pos. 1“ |
| `totals` | `null \| object` | ja | Summenblock; null auf dem Lieferschein |
| `totals.rows` | `object[]` | ja | Zeilen über dem Gesamtbetrag: Rabatt, Summe netto, Umsatzsteuer je Satz |
| `totals.rows[].label` | `string` | ja | Bezeichnung, links |
| `totals.rows[].value` | `string` | ja | Wert, rechts |
| `totals.gross` | `object` | ja | Gesamtbetrag |
| `totals.gross.label` | `string` | ja | Bezeichnung, links |
| `totals.gross.value` | `string` | ja | Wert, rechts |
| `totals.included` | `null \| object` | nein | Bruttopreise: enthaltenes Netto und Umsatzsteuer je Satz; null bei Nettopreisen |
| `totals.included.label` | `string` | ja | Überschrift, z. B. „darin enthalten“ |
| `totals.included.rows` | `object[]` | ja | Enthaltenes Netto und Umsatzsteuer je Satz |
| `totals.included.rows[].label` | `string` | ja | Bezeichnung, links |
| `totals.included.rows[].value` | `string` | ja | Wert, rechts |
| `totals.euroTax` | `null \| object` | nein | Fremdwährung: Umsatzsteuer in Euro (§ 14 Abs. 4 Nr. 8 UStG); null in Euro |
| `totals.euroTax.label` | `string` | ja | Überschrift mit dem Kurs |
| `totals.euroTax.rows` | `object[]` | ja | Umsatzsteuer in Euro je Satz, bei mehreren Sätzen auch gesamt |
| `totals.euroTax.rows[].label` | `string` | ja | Bezeichnung, links |
| `totals.euroTax.rows[].value` | `string` | ja | Wert, rechts |
| `taxNote` | `null \| string` | ja | Pflichthinweis ohne Steuerausweis, etwa Kleinunternehmer oder Reverse Charge; null sonst |
| `intro` | `null \| string` | nein | Einleitung über den Positionen ohne Auszeichnungszeichen; null ohne, fehlt auf dem Lieferschein |
| `introFormatted` | `null \| object[]` | nein | Einleitung mit Auszeichnungen; null ohne, fehlt auf dem Lieferschein |
| `introFormatted[].text` | `string` | ja | Text des Abschnitts |
| `introFormatted[].bold` | `boolean` | ja | fett |
| `introFormatted[].italic` | `boolean` | ja | kursiv |
| `introFormatted[].underline` | `boolean` | ja | unterstrichen |
| `note` | `null \| string` | ja | Hinweis unter den Summen ohne Auszeichnungszeichen; null ohne |
| `noteFormatted` | `null \| object[]` | ja | Hinweis mit Auszeichnungen; null ohne |
| `noteFormatted[].text` | `string` | ja | Text des Abschnitts |
| `noteFormatted[].bold` | `boolean` | ja | fett |
| `noteFormatted[].italic` | `boolean` | ja | kursiv |
| `noteFormatted[].underline` | `boolean` | ja | unterstrichen |
| `plan` | `null \| object` | nein | Angebot und Auftragsbestätigung: Zahlungsplan; null ohne |
| `plan.title` | `string` | ja | Überschrift des Zahlungsplans |
| `plan.columns` | `object` | ja | Spaltenköpfe |
| `plan.columns.label` | `string` | ja | Kopf der Spalte Bezeichnung |
| `plan.columns.due` | `string` | ja | Kopf der Spalte Fälligkeit |
| `plan.columns.share` | `string` | ja | Kopf der Spalte Anteil |
| `plan.columns.amount` | `string` | ja | Kopf der Spalte Betrag |
| `plan.rows` | `object[]` | ja | Zeilen des Plans |
| `plan.rows[].label` | `string` | ja | Bezeichnung |
| `plan.rows[].due` | `string` | ja | Fälligkeit |
| `plan.rows[].share` | `string` | ja | Anteil |
| `plan.rows[].amount` | `string` | ja | Betrag |
| `noPrices` | `boolean` | nein | Lieferschein: Positionen ohne Preise |
| `signature` | `object` | nein | Lieferschein: Feld für die Unterschrift |
| `signature.text` | `string` | ja | Satz zur Empfangsbestätigung |
| `signature.label` | `string` | ja | Beschriftung unter der Unterschriftslinie |

### Mahnung

| Feld | Typ | Immer da | Bedeutung |
| --- | --- | --- | --- |
| `docTitle` | `string` | ja | Titel des PDF-Dokuments, z. B. „Rechnung 2026-001“ |
| `author` | `string` | ja | Verfasser im PDF, der Firmenname |
| `title` | `string` | ja | Überschrift auf dem Blatt, z. B. „Rechnung“ oder „Angebot“ |
| `reference` | `null \| string` | ja | Bezugszeile unter der Überschrift, etwa auf die stornierte Rechnung |
| `senderLine` | `string` | ja | Kleine Absenderzeile über dem Anschriftfeld |
| `recipient` | `string[]` | ja | Anschrift des Empfängers, eine Zeile je Eintrag |
| `meta` | `object[]` | ja | Angaben rechts neben der Anschrift: Nummer, Datum, Leistungsdatum, Kundennummer, Referenzen |
| `meta[].label` | `string` | ja | Bezeichnung, links |
| `meta[].value` | `string` | ja | Wert, rechts |
| `payment` | `null \| string` | ja | Satz zur Zahlung, etwa Fälligkeit, Skonto oder Lastschrift |
| `qr` | `null \| string` | nein | GiroCode als SVG; null oder fehlt, wenn keiner gedruckt wird |
| `footer` | `string[][]` | ja | Spalten der Fußzeile, je Spalte die Zeilen als Text |
| `footerFormatted` | `null \| object[][][]` | ja | Eigene Fußzeile mit Auszeichnungen, je Spalte und Zeile; null bei der automatischen Fußzeile |
| `footerFormatted[][][].text` | `string` | ja | Text des Abschnitts |
| `footerFormatted[][][].bold` | `boolean` | ja | fett |
| `footerFormatted[][][].italic` | `boolean` | ja | kursiv |
| `footerFormatted[][][].underline` | `boolean` | ja | unterstrichen |
| `legal` | `null \| string` | ja | Pflichtangaben einer GmbH oder UG (§ 35a GmbHG) in einer Zeile; null ohne |
| `accent` | `string` | ja | Akzentfarbe #RRGGBB |
| `palette` | `object` | ja | Grautöne #RRGGBB, aus der Akzentfarbe abgeleitet |
| `palette.ink` | `string` | ja | Text |
| `palette.muted` | `string` | ja | Beschriftungen |
| `palette.rule` | `string` | ja | Linien |
| `look` | `object` | ja | Einstellungen der Gestaltung |
| `look.logoHeight` | `number` | ja | Größte Höhe des Logos in mm |
| `look.logoWidth` | `number` | ja | Größte Breite des Logos in mm |
| `look.logoLeft` | `boolean` | ja | Logo links statt rechts |
| `look.foldMarks` | `boolean` | ja | Falz- und Lochmarken drucken |
| `look.backgroundPages` | `"erste" \| "alle"` | ja | Briefpapier nur auf der ersten oder auf allen Seiten |
| `font` | `object` | ja | Gewählte Schrift; Familien, wie Typst sie nennt |
| `font.regular` | `string` | ja | Familie für normalen Text |
| `font.medium` | `string` | ja | Familie für mittelfett |
| `font.semibold` | `string` | ja | Familie für halbfett |
| `logo` | `string` | nein | Dateiname des Logos neben der Vorlage, z. B. logo.png; fehlt ohne Logo |
| `background` | `string` | nein | Dateiname des Briefpapiers neben der Vorlage; fehlt ohne Briefpapier |
| `draft` | `string` | nein | Vermerk über jeder Seite, wenn es ein Entwurf ist, z. B. „ENTWURF“; fehlt sonst |
| `qrPlaceholder` | `null \| string` | nein | Entwurf: Text im Platzhalter an der Stelle des GiroCodes; null ohne GiroCode |
| `salutation` | `string` | ja | Anrede |
| `intro` | `string` | ja | Einleitung ohne Auszeichnungszeichen |
| `introFormatted` | `object[]` | ja | Einleitung mit Auszeichnungen |
| `introFormatted[].text` | `string` | ja | Text des Abschnitts |
| `introFormatted[].bold` | `boolean` | ja | fett |
| `introFormatted[].italic` | `boolean` | ja | kursiv |
| `introFormatted[].underline` | `boolean` | ja | unterstrichen |
| `invoices` | `object[]` | ja | Gemahnte Rechnungen |
| `invoices[].number` | `string` | ja | Rechnungsnummer |
| `invoices[].date` | `string` | ja | Rechnungsdatum |
| `invoices[].due` | `string` | ja | Fällig seit |
| `invoices[].open` | `string` | ja | Offener Betrag |
| `rows` | `object[]` | ja | Forderung: offener Betrag, Gebühren, Pauschale, Zinsen |
| `rows[].label` | `string` | ja | Bezeichnung, links |
| `rows[].value` | `string` | ja | Wert, rechts |
| `total` | `object` | ja | Zu zahlen |
| `total.label` | `string` | ja | Bezeichnung, links |
| `total.value` | `string` | ja | Wert, rechts |
| `closing` | `string` | ja | Schlusstext ohne Auszeichnungszeichen |
| `closingFormatted` | `object[]` | ja | Schlusstext mit Auszeichnungen |
| `closingFormatted[].text` | `string` | ja | Text des Abschnitts |
| `closingFormatted[].bold` | `boolean` | ja | fett |
| `closingFormatted[].italic` | `boolean` | ja | kursiv |
| `closingFormatted[].underline` | `boolean` | ja | unterstrichen |
| `greeting` | `string` | ja | Gruß und Firmenname, mit Zeilenumbruch |

<!-- feldvertrag:ende -->
