# Fristen und Erinnerungen

Unter **Fristen** sammelt Haben alle steuerlichen Termine an einem Ort und erinnert per Kalender-Abo oder E-Mail daran.

## Welche Fristen

| Frist | Datum | Erledigt, sobald |
| --- | --- | --- |
| Umsatzsteuer-Voranmeldung | 10. des Folgemonats (ohne Dauerfristverlängerung), ab dem ersten Buchungsmonat; nicht für Kleinunternehmer | die Voranmeldung echt übermittelt ist |
| Umsatzsteuererklärung, Anlage EÜR, Einkommensteuererklärung | ohne Steuerberater 31. Juli des Folgejahres (§ 149 Abs. 2 AO); für 2020 bis 2023 die verlängerten Fristen (1.11.2021, 31.10.2022, 2.10.2023, 2.9.2024) | die Erklärung echt übermittelt ist |
| Einkommensteuer-Vorauszahlung | 10. März, Juni, September und Dezember | nur Hinweis: ob und wie viel zu zahlen ist, steht im Vorauszahlungsbescheid |
| Einspruchsfrist | ein Monat nach Bekanntgabe eines Bescheids aus dem [ELSTER-Postfach](finanzamt.md#bescheide-aus-dem-elster-postfach) | – |
| ELSTER-Zertifikat | „Gültig bis“ des hochgeladenen Zertifikats | ein neues Zertifikat hochgeladen ist |

Fällt eine Frist auf ein Wochenende oder einen Feiertag im Bundesland der Firma, gilt der nächste Werktag (§ 108 Abs. 3 AO). Die Liste reicht ein Jahr voraus; Offenes aus der Vergangenheit bleibt stehen, bis es erledigt ist, Erledigtes der letzten 60 Tage steht eingeklappt darunter. Ein Klick auf eine Frist führt zur Seite, auf der sie sich erledigen lässt.

Die Einkommensteuererklärung erscheint, sobald [persönliche Angaben](einrichtung.md#persönliche-angaben) hinterlegt sind. Mit Steuerberater gelten längere Fristen; die kennt Haben nicht.

## Kalender-Abo

**Kalender-Abo einrichten** erzeugt einen geheimen Link, den du in deinem Kalender abonnierst (iPhone: Einstellungen › Kalender › Accounts › Kalenderabo; Android über Google Kalender im Browser › Weitere Kalender › Per URL; Thunderbird, Outlook). Jede offene Frist ist ein ganztägiger Termin mit Erinnerung drei Tage vorher und am Morgen des Tages; Erledigtes verschwindet beim nächsten Abgleich.

- Den Link zeigt Haben nur beim Erzeugen; gespeichert ist nur sein SHA-256-Hash. Wer den Link kennt, sieht deine Fristen, sonst nichts.
- **Neuen Link erzeugen** macht den alten ungültig, **Abo beenden** schaltet das Abo ab.
- Manche Kalender übernehmen Erinnerungen aus Abos nicht (etwa Google); dort stellst du sie für den abonnierten Kalender selbst ein.
- Die Links in den Terminen zeigen auf `BETTER_AUTH_URL`.

## Erinnerungen per E-Mail

Mit einem E-Mail-Zugang (siehe [Einrichtung](einrichtung.md#e-mail)) schickt Haben Erinnerungen:

- zu den eingestellten Tagen vor einer offenen Frist (Vorgabe: 7 Tage und 1 Tag vorher, wählbar 14, 7, 3, 1 Tag oder am Tag),
- einmal, wenn eine Voranmeldung oder Erklärung überfällig ist,
- morgens nach 7 Uhr (Berliner Zeit) mit dem stündlichen Hintergrundjob, mehrere Fristen in einer Mail.

Jede Frist und Stufe erinnert nur einmal. War der Server aus, holt der nächste Lauf die engste schon erreichte Stufe nach. Scheitert der Versand, steht der Fehler im Protokoll unter Einstellungen › E-Mail-Versand, und der nächste Lauf versucht es erneut. Gesendete Mails stehen unveränderlich im Protokoll.
