// Rechnung nach DIN 5008 Form B. Alle Texte und Beträge kommen fertig
// formatiert als JSON über sys.inputs.data; hier wird nichts berechnet.

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

// Auszeichnungen aus parseTextFormatting (packages/core)
#let formatted(runs) = {
  for run in runs {
    let body = text(run.text)
    if run.bold { body = semibold(body) }
    if run.italic { body = emph(body) }
    if run.underline { body = underline(body) }
    body
  }
}

#set document(title: d.docTitle, author: d.author)
#set text(font: font.regular, size: 9.5pt, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
#set par(leading: 0.55em, spacing: 0.9em)

#let footer-col(lines) = {
  set text(size: 7pt, fill: muted)
  set par(leading: 0.45em)
  lines.join(linebreak())
}

// Eigene Spalten: je Zeile die ausgezeichneten Abschnitte
#let footer-col-formatted(lines) = {
  set text(size: 7pt, fill: muted)
  set par(leading: 0.45em)
  lines.map(formatted).join(linebreak())
}

// Pflichtangaben über die ganze Breite unter den Spalten des Fußes
#let legal-foot = if legal == none { none } else { pad(top: 2mm, footer-col((legal,))) }

// Leer, wenn das Briefpapier selbst den Fuß trägt
#let foot-spalten = if d.footer.len() == 0 { none } else {
  set block(spacing: 0pt)
  line(length: 100%, stroke: 0.4pt + rule)
  v(3mm)
  grid(
    columns: d.footer.map(_ => 1fr),
    column-gutter: 6mm,
    ..if d.at("footerFormatted", default: none) != none { d.footerFormatted.map(footer-col-formatted) } else { d.footer.map(footer-col) },
  )
  if legal-foot != none { legal-foot }
}

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
    foot-spalten
    let total = counter(page).final().first()
    if total > 1 {
      v(2.5mm)
      let labels = d.at("labels", default: (page: ("Seite", "von", "")))
      align(right, text(size: 7pt, fill: muted)[#labels.page.at(0) #counter(page).display() #labels.page.at(1) #total#labels.page.at(2)])
    }
  },
)

// Der Fuß hängt oben im unteren Rand und wächst nach unten: Mit festem Rand liefe er über das Blatt, wenn die Zeile mit den
// Pflichtangaben oder eigene Spalten umbrechen. Darum wächst der Rand mit (Satzspiegel 210 − 25 − 20 = 165 mm).
#let satzbreite = 165mm
#let hoehe(inhalt) = measure(block(width: satzbreite, inhalt)).height
#show: doc => context {
  let pflicht = if legal-foot == none { 0mm } else { hoehe(legal-foot) }
  // 5 mm für die Seitenzahl, 10,2 mm wie footer-descent, 3 mm Abstand zur Blattkante
  let rand = calc.max((34mm + pflicht).to-absolute(), hoehe(foot-spalten) + 5mm + 10.2mm + 3mm)
  set page(margin: (top: 20mm, bottom: rand, left: 25mm, right: 20mm))
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

// Einleitung (Kopftext) über den Positionen
#let intro = d.at("intro", default: none)
#if intro != none {
  formatted(d.introFormatted)
  v(4mm)
}

#let head(body) = medium(text(size: 8pt, fill: accent, body))
// Lieferschein: nur Position, Beschreibung und Menge
#let noPrices = d.at("noPrices", default: false)
#let cols = d.at("labels", default: (columns: (pos: "Pos.", itemNumber: "Art.-Nr.", description: "Beschreibung", quantity: "Menge", unitPrice: "Einzelpreis", vat: "USt", net: "Netto"))).columns
// Spalte „Art.-Nr.“ hinter der Position, nur wenn eine Position eine Artikelnummer hat (BT-155)
#let itemNumbers = d.at("itemNumbers", default: false)
#let withItem(cells, item) = if itemNumbers { (cells.at(0), item) + cells.slice(1) } else { cells }
// Spalte USt entfällt nur bei einem einzigen Steuersatz (showsVatColumn in packages/core)
#let hideVat = d.at("hideVatColumn", default: false)
#table(
  columns: withItem(if noPrices { (auto, 1fr, auto) } else if hideVat { (auto, 1fr, auto, auto, auto) } else { (auto, 1fr, auto, auto, auto, auto) }, auto),
  align: withItem(if noPrices { (left, left, right) } else if hideVat { (left, left, right, right, right) } else { (left, left, right, right, right, right) }, left),
  stroke: (x, y) => if y == 0 { (bottom: 0.6pt + accent) } else { (bottom: 0.4pt + rule) },
  inset: (x: 1.6mm, y: 2.2mm),
  table.header(
    ..withItem(if noPrices {
      (head(cols.pos), head(cols.description), head(cols.quantity))
    } else if hideVat {
      (head(cols.pos), head(cols.description), head(cols.quantity), head(cols.unitPrice), head(cols.net))
    } else {
      (head(cols.pos), head(cols.description), head(cols.quantity), head(cols.unitPrice), head(cols.vat), head(cols.net))
    }, head(cols.at("itemNumber", default: "Art.-Nr."))),
  ),
  ..d.lines.map(l => {
    // Bezeichnung, darunter die mehrzeilige Beschreibung der Position
    let detail = l.at("detail", default: none)
    // Kennzeichen optionaler und alternativer Positionen im Angebot, Positionsrabatt unter dem Text
    let tag = l.at("tag", default: none)
    let discount = l.at("discount", default: none)
    let desc = if detail == none and tag == none and discount == none { l.description } else {
      let parts = ()
      if tag != none { parts.push(medium(text(size: 8pt, fill: accent, tag))) }
      parts.push(if detail == none and tag == none { l.description } else { medium(l.description) })
      if detail != none { parts.push(text(size: 8.5pt, fill: muted, formatted(l.detailFormatted))) }
      if discount != none { parts.push(text(size: 8.5pt, fill: muted, discount)) }
      stack(spacing: 1.4mm, ..parts)
    }
    withItem(if noPrices { (l.pos, desc, l.quantity) } else if hideVat { (l.pos, desc, l.quantity, l.unitPrice, l.net) } else { (l.pos, desc, l.quantity, l.unitPrice, l.rate, l.net) }, l.at("itemNumber", default: ""))
  }).flatten()
)

