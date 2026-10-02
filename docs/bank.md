# Bankimport und Abgleich

Unter **Bank** importierst du Kontoauszüge als Datei und ordnest jeden Umsatz einer Rechnung, einem Beleg oder einer direkten Buchung zu. Haben schlägt passende offene Posten mit Begründung vor. Jede Zuordnung erzeugt sofort eine festgeschriebene Buchung.

<img src="screenshot-bank.png" alt="Bankabgleich mit Umsatzliste links und rechts dem ausgewählten Zahlungseingang, dem besten Treffer Rechnung 2026-034 und den Gründen Betrag stimmt exakt und Rechnungsnummer im Verwendungszweck" width="900">

## Unterstützte Formate

| Format | Erkennung | Eigene IBAN in der Datei | Salden |
| --- | --- | --- | --- |
| DKB-CSV (aktuelles Format) | Semikolon-CSV mit den Spalten Buchungsdatum, Zahlungspflichtige(r), Zahlungsempfänger(in), Betrag | ja | aus dem Kontostand im Dateikopf |
| DKB-CSV (Export bis 2023) | Semikolon-CSV mit Buchungstag, Auftraggeber/Begünstigter, Betrag | ja | aus dem Dateikopf |
| N26-CSV | Komma-CSV mit Booking Date bzw. Date, Amount, Partner Name bzw. Payee | nein | nein |
| CAMT.053 (XML) | Tagesauszug `BkToCstmrStmt` | ja | Anfangs- und Endsaldo des Auszugs |

Bank und Format erkennt Haben am Inhalt, nicht am Dateinamen. CAMT.052 und CAMT.054 werden mit einer eigenen Meldung abgelehnt; nur der Tagesauszug CAMT.053 wird gelesen.

Die Zeichenkodierung wird ebenfalls erkannt: UTF-8 mit oder ohne BOM, UTF-16 mit BOM, und alles, was kein gültiges UTF-8 ist, als Windows-1252 (ältere DKB-Exporte).

Beim Lesen gilt außerdem:

- Vorgemerkte Umsätze (DKB, CAMT-Status `PDNG`) werden übersprungen; Haben meldet ihre Anzahl.
- CAMT-Sammelbuchungen mit eigenen Einzelbeträgen werden in einzelne Umsätze aufgeteilt. Ergeben die Einzelbeträge nicht den Gesamtbetrag, kommt ein Hinweis.
- Fremdwährungen in der Datei werden gemeldet; Haben bucht nur in Euro.

## So gehst du vor

1. Bei deiner Bank die Umsätze als CSV oder CAMT.053 exportieren.
2. Unter **Bank** auf **CSV / CAMT importieren** klicken und eine oder mehrere Dateien wählen (bis 20 MB je Datei).
3. Haben meldet je Datei „… neue Umsätze für …“ und wie viele schon vorhanden waren, dazu Hinweise und eine eventuelle Lücke.
4. Links die offenen Umsätze durchgehen, rechts zuordnen.

### Konto

Nennt die Datei eine IBAN (DKB, CAMT), legt Haben das Konto beim ersten Import automatisch an und ordnet spätere Importe darüber zu. Als Name dient der Kontoname aus der Datei oder „Konto …“ mit den letzten vier Ziffern der IBAN.

N26-Exporte enthalten keine eigene IBAN. Dafür legst du das Konto vorher mit **Konto hinzufügen** an (Name und IBAN) und wählst es vor dem Import in der Auswahl **Konto** aus. Steht die Auswahl auf „aus der Datei“, lehnt Haben eine Datei ohne IBAN ab.

Wählst du ein Konto aus und die Datei nennt eine andere IBAN, bricht der Import mit einer Meldung ab.

Über der Liste steht je Konto ein Reiter mit Format und Datum des letzten Imports und dem Endsaldo. Ist der letzte Import älter als sieben Tage, ist die Angabe hervorgehoben.

## Was beim Import passiert

### Dubletten

Jeder Umsatz bekommt einen Hash aus Buchungsdatum, Betrag, IBAN der Gegenseite und Verwendungszweck (Leerzeichen und Groß-/Kleinschreibung vereinheitlicht). Dazu kommt ein Zähler für gleiche Umsätze innerhalb derselben Datei: Zwei echte, identische Buchungen am selben Tag bekommen so verschiedene Hashes (Zähler 0 und 1) und werden beide übernommen.

Umsätze, deren Hash es für das Konto schon gibt, überspringt Haben. Du kannst also überlappende Zeiträume oder dieselbe Datei noch einmal importieren, ohne doppelte Umsätze zu bekommen. Während eines Imports ist das Konto gesperrt, damit parallele Importe nichts doppelt anlegen.

