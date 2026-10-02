# Anlagen und AfA

Wirtschaftsgüter, die länger als ein Jahr im Betrieb bleiben und mehr als 800 € netto kosten, etwa ein Auto oder Büromöbel, sind keine Ausgabe im Jahr des Kaufs. Ihre Anschaffungskosten verteilen sich als Absetzung für Abnutzung (AfA) über die Nutzungsdauer. Haben führt dafür ein Anlagenverzeichnis, rechnet die AfA je Jahr aus, nimmt sie in die EÜR auf und bucht sie zum Jahresende.

## So gehst du vor

1. **Neue Anschaffung:** Lade die Rechnung als [Beleg](belege.md) hoch und wähle die Kategorie **Anlagegut (wird abgeschrieben)**. Gib Bezeichnung, Art, Abschreibung und gegebenenfalls die Nutzungsdauer an und buche den Beleg. Dabei entsteht die Anlage im Verzeichnis.
2. **Anlage aus Lexoffice oder einer anderen Buchhaltung:** Unter **Anlagen › Anlage übernehmen** trägst du sie mit dem Restbuchwert zum Übernahmestichtag ein (siehe [Übernahme](#übernahme-aus-lexoffice)).
3. **Zum Jahresende:** Ab dem 1. Dezember buchst du unter **Anlagen** mit **AfA … buchen** die Abschreibungen des Jahres. Die Übersicht erinnert daran.

In der EÜR steht die AfA schon vorher, sobald die Anlage im Verzeichnis ist.

## Art und Abschreibung

| Art | Vorschlag | Anlagekonto SKR03 / SKR04 | AfA-Konto SKR03 / SKR04 |
|---|---|---|---|
| Fahrzeug | linear, 6 Jahre | 0320 / 0520 | 4832 / 6222 |
| Computer, Hardware und Software | Nutzungsdauer 1 Jahr | 0420 / 0650 | 4830 / 6220 |
| Büromöbel und Büroeinrichtung | linear, 13 Jahre | 0420 / 0650 | 4830 / 6220 |
| Sonstige Betriebs- und Geschäftsausstattung | linear, Nutzungsdauer selbst eintragen | 0490 / 0690 | 4830 / 6220 |

Die Vorschläge folgen der amtlichen AfA-Tabelle. Du kannst Abschreibung und Nutzungsdauer ändern.

| Abschreibung | Wie Haben rechnet |
|---|---|
| Linear über die Nutzungsdauer | Monatsgenau ab dem Monat der Anschaffung (§ 7 Abs. 1 EStG). Wer im März kauft, schreibt im ersten Jahr 10/12 ab, der Rest kommt im letzten Jahr. Rundungsreste gleicht Haben aus, sodass am Ende genau die Anschaffungskosten abgeschrieben sind. |
| Computer und Software (Nutzungsdauer 1 Jahr) | Voll im Jahr der Anschaffung, unabhängig vom Monat (BMF-Schreiben vom 22.02.2022). |
| Geringwertiges Wirtschaftsgut | Bis 800 € netto, voll im Jahr der Anschaffung (§ 6 Abs. 2 EStG). Konten 0480 / 0670, AfA 4855 / 6260. |
| Sammelposten | 250,01 € bis 1.000 € netto, je ein Fünftel im Anschaffungsjahr und in den vier folgenden Jahren (§ 6 Abs. 2a EStG). Ein Abgang ändert daran nichts. Konten 0485 / 0675, AfA 4862 / 6264. |

GWG und Sammelposten prüft Haben gegen die Grenzen. Maßgeblich ist der Nettobetrag, auch bei Kleinunternehmern, deren Anschaffungskosten die Vorsteuer enthalten.

Kleine Anschaffungen bis 800 € netto kannst du weiter einfach mit der Kategorie **Hardware (GWG bis 800 € netto)** als Ausgabe buchen, ohne Eintrag im Anlagenverzeichnis.

## Anschaffung per Beleg

Beim Buchen eines Belegs mit der Kategorie **Anlagegut** bucht Haben den Nettobetrag auf das Anlagekonto statt in den Aufwand:

```
0320 Pkw                    36.000,00   an  1600 Verbindlichkeiten   42.840,00
1576 Vorsteuer 19 %          6.840,00
```

Die Vorsteuer zählt wie bei jedem Beleg in der Voranmeldung und, sobald bezahlt, in der EÜR. Der Kaufpreis selbst ist keine Ausgabe; er wirkt nur über die AfA. Als Kleinunternehmer gehört die Steuer zu den Anschaffungskosten.

Die Anlage übernimmt Datum und Betrag vom Beleg. Art und Abschreibungsart stehen damit fest. Die Nutzungsdauer kannst du bis zur ersten gebuchten AfA auf der Seite der Anlage noch ändern. Von der Anlage führt ein Link zum Beleg und umgekehrt.

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

Solange nichts gebucht ist, lässt sich eine übernommene Anlage ändern und löschen. Mit der ersten AfA-Buchung bucht Haben auch die Eröffnung:

```
0320 Pkw   25.000,00   an  9000 Saldenvorträge Sachkonten   25.000,00   (zum Stichtag)
```

## AfA buchen

**AfA … buchen** bucht für alle Anlagen die Abschreibung des Jahres. Das geht ab dem 1. Dezember des Jahres, für Vorjahre jederzeit. Frühere Jahre müssen zuerst gebucht sein. Gebucht wird je Anlage zum 31.12., bei einem Abgang zum Abgangsdatum:

```
4832 Abschreibungen auf Kfz   6.000,00   an  0320 Pkw   6.000,00
```

Die Buchungen sind wie alle anderen sofort festgeschrieben. Danach sind die Berechnungsgrundlagen der Anlage gesperrt (Art, Abschreibung, Datum, Kosten, Nutzungsdauer, Übernahmewerte), auch in der Datenbank per Trigger. Bezeichnung und Notiz bleiben änderbar.

## Abgang

Wird eine Anlage verkauft, entnommen oder verschrottet, trägst du das **Abgangsdatum** ein. Haben schreibt bis einschließlich des Abgangsmonats ab und bucht den verbleibenden Buchwert als Aufwand:

```
4832 Abschreibungen auf Kfz              1.500,00   an  0320 Pkw   1.500,00
2310 Anlagenabgänge (Restbuchwert)      16.500,00   an  0320 Pkw  16.500,00
```

Den Verkaufserlös stellst du als normale [Rechnung](rechnungen.md) mit Umsatzsteuer. Er zählt in der EÜR als Einnahme. Der Abgang lässt sich nur in ein Jahr legen, für das die AfA noch nicht gebucht ist.

## Private Nutzung von Firmenwagen

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

Die [EÜR](auswertungen.md) bekommt je nach Bedarf die Zeilen **AfA auf bewegliche Wirtschaftsgüter**, **Sofortabschreibung geringwertiger Wirtschaftsgüter**, **Auflösung Sammelposten** und **Restbuchwert ausgeschiedener Anlagegüter**. Die Werte kommen aus dem Abschreibungsplan, ob schon gebucht oder nicht.

Im Jahresexport liegt `anlagen/anlagenverzeichnis.csv` mit Buchwert am Jahresanfang, Zugang, AfA, Abgang und Buchwert am Jahresende je Anlage.

## Grenzen

- Nur bewegliche Wirtschaftsgüter, keine Gebäude und keine immateriellen Wirtschaftsgüter außer Software.
- Nur lineare AfA. Keine degressive AfA, keine Sonderabschreibung (§ 7g EStG) und kein Investitionsabzugsbetrag.
- Kein Erinnerungswert von 1 €; bei der EÜR wird bis 0 abgeschrieben.
- Private Kfz-Nutzung nur nach der Listenpreismethode: kein Fahrtenbuch, keine Fahrten zwischen Wohnung und Betriebsstätte (0,03 %) und keine Kostendeckelung.
- Gebuchte AfA lässt sich nicht stornieren.
- Kontenzuordnung vor dem Echtbetrieb mit dem Steuerberater abgleichen.
