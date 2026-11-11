---
name: "belegvorlage"
description: "Eigenes Layout für Belege von Haben in Typst schreiben oder ändern: Rechnung, Angebot, Auftragsbestätigung, Lieferschein und Mahnung. Mit allen Feldern, die Haben der Vorlage übergibt (Feldvertrag v1), den Schriften, den Pflichtangaben und dem, was Haben beim Hochladen prüft. Braucht kein Repository."
---

# Eigene Belegvorlage für Haben

Haben setzt Belege mit [Typst](https://typst.app/docs/) 0.14.2 als PDF/A-3b. Ein eigenes Layout ist eine einzelne `.typ`-Datei. Haben übergibt ihr die Daten des Belegs fertig formatiert, die Vorlage rechnet nichts: Beträge, Daten und Mengen sind Text. Die E-Rechnung (ZUGFeRD-XML) hängt Haben selbst an, eine Vorlage kann sie nicht verlieren.

## Daten lesen

```typst
#let d = json(bytes(sys.inputs.data))
```

Es gibt zwei Arten mit eigenen Feldern: **Beleg** (Rechnung, Storno, Korrektur, Angebot, Auftragsbestätigung, Lieferschein) und **Mahnung**. Beim Hochladen wählt man, wofür das Layout ist.

- Ein Feld mit „Immer da: nein“ kann fehlen. Lies es mit `d.at("feld", default: none)`, sonst bricht das Layout bei Belegen ohne dieses Feld.
- `null` heißt: auf diesem Beleg gibt es das nicht. Prüfe mit `!= none`.
- Text mit Auszeichnungen kommt zweimal: als reiner Text (`intro`) und in Abschnitten (`introFormatted`, je Abschnitt `text`, `bold`, `italic`, `underline`). Für das Blatt die Abschnitte nehmen.
- Neue Felder kommen nur dazu. Ein Layout für Version 1 bekommt auch künftig alle Felder dieser Version mit gleichem Namen und Typ.

## Schriften

Nur diese Schriften sind eingebettet; andere fehlen auf dem Server, und PDF/A verlangt eingebettete Schriften. Die in der Gestaltung gewählte steht in `d.font`:

- „IBM Plex Sans“, dazu „IBM Plex Sans Medm“ (500) und „IBM Plex Sans SmBld“ (600), normal und kursiv
- „IBM Plex Serif“, dazu „IBM Plex Serif Medm“ (500) und „IBM Plex Serif SmBld“ (600), normal und kursiv
- „Source Sans 3“, Gewichte 400, 500 und 600, normal und kursiv
- „Fira Sans“, Gewichte 400, 500 und 600, normal und kursiv
- „Figtree“, Gewichte 400, 500 und 600, normal und kursiv
- „Inter“, Gewichte 400, 500 und 600, normal und kursiv
- „Libre Franklin“, Gewichte 400, 500 und 600, normal und kursiv
- „Literata“, Gewichte 400, 500 und 600, normal und kursiv
- „Lora“, Gewichte 400, 500 und 600, normal und kursiv
- „Nunito Sans“, Gewichte 400, 500 und 600, normal und kursiv

## Dateien und Pakete

- Logo und Briefpapier liegen beim Setzen neben der Vorlage, ihre Dateinamen stehen in `d.logo` und `d.background` (fehlen ohne). Lies sie mit `image(d.logo)`, nie mit festem Namen.
- Andere Dateien gibt es nicht, und Typst liest nichts außerhalb des Ordners der Vorlage.
- Pakete (`#import "@preview/name:1.2.3"`) nur mit fester Version. Haben fragt beim Hochladen nach, lädt sie nach der Bestätigung einmal und setzt danach ohne Netz. Ohne Paket ist ein Layout einfacher zu prüfen; ein zur Laufzeit zusammengesetzter Paketname scheitert.
- Ein Lauf darf höchstens 5 Sekunden dauern, sonst bricht Haben ihn ab.

## Pflichtangaben

Vor dem Setzen sucht Haben im Quelltext jedes Feld, das in den Tabellen unten „Pflicht im Layout: ja“ hat, etwa `taxNote` für den Hinweis bei Kleinunternehmern oder Reverse Charge, `reference` für den Bezug einer Stornorechnung und `legal` für die Angaben einer GmbH. Nennt das Layout eines davon nicht, lehnt Haben es ab, auch wenn kein Beispiel das Feld füllt. Zeige jedes dieser Felder, wenn es einen Wert hat.

Danach setzt Haben das Layout mit Beispieldaten und lehnt es ab, wenn auf dem Blatt etwas davon fehlt:

- Absender mit Name und vollständiger Anschrift, also Straße sowie PLZ und Ort (`author` und `senderLine`; die Fußzeile genügt dafür nicht, denn was dort steht, legt die Gestaltung fest; § 14 Abs. 4 Nr. 1 UStG) und Empfänger (`recipient`), die Bezeichnung des Belegs (`title`, keine feste Überschrift wie „Rechnung“), bei Storno und Korrektur der Bezug auf die Rechnung (`reference`; § 31 Abs. 5 UStDV), Angaben aus `meta` (Nummer, Datum, Leistungsdatum).
- Jede Position mit Menge und Bezeichnung (`lines`), die Summen mit Umsatzsteuer und Steuersatz je Satz, etwa „Umsatzsteuer 19 %“ (`totals.rows`, bei Bruttopreisen in `totals.included`, bei Fremdwährung zusätzlich in Euro in `totals.euroTax`), der Hinweis ohne Steuerausweis (`taxNote`), bei Skonto der Zahlungssatz (`payment`; § 14 Abs. 4 Nr. 7 UStG), auf Rechnungen die Steuernummer oder die USt-IdNr. des Ausstellers, eine genügt (meist in der Fußzeile, `footer`; § 14 Abs. 4 Nr. 2 UStG; Angebot, Auftragsbestätigung, Lieferschein und Mahnung brauchen keine) und bei GmbH oder UG die Pflichtangaben aus `legal`, gern je Angabe auf eigener Zeile (Trenner „ · “; § 14 Abs. 4 UStG, § 35a GmbHG).
- Bei einem Entwurf der Vermerk aus `draft` auf jeder Seite.
- Mehrseitige Belege müssen gehen: Die Beispiele haben bis zu 40 Positionen.

Die Prüfung findet nur Offensichtliches. Für ein eigenes Layout übernimmt Haben keine Gewähr: Wer es hochlädt, ist selbst dafür verantwortlich, dass es alle Angaben richtig zeigt und die Belege den gesetzlichen Anforderungen genügen.

## Grundgerüst

```typst
#let d = json(bytes(sys.inputs.data))

#set page(paper: "a4", margin: (top: 20mm, bottom: 30mm, left: 25mm, right: 20mm),
  // Pflicht: Der Vermerk eines Entwurfs steht über jeder Seite
  foreground: if d.at("draft", default: none) != none { place(center + horizon, rotate(-30deg, text(60pt, fill: luma(200), d.draft))) },
  footer: context grid(columns: d.footer.len() * (1fr,), gutter: 6mm, ..d.footer.map(spalte => text(7pt, spalte.join("\n")))),
)
#set text(font: d.font.regular, size: 9.5pt, fill: rgb(d.palette.ink), lang: "de")

#if d.at("logo", default: none) != none { place(top + right, image(d.logo, height: d.look.logoHeight * 1mm)) }
#text(7pt, d.senderLine) \
#d.recipient.join("\n")

#for m in d.meta [ #m.label: #m.value \ ]
= #d.title
#if d.reference != none { par(d.reference) }
#table(columns: 5, [Pos.], [Bezeichnung], [Menge], [USt], [Betrag], ..d.lines.map(l => (l.pos, l.description, l.quantity, l.rate, l.net)).flatten())
#if d.totals != none {
  for r in d.totals.rows [ #r.label: #r.value \ ]
  strong[#d.totals.gross.label: #d.totals.gross.value]
  // Bruttopreise: Umsatzsteuer je Satz steht nur hier; Fremdwährung: Umsatzsteuer in Euro
  for block in (d.totals.at("included", default: none), d.totals.at("euroTax", default: none)) {
    if block != none [ \ #block.label \ #for r in block.rows [ #r.label: #r.value \ ] ]
  }
}
#if d.taxNote != none { par(d.taxNote) }
#if d.payment != none { par(d.payment) }
#if d.legal != none { text(7pt, d.legal) }
```

## Prüfen

Haben bietet unter Einstellungen › Beleggestaltung › Layouts die eingebauten Layouts als Grundlage und die Beispieldaten zum Herunterladen an. Die Beispieldaten sind eine Liste aus `name` und `data`; ein Beispiel daraus geht mit der Typst-CLI so (die Schriften oben gibt es frei unter der SIL Open Font License, etwa bei Google Fonts):

```sh
jq '.[0].data' beispieldaten-beleg.json > beispiel.json
typst compile --input data="$(cat beispiel.json)" --font-path schriften/ vorlage.typ
```

## Felder (Feldvertrag v1)

### Beleg: Rechnung, Storno, Korrektur, Angebot, Auftragsbestätigung, Lieferschein

| Feld | Typ | Immer da | Pflicht im Layout | Bedeutung |
| --- | --- | --- | --- | --- |
| `docTitle` | `string` | ja |  | Titel des PDF-Dokuments, z. B. „Rechnung 2026-001“ |
| `author` | `string` | ja |  | Verfasser im PDF, der Firmenname |
| `title` | `string` | ja | ja | Überschrift auf dem Blatt, z. B. „Rechnung“ oder „Angebot“ |
| `reference` | `null \| string` | ja | ja | Bezugszeile unter der Überschrift, etwa auf die stornierte Rechnung |
| `senderLine` | `string` | ja | ja | Kleine Absenderzeile über dem Anschriftfeld |
| `recipient` | `string[]` | ja | ja | Anschrift des Empfängers, eine Zeile je Eintrag |
| `meta` | `object[]` | ja | ja | Angaben rechts neben der Anschrift: Nummer, Datum, Leistungsdatum, Kundennummer, Referenzen |
| `meta[].label` | `string` | ja |  | Bezeichnung, links |
| `meta[].value` | `string` | ja |  | Wert, rechts |
| `payment` | `null \| string` | ja | ja | Satz zur Zahlung, etwa Fälligkeit, Skonto oder Lastschrift |
| `qr` | `null \| string` | nein |  | GiroCode als SVG; null oder fehlt, wenn keiner gedruckt wird |
| `footer` | `string[][]` | ja | ja | Spalten der Fußzeile, je Spalte die Zeilen als Text |
| `footerFormatted` | `null \| object[][][]` | ja | ja | Eigene Fußzeile mit Auszeichnungen, je Spalte und Zeile; null bei der automatischen Fußzeile |
| `footerFormatted[][][].text` | `string` | ja |  | Text des Abschnitts |
| `footerFormatted[][][].bold` | `boolean` | ja |  | fett |
| `footerFormatted[][][].italic` | `boolean` | ja |  | kursiv |
| `footerFormatted[][][].underline` | `boolean` | ja |  | unterstrichen |
| `legal` | `null \| string` | ja | ja | Pflichtangaben einer GmbH oder UG (§ 35a GmbHG) in einer Zeile; null ohne |
| `accent` | `string` | ja |  | Akzentfarbe #RRGGBB |
| `palette` | `object` | ja |  | Grautöne #RRGGBB, aus der Akzentfarbe abgeleitet |
| `palette.ink` | `string` | ja |  | Text |
| `palette.muted` | `string` | ja |  | Beschriftungen |
| `palette.rule` | `string` | ja |  | Linien |
| `look` | `object` | ja |  | Einstellungen der Gestaltung |
| `look.logoHeight` | `number` | ja |  | Größte Höhe des Logos in mm |
| `look.logoWidth` | `number` | ja |  | Größte Breite des Logos in mm |
| `look.logoLeft` | `boolean` | ja |  | Logo links statt rechts |
| `look.foldMarks` | `boolean` | ja |  | Falz- und Lochmarken drucken |
| `look.backgroundPages` | `"erste" \| "alle"` | ja |  | Briefpapier nur auf der ersten oder auf allen Seiten |
| `font` | `object` | ja |  | Gewählte Schrift; Familien, wie Typst sie nennt |
| `font.regular` | `string` | ja |  | Familie für normalen Text |
| `font.medium` | `string` | ja |  | Familie für mittelfett |
| `font.semibold` | `string` | ja |  | Familie für halbfett |
| `logo` | `string` | nein |  | Dateiname des Logos neben der Vorlage, z. B. logo.png; fehlt ohne Logo |
| `background` | `string` | nein |  | Dateiname des Briefpapiers neben der Vorlage; fehlt ohne Briefpapier |
| `draft` | `string` | nein | ja | Vermerk über jeder Seite, wenn es ein Entwurf ist, z. B. „ENTWURF“; fehlt sonst |
| `qrPlaceholder` | `null \| string` | nein |  | Entwurf: Text im Platzhalter an der Stelle des GiroCodes; null ohne GiroCode |
| `labels` | `object` | ja |  | Beschriftungen in der Sprache des Belegs |
| `labels.columns` | `object` | ja |  | Köpfe der Positionstabelle in der Sprache des Belegs |
| `labels.columns.pos` | `string` | ja |  | Kopf der Spalte Position |
| `labels.columns.itemNumber` | `string` | ja |  | Kopf der Spalte Artikelnummer |
| `labels.columns.description` | `string` | ja |  | Kopf der Spalte Bezeichnung |
| `labels.columns.quantity` | `string` | ja |  | Kopf der Spalte Menge |
| `labels.columns.unitPrice` | `string` | ja |  | Kopf der Spalte Einzelpreis |
| `labels.columns.vat` | `string` | ja |  | Kopf der Spalte Steuersatz |
| `labels.columns.net` | `string` | ja |  | Kopf der Spalte Betrag |
| `labels.page` | `string[]` | ja |  | Teile von „Seite x von y“, z. B. ["Seite", "von"] |
| `itemNumbers` | `boolean` | ja |  | Spalte Artikelnummer zeigen |
| `hideVatColumn` | `boolean` | nein |  | Spalte Steuersatz weglassen (ein einziger Satz, abgewählt); fehlt auf dem Lieferschein |
| `lines` | `object[]` | ja | ja | Positionen |
| `lines[].pos` | `string` | ja |  | Positionsnummer |
| `lines[].itemNumber` | `string` | ja |  | Artikelnummer; leer ohne |
| `lines[].description` | `string` | ja | ja | Bezeichnung |
| `lines[].detail` | `null \| string` | ja |  | Text zur Position ohne Auszeichnungszeichen; null ohne |
| `lines[].detailFormatted` | `null \| object[]` | ja |  | Text zur Position mit Auszeichnungen; null ohne |
| `lines[].detailFormatted[].text` | `string` | ja |  | Text des Abschnitts |
| `lines[].detailFormatted[].bold` | `boolean` | ja |  | fett |
| `lines[].detailFormatted[].italic` | `boolean` | ja |  | kursiv |
| `lines[].detailFormatted[].underline` | `boolean` | ja |  | unterstrichen |
| `lines[].quantity` | `string` | ja | ja | Menge mit Einheit, z. B. „8 Std.“ |
| `lines[].unitPrice` | `string` | ja |  | Einzelpreis; leer auf dem Lieferschein |
| `lines[].rate` | `string` | ja | ja | Steuersatz, z. B. „19 %“; „–“ ohne Steuerausweis, leer auf dem Lieferschein |
| `lines[].net` | `string` | ja | ja | Betrag der Zeile, bei Bruttopreisen brutto; leer auf dem Lieferschein |
| `lines[].discount` | `null \| string` | nein |  | Rabatt der Position als Satz, z. B. „abzüglich 10 % Rabatt (95,00 €)“; null ohne |
| `lines[].tag` | `string` | nein |  | Angebot: Kennzeichen über der Bezeichnung, etwa „Optional“ oder „Alternative zu Pos. 1“ |
| `totals` | `null \| object` | ja | ja | Summenblock; null auf dem Lieferschein |
| `totals.rows` | `object[]` | ja |  | Zeilen über dem Gesamtbetrag: Rabatt, Summe netto, Umsatzsteuer je Satz |
| `totals.rows[].label` | `string` | ja |  | Bezeichnung, links |
| `totals.rows[].value` | `string` | ja |  | Wert, rechts |
| `totals.gross` | `object` | ja |  | Gesamtbetrag |
| `totals.gross.label` | `string` | ja |  | Bezeichnung, links |
| `totals.gross.value` | `string` | ja |  | Wert, rechts |
| `totals.included` | `null \| object` | nein |  | Bruttopreise: enthaltenes Netto und Umsatzsteuer je Satz; null bei Nettopreisen |
| `totals.included.label` | `string` | ja |  | Überschrift, z. B. „darin enthalten“ |
| `totals.included.rows` | `object[]` | ja |  | Enthaltenes Netto und Umsatzsteuer je Satz |
| `totals.included.rows[].label` | `string` | ja |  | Bezeichnung, links |
| `totals.included.rows[].value` | `string` | ja |  | Wert, rechts |
| `totals.euroTax` | `null \| object` | nein |  | Fremdwährung: Umsatzsteuer in Euro (§ 14 Abs. 4 Nr. 8 UStG); null in Euro |
| `totals.euroTax.label` | `string` | ja |  | Überschrift mit dem Kurs |
| `totals.euroTax.rows` | `object[]` | ja |  | Umsatzsteuer in Euro je Satz, bei mehreren Sätzen auch gesamt |
| `totals.euroTax.rows[].label` | `string` | ja |  | Bezeichnung, links |
| `totals.euroTax.rows[].value` | `string` | ja |  | Wert, rechts |
| `taxNote` | `null \| string` | ja | ja | Pflichthinweis ohne Steuerausweis, etwa Kleinunternehmer oder Reverse Charge; null sonst |
| `intro` | `null \| string` | nein |  | Einleitung über den Positionen ohne Auszeichnungszeichen; null ohne, fehlt auf dem Lieferschein |
| `introFormatted` | `null \| object[]` | nein |  | Einleitung mit Auszeichnungen; null ohne, fehlt auf dem Lieferschein |
| `introFormatted[].text` | `string` | ja |  | Text des Abschnitts |
| `introFormatted[].bold` | `boolean` | ja |  | fett |
| `introFormatted[].italic` | `boolean` | ja |  | kursiv |
| `introFormatted[].underline` | `boolean` | ja |  | unterstrichen |
| `note` | `null \| string` | ja |  | Hinweis unter den Summen ohne Auszeichnungszeichen; null ohne |
| `noteFormatted` | `null \| object[]` | ja |  | Hinweis mit Auszeichnungen; null ohne |
| `noteFormatted[].text` | `string` | ja |  | Text des Abschnitts |
| `noteFormatted[].bold` | `boolean` | ja |  | fett |
| `noteFormatted[].italic` | `boolean` | ja |  | kursiv |
| `noteFormatted[].underline` | `boolean` | ja |  | unterstrichen |
| `plan` | `null \| object` | nein |  | Angebot und Auftragsbestätigung: Zahlungsplan; null ohne |
| `plan.title` | `string` | ja |  | Überschrift des Zahlungsplans |
| `plan.columns` | `object` | ja |  | Spaltenköpfe |
| `plan.columns.label` | `string` | ja |  | Kopf der Spalte Bezeichnung |
| `plan.columns.due` | `string` | ja |  | Kopf der Spalte Fälligkeit |
| `plan.columns.share` | `string` | ja |  | Kopf der Spalte Anteil |
| `plan.columns.amount` | `string` | ja |  | Kopf der Spalte Betrag |
| `plan.rows` | `object[]` | ja |  | Zeilen des Plans |
| `plan.rows[].label` | `string` | ja |  | Bezeichnung |
| `plan.rows[].due` | `string` | ja |  | Fälligkeit |
| `plan.rows[].share` | `string` | ja |  | Anteil |
| `plan.rows[].amount` | `string` | ja |  | Betrag |
| `noPrices` | `boolean` | nein |  | Lieferschein: Positionen ohne Preise |
| `signature` | `object` | nein |  | Lieferschein: Feld für die Unterschrift |
| `signature.text` | `string` | ja |  | Satz zur Empfangsbestätigung |
| `signature.label` | `string` | ja |  | Beschriftung unter der Unterschriftslinie |

### Mahnung

| Feld | Typ | Immer da | Pflicht im Layout | Bedeutung |
| --- | --- | --- | --- | --- |
| `docTitle` | `string` | ja |  | Titel des PDF-Dokuments, z. B. „Rechnung 2026-001“ |
| `author` | `string` | ja |  | Verfasser im PDF, der Firmenname |
| `title` | `string` | ja | ja | Überschrift auf dem Blatt, z. B. „Rechnung“ oder „Angebot“ |
| `reference` | `null \| string` | ja |  | Bezugszeile unter der Überschrift, etwa auf die stornierte Rechnung |
| `senderLine` | `string` | ja | ja | Kleine Absenderzeile über dem Anschriftfeld |
| `recipient` | `string[]` | ja | ja | Anschrift des Empfängers, eine Zeile je Eintrag |
| `meta` | `object[]` | ja | ja | Angaben rechts neben der Anschrift: Nummer, Datum, Leistungsdatum, Kundennummer, Referenzen |
| `meta[].label` | `string` | ja |  | Bezeichnung, links |
| `meta[].value` | `string` | ja |  | Wert, rechts |
| `payment` | `null \| string` | ja |  | Satz zur Zahlung, etwa Fälligkeit, Skonto oder Lastschrift |
| `qr` | `null \| string` | nein |  | GiroCode als SVG; null oder fehlt, wenn keiner gedruckt wird |
| `footer` | `string[][]` | ja | ja | Spalten der Fußzeile, je Spalte die Zeilen als Text |
| `footerFormatted` | `null \| object[][][]` | ja | ja | Eigene Fußzeile mit Auszeichnungen, je Spalte und Zeile; null bei der automatischen Fußzeile |
| `footerFormatted[][][].text` | `string` | ja |  | Text des Abschnitts |
| `footerFormatted[][][].bold` | `boolean` | ja |  | fett |
| `footerFormatted[][][].italic` | `boolean` | ja |  | kursiv |
| `footerFormatted[][][].underline` | `boolean` | ja |  | unterstrichen |
| `legal` | `null \| string` | ja | ja | Pflichtangaben einer GmbH oder UG (§ 35a GmbHG) in einer Zeile; null ohne |
| `accent` | `string` | ja |  | Akzentfarbe #RRGGBB |
| `palette` | `object` | ja |  | Grautöne #RRGGBB, aus der Akzentfarbe abgeleitet |
| `palette.ink` | `string` | ja |  | Text |
| `palette.muted` | `string` | ja |  | Beschriftungen |
| `palette.rule` | `string` | ja |  | Linien |
| `look` | `object` | ja |  | Einstellungen der Gestaltung |
| `look.logoHeight` | `number` | ja |  | Größte Höhe des Logos in mm |
| `look.logoWidth` | `number` | ja |  | Größte Breite des Logos in mm |
| `look.logoLeft` | `boolean` | ja |  | Logo links statt rechts |
| `look.foldMarks` | `boolean` | ja |  | Falz- und Lochmarken drucken |
| `look.backgroundPages` | `"erste" \| "alle"` | ja |  | Briefpapier nur auf der ersten oder auf allen Seiten |
| `font` | `object` | ja |  | Gewählte Schrift; Familien, wie Typst sie nennt |
| `font.regular` | `string` | ja |  | Familie für normalen Text |
| `font.medium` | `string` | ja |  | Familie für mittelfett |
| `font.semibold` | `string` | ja |  | Familie für halbfett |
| `logo` | `string` | nein |  | Dateiname des Logos neben der Vorlage, z. B. logo.png; fehlt ohne Logo |
| `background` | `string` | nein |  | Dateiname des Briefpapiers neben der Vorlage; fehlt ohne Briefpapier |
| `draft` | `string` | nein | ja | Vermerk über jeder Seite, wenn es ein Entwurf ist, z. B. „ENTWURF“; fehlt sonst |
| `qrPlaceholder` | `null \| string` | nein |  | Entwurf: Text im Platzhalter an der Stelle des GiroCodes; null ohne GiroCode |
| `salutation` | `string` | ja |  | Anrede |
| `intro` | `string` | ja | ja | Einleitung ohne Auszeichnungszeichen |
| `introFormatted` | `object[]` | ja | ja | Einleitung mit Auszeichnungen |
| `introFormatted[].text` | `string` | ja |  | Text des Abschnitts |
| `introFormatted[].bold` | `boolean` | ja |  | fett |
| `introFormatted[].italic` | `boolean` | ja |  | kursiv |
| `introFormatted[].underline` | `boolean` | ja |  | unterstrichen |
| `invoices` | `object[]` | ja | ja | Gemahnte Rechnungen |
| `invoices[].number` | `string` | ja |  | Rechnungsnummer |
| `invoices[].date` | `string` | ja |  | Rechnungsdatum |
| `invoices[].due` | `string` | ja |  | Fällig seit |
| `invoices[].open` | `string` | ja |  | Offener Betrag |
| `rows` | `object[]` | ja | ja | Forderung: offener Betrag, Gebühren, Pauschale, Zinsen |
| `rows[].label` | `string` | ja |  | Bezeichnung, links |
| `rows[].value` | `string` | ja |  | Wert, rechts |
| `total` | `object` | ja | ja | Zu zahlen |
| `total.label` | `string` | ja |  | Bezeichnung, links |
| `total.value` | `string` | ja |  | Wert, rechts |
| `closing` | `string` | ja | ja | Schlusstext ohne Auszeichnungszeichen |
| `closingFormatted` | `object[]` | ja | ja | Schlusstext mit Auszeichnungen |
| `closingFormatted[].text` | `string` | ja |  | Text des Abschnitts |
| `closingFormatted[].bold` | `boolean` | ja |  | fett |
| `closingFormatted[].italic` | `boolean` | ja |  | kursiv |
| `closingFormatted[].underline` | `boolean` | ja |  | unterstrichen |
| `greeting` | `string` | ja |  | Gruß und Firmenname, mit Zeilenumbruch |
