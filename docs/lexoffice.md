# Umzug aus Lexoffice / Lexware Office

Haben übernimmt deinen Bestand aus Lexware Office (früher Lexoffice), damit du das Abo kündigen kannst, ohne Daten zu verlieren. Der Umzug läuft auf der Seite **Archiv** unter „Umzug“ in fünf Schritten. Kommst du von sevDesk, lies [Umzug aus sevDesk](sevdesk.md).

<img src="screenshot-archiv.png" alt="Seite Archiv mit den Schritten des Umzugs und dem Abgleich je Geschäftsjahr" width="900">

## Worum es geht

Nach der Kündigung kommst du nicht mehr an deine Rechnungen, Belege und Buchungen in Lexware Office. Das Finanzamt kann aber noch Jahre später danach fragen. Haben holt deshalb alles, was die Schnittstelle hergibt, legt die Exporte unverändert daneben und zeigt dir je Geschäftsjahr, ob etwas fehlt. Was einmal im Archiv ist, lässt sich nicht mehr ändern oder löschen.

Der Altbestand bleibt von deiner laufenden Buchhaltung getrennt: Er fließt nicht in Bankabgleich, Voranmeldung und Auswertungen von Haben ein. Die einzige Ausnahme sind offene Posten, die du in Schritt 3 ausdrücklich übernimmst.

> [!NOTE]
> Der Abruf über die API ist gegen die öffentliche Dokumentation von Lexware Office gebaut und mit nachgestellten Antworten getestet. Ein Lauf gegen ein echtes Konto steht noch aus. Rechne damit, dass beim ersten echten Abruf Fehler auftauchen können, und kündige erst, wenn der Abgleich für jedes Jahr aufgeht.

## Voraussetzungen

