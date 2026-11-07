// Ausdruck der elektronischen Lohnsteuerbescheinigung nach dem amtlichen Muster (BMF-Schreiben vom 29.8.2025 für 2026):
// links Arbeitnehmer, Kopfdaten, Lohnsteuerabzugsmerkmale und Arbeitgeber, rechts die Zeilen 1 bis 34 mit Beträgen. Alle
// Texte und Beträge kommen fertig formatiert als JSON über sys.inputs.data, hier wird nichts berechnet.

#let d = json(bytes(sys.inputs.data))
#import "entwurf.typ": entwurf-vermerk

#let ink = rgb(d.palette.ink)
#let muted = rgb(d.palette.muted)
#let rule = rgb(d.palette.rule)

#let semibold(body) = text(font: "IBM Plex Sans SmBld", body)

#set document(title: d.docTitle, author: d.author)
#set text(font: "IBM Plex Sans", size: 7.5pt, fill: ink, lang: "de", region: "de", number-type: "lining", number-width: "tabular")
#set par(leading: 0.45em, spacing: 0.7em)
#set page(
  paper: "a4",
  margin: (top: 12mm, bottom: 14mm, left: 15mm, right: 15mm),
  // Entwurf: Vermerk über jeder Seite (entwurf.typ), damit ein ausgedrucktes Blatt nicht als Ausdruck durchgeht
  foreground: entwurf-vermerk(if d.entwurf != none { "ENTWURF" }),
  footer: context {
    set text(size: 6.5pt, fill: muted)
    grid(columns: (1fr, auto), d.erstellt, [Seite #counter(page).display() von #counter(page).final().first()])
  },
)

#semibold(text(size: 11pt, d.title))
#if d.untertitel != none { linebreak(); d.untertitel }
#if d.entwurf != none { linebreak(); semibold(d.entwurf) }

#v(2mm)
#let kasten(titel, body) = block(width: 100%, stroke: 0.4pt + rule, inset: 2mm, radius: 1mm, {
  if titel != none { text(fill: muted, titel); v(0.5mm) }
  body
})
#let paare(items) = table(
  columns: (auto, 1fr),
  stroke: none,
  inset: (x: 0mm, y: 0.9mm),
  column-gutter: 2mm,
  ..items.map(p => (text(fill: muted, p.label), p.value)).flatten()
)

#grid(
  columns: (68mm, 1fr),
  column-gutter: 5mm,
  {
    kasten(none, d.arbeitnehmer.join(linebreak()))
    v(2mm)
    kasten(none, paare(d.kopf))
    v(2mm)
    kasten("Für den letzten Lohnzahlungszeitraum wurden folgende Lohnsteuerabzugsmerkmale zugrunde gelegt:", paare(d.merkmale))
    if d.merkmaleHinweis != none { v(1mm); text(size: 6.5pt, fill: muted, d.merkmaleHinweis) }
    v(2mm)
    kasten("Anschrift und Steuernummer des Arbeitgebers:", d.arbeitgeber.join(linebreak()))
  },
  {
    table(
      columns: (auto, 1fr, auto),
      align: (x, y) => if x == 2 { right + bottom } else { left + bottom },
      stroke: (x, y) => (bottom: 0.4pt + rule),
      inset: (x: 1mm, y: 1.1mm),
      table.header(text(fill: muted, ""), text(fill: muted, ""), text(fill: muted, "EUR, Ct")),
      ..d.zeilen.map(z => (z.nr, z.text, z.wert)).flatten(),
    )
    v(2mm)
    kasten("Finanzamt, an das die Lohnsteuer abgeführt wurde (Name und vierstellige Nr.)", d.finanzamt)
  },
)
