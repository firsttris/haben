# Antworten von Stripe (Testmodus)

`sandbox-balance-transactions.json`: sechs Balance Transactions aus einem Stripe-Testkonto, so wie `StripeClient` sie
liefert (`GET /v1/balance_transactions` mit `expand[]=data.source.charge`, `source` als ID,
`relatedTransactionId` aus der aufgeklappten Zahlung). Beträge, Zeitpunkte, Arten und Gebühren sind unverändert,
Kennungen sind durch erfundene ersetzt, Bezeichnungen mit Namen oder Rechnungsnummern ebenfalls.

- Zahlung (`charge`) und `payment` (SEPA/Karte über ein Zahlungsobjekt `py_…`), beide mit Gebühr
- Erstattung (`refund`) mit Bezug auf die Zahlung
- Streit (`adjustment`, Kategorie `dispute`): Betrag −48,00 €, Streitgebühr 15,00 €, Netto −63,00 €, mit Bezug auf die Zahlung
- Auszahlung (`payout`)
