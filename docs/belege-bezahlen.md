---
title: "Belege bezahlen: Überweisung per SEPA-Datei, Verrechnen"
description: >-
  Eingangsrechnungen in Haben bezahlen: über Geschäftskonto, privat oder Kasse, Überweisungen als SEPA-Datei für die Bank, Skonto und Verrechnen ohne Zahlung.
---

# Belege bezahlen

## Bezahlung

Unter **Bezahlung** am Beleg wählst du, wie er bezahlt wurde:

| Auswahl | Gegenkonto | Folge |
| --- | --- | --- |
| Über das Geschäftskonto (Zuordnung beim Bankabgleich) | Verbindlichkeiten | Der Beleg wird nach dem Buchen im [Bankabgleich](bank.md) als offener Posten angeboten. |
| Privat bezahlt (Privateinlage) | Privateinlagen | Der Beleg ist damit erledigt und taucht im Bankabgleich nicht auf. |
| Vom Gesellschafter ausgelegt (nur GmbH, UG) | Gesellschafter-Verrechnungskonto (SKR03 0730, SKR04 3510) | Wie privat bezahlt; die GmbH schuldet dem Gesellschafter den Betrag. |
| Bar aus der Kasse (Zeile im Kassenbuch) | Kasse | Beim Buchen entsteht eine Zeile im [Kassenbuch](kasse.md). Reicht der Kassenbestand am Belegdatum nicht, lehnt Haben das Buchen ab. |

## Überweisen (SEPA-Datei)

