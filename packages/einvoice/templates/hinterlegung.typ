// Bilanz einer Kleinstkapitalgesellschaft zur Hinterlegung beim Unternehmensregister (§ 326 Abs. 2 HGB).
// Alle Texte und Beträge kommen fertig formatiert als JSON über sys.inputs.data; hier wird nichts berechnet.
// Schlicht in Schwarz und Grau, ohne Logo: Das Register übernimmt das Blatt, wie es ist.

#let d = json(bytes(sys.inputs.data))

#let ink = rgb(d.palette.ink)
#let muted = rgb(d.palette.muted)
#let rule = rgb(d.palette.rule)

// Die Plex-TTFs tragen Medium und SemiBold als eigene Familien
#let semibold(body) = text(font: "IBM Plex Sans SmBld", body)

#set document(title: d.docTitle, author: d.author)
#set text(font: "IBM Plex Sans", size: 10pt, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
#set par(leading: 0.6em, spacing: 1em)
#set page(
  paper: "a4",
  margin: (top: 25mm, bottom: 25mm, left: 25mm, right: 20mm),
  footer: context {
    let total = counter(page).final().first()
    if total > 1 {
      align(right, text(size: 8pt, fill: muted)[Seite #counter(page).display() von #total])
    }
  },
)

#semibold(text(size: 13pt, d.firma))
#v(-1mm)
#d.kopf.join(linebreak())

#v(6mm)
#semibold(text(size: 16pt, d.title))
#v(4mm)

#let vorjahr = d.spalten.vorjahr != none
#let spalten = if vorjahr { (1fr, 32mm, 32mm) } else { (1fr, 32mm) }
// Davon-Vermerke (§ 268 Abs. 4 und 5 HGB, § 42 Abs. 3 GmbHG) eingerückt und kleiner unter ihrem Posten
#let klein(z, body) = if z.at("vermerk", default: false) { text(size: 9pt, body) } else { body }
#let zellen(z) = {
  let label = if z.at("vermerk", default: false) { pad(left: 4mm, klein(z, z.label)) } else { z.label }
  if vorjahr { (label, klein(z, z.betrag), klein(z, z.vorjahr)) } else { (label, klein(z, z.betrag)) }
}
#let summe(z) = zellen(z).map(semibold)

#let seite(titel, zeilen, sum) = {
  let kopf = if vorjahr { (semibold(titel), semibold(d.spalten.jahr + "\nEUR"), semibold(d.spalten.vorjahr + "\nEUR")) } else {
    (semibold(titel), semibold(d.spalten.jahr + "\nEUR"))
  }
  table(
    columns: spalten,
    align: (x, y) => if x == 0 { left + bottom } else { right + bottom },
    stroke: (x, y) => if y == 0 { (bottom: 0.6pt + ink) } else if y == zeilen.len() + 1 { (top: 0.6pt + ink, bottom: 0.6pt + ink) } else {
      (bottom: 0.4pt + rule)
    },
    inset: (x: 1.6mm, y: 2.2mm),
    table.header(..kopf),
    ..zeilen.map(zellen).flatten(),
    ..summe(sum),
  )
}

#seite("Aktiva", d.aktiva, d.summeAktiva)
#v(6mm)
#seite("Passiva", d.passiva, d.summePassiva)

#v(8mm)
#block(breakable: false, {
  semibold(d.angabenTitel)
  v(1mm)
  for a in d.angaben {
    block(spacing: 3mm, {
      text(fill: muted, a.titel)
      linebreak()
      a.text
    })
  }
})

#v(6mm)
#d.hinweis

#d.feststellung
