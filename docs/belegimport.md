---
title: "Geprüfte Bestände über JSON übernehmen"
description: >-
  Originalbelege und Buchungen per Betreiber-CLI in den gemeinsamen Umzugsbestand übernehmen,
  mit Herkunft, Prüflauf und vorhandener OPOS-Weiterverarbeitung.
---

# Gemeinsamer JSON-Eingang für Umzüge

Die Betreiber-CLI übernimmt einen vorbereiteten Bestand in die vorhandenen Umzugsbausteine. Rechnungen und Eingangsbelege stehen zusammen mit Lexoffice- und sevDesk-Belegen unter **Archiv → Belege**, Angebote und andere kaufmännische Originale unter **Archiv → Auftragsdokumente**. Ihre Herkunft nennt das tatsächliche Quellprogramm. Ursprüngliche Buchungen durchlaufen Habens Buchungskern und erscheinen im Journal; Kassenbewegungen stehen zusätzlich im Kassenbuch.

Offene Posten werden anschließend unter **Archiv › Umzug › Offene Posten übernehmen** mit dem bestehenden Ablauf aus Stichtag und Eröffnung übernommen. Dabei bleiben die global eindeutigen nativen Belegnummern erhalten. Eine kollidierende Rechnungsnummer blockiert die native Übernahme; das Original im Umzugsbestand bleibt verfügbar. Verschiedene Originale werden weder allein wegen gleicher Nummern zusammengeführt noch umnummeriert.

Die ausdrücklich übergebene Steuerart bleibt bei dieser Übernahme erhalten und steuert Erlöskonto, Voranmeldung und spätere Zahlungen wie bei einer in Haben geschriebenen Rechnung:

| `taxType` | Behandlung in Haben | Voranmeldung |
| --- | --- | --- |
| `net`, `gross`, `vatfree` | regulär | nach Steuersatz |
| `thirdPartyCountryDelivery` | Ausfuhrlieferung | Kz 43 |
| `thirdPartyCountryService` | Leistung ins Drittland | Kz 45 |
| `intraCommunitySupply` | innergemeinschaftliche Lieferung | Kz 41 |
| `externalService13b` | Reverse Charge, Leistung ins EU-Ausland | Kz 21 |

Für `constructionService13b` (Kz 60), `photovoltaicEquipment` (Kz 87) und OSS-Umsätze hat Haben keine eigene Behandlung; solche offenen Posten werden nicht übernommen und sind von Hand zu erfassen. Eine Leistung ins Drittland wird bei Ist-Versteuerung ebenfalls nicht übernommen: Haben meldet Kz 45 auch bei Ist mit der Rechnung, das Quellprogramm mit der Zahlung, die offene Rechnung stünde sonst in keiner Voranmeldung. Ein Widerspruch zwischen einer steuerfreien Steuerart und ausgewiesener Steuer blockiert die Übernahme, ebenso ein storniertes Original (`status: "voided"`). Original-PDF und Herkunft bleiben in allen Fällen unverändert im Archiv.

Der Eingang unterstützt EUR und den eingestellten Kontenrahmen SKR03 oder SKR04. Er ergänzt die Stammdatenimporte und Anbieteradapter; er erkennt und bewertet keine PDFs selbst. Ein Exportadapter bereitet das normalisierte Paket vor. Die fachliche Prüfung von Herkunft, Stichtag, Kontierung und Zahlungen gehört dazu.

## Prüfen und anwenden

Vorher eine vollständige Sicherung erstellen und den Bestand auf einer getrennten Kopie prüfen. Der Befehl nutzt die Umgebungsvariablen der Installation. Zugangsdaten gehören in die geschützte Betriebskonfiguration, nicht in den Befehlsverlauf.

Im Verzeichnis `apps/web`:

```sh
bun src/server/modules/datenimport/import-cli.ts --paket /migration/bestand.json --originale /migration/originale --akteur migration:quelle
bun src/server/modules/datenimport/import-cli.ts --paket /migration/bestand.json --originale /migration/originale --akteur migration:quelle --anwenden
```

Der erste Aufruf prüft Struktur, Beträge, Buchungsgleichheit und Originalhashes, ohne den Zielbestand zu ändern. Der zweite prüft den Zielbestand und übernimmt das gesamte Paket mit Akteur in einer Transaktion. Fehler rollen die Geschäftsdaten des Pakets zurück. Identische Wiederholungen und gleichzeitige Aufrufe erzeugen keine Duplikate; veränderte Inhalte derselben Quellidentität werden abgewiesen. Kontenrahmen, abgeschlossene Jahre und Siegelsperren gelten auch beim Import.

Originale heißen `<sha256>.pdf`. Ein PDF darf höchstens 20 MiB groß sein, die unterschiedlichen Originale eines Pakets zusammen höchstens 128 MiB. Größere Bestände werden in mehrere Pakete aufgeteilt. Die Originaldateien werden in der vorhandenen, nach ihrem Inhalt adressierten Ablage gespeichert. Bei einem späteren Transaktionsfehler kann dort eine unreferenzierte Datei bleiben; es entsteht dadurch kein Geschäftsdatensatz.

