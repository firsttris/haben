// Gemeinsamer Unterbau der eingebauten Layouts (#113): Seite nach DIN 5008 Form B, Fuß, Anschriftfeld, Infoblock,
// Positionen, Summen und Abschluss. Jedes Layout setzt darauf seinen Stil; die Daten kommen fertig formatiert als JSON über
// sys.inputs.data (Feldvertrag v1, packages/einvoice/src/layout-schema.ts). Hier wird nichts berechnet.

#import "entwurf.typ": entwurf-vermerk, girocode-feld

#let d = json(bytes(sys.inputs.data))
#let legal = d.at("legal", default: none)
#let ink = rgb(d.palette.ink)
#let muted = rgb(d.palette.muted)
#let rule = rgb(d.palette.rule)
#let accent = rgb(d.accent)
// Helle Fläche in der Akzentfarbe, etwa hinter dem Gesamtbetrag
#let accent-soft = accent.lighten(88%)
#let look = d.at("look", default: (logoHeight: 18, logoWidth: 60, logoLeft: false, foldMarks: true, backgroundPages: "erste"))
// Optionen des Layouts aus dem Katalog (packages/core/src/layout-katalog.ts), schon aufgelöst; fehlt eine, gilt der erste Wert
#let optionen = look.at("options", default: (:))
#let option(name, standard) = optionen.at(name, default: standard)
#let font = d.at("font", default: (regular: "Inter", medium: "Inter", semibold: "Inter"))

#let medium(body) = text(font: font.medium, weight: 500, body)
#let semibold(body) = text(font: font.semibold, weight: 600, body)

// Auszeichnungen aus parseTextFormatting (packages/core)
#let run-style(run, inhalt) = {
  let body = inhalt
  if run.bold { body = semibold(body) }
  if run.italic { body = emph(body) }
  if run.underline { body = underline(body) }
  body
}
#let formatted(runs) = {
  for run in runs { run-style(run, text(run.text)) }
}

// Satzspiegel: 25 mm links, 20 mm rechts, Anschriftfeld und Infoblock nach DIN 5008 Form B
#let links = 25mm
#let rechts = 20mm
#let oben = 20mm
#let satzbreite = 210mm - links - rechts

// Nur Wörter, die nicht in die Spalte passen, bekommen Umbruchstellen; Typst bricht sonst nicht innerhalb eines Worts
#let umbruchstellen(wort) = if wort == "" { "" } else { wort.clusters().join("\u{200B}") }
#let umbrechbar(inhalt, breite) = inhalt.split(" ").map(wort => if measure(text(wort)).width > breite { umbruchstellen(wort) } else { wort }).join(" ")
// Angaben nach § 35a GmbHG als eigene Spalte im Fuß, je Angabe eine Zeile (statt einer langen Zeile über die ganze Breite)
#let legal-zeilen = if legal == none { () } else { legal.split(" · ") }
#let fuss-spalten-zahl = d.footer.len() + if legal-zeilen.len() > 0 { 1 } else { 0 }
#let foot-breite = (satzbreite - 6mm * calc.max(fuss-spalten-zahl - 1, 0)) / calc.max(fuss-spalten-zahl, 1)

// Zeile der eigenen Fußzeile: ein Wort über mehrere Auszeichnungen wird als Ganzes gemessen
#let footer-zeile(runs) = {
  let je-zeichen = runs.map(run => run.text.clusters().map(_ => run)).flatten()
  let marken = ()
  let wortanfang = 0
  for wort in runs.map(run => run.text).join("").split(" ") {
    let laenge = wort.clusters().len()
    let teil = je-zeichen.slice(wortanfang, calc.min(wortanfang + laenge, je-zeichen.len()))
    let stuecke = ()
    for (z, run) in wort.clusters().zip(teil) {
      if stuecke.len() > 0 and stuecke.at(-1).run == run { stuecke.at(-1).text += z } else { stuecke.push((run: run, text: z)) }
    }
    let zu-breit = stuecke.len() > 0 and measure(stuecke.map(s => run-style(s.run, text(s.text))).join()).width > foot-breite
    marken += range(laenge).map(_ => zu-breit)
    marken.push(false)
    wortanfang += laenge + 1
  }
  let stelle = 0
  for run in runs {
    let zeichen = run.text.clusters()
    let start = stelle
    run-style(run, text(zeichen.enumerate().map(((i, z)) => if marken.at(start + i, default: false) { z + "\u{200B}" } else { z }).join("")))
    stelle += zeichen.len()
  }
}

