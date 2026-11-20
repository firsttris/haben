# Beispiel-Lieferungen zum Importvertrag (#306)

Lieferungen im Format von `packages/import/src/importvertrag/types.ts`, keine Antworten der Anbieter; Kennungen, Namen
und Beträge sind erfunden. Sie zeigen, wie ein Connector die Daten seines Anbieters abbildet.

- `ebay.json`: Zahlungsdienstleister. Verkauf als Hauptbetrag plus Gebühr, Teilerstattung mit Bezug auf den Verkauf und
  Gutschrift der Gebühr, Shop-Abo als eigene Gebühr, Auszahlung als Geldtransit. Alle Bewegungen zusammen ergeben 0.
  Die Ereigniscodes `SALE`, `REFUND` und `NON_SALE_CHARGE` sind Transaktionstypen der
  [Finances API](https://developer.ebay.com/develop/api/sell/finances_api/transaction/gettransactions#sell-finances_api-transaction-gettransactions.transactiontypeenum);
  die Auszahlung kommt dort aus
  [`getPayouts`](https://developer.ebay.com/api-docs/sell/finances/resources/payout/methods/getPayouts) und hat deshalb
  keinen Ereigniscode.
- `enablebanking.json`: Bankkonto. Zwei gleichartige Kartenzahlungen am selben Tag mit verschiedenen `entry_reference`,
  eine Bewegung vor dem Stichtag 2026-10-01, der Eingang der eBay-Auszahlung und ein gebuchter Umsatz ohne
  `entry_reference`, den der Connector nicht einordnet. Nach der
  [API-Referenz](https://enablebanking.com/docs/api/reference/) ist `entry_reference` eindeutig für Konten mit demselben
  `identification_hash`, `transaction_id` kann sich ändern; als Kontokennung dient deshalb der `identification_hash`.
- `etsy.json` (von @Niruthan96, Aufbau nach dem echten Zahlungsverlauf): Zahlungsdienstleister, bei dem jede Gebühr
  und die von Etsy abgeführte Sales Tax eine eigene Zeile mit eigener `entry_id` haben
  ([getShopPaymentAccountLedgerEntries](https://developers.etsy.com/documentation/reference/#operation/getShopPaymentAccountLedgerEntries),
  Zeilenarten nach der [Auswertung in #306](https://github.com/Speicherstadt/haben/issues/306#issuecomment-6900551383)). Sie
  sind deshalb eigene Ereignisse mit der Komponente `main` (Art `fee`, die Steuer `adjustment`), verbunden über
  `orderId`, die der Connector ergänzt, wo der Verlauf sie nicht nennt; eine eigene Komponente für die Steuer braucht es
  nicht. Der Saldo vom 30.09. ist der Anfangsstand vor dem Fenster, die Tagessalden folgen aus den Bewegungen.
- `paypal.json`: Zahlungsdienstleister mit dem Beispiel aus #306 (+100,00 € Zahlung, −3,00 € Gebühr), Teilerstattung,
  Abbuchung auf die Bank, ein ausstehendes Ereignis, das der Connector nicht einordnet, und eine nachträglich
  zurückgebuchte Zahlung (Status V): Die Zahlung bleibt gebucht, die Rückbuchung ist ein eigenes Ereignis mit
  `relatedEventId` ([abgestimmt in #306](https://github.com/Speicherstadt/haben/issues/306#issuecomment-6897475489)). Codes
  nach den [T-Codes](https://developer.paypal.com/reports/reference/t-codes) (T0006 Zahlung über Express Checkout, T1107
  Erstattung, T1106 Rückbuchung durch PayPal, T0400 Abbuchung auf das Bankkonto) und `transaction_status` P (ausstehend)
  und V (zurückgebucht) unter [List transactions](https://developer.paypal.com/api/transaction-search/v1/search-get).
- `stripe.json`: Zahlungsdienstleister, Balance Transactions aus
  [`GET /v1/balance_transactions`](https://docs.stripe.com/api/balance_transactions/list) mit
  `stripeBatch` abgebildet. Zahlung mit Gebühr als Hauptbetrag plus Gebührenkomponente (`amount` brutto, `fee`
  positiv, `net` = Betrag − Gebühr), Erstattung ohne Gebühr, Stripe-Rechnung als eigene Gebühr, eine Zahlung mit
  `status: pending` (nur noch nicht verfügbar, trotzdem übernommen), Auszahlung mit `payoutId` aus der Quelle
  (`po_…`) und ein Transfer, den der Connector nicht einordnet und der den Zeitraum offen lässt. Buchungstag ist der Tag
  von `created` in UTC wie im CSV-Export „Balance history“; Kennung ist die `txn_…`-ID.
