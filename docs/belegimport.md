---
title: "Angebote, Rechnungen und Buchungen übernehmen"
description: >-
  Geprüfte Originalbelege und Buchungen eines anderen Programms per Betreiber-CLI in Haben übernehmen,
  mit Herkunft, Zahlungsständen und belegten EÜR-Zahlungen.
---

# Allgemeiner Belegimport

Der Betreiberimport übernimmt einen vorbereiteten Bestand in die normalen Bereiche **Angebote**, **Rechnungen**, **Buchungen**, **offene Posten** und **EÜR**. Er ergänzt den CSV-Import der Stammdaten und die anbieterbezogenen Umzüge. Er ist kein PDF-Erkennungsdienst: Ein Exportadapter bereitet das JSON-Paket vor; fachliche Zuordnungen müssen vor dem Anwenden geprüft sein.

Die erste Ausbaustufe unterstützt **Einzelunternehmen mit Kleinunternehmerprofil**, Euro und SKR03 oder SKR04. Reguläre Umsatzsteuer, Fremdwährung, importierte Ausgangsgutschriften und Anlagen werden nicht umgedeutet. Eingangsbelege kommen über den bestehenden Belegimport; die Anlagen über den Anlagenimport.

## Originale und Herkunft

Jeder Vorgang hat eine Quelle und eine stabile Kennung innerhalb seiner Art. Die Kennung ist nicht die Belegnummer: Verschiedene Originalangebote oder Originalrechnungen können dieselbe Nummer tragen. Haben erhält sie getrennt, ohne die fremden Originale umzunummerieren. Neue native Belegnummern bleiben gegen Kollisionen mit dem gesamten Bestand geschützt. Eine bereits doppelt vergebene Quellnummer wird dadurch nicht nachträglich zu einer ordnungsgemäßen Nummernvergabe erklärt.

Das Paket enthält nur die jeweils aktuelle Version eines Angebots. Frühere Originale bleiben im Archiv. Der Adapter übernimmt eine bestätigte Versionsgruppe; er führt nicht allein aufgrund gleicher Nummern verschiedene Empfänger zusammen.

Die PDFs werden unverändert übernommen, mit SHA-256 geprüft und beim Import festgeschrieben. Es entstehen weder neue Belegnummern noch neue PDFs oder Versandversuche. Strukturierte Positionen müssen den übernommenen Gesamtbetrag centgenau ergeben. Wenn die Quelle nur einen Gesamtbetrag bietet, kennzeichnet der Adapter eine zusammengefasste Position ausdrücklich; Einzelpositionen bleiben im Original nachlesbar.

Quellakteur, frühere Identitäten und weitere Nachweise gehören in `evidence`. Die Übernahme selbst steht mit dem übergebenen Akteur im Änderungsprotokoll. Importierte Daten und Herkunftszuordnungen sind anschließend unveränderlich. Ein anderer Inhalt mit derselben Kennung wird abgewiesen, statt den ersten Stand zu überschreiben.

Das Jahresarchiv enthält unter `importe/uebernahmen.json` die Herkunft, die Originaldaten, den übernommenen Zahlungsstand und die belegten EÜR-Zahlungen. Maßgeblich ist das Belegjahr; die Nachweise bleiben deshalb auch bei einem späteren Umzug im Archiv des ursprünglichen Jahres erhalten.

## Zahlungsstand, OPOS und EÜR

`settledAmount` ist der übernommene Zahlungsstand einer Rechnung. Er vermindert den offenen Posten, erzeugt aber keinen erfundenen Bankumsatz und keine weitere Zahlung im Journal. Sind Betrag oder Zahlungszeitpunkt nicht ausreichend belegt, steht `paymentUncertain` auf `true`. Haben zeigt den Stand ausdrücklich als übernommen an und weist in der EÜR auf die ungeklärten Anteile hin. Eine ELSTER-Abgabe bleibt damit gesperrt, bis die Angaben geklärt sind. Eine Bezahlt-Bestätigung wird nicht als Banknachweis ausgegeben.

Nur nachgewiesene Zu-/Abflüsse stehen in den `cashFlows` der ursprünglichen Journalbuchung. Jeder Eintrag braucht Datum, Centbetrag, Kategorie und Nachweis. Datum und Geldbewegung müssen zur Buchung passen. Diese Einträge fließen einmalig in die EÜR ein; bloße Bezahlt-Markierungen nicht. Einnahme ist die Kategorie `einnahme`, eine Ausgabe eine vorhandene Ausgabekategorie, mit negativem Betrag. Ausgaben werden im Kleinunternehmerprofil brutto gerechnet; Anlagen sind kein sofortiger Aufwand.

