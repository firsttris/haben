// Eingefroren mit v1/rechnung.typ und v1/mahnung.typ: Ein eigenes Layout bringt alles mit, was es importiert; nie ändern.
// Gemeinsame Teile für Entwürfe (Issue #342). Die Texte kommen fertig formatiert aus den Daten.

// Großes „ENTWURF“ quer über jede Seite. Als Vordergrund der Seite liegt es über Inhalt, Hintergrund und Briefpapier,
// keine Gestaltung kann es verdecken. Grau mit 15 % Deckung hält den Inhalt lesbar; auffälliger wäre Rot,
// etwa rgb(200, 30, 30, 45).
#let entwurf-vermerk(wort) = if wort != none {
  place(center + horizon, rotate(-45deg, text(font: "IBM Plex Sans SmBld", size: 110pt, fill: rgb(0, 0, 0, 38), wort)))
}

// GiroCode unter der Zahlungsaufforderung. Im Entwurf steht an seiner Stelle ein gestrichelter Platzhalter gleicher
// Größe: Umbruch und Abstände wie im endgültigen PDF, aber nichts, womit jemand einen Entwurf bezahlt.
#let girocode-feld(d, muted) = {
  let qr = d.at("qr", default: none)
  let platzhalter = d.at("qrPlaceholder", default: none)
  if qr == none and platzhalter == none { return none }
  box(width: 24mm, {
    if qr != none {
      image(bytes(qr), format: "svg", width: 24mm)
    } else {
      rect(
        width: 24mm,
        height: 24mm,
        inset: 2mm,
        stroke: (paint: muted, thickness: 0.5pt, dash: "dashed"),
        align(center + horizon, text(size: 6.5pt, fill: muted, platzhalter)),
      )
    }
    v(1mm)
    align(center, text(size: 6.5pt, fill: muted)[GiroCode])
  })
}
