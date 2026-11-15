# Beispiel-Lieferungen zum Importvertrag (#306)

Erfundene Lieferungen nach `packages/import/src/importvertrag/types.ts`, keine Antworten der Anbieter: Kennungen,
Namen und Beträge sind ausgedacht. Sie zeigen, wie ein Connector die Daten seines Anbieters abbildet.

- `ebay.json`: Zahlungsdienstleister. Verkauf als Hauptbetrag plus Gebühr, Teilerstattung mit Bezug auf den Verkauf und
  Gutschrift der Gebühr, Shop-Abo als eigene Gebühr, Auszahlung als Geldtransit. Alle Bewegungen zusammen ergeben 0.
  Die Ereigniscodes `SALE`, `REFUND` und `NON_SALE_CHARGE` sind Transaktionstypen der
  [Finances API](https://developer.ebay.com/api-docs/sell/finances/types/pay:TransactionTypeEnum); die Auszahlung kommt
  dort aus [`getPayouts`](https://developer.ebay.com/api-docs/sell/finances/resources/payout/methods/getPayouts) und hat
  deshalb keinen Ereigniscode.
- `enablebanking.json`: Bankkonto. Zwei gleichartige Kartenzahlungen am selben Tag mit verschiedenen `entry_reference`,
  eine Bewegung vor dem Stichtag 2026-10-01, der Eingang der eBay-Auszahlung und ein gebuchter Umsatz ohne
  `entry_reference`, den der Connector nicht einordnet. Nach der
  [API-Referenz](https://enablebanking.com/docs/api/reference/) ist `entry_reference` eindeutig für Konten mit demselben
  `identification_hash`, `transaction_id` kann sich ändern; als Kontokennung dient deshalb der `identification_hash`.
- `paypal.json`: Zahlungsdienstleister mit dem Beispiel aus #306 (+100,00 € Zahlung, −3,00 € Gebühr), Teilerstattung,
  Abbuchung auf die Bank und ein ausstehendes Ereignis, das der Connector nicht einordnet. Codes nach
  [Transaction Event Codes](https://developer.paypal.com/docs/transaction-search/transaction-event-codes/) (T0006 Zahlung,
  T1107 Erstattung durch den Händler, T0400 Abbuchung) und dem Status P (ausstehend) der
  [Transaction Search API](https://developer.paypal.com/docs/api/transaction-search/v1/).
