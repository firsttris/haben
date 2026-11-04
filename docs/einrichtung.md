# Erste Schritte

Diese Seite führt dich durch die Einrichtung nach der Installation: Konto und Passkey, App auf Handy und Rechner, Firmendaten, Versteuerung und Kontenrahmen, Rechnungsnummern, ELSTER, KI-Auslesung und Bankkonten. Wie du Haben auf dem Server installierst, steht in [Betrieb und Installation](installation.md).

## Checkliste

In dieser Reihenfolge kommst du am schnellsten zu einer vollständigen Buchhaltung:

1. Konto anlegen und einen Passkey hinzufügen
2. Firmendaten ausfüllen, Rechtsform, Versteuerung und Kontenrahmen wählen, gegebenenfalls Kleinunternehmer einschalten
3. Wenn du aus Lexoffice kommst: Umzug durchführen, siehe [Umzug aus Lexoffice](lexoffice.md). Der Abgleich zeigt dir die letzte Rechnungsnummer
4. Nächste Rechnungsnummer setzen
5. Hersteller-ID und ELSTER-Zertifikat **gleich jetzt** beantragen: Beides dauert ein bis zwei Wochen, siehe [Was du brauchst](#was-du-brauchst)
6. Wenn beides da ist: ERiC laden, Hersteller-ID eintragen, Datenschutzhinweise bestätigen, Zertifikat hochladen, eine Voranmeldung mit „Nur prüfen“ und dann als Testübermittlung schicken
7. Für die Anlage EÜR Einkunftsart und Art des Betriebs eintragen, siehe [Jahreserklärungen](jahreserklaerung.md)
8. Bank verbinden (automatischer Abruf) oder ersten Kontoauszug importieren, siehe [Bank](bank.md)
9. Optional: KI-Auslesung für Belege einschalten

> [!IMPORTANT]
> Rechtsform, Versteuerung, Kontenrahmen und Kleinunternehmerstatus legst du fest, bevor du die erste Rechnung festschreibst oder den ersten Beleg buchst. Die Rechtsform ist ab der ersten Buchung fest, bei GmbH und UG auch der Kontenrahmen. Sobald es im laufenden Jahr Buchungen gibt, sperrt Haben die Umstellung bis zum nächsten Jahreswechsel (siehe [Sperren](#wann-sich-die-einstellungen-ändern-lassen)).

## Konto anlegen

Beim ersten Aufruf leitet Haben auf `/setup` weiter. Haben kennt genau ein Konto: Du gibst den Einrichtungscode, Name, E-Mail und ein Passwort mit mindestens 12 Zeichen ein und klickst „Konto anlegen“.

Den Einrichtungscode schreibt Haben beim Start ins Log, solange es noch kein Konto gibt, etwa `Einrichtungscode für https://haben.example.de/setup: K7QM-3XRP-W9TD`. Du findest ihn mit `docker compose logs app` bzw. `journalctl --user -u haben-app`. Er sorgt dafür, dass niemand anderes eine frisch gestartete Instanz zuerst erreicht und das Konto anlegt. Nach jedem Neustart gibt es einen neuen Code; einen festen setzt du mit `HABEN_SETUP_CODE`. Sobald es ein Konto gibt, lehnt Haben jede weitere Registrierung ab („Haben ist bereits eingerichtet.“), und `/setup` leitet auf die Anmeldung um.

Direkt danach bietet Haben an, einen Passkey hinzuzufügen. Damit meldest du dich künftig ohne Passwort an, etwa mit Fingerabdruck, Gesichtserkennung oder einem Sicherheitsschlüssel. Das Passwort bleibt als Rückfallebene. Du kannst den Schritt mit „Später“ überspringen.

Auf der Anmeldeseite wählst du „Mit Passkey anmelden“. Über „Passwort verwenden“ meldest du dich mit E-Mail und Passwort an. Unterstützt der Browser Passkey-Autofill, schlägt er den Passkey dort auch direkt im Feld E-Mail vor.

Passkeys verwaltest du unter **Einstellungen › Sicherheit › Passkeys**: weitere hinzufügen (z. B. für Handy und Laptop) oder alte entfernen. Passkeys hängen an der Domain aus `BETTER_AUTH_URL`; bei einem Domainwechsel musst du sie neu anlegen.

## Einstellungen und Darstellung

Die **Einstellungen** (unten links in der Navigation) sind in Bereiche geteilt: **Firma**, **Persönliche Angaben**, **Rechnungen** (Nummernkreis, Nummernformat, Logo, Akzentfarbe), **ELSTER** (Zertifikat, ERiC), **E-Mail** (Versand, Belege-Postfach), **Bank** (automatischer Kontoabruf), **Sicherheit** (Passkeys) und **Export** (Jahresarchiv, DATEV, Änderungsprotokoll prüfen). Links aus der App, etwa „Zertifikat hochladen“ in der Übersicht, führen direkt in den passenden Bereich; die Adresse lautet dann z. B. `/einstellungen?bereich=elster`.

Ebenfalls unten links wählst du das **Theme**: Wald (Grün, Standard), Ozean, Pflaume, Graphit, die dunklen Themes Nacht und Tiefsee oder **Automatisch**, das je nach Systemeinstellung zwischen Wald und Nacht wechselt. Die Wahl gilt für diesen Browser und wird dort gespeichert, nicht auf dem Server; auf einem anderen Gerät wählst du sie neu. Rechnungen und PDFs bleiben in jedem Theme gleich.

Darunter steht die **Version** von Haben, die auf dem Server läuft, verlinkt mit den Versionshinweisen auf GitHub. Nach einem Update siehst du dort, ob der neue Stand angekommen ist.

## Als App installieren

Haben lässt sich auf Handy und Rechner wie eine App installieren (Progressive Web App). Es öffnet sich dann in einem eigenen Fenster ohne Adressleiste und hat ein Symbol auf dem Startbildschirm bzw. im Startmenü.

| Gerät | So geht es |
| --- | --- |
| Rechner mit Chrome, Edge oder Brave | Haben öffnen, in der Adressleiste auf das Symbol **Installieren** klicken oder im Menü „App installieren“ wählen |
| Android | Haben in Chrome öffnen, im Menü **App installieren** bzw. „Zum Startbildschirm hinzufügen“ |
| iPhone und iPad | Haben in Safari öffnen, **Teilen › Zum Home-Bildschirm** |

Die installierte App bringt zwei Kurzbefehle mit, **Beleg hochladen** und **Neue Rechnung**: am Handy lange auf das Symbol drücken, am Rechner mit der rechten Maustaste. Unter Android steht Haben außerdem im **Teilen-Menü**: Ein PDF oder Foto aus einer anderen App teilst du direkt als Beleg ([Belege](belege.md)). Safari auf iPhone und iPad bietet das Teilen an Web-Apps nicht an; dort lädst du Belege in Haben hoch oder nimmst sie mit der Kamera auf.

Die App ist dieselbe Seite wie im Browser und speichert nichts auf dem Gerät zwischen. Sie braucht also eine Verbindung zu deinem Server, und die Anmeldung mit Passkey gilt auch dort. Installieren lässt sich Haben nur über HTTPS, wie es die [Installation](installation.md) einrichtet.

## Firmendaten

Unter **Einstellungen › Firma** hinterlegst du die Angaben, die auf Rechnungen und in der Voranmeldung stehen. Fehlt etwas für ELSTER, zeigt das Formular oben „Für ELSTER fehlt noch: …“.

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
| Kontoinhaber | Nur nötig, wenn das Konto nicht auf den Firmennamen läuft. Steht im GiroCode, in der Fußzeile und in der E-Rechnung (BT-85); leer = Firmenname. Höchstens 70 Zeichen, siehe [GiroCode](rechnungen.md#girocode) |
| Rechtsform | Einzelunternehmen, GmbH oder UG (haftungsbeschränkt), siehe [unten](#rechtsform-einzelunternehmen-gmbh-oder-ug) |
| Sitz, Registergericht, Registernummer | Nur GmbH und UG, Abschnitt **Handelsregister und Geschäftsführung**: wie im Registerauszug, etwa „Amtsgericht Bremen“ und „HRB 12345 HB“. Sie gehören in den Jahresabschluss (§ 264 Abs. 1a HGB), stehen auf der [Bilanz zur Hinterlegung](buchhaltung.md#hinterlegung-beim-unternehmensregister-gmbh-und-ug) und auf jedem Geschäftsbrief (siehe [Pflichtangaben einer GmbH oder UG](rechnungen.md#pflichtangaben-einer-gmbh-oder-ug)). Sitz laut Gesellschaftsvertrag; leer = Ort der Anschrift |
| Geschäftsführer | Nur GmbH und UG: alle Geschäftsführer, einer je Zeile, mit Familiennamen und mindestens einem ausgeschriebenen Vornamen, etwa „Erika Mustermann“ (§ 35a Abs. 1 GmbHG). Stehen im Fuß von Rechnung, Angebot, Mahnung und Lieferschein und unter E-Mails an Kunden |
| Vorsitz des Aufsichtsrats | Nur, wenn die Gesellschaft einen Aufsichtsrat mit Vorsitz gebildet hat; sonst leer lassen |
| Kontenrahmen | SKR03 oder SKR04, siehe unten |
| Standard-Zahlungsziel in Tagen | Vorgabe für neue Rechnungen (0 bis 120 Tage) |
| Standardformat für Rechnungen | ZUGFeRD (PDF mit eingebettetem XML), XRechnung (CII) oder XRechnung (UBL). Vorgabe für neue Rechnungen |
| Standard-Einleitung für Rechnungen, für Angebote | Steht in neuen Rechnungen bzw. Angeboten als Einleitung über den Positionen, etwa eine Anrede oder „Für die erbrachten Leistungen berechne ich Ihnen:“. Im Beleg änderbar; bestehende Belege ändern sich nicht. Leer = keine Einleitung, höchstens 2000 Zeichen |
| Versteuerung | Ist oder Soll, siehe unten |
| Kleinunternehmer nach § 19 UStG | Haken setzen, wenn du die Kleinunternehmerregelung nutzt, siehe unten |

Fehlt einer GmbH oder UG etwas davon, zeigt das Formular im Abschnitt **Handelsregister und Geschäftsführung** „Für Rechnungen und Geschäftsbriefe fehlt noch (§ 35a GmbHG): …“, etwa „Geschäftsführer fehlt“ oder bei „E. Mustermann“ den fehlenden ausgeschriebenen Vornamen.

Die Umrechnung der Steuernummer prüft die Länge je Bundesland. Passt sie nicht, meldet Haben zum Beispiel „Steuernummer für Bayern muss 11 Ziffern haben“. Für Hessen setzt Haben die führende `0` der Finanzamtsnummer wie von ELSTER verlangt auf `6`.

Mehr zu den Pflichtangaben auf Rechnungen steht in [Rechnungen](rechnungen.md).

### Logo

Unter **Einstellungen › Rechnungen › Logo** lädst du dein Logo hoch, als PNG (gern mit transparentem Hintergrund) oder JPEG bis 1 MB.

- Es steht oben rechts im Briefkopf von Rechnungen, Angeboten und Mahnungen, höchstens 18 mm hoch und 60 mm breit, ohne Verzerrung.
- Die Vorschau im Rechnungs- und Angebotseditor zeigt es ebenfalls.
- Es gilt für alles, was ab dann festgeschrieben wird; schon festgeschriebene PDFs bleiben unverändert.
- Im Änderungsprotokoll steht, wann sich das Logo geändert hat, mit SHA-256, aber ohne die Bilddaten.

### Akzentfarbe

Unter **Einstellungen › Rechnungen › Akzentfarbe** stellst du die Farbe der Spaltenköpfe und Linien ein, etwa passend zu deinem Logo. Ab Werk ist es das Grün `#1F6F5C`.

- Text, Adressen, Beschriftungen, Positionen, dünne Linien und Fußzeile stehen in Grautönen, die Haben aus der Akzentfarbe ableitet: gleiche Helligkeit wie ab Werk, aber mit ihrem Farbton. Bei Blau sind sie leicht bläulich, bei einer grauen Akzentfarbe neutral grau; mit dem Standardgrün bleibt alles wie bisher.
- Du wählst sie mit dem Farbfeld oder trägst sie als Hex-Wert in der Form `#RRGGBB` ein; **Auf Standard zurücksetzen** stellt das Grün wieder her.
- Sie gilt für Rechnungen, Angebote, Auftragsbestätigungen, Lieferscheine und Mahnungen, die ab dann entstehen, und für die Vorschau im Editor; schon festgeschriebene PDFs bleiben unverändert.
- Ist die Farbe auf weißem Papier schwer zu lesen (Kontrast unter 4,5 : 1 nach WCAG), weist Haben darauf hin. Speichern geht trotzdem; eine dunklere Variante des Logo-Farbtons liest sich besser.
- Die Änderung steht wie die übrigen Firmendaten im Änderungsprotokoll.

## Persönliche Angaben

Unter **Einstellungen › Persönliche Angaben** stehen die Angaben zu dir als Person, die ELSTER für manche Vorgänge braucht: Anrede, steuerliche Identifikationsnummer (Steuer-ID), Vor- und Nachname, Geburtsdatum, Religion und ausgeübter Beruf. Bei der Zusammenveranlagung kommen das Heiratsdatum und dieselben Angaben zum Ehegatten dazu.

Gebraucht werden sie für [Bankverbindung ändern](finanzamt.md#bankverbindung-ändern) und die Einkommensteuererklärung. Haben prüft die Prüfziffer der Steuer-ID. Die Religion bestimmt, ob Kirchensteuer anfällt; Haben nutzt die Religionsschlüssel von ELSTER. Änderungen landen wie die Firmendaten im Audit-Log.

## Rechtsform: Einzelunternehmen, GmbH oder UG

Die Rechtsform bestimmt, wohin Geld zwischen dem Unternehmen und dir gebucht wird und welche Erklärungen Haben anbietet.

| | Einzelunternehmen | GmbH, UG (haftungsbeschränkt) |
| --- | --- | --- |
| Geld vom und an den Inhaber | Privateinlage und Privatentnahme | Gesellschafter-Verrechnungskonto: SKR03 0730, SKR04 3510 „Verbindlichkeiten gegenüber Gesellschaftern“, für beide Richtungen |
| Beleg aus eigenem Geld bezahlt | „Privat bezahlt (Privateinlage)“ | „Vom Gesellschafter ausgelegt (Verrechnungskonto)“ |
| Bank ohne Rechnung oder Beleg | „Privat (Entnahme oder Einlage)“ | „Gesellschafter (Verrechnungskonto)“ |
| Kasse | „Einlage“ und „Entnahme“ | „Vom Gesellschafter“ und „An den Gesellschafter“ |
| Privatanteile, Kfz-Privatnutzung, [Pauschalen](pauschalen.md) | ja | nein |
| Anlage EÜR, Einkommensteuer | ja | nein |
| Voranmeldung, Umsatzsteuererklärung, DATEV-Export | ja | ja |
| [Manuelle Buchungen](buchhaltung.md#manuelle-buchungen-gmbh-und-ug) | nein | ja |
| [Saldenvortrag, Eröffnungsbuchung](buchhaltung.md#saldenvortrag-und-eröffnung-gmbh-und-ug) | nein, jedes Jahr beginnt bei null | ja |
| [Jahresabschluss](buchhaltung.md#jahresabschluss-gmbh-und-ug): Bilanz und GuV (Entwurf), Jahr abschließen | nein | ja |
| [Körperschaft- und Gewerbesteuer](buchhaltung.md#körperschaft-und-gewerbesteuer-gmbh-und-ug) rechnen, Rückstellungen buchen | nein | ja |
| [Körperschaft- und Gewerbesteuererklärung](jahreserklaerung.md#körperschaft-und-gewerbesteuererklärung-gmbh-und-ug) an das Finanzamt | nein | ja |
| [E-Bilanz](buchhaltung.md#e-bilanz-gmbh-und-ug) an das Finanzamt | nein | ja |
| [Gewinnausschüttung](buchhaltung.md#gewinnausschüttung-gmbh-und-ug) mit Kapitalertragsteuer-Anmeldung | nein | ja |

Eine Kapitalgesellschaft hat kein Privat. Was der Gesellschafter für sie auslegt oder von ihr bekommt, ist eine Verbindlichkeit bzw. Forderung ihm gegenüber; das Verrechnungskonto zeigt den Stand. Ein Privatanteil wäre bei einer GmbH Arbeitslohn oder eine verdeckte Gewinnausschüttung, die Privatnutzung eines Firmenwagens ein Sachbezug in der Lohnabrechnung. Beides bucht Haben deshalb nicht; die Pauschalen ersetzen Ausgaben eines Einzelunternehmers. Erstattet die GmbH dir Reisekosten, lädst du die Abrechnung als Beleg hoch und wählst „Vom Gesellschafter ausgelegt“.

Bilanz und GuV zeigt Haben als Entwurf für die Steuerberatung, rechnet Körperschaft- und Gewerbesteuer samt Rückstellungen und sendet die [E-Bilanz](buchhaltung.md#e-bilanz-gmbh-und-ug) und die [Erklärungen](jahreserklaerung.md#körperschaft-und-gewerbesteuererklärung-gmbh-und-ug) für eine GmbH ohne Beteiligungen, Organschaft und Ausschüttungen. Die laufende Buchhaltung mit Rechnungen, Belegen, Bank und Umsatzsteuer machst du in Haben und gibst den [DATEV-Export](auswertungen.md) an die Steuerberatung. Der Weg zum Abschluss steht in [Issue #213](https://github.com/firsttris/haben/issues/213).

Den Ablauf eines Jahres für eine GmbH oder UG zeigt [GmbH und UG](gmbh.md).

Die Rechtsform lässt sich nur vor der ersten Buchung festlegen. Danach sperren App und Datenbank die Änderung, auch über Jahre hinweg: Privatkonten und Gesellschafter-Verrechnungskonto gehören nicht in dieselben Bücher, und eine neue Rechtsform ist ein neues Unternehmen mit eigener Buchhaltung.

> [!IMPORTANT]
> Das Gesellschafter-Verrechnungskonto ist das Sammelkonto „Verbindlichkeiten gegenüber Gesellschaftern“ aus dem DATEV-Kontenrahmen. Für den Abschluss ordnet die Steuerberatung seinen Saldo nach Restlaufzeit oder als Forderung zu; stimme die Konten vor dem Echtbetrieb mit ihr ab.

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

Der Kontenrahmen legt fest, auf welche Kontonummern Haben bucht. Wähle denselben wie in Lexoffice oder bei deiner Steuerberatung. Er wirkt auf alle Buchungen (Rechnungen, Belege, Zahlungen) und auf die Kontonamen im Journal. Jede Buchung speichert den Kontenrahmen, mit dem sie erstellt wurde; ein späterer Wechsel ändert bestehende Buchungen nicht. Wechseln kannst du nur zum Jahresbeginn, bevor im neuen Jahr gebucht wird. Bei GmbH und UG ist der Kontenrahmen ab der ersten Buchung fest, in App und Datenbank (`0101_kontenrahmen_kapg.sql`): Die Bestandskonten tragen ihre Salden vor, und im neuen Kontenrahmen kämen die Vorträge nicht an. Einen Wechsel stellt die Steuerberatung mit einer neuen Eröffnungsbilanz um.

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

Nutzt du die Kleinunternehmerregelung nach § 19 UStG, setzt du unter **Einstellungen › Firma** den Haken **Kleinunternehmer nach § 19 UStG**. Dann gilt:

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

Nur im Einzelunternehmen; bei GmbH und UG fehlt der Abschnitt. Unter **Privatanteil Telefon in %** und **Privatanteil Internet in %** legst du fest, welcher Anteil dieser Rechnungen privat ist, z. B. 20 %. Neue Belege der Kategorien übernehmen den Wert; am einzelnen Beleg lässt er sich ändern. Mehr unter [Belege](belege.md#privatanteil).

## Fremdwährung

Rechnest du Belege oder Rechnungen in US-Dollar, Pfund oder einer anderen Währung ab, braucht Haben die Umsatzsteuer-Umrechnungskurse (§ 16 Abs. 6 UStG). Das Bundesministerium der Finanzen veröffentlicht sie monatlich im Datenportal als CSV (Datenlizenz Deutschland – Namensnennung 2.0). Haben ruft sie von selbst ab, sobald du Fremdwährung nutzt: höchstens einmal am Tag und nur, solange die Kurse des Vormonats fehlen. Belege und Rechnungsentwürfe, die auf einen Kurs warten, rechnet es danach um.

Unter **Einstellungen → Fremdwährung** siehst du die gespeicherten Kurse und kannst

- die Kurse sofort abrufen (**Kurse jetzt abrufen**),
- die CSV-Datei des BMF selbst hochladen, wenn der Server das Internet nicht erreicht,
- einen Kurs von Hand eintragen, etwa vorläufig für einen Monat, den das BMF noch nicht veröffentlicht hat. Veröffentlicht das BMF den Monat, ersetzt der amtliche Kurs deinen.

Jede Änderung eines Kurses steht im Audit-Log. Gebuchte Belege und festgeschriebene Rechnungen speichern ihren Kurs selbst und ändern sich nicht mehr.

Hat dir das Finanzamt erlaubt, mit dem Tageskurs umzurechnen (§ 16 Abs. 6 Satz 3 UStG), schaltest du in den Firmendaten unter **Fremdwährung** den **Tageskurs** ein. An Beleg und Rechnung trägst du dann Kurs und Kursdatum ein.

## Wann sich die Einstellungen ändern lassen

Kontenrahmen, Versteuerung und Kleinunternehmerstatus gelten für ein ganzes Geschäftsjahr. Haben sperrt deshalb die Umstellung, sobald es im laufenden Kalenderjahr eine Buchung gibt. Das Auswahlfeld ist dann ausgegraut, und darunter steht der Grund. Auch der Server lehnt eine solche Änderung ab, für jeden Zugang, und die Datenbank prüft den Kern der Regel (im laufenden Jahr gebucht) noch einmal selbst.

| Einstellung | Gesperrt, wenn |
| --- | --- |
| Kontenrahmen | im laufenden Jahr gebucht wurde |
| Versteuerung (Ist oder Soll) | im laufenden Jahr gebucht wurde oder Rechnungen noch offen sind; ihre Umsatzsteuer würde sonst doppelt oder gar nicht angemeldet |
| Kleinunternehmer einschalten | im laufenden Jahr gebucht wurde |
| Kleinunternehmer ausschalten | nie |
| Rechtsform | überhaupt schon gebucht wurde, in irgendeinem Jahr |

Umstellen kannst du also nur zum Jahreswechsel, bevor im neuen Jahr die erste Buchung entsteht. Das Vorjahr rechnet danach weiter nach der alten Versteuerung, auch die Umsatzsteuererklärung dafür. Ebenso beim Kleinunternehmerstatus: Wer zum 1. Januar Kleinunternehmer wird, sieht die Voranmeldung für Dezember und die Umsatzsteuererklärung des Vorjahres weiter als Frist und kann sie abgeben; maßgeblich ist der Stand im jeweiligen Monat bzw. Jahr laut Änderungsprotokoll.

Ins Vorjahr buchen geht nach einem Wechsel nur noch, wo es nicht von der Einstellung abhängt:

- **Kontenrahmen:** In ein Jahr, das im alten Kontenrahmen gebucht ist, bucht Haben nichts mehr, auch keine Gegenbuchung beim Aufheben einer Zuordnung. Ordne Zahlungen des Vorjahres also vor dem Wechsel richtig zu.
- **Versteuerung:** Eine Rechnung mit Datum im Vorjahr lässt sich nicht mehr festschreiben; ihre Umsatzsteuer stünde sonst doppelt (Soll → Ist) oder gar nicht (Ist → Soll) in den Voranmeldungen. Schreibe Entwürfe des Vorjahres vor dem Wechsel fest oder gib ihnen ein Datum im neuen Jahr.

Kläre einen Wechsel vorher mit deiner Steuerberatung.

Lehnt die Datenbank eine Umstellung ab, weil gleichzeitig gebucht wurde, siehst du ihre Begründung statt „Interner Fehler“.

## Rechnungsnummern

Rechnungsnummern haben ab Werk die Form `JAHR-NNN`, zum Beispiel `2026-034`; das Format lässt sich ändern (siehe unten). Der Zähler läuft je Jahr; das Jahr kommt aus dem Rechnungsdatum. Eine Nummer vergibt Haben erst beim Festschreiben, in derselben Transaktion wie PDF, XML und Buchung. Schlägt dabei etwas fehl, wird keine Nummer verbraucht. Entwürfe haben noch keine Nummer, deshalb entstehen keine Lücken.

Lückenlos und fortlaufend sollen die Nummern sein, damit das Finanzamt bei einer Prüfung sieht, dass keine Rechnung fehlt.

Unter **Einstellungen › Rechnungen › Rechnungsnummern** siehst du die nächste Nummer des laufenden Jahres. Kommst du aus Lexoffice, trägst du dort die nächste laufende Nummer ein (z. B. `35`, wenn die letzte Lexoffice-Rechnung `2026-034` war). Der Wert muss größer sein als die zuletzt vergebene Nummer; zurücksetzen geht nicht. Die letzte Lexoffice-Nummer zeigt dir auch der Abgleich in [Umzug aus Lexoffice](lexoffice.md).

### Nummernformat

Unter **Einstellungen › Rechnungen › Nummernformat** legst du fest, wie Rechnungs- und Angebotsnummern aufgebaut sind, etwa mit eigenem Präfix. Ab Werk sind es `{JJJJ}-{NNN}` (`2026-034`) und `AN-{JJJJ}-{NNN}` (`AN-2026-007`).

| Platzhalter | Wird zu |
| --- | --- |
| `{JJJJ}` | Jahr des Rechnungs- bzw. Angebotsdatums, z. B. `2026` |
| `{JJ}` | dasselbe zweistellig, z. B. `26` |
| `{N}` bis `{NNNNNN}` | laufende Nummer mit mindestens so vielen Stellen, vorne mit Nullen aufgefüllt; mehr Stellen werden nie abgeschnitten |

Beispiele: `RE-{JJJJ}-{NNNN}` ergibt `RE-2026-0034`, `R{JJ}{NNN}` ergibt `R26034`.

- Die laufende Nummer muss genau einmal vorkommen, das Jahr mindestens einmal: Der Zähler beginnt jedes Jahr bei 1, erst mit dem Jahr bleibt jede Nummer eindeutig (§ 14 Abs. 4 Nr. 4 UStG).
- Außerhalb der Platzhalter gehen Buchstaben, Ziffern, Bindestrich, Unterstrich und Punkt, insgesamt höchstens 30 Zeichen. Leerzeichen und Schrägstrich gehen nicht, weil die Nummer auch im Dateinamen und im Verwendungszweck steht.
- Unter dem Feld steht ein Beispiel oder, was am Format nicht passt.
- Das Format gilt für alles, was ab dann festgeschrieben wird; schon vergebene Nummern bleiben, wie sie sind. Der Zähler läuft beim Wechsel einfach weiter.
- Ergibt das neue Format eine Nummer, die es schon gibt, schreibt Haben nicht fest, sondern meldet „Die Nummer … ist schon vergeben“; der Zähler bleibt stehen. Das passiert nur bei sehr ähnlichen Formaten.
- Der Bankabgleich findet die Nummer im Verwendungszweck in jedem Format.
- Die Änderung steht wie die übrigen Firmendaten im Änderungsprotokoll.

## ELSTER einrichten

Haben übermittelt Voranmeldung, Jahreserklärungen und Nachrichten über ERiC, die offizielle Bibliothek der Steuerverwaltung, und holt darüber Bescheide aus dem ELSTER-Postfach. Ohne ERiC laufen Prüfen und Senden simuliert, und die Oberfläche weist darauf hin. Welcher Weg zum Finanzamt ohne Hersteller-ID bleibt, steht in [Abgabe an ELSTER](elster-abgabe.md).

### Was du brauchst

| | Wofür | Woher | Dauer |
| --- | --- | --- | --- |
| **ERiC** | Bibliothek der Finanzverwaltung: prüft, verschlüsselt und überträgt | Haben lädt sie selbst, siehe [Schritte](#schritte) | Minuten |
| **Hersteller-ID** (fünf Ziffern) | Kennung der Software in jeder Übermittlung; ERiC 43 verlangt sie schon fürs Prüfen | ELSTER-Entwicklerbereich: auf elster.de als Entwickler registrieren, das Bayerische Landesamt für Steuern prüft den Antrag | Tage bis Wochen |
| **Zertifikatsdatei** (.pfx) und PIN | unterschreibt jede Übermittlung | ELSTER-Benutzerkonto mit der Anmeldeart „Zertifikatsdatei“, siehe [unten](#zertifikatsdatei-statt-elster-secure) | ein bis zwei Wochen (Brief) |

Bis Hersteller-ID und Zertifikat da sind, arbeitest du ganz normal: Belege, Rechnungen, Bank, Auswertungen, Voranmeldung und Jahreserklärungen rechnet Haben vollständig, Prüfen und Senden laufen simuliert. Abgeben kannst du in der Zwischenzeit in Mein ELSTER: die Voranmeldung per XML-Import, alle Formulare mit der Erweiterung „Haben für Mein ELSTER“, mit einem KI-Assistenten oder von Hand. Die Wege im Vergleich: [Abgabe an ELSTER](elster-abgabe.md).

### Zertifikatsdatei statt ELSTER Secure

Haben unterschreibt über ERiC, und ERiC braucht eine Zertifikatsdatei mit PIN. Mit der App ELSTER Secure meldest du dich nur im Browser bei Mein ELSTER an; Programme wie Haben können sie nicht nutzen.

Ein ELSTER-Benutzerkonto hat genau eine Anmeldeart. Du legst deshalb ein zweites Konto an; dein bisheriges bleibt:

1. Auf elster.de **Benutzerkonto erstellen**, Anmeldeart **Zertifikatsdatei**, **Für mich** mit deiner Steuer-ID. Das persönliche Konto reicht auch für Umsatzsteuer und EÜR deines Einzelunternehmens und ist für den [Belegabruf](jahreserklaerung.md) zur Einkommensteuer nötig.
2. Die Aktivierungs-ID kommt per E-Mail, der Aktivierungscode per Post.
3. Mit beiden das Konto aktivieren, die `.pfx`-Datei herunterladen und die PIN festlegen. Das Zertifikat gilt drei Jahre.

### Hersteller-ID: wer ist Hersteller?

Die Hersteller-ID gehört dem Softwarehersteller, nicht dem Steuerpflichtigen. Bei gekaufter Software senden alle Kunden mit der ID des Anbieters. Bei Haben ist jeder, der es betreibt, selbst Hersteller: Jede Installation trägt ihre eigene ID in `ELSTER_HERSTELLER_ID` ein, Haben bringt keine mit.

Betreibst du Haben für andere mit deiner ID, bist du für sie Softwarehersteller im Sinne des ERiC-Lizenzvertrags (`lizenz.pdf` im ERiC-Paket):

- Den Support für diese Nutzer leistest du (§ 7).
- Du setzt mindestens die Mindestversion von ERiC ein, die ELSTER vorgibt (§ 5).
- Die Nutzer bestätigen vor der ersten Nutzung die Datenschutzhinweise der Finanzverwaltung (§ 5); das fragt Haben unter **Einstellungen › ELSTER › ERiC** ab.

Bei Verstößen kann das Landesamt die Hersteller-ID sperren (§ 9); dann kann niemand mehr damit senden. Wer Haben verändert und weitergibt, braucht eine eigene ID (§ 4). Die Hersteller-ID ist kein Geheimnis, sie steht in jeder Übermittlung. Trag sie trotzdem nur in `.env` bzw. `haben.env` ein, nicht ins Repository oder Image.

### Open Source und die Hersteller-ID

Die Hersteller-ID ist für Software gedacht, hinter der ein Hersteller mit einem Produkt steht. Für ein freies Projekt wie Haben passt das schlecht: Jeder, der es betreibt oder verändert, ist selbst Hersteller und braucht eine eigene ID. Eine gemeinsame ID für ein Open-Source-Projekt sieht ELSTER nicht vor. Das ist seit Langem bekannt; schon 2005 kritisierte [netzpolitik.org](https://netzpolitik.org/2005/elster-in-der-kritik/), dass die Hersteller-ID an Produkt und Hersteller gebunden ist und freie Software damit kaum vorgesehen ist.

Eine offizielle Aussage der Finanzverwaltung zu Open-Source-Projekten haben wir nicht gefunden. Zuständig ist das Bayerische Landesamt für Steuern, das ELSTER bundesweit koordiniert. Registrierung und Hersteller-ID laufen über die [ELSTER-Entwicklerseite](https://www.elster.de/eportal/infoseite/entwickler); mit dem Zugang zum Entwicklerbereich kannst du dort auch nachfragen, wie das Landesamt freie Software sieht. Erfährst du dabei etwas, freuen wir uns über ein Issue, damit es hier stehen kann.

### Warum Lexoffice ohne dein Zertifikat sendet

Cloud-Dienste wie Lexware Office übermitteln in deinem Auftrag mit ihrem eigenen Zertifikat (Datenübermittlung im Auftrag, § 87d AO). Der Anbieter muss dafür seine Auftraggeber identifizieren und die Übermittlungen aufbewahren. Haben läuft auf deinem eigenen Server, ohne Anbieter dazwischen: Du sendest selbst und brauchst dein eigenes Zertifikat.

### Schritte

1. **ERiC laden:** unter **Einstellungen › ELSTER › ERiC** den Nutzungsbedingungen zustimmen und **Herunterladen und einrichten** klicken. ERiC darf nicht weitergegeben werden und liegt deshalb weder im Repository noch im Image; Haben holt es direkt von der Finanzverwaltung (Linux x86_64).
2. **Oder von Hand:** das Paket z. B. nach `/opt/eric` entpacken (darin `lib/libericapi.so` und `lib/plugins/`) und `ERIC_HOME` setzen. Beides steht in [ERiC einbinden](installation.md#eric-einbinden).
3. **Hersteller-ID eintragen.** Die eigene Hersteller-ID aus dem ELSTER-Entwicklerbereich ([siehe oben](#was-du-brauchst)) als `ELSTER_HERSTELLER_ID` (fünf Ziffern) eintragen. Seit ERiC 43 ist die frühere Test-Hersteller-ID `74931` gesperrt; ERiC lehnt ohne eigene ID schon das Prüfen ab („Bitte verwenden Sie Ihre eigene Hersteller-ID auch für Testfälle“). Ohne ERiC laufen Prüfen und Testübermittlung weiter simuliert.
4. **Datenschutzhinweise bestätigen.** Unter **Einstellungen › ELSTER › ERiC** die Datenschutzhinweise der Finanzverwaltung lesen und bestätigen. Der ERiC-Lizenzvertrag verlangt das vor der ersten Nutzung; ohne Bestätigung lehnt Haben jeden Aufruf von ERiC ab. Die Bestätigung gilt für die Installation und steht im Änderungsprotokoll.
5. **Zertifikat hochladen.** Die `.pfx`-Datei aus deinem Konto mit Anmeldeart Zertifikatsdatei ([siehe oben](#zertifikatsdatei-statt-elster-secure)) unter **Einstellungen › ELSTER › ELSTER-Zertifikat** hochladen (höchstens 64 KB). Haben speichert die Datei AES-256-GCM-verschlüsselt in der Datenbank. Trägst du „Gültig bis“ ein, warnt die Übersicht 30 Tage vor Ablauf. Ein neues Zertifikat ersetzt das alte.
6. **Formate prüfen.** Unter **Einstellungen › ELSTER › ERiC** lässt **Formate mit ERiC prüfen** ERiC alle Nachrichten von Belegabruf, Berechtigung und Postfach gegen seine Schemas prüfen, ohne etwas zu senden. Diese Formate stammen aus freien Projekten (erica, viking) statt aus der amtlichen Jahresdokumentation; die Prüfung zeigt sofort, ob eine Version oder ein Feldname nicht mehr passt. Bemängelt ERiC etwas, bitte die Meldungen als Issue melden.
7. **Nur prüfen.** Auf der Seite einer Voranmeldung lässt „Nur prüfen“ ERiC die Daten auf Plausibilität prüfen. Dafür braucht es weder Zertifikat noch PIN.
8. **Testübermittlung.** Mit gesetztem Haken „Nur Testübermittlung“, PIN und „Prüfen und testweise senden“. Die Testübermittlung läuft mit deiner Hersteller-ID und dem Testmerker `700000004`; der ELSTER-Server nimmt sie an, leitet sie aber nicht an das Finanzamt weiter. Die Anmeldung bleibt ein Entwurf. Erst danach den Haken „Nur Testübermittlung“ entfernen.
9. **Echtübermittlung.** Ohne Haken fragt Haben noch einmal nach („Jetzt verbindlich senden“). Nach erfolgreicher Übermittlung ist die Voranmeldung festgeschrieben; eine Korrektur ist eine neue, berichtigte Anmeldung.

Die PIN fragt Haben bei jeder Übermittlung ab. Nur für den automatischen Postfach-Abruf kannst du sie verschlüsselt speichern, siehe [Finanzamt](finanzamt.md#automatisch-abrufen). Für den Versand legt Haben das entschlüsselte Zertifikat kurz in ein temporäres Verzeichnis (Rechte `0600`) und löscht es danach. Jede Prüfung und Übermittlung landet mit Transfer-Ticket und ERiC-Protokoll-PDF im Verlauf der Voranmeldung.

Vor dem Senden prüft Haben die Firmendaten: Name, Anschrift, Bundesland und eine gültige Steuernummer müssen vorhanden sein.

> [!IMPORTANT]
> Die ERiC-Anbindung ist mit ERiC 43.4.6.0 geprüft: Funktionssignaturen und Strukturen gegen die mitgelieferten Header, alle Nachrichten lokal gegen ERiCs Schemas und Plausibilitätsprüfungen, Zertifikat und Protokoll-PDF mit dem Testzertifikat aus dem ERiC-Paket. Die Übertragung an den ELSTER-Server lässt sich nur mit eigener Hersteller-ID testen; das ist deine erste Testübermittlung. ERiC-Updates spielst du erst ein, wenn eine Testübermittlung damit geklappt hat.

Wie du Voranmeldungen erstellst und was die Vorprüfung meldet, steht in [Umsatzsteuer](umsatzsteuer.md).

## E-Mail

Für [Rechnungen, Angebote und Mahnungen per E-Mail](rechnungen.md#per-e-mail-versenden) und [Erinnerungen an Fristen](fristen.md#erinnerungen-per-e-mail) braucht Haben einen E-Mail-Zugang über SMTP. Unter **Einstellungen › E-Mail › E-Mail-Versand** den Anbieter wählen (Gmail, GMX, web.de, Posteo, mailbox.org belegen Server, Port und Verschlüsselung vor) oder einen eigenen Server eintragen, dazu Benutzername, Passwort, Absender und den Empfänger der Erinnerungen. **Test-Mail senden** prüft den Zugang. Solange „Prüfwert des Änderungsprotokolls wöchentlich mailen“ eingeschaltet ist, kommt an dieselbe Adresse einmal pro Woche der aktuelle Prüfwert, wenn sich etwas geändert hat. Bewahre diese Mails auf: Mit ihnen lässt sich später zeigen, dass das Protokoll bis dahin nicht nachträglich verändert wurde (siehe [Buchhaltung in Haben](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel)).

- **Gmail:** Zwei-Faktor-Anmeldung einschalten und unter myaccount.google.com › Sicherheit › App-Passwörter ein App-Passwort erzeugen; das ist das Passwort für Haben, Benutzername ist die Gmail-Adresse. Eine eigene Gmail-Anbindung über die Google-API braucht es nicht.
- **GMX und web.de:** im Postfach unter Einstellungen › POP3/IMAP den Zugriff per externem Programm erlauben.

Unter **Vorlagen** legst du Betreff und Text der E-Mails je Art und Sprache fest (siehe [Per E-Mail versenden](rechnungen.md#per-e-mail-versenden)).

Das Passwort speichert Haben AES-256-GCM-verschlüsselt wie das ELSTER-Zertifikat; es steht nicht im Audit-Log und wird nie angezeigt. Zum Ändern anderer Angaben das Passwortfeld leer lassen.

## KI-Auslesung von Belegen

Optional. E-Rechnungen (ZUGFeRD, Factur-X, XRechnung) liest Haben immer selbst aus. Für andere PDFs und Fotos (JPEG, PNG, WebP) kann Claude die Felder vorbefüllen: Lieferant, USt-IdNr., Rechnungsnummer, Datum, Fälligkeit, Beträge je Steuersatz und eine vorgeschlagene Kategorie. Dafür muss auf dem Server `ANTHROPIC_API_KEY` gesetzt sein (siehe [Installation](installation.md#ki-auslesung-anthropic)).

Dabei geht die Belegdatei an die Anthropic-API. Ohne Schlüssel bleibt alles lokal, und du füllst die Felder von Hand aus. In beiden Fällen bucht Haben einen Beleg erst, wenn du die Felder bestätigt hast. Weicht die Summe vom Gesamtbetrag ab oder ist die Währung nicht Euro, zeigt Haben einen Hinweis. Mehr in [Belege](belege.md).

## Bankkonten

Bankkonten musst du meist nicht von Hand anlegen. Mit dem automatischen Abruf über Enable Banking legt Haben die freigegebenen Konten beim Verbinden an (Einrichtung in [Installation](installation.md#kontoabruf-enable-banking), Ablauf in [Bank](bank.md#automatischer-abruf)). Beim ersten Import eines DKB-CSV oder CAMT.053-Auszugs legt Haben das Konto über die IBAN aus der Datei an. N26-CSV-Dateien enthalten keine eigene IBAN. Dafür legst du das Konto vorher an:

1. Auf der Seite **Bank** „Konto hinzufügen“ wählen.
2. Name (z. B. „N26 Business“) und IBAN eintragen und „Konto anlegen“.
3. Beim Import das Konto in der Auswahl „Konto“ wählen und die Datei hochladen.

Name und Zweck eines Kontos (Geschäftskonto, Steuerkonto, Rücklagen, Privatkonto) änderst du auf der Seite **Bank** mit **Name und Zweck**, auch für automatisch angelegte Konten (siehe [Bank](bank.md#name-und-zweck)). Jede IBAN gibt es nur einmal. Alle Bankkonten buchen auf dasselbe Finanzkonto (1200 bei SKR03, 1800 bei SKR04). Import, Abgleich und Buchungen sind in [Bank](bank.md) beschrieben.

## Wie es weitergeht

- [Rechnungen](rechnungen.md) schreiben und festschreiben
- [Belege](belege.md) hochladen und buchen
- [Bank](bank.md): Kontoauszüge importieren und Zahlungen zuordnen
- [Umsatzsteuer](umsatzsteuer.md): monatliche Voranmeldung
- [Auswertungen](auswertungen.md) und Jahresexport

[Zurück zur Übersicht](README.md)
