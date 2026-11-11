---
title: "Umzug aus Accountable ohne Datenverlust"
description: >-
  Von Accountable zu Haben wechseln: Exporte übernehmen, Buchungen und Belege verknüpfen,
  im unveränderlichen Archiv aufbewahren und das Abo kündigen.
---

# Umzug aus Accountable

Haben übernimmt deinen Bestand aus Accountable, damit du kündigen kannst, ohne Daten zu verlieren. Der Umzug läuft auf der Seite „Archiv“ unter „Umzug“: Wähle oben „Umzug aus Accountable“. Die Schritte bis zum Abgleich sind dieselben wie beim [Umzug aus Lexoffice](lexoffice.md); diese Seite beschreibt, was bei Accountable anders ist.

Accountable hat keinen API-Zugang. Es gibt deshalb keine Verbindungskarte mit Schlüssel oder Token, und Haben liest nichts direkt aus deinem Accountable-Konto. Du lädst die Exportdatei hoch, Haben liest daraus den DATEV-Buchungsstapel, entpackt die Belege und verknüpft beides.

Für eine GmbH oder UG gilt dasselbe wie beim [Umzug aus Lexoffice](lexoffice.md#umzug-einer-gmbh-oder-ug): Die Bestände über die offenen Posten hinaus übernimmst du mit einer Eröffnungsbuchung.

> [!WARNING]
> Der Accountable-Import ist gegen echte Exporte (Stand November 2026) gebaut und damit getestet. Accountable kann Aufbau und Belegnamen ohne Ankündigung ändern. Prüfe nach dem Hochladen den Punkt „Jeder Beleg hat eine Datei“ im Abgleich und kündige erst, wenn er für jedes Jahr aufgeht.

## Schritt 1: Export bei Accountable erstellen

Accountable exportiert mehrere Dinge getrennt. Für den Umzug brauchst du einen einzigen Export:

1. In Accountable auf „Datenexport“ gehen und „DATEV“ wählen.
2. Den Kontenrahmen so wählen, wie er in Haben eingestellt ist, bei einer Einzelunternehmung in der Regel SKR03.
3. „Originaldokumente beifügen“ einschalten. Ohne diesen Schalter enthält der Export nur Buchungen und keine PDFs, und Haben meldet „Jeder Beleg hat eine Datei“ als offen.
4. Zeitraum: das ganze Geschäftsjahr (`01.01.` bis `31.12.`).
5. „Export-Datei erstellen“ und herunterladen.

Die Datei heißt danach `Accountable_<Vorname>_<Nachname>_skr03_<Datum>_<Zufall>.zip`. Sie trägt den Kontenrahmen im Namen (`skr03` oder `skr04`), und daran erkennst du den DATEV-Export. Die Nummer, die der Browser beim zweiten Download anhängt, sagt nichts über den Inhalt, die Dateigröße ebenso wenig.

Die anderen Exporte desselben Vorgangs (Excel-Export, Originaldokumente, PDF-Export, Vermögenswerte) brauchst du für den Umzug nicht.

> [!NOTE]
> Accountable rechnet den Buchungsstapel nach Zahlungsdaten; das passt zur Ist-Versteuerung. Der Stapel allein kennt deshalb keine offenen Posten. Was noch nicht bezahlt war, erkennt Haben an `Daten.xlsx` (siehe [Kategorie und Zahlungsstatus](#kategorie-und-zahlungsstatus)); nur diese Belege stehen in Schritt 3 zur Übernahme.

## Was in der Datei steckt

- der DATEV-Buchungsstapel (`EXTF_Buchungsstapel_<Jahr>….csv`, Windows-1252) im Ordner `datev_skr03_<Datum>`
- die Belege in `Belege.zip` samt `document.xml`, das jedem Beleg eine GUID zuordnet
- die Belegdateien unter `PDF/Einkäufe` (Ausgaben) und `PDF/Umsätze` (Ausgangsrechnungen)
- je Buchung die Verknüpfung zur Belegdatei im Feld „Beleglink“ (`BEDI "<GUID>"`)
- `Daten.xlsx`: Der Import liest daraus das Sheet „Ausgaben“ mit Buchungscode, Lieferant und Zahlungsstatus (siehe [Kategorie und Zahlungsstatus](#kategorie-und-zahlungsstatus)); die übrigen Sheets bleiben nur im Archiv
- `Abschreibungstabelle.xlsx`: wird mit der ZIP archiviert, aber nicht eingelesen

Die ZIP ist die einzige Schnittstelle zwischen den beiden Programmen.

Die Zuordnung Buchung zu Beleg läuft über die GUID und nicht über den Dateinamen. Derselbe Beleg heißt in `Belege.zip` anders als im PDF-Ordner (etwa `…_012` gegen `…_Wdn`). Wenn du vor dem Upload Dateien umbenennst, geht die Verknüpfung kaputt. Lade die ZIP unverändert hoch, Haben speichert sie mit Prüfsumme im Archiv.

Du kannst je Geschäftsjahr eine ZIP wählen oder mehrere auf einmal hochladen; jede darf höchstens 100 MB groß sein. Haben nimmt sie der Reihe nach und übernimmt jede für sich. Wie im Archiv gilt: Jeder Zeitraum wird nur einmal übernommen. Liegt für das Jahr schon ein Buchungsstapel im Archiv, etwa aus einem früheren Export desselben Jahres, bricht der Lauf mit einem Hinweis ab, statt die Buchungen doppelt abzulegen. Dieselbe ZIP noch einmal hochzuladen geht dagegen und übernimmt nur, was fehlt.

## Was übernommen wird

1. Aus Buchungen werden Belege. Accountable bucht jede Ausgabe einzeln gegen das Bankkonto 1200, Gegenkonto ist das Aufwandskonto. Daraus entstehen Archivbelege mit Datum, Brutto und Steuer.
2. Steuer und Netto richten sich nach dem BU-Schlüssel. Steht im Stapel einer (19 oder 7 %), ist der Umsatz brutto und Haben rechnet Steuer und Netto heraus. Ohne BU-Schlüssel gilt der Betrag als steuerfrei gebucht.
3. Die Belegdatei aus `document.xml` wird über die GUID als Original an den Archivbeleg gehängt. Fehlt eine verlinkte Datei, steht das als Hinweis am Lauf.
4. Der Lieferant kommt aus dem Buchungstext, ohne Vorsätze wie „ER“, „AR“, „EB“ oder „AB“.

Private Zeilen bleiben Zahlungen ohne Beleg: im SKR03 der ganze Privatbereich `1800` bis `1899`, also Privatentnahmen (`1800`, `1801`), Privatsteuern (`1810`), Sonderausgaben und Privateinlagen (`1890`), und Umbuchungen zwischen Unterkonten des Kontos 1200 (`1360`), im SKR04 Privat (`2100` bis `2199`) und Geldtransit (`1460`). Der Import zählt sie und legt dafür nichts an. Den Kontenrahmen liest Haben aus dem Ordnernamen im Export (`datev_skr03_…` bzw. `datev_skr04_…`).

Die Belege landen im Archiv, mit ihrer Datei. Belege in Haben legt der Import nicht an: Accountable bucht zahlungsbasiert, die Belege sind dort bezahlt und die Vorsteuer ist angemeldet. Als Beleg in Haben stünden sie als offene Verbindlichkeit im Bankabgleich. Was am Stichtag noch offen war (in `Daten.xlsx` nicht bezahlt), übernimmst du in Schritt 3 wie bei Lexoffice.

### Belegnummern sind synthetisch

Accountable vergibt für Ausgaben keine fortlaufende Belegnummer. Im DATEV-Stapel steht im Belegfeld 1 bei Ausgaben ein zusammengesetztes Kennzeichen `TTMMJJJJ_<Cent>`, etwa `04112026_3841` für 38,41 €. Bei Ausgangsrechnungen steht dort die echte Rechnungsnummer.

Im Archiv erscheint jede Ausgabe unter diesem Kennzeichen, du kannst danach suchen oder nach Jahr und Betrag filtern. Beim Belegabgleich mit dem DATEV-Stapel aus Schritt 4 findet Haben die Zeilen nur, wenn derselbe Stapel eingelesen ist. Wiederholen sich synthetische Belegnummern (gleicher Tag, gleicher Betrag), ordnet Haben die Buchung dem Beleg des Imports zu und nicht einer zweiten Buchung. Verlass dich beim Vergleich deshalb auf die Summen je Jahr und die Umsatzsteuer je Monat statt auf jeden Einzelposten.

## Was nicht übernommen wird

| Fehlt | Warum | Wo es herkommt |
| --- | --- | --- |
| IDEA-Export (GoBD-Datenexport für die Betriebsprüfung) | Accountable liefert ihn nicht im Buchungsstapel-Export mit | Accountable, Export „IDEA“, in Schritt 4 als IDEA-Export ablegen |
| Steuererklärungen (Einkommensteuer bzw. Körperschaft- und Gewerbesteuer, Umsatzsteuer-Jahreserklärung) | nicht Teil des Exports | Accountable bzw. das Finanzamt, als PDF in Schritt 4 ablegen |
| Ausgangsrechnungen mit Positionen | Der DATEV-Stapel enthält je Buchung nur Brutto, Steuer und Buchungstext, keine Positionen. Haben verlangt für eine Rechnung Positionen. Der Import zählt die Ausgangsrechnungen und meldet sie, angelegt werden sie nicht | in Haben neu schreiben oder als Bestand über die Eröffnungsbuchung führen |
| Kontakte als Datensatz | nur als Sheet im Excel-Export | [CSV-Import](csv-import.md#kontakte) oder von Hand |
| Bankumsätze und übermittelte Voranmeldungen | Voranmeldungen sind nicht im Export; die Bankumsätze stehen nur im Sheet „Kontobewegungen“ von `Daten.xlsx`, das der Import nicht einliest | Kontoauszüge als PDF, Voranmeldungen als Protokolle ablegen |
| Anlagenverzeichnis | `Abschreibungstabelle.xlsx` wird nur archiviert, nicht eingelesen | [Anlagen übernehmen](anlagen.md) |

## Bankumsätze kommen aus den Kontoauszügen

Das Sheet „Kontobewegungen“ in `Daten.xlsx` enthält dieselben Zahlungen wie die Kontoauszüge, nur mit dem Zahlungsdatum statt dem Buchungsdatum. Ein Konto bekommt seine Umsätze deshalb aus einer Quelle. Wer die Auszüge importiert, lässt den Export als Bankquelle weg; wer aus dem Export importiert, importiert für denselben Zeitraum keinen Auszug mehr. Gemischt ergibt das doppelte Umsätze, weil der Dubletten-Hash das Datum enthält; Haben meldet den Fall beim Import (siehe [Bank](bank.md#dubletten)).

## Kategorie und Zahlungsstatus

Die Kategorie kommt aus dem Buchungscode in `Daten.xlsx` (Sheet „Ausgaben“) und nicht aus dem Gegenkonto, weil der Code feiner ist als der Kontenrahmen. Haben bildet ihn so ab:

| Code | Accountable | Haben |
| --- | --- | --- |
| 0490 | Elektronik/IT | `hardware`; über 800 € netto je Buchung `anlage` (wird abgeschrieben) |
| 0420 | Büroeinrichtung | `buero` (Haben hat keinen Möbel-Topf) |
| 4280 | Dekoration | `buero` |
| 4288 | Miete/Nebenkosten häusliches Arbeitszimmer | `miete` |
| 4670 | Öffentliche Verkehrsmittel | `fahrtkosten` |
| 4806 | Hosting | `edv` |
| 4909 | Fremdleistungen | `fremdleistung` |
| 4910 | Briefmarken & Porto | `porto` |
| 4920 | Telefon | `telefon` |
| 4925 | Internet | `internet` |
| 4930 | Büromaterial | `buero` |
| 4964 | Software-Abo | `software` |
| 4970 | Bankgebühren | `geldverkehr` |

Einen unbekannten Code rät der Import nicht. Der Beleg landet unter „Sonstiger Aufwand“ (`sonstiges`), der Code steht als Hinweis am Lauf. Die passende Zeile findet Haben über Belegfeld 1 (`TTMMJJJJ_Cent`), sonst über Datum und Betrag. Passen Datum und Betrag auf mehrere Zeilen, bleibt die Buchung ohne die Angaben aus `Daten.xlsx` und der Fall steht als Hinweis am Lauf.

Der Zahlungsstatus kommt aus den Spalten „Bezahlt“ und „Zahlungsdatum“ derselben Zeile. Nicht bezahlt heißt offener Posten über den Bruttobetrag. Fehlt `Daten.xlsx`, gilt der Beleg wie bisher als bezahlt, weil der Stapel zahlungsbasiert über 1200 bucht.

Zwei Konten bleiben anders beschrieben, als Accountable sie meint:

- 4288 ist bei Accountable das häusliche Arbeitszimmer. Haben führt 4288 als Homeoffice-Tagespauschale (`Häusliches Arbeitszimmer, Tagespauschale`). Meint eine Buchung die Jahrespauschale oder tatsächliche Zimmerkosten, ändere sie nach dem Import auf die passende Kategorie und prüfe den Abzug in der EÜR.
- 4985 gibt es in Haben nicht. Buche die betroffenen Belege auf 4980 (Sonstiger Betriebsbedarf) um. Die Kategorie kommt trotzdem aus `Daten.xlsx`, das Konto bleibt nur als Herkunft im Beleg stehen.

Private Zeilen (SKR03 Gegenkonto 1800 bis 1899 und 1360; SKR04 2100 bis 2199, 1460) bleiben Zahlungen ohne Beleg; dazu gehören auch die Privatanteile der Arbeitszimmer-Buchungen und der 20-%-Privatanteil einer Geräterechnung.

## Belegverknüpfung außerhalb des Imports

Die GUID-Verknüpfung aus `document.xml` wertet nur der Import aus. Außerhalb des Imports gibt es dafür keinen Weg, weil die Buchungen, die du in Schritt 4 als DATEV-Buchungsstapel ablegst, keine `document.xml` mitbringen. Der Belegabgleich dort ordnet Buchungen über die Belegnummer zu, und die ist bei Accountable-Ausgaben synthetisch (`TTMMJJJJ_Cent`), siehe oben. Diese Zeilen bleiben deshalb ohne passenden Beleg. Was wirklich verknüpft ist, sagen der Fortschritt des Imports und der Punkt „Jeder Beleg hat eine Datei“.

## Schritt 2: Export hochladen und übernehmen

Unter „Umzug aus Accountable“ wählst du eine oder mehrere Exportdateien und klickst „Hochladen und übernehmen“. Haben liest den Stapel, entpackt `Belege.zip`, hängt die Dateien über die GUID an und zeigt dasselbe wie bei den anderen Quellen:

- Belege gefunden: wie viele Buchungen mit Belegbezug im Stapel stehen
- übernommen: wie viele schon im Archiv sind (ein zweiter Upload überspringt, was da ist)
- Dateien: wie viele Belegdateien angekommen sind

Fehlende Belege (`document.xml` ohne Datei, GUID ohne Eintrag) und private Zeilen stehen als Hinweis am Lauf. Abbrechen geht jederzeit, schon Übernommenes bleibt.

## Schritt 3 bis 5

Offene Posten, Exporte ablegen und Abgleich je Jahr funktionieren wie beim [Umzug aus Lexoffice](lexoffice.md#schritt-3-offene-posten-übernehmen). Unterschiede:

- IDEA-Export und Steuererklärungen liefert Accountable nicht mit. Lade sie in Schritt 4 getrennt hoch, sonst fehlt die Prüfung „IDEA-Export archiviert“.
- Bei Ausgangsrechnungen fehlen Positionen. Sie erscheinen im Import nur als Meldung und zählen im Abgleich deshalb nicht als Rechnung mit Datei.
- Beim Punkt „Jede Buchung mit Belegnummer findet ihren Beleg“ zählen Privat-, Geldtransit- und Vortragszeilen nie mit, bei jeder Herkunft und je nach Kontenrahmen. Erlösbuchungen zählen nur im Stapel aus dem Accountable-Umzug nicht mit, weil Accountable keine Ausgangsrechnungen exportiert. Aus Lexoffice und sevDesk fehlt die Rechnung zu einer Erlösbuchung dagegen wirklich.
- Die Buchungen aus dem Accountable-Stapel sind dieselben, die du in Schritt 4 noch einmal als DATEV-Buchungsstapel ablegst. Der Abgleich erkennt sie an ihren Belegnummern, synthetisch bei Ausgaben, echt bei Ausgangsrechnungen.
- Die letzte Rechnungsnummer für Schritt 5 steht nicht im Stapel. Trage sie aus Accountable von Hand in den Einstellungen nach.

## Rechnungen mit mehreren Buchungscodes

Accountable kann eine Rechnung auf mehrere Konten verteilen. Im Ausgabenblatt steht dann je
Konto eine Zeile, alle mit demselben Lieferanten und Datum, aber ohne Belegnummer, die sie
zusammenbindet. Beim Export fehlt damit die Angabe, welche Zeilen eine Rechnung sind.

Spalte Y, Dokument vorhanden, gilt für die ganze Rechnung und nicht für die einzelne Zeile:
sie steht auch an den Zeilen, die keinen eigenen Dateinamen tragen. Im Belege-Ordner liegt die
Datei einmal, benannt nach Datum und Lieferant.

Wer die Zeilen einzeln übernimmt, bekommt deshalb einen Beleg über den Teilbetrag einer Zeile,
während die übrigen ohne Buchung bleiben und im Aufwand und in der Vorsteuer fehlen.

Der Umzug auf der Seite „Archiv“ fasst solche Zeilen nicht zusammen. Prüfe sie nach dem
Import, besonders wenn Datum und Betrag auf mehrere Zeilen passen (siehe
[Kategorie und Zahlungsstatus](#kategorie-und-zahlungsstatus)). Wer den Bestand mit einem
eigenen Exportadapter vorbereitet, kann solche Zeilen dort zusammenfassen und das Paket über
den [Belegimport](belegimport.md) übernehmen.

Ob mehrere Zeilen eine Rechnung sind, bleibt eine Annahme, weil zwei getrennte Käufe beim
selben Händler am selben Tag genauso aussehen.

## Vor der Kündigung

- [ ] Für jedes Geschäftsjahr ist der DATEV-Export hochgeladen und der Lauf ist fertig
- [ ] Jeder Beleg hat eine Datei (Abgleich je Jahr), oder die fehlenden sind geklärt
- [ ] IDEA-Export und Steuererklärungen getrennt abgelegt
- [ ] Kontakte angelegt (CSV-Import oder von Hand)
- [ ] Ausgangsrechnungen, die du weiter brauchst, in Haben geschrieben oder über die Eröffnungsbuchung geführt
- [ ] Konten 4288 und 4985 geprüft und bei Bedarf auf Homeoffice-Tagespauschale bzw. 4980 geändert
- [ ] Offene Posten übernommen oder die Gründe geklärt
- [ ] Einnahmen, Ausgaben, Umsatz- und Vorsteuer je Jahr mit Accountable verglichen
- [ ] Nächste Rechnungsnummer in Haben gesetzt
- [ ] Jahresexport für jedes übernommene Jahr heruntergeladen
