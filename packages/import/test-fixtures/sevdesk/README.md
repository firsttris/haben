# Antworten von sevDesk

Testdaten aus echten Antworten der sevDesk-API und des DATEV-Exports, anonymisiert. sevDesk hat zwei Buchhaltungsversionen
(`/Tools/bookkeepingSystemVersion`), die Adresse `/api/v1` ist bei beiden dieselbe. Was in der einen gilt, ist für die andere
nicht belegt; deshalb liegen die Daten je Version getrennt.

| Ordner | Herkunft |
| --- | --- |
| `buchhaltung-1.0/` | Testkonto Buchhaltungsversion 1.0 ([#343](https://github.com/firsttris/haben/issues/343), [#472](https://github.com/firsttris/haben/issues/472)) |
| `buchhaltung-2.0/` | Berichte aus [#472](https://github.com/firsttris/haben/issues/472), Tarif Buchhaltung, Version 2.0: DATEV-Export, Storno-Paar und ein Satz GET-Antworten eines Melders |

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
- `mahnung-mit-rechnung.json`: Mahnung (`invoiceType` MA, `status` 500, `dunningLevel` 1), in sevDesk gespeichert und nicht versendet, dazu unter `gemahnteRechnung` die Rechnung, auf die `origin` zeigt; `GET /Invoice` liefert Mahnungen nur mit dem Filter `invoiceType=MA`.
- `beleg-wiederkehrend-rv.json`: drei Vorlagen wiederkehrender Belege (`voucherType` RV): `status` 50 ohne nächsten Termin, 100 mit nächstem Termin, 1000 mit Enddatum.
- `beleg-ohne-datei.json`: Belege ohne `document`, in diesem Konto mehr als ein Viertel aller Belege.
- `document-download.json`: Hülle von `GET /Document/{id}/download`, Datei als Base64 in `objects`.

Nur `buchhaltung-2.0/`:

- `extf-buchungsstapel.csv`: die Beispielzeilen aus dem Bericht.
- `storno-paar-folgejahr.json`: Rechnung und Storno in verschiedenen Jahren (fünf Jahre auseinander, `paidAmount` als Zahl).
- `rechnungen-steuerregel.json`: Rechnungen mit `taxRule` 11 und 1 und mit `taxType` `noteu`.
- `gutschrift.json`: Antwort von `GET /CreditNote`, ohne Positionen und ohne `paidAmount`.
- `zahlungen.json`: `CheckAccountTransactionLog`, gegliedert nach Fall: bezahlte Rechnung, zwei Zahlungen auf eine Rechnung, ein Umsatz auf zwei Rechnungen, Ausgabebelege mit negativem Betrag.

## Was je Version belegt ist

| Frage | 1.0 | 2.0 |
| --- | --- | --- |
| `creditDebit`: C ist Ausgabe | ja | ja: C trägt Wareneingang, Lizenzen, Umsatzsteuer-Vorauszahlungen; D Zinserträge und zweimal KFZ-Versicherung |
| Storno-Paar, bezahlt ohne Zahlung | ja | ja, auch über Jahre hinweg |
| Teilzahlung, Summe gegen den Beleg | ja | nein, Beträge maskiert |
| Einzelzahlungen, Vorzeichen, geteilter Umsatz | ja | ja, ohne Summen |
| Aufgehobene Zuordnung | ja | nein |
| Vorlagen `WKR` und `RV` | ja | nein |
| Beleg ohne `document` | ja | ja |
| Mahnung (`MA`) | nur gespeichert, nicht versendet | nein |
| Antwort von `Document/download` | ja, Hülle ohne Inhalt | nur Statuscode und Inhaltstyp |
| Anlagen (`/Asset`), nur Aufbau | ja | ungeprüft |
| Umsatzsteuer-Voranmeldungen (`/VatReport`), nur Aufbau | ja | ungeprüft |
| Gutschrift (`CreditNote`) | nein | ja, ohne Positionen |
| `taxRule` am Beleg | nein | 1, 4, 9, 10, 11, 15; dazu `taxType` `default` und `noteu` |

Offen für 2.0 ([#472](https://github.com/firsttris/haben/issues/472)): echte Beträge und damit Steueraufteilung und Summen, Teilzahlungen (Status 750), Mahnungen und wiederkehrende Rechnungen (im Konto des Melders nicht vorhanden). Ob D bei „KFZ-Versicherung“ eine Erstattung ist, lässt sich an den maskierten Beträgen nicht prüfen.

`/Asset` hat kein Feld für die bisherige AfA, nur Anschaffungsdatum, Kaufpreis, Nutzungsdauer und Verkaufsdatum. Die Beträge in `asset.json` und `vat-report.json` (auch in `reportingValues`) sind maskiert und tragen keine Summen.

Bei den Vorlagen ist die Bedeutung der Statuswerte aus diesen Beispielen abgeleitet, sevDesk beschreibt sie nicht. „Nachfällig“ hat an der Vorlage kein erkennbares Feld; verglichen wurde nur, welche Felder leer sind.

Ob eine Vorlage nachfällig oder vorschüssig abrechnet, zeigen erst die erzeugten Rechnungen: `invoiceDate` gleich `deliveryDateUntil` heißt nachfällig (39 von 39 Rechnungen einer Vorlage), `invoiceDate` gleich `deliveryDate` vorschüssig (ein Beispiel). Ohne erzeugte Rechnung bleibt es unklar. Belegt ist das nur für das Monatsintervall in Version 1.0, für 2.0 ist es ungeprüft.

Eine Mahnung verweist mit `origin` auf die gemahnte Rechnung. Ihre Summen im Kopf sind 0, der Betrag steht in den `reminder*`-Feldern, Positionen hat sie keine. Vor dem Speichern hatte sie `status` 100 und kein `sendDate`, nach dem Speichern in sevDesk `status` 500 mit `sendDate`, obwohl nur gespeichert wurde: `sendDate` belegt also keinen Versand. An der gemahnten Rechnung steht danach `dunningLevel` 1 und `status` 200, die `reminder*`-Felder bleiben dort leer. Eine tatsächlich versendete Mahnung ist nicht belegt.

Platzhalter wie `[%KONTAKTPERSON%]` sollen bisher nur als Text übernommen werden, Haben ersetzt sie nicht.

Nur als Befund festgehalten, ohne Datei:

- `GET /Document/{id}/download` antwortete in 2.0 mit 200 und `application/json`; der Inhalt wurde nicht gelesen.
- `GET /Voucher` mit `voucherType=AV` (Anlagen) lieferte eine leere Liste.
- Für übermittelte Umsatzsteuer-Voranmeldungen kennt der Melder keinen GET-Endpunkt.

## Anonymisierung

Aufbau, Feldnamen und Datentypen bleiben, denn auf sie kommt es an (`paidAmount` ist in Version 1.0 eine Zahl, in 2.0 teils Zahl, teils Text).

- Kennungen sind durchgehend ersetzt, Verweise (`origin`) passen weiter zusammen. Kennungen von Stammdaten bleiben (`AccountingType`, `AccountDatev`, `TaxRule`, `StaticCountry`).
- Texte, Namen und Adressen sind `<anon>`; in `rechnungsvorlage-wkr.json` bleiben die Platzhalter wie `[%KONTAKTPERSON%]` stehen. In `buchhaltung-2.0/` sind auch Rechnungs- und Belegnummern, `creditNoteDate` und `bookingDate` maskiert.
- In `buchhaltung-1.0/` sind Beträge erfunden, Vorzeichen und Null bleiben. In `asset.json`, `vat-report.json`, `rechnungsvorlage-wkr.json`, `beleg-wiederkehrend-rv.json` und `beleg-ohne-datei.json` stehen sie auf ±100, in `mahnung-mit-rechnung.json` die `reminder*`-Beträge auf 1, alle Daten in diesen Dateien auf dem 15.01.2024; die Dateien stammen aus einem eigenen Lauf mit eigenen Kennungen. In `rechnungen-aus-vorlage.json` sind die drei Datumsfelder nur ins Jahr 2024 verschoben, Monat und Tag sind echt, damit die Abstände stimmen.
- In `buchhaltung-2.0/` hat der Melder die Summen auf ±100.00 gesetzt, auch `discount` und `discountTime`; das sind keine echten Werte. Netto, Steuer und Brutto können gleich sein, mehrere Zahlungen ergeben nicht den Beleg.
- Datumsangaben sind verschoben, in den GET-Antworten aus 2.0 um genau drei Jahre, damit Jahreswechsel und Sommerzeit stimmen.
- `zahlungen.json` stammt aus einem eigenen Anonymisierungslauf: Gleiche Kennungen dort und in `belege-credit-debit.json` meinen nicht dasselbe Objekt.
- In `extf-buchungsstapel.csv` sind Konten und UUIDs gültige Platzhalter statt `x`, damit sie sich wie echte Werte lesen lassen.
