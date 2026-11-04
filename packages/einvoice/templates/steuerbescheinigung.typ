// Steuerbescheinigung nach § 45a Abs. 2 EStG (amtliches Muster II, BMF-Schreiben vom 16. Mai 2025) im Briefformat
// wie die Mahnung (DIN 5008 Form B). Alle Texte und Beträge kommen fertig formatiert als JSON über sys.inputs.data.

#let d = json(bytes(sys.inputs.data))
// Pflichtangaben einer GmbH oder UG (§ 35a GmbHG) unter den Spalten des Fußes; ohne sie bleibt der Fuß wie bisher
#let legal = d.at("legal", default: none)

#let ink = rgb(d.palette.ink)
#let muted = rgb(d.palette.muted)
#let rule = rgb(d.palette.rule)
#let accent = rgb(d.accent)

#let semibold(body) = text(font: "IBM Plex Sans SmBld", body)

#set document(title: d.docTitle, author: d.author)
#set text(font: "IBM Plex Sans", size: 9.5pt, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
#set par(leading: 0.55em, spacing: 0.9em)

#let footer-col(lines) = {
  set text(size: 7pt, fill: muted)
  set par(leading: 0.45em)
  lines.join(linebreak())
}

// Pflichtangaben über die ganze Breite unter den Spalten des Fußes
#let legal-foot = if legal == none { none } else { pad(top: 2mm, footer-col((legal,))) }

#set page(
  paper: "a4",
  margin: (top: 20mm, bottom: 34mm, left: 25mm, right: 20mm),
  // Fest statt 30 % des Rands: Wächst der Rand um die Pflichtangaben, bekommt der Fuß den ganzen Zuwachs
  footer-descent: 10.2mm,
  background: {
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
    if legal-foot != none { legal-foot }
    let total = counter(page).final().first()
    if total > 1 {
      v(2.5mm)
      align(right, text(size: 7pt, fill: muted)[Seite #counter(page).display() von #total])
    }
  },
)

// Der Fuß hängt oben im unteren Rand und wächst nach unten: Bricht die Zeile mit den Pflichtangaben um, liefe er mit
// festem Rand über das Blatt. Darum wächst der Rand um ihre gemessene Höhe (Satzspiegel 210 − 25 − 20 = 165 mm).
#show: doc => context {
  if legal-foot == none { return doc }
  set page(margin: (top: 20mm, bottom: 34mm + measure(block(width: 165mm, legal-foot)).height, left: 25mm, right: 20mm))
  doc
}

#if d.at("logo", default: none) != none {
  place(top + right, context {
    let hoch = image(d.logo, height: 18mm)
    if measure(hoch).width > 60mm { image(d.logo, width: 60mm) } else { hoch }
  })
}

// Anschriftfeld mit dem Gläubiger der Kapitalerträge
#place(top + left, dx: 20mm - 25mm, dy: 45mm - 20mm, box(width: 85mm, height: 45mm, {
  set block(spacing: 0pt)
  box(height: 17.7mm, align(bottom, pad(bottom: 2mm, text(size: 7pt, fill: muted, d.senderLine))))
  set par(leading: 0.5em)
  d.recipient.join(linebreak())
}))

#place(top + left, dx: 125mm - 25mm, dy: 50mm - 20mm, box(width: 75mm, {
  set text(size: 8.5pt)
  grid(
    columns: (auto, 1fr),
    column-gutter: 4mm,
    row-gutter: 2.2mm,
    ..d.meta.map(m => (text(fill: muted, m.label), align(right, m.value))).flatten()
  )
}))

#v(98.46mm - 20mm)

// Aufbau nach Muster II: Titel, Art der Bescheinigung, Satz mit Gläubiger, Beschluss und Zahlungstag, dann die Zeilen
#semibold(text(size: 16pt, d.title))
#v(-1mm)
#text(fill: muted, d.subtitle)

#v(4mm)

#d.kind

#v(4mm)

#d.intro

#v(2mm)

#table(
  columns: (1fr, auto),
  align: (left, right),
  stroke: (x, y) => (top: if y == 0 { 0.6pt + accent } else { none }, bottom: 0.4pt + rule),
  inset: (x: 1.6mm, y: 2.2mm),
  ..d.rows.map(r => (r.label, r.value)).flatten()
)

#v(4mm)

#for note in d.notes {
  block(text(size: 8.5pt, fill: muted, note))
}

#v(4mm)
#d.signature
