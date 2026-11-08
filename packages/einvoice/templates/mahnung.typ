// Mahnung nach DIN 5008 Form B, im Aufbau wie die Rechnung. Alle Texte und Beträge kommen
// fertig formatiert als JSON über sys.inputs.data; hier wird nichts berechnet.

#let d = json(bytes(sys.inputs.data))
#import "entwurf.typ": entwurf-vermerk, girocode-feld
// Pflichtangaben einer GmbH oder UG (§ 35a GmbHG) unter den Spalten des Fußes; ohne sie bleibt der Fuß wie bisher
#let legal = d.at("legal", default: none)

// Grautöne für Text, Beschriftungen und Linien, aus der Akzentfarbe abgeleitet (accentPalette in packages/core)
#let ink = rgb(d.palette.ink)
#let muted = rgb(d.palette.muted)
#let rule = rgb(d.palette.rule)
// Akzentfarbe aus den Einstellungen (Überschriften, Linien), immer gesetzt
#let accent = rgb(d.accent)
// Logo und Marken aus dem Briefkopf-Profil, Maße in mm (templateInputs in pdf.ts)
#let look = d.at("look", default: (logoHeight: 18, logoWidth: 60, logoLeft: false, foldMarks: true, backgroundPages: "erste"))
// Schrift aus dem Profil, Vorgabe IBM Plex Sans
#let font = d.at("font", default: (regular: "IBM Plex Sans", medium: "IBM Plex Sans Medm", semibold: "IBM Plex Sans SmBld"))

// Familien aus LETTERHEAD_FONTS (packages/core); das Gewicht wählt den Schnitt
#let medium(body) = text(font: font.medium, weight: 500, body)
#let semibold(body) = text(font: font.semibold, weight: 600, body)

#set document(title: d.docTitle, author: d.author)
#set text(font: font.regular, size: 9.5pt, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
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
  // Entwurf: Vermerk über jeder Seite (entwurf.typ)
  foreground: entwurf-vermerk(d.at("draft", default: none)),
  // Fest statt 30 % des Rands: Wächst der Rand um die Pflichtangaben, bekommt der Fuß den ganzen Zuwachs
  footer-descent: 10.2mm,
  background: context {
    // Briefpapier hinter allem; PNG oder JPEG auf die ganze Seite
    let bild = d.at("background", default: none)
    if bild != none and (look.backgroundPages == "alle" or counter(page).get().first() == 1) {
      place(top + left, image(bild, width: 100%, height: 100%, fit: "cover"))
    }
    if look.foldMarks {
      // Falz- und Lochmarken (Form B)
      place(top + left, dx: 4mm, dy: 105mm, line(length: 4mm, stroke: 0.4pt + rule))
      place(top + left, dx: 4mm, dy: 148.5mm, line(length: 6mm, stroke: 0.4pt + rule))
      place(top + left, dx: 4mm, dy: 210mm, line(length: 4mm, stroke: 0.4pt + rule))
    }
  },
  footer: context {
    set block(spacing: 0pt)
    line(length: 100%, stroke: 0.4pt + rule)
    v(3mm)
    grid(
      columns: d.footer.map(_ => 1fr),
      column-gutter: 6mm,
      ..d.footer.map(footer-col),
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

// Logo oben im Briefkopf, Seite und größte Maße aus dem Profil
#if d.at("logo", default: none) != none {
  place(top + if look.logoLeft { left } else { right }, context {
    let hoch = image(d.logo, height: look.logoHeight * 1mm)
    if measure(hoch).width > look.logoWidth * 1mm { image(d.logo, width: look.logoWidth * 1mm) } else { hoch }
  })
}

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

#d.salutation

#d.intro

#v(3mm)

#let head(body) = medium(text(size: 8pt, fill: accent, body))
#table(
  columns: (1fr, auto, auto, auto),
  align: (left, right, right, right),
  stroke: (x, y) => if y == 0 { (bottom: 0.6pt + accent) } else { (bottom: 0.4pt + rule) },
  inset: (x: 1.6mm, y: 2.2mm),
  table.header(head[Rechnung], head[Rechnungsdatum], head[Fällig seit], head[Offen]),
  ..d.invoices.map(i => (i.number, i.date, i.due, i.open)).flatten()
)

#v(3mm)

#align(right, block(width: 95mm, {
  set block(spacing: 0pt)
  grid(
    columns: (1fr, auto),
    align: (left, right),
    row-gutter: 2.2mm,
    inset: (x: 1.6mm),
    ..d.rows.map(r => (text(fill: muted, r.label), r.value)).flatten()
  )
  v(2.2mm)
  line(length: 100%, stroke: 0.6pt + accent)
  v(2.2mm)
  grid(
    columns: (1fr, auto),
    align: (left, right),
    inset: (x: 1.6mm),
    semibold(d.total.label),
    semibold(d.total.value),
  )
}))

#v(8mm)

// GiroCode über den offenen Gesamtbetrag
#let girocode = girocode-feld(d, muted)
#if girocode != none {
  block(breakable: false, grid(
    columns: (1fr, 24mm),
    column-gutter: 8mm,
    align: (left + top, right + top),
    semibold(d.payment),
    girocode,
  ))
} else {
  block(breakable: false, semibold(d.payment))
}
#v(2mm)
#d.closing

#v(4mm)
#d.greeting.split("\n").join(linebreak())
