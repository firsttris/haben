// Atelier, Fuß rechts (#113): wie Atelier, aber Angaben zum Beleg und Fuß in einer Randspalte rechts, getrennt durch eine
// Haarlinie in der Akzentfarbe ab Höhe der Absenderzeile. Display-Serif Cormorant Garamond. Nach DIN 5008 Form B.
#import "layout-basis.typ": *

#let serif = "Cormorant Garamond"
#let gesperrt(body, farbe: muted) = text(size: 6.6pt, fill: farbe, tracking: 0.14em, upper(body))
#let haar = 0.35pt + accent
#let spalte-x = 158mm
#let spalte-breite = 42mm
// Linie mittig zwischen Brief und Randspalte, je 4 mm Luft
#let linie-x = spalte-x - 4mm
#let rechts-rand = 210mm - (linie-x - 4mm)

#let fuss-spalte = {
  set text(size: 7.2pt, fill: muted)
  set par(leading: 0.5em)
  let spalten = if d.at("footerFormatted", default: none) != none {
    d.footerFormatted.map(zeilen => zeilen.map(runs => einpassen(formatted(runs), spalte-breite)).join(linebreak()))
  } else { d.footer.map(zeilen => zeilen.map(z => einpassen(z, spalte-breite)).join(linebreak())) }
  stack(spacing: 4.5mm, ..spalten, ..if legal != none { (text(size: 6.6pt, legal.split(" · ").map(z => einpassen(z, spalte-breite)).join(linebreak())),) })
}

#set document(title: d.docTitle, author: d.author)
#set text(font: font.regular, size: 9pt, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
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
    place(top + left, dx: linie-x, dy: 58mm, line(angle: 90deg, length: 297mm - 58mm - 16mm, stroke: haar))
    place(bottom + left, dx: spalte-x, dy: -16mm, box(width: spalte-breite, fuss-spalte))
  },
  footer: seitenzahl(),
)

// Kopf: Logo rechts in der Randspalte und Name in der Serif links; Logo links und Name rechts bündig mit der Randspalte;
// in der Mitte steht nur das Logo
#if d.at("logo", default: none) != none and logo-stelle != "rechts" {
  logo(rand: rechts-rand)
  if logo-stelle == "links" { place(top + left, dy: 2mm, box(width: spalte-x + spalte-breite - links, align(right, text(font: serif, size: 21pt, tracking: 0.02em, d.author)))) }
} else {
  if d.at("logo", default: none) != none {
    place(top + left, dx: spalte-x - links, box(width: spalte-breite, context {
      let hoch = image(d.logo, height: look.logoHeight * 1mm)
      if measure(hoch).width > spalte-breite { image(d.logo, width: spalte-breite) } else { hoch }
    }))
  }
  place(top + left, dy: 2mm, text(font: serif, size: 21pt, tracking: 0.02em, d.author))
}
#anschrift()
// Angaben zum Beleg in der Randspalte, ab Höhe der Anschrift, jede Länge
#place(top + left, dx: spalte-x - links, dy: 45mm - oben + 17.7mm - 3.9mm, box(width: spalte-breite, stack(spacing: 3.6mm,
  ..d.meta.map(m => stack(spacing: 1.3mm, gesperrt(m.label), text(font: serif, size: 10.5pt, zusammen(m.value)))))))
#bis-betreff()
#text(font: serif, size: 36pt, d.title)
#if d.reference != none { v(-1mm); text(fill: muted, d.reference) }
#v(7mm)
#let kopf(body) = gesperrt(body)
#let linien(x, y) = if y == 0 { (bottom: haar) } else { (bottom: 0.3pt + rule) }
#einleitung()
#{
  set text(size: 8.6pt)
  let spalten = if noPrices { (1fr, auto) } else if hideVat { (1fr, auto, auto, auto) } else { (1fr, auto, auto, auto, auto) }
  let n = spalten.len()
  table(
    columns: spalten,
    align: (x, y) => if x == 0 { left } else { right },
    stroke: linien,
    inset: (x, y) => (left: if x == 0 { 0pt } else { 1.6mm }, right: if x == n - 1 { 0pt } else { 1.6mm }, top: 2.6mm, bottom: 2.6mm),
    table.header(..(if noPrices { (cols.description, cols.quantity) } else if hideVat { (cols.description, cols.quantity, cols.unitPrice, cols.net) } else { (cols.description, cols.quantity, cols.unitPrice, cols.vat, cols.net) }).map(kopf)),
    ..d.lines.map(l => {
      let parts = ()
      let tag = l.at("tag", default: none)
      let item = l.at("itemNumber", default: "")
      if tag != none { parts.push(gesperrt(tag, farbe: accent)) }
      if itemNumbers and item != "" { parts.push(gesperrt(cols.at("itemNumber", default: "Art.-Nr.") + " " + item)) }
      parts.push(l.description)
      let detail = l.at("detail", default: none)
      if detail != none { parts.push(text(size: 8pt, fill: muted, formatted(l.detailFormatted))) }
      let discount = l.at("discount", default: none)
      if discount != none { parts.push(text(size: 8pt, fill: muted, discount)) }
      let desc = stack(spacing: 1.2mm, ..parts)
      if noPrices { (desc, l.quantity) } else if hideVat { (desc, l.quantity, l.unitPrice, l.net) } else { (desc, l.quantity, l.unitPrice, l.rate, l.net) }
    }).flatten()
  )
  v(3mm)
}
#if d.totals != none { context {
  align(right, block(width: 78mm, breakable: false, {
    set block(spacing: 0pt)
    zeilen-grid(d.totals.rows, row-gutter: 2.4mm)
    v(3.5mm)
    block(width: 100%, inset: (y: 3.2mm), stroke: (top: haar, bottom: haar), grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      gesperrt(d.totals.gross.label, farbe: ink),
      text(font: serif, size: 20pt, d.totals.gross.value),
    ))
    for extra in (d.totals.at("included", default: none), d.totals.at("euroTax", default: none)) {
      if extra != none and extra.rows.len() > 0 {
        v(2.6mm)
        set text(size: 0.9em)
        grid(columns: (1fr, auto), align: (left, right), row-gutter: 1.8mm,
          grid.cell(colspan: 2, text(fill: muted, extra.label + ":")),
          ..extra.rows.map(r => (text(fill: muted, r.label), text(fill: muted, r.value))).flatten())
      }
    }
  }))
  v(10mm)
} }
#abschluss(kopf: kopf, stroke: linien)
