---
title: "Steuerzahlungen und Darlehen im Bankabgleich"
description: >-
  Zahlungen an Finanzamt und Gemeinde und Erstattungen zuordnen, Darlehen mit Auszahlung, Tilgung und Zinsen buchen.
---

# Steuerzahlungen und Darlehen

## Steuerzahlungen

Zahlungen an das Finanzamt oder die Gemeinde und Erstattungen von dort, die keine Voranmeldung sind, buchst du unter **Direkt buchen** als **Steuerzahlung oder Erstattung**. Dazu gibst du drei Dinge an:

- **Steuerart:** Umsatzsteuer, Gewerbesteuer, im Einzelunternehmen Einkommensteuer, Kirchensteuer und Solidaritätszuschlag, in GmbH und UG Körperschaftsteuer und Solidaritätszuschlag, dazu die von der Bank einbehaltene Kapitalertragsteuer (siehe [Zinserträge](bank.md#auf-eine-kategorie-buchen)).
- **Bezugsjahr:** das Jahr, für das die Steuer festgesetzt ist, etwa 2024 für den Bescheid über die Gewerbesteuer 2024. Es bleibt am Vorgang stehen; gezählt wird die Zahlung trotzdem am Tag der Zahlung (§ 11 EStG).
- **Teil der Zahlung:** die Steuer selbst oder eine steuerliche Nebenleistung (§ 3 Abs. 4 AO): Nachzahlungs- oder Erstattungszinsen (§ 233a AO), Stundungs- oder Aussetzungszinsen (§§ 234, 237 AO), Hinterziehungszinsen (§ 235 AO), Säumniszuschlag (§ 240 AO), Verspätungszuschlag (§ 152 AO) oder Zwangsgeld (§ 329 AO).

Ob Zinsen und Zuschläge den Gewinn mindern, entscheidet die Steuerart, nicht das Wort „Zinsen“ im Verwendungszweck: Zur Umsatzsteuer sind sie Betriebsausgaben, zur Gewerbesteuer nicht (§ 4 Abs. 5b EStG), zur Einkommensteuer privat (§ 12 Nr. 3 EStG), zur Körperschaftsteuer nicht abziehbar (§ 10 Nr. 2 KStG). Ein Bescheid mit Steuer, Zinsen und Zuschlag in einer Zahlung wird mit **Aufteilen** auf mehrere Teile verteilt, jeder mit eigener Steuerart, eigenem Bezugsjahr und eigenem Teil; zusammen ergeben sie den Umsatz, aufgehoben wird nur die ganze Aufteilung.

Gebucht wird ohne Steuerschlüssel: Eine Steuerzahlung erzeugt weder Umsatz noch Vorsteuer, die Voranmeldung bleibt unverändert. Die Konten (DATEV-Kontenrahmen 2026):

| Steuerart und Teil | SKR03 | SKR04 | EÜR (Einzelunternehmen) |
| --- | --- | --- | --- |
| Umsatzsteuer, Steuer für das Vorjahr | 1790 Umsatzsteuerverbindlichkeiten Vorjahr | 3841 | gezahlte bzw. erstattete Umsatzsteuer |
| Umsatzsteuer, Steuer für frühere Jahre | 1791 Umsatzsteuerverbindlichkeiten frühere Jahre | 3845 | gezahlte bzw. erstattete Umsatzsteuer |
| Gewerbesteuer des laufenden Jahres (Vorauszahlung) | 4320 Gewerbesteuer | 7610 | keine Betriebsausgabe, nachrichtlich |
| Gewerbesteuer für Vorjahre, Nachzahlung und Erstattung | 2281 Gewerbesteuernachzahlungen und -erstattungen für Vorjahre nach § 4 Abs. 5b EStG | 7641 | keine Betriebsausgabe, nachrichtlich |
| Einkommen-, Kirchensteuer, Soli des Inhabers, mit Zinsen und Zuschlägen | 1810 Privatsteuern | 2150 | Entnahme; übersteigen die Erstattungen im Jahr die Zahlungen, Einlage |
| Erstattungszinsen zur Einkommensteuer | 1890 Privateinlagen | 2180 | Einlage (private Kapitalerträge, § 20 Abs. 1 Nr. 7 EStG) |
| Körperschaftsteuer bzw. Soli des laufenden Jahres (GmbH) | 2200 bzw. 2208 | 7600 bzw. 7608 | – |
| Körperschaftsteuer bzw. Soli für Vorjahre (GmbH), Nachzahlung | 2203 bzw. 2209, vorher die Rückstellung 0963 | 7603 bzw. 7609, vorher 3040 | – |
| Körperschaftsteuer bzw. Soli für Vorjahre (GmbH), Erstattung | 2204 bzw. 2210 | 7604 bzw. 7607 | – |
| Gewerbesteuer für Vorjahre (GmbH), Nachzahlung | 2281, vorher die Rückstellung 0956 | 7641, vorher 3035 | – |
| Zinsen § 233a AO zur Umsatzsteuer / zu Gewerbe- und Körperschaftsteuer | 2107 / 2105 | 7305 / 7308 | Betriebsausgabe / nachrichtlich bei der Gewerbesteuer |
| Stundungs- und Aussetzungszinsen (§§ 234, 237 AO) zur Umsatzsteuer / zu Gewerbe- und Körperschaftsteuer | 2111 / 2108 | 7311 / 7306 | Betriebsausgabe / nachrichtlich bei der Gewerbesteuer |
| Hinterziehungszinsen (§ 235 AO), auch zur Umsatzsteuer | 2108 | 7306 | nie abziehbar (§ 4 Abs. 5 Satz 1 Nr. 8a EStG), nachrichtlich bei der Gewerbesteuer |
| Säumniszuschlag zur Umsatzsteuer / zur Gewerbesteuer / zur Körperschaftsteuer | 2103 / 2102 / 2104 | 7303 / 7302 / 7304 | Betriebsausgabe / nachrichtlich bei der Gewerbesteuer |
| Verspätungszuschlag, Zwangsgeld zur Umsatzsteuer / zu Gewerbe- und Körperschaftsteuer | 4396 / 4397 | 6436 / 6437 | Betriebsausgabe / nachrichtlich bei der Gewerbesteuer |
| Erstattungszinsen § 233a AO zur Umsatz- oder Gewerbesteuer | 2657 Zinserträge § 233a AO, steuerpflichtig | 7105 | Betriebseinnahme |

Beispiel: Der Bescheid über die Gewerbesteuer 2024 kommt im Oktober 2026, die Stadtkasse zieht 543,00 € ein: 500,00 € Steuer, 18,00 € Nachzahlungszinsen und 25,00 € Verspätungszuschlag. Aufgeteilt in drei Teile, Steuerart Gewerbesteuer, Bezugsjahr 2024:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 2281 Gewerbesteuer Vorjahre | 7641 | 500,00 | |
| 2105 Zinsen § 233a AO nicht abzugsfähig | 7308 | 18,00 | |
| 4397 Verspätungszuschläge nicht abzugsfähig | 6437 | 25,00 | |
| 1200 Bank | 1800 Bank | | 543,00 |

Die EÜR 2026 bleibt dadurch unverändert; die 543,00 € stehen nachrichtlich als Gewerbesteuer in der [Anlage EÜR](jahreserklaerung.md#anlage-eür). Wären es dieselben Beträge zur Umsatzsteuer 2024, zählten 500,00 € als gezahlte Umsatzsteuer und 43,00 € als Betriebsausgabe.

**Abgrenzung zur Voranmeldung:** Die Zahllast einer abgegebenen Voranmeldung ordnest du weiter der [Voranmeldung](bank.md#voranmeldung-zahllast-und-erstattung) zu, auch die für Dezember im Januar. Umsatzsteuer als Steuerzahlung gibt es nur für frühere Jahre, also aus Jahreserklärung oder Bescheid; die Steuer des laufenden Jahres lehnt Haben dort ab. Zinsen und Zuschläge zur Umsatzsteuer, etwa ein Säumniszuschlag zur Voranmeldung, gehen auch für das laufende Jahr. Liegt eine Zahlung „Umsatzsteuer früherer Jahre“ zwischen 22. Dezember und 10. Januar, weist die Jahreserklärung darauf hin: Ist es die Vorauszahlung für Dezember oder das vierte Quartal, ordne sie der Voranmeldung zu. Dann zählt Haben sie in der EÜR des Vorjahres, wenn sie ohne Dauerfristverlängerung am 10. Januar fällig war (§ 11 Abs. 2 Satz 2 EStG, [Vorauszahlung um den Jahreswechsel](auswertungen.md#umsatzsteuer-vorauszahlung-um-den-jahreswechsel)); als Steuerzahlung zählt sie im Jahr der Zahlung.

**Privates Konto:** Liegt das Geld auf einem Konto mit dem Zweck **privat**, steht statt der Bank die Privatentnahme bzw. die Einlage, wie bei der [Voranmeldung](bank.md#voranmeldung-zahllast-und-erstattung) beschrieben — für jede Steuerart, nicht nur die Umsatzsteuer: Auch Gewerbesteuer und die Steuern der GmbH laufen über das Privatkonto des Inhabers oder Gesellschafters. Zwei Ausnahmen lehnt Haben dort ab, weil sie kein Geschäftsvorfall sind: die Steuern des Inhabers samt Nebenleistungen (Einkommen-, Kirchensteuer, Soli; § 12 Nr. 3 EStG) und die einbehaltene Kapitalertragsteuer auf privates Kapitalvermögen (§ 20 Abs. 1 Nr. 7 EStG). Vom Geschäftskonto gebucht bleibt es bei der Privatentnahme (1810 bzw. 2150). Ohne die Ablehnung stünde dieselbe Summe in der Anlage EÜR als Entnahme und als Einlage.

**GmbH und UG:** Eine Nachzahlung von Körperschaftsteuer, Soli oder Gewerbesteuer für ein Vorjahr verbraucht zuerst die Rückstellung, die der [Jahresabschluss](gmbh-abschluss.md#körperschaft--und-gewerbesteuer-gmbh-und-ug) zum 31.12. dieses Jahres gebucht hat, soweit Zahlungen für dasselbe Jahr sie nicht schon verbraucht haben; nur der Rest ist Aufwand für Vorjahre. Bleibt nach dem endgültigen Bescheid ein Rest der Rückstellung stehen, löst ihr ihn mit der Steuerberatung als manuelle Buchung auf. Nicht abziehbare Zinsen und Zuschläge rechnet die Steuerberechnung dem Einkommen wieder hinzu.

Erstattungszinsen zur Gewerbesteuer sind Betriebseinnahmen wie die zur Umsatzsteuer; § 4 Abs. 5b EStG nimmt nur die Nachzahlungszinsen aus dem Gewinn (BFH, Urteil vom 26.09.2025, IV R 16/23). Die Erstattung der Gewerbesteuer selbst bleibt außerhalb des Gewinns.

**Nicht unterstützt:** Erstattungszinsen zur Körperschaftsteuer und zum Solidaritätszuschlag der GmbH (steuerfrei nach § 10 Nr. 2 KStG; die Kürzung außerhalb der Bilanz bilden die Erklärungen in Haben nicht ab) und Steuern, die nicht in der Auswahl stehen. Die Kfz-Steuer kommt weiter mit einem Beleg (Kategorie „Kfz: Steuer“), die Lohnsteuer über die [Lohnabrechnung](lohn.md#buchung).

## Darlehen

Ein aufgenommenes Darlehen legst du unter **Geld › Darlehen** an: Name, **Darlehensgeber** (Kreditinstitut oder anderer Darlehensgeber; Darlehen von Gesellschaftern laufen weiter über das Gesellschafter-Verrechnungskonto), **Restlaufzeit** und **Verwendung** (laufender Betrieb oder Finanzierung von Anlagevermögen). Ein laufendes Darlehen bringt seine **Restschuld** zum Stichtag mit, etwa beim Umzug in Haben; ein neues beginnt bei null und bekommt seinen Bestand mit der Auszahlung. Die Restschuld gilt nach Tagesabschluss: Auszahlungen und Tilgungen bis einschließlich des Stichtags stecken schon darin, deshalb lehnt Haben es ab, einen Bankumsatz von diesem Tag oder früher als Auszahlung oder Tilgung zuzuordnen. Zinsen und Gebühren aus dieser Zeit lassen sich weiter zuordnen. Die Seite zeigt je Darlehen das Konto und den **Bestand**: Restschuld beim Anlegen plus Auszahlungen minus Tilgungen aus dem Bankabgleich. Nach der ersten Zuordnung sind Geber, Restlaufzeit, Verwendung und Restschuld fest, weil sie die Konten der gebuchten Zahlungen bestimmen; der Name bleibt änderbar.

Im Bankabgleich ordnest du unter **Direkt buchen** bzw. mit **Aufteilen** „Darlehen“ zu, mit dem Darlehen und dem Teil:

| Teil | Buchung | EÜR (Einzelunternehmen) |
| --- | --- | --- |
| Auszahlung (Eingang) | Bank an Darlehen | keine Wirkung |
| Tilgung (Ausgang, höchstens bis zum Bestand) | Darlehen an Bank | keine Wirkung |
| Zinsen | Zinsaufwand an Bank | Schuldzinsen |
| Gebühren (Bearbeitung, Bereitstellung) | Kreditprovisionen und Verwaltungskostenbeiträge an Bank | Schuldzinsen |

Konten (DATEV-Kontenrahmen 2026): Das Darlehen steht nach Geber und Restlaufzeit auf

| Restlaufzeit | Kreditinstitut SKR03 | SKR04 | Anderer Geber SKR03 | SKR04 |
| --- | --- | --- | --- | --- |
| ohne Angabe | 0630 | 3150 | 1705 Darlehen | 3560 |
| bis 1 Jahr | 0631 | 3151 | 1706 | 3561 |
| 1 bis 5 Jahre | 0640 | 3160 | 1707 | 3564 |
| größer 5 Jahre | 0650 | 3170 | 1708 | 3567 |

Eine Grenze für die Restlaufzeit legt Haben nicht fest: Du wählst sie beim Anlegen. Ohne Angabe bestätigst du sie in einer GmbH oder UG im [Jahresabschluss](gmbh-abschluss.md#vermerke-unter-der-bilanz) je Konto (§ 268 Abs. 5 HGB); die Konten mit Restlaufzeit vermerkt Haben dort von selbst. Zinsen gehen bei der Finanzierung von Anlagevermögen auf 2126 bzw. 7326 (Zinsen zur Finanzierung des Anlagevermögens), sonst auf 2120 bzw. 7320 (langfristige Verbindlichkeiten), mit Restlaufzeit bis zu einem Jahr auf 2110 bzw. 7310; Gebühren auf 2141 bzw. 7355.

Beispiel: Die Bank bucht eine Rate von 1.000,00 € ab, davon 800,00 € Tilgung und 200,00 € Zinsen. Mit **Aufteilen** in zwei Teile:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 0630 Verbindlichkeiten gegenüber Kreditinstituten | 3150 | 800,00 | |
| 2120 Zinsaufwendungen für langfristige Verbindlichkeiten | 7320 | 200,00 | |
| 1200 Bank | 1800 Bank | | 1.000,00 |

Der Umsatz ist ganz zugeordnet, der Bestand sinkt um 800,00 €, in der EÜR zählen nur die 200,00 € als Schuldzinsen (Anlage EÜR: übrige Schuldzinsen bzw. Schuldzinsen zur Finanzierung von Anlagevermögen). Die Grenze für Schuldzinsen bei Überentnahmen (§ 4 Abs. 4a EStG, Anlage SZ) rechnet Haben nicht; hast du mehr entnommen, als du Gewinn und Einlagen hattest, prüft das die Steuerberatung. In GmbH und UG rechnet die Steuerberechnung die Zinsen dem Gewerbeertrag anteilig hinzu (§ 8 Nr. 1 a GewStG, über dem Freibetrag).

Hebst du eine Zuordnung auf, kehrt der Bestand zurück: Eine aufgehobene Tilgung erhöht ihn wieder. Eine Auszahlung lässt sich nur aufheben, solange die Tilgungen danach nicht höher als der Bestand wären; sonst hebst du zuerst die Tilgungen auf.

**Nicht unterstützt:** Darlehen, die das Unternehmen vergibt, Darlehen in Fremdwährung, Disagio und Gesellschafterdarlehen mit eigenem Konto.
