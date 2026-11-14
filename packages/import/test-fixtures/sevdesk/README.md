# Antworten von sevDesk

Testdaten aus echten Antworten der sevDesk-API und des DATEV-Exports, anonymisiert. sevDesk hat zwei Buchhaltungsversionen
(`/Tools/bookkeepingSystemVersion`), die Adresse `/api/v1` ist bei beiden dieselbe. Was in der einen gilt, ist für die andere
nicht belegt; deshalb liegen die Daten je Version getrennt.

| Ordner | Herkunft |
| --- | --- |
| `buchhaltung-1.0/` | Testkonto Buchhaltungsversion 1.0 ([#343](https://github.com/firsttris/haben/issues/343), [#472](https://github.com/firsttris/haben/issues/472)) |
| `buchhaltung-2.0/` | Berichte aus [#472](https://github.com/firsttris/haben/issues/472), Tarif Buchhaltung, Version 2.0: DATEV-Export, Storno-Paar, zwei Sätze GET-Antworten eines Melders und Belege mit `taxRule` 12, 14 und 9 eines zweiten |

## Dateien

In beiden Ordnern:

- `storno-paar.json`: Rechnung und ihre Stornorechnung, gleich aufgebaut.
- `belege-credit-debit.json`: Belege (`voucher` und `positions`) mit `creditDebit` und dem Buchungskonto der Position.

Nur `buchhaltung-1.0/`:

- `check-account-transaction-log*.json`, `invoice-teilzahlung*.json`: Teilzahlungen und aufgehobene Zuordnungen.
- `asset.json`, `vat-report.json`: Antworten von `GET /Asset` und `GET /VatReport`, je drei Einträge. Reine Referenz, noch liest sie kein Code.
- `rechnungsvorlage-wkr.json`: drei wiederkehrende Rechnungen; `GET /Invoice` liefert sie nur mit dem Filter `invoiceType=WKR`. Eine hat `status` 50 und `accountIntervall` `P0Y0M1W` (7 Tage) und ist in sevDesk auf nachfällig gestellt.
- `rechnungen-aus-vorlage.json`: drei aus diesen Vorlagen erzeugte Rechnungen (`origin.id` zeigt auf die Vorlage), nur Status, die drei Datumsfelder und Texte, ohne Beträge.
- `platzhalter-auftrag.json`: Angebot mit Platzhalter in `footText`.
- `mahnung-mit-rechnung.json`: zwei Mahnungen (`invoiceType` MA, `status` 500, `dunningLevel` 1 und 2), von sevDesk nach dem Speichern als versendet geführt, dazu unter `gemahnteRechnung` die Rechnung, auf die `origin` zeigt; `GET /Invoice` liefert Mahnungen nur mit dem Filter `invoiceType=MA`.
- `gutschrift.json`: sechs Gutschriften (`creditNote` und `positions`), je eine für jeden Wert von `bookingCategory`, `ACCOUNTING_TYPE` einmal mit Erlöskonto und einmal mit dem Aufwandskonto „Dienstleister / Agenturen / Freelancer“. Alle fertiggestellt (`status` 200, `sendDate` gesetzt, `sendType` `VPDF`), die beiden Honorar-Gutschriften danach bezahlt (`status` 1000, `payDate` gesetzt, `paidAmount` fehlt bei Gutschriften). sevDesk bucht `ACCOUNTING_TYPE` mit Aufwandskonto wie Honorar (DATEV: Soll 3100, BU 9).
- `accounting-type.json`: Antworten von `GET /AccountingType/{id}` zu den beiden Buchungskonten der `ACCOUNTING_TYPE`-Gutschriften in `gutschrift.json`, nur `id`, `objectName`, `name`, `skr03`, `skr04`, `type` und `translationCode`: „Dienstleister / Agenturen / Freelancer“ (3100/5900, `type` leer) und das Erlöskonto (8200/4200, `type` E). Kennungen wie in `gutschrift.json`.
- `gutschrift-zahlungen.json`: die beiden Zahlungen aus `CheckAccountTransactionLog` zu den bezahlten Honorar-Gutschriften, als Auszahlung (`amountPaid` negativ, `fromStatus` 100, `toStatus` 400). Der Filter `object[id]` auf `CheckAccountTransactionLog` wirkt bei sevDesk nicht; die Einträge sind aus der vollen Liste über `object.id` gesucht.
- `belege-zu-buchungen.json`: Rechnung und Belege, deren Nummer genau dem `Belegfeld 1` im Stapel entspricht, Beträge maskiert. Der Beleg zur Zahlungsbuchung ist erfunden.
- `extf-buchungsstapel.csv`, `extf-gp-stamm.csv`, `document-rechnungseingang.xml`, `document-rechnungsausgang.xml`: Auszug aus einem DATEV-Jahresexport, 7 Buchungen und 2 Personenkonten. Die Beleglink-GUIDs der CSV passen zu den XML-Dateien. Die beiden CSV-Dateien sind Windows-1252 mit CRLF und müssen es bleiben.
- `beleg-wiederkehrend-rv.json`: drei Vorlagen wiederkehrender Belege (`voucherType` RV): `status` 50 ohne nächsten Termin, 100 mit nächstem Termin, 1000 mit Enddatum.
- `beleg-ohne-datei.json`: Belege ohne `document`, in diesem Konto mehr als ein Viertel aller Belege.
- `document-download.json`: Hülle von `GET /Document/{id}/download`, Datei als Base64 in `objects`.

Nur `buchhaltung-2.0/`:

- `extf-buchungsstapel.csv`: die Beispielzeilen aus dem Bericht.
- `storno-paar-folgejahr.json`: Rechnung und Storno in verschiedenen Jahren (fünf Jahre auseinander, `paidAmount` als Zahl).
- `rechnungen-steuerregel.json`: Rechnungen mit `taxRule` 11 und 1 und mit `taxType` `noteu`.
- `gutschrift.json`: Antwort von `GET /CreditNote`, ohne Positionen und ohne `paidAmount`.
- `zahlungen.json`: `CheckAccountTransactionLog`, gegliedert nach Fall: bezahlte Rechnung, zwei Zahlungen auf eine Rechnung, ein Umsatz auf zwei Rechnungen, Ausgabebelege mit negativem Betrag.
- `belege-steuerregel.json`: Ausgabebelege mit `taxRule` 12 (zweimal, laut Melder Reverse Charge mit Vorsteuerabzug), 14 und 9 zum Vergleich, mit Positionen und DATEV-Konto.
- `asset.json`, `vat-report.json`: Antworten von `GET /Asset` (eine Anlage) und `GET /VatReport` (vier übermittelte Voranmeldungen und ein Testfall mit `testCase` 1).
- `mahnung-mit-rechnung.json`: Mahnung (`invoiceType` MA, `status` 1000, `dunningLevel` 1) und unter `gemahnte_rechnung` die Rechnung, auf die `origin` zeigt.
- `gutschrift-underachievement.json`: Gutschrift mit `bookingCategory` `UNDERACHIEVEMENT` und Positionen; die einzige Art im Konto des Melders.
- `gutschrift-kategorien.json`: drei Gutschriften aus einem zweiten Konto, je mit `creditNote`, `positions` und `accountingType` (`GET /AccountingType/{id}` des Kontos am Kopf): `PROVISION`, `ROYALTY_ASSIGNED` und `ROYALTY_UNASSIGNED` (versehentlich über 0 €). Je 1 € netto mit 19 %, fertiggestellt (`status` 200), nicht bezahlt. Am Kopf `taxRule` 9, `taxType` `null` und `taxRate` 0, die 19 % nur an den Positionen; `accountingType` am Kopf nur als Verweis. Kennungen und Nummern ersetzt, Beträge und Daten echt (Testbelege).
- `extf-buchungsstapel-gutschriften.csv`, `document-rechnungsausgang-gutschriften.xml`: DATEV-Export dazu, Windows-1252 mit LF wie geliefert. Soll 4760 bzw. 3100 an Kreditor (Personenkonto durch 70001 ersetzt), BU 9; die Gutschrift über 0 € ohne Zeile. Das Belegbild steht unter Rechnungsausgang (`type` 2). Belegnummern `XX-1111111117` und `XX-1111111118`, USt-IdNr. `<anon>`, im Dateinamen festes Datum.
- `dokumente-mit-rechnungsbezug.json`: drei Antworten von `GET /Document` mit dem Kontakt unter `object` und der Rechnung unter `baseObject`.
- `extf-buchungsstapel-auszug.csv`, `extf-gp-stamm.csv`, `document-rechnungsausgang.xml`, `document-rechnungseingang.xml`: Auszug aus dem DATEV-Export mit je einer Rechnung, einem Ausgabebeleg, einer Zahlung und einer Gutschrift, zwei Personenkonten und je drei Einträgen in `document.xml`.

## Was je Version belegt ist

| Frage | 1.0 | 2.0 |
| --- | --- | --- |
| `creditDebit`: C ist Ausgabe | ja | ja: C trägt Wareneingang, Lizenzen, Umsatzsteuer-Vorauszahlungen; D Zinserträge und zweimal KFZ-Versicherung |
| Storno-Paar, bezahlt ohne Zahlung | ja | ja, auch über Jahre hinweg |
| Teilzahlung, Summe gegen den Beleg | ja | nein, Beträge maskiert |
| Einzelzahlungen, Vorzeichen, geteilter Umsatz | ja | ja, ohne Summen |
| Aufgehobene Zuordnung | ja | nein |
| Vorlagen `WKR` und `RV` | ja | nein, im Konto des Melders keine |
| Beleg ohne `document` | ja | ja |
| Mahnung (`MA`) | Stufen 1 und 2, von sevDesk als versendet geführt, Zustellung sowie Gebühren und Zinsen nicht belegt | Stufe 1 mit `status` 1000, `reminderDebit` 0 |
| Antwort von `Document/download` | ja, Hülle ohne Inhalt | Statuscode, Inhaltstyp und dieselben Feldnamen |
| Anlagen (`/Asset`), nur Aufbau | ja | ja, Konto als `accountDatev` |
| Umsatzsteuer-Voranmeldungen (`/VatReport`), nur Aufbau | ja | ja |
| Datei mit Rechnungsbezug (`Document.baseObject`) | nein | ja |
| Gutschrift (`CreditNote`), alle Werte von `bookingCategory` | ja, alle fertiggestellt | `UNDERACHIEVEMENT`, `PROVISION`, `ROYALTY_ASSIGNED` und `ROYALTY_UNASSIGNED` (0 €), mit Positionen und DATEV-Export; `ACCOUNTING_TYPE` gibt es in 2.0 nicht |
| DATEV-Export mit Beleglinks und `document.xml` | ja | ja, Auszug |
| `taxRule` am Beleg | nein | 1, 4, 9, 10, 11, 12, 14, 15; dazu `taxType` `default` und `noteu` |

Offen für 2.0 ([#472](https://github.com/firsttris/haben/issues/472)): echte Beträge und damit Steueraufteilung und Summen, Teilzahlungen (Status 750), wiederkehrende Rechnungen und Belege, Mahnstufe 2, `taxRule` 17 (in beiden Konten nicht vorhanden). Ob D bei „KFZ-Versicherung“ eine Erstattung ist, lässt sich an den maskierten Beträgen nicht prüfen.

`/Asset` hat kein Feld für die bisherige AfA, nur Anschaffungsdatum, Kaufpreis, Nutzungsdauer und Verkaufsdatum. Die Beträge in `asset.json` und `vat-report.json` (auch in `reportingValues`) sind maskiert und tragen keine Summen.

Bei den Vorlagen ist die Bedeutung der Statuswerte aus diesen Beispielen abgeleitet, sevDesk beschreibt sie nicht. „Nachfällig“ hat an der Vorlage kein erkennbares Feld; verglichen wurde nur, welche Felder leer sind.

Ob eine Vorlage nachfällig oder vorschüssig abrechnet, zeigen erst die erzeugten Rechnungen: `invoiceDate` gleich `deliveryDateUntil` heißt nachfällig (39 von 39 Rechnungen einer Vorlage), `invoiceDate` gleich `deliveryDate` vorschüssig (ein Beispiel). Ohne erzeugte Rechnung bleibt es unklar. Belegt ist das nur für das Monatsintervall in Version 1.0, für 2.0 ist es ungeprüft.

Jede Mahnstufe ist ein eigenes `MA`-Objekt und verweist mit `origin` auf die gemahnte Rechnung, nicht auf die vorige Mahnung. Ihre Summen im Kopf sind 0, der Betrag steht in den `reminder*`-Feldern, Positionen hat sie keine. Vor dem Speichern hatte die erste Stufe `status` 100 und kein `sendDate`, nach dem Speichern `status` 500 mit `sendDate` und `sendType` `VPDF`; der Verlauf in sevDesk zeigt sie passend dazu als „versendet“. Die gemahnte Rechnung trägt die höchste Stufe als `dunningLevel` und `status` 200, ihre Betragsfelder `reminderTotal` und `reminderDebit` bleiben leer. In beiden Stufen waren `reminderDebit` und `reminderTotal` im Konto gleich dem Brutto der Rechnung, die Gebühr 0; in der Datei ist das wegen der Maskierung nicht mehr zu sehen. Gebühren und Zinsen sind damit nicht belegt. Nicht belegt ist, ob eine solche Mahnung beim Empfänger ankommt: In diesem Test wurde keine Mail bewusst verschickt.

Am DATEV-Export 2024 aus Version 1.0: 186 Zeilen tragen `BEDI` mit 170 GUIDs, jede GUID gehört zu genau einer Datei, im Belegfeld stehen keine UUIDs oder abgeschnittenen Kennungen. 14 von 442 Belegnummern unterscheiden sich vom Original, alle erklärt: sevDesk entfernt Zeichen außerhalb des DATEV-Zeichensatzes (belegt `.`, `ü`, `ä`) und nimmt dann die letzten 36 Zeichen. Diese Zahlen stammen aus dem vollständigen Export, die Dateien hier sind nur ein Auszug.

Gutschriften aus Version 1.0: Das Buchungskonto steht am Kopf unter `accountingType`, frei wählbar bei `ACCOUNTING_TYPE` (hier Einnahmen), „Dienstleister / Agenturen / Freelancer“ bei `ROYALTY_ASSIGNED`, „Fremdarbeiten/Fremdleistungen“ bei `ROYALTY_UNASSIGNED`, „Verkaufsprovision“ bei `PROVISION`. `UNDERACHIEVEMENT` hat keins, stattdessen zeigen `origin` und `refSrcInvoice` auf die Rechnung. Die Beträge stehen positiv, Positionen tragen kein Konto.

Buchung laut DATEV-Export von sevDesk (SKR03), jeweils im Soll und mit Beleglink auf den Ordner Rechnungsausgang: `ACCOUNTING_TYPE` mit Erlöskonto auf 8200 mit BU 3, `UNDERACHIEVEMENT` auf 8400 ohne BU, `ROYALTY_ASSIGNED` auf 3100 mit BU 9 (Vorsteuer), `PROVISION` auf 4760 (Verkaufsprovisionen) mit BU 9, `ROYALTY_UNASSIGNED` auf 4909 (Fremdleistungen) mit BU 9. Steuerlich und zur Zahlung ist nichts geprüft.

Offene Frage: Honorar und Provision stehen auf Aufwandskonten, und sevDesk bucht `ROYALTY_ASSIGNED`, `ROYALTY_UNASSIGNED` und `PROVISION` im Export auf Aufwand mit Vorsteuer. Haben bildet jede Gutschrift dagegen als negative Einnahme ab (`mapSevCreditNote`).

Belege mit `taxRule` 12 und 14 aus Version 2.0 sind Ausgaben (`creditDebit` C) mit `taxType` `null` und 0 % Steuer an der Position; die Steuerwirkung steckt laut Melder allein in `taxRule`, die EÜR von sevDesk zeigt bei 12 Vorsteuer. Haben rechnet für sie heute keine Vorsteuer. Vorsteuer nach § 13b gehört in Kz 67, die Nachrechnung der Voranmeldung kennt nur Kz 66. Offen in [#472](https://github.com/firsttris/haben/issues/472).

Mahnung aus Version 2.0: `status` 1000, Summen im Kopf 0, `reminderTotal` mit Betrag, `reminderDebit` 0 (in 1.0 gleich `reminderTotal`). Die Dateien mit Rechnungsbezug machen im Konto des Melders rund drei Viertel aller Dokumente aus.

Platzhalter wie `[%KONTAKTPERSON%]` sollen bisher nur als Text übernommen werden, Haben ersetzt sie nicht.

Nur als Befund festgehalten, ohne Datei:

- `GET /Document/{id}/download` antwortete in 2.0 mit 200 und `application/json` und denselben Feldnamen wie in 1.0 (`filename`, `mimetype`, `base64Encoded`, `content`); Inhalt und Datentypen hat kein Melder geliefert.
- `GET /Voucher` mit `voucherType=AV` (Anlagen) lieferte eine leere Liste.

## Anonymisierung

Aufbau, Feldnamen und Datentypen bleiben, denn auf sie kommt es an (`paidAmount` ist in Version 1.0 eine Zahl, in 2.0 teils Zahl, teils Text).

- Kennungen sind durchgehend ersetzt, Verweise (`origin`) passen weiter zusammen. Kennungen von Stammdaten bleiben (`AccountingType`, `AccountDatev`, `TaxRule`, `StaticCountry`).
- Texte, Namen und Adressen sind `<anon>`; in `rechnungsvorlage-wkr.json` bleiben die Platzhalter wie `[%KONTAKTPERSON%]` stehen. In `buchhaltung-2.0/` sind auch Rechnungs- und Belegnummern, `creditNoteDate` und `bookingDate` maskiert.
- In `buchhaltung-1.0/` sind Beträge erfunden, Vorzeichen und Null bleiben. In `invoice-teilzahlung*.json` und `check-account-transaction-log*.json` sind Beträge und Daten maskiert, die Summen und der Steuersatz stimmen weiter; in `belege-credit-debit.json` sind die Daten maskiert, technische Platzhalter wie 1968 bleiben. In `asset.json`, `vat-report.json`, `rechnungsvorlage-wkr.json`, `beleg-wiederkehrend-rv.json` und `beleg-ohne-datei.json` stehen sie auf ±100, in `mahnung-mit-rechnung.json` die `reminder*`-Beträge auf 1, alle Daten in diesen Dateien auf dem 15.01.2024; die Dateien stammen aus einem eigenen Lauf mit eigenen Kennungen. In `rechnungen-aus-vorlage.json` sind die drei Datumsfelder nur ins Jahr 2024 verschoben, Monat und Tag sind echt, damit die Abstände stimmen.
- In `buchhaltung-2.0/` hat der Melder die Summen auf ±100.00 gesetzt, auch `discount` und `discountTime`; das sind keine echten Werte. Netto, Steuer und Brutto können gleich sein, mehrere Zahlungen ergeben nicht den Beleg.
- Datumsangaben sind verschoben, in den GET-Antworten aus 2.0 um ganze Jahre, damit der Jahreswechsel erhalten bleibt. Der Versatz zu UTC ist dabei geblieben und kann in der Woche der Zeitumstellung abweichen; das Datum liest Haben aus den ersten zehn Zeichen (`lexDate`).
- `zahlungen.json` stammt aus einem eigenen Anonymisierungslauf: Gleiche Kennungen dort und in `belege-credit-debit.json` meinen nicht dasselbe Objekt.
- Zweite Runde aus 2.0: Belegnummern, Steuernummern, IBAN, Kundennummern, Ticketnummern des Finanzamts und Freitexte sind `<anon>`, auch wo der Melder nur Ziffern und Buchstaben ersetzt hatte. In `belege-steuerregel.json` sind die Kennungen je Beleg neu vergeben, weil sie maskiert alle gleich waren; Kontenrahmen-Objekte behalten Kennung und Datum.
- Der DATEV-Auszug aus 2.0 kam als UTF-8 mit LF und Kommentarzeilen. Die Kommentarzeilen sind entfernt, Daten auf den 15.01.2024 gesetzt, Belegnummern je Beleg eindeutig gemacht. Steuersatz (19 %) und die Beträge in Beleginfo sind nachgestellt, Netto und Steuer ergeben den Umsatz; es sind keine Werte des Melders; Beleglink, `document.xml` und Belegfeld passen zusammen.
- In `buchhaltung-2.0/extf-buchungsstapel.csv` sind Konten und UUIDs gültige Platzhalter statt `x`, damit sie sich wie echte Werte lesen lassen.
- Im DATEV-Auszug aus `buchhaltung-1.0/` sind Beträge 100,00, Daten der 15.01.2024, Belegnummern pro Buchung einheitlich ersetzt, GUIDs und Dateikennungen Platzhalter; Kontonummern des Kontenrahmens und das Muster der Nummern bleiben. Bezüge per Nummer, GUID und `origin.id` stimmen.

`packages/import/src/sevdesk/anonymisierung.test.ts` prüft alle Dateien hier auf E-Mail, IBAN und USt-IdNr. und sensible Felder auf Platzhalter. Wer neue Daten ablegt, trägt erfundene Namen oder Nummern dort ausdrücklich ein.
