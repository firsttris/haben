// Modern (#113): große Überschrift mit einem kurzen Strich in der Akzentfarbe darüber, viel Luft, offene Tabelle,
// der Gesamtbetrag groß. Optionen: Akzentfarbe farbig oder sparsam, Linie über dem Fuß. Vorgabe Nunito Sans. Nach DIN 5008 Form B.
#import "layout-basis.typ": *

// Option „Linie über dem Fuß“: ohne (Vorgabe, wie die offene Tabelle) oder mit
#show: seite.with(groesse: 9.5pt, leading: 0.58em, fuss-linie: option("fusslinie", "ohne") == "mit")

// Option „Akzentfarbe“: farbig (Tabellenkopf, Linie, Gesamtbetrag in der Akzentfarbe) oder sparsam (nur der Strich am Titel)
#let farbig = option("akzent", "farbig") == "farbig"
#let betont = if farbig { accent } else { ink }
#let kopf(body) = semibold(text(size: 8pt, fill: betont, body))
#let linien(x, y) = if y == 0 { (bottom: 0.7pt + betont) } else { none }

#logo()
#anschrift()
#infoblock(groesse: 8.5pt, label-farbe: if farbig { accent } else { muted })
#bis-betreff()
#info-ueberlauf(groesse: 8pt, label-farbe: if farbig { accent } else { muted }, rahmen: body => block(width: 100%, inset: (y: 2mm), stroke: (top: 0.4pt + rule, bottom: 0.4pt + rule), body))
#box(width: 28mm, height: 0.9mm, radius: 0.45mm, fill: accent)
#v(2.5mm)
#semibold(text(size: 26pt, d.title))
#if d.reference != none { v(1mm); text(fill: muted, d.reference) }
#v(6mm)
#einleitung()
#positionen(kopf: kopf, stroke: linien, inset: (x: 1.6mm, y: 2.8mm))
// Summen ruhig, der Gesamtbetrag groß in der Akzentfarbe, Beschriftung klein darüber
#if d.totals != none {
  align(right, block(width: 86mm, breakable: false, {
    set block(spacing: 0pt)
    zeilen-grid(d.totals.rows, row-gutter: 2.4mm)
    v(3mm)
    line(length: 100%, stroke: 0.5pt + rule)
    v(3mm)
    grid(columns: (1fr, auto), align: (left + bottom, right + bottom),
      semibold(text(size: 9pt, d.totals.gross.label)),
      semibold(text(size: 20pt, fill: betont, d.totals.gross.value)))
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
  v(9mm)
}
#abschluss(kopf: kopf, stroke: linien)
