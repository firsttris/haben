# Buchhaltung in Haben (Buchungslogik)

Diese Seite beschreibt, wie Haben bucht: welche Konten es verwendet, welcher Vorgang welchen Buchungssatz erzeugt und wie die Unveränderbarkeit nach GoBD technisch abgesichert ist. Sie richtet sich an Nutzer, die ihre Buchungen nachvollziehen wollen, und an Steuerberatungen.

## Grundsätze

- **Beträge in Cent.** Alle Geldbeträge sind ganze Cent (`integer`), Steuersätze Basispunkte (1900 = 19 %). Es gibt keine Gleitkommarechnung mit Geld. Rechnungen runden die Steuer je Steuersatz auf die Summe der Positionen, nicht je Position.
- **Doppelte Buchführung im Hintergrund.** Jeder buchungsrelevante Vorgang erzeugt eine Buchung (`journal_entries`) mit mindestens zwei Zeilen (`journal_lines`), je Zeile Konto, Soll oder Haben und Steuerschlüssel. Die Auswertungen und die Voranmeldung rechnet Haben aus den zugrunde liegenden Rechnungen, Zahlungen und Belegen; das Journal dokumentiert dieselben Vorgänge in Kontenform.
- **Festschreibung ab Entstehung.** Eine Buchung wird in derselben Datenbanktransaktion angelegt und festgeschrieben, in der der Vorgang passiert. Beim Festschreiben prüft ein Trigger, dass Soll gleich Haben ist und die Buchung mindestens eine Zeile hat.
- **Korrektur nur per Gegenbuchung.** Festgeschriebene Buchungen, Rechnungen, Belege und gesendete Voranmeldungen lassen sich nicht ändern oder löschen. Eine Rechnung wird storniert oder korrigiert, eine Zahlungszuordnung per Gegenzeile und Gegenbuchung aufgehoben, eine Voranmeldung berichtigt.
- **Ein Kontenrahmen je Buchung.** Jede Buchung speichert den Kontenrahmen, mit dem sie entstanden ist. Ein Wechsel des Kontenrahmens in den Einstellungen gilt nur für künftige Buchungen.

## GoBD: Unveränderbarkeit in der Datenbank

Die Sperren stecken nicht nur im Anwendungscode, sondern als Trigger in Postgres (`apps/web/drizzle/0001_festschreibung.sql` und folgende `*_trigger.sql`). Sie greifen also auch bei direktem Zugriff auf die Datenbank.

| Art | Tabellen | Wirkung |
| --- | --- | --- |
| Festschreibung | `journal_entries`, `invoices`, `documents`, `vat_returns` | `UPDATE` und `DELETE` werden abgelehnt, sobald `locked_at` gesetzt ist |
| Abhängige Zeilen | `journal_lines`, `invoice_lines`, `document_amounts` | Einfügen, Ändern und Löschen abgelehnt, wenn die Buchung, Rechnung bzw. der Beleg festgeschrieben ist |
| Nur anhängen | `audit_log`, `vat_return_submissions`, `contact_versions`, `bank_imports`, `bank_transactions`, `allocations`, `archive_files`, `datev_bookings`, `lexoffice_vouchers`, `lexoffice_voucher_files` | `UPDATE` und `DELETE` immer abgelehnt (`audit_log` auch `TRUNCATE`) |
| Kontakte | `contacts` | Löschen abgelehnt; jede Änderung erhöht die Version und legt eine Kopie in `contact_versions` ab |
| Nummernkreis | `invoice_number_counters` | Zähler darf nicht sinken, Zeilen nicht gelöscht werden |
| Zuordnungen | `allocations` | Vorzeichen muss dem Bankumsatz entsprechen, die Summe darf den Umsatz nicht übersteigen |

### Änderungsprotokoll

Trigger schreiben jede Änderung an den wichtigen Tabellen mit altem und neuem Wert als JSON in `audit_log`: Firmendaten, Zertifikate, Voranmeldungen und Übermittlungen, Kontakte, Rechnungen, Buchungen, Nummernkreis, Belege, Bankkonten, Importe, Zuordnungen, Archivdateien, Lexoffice-Abrufe und -Verbindung. Binärdaten (PDF, XML, Protokoll-PDF) und verschlüsselte Inhalte werden dabei weggelassen.

Jede schreibende Aktion läuft in einer Transaktion, die vorher `haben.actor` auf die ID des angemeldeten Nutzers setzt (`withActor` in `apps/web/src/server/db/actor.ts`). Der Trigger übernimmt diesen Wert in die Spalte `actor`. So ist jede Änderung einer Person zugeordnet.

## Ist- und Soll-Versteuerung

