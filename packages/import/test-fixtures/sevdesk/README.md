# Antworten von sevDesk

Testdaten aus echten Antworten der sevDesk-API und des DATEV-Exports, anonymisiert. sevDesk hat zwei Buchhaltungsversionen
(`/Tools/bookkeepingSystemVersion`), die Adresse `/api/v1` ist bei beiden dieselbe. Was in der einen gilt, ist für die andere
nicht belegt; deshalb liegen die Daten je Version getrennt.

| Ordner | Herkunft |
| --- | --- |
| `buchhaltung-1.0/` | Testkonto Buchhaltungsversion 1.0 ([#343](https://github.com/firsttris/haben/issues/343), [#472](https://github.com/firsttris/haben/issues/472)) |
| `buchhaltung-2.0/` | Bericht aus [#472](https://github.com/firsttris/haben/issues/472), Tarif Buchhaltung, Version 2.0 |

## Dateien

- `storno-paar.json` in beiden Ordnern: Rechnung und ihre Stornorechnung, gleich aufgebaut.
- `buchhaltung-1.0/belege-credit-debit.json`: Belege mit `creditDebit` und dem Buchungskonto der Position; zeigt, dass C die Ausgabe ist.
- `buchhaltung-2.0/extf-buchungsstapel.csv`: die Beispielzeilen aus dem Bericht.
- `buchhaltung-1.0/` außerdem: Einzelzahlungen (`CheckAccountTransactionLog`).

Für Version 2.0 fehlen noch Belege (`Voucher`, `VoucherPos`) und Einzelzahlungen; offen in [#472](https://github.com/firsttris/haben/issues/472).

## Anonymisierung

Aufbau, Feldnamen und Datentypen bleiben, denn auf sie kommt es an (`paidAmount` ist in Version 1.0 auch eine Zahl, in 2.0 Text).

- Kennungen sind durchgehend ersetzt, Verweise (`origin`) passen weiter zusammen.
- Texte, Namen und Adressen sind `<anon>`. Beträge sind erfunden, Vorzeichen und Null bleiben. Datumsangaben sind verschoben.
- In `buchhaltung-2.0/` hat der Melder die Summen auf ±100.00 gesetzt, auch `discount` und `discountTime`; das sind keine echten Werte.
- In `extf-buchungsstapel.csv` sind Konten und UUIDs gültige Platzhalter statt `x`, damit sie sich wie echte Werte lesen lassen.