#let footer-col(lines, breite: foot-breite) = {
  set text(size: 7pt, fill: muted)
  set par(leading: 0.45em)
  context lines.map(zeile => umbrechbar(zeile, breite)).join(linebreak())
}
#let footer-col-formatted(lines) = {
  set text(size: 7pt, fill: muted)
  set par(leading: 0.45em)
  context lines.map(footer-zeile).join(linebreak())
}
// Unter den Spalten nur noch, wenn ein Layout es so will (legal-unten); die Basis setzt die Angaben als Spalte
#let legal-foot = none

// Fuß: Spalten aus d.footer (oder d.footerFormatted), darunter die Angaben nach § 35a GmbHG; leer, wenn das Briefpapier ihn trägt
#let fuss(linie: true, linie-farbe: rule) = if d.footer.len() == 0 { none } else {
  set block(spacing: 0pt)
  if linie { line(length: 100%, stroke: 0.4pt + linie-farbe) }
  v(3mm)
  grid(
    columns: range(fuss-spalten-zahl).map(_ => 1fr),
    column-gutter: 6mm,
    ..if d.at("footerFormatted", default: none) != none { d.footerFormatted.map(footer-col-formatted) } else { d.footer.map(footer-col) },
    ..if legal-zeilen.len() > 0 { (footer-col(legal-zeilen),) },
  )
}

#let seitenzahl() = context {
  let total = counter(page).final().first()
  if total > 1 {
    v(2.5mm)
    let labels = d.at("labels", default: (page: ("Seite", "von", "")))
    align(right, text(size: 7pt, fill: muted)[#labels.page.at(0) #counter(page).display() #labels.page.at(1) #total#labels.page.at(2)])
  }
}

// Seite: Schrift, Briefpapier, Falz- und Lochmarken, Entwurfsvermerk, Fuß. hintergrund ist ein Stück Gestaltung des Layouts
// hinter allem außer dem Briefpapier (etwa eine Fläche in der Akzentfarbe); der untere Rand wächst mit dem Fuß.
#let seite(groesse: 9.5pt, leading: 0.55em, fuss-linie: true, fuss-farbe: rule, hintergrund: none, body) = {
  set document(title: d.docTitle, author: d.author)
  set text(font: font.regular, size: groesse, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
  set par(leading: leading, spacing: 0.9em)
  let fuss-inhalt = fuss(linie: fuss-linie, linie-farbe: fuss-farbe)
  set page(
    paper: "a4",
    margin: (top: oben, bottom: 34mm, left: links, right: rechts),
    foreground: entwurf-vermerk(d.at("draft", default: none)),
    footer-descent: 10.2mm,
    background: context {
      let bild = d.at("background", default: none)
      if bild != none and (look.backgroundPages == "alle" or counter(page).get().first() == 1) {
        place(top + left, image(bild, width: 100%, height: 100%, fit: "cover"))
      } else if hintergrund != none {
        hintergrund
      }
      if look.foldMarks {
        place(top + left, dx: 4mm, dy: 105mm, line(length: 4mm, stroke: 0.4pt + rule))
        place(top + left, dx: 4mm, dy: 148.5mm, line(length: 6mm, stroke: 0.4pt + rule))
        place(top + left, dx: 4mm, dy: 210mm, line(length: 4mm, stroke: 0.4pt + rule))
      }
    },
    footer: { fuss-inhalt; seitenzahl() },
  )
  context {
    let hoehe(inhalt) = measure(block(width: satzbreite, inhalt)).height
    let pflicht = if legal-foot == none { 0mm } else { hoehe(legal-foot) }
    let rand = calc.max((34mm + pflicht).to-absolute(), hoehe(fuss-inhalt) + 5mm + 10.2mm + 3mm)
    set page(margin: (top: oben, bottom: rand, left: links, right: rechts))
    body
  }
}

// Logo oben im Briefkopf, Stelle und größte Maße aus dem Profil; dy verschiebt es etwa unter eine Kopffläche. „mitte“
// steht mittig auf dem Blatt, nicht im Satzspiegel
#let logo-stelle = look.at("logoPosition", default: if look.logoLeft { "links" } else { "rechts" })
#let logo(dy: 0mm) = if d.at("logo", default: none) != none {
  let ecke = if logo-stelle == "links" { left } else if logo-stelle == "mitte" { center } else { right }
  let dx = if logo-stelle == "mitte" { 105mm - (links + (210mm - links - rechts) / 2) } else { 0mm }
  place(top + ecke, dx: dx, dy: dy, context {
    let hoch = image(d.logo, height: look.logoHeight * 1mm)
    if measure(hoch).width > look.logoWidth * 1mm { image(d.logo, width: look.logoWidth * 1mm) } else { hoch }
  })
}

