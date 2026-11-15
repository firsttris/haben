---
title: "Abschluss für GmbH und UG: Bilanz, E-Bilanz, Ausschüttung"
description: >-
  Wie Haben bei GmbH und UG eröffnet, den Jahresabschluss mit Vermerken erstellt, beim Unternehmensregister
  hinterlegt, Körperschaft- und Gewerbesteuer rechnet, Gewinnausschüttungen bucht und die E-Bilanz übermittelt.
---

# Abschluss für GmbH und UG

Den Ablauf eines Jahres zeigt [GmbH und UG](gmbh.md), die Buchungslogik für alle Rechtsformen [Buchhaltung in Haben](buchhaltung.md).

## Saldenvortrag und Eröffnung (GmbH und UG)

Eine GmbH oder UG bilanziert: Ihre Bestandskonten laufen über den Jahreswechsel weiter. Haben trägt deshalb in der Saldenliste, im Kontenblatt und in den Kacheln der Seite **Konten** zum 1. Januar vor:

- **Bestandskonten** (Anlagen, Bank, Kasse, Forderungen, Verbindlichkeiten, Steuern, Eigenkapital, Gesellschafter) mit ihrem Saldo aus allen Vorjahren.
- **Erfolgskonten** (Erlöse und Aufwand) beginnen bei null. Ihr Ergebnis aus den Vorjahren steht als Gewinnvortrag (Saldo im Haben) bzw. Verlustvortrag vor Verwendung (im Soll) im Eigenkapital, bis eine Buchung es verwendet, etwa für eine Ausschüttung.

| Konto | SKR03 | SKR04 |
| --- | --- | --- |
| Gewinnvortrag vor Verwendung | 0860 | 2970 |
| Verlustvortrag vor Verwendung | 0868 | 2978 |

Die Summe aller Vorträge ist null wie im Journal. Bestandskonten sind nach DATEV im SKR04 die Klassen 0 bis 3, im SKR03 die Klassen 0, 1 und 7 sowie 3970 bis 3989 (Bestände; 3990 „Verrechnete Stoffkosten“ ist wieder Aufwand); die Klasse 9 trägt ebenfalls vor. Diese Einteilung ist gegen den DATEV-Kontenrahmen 2026 geprüft: Ein Konto hat dort genau dann einen Bilanzposten, wenn es ein Bestandskonto ist, ausgenommen die Konten der Ergebnisverwendung (SKR03 2795 bis 2868, SKR04 7700 bis 7751).

Alle vier Konten stehen so im DATEV-Kontenrahmen 2026.

Der Vortrag ist berechnet, nicht gebucht: Bucht jemand nachträglich ins Vorjahr (eine Rechnung vom 31.12., eine Abschlussbuchung), stimmt der Vortrag sofort wieder. Vorgetragen wird im Kontenrahmen der Firmendaten; bei GmbH und UG ist er deshalb ab der ersten Buchung fest (`0101_kontenrahmen_kapg.sql`). Im Einzelunternehmen mit EÜR beginnt jedes Jahr bei null. Den DATEV-Export betrifft der Vortrag nicht; den Saldenvortrag in DATEV übernimmt die Steuerberatung aus dem Vorjahr.

**Eröffnungsbuchung:** Beginnt die Buchhaltung der GmbH nicht in Haben, übernimmst du die Bestände der bisherigen Buchhaltung mit **Buchung erfassen › Eröffnungsbuchung**. Sie steht am 1. Januar des ersten Jahres in Haben und bucht nur Bestandskonten, dazu den Kontostand der Bank und 9000 Saldenvorträge, zum Beispiel:

| | SKR03 | SKR04 |
| --- | --- | --- |
| Bank an Saldenvorträge | 1200 an 9000 | 1800 an 9000 |
| Saldenvorträge an Gezeichnetes Kapital, Gewinnvortrag, Gesellschafter | 9000 an 0800, 0860, 0730 | 9000 an 2900, 2970, 3510 |

Offene Rechnungen und Belege übernimmst du einzeln über den [Umzug](lexoffice.md) (Forderung bzw. Verbindlichkeit an 9000), Anlagen über das [Anlagenverzeichnis](anlagen.md), die Kasse über das Kassenbuch. Sind alle Bestände übernommen, ist 9000 ausgeglichen.