### Saldenprüfung

Haben vergleicht den Anfangssaldo der neuen Datei mit dem Endsaldo des vorigen Imports desselben Kontos. Passen sie nicht zusammen und überschneiden sich die Zeiträume nicht, meldet Haben eine Lücke mit Differenz, etwa: „Lücke: Anfangssaldo … passt nicht zum Endsaldo … des vorigen Imports. … vermutlich fehlen Umsätze dazwischen.“ Importiert wird trotzdem.

Bei DKB-CSV leitet Haben die Salden aus dem Kontostand im Dateikopf ab, wenn dessen Datum zum Zeitraum der Umsätze passt. N26-CSV hat keine Salden; dort entfällt die Prüfung.

### Unveränderlichkeit

Importe, Umsätze und Zuordnungen lassen sich nur ergänzen. Datenbank-Trigger lehnen jedes Ändern oder Löschen ab. Ein Fehler wird nicht überschrieben, sondern mit einer Gegenzeile aufgehoben (siehe [Zuordnung aufheben](#zuordnung-aufheben)).

## Umsatzliste

Die Filter **Alle**, **Offen** (mit Anzahl) und **Zugeordnet** schränken die Liste ein, das Suchfeld durchsucht Gegenpartei, Verwendungszweck und Betrag. Angezeigt werden höchstens 500 Umsätze.

| Hinweis | Bedeutung |
| --- | --- |
| Vorschlag | Es gibt einen passenden offenen Posten. |
| Teilweise | Ein Teil des Umsatzes ist zugeordnet. |
| Beleg fehlt | Ausgabe ohne Zuordnung und ohne Vorschlag. |
| Offen | Eingang ohne Zuordnung und ohne Vorschlag. |
| Zugeordnet | Der ganze Betrag ist zugeordnet. |

Der Hinweis „Vorschlag“ in der Liste rechnet wie die Detailansicht, also auch mit der IBAN der Gegenseite.

## Vorschläge

Für den noch offenen Teil eines Umsatzes sucht Haben unter den offenen Posten: festgeschriebene Rechnungen und Rechnungskorrekturen, die nicht storniert und nicht voll bezahlt sind, und gebuchte Belege mit Bezahlung über das Geschäftskonto. Infrage kommen nur Posten in derselben Richtung: Eingänge für Rechnungen, Ausgänge für Belege und Rechnungskorrekturen.

Jeder Posten bekommt Punkte:

| Grund (wie angezeigt) | Punkte |
| --- | ---: |
| Betrag stimmt exakt | 50 |
| Rechnungsnummer im Verwendungszweck | 40 |
| IBAN bekannt vom Kontakt | 30 |
| Name passt | 15 |
| Datum passt (± 5 Tage), nur bei Belegen, gemessen an Beleg- oder Fälligkeitsdatum | 10 |
| Teilbetrag des offenen Betrags | 5 |

Die Rechnungsnummer wird ohne Leer- und Trennzeichen gesucht, `2026-034` findet also auch `2026034`. Beim Namen zählen gemeinsame Wörter ab drei Buchstaben; Rechtsformen wie GmbH, UG oder AG werden ignoriert.

Vorgeschlagen wird ein Posten erst ab 40 Punkten. Ein exakter Betrag reicht allein, ein passender Name allein nicht. Rechts erscheint der beste Treffer als **Bester Treffer** mit allen Gründen; bei Gleichstand gewinnt der ältere Posten.

## Zuordnen

1. Umsatz links anklicken. Ohne Auswahl ist der erste offene Umsatz gewählt.
2. Rechts den **besten Treffer** prüfen, oder mit **Andere Rechnung** einen anderen offenen Posten aus der Auswahl **Rechnung oder Beleg** nehmen.
3. **Betrag** prüfen. Vorbelegt ist der kleinere Wert aus offenem Umsatz und offenem Posten.
4. **Zuordnen** klicken.

Tastatur: **Enter** ordnet zu, solange der Fokus nicht in einem Eingabefeld, auf einem Knopf oder Link liegt. **J** springt zum nächsten, **K** zum vorigen Umsatz.

### Teilzahlungen und mehrere Zuordnungen

Ein Umsatz kann auf mehrere Posten verteilt werden: Betrag verringern, zuordnen, dann für den Rest den nächsten Posten wählen. Rechts steht dann „Noch offen: …“, in der Liste „Teilweise“. Umgekehrt kann eine Rechnung über mehrere Zahlungen bezahlt werden; sie steht bis zum vollen Betrag als „Teilbezahlt“ bzw. „Überfällig“ in der [Rechnungsliste](rechnungen.md#rechnungsliste-und-status).

Haben prüft bei jeder Zuordnung, dass der Betrag das Vorzeichen des Umsatzes hat, nicht größer ist als der offene Teil des Umsatzes und nicht größer als der offene Betrag der Rechnung bzw. des Belegs. Ein Datenbank-Trigger prüft Vorzeichen und Umsatzbetrag ein zweites Mal.

Beim ersten Zahlungseingang auf eine Rechnung merkt sich Haben die IBAN der Gegenseite am Kontakt, wenn dort noch keine steht. Spätere Zahlungen bekommen dadurch den Grund „IBAN bekannt vom Kontakt“.

### Ohne Rechnung buchen

Für Umsätze ohne Rechnung oder Beleg klickst du **Ohne Rechnung buchen**, wählst unter **Buchen als** die Art und klickst **Buchen**.

| Auswahl | Gegenkonto SKR03 | Gegenkonto SKR04 |
| --- | --- | --- |
| Privat (Entnahme oder Einlage) | Ausgang: 1800 Privatentnahmen, Eingang: 1890 Privateinlagen | Ausgang: 2100, Eingang: 2180 |
| Geldtransit (eigenes Konto) | 1360 | 1460 |
| Umsatzsteuer an das Finanzamt | 1780 | 3820 |
| Kontoführung und Bankgebühren | 4970 | 6855 |
| Mahngebühren und Verzugszinsen (vom Kunden) | 2650 | 7100 |

Für Ausgaben mit Rechnung gilt: erst den Beleg unter [Belege](belege.md) hochladen und buchen, dann hier zuordnen. Direkt gebuchte Ausgaben haben keine Vorsteuer.

## Buchungen

Gebucht wird mit dem Buchungsdatum des Bankumsatzes.

**Zahlungseingang auf eine Rechnung**, Beispiel 1.190,00 € auf eine Rechnung zu 19 %:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 1200 Bank | 1800 Bank | 1.190,00 | |
| 1400 Forderungen | 1200 Forderungen | | 1.190,00 |

Bei **Ist-Versteuerung** kommt die Umbuchung der Steuer dazu; erst damit wird sie fällig und erscheint in der [Voranmeldung](umsatzsteuer.md):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 1766 USt nicht fällig 19 % | 3816 USt nicht fällig 19 % | 190,00 | |
| 1776 Umsatzsteuer 19 % | 3806 Umsatzsteuer 19 % | | 190,00 |

Bei Teilzahlungen wird nur der Steueranteil der Zahlung umgebucht, bei mehreren Steuersätzen anteilig je Satz. Rundungsreste schlägt Haben dem größten Posten zu, damit die Summe stimmt.

**Zahlung eines Belegs**, Beispiel 119,00 €:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 1600 Verbindlichkeiten | 3300 Verbindlichkeiten | 119,00 | |
| 1200 Bank | 1800 Bank | | 119,00 |

**Direkte Buchung**, Beispiel Bankgebühr 9,90 €:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 4970 Nebenkosten Geldverkehr | 6855 Nebenkosten Geldverkehr | 9,90 | |
| 1200 Bank | 1800 Bank | | 9,90 |

Bei Eingängen (Privateinlage, Geldtransit, Erstattung vom Finanzamt) steht die Bank im Soll und das Gegenkonto im Haben.

> [!IMPORTANT]
> Die Konten stammen aus `packages/core/src/posting.ts`. Gleiche sie vor dem Echtbetrieb mit deiner Steuerberatung ab.

## Zuordnung aufheben

Unter **Zugeordnet** steht neben jeder Zuordnung **Aufheben**. Haben löscht dabei nichts: Es legt eine Gegenzeile mit umgekehrtem Betrag an und bucht die ursprüngliche Buchung mit vertauschten Seiten zurück („Storno: …“), ebenfalls mit dem Buchungsdatum des Umsatzes. Die aufgehobene Zuordnung bleibt durchgestrichen sichtbar, der Betrag ist wieder offen.

Eine Zuordnung lässt sich nur einmal aufheben.

## Grenzen

- Kein Online-Banking (FinTS, PSD2); Umsätze kommen nur per Datei.
- Nur DKB, N26 und CAMT.053. Andere Banken gehen, wenn sie CAMT.053 exportieren.
- Zuordnungen und ihre Aufhebung werden mit dem Buchungsdatum des Umsatzes gebucht. Hebst du eine Zuordnung in einem Monat auf, dessen Voranmeldung schon gesendet ist, ändern sich dessen berechnete Werte; die gesendete Anmeldung bleibt, wie sie ist, und die Seite des Monats weist auf die Abweichung hin (siehe [umsatzsteuer.md](umsatzsteuer.md)).