## Originale und unbekannte Angaben

Das Paket enthält die jeweils maßgeblichen Originalstände mit ihren Quellenkennungen. Frühere Versionen können separat im Archiv erhalten bleiben. Ein Angebot mit unbekannter Frist wird als Original mit `validUntil: null` gespeichert; die Pflichtangaben neuer nativer Angebote bleiben erhalten. Eine fehlende Fälligkeit bleibt im Umzugsbestand ebenfalls unbekannt.

Die Herkunftszuordnung ist nur anhängbar und auditiert. Das Jahresarchiv enthält sie nach Belegjahr zusammen mit Originalen und belegten Einzelzahlungen, auch wenn das Jahr erst später importiert wurde. Storno importierter Kassenbewegungen und generisch übernommener Originalrechnungen bleibt bis zur Abstimmung der fremden Originalbuchungen gesperrt.

## Zahlungen, Journal und EÜR

Ein bestätigter Bezahlt-Status und ein Zahlungsnachweis sind unterschiedliche Angaben. Der Quellstand steht am Originalbeleg; belegte Einzelzahlungen liegen im vorhandenen Zahlungsbestand. Betrag, Datum und Nachweis werden einzeln übergeben. Fehlende Nachweise erscheinen als ungeklärt und blockieren eine unsichere Stichtagsübernahme. Ein geschätztes Datum wird nicht zum Zahlungsbeleg. Die Übernahme erzeugt keine Bankumsätze.

Rechnungen werden beim Einlesen nicht erneut ausgestellt und erzeugen keine Erlösbuchung. Vor der späteren Übernahme offener Posten ist zu prüfen, welche Forderungen und Verbindlichkeiten schon durch Originalbuchungen oder eine Eröffnung gedeckt sind. Der vorhandene Umzugsablauf berücksichtigt Eröffnungen; eine beliebige freie Originalbuchung wird nicht stillschweigend als solche interpretiert. Sind freie Originaljournale derselben Quelle vorhanden, bleibt eine zusätzliche native OPOS-Übernahme bis zum Abgleich gesperrt. Umgekehrt wird nach einer nativen OPOS-Übernahme kein freies Originaljournal derselben Quelle ungeprüft nachgebucht. Auch eine fehlende Fälligkeit blockiert die native Weiterübernahme eines generischen Originals.

