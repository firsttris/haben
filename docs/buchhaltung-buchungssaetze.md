---
title: "Buchungssätze in Haben: was bei jedem Vorgang gebucht wird"
description: >-
  Die Buchungssätze von Haben je Vorgang, in SKR03 und SKR04: Rechnung, Storno, Zahlungseingang, Beleg,
  Zahlung, Bankumsatz ohne Beleg, Anlagen und AfA, Pauschalen und Lohn.
---

# Buchungssätze

Die Tabellen zeigen je Vorgang die Zeilen einer Buchung. Bei mehreren Steuersätzen entstehen Erlös-, Aufwands- und Steuerzeilen je Satz; Zeilen mit 0 € entfallen. Negative Beträge (Storno, Korrektur, Gutschrift, Rückzahlung) drehen Soll und Haben.

## Rechnung festschreiben

Beim Festschreiben einer Ausgangsrechnung, gebucht auf das Rechnungsdatum. Beschreibung: `Rechnung <Nummer> · <Kunde>`.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1400 Forderungen | 1200 Forderungen | brutto | |
| 8400 / 8300 / 8200 Erlöse | 4400 / 4300 / 4200 Erlöse | | netto je Satz |
| Soll: 1776 / 1771 Umsatzsteuer | Soll: 3806 / 3801 Umsatzsteuer | | Steuer je Satz |
| Ist: 1766 / 1761 USt nicht fällig | Ist: 3816 / 3811 USt nicht fällig | | Steuer je Satz |