// Anschriftfeld 45 mm von oben, 85 × 45 mm ab 20 mm von links (DIN 5008 Form B); der Text steht wie Betreff und Tabelle
// auf der Fluchtlinie 25 mm, im Fenster bleibt links 5 mm Luft
#let anschrift(absender-farbe: muted, absender-linie: false) = place(top + left, dx: 0mm, dy: 45mm - oben, box(width: 80mm, height: 45mm, {
  set block(spacing: 0pt)
  box(height: 17.7mm, width: 80mm, align(bottom, pad(bottom: 2mm, {
    text(size: 7pt, fill: absender-farbe, d.senderLine)
    if absender-linie { v(1mm); line(length: 75mm, stroke: 0.4pt + rule) }
  })))
  set par(leading: 0.5em)
  d.recipient.join(linebreak())
}))

// Infoblock: Kerndaten rechts neben der Anschrift (ab 125 mm, Oberkante info-oben), Bezüge zweispaltig über die volle Breite unter
// dem Anschriftfeld. So verträgt jedes Layout jede Länge, auch alle Referenzen nach EN 16931.
// Kerndaten rechts, weitere Referenzen (group „referenz“: Auftrag, Lieferschein, Leitweg-ID …) darunter. Ohne Gruppen (ältere Daten)
// die ersten sechs rechts, der Rest darunter.
#let rechts-max = 6
// Oberkante des Infoblocks: auf Höhe der Absenderzeile im Anschriftfeld (DIN 5008 Form B sähe 50 mm vor, darüber
// stünde er höher als die Anschrift). Bis zum Betreff bei 98,46 mm bleibt Platz für etwa neun Zeilen
#let info-oben = 58mm
#let mit-gruppen = d.meta.any(m => m.at("group", default: none) != none)
#let info-rechts = if mit-gruppen { d.meta.filter(m => m.at("group", default: none) != "referenz") } else { d.meta.slice(0, calc.min(rechts-max, d.meta.len())) }
#let info-rest = if mit-gruppen { d.meta.filter(m => m.at("group", default: none) == "referenz") } else { d.meta.slice(calc.min(rechts-max, d.meta.len())) }

// Ein Zeitraum („01.09.2026 – 30.09.2026“) bricht nicht um; der Wert bekommt seine volle Breite, die Beschriftung den Rest
// Eine Zeile, die nicht in die Breite passt (etwa die IBAN in einer schmalen Randspalte), etwas kleiner statt umbrochen
#let einpassen(inhalt, breite, mindestens: 6pt) = context {
  let natuerlich = measure(inhalt).width
  if natuerlich <= breite { inhalt } else { text(size: calc.max(mindestens, text.size * (breite / natuerlich)), inhalt) }
}
#let zusammen(wert) = wert.replace(" – ", "\u{00A0}–\u{00A0}")
// Beschriftung links, Wert rechtsbündig; passt ein Wert nur neben seine eigene Beschriftung, bekommt die Zeile die ganze
// Breite; passt er gar nicht daneben, steht er in einer eigenen Zeile darunter, statt sich in die Beschriftung zu schieben
#let info-zeilen(zeilen, label-farbe: muted, wert-gewicht: "regular", row-gutter: 2.2mm, column-gutter: 4mm) = layout(platz => {
  let wert(m) = if wert-gewicht == "medium" { medium(zusammen(m.value)) } else { zusammen(m.value) }
  let label(m) = text(fill: label-farbe, m.label)
  let label-breite = calc.max(0pt, ..zeilen.map(m => measure(label(m)).width))
  let zellen = ()
  for m in zeilen {
    let breite = measure(wert(m)).width
    if label-breite + column-gutter + breite <= platz.width {
      zellen.push(label(m))
      zellen.push(align(right, wert(m)))
    } else if measure(label(m)).width + column-gutter + breite <= platz.width {
      // Passt neben die eigene, kürzere Beschriftung (etwa ein langer Leistungszeitraum neben „Leistungsdatum“)
      zellen.push(grid.cell(colspan: 2, grid(columns: (auto, 1fr), column-gutter: column-gutter, label(m), align(right, wert(m)))))
    } else {
      zellen.push(grid.cell(colspan: 2, label(m)))
      zellen.push(grid.cell(colspan: 2, align(right, wert(m))))
    }
  }
  grid(columns: (auto, 1fr), column-gutter: column-gutter, row-gutter: row-gutter, ..zellen)
})

