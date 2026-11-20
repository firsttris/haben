// Premium, Fuß unten (#113): Display-Serif Cormorant Garamond für Name, Überschrift und Beträge, die Schrift der Gestaltung
// für den Rest, Haarlinien in der Akzentfarbe (Vorgabe Gold #B5862A) unter dem Kopf und über dem Fuß, Beschriftungen klein
// und gesperrt. Option Kerndaten: Liste oder zweispaltig. Nach DIN 5008 Form B.
#import "layout-basis.typ": *

#let serif = "Cormorant Garamond"
#let gesperrt(body, farbe: muted) = text(size: 6.8pt, fill: farbe, tracking: 0.14em, upper(body))
#let haar = 0.35pt + accent

#show: seite.with(groesse: 9pt, leading: 0.62em, fuss-farbe: accent)

// Kopf: Logo, Name oder beides, darunter eine Haarlinie in der Akzentfarbe über die ganze Breite, immer mit Abstand zum Logo
// Steht das Logo links, steht der Name rechts daneben; mittig oder rechts steht nur das Logo
#if d.at("logo", default: none) != none {
  logo()
  if logo-stelle == "links" { place(top + right, dy: 4mm, text(font: serif, size: 21pt, tracking: 0.02em, d.author)) }
} else {
  place(top + left, dy: 4mm, text(font: serif, size: 21pt, tracking: 0.02em, d.author))
}
#context {
  let logo-hoehe = if d.at("logo", default: none) == none { 0mm } else { measure(image(d.logo, height: look.logoHeight * 1mm)).height }
  place(top + left, dy: calc.max(17mm.to-absolute(), logo-hoehe + 4mm), line(length: satzbreite, stroke: haar))
}
#anschrift()
// Angaben zum Beleg untereinander, Beschriftung über dem Wert, rechtsbündig mit der Tabelle (bis 190 mm)
#let angabe(m) = stack(spacing: 1.3mm, text(size: 6.4pt, fill: muted, tracking: 0.08em, upper(m.label)), text(font: serif, size: 10.5pt, zusammen(m.value)))
// Option „Kerndaten“: Liste (untereinander, rechtsbündig) oder zweispaltig
#place(top + left, dx: 125mm - links, dy: info-oben - oben, box(width: 190mm - 125mm, if option("kerndaten", "liste") == "zweispaltig" {
  info-zweispaltig(info-rechts, angabe)
} else {
  stack(spacing: 3.2mm, ..info-rechts.map(m => align(right, angabe(m))))
}))
#bis-betreff()
#if info-rest.len() > 0 {
  let haelfte = calc.ceil(info-rest.len() / 2)
  let spalte(zeilen) = grid(columns: (auto, 1fr), column-gutter: 4mm, row-gutter: 2.2mm,
    ..zeilen.map(m => (gesperrt(m.label), align(right, text(font: serif, size: 8.6pt, m.value)))).flatten())
  block(width: 100%, inset: (y: 2.6mm), stroke: (top: haar, bottom: haar), grid(columns: (1fr, 1fr), column-gutter: 10mm, spalte(info-rest.slice(0, haelfte)), spalte(info-rest.slice(haelfte))))
  v(5mm)
}
#text(font: serif, size: 36pt, d.title)
#if d.reference != none { v(-1mm); text(fill: muted, d.reference) }
#v(7mm)
#let kopf(body) = gesperrt(body)
#let linien(x, y) = if y == 0 { (bottom: haar) } else { (bottom: 0.3pt + rule) }
#einleitung()
#positionen(kopf: kopf, stroke: linien, inset: (x: 1.8mm, y: 2.8mm), tag-farbe: accent)
// Gesamtbetrag zwischen zwei Haarlinien, Betrag groß in der Serif
#if d.totals != none { context {
  let breite = 88mm
  align(right, block(width: breite, breakable: false, {
    set block(spacing: 0pt)
    zeilen-grid(d.totals.rows, row-gutter: 2.4mm)
    v(3.5mm)
    block(width: 100%, inset: (y: 3.2mm), stroke: (top: haar, bottom: haar), grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      gesperrt(d.totals.gross.label, farbe: ink),
      text(font: serif, size: 21pt, d.totals.gross.value),
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
