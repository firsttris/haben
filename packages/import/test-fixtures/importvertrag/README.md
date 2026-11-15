# Beispiel-Lieferungen zum Importvertrag (#306)

Erfundene Lieferungen nach `packages/import/src/importvertrag/types.ts`, keine Antworten der Anbieter: Kennungen,
Namen und Beträge sind ausgedacht. Sie zeigen, wie ein Connector die Daten seines Anbieters abbildet.

- `ebay.json`: Zahlungsdienstleister. Verkauf als Hauptbetrag plus Gebühr, Teilerstattung mit Bezug auf den Verkauf und
  Gutschrift der Gebühr, Shop-Abo als eigene Gebühr, Auszahlung als Geldtransit. Alle Bewegungen zusammen ergeben 0.
- `enablebanking.json`: Bankkonto. Zwei gleichartige Kartenzahlungen am selben Tag mit verschiedenen `entry_reference`,
  eine Bewegung vor dem Stichtag 2026-10-01 und der Eingang der eBay-Auszahlung.
- `paypal.json`: Zahlungsdienstleister mit dem Beispiel aus #306 (+100,00 € Zahlung, −3,00 € Gebühr), Teilerstattung,
  Abbuchung auf die Bank und ein ausstehendes Ereignis, das der Connector nicht einordnet.
