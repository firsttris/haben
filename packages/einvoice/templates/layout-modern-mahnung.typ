// Modern (#113) für Mahnungen: große Überschrift mit einem kurzen Strich in der Akzentfarbe darüber, viel Luft, offene Tabelle,
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
#mahnung-inhalt(kopf: kopf, stroke: linien)