Die Versteuerungsart wird unter Einstellungen festgelegt. Sie bestimmt, wann die Umsatzsteuer fällig wird:

- **Soll:** mit der Rechnung. Die Rechnungsbuchung geht direkt auf das Konto „Umsatzsteuer“, die Voranmeldung zählt nach Rechnungsdatum.
- **Ist:** mit dem Zahlungseingang. Die Rechnungsbuchung geht auf „Umsatzsteuer nicht fällig“. Beim Zahlungseingang wird der Steueranteil der Zahlung auf „Umsatzsteuer“ umgebucht, bei Teilzahlungen anteilig; die Voranmeldung zählt nach Buchungstag des Zahlungseingangs.

Die Vorsteuer zählt in beiden Fällen nach Belegdatum. Haben liest die Einstellung bei jeder Buchung neu und verhindert keinen Wechsel. Wird gewechselt, während noch Rechnungen offen sind, passt die Zahlungsbuchung nicht mehr zur Rechnungsbuchung (etwa bleibt Steuer auf „Umsatzsteuer nicht fällig“ stehen). Die Versteuerungsart sollte deshalb vor der ersten Rechnung feststehen und nur in Absprache mit der Steuerberatung geändert werden. Die EÜR ist unabhängig davon immer eine Zufluss-Abfluss-Rechnung (siehe [Auswertungen](auswertungen.md)).

## Kontenrahmen

Haben bucht nach SKR03 oder SKR04. Die Zuordnung steht in `packages/core/src/posting.ts` (`ACCOUNTS`, `ACCOUNT_NAMES`, `EXPENSE_CATEGORIES`).

> [!IMPORTANT]
> Die Konten sind sorgfältig gewählt, aber nicht von einer Steuerberatung abgenommen. Sie sollten vor dem Echtbetrieb mit der Steuerberatung abgeglichen werden, besonders wenn diese mit den Daten weiterarbeitet.

### Bestands- und Steuerkonten

| Zweck | SKR03 | SKR04 |
| --- | --- | --- |
| Bank (alle Bankkonten auf einem Finanzkonto) | 1200 | 1800 |
| Forderungen aus Lieferungen und Leistungen | 1400 | 1200 |
| Verbindlichkeiten aus Lieferungen und Leistungen | 1600 | 3300 |
| Erlöse 19 % USt | 8400 | 4400 |
| Erlöse 7 % USt | 8300 | 4300 |
| Erlöse (ohne USt) | 8200 | 4200 |
| Umsatzsteuer 19 % | 1776 | 3806 |
| Umsatzsteuer 7 % | 1771 | 3801 |
| Umsatzsteuer nicht fällig 19 % | 1766 | 3816 |
| Umsatzsteuer nicht fällig 7 % | 1761 | 3811 |
| Vorsteuer 19 % | 1576 | 1406 |
| Vorsteuer 7 % | 1571 | 1401 |
| Umsatzsteuer-Vorauszahlungen | 1780 | 3820 |
| Privatentnahmen | 1800 | 2100 |
| Privateinlagen | 1890 | 2180 |
| Geldtransit | 1360 | 1460 |
| Nebenkosten des Geldverkehrs | 4970 | 6855 |
| Saldenvorträge Sachkonten | 9000 | 9000 |

Achtung bei der Nummer 1200: In SKR03 ist das die Bank, in SKR04 die Forderungen; in SKR03 ist 1800 die Privatentnahme, in SKR04 die Bank.

### Aufwandskonten der Belegkategorien

Jeder Beleg bekommt eine Kategorie. Sie bestimmt das Aufwandskonto und die Zeile in der EÜR.

| Kategorie | SKR03 | SKR04 |
| --- | --- | --- |
| Software und Lizenzen | 4964 | 6837 |
| Hosting und IT-Dienste | 4806 | 6495 |
| Hardware (GWG bis 800 € netto) | 0480 | 0670 |
| Telefon | 4920 | 6805 |
| Internet | 4925 | 6810 |
| Bürobedarf | 4930 | 6815 |
| Fachliteratur | 4940 | 6820 |
| Fortbildung | 4945 | 6821 |
| Reisekosten: Fahrten | 4673 | 6673 |
| Reisekosten: Übernachtung | 4676 | 6680 |
| Porto | 4910 | 6800 |
| Werbung | 4600 | 6600 |
| Rechts- und Beratungskosten | 4950 | 6825 |
| Buchführung und Steuerberatung | 4955 | 6830 |
| Fremdleistungen | 3100 | 5900 |
| Kontoführung und Gebühren | 4970 | 6855 |
| Versicherungen | 4360 | 6400 |
| Beiträge | 4380 | 6420 |
| Sonstiger Aufwand | 4900 | 6300 |

