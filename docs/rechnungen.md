# Rechnungen und E-Rechnung

Haben schreibt Ausgangsrechnungen als E-Rechnung: ZUGFeRD (PDF/A-3 mit eingebettetem XML, Profil EN 16931) oder XRechnung 3.0 in CII- oder UBL-Syntax. Eine Rechnung ist zuerst ein Entwurf, den du beliebig ändern kannst. Mit dem Festschreiben bekommt sie ihre Nummer, PDF und XML werden erzeugt, sie wird gebucht und ist danach unveränderlich.

<img src="screenshot-rechnung.png" alt="Rechnungseditor mit Kunde, Leistungszeitraum, Positionen und Live-Vorschau der Rechnung rechts daneben" width="900">

## Voraussetzungen

Bevor du die erste Rechnung festschreibst, brauchst du:

- **Firmendaten** unter Einstellungen: Firmenname, Anschrift, E-Mail-Adresse, IBAN und Steuernummer oder USt-IdNr. Fehlt etwas, zeigt der Editor oben „Vor dem Festschreiben: …“ mit einem Link „Firmendaten ergänzen“. Siehe [einrichtung.md](einrichtung.md).
- **Einen Kontakt** für den Kunden (siehe [Kontakte](#kontakte)).
- Für XRechnung zusätzlich eine **Telefonnummer** in den Firmendaten und beim Kunden eine **E-Mail-Adresse oder Leitweg-ID**.

## So gehst du vor

1. Unter **Rechnungen** auf **Neue Rechnung** klicken.
2. **Kunde** wählen. Hat der Kontakt ein Standardformat, wird es übernommen; hat er eine Leitweg-ID und kein Standardformat, stellt Haben auf XRechnung 3.0 (CII) um.
3. **Rechnungsdatum** und **Zahlungsziel in Tagen** (0 bis 120) eintragen. Darunter steht das errechnete Fälligkeitsdatum (siehe [Fälligkeit](#fälligkeit)). Vorgabe für das Zahlungsziel ist der Wert aus den Firmendaten.
   Optional **Skonto**: je Stufe Satz und Frist in Tagen, vorbelegt vom Kunden oder aus den Firmendaten (siehe [Skonto](#skonto)).
4. Optional **Leistung von** und **Leistung bis**. Ohne Angabe gilt das Rechnungsdatum als Leistungsdatum; ist nur ein Tag angegeben oder sind beide gleich, erscheint auf der Rechnung „Leistungsdatum“, sonst „Leistungszeitraum“.
5. **E-Rechnungsformat** prüfen.
6. Unter **Umsatzsteuer** die steuerliche Behandlung wählen, im Normalfall „Regulär besteuert“ (siehe [Umsatzsteuer auf der Rechnung](#umsatzsteuer-auf-der-rechnung)).
7. Unter **Preise** wählen, ob die Einzelpreise netto oder brutto inklusive Umsatzsteuer gelten (siehe [Netto- oder Bruttopreise](#nettopreise-oder-bruttopreise)). Vorgabe ist netto.
8. Optional eine **Einleitung über den Positionen** eintragen (Kopftext, bis 2000 Zeichen), etwa Bestellnummer, Rahmenvertrag oder Anrede. Vorbelegt ist sie mit der Standard-Einleitung für Rechnungen aus den [Firmendaten](einrichtung.md). **Textbaustein einfügen** übernimmt einen gespeicherten Kopftext (siehe [Textbausteine](#textbausteine)).
9. **Positionen** erfassen: Beschreibung, Menge, Einheit, Einzelpreis und Steuersatz. Mit **+ Position hinzufügen** kommt eine weitere Zeile dazu; sie übernimmt Einheit und Steuersatz der letzten Zeile.
10. Optional einen **Hinweis auf der Rechnung** eintragen (Fußtext unter den Summen, bis 2000 Zeichen), auch aus einem Textbaustein.
11. **Entwurf speichern** oder direkt **Festschreiben**. Das Festschreiben fragt einmal nach: erst der zweite Klick auf **Jetzt festschreiben** führt es aus.

Rechts zeigt die Vorschau die Rechnung, während du tippst. Die Überschrift im Editor nennt die Nummer, die die Rechnung voraussichtlich bekommt; vergeben wird sie erst beim Festschreiben.

Einen Entwurf, den du nicht mehr brauchst, entfernst du mit **Entwurf löschen**. Das geht nur, solange er nicht festgeschrieben ist.

### Positionen

| Feld | Werte |
| --- | --- |
| Beschreibung | Bezeichnung der Position, eine Zeile, z. B. `Beratung Softwarearchitektur`. Pflicht. Steht im XML als Artikelname (BT-153). |
| Text zu Position | Optional, mehrzeilig, bis 2000 Zeichen, z. B. Leistungsumfang oder Bestellbezug. Steht im PDF in kleinerer Schrift unter der Bezeichnung, die dann halbfett ist, und im XML als Artikelbeschreibung (BT-154). Storno und Rechnungskorrektur übernehmen ihn, ebenso Rechnungen aus einem Angebot oder einer Vorlage und der Lieferschein. Angebote und wiederkehrende Rechnungen haben dasselbe Feld. |
| Menge | Bis zu drei Nachkommastellen, z. B. `0,5` oder `152`. Muss größer als null sein. |
| Einheit | `Std.`, `Tag`, `Monat`, `Stk.`, `Psch.`, `km` |
| Einzelpreis | In Euro, z. B. `95,00`. Negative Preise sind möglich, etwa für einen Rabatt. |
| Steuersatz | 19 %, 7 % oder 0 % |

Der Zeilenbetrag ist Menge mal Einzelpreis, kaufmännisch auf Cent gerundet. Bei Nettopreisen rechnet Haben die Umsatzsteuer nach EN 16931 je Steuersatz auf die Summe der Zeilennetto, nicht als Summe der Steuer je Zeile. Bei mehreren Steuersätzen weist das PDF die Steuer je Satz mit ihrer Bemessungsgrundlage aus.

Die Einheiten gehen mit ihren UN/ECE-Codes ins XML (`HUR`, `DAY`, `MON`, `H87`, `LS`, `KMT`).

### Nettopreise oder Bruttopreise

Zwischen Unternehmen sind Nettopreise üblich, das ist die Vorgabe. Wer an Verbraucher verkauft, nennt Endpreise inklusive Umsatzsteuer, z. B. 9,80 € für einen Fotoabzug. Netto lässt sich so ein Preis oft nicht centgenau treffen: 8,23 € netto ergeben 9,79 €, 8,24 € netto 9,81 €. Mit **Preise: Brutto, inklusive Umsatzsteuer** gibst du die Endpreise direkt ein.

| | Netto (Vorgabe) | Brutto |
| --- | --- | --- |
| Einzelpreis | ohne Umsatzsteuer | mit Umsatzsteuer |
| Berechnung | Summe netto je Steuersatz, Umsatzsteuer darauf | Summe brutto je Steuersatz, Umsatzsteuer daraus herausgerechnet (bei 19 % brutto × 19/119), Netto ist die Differenz |
| Letzte Spalte in Vorschau und PDF | Netto | Brutto |
| Summenblock | Summe netto, Umsatzsteuer je Satz, Gesamtbetrag | Gesamtbetrag (inkl. USt), darunter „darin enthalten“ Netto und Umsatzsteuer je Satz |

Der Gesamtbetrag stimmt damit auf den Cent mit den Endpreisen überein. Weil die Steuer aus der Summe je Satz herausgerechnet wird und nicht je Zeile, kann sie einen Cent von der Summe der einzelnen Zeilen abweichen; so verlangt es auch EN 16931.

- Bruttopreise gibt es nur bei „Regulär besteuert“. Ohne Steuerausweis (Kleinunternehmer, Reverse Charge, steuerfrei, Nicht-EU-Ausland) sind netto und brutto gleich; Haben speichert die Rechnung dann als netto.
- Stornorechnung und Rechnungskorrektur rechnen immer wie die ursprüngliche Rechnung. Die Stornorechnung hebt sie auf den Cent genau auf.
- Eine Schlussrechnung mit Bruttopreisen zieht die Abschlagsrechnungen brutto ab, also mit Netto und Umsatzsteuer der Abschlagsrechnung zusammen. Legst du sie aus einer Abschlagsrechnung an, übernimmt sie deren Preismodus.
- Angebote und wiederkehrende Rechnungen haben dieselbe Auswahl. Eine Rechnung aus einem Angebot oder einer Vorlage übernimmt den Preismodus.
- Den Preismodus zu wechseln rechnet die eingegebenen Preise nicht um. Die eingetragenen Beträge gelten ab dann als netto bzw. brutto.

**In der E-Rechnung** stehen immer Nettobeträge, so verlangt es EN 16931. Haben verteilt das Netto je Steuersatz so auf die Positionen, dass ihre Summe genau die Bemessungsgrundlage ergibt; einen Rundungsrest von höchstens einigen Cent trägt die Position mit dem größten Betrag. Den Netto-Einzelpreis (BT-146) schreibt Haben mit so vielen Nachkommastellen wie nötig, damit Menge × Preis wieder das Zeilennetto ergibt (PEPPOL-EN16931-R120), z. B. 8,236 € für 7 Abzüge zu je 9,80 € brutto. Die Steuer je Satz (1,56 € auf 8,24 €) kann um einen Cent von Netto × Satz (1,57 €) abweichen; EN 16931 lässt das zu (BR-CO-17). Der KoSIT-Validator nimmt diese Rechnungen in allen drei Formaten an.

### Artikelkatalog

Unter **Artikel** (Seitenleiste, Bereich Verkauf) legst du Positionen an, die du oft brauchst: Stundensatz, Tagessatz, Wartungspauschale.

- Jeder Artikel hat eine Bezeichnung (eine Zeile) und optional einen **Text zur Position** (mehrzeilig, bis 2000 Zeichen), dazu optional eine Artikelnummer, Einheit, Preis und Steuersatz, dazu eine interne Notiz. Unter **Preis ist** legst du fest, ob der Preis netto oder brutto inklusive Umsatzsteuer gilt; in der Liste steht bei Bruttopreisen „brutto“.
- Passt der Preis nicht zum Preismodus der Rechnung, rechnet Haben ihn beim Einfügen um, kaufmännisch auf Cent gerundet: Ein Artikel zu 9,80 € brutto steht in einer Netto-Rechnung mit 8,24 €, ein Artikel zu 100,00 € netto in einer Brutto-Rechnung mit 119,00 €. Ohne Steuerausweis übernimmt Haben den Preis unverändert.
- Im Editor für Rechnungen und Angebote fügt **Aus dem Katalog einfügen** den Artikel als Position mit Menge 1 ein, mit Bezeichnung und Text. Ist die einzige Zeile noch leer, ersetzt er sie.
- Beim Tippen der Beschreibung einer Position schlägt der Browser passende Artikel vor (per Tastatur oder Maus auswählbar). Stimmt die Beschreibung mit der Bezeichnung eines Artikels überein, übernimmt die Position dessen Text, Einheit, Preis und Steuersatz; die Menge bleibt, bei einem Artikel ohne Text auch ein schon eingegebener Text der Position.
- **CSV importieren** übernimmt Artikel aus einer Datei, etwa aus „Produkte und Services“ von Lexware Office ([CSV-Import](csv-import.md#artikel)).
- Das Lesezeichen-Symbol neben einer Position speichert sie als Artikel: Beschreibung, Text, Einheit, Preis und Steuersatz der Position, bei einer Brutto-Rechnung als Bruttopreis. Steht genau diese Position schon im Katalog, ist der Knopf ausgegraut.
- Artikel, die vor dem eigenen Feld für den Text mehrzeilig angelegt waren, hat das Update geteilt: Die erste Zeile ist die Bezeichnung, der Rest der Text.
- Text, Menge und Preis passt du danach in der Position an.
- Ohne Steuerausweis (Kleinunternehmer, Reverse Charge, steuerfrei) setzt Haben den Steuersatz der Position auf 0 %.
- Änderungen am Katalog wirken nur auf neue Positionen. Festgeschriebene Rechnungen bleiben, wie sie sind.
- Nicht mehr gebrauchte Artikel archivierst du; sie lassen sich wiederherstellen. Jede Änderung steht im Änderungsprotokoll.

Wiederkehrende Rechnungen haben ihre Positionen in der Vorlage und nutzen den Katalog nicht.

### Textbausteine

Unter **Textbausteine** (Seitenleiste, Bereich Verkauf) legst du Kopf- und Fußtexte an, die du immer wieder brauchst: Pflichtangaben eines Kunden wie Bestellnummer oder Rahmenvertrag, eine Einleitung je Projekt, einen Dank zum Schluss.

- Jeder Baustein hat eine **Bezeichnung** (nur für die Auswahl), eine **Art** und den **Text**. Ein **Kopftext** steht als Einleitung über den Positionen, ein **Fußtext** als Hinweis unter den Summen.
- Optional ordnest du einen Baustein einem **Kunden** zu. Bei Belegen an diesen Kunden steht er in der Auswahl oben unter „Für diesen Kunden“, danach folgen die Bausteine für alle Kunden und die anderer Kunden. So lassen sich auch mehrere Bausteine je Kunde für verschiedene Projekte anlegen.
- In Rechnung, Angebot und wiederkehrender Rechnung fügt **Textbaustein einfügen** den Text in die Einleitung bzw. den Hinweis ein. Ist das Feld leer, steht danach genau der Baustein darin, sonst kommt er als neuer Absatz dazu.
- Eingefügt wird eine **Kopie**: Du kannst sie im Beleg noch anpassen, und spätere Änderungen am Baustein ändern keine geschriebene Rechnung. Einleitung und Hinweis gehören zur festgeschriebenen Rechnung und stehen mit im Siegel.
- Im XML stehen Einleitung und Hinweis als Freitext zur Rechnung (BT-22), die Einleitung zuerst.
- In wiederkehrenden Rechnungen gelten in der Einleitung dieselben Platzhalter wie in Beschreibung und Hinweis.
- Aus einem Angebot übernimmt die Rechnung die Einleitung des Angebots.
- Nicht mehr gebrauchte Bausteine archivierst du; sie lassen sich wiederherstellen. Jede Änderung steht im Änderungsprotokoll.

### Umsatzsteuer auf der Rechnung

Das Feld **Umsatzsteuer** legt fest, wie die Rechnung umsatzsteuerlich behandelt wird. Gespeichert wird die Auswahl an der Rechnung; sie bestimmt Erlöskonto, Kennzahl der [Voranmeldung](umsatzsteuer.md), Steuerkategorie im XML und den Pflichthinweis.

| Auswahl | Wann | Hinweis auf der Rechnung (Standard) | Steuerkategorie im XML |
| --- | --- | --- | --- |
| Regulär besteuert (19 %, 7 % oder 0 %) | Normalfall | – | S, bei 0 % Z |
| Reverse Charge: Leistung an Unternehmen im EU-Ausland | Sonstige Leistung an ein Unternehmen mit USt-IdNr. in einem anderen EU-Land | Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, Art. 196 MwStSystRL). | AE, Grund `VATEX-EU-AE` |
| Leistung ins Nicht-EU-Ausland | Sonstige Leistung (Dienstleistung) mit Leistungsort im Drittland, im Inland nicht steuerbar | Im Inland nicht steuerbare Leistung (Leistungsort im Drittland). | O, Grund `VATEX-EU-O` |
| Innergemeinschaftliche Lieferung | Ware, die zu einem Unternehmen mit USt-IdNr. in einem anderen EU-Land gelangt (§ 4 Nr. 1 Buchst. b, § 6a UStG) | Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b, § 6a UStG). | K, Grund `VATEX-EU-IC` |
| Ausfuhrlieferung ins Drittland | Ware, die ins Drittland gelangt, etwa in die Schweiz oder die USA (§ 4 Nr. 1 Buchst. a, § 6 UStG) | Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1 Buchst. a, § 6 UStG). | G, Grund `VATEX-EU-G` |
| Steuerfrei nach § 4 UStG | Steuerfreie Leistung, etwa nach § 4 Nr. 14 UStG | die Befreiungsvorschrift, die du einträgst | E |
| Kleinunternehmer nach § 19 UStG | Nur wählbar, wenn du in den Einstellungen als Kleinunternehmer eingetragen bist | Gemäß § 19 UStG wird keine Umsatzsteuer berechnet. | E |

Außer bei „Regulär besteuert“ gilt:

- Alle Positionen stehen auf 0 %, der Steuersatz lässt sich nicht ändern. In der Vorschau und im PDF steht in der Spalte für den Steuersatz „–“, und die Zeile „Umsatzsteuer 0 %“ entfällt.
- Der Hinweis steht fett über dem Satz zur Zahlung. Im Feld **Hinweis zur Umsatzsteuer** kannst du einen eigenen Text eintragen, der den Standardtext ersetzt. Bei „Steuerfrei nach § 4 UStG“ heißt das Feld **Befreiungsvorschrift** und ist Pflicht, z. B. „Steuerfrei nach § 4 Nr. 14 UStG“.
- Im XML steht der Hinweis als Befreiungsgrund in der Steueraufschlüsselung.

Bei Reverse Charge erinnert der Editor daran, dass die Leistung zusätzlich in die Zusammenfassende Meldung (ZM) an das Bundeszentralamt für Steuern gehört. Die ZM sendet Haben über ERiC ([Umsatzsteuer](umsatzsteuer.md#zusammenfassende-meldung)). Bei „Leistung ins Nicht-EU-Ausland“ lässt Haben im XML die USt-IdNr. von dir und vom Kunden weg (BR-O-02); als Kennung des Verkäufers dient dann die Steuernummer bzw. USt-IdNr. (BT-29). Den Steuersatz lässt Haben in den Positionen des XML weg; in der Steueraufschlüsselung steht 0, weil XRechnung ihn dort verlangt (BR-DE-14).

**Lieferung oder Leistung?** „Leistung ins Nicht-EU-Ausland“ ist für Dienstleistungen, deren Leistungsort im Drittland liegt; sie sind in Deutschland nicht steuerbar (Kz 45). Verkaufst du Ware, die ins Drittland gelangt, ist es eine steuerbare, aber steuerfreie **Ausfuhrlieferung** (Kz 43); die Vorsteuer aus dem Einkauf bleibt abziehbar. Ebenso ist Ware an ein Unternehmen im EU-Ausland keine Reverse-Charge-Leistung, sondern eine **innergemeinschaftliche Lieferung** (Kz 41).

Zur innergemeinschaftlichen Lieferung:

- Auf der Rechnung stehen deine USt-IdNr. und die des Kunden und der Hinweis auf die Steuerfreiheit (§ 14a Abs. 3 UStG). Ohne beide Nummern, mit einer deutschen oder einer formal falschen USt-IdNr. des Kunden oder bei einem Kunden außerhalb der EU lässt sich die Rechnung nicht festschreiben. Ob die Nummer erteilt ist, klärst du vorher mit der Bestätigungsabfrage beim BZSt.
- Im XML steht die Anschrift des Kunden als Lieferanschrift mit Lieferland (BT-80, Pflicht nach BR-IC-12). Eine abweichende Lieferanschrift kennt Haben nicht.
- Haben meldet die Lieferung in Kz 41 der Voranmeldung im Monat des Rechnungsdatums, auch bei Ist-Versteuerung, und in der [Zusammenfassenden Meldung](umsatzsteuer.md#zusammenfassende-meldung) mit Umsatzart L.
- Steuerfrei ist sie nur mit Nachweis, dass die Ware ins andere EU-Land gelangt ist (§ 6a Abs. 3 UStG, § 17a UStDV), etwa mit der Gelangensbestätigung oder einem Versandbeleg. Den Nachweis bewahrst du selbst auf, zum Beispiel als [Anhang](#zusätzliche-anhänge) der Rechnung.

Zur Ausfuhrlieferung: Der Kunde sitzt außerhalb der EU, und die Rechnung braucht deine USt-IdNr. (EN 16931 BR-G-02). Steuerfrei ist sie nur mit Ausfuhrnachweis (§ 6 Abs. 4 UStG, §§ 8 bis 11 UStDV), in der Regel dem Ausgangsvermerk aus dem ATLAS-Verfahren des Zolls. Bei Ist-Versteuerung zählt sie wie Kz 81 mit dem Zahlungseingang.

Bist du in den Einstellungen als Kleinunternehmer eingetragen, bekommen neue Rechnungen automatisch „Kleinunternehmer nach § 19 UStG“, und die Auswahl ist gesperrt. Siehe [Erste Schritte](einrichtung.md#kleinunternehmer).

### Format wählen

| Auswahl im Editor | Was entsteht |
| --- | --- |
| ZUGFeRD · EN 16931 (PDF mit XML) | PDF/A-3 mit eingebetteter `factur-x.xml` (CII, Profil EN 16931). Das XML steht zusätzlich einzeln zum Download bereit. |
| XRechnung 3.0 (CII) | XRechnung als CII-XML; das PDF ist eine Sichtkopie. |
| XRechnung 3.0 (UBL) | XRechnung als UBL-XML; das PDF ist eine Sichtkopie. |

Die Reihenfolge, nach der Haben das Format vorschlägt: Standardformat des Kontakts, sonst XRechnung (CII) bei vorhandener Leitweg-ID, sonst das Standardformat aus den Einstellungen. Du kannst es im Entwurf jederzeit ändern.

### Was vor dem Festschreiben geprüft wird

Der Editor listet alles auf, was noch fehlt. Geprüft werden:

- Firmendaten: Name, Anschrift, E-Mail-Adresse, IBAN, Steuernummer oder USt-IdNr.
- Kunde gewählt, mindestens eine Position, keine Position mit Betrag 0.
- Umsatzsteuer: Außer bei „Regulär besteuert“ müssen alle Positionen 0 % haben. Reverse Charge braucht deine USt-IdNr. in den Firmendaten und die USt-IdNr. des Kunden, und der Kunde darf nicht in Deutschland sitzen. Die innergemeinschaftliche Lieferung braucht deine USt-IdNr., eine USt-IdNr. des Kunden aus einem anderen EU-Land und einen Kunden in einem anderen EU-Land. Die Ausfuhrlieferung braucht deine USt-IdNr. und einen Kunden außerhalb der EU. Bei „Leistung ins Nicht-EU-Ausland“ darf der Kunde nicht in Deutschland sitzen. „Steuerfrei nach § 4 UStG“ braucht die Befreiungsvorschrift.
- Kleinunternehmer: Bist du in den Einstellungen als Kleinunternehmer eingetragen, lässt sich nur eine Kleinunternehmer-Rechnung festschreiben; bist du es nicht, keine.
- Eine Rechnung muss einen positiven Gesamtbetrag haben, eine Rechnungskorrektur einen negativen.
- GmbH und UG: Fehlen Pflichtangaben nach § 35a GmbHG (Registergericht, Registernummer, Geschäftsführer), zeigt der Editor einen Hinweis. Festschreiben geht trotzdem, siehe [Pflichtangaben einer GmbH oder UG](#pflichtangaben-einer-gmbh-oder-ug).
- Formatabhängige Pflichtangaben (aus `validateForFormat` in `packages/einvoice`):

| Angabe | ZUGFeRD | XRechnung |
| --- | --- | --- |
| Name und vollständige Anschrift des Rechnungsstellers | Pflicht | Pflicht |
| E-Mail-Adresse des Rechnungsstellers | Pflicht | Pflicht |
| Steuernummer oder USt-IdNr. | Pflicht | Pflicht |
| Telefonnummer des Rechnungsstellers | – | Pflicht |
| IBAN (bei Rechnungen mit positivem Betrag) | Pflicht | Pflicht |
| Name und vollständige Anschrift des Kunden | Pflicht | Pflicht |
| E-Mail-Adresse oder Leitweg-ID des Kunden | – | Pflicht |
| Bezug zur ursprünglichen Rechnung (Storno, Korrektur) | Pflicht | Pflicht |

## Was beim Festschreiben passiert

Alles läuft in einer einzigen Datenbanktransaktion. Schlägt ein Schritt fehl, bleibt der Entwurf ohne Nummer zurück und im Nummernkreis entsteht keine Lücke. PDF und XML entstehen, bevor Haben etwas speichert; andere Vorgänge, etwa ein gleichzeitig gebuchter Beleg, warten so nicht auf das Erzeugen der Dateien.

1. **Nummer ziehen.** Der Zähler je Jahr des Rechnungsdatums wird um eins erhöht. Das Format ist `JJJJ-NNN`, also `2026-034`. Ein Datenbank-Trigger verhindert, dass der Zähler zurückgesetzt wird.
2. **Anschriften einfrieren.** Absender (aus den Firmendaten) und Empfänger (aus dem Kontakt) werden mit der Rechnung gespeichert, dazu die Version des Kontakts. Spätere Änderungen am Kontakt ändern die Rechnung nicht.
3. **PDF erzeugen.** Die sichtbare Rechnung entsteht mit Typst aus einer Vorlage als PDF/A-3b. Als Erstellungszeit steht das Rechnungsdatum im PDF.
4. **XML erzeugen.** Die Bibliothek `@e-invoice-eu/core` erzeugt je nach Format Factur-X EN 16931 (und bettet es ins PDF ein), XRechnung CII oder XRechnung UBL.
5. **Prüfsummen.** Von PDF und XML wird je ein SHA-256 gespeichert. Die ersten Zeichen des PDF-Hashes stehen auf der Detailseite.
6. **Buchen.** Haben legt den Buchungssatz an (siehe unten) und schreibt ihn fest.
7. **Sperren.** Die Rechnung bekommt einen Festschreibungszeitpunkt. Ab dann lehnen Datenbank-Trigger jede Änderung oder Löschung der Rechnung, ihrer Positionen und ihrer [zusätzlichen Anhänge](#zusätzliche-anhänge) ab. Das Siegel der Rechnung schließt die Anhänge ein.

## Pflichtangaben einer GmbH oder UG

Auf allen Geschäftsbriefen einer GmbH oder UG an einen bestimmten Empfänger, gleich in welcher Form, müssen stehen ([§ 35a Abs. 1 GmbHG](https://www.gesetze-im-internet.de/gmbhg/__35a.html)): die Rechtsform und der Sitz der Gesellschaft, das Registergericht des Sitzes und die Nummer, unter der die Gesellschaft ins Handelsregister eingetragen ist, alle Geschäftsführer und, wenn die Gesellschaft einen Aufsichtsrat mit Vorsitzendem hat, dessen Vorsitzender, jeweils mit Familiennamen und mindestens einem ausgeschriebenen Vornamen. Angaben zum Kapital sind nicht Pflicht; wer welche macht, muss das Stammkapital und, wenn nicht alle Geldeinlagen eingezahlt sind, die ausstehenden Einlagen nennen (§ 35a Abs. 1 Satz 2 GmbHG). Haben macht keine Angaben zum Kapital.

Haben nimmt die Angaben aus den [Firmendaten](einrichtung.md#firmendaten) und setzt sie

- als eigene Zeile unter die drei Spalten des Fußes von Rechnung, Storno, Korrektur, Angebot, Auftragsbestätigung, Lieferschein, Mahnung und Steuerbescheinigung, auch in der Vorschau im Editor: „Sitz der Gesellschaft: Bremen · Registergericht: Amtsgericht Bremen, HRB 12345 HB · Geschäftsführung: Erika Mustermann“. Die Rechtsform steht davor („Rechtsform: GmbH“) nur, wenn der Firmenname sie nicht schon nennt, etwa „GmbH“ oder „UG (haftungsbeschränkt)“ (§ 4, § 5a Abs. 1 GmbHG). Auf englischen Belegen sind die Beschriftungen englisch („Registered office“, „Register court“, „Managing directors“).
- in die E-Rechnung: die Registernummer als Kennung aus einem amtlichen Register (BT-30, in CII `SpecifiedLegalOrganization/ID`, in UBL `PartyLegalEntity/CompanyID`) und die ganze Zeile als „Seller additional legal information“ (BT-33, in CII `Description` des Verkäufers, in UBL `CompanyLegalForm`) nach dem semantischen Modell der EN 16931-1 (Gruppe BG-4).
- als Signatur unter E-Mails mit Rechnung, Angebot oder Mahnung, siehe [Per E-Mail versenden](#per-e-mail-versenden).

**Hinweis, keine Sperre:** Fehlt etwas, zeigen Firmendaten und Editor einen Hinweis, das Festschreiben bleibt möglich; der Fuß nennt dann nur, was eingetragen ist. Die Rechnung bleibt umsatzsteuerlich gültig, denn § 14 Abs. 4 UStG verlangt die Angaben nicht; fehlende Angaben kann das Registergericht mit Zwangsgeld durchsetzen ([§ 79 Abs. 1 GmbHG](https://www.gesetze-im-internet.de/gmbhg/__79.html)). Eine Gesellschaft in Gründung hat vor der Eintragung noch keine Registernummer, schreibt aber schon Rechnungen, und Storno und Korrektur müssen immer möglich sein.

**Festgeschriebene Rechnungen bleiben, wie sie sind:** Der Absender ist mit der Rechnung gespeichert, PDF und XML sind gesperrt. Ältere Rechnungen haben den neuen Fuß also nicht. Mahnung, Auftragsbestätigung und Lieferschein entstehen dagegen neu und tragen die Angaben aus den aktuellen Firmendaten, auch zu einer älteren Rechnung. Beim Einzelunternehmen ändert sich nichts.

## Buchungen

Beispiel: Rechnung über 1.000,00 € netto zu 19 %.

**Soll-Versteuerung** (nach vereinbarten Entgelten):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 1400 Forderungen | 1200 Forderungen | 1.190,00 | |
| 8400 Erlöse 19 % | 4400 Erlöse 19 % | | 1.000,00 |
| 1776 Umsatzsteuer 19 % | 3806 Umsatzsteuer 19 % | | 190,00 |

**Ist-Versteuerung** (nach vereinnahmten Entgelten): Die Steuer landet zunächst auf „Umsatzsteuer nicht fällig“ und wird erst mit dem Zahlungseingang fällig (siehe [bank.md](bank.md)).

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 1400 Forderungen | 1200 Forderungen | 1.190,00 | |
| 8400 Erlöse 19 % | 4400 Erlöse 19 % | | 1.000,00 |
| 1766 USt nicht fällig 19 % | 3816 USt nicht fällig 19 % | | 190,00 |

Für 7 % gelten die Konten 8300/1771/1761 (SKR03) bzw. 4300/3801/3811 (SKR04), für regulär besteuerte Umsätze zu 0 % das Erlöskonto 8200 bzw. 4200 ohne Steuerzeile. Storno und Rechnungskorrektur haben negative Beträge; dabei tauschen Soll und Haben die Seiten.

Rechnungen ohne Steuerausweis gehen ohne Steuerzeile auf eigene Erlöskonten:

| Umsatzsteuer | Konto SKR03 | Konto SKR04 | Steuerschlüssel |
| --- | --- | --- | --- |
| Reverse Charge | 8336 | 4336 | `RC` (Kz 21) |
| Leistung ins Nicht-EU-Ausland | 8338 | 4338 | `Drittland` (Kz 45) |
| Innergemeinschaftliche Lieferung | 8125 | 4125 | `IGL` (Kz 41) |
| Ausfuhrlieferung ins Drittland | 8120 | 4120 | `Ausfuhr` (Kz 43) |
| Steuerfrei nach § 4 UStG | 8100 | 4100 | `Steuerfrei` (Kz 48) |
| Kleinunternehmer nach § 19 UStG | 8195 | 4185 | `KU` (keine Kennzahl) |

> [!IMPORTANT]
> Die Kontenzuordnung stammt aus `packages/core/src/posting.ts`. Gleiche sie vor dem Echtbetrieb mit deiner Steuerberatung ab.

## Fälligkeit

Fällig ist eine Rechnung am Rechnungsdatum plus Zahlungsziel. Fällt dieser Tag auf einen Samstag, Sonntag oder gesetzlichen Feiertag im Bundesland aus deinen Firmendaten, gilt der nächste Werktag (§ 193 BGB). Haben kennt nur Feiertage, die im ganzen Bundesland gelten; Feiertage einzelner Gemeinden (Fronleichnam in Teilen Sachsens und Thüringens, Mariä Himmelfahrt in Bayern, Augsburger Friedensfest) zählen nicht. Ohne Bundesland zählen nur die bundesweiten Feiertage. Bei Zahlungsziel 0 ist die Rechnung am Rechnungsdatum fällig, auch an einem Wochenende. Die Berechnung steht in `packages/core/src/holidays.ts`.

## Skonto

Skonto ist ein Abzug, den der Kunde machen darf, wenn er früh zahlt, etwa 2 % bei Zahlung innerhalb von 10 Tagen. Im Rechnungseditor stehen unter dem Zahlungsziel bis zu drei **Skontostufen**, je mit **Skonto in %** (bis zu zwei Nachkommastellen) und **Frist in Tagen**. Neben jeder Stufe zeigt der Editor das Datum, den Skontobetrag und den Zahlbetrag. Mit **+ Skontostufe hinzufügen** kommt eine weitere Stufe dazu, das Kreuz entfernt eine; ohne Stufe hat die Rechnung kein Skonto.

- **Vorgabe:** Das Skonto eines neuen Entwurfs kommt vom Kunden, wenn dort ein eigenes eingetragen ist (siehe [Kontakte](#kontakte)), sonst aus den [Firmendaten](einrichtung.md). Stufen mit einer Frist länger als das Zahlungsziel der Rechnung lässt Haben dabei weg. Dasselbe gilt für Rechnungen aus einem Angebot, wiederkehrende Rechnungen und Entwürfe aus der [REST-API](api.md).
- **Regeln:** Die Frist zählt ab dem Rechnungsdatum und endet spätestens mit dem Zahlungsziel; eine Stufe mit längerer Frist braucht einen kleineren Satz. Skonto gilt immer für den ganzen Rechnungsbetrag. Es gibt es nur bei Rechnungen in Euro, nicht bei Storno und Rechnungskorrektur.
- **Bis zum Festschreiben änderbar:** Danach ist das Skonto wie die ganze Rechnung gesperrt.
- **Auf dem PDF** steht unter der Zahlungsaufforderung je Stufe ein Satz wie „Bei Zahlung bis zum 05.10.2026 gewähren wir 2 % Skonto (95,20 €); Sie überweisen dann 4.664,80 €.“ Die Frist ist hier ein Datum: Rechnungsdatum plus Tage, ohne Verschiebung auf den nächsten Werktag. Fällt dieses Datum auf ein Wochenende oder einen Feiertag, gilt eine Zahlung am nächsten Werktag nach § 193 BGB trotzdem noch als rechtzeitig; so wertet sie der [Bankabgleich](bank.md#skonto-auf-eigene-rechnungen). Der GiroCode bleibt beim vollen Betrag, denn welches Skonto der Kunde nutzt, steht vorher nicht fest.
- **In der E-Rechnung** beginnen die Zahlungsbedingungen (BT-20) mit einer Zeile je Stufe im Format der XRechnung, Regel BR-DE-18: `#SKONTO#TAGE=10#PROZENT=2.00#`, danach ein Zeilenumbruch und derselbe Inhalt als Satz. So lesen Buchhaltungsprogramme des Kunden das Skonto maschinell, in XRechnung (UBL und CII) wie in ZUGFeRD.
- **In der E-Mail** nennt der Platzhalter `{zahlbar}` die Skontofristen mit, etwa „zahlbar bis zum 09.10.2026 ohne Abzug oder bis zum 05.10.2026 abzüglich 2 % Skonto“.

Zahlt der Kunde in der Frist den Betrag abzüglich Skonto, erkennt der [Bankabgleich](bank.md#skonto-auf-eigene-rechnungen) die Zahlung und bucht das Skonto mit einem Klick aus; bei einer [Barzahlung](kasse.md#rechnung-bar-bezahlt) im Kassenbuch ebenso. Wie das Skonto Erlöse und Umsatzsteuer mindert, steht unter [Ausbuchen](#ausbuchen). Nach der Fälligkeit gilt der volle Betrag: [Mahnungen](#mahnwesen) fordern den ganzen offenen Betrag und weisen darauf hin, dass das Skonto entfallen ist.

## GiroCode

Neben der Zahlungsaufforderung druckt Haben einen GiroCode, also einen EPC-QR-Code nach dem Standard des European Payments Council. Der Kunde scannt ihn mit der Banking-App, und die Überweisung ist ausgefüllt:

- Empfänger, IBAN und BIC aus den Firmendaten; als Empfänger steht der **Kontoinhaber**, ohne Angabe der Firmenname,
- der Rechnungsbetrag,
- der Verwendungszweck „Rechnung 2026-001“.

Läuft dein Konto nicht auf den Firmennamen, z. B. auf dich als Person, trag unter **Einstellungen › Firma** den **Kontoinhaber** ein. Die Bank deines Kunden vergleicht den Empfängernamen bei der Überweisung mit dem Inhaber des Kontos (Empfängerüberprüfung, seit Oktober 2025) und warnt sonst. Der Kontoinhaber steht auch in der Bankspalte der Fußzeile und in der E-Rechnung als Name des Zahlungskontos (BT-85).

Der Code steht nur auf Rechnungen in Euro mit Zahlbetrag und nur, wenn in den Firmendaten eine IBAN steht. Stornorechnungen und Korrekturen bekommen keinen. Mahnungen tragen den Code über den offenen Gesamtbetrag samt Gebühren und Zinsen.

## Rechnungen in Fremdwährung

Für Kunden im Ausland stellst du die Rechnung in deren Währung aus: im Editor bei **Währung** den Code eintragen, z. B. `USD`, und die Preise in dieser Währung. PDF und E-Rechnung zeigen alle Beträge in dieser Währung. Die Umsatzsteuer steht zusätzlich in Euro auf der Rechnung, wie es § 14 Abs. 4 Nr. 8 UStG mit Abschn. 14.5 UStAE verlangt, etwa „Umsatzsteuer in Euro, 1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026): Umsatzsteuer 19 % 166,94 €“. Im XML ist Euro die Steuerwährung (BT-6) mit der Steuer in Euro (BT-111).

Gebucht wird in Euro. **Kurs** leer lassen: Haben nimmt den Umsatzsteuer-Umrechnungskurs des Monats der Leistung (Ende des Leistungszeitraums, sonst Rechnungsdatum). Ist er noch nicht veröffentlicht, bleibt die Rechnung ein Entwurf („Umrechnungskurs für 10/2026 noch nicht veröffentlicht“), bis Haben die Kurse abgerufen hat oder du einen Kurs einträgst. Mit gestattetem Tageskurs trägst du Kurs und Kursdatum selbst ein. Storno und Korrektur übernehmen den Kurs der ursprünglichen Rechnung, damit sie genau dieselben Euro-Beträge zurücknehmen.

Offene Posten, Bankabgleich und Auswertungen rechnen mit dem Euro-Betrag. Zahlt der Kunde umgerechnet etwas anderes, gleichst du die Differenz im Bankabgleich als [Kursdifferenz](bank.md#kursdifferenz-bei-fremdwährung) aus. Die E-Mail zur Rechnung nennt den Betrag in der Währung der Rechnung.

Bei **Ist-Versteuerung** gehen Rechnungen in Fremdwährung nur ohne deutsche Umsatzsteuer, also an Unternehmen im Ausland (Reverse Charge in der EU, nicht steuerbare Leistung in Drittländern wie der Schweiz oder den USA). Mit deutscher Umsatzsteuer, etwa an Privatkunden im Ausland, wäre das Entgelt mit dem Kurs des Monats umzurechnen, in dem es eingeht (Abschn. 16.4 UStAE); Haben rechnet aber mit dem Kurs der Rechnung. Solche Rechnungen stellst du bei Ist-Versteuerung in Euro aus.

In Fremdwährung gibt es keinen GiroCode (SEPA kennt nur Euro), keine Abschlags- und Schlussrechnungen, keine wiederkehrenden Rechnungen und keine Mahnungen aus Haben.

## Abschlags- und Schlussrechnung

Bei größeren Aufträgen rechnest du in Teilen ab: zuerst Abschlagsrechnungen, am Ende eine Schlussrechnung über alles.

1. **Abschlagsrechnung:** Neue Rechnung, unter **Rechnungsart** „Abschlagsrechnung“ wählen und den Teilbetrag als Position eintragen, z. B. „1. Abschlag 30 % gemäß Angebot AN-2026-004“. Sie wird wie jede Rechnung festgeschrieben, gebucht, bezahlt und gemahnt. Im XML trägt sie den Typ 326 (Teilrechnung). Gibt es ein Angebot zum Auftrag, wählst du es unter **Angebot** aus, oder du legst den Abschlag gleich im Angebot mit **Abschlagsrechnung erstellen** an (siehe [angebote.md](angebote.md#in-abschlägen-abrechnen)).
2. **Schlussrechnung:** In der festgeschriebenen Abschlagsrechnung bzw. im Angebot auf **Schlussrechnung erstellen** klicken oder bei einer neuen Rechnung „Schlussrechnung“ wählen. Gehört die Schlussrechnung zu einem Angebot, schlägt Haben dessen offene Abschlagsrechnungen zum Abzug vor, sonst alle offenen Abschlagsrechnungen des Kunden. Per Häkchen wählst du sie ab oder wieder an, auch die anderer Aufträge. Unter **Positionen** steht die gesamte Leistung.

Die Abzüge setzt Haben selbst als eigene Positionen darunter, je Abschlagsrechnung und Steuersatz eine, mit Netto und Umsatzsteuer der Abschlagsrechnung, z. B. „Abzüglich Abschlagsrechnung 2026-031 vom 15.09.2026 (netto 3.000,00 €, USt 570,00 €)“. So weist die Schlussrechnung nur noch die Umsatzsteuer auf den Rest aus (§ 14 Abs. 5 UStG), und gebucht wird nur der Restbetrag; die Abschläge sind schon als Erlös gebucht. Im XML verweist die Schlussrechnung auf jede abgezogene Abschlagsrechnung.

Regeln:

- Abziehen lassen sich nur festgeschriebene, nicht stornierte Abschlagsrechnungen desselben Kunden mit derselben Umsatzsteuer-Behandlung, jede nur in einer Schlussrechnung.
- Das Angebot einer Rechnung muss festgeschrieben sein, zum selben Kunden gehören und darf nicht abgelehnt sein; sonst lässt sich die Rechnung nicht festschreiben. Der Bezug wird mit der Rechnung festgeschrieben.
- Eine Schlussrechnung zu einem Angebot muss alle festgeschriebenen Abschläge dieses Angebots abziehen, auch solche, die erst nach dem Anlegen des Entwurfs festgeschrieben wurden; beim Öffnen des Entwurfs schlägt Haben sie mit vor.
- Ist ein Angebot mit einer Schlussrechnung oder einer Rechnung über alles abgerechnet, lässt sich keine weitere Rechnung und kein weiterer Abschlag dazu festschreiben. Wird diese Rechnung storniert, ist das Angebot wieder offen.
- Die Abschläge dürfen die Gesamtleistung nicht übersteigen; ein Restbetrag von 0 € ist erlaubt.
- Eine abgezogene Abschlagsrechnung lässt sich erst stornieren, wenn die Schlussrechnung storniert ist. Danach ist sie wieder frei.

## Rechnungen auf Englisch

Für Kunden im Ausland stellst du im Kontakt **Sprache von Rechnungen und Angeboten** auf Englisch. Neue Rechnungen und Angebote für diesen Kunden übernehmen die Sprache; im Editor lässt sie sich je Beleg unter **Sprache** ändern.

Auf Englisch erscheinen:

- im PDF Titel („Invoice“, „Cancellation invoice“, „Corrective invoice“, „Quote“), Beschriftungen, Einheiten, Datumsangaben („10 Sept 2026“), Beträge („€1,190.00“), Zahlungsaufforderung, Hinweise zur Umsatzsteuer und Fußzeile,
- Betreff und Text der E-Mail, aus der englischen Vorlage (siehe [Vorlagen](#per-e-mail-versenden)),
- der Hinweis „As per our quote …“, wenn aus einem englischen Angebot eine Rechnung wird.

Stornorechnung und Rechnungskorrektur übernehmen die Sprache der ursprünglichen Rechnung, wiederkehrende Rechnungen die Sprache des Kontakts. Das XML der E-Rechnung ist sprachunabhängig und bleibt gleich. Mahnungen bleiben deutsch. Ein selbst eingetragener Hinweis zur Steuerbefreiung erscheint so, wie du ihn schreibst.

## Wiederkehrende Rechnungen

Für Monatspauschalen, Wartungsverträge oder Hosting legst du unter **Rechnungen › Wiederkehrend › Neue Vorlage** eine Vorlage an. Haben erzeugt daraus zu jedem Termin eine Rechnung.

| Feld | Bedeutung |
|---|---|
| Intervall | monatlich, vierteljährlich, halbjährlich oder jährlich |
| Nächste Rechnung am | Rechnungsdatum des nächsten Termins. Die folgenden Termine liegen am selben Tag im Monat; der 31. wird in kürzeren Monaten zum Monatsende und springt danach zurück. |
| Endet nach dem | optional. Danach wird die Vorlage inaktiv. |
| Leistungszeitraum | **Laufend:** die Monate ab dem Rechnungsmonat (Vorauszahlung). **Vergangen:** die Monate davor (Abrechnung). **Keiner:** ohne Leistungszeitraum, dann gilt das Rechnungsdatum. |
| Was am Termin passiert | **Entwurf anlegen:** du prüfst und schreibst selbst fest. **Direkt festschreiben:** Nummer, PDF, XML und Buchung wie beim Festschreiben von Hand; auf Wunsch **und per E-Mail an den Kunden schicken** (Vorlage und Adresse wie beim [Versand von Hand](#per-e-mail-versenden)). |
| Kunde, Einleitung, Positionen mit Text zur Position, Zahlungsziel, Format, Umsatzsteuer, Preise (netto oder brutto), Hinweis | wie im Rechnungseditor |

In Einleitung, Beschreibungen, Texten zur Position und Hinweis ersetzt Haben Platzhalter:

| Platzhalter | Beispiel |
|---|---|
| `{monat}` | November |
| `{jahr}` | 2026 |
| `{quartal}` | Q4 |
| `{zeitraum}` | November 2026, bei mehreren Monaten Oktober – Dezember 2026 |

Bezug ist der Leistungszeitraum, ohne Leistungszeitraum das Rechnungsdatum. „Wartung {monat} {jahr}“ wird so zu „Wartung November 2026“. Die Vorschau unter dem Formular zeigt die nächste Rechnung.

**Wann die Rechnungen entstehen:** Der Server prüft kurz nach dem Start und danach stündlich, welche Termine fällig sind. War Haben aus, werden verpasste Termine mit ihrem eigenen Datum nachgeholt. Je Termin entsteht höchstens eine Rechnung, auch bei mehreren gleichzeitigen Läufen. Mit **… fällige jetzt anlegen** in der Liste startest du den Lauf sofort.

Scheitert das Festschreiben, etwa weil in den Firmendaten die IBAN fehlt, bleibt die Rechnung als Entwurf stehen. Scheitert nur der E-Mail-Versand (kein E-Mail-Zugang, keine Adresse beim Kunden, Server nicht erreichbar), ist die Rechnung festgeschrieben und du schickst sie auf ihrer Seite von Hand. Die Vorlage zeigt den Fehler, bis du sie das nächste Mal speicherst.

Die Seite einer Vorlage listet alle daraus erzeugten Rechnungen. Löschen lässt sich eine Vorlage nur, solange daraus keine Rechnung entstanden ist; sonst deaktivierst du sie.

## Mahnwesen

Unter **Rechnungen › Mahnwesen** stehen alle überfälligen Rechnungen: festgeschrieben, nicht storniert, mit offenem Betrag und abgelaufener Fälligkeit. Ob eine Rechnung bezahlt ist, ergibt sich aus den Zuordnungen im [Bankabgleich](bank.md) und den Bareinnahmen im [Kassenbuch](kasse.md#rechnung-bar-bezahlt). Je Rechnung siehst du, wie viele Tage sie überfällig ist, den offenen Betrag und die letzte Mahnung mit ihrer Frist.

Der Knopf rechts schlägt die nächste Stufe vor:

| Stufe | Titel auf dem Schreiben |
|---|---|
| Zahlungserinnerung | Zahlungserinnerung |
| 1. Mahnung | Mahnung |
| Letzte Mahnung | Letzte Mahnung, mit Hinweis auf gerichtliche Schritte |

Läuft die Frist der letzten Mahnung noch, ist der Knopf hell. Mahnen kannst du trotzdem.

Gemahnt wird immer der volle offene Betrag. Bot die Rechnung [Skonto](#skonto) an, ist dessen Frist bei der Mahnung vorbei (sie endet spätestens mit dem Zahlungsziel); das Schreiben sagt deshalb unter der Zahlungsaufforderung, dass das Skonto entfallen ist.

Im Formular legst du fest:

| Feld | Bedeutung |
|---|---|
| Stufe | Vorschlag ist die nächste; beim Wechsel tauscht Haben Einleitung und Schluss gegen die Vorlage der Stufe |
| Neue Zahlungsfrist | Vorschlag: heute plus die Frist aus den Einstellungen (10 Tage) |
| Mahngebühr | Vorschlag je Stufe aus den Einstellungen |
| Verzugszinsen | Geschäftskunde: Basiszinssatz plus 9 Prozentpunkte, Verbraucher: plus 5 (§ 288 BGB). Taggenau ab dem Tag nach der Fälligkeit bis heute, auf 365 Tage, auf den offenen Betrag. Nur mit Basiszinssatz in den Einstellungen. |
| Verzugspauschale | 40 € nach § 288 Abs. 5 BGB, nur gegenüber Geschäftskunden |
| Einleitung und Schluss | Vorlage je Stufe, frei änderbar |

Rechts siehst du die Forderung mit Gesamtbetrag. **… erstellen** speichert die Mahnung mit PDF und öffnet es. Das PDF hat denselben Briefbogen wie die Rechnung: Rechnungsnummer und -datum, Fälligkeit, offener Betrag, Gebühren und Zinsen, Gesamtbetrag und Zahlungsaufforderung mit IBAN. Mahnungen sind wie verschickte Schreiben unveränderlich (Trigger); eine falsche Mahnung ersetzt du durch eine neue.

Auf der Seite der Rechnung stehen alle Mahnungen mit Link zum PDF, bei überfälligen Rechnungen auch der Knopf für die nächste Stufe.

**Gebühren und Zinsen buchen:** Sie sind keine Rechnung und erhöhen nicht die Forderung. Zahlt der Kunde mehr als die Rechnung, ordnest du im Bankabgleich die Rechnung und den Rest als **Mahngebühren und Verzugszinsen** zu. Gebucht wird Bank an 2650 bzw. 7100 „Sonstige Zinsen und ähnliche Erträge“, ohne Umsatzsteuer (Schadensersatz, kein Entgelt). In der EÜR zählt das als umsatzsteuerfreie Betriebseinnahme.

Jede Mahnung lässt sich auf der Seite der Rechnung **per E-Mail** schicken, mit dem PDF der Mahnung im Anhang (siehe [Per E-Mail versenden](#per-e-mail-versenden)).

## Rechnungsliste und Status

Die Liste unter **Rechnungen** zeigt Nummer, Kunde, Datum, Bruttobetrag und einen Status. Der Status wird bei jedem Aufruf aus den Zuordnungen im Bankabgleich und den Bareinnahmen im Kassenbuch abgeleitet; gespeichert ist nur „Entwurf“ oder „festgeschrieben“.

| Status | Bedeutung |
| --- | --- |
| Entwurf | Noch nicht festgeschrieben, ohne Nummer. |
| Offen | Festgeschrieben, nicht fällig, noch keine Zahlung zugeordnet. |
| Teilbezahlt | Ein Teil ist bezahlt, die Fälligkeit ist noch nicht überschritten. |
| Bezahlt | Der volle Betrag ist im Bankabgleich zugeordnet oder bar im Kassenbuch eingenommen, gegebenenfalls abzüglich eines ausgebuchten Skontos. |
| Ausgebucht | Erledigt, mit einem Forderungsausfall (siehe [Ausbuchen](#ausbuchen)). |
| Überfällig | Fälligkeit überschritten und noch etwas offen, auch bei Teilzahlung. |
| Storniert | Zu dieser Rechnung gibt es eine festgeschriebene Stornorechnung. |
| Storno | Die Stornorechnung selbst. |
| Korrektur | Eine Rechnungskorrektur. |

## Festgeschriebene Rechnung

Die Detailseite zeigt das PDF, die Eckdaten (Kunde, Rechnungsdatum, Fälligkeit, Netto, Umsatzsteuer, Brutto, Format, Zeitpunkt der Festschreibung, bei Rechnungen ohne Steuerausweis die Umsatzsteuer-Behandlung) und den Anfang des SHA-256 des PDFs.

- **PDF herunterladen** liefert `Rechnung-<Nummer>.pdf`.
- **XML herunterladen** liefert `Rechnung-<Nummer>-cii.xml` bzw. `-ubl.xml`. Bei ZUGFeRD ist das dasselbe XML, das im PDF steckt.
- **Lieferschein** erzeugt einen Lieferschein mit den Positionen und Mengen der Rechnung, ohne Preise (siehe [Angebote](angebote.md#auftragsbestätigung-und-lieferschein)).

Beide Dateien werden aus der Datenbank ausgeliefert, so wie sie beim Festschreiben entstanden sind. Sie werden nie neu erzeugt.

Unter **Zahlungen** stehen die Zahlungen auf die Rechnung mit Datum und Betrag: „Bank“ für eine Zuordnung im [Bankabgleich](bank.md), „bar“ mit der Nummer im [Kassenbuch](kasse.md#rechnung-bar-bezahlt) für eine Bareinnahme. Aufgehobene und stornierte Zahlungen sind durchgestrichen. Solange die Rechnung offen ist, führt **Barzahlung in der Kasse erfassen** ins Kassenbuch, mit der Rechnung und dem offenen Betrag vorbelegt.

## Zusätzliche Anhänge

Manche Kunden wollen mit der Rechnung weitere Unterlagen: Stundenzettel, Leistungsnachweise, Abnahmeprotokolle. Solche PDF-Dateien hängst du im Entwurf an die Rechnung; beim Versand per E-Mail wählst du, welche mitgehen.

1. Den Entwurf einmal speichern. Danach steht im Editor unter den Positionen der Abschnitt **Anhänge**.
2. **PDF anhängen** öffnet die Dateiauswahl; mehrere Dateien auf einmal gehen. Jede Datei steht danach mit Name und Größe in der Liste, ein Klick auf den Namen öffnet sie, **Herunterladen** lädt sie herunter.
3. **Entfernen** nimmt einen Anhang wieder von der Rechnung, solange sie ein Entwurf ist.

Erlaubt sind nur PDF-Dateien bis 20 MB, höchstens zehn je Rechnung. Den Typ erkennt Haben am Inhalt, nicht an der Endung: Ein umbenanntes Foto wird abgelehnt. Dieselbe Datei hängt nur einmal an derselben Rechnung. Die Dateien liegen wie Belege unter ihrem SHA-256 im Belegverzeichnis (siehe [Architektur](architektur.md#dateiablage)).

Mit dem Festschreiben sind die Anhänge zusammen mit der Rechnung gesperrt: Die Datenbank lehnt Hinzufügen, Ändern und Entfernen ab, das Siegel der Rechnung schließt Dateiname, Größe und SHA-256 jedes Anhangs ein. Auf der Seite der festgeschriebenen Rechnung stehen sie weiter unter **Anhänge** zum Ansehen und Herunterladen, im [Jahresarchiv](auswertungen.md#jahresexport) unter `rechnungen/anhaenge/` mit `anhaenge.csv`.

PDF, XML und E-Rechnung bleiben, wie sie sind: Die Anhänge stecken weder im ZUGFeRD-PDF noch in der XRechnung (keine BG-24 „Rechnungsbegründende Unterlagen“), sie gehen nur als eigene Dateien in der E-Mail mit.

## Ausbuchen

Ist eine festgeschriebene Rechnung noch offen, steht auf ihrer Seite der Abschnitt **Ausbuchen**. Dort buchst du einen Rest aus, den du nicht mehr bekommst: **Forderungsausfall** (uneinbringlich, etwa bei Insolvenz) oder **Skonto gewährt**, jeweils mit Datum und Betrag (vorbelegt: der ganze offene Betrag). Haben mindert Erlöse und Umsatzsteuer anteilig je Steuersatz (§ 17 UStG) und bucht

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 8730 Gewährte Skonti bzw. 2400 Forderungsverluste | 4730 bzw. 6930 | netto | |
| Umsatzsteuer (bei Ist: nicht fällig) | | Steuer | |
| 1400 Forderungen | 1200 Forderungen | | brutto |

Bei Soll-Versteuerung mindert die Ausbuchung die Voranmeldung des Monats, in dem du ausbuchst; bei Ist zählt ohnehin nur, was bezahlt wurde. Ausbuchungen stehen mit Datum und Betrag in der Liste darüber und lassen sich dort aufheben (Gegenbuchung). Wurde der Rest zusammen mit einer Zahlung im Bankabgleich ausgebucht (Rest als Skonto), hebst du ihn dort mit der Zuordnung auf; zusammen mit einer Bareinnahme mit deren Storno im Kassenbuch. Stornorechnungen lassen sich nicht ausbuchen.

Zahlt der Kunde später doch, hebst du die Ausbuchung auf und ordnest die Zahlung zu. Die Aufhebung bucht Haben am Tag, an dem du sie vornimmst: Bei Soll-Versteuerung ist die Umsatzsteuer dann im Monat des Zahlungseingangs erneut zu berichtigen (§ 17 Abs. 2 Nr. 1 Satz 2 UStG), die schon gesendete Voranmeldung des Ausbuchungsmonats bleibt richtig. Hebe die Ausbuchung deshalb im Monat der Zahlung auf.

Eine ausgebuchte Rechnung lässt sich erst stornieren, wenn die Ausbuchung aufgehoben ist; sonst minderte das Storno die Umsatzsteuer ein zweites Mal.

## Per E-Mail versenden

Mit einem E-Mail-Zugang ([Einstellungen › E-Mail › E-Mail-Versand](einrichtung.md#e-mail)) verschickt Haben festgeschriebene Rechnungen, Stornos, Korrekturen und Mahnungen. Auf der Seite der Rechnung unter **Per E-Mail**:

1. **Rechnung senden** öffnet das Formular. Vorbelegt sind alle E-Mail-Adressen aus dem Kontakt (etwa Rechnungseingang und Freigeber), sonst die Adresse auf der Rechnung, dazu Betreff und Text aus der Vorlage. Alles lässt sich vor dem Senden ändern; mehrere Empfänger trennst du mit Komma (höchstens fünf).
2. Hat die Rechnung [zusätzliche Anhänge](#zusätzliche-anhänge), stehen sie unter **Zusätzliche Anhänge mitsenden**, alle angehakt. Was nicht mitgehen soll, hakst du ab.
3. **Blindkopie an mich** schickt eine Kopie an den Absender aus den Einstellungen.
4. **Jetzt senden** verschickt die Mail sofort.

Bei GmbH und UG hängt Haben beim Senden die [Pflichtangaben](#pflichtangaben-einer-gmbh-oder-ug) als Signatur unter den Text (Firmenname, Sitz, Registergericht und -nummer, Geschäftsführung); das Formular zeigt sie unter dem Textfeld. Sie steht nicht im bearbeitbaren Text, damit sie beim Ändern nicht verloren geht.

| Format | Anhang |
| --- | --- |
| ZUGFeRD | `Rechnung-<Nummer>.pdf` mit eingebettetem XML |
| XRechnung | `Rechnung-<Nummer>.pdf` zur Ansicht und `Rechnung-<Nummer>-cii.xml` bzw. `-ubl.xml` als E-Rechnung |
| Mahnung | das PDF der Mahnung, z. B. `Zahlungserinnerung-<Nummer>.pdf` |

Ausgewählte zusätzliche Anhänge kommen bei Rechnungen nach PDF und XML dazu, mit ihrem Dateinamen.

Jeder Versand steht mit Zeitpunkt, Empfänger und den Dateinamen der tatsächlich versandten Anhänge unter **Per E-Mail**, auch fehlgeschlagene mit der Meldung des Servers. In der Rechnungsliste markiert ✉ per E-Mail versendete Rechnungen. Das Protokoll ist unveränderlich (`mail_log`).

**Vorlagen:** Betreff und Text stellst du unter Einstellungen › E-Mail › E-Mail-Versand › Vorlagen ein, je Sprache (Deutsch, Englisch) und Art:

| Vorlage | gilt für | leer |
| --- | --- | --- |
| Rechnung (allgemein) | alle Rechnungen ohne eigene Vorlage ihrer Art | Standardtext |
| Abschlagsrechnung, Schlussrechnung, Stornorechnung, Rechnungskorrektur | diese Art | Vorlage Rechnung, sonst Standardtext |
| Angebot | Angebote | Standardtext |
| Mahnung (allgemein) | alle Mahnstufen ohne eigene Vorlage | Standardtext |
| Zahlungserinnerung, 1. Mahnung, Letzte Mahnung | diese Stufe | Vorlage Mahnung, sonst Standardtext |

Es gilt die Sprache der Rechnung bzw. des Angebots. Mahnungen sind immer deutsch, auch zu einer englischen Rechnung, weil das PDF der Mahnung deutsch ist. Betreff und Text fallen einzeln zurück: Trägst du nur einen Betreff ein, bleibt der Text der allgemeinen Vorlage bzw. der Standardtext. Unter dem Feld steht, was gilt, wenn es leer bleibt. Platzhalter:

| Platzhalter | Inhalt |
| --- | --- |
| `{art}` | Rechnung, Abschlagsrechnung, Schlussrechnung, Stornorechnung oder Rechnungskorrektur (auf Englisch „Invoice“ …) |
| `{nummer}`, `{datum}` | Rechnungsnummer und -datum |
| `{betrag}` | Bruttobetrag, bei Mahnungen der offene Gesamtbetrag mit Gebühren und Zinsen |
| `{faellig}` | Fälligkeit der Rechnung |
| `{zahlbar}` | „, zahlbar bis zum …“ bei Rechnungen mit Betrag, sonst leer |
| `{kunde}`, `{firma}` | Name des Kunden und deiner Firma |
| `{stufe}`, `{frist}` | nur Mahnungen: Zahlungserinnerung, 1. Mahnung oder Letzte Mahnung und die neue Zahlungsfrist |
| `{gueltig}` | nur Angebote: gültig bis |

Öffentliche Auftraggeber verlangen XRechnungen oft über ihr eigenes Portal (ZRE, OZG-RE oder Peppol) statt per E-Mail; das kann Haben nicht.

## Storno und Rechnungskorrektur

Eine festgeschriebene Rechnung änderst du nicht, du stellst eine neue aus. Auf der Detailseite einer Rechnung gibt es dafür den Abschnitt **Korrigieren**.

| | Stornieren | Rechnungskorrektur anlegen |
| --- | --- | --- |
| Zweck | Hebt die Rechnung vollständig auf. | Mindert den Betrag teilweise. |
| Ergebnis | Stornorechnung mit allen Positionen negativ, sofort festgeschrieben und gebucht. | Entwurf mit allen Positionen negativ, den du anpasst. |
| Bestätigung | Zweiter Klick auf **Jetzt stornieren**. | Festschreiben wie bei einer Rechnung. |
| Bedingung | – | Gesamtbetrag muss negativ bleiben. |

Für beide gilt:

- Sie bekommen eine eigene Nummer aus demselben Nummernkreis und das heutige Datum.
- Sie gehen an die Anschrift, die auf der ursprünglichen Rechnung steht; der Kunde ist im Editor nicht wählbar.
- Sie übernehmen die Umsatzsteuer-Behandlung und den Hinweis der ursprünglichen Rechnung.
- PDF und XML verweisen auf die ursprüngliche Rechnung („zur Rechnung 2026-034 vom …“, im XML als BillingReference).
- Im XML erscheinen sie als Gutschrift (Typcode 381) mit positiven Beträgen; der Zahlungsweg ist offen gelassen, das PDF sagt „Der Betrag wird Ihnen erstattet.“
- Eine bereits stornierte Rechnung lässt sich nicht noch einmal stornieren oder korrigieren. Storno und Korrektur selbst lassen sich nicht weiter korrigieren.
- War die Rechnung schon (teilweise) bezahlt, ist die Stornorechnung im Bankabgleich mit dem gezahlten Betrag offen. Die Rückzahlung an den Kunden ordnest du dort der Stornorechnung zu; bei Ist-Versteuerung mindert sie im Monat der Rückzahlung die Umsatzsteuer.

Die ursprüngliche Rechnung zeigt unter **Korrekturen** alle Stornos und Korrekturen, die sich auf sie beziehen, eine stornierte Rechnung zusätzlich einen roten Hinweis mit Link zur Stornorechnung.

Im Bankabgleich ist eine stornierte Rechnung nicht mehr offen. Eine Rechnungskorrektur erscheint dort als offener Posten mit negativem Betrag, dem du eine Rückzahlung zuordnen kannst.

## Kontakte

Kontakte erreichst du in der Navigation unter **Verkauf › Kontakte**. Es gibt ein gemeinsames Verzeichnis für Kunden und Lieferanten: Eine Firma, bei der du einkaufst und der du auch Rechnungen schreibst, steht nur einmal drin. **Alle**, **Kunden** und **Lieferanten** über der Liste filtern nach Rolle. Das Suchfeld filtert nach Name, Kundennummer, E-Mail und Ort; **Archivierte zeigen** blendet archivierte Kontakte ein.

| Feld | Hinweis |
| --- | --- |
| Name oder Firma | Pflicht |
| Rolle | **Kunde**, **Lieferant** oder beides; mindestens eine. Kunden stehen bei Rechnungen, Angeboten, Serienrechnungen und Textbausteinen zur Auswahl, Lieferanten bei den [Belegen](belege.md). Kontakte von vor dieser Einstellung sind Kunden. |
| Lieferantennummer | Frei, z. B. deine Kundennummer beim Lieferanten. |
| Kundennummer | Erscheint auf der Rechnung und als Käuferkennung im XML. Mit einem Format unter **Einstellungen › Rechnungen › Kundennummern** vergibt Haben sie beim Anlegen selbst, wenn du das Feld leer lässt (siehe unten). |
| E-Mail | Eine oder mehrere Adressen, mit Komma getrennt (höchstens fünf), etwa zentraler Rechnungseingang und Freigeber. Der Versand per E-Mail schreibt an alle. Für XRechnung gilt die erste als elektronische Adresse des Käufers (BT-49). |
| Straße und Hausnummer, PLZ, Ort | Für das Festschreiben vollständig nötig. |
| Land (ISO-Code) | Zwei Buchstaben, Vorgabe `DE`. Andere Länder erscheinen ausgeschrieben in der Anschrift. |
| USt-IdNr. | Form `DE123456789`, steht dann auf der Rechnung. |
| IBAN | Hilft beim Bankabgleich. Wird beim ersten zugeordneten Zahlungseingang automatisch gemerkt, wenn das Feld leer ist. |
| Leitweg-ID (öffentliche Auftraggeber) | Steht auf der Rechnung und wird im XML als Käuferreferenz verwendet. |
| Standardformat für Rechnungen | ZUGFeRD, XRechnung (CII), XRechnung (UBL) oder „wie in den Einstellungen“. |
| Skonto | „wie in den Einstellungen“ oder „eigenes für diesen Kunden“ mit bis zu drei Stufen; ohne Stufe bekommt der Kunde kein Skonto (siehe [Skonto](#skonto)). |

**Kundennummern automatisch.** Unter **Einstellungen › Rechnungen › Kundennummern** trägst du ein Format wie `K-{NNNN}` und die nächste laufende Nummer ein. Legst du dann einen Kontakt ohne Kundennummer an, vergibt Haben die nächste (`K-0001`, `K-0002` …); das Formular zeigt sie vorab an. Platzhalter wie beim [Nummernformat](einrichtung.md#nummernformat), das Jahr ist hier aber nicht nötig, weil der Zähler nicht jährlich neu beginnt. Eine eingetragene Nummer bleibt, wie sie ist, und zählt nicht mit; Nummern, die ein Kontakt schon trägt, etwa aus einem Import, überspringt Haben. Beim Bearbeiten eines Kontakts vergibt Haben keine Nummer, und einem reinen Lieferanten (ohne Häkchen **Kunde**) auch nicht. Leeres Format schaltet die automatische Vergabe ab.

**Versionen.** Jede Änderung erhöht die Versionsnummer, der vorige Stand bleibt als Version erhalten. Die Detailseite listet alle Versionen mit Zeitpunkt. Festgeschriebene Rechnungen behalten die Anschrift, die beim Festschreiben galt.

**Aus einer Liste übernehmen.** **CSV importieren** über der Liste übernimmt Kunden und Lieferanten aus einer CSV-Datei, etwa dem Kontakt-Export von Lexware Office, mit Vorschau und ohne Dubletten ([CSV-Import](csv-import.md#kontakte)).

**Archivieren.** Kontakte lassen sich nicht löschen, nur mit **Archivieren** ausblenden und mit **Wiederherstellen** zurückholen. Archivierte Kontakte stehen nicht in der Kundenauswahl des Editors; in der Liste zeigst du sie mit **Archivierte zeigen**.

## Entwürfe aus der REST-API

Eigene Werkzeuge, etwa für Bestellungen aus Etsy oder eBay, legen über die [REST-API](api.md) Kontakte und Rechnungsentwürfe an. Diese Entwürfe stehen in der Rechnungsliste wie jeder andere; du prüfst sie im Editor und schreibst sie fest, die API selbst schreibt nichts fest und bucht nichts. Ein Entwurf kann die Plattform und die Bestellnummer tragen (externe Referenz): Kommt dieselbe Bestellung noch einmal, entsteht kein zweiter Entwurf. Die Referenz wird mit der Rechnung festgeschrieben.

## Rechnungen aus Lexoffice

Offene Rechnungen, die du bei der Migration aus Lexoffice übernimmst (siehe [lexoffice.md](lexoffice.md)), erscheinen als festgeschriebene Rechnungen mit ihrer Lexoffice-Nummer. Als Format steht dort **Original aus Lexoffice**: Das PDF ist das Original aus Lexoffice, ein XML gibt es nur, wenn Lexoffice eines geliefert hat. Haben bildet je Steuersatz eine Pauschalposition nach, damit Zahlungen im Bankabgleich zugeordnet werden können.

Gebucht werden diese Rechnungen nicht als Erlös, sondern gegen den Saldenvortrag (9000), weil der Erlös schon in den alten Büchern steht. Bei Ist-Versteuerung kommt die noch nicht angemeldete Umsatzsteuer auf „Umsatzsteuer nicht fällig“ und wird mit dem Zahlungseingang fällig. Stornierst oder korrigierst du eine solche Rechnung, bucht Haben ebenfalls gegen den Saldenvortrag statt gegen die Erlöse; bei Soll-Versteuerung mindert das Storno die in Lexoffice angemeldete Umsatzsteuer.

## Prüfung gegen den KoSIT-Validator

Die CI prüft bei jedem Push auf `main` und in jedem Pull Request die erzeugten E-Rechnungen mit dem offiziellen KoSIT-Validator (Version 1.5.0) und der XRechnung-Konfiguration 3.0.2. Geprüft werden Beispielrechnungen in den drei Formaten, darunter einfache Rechnung zu 19 %, gemischte Steuersätze, Storno, Rechnungskorrektur, Leitweg-ID, einzelnes Leistungsdatum, Absender nur mit Steuernummer, eine Rechnung zum Nullsatz, je eine Rechnung mit Reverse Charge, ins Drittland, als innergemeinschaftliche Lieferung (mit Leistungszeitraum und mit Lieferdatum, dazu ein Storno), als Ausfuhrlieferung, steuerfrei nach § 4 UStG und als Kleinunternehmer sowie Rechnungen mit Bruttopreisen (gemischte Sätze, Storno, 9,80 € zu 19 %, Schlussrechnung, große Mengen) und Rechnungen mit Skonto (zwei Stufen, mit Leitweg-ID). Die Prüfberichte liegen als Artefakt am CI-Lauf. Wie du die Prüfung lokal startest, steht in [entwicklung.md](entwicklung.md).

## Grenzen

- Nur die Steuersätze 19 %, 7 % und 0 %. Fremdwährung mit den Einschränkungen unter [Rechnungen in Fremdwährung](#rechnungen-in-fremdwährung); Angebote nur in Euro.
- Innergemeinschaftliche Lieferungen nur an Unternehmer mit USt-IdNr. Nicht unterstützt: Lieferungen an Abnehmer ohne USt-IdNr. und neue Fahrzeuge (Kz 44, 49), Dreiecksgeschäfte (§ 25b UStG), Lieferungen in ein Konsignationslager (§ 6b UStG), das innergemeinschaftliche Verbringen eigener Ware und Versandhandel an Privatkunden im EU-Ausland (One-Stop-Shop). Eine eigene Lieferanschrift gibt es nicht; Haben nimmt die Anschrift des Kunden.
- Ausfuhrlieferungen nur an Kunden mit Anschrift außerhalb der EU; den Ausfuhrnachweis führt Haben nicht.
- Skonto nur vom ganzen Rechnungsbetrag (kein Basisbetrag nach BR-DE-18), höchstens drei Stufen, nur in Euro. Keine Zu- oder Abschläge auf Belegebene.
- Höchstens 200 Positionen je Rechnung.
- Rechnungen gehen per E-Mail über deinen SMTP-Zugang, nicht über Peppol oder die Portale öffentlicher Auftraggeber.
- Zusätzliche Anhänge nur als PDF, bis 20 MB je Datei und zehn je Rechnung. Viele Mailserver nehmen Mails ab etwa 25 MB nicht mehr an; das Versandprotokoll zeigt dann die Meldung des Servers. Anhänge lassen sich nur in Haben hochladen, nicht über die [REST-API](api.md); [wiederkehrende Rechnungen](#wiederkehrende-rechnungen) haben keine Anhänge und versenden ohne sie. Mahnungen gehen ohne die Anhänge der Rechnung.
