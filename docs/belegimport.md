---
title: "Geprüfte Bestände über JSON übernehmen"
description: >-
  Originalbelege und Buchungen per Betreiber-CLI in den gemeinsamen Umzugsbestand übernehmen,
  mit Herkunft, Prüflauf und vorhandener OPOS-Weiterverarbeitung.
---

# Gemeinsamer JSON-Eingang für Umzüge

Die Betreiber-CLI übernimmt einen vorbereiteten Bestand in die vorhandenen Umzugsbausteine. Rechnungen und Eingangsbelege stehen zusammen mit Lexoffice- und sevDesk-Belegen unter **Archiv → Belege**, Angebote und andere kaufmännische Originale unter **Archiv → Auftragsdokumente**. Ihre Herkunft nennt das tatsächliche Quellprogramm. Ursprüngliche Buchungen durchlaufen Habens Buchungskern und erscheinen im Journal; Kassenbewegungen stehen zusätzlich im Kassenbuch.

Offene Posten werden anschließend über **Umzug → Offene Posten** und dessen bestehenden Stichtags-/Eröffnungsablauf übernommen. Dabei bleiben die global eindeutigen nativen Belegnummern erhalten. Eine kollidierende Rechnungsnummer blockiert die native Übernahme; das Original im Umzugsbestand bleibt verfügbar. Verschiedene Originale werden weder allein wegen gleicher Nummern zusammengeführt noch umnummeriert.

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

Ein bestätigter Bezahlt-Status und ein Zahlungsnachweis sind unterschiedliche Angaben. Der Quellstand steht am Originalbeleg; belegte Einzelzahlungen liegen im bereits vorhandenen Zahlungsbestand. Betrag, Datum und Nachweis werden einzeln übergeben. Fehlende Nachweise erscheinen als ungeklärt und blockieren eine unsichere Stichtagsübernahme. Ein geschätztes Datum wird nicht zum Zahlungsbeleg. Die Übernahme erzeugt keine Bankumsätze.

Rechnungen werden beim Einlesen nicht erneut ausgestellt und erzeugen keine Erlösbuchung. Vor der späteren Übernahme offener Posten ist zu prüfen, welche Forderungen und Verbindlichkeiten schon durch Originalbuchungen oder eine Eröffnung gedeckt sind. Der vorhandene Umzugsablauf berücksichtigt Eröffnungen; eine beliebige freie Originalbuchung wird nicht stillschweigend als solche interpretiert. Sind freie Originaljournale derselben Quelle vorhanden, bleibt eine zusätzliche native OPOS-Übernahme bis zum Abgleich gesperrt. Umgekehrt wird nach einer nativen OPOS-Übernahme kein freies Originaljournal derselben Quelle ungeprüft nachgebucht. Auch eine fehlende Fälligkeit blockiert die native Weiterübernahme eines generischen Originals.

Die CLI ergänzt keine eigene EÜR-Berechnung. Originaljournal und belegte Zahlungen bleiben für die Projektumstellung [EÜR aus dem Journal (#542)](https://github.com/firsttris/haben/issues/542) erhalten. Die vorhandene Kontenzuordnung und journalbasierte Schattenrechnung dienen dem Abgleich; der spätere verbindliche Umstieg ist ein weiterer Schritt. Deshalb beweist eine sichtbare importierte Journalbuchung allein noch nicht, dass sie in der aktuellen EÜR oder Voranmeldung enthalten ist. Die Auswertungen müssen vor einer steuerlichen Abgabe über die vorhandene Prüfstrecke abgeglichen sein.

Kassenbewegungen auf 1000 (SKR03) beziehungsweise 1600 (SKR04) werden im bestehenden Kassenbuch mit derselben Journalreferenz ergänzt. Der gesamte Tagesbestand wird geprüft; negative Bestände werden abgewiesen. Es entsteht keine zweite Journalbuchung oder zusätzliche Rechnungszahlung.

## Paketformat

Das verbindliche Schema ist `external-schema.ts`. **Version 2** nutzt den gemeinsamen Umzugsbestand. Version 1 des früheren Entwurfs wird ausdrücklich abgewiesen; ein bereits installierter Prototyp benötigt einen gesondert geprüften Datenübergang. Geldbeträge sind ganze Cent, Steuersätze Basispunkte, Datumsangaben ISO-Daten. Eine Quellidentität besteht aus `source`, Art und `externalId`; die Belegnummer ist kein Dublettenschlüssel.

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
