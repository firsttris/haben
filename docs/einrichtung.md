# Erste Schritte

Diese Seite führt dich durch die Einrichtung nach der Installation: Konto und Passkey, Firmendaten, Versteuerung und Kontenrahmen, Rechnungsnummern, ELSTER, KI-Auslesung und Bankkonten. Wie du Haben auf dem Server installierst, steht in [Betrieb und Installation](installation.md).

## Checkliste

In dieser Reihenfolge kommst du am schnellsten zu einer vollständigen Buchhaltung:

1. Konto anlegen und einen Passkey hinzufügen
2. Firmendaten ausfüllen, Versteuerung und Kontenrahmen wählen, gegebenenfalls Kleinunternehmer einschalten
3. Wenn du aus Lexoffice kommst: Umzug durchführen, siehe [Umzug aus Lexoffice](lexoffice.md). Der Abgleich zeigt dir die letzte Rechnungsnummer
4. Nächste Rechnungsnummer setzen
5. ELSTER-Zertifikat hochladen, eine Voranmeldung mit „Nur prüfen“ und dann als Testübermittlung schicken
6. Hersteller-ID beantragen und eintragen
7. Für die Anlage EÜR Einkunftsart und Art des Betriebs eintragen, siehe [Jahreserklärungen](jahreserklaerung.md)
8. Bank verbinden (automatischer Abruf) oder ersten Kontoauszug importieren, siehe [Bank](bank.md)
9. Optional: KI-Auslesung für Belege einschalten

