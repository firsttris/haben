# Umsatzsteuer-Voranmeldung

Haben berechnet die monatliche Umsatzsteuer-Voranmeldung aus deinen Buchungen und übermittelt sie über ERiC an ELSTER. Du siehst, welche Zahlungen, Rechnungen und Belege hinter jeder Kennzahl stehen, kannst die Werte mit Begründung überschreiben und vor dem Senden prüfen oder testweise übermitteln.

<img src="screenshot-umsatzsteuer.png" alt="Voranmeldung für einen Monat mit den Kennzahlen 81, 86, 66 und 83 links und dem Bereich An ELSTER übermitteln mit Zertifikat, PIN und Testoption rechts" width="900">

## Voraussetzungen

- **Firmendaten** mit Name, Anschrift, Bundesland und einer Steuernummer, die zum Bundesland passt. Fehlt etwas, zeigt die Seite „Firmendaten unvollständig: …“ und Prüfen und Senden bleiben gesperrt. Siehe [einrichtung.md](einrichtung.md).
- **Versteuerungsart** (Ist oder Soll) in den Firmendaten.
- Zum Übermitteln ein **ELSTER-Zertifikat** (.pfx aus Mein ELSTER), hochgeladen unter Einstellungen, und dessen PIN.
- Für echte Übermittlungen ein eingerichtetes **ERiC** (`ERIC_HOME`) und eine eigene **Hersteller-ID** (`ELSTER_HERSTELLER_ID`). Siehe [installation.md](installation.md).

Haben unterstützt nur monatliche Voranmeldungen ohne Dauerfristverlängerung.

Bist du in den Einstellungen als Kleinunternehmer eingetragen, zeigt die Seite oben einen Hinweis: Als Kleinunternehmer gibst du in der Regel keine Voranmeldung ab. Nötig ist sie nur, wenn du selbst Steuer schuldest, etwa für Leistungen ausländischer Unternehmer an dich (Reverse Charge). Die Übersicht zeigt dann keine Aufgaben zur Voranmeldung, zum ELSTER-Zertifikat und zu den Firmendaten für ELSTER.

## So gehst du vor