// Rechter Block an seiner Stelle, rechtsbündig mit Tabelle und Logo (bis 190 mm); rahmen umgibt ihn wahlweise (etwa ein Kasten oder eine Linie links)
#let infoblock(groesse: 8.5pt, label-farbe: muted, wert-gewicht: "regular", rahmen: none, dy: 0mm, breite: 210mm - rechts - 125mm) = place(
  top + left,
  dx: 125mm - links,
  dy: info-oben - oben + dy,
  box(width: breite, {
    set text(size: groesse)
    let inhalt = info-zeilen(info-rechts, label-farbe: label-farbe, wert-gewicht: wert-gewicht)
    if rahmen == none { inhalt } else { rahmen(inhalt) }
  }),
)

// Kerndaten zweispaltig, je Angabe Beschriftung über dem Wert; ein Wert, der nicht in die halbe Breite passt (etwa ein
// Leistungszeitraum), bekommt die ganze Breite. angabe(m) setzt eine Angabe, breite ist die Breite des Blocks.
#let info-zweispaltig(zeilen, angabe, breite: 210mm - rechts - 125mm, column-gutter: 5mm, row-gutter: 3.4mm) = context {
  let halb = (breite - column-gutter) / 2
  let zellen = ()
  let spalte = 0
  for m in zeilen {
    let inhalt = angabe(m)
    if measure(inhalt).width > halb {
      // Eine breite Angabe beginnt immer in einer neuen Zeile
      if spalte == 1 { zellen.push([]) }
      zellen.push(grid.cell(colspan: 2, inhalt))
      spalte = 0
    } else {
      zellen.push(inhalt)
      spalte = 1 - spalte
    }
  }
  grid(columns: (1fr, 1fr), column-gutter: column-gutter, row-gutter: row-gutter, ..zellen)
}

// Weitere Angaben im Fluss vor dem Betreff, zweispaltig; leer ohne
// rahmen umgibt den ganzen Block, spalte jede der beiden Spalten (etwa eine Linie davor wie beim Infoblock), trenner ist
// ein Strich zwischen den Spalten; innen ist der Abstand oben und unten, bis zu dem der Strich reicht (bis an einen Rahmen)
#let info-ueberlauf(groesse: 8.5pt, label-farbe: muted, ueberschrift: none, rahmen: none, spalte: none, trenner: none, innen: 0mm) = if info-rest.len() > 0 {
  set text(size: groesse)
  let haelfte = calc.ceil(info-rest.len() / 2)
  let inhalt = {
    if ueberschrift != none { ueberschrift; v(1.5mm) }
    grid(
      columns: (1fr, 1fr),
      column-gutter: if trenner == none { 10mm } else { 5mm },
      // Der Strich ist der linke Rand der zweiten Spalte und reicht so über die volle Höhe beider Spalten
      stroke: (x, y) => if trenner != none and x == 1 { (left: trenner) },
      inset: (x, y) => (top: innen, bottom: innen, left: if trenner != none and x == 1 { 5mm } else { 0pt }),
      ..(info-rest.slice(0, haelfte), info-rest.slice(haelfte)).map(teil => {
        let zeilen = info-zeilen(teil, label-farbe: label-farbe, row-gutter: 1.8mm)
        if spalte == none { zeilen } else { spalte(zeilen) }
      }),
    )
  }
  block(width: 100%, if rahmen == none { inhalt } else { rahmen(inhalt) })
  v(5mm)
}

