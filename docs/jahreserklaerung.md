---
title: "Jahreserklärungen: Anlage EÜR, USt-Erklärung, Einkommensteuer"
description: >-
  Umsatzsteuererklärung, Anlage EÜR mit AVEÜR und Einkommensteuererklärung aus den Buchungen
  berechnen und über ERiC an das Finanzamt übermitteln.
---

# Jahreserklärungen

Unter **Jahreserklärung** berechnet Haben für ein abgeschlossenes Jahr die **Umsatzsteuererklärung** und die **Anlage EÜR** mit dem Anlagenverzeichnis (**Anlage AVEÜR**) und übermittelt beide über ERiC an das Finanzamt, wie die [Voranmeldung](umsatzsteuer.md). Dazu kommt die **Einkommensteuererklärung** mit den Anlagen, die ein Selbständiger typischerweise braucht: Der Gewinn kommt aus der EÜR, Vorsorge, Sonderausgaben, Kinder und Kapitalerträge trägst du ein.

Die Seite zeigt je Erklärung die Zeilen mit Feldkennung, Hinweise und einen eigenen Bereich zum Übermitteln. Ohne Jahr in der Adresse öffnet sie das Vorjahr.

Neben dem Titel steht der Stand der Abgabe: „Übermittelt“ mit dem Datum der Sendung, „Außerhalb abgegeben“ mit dem Tag aus dem Vermerk oder „Noch nicht übermittelt“. Die Einkommensteuererklärung kennt keinen Vermerk; solange Haben sie nicht gesendet hat, steht dort „Nicht aus Haben übermittelt“ — gesendet wird sie über den Kasten unter der Tabelle.

Oben auf der Seite steht **Stand der Erklärungen** als Tabelle mit einer Zeile je Erklärung: der Stand als Pille und der Betrag, sofern ein Vermerk ihn festhält. Die Namen verlinken auf ihren Abschnitt, sodass du von der Übersicht direkt bei der Erklärung landest. Bei einer GmbH oder UG entfällt sie.

Die Gewinnzeile der Anlage EÜR steht nur da, wenn Haben aus den Buchungen einen Gewinn hat. Die Meldung über ein leeres Jahr entfällt, sobald die Erklärung außerhalb von Haben vermerkt ist; das gilt für die Umsatzsteuer und die Anlage EÜR.