**Eröffnung aus dem DATEV-Stapel:** Liegt der Buchungsstapel der bisherigen Buchhaltung im Archiv, schlägt Haben auf derselben Seite die ganze Eröffnung aus der Schlussbilanz des letzten Stapeljahres vor, mit allen Bestandskonten einschließlich Bank, Kasse, Forderungen, Verbindlichkeiten, Umsatzsteuer und Anlagen; gebucht wird sie erst nach deiner Bestätigung. Die Lockerung gilt nur für diesen Vorschlag, den Haben beim Buchen selbst neu rechnet; die Eröffnung von Hand bleibt auf Bestandskonten ohne Nebenbuch, Bank und 9000 beschränkt. Wie offene Posten, Umsatzsteuer und Kasse dabei behandelt werden, steht unter [Eröffnung aus dem DATEV-Stapel](lexoffice.md#eröffnung-aus-dem-datev-stapel-gmbh-und-ug). Ist sie gebucht, lehnt Haben eine weitere Eröffnung von Hand ab. In der Saldenliste stehen Eröffnungsbuchungen in der Spalte Eröffnung, im Journal mit der Herkunft „Eröffnung“.

Gibt es vor dem 1. Januar schon Buchungen in Haben, lehnt Haben eine Eröffnung ab; die Salden trägt es dann selbst vor. Umgekehrt lässt sich nach einer Eröffnung nichts mehr davor buchen, auch kein rückdatierter Beleg, sonst zählten die übernommenen Salden doppelt.

## Jahresabschluss (GmbH und UG)

> [!WARNING]
> Haben rechnet jedes Geschäftsjahr als Kalenderjahr mit Stichtag 31.12. Für ein abweichendes Wirtschaftsjahr (§ 4a Abs. 1 Satz 2 Nr. 2 EStG, § 7 Abs. 4 KStG) sind Abschluss, Hinterlegung, E-Bilanz und Steuern falsch ([Nur das Kalenderjahr als Wirtschaftsjahr](einrichtung.md#rechtsform-einzelunternehmen-gmbh-oder-ug)).

Unter **Buchhaltung › Jahresabschluss** zeigt Haben für eine GmbH oder UG Bilanz und Gewinn- und Verlustrechnung eines Jahres in der Form einer Kleinstkapitalgesellschaft (§ 267a HGB):

- **Bilanz** nur mit den Posten, die in § 266 Abs. 2 und 3 HGB Buchstaben tragen (§ 266 Abs. 1 Satz 4): Anlagevermögen, Umlaufvermögen, Rechnungsabgrenzung; Eigenkapital, Rückstellungen, Verbindlichkeiten, Rechnungsabgrenzung. Jeder Posten klappt die Konten auf, die in ihm stehen.
- **GuV** nach § 275 Abs. 5 HGB: Umsatzerlöse, sonstige Erträge, Materialaufwand, Personalaufwand, Abschreibungen, sonstige Aufwendungen, Steuern und als Ergebnis Jahresüberschuss oder Jahresfehlbetrag. Zinserträge zählen zu den sonstigen Erträgen, Zinsaufwand zu den sonstigen Aufwendungen.

Die Salden sind die der [Saldenliste](buchhaltung.md#die-seite-konten) zum 31.12., mit Vortrag. Das Jahresergebnis steht im Eigenkapital. Ein Konto des Umlaufvermögens mit Haben-Saldo (überzogene Bank, Umsatzsteuer-Zahllast) steht unter den Verbindlichkeiten, eine Verbindlichkeit mit Soll-Saldo (der Gesellschafter schuldet der GmbH) im Umlaufvermögen.

**Zuordnung der Konten:** Jedes Konto gehört nach seinem Kontenbereich zu einem Posten (`packages/core/src/hgb.ts`). Die Bereiche sind aus dem DATEV-Kontenrahmen 2026 erzeugt (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175): je Konto der Bilanz- bzw. GuV-Posten, den DATEV in der linken Spalte nennt, verdichtet auf die Ebene der Kleinstkapitalgesellschaft. Nennt DATEV zwei Posten („Sonstige Verbindlichkeiten oder Sonstige Vermögensgegenstände“), gilt der zweite bei umgekehrtem Saldo: Die überzogene Bank steht unter den Verbindlichkeiten, „Umsatzsteuer nicht fällig“ mit Haben-Saldo unter den Steuerrückstellungen, mit Soll-Saldo unter den sonstigen Vermögensgegenständen, das Gesellschafter-Verrechnungskonto je nach Saldo unter den Verbindlichkeiten oder Forderungen. Anlagevermögen gibt es nur in Klasse 0; gleichnamige Posten in Klasse 1 sind Umlaufvermögen. Erhaltene Anzahlungen, die DATEV offen von den Vorräten absetzt (SKR03 1722, SKR04 1190), stehen mit negativem Betrag im Umlaufvermögen; abgeführte Gewinne (Gewinngemeinschaft, Gewinnabführungsvertrag, stille Beteiligung) sind sonstige Aufwendungen. Jedes Konto, das Haben selbst bebucht, hat einen Posten. Keinen Posten haben Sonderposten und die Konten der Ergebnisverwendung (Einstellungen in Rücklagen, Ertrag aus Kapitalherabsetzung, Ausschüttung), die nach dem Jahresergebnis stehen; solche Konten und nicht ausgeglichene Vortragskonten (9000) nennt die Seite unter **Offene Punkte**, statt sie still wegzulassen.

### Vermerke unter der Bilanz

Unter den Posten stehen Vermerke, die das Gesetz auch der Kleinstkapitalgesellschaft nicht erlässt; ohne Anhang gehören sie in die Bilanz (`packages/core/src/bilanzvermerke.ts`):

- **Restlaufzeiten** ([§ 268 HGB](https://www.gesetze-im-internet.de/hgb/__268.html)): beim Umlaufvermögen die Forderungen mit einer Restlaufzeit von mehr als einem Jahr (Abs. 4 Satz 1), bei den Verbindlichkeiten die Beträge mit einer Restlaufzeit bis zu einem Jahr und von mehr als einem Jahr (Abs. 5 Satz 1). [§ 274a HGB](https://www.gesetze-im-internet.de/hgb/__274a.html) befreit kleine und Kleinstkapitalgesellschaften nur von Satz 2 bzw. Satz 3, den Erläuterungen im Anhang.
- **Gegenüber Gesellschaftern** ([§ 42 Abs. 3 GmbHG](https://www.gesetze-im-internet.de/gmbhg/__42.html)): Ausleihungen, Forderungen und Verbindlichkeiten gegenüber Gesellschaftern sind gesondert auszuweisen oder im Anhang anzugeben; stehen sie unter anderen Posten, ist das zu vermerken. Die Kleinst-Bilanz fasst sie mit den übrigen zusammen, also stehen darunter „davon Ausleihungen an Gesellschafter“, „davon Forderungen gegen Gesellschafter“ und „davon gegenüber Gesellschaftern“. Dazu zählen das Gesellschafter-Verrechnungskonto und die Gesellschafterkonten des DATEV-Kontenrahmens (SKR03 0580–0582, 0730–0755, 1381–1383, 1490–1495, 1507–1508, 1650–1658, 1665–1668; SKR04 0960–0961, 1250–1255, 1307–1309, 1330–1335, 3340–3348, 3510–3519, 3640–3643), nicht stille Gesellschafter. Diese Vermerke rechnet Haben aus den Salden.

**Restlaufzeiten bestätigen:** Die Restlaufzeit steht nicht in jeder Buchung. Die Seite **Jahresabschluss** zeigt deshalb den Abschnitt **Restlaufzeiten** mit jedem Konto, das eine Forderung (Position unter den Forderungen der E-Bilanz) oder eine Verbindlichkeit ist, mit Betrag und dem Teil, der mehr als ein Jahr läuft:

- **Fest** ist der Teil bei Konten, deren Name im DATEV-Kontenrahmen die Restlaufzeit nennt (etwa SKR03 0631/SKR04 3151 „Verbindlichkeiten gegenüber Kreditinstituten – Restlaufzeit bis 1 Jahr“, 0640/3160 „1 bis 5 Jahre“), und bei Konten, deren Saldo auf der Gegenseite den Posten mindert.
- **Vorgeschlagen** wird für Forderungen und Verbindlichkeiten aus Lieferungen und Leistungen, was an offenen Rechnungen bzw. gebuchten Belegen erst mehr als ein Jahr nach dem Stichtag fällig ist (ausgestellt bis zum Stichtag, nicht bis dahin storniert, abzüglich der bis dahin zugeordneten Zahlungen und Ausbuchungen wie Skonto oder Forderungsausfall; eine Korrekturrechnung mindert den Betrag wie in den offenen Posten). Für alle anderen Konten, auch das Gesellschafter-Verrechnungskonto, kennt Haben keine Laufzeit und schlägt 0 vor: Ohne vereinbarte Zeit ist eine Leistung sofort fällig ([§ 271 Abs. 1 BGB](https://www.gesetze-im-internet.de/bgb/__271.html)). Für ein Darlehen oder eine Stundung trägst du den Teil ein, der erst nach dem 31.12. des Folgejahres fällig ist.

Hat die Bilanz eine Vorjahresspalte, steht der Vorjahresstichtag darunter; was du für das Vorjahr bestätigt hast, gilt dort schon. **Restlaufzeiten bestätigen** speichert beides für das Jahr (Tabelle `residual_terms`, mit Änderungsprotokoll). Bestätige nach den Abschlussbuchungen; ändert sich danach ein Betrag, etwa durch eine Buchung ins Jahr, sagt die Seite, dass neu zu bestätigen ist. Ohne bestätigte Restlaufzeiten fehlen sie unter der Bilanz und in der E-Bilanz, und die Bilanz zur Hinterlegung lässt sich nicht herunterladen.

> [!WARNING]
> Bilanz und GuV sind ein **Entwurf für die Steuerberatung**. Die Rückstellungen für Körperschaft- und Gewerbesteuer rechnet und bucht Haben ([unten](#körperschaft--und-gewerbesteuer-gmbh-und-ug)); andere Abschlussbuchungen wie Abschlusskosten, Rechnungsabgrenzung und Wertberichtigungen erfasst ihr vorher als [manuelle Buchung](buchhaltung.md#manuelle-und-freie-buchungen). Die Bilanz zur Hinterlegung beim Unternehmensregister erstellt Haben aus denselben Zahlen ([unten](#hinterlegung-beim-unternehmensregister-gmbh-und-ug)).

**Jahr abschließen:** Wenn die Steuerberatung den Abschluss freigegeben hat, schließt der Knopf **‹Jahr› abschließen** (etwa „2025 abschließen“) im Abschnitt **Jahr abschließen** das Jahr ab, nach einer Rückfrage mit Häkchen. Vorher muss das Jahr vorbei sein, die AfA aller Anlagen gebucht und jeder Beleg mit Datum im Jahr gebucht. Danach:

- nimmt das Jahr keine Buchung mehr an, auch keine Gegenbuchung. Das prüft das Hauptbuch und, auch für Schreiber an Haben vorbei, ein Trigger der Datenbank (`0098_jahresabschluss_trigger.sql`). Rückgängig machen lässt sich der Abschluss nicht; `year_closings` ist nur anhängbar.
- hält Haben Zahl und Prüfwert der Buchungen des Jahres fest: SHA-256 über ID und Inhalt jeder Buchung samt Zeilen, gerechnet wie ihr Siegel. Die Seite rechnet ihn bei jedem Aufruf aus den aktuellen Daten nach und zeigt, ob die Buchungen seitdem unverändert sind. Der Abschluss selbst steht mit Prüfwert im Änderungsprotokoll und damit in der Hash-Kette.

Fehler im abgeschlossenen Jahr korrigiert ihr im laufenden Jahr, wie es das Handelsrecht vorsieht.

## Hinterlegung beim Unternehmensregister (GmbH und UG)

Eine Kleinstkapitalgesellschaft (§ 267a HGB) muss ihren Jahresabschluss nicht offenlegen, sondern kann nur die Bilanz beim Unternehmensregister hinterlegen (§ 326 Abs. 2 HGB). Dritte sehen sie dann nur auf Antrag und gegen Gebühr. Die Frist endet ein Jahr nach dem Bilanzstichtag, für 2025 also am 31.12.2026 (§ 325 Abs. 1a HGB); wer sie versäumt, riskiert ein Ordnungsgeld (§ 335 HGB).

Auf der Seite **Jahresabschluss** eines vergangenen Jahres erstellt Haben dafür unter **Hinterlegung beim Unternehmensregister** die Bilanz als PDF. Die Seite nennt die Frist und weist darauf hin, solange das Jahr nicht abgeschlossen ist: Hinterlegt wird erst, wenn die Steuerberatung den Abschluss freigegeben hat, die Gesellschafter ihn festgestellt haben und das Jahr in Haben abgeschlossen ist. Danach ändert keine Buchung mehr die Zahlen.

**Was auf dem Blatt steht** (`packages/core/src/hinterlegung.ts`):

- **Firma, Sitz, Registergericht und Registernummer** (§ 264 Abs. 1a HGB) aus den [Firmendaten](einrichtung.md#firmendaten). Fehlen Registergericht oder Registernummer, ist der Download gesperrt und die Seite sagt, was fehlt.
- **Die Bilanz** in der verkürzten Form wie oben, mit der **Spalte des Vorjahres** (§ 265 Abs. 2 HGB). Die Vorjahreszahlen sind die Salden zum 1. Januar, also die Schlussbilanz des Vorjahres, ob in Haben vorgetragen oder per Eröffnungsbuchung übernommen; was im Jahr gegen 9000 Saldenvorträge übernommen ist (offene Posten aus dem Umzug, Anlagen), zählt dazu. Gibt es zum 1. Januar keine Salden (erstes Geschäftsjahr), fehlt die Spalte, und die Seite sagt das. Posten ohne Betrag in beiden Jahren entfallen (§ 265 Abs. 8 HGB), das Eigenkapital steht immer da.
- **Vermerke** unter Umlaufvermögen, Anlagevermögen und Verbindlichkeiten zu Restlaufzeiten und gegenüber Gesellschaftern, in beiden Spalten ([oben](#vermerke-unter-der-bilanz)). Solange die Restlaufzeiten nicht bestätigt sind, ist der Download gesperrt und die Seite sagt, für welchen Stichtag sie fehlen.
- Ist das Eigenkapital durch Verluste aufgebraucht, steht das Eigenkapital mit 0,00 und der Rest als **Nicht durch Eigenkapital gedeckter Fehlbetrag** am Schluss der Aktivseite (§ 268 Abs. 3 HGB).
- **Angaben unter der Bilanz**, die den Anhang ersetzen (§ 264 Abs. 1 Satz 5 HGB): Haftungsverhältnisse (§ 268 Abs. 7, § 251 HGB), etwa Bürgschaften für Dritte, und Vorschüsse und Kredite an Geschäftsführer (§ 285 Nr. 9 Buchst. c HGB). Vorgewählt ist jeweils „Keine“; gibt es welche, wählst du „Ja, folgende“ und schreibst sie so, wie sie unter der Bilanz stehen sollen. Haben übernimmt den Text unverändert und erfindet nichts. Die dritte Angabe des Gesetzes, eigene Aktien, betrifft nur die Aktiengesellschaft.
- **Tag der Feststellung** durch die Gesellschafter (§ 46 Nr. 1 GmbHG), Pflicht nach § 328 Abs. 1a und 5 HGB; er muss nach dem Stichtag liegen und darf nicht in der Zukunft liegen.
- Den Hinweis, dass die Gesellschaft eine Kleinstkapitalgesellschaft ist und keinen Anhang aufstellt.

Die GuV gehört nicht zur Hinterlegung. Die Angaben unter der Bilanz und der Tag der Feststellung werden nicht gespeichert; das PDF entsteht beim Herunterladen (`/api/hinterlegung/<jahr>`).

**Einreichen:** Das PDF lädst du auf der [Publikations-Plattform](https://www.publikations-plattform.de) als Hinterlegungsauftrag an das Unternehmensregister hoch. Für Geschäftsjahre ab 2022 gelten dafür die [Allgemeinen Nutzungsbedingungen für das Unternehmensregister](https://www.publikations-plattform.de/order/D088.pdf), nicht mehr die AGB des Bundesanzeigers für die Hinterlegung (D089), die nur noch frühere Geschäftsjahre betreffen.

- **Formate:** Direkt angenommen wird XML/XBRL nach dem Schema oder dem Webformular des Bundesanzeiger Verlags. Word, RTF, Excel und PDF wandelt das Register gegen ein Entgelt um (§ 9 der Nutzungsbedingungen). Ein PDF muss les-, kopier- und druckbar sein, den ganzen Text enthalten, darf weder verschlüsselt sein noch JavaScript oder Formulare enthalten und muss auf A4 passen, höchstens 25 MB.
- **Warum Haben ein PDF erzeugt:** Das Schema des Betreibers ist nicht öffentlich ([XML oder XBRL statt PDF](#xml-oder-xbrl-statt-pdf)). Ein PDF/A mit echtem Text, wie bei der Rechnung mit Typst gesetzt, erfüllt die Anforderungen, ist archivierbar und kommt beim Register so an, wie du es siehst. Wer die Umwandlung sparen will, tippt die Bilanz in das Webformular ab.
- **Mitteilung:** Hinterlegen darf die Gesellschaft nur, wenn sie dem Register mitteilt, dass sie zwei der drei Merkmale einer Kleinstkapitalgesellschaft (§ 267a Abs. 1 HGB) an den maßgeblichen Stichtagen nicht überschreitet (§ 326 Abs. 2 Satz 2 HGB). Das bestätigst du beim Hinterlegungsauftrag auf der Plattform.
- **Kosten:** 18,50 € Gebühr (Nr. 1420 des [Kostenverzeichnisses zum JVKostG](https://www.gesetze-im-internet.de/jvkostg/anlage.html)), für ein PDF dazu 1,75 Cent je sichtbarem Zeichen zuzüglich Umsatzsteuer ([Gebühren und Entgelte](https://www.publikations-plattform.de/order/D051Preisliste.pdf), Stand November 2026). Ein gescanntes Dokument kostet 2,50 Cent je Zeichen.

> [!WARNING]
> Prüfe das PDF vor dem Hochladen mit der Steuerberatung. Nicht abgebildet sind eine Gesellschaft in Liquidation (§ 264 Abs. 1a Satz 2 HGB) und Geschäftsjahre, die nicht am 31.12. enden.
>
> Das Eigenkapital steht als ein Posten ohne gezeichnetes Kapital: Das genügt bei der Kleinstkapitalgesellschaft (§ 266 Abs. 1 Satz 4 HGB, nur die Posten mit Buchstaben).

Gesetzestexte: [§ 264](https://www.gesetze-im-internet.de/hgb/__264.html), [§ 265](https://www.gesetze-im-internet.de/hgb/__265.html), [§ 266](https://www.gesetze-im-internet.de/hgb/__266.html), [§ 267a](https://www.gesetze-im-internet.de/hgb/__267a.html), [§ 268](https://www.gesetze-im-internet.de/hgb/__268.html), [§ 274a](https://www.gesetze-im-internet.de/hgb/__274a.html), [§ 285](https://www.gesetze-im-internet.de/hgb/__285.html), [§ 325](https://www.gesetze-im-internet.de/hgb/__325.html), [§ 326](https://www.gesetze-im-internet.de/hgb/__326.html), [§ 328 HGB](https://www.gesetze-im-internet.de/hgb/__328.html), [§ 42 GmbHG](https://www.gesetze-im-internet.de/gmbhg/__42.html).

### XML oder XBRL statt PDF

Ein PDF nimmt das Unternehmensregister nur gegen ein Entgelt für die Umwandlung an: 1,75 Cent je sichtbarem Zeichen ohne Leerzeichen zuzüglich Umsatzsteuer, zusätzlich zur Gebühr ([Gebühren und Entgelte](https://www.publikations-plattform.de/order/D051Preisliste.pdf), Abschnitt 2). Ohne dieses Entgelt angenommen werden XML oder XBRL nach den Vorgaben des Bundesanzeiger Verlags und das Webformular der Plattform ([Allgemeine Nutzungsbedingungen für das Unternehmensregister](https://www.publikations-plattform.de/order/D088.pdf), §§ 8 und 9). Haben erzeugt kein XML und kein XBRL zur Hinterlegung; geprüft im November 2026 unter **Arbeitshilfen & Standards › Technische Standards** der Publikations-Plattform:

- **XML nach dem Schema des Verlags.** Die Schemata „Bundesanzeiger“ und „Unternehmensregister“ (Stand September 2007) beschreiben ein Layout aus Überschriften, Absätzen und Tabellen. Der Download setzt eine gesonderte Freischaltung voraus, und die [Nutzungsbedingungen für die Strukturdefinitionen](https://www.publikations-plattform.de/order/de/arbeitshilfenstandards/standards/xml_schemata) (Stand 02.07.2016) erlauben sie nur, um eigene Daten oder die eigener Kunden an den Verlag zu übermitteln, und untersagen „jegliche Vervielfältigung und/oder Weitergabe“. Das Schema kann also nicht in dieses Repository, und ohne Schema lässt sich keine Datei prüfen.
- **XBRL nach der HGB-Taxonomie.** Das Register nimmt Jahresabschlüsse als XBRL 2.1 mit Dimensions 1.0 nach der HGB-Taxonomie von XBRL Deutschland an, auch in der Sicht „Einzelabschluss MicroBilG“ (`de-gaap-ci-2025-04-01-microbilg` mit `de-gcd-2025-04-01` für Version 6.9; [Arbeitshilfe für die Einreichung im XBRL-Format](https://www.publikations-plattform.de/order/D008.pdf), Stand September 2025). Das ist dieselbe Taxonomie, Version 6.9, die Haben für die [E-Bilanz](#e-bilanz-gmbh-und-ug) nutzt. Für eine Einreichung fehlt aber die Dokumentation des Verlags für Softwareanbieter, die es nur nach der Freischaltung gibt, und der Zugang zur Testplattform, den der Verlag auf Anfrage vergibt ([XBRL-Programm](https://www.publikations-plattform.de/order/de/arbeitshilfenstandards/arbeitshilfen/xbrlprogramm)). Sollen Texte wie die Angaben unter der Bilanz mit Absätzen oder Listen erscheinen, braucht es zudem das Zusatzschema „BA-Jahresabschluss-XHTML“, ebenfalls hinter der Freischaltung; XBRL-Dateien, deren gestaltete Fußnoten nicht dagegen gültig sind, nimmt der Verlag nicht an. Ohne das Zusatzschema erscheinen Texte als einfache Fußnoten (Arbeitshilfe, S. 2). Haben kennt von der Taxonomie außerdem nur einen Auszug für die Übermittlung an ELSTER, nicht ihre Dateien und Bezeichnungen. Ohne die Vorgaben und ohne Prüfung gegen die Testplattform wäre eine solche Datei geraten.

Was dafür fehlt, steht in der [Roadmap](roadmap.md#nicht-machbar-ohne-zertifizierung-oder-lizenz).

## Körperschaft- und Gewerbesteuer (GmbH und UG)

Auf der Seite **Jahresabschluss** rechnet Haben Körperschaftsteuer, Solidaritätszuschlag und Gewerbesteuer des Jahres aus dem Jahresergebnis (`packages/core/src/koerperschaft.ts`) und bucht die Rückstellungen dafür. Dazu braucht es je Jahr drei Angaben: den **Hebesatz** der Gemeinde und die **Verlustvorträge** zum 31.12. des Vorjahres für Körperschaftsteuer und Gewerbesteuer, wie sie im Bescheid stehen. Ohne gespeicherte Angaben schlägt Haben die des Vorjahres vor, mit den Vorträgen nach seiner eigenen Rechnung; speichert sie erst, wenn sie zum Bescheid passen.

| Schritt | Was Haben rechnet |
| --- | --- |
| Jahresergebnis | aus der GuV, wie im Jahresabschluss |
| + nicht abziehbare Aufwendungen | gebuchte Körperschaftsteuer und Soli (§ 10 Nr. 2 KStG), Gewerbesteuer (§ 4 Abs. 5b EStG), Steuern für Vorjahre und Erstattungen, Kapitalertragsteuer, die Konten für nicht abziehbare Geschenke, Bewirtung und Betriebsausgaben, dazu 30 % der Bewirtungskosten (§ 4 Abs. 5 Nr. 2 EStG; Haben bucht die Bewirtung voll) |
| = Einkommen | zugleich Gewinn aus Gewerbebetrieb (§ 7 GewStG) |
| − Verlustabzug | bis 1 Mio. € voll, darüber 70 % (2024 bis 2027, § 10d Abs. 2 EStG), sonst 60 % |
| Körperschaftsteuer | 15 % des zu versteuernden Einkommens in vollen Euro; Soli 5,5 % davon, Bruchteile eines Cents fallen weg |
| + Hinzurechnung § 8 Nr. 1 GewStG | ein Viertel der Summe aus Zinsen (voll, auch die zur Finanzierung des Anlagevermögens aus den [Darlehen](bank-steuern-darlehen.md#darlehen)), Miete und Leasing beweglicher Wirtschaftsgüter (20 %), unbeweglicher (50 %) und Aufwand für Rechte (25 %), soweit sie 200.000 € übersteigt; gelesen aus den DATEV-Konten mit Kennzeichen G |
| − Gewerbeverlust | bis 1 Mio. € voll, darüber 60 % (§ 10a GewStG) |
| Gewerbesteuer | Gewerbeertrag auf volle 100 € abgerundet, ohne Freibetrag (Kapitalgesellschaft), Messzahl 3,5 %, mal Hebesatz |

Weil die gebuchten Steuern wieder hinzugerechnet werden, ändert eine gebuchte Rückstellung das Ergebnis nicht. **Rückstellungen zum 31.12.‹Jahr› buchen** nennt in einer Rückfrage Stichtag und Beträge und bucht dann als Umbuchung zum 31.12., was zur Steuer noch fehlt: Körperschaftsteuer und Soli an Körperschaftsteuerrückstellung (SKR03 0963, SKR04 3040), Gewerbesteuer an Gewerbesteuerrückstellung (0956 bzw. 3035). Vorauszahlungen, auf die Steueraufwandskonten gebucht (SKR03 2200, 2208, 4320; SKR04 7600, 7608, 7610), sind abgezogen; im Bankabgleich ordnest du sie als [Steuerzahlung](bank-steuern-darlehen.md#steuerzahlungen) des laufenden Jahres zu. Übersteigen sie die Steuer, bucht Haben keine Erstattung; die Forderung gegen das Finanzamt bucht ihr mit der Steuerberatung. Eine Nachzahlung für ein Vorjahr verbraucht im Bankabgleich zuerst die Rückstellung dieses Jahres, der Rest geht auf die Konten für Vorjahre. Zinsen und Zuschläge zu Körperschaft- und Gewerbesteuer (SKR03 2102, 2104, 2105, 2108, 4397; SKR04 7302, 7304, 7308, 7306, 6437) rechnet die Steuerberechnung als nicht abziehbar hinzu (§ 10 Nr. 2 KStG, § 4 Abs. 5b EStG), in der Anlage GK unter den übrigen nicht abziehbaren Aufwendungen.

Im Verlustjahr lässt sich ein **Verlustrücktrag** in die zwei Vorjahre eintragen (höchstens 1 Mio. €, § 10d Abs. 1 EStG); leer bedeutet Verzicht, der ganze Verlust geht in den Vortrag. Die Gewerbesteuer kennt keinen Rücktrag.

Nicht gerechnet werden steuerfreie Erträge (§ 8b KStG), der Spendenabzug (§ 9 KStG), verdeckte Gewinnausschüttungen und Einlagen, Kürzungen nach § 9 GewStG und die Zerlegung auf mehrere Gemeinden. Hat die GmbH davon etwas, rechnet die Steuerberatung. Aus der Rechnung macht Haben auch die [Körperschaft- und Gewerbesteuererklärung](jahreserklaerung.md#körperschaft--und-gewerbesteuererklärung-gmbh-und-ug).

## Gewinnausschüttung (GmbH und UG)

Unter **Steuern › Ausschüttungen** bucht Haben den Gewinnverwendungsbeschluss einer GmbH oder UG und meldet die Kapitalertragsteuer an. Du gibst Datum des Beschlusses, das Geschäftsjahr, dessen Gewinn ausgeschüttet wird (vorbelegt mit dem Vorjahr; es steht in der Steuerbescheinigung), den Betrag und, wenn der Beschluss einen bestimmt, den Tag der Auszahlung ein. Ohne Auszahlungstag fließt die Ausschüttung am Tag nach dem Beschluss zu (§ 44 Abs. 2 Satz 2 EStG).

**Steuerabzug je Gesellschafter** (`packages/core/src/ausschuettung.ts`). Gesellschafter, Anteile und Kirchensteuerabzugsmerkmal kommen aus den [Angaben zur Körperschaftsteuererklärung](jahreserklaerung.md#körperschaft--und-gewerbesteuererklärung-gmbh-und-ug) des Jahres.
- **Ohne Kirchensteuer:** 25 % Kapitalertragsteuer.
- **Mit Kirchensteuer:** Die Kapitalertragsteuer ist ermäßigt auf Ertrag / (4 + Kirchensteuersatz), bei 9 % also 24,45 % (§ 43a Abs. 1 Satz 2, § 32d Abs. 1 Satz 4 EStG). Die Kirchensteuer selbst beträgt 8 oder 9 % der Kapitalertragsteuer.
- **Solidaritätszuschlag:** 5,5 % der Kapitalertragsteuer.
- **Rundung:** Bruchteile eines Cents fallen weg.
- **Einlagekonto:** Was über den ausschüttbaren Gewinn hinausgeht, kommt ohne Steuerabzug aus dem steuerlichen Einlagekonto, höchstens bis zu dessen Bestand (§ 27 Abs. 1 KStG). Der ausschüttbare Gewinn ist das Eigenkapital zum Schluss des Vorjahres, abzüglich Stammkapital und Einlagekonto und abzüglich der Ausschüttungen des Jahres davor.

**Buchung** zum Datum des Beschlusses: Gewinnvortrag (SKR03 0860, SKR04 2970) an Gesellschafter-Verrechnungskonto (0730 bzw. 3510) mit der Nettodividende und an Verbindlichkeiten aus Einbehaltungen (1746 bzw. 3760) mit Kapitalertragsteuer, Soli und Kirchensteuer.
- **Grenze:** Mehr als den Gewinnvortrag zum Beschluss schüttet Haben nicht aus.
- **Auszahlung:** Die Auszahlung an die Gesellschafter ordnest du im Bankabgleich wie jede Zahlung an sie dem Gesellschafter-Verrechnungskonto zu.
- **Steuern an das Finanzamt:** Die Überweisung der einbehaltenen Steuern ordnest du als **Kapitalertragsteuer an das Finanzamt** zu.

**Kapitalertragsteuer-Anmeldung** (KapEStA, `packages/elster/src/kapesta.ts`). Sie geht über ERiC wie die Voranmeldung. Die Frist ist der 10. des Monats nach dem Zufluss, an einem Wochenende oder Feiertag der nächste Werktag; sie steht in der [Fristenliste](fristen.md). Gemeldet werden:
- Kapitalerträge, Kapitalertragsteuer und Soli;
- der Gewinnverteilungsbeschluss mit Datum, Betrag und Zufluss;
- die Kirchensteuer je Religionsschlüssel aus dem Kirchensteuerabzugsmerkmal.

In der **Körperschaftsteuererklärung** des Jahres stehen die Ausschüttungen in der Anlage KSt 1 F (`packages/elster/src/kst1f.ts`). Dort stehen auch der ausschüttbare Gewinn und der Abzug vom Einlagekonto. Das Einlagekonto mindert sich nur um den Betrag, den die Steuerbescheinigung an die Gesellschafter als Leistung aus dem Einlagekonto ausweist (§ 27 Abs. 3 und 5 KStG). Haben setzt den berechneten Teil als bescheinigt an.

Ein **Storno** ist eine Gegenbuchung und geht nur, solange die Anmeldung nicht echt übermittelt ist. Danach korrigiert eine berichtigte Anmeldung über das ELSTER-Portal.

**Steuerbescheinigung** (§ 45a Abs. 2 EStG). Die GmbH bescheinigt jedem Gesellschafter als Schuldner der Kapitalerträge, was sie ausgeschüttet und einbehalten hat; er braucht die Bescheinigung für seine Einkommensteuererklärung. Unter jeder gebuchten Ausschüttung steht je Gesellschafter ein Link **Steuerbescheinigung … (PDF)**.
- **Muster:** Haben folgt dem amtlichen Muster II („Steuerbescheinigung einer leistenden Körperschaft, Personenvereinigung oder Vermögensmasse oder eines Personenunternehmens oder eines Spezial-Investmentfonds oder eines inländischen Betreibers/einer inländischen Zweigniederlassung eines ausländischen Betreibers einer Internet-Dienstleistungsplattform“) aus dem [BMF-Schreiben vom 16. Mai 2025](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Abgeltungsteuer/2025-05-16-kapitalertragSt-steuerbescheinigung.pdf) (BStBl I 2025 S. 1388; das Muster allein als PDF beim [Bayerischen Landesamt für Steuern](https://www.lfst.bayern.de/fileadmin/RESSOURCEN/Formulare/Weitere_Themen_A_bis_Z/Kapitalertragsteuer/Steuerbescheinigung_Muster_II.pdf)), als Einzelsteuerbescheinigung für den Zahlungstag. Nach Rz. 1 des Schreibens darf nach Inhalt, Aufbau und Reihenfolge nicht vom Muster abgewichen werden; frei sind nur die Felder für Schuldner und Gläubiger. Inhalt in `packages/core/src/steuerbescheinigung.ts`, PDF mit derselben Vorlage wie die Mahnung in `packages/einvoice`.
- **Inhalt:** Schuldner (die Gesellschaft mit Anschrift und Steuernummer), Titel, Art der Bescheinigung, dann der Satz des Musters „An … wurden lt. Beschluss vom … am … für das Geschäftsjahr … folgende Kapitalerträge gezahlt“ mit Name, Anschrift und Identifikationsnummer des Gesellschafters. Darunter die Zeilen im Wortlaut des Musters: Kapitalerträge im Sinne des § 43 Abs. 1 Satz 1 Nr. 1 EStG, Summe Kapitalertragsteuer, Summe Solidaritätszuschlag, Summe Kirchensteuer zur Kapitalertragsteuer, bei Kirchensteuer die kirchensteuererhebende Religionsgemeinschaft mit Namen, und Leistungen aus dem steuerlichen Einlagekonto; dazu die Fußnoten des Musters zur Anlage KAP. Was aus dem Einlagekonto kommt, ist kein Kapitalertrag und steht nur in der letzten Zeile. Zeilen für andere Kapitalerträge (Zinsen, Investmenterträge, Lebensversicherungen, ausländische Steuer) lässt Haben weg, weil sie bei einer Gewinnausschüttung nicht vorkommen.
- **Woher die Angaben kommen:** Beträge, Beschluss und Geschäftsjahr aus der gebuchten Ausschüttung; Anschrift, Identifikationsnummer und Religionsgemeinschaft aus den Angaben zur Körperschaftsteuererklärung des Beschlussjahres; der Schuldner aus den Firmendaten. Ausschüttungen, die gebucht wurden, bevor Haben das Geschäftsjahr erfragt hat, bekommen keine Bescheinigung: Der Zeitraum gehört zum Inhalt von Muster II, und Rz. 1 des BMF-Schreibens erlaubt keine Abweichung. Für eine Bescheinigung die Ausschüttung stornieren und mit Geschäftsjahr neu buchen.
- **Was fehlt, steht dort:** Fehlt die Anschrift, die Identifikationsnummer (eine Steuernummer genügt nicht) oder bei Kirchensteuer der Name der Religionsgemeinschaft, zeigt Haben das statt des Links und erzeugt keine unvollständige Bescheinigung. Den Religionsschlüssel aus dem Kirchensteuerabzugsmerkmal braucht nur die Kapitalertragsteuer-Anmeldung; die Bescheinigung verlangt den Namen.
- **Ab dem Zahlungstag:** Weil der Zahlungstag zu bescheinigen ist, gibt es die Bescheinigung erst ab dem Zufluss; zu einer stornierten Ausschüttung gibt es keine.
- **Unterschrift:** Die Bescheinigung ist maschinell erstellt und nennt den Aussteller; eine Unterschrift braucht sie dann nicht (§ 45a Abs. 2 Satz 3 EStG).
- **Übergabe und Aufbewahrung:** Gib jedem Gesellschafter seine Bescheinigung und leg eine Kopie zu den Unterlagen der Ausschüttung. Haben speichert die Bescheinigung nicht, sondern erzeugt sie bei jedem Abruf neu, mit dem Tag des Abrufs als Ausstellungsdatum. Ist eine ausgegebene Bescheinigung falsch, ersetzt die GmbH sie unverzüglich durch eine berichtigte, die als solche gekennzeichnet ist, und meldet die Berichtigung ihrem Betriebsstättenfinanzamt nach § 93c AO ([§ 45a Abs. 5 EStG](https://www.gesetze-im-internet.de/estg/__45a.html)); für eine falsche Bescheinigung haftet sie (Abs. 6). Eine berichtigte Bescheinigung erzeugt Haben nicht.

> [!WARNING]
> Haben fragt die Kirchensteuerabzugsmerkmale nicht selbst beim Bundeszentralamt für Steuern ab (KiStAM-Abfrage, jährlich zwischen 1. September und 31. Oktober); trag sie aus der Antwort ein. Nicht abgedeckt sind Ausschüttungen aus der Kapitalrücklage, verdeckte Gewinnausschüttungen, Gesellschafter im Ausland, Freistellungsaufträge und Nichtveranlagungsbescheinigungen. Die Steuerbescheinigung deckt nur Gesellschafter mit steuerlicher Identifikationsnummer ab, also natürliche Personen; für eine Gesellschaft als Gesellschafterin stellt sie die Steuerberatung aus.

## E-Bilanz (GmbH und UG)

Eine Kapitalgesellschaft übermittelt Bilanz und GuV elektronisch an das Finanzamt (§ 5b EStG), mit derselben Frist wie die Steuererklärungen. Auf der Seite **Jahresabschluss** steht dafür unten der Abschnitt **E-Bilanz**: Haben baut sie aus den Buchungen des Jahres, lässt sie von ERiC prüfen und sendet sie wie die [Jahreserklärungen](jahreserklaerung.md) mit Zertifikat und PIN.

**Taxonomie:** Für Wirtschaftsjahre bis 2026 sendet Haben in der HGB-Taxonomie 6.9, ab 2027 in der Taxonomie 6.10. Das folgt den BMF-Schreiben vom 10. Juni 2025 und 8. Juni 2026: Eine neue Taxonomie gilt grundsätzlich für Wirtschaftsjahre, die nach dem 31. Dezember des Vorjahres beginnen; für das Jahr davor ist sie nur „nicht beanstandet“. Für 2026 bleibt es deshalb bei 6.9, die jedes ERiC ab 43 prüft. Die Taxonomie 6.10 kann erst ERiC 45 prüfen, als Test; Echtfälle nimmt die Finanzverwaltung voraussichtlich ab dem ERiC-Release im Mai 2027 an. Ist ein älteres ERiC installiert (etwa 44, der Standard), nennt der Abschnitt für 2027 das als offenen Punkt und sendet nicht, bis unter **Einstellungen › ELSTER › ERiC** eine Version ab 45 installiert ist.

**Was gesendet wird:** ein Jahresabschluss (Einzelabschluss) nach deutschem Steuerrecht in der HGB-Taxonomie 6.9 oder 6.10, Kerntaxonomie, GuV nach dem Gesamtkostenverfahren, mit

- **Bilanz und GuV** in der Gliederung der Taxonomie. Die ist feiner als der Kleinst-Abschluss: Umsatzerlöse nach Umsatzsteuer (Regelsatz, ermäßigt, nicht steuerbar, steuerfrei), sonstige Aufwendungen nach Art (Kommunikation, Beratung, Fuhrpark, Werbung …), Anlagen nach Bilanzposition.
- **Anlagenspiegel** je Bilanzposition des Anlagevermögens aus dem [Anlagenverzeichnis](anlagen.md): Anschaffungskosten am Jahresanfang, Zugänge, Abgänge, kumulierte AfA und AfA des Jahres. Eine übernommene Anlage bringt ihre Anschaffungskosten mit, die AfA davor ist der Unterschied zum übernommenen Buchwert. GWG und Sammelposten gehen ab, sobald sie abgeschrieben sind. In 6.10 muss der Buchwert des Anlagevermögens im Anlagenspiegel dem Wert der Bilanz gleichen, auch wenn er 0 ist: Ohne Anlagen im Jahr bleibt der Anlagenspiegel dort weg, sind alle Anlagen abgeschrieben, steht das Anlagevermögen mit 0 in der Bilanz.
- **Kontennachweis:** jedes Konto mit Saldo am Jahresende einzeln, mit Nummer, Bezeichnung und Saldo auf seiner Position (§ 5b Abs. 1 EStG, für Wirtschaftsjahre ab 2025). Der Saldo steht im Vorzeichen der Position, sodass die Konten einer Position ihren Wert ergeben. Den Jahresüberschuss schließt Haben nicht auf ein Konto ab; er steht in 6.10 als Eintrag „Konto nicht vorhanden oder nicht übermittelbar“. Die Davon-Positionen zu Restlaufzeiten bekommen keinen Nachweis, weil sie in keiner Rechenregel stehen.
- **Betriebsvermögensvergleich:** Eigenkapital am Ende des Vorjahres (der EB-Wert der Eigenkapitalkonten aus Vortrag und Eröffnungsbuchung), Einlagen (Buchungen im Haben der Eigenkapitalkonten im Jahr) und Ausschüttungen (Buchungen im Soll). Er muss den Jahresüberschuss der GuV ergeben. Zahlt ihr das Stammkapital im Gründungsjahr ein, bucht das deshalb als normale Buchung, nicht als Eröffnung: Dann ist es eine Einlage und das Eigenkapital des Vorjahres null.

- **Davon-Positionen zu Restlaufzeiten**, sobald sie [bestätigt](#vermerke-unter-der-bilanz) sind: je Gruppe der Forderungen und Verbindlichkeiten (aus Lieferungen und Leistungen, gegenüber Kreditinstituten, gegenüber Gesellschaftern, sonstige) „Restlaufzeit bis 1 Jahr“ und „größer 1 Jahr“ (`upTo1year`, `above1year`) und die Summen über alle Forderungen und Verbindlichkeiten. Die Taxonomie verlangt sie nicht; ohne Bestätigung fehlen sie, und der Abschnitt weist darauf hin.

Den Kontennachweis verlangt die Taxonomie 6.10 zu jeder Position von Bilanz und GuV mit Wert, die keine Unterposition mit Wert hat (Technischer Leitfaden 6.10, Tz. B.12.1). In 6.9 sendet Haben ihn ebenso mit; dort reicht der Taxonomie ein Kontensaldo in Bilanz und GuV, und ohne Konto in der GuV, etwa in einem Jahr ohne Buchung, steht wie bisher der Vermerk, dass die Kontennachweise noch nicht übermittelt werden können. In 6.9 erlaubt das BMF-Schreiben vom 10. Juni 2025 das nur, wenn die Kontennachweise auf anderem Weg beim Finanzamt eingehen.

**Gesellschafter:** Die Stammdaten führen den Gesellschafter als Mussfeld, für eine GmbH ohne Angaben. Die neuen Prüfregeln der Taxonomie 6.10 zu Steuernummer, Identifikationsnummer und Wirtschafts-Identifikationsnummer der Gesellschafter gelten nur für Personengesellschaften (Technischer Leitfaden 6.10, Tz. B.14.3.1.19); die neue Angabe „noch nicht vergeben“ lässt Haben deshalb weg.

**Zuordnung der Konten** (`packages/core/src/ebilanz.ts`): Jedes Konto, das Haben selbst bucht, hat eine feste Position, abhängig vom Saldo wie im Kleinst-Abschluss (die überzogene Bank unter den Verbindlichkeiten gegenüber Kreditinstituten, das Gesellschafter-Verrechnungskonto im Soll unter den sonstigen Vermögensgegenständen gegen Gesellschafter, das Zwischenkonto der Gutschrift „erstattet bereits Bezahltes“ SKR03 1548/SKR04 1434 im Soll unter den sonstigen Vermögensgegenständen aus Umsatzsteuer und im Haben unter den Verbindlichkeiten aus Umsatzsteuer). Die übrigen Gesellschafterkonten des DATEV-Kontenrahmens stehen auf den Positionen für Gesellschafter (Forderungen und Verbindlichkeiten aus Lieferungen und Leistungen gegenüber Gesellschaftern, Forderungen gegen und Verbindlichkeiten gegenüber GmbH-Gesellschaftern), weil § 42 Abs. 3 GmbHG den gesonderten Ausweis verlangt; Ausleihungen an Gesellschafter sind Anlagevermögen und brauchen den Anlagenspiegel, den Haben dafür nicht führt. Andere Konten, etwa aus einer manuellen Buchung, kommen auf die Auffangposition ihres Postens im DATEV-Kontenrahmen („nicht zuordenbar“ bzw. „übrige“). Keine Auffangposition haben Anlagevermögen, Eigenkapital und Steuern: Ein solches Konto ohne feste Position nennt der Abschnitt als offenen Punkt, und die E-Bilanz geht nicht raus, bis es umgebucht ist. Ein Test prüft jede Position gegen die Taxonomie, ein zweiter alle Konten zusammen mit dem echten ERiC.

**Ablauf:**

1. **Nur prüfen** lässt ERiC die E-Bilanz gegen Taxonomie und Plausibilitätsregeln prüfen, ohne zu senden. Das geht schon vor dem Abschluss.
2. **Prüfen und testweise senden** (mit Haken bei **Nur Testübermittlung**, vorgewählt) sendet mit Testmerker; das Finanzamt verarbeitet sie nicht.
3. **Prüfen und senden** (ohne den Haken) sendet echt; das geht erst, wenn das Jahr [abgeschlossen](#jahresabschluss-gmbh-und-ug) ist, und nur einmal. Eine berichtigte E-Bilanz geht über die Steuerberatung oder das ELSTER-Portal.

Jeder Versuch steht mit Werten und XML im Verlauf (Tabelle `annual_submissions`, Formular `ebilanz`), das Übertragungsprotokoll als PDF daneben.

> [!WARNING]
> Gesendet wird, was gebucht ist. Eine Überleitung von der Handels- zur Steuerbilanz rechnet Haben nicht. Bucht vorher die Rückstellungen für [Körperschaft- und Gewerbesteuer](#körperschaft--und-gewerbesteuer-gmbh-und-ug) und eure übrigen Abschlussbuchungen. Lasst die E-Bilanz von der Steuerberatung ansehen, bevor ihr echt sendet.
