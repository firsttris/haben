---
title: "Bankimport und Abgleich: Umsätze automatisch zuordnen"
description: >-
  Kontoumsätze über Enable Banking abrufen oder als Datei (CAMT oder CSV) importieren und
  Rechnungen, Belegen oder Buchungen zuordnen – mit Vorschlägen.
---

# Bankimport und Abgleich

Unter **Bank** holst du die Umsätze automatisch über Enable Banking ab oder importierst Kontoauszüge als Datei, und ordnest jeden Umsatz einer Rechnung, einem Beleg oder einer direkten Buchung zu. Haben schlägt passende offene Posten mit Begründung vor. Jede Zuordnung erzeugt sofort eine festgeschriebene Buchung.

<img src="screenshot-bank.png#only-light" alt="Bankabgleich mit Umsatzliste links und rechts dem ausgewählten Zahlungseingang, dem besten Treffer Rechnung 2026-034 und den Gründen Betrag stimmt exakt und Rechnungsnummer im Verwendungszweck" width="900">
<img src="screenshot-bank-dunkel.png#only-dark" alt="Bankabgleich mit Umsatzliste links und rechts dem ausgewählten Zahlungseingang, dem besten Treffer Rechnung 2026-034 und den Gründen Betrag stimmt exakt und Rechnungsnummer im Verwendungszweck" width="900">

## Automatischer Abruf

