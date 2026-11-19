// Strukturiert (#113): Tabellen mit Gitterlinien, Infoblock und weitere Referenzen als Tabelle oder im Kasten,
// Gesamtbetrag im Kasten. Für B2B und öffentliche Auftraggeber. Vorgabe IBM Plex Sans. Nach DIN 5008 Form B.
#import "layout-basis.typ": *

#show: seite.with(groesse: 9pt)

#let kopf(body) = medium(text(size: 7.8pt, fill: ink, body))
#let gitter = 0.4pt + rule
#let flaeche(x, y) = if y == 0 { accent.lighten(90%) } else { none }
#let kasten(inhalt) = block(width: 100%, outset: 2.4mm, stroke: gitter, inhalt)

// Option „infoblock“: als Tabelle mit Gitter (Vorgabe) oder im Kasten
#let form = option("infoblock", "gitter")

#logo()
#anschrift()
#if form == "kasten" { infoblock(rahmen: kasten) } else {
  place(top + left, dx: 125mm - links, dy: info-oben - oben - 1.4mm, box(width: 210mm - rechts - 125mm, {
    set text(size: 8.3pt)
    info-tabelle(info-rechts, stroke: gitter)
  }))
}
#bis-betreff()
#if form == "kasten" { info-ueberlauf(trenner: gitter, innen: 2.4mm, rahmen: inhalt => block(width: 100%, outset: (x: 2.4mm), stroke: gitter, inhalt)) } else if info-rest.len() > 0 {
  set text(size: 8.3pt)
  info-tabelle(info-rest, paare: 2, stroke: gitter)
  v(5mm)
}
#titel(groesse: 15pt)
#einleitung()
#positionen(kopf: kopf, stroke: gitter, fill: flaeche, inset: (x: 1.8mm, y: 1.9mm))
#summen(stil: "kasten", flaeche: accent.lighten(90%))
#abschluss(kopf: kopf, stroke: gitter)
