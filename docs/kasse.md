# Kassenbuch

Unter **Kasse** führst du das Kassenbuch für Bargeld: jede Bewegung mit fortlaufender Nummer, Datum, Text, Betrag und dem Bestand danach. Wer nur selten bar bezahlt, braucht es meist nicht; privat ausgelegte Belege laufen über **Privat bezahlt** (siehe [Belege](belege.md#bezahlung)).

## Was ins Kassenbuch kommt

| Art | Buchung (SKR03, SKR04 in Klammern) | Wann |
| --- | --- | --- |
| Beleg | Aufwand und Vorsteuer an 1000 Kasse (1600) | automatisch beim Buchen eines Belegs mit **Bar aus der Kasse** |
| Einlage | 1000 Kasse an 1890 Privateinlagen (1600 an 2180) | privates Geld in die Kasse, z. B. Wechselgeld |
| Entnahme | 1800 Privatentnahmen an 1000 Kasse (2100 an 1600) | Geld aus der Kasse für private Zwecke |
| Abhebung von der Bank | 1000 Kasse an 1360 Geldtransit (1600 an 1460) | Geld vom Geschäftskonto in die Kasse |
| Einzahlung auf die Bank | 1360 Geldtransit an 1000 Kasse (1460 an 1600) | Geld aus der Kasse auf das Geschäftskonto |

Bei Abhebung und Einzahlung ordnest du den Umsatz auf dem Bankkonto im [Bankabgleich](bank.md) als **Geldtransit** zu; dann ist das Geldtransitkonto wieder ausgeglichen.

## Regeln

- Jede Zeile wird sofort gebucht und festgeschrieben. Ändern oder Löschen geht nicht (GoBD), auch nicht in der Datenbank.
- Eine falsche Zeile hebst du mit **Stornieren** auf: Haben schreibt eine Gegenzeile mit neuer Nummer und heutigem Datum und bucht gegen. Danach trägst du sie richtig neu ein. Bar bezahlte Belege sind gebucht und lassen sich hier nicht stornieren.
- Der Kassenbestand darf an keinem Tag negativ sein. Würde eine Zeile ihn ins Minus bringen, auch an einem späteren Tag, lehnt Haben sie mit dem Datum ab. Trage dann zuerst die Einlage oder Abhebung ein.
- Datum in der Zukunft ist nicht möglich.

Zähle die Kasse regelmäßig und vergleiche mit **Bestand heute**. Weicht etwas ab, klärst du es mit einer Einlage oder Entnahme samt Text.

## Auswertungen

- In der [Anlage EÜR](jahreserklaerung.md) zählt ein bar bezahlter Beleg am Belegdatum. Einlagen, Entnahmen und Geldtransit sind keine Einnahmen oder Ausgaben.
- **CSV herunterladen** liefert das Kassenbuch des gewählten Jahres mit Anfangsbestand. Im [Jahresarchiv](auswertungen.md) liegt es unter `kasse/kassenbuch.csv`.

## Grenzen

- Keine Bareinnahmen aus Rechnungen. Bezahlt ein Kunde bar, zahlst du das Geld auf das Konto ein und ordnest die Zahlung dort der Rechnung zu.
- Keine Registrierkasse und keine Kassensicherungsverordnung (TSE); Haben ist kein Kassensystem für den Ladenverkauf.
- Eine Kasse je Unternehmen.