Bei einer GmbH oder UG zeigt die Seite die Umsatzsteuererklärung, die [Körperschaftsteuererklärung und die Gewerbesteuererklärung](#körperschaft--und-gewerbesteuererklärung-gmbh-und-ug); Anlage EÜR und Einkommensteuer gibt es für eine Kapitalgesellschaft nicht, und der Server lehnt ihre Übermittlung ab. Bilanz, GuV und E-Bilanz stehen unter [Jahresabschluss](gmbh-abschluss.md#e-bilanz-gmbh-und-ug).

## Ablauf

1. **Jahr abschließen:** Bankumsätze bis 31.12. zuordnen, Belege buchen, unter [Anlagen](anlagen.md) die AfA des Jahres buchen. Solange AfA oder Privatnutzung fehlen, lässt sich die Anlage EÜR nicht senden.
2. **Einstellungen:** Für die Anlage EÜR braucht Haben die **Einkunftsart** (selbständige Arbeit oder Gewerbebetrieb) und die **Art des Betriebs** (z. B. „Softwareentwicklung“).
3. **Nur prüfen:** ERiC prüft das XML gegen das Schema und die Plausibilitätsregeln des Jahres. Erst hier zeigt sich, ob die Feldkennungen für das Jahr passen.
4. **Testübermittlung** mit Zertifikat und PIN: geht an den ELSTER-Server, aber nicht ans Finanzamt (Testmerker). Das Protokoll-PDF liegt im Verlauf.
5. **Echtübermittlung:** Häkchen „Nur Testübermittlung“ entfernen und im Dialog **Verbindlich senden** bestätigen. Dafür brauchst du wie bei der Voranmeldung ERiC und eine eigene Hersteller-ID.

Jede Prüfung und Übermittlung speichert Haben mit XML, Antwort, Protokoll und den gesendeten Werten; ändern oder löschen lässt sich das nicht. Je Erklärung und Jahr ist nur eine Echtübermittlung möglich. Eine berichtigte Erklärung gibst du über das ELSTER-Portal ab.

Fristen: ohne Steuerberatung bis 31. Juli des Folgejahres, mit Steuerberatung später.

## Ohne Hersteller-ID: in Mein ELSTER eintragen

Ohne eigene Hersteller-ID steht neben dem Senden-Kasten **In Mein ELSTER eintragen**. „Werte für Mein ELSTER kopieren“ legt die Feldkennungen und Werte der Erklärung in die Zwischenablage, genau die aus dem XML, das Haben senden würde. Die Erweiterung **Haben für Mein ELSTER** trägt sie dann Seite für Seite in das Formular ein; prüfen und absenden machst du dort. Einrichten und Ablauf: [Mein ELSTER mit Erweiterung](elster-mit-erweiterung.md). Einen XML-Import wie bei der Voranmeldung bietet Mein ELSTER für die Jahreserklärungen nicht; alle Wege: [Abgabe an ELSTER](elster-abgabe.md).

## Abgabe außerhalb von Haben vermerken

Gibst du die Umsatzsteuererklärung oder die Anlage EÜR außerhalb von Haben ab, etwa mit WISO, über Accountable oder im ELSTER-Portal, hältst du das je Erklärung in der Karte **Außerhalb von Haben abgegeben** mit **Abgabe vermerken** fest. Der Dialog fragt nach dem Tag der Abgabe laut Übermittlungsprotokoll, dem Transferticket, dem Betrag und einer kurzen Begründung; das Protokoll kannst du als PDF anhängen. Vorgeschlagen ist der aus den Buchungen gerechnete Betrag. Weicht der Betrag laut Protokoll davon ab, nennt Haben die Differenz, und der Vermerk geht erst durch, wenn du die Abweichung ausdrücklich bestätigst. Gespeichert wird der Betrag laut Protokoll.

Mit dem Vermerk gilt die Erklärung als abgegeben, wie nach einer Übermittlung: Die Frist ist erledigt, das Jahr nimmt keine rückdatierten Buchungen mehr an, die Karte zeigt Datum, Ticket und Betrag statt des Knopfs, und Begründung wie Protokoll stehen darunter in einer Tabelle, die erst aufklappt, und eine Übermittlung aus Haben ist nicht mehr vorgesehen. Je Erklärung und Jahr ist nur ein Vermerk möglich, und ein Transferticket lässt sich nur einmal verwenden. Das Ticket besteht aus Buchstaben und Ziffern, wie es im Übermittlungsprotokoll steht; Haben prüft es mit demselben Muster wie bei der Voranmeldung. Vermerken lässt sich nur ein abgelaufenes Jahr; ein abgeschlossenes Jahr nimmt keinen Vermerk mehr auf. Meldungen, die Haben aus seinen eigenen Daten ableitet — etwa die Nullerklärung oder „Keine Betriebseinnahmen und -ausgaben im Jahr“ —, treten mit dem Vermerk zurück; sie würden ihm sonst auf derselben Seite widersprechen.

### Zeilenwerte aus dem Übermittlungsprotokoll

Ein Vermerk hält Tag, Transferticket und Betrag fest, aber nicht die einzelnen Zeilen der Erklärung. Rechnet Haben aus den Buchungen weniger oder gar nichts, steht in der Jahreserklärung deshalb eine Null, obwohl beim Finanzamt echte Zahlen liegen.

Über der Tabelle klappt der Bereich **Zeilenwerte aus dem Übermittlungsprotokoll** auf. Trag dort ein, was in der Erklärung steht; in Klammern hinter dem Zeilentext steht der Schlüssel, den Haben für diese Zeile verwendet. Die Schlüssel sind dieselben, die Haben selbst übermittelt: die Zeilen der Anlage EÜR aus ihrer Feldkennungstabelle (etwa `steuerpflichtig` mit der Kennung E6000401) und die Beträge der Umsatzsteuererklärung (`base19`, `tax19`, `vorsteuer`, `abschluss`). Eine Zeile, die es in der Erklärung nicht gibt, lehnt Haben ab. Leere Felder werden nicht gespeichert, sie bleiben Habens Rechnung. Ein bewusst eingetragenes Feld mit 0 wird gespeichert.

Liegen Zeilen vor, stehen sie über Habens Rechnung: Die Kernzeilen sind offen, die übrigen klappen unter **Alle erklärten Zeilen** auf, und ein Hinweis sagt, dass die Zahlen aus dem Protokoll stammen. Habens eigene Rechnung bleibt darunter stehen; was erklärt ist, gilt, was fehlt, bleibt seine. Fehlende Zeilen lassen sich auch später nachtragen, gespeicherte bleiben dabei unverändert. Das gilt für die Umsatzsteuererklärung und die Anlage EÜR.

Weicht die erklärte Schlusszeile, also die Abschlusszahlung bzw. der Gewinn, vom Betrag des Vermerks ab, steht das als Hinweis auf der Seite; gesperrt wird nichts, das Protokoll ist die Quelle. Ein abgeschlossenes Jahr nimmt keine Zeilen mehr auf, so wie es keinen Vermerk mehr aufnimmt.

Gespeicherte Zeilen lassen sich nicht ändern. Sie hängen am Vermerk, und beides ist gegen Änderung, Löschung und `TRUNCATE` gesperrt und steht im Änderungsprotokoll, wie der Vermerk selbst.

## Umsatzsteuererklärung

| Zeile | Woher |
| --- | --- |
| Umsätze zu 19 % und 7 % | Summe der zwölf Monate aus den Buchungen, wie in der Voranmeldung: Ist-Versteuerung nach Zahlungseingang, Soll nach Rechnungsdatum. Es zählt die Versteuerung des Jahres, auch wenn du sie zum Jahreswechsel umgestellt hast ([Ist- und Soll-Versteuerung](buchhaltung.md#ist--und-soll-versteuerung)). Bemessungsgrundlage in vollen Euro, die Steuer daraus. Die private Kfz-Nutzung ist in den 19 % enthalten |
| Steuerfreie innergemeinschaftliche Lieferungen (Kz 41) und Ausfuhrlieferungen (Kz 43) | Summe der zwölf Monate, in vollen Euro |
| Innergemeinschaftliche Erwerbe zu 19 % (Kz 89) und 7 % (Kz 93) | Bemessungsgrundlage in vollen Euro und die Erwerbsteuer daraus, wie in der Voranmeldung; die Summe der Steuer steht in der Berechnung |
| Steuerfreie Umsätze ohne Vorsteuerabzug: Vermietung nach § 4 Nr. 12 UStG (Zeile 46) und übrige nicht zum Gesamtumsatz gehörende (Zeile 47, mit den Nummern als Text) | Summe der zwölf Monate je Zeile, in vollen Euro; die Nummer liest Haben aus dem Befreiungsgrund der Rechnung |
| §-13b-Leistungen aus dem EU-Ausland (Kz 46/47) und dem Drittland (Kz 84/85) | Bemessungsgrundlage in vollen Euro und die Steuer, die du als Leistungsempfänger schuldest; die Summe steht in der Berechnung |
| Nicht steuerbare Leistungen, Ort im EU-Ausland (Kz 21), und nicht steuerbare Umsätze (Drittland, Kz 45) | Summe der zwölf Monate, in vollen Euro; ergänzende Angaben ohne Steuer |
| Abziehbare Vorsteuer (Kz 66) | Summe der Vorsteuer aus gebuchten Belegen |
| Vorsteuer aus innergemeinschaftlichem Erwerb (Kz 61), Einfuhrumsatzsteuer (Kz 62) und Vorsteuer aus §-13b-Leistungen (Kz 67) | Summe der zwölf Monate, gehen in die Summe der Vorsteuerbeträge ein |
| Vorauszahlungssoll | Summe der gesendeten Voranmeldungen des Jahres; je Monat zählt die zuletzt gesendete (bei Berichtigungen die berichtigte) |
| Abschlusszahlung bzw. Erstattung | Umsatzsteuer einschließlich § 13b und Erwerbsteuer minus Vorsteuer einschließlich Kz 61, 62 und 67 minus Vorauszahlungssoll |

Hast du Voranmeldungen eines Jahres in einem anderen Programm gesendet (etwa vor dem Umzug aus Lexoffice), fehlen sie im Vorauszahlungssoll; Haben weist darauf hin. Dann stimmt die Abschlusszahlung nicht, und du gibst die Erklärung besser im ELSTER-Portal ab. Der Hinweis verlinkt den letzten Voranmeldungszeitraum des Jahres (2025-Q4 bei vierteljährlicher, 2025-12 bei monatlicher Abgabe), nicht den laufenden Zeitraum.

Monate vor dem Beginn der Tätigkeit zählen nicht als fehlend. Als Beginn gilt der erste Eintrag des Jahres unter [Voranmeldungszeitraum](umsatzsteuer.md#voranmeldungszeitraum), wenn kein früheres Jahr einen hat: Steht der erste Eintrag ab Oktober, fehlt für Januar bis September nichts. Hat ein früheres Jahr einen Eintrag, ist ein Eintrag im Jahr ein Wechsel, und alle Monate zählen. Wechselt das Finanzamt mitten im Jahr und hast du bisher nichts eingestellt (also monatlich), stell auch das Vorjahr ein, sonst gilt der Wechsel als Beginn.

Abzugszeilen — Vorsteuer, Vorsteuer aus innergemeinschaftlichem Erwerb, Einfuhrumsatzsteuer und Vorauszahlungssoll — zeigen den Betrag mit umgekehrtem Vorzeichen: Ein Abzug steht negativ, eine Gutschrift in derselben Zeile positiv. Wer die Spalte zusammenzählt, kommt damit auf die Abschlusszahlung — solange die Zeilen für § 13b, innergemeinschaftliche Erwerbe und Einfuhr leer sind; die Summenzeile „Umsatzsteuer“ führt diese Kennzahlen nicht mit. Die Abschlusszeile trägt dagegen das Vorzeichen ihres Betrags; eine Erstattung steht deshalb negativ.

Haben übermittelt die Umsatzsteuererklärung nicht, wenn

- das Jahr steuerfreie Umsätze ohne Vorsteuerabzug (Kz 48) enthält, die Haben keiner Zeile zuordnen kann: ohne lesbare Nummer in § 4 UStG im Befreiungsgrund — eine Bareinnahme oder eine Buchung ohne Rechnung (etwa aus einem Umzug) hat keinen, ein Bereich wie „§ 4 Nr. 8 bis 29 UStG“ ist keine — oder nach § 4 Nr. 8 a bis h, 9 a und 10 UStG, denn ob diese Umsätze zum Gesamtumsatz gehören (Hilfsumsatz, UStAE 19.3 Abs. 2), kann Haben nicht entscheiden. Gib bei künftigen Rechnungen den Befreiungsgrund mit der Nummer an, etwa „Steuerfrei nach § 4 Nr. 21 UStG“; dieses Jahr gibst du im ELSTER-Portal ab.
- du Kleinunternehmer bist: Ab dem Jahr 2024 gibst du keine Umsatzsteuererklärung mehr ab, außer das Finanzamt fordert dazu auf. Für 2023 brauchst du sie noch; die Angaben für Kleinunternehmer übermittelst du dann im ELSTER-Portal.
- es weder Umsätze noch Vorsteuer gibt (Nullerklärung über das ELSTER-Portal).

## Anlage EÜR

Grundlage ist dieselbe Rechnung wie unter [Auswertungen](auswertungen.md): Zufluss und Abfluss im Jahr, vereinnahmte Umsatzsteuer als Einnahme, Vorsteuer und gezahlte Umsatzsteuer als Ausgabe. Summen und Gewinn sind dieselben; Haben verteilt die Beträge nur auf die Zeilen des amtlichen Vordrucks.

| Kategorie in Haben | Zeile der Anlage EÜR |
| --- | --- |
| Software und Lizenzen, Hosting und IT-Dienste | Laufende EDV-Kosten |
| Hardware (GWG) und GWG aus dem Anlagenverzeichnis | Geringwertige Wirtschaftsgüter |
| Telefon, Internet | Telekommunikation |
| Bürobedarf, Fachliteratur, Porto | Arbeitsmittel |
| Fortbildung | Fortbildungskosten |
| Reisekosten: Übernachtung | Übernachtungs- und Reisenebenkosten |
| Reisekosten: Fahrten, Kfz: Laden, Tanken, Wartung, Reparaturen, sonstige Kosten | Sonstige tatsächliche Fahrtkosten |
| Kfz: Versicherung, Steuer | Steuern, Versicherungen und Maut für Kraftfahrzeuge |
| Kfz: Leasing | Leasingkosten für Kraftfahrzeuge |
| Rechts- und Beratungskosten, Buchführung und Steuerberatung | Rechts- und Steuerberatung, Buchführung |
| Versicherungen, Beiträge | Beiträge, Gebühren, Abgaben und Versicherungen |
| Werbung | Werbekosten |
| Geschenke an Geschäftspartner | Geschenke (beschränkt abziehbar, Spalte „abziehbar“) |
| Bewirtung von Geschäftspartnern | Bewirtungsaufwendungen: 70 % „abziehbar“, 30 % „nicht abziehbar“. Die Vorsteuer bleibt voll abziehbar. |
| Wareneinkauf (Handelsware) | Waren, Rohstoffe und Hilfsstoffe einschließlich der Nebenkosten |
| Fremdleistungen | Bezogene Fremdleistungen |
| Lohn, Lohnsteuer und SV-Beiträge aus dem Bankabgleich ([Lohn](lohn.md#buchung)) | Ausgaben für eigenes Personal (Gehälter, Löhne und Versicherungsbeiträge). Lohnzahlungen zwischen 22. Dezember und 10. Januar zeigt die Vorprüfung als Hinweis (§ 11 Abs. 2 Satz 2 EStG) |
| Kontoführung und Gebühren, Sonstiger Aufwand, Sonstiger Betriebsbedarf | Übrige Betriebsausgaben |
| Miete für Geschäftsräume | Miete/Pacht für Geschäftsräume und betrieblich genutzte Grundstücke (Zeile 39, Kz 150) |
| Reparatur und Instandhaltung (Ausstattung, ohne EDV und Kfz) | Erhaltungsaufwendungen, ohne solche für Gebäude und Kfz (Zeile 48, Kz 225) |
| Beiträge zur Berufsgenossenschaft, Versorgungskassen | Ausgaben für eigenes Personal (Gehälter, Löhne und Versicherungsbeiträge für Arbeitnehmer) |
| [Direkt gebuchte](bank.md#auf-eine-kategorie-buchen) Einnahme bzw. Ausgabe auf eine Kategorie | Umsatzsteuerpflichtige Betriebseinnahmen und vereinnahmte Umsatzsteuer (Kleinunternehmer: Betriebseinnahmen als Kleinunternehmer) bzw. die Zeile der Kategorie wie bei einem Beleg |
| AfA aus dem Anlagenverzeichnis, linear, degressiv und für Elektrofahrzeuge (§ 7 Abs. 2a EStG) | AfA auf bewegliche Wirtschaftsgüter, Auflösung Sammelposten, Restbuchwert ausgeschiedener Anlagen |
| [Pauschale](pauschalen.md): Homeoffice-Tage | Tagespauschale für die Arbeit in der Wohnung |
| [Pauschale](pauschalen.md): Fahrten mit dem Privatfahrzeug | Fahrtkosten für nicht zum Betriebsvermögen gehörende Fahrzeuge (Nutzungseinlage) |
| [Pauschale](pauschalen.md): Verpflegungsmehraufwand | Verpflegungsmehraufwendungen (beschränkt abziehbar) |
| [Pauschale](pauschalen.md#wege-zwischen-wohnung-und-betriebsstätte): Wege zwischen Wohnung und Betriebsstätte | Mindestens abziehbare Kraftfahrzeugkosten für Wege zwischen Wohnung und Betriebsstätte, Familienheimfahrten (Zeile 73 der Anlage EÜR 2025, Entfernungspauschale) |
| Private Kfz-Nutzung | Private Kfz-Nutzung (Einnahme), die Umsatzsteuer darauf bei der vereinnahmten Umsatzsteuer |
| [Sachentnahme](buchhaltung.md#manuelle-und-freie-buchungen) (freie Buchung, ab dem Stichjahr) | Sonstige Sach-, Nutzungs- und Leistungsentnahmen (Einnahme), die Umsatzsteuer darauf bei der vereinnahmten Umsatzsteuer |
| Einfuhrumsatzsteuer ([Beleg](belege-ausland.md#einfuhrumsatzsteuer)), bei Zahlung | Gezahlte Vorsteuerbeträge |
| Umsatzsteuer an das Finanzamt, einer [Voranmeldung zugeordnet](bank.md#voranmeldung-zahllast-und-erstattung) | An das Finanzamt gezahlte bzw. vom Finanzamt erstattete Umsatzsteuer, im Jahr der Zahlung. Die Vorauszahlung für Dezember bzw. das vierte Quartal, ohne Dauerfristverlängerung am 10. Januar fällig und bis dahin gezahlt, im Vorjahr (§ 11 Abs. 2 Satz 2 EStG, [Vorauszahlung um den Jahreswechsel](auswertungen.md#umsatzsteuer-vorauszahlung-um-den-jahreswechsel)); eine Erstattung im Jahr des Eingangs |
| [Steuerzahlung](bank-steuern-darlehen.md#steuerzahlungen): Umsatzsteuer früherer Jahre | An das Finanzamt gezahlte bzw. vom Finanzamt erstattete Umsatzsteuer, im Jahr der Zahlung (§ 11 EStG). Zahlungen zwischen 22. Dezember und 10. Januar zeigt die Vorprüfung als Hinweis: Ist es die Vorauszahlung für Dezember bzw. das vierte Quartal, ordne sie der Voranmeldung zu, dann zählt Haben sie im Vorjahr |
| Steuerzahlung: Zinsen, Säumnis- und Verspätungszuschläge zur Umsatzsteuer | Übrige unbeschränkt abziehbare Betriebsausgaben; nicht die Schuldzinsen der Zeilen 55 und 56, die für die nicht abziehbaren Schuldzinsen (§ 4 Abs. 4a EStG) gemeint sind |
| Steuerzahlung: Erstattungszinsen zur Umsatz- oder Gewerbesteuer, [Zinserträge](bank.md#direkt-buchen) | Umsatzsteuerfreie, nicht umsatzsteuerbare Betriebseinnahmen |
| Steuerzahlung: Gewerbesteuer mit Zinsen und Zuschlägen, abzüglich Erstattungen | Sonstige beschränkt abziehbare Betriebsausgaben, Spalte „nicht abziehbar“ (`E6004301`), wie es die amtliche Anleitung für Gewerbesteuer und Nebenleistungen verlangt; mindert den Gewinn nicht (§ 4 Abs. 5b EStG), nach Erstattungen auch negativ |
| [Darlehen](bank-steuern-darlehen.md#darlehen): Zinsen und Gebühren, Verwendung Anlagevermögen | Schuldzinsen zur Finanzierung von Anschaffungs- und Herstellungskosten von Wirtschaftsgütern des Anlagevermögens (Zeile 55, `E6004202`); Auszahlung und Tilgung zählen nicht |
| Darlehen: Zinsen und Gebühren, laufender Betrieb | Übrige Schuldzinsen (Zeile 56, `E6004303`). Die Anlage SZ (nicht abziehbare Schuldzinsen bei Überentnahmen, § 4 Abs. 4a EStG) füllt Haben nicht |
| Steuerzahlung: Einkommen-, Kirchensteuer, Soli, einbehaltene Kapitalertragsteuer | keine Betriebsausgabe; Entnahme (Privatsteuern), Erstattungen mindern die Entnahmen |

**Vorauszahlung bei gesperrtem Vorjahr:** War die Anlage EÜR oder die Einkommensteuererklärung des Vorjahres schon übermittelt (oder die Anlage EÜR als außerhalb abgegeben vermerkt) bzw. das Jahr abgeschlossen, als du die Vorauszahlung für Dezember zugeordnet hast, bleibt das Vorjahr, wie übermittelt (GoBD): Die Zahlung zählt im Jahr der Zahlung, und die Vorprüfung nennt Zeitraum und Betrag als Hinweis, damit du mit der Steuerberatung klärst, ob die Erklärung des Vorjahres zu berichtigen ist. Mit jeder Übermittlung und jedem Vermerk speichert Haben, welche Vorauszahlungen sie in das Vorjahr verschoben bzw. hereingenommen hat; danach richten sich beide Jahre, auch wenn du später die Dauerfristverlängerung änderst. Erklärungen aus älteren Versionen enthalten die Zahlung nicht und sperren das Vorjahr immer; im Jahr der Zahlung zählt sie dort weiter am Buchungstag.

**Entnahmen und Einlagen** kommen aus dem Journal: alles, was auf den Privatkonten gebucht ist (Privatüberweisungen im Bankabgleich, private Steuern vom Geschäftskonto auf Privatsteuern, privat bezahlte Belege, Pauschalen ohne Beleg, Privatanteile, Privatnutzung der Firmenwagen mit Umsatzsteuer).

**Allgemeine Angaben:** Rechtsform „Angehörige freier Berufe“ bzw. „Einzelgewerbetreibende“, Betriebsinhaber ist die steuerpflichtige Person, keine Veräußerung von Grundstücken. Für Gesellschaften ist die Anlage EÜR in Haben nicht gedacht.

Nicht abgebildet sind das häusliche Arbeitszimmer als Mittelpunkt (die Tagespauschale schon), Verpflegung im Ausland, Wege zwischen Wohnung und Betriebsstätte mit einem Fahrzeug im Betriebsvermögen (Zeile 72), Investitionsabzugsbeträge und Rücklagen. Brauchst du davon etwas, ergänze die Anlage im ELSTER-Portal statt sie hier zu senden.

### Anlage AVEÜR

Das Anlagenverzeichnis listet jede Anlage mit Bezeichnung, Anschaffungsdatum, Anschaffungskosten, Buchwert zu Beginn, AfA, Abgang und Buchwert am Ende, gruppiert nach Kraftfahrzeugen, Büroeinrichtung und anderen beweglichen Wirtschaftsgütern; Sammelposten stehen je Jahrgang. Geringwertige Wirtschaftsgüter gehören nicht hinein. Anlagen, die im Jahr angeschafft wurden, stehen mit den Anschaffungskosten im Buchwert zu Beginn, wie es auch EasyCash&Tax übermittelt. Degressive AfA und die Staffel für Elektrofahrzeuge stehen in der Spalte AfA, wie die lineare: § 7 Abs. 2 und 2a EStG sind Absetzungen für Abnutzung, die Spalte Sonderabschreibungen (`E6007318`) gehört zu § 7g EStG, den Haben nicht kennt. Ein Kraftfahrzeug mit AfA nach § 7 Abs. 2a meldet Haben als Elektrofahrzeug (`E6007327`), wie eines mit erfasstem Elektro- oder Hybridantrieb. Mit [Erinnerungswert](anlagen.md#erinnerungswert) steht eine abgeschriebene Anlage mit 1 € weiter im Verzeichnis, bis sie ausscheidet.

## Einkommensteuererklärung

Die Einkommensteuererklärung (Datenart ESt, Vordruck E10) setzt Haben aus drei Quellen zusammen:

| Teil | Woher |
| --- | --- |
| Hauptvordruck ESt 1 A | [Persönliche Angaben](einrichtung.md#persönliche-angaben) (Steuer-ID, Name, Geburtsdatum, Religion, Beruf, bei Zusammenveranlagung Ehegatte und Heiratsdatum), Anschrift, Telefon und IBAN aus den Firmendaten |
| Anlage S oder G | Gewinn laut Anlage EÜR des Jahres in vollen Euro, Tätigkeit aus „Art des Betriebs“; selbständige Arbeit geht in Anlage S, Gewerbe in Anlage G |
| Übrige Anlagen | Angaben, die du auf der Seite einträgst und speicherst |

Die eingetragenen Angaben speichert Haben je Jahr; jede Änderung steht im Audit-Log. Übermittelt wird, was gespeichert ist. Leere Anlagen schickt Haben nicht mit.

Arbeitslohn (Anlage N) je Person, Vorsorgeaufwand, Sonderausgaben, haushaltsnahe Aufwendungen, Kinder und Kapitalerträge stehen zugeklappt; im Titel steht, was eingetragen ist (z. B. „Vorsorgeaufwand · 4.230,00 €“, bei der Anlage N Bruttoarbeitslohn und Lohnsteuer aller Bescheinigungen zusammen). In der Anlage N klappen auch jede Lohnsteuerbescheinigung und die Werbungskosten einzeln auf. Fehlt beim Speichern eine Pflichtangabe in einem zugeklappten Block, klappt Haben ihn auf und setzt den Cursor ins Feld. **Angaben speichern** und die voraussichtliche Steuer bleiben am unteren Rand sichtbar. Über die Leiste oben springst du zwischen Umsatzsteuer, Anlage EÜR, Einkommensteuer, den Belegen von ELSTER und dem Verlauf.

| Anlage | Angaben |
| --- | --- |
| N | Je Person mit Arbeitslohn: die Lohnsteuerbescheinigungen (Steuerklasse, Bruttoarbeitslohn, Lohnsteuer, Soli, Kirchensteuer) und Werbungskosten, siehe [Arbeitslohn](#arbeitslohn-anlage-n) |
| Vorsorgeaufwand | Je Person: Beiträge laut Lohnsteuerbescheinigung (Rentenversicherung mit Arbeitgeberanteil, Kranken-, Pflege- und Arbeitslosenversicherung), gesetzliche Rentenversicherung, zertifizierte Basisrente (Rürup), gesetzliche Kranken- und Pflegeversicherung (Basis, dazu Krankengeldanteil und Wahlleistungen), private Kranken- und Pflege-Pflichtversicherung samt Erstattungen und Wahlleistungen, steuerfreie Arbeitgeberzuschüsse zur privaten KV und PV; weitere sonstige Vorsorge (Haftpflicht, Unfall, Risikoleben) |
| Sonderausgaben | Gezahlte und erstattete Kirchensteuer, Spenden an steuerbegünstigte Empfänger im Inland; vom Geschäftskonto gezahlte Spenden stehen im Kontenblatt 1840 bzw. 2250 „Zuwendungen, Spenden“ ([Bank](bank.md#direkt-buchen)) |
| Außergewöhnliche Belastungen | Selbst getragene Krankheitskosten |
| Haushaltsnahe Aufwendungen (§ 35a EStG) | Minijobs im Haushalt, haushaltsnahe Dienstleistungen, Handwerkerleistungen (nur Arbeits-, Maschinen- und Fahrtkosten) |
| Kind | Je Kind Vorname, Geburtsdatum, Steuer-ID, Familienkasse und Kinderbetreuungskosten; leibliches Kind beider Ehegatten bzw. der steuerpflichtigen Person, Wohnsitz im Inland im ganzen Jahr bzw. ab Geburt |
| KAP | Erträge mit und ohne inländischen Steuerabzug, ausländische Erträge, genutzter Sparer-Pauschbetrag, einbehaltene Kapitalertragsteuer, Solidaritätszuschlag und Kirchensteuer, Antrag auf Günstigerprüfung |

Unter den Angaben zeigt Haben das geschätzte zu versteuernde Einkommen und die voraussichtliche Steuer, berechnet wie die [Steuerprognose](finanzamt.md#steuerprognose) mit dem tatsächlichen Gewinn des Jahres. Mit Arbeitslohn kommen die bereits einbehaltene Lohnsteuer samt Soli und Kirchensteuer und die voraussichtliche Nachzahlung bzw. Erstattung dazu.

### Was die Vorsorgezeilen bedeuten

Die Beiträge zur gesetzlichen Rentenversicherung und die einer zertifizierten Basisrente (Rürup) teilen sich denselben Höchstbetrag der Altersvorsorge; Haben rechnet beide zusammen und kappt erst danach.

Wahlleistungen einer privaten Krankenversicherung, also was über die Basisabsicherung hinausgeht, gehören nicht zur Basisabsicherung, sondern zu den sonstigen Vorsorgeaufwendungen und damit in deren Höchstbetrag (2.800 € für Selbständige, 1.900 € für Arbeitnehmer).

Die steuerfreien Arbeitgeberzuschüsse zur privaten Kranken- und Pflegeversicherung stehen getrennt in der Lohnsteuerbescheinigung (Nr. 24 b und 24 c). Sie mindern den abzugsfähigen Betrag, sie erhöhen ihn nicht. Trag sie ein, wenn deine Bescheinigung sie ausweist — und zwar beide: ERiC nimmt den Zuschuss zur Krankenversicherung (Nr. 24 b) nur zusammen mit dem zur Pflegeversicherung (Nr. 24 c) an (Regel 100240078). Bei privat versicherten Arbeitnehmern weist die Bescheinigung beide aus.

### Arbeitslohn (Anlage N)

Für jede Person, die angestellt war, setzt du den Haken „hatte Arbeitslohn“ und trägst die Lohnsteuerbescheinigung ein. Die Felder tragen die Nummern der Bescheinigung:

| Nr. | Angabe | Wohin |
| --- | --- | --- |
| – | Steuerklasse | Anlage N; Steuerklasse 6 (zweites Dienstverhältnis) in eigene Zeilen |
| 3 bis 7 | Bruttoarbeitslohn, Lohnsteuer, Solidaritätszuschlag, Kirchensteuer, Kirchensteuer des Ehegatten | Anlage N, Zeilen 4 bis 9 |
| 22a, 23a | Rentenversicherung Arbeitgeber- und Arbeitnehmeranteil | Anlage Vorsorgeaufwand, Zeilen 4 und 9 |
| 25, 26 | Arbeitnehmerbeiträge zur Kranken- und Pflegeversicherung | Anlage Vorsorgeaufwand, Zeilen 11 und 13 |
| 27 | Arbeitslosenversicherung | Anlage Vorsorgeaufwand, Zeile 43 |

Bei mehreren Arbeitgebern gibt es je Bescheinigung eine Zeile; Haben schickt jede einzeln und die Summe.

Werbungskosten:

- **Wege zur ersten Tätigkeitsstätte:** Anschrift, Tage dort, einfache Entfernung, optional Arbeitstage je Woche und Urlaubs- und Krankheitstage. Haben geht von Fahrten mit dem eigenen Auto aus.
- **Homeoffice-Tage:** an denen du nicht zur Tätigkeitsstätte gefahren bist; mit dem Haken „dauerhaft kein anderer Arbeitsplatz“ in Zeile 62 statt 61.
- **Häusliches Arbeitszimmer:** nur, wenn es den Mittelpunkt deiner gesamten beruflichen und betrieblichen Tätigkeit bildet: die Aufwendungen des Jahres oder stattdessen die Jahrespauschale von 1.260 €, die sich für jeden vollen Monat ohne diese Voraussetzung um 105 € mindert ([§ 4 Abs. 5 Satz 1 Nr. 6b EStG](https://www.gesetze-im-internet.de/estg/__4.html), für Arbeitnehmer über § 9 Abs. 5). Die Homeoffice-Tagespauschale gibt es nicht für die Zeit, für die du das Arbeitszimmer absetzt (Nr. 6c Satz 3).
- **Arbeitsmittel, Fortbildung, Gewerkschaft, Berufsverbände, weitere Werbungskosten** (etwa Kontoführung) als Beträge. Gewerkschaftsbeiträge zieht die Steuerschätzung ab 2026 zusätzlich zum Arbeitnehmer-Pauschbetrag ab (§ 9a Satz 3 EStG); in der Anlage N bis 2025 stehen sie mit den Berufsverbänden in einer Zeile, ab 2026 in einer eigenen. Zu den Fortbildungskosten meldet Haben ab 2026 steuerfreie Erstattungen mit 0; trag deshalb nur den Teil ein, den du selbst getragen hast.

In der Prognose rechnet Haben die Entfernungspauschale mit 0,30 € je Kilometer, ab dem 21. Kilometer 0,38 € (2021: 0,35 €; ab 2026 vom ersten Kilometer an). Homeoffice zählt mit 6 € je Tag, höchstens 210 Tage; liegen die Werbungskosten unter dem Arbeitnehmer-Pauschbetrag von 1.230 €, gilt der Pauschbetrag.

Die Homeoffice-Pauschale gibt es je Person nur einmal im Jahr. Hast du als Person A auch [Homeoffice-Tage in der EÜR](pauschalen.md), weist Haben darauf hin, wenn beide zusammen mehr als 210 Tage ergeben.

Nicht abgebildet sind Versorgungsbezüge, ermäßigt besteuerte Entschädigungen (Abfindungen), Arbeitslohn ohne Steuerabzug oder aus dem Ausland, Kurzarbeiter- und Elterngeld, Fahrtkostenersatz des Arbeitgebers, Reisekosten, doppelte Haushaltsführung. Steuerfreie Zuschüsse zur privaten Kranken- und Pflegeversicherung (Nr. 24 b und 24 c) stehen in der Anlage Vorsorgeaufwand, siehe [Was die Vorsorgezeilen bedeuten](#was-die-vorsorgezeilen-bedeuten).

Beträge gehen in vollen Euro an ELSTER, nur die Steuern auf Kapitalerträge mit Cent. Pflicht sind die IBAN in den Firmendaten und je Kind die Familienkasse. Lohn- und Kirchensteuer einer Lohnsteuerbescheinigung schickt Haben auch mit 0, wenn das Feld leer ist; so verlangt es ELSTER.

Nicht abgebildet sind unter anderem Renten, Vermietung, Unterhalt, Riester, Kinder bei Einzelveranlagung (ELSTER verlangt dann Angaben zum anderen Elternteil) sowie Kinder mit anderem Kindschaftsverhältnis oder Wohnsitz im Ausland. Brauchst du davon etwas, gibst du die Erklärung im ELSTER-Portal ab, statt sie hier zu senden; ein Nachsenden einzelner Anlagen ist nicht möglich.

## Körperschaft- und Gewerbesteuererklärung (GmbH und UG)

Die Werte kommen aus der [Steuerberechnung beim Jahresabschluss](gmbh-abschluss.md#körperschaft--und-gewerbesteuer-gmbh-und-ug); dort stehen auch Hebesatz, Verlustvorträge und ein Verlustrücktrag. Auf dieser Seite trägst du ein, was nur die Erklärung braucht, unter **Angaben zu den Erklärungen**:

- **Anteilseigner** mit Anschrift, Identifikationsnummer (oder Steuernummer im ELSTER-Format), Beteiligung in Euro und Anteil; die Anteile ergeben zusammen 100 %. „Geändert“ markiert eine Änderung gegenüber dem Vorjahr.
- Für Ausschüttungen je Anteilseigner das **Kirchensteuerabzugsmerkmal**: Kirchensteuersatz (8 oder 9 %) und Religionsschlüssel aus der Antwort des Bundeszentralamts für Steuern, dazu der Name der kirchensteuererhebenden Religionsgemeinschaft (etwa „römisch-katholisch“): Den Schlüssel braucht die Kapitalertragsteuer-Anmeldung, den Namen die [Steuerbescheinigung](gmbh-abschluss.md#gewinnausschüttung-gmbh-und-ug) nach Muster II. Ohne Kirchensteuerpflicht bleibt das Feld auf „keine“.
- **Verträge mit Anteilseignern** und nahestehenden Personen (Geschäftsführer-, Miet-, Darlehensvertrag) mit Datum und Vergütung im Jahr (Anlage WA).
- Im Gründungsjahr das **Gründungsdatum**: Damit beginnen Steuerpflicht und erstes Wirtschaftsjahr.
- Der **Bestand des steuerlichen Einlagekontos** zum Schluss des Vorjahres (meist 0) und, falls Lizenzen an im Ausland Ansässige gezahlt wurden, der Anteil nach § 50a EStG für die Gewerbesteuer.

Ohne Angaben für das Jahr übernimmt die Seite Anteilseigner und Verträge aus dem Vorjahr; bitte prüfen und speichern.

| Erklärung | Was Haben sendet |
| --- | --- |
| Körperschaftsteuer (KSt 1 mit Anlagen GK, ZVE, WA, KSt 1 F, Verluste) | Jahresüberschuss, nicht abziehbare Steuern und Betriebsausgaben (Anlage GK Zeilen 81 bis 90), Einkünfte aus Gewerbebetrieb, Verlustabzug mit Mindestbesteuerung, zu versteuerndes Einkommen und 15 % Körperschaftsteuer; Anteilseigner, Verträge, kein schädlicher Beteiligungserwerb nach § 8c KStG, Einlagekonto (Anlage KSt 1 F) mit den [Ausschüttungen](gmbh-abschluss.md#gewinnausschüttung-gmbh-und-ug) des Jahres, dem ausschüttbaren Gewinn und dem Teil aus dem Einlagekonto |
| Gewerbesteuer (GewSt 1 A) | Rechtsform, Gegenstand (Einstellungen › Art des Betriebs), einzige Betriebsstätte am Sitz, Gewinn aus Gewerbebetrieb, Zinsen, Mieten, Leasing und Lizenzen in voller Höhe (§ 8 Nr. 1 GewStG; den Hinzurechnungsbetrag ermittelt das Finanzamt) und den Gewerbeverlust des Vorjahres |

Alle Beträge in vollen Euro; die Summen rechnet Haben aus den Einzelbeträgen, wie die Plausibilitätsregeln es verlangen. **Nur prüfen** und die **Testübermittlung** gehen jederzeit; **echt senden** erst, wenn das Jahr [abgeschlossen](gmbh-abschluss.md#jahresabschluss-gmbh-und-ug) ist, und je Erklärung nur einmal. Die Körperschaftsteuererklärung kennt Haben für 2025, die Gewerbesteuererklärung für 2024 und 2025; für spätere Jahre kommt das Formular mit dem nächsten ERiC.

> [!WARNING]
> Nicht abgedeckt sind Organschaft, Beteiligungen an anderen Gesellschaften (§ 8b KStG), verdeckte Gewinnausschüttungen, Spenden, Einlagen in das Einlagekonto, ausländische Einkünfte, mehrere Betriebsstätten, Kürzungen nach § 9 GewStG und ein schädlicher Beteiligungserwerb (§ 8c KStG). Hat die GmbH davon etwas, gibt die Steuerberatung die Erklärungen ab.

## Belege von ELSTER

Nur im Einzelunternehmen: Die vorausgefüllte Steuererklärung gibt es für die Einkommensteuer; bei GmbH und UG fehlt der Abschnitt, und Haben lehnt den Abruf ab, ebenso die Abrufberechtigung für den Ehegatten.

Arbeitgeber, Rentenversicherung, Krankenkassen und andere Stellen melden dem Finanzamt Daten für die Steuererklärung: Lohnsteuerbescheinigung, Rentenbezüge, Beiträge zur Kranken- und Pflegeversicherung, Lohnersatzleistungen und mehr. Diese Belege der vorausgefüllten Steuererklärung (VaSt) holt Haben unter **Belege von ELSTER** auf der Seite des Jahres ab:

1. Persönliche Angaben mit Steuer-ID hinterlegen ([Einstellungen](einrichtung.md#persönliche-angaben)) und das ELSTER-Zertifikat hochladen.
2. Person wählen (bei Zusammenveranlagung), PIN eingeben, **Belege abrufen**. Ist der automatische Postfachabruf an, reicht die gespeicherte PIN.
3. Haben fragt die Liste der Belege für Steuer-ID und Jahr ab, holt alle Belege in einem zweiten Schritt und entschlüsselt sie mit dem Zertifikat.

Jeder Beleg erscheint mit seiner Art und allen gemeldeten Werten; Beträge zeigt Haben in Euro, Datumsangaben als Datum. Das XML lässt sich so öffnen, wie es von ELSTER kam. Abrufe und Belege sind wie Postfach-Abrufe unveränderlich gespeichert, das Beleg-XML steht wegen der persönlichen Daten nicht im Audit-Log. Wiederholte Abrufe legen nur neue Belege ab; eine berichtigte Meldung kommt bei ELSTER mit neuer ID. Testbelege blendet Haben aus, sobald es echte für das Jahr gibt.

Gut zu wissen:

- Die meisten Meldungen liegen ab Ende Februar des Folgejahres vor; die Belege lassen sich beliebig oft abrufen, eine Bestätigung wie beim Postfach gibt es nicht.
- Mit dem eigenen Zertifikat, das mit deiner Steuer-ID registriert ist, holst du deine eigenen Belege. Für die Belege des Ehegatten braucht dein Zertifikat eine Berechtigung, siehe unten. Alternativ ruft der Ehegatte mit dem eigenen Zertifikat ab.
- Der Testabruf trägt den Testmerker der Datenabholung (`370000001`). Ohne ERiC liefert er zwei erfundene Beispielbelege.
- Haben übernimmt die Werte noch nicht von selbst in die Erklärung. Die Belege dienen zum Abgleich mit den Angaben oben; das Finanzamt hat sie ohnehin und gleicht selbst ab. Für eine sichere Zuordnung zu den Feldern fehlen die Schemas der einzelnen Belegarten ([Roadmap](roadmap.md#blockiert)).

### Berechtigung für den Ehegatten

Wählst du unter **Für** den Ehegatten (Person B aus den [persönlichen Angaben](einrichtung.md#persönliche-angaben)), zeigt Haben den Stand der Berechtigung (ELSTER-Verfahren ElsterBRM):

1. **Berechtigung beantragen:** mit Steuer-ID und Geburtsdatum des Ehegatten, für alle Jahre und gültig bis zum gewählten Datum (Vorschlag: Ende des übernächsten Jahres). ELSTER schickt dem Ehegatten einen Brief mit Freischaltcode; die E-Mail-Adresse aus den Firmendaten bekommt Benachrichtigungen.
2. **Freischalten:** den Code aus dem Brief eingeben, bevor die Frist abläuft, die Haben beim Antrag anzeigt. Danach steht die Berechtigung auf „genehmigt“ und der Belegabruf für den Ehegatten funktioniert wie der eigene.
3. **Widerrufen** oder einen offenen Antrag zurückziehen geht jederzeit, nach einer Rückfrage im Dialog.

**Stand bei ELSTER prüfen** fragt alle eigenen Anträge ab. So erkennt Haben auch einen Antrag, den du in Mein ELSTER gestellt hast, und ob eine Berechtigung abgelaufen ist. Jeder Schritt braucht die Zertifikats-PIN (oder die gespeicherte) und steht unveränderlich im Verlauf; den Freischaltcode speichert Haben nicht. Test und echt sind getrennt: Der Testserver führt eigene Anträge, im simulierten Betrieb gilt jeder Code.

## Herkunft der Feldkennungen

Das Finanzamt beschreibt jedes Feld mit einer Kennung (z. B. `E6007202` für den Gewinn). Die amtliche Liste steht in der Jahresdokumentation im ERiC-Paket. Haben nutzt die Kennungen und die Reihenfolge, mit denen andere freie Programme die Erklärungen bereits übermitteln (EasyCash&Tax für Anlage EÜR und AVEÜR, viking und finamt für die Umsatzsteuererklärung, viking für die Einkommensteuererklärung), für die Jahre ab 2023. Die Reihenfolge der Felder der Einkommensteuererklärung ist gegen die Feldliste der Jahresdokumentation 2024 abgeglichen; Feldkennungen und Kontexte der Anlage N und der Arbeitnehmerzeilen der Anlage Vorsorgeaufwand stammen direkt aus dieser Feldliste. Die Felder der Umsatzsteuererklärung über Umsätze zu 19 und 7 % und die Vorsteuer aus Rechnungen hinaus (steuerfreie und nicht steuerbare Umsätze, innergemeinschaftliche Erwerbe, §-13b-Leistungen, weitere Vorsteuer) stammen direkt aus Feldliste, Regeln und Schema E50 der Jahre 2023 bis 2026 in ERiC 44.3.6.0.

Die Elemente für Miete (`Raumkosten_u_sonst/Miete_Pacht`, `E6003201`) und Erhaltungsaufwendungen (`Sonst_unbeschraenkt/Erhaltungsaufwand`, `E6004313`) stammen direkt aus den Schemas E77-2023 bis E77-2025 im Dokumentationspaket von ERiC 44.3.6.0 und sind mit dem echten ERiC geprüft (`eric-echt.test.ts`).

Die Entfernungspauschale (`KFZ_u_Fahrtkosten/Entfernungspausch_Familienheimfahrt`, `E6003702`) steht so im Schema E77 2025 und 2026 der ERiC-Dokumentation; in der Anlage EÜR ist es 2025 die Zeile 73, 2026 die Zeile 74.

Die Beträge in Zeile 18 (`E6000701`, erstattete Umsatzsteuer) und Zeile 58, ab 2026 Zeile 59 (`E6005101`, gezahlte Umsatzsteuer), tragen laut Jahresdokumentation E77 2025 („GeldBetragMitCent ohne Vorzeichen“) und den Schemas E77-2025 und E77-2026 kein Vorzeichen; ERiC lehnt `-190,00` dort mit „Unzulässiges Vorzeichen“ ab. Haben schickt deshalb kein negatives Feld. Ein negativer Betrag heißt, dass im Jahr mehr Umsatzsteuer erstattet als gezahlt wurde: Die Anlage EÜR weist ihn dann als Betriebseinnahme in Zeile 18 aus, umgekehrt einen negativen Betrag in Zeile 18 als Betriebsausgabe in Zeile 58 (2026: 59), jeweils ohne Vorzeichen und getrennt in beiden Zeilen. Der Gewinn bleibt gleich, gebuchte Daten ändern sich nicht. Die Vorprüfung der Anlage EÜR nennt das Umgliedern als Hinweis; bliebe danach ein negativer Betrag übrig, wäre das ein Fehler vor dem Senden.

Die Vordrucke ändern sich jedes Jahr ein wenig. Deshalb vor der Echtübermittlung immer erst prüfen oder testweise senden: Meldet ERiC ein unbekanntes Feld oder eine verletzte Regel, steht die Meldung im Verlauf. Bitte dann als Issue melden.