// Angaben als Tabelle mit Gitter, Beschriftungen auf leichter Fläche (Strukturiert); paare: 2 setzt zwei Paare nebeneinander
#let info-tabelle(zeilen, paare: 1, stroke: 0.4pt + rule, flaeche: accent.lighten(94%), inset: (x: 1.8mm, y: 1.4mm)) = {
  let paar(m) = if m == none { ([], []) } else { (text(fill: muted, m.label), align(right, zusammen(m.value))) }
  let haelfte = calc.ceil(zeilen.len() / paare)
  let zellen = range(haelfte).map(i => range(paare).map(p => paar(zeilen.at(p * haelfte + i, default: none))).flatten()).flatten()
  // Text auf der Fluchtlinie, das Gitter steht wie bei den Positionen um inset.x davor
  pad(left: -inset.x, right: -inset.x, table(
    columns: range(paare).map(_ => (auto, 1fr)).flatten(),
    stroke: stroke,
    inset: inset,
    fill: (x, y) => if calc.even(x) { flaeche },
    ..zellen,
  ))
}

// Betreffzeile bei 98,46 mm von oben; davor wenn nötig der Überlauf des Infoblocks
#let bis-betreff() = v(98.46mm - oben)

#let titel(groesse: 16pt, farbe: ink, schnitt: "semibold", bezug-farbe: muted) = {
  let t = text(size: groesse, fill: farbe, d.title)
  if schnitt == "semibold" { semibold(t) } else if schnitt == "medium" { medium(t) } else { t }
  if d.reference != none {
    v(-1mm)
    text(fill: bezug-farbe, d.reference)
  }
  v(5mm)
}

#let einleitung() = {
  let intro = d.at("intro", default: none)
  if intro != none {
    formatted(d.introFormatted)
    v(4mm)
  }
}

#let cols = d.at("labels", default: (columns: (pos: "Pos.", itemNumber: "Art.-Nr.", description: "Beschreibung", quantity: "Menge", unitPrice: "Einzelpreis", vat: "USt", net: "Netto"))).columns
#let noPrices = d.at("noPrices", default: false)
#let itemNumbers = d.at("itemNumbers", default: false)
#let hideVat = d.at("hideVatColumn", default: false)
#let withItem(cells, item) = if itemNumbers { (cells.at(0), item) + cells.slice(1) } else { cells }

// Tabellen bündig mit dem Text: Ohne Flächen hat die erste Spalte links und die letzte rechts keinen Innenabstand, so stehen
// „Pos.“ und die Beträge genau an den Kanten der Überschrift. Mit Flächen (Kopf als Fläche, Streifen, Gitter) bleibt der Text
// ebenso bündig, und die Fläche ragt um den Innenabstand in den Rand.
#let satz-tabelle(columns: (), inset: (x: 1.6mm, y: 2.2mm), haengend: false, ..args) = {
  let n = columns.len()
  if haengend {
    pad(left: -inset.x, right: -inset.x, table(columns: columns, inset: inset, ..args))
  } else {
    table(columns: columns, inset: (x, y) => (left: if x == 0 { 0pt } else { inset.x }, right: if x == n - 1 { 0pt } else { inset.x }, top: inset.y, bottom: inset.y), ..args)
  }
}