- Für den Abruf in Schritt 1 bis 3 brauchst du die Public API von Lexware Office, und die gibt es nur im **Tarif XL**. Hast du einen kleineren Tarif, hast du zwei Wege: für einen Monat auf XL wechseln, den Abruf machen und danach kündigen, oder nur über die Exporte umziehen (siehe [Umzug ohne Public API](#umzug-ohne-public-api-tarife-s-m-und-l)).
- Den API-Schlüssel erzeugst du in Lexware Office unter **Erweiterungen → Public API** (`app.lexware.de/addons/public-api`).
- In Haben sollten Firmendaten, Kontenrahmen und Versteuerungsart (Ist oder Soll) eingerichtet sein ([Einrichtung](einrichtung.md)). Die Versteuerungsart bestimmt, wie offene Posten gebucht und wie die Umsatzsteuer im Abgleich gerechnet wird. Sie sollte dieselbe sein wie in Lexware Office.
- Der Server braucht Zugriff auf `https://api.lexware.io`.

## Wann umziehen: am besten zum Jahreswechsel

Am einfachsten ist der Wechsel zum **1. Januar**. Das Jahr davor schließt du in Lexware Office ab (EÜR und Voranmeldungen kommen dann vollständig aus einem System), und in Haben beginnt das neue Jahr ohne Altlasten:

- **Bank:** Ein neu verbundenes Konto ruft Haben ab dem 1. Januar des laufenden Jahres ab (siehe [Bank](bank.md#welche-umsätze-abgerufen-werden)). Verbindest du im Januar, beginnen die Umsätze genau am Jahresanfang, ohne Kontoauszug als Datei und ohne Überschneidung mit Lexware Office.
- **Offene Posten** übernimmst du zum 31. Dezember (Schritt 3), **Anlagen** mit dem Restbuchwert zum 1. Januar ([Anlagen](anlagen.md#übernahme-aus-lexoffice)).
- **Lexware Office** brauchst du danach nur noch für den Jahresabschluss des alten Jahres; kündigen kannst du, sobald der Abgleich aufgeht.

Ein Wechsel **unter dem Jahr** geht auch, ist aber aufwendiger: Für das laufende Jahr stehen die Monate vor dem Wechsel in Lexware Office, die danach in Haben, und für die EÜR muss beides zusammengeführt werden. Umsätze vor dem ersten Abruf kommen dann per Kontoauszug als Datei; Haben ruft danach keine Tage mehr ab, die eine Datei schon abdeckt. Willst du Haben vorher ausprobieren, nimm dafür eine eigene Instanz und starte die echte Buchhaltung zum Jahreswechsel neu: Importierte Bankumsätze und Buchungen lassen sich nicht löschen.

## Umzug ohne Public API (Tarife S, M und L)

Ohne Tarif XL fallen die Schritte 1 bis 3 weg. Den Umzug kannst du trotzdem machen, nur über die Exporte aus Schritt 4:

1. In Lexware Office unter **Einstellungen › Export** je Geschäftsjahr die DATEV-konformen Dateien exportieren und den Buchungsstapel (`EXTF_Buchungsstapel_….csv`) als **DATEV-Buchungsstapel** hochladen.
2. Den IDEA-Export, die ELSTER-Protokolle und die Kontoauszüge wie in Schritt 4 ablegen.
3. Die Belegdateien selbst sichern: Der DATEV-Export „ohne Belegbilder“ enthält keine PDFs. Laut Lexware-Hilfe gibt es unter **Einstellungen › Export** auch einen Belegexport als ZIP mit je einem PDF und XML pro Beleg; ob er in deinem Tarif angeboten wird, siehst du dort. Lege die ZIP-Datei je Jahr als **Sonstiges** ab. Gibt es ihn nicht, lade die Belege vor der Kündigung anders herunter.

Was dabei fehlt:

- **Rechnungen und Belege als Datensätze.** Haben kennt nur die Buchungen aus dem DATEV-Stapel, nicht die einzelnen Belege mit Positionen, Zahlungsstatus und Steuerart. Die Belegdateien liegen nur als ZIP im Archiv, ohne Suche nach Nummer.
- **Kontakte.** Kunden und Lieferanten legst du in Haben neu an.
- **Offene Posten (Schritt 3).** Unbezahlte Rechnungen und Eingangsrechnungen trägst du in Haben selbst ein.
- **Umsatzsteuer je Monat** im Abgleich. Einnahmen, Ausgaben und die Steuer je Jahr rechnet Haben näherungsweise aus dem Buchungsstapel (siehe [Schritt 5](#schritt-5-abgleich-je-jahr)).
- **Der Status „vollständig“.** Die Prüfungen „Belege und Rechnungen per API abgerufen“ und „Jeder Beleg hat eine Datei“ bleiben offen, das Jahr wird im Abgleich nie als vollständig angezeigt. Ob alles da ist, entscheidest du selbst.

Lohnt sich das? Brauchst du offene Posten, Kontakte oder die Belege einzeln durchsuchbar, ist ein Monat XL meist die bessere Wahl. Für abgeschlossene Jahre ohne offene Posten reichen die Exporte.

## Schritt 1: Verbindung zu Lexware Office

Füge den API-Schlüssel ein und klicke „Prüfen und speichern“. Haben fragt damit das Profil ab; klappt das, steht der Firmenname aus Lexware Office da. Der Schlüssel wird mit AES-256-GCM verschlüsselt in der Datenbank gespeichert (mit `HABEN_ENCRYPTION_KEY`, wie das ELSTER-Zertifikat) und taucht weder im Änderungsprotokoll noch im Jahresexport auf.

Haben liest nur. Es legt in Lexware Office nichts an und ändert nichts. Nach dem Umzug kannst du den Schlüssel mit „Schlüssel entfernen“ löschen und ihn in Lexware Office widerrufen.

## Schritt 2: Kontakte, Rechnungen und Belege abrufen

„Alles abrufen“ startet den Abruf im Hintergrund. Du kannst die Seite verlassen; der Fortschritt aktualisiert sich alle zwei Sekunden. Der Abruf läuft in drei Phasen:

1. **Kontakte:** alle Kontakte mit Name, Kundennummer, Rechnungsadresse (sonst Lieferadresse), erster E-Mail-Adresse und USt-IdNr. Archivierte Kontakte werden in Haben archiviert angelegt.
2. **Belegliste:** alle Ausgangsrechnungen, Gutschriften und Abschlagsrechnungen aus dem Rechnungsmodul sowie alle Einnahme- und Ausgabebelege samt Gutschriften aus der Buchhaltung, archiviert und nicht archiviert. Entwürfe bleiben draußen.
3. **Belege und Dateien:** je Beleg die Details, der Zahlungsstatus mit den einzelnen Zahlungen, das Original-PDF, bei E-Rechnungen das XML und bei Buchhaltungsbelegen alle angehängten Dateien. Die Kategorien aus Lexware Office kommen mit ihrem Namen dazu.

Die Antwort der API wird je Beleg vollständig gespeichert, zum Nachweis. Beträge rechnet Haben in Cent um; maßgeblich sind Brutto und Steuer des Belegs, Netto ergibt sich daraus. Bei Schlussrechnungen rechnet Haben die verrechneten Abschläge je Steuersatz heraus, die Beträge entsprechen also dem geforderten Restbetrag. Die Abschlagsrechnungen sind eigene Belege; so zählen ihre Umsätze und Steuern im Abgleich und bei den offenen Posten nicht doppelt. Das gilt für Belege, die mit dieser Version abgerufen werden; schon gespeicherte Belege bleiben unverändert.

### Kontakte verknüpfen

Gibt es in Haben schon einen Kontakt mit demselben Namen (Groß- und Kleinschreibung egal) und ohne Lexoffice-Herkunft, verknüpft Haben ihn statt einen zweiten anzulegen. Der Fortschritt zeigt das unter „verknüpft“. Kontakte, die schon aus einem früheren Abruf stammen, überspringt Haben.

### Rate-Limit, Abbruch und Fortsetzen

Die API erlaubt etwa zwei Anfragen pro Sekunde. Haben hält zwischen zwei Anfragen mindestens 600 ms Abstand und wiederholt bei Rate-Limit (429) oder Serverfehlern (502, 503, 504) und Netzwerkfehlern bis zu fünfmal, mit wachsender Wartezeit bzw. so lange, wie die API mit `Retry-After` verlangt. Bei einigen hundert Belegen dauert der Abruf deshalb eine Weile.

- **Abbrechen** beendet den Lauf. Ein neuer Abruf überspringt alles, was schon da ist, und setzt dort fort.
- Wird der Server während des Abrufs neu gestartet, markiert Haben den Lauf nach drei Minuten ohne Fortschritt als abgebrochen. Auch dann setzt „Erneut abrufen“ fort.
- Ist der Schlüssel ungültig oder fehlt die Berechtigung (Tarif gewechselt), bricht der Lauf mit Fehlermeldung ab.
- Schlägt ein einzelner Beleg fehl, läuft der Abruf weiter. Die fehlgeschlagenen Belege stehen mit Nummer und Fehlermeldung in einer aufklappbaren Liste; der nächste Abruf versucht sie erneut.

Der Schritt ist erledigt, wenn ein Lauf fertig ist und die Liste der fehlgeschlagenen Belege leer ist.

### Was die API nicht liefert

- **Keine Buchungen.** Kontierung, Umbuchungen und Kontensalden gibt es nur im DATEV-Export (Schritt 4).
- **Keine Bankumsätze.** Die Kontoauszüge holst du bei deiner Bank.
- **Keine übermittelten Voranmeldungen** und keine ELSTER-Protokolle.
- **Kein Anlagenverzeichnis.** Anlagen wie ein Firmenwagen trägst du unter **Anlagen › Anlage übernehmen** mit dem Restbuchwert zum Stichtag ein, siehe [Anlagen und AfA](anlagen.md#übernahme-aus-lexoffice).
- Angebote, Auftragsbestätigungen, Lieferscheine und Mahnungen ruft Haben nicht ab.

## Schritt 3: Offene Posten übernehmen

Rechnungen, die deine Kunden noch nicht bezahlt haben, und Eingangsrechnungen, die du noch zahlen musst, sollen nach dem Umzug in Haben bezahlt werden. Dieser Schritt listet sie auf, sobald der Abruf gelaufen ist. Mit „Übernehmen“ (oder „Alle … übernehmen“) holst du sie herüber:

- Eine offene **Ausgangsrechnung** wird zu einer festgeschriebenen Rechnung in Haben, mit dem Original-PDF und der Rechnungsnummer aus Lexware Office (ohne Nummer `LX-` plus Kurz-ID). Je Steuersatz entsteht eine Position. Der Kunde ist der verknüpfte Kontakt; fehlt er, legt Haben ihn aus der Rechnungsadresse an.
- Ein offener **Ausgabebeleg** wird zu einem gebuchten Beleg mit Zahlung „Bank“, mit Datei, Lieferant, Nummer, Belegdatum, Fälligkeit und Beträgen je Steuersatz. Die Kategorie leitet Haben grob aus den Kategorienamen in Lexware Office ab; sie zählt nur für die Aufteilung in der EÜR.

Danach ordnest du den Zahlungseingang bzw. die Zahlung wie gewohnt im [Bankabgleich](bank.md) zu.

### Wie gebucht wird

Die Erlöse und Aufwände stehen schon in den Büchern von Lexware Office. Haben bucht deshalb nicht noch einmal Erlös oder Aufwand, sondern gegen den Saldenvortrag (Konto 9000), mit dem Datum der Übernahme. Die genauen Buchungssätze stehen in [Buchhaltung in Haben](buchhaltung.md#eröffnungsbuchungen-für-offene-posten-aus-lexoffice).

| Fall | Buchung | Umsatz- bzw. Vorsteuer |
| --- | --- | --- |
| Rechnung, Ist-Versteuerung | Forderung an Umsatzsteuer nicht fällig und Saldenvortrag | Noch nicht angemeldet; wird mit dem Zahlungseingang in Haben fällig und landet in der Voranmeldung des Zahlungsmonats |
| Rechnung, Soll-Versteuerung | Forderung an Saldenvortrag | Schon in Lexware Office angemeldet; Haben zählt sie nicht noch einmal |
| Eingangsbeleg | Saldenvortrag an Verbindlichkeiten | Vorsteuer schon in Lexware Office angemeldet; Haben zählt sie nicht noch einmal |

So wird keine Steuer doppelt angemeldet. In der EÜR von Haben zählt die Zahlung, wenn sie in Haben eingeht oder abfließt, wie jede andere Zahlung.

### Was nicht übernommen wird

Übernehmen lassen sich nur Rechnungen aus dem Rechnungsmodul und Ausgabebelege, die laut Lexware Office offen sind. Statt des Knopfs steht der Grund da, wenn einer dieser Punkte zutrifft:

| Hinweis | Was du tun kannst |
| --- | --- |
| Fremdwährung | Von Hand in Haben erfassen |
| teilweise bezahlt | Den Rest in Lexware Office ausgleichen oder die Zahlung in Haben ohne Rechnung buchen |
| Steuersatz, den Haben nicht kennt | Haben kennt 19 %, 7 % und 0 % |
| Betrag nicht positiv | Gutschriften werden nicht übernommen |
| keine Datei aus Lexoffice | Erst die Datei in Lexware Office anhängen und erneut abrufen |

Außerdem lehnt Haben die Übernahme ab, wenn die Rechnungsnummer in Haben schon vergeben ist, wenn sich die Steuer aus den Positionen nicht centgenau nachbilden lässt (weder mit Netto- noch mit Bruttopreisen, siehe [Rechnungen](rechnungen.md#nettopreise-oder-bruttopreise)) oder wenn die Datei eines Belegs schon als Beleg in Haben liegt (dann bezahlst du dort).

## Schritt 4: Exporte ablegen

Was die API nicht liefert, lädst du als Datei hoch. Wähle die Art, das Geschäftsjahr (beim DATEV-Stapel optional) und eine oder mehrere Dateien (bis zu 50 auf einmal, je höchstens 100 MB):

| Art | Woher | Was Haben damit macht |
| --- | --- | --- |
| DATEV-Buchungsstapel | Lexware Office, DATEV-Export, je Geschäftsjahr die CSV mit den Buchungen | Ablegen und zeilenweise einlesen |
| IDEA-Export | Lexware Office, Export für die Betriebsprüfung | Ablegen |
| ELSTER-Protokoll | Übertragungsprotokolle der Voranmeldungen | Ablegen |
| Kontoauszug | Bank, als PDF | Ablegen |
| Sonstiges | alles andere, was du aufheben willst | Ablegen |

Jede Datei bleibt byte-genau erhalten und liegt unter ihrem SHA-256. Dieselbe Datei zweimal hochzuladen lehnt Haben ab.

> [!IMPORTANT]
> Bei IDEA-Export, ELSTER-Protokollen und Kontoauszügen ist das **Geschäftsjahr** Pflicht; danach richten sich Abgleich und Jahresexport.

### DATEV-Buchungsstapel

Haben erkennt einen Buchungsstapel am Inhalt, auch wenn du eine andere Art gewählt hast. Erwartet wird das DATEV-Format EXTF (oder DTVF), Formatkategorie 21 „Buchungsstapel“, Version 7xx. Andere DATEV-Exporte, etwa Kontenbeschriftungen oder Debitoren/Kreditoren, werden mit Namen abgelehnt.

- **Kodierung:** UTF-8 (mit oder ohne BOM), UTF-16 mit BOM; alles andere liest Haben als Windows-1252.
- **Spalten:** Haben sucht die Spalten über ihren Namen, nicht ihre Position. Pflicht sind Umsatz, Soll/Haben-Kennzeichen, Konto, Gegenkonto und Belegdatum. Beim Vergleich der Namen zählen Groß- und Kleinschreibung, Leerzeichen und Bindestriche nicht, und „ae“, „oe“, „ue“, „ss“ gelten wie „ä“, „ö“, „ü“, „ß“. So passen auch die vereinfachten Namen aus Lexware Office wie „Umsatz“, „Gegenkonto“, „BU-Schluessel“ oder „Basisumsatz“. Übernommen werden außerdem Währung, BU-Schlüssel, Belegfeld 1 und 2, Buchungstext und Beleglink; alle anderen nicht leeren Spalten bleiben je Zeile unverändert gespeichert.
- **Belegdatum:** DATEV schreibt meist nur Tag und Monat (`TTMM`). Das Jahr ergibt sich aus dem Wirtschaftsjahresbeginn in der Kopfzeile; Monate vor dem Beginnmonat gehören ins Folgejahr. Liegt das Datum außerhalb des Zeitraums aus der Kopfzeile, nimmt Haben das andere Kalenderjahr des Zeitraums, sonst gibt es eine Warnung. `TTMMJJJJ` wird direkt gelesen.
- **Geschäftsjahr:** Lässt du das Feld leer, nimmt Haben das Jahr des Wirtschaftsjahresbeginns.
- **Fehler:** Negative Umsätze, ein Soll/Haben-Kennzeichen außer S oder H, fehlende Konten oder ein unmögliches Datum führen zur Ablehnung der ganzen Datei mit Zeilennummer. Hinweise wie „Umsatz ist 0,00“ werden angezeigt, die Datei wird trotzdem übernommen.
- **Überschneidung:** Ein Zeitraum darf nur einmal übernommen werden. Liegt eine schon eingelesene Buchung zwischen dem ersten und dem letzten Datum des neuen Stapels, lehnt Haben die Datei ab und nennt die vorhandene.

Ein [KI-Assistent](ki-assistenten.md#voranmeldungen-aus-lexware-office-vergleichen) liest die Salden je Konto und Monat und die einzelnen Buchungen über die Werkzeuge `lexoffice_konten` und `lexoffice_buchungen`.

Unter **DATEV-Buchungen** siehst du die Zeilen je Jahr, durchsuchbar nach Text, Belegfeld und Konto, und darunter die Umsätze je Konto. Dort, wo eine Steuerautomatik greift, sind die Beträge brutto; die Steuer ist nicht auf ein Steuerkonto aufgeteilt.

## Schritt 5: Abgleich je Jahr

Für jedes Geschäftsjahr, aus dem Belege, Buchungen oder Dateien vorliegen, zeigt Haben eine Karte mit Prüfungen. Ein Jahr ist „vollständig“, wenn alle erfüllt sind:

| Prüfung | Erfüllt, wenn |
| --- | --- |
| Belege und Rechnungen per API abgerufen | mindestens ein Beleg mit Datum in diesem Jahr vorliegt |
| Jeder Beleg hat eine Datei | kein Beleg des Jahres ohne Datei ist; „Belege ohne Datei ansehen“ zeigt die Liste |
| DATEV-Buchungsstapel übernommen | Buchungen mit Datum in diesem Jahr eingelesen sind |
| Jede Buchung mit Belegnummer findet ihren Beleg | für jede Buchung mit Belegfeld 1 ein Lexoffice-Beleg mit derselben Nummer existiert (Leerzeichen und Groß-/Kleinschreibung egal); Buchungen ohne Belegnummer, etwa Umbuchungen, werden nur gezählt |
| IDEA-Export archiviert | eine Datei der Art IDEA mit diesem Jahr vorliegt |
| ELSTER-Protokolle archiviert | mindestens ein ELSTER-Protokoll mit diesem Jahr vorliegt |
| Kontoauszüge archiviert | mindestens ein Kontoauszug mit diesem Jahr vorliegt |

Daneben stehen Einnahmen netto, Umsatzsteuer, Ausgaben netto und Vorsteuer, jeweils nach Belegdatum, und die letzte Rechnungsnummer des Jahres. Vergleiche die Summen mit den Auswertungen in Lexware Office.

Gibt es für ein Jahr keine Belege per API (etwa im Tarif ohne Public API), rechnet Haben die Summen aus dem DATEV-Buchungsstapel: Erlöse und Aufwand nach den Kontenklassen des Kontenrahmens (SKR03: 8 sowie 3 und 4; SKR04: 4 sowie 5 und 6), die Steuer aus Automatikkonten und den BU-Schlüsseln 2, 3, 8 und 9 oder aus Buchungen auf den Umsatz- und Vorsteuerkonten. Personenkonten (Debitoren und Kreditoren, länger als die Sachkontenlänge aus der Kopfzeile) zählen nicht mit; fünfstellige Sachkonten wie 84000 liest Haben wie 8400. Das ist eine Näherung; Sonderfälle wie § 13b stehen nur über die Steuerkonten drin.

### Umsatzsteuer je Monat

Aufgeklappt zeigt jede Karte eine Tabelle je Monat, berechnet aus den abgerufenen Belegen:

| Spalte | Inhalt |
| --- | --- |
| Kz 81 | Bemessungsgrundlage (netto) der Umsätze zu 19 % |
| Kz 86 | Bemessungsgrundlage (netto) der Umsätze zu 7 % |
| Kz 66 | Vorsteuer aus Ausgabebelegen nach Belegdatum |
| Kz 21, 41, 43, 45, 60, 87 | Sonderfälle nach der Steuerart der Rechnung in Lexware Office (siehe unten); die Spalte erscheint nur, wenn im Jahr etwas drinsteht |
| Steuerfrei | Rechnungen mit Steuerart „steuerfrei“: Kz 48, wenn sie nach § 4 Nr. 8–28 UStG steuerfrei sind, bei Kleinunternehmern gar nicht gemeldet |
| OSS | Fernverkäufe und elektronische Dienstleistungen ins EU-Ausland über das OSS-Verfahren; gehören nicht in die Voranmeldung |
| Andere Sätze | Umsätze zu 0 % und Altsätzen (16 %, 5 %) sowie unbekannte Steuerarten, nur zur Information |

Die Steuerart liest Haben aus der gespeicherten Antwort der API (`taxConditions.taxType`), auch für schon abgerufene Belege:

| Steuerart in Lexware Office | Kennzahl |
| --- | --- |
| Netto, Brutto | Kz 81 (19 %), Kz 86 (7 %), sonst „Andere Sätze“ |
| Innergemeinschaftliche Lieferung (`intraCommunitySupply`) | Kz 41 |
| Fremdleistung § 13b EU (`externalService13b`) | Kz 21 |
| Bauleistung § 13b (`constructionService13b`) | Kz 60 |
| Dienstleistung Drittland (`thirdPartyCountryService`) | Kz 45 |
| Ausfuhrlieferung Drittland (`thirdPartyCountryDelivery`) | Kz 43 |
| Photovoltaik 0 % (`photovoltaicEquipment`) | Kz 87 |
| Steuerfrei (`vatfree`) | Steuerfrei |
| mit Unterart Fernverkauf oder elektronische Dienstleistung | OSS |

Kz 21, 41 und 60 zählen auch bei Ist-Versteuerung im Monat des Belegdatums, die übrigen wie die regulären Umsätze. Die Eingangsseite von § 13b (Kz 46, 47, 84, 85, 67) rechnet Haben nicht nach: Buchhaltungsbelege tragen in der API keine eigene Steuerart dafür.

Bei Soll-Versteuerung zählen Einnahmen nach Belegdatum. Bei Ist-Versteuerung zählen sie anteilig nach Datum der einzelnen Zahlungen aus dem Zahlungsstatus; Skonto, Mahnkosten, Kursdifferenzen und Forderungsausfälle zählen dabei nicht. Gutschriften mindern die Umsätze.

Lege die übermittelten Voranmeldungen (ELSTER-Protokolle) daneben und vergleiche Monat für Monat. Mit einem [KI-Assistenten](ki-assistenten.md#voranmeldungen-aus-lexware-office-vergleichen) geht das auch im Gespräch, bis auf den einzelnen Beleg. Bemessungsgrundlagen meldet ELSTER in vollen Euro, kleine Abweichungen im Centbereich sind also normal. Größere Abweichungen entstehen, wenn in Lexware Office nachträglich etwas korrigiert, eine Voranmeldung von Hand angepasst oder eine Rechnung storniert wurde. Kläre sie vor der Kündigung.

### Rechnungsnummern weiterzählen

Im laufenden Jahr erinnert die Karte daran, die nächste Rechnungsnummer in den [Einstellungen](einrichtung.md) auf die Nummer nach der letzten aus Lexware Office zu setzen, damit der Nummernkreis lückenlos weiterläuft.

## Unveränderlich archiviert

Abgerufene Belege, ihre Dateien, archivierte Exporte und DATEV-Buchungen kann niemand mehr ändern oder löschen, auch nicht direkt in der Datenbank: Postgres-Trigger lehnen `UPDATE` und `DELETE` ab. Das Ablegen jeder Datei und jeder Abruf stehen im Änderungsprotokoll. Ändern dürfen sich nur der gespeicherte Schlüssel und der Fortschritt eines laufenden Abrufs.

Unter **Belege** findest du den Altbestand je Jahr, filterbar nach Einnahmen und Ausgaben, nach Nummer, Kontakt oder Notiz durchsuchbar und mit dem Filter „ohne Datei“. Jeder Beleg zeigt die Beträge je Steuersatz, die Kategorien, den Zahlungsstatus und seine Dateien. Unter **Originaldateien** liegen die hochgeladenen Exporte zum Herunterladen.

Im [Jahresexport](auswertungen.md#jahresexport) steht der Altbestand jedes Jahres unter `lexoffice/`: Belege mit Originaldateien, `belege.csv`, `datev-buchungen.csv` und die Originalexporte unter `originale/`.

## Andere API-Adresse

Haben spricht standardmäßig mit `https://api.lexware.io/v1`. Mit der Umgebungsvariable `LEXOFFICE_API_URL` setzt du eine andere Basis-URL, etwa zum Testen gegen einen nachgestellten Server oder falls Lexware die Adresse ändert. Die ältere Adresse `https://api.lexoffice.io/v1` sollte ebenfalls funktionieren.

## Grenzen

- Der Client ist noch nicht gegen ein echtes Lexware-Konto gelaufen (siehe Hinweis oben).
- Buchungen kommen nur aus dem DATEV-Stapel und werden archiviert, nicht in das Journal von Haben übernommen. Kontensalden und Saldenvorträge musst du für den Jahreswechsel selbst bzw. mit deiner Steuerberatung festhalten.
- Der Abgleich prüft Vollständigkeit und Nummern, keine Kontierung. Summen und Umsatzsteuer vergleichst du selbst mit Lexware Office.
- Die Umsatzsteuer je Monat kennt keine Eingangsseite von § 13b (Kz 46, 47, 84, 85, 67), keine Berichtigungen nach § 17 und keine von Hand geänderten Voranmeldungen.
- Teilweise bezahlte Posten, Gutschriften, Fremdwährung und andere Steuersätze als 19, 7 und 0 % werden nicht als offene Posten übernommen.
- Bei ungeprüften Belegen ohne Belegdatum nimmt Haben das Anlagedatum; solche Belege haben oft keine Beträge.

## Vor der Kündigung

- [ ] Abruf ist fertig, die Liste der fehlgeschlagenen Belege ist leer
- [ ] Für jedes Geschäftsjahr: DATEV-Buchungsstapel, IDEA-Export, ELSTER-Protokolle und Kontoauszüge abgelegt, jeweils mit Jahr
- [ ] Jedes Jahr zeigt „vollständig“
- [ ] Einnahmen, Ausgaben, Umsatz- und Vorsteuer je Jahr mit Lexware Office verglichen
- [ ] Umsatzsteuer je Monat mit den übermittelten Voranmeldungen verglichen
- [ ] Offene Posten übernommen oder die Gründe geklärt
- [ ] Nächste Rechnungsnummer in Haben gesetzt
- [ ] Jahresexport für jedes übernommene Jahr heruntergeladen und die Prüfsummen geprüft
- [ ] Backup von Datenbank und Belegdateien läuft ([Installation](installation.md))
- [ ] API-Schlüssel in Haben entfernt und in Lexware Office widerrufen

> [!NOTE]
> Stimme den Umzug mit deiner Steuerberatung ab, besonders die Saldenvorträge zum Jahreswechsel und die Frage, welche Unterlagen du in welcher Form aufbewahren musst.
