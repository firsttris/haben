---
title: "Entwurf: Erhaltene Anzahlungen bei GmbH und UG"
description: >-
  Fachlicher Entwurf zur erfolgsneutralen Bilanzierung erhaltener Anzahlungen: Leistungszeitpunkt,
  Prüffälle, Kontierungsfragen und Abgrenzung zur Umsatzsteuerkorrektur.
---

# Entwurf: Erhaltene Anzahlungen bei GmbH und UG

**Status:** Beitrags- und Entscheidungsentwurf zu #750. Der unten fortgeschriebene Kern ist vom Maintainer bestätigt; dieses ADR und der gesamte Implementierungsumfang sind damit noch nicht als angenommen gekennzeichnet.
**Bezug:** [#750](https://github.com/firsttris/haben/issues/750),
[#622](https://github.com/firsttris/haben/issues/622), [PR #745](https://github.com/firsttris/haben/pull/745).

Die folgenden Abschnitte halten den ursprünglichen Vorschlag mit seinen damaligen Prüffragen fest. Den bestätigten Kern und die späteren Umfangsentscheidungen dokumentiert die [Fortschreibung](#fortschreibung-des-beitrags-zu-750).

## Fachlicher Sollzustand

Eine erhaltene Anzahlung für eine noch nicht erbrachte Leistung ist bei GmbH und UG zunächst erfolgsneutral zu führen.
Die Realisierung des Erlöses folgt der erbrachten Leistung; Zahlung und Rechnungsstellung allein reichen dafür nicht.
Grundlagen sind das Realisationsprinzip und die Periodenabgrenzung in
[§ 252 Abs. 1 Nr. 4 und 5 HGB](https://www.gesetze-im-internet.de/hgb/__252.html) sowie der Bilanzposten
„erhaltene Anzahlungen auf Bestellungen“ in [§ 266 Abs. 3 C.3 HGB](https://www.gesetze-im-internet.de/hgb/__266.html).

Die Umsatzsteuer auf eine vor Leistung erhaltene Zahlung entsteht bereits im Eingangszeitraum
([§ 13 Abs. 1 Nr. 1 Buchst. a UStG](https://www.gesetze-im-internet.de/ustg_1980/__13.html)).
PR #745 behandelt diesen Steuerzeitpunkt. Der hier vorgeschlagene Folgeschritt betrifft die Netto-Erlöse und deren
Bilanzausweis; er soll die Steuer weder erneut auslösen noch allein wegen der späteren Erlösrealisierung verschieben.

Beispiel: Gesamtleistung 1.000 € netto zu 19 %, davon 300 € netto als Anzahlung. Die Anzahlung von 357 € geht im
Dezember 2026 ein; die Leistung wird im Januar 2027 vollständig erbracht. Die verbleibenden 833 € werden im Januar bezahlt.

| Zeitpunkt | Erlös aus dieser Leistung | Erhaltene Anzahlung am Periodenende, netto | Umsatzsteuer im Zeitraum |
| --- | ---: | ---: | ---: |
| Dezember: 357 € Anzahlung, keine Leistung | 0 € | 300 € | 57 € |
| Januar: gesamte Leistung und Restzahlung | 1.000 € | 0 € | 133 € |

Die Auflösung der Anzahlung über 300 € gehört zum Gesamterlös von 1.000 €; sie kommt nicht zusätzlich dazu.
Für die EÜR eines Einzelunternehmens soll der bestehende Zahlungsbezug erhalten bleiben.

## Prüffälle für die Buchungsimplementierung

| Fall | Zu belegendes Ergebnis |
| --- | --- |
| Jahreswechsel wie im Beispiel | Dezember ohne Erlös; Januar mit genau dem Gesamtleistungswert. Bilanz, GuV, E-Bilanz und DATEV verwenden dieselbe fachlich richtige Zuordnung. |
| Nur 119 € Teilzahlung zu 19 % | Vor Leistung 100 € erhaltene Anzahlung und 19 € fällige Umsatzsteuer; keine vorweggenommenen Erlöse. |
| Unbezahlte Anzahlungsanforderung | Kein Erlös und keine als erhalten ausgewiesene Zahlung. Die offene Anforderung bleibt mit einem ausdrücklich festgelegten OPOS-/Journalabgleich nachvollziehbar. |
| Ausdrücklich erbrachte Teilleistung | Der realisierte Teil wird nicht allein wegen der Rechnungsart „Abschlag“ als künftige Leistung behandelt. |
| Schlussleistung, auch bei vollständiger Vorauszahlung | Anzahlungen genau einmal auflösen. Noch unbezahlte Forderungen und ein Restbetrag von null bleiben nachvollziehbar; keine zweite Bank-/Kassenbewegung. |
| Rückzahlung, Storno oder nachträgliche Zahlungszuordnung | Fortgeschriebene Verbindlichkeit, realisierte Erlöse und Steuer ergeben sich aus den tatsächlichen Vorgängen; Korrekturen ändern keine gesperrten Ursprungszeilen. |

Die Fälle müssen SKR03 und SKR04, Ist- und Soll-Versteuerung sowie GmbH und UG abdecken. Das Beispiel und die Teilzahlung
sind zusätzlich zu 7 % und für das Kleinunternehmerprofil gegenzurechnen. Bei letzterem entfällt im Beispiel die Umsatzsteuer
([§ 19 UStG](https://www.gesetze-im-internet.de/ustg_1980/__19.html)),
die bilanzielle Trennung zwischen Anzahlung und Erlös bleibt erforderlich.

## Vor der Implementierung festlegen

1. **Unbezahlte Anforderungen und OPOS:** Welche Buchungen entstehen vor Zahlung, und welche offenen Anforderungen sind
   noch keine bilanzierten Forderungen? Der Abgleich muss diese Unterscheidung ausdrücklich berücksichtigen.
2. **Konten und Auswertungen:** Die konkreten SKR03-/SKR04-Konten, ihre Steuerautomatik und Zuordnung zu Bilanz und
   E-Bilanz sind anhand der aktuellen DATEV-Primärquellen zu belegen. Ein Rücklesetest gleicher DATEV-Salden allein
   bestätigt die fachliche Kontierung nicht. Dazu gehört das Ausweiswahlrecht: unter den Verbindlichkeiten oder, soweit
   es Anzahlungen auf Vorräte sind, offen vom Posten „Vorräte“ abgesetzt
   ([§ 268 Abs. 5 Satz 2 HGB](https://www.gesetze-im-internet.de/hgb/__268.html)). Ohne Vorräte, etwa bei reinen
   Dienstleistungen, bleibt nur der Ausweis unter den Verbindlichkeiten.
   Infrage kommen nach den DATEV-Kontenrahmen 2026 (SKR03 Art.-Nr. 11174, S. 10; SKR04 Art.-Nr. 11175, S. 3 und 11):

   | Konto | SKR03 | SKR04 |
   | --- | --- | --- |
   | Erhaltene Anzahlungen auf Bestellungen (Verbindlichkeiten) | 1710 | 3250 |
   | Erhaltene, versteuerte Anzahlungen 19 % USt, mit automatischer Umsatzsteuer (AM) | 1718 | 3272 |
   | Erhaltene, versteuerte Anzahlungen 7 % USt, AM | 1711 | 3260 |
   | Erhaltene Anzahlungen auf Bestellungen (von Vorräten offen abgesetzt) | 1722 | 1190 |

   Die Bilanzposten dieser Konten ordnet `packages/core/src/hgb.ts` schon zu.
3. **Realisierung und Bestand:** Festlegen, welche dokumentierte Leistung die Auflösung auslöst und wie der Übergang
   auf neue Buchungen erkennbar bleibt. Bereits gesperrte Belege, Journalzeilen und deren Siegel bleiben unverändert;
   nötige Bestandskorrekturen erfolgen über nachvollziehbare Folgebuchungen in zulässigen Zeiträumen.

## Umsetzung getrennt vom Umsatzsteuerfix

Der Implementierungsvorschlag soll die in PR #745 eingeführte Unterscheidung zwischen Anzahlung und erbrachter
Teilleistung sowie die bestehenden Beleg- und Zahlungsbezüge verwenden. Eine zweite Klassifikation oder ein zweiter
Umsatzsteuerrechenweg ist nicht vorgesehen. Solange #745 offen ist, behauptet dieser Entwurf keine Verfügbarkeit dieser
Grundlage auf `main`.

Der Maintainer entscheidet über Kontierung und Umfang der Folgeänderung. Die bisherige Erlösbuchung in
[`invoicePosting`](https://github.com/firsttris/haben/blob/f38f82dfb631ae0c2647e513364bc86cd3547536/packages/core/src/posting.ts#L378)
wird durch dieses Dokument nicht umgestellt. Umsetzung und rote Regressionen gehören in die Fortführung des
gesonderten Pull Requests nach dieser Klärung.

## Fortschreibung des Beitrags zu #750

Die [Maintainerentscheidung](https://github.com/firsttris/haben/issues/750#issuecomment-6837873675) bestätigt für neue reine Anforderungen von GmbH und UG:

- Vor Zahlung und Leistung entsteht keine Journalbuchung. Tatsächliche Nettozahlungen stehen auf 1710 (SKR03) beziehungsweise 3250 (SKR04), ohne AM-Funktion; die Umsatzsteuer bleibt getrennt.
- Die erste reale Schlussleistung realisiert den gesamten Nettoerlös unabhängig von Ist oder Soll, auch wenn die Schlussrechnung keinen Restbetrag mehr verlangt.
- Ein bloßes Schluss-Papierstorno nimmt die erbrachte Leistung nicht zurück. Ein eindeutiger, betragsgleicher Ersatz mit unverändertem Abzugssatz setzt sie fort; er realisiert keinen zweiten Erlös. Zahlungen bleiben an ihren gespeicherten Belegen und werden über die Ersatzkette berücksichtigt.
- Die Einführung ist additiv. Alte Belege, Journalzeilen, Siegel und abgeschlossene Jahre bleiben unverändert.

Der Beitrag speichert das Verfahren in `advance_accounting`; `null` behält den bisherigen Weg. `replaces_invoice_id` verbindet den Ersatz mit seinem eindeutigen Vorgänger. Der Stichtagsleser trennt unbilanzierte Anforderungen, bilanzierte Forderungen einschließlich des offenen Anspruchs ohne aktuellen Schlussbeleg und echte Anzahlungs-Erstattungen. Journalgegenprobe und Restlaufzeiten verwenden dieselben datierten Belege und Erledigungen. Das aktuelle Verhalten steht in [Buchhaltung](../buchhaltung.md#anzahlungen-vor-leistung) und [Rechnungen](../rechnungen.md#abschlags--und-schlussrechnung).

Die [ergänzende Maintainerentscheidung](https://github.com/firsttris/haben/issues/750#issuecomment-6850907108) bestätigt die Ersatzgrenze, datierte Entgeltkorrekturen sowie die Sperren für Forderungsausfall auf eine noch unbilanzierte Anforderung und für Zahlungen vor Leistung auf neue Bilanz-Schlussketten. Die Bedienung steht in den oben verlinkten Nutzerseiten. Der allgemeine Vorauszahlungsfall normaler Rechnungen folgt in [#853](https://github.com/firsttris/haben/issues/853). Fremdwährungs-Abschläge bleiben im bisherigen Festschreibungsweg ausgeschlossen.