// Positionen. kopf formatiert eine Kopfzelle, stroke und fill kommen vom Layout; Spalte „Art.-Nr.“ nur mit Artikelnummern
// (BT-155), Spalte USt nur bei mehr als einem Satz, auf dem Lieferschein nur Position, Beschreibung und Menge
#let positionen(
  kopf: body => medium(text(size: 8pt, fill: accent, body)),
  stroke: (x, y) => if y == 0 { (bottom: 0.6pt + accent) } else { (bottom: 0.4pt + rule) },
  fill: none,
  inset: (x: 1.6mm, y: 2.2mm),
  tag-farbe: accent,
  haengend: auto,
) = {
  satz-tabelle(
    haengend: if haengend == auto { fill != none } else { haengend },
    columns: withItem(if noPrices { (auto, 1fr, auto) } else if hideVat { (auto, 1fr, auto, auto, auto) } else { (auto, 1fr, auto, auto, auto, auto) }, auto),
    align: withItem(if noPrices { (left, left, right) } else if hideVat { (left, left, right, right, right) } else { (left, left, right, right, right, right) }, left),
    stroke: stroke,
    fill: fill,
    inset: inset,
    table.header(
      ..withItem(if noPrices {
        (kopf(cols.pos), kopf(cols.description), kopf(cols.quantity))
      } else if hideVat {
        (kopf(cols.pos), kopf(cols.description), kopf(cols.quantity), kopf(cols.unitPrice), kopf(cols.net))
      } else {
        (kopf(cols.pos), kopf(cols.description), kopf(cols.quantity), kopf(cols.unitPrice), kopf(cols.vat), kopf(cols.net))
      }, kopf(cols.at("itemNumber", default: "Art.-Nr."))),
    ),
    ..d.lines.map(l => {
      let detail = l.at("detail", default: none)
      let tag = l.at("tag", default: none)
      let discount = l.at("discount", default: none)
      let desc = if detail == none and tag == none and discount == none { l.description } else {
        let parts = ()
        if tag != none { parts.push(medium(text(size: 8pt, fill: tag-farbe, tag))) }
        parts.push(if detail == none and tag == none { l.description } else { medium(l.description) })
        if detail != none { parts.push(text(size: 0.9em, fill: muted, formatted(l.detailFormatted))) }
        if discount != none { parts.push(text(size: 0.9em, fill: muted, discount)) }
        stack(spacing: 1.4mm, ..parts)
      }
      withItem(if noPrices { (l.pos, desc, l.quantity) } else if hideVat { (l.pos, desc, l.quantity, l.unitPrice, l.net) } else { (l.pos, desc, l.quantity, l.unitPrice, l.rate, l.net) }, l.at("itemNumber", default: ""))
    }).flatten()
  )
  v(3mm)
}

#let zeilen-grid(zeilen, label-farbe: muted, wert-farbe: ink, row-gutter: 2.2mm) = grid(
  columns: (1fr, auto),
  align: (left, right),
  row-gutter: row-gutter,
  ..zeilen.map(r => (text(fill: label-farbe, r.label), text(fill: wert-farbe, r.value))).flatten()
)

// Summenblock rechts, mindestens 80 mm, sonst so breit wie die längste Zeile. stil: "linie" (Linie über dem Gesamtbetrag),
// "kasten" (Gesamtbetrag auf einer Fläche) oder "doppellinie"
#let summen(stil: "linie", farbe: accent, flaeche: accent-soft, kasten-text: ink, gesamt-groesse: 1em) = if d.totals != none { context {
  let zeilen = (..d.totals.rows, d.totals.gross)
  let breitest(werte) = calc.max(0pt, ..werte.map(wert => measure(text(wert)).width))
  let inhalt = breitest(zeilen.map(zeile => zeile.label)) + breitest(zeilen.map(zeile => zeile.value)) * (gesamt-groesse / 1em) + 8mm
  let breite = calc.min(satzbreite.to-absolute(), calc.max(80mm.to-absolute(), inhalt.to-absolute()))
  align(right, block(width: breite, breakable: false, {
    set block(spacing: 0pt)
    if d.totals.rows.len() > 0 {
      zeilen-grid(d.totals.rows)
      v(2.2mm)
    }
    let gesamt = grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      semibold(text(size: gesamt-groesse, fill: if stil == "kasten" { kasten-text } else { ink }, d.totals.gross.label)),
      semibold(text(size: gesamt-groesse, fill: if stil == "kasten" { kasten-text } else { ink }, d.totals.gross.value)),
    )
    if stil == "kasten" {
      // Die Fläche ragt in den Rand, der Text bleibt bündig mit den Zeilen darüber
      block(width: 100%, fill: flaeche, inset: (y: 2.6mm), outset: (x: 2mm), gesamt)
    } else if stil == "doppellinie" {
      // Wie in der Buchhaltung: Linie über der Summe, nur der Betrag doppelt unterstrichen
      line(length: 100%, stroke: 0.6pt + farbe)
      v(2.2mm)
      let betrag = semibold(text(size: gesamt-groesse, d.totals.gross.value))
      grid(
        columns: (1fr, auto),
        align: (left + top, right + top),
        semibold(text(size: gesamt-groesse, d.totals.gross.label)),
        context {
          let breite = measure(betrag).width
          stack(spacing: 0pt, betrag, v(1.4mm), line(length: breite, stroke: 0.5pt + farbe), v(0.9mm), line(length: breite, stroke: 0.5pt + farbe))
        },
      )
    } else {
      line(length: 100%, stroke: 0.6pt + farbe)
      v(2.2mm)
      gesamt
    }
    for extra in (d.totals.at("included", default: none), d.totals.at("euroTax", default: none)) {
      if extra != none and extra.rows.len() > 0 {
        v(2.6mm)
        set text(size: 0.9em)
        grid(
          columns: (1fr, auto),
          align: (left, right),
          row-gutter: 1.8mm,
          grid.cell(colspan: 2, text(fill: muted, extra.label + ":")),
          ..extra.rows.map(r => (text(fill: muted, r.label), text(fill: muted, r.value))).flatten()
        )
      }
    }
  }))
  v(8mm)
} }