Hardware wird als geringwertiges Wirtschaftsgut voll im Jahr der Zahlung abgezogen. Anlagevermögen mit Abschreibung kennt Haben nicht.

## Buchungssätze

Die Tabellen zeigen je Vorgang die Zeilen einer Buchung. Bei mehreren Steuersätzen entstehen Erlös-, Aufwands- und Steuerzeilen je Satz; Zeilen mit 0 € entfallen. Negative Beträge (Storno, Korrektur, Gutschrift, Rückzahlung) drehen Soll und Haben.

### Rechnung festschreiben

Beim Festschreiben einer Ausgangsrechnung, gebucht auf das Rechnungsdatum. Beschreibung: `Rechnung <Nummer> · <Kunde>`.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1400 Forderungen | 1200 Forderungen | brutto | |
| 8400 / 8300 / 8200 Erlöse | 4400 / 4300 / 4200 Erlöse | | netto je Satz |
| Soll: 1776 / 1771 Umsatzsteuer | Soll: 3806 / 3801 Umsatzsteuer | | Steuer je Satz |
| Ist: 1766 / 1761 USt nicht fällig | Ist: 3816 / 3811 USt nicht fällig | | Steuer je Satz |

### Stornorechnung und Rechnungskorrektur

Eine Stornorechnung ist eine neue Rechnung mit allen Positionen der ursprünglichen, negativ, und wird sofort festgeschrieben. Eine Rechnungskorrektur entsteht als Entwurf mit negativen Positionen, die angepasst werden; sie muss den Betrag mindern. Beide bekommen eine eigene Nummer, verweisen auf die ursprüngliche Rechnung und werden wie oben gebucht, mit gedrehten Seiten:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 8400 / 8300 / 8200 Erlöse | 4400 / 4300 / 4200 Erlöse | netto je Satz | |
| 1776 / 1771 bzw. 1766 / 1761 | 3806 / 3801 bzw. 3816 / 3811 | Steuer je Satz | |
| 1400 Forderungen | 1200 Forderungen | | brutto |

Buchungsdatum ist das Datum der Storno- bzw. Korrekturrechnung.

### Zahlungseingang auf eine Rechnung

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

### Beleg buchen

Beim Buchen eines Eingangsbelegs, gebucht auf das Belegdatum. Beschreibung: `Beleg <Rechnungsnummer> · <Lieferant>`. Die Beträge je Satz kommen vom Beleg, Haben rechnet die Steuer nicht nach.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| Aufwandskonto der Kategorie | Aufwandskonto der Kategorie | netto je Satz | |
| 1576 / 1571 Vorsteuer | 1406 / 1401 Vorsteuer | Steuer je Satz | |
| Zahlung „Bank“: 1600 Verbindlichkeiten | Zahlung „Bank“: 3300 Verbindlichkeiten | | brutto |
| Zahlung „privat“: 1890 Privateinlagen | Zahlung „privat“: 2180 Privateinlagen | | brutto |

Ein privat bezahlter Beleg ist damit erledigt. Ein über die Bank zu zahlender bleibt als Verbindlichkeit offen, bis die Zahlung im Bankabgleich zugeordnet ist. Gutschriften (negative Beträge) drehen die Seiten.

### Zahlung eines Belegs

Beim Zuordnen eines Bankumsatzes zu einem gebuchten Beleg, gebucht auf den Buchungstag. Beschreibung: `Zahlung Beleg <Nummer> · <Lieferant>`.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1600 Verbindlichkeiten | 3300 Verbindlichkeiten | Zahlbetrag | |
| 1200 Bank | 1800 Bank | | Zahlbetrag |

### Bankumsätze ohne Rechnung oder Beleg

Im Bankabgleich lassen sich Umsätze ohne Rechnung oder Beleg einer von vier Arten zuordnen. Gebucht wird Bank gegen ein Gegenkonto, auf den Buchungstag. Bei einem Ausgang (negativer Betrag) steht die Bank im Haben, bei einem Eingang im Soll.

| Art | Gegenkonto SKR03 | Gegenkonto SKR04 | Ausgang | Eingang |
| --- | --- | --- | --- | --- |
| Privat | 1800 Privatentnahmen bzw. 1890 Privateinlagen | 2100 Privatentnahmen bzw. 2180 Privateinlagen | Entnahme an Bank | Bank an Einlage |
| Geldtransit (eigenes Konto) | 1360 | 1460 | Geldtransit an Bank | Bank an Geldtransit |
| Umsatzsteuer an das Finanzamt | 1780 | 3820 | Vorauszahlung an Bank | Bank an Vorauszahlung (Erstattung) |
| Kontoführung und Bankgebühren | 4970 | 6855 | Gebühren an Bank | Bank an Gebühren |