> [!IMPORTANT]
> Versteuerung, Kontenrahmen und Kleinunternehmerstatus legst du fest, bevor du die erste Rechnung festschreibst oder den ersten Beleg buchst. Sobald es im laufenden Jahr Buchungen gibt, sperrt Haben die Umstellung bis zum nächsten Jahreswechsel (siehe [Sperren](#wann-sich-die-einstellungen-ändern-lassen)).

## Konto anlegen

Beim ersten Aufruf leitet Haben auf `/setup` weiter. Haben kennt genau ein Konto: Du gibst Name, E-Mail und ein Passwort mit mindestens 12 Zeichen ein und klickst „Konto anlegen“. Sobald es ein Konto gibt, lehnt Haben jede weitere Registrierung ab („Haben ist bereits eingerichtet.“), und `/setup` leitet auf die Anmeldung um.

Direkt danach bietet Haben an, einen Passkey hinzuzufügen. Damit meldest du dich künftig ohne Passwort an, etwa mit Fingerabdruck, Gesichtserkennung oder einem Sicherheitsschlüssel. Das Passwort bleibt als Rückfallebene. Du kannst den Schritt mit „Später“ überspringen.

Auf der Anmeldeseite wählst du „Mit Passkey anmelden“. Unterstützt der Browser Passkey-Autofill, schlägt er den Passkey auch direkt im Feld vor. Über „Passwort verwenden“ meldest du dich mit E-Mail und Passwort an.

Passkeys verwaltest du unter **Einstellungen → Passkeys**: weitere hinzufügen (z. B. für Handy und Laptop) oder alte entfernen. Passkeys hängen an der Domain aus `BETTER_AUTH_URL`; bei einem Domainwechsel musst du sie neu anlegen.

## Firmendaten

Unter **Einstellungen → Firmendaten** hinterlegst du die Angaben, die auf Rechnungen und in der Voranmeldung stehen. Fehlt etwas für ELSTER, zeigt das Formular oben „Für ELSTER fehlt noch: …“.

| Feld | Wofür |
| --- | --- |
| Name | Absender auf Rechnungen, Datenlieferant in der Voranmeldung. Pflicht für beides |
| E-Mail | Absender auf Rechnungen. Pflicht zum Festschreiben einer Rechnung |
| Straße und Hausnummer, PLZ, Ort | Anschrift auf Rechnungen und in der Voranmeldung. Pflicht für beides; die PLZ hat fünf Ziffern |
| Bundesland | Nötig, um die Steuernummer ins ELSTER-Format umzurechnen. Pflicht für ELSTER. Bestimmt außerdem die Feiertage für die Fälligkeit von Rechnungen und Voranmeldungen |
| Steuernummer | So eingeben, wie sie auf dem Bescheid steht (z. B. `21/815/08150`). Haben rechnet sie ins 13-stellige ELSTER-Format um; eine schon 13-stellige Nummer bleibt unverändert. Pflicht für ELSTER; für Rechnungen reicht Steuernummer oder USt-IdNr. |
| USt-IdNr. | Auf Rechnungen und im E-Rechnungs-XML. Form `DE123456789` |
| Finanzamt | Nur zur Information. Das Empfänger-Finanzamt der Voranmeldung leitet Haben aus der Steuernummer ab |
| Telefon | Auf der Rechnung; für XRechnung Pflicht |
| Bank, IBAN, BIC | Zahlungsangaben auf der Rechnung. Die IBAN ist Pflicht zum Festschreiben; Eingabe ohne Leerzeichen, Haben entfernt sie aber auch selbst |
| Kontenrahmen | SKR03 oder SKR04, siehe unten |
| Standard-Zahlungsziel in Tagen | Vorgabe für neue Rechnungen (0 bis 120 Tage) |
| Standardformat für Rechnungen | ZUGFeRD (PDF mit eingebettetem XML), XRechnung (CII) oder XRechnung (UBL). Vorgabe für neue Rechnungen |
| Versteuerung | Ist oder Soll, siehe unten |
| Kleinunternehmer nach § 19 UStG | Haken setzen, wenn du die Kleinunternehmerregelung nutzt, siehe unten |

Die Umrechnung der Steuernummer prüft die Länge je Bundesland. Passt sie nicht, meldet Haben zum Beispiel „Steuernummer für Bayern muss 11 Ziffern haben“. Für Hessen setzt Haben die führende `0` der Finanzamtsnummer wie von ELSTER verlangt auf `6`.

Mehr zu den Pflichtangaben auf Rechnungen steht in [Rechnungen](rechnungen.md).

## Persönliche Angaben

Unter **Einstellungen → Persönliche Angaben** stehen die Angaben zu dir als Person, die ELSTER für manche Vorgänge braucht: Anrede, steuerliche Identifikationsnummer (Steuer-ID), Vor- und Nachname, Geburtsdatum, Religion und ausgeübter Beruf. Bei der Zusammenveranlagung kommen das Heiratsdatum und dieselben Angaben zum Ehegatten dazu.

Gebraucht werden sie für [Bankverbindung ändern](finanzamt.md#bankverbindung-ändern) und die Einkommensteuererklärung. Haben prüft die Prüfziffer der Steuer-ID. Die Religion bestimmt, ob Kirchensteuer anfällt; Haben nutzt die Religionsschlüssel von ELSTER. Änderungen landen wie die Firmendaten im Audit-Log.

## Versteuerung: Ist oder Soll

Die Einstellung bestimmt, wann die Umsatzsteuer aus deinen Rechnungen in der Voranmeldung landet.

| | Ist (nach vereinnahmten Entgelten) | Soll (nach vereinbarten Entgelten) |
| --- | --- | --- |
| Buchung beim Festschreiben | Forderung an Erlöse und „Umsatzsteuer nicht fällig“ | Forderung an Erlöse und Umsatzsteuer |
| Umsatzsteuer in der Voranmeldung | im Monat des zugeordneten Zahlungseingangs, bei Teilzahlungen anteilig | im Monat des Rechnungsdatums |
| Zahlungseingang im Bankabgleich | bucht den Steueranteil von „nicht fällig“ auf „Umsatzsteuer“ um | nur Bank an Forderungen |

Die Vorsteuer aus Belegen zählt in beiden Fällen nach Belegdatum. Bei Ist-Versteuerung ist der Bankabgleich deshalb Pflicht: Ein nicht zugeordneter Zahlungseingang fehlt sonst in der Voranmeldung, und die Vorprüfung warnt davor.

Die Einstellung wirkt auf alles, was danach gebucht wird. Bereits festgeschriebene Rechnungen behalten ihre Buchung. Umstellen lässt sie sich nur, solange es im laufenden Jahr keine Buchungen und keine offenen Rechnungen gibt (siehe [unten](#wann-sich-die-einstellungen-ändern-lassen)). Ob du Ist-Versteuerung nutzen darfst, entscheidet das Finanzamt; das klärst du mit deiner Steuerberatung. Details zur Berechnung stehen in [Umsatzsteuer](umsatzsteuer.md).

## Kontenrahmen: SKR03 oder SKR04

Der Kontenrahmen legt fest, auf welche Kontonummern Haben bucht. Wähle denselben wie in Lexoffice oder bei deiner Steuerberatung. Er wirkt auf alle Buchungen (Rechnungen, Belege, Zahlungen) und auf die Kontonamen im Journal. Jede Buchung speichert den Kontenrahmen, mit dem sie erstellt wurde; ein späterer Wechsel ändert bestehende Buchungen nicht. Wechseln kannst du nur zum Jahresbeginn, bevor im neuen Jahr gebucht wird.

Einige Beispiele:

| Konto | SKR03 | SKR04 |
| --- | --- | --- |
| Forderungen | 1400 | 1200 |
| Erlöse 19 % | 8400 | 4400 |
| Umsatzsteuer nicht fällig 19 % | 1766 | 3816 |
| Vorsteuer 19 % | 1576 | 1406 |
| Verbindlichkeiten | 1600 | 3300 |
| Bank (alle Bankkonten) | 1200 | 1800 |

Die vollständige Zuordnung, auch die Aufwandskonten der Belegkategorien, steht in `packages/core/src/posting.ts` und ist in [Buchhaltung](buchhaltung.md) beschrieben.

> [!NOTE]
> Der Code selbst merkt an, dass die Kontenzuordnung vor dem Echtbetrieb mit der Steuerberatung abgeglichen werden sollte. Das gilt besonders für die Aufwandskonten der Belegkategorien.

## Kleinunternehmer

Nutzt du die Kleinunternehmerregelung nach § 19 UStG, setzt du unter **Einstellungen → Firmendaten** den Haken **Kleinunternehmer nach § 19 UStG**. Dann gilt:

| Bereich | Wirkung |
| --- | --- |
| Rechnungen | Neue Rechnungen bekommen „Kleinunternehmer nach § 19 UStG“, alle Positionen 0 %, mit dem Hinweis „Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.“ Die Auswahl im Editor ist gesperrt. Eine regulär besteuerte Rechnung lässt sich nicht festschreiben. Siehe [Rechnungen](rechnungen.md#umsatzsteuer-auf-der-rechnung). |
| Belege | Gebucht ohne Vorsteuerabzug: der Bruttobetrag geht auf das Aufwandskonto. Siehe [Belege](belege.md#als-kleinunternehmer). |
| Voranmeldung | Die Seite weist darauf hin, dass du in der Regel keine Voranmeldung abgibst. Nötig ist sie nur, wenn du selbst Steuer schuldest, etwa für Leistungen ausländischer Unternehmer an dich (Reverse Charge). |
| Übersicht | Die Aufgaben „Voranmeldung senden“, zum ELSTER-Zertifikat und zu den Firmendaten für ELSTER entfallen. |
| EÜR | Die Einnahmen stehen in der Zeile „Betriebseinnahmen als umsatzsteuerlicher Kleinunternehmer“. |

Überschreitest du die Umsatzgrenze, nimmst du den Haken heraus; ab dann gilt die Regelbesteuerung. Ausschalten geht jederzeit, auch mitten im Jahr. Eine Kleinunternehmer-Rechnung lässt sich danach nicht mehr festschreiben. Belege, die vorher ohne Vorsteuerabzug gebucht wurden, bleiben so.

## Mahnwesen

| Feld | Bedeutung |
|---|---|
| Basiszinssatz in % | Grundlage der Verzugszinsen. Er ändert sich zum 1. Januar und 1. Juli und wird von der Deutschen Bundesbank veröffentlicht; trage ihn dann neu ein. Leer heißt: keine Verzugszinsen. |
| Zahlungsfrist in Mahnungen | Tage ab dem Mahndatum, Vorgabe 10 |
| Gebühr je Stufe | Vorschlag für Zahlungserinnerung, 1. Mahnung und letzte Mahnung, z. B. 0 €, 5 €, 10 € |

Mehr unter [Rechnungen › Mahnwesen](rechnungen.md#mahnwesen).

## Privatanteile

Unter **Privatanteil Telefon in %** und **Privatanteil Internet in %** legst du fest, welcher Anteil dieser Rechnungen privat ist, z. B. 20 %. Neue Belege der Kategorien übernehmen den Wert; am einzelnen Beleg lässt er sich ändern. Mehr unter [Belege](belege.md#privatanteil).

## Wann sich die Einstellungen ändern lassen

Kontenrahmen, Versteuerung und Kleinunternehmerstatus gelten für ein ganzes Geschäftsjahr. Haben sperrt deshalb die Umstellung, sobald es im laufenden Kalenderjahr eine Buchung gibt. Das Auswahlfeld ist dann ausgegraut, und darunter steht der Grund. Auch der Server lehnt eine solche Änderung ab.

| Einstellung | Gesperrt, wenn |
| --- | --- |
| Kontenrahmen | im laufenden Jahr gebucht wurde |
| Versteuerung (Ist oder Soll) | im laufenden Jahr gebucht wurde oder Rechnungen noch offen sind; ihre Umsatzsteuer würde sonst doppelt oder gar nicht angemeldet |
| Kleinunternehmer einschalten | im laufenden Jahr gebucht wurde |
| Kleinunternehmer ausschalten | nie |

Umstellen kannst du also nur zum Jahreswechsel, bevor im neuen Jahr die erste Buchung entsteht. Kläre einen Wechsel vorher mit deiner Steuerberatung.

## Rechnungsnummern

Rechnungsnummern haben die Form `JAHR-NNN`, zum Beispiel `2026-034`. Der Zähler läuft je Jahr; das Jahr kommt aus dem Rechnungsdatum. Eine Nummer vergibt Haben erst beim Festschreiben, in derselben Transaktion wie PDF, XML und Buchung. Schlägt dabei etwas fehl, wird keine Nummer verbraucht. Entwürfe haben noch keine Nummer, deshalb entstehen keine Lücken.

Lückenlos und fortlaufend sollen die Nummern sein, damit das Finanzamt bei einer Prüfung sieht, dass keine Rechnung fehlt.

Unter **Einstellungen → Rechnungsnummern** siehst du die nächste Nummer des laufenden Jahres. Kommst du aus Lexoffice, trägst du dort die nächste laufende Nummer ein (z. B. `35`, wenn die letzte Lexoffice-Rechnung `2026-034` war). Der Wert muss größer sein als die zuletzt vergebene Nummer; zurücksetzen geht nicht. Die letzte Lexoffice-Nummer zeigt dir auch der Abgleich in [Umzug aus Lexoffice](lexoffice.md).

## ELSTER einrichten

Haben übermittelt die Umsatzsteuer-Voranmeldung über ERiC, die offizielle Bibliothek der Steuerverwaltung. Ohne ERiC laufen Prüfen und Senden simuliert, und die Oberfläche weist darauf hin.

1. **ERiC laden:** unter **Einstellungen › ERiC** den Nutzungsbedingungen zustimmen und **Herunterladen und einrichten** klicken. ERiC darf nicht weitergegeben werden und liegt deshalb weder im Repository noch im Image; Haben holt es direkt von der Finanzverwaltung (Linux x86_64).
2. **Oder von Hand:** das Paket z. B. nach `/opt/eric` entpacken (darin `lib/libericapi.so` und `lib/plugins2/`) und `ERIC_HOME` setzen. Beides steht in [ERiC einbinden](installation.md#eric-einbinden).
3. **Zertifikat beantragen und hochladen.** In Mein ELSTER eine Zertifikatsdatei (.pfx) beantragen und unter **Einstellungen → ELSTER-Zertifikat** hochladen (höchstens 64 KB). Haben speichert die Datei AES-256-GCM-verschlüsselt in der Datenbank. Trägst du „Gültig bis“ ein, warnt die Übersicht 30 Tage vor Ablauf. Ein neues Zertifikat ersetzt das alte.
4. **Formate prüfen.** Unter **Einstellungen › ERiC** lässt **Formate mit ERiC prüfen** ERiC alle Nachrichten von Belegabruf, Berechtigung und Postfach gegen seine Schemas prüfen, ohne etwas zu senden. Diese Formate stammen aus freien Projekten (erica, viking) statt aus der amtlichen Jahresdokumentation; die Prüfung zeigt sofort, ob eine Version oder ein Feldname nicht mehr passt. Bemängelt ERiC etwas, bitte die Meldungen als Issue melden.
5. **Nur prüfen.** Auf der Seite einer Voranmeldung lässt „Nur prüfen“ ERiC die Daten auf Plausibilität prüfen. Dafür braucht es weder Zertifikat noch PIN.
6. **Testübermittlung.** Mit gesetztem Haken „Nur Testübermittlung“, PIN und „Prüfen und testweise senden“. Die Testübermittlung läuft mit der Test-Hersteller-ID `74931` und dem Testmerker `700000004`; der ELSTER-Server nimmt sie an, leitet sie aber nicht an das Finanzamt weiter. Die Anmeldung bleibt ein Entwurf.
7. **Hersteller-ID beantragen.** Nach erfolgreicher Testübermittlung beantragst du bei ELSTER eine eigene Hersteller-ID und trägst sie als `ELSTER_HERSTELLER_ID` (fünf Ziffern) ein. Erst dann lässt sich der Haken „Nur Testübermittlung“ entfernen.
8. **Echtübermittlung.** Ohne Haken fragt Haben noch einmal nach („Jetzt verbindlich senden“). Nach erfolgreicher Übermittlung ist die Voranmeldung festgeschrieben; eine Korrektur ist eine neue, berichtigte Anmeldung.

Die PIN fragt Haben bei jeder Übermittlung ab und speichert sie nie. Für den Versand legt Haben das entschlüsselte Zertifikat kurz in ein temporäres Verzeichnis (Rechte `0600`) und löscht es danach. Jede Prüfung und Übermittlung landet mit Transfer-Ticket und ERiC-Protokoll-PDF im Verlauf der Voranmeldung.

Vor dem Senden prüft Haben die Firmendaten: Name, Anschrift, Bundesland und eine gültige Steuernummer müssen vorhanden sein.

> [!IMPORTANT]
> Die ERiC-Anbindung ist gegen eine nachgebaute Bibliothek getestet; Funktionssignaturen, Flags und die Strukturen `eric_druck_parameter_t` (Version 4) und `eric_verschluesselungs_parameter_t` (Version 3) entsprechen den Headern von ERiC 43. Die erste Prüfung mit echtem ERiC zeigt, ob alles passt. ERiC-Updates spielst du erst ein, wenn eine Testübermittlung damit geklappt hat.

Wie du Voranmeldungen erstellst und was die Vorprüfung meldet, steht in [Umsatzsteuer](umsatzsteuer.md).

## KI-Auslesung von Belegen

Optional. E-Rechnungen (ZUGFeRD, Factur-X, XRechnung) liest Haben immer selbst aus. Für andere PDFs und Fotos (JPEG, PNG, WebP) kann Claude die Felder vorbefüllen: Lieferant, USt-IdNr., Rechnungsnummer, Datum, Fälligkeit, Beträge je Steuersatz und eine vorgeschlagene Kategorie. Dafür muss auf dem Server `ANTHROPIC_API_KEY` gesetzt sein (siehe [Installation](installation.md#ki-auslesung-anthropic)).

Dabei geht die Belegdatei an die Anthropic-API. Ohne Schlüssel bleibt alles lokal, und du füllst die Felder von Hand aus. In beiden Fällen bucht Haben einen Beleg erst, wenn du die Felder bestätigt hast. Weicht die Summe vom Gesamtbetrag ab oder ist die Währung nicht Euro, zeigt Haben einen Hinweis. Mehr in [Belege](belege.md).

## Bankkonten

Bankkonten musst du meist nicht von Hand anlegen. Mit dem automatischen Abruf über Enable Banking legt Haben die freigegebenen Konten beim Verbinden an (Einrichtung in [Installation](installation.md#kontoabruf-enable-banking), Ablauf in [Bank](bank.md#automatischer-abruf)). Beim ersten Import eines DKB-CSV oder CAMT.053-Auszugs legt Haben das Konto über die IBAN aus der Datei an. N26-CSV-Dateien enthalten keine eigene IBAN. Dafür legst du das Konto vorher an:

1. Auf der Seite **Bank** „Konto hinzufügen“ wählen.
2. Name (z. B. „N26 Business“) und IBAN eintragen und „Konto anlegen“.
3. Beim Import das Konto in der Auswahl „Konto“ wählen und die Datei hochladen.

Jede IBAN gibt es nur einmal. Alle Bankkonten buchen auf dasselbe Finanzkonto (1200 bei SKR03, 1800 bei SKR04). Import, Abgleich und Buchungen sind in [Bank](bank.md) beschrieben.

## Wie es weitergeht

- [Rechnungen](rechnungen.md) schreiben und festschreiben
- [Belege](belege.md) hochladen und buchen
- [Bank](bank.md): Kontoauszüge importieren und Zahlungen zuordnen
- [Umsatzsteuer](umsatzsteuer.md): monatliche Voranmeldung
- [Auswertungen](auswertungen.md) und Jahresexport

[Zurück zur Übersicht](../README.md)
