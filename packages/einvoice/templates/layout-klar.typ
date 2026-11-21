// Klar: das Standardlayout (#113). Ruhige serifenlose Schrift (Vorgabe Inter), Infoblock als Tabelle mit feinen Linien,
// die Akzentfarbe nur als Linie unter dem Tabellenkopf und über dem Gesamtbetrag. Nach DIN 5008 Form B.
#import "layout-basis.typ": *

#show: seite.with(groesse: 9.5pt)

#logo()
#anschrift()
#infoblock(rahmen: inhalt => block(inset: (left: 3mm), stroke: (left: 0.6pt + accent), inhalt))
#bis-betreff()
#info-ueberlauf(spalte: inhalt => block(width: 100%, inset: (left: 3mm), stroke: (left: 0.6pt + accent), inhalt))
#titel(groesse: 17pt)
#einleitung()
#positionen()
#summen()
#abschluss()
