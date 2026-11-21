// Elegant, Fuß rechts (#113): Brief links, rechts eine schmale Spalte mit allen Angaben. Oben die Angaben zum Beleg (jede
// Länge, auch alle Referenzen), unten der Absender mit Kontakt, Bank und Steuerdaten statt einer Fußzeile. Beschriftungen
// klein in der Akzentfarbe, Werte kräftig, linksbündig an einer feinen Linie. Vorgabe Literata. Anschriftfeld nach DIN 5008 Form B.
#import "layout-basis.typ": *

// Satzspiegel links 25 mm bis 150 mm, Linie bei 154 mm, Randspalte 158 bis 200 mm
#let spalte-x = 158mm
#let spalte-breite = 42mm
// Linie mittig zwischen Brief und Randspalte, je 4 mm Luft
#let linie-x = spalte-x - 4mm
#let rechts-rand = 210mm - (linie-x - 4mm)

#let angabe(label, wert) = {
  text(size: 7pt, fill: accent, label)
  linebreak()
  medium(text(size: 8pt, fill: ink, wert))
}
#let fuss-spalte = {
  set text(size: 7.5pt, fill: muted)
  set par(leading: 0.5em)
  let spalten = if d.at("footerFormatted", default: none) != none {
    d.footerFormatted.map(zeilen => zeilen.map(runs => einpassen(formatted(runs), spalte-breite)).join(linebreak()))
  } else { d.footer.map(zeilen => zeilen.map(z => einpassen(z, spalte-breite)).join(linebreak())) }
  stack(spacing: 5mm, ..spalten, ..if legal != none { (text(size: 6.8pt, legal.split(" · ").map(z => einpassen(z, spalte-breite)).join(linebreak())),) })
}

#set document(title: d.docTitle, author: d.author)
#set text(font: font.regular, size: 9.8pt, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
#set par(leading: 0.62em, spacing: 1em)
#set page(
  paper: "a4",
  margin: (top: oben, bottom: 22mm, left: links, right: rechts-rand),
  foreground: entwurf-vermerk(d.at("draft", default: none)),
  background: context {
    let bild = d.at("background", default: none)
    if bild != none and (look.backgroundPages == "alle" or counter(page).get().first() == 1) {
      place(top + left, image(bild, width: 100%, height: 100%, fit: "cover"))
    }
    if look.foldMarks {
      place(top + left, dx: 4mm, dy: 105mm, line(length: 4mm, stroke: 0.4pt + rule))
      place(top + left, dx: 4mm, dy: 148.5mm, line(length: 6mm, stroke: 0.4pt + rule))
      place(top + left, dx: 4mm, dy: 210mm, line(length: 4mm, stroke: 0.4pt + rule))
    }
    // Feine Linie in der Akzentfarbe am inneren Rand der Spalte, auf jeder Seite
    place(top + left, dx: linie-x, dy: 98.46mm, line(angle: 90deg, length: 297mm - 98.46mm - 16mm, stroke: 0.5pt + accent))
    // Absender, Kontakt, Bank und Steuerdaten unten in der Randspalte, auf jeder Seite
    place(bottom + left, dx: spalte-x, dy: -16mm, box(width: spalte-breite, fuss-spalte))
  },
  footer: seitenzahl(),
)

// Logo rechts bündig mit der Randspalte (bis 200 mm), links bündig mit dem Brief
#if d.at("logo", default: none) != none {
  place(top + if look.logoLeft { left } else { right }, dx: if look.logoLeft { 0mm } else { 200mm - (210mm - rechts-rand) }, context {
    let hoch = image(d.logo, height: look.logoHeight * 1mm)
    if measure(hoch).width > look.logoWidth * 1mm { image(d.logo, width: look.logoWidth * 1mm) } else { hoch }
  })
}
#place(top + left, dx: 0mm, dy: 45mm - oben, box(width: 80mm, height: 45mm, {
  set block(spacing: 0pt)
  box(height: 17.7mm, width: 80mm, align(bottom, pad(bottom: 2mm, text(size: 7pt, fill: muted, d.senderLine))))
  set par(leading: 0.5em)
  d.recipient.join(linebreak())
}))
// Alle Angaben zum Beleg in der Randspalte, auf Höhe des Betreffs
#place(top + left, dx: spalte-x - links, dy: 98.46mm - oben, box(width: spalte-breite, stack(spacing: 2.2mm, ..d.meta.map(m => angabe(m.label, m.value)))))

