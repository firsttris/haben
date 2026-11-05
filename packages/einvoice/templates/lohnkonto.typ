// Lohnkonto je Arbeitnehmer und Kalenderjahr (§ 41 Abs. 1 EStG, § 4 LStDV). Querformat; alle Texte und Beträge kommen
// fertig formatiert als JSON über sys.inputs.data, hier wird nichts berechnet.

#let d = json(bytes(sys.inputs.data))

#let ink = rgb(d.palette.ink)
#let muted = rgb(d.palette.muted)
#let rule = rgb(d.palette.rule)

#let semibold(body) = text(font: "IBM Plex Sans SmBld", body)

#set document(title: d.docTitle, author: d.author)
#set text(font: "IBM Plex Sans", size: 8pt, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
#set par(leading: 0.5em, spacing: 0.8em)
#set page(
  paper: "a4",
  flipped: true,
  margin: (top: 15mm, bottom: 15mm, left: 15mm, right: 15mm),
  footer: context {
    set text(size: 7pt, fill: muted)
    grid(
      columns: (1fr, auto),
      d.erstellt,
      [Seite #counter(page).display() von #counter(page).final().first()],
    )
  },
)

#semibold(text(size: 14pt, d.title))
#h(3mm)
#text(fill: muted, d.untertitel)
#v(-1mm)
#d.arbeitgeber

#v(2mm)
#table(
  columns: (auto, 1fr, auto, 1fr),
  stroke: (x, y) => (bottom: 0.4pt + rule),
  inset: (x: 1.2mm, y: 1.4mm),
  ..d.person.map(p => (text(fill: muted, p.label), p.value)).flatten()
)

#v(2mm)
#table(
  columns: (auto, auto, auto, 1fr, auto, auto, auto, auto, auto, auto, auto, auto, auto, auto, auto),
  align: (x, y) => if x < 4 { left + bottom } else { right + bottom },
  stroke: (x, y) => if y == 0 { (bottom: 0.6pt + ink) } else if y == d.zeilen.len() + 1 { (top: 0.6pt + ink) } else { (bottom: 0.4pt + rule) },
  inset: (x: 1mm, y: 1.4mm),
  table.header(..d.spalten.map(s => text(fill: muted, s))),
  ..d.zeilen.flatten(),
  ..d.summe.map(semibold),
)

#if d.leer != none { text(fill: muted, d.leer) }

#v(2mm)
#for h in d.hinweise { block(text(size: 7.5pt, fill: muted, h)) }
