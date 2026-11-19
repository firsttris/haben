// Premium, Fuß unten (#113) für Mahnungen: Display-Serif Cormorant Garamond für Name, Überschrift und Beträge, die Schrift der Gestaltung
// für den Rest, Haarlinien in der Akzentfarbe (Vorgabe Gold #B5862A) unter dem Kopf und über dem Fuß, Beschriftungen klein
// und gesperrt. Option Kerndaten: Liste oder zweispaltig. Nach DIN 5008 Form B.
#import "layout-basis.typ": *

#let serif = "Cormorant Garamond"
#let gesperrt(body, farbe: muted) = text(size: 6.8pt, fill: farbe, tracking: 0.14em, upper(body))
#let haar = 0.35pt + accent

#show: seite.with(groesse: 9pt, leading: 0.62em, fuss-farbe: accent)

// Kopf: Name in der Serif, darunter eine Haarlinie in der Akzentfarbe über die ganze Breite
// Kopf: Logo oder Name, darunter eine Haarlinie in der Akzentfarbe über die ganze Breite, immer mit Abstand zum Logo
#if d.at("logo", default: none) != none { logo() } else {
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
#mahnung-inhalt(kopf: kopf, stroke: linien)
