// Klar mit Kerndaten auf Karte (#113) für Mahnungen: die Kerndaten rechts auf einer hellen Karte in der Akzentfarbe, der Absender groß links oben.
// Vorgabe Inter. Anschriftfeld nach DIN 5008 Form B.
#import "layout-basis.typ": *

#show: seite.with(groesse: 9.5pt)

// Ohne Logo steht der Name groß links oben
#if d.at("logo", default: none) == none { place(top + left, dy: 2mm, semibold(text(size: 15pt, fill: accent, d.author))) }
// Logo rechtsbündig mit Infoblock und Tabelle
#logo()
#anschrift()
#infoblock(label-farbe: accent, wert-gewicht: "medium", dy: 0mm, rahmen: inhalt => block(width: 100%, fill: accent.lighten(90%), outset: 3.5mm, radius: 1.6mm, inhalt))
#bis-betreff()
#info-ueberlauf(label-farbe: accent, rahmen: inhalt => block(width: 100%, fill: accent.lighten(90%), outset: 3.5mm, radius: 1.6mm, inhalt))
#titel(groesse: 18pt)
#mahnung-inhalt()
