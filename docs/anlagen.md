---
title: "Anlagen und AfA: Abschreibung und Anlagenverzeichnis"
description: >-
  Anlagegüter über 800 € netto erfassen und abschreiben: lineare AfA, GWG, Sammelposten,
  Anlagenverzeichnis (AVEÜR) und Übernahme aus Lexoffice.
---

# Anlagen und AfA

Wirtschaftsgüter, die länger als ein Jahr im Betrieb bleiben und mehr als 800 € netto kosten, etwa ein Auto oder Büromöbel, sind keine Ausgabe im Jahr des Kaufs. Ihre Anschaffungskosten verteilen sich als Absetzung für Abnutzung (AfA) über die Nutzungsdauer. Haben führt dafür ein Anlagenverzeichnis, rechnet die AfA je Jahr aus, nimmt sie in die EÜR auf und bucht sie zum Jahresende.

## So gehst du vor

1. **Neue Anschaffung:** Lade die Rechnung als [Beleg](belege.md) hoch und wähle die Kategorie **Anlagegut (wird abgeschrieben)**. Gib Bezeichnung, Art, Abschreibung und gegebenenfalls die Nutzungsdauer an und buche den Beleg. Dabei entsteht die Anlage im Verzeichnis.
2. **Anlage aus Lexoffice oder einer anderen Buchhaltung:** Unter **Anlagen › Anlage übernehmen** trägst du sie mit dem Restbuchwert zum Übernahmestichtag ein (siehe [Übernahme](#übernahme-aus-lexoffice)). Viele auf einmal übernimmst du mit **CSV importieren** aus einer Liste ([CSV-Import](csv-import.md#anlagen)).
3. **Zum Jahresende:** Ab dem 1. Dezember buchst du unter **Anlagen** mit **AfA … buchen** die Abschreibungen des Jahres. Die Übersicht erinnert daran.

In der EÜR steht die AfA schon vorher, sobald die Anlage im Verzeichnis ist.

## Art und Abschreibung

| Art | Vorschlag | Anlagekonto SKR03 / SKR04 | AfA-Konto SKR03 / SKR04 |
|---|---|---|---|
| Fahrzeug | linear, 6 Jahre | 0320 / 0520 | 4832 / 6222 |
| Computer, Hardware und Software | Nutzungsdauer 1 Jahr | 0420 / 0650 | 4830 / 6220 |
| Büromöbel und Büroeinrichtung | linear, 13 Jahre | 0420 / 0650 | 4830 / 6220 |
| Sonstige Betriebs- und Geschäftsausstattung | linear, Nutzungsdauer selbst eintragen | 0490 / 0690 | 4830 / 6220 |
| Sonstige Transportmittel (z. B. Anhänger, Lastenrad, Boot) | linear, Nutzungsdauer selbst eintragen | 0380 / 0560 | 4832 / 6222 |

Die Vorschläge folgen der amtlichen AfA-Tabelle. Du kannst Abschreibung und Nutzungsdauer ändern.

**Sonstige Transportmittel** sind bewegliche Transportmittel, die kein Pkw oder Lkw sind, etwa Anhänger, Lastenräder, Boote oder Gabelstapler. Die Konten folgen dem DATEV-Kontenrahmen 2026 (SKR03 0380, SKR04 0560 „Sonstige Transportmittel“, in der Gruppe der Fahrzeuge); abgeschrieben wird auf „Abschreibungen auf Fahrzeuge“ (4832 / 6222), weil 4830 / 6220 die AfA auf Fahrzeuge ausnimmt. Die Nutzungsdauer trägst du für das einzelne Wirtschaftsgut nach der AfA-Tabelle ein (Anhänger etwa 11 Jahre, Fahrräder 7 Jahre); die sechs Jahre für Pkw schlägt Haben hier nicht vor. Privatnutzung nach der Listenpreismethode und die AfA für Elektrofahrzeuge (§ 7 Abs. 2a EStG) gibt es nur für die Art **Fahrzeug**. Zugang, AfA, Abgang und Verkauf laufen wie bei jeder Anlage; in der Anlage AVEÜR stehen sie bei den übrigen beweglichen Wirtschaftsgütern, in der E-Bilanz unter „sonstige Transportmittel“.

| Abschreibung | Wie Haben rechnet |
|---|---|
| Linear über die Nutzungsdauer | Monatsgenau ab dem Monat der Anschaffung (§ 7 Abs. 1 EStG). Wer im März kauft, schreibt im ersten Jahr 10/12 ab, der Rest kommt im letzten Jahr. Rundungsreste gleicht Haben aus, sodass am Ende genau die Anschaffungskosten abgeschrieben sind. |
| Degressiv mit Wechsel zur linearen | Fester Satz vom Buchwert am Jahresanfang, im Anschaffungsjahr monatsgenau (§ 7 Abs. 2 EStG). Haben wechselt von selbst zur linearen AfA, sobald diese höher ist ([Degressive AfA](#degressive-afa)). |
| Elektrofahrzeug (§ 7 Abs. 2a EStG) | 75 % der Anschaffungskosten im Anschaffungsjahr, unabhängig vom Monat, danach 10, 5, 5, 3 und 2 % ([Elektrofahrzeuge](#elektrofahrzeuge)). |
| Computer und Software (Nutzungsdauer 1 Jahr) | Voll im Jahr der Anschaffung, unabhängig vom Monat (BMF-Schreiben vom 22.02.2022). |
| Geringwertiges Wirtschaftsgut | Bis 800 € netto, voll im Jahr der Anschaffung (§ 6 Abs. 2 EStG). Konten 0480 / 0670, AfA 4855 / 6260. |
| Sammelposten | 250,01 € bis 1.000 € netto, je ein Fünftel im Anschaffungsjahr und in den vier folgenden Jahren (§ 6 Abs. 2a EStG). Ein Abgang ändert daran nichts. Konten 0485 / 0675, AfA 4862 / 6264. |

GWG und Sammelposten prüft Haben gegen die Grenzen. Maßgeblich ist der Nettobetrag, auch bei Kleinunternehmern, deren Anschaffungskosten die Vorsteuer enthalten.

Kleine Anschaffungen bis 800 € netto kannst du weiter mit der Kategorie **Hardware (GWG bis 800 € netto)** als Ausgabe buchen, ohne Eintrag im Anlagenverzeichnis.

## Degressive AfA

Bewegliche Wirtschaftsgüter darfst du statt linear degressiv abschreiben, wenn du sie in einem dieser Zeiträume angeschafft hast:

| Anschaffung | Höchstens | Rechtsgrundlage |
|---|---|---|
| 01.07.2025 bis 31.12.2027 | das Dreifache des linearen Satzes, höchstens 30 % | § 7 Abs. 2 EStG (Gesetz für ein steuerliches Investitionssofortprogramm vom 14.07.2025) |
| 01.04.2024 bis 31.12.2024 | das Doppelte, höchstens 20 % | § 7 Abs. 2 EStG a. F. (Wachstumschancengesetz) i. V. m. § 52 Abs. 15 Satz 4 EStG |
| 01.01.2020 bis 31.12.2022 | das Zweieinhalbfache, höchstens 25 % | wie oben |

Haben schlägt den Höchstsatz vor; einen niedrigeren Satz kannst du eintragen. Der Satz gilt dann unverändert für jedes Jahr, berechnet vom Buchwert am Jahresanfang. Im Anschaffungsjahr zählt jeder Monat ab dem Monat der Anschaffung, im Abgangsjahr jeder Monat bis zum Abgang (§ 7 Abs. 2 Satz 3 i. V. m. Abs. 1 Satz 4 EStG, R 7.4 Abs. 8 EStR).

**Wechsel zur linearen AfA:** Ist der Buchwert geteilt durch die restliche Nutzungsdauer mindestens so hoch wie die degressive AfA, schreibt Haben ab diesem Jahr linear weiter (§ 7 Abs. 3 EStG); zurück geht es nicht. Willst du früher wechseln, trägst du **Linear ab Jahr** ein, auch nachdem schon AfA gebucht ist, aber nur für ein Jahr, für das noch nichts gebucht ist.

Beispiel: Maschine für 100.000 € im September 2025, Nutzungsdauer 10 Jahre, Satz 30 %:

| Jahr | AfA | Rechnung |
|---|---|---|
| 2025 | 10.000,00 € | 30 % × 100.000 € × 4/12 |
| 2026 | 27.000,00 € | 30 % × 90.000 € |
| 2027 bis 2032 | 18.900,00 € bis 3.176,52 € | 30 % vom jeweiligen Buchwert |
| 2033 und 2034 | je 2.779,46 € | Wechsel: 7.411,89 € über 32 Restmonate |
| 2035 | 1.852,97 € | Rest bis August |

Die degressive AfA steht in der EÜR und der Anlage AVEÜR in denselben Zeilen wie die lineare (AfA auf bewegliche Wirtschaftsgüter), gebucht wird auf dasselbe Konto. Satz und Wechseljahr stehen im Anlagenverzeichnis des Jahresexports, wie es § 7a Abs. 8 EStG verlangt.

## Elektrofahrzeuge

Für Elektrofahrzeuge nach § 9 Abs. 2 KraftStG, die du vom 01.07.2025 bis 31.12.2027 angeschafft hast, gilt statt linearer oder degressiver AfA wahlweise eine feste Staffel (§ 7 Abs. 2a EStG): 75 % der Anschaffungskosten im Anschaffungsjahr, egal in welchem Monat, im ersten Folgejahr 10 %, dann zweimal 5 %, 3 % und 2 %. Haben bietet sie nur im Einzelunternehmen an, nur für Anlagen der Art **Fahrzeug** und nur für reine Elektrofahrzeuge; ist bei der Privatnutzung ein anderer Antrieb erfasst, lehnt Haben die Methode ab. Bei einem Abgang zählt der Satz des Jahres zeitanteilig bis zum Abgangsmonat, der Rest ist Restbuchwert.

Das Gesetz nennt die Staffel „Absetzung für Abnutzung“, nicht Sonderabschreibung. Sie steht deshalb in der Anlage EÜR in der Zeile **AfA auf bewegliche Wirtschaftsgüter** und in der Anlage AVEÜR in der Spalte AfA; die Spalte für Sonderabschreibungen ist § 7g EStG vorbehalten. Haben meldet das Fahrzeug in der AVEÜR als Elektrofahrzeug. Gebucht wird auf das Konto für Kfz-Abschreibungen.

In GmbH und UG bietet Haben die Staffel nicht an. Sie ist eine rein steuerliche Abschreibung: In der Handelsbilanz wird planmäßig über die Nutzungsdauer abgeschrieben (§ 253 Abs. 3 Satz 1 HGB), und seit dem BilMoG folgt die Handelsbilanz steuerlichen Wahlrechten nicht mehr (§ 5 Abs. 1 Satz 1 Halbsatz 2 EStG). Haben führt ein Buch für Handels- und Steuerbilanz ohne Überleitung; die Staffel stünde damit auch in der Handelsbilanz. Die degressive AfA bleibt in der GmbH wählbar, sie ist auch nach HGB eine planmäßige Methode.

## Erinnerungswert

Mit **Erinnerungswert 1 € bis zum Abgang stehen lassen** schreibt Haben eine Anlage nur bis auf 1 € ab, wie es in der Bilanz nach HGB üblich ist, damit sie im Verzeichnis bleibt. Der Euro geht mit dem Abgang als Restbuchwert in den Aufwand. Das geht bei linearer, degressiver und Elektro-AfA, nicht bei GWG, Sammelposten und Computern mit einjähriger Nutzungsdauer. In der EÜR heißt das 1 € weniger AfA im letzten Jahr und 1 € Restbuchwert beim Abgang; Haben schlägt den Erinnerungswert deshalb nicht von selbst vor.

## Anschaffung per Beleg

Beim Buchen eines Belegs mit der Kategorie **Anlagegut** bucht Haben den Nettobetrag auf das Anlagekonto statt in den Aufwand:

```
0320 Pkw                    36.000,00   an  1600 Verbindlichkeiten   42.840,00
1576 Vorsteuer 19 %          6.840,00
```

Die Vorsteuer zählt wie bei jedem Beleg in der Voranmeldung und, sobald bezahlt, in der EÜR. Der Kaufpreis selbst ist keine Ausgabe; er wirkt nur über die AfA. Als Kleinunternehmer gehört die Steuer zu den Anschaffungskosten.

Die Anlage übernimmt Datum und Betrag vom Beleg. Art und Anlagekonto stehen damit fest. Abschreibung (außer GWG und Sammelposten), Nutzungsdauer, degressiven Satz und Erinnerungswert kannst du bis zur ersten gebuchten AfA auf der Seite der Anlage noch ändern; bei degressiver AfA nimmt Haben zuerst den Höchstsatz. Von der Anlage führt ein Link zum Beleg und umgekehrt.

Gutschriften zu Anlagen, etwa ein nachträglicher Rabatt, werden nicht unterstützt.

## Übernahme aus Lexoffice

Die Lexoffice-Schnittstelle liefert kein Anlagenverzeichnis. Öffne es in Lexoffice und trage je Anlage in Haben ein:

| Feld | Woher |
|---|---|
| Bezeichnung, Art, Abschreibung, Nutzungsdauer | wie in Lexoffice |
| Anschaffungsdatum und Anschaffungskosten netto | aus dem Anlagenverzeichnis |
| Übernahmestichtag | in der Regel der 01.01. des ersten Jahres, das du in Haben buchst |
| Restbuchwert zum Stichtag | Buchwert zum 31.12. des Vorjahres laut Lexoffice |

Ab dem Stichtag schreibt Haben den Restbuchwert über die restliche Nutzungsdauer ab. Beispiel: Ein Auto für 36.000 € vom März 2024 mit sechs Jahren Nutzungsdauer hat zum 01.01.2026 noch 50 Monate. Bei einem Restbuchwert von 25.000 € sind das 6.000 € im Jahr.

Voll abgeschriebene Anlagen, GWG aus Vorjahren und Computer mit einjähriger Nutzungsdauer musst du nicht übernehmen.

**Degressive und Elektro-AfA** übernimmt Haben nur zum 01.01. eines Jahres nach der Anschaffung und nur, wenn der Restbuchwert zum eigenen Plan passt (bis 1 € Rundung je Jahr). Eine abweichende Zahl heißt meist, dass die bisherige Buchhaltung anders gerechnet oder schon zur linearen AfA gewechselt hat. Dann lehnt Haben ab und nennt den rechnerischen Wert; du übernimmst die Anlage linear mit Restbuchwert und Restnutzungsdauer, was rechtlich der Wechsel nach § 7 Abs. 3 EStG ist. Hat die bisherige Buchhaltung schon gewechselt, trägst du zusätzlich **Linear ab Jahr** ein.

Mehrere Anlagen übernimmst du mit **Anlagen › CSV importieren** aus einer Liste, mit denselben Regeln und einem Stichtag für die ganze Datei ([CSV-Import](csv-import.md#anlagen)).

Solange nichts gebucht ist, lässt sich eine übernommene Anlage ändern und löschen. Mit der ersten AfA-Buchung bucht Haben auch die Eröffnung:

```
0320 Pkw   25.000,00   an  9000 Saldenvorträge Sachkonten   25.000,00   (zum Stichtag)
```

## AfA buchen

**AfA … buchen** bucht für alle Anlagen die Abschreibung des Jahres. Das geht ab dem 1. Dezember des Jahres, für Vorjahre jederzeit. Frühere Jahre müssen zuerst gebucht sein. Gebucht wird je Anlage zum 31.12., bei einem Abgang zum Abgangsdatum:

```
4832 Abschreibungen auf Kfz   6.000,00   an  0320 Pkw   6.000,00
```

Die Buchungen sind wie alle anderen sofort festgeschrieben. Danach sind die Berechnungsgrundlagen der Anlage gesperrt (Art, Abschreibung, Datum, Kosten, Nutzungsdauer, degressiver Satz, Erinnerungswert, Übernahmewerte), auch in der Datenbank per Trigger. Bezeichnung und Notiz bleiben änderbar, bei degressiver AfA auch der Wechsel zur linearen für ein noch nicht gebuchtes Jahr.

## Abgang

Wird eine Anlage verkauft, entnommen oder verschrottet, trägst du auf der Seite der Anlage unter **Abgang (Verkauf, Entnahme, Verschrottung)** das Datum ein. Haben schreibt bis einschließlich des Abgangsmonats ab und bucht den verbleibenden Buchwert als Aufwand:

```
4832 Abschreibungen auf Kfz              1.500,00   an  0320 Pkw   1.500,00
2310 Anlagenabgänge (Restbuchwert)      16.500,00   an  0320 Pkw  16.500,00
```

Den Verkaufserlös stellst du als normale [Rechnung](rechnungen.md) mit Umsatzsteuer. Er zählt in der EÜR als Einnahme. Der Abgang lässt sich nur in ein Jahr legen, für das die AfA noch nicht gebucht ist.

## Private Nutzung von Firmenwagen

Nur im Einzelunternehmen. Fährt der Gesellschafter einen Wagen der GmbH oder UG privat, ist das Arbeitslohn (Sachbezug) in der Lohnabrechnung; das Feld fehlt dann.

Für Fahrzeuge ohne Fahrtenbuch rechnet Haben die private Nutzung nach der Listenpreismethode (§ 6 Abs. 1 Nr. 4 EStG). Auf der Seite der Anlage hakst du **Auch privat genutzt** an und trägst ein:

| Feld | Bedeutung |
|---|---|
| Bruttolistenpreis | Inländischer Listenpreis bei Erstzulassung inklusive Sonderausstattung und Umsatzsteuer, nicht der Kaufpreis. Haben rundet auf volle 100 € ab. |
| Antrieb | Verbrenner, Plug-in-Hybrid (begünstigt) oder Elektro |
| Satz je Monat | Vorschlag aus Antrieb, Listenpreis und Anschaffungsdatum, änderbar |
| Umsatzsteuer auf die Privatnutzung | Aus, wenn du beim Kauf keine Vorsteuer gezogen hast. Als Kleinunternehmer immer aus. |

| Antrieb | Satz |
|---|---|
| Verbrenner | 1 % |
| Plug-in-Hybrid, begünstigt | 0,5 % |
| Elektro bis zur Preisgrenze | 0,25 % |
| Elektro über der Preisgrenze | 0,5 % |

Die Preisgrenze für 0,25 % liegt bei 60.000 € für Anschaffungen bis 2023, 70.000 € bis Juni 2025 und 100.000 € danach. Vor 2019 angeschaffte Elektro- und Hybridautos schlägt Haben mit 1 % vor.

Die Pauschale fällt in jedem Monat ab der Anschaffung bzw. dem Übernahmestichtag an, bis einschließlich des Abgangsmonats. Beispiel Elektroauto mit 58.990 € Listenpreis: 0,25 % von 58.900 € sind 147,25 € Entnahme im Monat.

**Umsatzsteuer:** Die Privatnutzung ist eine unentgeltliche Wertabgabe. Bemessung ist 1 % des vollen Listenpreises abzüglich 20 % für Kosten ohne Vorsteuer, auch bei Elektroautos; die Ermäßigung gilt nur für die Einkommensteuer. Im Beispiel 471,20 € Bemessung und 89,53 € Umsatzsteuer im Monat. Sie steht in der [Voranmeldung](umsatzsteuer.md) unter Kz 81 als „Privatnutzung“, auch bei Ist-Versteuerung im Monat der Nutzung.

**EÜR:** Die Entnahme steht als „Private Kfz-Nutzung“ in den Einnahmen, die Umsatzsteuer darauf als „Umsatzsteuer auf unentgeltliche Wertabgaben“.

**Buchung:** Mit **AfA … buchen** zum Jahresende bucht Haben je Monat zum Monatsende:

```
1800 Privatentnahmen   236,78   an  8921 Kfz-Nutzung 19 % USt    147,25
                                    1776 Umsatzsteuer 19 %         89,53
```

Bei Verbrennern geht die Entnahme bis zur Höhe der Bemessung auf 8921 (SKR04 4645), der Rest ohne Umsatzsteuer auf 8924 (SKR04 4639). Die Kennzahl 81 rechnet Haben aus der Bemessung, nicht aus dem Erlöskonto.

Ist schon gebucht, lässt sich die Privatnutzung nicht mehr ändern.

## In der EÜR

Die [EÜR](auswertungen.md) bekommt je nach Bedarf die Zeilen **AfA auf bewegliche Wirtschaftsgüter**, **Sofortabschreibung geringwertiger Wirtschaftsgüter**, **Auflösung Sammelposten** und **Restbuchwert ausgeschiedener Anlagegüter**. Solange die AfA des Jahres nicht gebucht ist, kommen die Werte aus dem Abschreibungsplan. Danach kommen sie ab dem Stichjahr aus dem Journal, vorher weiter aus dem Abschreibungsplan ([EÜR nach Zufluss und Abfluss](auswertungen.md#eür-nach-zufluss-und-abfluss)); der [Abgleich](buchhaltung.md#abgleich-von-journal-umsatzsteuer-und-eür) prüft, dass gebuchte AfA und Plan übereinstimmen.

Im Jahresexport liegt `anlagen/anlagenverzeichnis.csv` mit Buchwert am Jahresanfang, Zugang, AfA, Abgang und Buchwert am Jahresende je Anlage.

## Grenzen

- Nur bewegliche Wirtschaftsgüter, keine Gebäude und keine immateriellen Wirtschaftsgüter außer Software.
- Lineare und degressive AfA, die Staffel für Elektrofahrzeuge, GWG und Sammelposten. Keine Sonderabschreibung (§ 7g EStG), kein Investitionsabzugsbetrag, keine Leistungs-AfA und keine Absetzung für außergewöhnliche Abnutzung.
- Degressive AfA nur für Anschaffungen ab 2020 in den oben genannten Zeiträumen; ältere degressive Anlagen übernimmst du linear mit Restbuchwert.
- Private Kfz-Nutzung nur nach der Listenpreismethode: kein Fahrtenbuch, keine Fahrten zwischen Wohnung und Betriebsstätte (0,03 %) und keine Kostendeckelung.
- Gebuchte AfA lässt sich nicht stornieren.
- Kontenzuordnung vor dem Echtbetrieb mit dem Steuerberater abgleichen.
