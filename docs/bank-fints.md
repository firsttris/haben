---
title: "Kontoabruf über FinTS mit PIN und TAN in Haben"
description: >-
  Bankkonten über FinTS (HBCI) direkt bei der Bank abrufen: verbinden, TAN-Verfahren, pushTAN, täglicher Abruf, Fehler und PIN.
---

# Abruf über FinTS

Mit einer eigenen Registrierungsnummer holt Haben die Umsätze über FinTS (früher HBCI) direkt bei der Bank, ohne Enable Banking. Wie die Registrierungsnummer in Haben kommt, steht unter [Kontoabruf über FinTS](installation-anbindungen.md#kontoabruf-über-fints); ohne sie fehlt der Knopf.

1. **Über FinTS verbinden** klicken und Bankleitzahl, FinTS-Adresse der Bank, Anmeldename und PIN eintragen, die Kunden-ID nur, wenn die Bank sie getrennt vom Anmeldenamen nennt. **Umsätze abrufen ab** gilt wie beim [Abruf über Enable Banking](bank.md#automatischer-abruf).
2. Bietet die Bank mehrere TAN-Verfahren an, wählst du eines, etwa pushTAN oder chipTAN manuell. Verlangt das Verfahren ein TAN-Medium und gibt es mehrere, wählst du auch das.
3. Verlangt die Bank eine Freigabe, zeigt Haben ihren Text. Bei chipTAN, smsTAN und ähnlichen trägst du die TAN ein; bei pushTAN oder einer anderen App gibst du dort frei und klickst dann **Freigegeben, weiter**. Für photoTAN zeigt Haben die Grafik der Bank. Eine offene Freigabe wartet zehn Minuten, danach beginnst du neu.
4. Haben ordnet die Konten über die IBAN zu, legt fehlende an und holt sofort die ersten Umsätze, wie beim Abruf über Enable Banking. Konten ohne IBAN oder ohne Umsatzabruf (Kreditkarten, Depots) und Konten in Fremdwährung ruft Haben nicht ab; die Meldung nach dem Verbinden nennt sie.

Haben speichert die PIN verschlüsselt und ruft jede Verbindung einmal täglich im Hintergrund ab; **Jetzt abrufen** holt die Umsätze sofort. Welche Umsätze kommen, steht unter [Welche Umsätze abgerufen werden](bank.md#welche-umsätze-abgerufen-werden). Die Bank liefert gebuchte Umsätze als MT940 oder CAMT.052, Haben nimmt CAMT, wenn die Bank es für das Konto anbietet. Den Kontostand nimmt Haben aus dem Endsaldo des spätesten Tagesauszugs, der zum Abruf passt.

- **TAN nötig:** Auch nur zum Lesen verlangen Banken nach PSD2 in Abständen eine TAN, meist alle 90 bis 180 Tage. Der Abruf im Hintergrund wartet nie darauf: Er hört auf, die Verbindung steht auf **TAN nötig**, und erst **Jetzt abrufen** mit TAN oder Freigabe in der App bringt sie wieder in Gang. Bei pushTAN kommt die Anfrage der Bank dabei trotzdem aufs Handy, je nach Uhrzeit des Abrufs auch nachts; freigeben musst du sie nicht, Haben wartet nicht auf sie.
- **Fehler:** Lehnt die Bank ab, etwa weil die PIN nicht mehr stimmt, steht die Verbindung auf **Fehler** mit dem Text der Bank, und der Hintergrund versucht es nicht wieder: Nach wenigen falschen PINs sperren Banken den Zugang. Mit **Zugang ändern** trägst du die neue PIN ein; der neue Zugang löst den alten ab und macht beim Abrufstand weiter. Ist die Bank nur nicht erreichbar, bleibt die Verbindung aktiv, und Haben versucht es am nächsten Tag wieder.
- **Ein Konto, ein Abruf:** Verbindest du über FinTS ein Konto, das bisher Enable Banking abruft, holt es ab dann FinTS, und umgekehrt; eine Zustimmung bei Enable Banking ohne Konten endet. Beide Wege schreiben den Verwendungszweck verschieden, über beide abgerufen kämen Umsätze doppelt.
- **Trennen** löscht PIN und Bankdaten. Die abgerufenen Umsätze bleiben.
