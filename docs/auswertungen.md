# Auswertungen und Jahresexport

Die Seite „Auswertungen“ zeigt dir die Einnahmen-Überschuss-Rechnung (EÜR) eines Jahres, Einnahmen und Ausgaben je Monat und die offenen Posten. Unter „Einstellungen“ lädst du das Jahresarchiv als ZIP für die Aufbewahrung herunter.

<img src="screenshot-auswertungen.png" alt="Seite Auswertungen mit Kennzahlen, Säulendiagramm der Einnahmen und Ausgaben je Monat und der EÜR-Tabelle" width="900">

## Überblick

Oben wählst du das Jahr (Vor- und Folgejahr per Pfeil, dazu alle Jahre mit Bankumsätzen, festgeschriebenen Rechnungen oder gebuchten Belegen). Darunter stehen vier Kennzahlen:

| Kennzahl | Bedeutung |
| --- | --- |
| Einnahmen (netto) | Summe der Monatswerte, ohne Umsatzsteuer; darunter der Bruttowert laut EÜR |
| Ausgaben (netto) | Summe der Monatswerte, ohne Vorsteuer; darunter der Bruttowert laut EÜR mit Vorsteuer und gezahlter Umsatzsteuer |
| Gewinn bzw. Verlust | Betriebseinnahmen minus Betriebsausgaben laut EÜR |
| Offene Forderungen | Summe aller offenen Rechnungen heute, mit Anzahl und Zahl der überfälligen |

## EÜR nach Zufluss und Abfluss

Haben rechnet die EÜR nach § 4 Abs. 3 EStG: Es zählt, wann Geld fließt, nicht wann eine Rechnung geschrieben oder ein Beleg gebucht wurde. Die Berechnung steht in `packages/core/src/euer.ts`, die Daten sammelt `apps/web/src/server/reports.ts`.

### Was zählt

| Quelle | Datum | EÜR-Position |
| --- | --- | --- |
| Zahlungseingang, im Bankabgleich einer Rechnung zugeordnet | Buchungstag des Umsatzes | Einnahmen netto (steuerpflichtig oder steuerfrei) und vereinnahmte Umsatzsteuer |
| Zahlung, im Bankabgleich einem Beleg zugeordnet | Buchungstag des Umsatzes | Ausgabe in der Kategorie des Belegs und gezahlte Vorsteuer |
| Gebuchter Beleg, privat bezahlt | Belegdatum | wie oben |
| Bankumsatz „Umsatzsteuer an das Finanzamt“, Ausgang | Buchungstag | An das Finanzamt gezahlte Umsatzsteuer |
| Bankumsatz „Umsatzsteuer an das Finanzamt“, Eingang | Buchungstag | Vom Finanzamt erstattete Umsatzsteuer |
| Bankumsatz „Kontoführung und Bankgebühren“ | Buchungstag | Ausgabe „Kontoführung und Gebühren“ |

Bei Teilzahlungen teilt Haben die Zahlung im Verhältnis der Rechnung bzw. des Belegs auf Netto und Steuer je Steuersatz auf. Hebst du eine Zuordnung im Bankabgleich auf, hebt die Gegenzeile die ursprüngliche Zahlung in der EÜR genau auf.

### Was nicht zählt

- Bankumsätze, die du noch nicht zugeordnet hast. Ordne vor dem Jahresabschluss alles im [Bankabgleich](bank.md) zu.
- Belege, die noch nicht gebucht sind, und über die Bank zu zahlende Belege ohne zugeordnete Zahlung (die stehen unter „Offene Verbindlichkeiten“).
- Privatentnahmen und -einlagen sowie Geldtransit zwischen eigenen Konten. Sie sind nicht betrieblich.
- Rechnungsentwürfe und Rechnungen ohne Zahlungseingang.

### Bruttomethode

Wie in der Anlage EÜR ist die vereinnahmte Umsatzsteuer eine Betriebseinnahme. Gezahlte Vorsteuer und die an das Finanzamt gezahlte Umsatzsteuer sind Betriebsausgaben, eine Erstattung vom Finanzamt ist wieder Einnahme. Ob du Ist- oder Soll-Versteuerung eingestellt hast, ändert an der EÜR nichts; das betrifft nur die [Umsatzsteuer-Voranmeldung](umsatzsteuer.md).