Unter **Überweisungen** (Menü **Ausgaben**) stellst du offene Belege zu einer SEPA-Datei zusammen, die du im Online-Banking hochlädst. Haben bucht dabei nichts: Bezahlt ist ein Beleg erst, wenn der [Bankabgleich](bank.md#überweisungen-aus-haben) die Abbuchung zuordnet.

1. **Auftraggeberkonto** wählen: eines der Bankkonten unter [Bank](bank.md#konto), von dem das Geld abgeht. Zahlungsdienstleister stehen nicht zur Wahl.
2. **Ausführungsdatum** setzen, frühestens heute.
3. Die Belege ankreuzen, einzeln oder mit **Alle auswählen**. Darunter stehen Anzahl und Summe.
4. **SEPA-Datei erzeugen**. Der Browser lädt die Datei `HABEN-….xml` herunter; unter **Erzeugte Dateien** bleibt sie zum erneuten Herunterladen.

In der Liste stehen alle gebuchten, nicht stornierten Belege mit Bezahlung über das Geschäftskonto, die noch offen sind, die älteste Fälligkeit zuerst. Teilweise bezahlte Belege erscheinen mit dem Rest.

| Angabe | Woher |
| --- | --- |
| Empfänger | Lieferant am Beleg |
| IBAN | Aus dem Kontakt des Lieferanten (unter **Aus den Kontakten** gewählt), sonst die am Beleg bestätigte aus der E-Rechnung (BT-84); weichen beide ab, die [am Beleg entschiedene](#abweichende-iban-in-der-e-rechnung) |
| Betrag | Offener Betrag, mit Skonto abzüglich Skonto |
| Verwendungszweck | Rechnungsnummer des Lieferanten, ohne Nummer „Rechnung vom …“; mit Skonto zusätzlich „abzgl. 2,00 Prozent Skonto 4,31 EUR“ |
| Auftraggeber | Kontoinhaber aus den Firmendaten, sonst der Firmenname; die BIC nur, wenn die IBAN der Firmendaten das gewählte Konto ist |

Einen Beleg ohne IBAN, mit ungültiger IBAN (Prüfziffer nach ISO 13616), mit einer IBAN außerhalb des Europäischen Wirtschaftsraums (EU, Island, Liechtenstein, Norwegen), ohne Lieferant oder in Fremdwährung kann Haben nicht überweisen; außerhalb des EWR verlangt SEPA BIC und Anschrift des Empfängers oder gilt gar nicht, solche Zahlungen gibst du direkt im Online-Banking ein; der Grund steht in der Zeile, der Haken ist gesperrt. Die IBAN trägst du im [Kontakt](kontakte.md) des Lieferanten ein und wählst ihn am Beleg. Nennt die E-Rechnung eine andere IBAN als der Kontakt, ist der Beleg gesperrt, bis du am Beleg entschieden hast, welche gilt (siehe unten).

### Abweichende IBAN in der E-Rechnung

Eine geänderte Bankverbindung in einer Rechnung ist ein bekanntes Muster für Betrug: Jemand fängt die Rechnung ab und tauscht die IBAN aus. Haben gleicht deshalb die IBAN einer E-Rechnung (ZUGFeRD oder XRechnung, BT-84) mit der im Kontakt des Lieferanten ab, sobald der Kontakt am Beleg hängt, vor und nach dem Buchen. Verglichen wird ohne Leerzeichen und Groß- und Kleinschreibung; dieselbe IBAN, anders geschrieben, gilt als gleich.

- **Abweichend:** Oben auf der Belegseite steht **Bankverbindung prüfen** mit beiden IBANs in Vierergruppen. Prüfe die Bankverbindung über einen bekannten Weg beim Lieferanten, nicht über Telefonnummer oder E-Mail aus dieser Rechnung. Nach dem Buchen entscheidest du (ein offener Beleg lässt sich noch löschen, deshalb erst dann):
    - **IBAN des Kontakts behalten**, oder
    - **IBAN der E-Rechnung nur für diesen Beleg**.

    Der Kontakt bleibt in beiden Fällen unverändert; die IBAN dort änderst du, wenn nötig, selbst im [Kontakt](kontakte.md). Die Belegseite zeigt danach, welche IBAN gilt, wer entschieden hat und wann. Eine spätere Entscheidung ersetzt die frühere.
- **Ohne Entscheidung** ist der Beleg unter **Überweisungen** nicht auswählbar, auch nicht über **Alle auswählen**; die Zeile nennt den Grund und führt mit **Zum Beleg** dorthin. Auch der Server lehnt ihn in einer SEPA-Datei ab. Nach der Entscheidung geht die Überweisung an die gewählte IBAN, und die Zeile nennt die Entscheidung.
- **Neu entscheiden:** Die Entscheidung gilt nur für genau dieses Paar aus Kontakt- und Rechnungs-IBAN. Ändert sich die IBAN im Kontakt (oder steht ein anderer Kontakt am Beleg), ist neu zu entscheiden.
- **Kontakt ohne IBAN** (oder kein Kontakt am Beleg): Oben auf der Belegseite steht **IBAN aus der E-Rechnung, noch nicht bestätigt**. Die IBAN der E-Rechnung gilt erst, wenn du sie mit **Übernehmen** für diesen Beleg bestätigst, nach dem Buchen; bis dahin ist der Beleg unter **Überweisungen** gesperrt wie bei einer Abweichung. Mit **Auch im Kontakt des Lieferanten eintragen** kommt sie zusätzlich in den Kontakt, als neue Version; das geht nur, solange der Kontakt keine IBAN hat, eine vorhandene überschreibt Haben nie, und nur eine gültige IBAN (BT-84 kann auch eine Kontonummer sein). Ohne den Haken bleibt der Kontakt, wie er ist. Die Bestätigung gilt nur für genau diese IBAN.

Die Entscheidungen stehen in einer eigenen, nur anhängbaren Tabelle mit Eintrag im Änderungsprotokoll; Sperre und Siegel des gebuchten Belegs bleiben unberührt. IBANs aus der KI-Auslesung oder dem PDF-Text gleicht Haben nicht ab, nur die der E-Rechnung. Entscheiden kann nur der Inhaber; die [Steuerberatung](steuerberatung.md) sieht den Hinweis.

### Skonto

Skonto bietet Haben nur an, wenn die E-Rechnung es in den Zahlungsbedingungen (BT-20) so angibt, wie XRechnung es vorschreibt (Regel BR-DE-18): `#SKONTO#TAGE=7#PROZENT=2.00#`, wahlweise mit `#BASISBETRAG=…#`. Bei mehreren Stufen gilt die höchste, deren Frist am Ausführungsdatum noch läuft; die Frist zählt ab dem Rechnungsdatum. Dann steht unter dem Lieferanten ein Haken **2,00 % Skonto bis … abziehen**. Ohne Skontoangabe, bei schon teilweise bezahlten Belegen und dort, wo der Bankabgleich kein erhaltenes Skonto buchen kann (§ 13b, Privatanteil, Anlagegut), gibt es den Haken nicht. Nach der Abbuchung buchst du den Rest im Bankabgleich mit **Rest … als erhaltenes Skonto** aus ([Rest ausbuchen](bank.md#rest-ausbuchen-skonto-und-forderungsausfall)).

### Vermerk am Beleg

Für jede Überweisung steht am Beleg „Überweisung erzeugt am …“ mit Betrag, Ausführungsdatum und Referenz, in der Liste der Überweisungen zusätzlich die letzte. Die Datei lässt sich nicht ändern oder löschen; sie ist mit Auftraggeberkonto, Ausführungsdatum und jeder Überweisung in der Datenbank festgehalten, mit Eintrag im [Änderungsprotokoll](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel). Ob die Bank die Datei angenommen hat, weiß Haben nicht; eine zweite Datei für denselben Beleg ist möglich, Haben warnt davor nur mit dem Vermerk.

### Die Datei

Das Format ist pain.001.001.09 nach Anlage 3 des DFÜ-Abkommens der Deutschen Kreditwirtschaft, Version 3.9 (gültig seit 5. Oktober 2025, Schema `pain.001.001.09_GBIC_5.xsd`):

- Ein Zahlungsauftrag mit einer Überweisung je Beleg. `BtchBookg` ist `false`: Die Bank bucht jede Überweisung einzeln ab, statt einer Summe für die ganze Datei, damit der Abgleich jede Abbuchung ihrem Beleg zuordnen kann.
- `NbOfTxs` und `CtrlSum` stehen im Kopf und im Auftrag und sind aus den Überweisungen gezählt.
- Jede Überweisung trägt eine eigene `EndToEndId` (`HABEN-` und 16 Hex-Ziffern), die Datei eine eigene `MsgId`.
- Text nur im Latin-Zeichensatz des EPC (Buchstaben ohne Umlaute, Ziffern und `/ - ? : ( ) . , ' +`): Umlaute schreibt Haben aus (ä → ae, ß → ss), Akzente fallen weg, `&` wird `+`, `@` wird `(at)`; andere Zeichen werden zu Leerzeichen. Namen sind auf 70 Zeichen gekürzt, der Verwendungszweck auf 140.
- Ohne BIC des Auftraggebers steht dort `NOTPROVIDED`, wie das Schema der DK es verlangt; für den Empfänger reicht im SEPA-Raum die IBAN.

## Verrechnen ohne Zahlung

Manche Rechnungen werden nie bezahlt, sondern gegen eine Gutschrift des Lieferanten aufgerechnet. Typisch sind Abschläge und Jahresabrechnungen: Der Versorger schreibt ein Guthaben gut und verrechnet es in den Folgemonaten, abgebucht wird nichts mehr. Bis dahin blieben Rechnung und Gutschrift offen.

Auf der Belegseite eines gebuchten Belegs steht dafür unter **Verrechnung**, wie viel noch offen ist und der Knopf **Mit einem Beleg verrechnen**. Dort wählst du den Gegenbeleg, also die Gutschrift desselben Lieferanten, den Betrag, den Tag der Aufrechnung und einen Grund. Tag und Grund sind Pflicht, weil die Verrechnung steuerlich an diesem Tag wirkt. Das Datum darf nicht vor dem jüngeren der beiden Belege liegen und nicht in der Zukunft; in der Oberfläche ist heute vorbelegt. Vorgeschlagen wird der kleinere der beiden offenen Beträge; bei Teilverrechnung bleibt der Rest offen und lässt sich später mit einer weiteren Rechnung ausgleichen.

Haben verrechnet nur, was zusammenpasst:

- Beide Belege sind gebucht, laufen über die Bank und sind nicht storniert.
- Sie gehören demselben Lieferanten und zeigen in verschiedene Richtungen, also eine Rechnung und eine Gutschrift.
- Der Betrag überschreitet keinen der beiden offenen Reste.

Verrechnungen bewegen kein Geld: Es entsteht kein Bankumsatz, kein Kassenstand ändert sich, und die Buchungen beider Belege bleiben, wie sie sind. Beide Belege zählen danach als erledigt, die Verrechnung steht bei beiden mit Datum, Gegenbeleg und Grund. **Aufheben** setzt sie zurück, wie bei den Ausbuchungen mit einer Gegenzeile, damit die Spur erhalten bleibt. Dabei gibst du den Tag der Aufhebung an: Die Gegenzeile wirkt an diesem Tag, nicht rückwirkend auf den Tag der Verrechnung. Ein bereits gemeldetes Jahr bleibt damit unverändert.

Für die Auswertungen zählt die Verrechnung wie eine Zahlung, und zwar am Tag der Aufrechnung. Das folgt der Rechtsprechung: Die Aufrechnung mit einer fälligen Gegenforderung ist eine Leistung im Sinne des § 11 Abs. 2 EStG (H 11 EStH „Aufrechnung“, BFH vom 19.04.1977, BStBl II S. 601). In der EÜR wirkt sie deshalb auf beide Belege: Der Aufwand der Rechnung und die Minderung aus der Gutschrift fließen in den Zeitraum, in dem aufgerechnet wird, nicht in den des Rechnungsdatums. Eigene Buchungen erzeugt sie nicht, außer der Umbuchung, wenn der Gegenbeleg eine Gutschrift mit **Erstattet bereits Bezahltes** ist: Dann mindert der verrechnete Anteil im Monat der Aufrechnung die Vorsteuer (§ 17 Abs. 1 Satz 2 UStG, siehe [Gutschrift für schon Bezahltes](belege.md#gutschrift-für-schon-bezahltes)).
