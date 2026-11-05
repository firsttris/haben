# Belege und Eingangsrechnungen

Unter **Belege** legst du Eingangsrechnungen und Quittungen ab. E-Rechnungen liest Haben direkt aus, andere PDFs und Fotos auf Wunsch mit Claude. Du prüfst die Felder, wählst eine Kategorie und buchst den Beleg; danach ist er festgeschrieben.

<img src="screenshot-belege.png" alt="Belegdetail mit PDF-Vorschau links und den ausgelesenen Feldern Lieferant, Belegdatum, Kategorie und Beträge je Steuersatz rechts" width="900">

## So gehst du vor

1. Beleg hochladen (siehe unten).
2. Den Beleg in der Liste öffnen. Ist er aus einer E-Rechnung oder von der KI vorbefüllt, steht dort „Vorbefüllt aus … Bitte prüfen und bestätigen.“
3. **Lieferant**, **Rechnungsnummer**, **USt-IdNr. des Lieferanten**, **Belegdatum**, **Fällig am** und **Kategorie** prüfen oder eintragen. Ist der Lieferant schon in den Kontakten (Rolle **Lieferant**), wählst du ihn unter **Aus den Kontakten**; Haben übernimmt Name und USt-IdNr. Änderst du den Namen danach von Hand, fällt die Verknüpfung weg. Ein neuer Lieferant lässt sich wie bisher einfach eintippen.
4. Unter **Beträge je Steuersatz** Netto und Vorsteuer je Satz prüfen. Mit **+ Steuersatz** kommt eine Zeile für einen weiteren Satz dazu (höchstens 19 %, 7 % und 0 % je einmal). Gehören Teile der Rechnung in verschiedene Kategorien, teilst du sie mit **Auf mehrere Kategorien aufteilen** auf (siehe [Auf mehrere Kategorien aufteilen](#auf-mehrere-kategorien-aufteilen)).
5. Unter **Bezahlung** wählen, ob der Beleg über das Geschäftskonto oder privat bezahlt wurde.
6. **Bestätigen und buchen**, dann **Jetzt buchen**. Ungespeicherte Änderungen werden dabei vorher gespeichert.

Mit **Speichern** sicherst du Zwischenstände, ohne zu buchen.

## Hochladen

Es gibt mehrere Wege, alle führen zum selben Ergebnis:

| Weg | Wie |
| --- | --- |
| Ziehen und Ablegen | Dateien auf die Fläche „Belege hierher ziehen“ ziehen. |
| Dateiauswahl | **Dateien auswählen**, auch mehrere auf einmal (bis 50 je Vorgang). |
| Kamera | Auf dem Handy **Foto aufnehmen**; öffnet direkt die Rückkamera. |
| Teilen-Menü | In der als App installierten Version (PWA) taucht Haben im Teilen-Menü des Telefons auf. Geteilte Dateien gehen an `/api/belege/teilen` (bis 20 je Vorgang). Bei genau einer Datei öffnet Haben danach gleich den Beleg, sonst die Liste. |
| E-Mail | Anhänge aus einem eigenen Postfach, siehe [Belege per E-Mail](#belege-per-e-mail). |
| REST-API | Eigene Werkzeuge, Dokumentenarchive und Skripte schicken Belege mit einem API-Token, siehe [Belege aus der REST-API](#belege-aus-der-rest-api). |

Erlaubt sind PDF, JPEG, PNG, WebP, HEIC und E-Rechnungs-XML bis 20 MB je Datei. Nach dem Hochladen meldet Haben je Datei „abgelegt“, „liegt schon in Haben, nicht doppelt abgelegt“ oder den Grund der Ablehnung.

### Was im Hintergrund passiert

1. **Dateityp erkennen.** Haben erkennt den Typ am Inhalt der Datei (den ersten Bytes), nicht an Dateiendung oder Browserangabe. XML wird auch mit vorangestelltem UTF-8-BOM erkannt.
2. **Ablegen unter dem SHA-256.** Die Datei wird unter ihrem SHA-256-Hash im Verzeichnis `DOCUMENTS_DIR` gespeichert (`<dir>/ab/abcdef…`), atomar über eine temporäre Datei. Beim Lesen prüft Haben den Hash erneut und meldet eine beschädigte Datei.
3. **Keine Dubletten.** Gibt es schon einen Beleg mit demselben Hash, entsteht kein zweiter; du landest beim vorhandenen.
4. **E-Rechnung lesen.** Bei PDF und XML versucht Haben zuerst, eine E-Rechnung zu lesen (siehe unten).
5. **KI-Auslesung.** Ist es keine E-Rechnung und ist ein Anthropic-API-Schlüssel eingerichtet, startet für PDF, JPEG, PNG und WebP die KI-Auslesung im Hintergrund. Der Beleg zeigt solange „Wird ausgelesen“, Liste und Detailseite aktualisieren sich selbst.

Ohne E-Rechnung und ohne KI füllst du die Felder von Hand aus.

## Belege per E-Mail

Viele Rechnungen kommen per Mail. Unter **Einstellungen › E-Mail › Belege per E-Mail** trägst du ein Postfach ein, aus dem Haben sie selbst abholt:

- **Zugang:** IMAP-Server, Port, Verschlüsselung, Benutzername, Passwort und Ordner. Für Gmail, GMX, web.de, Posteo und mailbox.org sind Server und Port vorbelegt; Gmail, GMX und web.de brauchen ein App-Passwort bzw. freigeschaltetes IMAP. Das Passwort liegt verschlüsselt in der Datenbank.
- **Was abgeholt wird:** jede ungelesene Mail im Ordner. Ihre Anhänge gehen wie beim Hochladen zu den Belegen. E-Rechnungen werden gelesen, sonst greift die KI-Auslesung, und Dubletten erkennt Haben am Inhalt.
- **Was übersprungen wird:** eingebettete Bilder wie Logos und Signaturen sowie Dateien, die kein Beleg sein können (Word, ZIP …). Der Grund steht im Abrufprotokoll.
- **Danach** ist die Mail im Postfach als gelesen markiert. Am Beleg steht als Notiz, von wem und mit welchem Betreff er kam.
- **Wann:** stündlich, solange „Stündlich abrufen“ an ist, oder sofort mit **Jetzt abrufen**. Je Lauf höchstens 50 Mails.

Am besten richtest du eine eigene Adresse oder einen Ordner mit Filterregel ein, etwa `belege@…` oder „Rechnungen“, und leitest Rechnungen dorthin weiter. Im Hauptpostfach würde Haben jede ungelesene Mail anfassen.

Jede abgeholte Mail steht mit ihrer Message-ID genau einmal im Abrufprotokoll (nur anhängen). Markierst du sie wieder als ungelesen, legt Haben sie kein zweites Mal ab. Schlägt der Abruf fehl, etwa wegen eines falschen Passworts, steht der Fehler in den Einstellungen und auf der Belegseite.

## Belege aus der REST-API

Liegen deine Belege schon in einem anderen System, etwa einem Dokumentenarchiv, oder holt ein eigenes Skript sie aus Kundenportalen, dann liefert es sie über die [REST-API](api.md#belege) an Haben: `POST /api/v1/belege` mit der Datei im Feld `datei`, angemeldet mit einem API-Token, das das Recht „Belege lesen und hochladen“ (`belege:anlegen`) hat. Ein Token mit `belege:lesen` sieht nur den Stand.

- **Derselbe Weg wie beim Hochladen:** gleiche Formate und 20 MB je Datei, Ablage unter dem SHA-256, E-Rechnungen werden sofort gelesen, sonst greift die KI-Auslesung, wenn sie eingerichtet ist.
- **Der Beleg landet als „Zu prüfen“** in der Liste, gebucht wird nichts. Du prüfst und buchst ihn wie jeden anderen. Im Änderungsprotokoll steht als Akteur der Name des Tokens (`api:Dokumentenarchiv`).
- **Keine Dubletten:** Das Werkzeug kann zu jedem Beleg eine Referenz mitschicken, Quelle und Kennung des Dokuments (`externalSource`, `externalId`). Dieselbe Referenz legt keinen zweiten Beleg an, auch nicht bei gleichzeitigen Anfragen. Dieselbe Datei erkennt Haben wie beim Hochladen am Inhalt; kommt sie mit einer anderen Referenz, lehnt die API sie ab und nennt den vorhandenen Beleg.
- **Stand abfragen:** `GET /api/v1/belege` mit Filter nach Status und Referenz, `GET /api/v1/belege/{id}` mit Status, ob gebucht, was noch fehlt, und dem Link zur Seite in Haben. So sieht das Werkzeug, was schon geprüft und gebucht ist.
- **Nicht über die API:** ändern, buchen, löschen und die Datei herunterladen. Löschst du einen ungebuchten Beleg in Haben, ist seine Referenz wieder frei.

Einrichtung, Antworten und ein Beispiel mit `curl` stehen unter [REST-API › Belege](api.md#belege).

## E-Rechnungen

Haben liest diese Formate:

| Format | Erkennung | Quelle in der Liste |
| --- | --- | --- |
| ZUGFeRD 2.x / Factur-X | PDF mit eingebetteter XML-Datei | ZUGFeRD |
| ZUGFeRD 1.0 | PDF mit eingebetteter XML (`CrossIndustryDocument`) | ZUGFeRD |
| XRechnung als PDF-Anhang | PDF mit eingebetteter `xrechnung.xml` | ZUGFeRD |
| XRechnung CII | XML-Datei mit Wurzel `CrossIndustryInvoice` | XRechnung |
| XRechnung UBL | XML-Datei mit Wurzel `Invoice` oder `CreditNote` | XRechnung |

Im PDF sucht Haben zuerst nach den Anhängen `factur-x.xml`, `zugferd-invoice.xml` und `xrechnung.xml`, danach nach jedem anderen XML-Anhang.

Übernommen werden Lieferant, USt-IdNr. des Lieferanten, Rechnungsnummer, Rechnungsdatum, Fälligkeit, Währung und die Beträge je Steuersatz. Gutschriften (z. B. Typcode 381 oder UBL `CreditNote`) werden mit negativen Beträgen übernommen. Steuersätze außer 19, 7 und 0 % werden nicht übernommen, sondern als Hinweis am Beleg angezeigt. Bei einer Fremdwährung übernimmt Haben die Beträge als Originalbeträge und rechnet sie mit dem Umsatzsteuer-Umrechnungskurs des Monats um (siehe [Fremdwährung](#fremdwährung)).

Lässt sich eine hochgeladene XML-Datei nicht als E-Rechnung lesen, steht der Fehler am Beleg. Bei einem PDF, dessen eingebettetes XML nicht lesbar ist, geht Haben weiter zur KI-Auslesung.

Eine E-Rechnung bringt keine Kategorie mit. Haben schlägt die Kategorie vor, unter der du Belege desselben Lieferanten bisher am häufigsten gebucht hast; gibt es keinen, bleibt das Feld leer.

## KI-Auslesung mit Claude

Die KI-Auslesung ist optional und nur aktiv, wenn `ANTHROPIC_API_KEY` gesetzt ist (siehe [installation.md](installation.md)). Ohne Schlüssel funktioniert alles andere weiter, auch das Lesen von E-Rechnungen.

**Was gesendet wird:** die Belegdatei selbst (PDF als Dokument, JPEG, PNG oder WebP als Bild) zusammen mit einer festen Anweisung und der Liste der Ausgabenkategorien. Sonst nichts aus deiner Buchhaltung. HEIC-Fotos und XML-Dateien gehen nicht an die KI.

**Was zurückkommt:** ein festes Schema mit Lieferant, USt-IdNr., Rechnungsnummer, Belegdatum, Fälligkeit, Währung, Netto und Steuer je Steuersatz, Bruttobetrag, Kategorie, ob es eine Gutschrift ist, und einem Hinweis bei Unklarheiten. Die Anweisung verlangt, nur zu übernehmen, was auf dem Beleg steht, und nichts zu raten.

Haben prüft die Antwort und zeigt Auffälligkeiten als Hinweis am Beleg:

- Netto plus Steuer weicht vom Gesamtbetrag ab.
- Ein Betrag ist nicht lesbar.
- Die Währung ist nicht Euro und der Kurs des Monats ist noch nicht veröffentlicht: Die Beträge stehen dann als Originalbeträge am Beleg, der Kurs fehlt noch.
- Der Hinweis der KI zu unklaren Stellen.

Die KI bucht nie selbst. Jeder ausgelesene Beleg bleibt im Status „Zu prüfen“, bis du ihn mit **Bestätigen und buchen** bestätigst. Mit **Mit KI neu auslesen** kannst du die Auslesung wiederholen, solange der Beleg nicht gebucht ist; dabei werden die Felder überschrieben und eine Aufteilung auf mehrere Kategorien verworfen. Fehler (ungültiger Schlüssel, Auslastung, keine Verbindung, abgelehnte Auslesung) stehen am Beleg, der dann den Status „Prüfen“ trägt.

Bei der Kategorie haben die gebuchten Belege desselben Lieferanten Vorrang vor dem Vorschlag der KI: Haben nimmt die Kategorie, unter der sie am häufigsten gebucht sind, bei Gleichstand die zuletzt gebuchte. So wechselt der Vorschlag nicht, nur weil ein Lieferant wie Amazon einmal etwas anderes geliefert hat. Erkannt wird der Lieferant an der USt-IdNr. oder am Namen (ohne Groß- und Kleinschreibung). Unter dem Feld **Kategorie** steht, wie oft, etwa „Bisher 7 von 9 Belegen als Software und Lizenzen gebucht“; hast du eine andere gewählt, übernimmst du die bisherige mit **übernehmen**.

## Kategorien

Die Kategorie bestimmt das Aufwandskonto. Die Zuordnung steht in `packages/core/src/posting.ts`.

| Kategorie | SKR03 | SKR04 |
| --- | --- | --- |
| Software und Lizenzen | 4964 | 6837 |
| Hosting und IT-Dienste | 4806 | 6495 |
| Hardware (GWG bis 800 € netto) | 0480 | 0670 |
| Telefon | 4920 | 6805 |
| Internet | 4925 | 6810 |
| Bürobedarf | 4930 | 6815 |
| Fachliteratur | 4940 | 6820 |
| Fortbildung | 4945 | 6821 |
| Reisekosten: Fahrten | 4673 | 6673 |
| Reisekosten: Übernachtung | 4676 | 6680 |
| Porto | 4910 | 6800 |
| Werbung | 4600 | 6600 |
| Bewirtung von Geschäftspartnern (70 % abziehbar) | 4650 | 6640 |
| Geschenke an Geschäftspartner (bis 50 € je Empfänger und Jahr) | 4630 | 6610 |
| Rechts- und Beratungskosten | 4950 | 6825 |
| Buchführung und Steuerberatung | 4955 | 6830 |
| Wareneinkauf (Handelsware) | 3200 | 5200 |
| Fremdleistungen | 3100 | 5900 |
| Kontoführung und Gebühren | 4970 | 6855 |
| Versicherungen | 4360 | 6400 |
| Beiträge | 4380 | 6420 |
| Sonstiger Aufwand | 4900 | 6300 |
| Kfz: Laden, Tanken, Wartung | 4530 | 6530 |
| Kfz: Versicherung | 4520 | 6520 |
| Kfz: Steuer | 4510 | 7685 |
| Kfz: Reparaturen | 4540 | 6540 |
| Kfz: Leasing | 4570 | 6560 |
| Anlagegut (wird abgeschrieben) | Anlagekonto je Art | Anlagekonto je Art |

**Bewirtung** von Geschäftspartnern zählt zu 70 % als Betriebsausgabe, die Vorsteuer voll; die Aufteilung macht die EÜR. **Geschenke** an Geschäftspartner sind nur bis 50 € netto je Empfänger und Jahr abziehbar (bis 2023: 35 €). Teurere Geschenke sind keine Betriebsausgabe, auch die Vorsteuer nicht: Buche sie mit Privatanteil 100 %.

Mit **Anlagegut** wird der Beleg nicht zum Aufwand, sondern legt beim Buchen eine Anlage im Verzeichnis an, die über die Nutzungsdauer abgeschrieben wird. Das Formular fragt dann nach Bezeichnung, Art, Abschreibung und Nutzungsdauer. Mehr unter [Anlagen und AfA](anlagen.md).

> [!IMPORTANT]
> Kategorien und Konten sind ein Vorschlag für typische Freiberufler-Ausgaben. Gleiche sie vor dem Echtbetrieb mit deiner Steuerberatung ab, besonders Hardware (GWG-Grenze) und Reisekosten.

## Beträge

Du gibst je Steuersatz Netto und Vorsteuer ein. Solange du die Vorsteuer nicht selbst geändert hast, rechnet Haben sie aus dem Netto vor. Beim Buchen übernimmt Haben die Vorsteuer genau so, wie sie im Formular steht, und rechnet nicht nach: maßgeblich ist der Betrag auf der Rechnung.

Gutschriften gibst du mit Minus ein.

## Auf mehrere Kategorien aufteilen

Stehen auf einer Rechnung Dinge, die auf verschiedene Konten gehören, etwa Handelsware, Softwarelizenzen und Bürobedarf, teilst du den Beleg auf. Er bleibt ein Beleg mit einer Datei, einem offenen Posten und einer Zahlung; nur das Netto geht auf mehrere Kategorien.

1. Unter **Beträge je Steuersatz** die Beträge laut Rechnung eintragen, wie ohne Aufteilung.
2. Unter dem Feld **Kategorie** auf **Auf mehrere Kategorien aufteilen** klicken. Darunter erscheint **Aufteilung auf Kategorien** mit einer Zeile je Steuersatz (die erste mit der bisherigen Kategorie und dem Netto des Satzes) und einer leeren Zeile.
3. Je Zeile **Kategorie**, **Satz** und **Netto** eintragen. Mit **+ Zeile** kommt eine weitere dazu, mit dem Kreuz neben der Zeile fällt sie weg (mindestens zwei bleiben). Mehrere Zeilen mit demselben Satz und auch derselben Kategorie sind erlaubt.
4. Unter den Zeilen steht je Steuersatz, wie viel schon verteilt ist, etwa „19 %: Zeilen 150,00 € von 170,00 € netto · noch 20,00 € zu verteilen“, bis es „stimmt“. Unter jedem Netto steht der Anteil an der Vorsteuer.
5. **Speichern** oder **Bestätigen und buchen** wie sonst. Mit **Aufteilung aufheben** gilt wieder eine Kategorie für den ganzen Beleg, die der ersten Zeile.

Beispiel, alles zu 19 %: 100,00 € Handelsware, 50,00 € Software und 20,00 € Bürobedarf ergeben 170,00 € netto, 32,30 € Vorsteuer und 202,30 € Zahlbetrag. Gebucht wird eine Buchung (SKR04 in Klammern):

| Konto | Soll | Haben |
| --- | ---: | ---: |
| 3200 (5200) Wareneinkauf | 100,00 | |
| 4964 (6837) Software und Lizenzen | 50,00 | |
| 4930 (6815) Bürobedarf | 20,00 | |
| 1576 (1406) Vorsteuer 19 % | 32,30 | |
| 1600 (3300) Verbindlichkeiten | | 202,30 |

**Was maßgeblich ist.** Die Beträge je Steuersatz bleiben die des Belegs: Netto und Vorsteuer laut Rechnung, die Voranmeldung zählt sie wie bisher. Die Zeilen müssen je Satz genau dieses Netto ergeben; sonst steht vor dem Buchen etwa „Aufteilung 19 %: Zeilen zusammen 150,00 € netto, Beleg 170,00 €“, und Haben bucht nicht.

**Rundung.** Haben rechnet die Vorsteuer nicht je Zeile neu aus, sondern verteilt die Vorsteuer des Satzes anteilig nach Netto auf seine Zeilen und rundet kaufmännisch. Den Rundungsrest bekommt die betragsmäßig größte Zeile des Satzes (bei gleich großen die erste), wie beim Netto einer Bruttorechnung und beim Steueranteil einer Teilzahlung. So ergeben die Zeilen je Satz auf den Cent Netto und Vorsteuer des Belegs. Beispiel: 3 × 33,33 € zu 19 % mit 19,00 € Vorsteuer auf der Rechnung ergeben 6,34 €, 6,33 € und 6,33 €. Die Anteile werden beim Speichern berechnet, mit den Zeilen gespeichert und beim Buchen mit dem Beleg festgeschrieben.

**Buchung.** Je Kategorie und Steuersatz eine Aufwandszeile; zwei Zeilen mit gleicher Kategorie und gleichem Satz fasst Haben zusammen. Die Vorsteuer steht je Satz in einer Zeile, die Gegenbuchung (Verbindlichkeiten, Privateinlage, Gesellschafter oder Kasse) über den ganzen Betrag. Als Kleinunternehmer gehört der Vorsteueranteil jeder Zeile zu ihrem Aufwand. Gutschriften gibst du mit negativen Zeilen ein; Plus und Minus in einem Satz gemischt nimmt Haben nicht an.

**Zahlung, EÜR, DATEV.** Der Beleg steht einmal in den offenen Posten und im Bankabgleich, mit dem ganzen Betrag; Teilzahlungen und Skonto ordnest du ihm wie jedem Beleg zu. In der [EÜR](auswertungen.md) zählt jede Zahlung anteilig je Zeile in deren Kategorie; die Vorsteuer einer Teilzahlung ist dieselbe wie ohne Aufteilung, alle Zahlungen zusammen ergeben genau die Zeilen. Der DATEV-Export zerlegt die eine Buchung wie jede andere in Buchungssätze, je Aufwandskonto einer gegen die Verbindlichkeiten.

**Storno und Neuerfassung.** Ein [Storno](#stornieren-und-neu-erfassen) bucht die ganze Buchung mit allen Zeilen zurück; **Neu erfassen** übernimmt die Aufteilung in den neuen Entwurf.

**Noch nicht mit Aufteilung:** § 13b, Privatanteil, Fremdwährung und Anlagegüter. Haben lehnt das Buchen dann mit Grund ab („§ 13b mit Aufteilung wird nicht unterstützt“ usw.); solche Teile erfasst du als eigenen Beleg. Bei § 13b und Fremdwährung ist der Knopf zum Aufteilen gesperrt, mit Aufteilung fehlt das Feld **Privatanteil in %**.

## Privatanteil

Den Privatanteil gibt es nur im Einzelunternehmen; bei einer GmbH oder UG fehlt das Feld (siehe [Rechtsform](einrichtung.md#rechtsform-einzelunternehmen-gmbh-oder-ug)). Wird etwas auch privat genutzt, etwa der Handy- oder Internetvertrag, trägst du unter den Beträgen den **Privatanteil in %** ein. Nur der betriebliche Teil wird Ausgabe und Vorsteuer, der private Teil ist eine Entnahme:

```
4920 Telefon             32,00
1576 Vorsteuer 19 %       6,08
1800 Privatentnahmen      9,52   an  1600 Verbindlichkeiten   47,60
```

Vorgaben je Kategorie stellst du in den [Einstellungen](einrichtung.md#privatanteile) ein (Telefon, Internet). Sie werden beim Wählen der Kategorie und beim Auslesen übernommen. Bei Anlagegütern gibt es keinen Privatanteil; für Firmenwagen gilt die [Listenpreismethode](anlagen.md#private-nutzung-von-firmenwagen).

## Reverse Charge als Leistungsempfänger (§ 13b)

Viele Anbieter von Software und Cloud-Diensten aus dem EU-Ausland (Google, Microsoft, AWS, JetBrains, Adobe aus Irland oder den Niederlanden) stellen Unternehmern Rechnungen ohne Umsatzsteuer mit dem Hinweis „Reverse Charge“. Die Steuer schuldest dann du (§ 13b UStG) und ziehst sie im selben Zug als Vorsteuer wieder ab.

Unter **Umsatzsteuer auf dem Beleg** wählst du:

| Auswahl | Wann | Kennzahlen |
| --- | --- | --- |
| § 13b: Leistung eines Unternehmers aus dem EU-Ausland | sonstige Leistung eines Unternehmers mit Sitz in einem anderen EU-Land | Kz 46 (netto) und 47 (Steuer) |
| § 13b: Leistung eines Unternehmers aus dem Drittland | Leistung eines Unternehmers ohne Sitz in der EU, z. B. aus den USA, ohne deutsche Umsatzsteuer | Kz 84 (netto) und 85 (Steuer) |

Du trägst nur das Netto aus der Rechnung ein; Haben rechnet die Steuer zum gewählten Satz aus (änderbar). Bezahlt wird der Nettobetrag, der Bankabgleich erwartet also netto. Hat der Lieferant eine USt-IdNr. aus einem anderen EU-Land und steht keine Steuer auf dem Beleg, weist Haben darauf hin.

Gebucht wird (SKR03, SKR04 in Klammern):

- Aufwand netto an Verbindlichkeiten bzw. Privateinlage,
- Vorsteuer nach § 13b auf 1577 (1407) an Umsatzsteuer nach § 13b auf 1787 (3837).

In der [Voranmeldung](umsatzsteuer.md#-13b-als-leistungsempfänger) heben sich Steuer und Vorsteuer auf. Als Kleinunternehmer schuldest du die Steuer trotzdem, ziehst aber nichts ab: Sie wird Teil des Aufwands und ist mit der Voranmeldung zu zahlen. Mit Privatanteil ist die Steuer voll geschuldet, abziehbar nur der betriebliche Teil. In der EÜR zählt der gezahlte Nettobetrag; die Steuer an das Finanzamt erscheint dort, wenn sie gezahlt wird.

## Bezahlung

| Auswahl | Gegenkonto | Folge |
| --- | --- | --- |
| Über das Geschäftskonto (Zuordnung beim Bankabgleich) | Verbindlichkeiten | Der Beleg wird nach dem Buchen im [Bankabgleich](bank.md) als offener Posten angeboten. |
| Privat bezahlt (Privateinlage) | Privateinlagen | Der Beleg ist damit erledigt und taucht im Bankabgleich nicht auf. |
| Vom Gesellschafter ausgelegt (nur GmbH, UG) | Gesellschafter-Verrechnungskonto (SKR03 0730, SKR04 3510) | Wie privat bezahlt; die GmbH schuldet dem Gesellschafter den Betrag. |
| Bar aus der Kasse (Zeile im Kassenbuch) | Kasse | Beim Buchen entsteht eine Zeile im [Kassenbuch](kasse.md). Reicht der Kassenbestand am Belegdatum nicht, lehnt Haben das Buchen ab. |

## Überweisen (SEPA-Datei)

Unter **Überweisungen** (Menü **Ausgaben**) stellst du offene Belege zu einer SEPA-Datei zusammen, die du im Online-Banking hochlädst. Haben bucht dabei nichts: Bezahlt ist ein Beleg erst, wenn der [Bankabgleich](bank.md#überweisungen-aus-haben) die Abbuchung zuordnet.

1. **Auftraggeberkonto** wählen: eines der Bankkonten unter [Bank](bank.md#konto), von dem das Geld abgeht. Zahlungsdienstleister stehen nicht zur Wahl.
2. **Ausführungsdatum** setzen, frühestens heute.
3. Die Belege ankreuzen, einzeln oder mit **Alle auswählen**. Darunter stehen Anzahl und Summe.
4. **SEPA-Datei erzeugen**. Der Browser lädt die Datei `HABEN-….xml` herunter; unter **Erzeugte Dateien** bleibt sie zum erneuten Herunterladen.

In der Liste stehen alle gebuchten, nicht stornierten Belege mit Bezahlung über das Geschäftskonto, die noch offen sind, die älteste Fälligkeit zuerst. Teilweise bezahlte Belege erscheinen mit dem Rest.

| Angabe | Woher |
| --- | --- |
| Empfänger | Lieferant am Beleg |
| IBAN | Aus dem Kontakt des Lieferanten (unter **Aus den Kontakten** gewählt), sonst aus der E-Rechnung (BT-84) |
| Betrag | Offener Betrag, mit Skonto abzüglich Skonto |
| Verwendungszweck | Rechnungsnummer des Lieferanten, ohne Nummer „Rechnung vom …“; mit Skonto zusätzlich „abzgl. 2,00 Prozent Skonto 4,31 EUR“ |
| Auftraggeber | Kontoinhaber aus den Firmendaten, sonst der Firmenname; die BIC nur, wenn die IBAN der Firmendaten das gewählte Konto ist |

Einen Beleg ohne IBAN, mit ungültiger IBAN (Prüfziffer nach ISO 13616), mit einer IBAN außerhalb des Europäischen Wirtschaftsraums (EU, Island, Liechtenstein, Norwegen), ohne Lieferant oder in Fremdwährung kann Haben nicht überweisen; außerhalb des EWR verlangt SEPA BIC und Anschrift des Empfängers oder gilt gar nicht, solche Zahlungen gibst du direkt im Online-Banking ein; der Grund steht in der Zeile, der Haken ist gesperrt. Die IBAN trägst du im [Kontakt](rechnungen.md#kontakte) des Lieferanten ein und wählst ihn am Beleg. Nennt die E-Rechnung eine andere IBAN als der Kontakt, überweist Haben auf die des Kontakts und zeigt einen Hinweis: Eine geänderte Bankverbindung in einer Rechnung ist ein bekanntes Muster für Betrug.

### Skonto

Skonto bietet Haben nur an, wenn die E-Rechnung es in den Zahlungsbedingungen (BT-20) so angibt, wie XRechnung es vorschreibt (Regel BR-DE-18): `#SKONTO#TAGE=7#PROZENT=2.00#`, wahlweise mit `#BASISBETRAG=…#`. Bei mehreren Stufen gilt die höchste, deren Frist am Ausführungsdatum noch läuft; die Frist zählt ab dem Rechnungsdatum. Dann steht unter dem Lieferanten ein Haken **2,00 % Skonto bis … abziehen**. Ohne Skontoangabe, bei schon teilweise bezahlten Belegen und dort, wo der Bankabgleich kein erhaltenes Skonto buchen kann (§ 13b, Privatanteil, Anlagegut), gibt es den Haken nicht. Nach der Abbuchung buchst du den Rest im Bankabgleich mit **Rest … als erhaltenes Skonto** aus ([Rest ausbuchen](bank.md#rest-ausbuchen-skonto-und-forderungsausfall)).

### Vermerk am Beleg

Für jede Überweisung steht am Beleg „Überweisung erzeugt am …“ mit Betrag, Ausführungsdatum und Referenz, in der Liste der Überweisungen zusätzlich die letzte. Die Datei lässt sich nicht ändern oder löschen; sie ist mit Auftraggeberkonto, Ausführungsdatum und jeder Überweisung in `sepa_transfers` und `sepa_transfer_items` festgehalten, mit Eintrag im [Änderungsprotokoll](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel). Ob die Bank die Datei angenommen hat, weiß Haben nicht; eine zweite Datei für denselben Beleg ist möglich, Haben warnt davor nur mit dem Vermerk.

### Die Datei

Das Format ist pain.001.001.09 nach Anlage 3 des DFÜ-Abkommens der Deutschen Kreditwirtschaft, Version 3.9 (gültig seit 5. Oktober 2025, Schema `pain.001.001.09_GBIC_5.xsd`):

- Ein Zahlungsauftrag mit einer Überweisung je Beleg. `BtchBookg` ist `false`: Die Bank bucht jede Überweisung einzeln ab, statt einer Summe für die ganze Datei, damit der Abgleich jede Abbuchung ihrem Beleg zuordnen kann.
- `NbOfTxs` und `CtrlSum` stehen im Kopf und im Auftrag und sind aus den Überweisungen gezählt.
- Jede Überweisung trägt eine eigene `EndToEndId` (`HABEN-` und 16 Hex-Ziffern), die Datei eine eigene `MsgId`.
- Text nur im Latin-Zeichensatz des EPC (Buchstaben ohne Umlaute, Ziffern und `/ - ? : ( ) . , ' +`): Umlaute schreibt Haben aus (ä → ae, ß → ss), Akzente fallen weg, `&` wird `+`, `@` wird `(at)`; andere Zeichen werden zu Leerzeichen. Namen sind auf 70 Zeichen gekürzt, der Verwendungszweck auf 140.
- Ohne BIC des Auftraggebers steht dort `NOTPROVIDED`, wie das Schema der DK es verlangt; für den Empfänger reicht im SEPA-Raum die IBAN.

## Buchen

Vor dem Buchen müssen Lieferant, Belegdatum und Kategorie (oder eine stimmige [Aufteilung](#auf-mehrere-kategorien-aufteilen)) gesetzt sein und mindestens ein Betrag eingetragen sein; bei einer Fremdwährung auch der Umrechnungskurs. Fehlt etwas, steht oberhalb der Knöpfe „Vor dem Buchen: …“.

Beim Buchen legt Haben einen Buchungssatz mit dem Belegdatum an, schreibt ihn fest und sperrt den Beleg. Ab dann lehnen Datenbank-Trigger jede Änderung am Beleg, an seinen Beträgen und an seiner Aufteilung ab.

Beispiel: Softwarelizenz über 100,00 € netto zu 19 %, über das Geschäftskonto bezahlt:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | ---: | ---: |
| 4964 Software und Lizenzen | 6837 Software und Lizenzen | 100,00 | |
| 1576 Vorsteuer 19 % | 1406 Vorsteuer 19 % | 19,00 | |
| 1600 Verbindlichkeiten | 3300 Verbindlichkeiten | | 119,00 |

Bei privater Zahlung steht statt Verbindlichkeiten das Konto Privateinlagen (SKR03 1890, SKR04 2180) im Haben. Vorsteuer zu 7 % geht auf 1571 bzw. 1401. Bei Gutschriften tauschen Soll und Haben die Seiten.

Die Zahlung selbst buchst du im Bankabgleich: Verbindlichkeiten an Bank (siehe [bank.md](bank.md)).

### Als Kleinunternehmer

Bist du in den Einstellungen als Kleinunternehmer nach § 19 UStG eingetragen, ziehst du keine Vorsteuer ab. Haben bucht dann den Bruttobetrag auf das Aufwandskonto, ohne Vorsteuerzeile und mit dem Steuerschlüssel `keineVSt`. Im Beispiel oben stünden 119,00 € auf 4964 bzw. 6837. Ob ein Beleg mit oder ohne Vorsteuerabzug gebucht wurde, hält Haben beim Buchen am Beleg fest. Spätere Auswertungen bleiben so richtig, auch wenn sich die Einstellung ändert.

## Belege nacheinander prüfen

Nach einem Import liegen oft viele Belege auf „Zu prüfen“. Damit du sie ohne Umweg über die Liste abarbeitest, steht oben in der Detailansicht **‹ Vorheriger**, die Position („3 von 17“) und **Nächster ›**. Die Reihenfolge ist die der Liste: offene zuerst, dann nach Belegdatum.

- **Nach dem Buchen** springt die Ansicht zum nächsten Beleg „Zu prüfen“; am Ende der Liste geht es vorn weiter. Ist keiner mehr offen, bleibt der gebuchte Beleg stehen, darüber steht „Alle Belege geprüft“ mit einem Link zur Liste.
- **Hierbleiben:** Entfernst du den Haken **Nach dem Buchen zum nächsten offenen Beleg** unter den Knöpfen, bleibt die Ansicht nach dem Buchen beim gebuchten Beleg, etwa um ihn danach im Bankabgleich zuzuordnen. Haben merkt sich die Wahl in diesem Browser.
- **Nach dem Löschen** geht es zum nächsten offenen Beleg, sonst zurück zur Liste.
- **Ungespeicherte Änderungen:** Beim Wechsel fragt Haben einmal nach; der zweite Klick wechselt ohne zu speichern.

| Taste | Wirkung |
| --- | --- |
| `J` oder `→` | Nächster Beleg (nicht in Eingabefeldern) |
| `K` oder `←` | Vorheriger Beleg |
| `Strg+Enter` (Mac: `Cmd+Enter`) | Wie ein Klick auf **Bestätigen und buchen**, auch aus einem Eingabefeld. Gebucht wird wie mit der Maus erst beim zweiten Mal. |
| `Esc` | Bricht die Rückfrage zum Buchen oder Löschen ab, sonst zurück zur Liste (nicht in Eingabefeldern) |

Auf dem Handy wischst du nach links zum nächsten und nach rechts zum vorigen Beleg.

Im [Bankabgleich](bank.md#zuordnen) geht es genauso: Nach dem vollständigen Zuordnen springt die Auswahl zum nächsten offenen Umsatz.

## Fremdwährung

Rechnungen in US-Dollar, Pfund oder einer anderen Währung (Software-Abos, Hosting, Werbung) buchst du so:

1. Unter **Beträge je Steuersatz** bei **Währung** den Code eintragen, z. B. `USD`. Bei E-Rechnungen und der KI-Auslesung steht er schon da.
2. Die Beträge so eintragen, wie sie auf dem Beleg stehen, also in der Fremdwährung.
3. **Kurs: 1 EUR = …** leer lassen. Für die Umsatzsteuer gilt der Umsatzsteuer-Umrechnungskurs, den das Bundesministerium der Finanzen (BMF) für jeden Monat veröffentlicht (§ 16 Abs. 6 UStG). Haben nimmt den Kurs für den Monat des Belegdatums aus den [abgerufenen Kursen](einrichtung.md#fremdwährung) und zeigt ihn mit Herkunft an, z. B. „1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)“.

Einen eigenen Kurs trägst du ein, wenn das Finanzamt dir den Tageskurs gestattet hat (Einstellung **Tageskurs** in den Firmendaten, dann mit **Kursdatum**) oder wenn du einen Kurs aus der Bankabrechnung nehmen willst. Ein eigener Kurs bleibt; ein übernommener USt-Kurs wechselt mit, wenn du das Belegdatum in einen anderen Monat änderst. Jede Änderung steht im Audit-Log des Belegs.

Haben rechnet jede Zeile durch den Kurs in Euro um und rundet kaufmännisch auf den Cent. Unter dem Gesamtbetrag stehen der Betrag in Euro und die Euro-Beträge je Steuersatz. Gebucht, in die Voranmeldung übernommen und im Bankabgleich zugeordnet wird nur der Euro-Betrag. Währung, Kurs und Originalbeträge bleiben am Beleg gespeichert und stehen im Jahresexport in `belege.csv`.

Bei § 13b steht keine Steuer auf der Rechnung. Haben rechnet dann das Netto in Euro um und berechnet die Steuer aus diesem Euro-Betrag.

Beispiel: 100,00 USD netto zu 19 % bei 1 EUR = 1,0812 USD ergibt 92,49 € netto und 17,57 € Vorsteuer (19,00 USD / 1,0812).

Das BMF veröffentlicht die Kurse eines Monats am ersten Arbeitstag des Folgemonats. Bis dahin lässt sich der Beleg speichern, aber nicht buchen („Kurs für 10/2026 noch nicht veröffentlicht“). Sobald Haben die Kurse abgerufen hat, rechnet es wartende Belege von selbst um; du kannst auch einen Kurs von Hand eintragen. Einen gebuchten Beleg ändert ein später abgerufener oder geänderter Kurs nicht.

Belastet die Bank einen anderen Euro-Betrag als den umgerechneten, gleichst du die Differenz im Bankabgleich als [Kursdifferenz](bank.md#kursdifferenz-bei-fremdwährung) aus.

## Vorsteuer in der Voranmeldung

Die Vorsteuer eines gebuchten Belegs zählt in der Umsatzsteuer-Voranmeldung für den Monat seines **Belegdatums**, unabhängig davon, wann er bezahlt wird, und auch bei Ist-Versteuerung. Ungebuchte Belege zählen nicht; die Voranmeldung weist vor dem Senden darauf hin. Belege, die ohne Vorsteuerabzug gebucht wurden, zählen nicht. Ein Storno zählt mit umgekehrtem Vorzeichen im Monat des Stornos. Siehe [umsatzsteuer.md](umsatzsteuer.md).

## Stornieren und neu erfassen

Ein gebuchter Beleg lässt sich nicht mehr ändern oder löschen (GoBD). Hast du dich vertippt, etwa den Bruttobetrag ins Feld **Netto** geschrieben, hebst du ihn mit **Beleg stornieren** auf und erfasst ihn richtig neu, wie bei einer Stornorechnung.

1. Den gebuchten Beleg öffnen und **Beleg stornieren** klicken. Darüber erscheint ein Hinweis und das Feld **Grund** (optional, z. B. „Brutto als Netto erfasst“).
2. **Jetzt stornieren** klicken. Der Beleg zeigt danach „Storniert am …“ mit einem Link auf die Gegenbuchung im Journal, in der Liste steht er als **Storniert**.
3. **Neu erfassen** legt einen neuen Entwurf mit derselben Datei und den Feldern des stornierten Belegs an, mit Beträgen und Aufteilung. Du korrigierst ihn und buchst ihn wie jeden anderen. Gibt es den Entwurf schon, führt **Zur Neuerfassung** dorthin.

Was dabei passiert:

- **Gegenbuchung am Tag des Stornos.** Haben bucht die Belegbuchung mit vertauschten Seiten zurück („Storno: Beleg …“), mit heutigem Datum, frühestens am Belegdatum. Eine schon abgegebene Voranmeldung bleibt so unberührt: Die Vorsteuer des Belegs steht weiter im Monat des Belegdatums, der Storno mindert sie im Monat des Stornos (§ 17 Abs. 1 UStG). Ebenso Kz 46/47 bzw. 84/85 und 67 bei § 13b. Bei Ist- und Soll-Versteuerung gleich.
- **Der Beleg bleibt, wie er ist.** Er bleibt gebucht, gesperrt und versiegelt. Den Storno hält eine eigene Zeile fest (Beleg, Gegenbuchung, Datum, Grund), die nur angehängt wird, im Änderungsprotokoll steht und ein eigenes Siegel trägt.
- **EÜR:** Ein privat oder bar bezahlter Beleg zählt am Belegdatum als Ausgabe und am Tag des Stornos mit umgekehrtem Vorzeichen. Liegt der Storno im Folgejahr, mindert er die Ausgaben dort.
- **Bar aus der Kasse:** Im [Kassenbuch](kasse.md) entsteht eine Gegenzeile mit neuer Nummer und dem Betrag zurück in die Kasse; die ursprüngliche Zeile ist als storniert markiert.
- **Über das Geschäftskonto:** Der Beleg verschwindet aus den offenen Posten und lässt sich keiner Zahlung mehr zuordnen.
- **Dieselbe Datei:** Beim Hochladen nimmt Haben dieselbe Datei sonst nicht ein zweites Mal an. Die Neuerfassung nutzt sie trotzdem; lädst du die Datei danach noch einmal hoch, landest du bei der Neuerfassung. Je storniertem Beleg gibt es eine Neuerfassung; löschst du den Entwurf, lässt er sich wieder neu erfassen.

Nicht stornieren lassen sich:

| Fall | Was stattdessen |
| --- | --- |
| Der Beleg ist schon einer Zahlung zugeordnet (auch Skonto oder Kursdifferenz) | Erst im [Bankabgleich](bank.md) die Zuordnung aufheben, dann stornieren. |
| Anlagegut | Die Anlage bliebe im Verzeichnis und würde weiter abgeschrieben. Erfasse den Abgang im [Anlagenverzeichnis](anlagen.md). |
| Aus Lexoffice übernommen | Die Vorsteuer ist dort angemeldet; korrigiere den Beleg in Lexoffice. |
| Das Jahr des Stornos ist abgeschlossen (GmbH, UG) | In ein abgeschlossenes Jahr bucht Haben nichts mehr. |
| Der Kontenrahmen wurde seit dem Buchen gewechselt | Die Kontonummern bedeuten im neuen Rahmen etwas anderes. |

## Löschen

**Löschen** gibt es nur für Belege, die noch nicht gebucht sind. Haben fragt einmal nach: Der Knopf heißt dann **Endgültig löschen**, darüber steht ein Warnhinweis. Erst der zweite Klick löscht den Beleg, die Datei wird aus der Ablage entfernt. Nutzt das Archiv oder der Lexoffice-Umzug dieselbe Datei (gleicher Inhalt, gleicher SHA-256), bleibt sie liegen. Einen gebuchten Beleg kannst du nicht löschen und nicht ändern, nur [stornieren](#stornieren-und-neu-erfassen).

## Liste und Status

Die Liste zeigt Datum, Lieferant mit Rechnungsnummer und Quelle (ZUGFeRD, XRechnung, KI oder Hand), Kategorie (bei einer Aufteilung „Aufgeteilt auf 3 Zeilen“), Bruttobetrag und Status. Ungebuchte Belege stehen oben; die Zahl „… zu prüfen“ in der Kopfzeile zählt sie.

| Status | Bedeutung |
| --- | --- |
| Wird ausgelesen | Die KI liest den Beleg gerade. Das Formular ist solange gesperrt. Wurde der Server während der Auslesung neu gestartet, zeigt der Beleg beim nächsten Öffnen einen Fehler, und du liest ihn erneut aus oder füllst ihn von Hand aus. |
| Zu prüfen | Bereit zur Prüfung, noch nicht gebucht. |
| Prüfen | Die Auslesung ist fehlgeschlagen; der Grund steht am Beleg. |
| Gebucht | Festgeschrieben. |
| Storniert | Gebucht und per Gegenbuchung aufgehoben, siehe [Stornieren und neu erfassen](#stornieren-und-neu-erfassen). |

Mit **Original herunterladen** bekommst du die Datei so zurück, wie du sie hochgeladen hast. Für XML und HEIC zeigt Haben keine Vorschau, sondern einen Link zum Öffnen der Datei.

## Grenzen

- Fremdwährung: Für den Monat gilt das Belegdatum; ein abweichendes Leistungsdatum hat der Beleg nicht.
- Nur die Steuersätze 19 %, 7 % und 0 %, je Satz eine Zeile.
- Aufteilung auf mehrere Kategorien nur auf die festen Kategorien, nicht auf frei gewählte Sachkonten, und nur mit deutscher Umsatzsteuer in Euro: nicht mit § 13b, Privatanteil, Fremdwährung oder Anlagegut. Die Steuerbehandlung gilt für den ganzen Beleg, nicht je Zeile.
- § 13b nur für sonstige Leistungen ausländischer Unternehmer (Kz 46/47 und 84/85), nicht für Bauleistungen, Gebäudereinigung, Gold oder Mobilfunkgeräte, und nicht bei Anlagegütern. Keine innergemeinschaftlichen Erwerbe von Waren; einen Beleg der Kategorie „Wareneinkauf (Handelsware)“ mit § 13b bucht Haben nicht.
- Keine Abschreibung über mehrere Jahre; die Kategorie Hardware ist für geringwertige Wirtschaftsgüter gedacht.
- HEIC-Fotos werden abgelegt, aber weder in der Vorschau angezeigt noch von der KI gelesen.