Grundlage des Zufluss-/Abflussprinzips ist [§ 11 EStG](https://www.gesetze-im-internet.de/estg/__11.html). Der Import entscheidet keine unsicheren steuerlichen Zeitpunkte und verteilt auch keine regelmäßig wiederkehrenden Zahlungen eigenständig auf andere Jahre.

Rechnungen und ursprüngliche Journalbuchungen werden getrennt übergeben: Der Import einer Rechnung erzeugt keine zweite Erlösbuchung neben dem bereits übernommenen Journal. Die Journalbuchungen durchlaufen Habens bestehenden Buchungskern einschließlich Jahres-, Kontenrahmen-, Ausgleichs- und Siegelsperren. Storno und Korrektur solcher Originalrechnungen sind vorerst gesperrt: Deren Wirkung muss zuerst mit den fremden Originalbuchungen abgestimmt werden.

## Aufruf

Vorher eine vollständige Sicherung erstellen und den Bestand auf einer getrennten Kopie prüfen. Der Befehl läuft mit den Umgebungsvariablen der Installation, insbesondere `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` und `HABEN_ENCRYPTION_KEY`. Keine Kennwörter in den Befehlsverlauf schreiben.

Im Verzeichnis `apps/web`:

```sh
bun src/server/modules/datenimport/import-cli.ts --paket /migration/bestand.json --originale /migration/originale --akteur migration:mein-programm
bun src/server/modules/datenimport/import-cli.ts --paket /migration/bestand.json --originale /migration/originale --akteur migration:mein-programm --anwenden
```

Der erste Aufruf prüft Struktur und Originalhashes, ohne den Zielbestand zu ändern. Der zweite prüft und übernimmt den Bestand in einer Transaktion. Scheitert ein Datensatz, bleibt das ganze Paket unangewendet. Wiederholte und gleichzeitige Aufrufe legen denselben Bestand nicht erneut an. PDF-Dateien heißen `<sha256>.pdf` und liegen im übergebenen Originalordner.

## Paketformat

Das versionierte Schema steht in [`external-schema.ts`](https://github.com/firsttris/haben/blob/main/apps/web/src/server/modules/datenimport/external-schema.ts). Geld wird in ganzen Cent, Mengen in Tausendsteln übergeben. Alle Datumsfelder sind ISO-Daten; fehlende Fristen müssen vor dem Import geklärt oder ausdrücklich als unbekannte Quellangabe dokumentiert werden. Der Betreiberimport ersetzt keine fachliche Abnahme.

```json
{
  "version": 1,
  "source": "mein-programm",
  "kontenrahmen": "SKR03",
  "entries": [
    {
      "kind": "invoice",
      "externalId": "rechnung-42",
      "number": "10042",
      "date": "2026-01-03",
      "dueDate": "2026-01-17",
      "contactId": null,
      "buyer": { "name": "Beispielkunde", "strasse": "Musterweg 1", "plz": "10115", "ort": "Berlin", "land": "DE" },
      "gross": 100000,
      "settledAmount": 100000,
      "paymentUncertain": true,
      "lines": [{ "description": "Leistung gemäß Original", "quantity": 1000, "unit": "Psch.", "unitPrice": 100000 }],
      "pdfSha256": "ERSETZEN_DURCH_64_KLEINE_HEXZEICHEN"
    }
  ]
}
```

Angebote verwenden `kind: "quote"` und `validUntil`; bei unbekannter Frist ist `validUntil: null` zulässig. Haben zeigt dann „Keine Frist übernommen“ und erklärt das Angebot nicht anhand eines erfundenen Datums für abgelaufen. Neue native Entwürfe verlangen weiterhin eine Frist. Optional ist `decision` mit `angenommen` oder `abgelehnt`. Eine Rechnung kann über `quoteExternalId` auf ein Angebot derselben Quelle zeigen. Buchungen verwenden `kind: "journal"`, `date`, `description`, `lines` aus Konto/Soll/Haben und gegebenenfalls `cashFlows`. Die Erkennung und fachliche Prüfung von Quellformaten bleiben Aufgabe des Adapters, nicht einer neuen Parallelbuchhaltung.
