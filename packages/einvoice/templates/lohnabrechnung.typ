// Entgeltabrechnung nach § 108 GewO mit den Angaben der Entgeltbescheinigungsverordnung (§ 1 EntgBV), im Briefformat wie
// die Steuerbescheinigung (DIN 5008 Form B). Alle Texte und Beträge kommen fertig formatiert als JSON über sys.inputs.data.

#let d = json(bytes(sys.inputs.data))
#import "entwurf.typ": entwurf-vermerk
#let legal = d.at("legal", default: none)

#let ink = rgb(d.palette.ink)
#let muted = rgb(d.palette.muted)
#let rule = rgb(d.palette.rule)
#let accent = rgb(d.accent)

#let semibold(body) = text(font: "IBM Plex Sans SmBld", body)

#set document(title: d.docTitle, author: d.author)
#set text(font: "IBM Plex Sans", size: 9pt, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
#set par(leading: 0.5em, spacing: 0.8em)

#let footer-col(lines) = {
  set text(size: 7pt, fill: muted)
  set par(leading: 0.45em)
  lines.join(linebreak())
}

#let legal-foot = if legal == none { none } else { pad(top: 2mm, footer-col((legal,))) }

#set page(
  paper: "a4",
  margin: (top: 20mm, bottom: 30mm, left: 25mm, right: 20mm),
  footer-descent: 8mm,
  // Entwurf: Vermerk über jeder Seite (entwurf.typ), damit ein ausgedrucktes Blatt nicht als Abrechnung durchgeht
  foreground: entwurf-vermerk(if d.entwurf != none { "ENTWURF" }),
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

#if d.at("logo", default: none) != none {
  place(top + right, context {
    let hoch = image(d.logo, height: 18mm)
    if measure(hoch).width > 60mm { image(d.logo, width: 60mm) } else { hoch }
  })
}

// Anschriftfeld mit dem Beschäftigten
#place(top + left, dx: 20mm - 25mm, dy: 45mm - 20mm, box(width: 85mm, height: 45mm, {
  set block(spacing: 0pt)
  box(height: 17.7mm, align(bottom, pad(bottom: 2mm, text(size: 7pt, fill: muted, d.senderLine))))
  set par(leading: 0.5em)
  set text(size: 9.5pt)
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

#semibold(text(size: 15pt, d.title))
#v(-1mm)
#text(fill: muted, d.kennzeichnung)
#if d.entwurf != none {
  v(1mm)
  semibold(text(fill: accent, d.entwurf))
}

// Zwei Spalten Angaben (Label, Wert) unter einer Überschrift
#let angaben(titel, zeilen) = block(breakable: false, {
  semibold(titel)
  v(-1mm)
  table(
    columns: (auto, 1fr),
    stroke: (x, y) => (bottom: 0.4pt + rule),
    inset: (x: 1.2mm, y: 1.6mm),
    ..zeilen.map(z => (text(fill: muted, z.label), z.value)).flatten()
  )
})

// Beträge (Label, Betrag rechts), die letzte Zeile wahlweise hervorgehoben
#let betraege(titel, zeilen) = block(breakable: false, {
  if titel != none { semibold(titel); v(-1mm) }
  table(
    columns: (1fr, auto),
    align: (left, right),
    stroke: (x, y) => (bottom: 0.4pt + rule),
    inset: (x: 1.2mm, y: 1.6mm),
    ..zeilen.map(z => (z.label, z.value)).flatten()
  )
})

#v(3mm)
#angaben("Angaben zur Person und zur Beschäftigung", d.person)
#grid(
  columns: (1fr, 1fr),
  column-gutter: 6mm,
  angaben("Lohnsteuerabzugsmerkmale", d.steuer),
  angaben("Sozialversicherung", d.sv),
)

#block(breakable: false, {
  semibold("Bezüge")
  v(-1mm)
  table(
    columns: (1fr, auto, auto, auto, auto, auto),
    align: (left, left, center, center, center, right),
    stroke: (x, y) => (top: if y == 0 { 0.6pt + accent } else { none }, bottom: 0.4pt + rule),
    inset: (x: 1.2mm, y: 1.6mm),
    table.header(
      ..("Bezeichnung", "Art", "Steuer", "SV", "Gesamtbrutto", "Betrag").map(h => text(fill: muted, size: 8pt, h)),
    ),
    ..d.bezuege.map(b => (b.label, b.art, b.steuer, b.sv, b.gesamt, b.value)).flatten()
  )
})

#betraege("Bruttoentgelte", d.brutto)
#if d.abzuege.len() > 0 { betraege("Gesetzliche Abzüge (laufend)", d.abzuege) }

#block(breakable: false, {
  table(
    columns: (1fr, auto),
    align: (left, right),
    stroke: (x, y) => (top: if y == 0 { 0.6pt + accent } else { none }, bottom: 0.4pt + rule),
    inset: (x: 1.2mm, y: 1.8mm),
    semibold(d.netto.label), semibold(d.netto.value),
    ..if d.zuschuss != none { (d.zuschuss.label, d.zuschuss.value) } else { () },
    semibold(d.auszahlung.label), semibold(d.auszahlung.value),
  )
  if d.ueberweisung != none { text(fill: muted, d.ueberweisung) }
})

#if d.arbeitgeber.len() > 0 {
  betraege("Vom Arbeitgeber getragen (nicht Teil der Auszahlung)", d.arbeitgeber)
}

#v(2mm)
#text(size: 8pt, fill: muted, d.hinweis)
