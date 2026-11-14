---
title: "Umzug aus FastBill ohne Datenverlust"
description: >-
  Von FastBill zu Haben wechseln: Rechnungen, Gutschriften, Stornos, Ausgaben und Kunden über die API
  übernehmen, im unveränderlichen Archiv aufbewahren und das Abo kündigen.
---

# Umzug aus FastBill

Haben übernimmt deinen Bestand aus FastBill, damit du das Abo kündigen kannst, ohne Daten zu verlieren. Der Umzug läuft auf der Seite **Archiv** unter „Umzug“: Wähle oben „Umzug aus FastBill“. Die Schritte sind dieselben wie beim [Umzug aus Lexoffice](lexoffice.md).

Abgerufene Belege landen im selben unveränderlichen Archiv wie die aus Lexoffice und sevDesk. Abgleich je Jahr, offene Posten, die Ansicht **Belege**, die [Kontaktseite](kontakte.md#rechnungen-und-belege-am-kontakt) und der Jahresexport behandeln alle Quellen gleich.

> [!WARNING]
> Der Abruf ist gegen die [API-Dokumentation von FastBill](https://apidocs.fastbill.com/) gebaut und mit nachgestellten Antworten getestet. Form und Felder der Antworten wurden mit einem lesenden Probeabruf an einem echten Konto geprüft (November 2026); ein vollständiger Umzug wurde damit noch nicht getestet. Prüfe nach dem Abruf den Abgleich je Jahr und kündige erst, wenn er für jedes Jahr aufgeht.

## Voraussetzungen

- Die **Login-E-Mail** deines FastBill-Kontos und den **API-Schlüssel** aus den Einstellungen deines Kontos in FastBill. Die API meldet sich mit beiden an (Basic Auth); bei mehreren Benutzern nimm den Zugang des Inhabers.
- Deinen **Tarif**: FastBill erlaubt je Konto und Stunde nur eine bestimmte Zahl von Anfragen, Solo 50, Solo-Plus 100, Pro 500 und Premium 1000 ([Grundlagen der API](https://apidocs.fastbill.com/fastbill/en/fundamentals.html)).
- Firmendaten, Kontenrahmen und Versteuerungsart (Ist oder Soll) sind in Haben eingerichtet, wie in FastBill ([Einrichtung](einrichtung.md)).
- Der Server braucht Zugriff auf `https://my.fastbill.com`.

> [!IMPORTANT]
> Mit E-Mail und API-Schlüssel lassen sich die Daten deines FastBill-Kontos lesen und ändern. Entferne den Zugang nach dem Umzug in Haben (siehe [Vor der Kündigung](#vor-der-kündigung)); das löscht ihn nur in Haben, nicht in FastBill.

## Schritt 1: Verbindung zu FastBill

Trag Login-E-Mail, Tarif und API-Schlüssel ein und klicke „Prüfen und speichern“. Haben ruft damit einen Kunden ab; klappt das, stimmen die Angaben. Der Schlüssel wird wie bei Lexoffice mit AES-256-GCM verschlüsselt gespeichert und taucht weder im Änderungsprotokoll noch im Jahresexport auf. Den Tarif brauchst du, damit Haben die Stundengrenze einhält; stimmt er nicht, wartet der Abruf zu kurz oder unnötig lange.

## Schritt 2: Kontakte, Rechnungen und Belege abrufen

„Alles abrufen“ startet den Abruf im Hintergrund, mit Fortschritt, Abbrechen und Fortsetzen wie bei Lexoffice. Es läuft immer nur ein Abruf, gleich aus welcher Quelle.

1. **Kunden:** Name (Firma oder Person), Adresse, Land, E-Mail, USt-IdNr. und Kundennummer, als Kontakte mit der Rolle Kunde. Gibt es in Haben schon einen Kontakt mit demselben Namen und ohne FastBill-Herkunft, verknüpft Haben ihn. FastBill führt Lieferanten nicht als Kontakte; sie stehen in den Ausgaben nur als Name.
2. **Belegliste:** Ausgangsrechnungen, Gutschriften und stornierte Rechnungen, je Art ein eigener Abruf, dazu die Ausgaben. Entwürfe bleiben draußen.
3. **Dateien:** je Rechnung und Gutschrift das PDF, je Ausgabe der hochgeladene Beleg. Ist an einer Ausgabe kein Beleg hinterlegt, liefert FastBill nichts; der Abgleich zeigt sie als Beleg ohne Datei.

Die Antwort der API wird je Beleg gespeichert, zum Nachweis.

### Dauer und Stundengrenze

Jede Seite mit bis zu 100 Einträgen ist eine Anfrage, die PDFs zählen nicht dazu. Ist die Grenze deines Tarifs erreicht, wartet der Abruf, bis wieder Anfragen frei sind, und zeigt bis wann. Ein neuer Abruf nach einem Abbruch rechnet die Anfragen der letzten Stunde an und überspringt alles, was schon im Archiv liegt.

### Wie FastBill-Belege abgebildet werden

| In FastBill | In Haben |
| --- | --- |
| Rechnung (`TYPE` outgoing) | Rechnung; Abschlagsrechnung (`SUBTYPE` progress_invoice) als Abschlagsrechnung |
| Gutschrift (`TYPE` credit) | Gutschrift, immer negativ |
| Stornierte Rechnung (`STATE` canceled) und ihre Stornogutschrift | beide storniert und ausgeglichen; sie heben sich im Umsatz auf |
| Ausgabe | Eingangsrechnung; mit negativem Betrag Gutschrift des Lieferanten |

Eine Gutschrift gilt nur als Storno, wenn sie auf eine stornierte Rechnung verweist (`REFERENCED_INVOICE_ID`) und deren Betrag voll aufhebt. Eine Teilgutschrift bleibt eine Gutschrift mit eigenem Zahlungsstand.

Die Aufteilung nach Steuersatz kommt aus der Steueraufstellung des Belegs (`VAT_ITEMS`), sonst aus den Positionen. Die Kategorie einer Ausgabe steht an jedem Steuersatz.

### Steuerarten im Abgleich

Die Steuerart einer Rechnung liest Haben aus `VAT_CASE`. FastBill liefert dort entweder 0 oder 1 (innergemeinschaftlich ja oder nein) oder einen Fall aus der [Rechnungs-API](https://apidocs.fastbill.com/fastbill/en/invoice.html):

| `VAT_CASE` | Im Abgleich |
| --- | --- |
| 0, `standard` | regulär |
| 1 bei Rechnungen, `b2b_eu_goods` | innergemeinschaftliche Lieferung (Kz 41) |
| `b2b_eu_services` | sonstige Leistung im übrigen Gemeinschaftsgebiet (Kz 21) |
| `b2b_noneu_goods`, `b2c_noneu_goods` | Ausfuhrlieferung (Kz 43) |
| `b2b_noneu_services` | sonstige Leistung im Drittland (Kz 45) |
| `small_business_regulation` | steuerfrei (Kleinunternehmer) |
| `b2c_eu_goods` | andere: ob der Fernverkauf über OSS lief, steht nicht in der Antwort |

Ausgaben zählen als regulär; eine 1 an einer Ausgabe (innergemeinschaftlicher Erwerb) steht unter „andere“. Vergleiche die Umsatzsteuer je Monat mit FastBill, bevor du kündigst.

### Zahlungen

Die Einzelzahlungen einer Rechnung (`PAYMENTS`) übernimmt Haben mit Datum, Betrag und Zahlungsweg. Ist eine Rechnung nur zum Teil bezahlt, steht sie als teilweise bezahlt mit dem Rest offen. Eine bezahlte und danach stornierte Rechnung zeigt ihre Zahlung weiter an, ist aber ausgeglichen.

### Grenzen des aktuellen Imports

- Angebote, wiederkehrende Rechnungen, Projekte, Zeiten und die Dokumentenablage von FastBill übernimmt Haben nicht. Artikel kommen per [CSV-Import](csv-import.md#artikel).
- Ausgaben haben keinen Kontakt; der Lieferant steht nur als Name am Beleg.

## Schritt 3 bis 5

Offene Posten, Exporte ablegen und Abgleich je Jahr funktionieren wie beim [Umzug aus Lexoffice](lexoffice.md#schritt-3-offene-posten-übernehmen). Unterschiede:

- Die API liefert keine Buchungen und keine Bankumsätze. Lege je Geschäftsjahr den DATEV-Export aus FastBill ab, dazu die ELSTER-Protokolle und die Kontoauszüge.
- Eine offene Rechnung ohne Nummer bekommt in Haben die Nummer `FB-` plus die ID aus FastBill.
- Im Jahresexport stehen die Belege aus FastBill ebenfalls unter `lexoffice/`; die Spalte „Quelle“ in `belege.csv` sagt, woher ein Beleg stammt.

## Andere API-Adresse

Haben spricht standardmäßig mit `https://my.fastbill.com/api/1.0/api.php`. Mit der Umgebungsvariable `FASTBILL_API_URL` setzt du eine andere Adresse, etwa zum Testen gegen einen nachgestellten Server.

## Vor der Kündigung

- [ ] Abruf ist fertig, die Liste der fehlgeschlagenen Belege ist leer
- [ ] Jeder Beleg hat eine Datei (Abgleich je Jahr); Ausgaben ohne Beleg in FastBill geklärt
- [ ] Für jedes Geschäftsjahr: DATEV-Export, ELSTER-Protokolle und Kontoauszüge abgelegt, jeweils mit Jahr
- [ ] Einnahmen, Ausgaben, Umsatz- und Vorsteuer je Jahr mit FastBill verglichen
- [ ] Offene Posten übernommen oder die Gründe geklärt
- [ ] Nächste Rechnungsnummer in Haben gesetzt
- [ ] Jahresexport für jedes übernommene Jahr heruntergeladen
- [ ] Zugang zu FastBill in Haben entfernt (das löscht ihn nur in Haben, nicht in FastBill)