Ist Enable Banking eingerichtet (unter **Einstellungen › Bank**, siehe [Anbindungen](installation-anbindungen.md#kontoabruf-enable-banking)), steht unter **Bank** der Bereich **Automatischer Abruf** mit dem Knopf **Bank verbinden**.

1. **Bank verbinden** klicken, die Bank suchen und auswählen. Gewählt ist die markierte Bank; bleibt nach der Suche nur eine übrig, ist sie schon gewählt. Unter der Liste steht, zu welcher Bank es weitergeht. Bietet die Bank beides an, wählst du Geschäfts- oder Privatkonto; das entscheidet, mit welchem Online-Banking-Zugang du dich gleich anmeldest. Unter **Umsätze abrufen ab** steht der Jahresbeginn; beginnt deine Buchhaltung in Haben später im Jahr, etwa nach einem Umzug, trägst du hier diesen Tag ein (siehe [Welche Umsätze abgerufen werden](#welche-umsätze-abgerufen-werden)).
2. **Weiter zur Bank** führt zur Anmeldeseite deiner Bank. Dort meldest du dich an, bestätigst mit TAN und wählst die Konten aus.
3. Die Bank leitet zurück zu Haben. Haben ordnet die freigegebenen Konten über die IBAN zu, legt fehlende an und holt sofort die ersten Umsätze. Neue Konten heißen nach Bank, Kontoname der Bank und den letzten vier Ziffern der IBAN, z. B. „Finom Geschäftskonto …7890“; die Meldung nach der Rückkehr nennt sie. Name und Zweck legst du danach mit **Name und Zweck** fest (siehe [Konto](#konto)).

Danach ruft Haben jede Verbindung einmal täglich ab, im Hintergrund und ohne dass du angemeldet sein musst. **Jetzt abrufen** holt die Umsätze sofort. Die Konten erscheinen als Reiter, mit „Abruf“ statt „CSV“ und dem Kontostand der Bank.

### Zustimmung

Die Freigabe gilt nach PSD2 höchstens 180 Tage, bei manchen Banken weniger; das Datum steht an der Verbindung. Zwei Wochen vor Ablauf erscheint **Läuft bald ab** und der Knopf **Zustimmung erneuern**. Erneuern heißt: dieselbe Anmeldung bei der Bank noch einmal. Die neue Zustimmung löst die alte ab, und der Abruf macht dort weiter, wo er aufgehört hat. Lehnt die Bank den Zugriff ab, etwa weil du die Freigabe im Online-Banking widerrufen hast, steht die Verbindung auf **Abgelaufen**.

**Trennen** beendet die Zustimmung auch bei Enable Banking. Die schon abgerufenen Umsätze bleiben.

### Welche Umsätze abgerufen werden

- **Neues Konto:** ab dem 1. Januar des laufenden Jahres, oder ab dem Tag, den du unter **Umsätze abrufen ab** selbst einträgst. Manche Banken geben nur etwa 90 Tage zurück; lehnt die Bank den Zeitraum ab, holt Haben die letzten 89 Tage, nie aber Tage vor dem gewählten. Ältere Umsätze dann per Datei importieren.
- **Konto schon per Datei importiert:** Bleibt **Umsätze abrufen ab** auf der Vorgabe, beginnt der erste Abruf am Tag nach dem letzten vorhandenen Umsatz, auch wenn der im Vorjahr liegt. Mit einem selbst eingetragenen Tag gilt das, wenn die vorhandenen Umsätze bis zum Vortag oder darüber hinaus reichen; sonst beginnt der Abruf am eingetragenen Tag. Im Anschluss an vorhandene Umsätze gibt es keinen Rückfall auf die letzten 89 Tage: Lehnt die Bank den Zeitraum ab, meldet Haben einen Fehler, statt still eine Lücke zu lassen. Banken schreiben den Verwendungszweck in der Schnittstelle oft anders als in der CSV; ein überlappender Zeitraum ergäbe sonst doppelte Umsätze.
- **Zustimmung erneuert:** Bei Konten, die schon abgerufen wurden, macht der Abruf dort weiter, wo er aufgehört hat. **Umsätze abrufen ab** gilt nur für Konten, die noch nie abgerufen wurden; ein früher eingetragener Tag bleibt bei den anderen Konten erhalten.
- **Folgeabrufe** beginnen sieben Tage vor dem letzten Abruf. So kommen auch spät gebuchte Umsätze an; Doppelte erkennt Haben am Hash wie beim Dateiimport. Tage, die schon ein Dateiimport abdeckt, ruft Haben auch dabei nicht noch einmal ab: Der Folgeabruf beginnt frühestens am Tag nach dem letzten Umsatz aus einer Datei. Hast du beim Verbinden einen Tag unter **Umsätze abrufen ab** eingetragen, gehen auch Folgeabrufe nie vor diesen Tag zurück.
- **Vorgemerkte Umsätze** übernimmt Haben erst, wenn die Bank sie gebucht hat.
- **Kontostand:** Haben nimmt den gebuchten Saldo der Bank, bevorzugt den Tagesendsaldo (CLBD), sonst den aktuellen gebuchten Saldo (ITBD), und zwar den ersten, dessen Stichtag zum Abruf passt: nicht vor dem letzten Buchungstag, nicht nach dem Ende des Abrufs. Manche Banken melden den Tagesendsaldo nur bis gestern; mit einem Umsatz von heute gilt dann der gebuchte Saldo von heute. Verfügbare Salden mit Vormerkungen oder Kreditlinie übernimmt Haben nie.
- **Konten ohne IBAN**, zum Beispiel Kreditkarten, ruft Haben nicht ab.
- **Konten in Fremdwährung** ruft Haben nicht ab, weil es nur in Euro bucht. Manche Banken führen ein Unterkonto in US-Dollar unter derselben IBAN wie das Euro-Konto; die Meldung nach dem Verbinden nennt sie.

Der Dateiimport bleibt daneben möglich, etwa für ältere Zeiträume. Importierst du für ein abgerufenes Konto eine Datei mit Umsätzen, die schon abgerufen sind, können Doppelte entstehen, wenn die Bank den Verwendungszweck unterschiedlich liefert; Haben meldet den Fall beim Import (siehe [Dubletten](#dubletten)).

Jeder Abruf wird wie eine Datei als Import gespeichert, mit Zeitraum, Kontostand und Prüfsumme der API-Antwort. Die Bank zählt jeden Zugriff ohne dich; deshalb ruft Haben im Hintergrund höchstens einmal in 20 Stunden ab, auch nach einem Fehler.

## Unterstützte Formate

| Format | Erkennung | Eigene IBAN in der Datei | Salden |
| --- | --- | --- | --- |
| DKB-CSV (aktuelles Format) | Semikolon-CSV mit den Spalten Buchungsdatum, Zahlungspflichtige(r), Zahlungsempfänger(in), Betrag | ja | aus dem Kontostand im Dateikopf |
| DKB-CSV (Export bis 2023) | Semikolon-CSV mit Buchungstag, Auftraggeber/Begünstigter, Betrag | ja | aus dem Dateikopf |
| N26-CSV | Komma-CSV mit Booking Date bzw. Date, Amount, Partner Name bzw. Payee | nein | nein |
| Swan-CSV | Komma-CSV mit Kopfblock (IBAN, Alter und Neuer Kontostand, Von, Bis) und den Spalten Datum, Name, Verwendungszweck, Kredit EUR, Debit EUR | ja | Alter und Neuer Kontostand aus dem Kopfblock |
| Commerzbank-CSV | Semikolon-CSV aus dem Online-Banking mit den Spalten Buchungstag, Umsatzart, Buchungstext, Betrag, IBAN Kontoinhaber, Sender, Empfänger, Verwendungszweck | ja, in jeder Zeile | nein |
| C24-CSV | Komma-CSV mit den Spalten Transaktionstyp, Buchungsdatum, Betrag, Zahlungsempfänger, Verwendungszweck, Beschreibung, Kontonummer | nein, nur die Kontonummer | nein |
| CAMT.053 (XML) | Tagesauszug `BkToCstmrStmt` | ja | Anfangs- und Endsaldo des Auszugs |
| PayPal | Aktivitätenexport (CSV), Spalten deutsch (Brutto, Gebühr, Netto, Transaktionscode) oder englisch (Gross, Fee, Net, Transaction ID) | nein, in das Konto des [Zahlungsdienstleisters](bank-zahlungsdienstleister.md) | Guthaben aus den Umsätzen |
| Stripe | Saldenverlauf („Balance history“), alter Export (id, Type, Amount, Fee, Net, Available On) und neuer (balance_transaction_id, gross, fee, net, reporting_category) | nein, wie oben | wie oben |
| Shopify Payments | Transaktionsexport mit Payout ID, Payout Date, Amount, Fee, Net | nein, wie oben | wie oben |
| eBay | Transaktionsbericht (CSV), Spalten deutsch (Datum der Transaktionserstellung, Typ, Nettobetrag, Auszahlung Nr.) oder englisch (Transaction creation date, Type, Net amount, Payout ID) | nein, wie oben | wie oben |
| Etsy | Monatsabrechnung (CSV), Spalten deutsch (Datum, Art, Titel, Info, Betrag, Gebühren & Steuern, Netto) oder englisch (Date, Type, Title, Info, Amount, Fees & Taxes, Net) | nein, wie oben | wie oben |

Bank und Format erkennt Haben am Inhalt, nicht am Dateinamen. CAMT.052 und CAMT.054 werden mit einer eigenen Meldung abgelehnt; nur der Tagesauszug CAMT.053 wird gelesen.

Die Zeichenkodierung wird ebenfalls erkannt: UTF-8 mit oder ohne BOM, UTF-16 mit BOM, und alles, was kein gültiges UTF-8 ist, als Windows-1252 (ältere DKB-Exporte).

Beim Lesen gilt außerdem:

- Vorgemerkte Umsätze (DKB, CAMT-Status `PDNG`) werden übersprungen; Haben meldet ihre Anzahl.
- CAMT-Sammelbuchungen mit eigenen Einzelbeträgen werden in einzelne Umsätze aufgeteilt. Ergeben die Einzelbeträge nicht den Gesamtbetrag, kommt ein Hinweis.
- Commerzbank-CSV: Den Export holst du im Online-Banking bei den Umsätzen über **PDF / CSV**, Format CSV ([Commerzbank-Hilfe](https://www.commerzbank.de/service/wie-kann-ich-meine-umsaetze-exportieren/)). Name der Gegenseite und Verwendungszweck stehen in eigenen Spalten. Die IBAN der Gegenseite nennt der Export nur im Buchungstext, und nur bei Ausgängen, Daueraufträgen und Lastschriften, die du selbst einziehst; Eingänge haben keine: Für die [Vorschläge](#vorschläge) zählen dort Betrag, Rechnungsnummer im Verwendungszweck und Name, und am Kontakt merkt sich Haben keine IBAN. Haben nimmt nur eine IBAN mit gültiger Prüfziffer, nie die eigene, eine Gläubiger-ID oder eine strukturierte Referenz (RF…) aus dem Verwendungszweck. End-to-End-Referenz, Kundenreferenz, Mandatsreferenz und Gläubiger-ID liest Haben aus demselben Text; über die End-to-End-Referenz findet es auch [Überweisungen aus Haben](#überweisungen-aus-haben) wieder. Eine Datei mit Umsätzen mehrerer Konten lehnt Haben ab; exportiere je Konto eine Datei.
- C24-CSV: Der Export (`Transaktionen.csv`) enthält die Umsätze eines Kontos oder einer Pocket. Gegenseite ist in beiden Richtungen die Spalte „Zahlungsempfänger“; der Zweck setzt sich aus Verwendungszweck und Beschreibung zusammen, bei Kartenzahlungen steht dort der Text des Händlers. Die eigene IBAN nennt die Datei nicht, nur die Kontonummer: Lege das Konto vorher an und wähle es beim Import aus (wie bei N26). Umbuchungen zwischen Pockets nennen keine Gegen-IBAN; den [Geldtransit](#vorschläge-ohne-rechnung-und-geldtransit) schlägt Haben dort nicht von selbst vor, du wählst ihn im Abgleich. Eine Datei mit Umsätzen mehrerer Konten lehnt Haben ab; exportiere je Konto bzw. Pocket eine Datei.
- Fremdwährungen in der Datei werden gemeldet; Bankkonten führt Haben nur in Euro. Rechnungen und Belege in Fremdwährung gleichst du mit dem Euro-Betrag aus (siehe [Kursdifferenz](#kursdifferenz-bei-fremdwährung)).

## So gehst du vor

1. Bei deiner Bank die Umsätze als CSV oder CAMT.053 exportieren.
2. Unter **Bank** auf **CSV / CAMT importieren** klicken und eine oder mehrere Dateien wählen (bis 50 Dateien auf einmal, bis 20 MB je Datei).
3. Haben meldet je Datei „… neue Umsätze für …“ und wie viele schon vorhanden waren, dazu Hinweise und eine eventuelle Lücke.
4. Links die offenen Umsätze durchgehen, rechts zuordnen.

### Konto

Nennt die Datei eine IBAN (DKB, CAMT), legt Haben das Konto beim ersten Import automatisch an und ordnet spätere Importe darüber zu. Als Name dient der Kontoname aus der Datei oder „Konto …“ mit den letzten vier Ziffern der IBAN.

### Name und Zweck

Unter den Reitern stehen Name, Zweck und IBAN des gewählten Kontos. Mit **Name und Zweck** änderst du beides, auch für Konten aus dem automatischen Abruf oder dem Dateiimport. Der Name ist nur Anzeige: Umsätze bleiben am Konto, und spätere Importe findet Haben weiter über die IBAN. Die Änderung steht im Änderungsprotokoll.

Viele Selbständige haben bei derselben Bank mehrere Konten, etwa ein Geschäftskonto und ein Steuerkonto, auf das sie die Umsatzsteuer zurücklegen und von dem das Finanzamt per Lastschrift einzieht. Der Zweck sagt Haben, wofür ein Konto dient:

| Zweck | Wirkung |
| --- | --- |
| Geschäftskonto (Standard) | wie bisher; sein Kontostand steht in der Übersicht |
| Steuerkonto | Vorbelegung für [Bankverbindung ändern](finanzamt.md#bankverbindung-ändern); Lastschriften und Erstattungen der Umsatzsteuer auf diesem Konto bekommen „Umsatzsteuer an das Finanzamt“ als Vorschlag; die Übersicht zeigt den Stand neben der noch offenen Zahllast (abzüglich schon zugeordneter Zahlungen an das Finanzamt nach Ende des Zeitraums) und warnt, wenn er nicht reicht |
| Rücklagen- oder Sparkonto | Überträge zu und von eigenen Konten bekommen „Geldtransit“ als Vorschlag |
| Privatkonto (nur zur Zuordnung) | Überweisungen dorthin oder von dort bekommen „Privat“ als Vorschlag. Das Konto legst du mit **Konto hinzufügen** an; Umsätze importierst du nur, wenn du sie buchen willst, etwa eine Umsatzsteuer-Erstattung ([Voranmeldung](#voranmeldung-zahllast-und-erstattung)). |

Jedes Konto hat einen Zweck. Gebucht wird weiter auf das eine Bankkonto (1200 bzw. 1800); welche IBAN auf Rechnungen steht, bestimmen die Firmendaten.

N26-Exporte enthalten keine eigene IBAN. Dafür legst du das Konto vorher mit **Konto hinzufügen** an (Name und IBAN) und wählst es vor dem Import in der Auswahl **Konto** aus. Steht die Auswahl auf „aus der Datei“, lehnt Haben eine Datei ohne IBAN ab.

Wählst du ein Konto aus und die Datei nennt eine andere IBAN, bricht der Import mit einer Meldung ab.

Über der Liste steht je Konto ein Reiter mit Format und Datum des letzten Imports und dem Endsaldo. Ist der letzte Import älter als sieben Tage, ist die Angabe hervorgehoben.

### Fremdes Konto ausschließen

Manchmal gehört ein Konto nicht zu dieser Firma, etwa wenn der Bankzugang auch das Konto einer zweiten Firma freigibt. Löschen geht nicht: Importierte Umsätze sind gesperrt. Stattdessen schließt du das Konto aus: Wähle es und klicke neben **Name und Zweck** auf **Gehört nicht zu dieser Firma**; nach einer Rückfrage ist es erledigt.

Das geht nur, **solange kein Umsatz des Kontos zugeordnet, verrechnet oder ausgebucht ist**, denn dann gehört das Konto zu dieser Firma. Hat das gewählte Konto schon eine Zuordnung, ist der Knopf gesperrt und nennt den Grund. Ein Zahlungsdienstleister lässt sich nicht ausschließen.

Ein ausgeschlossenes Konto:

- steht nicht mehr unter den Reitern und fehlt in Bankabgleich, Vorschlägen, Übersicht, Überweisungen und Lastschriften, in der Vorprüfung der Voranmeldung, in der Jahresauswahl und im [Jahresarchiv](auswertungen.md#jahresexport);
- wird beim automatischen Abruf übersprungen; die Verbindung selbst läuft für die anderen Konten weiter;
- nimmt keinen Import an: Eine Datei mit seiner IBAN oder mit diesem Konto als Ziel lehnt Haben mit einer Meldung ab.

Gelöscht wird nichts. Die Umsätze bleiben in der Datenbank, und der Schritt steht im [Änderungsprotokoll](buchhaltung.md#änderungsprotokoll). Unter **Ausgeschlossene Konten** am Ende der Seite siehst du die ausgeschlossenen Konten mit der Zahl ihrer Umsätze und nimmst ein Konto mit **… wieder aufnehmen** (mit dem Namen des Kontos) zurück; dann ist alles wie vorher da.

## Was beim Import passiert

### Dubletten

Jeder Umsatz bekommt einen Hash aus Buchungsdatum, Betrag, IBAN der Gegenseite und Verwendungszweck (Leerzeichen und Groß-/Kleinschreibung vereinheitlicht). Dazu kommt ein Zähler für gleiche Umsätze innerhalb derselben Datei: Zwei echte, identische Buchungen am selben Tag bekommen so verschiedene Hashes (Zähler 0 und 1) und werden beide übernommen.

Umsätze, deren Hash es für das Konto schon gibt, überspringt Haben. Du kannst also überlappende Zeiträume oder dieselbe Datei noch einmal importieren, ohne doppelte Umsätze zu bekommen. Während eines Imports ist das Konto gesperrt, damit parallele Importe nichts doppelt anlegen.

Die Prüfung gilt innerhalb einer Quelle. Sie erkennt nicht, dass dieselbe Zahlung aus zwei Quellen stammt: Der Abruf und die Datei derselben Bank schreiben den Verwendungszweck oft anders, und manche Exporte nennen das Zahlungs- statt des Buchungsdatums, ein bis drei Tage daneben. Ein Konto bekommt seine Umsätze deshalb aus einer Quelle. Wer die Quelle wechselt, importiert ab dem Tag nach dem letzten vorhandenen Umsatz; der [Abruf](#welche-umsätze-abgerufen-werden) beginnt nach einem Dateiimport von selbst dort.

Liegen im Zeitraum einer neuen Datei schon Umsätze aus einem anderen Format oder aus dem Abruf (altes und neues CSV der DKB zählen als ein Format) und legt der Import trotzdem Umsätze neu an, meldet Haben das neben der Meldung zur Lücke, mit Zeitraum, Quelle und Anzahl. Importiert wird trotzdem. Unscharf über Betrag und Datum verglichen wird bewusst nicht, sonst blieben echte gleiche Zahlungen an Folgetagen unbemerkt.

### Saldenprüfung

Haben vergleicht den Anfangssaldo der neuen Datei mit dem Endsaldo des vorigen Imports desselben Kontos. Passen sie nicht zusammen und überschneiden sich die Zeiträume nicht, meldet Haben eine Lücke mit Differenz, etwa: „Lücke: Anfangssaldo … passt nicht zum Endsaldo … des vorigen Imports. … vermutlich fehlen Umsätze dazwischen.“ Importiert wird trotzdem.

Bei DKB-CSV leitet Haben die Salden aus dem Kontostand im Dateikopf ab, wenn dessen Datum zum Zeitraum der Umsätze passt. Swan-CSV nennt beide Salden im Kopfblock. N26-, Commerzbank- und C24-CSV haben keine Salden; dort entfällt die Prüfung.

### Unveränderlichkeit

Importe, Umsätze, Zuordnungen und [Verrechnungen](#gegenläufige-umsätze-verrechnen) lassen sich nur ergänzen. Datenbank-Trigger lehnen jedes Ändern oder Löschen ab. Ein Fehler wird nicht überschrieben, sondern mit einer Gegenzeile aufgehoben (siehe [Zuordnung aufheben](#zuordnung-aufheben)).

## Umsatzliste

Die Filter **Alle**, **Offen** (mit Anzahl) und **Zugeordnet** (auch verrechnete Umsätze) schränken die Liste ein, das Suchfeld durchsucht Gegenpartei, Verwendungszweck und Betrag. Angezeigt werden höchstens 500 Umsätze.

Die Spaltenköpfe Datum, Gegenpartei · Verwendungszweck, Betrag und Status sortieren die Liste. Der erste Klick sortiert absteigend, ein zweiter Klick auf denselben Kopf dreht die Richtung; der aktive Kopf zeigt einen Pfeil. Ohne Auswahl steht der neueste Umsatz oben. Am Handy sind Datum und Status ausgeblendet, dort sortieren Gegenpartei und Betrag.

Nach Datum, Gegenpartei und Betrag sortiert Haben alle Umsätze des Kontos, die zu Filter und Suche passen, und zeigt davon die ersten 500: „Betrag absteigend“ zeigt also die größten Beträge, auch wenn sie Jahre zurückliegen. Umsätze ohne Gegenpartei stehen beim Sortieren nach Gegenpartei unten. Den Status bestimmt Haben erst beim Anzeigen; nach Status sortiert es deshalb die neuesten 500 Umsätze. Absteigend steht oben, was zu tun ist, in der Reihenfolge „Beleg fehlt“, „Vorschlag“, „Offen“, „Teilweise“, „Zugeordnet“, zuletzt „Verrechnet“.

| Hinweis | Bedeutung |
| --- | --- |
| Vorschlag | Es gibt einen passenden offenen Posten. |
| Teilweise | Ein Teil des Umsatzes ist zugeordnet. |
| Beleg fehlt | Ausgabe ohne Zuordnung und ohne Vorschlag. |
| Offen | Eingang ohne Zuordnung und ohne Vorschlag. |
| Zugeordnet | Der ganze Betrag ist zugeordnet. |
| Verrechnet | Mit einem gegenläufigen Umsatz verrechnet, ohne Buchung (siehe [Gegenläufige Umsätze verrechnen](#gegenläufige-umsätze-verrechnen)). |

Der Hinweis „Vorschlag“ in der Liste rechnet wie die Detailansicht, also auch mit der IBAN der Gegenseite.

## Vorschläge

Für den noch offenen Teil eines Umsatzes sucht Haben unter den offenen Posten: festgeschriebene Rechnungen und Rechnungskorrekturen, die nicht storniert und nicht voll bezahlt sind, gebuchte, nicht stornierte Belege mit Bezahlung über das Geschäftskonto und die Zahllast bzw. Erstattung abgegebener Voranmeldungen (siehe [Voranmeldung](#voranmeldung-zahllast-und-erstattung)). Infrage kommen nur Posten in derselben Richtung: Eingänge für Rechnungen, Ausgänge für Belege und Rechnungskorrekturen.

Jeder Posten bekommt Punkte:

| Grund (wie angezeigt) | Punkte |
| --- | ---: |
| Betrag stimmt exakt | 50 |
| Betrag stimmt mit … Skonto (…), in der Frist (siehe [Skonto auf eigene Rechnungen](#skonto-auf-eigene-rechnungen)) | 50 |
| Betrag passt bis auf eine Kursdifferenz (…), nur bei Fremdwährung (siehe [Kursdifferenz](#kursdifferenz-bei-fremdwährung)) | 30 |
| Rechnungsnummer im Verwendungszweck | 40 |
| Bestellnummer im Verwendungszweck, nur bei exaktem Betrag (siehe unten) | 60 |
| Überweisung aus Haben (Referenz), nur bei Belegen | 60 |
| IBAN bekannt vom Kontakt bzw. bei Belegen IBAN des Lieferanten | 30 |
| Name passt | 15 |
| Datum passt (± 5 Tage), nur bei Belegen, gemessen an Beleg- oder Fälligkeitsdatum | 10 |
| Teilbetrag des offenen Betrags | 5 |

**Bestellnummer:** Zahlungsdienstleister wie Etsy nennen im Umsatz die Bestellnummer der Plattform statt deiner Rechnungsnummer (`Payment for Order #1234567890`). Steht dieselbe Nummer als externe Referenz, Bestellnummer des Kunden oder eigene Auftragsnummer an einer Rechnung, einer Korrektur oder einem Storno (etwa über die REST-API angelegt), zählt sie 60 Punkte. Das gilt nur, wenn auch der Betrag exakt stimmt: Gebühren, Gebühren-Gutschriften und der Karteneinzug bei einer Erstattung nennen dieselbe Bestellnummer, gehören aber nicht zur Rechnung. Nummern unter fünf Zeichen und Nummern, die nur der Anfang einer anderen sind, zählen nicht. Bei mehreren Rechnungen mit gleichem Betrag entscheidet so die Bestellnummer, eine Erstattung findet das Storno derselben Bestellung. Bei einer Fremdwährung (Kursdifferenz) und bei Skonto zählt die Nummer nicht, weil der Betrag dann nicht exakt stimmt. Wie alle Gründe ist es nur ein Vorschlag: Du ordnest weiterhin selbst zu, auch wenn eine freie Bestellnummer des Kunden zufällig mit einer Nummer im Verwendungszweck übereinstimmt.

Die Rechnungsnummer wird ohne Leer- und Trennzeichen gesucht, `2026-034` findet also auch `2026034`. Beim Namen zählen gemeinsame Wörter ab drei Buchstaben; Rechtsformen wie GmbH, UG oder AG werden ignoriert.

Die IBAN des Lieferanten eines Belegs kennt Haben aus dem Kontakt, aus der E-Rechnung (BT-84) und aus einer [SEPA-Überweisung](belege-bezahlen.md#überweisen-sepa-datei) für diesen Beleg. Die IBAN aus der E-Rechnung zählt dabei nach derselben Regel wie für die SEPA-Datei ([Abweichende IBAN in der E-Rechnung](belege-bezahlen.md#abweichende-iban-in-der-e-rechnung)): nur, wenn sie der IBAN im Kontakt entspricht, am Beleg **IBAN der E-Rechnung nur für diesen Beleg** gewählt ist oder sie bei einem Kontakt ohne IBAN übernommen wurde. Solange am Beleg nichts entschieden ist oder **IBAN des Kontakts behalten** gewählt ist, bringt eine Zahlung an die IBAN aus der E-Rechnung keine Punkte für die IBAN; eine ausgetauschte Bankverbindung soll nicht vertrauenswürdig aussehen. Der Vorschlag kommt dann über Betrag, Rechnungsnummer und Name zustande. Die IBAN im Kontakt und die IBANs erzeugter SEPA-Überweisungen zählen immer.

Vorgeschlagen wird ein Posten erst ab 40 Punkten. Ein exakter Betrag reicht allein, ein passender Name allein nicht. Rechts erscheint der beste Treffer als **Bester Treffer** mit allen Gründen; bei Gleichstand gewinnt der ältere Posten.

### Voranmeldung: Zahllast und Erstattung

Jede gesendete oder [vermerkte](umsatzsteuer.md#abgabe-außerhalb-von-haben-vermerken) Voranmeldung ist ein offener Posten, die Zahllast als Ausgang, ein Überschuss als Eingang ([Zahlung an das Finanzamt](umsatzsteuer.md#zahlung-an-das-finanzamt)). Vorgeschlagen wird sie nur, wenn die Gegenpartei das Finanzamt ist (Finanzamt, Finanzkasse, Landeshauptkasse …) oder der Verwendungszweck die Umsatzsteuer nennt, und nie, wenn er eine andere Steuer oder die Sondervorauszahlung nennt. Punkte:

| Grund (wie angezeigt) | Punkte |
| --- | ---: |
| Betrag stimmt exakt | 50 |
| Zahllast und … Säumniszuschlag (§ 240 AO, … Monate): der Umsatz ist um genau den Säumniszuschlag höher; zugeordnet wird nur die Zahllast | 40 |
| Zeitraum im Verwendungszweck („USt 10/26“, „10.2026“, „Okt. 2026“, „Q3/26“, „3. VJ 2026“, „III/26“; ein Datum wie „05.10.26“ zählt nicht) | 40 |
| Finanzamt als Gegenpartei | 15 |
| Teilbetrag des offenen Betrags | 5 |

Wie bei Rechnungen ab 40 Punkten. Zwei Zeiträume mit gleicher Zahllast unterscheidet der Zeitraum im Verwendungszweck. Gebucht wird wie „Umsatzsteuer an das Finanzamt“ (SKR03 1780, SKR04 3820), mit dem Bezug auf die Voranmeldung; in der Liste der Zuordnungen steht er dahinter, etwa „Umsatzsteuer USt 10/2026“. In der EÜR zählt die Zahlung am Buchungstag; die Vorauszahlung für Dezember bzw. das vierte Quartal, gezahlt bis 10. Januar, ohne Dauerfristverlängerung im Vorjahr (§ 11 Abs. 2 Satz 2 EStG, [Vorauszahlung um den Jahreswechsel](auswertungen.md#umsatzsteuer-vorauszahlung-um-den-jahreswechsel)).

Liegt der Umsatz auf einem Konto mit dem Zweck **privat**, bucht Haben die Gegenzeile nicht gegen die Bank, sondern gegen die Privatentnahme (SKR03 1800, SKR04 2100), in GmbH und UG gegen das Gesellschafter-Verrechnungskonto; eine Zahlung an das Finanzamt von dort wird zur Einlage (SKR03 1890, SKR04 2180, in GmbH und UG dasselbe Verrechnungskonto). Das Geld fließt ins Private, die Forderung bzw. Verbindlichkeit gegenüber dem Finanzamt wird trotzdem erfüllt; die Entnahme steht in § 4 Abs. 1 Satz 2 EStG, die Einlage in Satz 8 (beides im Einzelunternehmen; in GmbH und UG trägt § 4 EStG die Buchung nicht). Ohne diese Unterscheidung stünde die Erstattung auf dem Geschäftskonto, auf dem sie nie war. Das gilt auch für die Umsatzsteuer des Vorjahres als [Steuerzahlung](bank-steuern-darlehen.md#steuerzahlungen).

### Dauerbelege: noch zu prüfen

Belege aus einem [Dauerbeleg](belege.md#dauerbelege) (Miete, Versicherung, Leasing) entstehen ungebucht mit dem Status „Zu prüfen“ und sind deshalb noch kein offener Posten. Damit die Abbuchung trotzdem ihren Beleg findet, sucht Haben für einen Ausgang auch unter diesen Belegen, wenn sie über das Geschäftskonto bezahlt werden, mit denselben Punkten wie oben. Gezeigt werden nur Treffer, deren Betrag genau zum Umsatz passt, unter **Dauerbeleg, noch zu prüfen**:

- **Buchen und zuordnen** bucht den Beleg wie **Bestätigen und buchen** auf der Belegseite (Aufwand und Vorsteuer an Verbindlichkeiten, mit Belegdatum) und ordnet ihm in derselben Transaktion den Umsatz zu (Verbindlichkeiten an Bank). Fehlt dem Beleg etwas zum Buchen oder passt die Zuordnung nicht (etwa weil der Umsatz inzwischen zugeordnet ist), steht der Grund im Feld, und nichts ist gebucht.
- **Beleg prüfen** öffnet den Beleg; nach dem Buchen erscheint er hier als gewöhnlicher Vorschlag.

Haben bucht einen Dauerbeleg nie von selbst, auch nicht bei einem eindeutigen Treffer.

### Überweisungen aus Haben

Jede Überweisung einer [SEPA-Datei aus Haben](belege-bezahlen.md#überweisen-sepa-datei) trägt eine eigene Referenz (EndToEndId, `HABEN-` und 16 Hex-Ziffern). Taucht sie in der Abbuchung wieder auf, schlägt Haben den Beleg mit „Überweisung aus Haben (HABEN-…)“ vor, auch wenn der Betrag nach Skonto nicht mehr stimmt oder die Bank den Verwendungszweck kürzt. Gesucht wird die Referenz:

- in der EndToEndId des Umsatzes (CAMT.053: `Refs/EndToEndId`; Haben speichert sie, auch wenn die Bank eine eigene Referenz mitliefert),
- in der Referenz der Bank (DKB: Spalte „Kundenreferenz“),
- im Verwendungszweck, unabhängig von Leer- und Trennzeichen (manche Exporte schreiben `EREF: HABEN-…` dort hinein).

Zugeordnet wird wie immer erst mit **Zuordnen**. Wurde mit Skonto überwiesen, bleibt danach der Skontobetrag offen; ihn buchst du mit **Rest … als erhaltenes Skonto** aus.

### Lastschriften aus Haben

Für Rechnungen mit Zahlungsart [Lastschrift](rechnungen-zahlung.md#lastschrift) erzeugt Haben eine [Sammeldatei](rechnungen-zahlung.md#sammeldatei-für-die-bank). Jede Lastschrift darin trägt eine eigene Referenz (EndToEndId, `HABEN-…`), jeder Sammler eine Kennung (PmtInfId).

**Sammelgutschrift.** Die Bank schreibt jeden Sammler als eine Summe gut. Liefert der Auszug Einzelangaben (CAMT.053 mit `TxDtls`), zerlegt der Import die Summe schon in Einzelumsätze; jeder findet seine Rechnung über die Referenz wie unter [Überweisungen aus Haben](#überweisungen-aus-haben). Bleibt es eine Summe (etwa im CSV-Export der DKB), erkennt Haben sie am Betrag: Ergeben die noch nicht gutgeschriebenen Lastschriften eines Sammlers, oder alle Sammler desselben Einzugstags aus einer Datei, genau den Betrag, und liegt die Buchung zwischen einem Tag vor und 30 Tagen nach dem Einzugstag, steht rechts **Sammler einer Lastschriftdatei** mit den Rechnungen. **Auf … Rechnungen aufteilen** bucht jede Rechnung mit ihrem Betrag als Zahlung, als [Aufteilung](#aufteilen-splitbuchung).

**Rücklastschrift.** Gibt die Bank des Kunden eine Lastschrift zurück (etwa mangels Deckung oder nach einem Widerspruch innerhalb von acht Wochen), bucht deine Bank den Betrag zurück, oft mit einem Entgelt. Haben erkennt die Rückgabe an der Referenz der Lastschrift oder an einem Rückgabetext (RETURN, REJECT, REFUND, Rücklastschrift) zusammen mit „Rechnung …“ oder der Mandatsreferenz, und nur bei einer schon gutgeschriebenen Lastschrift. Passt mehr als eine Lastschrift (etwa nur die Mandatsreferenz bei mehreren Einzügen auf dasselbe Mandat), schlägt Haben nichts vor; dann ordnest du von Hand zu. Rechts steht dann **Rücklastschrift** mit Rechnung, Grund und Entgelt. Die Gründe stammen aus der Rückgabe (Anlage 3 des DFÜ-Abkommens, Kap. 7.1.7.12, `Rsn/Cd`), etwa AM04 „Rückgabe mangels Deckung“, AC04 „Konto aufgelöst“, MD01 „Kein gültiges Mandat“, MS02 „Rückgabe durch den Zahler“, MD06 „Erstattung auf Verlangen des Zahlers“ (Texte aus Anlage 3, Kap. 2.2.3.10.3, und EPC173-14 v8.1).

**Rechnung wieder öffnen** bucht den Betrag als negative Zahlung auf die Rechnung und das Entgelt als Kontoführung und Bankgebühren; beides ist eine Aufteilung und lässt sich nur zusammen aufheben. Die Sammelgutschrift davor hebst du erst auf, wenn die Rücklastschrift aufgehoben ist; sonst stünde die Rechnung doppelt offen. Die Steuerbehandlung bleibt die des Rechnungsjahres, auch nach einem [Wechsel zwischen Ist und Soll](buchhaltung.md#ist--und-soll-versteuerung): Eine vorher nach Soll versteuerte Rechnung ändert durch die Rücklastschrift und erneute Zahlung allein keine Umsatzsteuer. Bei einer vorher nach Ist versteuerten Rechnung mindert die Rücklastschrift die Steuer; die erneute Zahlung meldet sie wieder. Eine tatsächliche Uneinbringlichkeit wird gesondert als Forderungsausfall behandelt ([§ 17 UStG](https://www.gesetze-im-internet.de/ustg_1980/__17.html)). Auch Skonto und Barzahlungen behalten das Verfahren der Rechnung. Beim Aufheben einer Zuordnung wird ihre ursprüngliche Buchung mit unveränderter Steuerbehandlung gegengebucht.

Die Rechnung ist wieder offen und steht unter **Lastschriften** zum erneuten Einzug (jetzt als Folgelastschrift), solange das Mandat gilt. Die Rückgabe zählt für den Verfall des Mandats wie ein Einzug (Rulebook Kap. 4.2: „even if rejected, returned or refunded“). Ob du das Entgelt beim Kunden einforderst, entscheidest du; dafür gibt es die [Mahnung](rechnungen-zahlung.md#mahnwesen) mit Gebühr.

## Zuordnen

1. Umsatz links anklicken. Ohne Auswahl ist der erste offene Umsatz gewählt.
2. Rechts den **besten Treffer** prüfen, oder mit **Andere Rechnung** einen anderen offenen Posten aus der Auswahl **Rechnung, Beleg oder Voranmeldung** nehmen.
3. **Betrag** prüfen. Vorbelegt ist der kleinere Wert aus offenem Umsatz und offenem Posten.
4. **Zuordnen** klicken. Ist der Umsatz damit ganz zugeordnet, springt die Auswahl zum nächsten offenen Umsatz, am Ende der Liste wieder von vorn.

Tastatur: **Enter** ordnet zu, solange der Fokus nicht in einem Eingabefeld, auf einem Knopf oder Link liegt. **J** springt zum nächsten, **K** zum vorigen Umsatz.

### Teilzahlungen und mehrere Zuordnungen

Ein Umsatz kann auf mehrere Posten verteilt werden: Betrag verringern, zuordnen, dann für den Rest den nächsten Posten wählen. Rechts steht dann „Noch offen: …“, in der Liste „Teilweise“. Umgekehrt kann eine Rechnung über mehrere Zahlungen bezahlt werden; sie steht bis zum vollen Betrag als „Teilbezahlt“ bzw. „Überfällig“ in der [Rechnungsliste](rechnungen.md#rechnungsliste-und-status).

Haben prüft bei jeder Zuordnung, dass der Betrag das Vorzeichen des Umsatzes hat, nicht größer ist als der offene Teil des Umsatzes und nicht größer als der offene Betrag der Rechnung bzw. des Belegs. Ein Datenbank-Trigger prüft Vorzeichen und Umsatzbetrag ein zweites Mal, und zwar am Ende der Transaktion, damit er bei einer [Aufteilung](#aufteilen-splitbuchung) alle Teile zusammen sieht.

Beim ersten Zahlungseingang auf eine Rechnung merkt sich Haben die IBAN der Gegenseite am Kontakt, wenn dort noch keine steht. Spätere Zahlungen bekommen dadurch den Grund „IBAN bekannt vom Kontakt“.

### Aufteilen (Splitbuchung)

Zahlungsdienstleister wie PayPal, Stripe, Shopify Payments oder Etsy zahlen selten den Rechnungsbetrag aus: Sie behalten ihre Gebühr ein. Steuerlich gilt trotzdem das Bruttoprinzip: Die Rechnung ist voll bezahlt (voller Erlös, bei Ist-Versteuerung die volle Umsatzsteuer), die Gebühr ist eine Ausgabe. Dafür teilst du den Umsatz auf.

**Rest als Gebühr:** Ist die gewählte Rechnung höher als der offene Umsatz, erscheint der Knopf **Voll zuordnen, Rest … als Gebühr**. Er ordnet die Rechnung mit ihrem vollen offenen Betrag zu und bucht die Differenz als Kontoführung und Bankgebühren (Nebenkosten des Geldverkehrs, 4970 bzw. 6855).

Beispiel: Rechnung über 4.760,00 €, PayPal zahlt 4.700,00 € aus.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 1200 Bank | 1800 Bank | 4.760,00 | |
| 1400 Forderungen | 1200 Forderungen | | 4.760,00 |
| 4970 Nebenkosten des Geldverkehrs | 6855 Nebenkosten des Geldverkehrs | 60,00 | |
| 1200 Bank | 1800 Bank | | 60,00 |

Auf der Bank bleiben 4.700,00 €, die Rechnung steht auf „Bezahlt“. Bei Ist-Versteuerung kommt wie bei jedem Zahlungseingang die Umbuchung der Umsatzsteuer auf den vollen Rechnungsbetrag dazu (siehe [Buchungen](#buchungen)).

**Frei aufteilen:** Mit **Aufteilen** verteilst du den offenen Teil eines Umsatzes auf beliebig viele Teile. Jeder Teil hat ein Ziel (Rechnung, gebuchter Beleg oder eine Art aus **Direkt buchen**) und einen Betrag mit dem Vorzeichen, mit dem er das Konto bewegt: Zahlungseingänge positiv, Gebühren und Ausgänge negativ. Zur Auswahl stehen auch Posten in Gegenrichtung, etwa ein gebuchter Gebührenbeleg des Dienstleisters in einer Auszahlung; so laufen Vorsteuer bzw. § 13b über den Beleg. **Aufteilen und buchen** ist erst möglich, wenn die Teile zusammen genau den offenen Betrag ergeben. Jeder Teil wird einzeln gebucht, alle in einem Schritt.

Teile einer Aufteilung hebst du nur gemeinsam auf (**Aufteilung aufheben**): Allein ergäbe ein Teil nicht mehr den Umsatz, etwa bliebe die Gebühr ohne den Erlös stehen.

### Rest ausbuchen: Skonto und Forderungsausfall

Zahlt ein Kunde weniger als die Rechnung, ist der Rest nicht immer eine Gebühr: Er hat Skonto abgezogen, oder der Rest ist nicht mehr einzutreiben. Ist die gewählte Rechnung höher als der Zahlungseingang, bietet Haben deshalb auch **Rest … als Skonto** und **Rest … als Forderungsausfall** an. Die Zahlung wird der Rechnung zugeordnet und der Rest mit dem Datum des Umsatzes ausgebucht. Die Rechnung ist danach erledigt („Bezahlt“ bzw. bei Forderungsausfall „Ausgebucht“).

Der ausgebuchte Rest mindert Erlöse und Umsatzsteuer anteilig je Steuersatz (§ 17 UStG):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 8730 Gewährte Skonti bzw. 2400 Forderungsverluste | 4730 bzw. 6930 | 80,00 | |
| 1776 Umsatzsteuer 19 % (bei Ist 1766 nicht fällig) | 3806 (bei Ist 3816) | 15,20 | |
| 1400 Forderungen | 1200 Forderungen | | 95,20 |

Beispiel: Rechnung 4.760,00 €, der Kunde überweist 4.664,80 € (2 % Skonto). Bei Soll-Versteuerung mindert das Skonto die Umsatzsteuer in der Voranmeldung des Monats, in dem ausgebucht wird. Bei Ist-Versteuerung wird ohnehin nur fällig, was bezahlt ist; Haben mindert dann die noch nicht fällige Umsatzsteuer.

Hast du selbst Skonto abgezogen, liegt die Abbuchung unter dem Beleg. Dann gibt es **Rest … als erhaltenes Skonto**: Verbindlichkeiten an 3730 bzw. 5730 Erhaltene Skonti und an Vorsteuer, anteilig je Steuersatz; die Vorsteuer in der Voranmeldung sinkt im Monat der Ausbuchung. Ohne Vorsteuerabzug (Kleinunternehmer) mindert das Skonto den Aufwand brutto. Bei Belegen mit § 13b, mit Privatanteil oder für Anlagen gibt es das nicht.

Einen Forderungsausfall ohne Zahlung, etwa bei Insolvenz des Kunden, buchst du auf der Seite der Rechnung unter **Ausbuchen** (siehe [Rechnungen](rechnungen.md#ausbuchen)). Hebst du die Zuordnung einer Zahlung auf, hebt Haben einen mit ihr ausgebuchten Rest mit auf.

### Skonto auf eigene Rechnungen

Steht auf deiner Rechnung [Skonto](rechnungen-zahlung.md#skonto), rechnet Haben für jede Stufe den Zahlbetrag aus. Geht bis zum letzten Tag einer Frist (Buchungsdatum des Umsatzes) genau dieser Betrag ein – endet die Frist an einem Samstag, Sonntag oder Feiertag, auch noch am nächsten Werktag (§ 193 BGB, Feiertage des Bundeslands aus den Firmendaten wie beim Zahlungsziel) –, schlägt Haben die Rechnung vor wie bei einem exakten Betrag, mit der Begründung „Betrag stimmt mit 2 % Skonto (95,20 €), in der Frist“. Der Knopf heißt dann **Zuordnen, Rest 95,20 € als Skonto**: Ein Klick (oder Enter) ordnet die Zahlung zu und bucht den Rest als gewährtes Skonto aus. Die Rechnung ist danach „Bezahlt“.

Das gilt nur, solange die Rechnung noch ganz offen ist, und nur für Rechnungen in Euro. Kommt die Zahlung nach der Frist oder mit einem anderen Betrag, ist sie ein Teilbetrag; willst du das Skonto trotzdem gewähren, nimmst du **Rest … als Skonto** von Hand.

### Kursdifferenz bei Fremdwährung

Rechnungen und Belege in Fremdwährung stehen im Bankabgleich mit ihrem Euro-Betrag zum Kurs der Rechnung (USt-Umrechnungskurs oder eigener Kurs). Die Bank rechnet zum Tageskurs, die Zahlung weicht also meist um ein paar Cent oder Euro ab. Weicht sie um höchstens 5 % ab, bekommt die Rechnung dafür 30 Punkte („Betrag passt bis auf eine Kursdifferenz (USD)“); vorgeschlagen wird sie, sobald ein weiterer Grund wie Rechnungsnummer, IBAN oder Name dazukommt. Ist eine Rechnung oder ein Beleg in Fremdwährung gewählt, als bester Treffer oder unter **Andere Rechnung**, bietet Haben **Ausgleichen, … als Kursdifferenz** an:

- **Weniger** als offen: Die Zahlung wird zugeordnet, der Rest ausgebucht.
- **Mehr** als offen: Haben teilt den Umsatz auf, den offenen Betrag auf die Rechnung bzw. den Beleg und den Überschuss als Kursdifferenz.

Die Differenz ist Aufwand oder Ertrag aus Kursdifferenzen, ohne Umsatzsteuer; die Umsatzsteuer bleibt beim Kurs der Rechnung (§ 16 Abs. 6 UStG):

| Fall | SKR03 | SKR04 |
| --- | --- | --- |
| Kunde zahlt weniger, du zahlst mehr | 2150 Aufwendungen aus Kursdifferenzen | 6880 |
| Kunde zahlt mehr, du zahlst weniger | 2660 Erträge aus Kursdifferenzen | 4840 |

Beispiel: Rechnung über 1.190,00 USD, zum USt-Kurs 1 EUR = 1,0812 USD sind das 1.100,63 €. Der Kunde überweist 1.095,00 €. Haben ordnet 1.095,00 € zu und bucht 5,63 € auf 2150 gegen Forderungen. Bei Ist-Versteuerung wird die Umsatzsteuer der Rechnung trotzdem voll fällig, auch auf den ausgebuchten Teil. In der EÜR stehen die Erlöse in voller Höhe und die 5,63 € als eigener Posten „Aufwendungen aus Kursdifferenzen“; im Abgleich der Auswertungen werden die Konten gegen diesen Posten geprüft.

Hebst du die Zuordnung auf, hebt Haben Ausbuchung bzw. Aufteilung mit auf.

### Vorschläge ohne Rechnung und Geldtransit

Gibt es keinen passenden offenen Posten, schlägt Haben anhand der Kontozwecke eine Buchung ohne Rechnung vor, mit Begründung unter **Vorschlag ohne Rechnung**. Der Umsatz steht dann in der Liste auf „Vorschlag“.

- **Gegenkonto ist ein eigenes Konto** (Gegen-IBAN gehört zu einem deiner Konten): Geldtransit; ist eines der beiden ein Privatkonto, Privat.
- **Steuerkonto, Gegenpartei ist das Finanzamt** (Finanzamt, Finanzkasse, Landeshauptkasse, Bundeskasse und ähnliche) **und der Verwendungszweck nennt die Umsatzsteuer** („USt“, „Umsatzsteuer“, „Voranmeldung“): Umsatzsteuer an das Finanzamt; nennt er die Sondervorauszahlung („Sondervorauszahlung“, „SVZ“, „1/11“), stattdessen Sondervorauszahlung (Dauerfristverlängerung). Nennt er eine andere Steuer (Einkommensteuer, Kirchensteuer, Gewerbesteuer, Kfz-Steuer …) oder gar keine, gibt es keinen Vorschlag: Auf dem Steuerkonto liegt oft auch die Rücklage für die private Einkommensteuer. Auf anderen Konten schlägt Haben die Umsatzsteuer nie vor.

Bei einem Geldtransit sucht Haben auf dem anderen Konto die Gegenbuchung: gleicher Betrag mit umgekehrtem Vorzeichen, höchstens fünf Tage auseinander, noch ganz offen, und als Gegenkonto das Ausgangskonto (fehlt die Gegen-IBAN, nimmt Haben sie nur, wenn es keine mit passender IBAN gibt). Eine fremde Zahlung über denselben Betrag, etwa eine Erstattung des Finanzamts, ist nie die Gegenbuchung. Gibt es sie, bucht **Beide Seiten als Geldtransit buchen** beide Umsätze in einem Schritt über das Geldtransitkonto (1360 bzw. 1460), wo sie sich aufheben.

### Aus früheren Zuordnungen gelernt

Greift keine der Regeln aus [Vorschläge ohne Rechnung](#vorschläge-ohne-rechnung-und-geldtransit), schlägt Haben die Buchungsart vor, mit der du frühere Umsätze derselben Gegenpartei gebucht hast: gleiche Gegen-IBAN, ohne IBAN gleicher Name, und dieselbe Richtung (die Gebühren von Stripe sind keine Vorlage für dessen Auszahlung). Ein aufgeteilter Umsatz zählt einmal, und zwar mit dem Teil in seiner Richtung: Die von einer Auszahlung abgezogene Gebühr macht die Auszahlung nicht zu einer Gebühr. Vorgeschlagen wird nur, was mindestens zweimal und bei mehr als der Hälfte dieser Umsätze so gebucht wurde. Die Begründung nennt, wie oft und wann zuletzt, etwa „3 von 4 Umsätzen mit dieser Gegen-IBAN so gebucht, zuletzt am 01.10.2026“ bei der monatlichen Kontoführungsgebühr. Aufgehobene Zuordnungen zählen nicht. Ein KI-Modell steckt nicht dahinter, nur das Zählen der eigenen Zuordnungen (siehe [Roadmap](roadmap.md#bewusst-nicht)).

So gelernt werden:

- Kontoführung und Bankgebühren, Privat, Spenden, Mahngebühren und Zinserträge;
- [Einnahmen und Ausgaben auf eine Kategorie](#auf-eine-kategorie-buchen), jede Kategorie und jeder Steuersatz für sich: Hast du die Aufladungen beim Kiosk zweimal als Telefon gebucht, steht beim dritten Mal „Ausgabe: Telefon“ als Vorschlag da, und unter **Direkt buchen** sind Art und Kategorie schon gewählt. Zwei Zahlungen eines Privatkunden mit 7 % und eine mit 19 % ergeben „Einnahme: Erlöse 7 %“. Eine Kategorie, die am Tag des Umsatzes so nicht buchbar wäre, schlägt Haben nicht vor, etwa Erlöse mit 19 %, wenn du inzwischen Kleinunternehmer bist.

Nie gelernt werden Geldtransit (dafür braucht es die Gegenbuchung), alles mit dem Finanzamt, weil über dieselbe IBAN Umsatzsteuer und private Steuern laufen, und Lohn, Sozialversicherung, Steuerzahlungen und Darlehen: Dort ändern sich Abrechnung, Steuerart und Jahr oder der Teil der Rate von Zahlung zu Zahlung, und die Regeln oben kennen sie besser.

Gebucht wird ein gelernter Vorschlag wie jeder andere erst mit **Buchen**; Haben bucht nie von selbst.

### Direkt buchen

Für Umsätze ohne Rechnung oder Beleg klickst du **Direkt buchen** („Bankumsatz einer Buchungsart zuordnen, ohne einen separaten Beleg anzulegen“; bis Version 0.6 hieß die Schaltfläche „Ohne Rechnung buchen“), wählst unter **Buchen als** die Art und klickst **Buchen**.

| Auswahl | Gegenkonto SKR03 | Gegenkonto SKR04 |
| --- | --- | --- |
| Privat (Entnahme oder Einlage) | Ausgang: 1800 Privatentnahmen, Eingang: 1890 Privateinlagen | Ausgang: 2100, Eingang: 2180 |
| Spende (privat, Sonderausgabe), nur im Einzelunternehmen | 1840 Zuwendungen, Spenden | 2250 Zuwendungen, Spenden |
| Gesellschafter (Verrechnungskonto), statt Privat in GmbH und UG | beide Richtungen: 0730 Verbindlichkeiten gegenüber Gesellschaftern | beide Richtungen: 3510 |
| Geldtransit (eigenes Konto) | 1360 | 1460 |
| Umsatzsteuer an das Finanzamt (ohne Bezug; besser die Voranmeldung als offenen Posten zuordnen, siehe oben); auf einem privaten Konto gegen die Privatentnahme bzw. die Einlage, siehe [Voranmeldung: Zahllast und Erstattung](#voranmeldung-zahllast-und-erstattung) | 1780 | 3820 |
| Sondervorauszahlung (Dauerfristverlängerung), siehe [Umsatzsteuer](umsatzsteuer.md#buchen) | 1781 Umsatzsteuer-Vorauszahlungen 1/11 | 3830 |
| Kontoführung und Bankgebühren | 4970 | 6855 |
| Mahngebühren und Verzugszinsen (vom Kunden) | 2650 | 7100 |
| Zinserträge (Guthabenzinsen auf ein betriebliches Konto) | 2650 Sonstige Zinsen und ähnliche Erträge | 7100 |
| Steuerzahlung oder Erstattung (Finanzamt, Gemeinde), siehe [Steuerzahlungen](bank-steuern-darlehen.md#steuerzahlungen) | je nach Steuerart und Teil | je nach Steuerart und Teil |
| Einnahme oder Ausgabe (Kategorie, Steuersatz), siehe [Auf eine Kategorie buchen](#auf-eine-kategorie-buchen) | Konto der Kategorie | Konto der Kategorie |
| Darlehen: Auszahlung, Tilgung, Zinsen oder Gebühren, siehe [Darlehen](bank-steuern-darlehen.md#darlehen) | je nach Darlehen und Teil | je nach Darlehen und Teil |
| Kapitalertragsteuer an das Finanzamt (Ausschüttung), nur GmbH und UG | 1746 Verbindlichkeiten aus Einbehaltungen | 3760 |
| Lohn/Gehalt an Mitarbeiter | 1740 Verbindlichkeiten aus Lohn und Gehalt | 3720 |
| Lohnsteuer an das Finanzamt | 1741 Verbindlichkeiten aus Lohn- und Kirchensteuer | 3730 |
| SV-Beiträge an Krankenkasse oder Minijob-Zentrale | 1742 Verbindlichkeiten im Rahmen der sozialen Sicherheit | 3740 |

Eine **Spende** vom Geschäftskonto ist im Einzelunternehmen keine Betriebsausgabe, sondern eine Entnahme; abziehbar ist sie privat als Sonderausgabe (§ 10b EStG). Haben bucht sie deshalb nicht auf „Privat“, sondern auf das eigene Privatkonto „Zuwendungen, Spenden“, wie es der DATEV-Kontenrahmen vorsieht. Gewinn und EÜR ändern sich dadurch nicht; in der Anlage EÜR zählt sie zu den Entnahmen. Die Summe des Jahres steht im Kontenblatt 1840 bzw. 2250, und du trägst sie mit der Zuwendungsbestätigung in der [Einkommensteuer](jahreserklaerung.md) unter Sonderausgaben ein. In GmbH und UG gibt es die Auswahl nicht: Dort ist eine Spende Aufwand mit eigenem Abzug (§ 9 Abs. 1 Nr. 2 KStG).

Die drei Lohnzahlungen bezahlen, was eine festgeschriebene [Lohnabrechnung](lohn.md#buchung) als Verbindlichkeit gebucht hat, und höchstens so viel, wie auf dem Konto noch offen ist; ohne festgeschriebene Abrechnung lehnt Haben sie ab. Ein Eingang (Rückzahlung, Erstattung) geht nur, soweit das Konto überzahlt ist. Lohnsteuer, Soli und Kirchensteuer überweist du gemeinsam als „Lohnsteuer an das Finanzamt“, im Minijob die Pauschsteuer mit den Beiträgen an die Minijob-Zentrale. Eine Lastschrift des Finanzamts über genau den Gesamtbetrag (Kz 83) einer übermittelten [Lohnsteuer-Anmeldung](lohn.md#lohnsteuer-anmeldung) schlägt Haben als „Lohnsteuer an das Finanzamt“ vor. Im Einzelunternehmen zählen sie in der EÜR am Tag der Zahlung als Ausgaben für Personal.

Für Ausgaben mit Rechnung gilt: erst den Beleg unter [Belege](belege.md) hochladen und buchen, dann hier zuordnen. Direkt gebuchte Ausgaben haben keine Vorsteuer.

### Auf eine Kategorie buchen

Eine Einnahme ohne Rechnung, etwa die Zahlung eines Privatkunden, oder eine kleine Ausgabe ohne Beleg buchst du unter **Direkt buchen** als **Einnahme oder Ausgabe (Kategorie, Steuersatz)**. Du wählst die **Kategorie** und bei Einnahmen den **Steuersatz** (19 % oder 7 %); Haben zeigt Netto und Umsatzsteuer des Betrags an. Das geht auch als Teil einer Aufteilung.

Gebucht wird nur auf eine Kategorie, nicht frei auf ein Konto mit Steuerschlüssel: Voranmeldung, EÜR und E-Bilanz hängen an den Kategorien und ihren Konten (siehe [Roadmap](roadmap.md#bewusst-nicht)). Für Vorgänge ohne Bankumsatz, etwa eine Sachentnahme, gibt es ab dem Stichjahr [freie Buchungen mit Steuerschlüssel](buchhaltung.md#manuelle-und-freie-buchungen); Bank- und Steuerkonten lassen sich auch dort nicht bebuchen.

| Kategorie | SKR03 | SKR04 | Voranmeldung | EÜR (Einzelunternehmen) |
| --- | --- | --- | --- | --- |
| Erlöse 19 % | 8400, Steuer 1776 | 4400, Steuer 3806 | Kz 81 im Monat der Zahlung, bei Ist und Soll | Einnahme netto, Steuer als vereinnahmte Umsatzsteuer |
| Erlöse 7 % | 8300, Steuer 1771 | 4300, Steuer 3801 | Kz 86 im Monat der Zahlung, bei Ist und Soll | ebenso |
| Erlöse als Kleinunternehmer | 8195 | 4185 | – | Einnahme als Kleinunternehmer |
| Ausgabekategorie, z. B. Telefon | Konto der Kategorie ([Belegkategorien](buchhaltung.md#aufwandskonten-der-belegkategorien)) | ebenso | keine Vorsteuer | Ausgabe brutto in der Zeile der Kategorie |

Beispiel: Ein Privatkunde überweist für eine Reparatur 119,00 €, Erlöse 19 %:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 1200 Bank | 1800 Bank | 119,00 | |
| 8400 Erlöse 19 % USt | 4400 | | 100,00 |
| 1776 Umsatzsteuer 19 % | 3806 | | 19,00 |

- **Einnahmen:** Die Umsatzsteuer entsteht mit der Leistung, nicht mit einer Rechnung (§ 13 Abs. 1 Nr. 1 UStG); an Privatkunden musst du keine Rechnung ausstellen (§ 14 Abs. 2 Satz 1 Nr. 2 UStG). Ohne Rechnung kennt Haben nur den Tag der Zahlung; daran wird die Steuer fällig, bei Ist- und bei Soll-Versteuerung, und nie auf „Umsatzsteuer nicht fällig“ gebucht. Bei Soll gilt das auch für eine Anzahlung vor der Leistung (§ 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG). Liegt die Leistung in einem früheren Monat als die Zahlung, gehört der Umsatz bei Soll in den Monat der Leistung; dann schreibe besser eine Rechnung. Steuerfreie Umsätze, Reverse Charge, innergemeinschaftliche Lieferungen und Ausfuhren gehen nur über eine [Rechnung](rechnungen.md) mit ihren Pflichtangaben. Als Kleinunternehmer gibt es keinen Steuersatz (§ 19 UStG).
- **Ausgaben:** brutto als Aufwand, ohne Vorsteuer: Die Vorsteuer darfst du nur mit einer Rechnung abziehen (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG). Hast du eine, buche sie als [Beleg](belege.md). Nicht direkt buchen lassen sich Anlagegüter und geringwertige Wirtschaftsgüter (Anlagenverzeichnis), die Einfuhrumsatzsteuer (Bescheid des Zolls), Bewirtung (Bewirtungsbeleg, § 4 Abs. 5 Satz 1 Nr. 2 Satz 2 EStG) und Geschenke (Empfänger, § 4 Abs. 7 EStG); Bankgebühren haben ihre eigene Art.
- Eine Zahlung in Gegenrichtung, etwa die Erstattung an einen Privatkunden, bucht die Seiten umgekehrt und mindert Erlöse und Umsatzsteuer im Monat der Erstattung.

Kategorie und Steuersatz stehen an der Zuordnung, gesperrt und versiegelt; eine Aufhebung übernimmt sie in die Gegenzeile. In den Quellen der [Voranmeldung](umsatzsteuer.md#quellen-aufklappen) erscheint die Buchung als „Direktbuchung“ mit Link auf den Bankumsatz.

**Zinserträge** sind Zinsen auf das Guthaben eines betrieblichen Kontos, ohne Umsatzsteuer (§ 4 Nr. 8 Buchst. a UStG); in der EÜR zählen sie bei den umsatzsteuerfreien Betriebseinnahmen. Hat die Bank Kapitalertragsteuer und Solidaritätszuschlag einbehalten, teilst du die Gutschrift mit **Aufteilen** auf: den Bruttozins als Zinserträge (positiv) und die einbehaltenen Steuern als [Steuerzahlung](bank-steuern-darlehen.md#steuerzahlungen) mit der Steuerart „Kapitalertragsteuer (von der Bank einbehalten)“ bzw. „Solidaritätszuschlag zur Kapitalertragsteuer“ (negativ). Beispiel: 100,00 € Zinsen, 25,00 € Kapitalertragsteuer und 1,37 € Soli, gutgeschrieben 73,63 €:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 1200 Bank | 1800 Bank | 73,63 | |
| 1810 Privatsteuern (GmbH: 2213 und 2216) | 2150 (GmbH: 7630 und 7633) | 26,37 | |
| 2650 Sonstige Zinsen und ähnliche Erträge | 7100 | | 100,00 |

Im Einzelunternehmen ist die einbehaltene Steuer eine Entnahme, angerechnet wird sie in der Einkommensteuererklärung; in GmbH und UG ist sie Steueraufwand, den die Steuerberechnung dem Einkommen wieder hinzurechnet. Kirchensteuer auf die Zinsen buchst du im Einzelunternehmen als Kirchensteuer.

### Steuerzahlungen und Darlehen

<a id="steuerzahlungen"></a><a id="darlehen"></a>Zahlungen an Finanzamt und Gemeinde, Erstattungen und Darlehen stehen unter [Steuerzahlungen und Darlehen](bank-steuern-darlehen.md).

## Zahlungsdienstleister

<a id="google-play-und-app-store"></a>Konten bei PayPal, Stripe, Shopify Payments, eBay, Etsy, SumUp, Google Play und App Store stehen unter [Zahlungsdienstleister](bank-zahlungsdienstleister.md).

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

Bezahlt der Kunde bar, erfasst du das im [Kassenbuch](kasse.md#rechnung-bar-bezahlt): gebucht genauso, nur 1000 Kasse (SKR04 1600) statt Bank, mit dem Datum der Bareinnahme. Der Bankabgleich sieht danach nur noch den offenen Rest.

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

**Rücklastschrift**, Beispiel 297,50 € auf eine Rechnung zu 19 % mit 3,00 € Entgelt: die Zahlung mit vertauschten Seiten, dazu die Gebühr.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 1400 Forderungen | 1200 Forderungen | 297,50 | |
| 1200 Bank | 1800 Bank | | 297,50 |
| 4970 Nebenkosten Geldverkehr | 6855 Nebenkosten Geldverkehr | 3,00 | |
| 1200 Bank | 1800 Bank | | 3,00 |

Bei **Ist-Versteuerung** geht die Umsatzsteuer zurück auf „nicht fällig“ (SKR03 1776 an 1766, SKR04 3806 an 3816, hier 47,50 €), denn das Entgelt ist nicht mehr vereinnahmt; mit dem nächsten Zahlungseingang wird sie wieder fällig. Bei Soll-Versteuerung bleibt die Steuer, wie sie ist.

Bei Eingängen (Privateinlage, Geldtransit, Erstattung vom Finanzamt) steht die Bank im Soll und das Gegenkonto im Haben; auf einem Konto mit dem Zweck **privat** steht dort die Privatentnahme bzw. die Einlage ([Voranmeldung](#voranmeldung-zahllast-und-erstattung)). Steuerzahlungen stehen unter [Steuerzahlungen](bank-steuern-darlehen.md#steuerzahlungen).

> [!IMPORTANT]
> Die Konten stammen aus `packages/core/src/posting.ts`. Gleiche sie vor dem Echtbetrieb mit deiner Steuerberatung ab.

## Zuordnung aufheben

Unter **Zugeordnet** steht neben jeder Zuordnung **Aufheben**, bei einer Aufteilung einmal **Aufteilung aufheben** für alle Teile. Haben fragt vorher in einem Dialog nach und nennt Zuordnung und Betrag. Es löscht dabei nichts: Es legt eine Gegenzeile mit umgekehrtem Betrag an und bucht die ursprüngliche Buchung mit vertauschten Seiten zurück („Storno: …“), ebenfalls mit dem Buchungsdatum des Umsatzes. Die aufgehobene Zuordnung bleibt durchgestrichen sichtbar, der Betrag ist wieder offen.

Eine Zuordnung lässt sich nur einmal aufheben.

Beim [Stornieren eines Belegs](belege.md#stornieren-und-neu-erfassen) kann Haben dessen Bankzuordnungen in derselben bestätigten Aktion aufheben. Die Rückfrage nennt die Zuordnungen einschließlich aller Teile betroffener Aufteilungen. Mit der Zahlung verknüpfte Ausbuchungen wie Skonto werden mit aufgehoben. Scheitert die Rücknahme oder der Belegstorno, wird keiner der beiden Teile gespeichert.

Die Bankgegenbuchungen einschließlich verknüpfter Ausbuchungen stehen auch dabei am ursprünglichen Buchungsdatum. Die neu berechneten Steuerwerte eines früheren Zeitraums können sich deshalb ändern; eine gespeicherte, bereits gesendete Voranmeldung bleibt unverändert. Prüfe dann, ob du eine [berichtigte Anmeldung](umsatzsteuer.md#berichtigte-anmeldung) abgeben musst. Die Gegenbuchung des Belegs erhält unabhängig davon ihr eigenes, im Stornodialog genanntes Datum.

## Gegenläufige Umsätze verrechnen

Manche Umsätze heben sich auf, ohne dass Geld fließt: Bei einer Kartenprüfung bucht etwa PayPal 1,00 € ab und am nächsten Tag wieder zurück. Das ist weder Einnahme noch Ausgabe, und keine Buchungsart passt. Solche Paare verrechnest du miteinander; beide gelten danach als erledigt.

1. Einen der beiden Umsätze links anklicken. Gibt es auf demselben Konto einen ganz offenen Umsatz mit genau dem umgekehrten Betrag, steht rechts **Mit Gegenumsatz verrechnen**.
2. Unter **Gegenumsatz** den passenden wählen; der zeitlich nächste steht oben.
3. Unter **Notiz** den Grund eintragen, etwa „PayPal-Autorisierung mit automatischer Rückbuchung“. Ohne Notiz geht es nicht.
4. **Verrechnen** klicken. Beide Umsätze stehen danach in der Liste als „Verrechnet“ unter **Zugeordnet**, rechts unter **Verrechnet** mit Gegenumsatz und Notiz.

Was dabei passiert:

- **Keine Buchung, keine Zuordnung.** Voranmeldung, EÜR, Journal und DATEV-Export bleiben unverändert; die Vorprüfung der Voranmeldung zählt die beiden nicht mehr als offen.
- **Die Umsätze bleiben, wie sie sind.** Haben legt eine eigene Zeile mit beiden Umsätzen, der Notiz und der Person an, die nur ergänzt werden kann. Sie steht im [Änderungsprotokoll](buchhaltung.md#änderungsprotokoll) und im [Jahresexport](auswertungen.md#jahresexport) unter `bank/verrechnungen.csv`; in `umsaetze.csv` sind beide als verrechnet und nicht offen markiert.
- **Nur, was sich genau aufhebt:** zwei verschiedene Umsätze auf demselben Konto, zusammen genau 0,00 €, beide ohne Zuordnung. Ist einer schon (auch teilweise) zugeordnet, hebst du erst die Zuordnung auf. Ein Umsatz steckt höchstens in einer gültigen Verrechnung, und ein verrechneter Umsatz lässt sich nicht zusätzlich zuordnen. Ein Datenbank-Trigger prüft das ein zweites Mal.

**Aufheben:** Neben der Verrechnung steht **Aufheben**. Nach der Rückfrage legt Haben eine Gegenzeile an; gebucht wird auch dabei nichts. Beide Umsätze sind danach wieder offen, die aufgehobene Verrechnung bleibt durchgestrichen sichtbar.

Einen einzelnen Umsatz ohne Gegenstück verrechnet Haben nicht: Was Geld bewegt, wird zugeordnet oder [direkt gebucht](#direkt-buchen). Umsätze zwischen zwei eigenen Konten sind [Geldtransit](#vorschläge-ohne-rechnung-und-geldtransit).

## Grenzen

- Automatischer Abruf nur über Enable Banking (PSD2), nicht über FinTS/HBCI. Ohne Enable Banking kommen die Umsätze per Datei.
- Dateiimport nur für DKB, Commerzbank, N26, Swan und CAMT.053. Andere Banken gehen, wenn sie CAMT.053 exportieren. Zahlungsdienstleister: PayPal, Stripe, Shopify Payments, eBay und Etsy per CSV, [Google Play und App Store](bank-zahlungsdienstleister.md#google-play-und-app-store) per Abruf der Finanzberichte; SumUp und andere lassen sich anlegen, aber noch nicht importieren.
- Zahlungsdienstleister nur in Euro; Zeilen in anderen Währungen (etwa ein USD-Guthaben bei PayPal) übernimmt Haben nicht und meldet sie. Ausnahme ist der App Store: Fremdwährung rechnet Haben mit dem Umsatzsteuer-Umrechnungskurs in Euro um (siehe [Google Play und App Store](bank-zahlungsdienstleister.md#google-play-und-app-store)).
- Kursdifferenzen nur beim Ausgleich einer Rechnung oder eines Belegs in Fremdwährung; Bankkonten und Verrechnungskonten von Zahlungsdienstleistern nur in Euro.
- Zuordnungen und ihre Aufhebung werden mit dem Buchungsdatum des Umsatzes gebucht. Hebst du eine Zuordnung in einem Monat auf, dessen Voranmeldung schon gesendet ist, ändern sich dessen berechnete Werte; die gesendete Anmeldung bleibt, wie sie ist, und die Seite des Monats weist auf die Abweichung hin (siehe [umsatzsteuer.md](umsatzsteuer.md)).