Beispiel Bankgebühr von 9,90 € in SKR03:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 4970 Nebenkosten des Geldverkehrs | 6855 Nebenkosten des Geldverkehrs | 9,90 | |
| 1200 Bank | 1800 Bank | | 9,90 |

### Zuordnung aufheben

Eine Zuordnung wird nicht gelöscht. Haben legt eine Gegenzeile mit negativem Betrag an (`allocations.reverses_id`) und bucht eine Gegenbuchung mit allen Zeilen der ursprünglichen Buchung, Soll und Haben vertauscht. Sie verweist über `reverses_id` auf die ursprüngliche Buchung, trägt die Beschreibung `Storno: …` und das Datum des Bankumsatzes. Danach ist der Umsatz wieder offen und kann neu zugeordnet werden.

### Eröffnungsbuchungen für offene Posten aus Lexoffice

Beim [Umzug aus Lexoffice](lexoffice.md) lassen sich unbezahlte Rechnungen und Eingangsbelege übernehmen. Erlös bzw. Aufwand stehen schon in den alten Büchern, deshalb bucht Haben gegen den Saldenvortrag, auf das Datum der Übernahme.

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

Die spätere Zahlung wird wie jede andere gebucht. Für die Voranmeldung zählt bei Soll-Versteuerung eine übernommene Rechnung nicht noch einmal, ebenso wenig die Vorsteuer eines übernommenen Belegs.

## Steuerschlüssel und Kennzahlen

Erlös-, Aufwands- und Steuerzeilen tragen einen Steuerschlüssel. Forderungen, Verbindlichkeiten, Bank, Privat- und Saldenvortragskonten bleiben ohne; ebenso die Zeilen der Eröffnungsbuchungen.

| Schlüssel | Satz | Kennzahl der Voranmeldung | Bedeutung |
| --- | --- | --- | --- |
| `USt19` | 19 % | 81 | Umsatzsteuer 19 % |
| `USt7` | 7 % | 86 | Umsatzsteuer 7 % |
| `frei` | 0 % | – | Ohne Umsatzsteuer |
| `VSt19` | 19 % | 66 | Vorsteuer 19 % |
| `VSt7` | 7 % | 66 | Vorsteuer 7 % |
| `keineVSt` | 0 % | – | Ohne Vorsteuer |

Die Kennzahlen der [Voranmeldung](umsatzsteuer.md) rechnet Haben aus denselben Quellen wie die Buchungen (`apps/web/src/server/vat-figures.ts`):

- **Kz 81 und 86:** Bemessungsgrundlagen zu 19 % bzw. 7 %, bei Soll aus den festgeschriebenen Rechnungen des Monats, bei Ist aus den zugeordneten Zahlungseingängen des Monats, anteilig je Zahlung. ELSTER bekommt sie in vollen Euro, die Steuer wird daraus neu berechnet.
- **Kz 66:** Vorsteuer aus den gebuchten Belegen des Monats nach Belegdatum.
- **Kz 83:** Umsatzsteuer aus Kz 81 und 86 minus Kz 66.

Umsätze zu 0 % meldet Haben nicht; die Vorprüfung weist darauf hin, damit geklärt werden kann, ob eine Kennzahl dafür nötig ist.

## Die Seite „Buchungen“

Unter **Buchungen** steht das Journal je Monat, neueste zuerst, mit Pfeilen zum Vor- und Folgemonat. Jede Buchung zeigt Datum, Beschreibung und Herkunft („Rechnung“, „Beleg“, „Bank“ oder „Gegenbuchung“), darunter je Zeile Kontonummer, Kontoname, Soll, Haben und Steuerschlüssel. Die Seite ist nur lesend; gebucht wird ausschließlich über Rechnungen, Belege und den Bankabgleich.

Dasselbe Journal steht im [Jahresexport](auswertungen.md#jahresexport) als `buchungen/journal.csv`, eine Zeile je Buchungszeile, mit Buchungs-ID, Quelle, Kontenrahmen und Verweis auf die Ursprungsbuchung bei Gegenbuchungen.

## Was Haben nicht bucht

- Anlagevermögen und Abschreibungen, Sachentnahmen, private Kfz-Nutzung
- Kleinunternehmerregelung, Reverse Charge und innergemeinschaftliche Umsätze
- Lohn, Kasse und Fremdwährung
- Abschlussbuchungen und Saldenvorträge zum Jahreswechsel (außer für übernommene offene Posten)

> [!NOTE]
> Haben ersetzt keine Steuerberatung. Arbeitet die Steuerberatung mit den Daten weiter, bekommt sie das Journal aus dem Jahresexport; die Kontenzuordnung sollte einmal mit ihr abgestimmt werden.
