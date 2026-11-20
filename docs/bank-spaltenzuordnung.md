---
title: "Kontoauszug einer anderen Bank: Spalten zuordnen"
description: >-
  CSV-Kontoauszüge von Banken ohne eigenes Format in Haben importieren: Spalten einmal zuordnen, Vorschau, gespeichert je Konto.
---

# Andere Banken: Spalten zuordnen

Erkennt Haben eine CSV nicht, meldet es „Haben kennt diese Bank nicht“ mit dem Knopf **Spalten zuordnen**. Das betrifft etwa einen älteren Export der Deutschen Bank, Norisbank oder Postbank (bis Anfang 2024); den liest Haben [bewusst nicht als eigenes Format](bank.md#unterstützte-formate). Im Dialog wählst du das **Konto**; die Datei nennt keine eigene IBAN, Konten von Zahlungsdienstleistern stehen nicht zur Wahl. Kopfzeile, Spalten und Zahlenformat schlägt Haben vor:

- **Buchungstag und Betrag** sind Pflicht. Der Betrag steht in einer Spalte mit Vorzeichen oder in zwei Spalten für Soll und Haben; Soll gilt als Ausgang, auch ohne Minus.
- **Gegenseite:** Name, IBAN und Verwendungszweck. Eine IBAN übernimmt Haben nur mit gültiger Prüfziffer.
- **Weitere Spalten** (Wertstellung, Währung, Buchungsart, Referenz), **Kopfzeile** und **Zahlenformat** (`1.234,56` oder `1,234.56`) sind eingeklappt. Als Kopfzeile schlägt Haben die erste Zeile ohne Datum mit den meisten gefüllten Zellen vor, auch hinter einem Kopfblock wie „Umsätze Girokonto“ oder „Zeitraum …“.

Jede Auswahl zeigt neben dem Spaltennamen einen Wert aus der Datei, die Vorschau darüber rechnet nach jeder Änderung neu. Zeilen mit Fehlern übernimmt Haben nicht; sie stehen in der Vorschau oben und nach dem Import als Hinweis. Das sind etwa ein Kontostand am Ende der Datei, eine Zeile mit Soll und Haben zugleich, ein Betrag von 0,00 € und eine andere Währung als Euro: Bankkonten führt Haben nur in Euro.

Haben speichert die Zuordnung am Konto und sagt es in der Meldung nach dem Import. Der nächste Export mit genau derselben Kopfzeile geht ohne Dialog durch, wenn neben dem Import unter **Konto** dieses Konto gewählt ist; [Dubletten](bank.md#dubletten) erkennt Haben wie bei jeder anderen Datei. Jede Meldung eines solchen Imports hat den Knopf **Zuordnung ändern**: Der Dialog öffnet sich mit der gespeicherten Zuordnung, und eine geänderte gilt ab diesem Import. Änderst du Buchungstag, Betrag (auch Soll und Haben), IBAN, Verwendungszweck oder Zahlenformat, weist der Dialog darauf hin, dass Haben schon importierte Umsätze dann nicht mehr als Dubletten erkennt. Ändert die Bank ihre Spalten, meldet Haben wieder „Haben kennt diese Bank nicht“, und du ordnest neu zu. Salden nennt die Zuordnung nicht, die [Saldenprüfung](bank.md#saldenprüfung) entfällt.
