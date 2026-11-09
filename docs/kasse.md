---
title: "Kassenbuch für Bargeld führen"
description: >-
  Ein GoBD-konformes Kassenbuch: jede Bargeldbewegung mit fortlaufender Nummer, Datum, Betrag und
  Bestand, gebucht nach SKR03 oder SKR04.
---

# Kassenbuch

Unter **Kasse** führst du das Kassenbuch für Bargeld: jede Bewegung mit fortlaufender Nummer, Datum, Text, Betrag und dem Bestand danach. Wer nur selten bar bezahlt, braucht es meist nicht; privat ausgelegte Belege laufen über **Privat bezahlt** (siehe [Belege](belege.md#bezahlung)).

## Was ins Kassenbuch kommt

| Art | Buchung (SKR03, SKR04 in Klammern) | Wann |
| --- | --- | --- |
| Beleg | Aufwand und Vorsteuer an 1000 Kasse (1600) | automatisch beim Buchen eines Belegs mit **Bar aus der Kasse** |
| Rechnung bar bezahlt | 1000 Kasse an 1400 Forderungen (1600 an 1200) | ein Kunde bezahlt eine Ausgangsrechnung bar, siehe [unten](#rechnung-bar-bezahlt) |
| Einlage | 1000 Kasse an 1890 Privateinlagen (1600 an 2180) | privates Geld in die Kasse, z. B. Wechselgeld |
| Entnahme | 1800 Privatentnahmen an 1000 Kasse (2100 an 1600) | Geld aus der Kasse für private Zwecke |
| Abhebung von der Bank | 1000 Kasse an 1360 Geldtransit (1600 an 1460) | Geld vom Geschäftskonto in die Kasse |
| Einzahlung auf die Bank | 1360 Geldtransit an 1000 Kasse (1460 an 1600) | Geld aus der Kasse auf das Geschäftskonto |

In einer GmbH oder UG heißen Einlage und Entnahme „Vom Gesellschafter“ und „An den Gesellschafter“ und buchen gegen das Gesellschafter-Verrechnungskonto (SKR03 0730, SKR04 3510), siehe [Rechtsform](einrichtung.md#rechtsform-einzelunternehmen-gmbh-oder-ug).

Bei Abhebung und Einzahlung ordnest du den Umsatz auf dem Bankkonto im [Bankabgleich](bank.md) als **Geldtransit** zu; dann ist das Geldtransitkonto wieder ausgeglichen.

## Rechnung bar bezahlt

Bezahlt ein Kunde eine Rechnung bar, wählst du unter **Eintragen** die Art **Rechnung bar bezahlt**, dann die Rechnung, das Datum und den Betrag. Zur Auswahl stehen festgeschriebene Rechnungen in Euro mit offenem Betrag; der Betrag ist mit dem offenen vorbelegt. Auf der Seite einer offenen Rechnung führt **Barzahlung in der Kasse erfassen** unter **Zahlungen** direkt hierher, mit der Rechnung schon gewählt.

- **Gebucht wie eine Zahlung im Bankabgleich**, nur Kasse statt Bank: Kasse an Forderungen. Bei **Ist-Versteuerung** wird die Umsatzsteuer mit der Bareinnahme fällig und steht in der Voranmeldung des Monats, in dem du das Geld bekommen hast (§ 13 Abs. 1 Nr. 1 Buchst. b UStG); bei einer Teilzahlung anteilig je Steuersatz wie im [Bankabgleich](bank.md). Bei **Soll-Versteuerung** ist die Steuer schon mit der Rechnung angemeldet. In der [Anlage EÜR](jahreserklaerung.md) zählt die Bareinnahme am Tag der Bareinnahme.
- **Teilzahlung:** Ein kleinerer Betrag lässt den Rest offen; die Rechnung ist dann teilbezahlt und bleibt in den [offenen Posten](auswertungen.md), im [Mahnwesen](rechnungen.md#mahnwesen) und im Bankabgleich mit dem Rest. Mehr als offen lehnt Haben ab.
- **Vor dem Rechnungsdatum:** Hat der Kunde schon bar bezahlt, bevor du die Rechnung schreibst, etwa einzelne Leistungen vor einer Sammel- oder Monatsrechnung, trägst du die Bareinnahme mit ihrem tatsächlichen Datum ein, sobald die Rechnung festgeschrieben ist. Das geht wie im Bankabgleich. Bei **Ist-Versteuerung** zählt die Umsatzsteuer im Monat der Bareinnahme (§ 13 Abs. 1 Nr. 1 Buchst. b UStG), auch wenn die Rechnung erst später kommt; ist die Voranmeldung dieses Monats schon gesendet, weist die Seite des Monats auf die Abweichung hin (siehe [Umsatzsteuer](umsatzsteuer.md)). Bei **Soll-Versteuerung** bleibt die Steuer bei der Rechnung. In der EÜR zählt der Zufluss am Tag der Bareinnahme (§ 11 Abs. 1 EStG).
- **Skonto:** Bleibt ein Rest, kannst du ihn mit **Rest als Skonto ausbuchen** als gewährtes Skonto ausbuchen, am Datum der Bareinnahme und gebucht wie [Ausbuchen](rechnungen.md#ausbuchen). Zahlt der Kunde in der Frist genau den Betrag mit Skonto, ist das Häkchen schon gesetzt; die Fristen der Rechnung stehen mit **Betrag mit Skonto übernehmen** darunter. Die Frist wahrt wie im Bankabgleich auch eine Zahlung am nächsten Werktag, wenn sie an einem Wochenende oder Feiertag endet.
- **Auf der Rechnung** steht die Zahlung unter **Zahlungen** als „bar“ mit der Nummer im Kassenbuch; die Rechnung ist bezahlt, sobald nichts mehr offen ist.
- **Storno:** **Stornieren** in der Liste schreibt eine Gegenzeile mit neuer Nummer und heutigem Datum und bucht gegen (Forderungen an Kasse, bei Ist die Umsatzsteuer zurück auf „nicht fällig“). Die Rechnung ist danach wieder offen, ein mit der Bareinnahme ausgebuchtes Skonto wird mit aufgehoben. Auch hier darf der Kassenbestand nicht negativ werden.

**Warum im Kassenbuch:** Bisher musste bar erhaltenes Geld erst auf das Konto eingezahlt und dort der Rechnung zugeordnet werden. Dann stimmten Kassenbuch und Kassenbestand nicht mit dem Bargeld überein, und bei Ist-Versteuerung fiel die Umsatzsteuer in den Monat der Einzahlung statt in den Monat, in dem das Geld vereinnahmt war. Die Bareinnahme bucht jetzt den Zahlungseingang dort, wo er stattfindet. Ein Kassensystem für den Ladenverkauf wird Haben damit nicht: Jede Bareinnahme gehört zu einer schon festgeschriebenen Rechnung, Haben zeichnet keine Verkäufe an der Kasse auf.

Eine Bareinnahme gehört zu genau einer Rechnung. Bezahlt ein Kunde mehrere Rechnungen auf einmal bar, trägst du je Rechnung eine Zeile ein; so steht jede Quittung für sich im Kassenbuch.

## Regeln

- Jede Zeile wird sofort gebucht und festgeschrieben. Ändern oder Löschen geht nicht (GoBD), auch nicht in der Datenbank.
- Eine falsche Zeile hebst du mit **Stornieren** auf: Haben schreibt eine Gegenzeile mit neuer Nummer und heutigem Datum und bucht gegen. Danach trägst du sie richtig neu ein. Bar bezahlte Belege sind gebucht und lassen sich hier nicht stornieren; das geht am Beleg selbst mit **Beleg stornieren**, dann schreibt Haben die Gegenzeile ins Kassenbuch (siehe [Belege](belege.md#stornieren-und-neu-erfassen)).
- Der Kassenbestand darf an keinem Tag negativ sein. Würde eine Zeile ihn ins Minus bringen, auch an einem späteren Tag, lehnt Haben sie mit dem Datum ab. Trage dann zuerst die Einlage oder Abhebung ein.
- Datum in der Zukunft ist nicht möglich.

**Anfangsbestand aus der Eröffnung (GmbH und UG):** Bucht die [Eröffnung aus dem DATEV-Stapel](lexoffice.md#eröffnung-aus-dem-datev-stapel-gmbh-und-ug) einen Kassenbestand, ist er der Anfangsbestand des Jahres im Kassenbuch. Er bekommt keine eigene Zeile und wird nicht noch einmal gebucht; du erfasst ihn also nicht zusätzlich als Einlage. Er zählt für die Prüfung, dass der Bestand nicht negativ wird. Würde ein Storno der Eröffnung den Bestand an einem Tag negativ machen, lehnt Haben ihn ab.

Zähle die Kasse regelmäßig und vergleiche mit **Bestand heute**. Weicht etwas ab, klärst du es mit einer Einlage oder Entnahme samt Text.

## Auswertungen

- In der [Anlage EÜR](jahreserklaerung.md) zählt ein bar bezahlter Beleg am Belegdatum, eine bar bezahlte Rechnung am Tag der Bareinnahme. Einlagen, Entnahmen und Geldtransit sind keine Einnahmen oder Ausgaben.
- **CSV herunterladen** liefert das Kassenbuch des gewählten Jahres mit Anfangsbestand, bei Bareinnahmen mit der Rechnungsnummer in der Spalte „Rechnung“. Im [Jahresarchiv](auswertungen.md) liegt es unter `kasse/kassenbuch.csv`. Im DATEV-Export trägt die Buchung einer Bareinnahme die Rechnungsnummer als Belegfeld.

## Grenzen

- Bareinnahmen nur auf Ausgangsrechnungen in Euro, nicht auf Stornorechnungen und nicht in Fremdwährung. Erstattest du einem Kunden nach einem Storno Geld, geht das über die Bank (Zuordnung zur Stornorechnung im [Bankabgleich](bank.md)). Einnahmen ohne Rechnung (Barverkauf über eine Registrierkasse) erfasst Haben nicht, siehe nächster Punkt.
- Keine Registrierkasse und keine Kassensicherungsverordnung (TSE); Haben ist kein Kassensystem für den Ladenverkauf.
- Eine Kasse je Unternehmen.
