---
title: "Kontoabruf über die Vivid Business API in Haben"
description: >-
  Konten bei Vivid Business mit einem API-Schlüssel abrufen: verbinden, 90 Tage, vorgemerkte Kartenzahlungen und was die API nicht nennt.
---

# Abruf über Vivid

Konten bei Vivid Business holt Haben über deren eigene [API](https://api.prime.vivid.money/sme-integration/docs/), ohne Enable Banking und ohne FinTS. Dafür brauchst du einen API-Schlüssel aus Vivid ([Anbindungen](installation-anbindungen.md#kontoabruf-über-vivid)).

1. Unter **Bank** **Vivid verbinden** klicken, den API-Schlüssel einfügen und **Verbinden**.
2. Haben ordnet die Konten in Euro über die IBAN zu, legt fehlende an („Vivid Hauptkonto …1234“) und holt sofort die Umsätze. Danach ruft es einmal täglich ab; **Jetzt abrufen** holt sie sofort.

Was dabei gilt:

- **Zeitraum:** Vivid gibt nur die letzten 90 Tage heraus. Der erste Abruf beginnt wie oben unter [Welche Umsätze abgerufen werden](bank.md#welche-umsätze-abgerufen-werden), aber nie früher; ältere Umsätze importierst du per Datei, die Meldung nach dem Verbinden nennt den Zeitraum. Jeder Abruf liest alle 90 Tage und erkennt schon abgerufene Umsätze an ihrer Kennung bei Vivid, nie vor dem Tag nach dem letzten Umsatz aus einer Datei oder einem anderen Abruf.
- **Vorgemerkte Kartenzahlungen** übernimmt Haben erst, wenn Vivid sie bucht, dann mit dem Tag der Zahlung und dem endgültigen Betrag. Das gilt auch für eine Zahlung, die vor dem Beginn des Abrufs freigegeben und erst danach gebucht wurde: Eine Datei bis zum Vortag kennt sie nicht. Das Importprotokoll nennt sie; steht sie doch schon aus einer Datei da, ist sie doppelt. Abgelehnte Zahlungen kommen nie.
- **Tag:** Vivid nennt keinen Buchungstag, nur den Zeitpunkt der Zahlung aus deiner Sicht, bei Karten die Freigabe. Haben nimmt dessen Tag in deutscher Zeit; er kann vom Buchungstag im Kontoauszug abweichen.
- **Verwendungszweck und Gegenseite:** Die API nennt beides nicht. Bei Kartenzahlungen steht der Händler als Gegenseite, im Zweck Art, Karte, Ort und Betrag in Fremdwährung; bei Überweisungen nur „Überweisung“. Die [Vorschläge](bank.md#vorschläge) gehen dort nur nach Betrag.
- **Kontostand:** Vivid nennt nur den verfügbaren Betrag, keinen gebuchten Saldo. Haben übernimmt keinen und prüft keine Salden.
- **Rechte:** Beim Verbinden prüft Haben, ob der Schlüssel Konten und Umsätze lesen darf, bevor ein Konto von Enable Banking oder FinTS zu Vivid wechselt.
- **Schlüssel abgelehnt:** Ist der Schlüssel abgelaufen (nach höchstens 180 Tagen), gelöscht oder fehlt ihm ein Recht, steht die Verbindung auf **Schlüssel abgelehnt**, und der tägliche Abruf ruht. Mit **Vivid verbinden** und einem neuen Schlüssel macht Haben dort weiter, wo es aufgehört hat; die alte Verbindung fällt weg.
- Ein Konto ruft Haben nur über einen Weg ab: Kam es bisher über Enable Banking oder FinTS, fällt es dort heraus. **Trennen** löscht den Schlüssel in Haben; in Vivid gilt er, bis du ihn dort löschst.