#v(3mm)

#if d.totals != none { align(right, block(width: 80mm, {
  set block(spacing: 0pt)
  if d.totals.rows.len() > 0 {
    grid(
      columns: (1fr, auto),
      align: (left, right),
      row-gutter: 2.2mm,
      inset: (x: 1.6mm),
      ..d.totals.rows.map(r => (text(fill: muted, r.label), r.value)).flatten()
    )
    v(2.2mm)
  }
  line(length: 100%, stroke: 0.6pt + accent)
  v(2.2mm)
  grid(
    columns: (1fr, auto),
    align: (left, right),
    inset: (x: 1.6mm),
    semibold(d.totals.gross.label),
    semibold(d.totals.gross.value),
  )
  // Bruttopreise: Netto und Umsatzsteuer je Satz, die im Gesamtbetrag enthalten sind
  let included = d.totals.at("included", default: none)
  if included != none and included.rows.len() > 0 {
    v(2.2mm)
    set text(size: 8.5pt)
    grid(
      columns: (1fr, auto),
      align: (left, right),
      row-gutter: 1.8mm,
      inset: (x: 1.6mm),
      grid.cell(colspan: 2, text(fill: muted, included.label + ":")),
      ..included.rows.map(r => (text(fill: muted, r.label), text(fill: muted, r.value))).flatten()
    )
  }
  // Fremdwährung: Umsatzsteuer in Euro mit dem Kurs
  let euro-tax = d.totals.at("euroTax", default: none)
  if euro-tax != none and euro-tax.rows.len() > 0 {
    v(2.2mm)
    set text(size: 8.5pt)
    grid(
      columns: (1fr, auto),
      align: (left, right),
      row-gutter: 1.8mm,
      inset: (x: 1.6mm),
      grid.cell(colspan: 2, text(fill: muted, euro-tax.label + ":")),
      ..euro-tax.rows.map(r => (text(fill: muted, r.label), text(fill: muted, r.value))).flatten()
    )
  }
})) }

#v(8mm)

// Zahlungsplan im Angebot und auf Wunsch in der Auftragsbestätigung
#let plan = d.at("plan", default: none)
#if plan != none {
  block(breakable: false, {
    semibold(plan.title)
    v(1mm)
    table(
      columns: (auto, 1fr, auto, auto),
      align: (left, left, right, right),
      stroke: (x, y) => if y == 0 { (bottom: 0.6pt + accent) } else { (bottom: 0.4pt + rule) },
      inset: (x: 1.6mm, y: 1.8mm),
      table.header(head(plan.columns.label), head(plan.columns.due), head(plan.columns.share), head(plan.columns.amount)),
      ..plan.rows.map(r => (r.label, r.due, r.share, r.amount)).flatten()
    )
  })
  v(4mm)
}

#if d.taxNote != none {
  block(breakable: false, semibold(d.taxNote))
  v(2mm)
}
// GiroCode: Banking-App scannen statt abtippen
#let girocode = girocode-feld(d, muted)
#if girocode != none {
  block(breakable: false, grid(columns: (1fr, 24mm), column-gutter: 8mm, align: (left + top, right + top), d.payment, girocode))
} else if d.payment != none {
  block(breakable: false, d.payment)
}
#let signature = d.at("signature", default: none)
#if signature != none {
  // Empfangsbestätigung auf dem Lieferschein
  block(breakable: false, {
    signature.text
    v(14mm)
    block(width: 80mm, {
      line(length: 100%, stroke: 0.5pt + muted)
      v(1.5mm)
      text(size: 8pt, fill: muted, signature.label)
    })
  })
}
#if d.note != none {
  v(2mm)
  formatted(d.noteFormatted)
}
