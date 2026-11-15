---
title: "Umzug aus FastBill ohne Datenverlust"
description: >-
  Von FastBill zu Haben wechseln: Rechnungen, Gutschriften, Ausgaben und Kunden über die API übernehmen,
  unveränderlich archivieren und kündigen.
---

# Umzug aus FastBill

Haben übernimmt deinen Bestand aus FastBill, damit du das Abo kündigen kannst, ohne Daten zu verlieren. Der Umzug läuft auf der Seite **Archiv** unter „Umzug“: Wähle oben „Umzug aus FastBill“. Die Schritte sind dieselben wie beim [Umzug aus Lexoffice](lexoffice.md).

Für eine GmbH oder UG gilt dasselbe wie beim [Umzug aus Lexoffice](lexoffice.md#umzug-einer-gmbh-oder-ug): Die Bestände über die offenen Posten hinaus übernimmst du mit einer Eröffnungsbuchung.

Abgerufene Belege landen im selben unveränderlichen Archiv wie die aus Lexoffice und sevDesk. Abgleich je Jahr, offene Posten, die Ansicht **Belege**, die [Kontaktseite](kontakte.md#rechnungen-und-belege-am-kontakt) und der Jahresexport behandeln alle Quellen gleich.

> [!WARNING]
> Der Abruf ist gegen die [API-Dokumentation von FastBill](https://apidocs.fastbill.com/) gebaut, mit nachgestellten Antworten getestet und einmal vollständig gegen ein echtes Konto gelaufen (November 2026). Prüfe nach dem Abruf den Abgleich je Jahr und kündige erst, wenn er für jedes Jahr aufgeht.

## Voraussetzungen

- Die **Login-E-Mail** deines FastBill-Kontos und den **API-Schlüssel** aus den Einstellungen deines Kontos in FastBill. Die API meldet sich mit beiden an (Basic Auth).
- Deinen **Tarif**: FastBill erlaubt je Konto und Stunde nur eine bestimmte Zahl von Anfragen, Solo 50, Solo-Plus 100, Pro 500 und Premium 1000 ([Grundlagen der API](https://apidocs.fastbill.com/fastbill/en/fundamentals.html)).
- Firmendaten, Kontenrahmen und Versteuerungsart (Ist oder Soll) sind in Haben eingerichtet, wie in FastBill ([Einrichtung](einrichtung.md)).
- Der Server braucht Zugriff auf `https://my.fastbill.com`.

> [!IMPORTANT]
> Mit E-Mail und API-Schlüssel lassen sich die Daten deines FastBill-Kontos lesen und ändern. Entferne den Zugang nach dem Umzug in Haben (siehe [Vor der Kündigung](#vor-der-kündigung)); das löscht ihn nur in Haben, nicht in FastBill.

## Schritt 1: Verbindung zu FastBill

Trag Login-E-Mail, Tarif und API-Schlüssel ein und klicke „Prüfen und speichern“. Haben ruft damit einen Kunden ab; klappt das, stimmen die Angaben. Der Schlüssel wird wie bei Lexoffice mit AES-256-GCM verschlüsselt gespeichert und taucht weder im Änderungsprotokoll noch im Jahresexport auf. Stimmt der Tarif nicht, wartet der Abruf zu kurz oder unnötig lange.

## Schritt 2: Kontakte, Rechnungen und Belege abrufen

„Alles abrufen“ startet den Abruf im Hintergrund, mit Fortschritt, Abbrechen und Fortsetzen wie bei Lexoffice. Es läuft immer nur ein Abruf, gleich aus welcher Quelle.

1. **Kunden:** Name (Firma oder Person), Adresse, Land, E-Mail, USt-IdNr. und Kundennummer, als Kontakte mit der Rolle Kunde. Gibt es in Haben schon einen Kontakt mit demselben Namen und ohne FastBill-Herkunft, verknüpft Haben ihn. FastBill führt Lieferanten nicht als Kontakte; sie stehen in den Ausgaben nur als Name.
2. **Belegliste:** Ausgangsrechnungen, Gutschriften und stornierte Rechnungen, je Art ein eigener Abruf, dazu die Ausgaben. Entwürfe bleiben draußen.
3. **Dateien:** je Rechnung und Gutschrift das PDF, je Ausgabe der hochgeladene Beleg. Gibt FastBill den Beleg einer Ausgabe nur im angemeldeten Browser heraus, wartet die Ausgabe, siehe [Belege, die FastBill nur im Browser herausgibt](#belege-die-fastbill-nur-im-browser-herausgibt).

Die Antwort der API wird je Beleg gespeichert, zum Nachweis; ohne die Download-Adresse (`DOCUMENT_URL`), denn wer sie kennt, lädt den Beleg ohne Anmeldung.

### Dauer und Stundengrenze

Jede Seite mit bis zu 100 Einträgen ist eine Anfrage, die PDFs zählen nicht dazu. Ist die Grenze deines Tarifs erreicht, wartet der Abruf, bis wieder Anfragen frei sind, und zeigt bis wann. Ein neuer Abruf nach einem Abbruch rechnet die Anfragen der letzten Stunde an und überspringt alles, was schon im Archiv liegt.

### Belege, die FastBill nur im Browser herausgibt

Bei einem Teil der Ausgaben liefert die Download-Adresse aus der API (`DOCUMENT_URL`) die Datei nur, wenn man im Browser bei FastBill angemeldet ist; der API liefert sie nur eine leere Seite. Rechnungen und Gutschriften betrifft das nicht. Damit solche Ausgaben nicht ohne Beleg im unveränderlichen Archiv landen, archiviert Haben sie erst, wenn der Beleg da ist, und zeigt unter Schritt 2 den Kasten „Belege, die FastBill nur im Browser herausgibt“:

1. In my.fastbill.com anmelden und die Entwicklerwerkzeuge öffnen (F12), dort die Konsole.
2. In Haben „Skript kopieren“, in der Konsole einfügen und mit Enter starten. Haben setzt beim Kopieren die Liste der wartenden Ausgaben ein; das Skript lädt mit deiner Anmeldung genau diese Belege und gibt sie als ZIP-Dateien zurück, jede Datei benannt nach der ID der Ausgabe in FastBill. Es liest nur.
3. Die ZIP-Dateien in Haben hochladen. Haben ordnet jede Datei über die ID ihrer Ausgabe zu und nimmt nur PDFs und Bilder an. Manche Belege speichert FastBill samt der Hülle des Formulars, mit dem sie hochgeladen wurden; dann übernimmt Haben die Datei darin unverändert, ohne die Hülle.
4. In Schritt 2 „Erneut abrufen“: Haben übernimmt die Ausgaben jetzt mit ihrem Beleg.

Gibt es zu einer Ausgabe in FastBill wirklich keinen Beleg, übernimmt „Rest ohne Beleg übernehmen“ die übrigen wartenden Ausgaben beim nächsten Abruf ohne Datei. Im Abgleich bleibt „Jeder Beleg hat eine Datei“ für dieses Jahr dann offen; an einen archivierten Beleg lässt sich später keine Datei mehr hängen.

Einen Download der Ausgabenbelege aus der Oberfläche von FastBill legst du bei Bedarf in Schritt 4 als „Sonstiges“ ab; Haben ordnet daraus nichts zu.

### Wie FastBill-Belege abgebildet werden

| In FastBill | In Haben |
| --- | --- |
| Rechnung (`TYPE` outgoing) | Rechnung; Abschlagsrechnung (`SUBTYPE` progress_invoice) als Abschlagsrechnung |
| Gutschrift (`TYPE` credit) | Gutschrift, immer negativ |
| Stornierte Rechnung (`STATE` canceled) und ihre Stornogutschrift | beide storniert und ausgeglichen; sie heben sich im Umsatz auf |
| Ausgabe | Eingangsrechnung; mit negativem Betrag Gutschrift des Lieferanten |

Eine Gutschrift gilt nur als Storno, wenn sie auf eine stornierte Rechnung verweist (`REFERENCED_INVOICE_ID`) und deren Betrag voll aufhebt. Eine Teilgutschrift bleibt eine Gutschrift mit eigenem Zahlungsstand.

Die Aufteilung nach Steuersatz kommt aus der Steueraufstellung des Belegs (`VAT_ITEMS`), sonst aus den Positionen.

### Steuerarten im Abgleich

Die Steuerart einer Rechnung liest Haben aus `VAT_CASE`. FastBill liefert dort entweder 0 oder 1 (innergemeinschaftlich nein oder ja) oder einen Fall aus der [Rechnungs-API](https://apidocs.fastbill.com/fastbill/en/invoice.html):

| `VAT_CASE` | Im Abgleich |
| --- | --- |
| 0, `standard` | Kz 81, Kz 86 |
| 1 bei Rechnungen, `b2b_eu_goods` | innergemeinschaftliche Lieferung (Kz 41) |
| `b2b_eu_services` | sonstige Leistung im übrigen Gemeinschaftsgebiet (Kz 21) |
| `b2b_noneu_goods`, `b2c_noneu_goods` | Ausfuhrlieferung (Kz 43) |
| `b2b_noneu_services` | sonstige Leistung im Drittland (Kz 45) |
| `small_business_regulation` | Steuerfrei (Kleinunternehmer) |
| `b2c_eu_goods` | Andere Sätze: ob der Fernverkauf über OSS lief, steht nicht in der Antwort |

Ausgaben zählen als regulär (Vorsteuer Kz 66); eine 1 an einer Ausgabe (innergemeinschaftlicher Erwerb) steht unter „Andere Sätze“.

### Zahlungen

Die Einzelzahlungen einer Rechnung (`PAYMENTS`) übernimmt Haben mit Datum, Betrag und Zahlungsweg. Ist eine Rechnung nur zum Teil bezahlt, steht sie als teilweise bezahlt mit dem Rest offen. Eine bezahlte und danach stornierte Rechnung zeigt ihre Zahlung weiter an, ist aber ausgeglichen.

### Grenzen des aktuellen Imports

Angebote, wiederkehrende Rechnungen, Projekte, Zeiten und die Dokumentenablage von FastBill übernimmt Haben nicht. Artikel kommen per [CSV-Import](csv-import.md#artikel).

## Schritt 3 bis 5

Offene Posten, Exporte ablegen und Abgleich je Jahr funktionieren wie beim [Umzug aus Lexoffice](lexoffice.md#schritt-3-offene-posten-übernehmen). Unterschiede:

- Die API liefert keine Buchungen und keine Bankumsätze. Lege je Geschäftsjahr den DATEV-Export aus FastBill ab, dazu die ELSTER-Protokolle und die Kontoauszüge.
- Einen Export für die Betriebsprüfung (GoBD, Datenträgerüberlassung) legst du als „IDEA-Export“ ab; danach richtet sich die Prüfung „IDEA-Export archiviert“. Ohne ihn bleibt diese Prüfung offen.
- Eine offene Rechnung ohne Nummer bekommt in Haben die Nummer `FB-` plus die ID aus FastBill.
- Im Jahresexport stehen die Belege aus FastBill ebenfalls unter `lexoffice/`; die Spalte „Quelle“ in `belege.csv` sagt, woher ein Beleg stammt.

## Andere API-Adresse

Haben spricht standardmäßig mit `https://my.fastbill.com/api/1.0/api.php`. Mit der Umgebungsvariable `FASTBILL_API_URL` setzt du eine andere Adresse, etwa zum Testen gegen einen nachgestellten Server.

## Vor der Kündigung

- [ ] Abruf ist fertig, die Liste der fehlgeschlagenen Belege ist leer
- [ ] Keine Ausgabe wartet mehr auf ihren Beleg aus dem Browser-Skript
- [ ] Jeder Beleg hat eine Datei (Abgleich je Jahr); Ausgaben ohne Beleg in FastBill geklärt
- [ ] Für jedes Geschäftsjahr: DATEV-Export, ELSTER-Protokolle und Kontoauszüge abgelegt, jeweils mit Jahr; ein GoBD-Export, falls es ihn gibt
- [ ] Einnahmen, Ausgaben, Umsatz- und Vorsteuer je Jahr mit FastBill verglichen
- [ ] Umsatzsteuer je Monat mit den übermittelten Voranmeldungen verglichen
- [ ] Offene Posten übernommen oder die Gründe geklärt
- [ ] Nächste Rechnungsnummer in Haben gesetzt
- [ ] Jahresexport für jedes übernommene Jahr heruntergeladen
- [ ] Zugang zu FastBill in Haben entfernt (das löscht ihn nur in Haben, nicht in FastBill)