1. **Umsatzsteuer** öffnen. Haben springt zum Vormonat, also dem Monat, der gerade abzugeben ist. Über **Zeitraum** wählst du den laufenden Monat oder einen der zwölf davor.
2. Die Hinweise oben abarbeiten (siehe [Vorprüfung](#vorprüfung)).
3. Kennzahlen prüfen, bei Bedarf die Quellen aufklappen.
4. **Nur prüfen**: ERiC prüft die Daten, ohne etwas zu senden.
5. **Prüfen und testweise senden** mit gesetztem Haken **Nur Testübermittlung**: Übermittlung an den Testserver, nichts geht an dein Finanzamt.
6. Haken entfernen, **Prüfen und senden**, dann **Jetzt verbindlich senden**.

Vor jedem Prüfen oder Senden speichert Haben den Entwurf, falls er neu oder geändert ist. Mit **Entwurf speichern** geht das auch ohne Prüfung.

## Wie die Kennzahlen entstehen

Die Werte kommen aus den gebuchten Daten, nicht aus einer eigenen Eingabe.

### Umsatzsteuer (Kz 81 und 86)

| Versteuerung | Maßgeblich | Quelle |
| --- | --- | --- |
| Ist (vereinnahmte Entgelte) | Buchungsdatum des Zahlungseingangs | Zuordnungen im [Bankabgleich](bank.md). Bei Teilzahlungen zählt der Anteil der Zahlung, bei mehreren Steuersätzen anteilig je Satz. Aufgehobene Zuordnungen heben sich mit ihrer Gegenzeile auf. |
| Soll (vereinbarte Entgelte) | Rechnungsdatum | Festgeschriebene Rechnungen, Stornos und Korrekturen des Monats mit ihren Beträgen je Steuersatz. |

Kz 81 ist die Bemessungsgrundlage zu 19 %, Kz 86 die zu 7 %. Dazu zählen nur regulär besteuerte Rechnungen und, in Kz 81, die private Nutzung von Firmenwagen im Monat der Nutzung ([Anlagen und AfA](anlagen.md#private-nutzung-von-firmenwagen)). Belege mit Privatanteil zählen in Kz 66 nur mit dem betrieblichen Teil. Regulär besteuerte Umsätze zu 0 % meldet Haben nicht; die Vorprüfung weist darauf hin.

### Umsätze ohne Steuer (Kz 21, 45 und 48)

Rechnungen ohne Steuerausweis (siehe [Rechnungen](rechnungen.md#umsatzsteuer-auf-der-rechnung)) meldet Haben mit ihrer Bemessungsgrundlage, ohne Steuer. Sie ändern Kz 83 nicht.

| Kennzahl | Umsatzsteuer an der Rechnung | Maßgeblich |
| --- | --- | --- |
| 21 | Reverse Charge: Leistung an Unternehmen im EU-Ausland | immer das Rechnungsdatum, auch bei Ist-Versteuerung |
| 45 | Leistung ins Nicht-EU-Ausland (nicht steuerbar) | wie Kz 81: Ist nach Zahlungseingang, Soll nach Rechnungsdatum |
| 48 | Steuerfrei nach § 4 UStG (ohne Vorsteuerabzug) | wie Kz 81: Ist nach Zahlungseingang, Soll nach Rechnungsdatum |

Bei Reverse Charge ist der Monat der Leistung maßgeblich, nicht die Zahlung. Haben nimmt das Rechnungsdatum als Näherung dafür. Kleinunternehmer-Rechnungen erscheinen in keiner Kennzahl.

In der Tabelle der Kennzahlen stehen Kz 21, 45 und 48 nur, wenn sie nicht null sind oder du die Werte von Hand überschreibst.

### Vorsteuer (Kz 66)

Die Vorsteuer kommt aus gebuchten [Belegen](belege.md), zugeordnet nach ihrem **Belegdatum**, bei Ist- wie bei Soll-Versteuerung. Ob und wann der Beleg bezahlt wurde, spielt keine Rolle.

### Übernahmen aus Lexoffice

Bei der [Migration aus Lexoffice](lexoffice.md) übernommene offene Posten sind schon in Lexoffice gemeldet und werden nicht doppelt gezählt:

- Übernommene Belege zählen nie für Kz 66.
- Übernommene Rechnungen zählen bei Soll-Versteuerung nicht.
- Bei Ist-Versteuerung zählt der Zahlungseingang auf eine übernommene Rechnung mit, denn die Steuer war in Lexoffice noch nicht fällig.

### Rundung und Kz 83

ELSTER erwartet die Bemessungsgrundlagen in vollen Euro. Haben schneidet die Cent ab (`toWholeEuros` in `packages/core/src/ustva.ts`) und rechnet die Steuer aus dem abgeschnittenen Betrag:

| Kennzahl | Inhalt | Rundung |
| --- | --- | --- |
| 81 | Steuerpflichtige Umsätze 19 % | volle Euro, Cent abgeschnitten; Steuer = 19 % davon, auf Cent gerundet |
| 86 | Steuerpflichtige Umsätze 7 % | volle Euro, Cent abgeschnitten; Steuer = 7 % davon, auf Cent gerundet |
| 21, 45, 48 | Umsätze ohne Steuer | volle Euro, Cent abgeschnitten |
| 66 | Vorsteuer aus Rechnungen anderer Unternehmer | centgenau |
| 83 | Verbleibende Umsatzsteuer-Vorauszahlung | Steuer 81 + Steuer 86 − Kz 66 |

Ist Kz 83 negativ, heißt die Zeile „Verbleibender Überschuss (Erstattung)“.

Beispiel: Zahlungseingänge zu 19 % mit 2.345,67 € netto ergeben Kz 81 = 2.345 € und eine Steuer von 445,55 €.

### Quellen aufklappen

Unter jeder Kennzahl steht, wie viele Zahlungseingänge, Rechnungen oder Belege dahinterstehen. Ein Klick klappt die Liste auf: Datum, Rechnungs- oder Belegnummer mit Kunde bzw. Lieferant, Netto und Steuer, jeweils mit Link zur Rechnung oder zum Beleg. Die Beträge dort sind centgenau, also vor dem Abschneiden.

## Manuell überschreiben

Mit **Manuell überschreiben** gibst du Kz 81, 86, 21, 45, 48 und 66 selbst ein. Dann ist eine **Begründung der Abweichung** Pflicht (mindestens 10 Zeichen). Darunter stehen die berechneten Werte zum Vergleich. Gespeichert werden die eingegebenen Werte, die Begründung und die berechneten Werte zum Zeitpunkt des Speicherns. Nach dem Senden zeigt die Seite „Manuell überschrieben: …“ mit der Begründung.

Manuelle Werte dürfen auch negativ sein, etwa wenn im Monat Gutschriften überwiegen. Mit **Aus Buchungen berechnet** kehrst du zu den berechneten Werten zurück.

## Veralteter Entwurf

Ein gespeicherter berechneter Entwurf friert die Zahlen nicht ein. Ändern sich danach Buchungen im Monat, zeigt die Seite: „Die Buchungen haben sich seit dem Speichern geändert; angezeigt sind die aktuellen Werte. Beim Senden werden sie übernommen.“ Haben rechnet einen berechneten Entwurf vor jedem Prüfen oder Senden neu. Manuelle Entwürfe bleiben, wie sie sind.

## Vorprüfung

Solange die Anmeldung nicht gesendet ist, prüft Haben, was im Monat noch fehlt und die Zahlen verfälschen könnte. Jeder Hinweis verlinkt auf die passende Seite.

| Hinweis | Gewicht | Prüfung |
| --- | --- | --- |
| … Ausgaben im Zeitraum ohne Beleg oder Zuordnung | Warnung | Bankausgänge mit Buchungsdatum im Monat, die nicht voll zugeordnet sind. Ohne Beleg wird keine Vorsteuer angesetzt. |
| … Zahlungseingänge im Zeitraum noch nicht zugeordnet | Warnung bei Ist, Hinweis bei Soll | Bankeingänge im Monat ohne volle Zuordnung. Bei Ist fehlt sonst Umsatzsteuer. |
| … Belege sind noch nicht gebucht | Warnung | Ungebuchte Belege mit Belegdatum im Monat oder ganz ohne Belegdatum. |
| … Rechnungsentwürfe mit Datum im Zeitraum | Hinweis | Nicht festgeschriebene Rechnungen mit Rechnungsdatum im Monat. |
| Regulär besteuerte Umsätze zu 0 % | Warnung | Im Monat gibt es regulär besteuerte Umsätze zu 0 %, die Haben nicht meldet. Ist es Reverse Charge, eine Leistung ins Drittland oder steuerfrei, stellst du das an der Rechnung ein. |

Die Hinweise blockieren nichts. Du entscheidest, ob du trotzdem sendest.

## Fälligkeit

Die Voranmeldung ist am 10. des Folgemonats fällig. Fällt der 10. auf einen Samstag, Sonntag oder gesetzlichen Feiertag im Bundesland aus deinen Firmendaten, rechnet Haben mit dem nächsten Werktag (`dueDate` in `packages/core/src/period.ts`). Feiertage einzelner Gemeinden zählen nicht, ohne Bundesland nur die bundesweiten. Das Datum steht unter den Kennzahlen; die Übersicht zeigt die offene Voranmeldung als Aufgabe und hebt sie drei Tage vor der Frist hervor.

## Übermitteln an ELSTER

Rechts steht der Bereich **An ELSTER übermitteln** mit dem hinterlegten Zertifikat, dem Feld **Zertifikats-PIN** und dem Haken **Nur Testübermittlung**.

| Aktion | Braucht | Was passiert |
| --- | --- | --- |
| **Nur prüfen** | vollständige Firmendaten | ERiC prüft das XML gegen die Regeln, ohne zu senden. |
| **Prüfen und testweise senden** | Zertifikat, PIN | Prüfung und Übermittlung mit Testmerker `700000004` und der Test-Hersteller-ID `74931`. Der Server nimmt die Daten an, leitet sie aber nicht ans Finanzamt weiter. |
| **Prüfen und senden** | Zertifikat, PIN, `ELSTER_HERSTELLER_ID` | Echte Übermittlung nach einer zweiten Bestätigung („Jetzt verbindlich senden“). |

Ohne eigene Hersteller-ID ist der Haken **Nur Testübermittlung** fest gesetzt; die Seite sagt dann „Echtübermittlung erst mit eigener Hersteller-ID (ELSTER_HERSTELLER_ID).“

### Was im Hintergrund passiert

1. Haben erzeugt das ElsterXML der Datenart `UStVA_<Jahr>` mit 13-stelliger Steuernummer, Empfänger-Finanzamt aus der Steuernummer, Datenlieferant aus den Firmendaten und den Kennzahlen. Die Kennzahlen stehen in aufsteigender Reihenfolge (10, 21, 45, 48, 66, 81, 83, 86). Kz 21, 45, 48, 66, 81 und 86 erscheinen nur, wenn sie nicht null sind; Kz 83 steht immer drin.
2. Jeder ERiC-Aufruf läuft in einem eigenen, kurzlebigen Kindprozess mit 120 Sekunden Zeitlimit.
3. Zum Senden wird das Zertifikat entschlüsselt und nur für die Dauer des Aufrufs in ein privates temporäres Verzeichnis geschrieben, danach gelöscht. Die PIN wird weder gespeichert noch geloggt.
4. Beim Senden prüft ERiC, übermittelt und erzeugt das Übertragungsprotokoll als PDF.
5. Jeder Versuch, auch ein fehlgeschlagener, landet im Verlauf: Art, Ergebnis, ERiC-Rückgabecode, Meldung, Transfer-Ticket, gesendetes XML, Antworten von ERiC und Server und das Protokoll-PDF. Diese Einträge lassen sich nur ergänzen, nicht ändern oder löschen.
6. Nach einer erfolgreichen echten Übermittlung wird die Anmeldung mit Transfer-Ticket und Zeitpunkt gespeichert und festgeschrieben. Ein Datenbank-Trigger verhindert danach jede Änderung.

### Verlauf und Protokoll

Der Bereich **Verlauf** listet für den Monat jede Prüfung, Testübermittlung und Übermittlung mit „OK“ oder „Fehler <Code>“, Zeitpunkt, Transfer-Ticket und Fehlermeldung. Wo es ein Protokoll gibt, öffnet **Protokoll** das PDF. Darunter stehen die zuletzt gesendeten Voranmeldungen aller Monate mit ihrer Zahllast.

## Berichtigte Anmeldung

Eine gesendete Anmeldung ist gesperrt. Stellst du danach einen Fehler fest, legst du mit **Berichtigte Anmeldung anlegen** einen neuen Entwurf an. Er übernimmt die Werte der zuletzt gesendeten Anmeldung und trägt im XML Kz 10 = 1. War die ursprüngliche Anmeldung aus den Buchungen berechnet, rechnet Haben die berichtigte vor dem Senden neu; korrigierst du also erst die Buchungen, landen die richtigen Werte automatisch darin. Status und Verlauf zeigen „berichtigte Anmeldung“ bzw. „(berichtigt)“.

## Zertifikat

Das Zertifikat lädst du unter Einstellungen hoch. Es wird mit `HABEN_ENCRYPTION_KEY` verschlüsselt gespeichert. Trägst du dort **Gültig bis** ein, erinnert die Übersicht 30 Tage vor Ablauf („ELSTER-Zertifikat läuft bald ab“) und nach Ablauf („ELSTER-Zertifikat abgelaufen“). Ohne Datum gibt es keine Erinnerung.

## Simulierter Modus

Ist `ERIC_HOME` nicht gesetzt, zeigt die Seite „ERiC ist nicht eingerichtet. Prüfen und Senden laufen simuliert, nichts geht an das Finanzamt.“ Ein Ersatz-Client prüft dann nur, ob das XML wohlgeformt ist und Kz 83 enthält. Übermittlungen bekommen ein erfundenes Ticket (`fake-…`) und ein Protokoll-PDF mit dem Text „Testprotokoll – keine echte Übermittlung“.

Eine Echtübermittlung ist im simulierten Modus nicht möglich: Der Haken **Nur Testübermittlung** bleibt gesetzt, und Haben lehnt eine Echtübermittlung ab, solange kein ERiC eingerichtet ist. So wird keine Anmeldung als gesendet festgeschrieben, die nie beim Finanzamt war.

## Grenzen

- Nur Monatszeiträume, keine Quartals- oder Jahreserklärung, keine Dauerfristverlängerung.
- Nur die Kennzahlen 81, 86, 21, 45, 48, 66, 83 und 10. Keine innergemeinschaftlichen Lieferungen oder Erwerbe, keine Steuer als Leistungsempfänger (§ 13b UStG), keine Zusammenfassende Meldung.
- Festgeschrieben wird die Anmeldung, nicht der Monat. Buchungen im Monat sind danach weiter möglich, etwa wenn du eine Zuordnung aufhebst. Ergeben sich daraus andere Kennzahlen als gesendet, zeigt die Seite des Monats einen Hinweis mit den neuen Werten; prüfe dann, ob du eine berichtigte Anmeldung brauchst.
