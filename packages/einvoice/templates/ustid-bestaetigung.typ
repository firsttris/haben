// Antwort des BZSt zur Bestätigung einer ausländischen USt-IdNr. (§ 18e Nr. 1 UStG, #1491): Anfrage, Ergebnis, bei der
// qualifizierten Abfrage gesendete Angaben mit dem Vergleich je Angabe, am Ende der empfangene Datensatz. Alle Texte kommen
// fertig formatiert als JSON über sys.inputs.data; hier wird nichts berechnet. Schlicht ohne Logo wie die Bilanz zur Hinterlegung.

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
    set text(size: 8pt, fill: muted)
    grid(columns: (1fr, auto), d.erstellt, [Seite #counter(page).display() von #counter(page).final().first()])
  },
)

#semibold(text(size: 15pt, d.title))
#v(-1mm)
#text(fill: muted, d.untertitel)

#v(3mm)
#block(width: 100%, stroke: 0.4pt + rule, inset: 3mm, radius: 1mm, d.hinweis)

#let abschnitt(titel) = {
  v(5mm)
  semibold(titel)
  v(-1mm)
}
#let paare(items) = table(
  columns: (48mm, 1fr),
  stroke: (x, y) => (bottom: 0.4pt + rule),
  inset: (x: 0mm, y: 2mm),
  ..items.map(p => (text(fill: muted, p.label), p.value)).flatten()
)

#abschnitt("Anfrage")
#paare(d.anfrage)

#abschnitt("Ergebnis")
#paare(d.ergebnis)

#if d.angaben != none {
  abschnitt("Name und Anschrift")
  table(
    columns: (48mm, 1fr, 40mm),
    stroke: (x, y) => (bottom: 0.4pt + rule),
    inset: (x: 0mm, y: 2mm),
    table.header(text(fill: muted, "Angabe"), text(fill: muted, "Gesendet"), text(fill: muted, "Ergebnis")),
    ..d.angaben.map(a => (text(fill: muted, a.label), a.gesendet, a.ergebnis)).flatten(),
  )
}

#abschnitt("Empfangener Datensatz")
#text(size: 8pt, d.datensatz.join(linebreak()))
