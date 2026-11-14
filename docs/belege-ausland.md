---
title: "Belege aus dem Ausland: Reverse Charge, Erwerb, Einfuhr"
description: >-
  Eingangsrechnungen aus dem Ausland in Haben: Reverse Charge nach § 13b, innergemeinschaftlicher Erwerb, Einfuhrumsatzsteuer und Belege in Fremdwährung.
---

# Belege aus dem Ausland

Was Haben bei § 13b und beim innergemeinschaftlichen Erwerb nicht abdeckt, steht unter [Belege › Grenzen](belege.md#grenzen).

## Reverse Charge als Leistungsempfänger (§ 13b)

Viele Anbieter von Software und Cloud-Diensten aus dem EU-Ausland (Google, Microsoft, AWS, JetBrains, Adobe aus Irland oder den Niederlanden) stellen Unternehmern Rechnungen ohne Umsatzsteuer mit dem Hinweis „Reverse Charge“. Die Steuer schuldest dann du (§ 13b UStG) und ziehst sie im selben Zug als Vorsteuer wieder ab.

Unter **Umsatzsteuer auf dem Beleg** wählst du:

| Auswahl | Wann | Kennzahlen |
| --- | --- | --- |
| § 13b: Leistung eines Unternehmers aus dem EU-Ausland | sonstige Leistung eines Unternehmers mit Sitz in einem anderen EU-Land | Kz 46 (netto) und 47 (Steuer) |
| § 13b: Leistung eines Unternehmers aus dem Drittland | Leistung eines Unternehmers ohne Sitz in der EU, z. B. aus den USA, ohne deutsche Umsatzsteuer | Kz 84 (netto) und 85 (Steuer) |

Du trägst nur das Netto aus der Rechnung ein und wählst den zutreffenden deutschen Steuersatz (19 % oder 7 %). **Steuer § 13b (automatisch)** zeigt die daraus berechnete Steuer schreibgeschützt an. Änderungen am Netto oder am Satz aktualisieren sie automatisch, auch nach dem erneuten Öffnen eines gespeicherten Entwurfs. Beim Speichern rechnet Haben die Steuer selbst noch einmal aus Netto und Satz, auch bei der Erwerbsteuer; ein älterer Entwurf mit abweichender Steuer lässt sich erst buchen, wenn du ihn geöffnet und gespeichert hast. Bezahlt wird der Nettobetrag, der Bankabgleich erwartet also netto. Hat der Lieferant eine USt-IdNr. aus einem anderen EU-Land und steht keine Steuer auf dem Beleg, weist Haben darauf hin.

Gebucht wird (SKR03, SKR04 in Klammern):

- Aufwand netto an Verbindlichkeiten bzw. Privateinlage,
- Vorsteuer nach § 13b auf 1577 (1407) an Umsatzsteuer nach § 13b auf 1787 (3837).

In der [Voranmeldung](umsatzsteuer.md#-13b-als-leistungsempfänger) heben sich Steuer und Vorsteuer auf. Ohne Vorsteuerabzug schuldest du die Steuer trotzdem, ziehst aber nichts ab: Sie wird Teil des Aufwands und ist mit der Voranmeldung zu zahlen. Mit Privatanteil ist die Steuer voll geschuldet, abziehbar nur der betriebliche Teil. Gebucht wird die nicht abziehbare Steuer als eigene Aufwandszeile neben dem Netto; mit Privatanteil steht der private Teil des Nettos mit dem Steuerschlüssel des § 13b auf den Entnahmen, die private Steuer ohne. So trägt das Journal die volle Bemessungsgrundlage wie die Voranmeldung (Kz 46/84). Beim innergemeinschaftlichen Erwerb mit Privatanteil ebenso (Kz 89/93). In der EÜR zählt der gezahlte Nettobetrag; die Steuer an das Finanzamt erscheint dort, wenn sie gezahlt wird. Den privaten Teil der Steuer zahlt der Betrieb mit der Voranmeldung, er ist aber keine Betriebsausgabe: Die EÜR zählt ihn deshalb mit der Zahlung des Belegs als „Vereinnahmte Umsatzsteuer sowie Umsatzsteuer auf unentgeltliche Wertabgaben“ (Zeile 17). Unterm Strich mindert so nur der betriebliche Teil den Gewinn, wie bei DATEV, wo die Konten der Steuer nach § 13b in dieser Zeile stehen. Beispiel: 1.000,00 € netto, 190,00 € Steuer, Privatanteil 30 %: 700,00 € Ausgabe, 57,00 € in Zeile 17; mit der Voranmeldung gehen 57,00 € ans Finanzamt (190,00 € Steuer, 133,00 € Vorsteuer).

## Innergemeinschaftlicher Erwerb (§ 1a UStG)

Kaufst du als Unternehmer **Ware** bei einem Unternehmer aus einem anderen EU-Land und gelangt sie aus diesem Land nach Deutschland, stellt er dir die Rechnung ohne Umsatzsteuer, mit seiner und deiner USt-IdNr. Die Umsatzsteuer (Erwerbsteuer) schuldest dann du und ziehst sie im selben Zug als Vorsteuer wieder ab. Ein Beispiel: Hardware von einem Händler aus den Niederlanden für 500 € netto; daraus entstehen 95 € Erwerbsteuer und 95 € Vorsteuer, an den Händler gehen 500 €.

Unter **Umsatzsteuer auf dem Beleg** wählst du **Innergemeinschaftlicher Erwerb (§ 1a UStG): Ware aus dem EU-Ausland**. Die Steuerbehandlung ist unabhängig von der Kategorie: Ware zum Weiterverkauf („Wareneinkauf (Handelsware)“), Büroausstattung, Hardware und auch ein **Anlagegut** gehen. Bei einem Anlagegut kommt der Nettobetrag wie sonst ins [Anlagenverzeichnis](anlagen.md), Erwerbsteuer und Vorsteuer stehen daneben; dafür ist vollständiger Vorsteuerabzug nötig (siehe [Grenzen](belege.md#grenzen)).

Du trägst das Netto aus der Rechnung ein und wählst 19 % oder 7 %. **Erwerbsteuer (automatisch)** zeigt die berechnete Steuer schreibgeschützt an; bei Änderungen am Netto oder am Satz wird sie automatisch aktualisiert. Bezahlt wird der Nettobetrag. Zum Buchen braucht Haben die **USt-IdNr. des Lieferanten** aus einem anderen EU-Land; mit einer deutschen USt-IdNr. ist es kein innergemeinschaftlicher Erwerb.

Gebucht wird (SKR03, SKR04 in Klammern), Konten aus dem DATEV-Kontenrahmen 2026:

- Aufwand bzw. Anlagekonto netto an Verbindlichkeiten bzw. Privateinlage,
- Vorsteuer aus innergemeinschaftlichem Erwerb 19 % auf 1574 (1404), 7 % auf 1572 (1402), an Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 % auf 1774 (3804), 7 % auf 1772 (3802).

Haben bucht auf das Aufwandskonto der Kategorie, nicht auf die DATEV-Automatikkonten 3425/3420 (5425/5420); die Steuer steht als eigene Zeile im Journal, deshalb rechnet DATEV sie beim [Export](auswertungen.md) nicht ein zweites Mal heraus.

In der [Voranmeldung](umsatzsteuer.md#innergemeinschaftlicher-erwerb) steht das Netto in **Kz 89** (19 %) bzw. **Kz 93** (7 %), die Vorsteuer in **Kz 61**; beides hebt sich auf. Die Erwerbsteuer entsteht mit der Ausstellung der Rechnung, spätestens mit Ablauf des Folgemonats (§ 13 Abs. 1 Nr. 6 UStG). Haben meldet sie deshalb im Monat des **Belegdatums**, auch bei Ist-Versteuerung, und nicht mit der Zahlung. Mit Privatanteil ist die Erwerbsteuer voll geschuldet, als Vorsteuer abziehbar nur der betriebliche Teil (§ 15 Abs. 1 Satz 1 Nr. 3 UStG). In der EÜR zählt der gezahlte Nettobetrag; Erwerbsteuer und Vorsteuer heben sich auf.

Abzugrenzen sind:

- **Dienstleistungen** aus dem EU-Ausland (Software-Abos, Cloud, Beratung): § 13b, siehe oben.
- **Händler aus dem EU-Ausland mit deutscher Umsatzsteuer** auf der Rechnung, etwa im Versandhandel oder über einen Marktplatz: ein gewöhnlicher Beleg mit Vorsteuer. Der Sitz des Händlers oder der Marktplatz allein machen keinen Erwerb.
- Ein Storno zählt wie bei allen Belegen im Monat des Stornos mit umgekehrtem Vorzeichen (Kz 89/93 und 61).

## Einfuhrumsatzsteuer

Bei der Einfuhr von Waren aus dem Drittland erhebt der Zoll die Einfuhrumsatzsteuer. Sie ist als Vorsteuer abziehbar (§ 15 Abs. 1 Satz 1 Nr. 2 UStG) und steht in der Voranmeldung in Kz 62. Lade den Bescheid des Zolls (Einfuhrabgabenbescheid) als Beleg hoch und wähle die Kategorie **Einfuhrumsatzsteuer (Bescheid des Zolls)**. Der Beleg enthält nur die Steuer, als **ein Betrag zu 0 %**; die Rechnung des Lieferanten über die Ware buchst du getrennt (ohne Vorsteuer, mit der Kategorie der Ware). Zölle und andere Abgaben auf demselben Bescheid gehören nicht in diesen Beleg, sondern zu den Kosten der Ware.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 1588 Entstandene Einfuhrumsatzsteuer | 1433 | 380,00 | |
| 1600 Verbindlichkeiten | 3300 Verbindlichkeiten | | 380,00 |

- **Voranmeldung:** Kz 62 im Monat des Belegdatums, bei Ist- und Soll-Versteuerung; sie mindert die Zahllast (Kz 83) wie Vorsteuer.
- **EÜR:** gezahlte Vorsteuer, wenn der Bescheid bezahlt ist (im Bankabgleich wie jeder Beleg); keine Betriebsausgabe.
- **Nicht unterstützt:** Kleinunternehmer und Belege ohne Vorsteuerabzug (dann gehört die Einfuhrumsatzsteuer zu den Kosten der Ware; buche sie mit deren Kategorie), Privatanteil, § 13b und Aufteilung mit anderen Kategorien. Die Umsatzsteuer-Jahreserklärung übermittelt Haben für ein Jahr mit Einfuhrumsatzsteuer nicht; die Seite nennt die Werte für das ELSTER-Portal.

## Fremdwährung

Rechnungen in US-Dollar, Pfund oder einer anderen Währung (Software-Abos, Hosting, Werbung) buchst du so:

1. Unter **Beträge je Steuersatz** bei **Währung** den Code eintragen, z. B. `USD`. Bei E-Rechnungen und der KI-Auslesung steht er schon da.
2. Die Beträge so eintragen, wie sie auf dem Beleg stehen, also in der Fremdwährung.
3. **Kurs: 1 EUR = …** leer lassen. Für die Umsatzsteuer gilt der Umsatzsteuer-Umrechnungskurs, den das Bundesministerium der Finanzen (BMF) für jeden Monat veröffentlicht (§ 16 Abs. 6 UStG). Haben nimmt den Kurs für den Monat des Belegdatums aus den [abgerufenen Kursen](einrichtung.md#fremdwährung) und zeigt ihn mit Herkunft an, z. B. „1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)“.

Einen eigenen Kurs trägst du ein, wenn das Finanzamt dir den Tageskurs gestattet hat (Einstellung **Tageskurs** in den Firmendaten, dann mit **Kursdatum**) oder wenn du einen Kurs aus der Bankabrechnung nehmen willst. Ein eigener Kurs bleibt; ein übernommener USt-Kurs wechselt mit, wenn du das Belegdatum in einen anderen Monat änderst. Jede Änderung steht im Audit-Log des Belegs.

Haben rechnet jede Zeile durch den Kurs in Euro um und rundet kaufmännisch auf den Cent. Unter dem Gesamtbetrag stehen der Betrag in Euro und die Euro-Beträge je Steuersatz. Gebucht, in die Voranmeldung übernommen und im Bankabgleich zugeordnet wird nur der Euro-Betrag. Währung, Kurs und Originalbeträge bleiben am Beleg gespeichert und stehen im Jahresexport in `belege.csv`.

Bei § 13b steht keine Steuer auf der Rechnung. Haben rechnet dann das Netto in Euro um und berechnet die Steuer aus diesem Euro-Betrag.

Beispiel: 100,00 USD netto zu 19 % bei 1 EUR = 1,0812 USD ergibt 92,49 € netto und 17,57 € Vorsteuer (19,00 USD / 1,0812).

Das BMF veröffentlicht die Kurse eines Monats am ersten Arbeitstag des Folgemonats. Bis dahin lässt sich der Beleg speichern, aber nicht buchen („Kurs für 10/2026 noch nicht veröffentlicht“). Sobald Haben die Kurse abgerufen hat, rechnet es wartende Belege von selbst um; du kannst auch einen Kurs von Hand eintragen. Einen gebuchten Beleg ändert ein später abgerufener oder geänderter Kurs nicht.

Belastet die Bank einen anderen Euro-Betrag als den umgerechneten, gleichst du die Differenz im Bankabgleich als [Kursdifferenz](bank.md#kursdifferenz-bei-fremdwährung) aus.
