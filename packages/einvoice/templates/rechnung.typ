// Rechnung nach DIN 5008 Form B. Alle Texte und Beträge kommen fertig
// formatiert als JSON über sys.inputs.data; hier wird nichts berechnet.

#let d = json(bytes(sys.inputs.data))

#let ink = rgb("#16211C")
#let muted = rgb("#5B6B63")
#let rule = rgb("#D5DDD8")
#let accent = rgb("#1F6F5C")

// Die Plex-TTFs tragen Medium und SemiBold als eigene Familien
#let medium(body) = text(font: "IBM Plex Sans Medm", body)
#let semibold(body) = text(font: "IBM Plex Sans SmBld", body)

#set document(title: d.docTitle, author: d.author)
#set text(font: "IBM Plex Sans", size: 9.5pt, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
#set par(leading: 0.55em, spacing: 0.9em)

#let footer-col(lines) = {
  set text(size: 7pt, fill: muted)
  set par(leading: 0.45em)
  lines.join(linebreak())
}

#set page(
  paper: "a4",
  margin: (top: 20mm, bottom: 34mm, left: 25mm, right: 20mm),
  background: {
    // Falz- und Lochmarken (Form B)
    place(top + left, dx: 4mm, dy: 105mm, line(length: 4mm, stroke: 0.4pt + rule))
    place(top + left, dx: 4mm, dy: 148.5mm, line(length: 6mm, stroke: 0.4pt + rule))
    place(top + left, dx: 4mm, dy: 210mm, line(length: 4mm, stroke: 0.4pt + rule))
  },
  footer: context {
    set block(spacing: 0pt)
    line(length: 100%, stroke: 0.4pt + rule)
    v(3mm)
    grid(
      columns: (1fr, 1fr, 1fr),
      column-gutter: 6mm,
      footer-col(d.footer.at(0)),
      footer-col(d.footer.at(1)),
      footer-col(d.footer.at(2)),
    )
    let total = counter(page).final().first()
    if total > 1 {
      v(2.5mm)
      align(right, text(size: 7pt, fill: muted)[Seite #counter(page).display() von #total])
    }
  },
)

// Anschriftfeld: 20 mm von links, 45 mm von oben, 85 × 45 mm
#place(top + left, dx: 20mm - 25mm, dy: 45mm - 20mm, box(width: 85mm, height: 45mm, {
  set block(spacing: 0pt)
  box(height: 17.7mm, align(bottom, pad(bottom: 2mm, text(size: 7pt, fill: muted, d.senderLine))))
  set par(leading: 0.5em)
  d.recipient.join(linebreak())
}))

// Informationsblock: ab 125 mm von links, 50 mm von oben
#place(top + left, dx: 125mm - 25mm, dy: 50mm - 20mm, box(width: 75mm, {
  set text(size: 8.5pt)
  grid(
    columns: (auto, 1fr),
    column-gutter: 4mm,
    row-gutter: 2.2mm,
    ..d.meta.map(m => (text(fill: muted, m.label), align(right, m.value))).flatten()
  )
}))

// Betreffzeile bei 98,46 mm von oben
#v(98.46mm - 20mm)

#semibold(text(size: 16pt, d.title))
#if d.reference != none {
  v(-1mm)
  text(fill: muted, d.reference)
}

#v(5mm)

#let head(body) = medium(text(size: 8pt, fill: accent, body))
#table(
  columns: (auto, 1fr, auto, auto, auto, auto),
  align: (left, left, right, right, right, right),
  stroke: (x, y) => if y == 0 { (bottom: 0.6pt + accent) } else { (bottom: 0.4pt + rule) },
  inset: (x: 1.6mm, y: 2.2mm),
  table.header(
    head[Pos.], head[Beschreibung], head[Menge], head[Einzelpreis], head[USt], head[Netto],
  ),
  ..d.lines.map(l => (
    l.pos,
    l.description,
    l.quantity,
    l.unitPrice,
    l.rate,
    l.net,
  )).flatten()
)

#v(3mm)

#align(right, block(width: 80mm, {
  set block(spacing: 0pt)
  grid(
    columns: (1fr, auto),
    align: (left, right),
    row-gutter: 2.2mm,
    inset: (x: 1.6mm),
    ..d.totals.rows.map(r => (text(fill: muted, r.label), r.value)).flatten()
  )
  v(2.2mm)
  line(length: 100%, stroke: 0.6pt + accent)
  v(2.2mm)
  grid(
    columns: (1fr, auto),
    align: (left, right),
    inset: (x: 1.6mm),
    semibold(d.totals.gross.label),
    semibold(d.totals.gross.value),
  )
}))

#v(8mm)

#if d.taxNote != none {
  block(breakable: false, semibold(d.taxNote))
  v(2mm)
}
#let girocode = if d.at("qr", default: none) != none {
  // GiroCode: Banking-App scannen statt abtippen
  box(width: 24mm, {
    image(bytes(d.qr), format: "svg", width: 24mm)
    v(1mm)
    align(center, text(size: 6.5pt, fill: muted)[GiroCode])
  })
}
#if girocode != none {
  block(breakable: false, grid(columns: (1fr, 24mm), column-gutter: 8mm, align: (left + top, right + top), d.payment, girocode))
} else {
  block(breakable: false, d.payment)
}
#if d.note != none {
  v(2mm)
  d.note
}
