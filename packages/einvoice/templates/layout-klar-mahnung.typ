// Klar für Mahnungen (#113): wie das Belegslayout Klar.
#import "layout-basis.typ": *

#show: seite.with(groesse: 9.5pt)

#logo()
#anschrift()
#infoblock(rahmen: inhalt => block(inset: (left: 3mm), stroke: (left: 0.6pt + accent), inhalt))
#bis-betreff()
#info-ueberlauf(spalte: inhalt => block(width: 100%, inset: (left: 3mm), stroke: (left: 0.6pt + accent), inhalt))
#titel(groesse: 17pt)
#mahnung-inhalt()
