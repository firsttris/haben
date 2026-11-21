// Atelier, Fuß rechts (#113) für Mahnungen: wie Atelier, aber Angaben zum Beleg und Fuß in einer Randspalte rechts, getrennt durch eine
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
#mahnung-inhalt(kopf: kopf, stroke: linien)