#v(98.46mm - oben)
// Betreff mit Nummer, rechts das Datum (die ersten beiden Angaben des Infoblocks)
#grid(
  columns: (1fr, auto),
  align: (left + bottom, right + bottom),
  semibold(text(size: 11pt, d.title + if d.meta.len() > 0 { " " + d.meta.at(0).value })),
  if d.meta.len() > 1 { d.meta.at(1).value },
)
#if d.reference != none { v(0mm); text(fill: muted, d.reference) }
#v(8mm)
#let kopf(body) = semibold(text(size: 9.5pt, fill: ink, body))
#let linien(x, y) = if y == 0 { (bottom: 0.6pt + ink) } else { (bottom: 0.4pt + rule) }
#einleitung()
// Positionen ohne Spalte „Pos.“, die Artikelnummer klein über der Beschreibung: so passt die Tabelle in die Briefspalte
#{
  set text(size: 9pt)
  let spalten = if noPrices { (1fr, auto) } else if hideVat { (1fr, auto, auto, auto) } else { (1fr, auto, auto, auto, auto) }
  let n = spalten.len()
  table(
    columns: spalten,
    align: (x, y) => if x == 0 { left } else { right },
    stroke: linien,
    inset: (x, y) => (left: if x == 0 { 0pt } else { 1.6mm }, right: if x == n - 1 { 0pt } else { 1.6mm }, top: 2.4mm, bottom: 2.4mm),
    table.header(..(if noPrices { (cols.description, cols.quantity) } else if hideVat { (cols.description, cols.quantity, cols.unitPrice, cols.net) } else { (cols.description, cols.quantity, cols.unitPrice, cols.vat, cols.net) }).map(kopf)),
    ..d.lines.map(l => {
      let parts = ()
      let tag = l.at("tag", default: none)
      let item = l.at("itemNumber", default: "")
      if tag != none { parts.push(text(size: 7.8pt, fill: accent, emph(tag))) }
      if itemNumbers and item != "" { parts.push(text(size: 7.8pt, fill: muted, cols.at("itemNumber", default: "Art.-Nr.") + " " + item)) }
      parts.push(l.description)
      let detail = l.at("detail", default: none)
      if detail != none { parts.push(text(size: 8.3pt, fill: muted, formatted(l.detailFormatted))) }
      let discount = l.at("discount", default: none)
      if discount != none { parts.push(text(size: 8.3pt, fill: muted, discount)) }
      let desc = stack(spacing: 1.2mm, ..parts)
      if noPrices { (desc, l.quantity) } else if hideVat { (desc, l.quantity, l.unitPrice, l.net) } else { (desc, l.quantity, l.unitPrice, l.rate, l.net) }
    }).flatten()
  )
  v(3mm)
}
// Summen als volle Zeilen wie die Positionen, der Gesamtbetrag kräftig
#if d.totals != none {
  v(-3mm)
  table(
    columns: (1fr, auto),
    align: (left, right),
    stroke: (x, y) => (bottom: 0.4pt + rule),
    inset: (x, y) => (left: if x == 0 { 0pt } else { 1.6mm }, right: if x == 1 { 0pt } else { 1.6mm }, top: 2.4mm, bottom: 2.4mm),
    ..d.totals.rows.map(r => (r.label, r.value)).flatten(),
    d.totals.gross.label, semibold(d.totals.gross.value),
  )
  for extra in (d.totals.at("included", default: none), d.totals.at("euroTax", default: none)) {
    if extra != none and extra.rows.len() > 0 {
      v(1mm)
      text(size: 8.5pt, fill: muted, extra.label + ": " + extra.rows.map(r => r.label + " " + r.value).join(" · "))
    }
  }
  v(6mm)
}
#abschluss(kopf: kopf, stroke: linien)
