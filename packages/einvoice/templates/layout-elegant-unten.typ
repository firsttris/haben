// Elegant, Fuß unten (#113): wie die Randspalte gesetzt, aber mit Infoblock rechts neben der Anschrift und
// dem Fuß unten. Ruhig, ohne Zeilentrenner in der Tabelle. Vorgabe Literata. Nach DIN 5008 Form B.
#import "layout-basis.typ": *

#show: seite.with(groesse: 9.8pt, leading: 0.62em)

#let kopf(body) = semibold(text(size: 9pt, fill: ink, body))
#let linien(x, y) = if y == 0 { (bottom: 0.6pt + ink) } else { none }

#logo()
#anschrift()
// Kerndaten: Beschriftung klein in der Akzentfarbe über dem Wert, zweispaltig, bündig bis 190 mm
// Option „Kerndaten“: Liste (Beschriftung links, Wert rechts) oder zweispaltig (Beschriftung über dem Wert)
#if option("kerndaten", "liste") == "zweispaltig" {
  place(top + left, dx: 125mm - links, dy: info-oben - oben, box(width: 190mm - 125mm, info-zweispaltig(info-rechts, column-gutter: 6mm, row-gutter: 3.8mm,
    m => stack(spacing: 1.6mm, text(size: 7pt, fill: accent, m.label), medium(text(size: 8.8pt, zusammen(m.value)))))))
} else {
  infoblock(groesse: 8.3pt, label-farbe: accent, wert-gewicht: "medium")
}
#bis-betreff()
#info-ueberlauf(groesse: 8pt, label-farbe: accent)
#grid(columns: (1fr, auto), align: (left + bottom, right + bottom),
  semibold(text(size: 12pt, d.title + if d.meta.len() > 0 { " " + d.meta.at(0).value })),
  if d.meta.len() > 1 { d.meta.at(1).value })
#if d.reference != none { text(fill: muted, d.reference) }
#v(8mm)
#einleitung()
#positionen(kopf: kopf, stroke: linien, inset: (x: 1.6mm, y: 2.4mm))
#summen(farbe: ink)
#abschluss(kopf: kopf, stroke: linien)