Die Tabelle „Einnahmen-Überschuss-Rechnung“ zeigt:

- **Betriebseinnahmen:** Umsatzsteuerpflichtige Betriebseinnahmen (netto), Umsatzsteuerfreie und nicht steuerbare Betriebseinnahmen, Vereinnahmte Umsatzsteuer, Vom Finanzamt erstattete Umsatzsteuer
- **Betriebsausgaben:** eine Zeile je Belegkategorie mit Betrag (Software, Hosting, Telefon …), Gezahlte Vorsteuerbeträge, An das Finanzamt gezahlte Umsatzsteuer
- **Gewinn bzw. Verlust**

Belege ohne gültige Kategorie landen unter „Sonstiger Aufwand“. Welche Kategorie auf welches Konto geht, steht in [Buchhaltung in Haben](buchhaltung.md#kontenrahmen).

## Einnahmen und Ausgaben je Monat

Das Säulendiagramm zeigt je Monat die Einnahmen und Ausgaben netto nach Zahlungsdatum, also ohne Umsatzsteuer, Vorsteuer und Zahlungen an oder vom Finanzamt. Bankgebühren zählen zu den Ausgaben. Fährst du mit der Maus über einen Monat oder springst per Tab-Taste hinein, siehst du die Werte. Unter „Als Tabelle anzeigen“ stehen dieselben Zahlen mit Überschuss je Monat und Jahressumme.

## Offene Posten

Die beiden Tabellen am Ende zeigen den Stand von heute, unabhängig vom gewählten Jahr. Sortiert wird nach Fälligkeit.

- **Offene Forderungen:** festgeschriebene Rechnungen und Rechnungskorrekturen, die nicht storniert sind, mit Betrag abzüglich zugeordneter Zahlungen. Eine Korrektur erscheint mit negativem offenem Betrag.
- **Offene Verbindlichkeiten:** gebuchte Belege mit Zahlung „Bank“, abzüglich zugeordneter Zahlungen. Ohne Fälligkeitsdatum gilt das Belegdatum.

Der Status zeigt, wie viele Tage ein Posten überfällig ist oder in wie vielen Tagen er fällig wird. Nummer bzw. Rechnungsnummer führen zur Rechnung oder zum Beleg.

## EÜR als CSV

„EÜR als CSV“ lädt `euer-<Jahr>.csv` über `/api/auswertungen/<Jahr>`. Die Datei hat drei Spalten (`Bereich;Position;Betrag (EUR)`) mit allen Zeilen der Tabelle, den beiden Summen und dem Ergebnis. Format: UTF-8 mit BOM, Semikolon als Trennzeichen, Zeilenende CRLF, Beträge deutsch mit Tausenderpunkt und Dezimalkomma (`1.234,56`). Excel und LibreOffice öffnen sie mit Doppelklick richtig.

## Grenzen

Die Auswertung ist eine Vorschau und ersetzt nicht die Anlage EÜR. Bekannte Lücken:

- Haben gibt keine Zeilennummern der Anlage EÜR aus. Du überträgst die Positionen selbst oder gibst die CSV an deine Steuerberatung.
- Anlagevermögen und Abschreibungen (AfA) bildet Haben nicht ab. Die Kategorie „Hardware“ ist für geringwertige Wirtschaftsgüter bis 800 € netto gedacht und zählt voll im Jahr der Zahlung. Teurere Anschaffungen musst du außerhalb von Haben abschreiben.
- Umsätze zu 0 % landen pauschal unter „Umsatzsteuerfreie und nicht steuerbare Betriebseinnahmen“, ohne weitere Unterscheidung.
- Private Kfz-Nutzung, Arbeitszimmer, Bewirtungsanteile und ähnliche Korrekturen kennt Haben nicht.

> [!NOTE]
> Lass die EÜR vor der Abgabe von deiner Steuerberatung prüfen, besonders im ersten Jahr mit Haben und wenn du Altbestand aus Lexoffice übernommen hast.

## Jahresexport

Unter **Einstellungen → Jahresarchiv** wählst du ein Jahr und lädst mit „ZIP herunterladen“ alles herunter, was Haben zu diesem Jahr gespeichert hat. Zur Auswahl stehen alle Jahre mit Daten, dazu immer das laufende und das vorige Jahr. Die Datei heißt `Haben-<Jahr>-<Datum>.zip` und kommt von `/api/export/<Jahr>`.

Das ZIP wird beim Herunterladen Datei für Datei erzeugt und gestreamt. Auch große Jahre brauchen deshalb kaum Arbeitsspeicher auf dem Server; der Download beginnt sofort, eine Gesamtgröße zeigt der Browser aber nicht an.

### Inhalt

Zugeordnet wird nach Datum: Rechnungen nach Rechnungsdatum, Belege nach Belegdatum (ohne Datum nach Tag des Hochladens), Buchungen nach Buchungsdatum, Bankumsätze nach Buchungstag, Voranmeldungen nach Zeitraum, das Protokoll nach Zeitpunkt der Änderung.

| Pfad | Inhalt |
| --- | --- |
| `LIESMICH.txt` | Firma, Steuernummer, Zeitraum, Erstellungszeitpunkt, Haben-Version, Erklärung aller Ordner, Prüfanleitung und Hinweise zur Aufbewahrung |
| `rechnungen/` | Festgeschriebene Rechnungen, Stornos und Korrekturen als PDF und E-Rechnungs-XML (bei ZUGFeRD steckt das XML zusätzlich im PDF); `rechnungen.csv` mit Beträgen, Format, Zeitpunkt der Festschreibung und SHA-256. Entwürfe fehlen. |
| `belege/` | Alle Belege des Jahres als Originaldatei, Name `Datum_Lieferant_Kurz-ID`; `belege.csv` mit Beträgen je Steuersatz, Kategorie, Zahlung, Status, Quelle der Auslesung, SHA-256 und ursprünglichem Dateinamen |
| `buchungen/journal.csv` | Journal, eine Zeile je Buchungszeile mit Konto, Kontoname, Soll, Haben und Steuerschlüssel; Gegenbuchungen verweisen auf die Ursprungsbuchung |
| `bank/<IBAN>/umsaetze.csv` | Importierte Umsätze je Konto mit zugeordnetem und offenem Betrag |
| `bank/zuordnungen.csv` | Zuordnungen zu Rechnungen, Belegen und Buchungen ohne Beleg; aufgehobene als Gegenzeile |
| `bank/importe.csv` | Importierte Auszugsdateien mit SHA-256, Zeitraum und Salden (die Dateien selbst speichert der Bankimport nicht) |
| `umsatzsteuer/<JJJJ-MM>/` | Je Monat die Voranmeldung als `anmeldung.json` (bei mehreren, etwa berichtigten, `anmeldung-1.json`, `anmeldung-2.json` …), `übermittlungen.csv` und je Prüfung oder Übermittlung das ERiC-Protokoll (PDF) sowie das gesendete und empfangene XML |
| `lexoffice/` | Nur bei übernommenem Altbestand, siehe unten |
| `stammdaten/` | `kontakte.csv` (aktueller Stand), `kontakt-versionen.csv` (alle Versionen), `bankkonten.csv`, `firma.json` |
| `protokoll/audit.csv` | Änderungsprotokoll des Jahres mit altem und neuem Wert als JSON |
| `FEHLER.txt` | Nur wenn eine Datei nicht lesbar war, mit Liste der betroffenen Belege |
| `pruefsummen.sha256` | SHA-256 jeder anderen Datei im Archiv |

Die Stammdaten sind nicht nach Jahr gefiltert, sondern der Stand beim Export.

Der Ordner `lexoffice/` enthält, falls du aus Lexoffice umgezogen bist (siehe [Umzug aus Lexoffice](lexoffice.md)):

| Pfad | Inhalt |
| --- | --- |
| `lexoffice/belege/` | Original-PDFs, E-Rechnungs-XML und Anhänge der Lexoffice-Belege des Jahres |
| `lexoffice/belege.csv` | Je Beleg Art, Richtung, Nummer, Kontakt, Beträge, Status, Zahlungsdatum, Steuersätze und Kategorien als JSON, Dateien mit SHA-256 und Lexoffice-ID |
| `lexoffice/datev-buchungen.csv` | Die Zeilen des DATEV-Buchungsstapels mit Datei und Zeilennummer im Original |
| `lexoffice/originale/<Art>/` | Die unveränderten Originalexporte des Jahres: `datev`, `idea`, `elster`, `kontoauszug`, `sonstiges` |

PDF-, XML- und Bilddateien sind byte-genau die gespeicherten Originale. Fehlt eine Belegdatei im Speicher oder passt ihr Inhalt nicht mehr zum Hash, bricht der Export nicht ab: Die Zeile in `belege.csv` trägt dann „FEHLT“, und `FEHLER.txt` nennt den Beleg.

### CSV-Format

Alle CSV-Dateien im Archiv sind gleich aufgebaut:

- UTF-8 mit BOM, Trennzeichen Semikolon, Zeilenende CRLF
- Beträge in Euro mit Dezimalkomma und ohne Tausenderpunkt (`1234,56`), negative mit Minus
- Datumsangaben als `JJJJ-MM-TT`, Zeitpunkte in UTC nach ISO 8601
- Felder mit Semikolon, Anführungszeichen oder Zeilenumbruch in Anführungszeichen, Anführungszeichen verdoppelt (RFC 4180)
- Wahrheitswerte als `ja` bzw. `nein`

### Prüfsummen prüfen

`pruefsummen.sha256` hat das Format von `sha256sum`. Nach dem Entpacken im Archivordner:

```sh
sha256sum -c pruefsummen.sha256           # Linux
shasum -a 256 -c pruefsummen.sha256       # macOS
```

Unter Windows berechnest du den Hash einzelner Dateien in PowerShell mit `Get-FileHash -Algorithm SHA256 <Datei>` und vergleichst ihn mit der Zeile in `pruefsummen.sha256`.

Zusätzlich stehen in `rechnungen.csv` und `belege.csv` die SHA-256-Werte, die Haben beim Festschreiben bzw. Hochladen berechnet hat. Sie müssen zu den Dateien im Archiv passen; so siehst du, dass sich seitdem nichts verändert hat.

### Keine Geheimnisse im Export

Das ELSTER-Zertifikat und der Lexware-API-Schlüssel sind nie im Archiv. Im Änderungsprotokoll fehlen die verschlüsselten Inhalte, vom Zertifikat stehen nur Dateiname, Ablaufdatum, Status und Hochladezeitpunkt drin. Firmendaten, Kontakte und Bankverbindungen sind dagegen enthalten; behandle das ZIP wie deine Buchhaltung selbst.

### Aufbewahrung

Der Text in `LIESMICH.txt` fasst die Fristen nach § 147 AO und den GoBD so zusammen:

- Bücher und Aufzeichnungen: 10 Jahre
- Buchungsbelege: 8 Jahre (seit 2025)
- Handels- und Geschäftsbriefe: 6 Jahre

Die Frist beginnt mit dem Ende des Kalenderjahrs. Am einfachsten bewahrst du das ganze Archiv 10 Jahre auf, für 2025 also bis mindestens 31.12.2035, unverändert und lesbar, zum Beispiel zusätzlich zum Backup auf einem zweiten Datenträger. Elektronisch empfangene Rechnungen (E-Rechnungen) musst du elektronisch aufbewahren; ein Ausdruck reicht nicht.

> [!IMPORTANT]
> Die Fristen haben sich zuletzt geändert und können für dich abweichen. Kläre mit deiner Steuerberatung, wie lange du was aufbewahren musst, bevor du alte Daten löschst. Das Jahresarchiv ersetzt kein Backup der Datenbank und der Belegdateien (siehe [Installation](installation.md)).

Ein guter Zeitpunkt für den Export ist, wenn das Jahr abgeschlossen ist: alle Umsätze zugeordnet, alle Belege gebucht, die Dezember-Voranmeldung übermittelt. Du kannst den Export jederzeit wiederholen; Änderungen danach, etwa eine berichtigte Voranmeldung, stehen dann im neuen ZIP.