Rechnungen ohne Steuerausweis (siehe [Rechnungen](rechnungen.md#umsatzsteuer-auf-der-rechnung)) haben keine Steuerzeile und gehen auf ein eigenes Erlöskonto, bei Ist- wie bei Soll-Versteuerung. Beispiel Reverse Charge über 1.000,00 €:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1400 Forderungen | 1200 Forderungen | 1.000,00 | |
| 8336 Erlöse Reverse Charge | 4336 Erlöse Reverse Charge | | 1.000,00 |

Leistungen ins Drittland gehen auf 8338 bzw. 4338, steuerfreie Umsätze nach § 4 UStG auf 8100 bzw. 4100, Kleinunternehmer-Rechnungen auf 8195 bzw. 4185.

## Stornorechnung und Rechnungskorrektur

Eine Stornorechnung ist eine neue Rechnung mit allen Positionen der ursprünglichen, negativ, und wird sofort festgeschrieben. Eine Rechnungskorrektur entsteht als Entwurf mit negativen Positionen, die angepasst werden; sie muss den Betrag mindern. Beide bekommen eine eigene Nummer, verweisen auf die ursprüngliche Rechnung, übernehmen deren Umsatzsteuer-Behandlung und werden wie oben gebucht, mit gedrehten Seiten:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 8400 / 8300 / 8200 Erlöse | 4400 / 4300 / 4200 Erlöse | netto je Satz | |
| 1776 / 1771 bzw. 1766 / 1761 | 3806 / 3801 bzw. 3816 / 3811 | Steuer je Satz | |
| 1400 Forderungen | 1200 Forderungen | | brutto |

Buchungsdatum ist das Datum der Storno- bzw. Korrekturrechnung.

War die ursprüngliche Rechnung schon bezahlt, bleibt die Stornorechnung mit dem gezahlten Betrag offen. Die Rückzahlung wird ihr im Bankabgleich zugeordnet und wie ein Zahlungseingang mit negativem Betrag gebucht (Forderungen an Bank, bei Ist-Versteuerung zusätzlich Umsatzsteuer an „Umsatzsteuer nicht fällig“). Bei aus Lexoffice übernommenen Rechnungen gehen Storno und Korrektur gegen den Saldenvortrag statt gegen die Erlöse, auch das Storno einer Korrektur dazu, siehe [Eröffnungsbuchungen](#eröffnungsbuchungen-für-offene-posten-aus-lexoffice). Bei Soll-Versteuerung meldet die Voranmeldung die Korrektur im Monat der Korrektur mit Bemessungsgrundlage und Steuer (§ 17 UStG); die Zeile gegen den Saldenvortrag trägt dafür je Steuersatz den Steuerschlüssel.

## Zahlungseingang auf eine Rechnung

Beim Zuordnen eines Bankumsatzes zu einer Rechnung im [Bankabgleich](bank.md), gebucht auf den Buchungstag des Umsatzes. Beschreibung: `Zahlung <Nummer> · <Gegenpartei>`.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1200 Bank | 1800 Bank | Zahlbetrag | |
| 1400 Forderungen | 1200 Forderungen | | Zahlbetrag |

Bei Ist-Versteuerung kommt die Umbuchung des Steueranteils dazu:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1766 / 1761 USt nicht fällig | 3816 / 3811 USt nicht fällig | Steueranteil je Satz | |
| 1776 / 1771 Umsatzsteuer | 3806 / 3801 Umsatzsteuer | | Steueranteil je Satz |

Der Steueranteil ist Zahlbetrag mal Steuer durch Bruttobetrag der Rechnung, je Satz gerundet; ein Rundungsrest geht auf den Satz mit der größten Bemessungsgrundlage. Bezahlt ein Kunde in Raten, wird jede Rate so gebucht.

## Beleg buchen

Beim Buchen eines Eingangsbelegs, gebucht auf das Belegdatum. Beschreibung: `Beleg <Rechnungsnummer> · <Lieferant>`. Die Beträge je Satz kommen vom Beleg, Haben rechnet die Steuer nicht nach.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| Aufwandskonto der Kategorie | Aufwandskonto der Kategorie | netto je Satz | |
| 1576 / 1571 Vorsteuer | 1406 / 1401 Vorsteuer | Steuer je Satz | |
| Zahlung „Bank“: 1600 Verbindlichkeiten | Zahlung „Bank“: 3300 Verbindlichkeiten | | brutto |
| Zahlung „privat“: 1890 Privateinlagen | Zahlung „privat“: 2180 Privateinlagen | | brutto |
| Zahlung „Kasse“: 1000 Kasse | Zahlung „Kasse“: 1600 Kasse | | brutto |

Ein privat oder bar aus der [Kasse](kasse.md) bezahlter Beleg ist damit erledigt. Ein über die Bank zu zahlender bleibt als Verbindlichkeit offen, bis die Zahlung im Bankabgleich zugeordnet ist. Gutschriften (negative Beträge) drehen die Seiten.

Bist du als Kleinunternehmer eingetragen, entfällt die Vorsteuerzeile: Der Bruttobetrag je Satz geht mit dem Steuerschlüssel `keineVSt` auf das Aufwandskonto. Ob mit oder ohne Vorsteuerabzug gebucht wurde, speichert Haben am Beleg (`documents.vorsteuer_abzug`), damit Voranmeldung und EÜR auch nach einem späteren Wechsel stimmen.

## Zahlung eines Belegs

Beim Zuordnen eines Bankumsatzes zu einem gebuchten Beleg, gebucht auf den Buchungstag. Beschreibung: `Zahlung Beleg <Nummer> · <Lieferant>`.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1600 Verbindlichkeiten | 3300 Verbindlichkeiten | Zahlbetrag | |
| 1200 Bank | 1800 Bank | | Zahlbetrag |

## Bankumsätze ohne Rechnung oder Beleg

Im Bankabgleich lassen sich Umsätze ohne Rechnung oder Beleg einer dieser Arten zuordnen; die drei Lohnzahlungen nur über das, was eine festgeschriebene [Lohnabrechnung](#lohnabrechnung) als Verbindlichkeit gebucht hat und noch offen ist (ein Eingang nur, soweit überzahlt). Gebucht wird Bank gegen ein Gegenkonto, auf den Buchungstag. Bei einem Ausgang (negativer Betrag) steht die Bank im Haben, bei einem Eingang im Soll.

| Art | Gegenkonto SKR03 | Gegenkonto SKR04 | Ausgang | Eingang |
| --- | --- | --- | --- | --- |
| Privat | 1800 Privatentnahmen bzw. 1890 Privateinlagen | 2100 Privatentnahmen bzw. 2180 Privateinlagen | Entnahme an Bank | Bank an Einlage |
| Geldtransit (eigenes Konto) | 1360 | 1460 | Geldtransit an Bank | Bank an Geldtransit |
| Umsatzsteuer an das Finanzamt | 1780 | 3820 | Vorauszahlung an Bank | Bank an Vorauszahlung (Erstattung) |
| Sondervorauszahlung (Dauerfristverlängerung) | 1781 | 3830 | Sondervorauszahlung an Bank | Bank an Sondervorauszahlung (Erstattung) |
| Kapitalertragsteuer an das Finanzamt (Ausschüttung, nur GmbH und UG) | 1746 | 3760 | Verbindlichkeit an Bank | Bank an Verbindlichkeit |
| Kontoführung und Bankgebühren | 4970 | 6855 | Gebühren an Bank | Bank an Gebühren |
| Mahngebühren und Verzugszinsen | 2650 Sonstige Zinsen und ähnliche Erträge | 7100 | – | Bank an Zinserträge, ohne Umsatzsteuer |
| Zinserträge (Guthabenzinsen auf ein betriebliches Konto) | 2650 Sonstige Zinsen und ähnliche Erträge | 7100 | – | Bank an Zinserträge, ohne Umsatzsteuer |
| Steuerzahlung oder Erstattung | nach Steuerart, Bezugsjahr und Teil, siehe [Steuerzahlungen](bank-steuern-darlehen.md#steuerzahlungen) | ebenso | Steuerkonto an Bank | Bank an Steuerkonto |
| Einnahme oder Ausgabe (Kategorie, Steuersatz) | Erlöse 8400/8300 mit Umsatzsteuer 1776/1771, Kleinunternehmer 8195, Ausgaben auf das Konto der Kategorie, siehe [Auf eine Kategorie buchen](bank.md#auf-eine-kategorie-buchen) | 4400/4300 mit 3806/3801, 4185, Konto der Kategorie | Aufwand an Bank (ohne Vorsteuer), Erlösminderung | Bank an Erlöse und Umsatzsteuer |
| Darlehen: Auszahlung, Tilgung, Zinsen, Gebühren | Darlehenskonto (0630–0650, 1705–1708), Zinsen 2110/2120/2126, Gebühren 2141, siehe [Darlehen](bank-steuern-darlehen.md#darlehen) | 3150–3170, 3560–3567, 7310/7320/7326, 7355 | Tilgung, Zinsen, Gebühren an Bank | Bank an Darlehen (Auszahlung) |
| Lohn/Gehalt an Mitarbeiter | 1740 Verbindlichkeiten aus Lohn und Gehalt | 3720 | Verbindlichkeit an Bank | Bank an Verbindlichkeit (Rückzahlung) |
| Lohnsteuer an das Finanzamt | 1741 Verbindlichkeiten aus Lohn- und Kirchensteuer | 3730 | Verbindlichkeit an Bank | Bank an Verbindlichkeit (Erstattung) |
| SV-Beiträge an Krankenkasse oder Minijob-Zentrale | 1742 Verbindlichkeiten im Rahmen der sozialen Sicherheit | 3740 | Verbindlichkeit an Bank | Bank an Verbindlichkeit (Erstattung) |

Eine Steuerzahlung trägt Steuerart (`allocations.tax_type`), Bezugsjahr (`tax_year`) und Teil (`tax_item`: Steuer, Zinsen nach § 233a AO, §§ 234, 237 AO oder § 235 AO, Säumnis- oder Verspätungszuschlag); die drei Angaben sind mit der Zuordnung gesperrt und versiegelt, eine Aufhebung übernimmt sie in die Gegenzeile. Kontierung und EÜR folgen daraus (`packages/core/src/steuerzahlung.ts`), Buchungszeilen ohne Steuerschlüssel: Eine Steuerzahlung erzeugt weder Umsatz noch Vorsteuer. In der EÜR (Einzelunternehmen, nach Zahlung) zählt die Umsatzsteuer früherer Jahre als gezahlte bzw. erstattete Umsatzsteuer, Zinsen und Zuschläge zur Umsatzsteuer als übrige Betriebsausgaben, Erstattungszinsen zur Umsatz- und Gewerbesteuer als Einnahme (BFH, Urteil vom 26.09.2025, IV R 16/23); Gewerbesteuer samt Nachzahlungszinsen und Zuschlägen mindert den Gewinn nicht (§ 4 Abs. 5b EStG) und steht wie Hinterziehungszinsen (§ 4 Abs. 5 Satz 1 Nr. 8a EStG) nur nachrichtlich da; private Steuern sind Entnahmen. Der [Abgleich](buchhaltung.md#abgleich-von-journal-umsatzsteuer-und-eür) vergleicht die Steuerkonten im Journal mit diesen Posten.

Beispiel Bankgebühr von 9,90 € in SKR03:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 4970 Nebenkosten des Geldverkehrs | 6855 Nebenkosten des Geldverkehrs | 9,90 | |
| 1200 Bank | 1800 Bank | | 9,90 |

## Zuordnung aufheben

Eine Zuordnung wird nicht gelöscht. Haben legt eine Gegenzeile mit negativem Betrag an (`allocations.reverses_id`) und bucht eine Gegenbuchung mit allen Zeilen der ursprünglichen Buchung, Soll und Haben vertauscht. Sie verweist über `reverses_id` auf die ursprüngliche Buchung, trägt die Beschreibung `Storno: …` und das Datum des Bankumsatzes. Danach ist der Umsatz wieder offen und kann neu zugeordnet werden.

## Eröffnungsbuchungen für offene Posten aus Lexoffice

Beim [Umzug aus Lexoffice](lexoffice.md) lassen sich unbezahlte Rechnungen und Eingangsbelege übernehmen. Erlös bzw. Aufwand stehen schon in den alten Büchern, deshalb bucht Haben gegen den Saldenvortrag, auf den Tag nach dem [Stichtag](lexoffice.md#stichtag), den ersten Tag in Haben (meist den 1. Januar). Übernommen wird, was am Stichtag offen war, auch wenn es danach bezahlt wurde.

Offene Rechnung bei Ist-Versteuerung (die Steuer ist noch nicht angemeldet und wird mit dem Zahlungseingang fällig):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1400 Forderungen | 1200 Forderungen | brutto | |
| 1766 / 1761 USt nicht fällig | 3816 / 3811 USt nicht fällig | | Steuer je Satz |
| 9000 Saldenvorträge | 9000 Saldenvorträge | | netto |

Offene Rechnung bei Soll-Versteuerung (die Steuer ist schon angemeldet):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1400 Forderungen | 1200 Forderungen | brutto | |
| 9000 Saldenvorträge | 9000 Saldenvorträge | | brutto |

Offener Eingangsbeleg (die Vorsteuer ist schon angemeldet):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 9000 Saldenvorträge | 9000 Saldenvorträge | brutto | |
| 1600 Verbindlichkeiten | 3300 Verbindlichkeiten | | brutto |

Die spätere Zahlung wird wie jede andere gebucht. Für die Voranmeldung zählt bei Soll-Versteuerung eine übernommene Rechnung nicht noch einmal, ebenso wenig die Vorsteuer eines übernommenen Belegs. Steht schon eine [Eröffnung aus dem DATEV-Stapel](lexoffice.md#eröffnung-aus-dem-datev-stapel-gmbh-und-ug) nach dem Belegdatum, entfällt die Buchung: Der Posten steckt im Saldo der Forderungen bzw. Verbindlichkeiten der Eröffnung. Umgekehrt rechnet der Vorschlag der Eröffnung vorher übernommene Posten heraus.

## Anlagen und AfA

Ein Beleg mit der Kategorie „Anlagegut“ bucht den Nettobetrag auf das Anlagekonto statt in den Aufwand (ohne Vorsteuerabzug den Bruttobetrag). Zum Jahresende bucht **AfA … buchen** je Anlage AfA-Konto an Anlagekonto, beim Abgang zusätzlich den Restbuchwert (2310 bzw. 6895) an Anlagekonto. Übernommene Anlagen bekommen mit der ersten AfA ihre Eröffnung Anlagekonto an 9000. Konten und Beispiele stehen unter [Anlagen und AfA](anlagen.md).

## Pauschalen ohne Beleg

Homeoffice-Tage, Fahrten mit dem Privatfahrzeug und Verpflegungsmehraufwand bucht Haben beim Eintragen als Aufwand an Privateinlage (1890 bzw. 2180):

| Pauschale | SKR03 | SKR04 |
| --- | --- | --- |
| Homeoffice-Tagespauschale | 4288 | 6348 |
| Fahrten mit dem Privatfahrzeug | 4673 | 6673 |
| Verpflegungsmehraufwand | 4674 | 6674 |

Ein Storno ist eine Gegenbuchung am selben Tag. Sätze und Grenzen stehen unter [Pauschalen](pauschalen.md).

## Lohnabrechnung

Beim Festschreiben einer [Lohnabrechnung](lohn.md#buchung), gebucht auf den letzten Tag des abgerechneten Monats, ohne Steuerschlüssel. Beschreibung: `Lohn <Monat> · <Name>`. Die Konten stehen so im DATEV-Kontenrahmen 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175; `LOHN_KONTEN` in `packages/core/src/lohn-buchung.ts`):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 4120 Gehälter, 4124 Geschäftsführergehälter der GmbH-Gesellschafter bzw. 4195 Löhne für Minijobs | 6020, 6024 bzw. 6035 | Brutto | |
| 4130 Gesetzliche soziale Aufwendungen bzw. im Minijob 4144 Soziale Abgaben für Minijobber | 6110 bzw. 6171 | Anteile des Arbeitgebers, Umlagen U1, U2, Insolvenzgeld | |
| 4194 Pauschale Steuer für Minijobber | 6036 | Pauschsteuer 2 % | |
| 1740 Verbindlichkeiten aus Lohn und Gehalt | 3720 | | Auszahlung |
| 1741 Verbindlichkeiten aus Lohn- und Kirchensteuer | 3730 | | Lohnsteuer, Soli, Kirchensteuer |
| 1742 Verbindlichkeiten im Rahmen der sozialen Sicherheit | 3740 | | Anteile beider Seiten, Umlagen, im Minijob die Pauschsteuer |

Beispiel Beschäftigter mit 4.000,00 € im Oktober 2026 (Steuerklasse I ohne Kinderfreibetrag, vier Kinder unter 25 in der Pflegeversicherung, Zusatzbeitrag 3,1 %, Umlagen 1,6 % und 0,44 %), SKR04:

| Konto | Soll | Haben |
| --- | --- | --- |
| 6020 Gehälter | 4.000,00 | |
| 6110 Gesetzliche soziale Aufwendungen | 937,60 | |
| 3720 Verbindlichkeiten aus Lohn und Gehalt | | 2.640,17 |
| 3730 Verbindlichkeiten aus Lohn- und Kirchensteuer | | 539,83 |
| 3740 Verbindlichkeiten im Rahmen der sozialen Sicherheit | | 1.757,60 |

Achtung bei 3730: Im SKR04 ist das die Lohnsteuer, im SKR03 „Erhaltene Skonti“. Ein Storno der Abrechnung ist eine Gegenbuchung am selben Tag. Bezahlt werden die Verbindlichkeiten im Bankabgleich ([Bankumsätze ohne Rechnung oder Beleg](#bankumsätze-ohne-rechnung-oder-beleg)).

Für Minijobs nennt der DATEV-Kontenrahmen 2026 eigene Konten (4195, 4194, 4144 bzw. 6035, 6036, 6171), nicht die allgemeinen Aushilfslöhne (4190 bzw. 6030); die E-Bilanz fragt Löhne für Minijobs getrennt ab. Beiträge zur Berufsgenossenschaft (4138 bzw. 6120) bucht die Lohnabrechnung nicht; sie kommen jährlich mit dem Bescheid.

In der EÜR eines Einzelunternehmens zählt nicht diese Buchung, sondern die Zahlung: Lohn, Lohnsteuer und Beiträge sind am Tag der Zuordnung im Bankabgleich „Ausgaben für eigenes Personal“ (Anlage EÜR, Kennzahl E6001801).