Die CLI ergänzt keine eigene EÜR-Berechnung. Originalbuchungen stehen im Journal mit der Herkunft „Import“. Ob sie in Voranmeldung und EÜR zählen, hängt vom [Stichjahr](umsatzsteuer.md#wie-die-kennzahlen-entstehen) ab:

- **Vor dem Stichjahr** rechnen Voranmeldung und EÜR aus Rechnungen, Belegen und Zahlungen. Eine importierte Buchung zählt dort nicht, auch wenn sie im Journal steht.
- **Ab dem Stichjahr** zählen importierte Buchungen für die Voranmeldung und die Umsatzsteuererklärung nach Konto und Steuerschlüssel. Das gilt auch für die Monate vor einem Umzug mitten im Jahr. Im Einzelunternehmen zählt eine offene Forderung oder Verbindlichkeit in der EÜR erst mit der zugeordneten Zahlung ([Steuerschlüssel und Kennzahlen](buchhaltung.md#steuerschlüssel-und-kennzahlen), [EÜR](auswertungen.md#eür-nach-zufluss-und-abfluss)). Die Gegenprobe aus Rechnungen, Belegen und Zahlungen kennt Originaljournale nicht; der [Abgleich](buchhaltung.md#abgleich-von-journal-umsatzsteuer-und-eür) zeigt Unterschiede.

Bereits im alten Programm abgegebene Voranmeldungen sind mit ihrem Protokoll über [Abgabe vermerken](umsatzsteuer.md#abgabe-außerhalb-von-haben-vermerken) zu erfassen. Ihr festgeschriebener Stand wird durch einen späteren Import nicht geändert. Eine weitere reguläre Anmeldung desselben Zeitraums ist gesperrt; eine notwendige Berichtigung wird ausdrücklich als neue Anmeldung angelegt. Die Jahreserklärung enthält alle Buchungen des Jahres und berücksichtigt die vermerkten Vorauszahlungen.

Zahlungsbuchungen auf einen offenen Posten erhalten `settles`: die `externalId` der ursprünglichen Journalbuchung derselben Quelle, auch aus einer früheren Importdatei. Jede Zahlungsbuchung gleicht genau einen Posten aus; Sammelzahlungen und zusätzliche Aufwands-/Erlösbuchungen sind dafür aufzuteilen. Teilzahlungen und Rückzahlungen werden anteilig nach den ursprünglichen Konten gerechnet. Ein Zahlungseingang im Folgejahr wirkt erst dort, auch wenn die Rechnung vor dem Stichjahr liegt ([§ 11 EStG](https://www.gesetze-im-internet.de/estg/__11.html)).

Ohne diesen Bezug bleiben Buchungen auf Forderungen und Verbindlichkeiten aus der EÜR heraus; reine Zahlungsbuchungen ohne Bezug nennt der Abgleich als ungeklärt. Weder der Bezahlt-Status eines Originals noch seine Zahlungsnotiz ersetzt die Zuordnung zur Journalbuchung. Bestehende Pakete bleiben lesbar und ihre Herkunftshashes unverändert. Fehlende Bezüge lassen sich nach Prüfung über `settlements` nachpflegen; die Zuordnungen werden separat mit Ersteller protokolliert und sind nur anhängbar. Die CLI verändert dabei keine Originalbuchung und errät keine Zuordnung aus Belegnummern. Das Jahresarchiv enthält die Bezüge unter `importe/zahlungszuordnungen.json`.

Kassenbewegungen auf 1000 (SKR03) beziehungsweise 1600 (SKR04) werden im bestehenden Kassenbuch mit derselben Journalreferenz ergänzt. Der gesamte Tagesbestand wird geprüft; negative Bestände werden abgewiesen. Es entsteht keine zweite Journalbuchung oder zusätzliche Rechnungszahlung.

## Paketformat

Das verbindliche Schema ist `external-schema.ts`. **Version 2** nutzt den gemeinsamen Umzugsbestand. Version 1 des früheren Entwurfs wird abgewiesen; ein bereits installierter Prototyp benötigt einen gesondert geprüften Datenübergang. Geldbeträge sind ganze Cent, Steuersätze Basispunkte, Datumsangaben ISO-Daten. Eine Quellidentität besteht aus `source`, Art und `externalId`; die Belegnummer ist kein Dublettenschlüssel.

```json
{
  "version": 2,
  "source": "Beispielprogramm",
  "kontenrahmen": "SKR03",
  "entries": [{
    "kind": "invoice", "type": "invoice", "direction": "einnahme",
    "externalId": "rechnung-42", "number": "10042",
    "date": "2026-01-03", "dueDate": "2026-01-17",
    "contactId": null, "contactName": "Beispielkunde", "currency": "EUR",
    "net": 100000, "tax": 0, "gross": 100000,
    "taxes": [{ "rate": 0, "net": 100000, "tax": 0 }],
    "taxType": "vatfree", "status": "open", "payment": null,
    "pdfSha256": "0000000000000000000000000000000000000000000000000000000000000000"
  }]
}
```

Die Beispiel-Prüfsumme ist durch den tatsächlichen Hash des PDFs zu ersetzen. Für Rechnungen mit Zahlungseingang enthält `payment` den Quellrestbetrag `openAmount`, ein nur bei vollständig belegtem Ausgleich gesetztes `paidDate` und `items` aus `date`, `amount`, `evidence` und optional `account`. Ein bestätigter Bezahlt-Status ohne Zahlungsnachweis verwendet `status: "paid"`, `openAmount: 0`, `paidDate: null` und leere `items`.

Angebote verwenden `kind: "quote"`, `documentKind` (`AN`, `AB`, `LI`), `status`, `validUntil`, Originalbeträge und PDF-Hash. Positionen, Beziehungen und weitere Quellenangaben stehen in `positions`, `relatedObjects` und `evidence`. Buchungen verwenden `kind: "journal"`, Datum, Beschreibung und Zeilen aus Konto, Soll, Haben sowie gegebenenfalls vorhandenem Steuerschlüssel und Bemessungsgrundlage. Steuerwerte werden aus der Quelle übernommen und nicht rückwirkend geraten.

Beispiel einer Zahlung auf eine zuvor übernommene Journalbuchung `buchung-ar-42` (SKR03, ohne Umsatzsteuer):

```json
{
  "kind": "journal", "externalId": "zahlung-42", "settles": "buchung-ar-42",
  "date": "2026-02-15", "description": "Zahlung Rechnung 10042",
  "lines": [
    { "account": "1200", "debit": 100000, "credit": 0 },
    { "account": "1400", "debit": 0, "credit": 100000 }
  ]
}
```

Für bereits importierte Buchungen bleibt `entries` leer. Zahlung und ursprüngliche OP-Buchung müssen schon unter derselben Quelle vorliegen. Die Anwendung erfolgt mit derselben Betreiber-CLI und `--anwenden`; Wiederholungen erzeugen weder neue Buchungen noch doppelte Zuordnungen. Ein bestätigter Bezug lässt sich nicht durch einen anderen ersetzen.

```json
{
  "version": 2, "source": "Beispielprogramm", "kontenrahmen": "SKR03",
  "entries": [],
  "settlements": [{ "paymentExternalId": "zahlung-42", "originalExternalId": "buchung-ar-42" }]
}
```