// Zahlungsplan (Angebot, Auftragsbestätigung), Pflichthinweis ohne Steuerausweis, Zahlung mit GiroCode, Unterschrift
// (Lieferschein) und Hinweis
#let abschluss(kopf: body => medium(text(size: 8pt, fill: accent, body)), stroke: (x, y) => if y == 0 { (bottom: 0.6pt + accent) } else { (bottom: 0.4pt + rule) }) = {
  let plan = d.at("plan", default: none)
  if plan != none {
    block(breakable: false, {
      semibold(plan.title)
      v(1mm)
      satz-tabelle(
        columns: (auto, 1fr, auto, auto),
        align: (left, left, right, right),
        stroke: stroke,
        inset: (x: 1.6mm, y: 1.8mm),
        table.header(kopf(plan.columns.label), kopf(plan.columns.due), kopf(plan.columns.share), kopf(plan.columns.amount)),
        ..plan.rows.map(r => (r.label, r.due, r.share, r.amount)).flatten()
      )
    })
    v(4mm)
  }
  if d.taxNote != none {
    block(breakable: false, semibold(d.taxNote))
    v(2mm)
  }
  let girocode = girocode-feld(d, muted)
  if girocode != none {
    block(breakable: false, grid(columns: (1fr, 24mm), column-gutter: 8mm, align: (left + top, right + top), d.payment, girocode))
  } else if d.payment != none {
    block(breakable: false, d.payment)
  }
  let signature = d.at("signature", default: none)
  if signature != none {
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
  if d.note != none {
    v(2mm)
    formatted(d.noteFormatted)
  }
}

// Mahnung: Anrede, Einleitung, gemahnte Rechnungen, Forderung, Zahlung mit GiroCode, Schluss und Gruß
#let mahnung-inhalt(
  kopf: body => medium(text(size: 8pt, fill: accent, body)),
  stroke: (x, y) => if y == 0 { (bottom: 0.6pt + accent) } else { (bottom: 0.4pt + rule) },
  fill: none,
  summen-stil: "linie",
  haengend: auto,
) = {
  d.salutation
  parbreak()
  formatted(d.introFormatted)
  v(3mm)
  satz-tabelle(
    haengend: if haengend == auto { fill != none } else { haengend },
    columns: (1fr, auto, auto, auto),
    align: (left, right, right, right),
    stroke: stroke,
    fill: fill,
    inset: (x: 1.6mm, y: 2.2mm),
    table.header(kopf[Rechnung], kopf[Rechnungsdatum], kopf[Fällig seit], kopf[Offen]),
    ..d.invoices.map(i => (i.number, i.date, i.due, i.open)).flatten()
  )
  v(3mm)
  align(right, block(width: 95mm, breakable: false, {
    set block(spacing: 0pt)
    zeilen-grid(d.rows)
    v(2.2mm)
    let gesamt = grid(columns: (1fr, auto), align: (left, right), semibold(d.total.label), semibold(d.total.value))
    if summen-stil == "kasten" {
      block(width: 100%, fill: accent-soft, inset: (y: 2.6mm), outset: (x: 2mm), gesamt)
    } else {
      line(length: 100%, stroke: 0.6pt + accent)
      v(2.2mm)
      gesamt
    }
  }))
  v(8mm)
  let girocode = girocode-feld(d, muted)
  if girocode != none {
    block(breakable: false, grid(columns: (1fr, 24mm), column-gutter: 8mm, align: (left + top, right + top), semibold(d.payment), girocode))
  } else {
    block(breakable: false, semibold(d.payment))
  }
  v(2mm)
  formatted(d.closingFormatted)
  v(4mm)
  d.greeting.split("\n").join(linebreak())
}
