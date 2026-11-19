# Antworten der Transaction Search (nachgebaut)

`transaktionen.json`: eine Antwort von `GET /v1/reporting/transactions?fields=all` im Aufbau der
[API-Referenz](https://developer.paypal.com/api/transaction-search/v1/) (`transaction_details` mit `transaction_info` und
`payer_info`). **Keine echten Antworten:** Kennungen, Namen, Beträge und Zeitpunkte sind erfunden, der Aufbau folgt dem
Schema von PayPal. Es gab beim Bau keinen Zugang zur Sandbox; die Fixture ersetzt keinen Test gegen echte Antworten.
Offen sind deshalb vor allem das Vorzeichen von `fee_amount` (hier wie in der CSV-Spalte „Gebühr“: bei einer Zahlung
negativ) und das Zeitzonenformat von `transaction_initiation_date` (hier beide Schreibweisen, `+0000` und `+00:00`).

Die zehn Zeilen:

- `9XY12345AB678901C` Zahlung (T0006) mit Gebühr, `8WV23456BC789012D` Teilerstattung (T1107) mit Bezug und zurückgegebener Gebühr
- `7UT34567CD890123E` Abbuchung auf das Bankkonto (T0400)
- `6SR45678DE901234F` ausstehend (`P`), `4ON67890FG123456H` abgelehnt (`D`)
- `5QP56789EF012345G` nachträglich zurückgebucht (`V`) und `0KJ01234KL567890M` die Rückbuchung (T1106) mit Bezug darauf
- `3NM78901GH234567J` Zahlung in US-Dollar, `2ML89012HJ345678K` Massenzahlung (T0001, wird nicht eingeordnet)
- `1LK90123JK456789L` Zahlung um 22:30 UTC, in Berlin schon am nächsten Tag
