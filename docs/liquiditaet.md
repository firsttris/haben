---
title: "Liquiditätsvorschau: Kontostand der nächsten Wochen und Monate"
description: >-
  Erwarteter Kontostand aus offenen Posten, Dauerbelegen, wiederkehrenden Rechnungen, Umsatzsteuer und
  Vorauszahlungen, mit Tiefpunkt und Sicherheit je Posten.
---

# Liquiditätsvorschau

Die Liquiditätsvorschau (`/auswertungen/liquiditaet`, im Kopf der Auswertungen „Liquidität“) zeigt, wie sich der Kontostand in den nächsten 4 oder 13 Wochen bzw. 6 oder 12 Monaten entwickelt: oben Kontostand heute, Tiefpunkt mit Datum, Stand am Ende und Rücklage, darunter die Kurve je Tag und die Tabelle je Woche (Montag bis Sonntag) bzw. Kalendermonat mit Anfang, Eingängen, Ausgängen, Ende und tiefstem Stand. Der Zeitraum mit dem Tiefpunkt ist hervorgehoben; ein Klick auf einen Zeitraum zeigt seine Posten mit Datum, Sicherheit und Link zur Quelle. Die Vorschau rechnet nur und bucht nichts. Horizont, Schalter und aufgeklappter Zeitraum stehen in der Adresse. Die Steuerberatung sieht die Seite auch; Links auf Seiten, die sie nicht öffnen kann, stehen als Text.

**Start** ist die Summe der Kontostände von Geschäfts-, Steuer- und Zahlungsdienstleisterkonten: der Schlusssaldo des letzten Kontoauszugs oder Abrufs, beim Zahlungsdienstleister die Summe seiner Umsätze. Rücklagekonten stehen nur daneben, private und ausgeschlossene Konten zählen nicht. Ein Hinweis nennt Konten ohne Saldo (etwa Dateien ohne Kontostand), Stände, die älter als drei Tage sind, und noch nicht zugeordnete Umsätze: Deren Rechnung oder Beleg steht sonst noch als offen in der Vorschau.

| Posten | Termin | Sicherheit |
| --- | --- | --- |
| Offene Rechnungen, bei GmbH und UG auch [Anforderungen vor der Leistung](buchhaltung.md#anzahlungen-vor-leistung) und zu erstattende Anzahlungen | Fälligkeit; überfällige am nächsten Werktag, überfällige Eingänge per Schalter ausblendbar | erwartet, überfällige geschätzt |
| Offene Belege mit Zahlung „Bank“ | Fälligkeit, ohne sie das Belegdatum | fest |
| Abgegebene Voranmeldungen | Fälligkeit wie unter [Offene Posten](auswertungen.md#offene-posten) | Zahllast fest, Erstattung erwartet |
| Aktive [Dauerbelege](belege.md#dauerbelege) mit Zahlung „Bank“ | jeder Termin ab dem nächsten, plus Zahlungsziel | erwartet |
| Aktive [wiederkehrende Rechnungen](rechnungen.md#wiederkehrende-rechnungen) | jeder Termin ab dem nächsten, plus Zahlungsziel | erwartet |
| Umsatzsteuer der noch nicht abgegebenen Zeiträume | [Fälligkeit](umsatzsteuer.md#fälligkeit) des Zeitraums | geschätzt |
| Sondervorauszahlung bei Dauerfrist und monatlicher Abgabe | wie unter [Fristen](fristen.md#welche-fristen) | angemeldet fest, sonst geschätzt wie im Vorjahr |
| Vorauszahlungen zu Einkommensteuer, Soli und Kirchensteuer | wie unter [Fristen](fristen.md#welche-fristen) | wie zuletzt gezahlt erwartet, aus der Prognose geschätzt |
| Vorauszahlungen zu Körperschaftsteuer und Soli | 10. März, Juni, September, Dezember (§ 31 Abs. 1 KStG) | wie zuletzt gezahlt erwartet |
| Gewerbesteuer-Vorauszahlung | 15. Februar, Mai, August, November (§ 19 Abs. 1 GewStG) | wie zuletzt gezahlt erwartet |

**Fest** heißt, Betrag und Termin stehen; **erwartet**, der Betrag kommt aus Rechnung, Voranmeldung, Vorlage oder letzter Zahlung, ob und wann er fließt, ist offen; **geschätzt**, Haben hat den Betrag gerechnet. Steuertermine verschieben sich wie unter [Fristen](fristen.md#welche-fristen) auf den nächsten Werktag. Überfällige Belege und überfällige Umsatzsteuer stehen heute.

**Umsatzsteuer:** Für jeden Zeitraum ohne abgegebene Voranmeldung, auch einen künftigen, nimmt Haben die Werte, die seine Voranmeldung heute hätte (im letzten Zeitraum des Jahres abzüglich der Sondervorauszahlung); bei Sollversteuerung steckt darin schon die Steuer gestellter Rechnungen für spätere Leistungen. Dazu zählt die Steuer der Posten, die im Zeitraum entsteht: bei Istversteuerung die Umsatzsteuer offener und wiederkehrender Rechnungen am erwarteten Zahlungseingang, bei Sollversteuerung die wiederkehrender Rechnungen im Monat der Leistung (Leistungszeitraum der Vorlage), dazu der betriebliche Teil der Vorsteuer aus Dauerbelegen mit ausgewiesener Steuer am Belegdatum. Kleinunternehmer haben keine.

**Vorauszahlungen:** Die Beträge aus den Bescheiden kennt Haben nicht. Es schreibt je Steuerart die letzte im Bankabgleich zugeordnete Zahlung fort, die als Steuer für das Jahr der Zahlung erfasst ist und höchstens 400 Tage zurückliegt; Nachzahlungen für frühere Jahre zählen nicht. Ein Termin bis 30 Tage nach dieser Zahlung gilt als bezahlt. Ist weder Einkommensteuer noch Soli oder Kirchensteuer so gezahlt, steht ein Viertel der [Steuerprognose](finanzamt.md#steuerprognose) samt Soli und Kirchensteuer, sobald persönliche Angaben hinterlegt sind; mit „Keine Einkommensteuer-Vorauszahlungen festgesetzt“ gar nichts. Im Einzelunternehmen tragen Einkommensteuer, Soli und Kirchensteuer den Vermerk „privat“ (§ 12 Nr. 3 EStG); sie stehen trotzdem in der Vorschau, weil sie meist vom Geschäftskonto gehen.

Grenzen:

- Löhne, Darlehensraten, Privatentnahmen, Zahlungspläne aus Angeboten und das Zahlungsverhalten je Kunde fehlen noch.
- Gewerbesteuer ohne frühere Zahlung fehlt bei jeder Rechtsform, Körperschaftsteuer ohne frühere Zahlung bei GmbH und UG; für sie gibt es keine Prognose des laufenden Jahres.
- Sondervorauszahlung und Vorauszahlungen mit Termin vor heute fehlen, auch wenn sie noch nicht gezahlt sind.
- Bei Sollversteuerung steht die Steuer einer Anforderung im Zeitraum der Leistung, nicht im Monat des Zahlungseingangs, in dem sie schon entsteht (§ 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG); die Summe stimmt, nur der Monat kann abweichen.
- Ein Beleg aus einem Dauerbeleg, der noch „Zu prüfen“ ist, fehlt, bis er gebucht ist.
- Bei einer wiederkehrenden Rechnung im Modus „Entwurf“ fehlt der angelegte Entwurf, bis er festgeschrieben ist; sein Termin zählt schon nicht mehr als wiederkehrend.
