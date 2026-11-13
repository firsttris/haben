---
title: "Erste Schritte: Firmendaten, Kontenrahmen, ELSTER einrichten"
description: >-
  Haben nach der Installation einrichten: Konto und Passkey, Firmendaten, Ist- oder Soll-
  Versteuerung, SKR03 oder SKR04, Rechnungsnummern, ELSTER und KI-Auslesung.
---

# Erste Schritte

Wie du Haben auf dem Server installierst, steht in [Betrieb und Installation](installation.md).

## Checkliste

In dieser Reihenfolge kommst du am schnellsten zu einer vollständigen Buchhaltung:

1. Konto anlegen und einen Passkey hinzufügen, siehe [Konto anlegen](#konto-anlegen)
2. Firmendaten ausfüllen, Rechtsform, Versteuerung und Kontenrahmen wählen, gegebenenfalls Kleinunternehmer einschalten; gibst du nicht monatlich ab, unter Umsatzsteuer den [Voranmeldungszeitraum](umsatzsteuer.md#voranmeldungszeitraum) einstellen
3. Wenn du aus Lexoffice kommst: Umzug durchführen, siehe [Umzug aus Lexoffice](lexoffice.md). Der Abgleich zeigt dir die letzte Rechnungsnummer
4. Nächste Rechnungsnummer setzen
5. Hersteller-ID und ELSTER-Zertifikat **gleich jetzt** beantragen: Beides dauert Tage bis Wochen, siehe [Was du brauchst](#was-du-brauchst)
6. Wenn beides da ist: ERiC laden, Hersteller-ID eintragen, Datenschutzhinweise bestätigen, Zertifikat hochladen, eine Voranmeldung mit „Nur prüfen“ und dann als Testübermittlung schicken
7. Für die Anlage EÜR Einkunftsart und Art des Betriebs eintragen, siehe [Jahreserklärungen](jahreserklaerung.md)
8. Bank verbinden (automatischer Abruf) oder ersten Kontoauszug importieren, siehe [Bank](bank.md)
9. Optional: KI-Auslesung für Belege einschalten, mit Claude oder einem Modell über eine OpenAI-kompatible Schnittstelle (selbst betrieben oder ein Cloud-Dienst wie OpenRouter)
10. Optional: deine Steuerberatung mit einem [eigenen Zugang](#zugang-für-die-steuerberatung) einladen

> [!IMPORTANT]
> Rechtsform, Versteuerung, Kontenrahmen und Kleinunternehmerstatus legst du fest, bevor du die erste Rechnung festschreibst oder den ersten Beleg buchst. Die Rechtsform ist ab der ersten Buchung fest, bei GmbH und UG auch der Kontenrahmen. Sobald es im laufenden Jahr Buchungen gibt, sperrt Haben die Umstellung bis zum nächsten Jahreswechsel (siehe [Sperren](#wann-sich-die-einstellungen-ändern-lassen)).

## Konto anlegen

Die folgenden Schritte gelten für den Standardmodus mit lokaler Anmeldung. Läuft Haben im SSO-Modus (`OIDC_ONLY=true`), zeigt `/setup` nur die Schaltfläche zum Einrichten über den Anbieter: Die erste Anmeldung eines Mitglieds der Inhaber-Gruppe richtet Haben ein, ohne Einrichtungscode, Passwort oder Passkey. Siehe [Single Sign-on mit OpenID Connect](installation.md#single-sign-on-mit-openid-connect).

Beim ersten Aufruf leitet Haben auf `/setup` weiter. Das erste Konto ist der **Inhaber** mit allen Rechten: Du gibst den Einrichtungscode, Name, E-Mail und ein Passwort mit mindestens 12 Zeichen ein und klickst „Konto anlegen“.

Den Einrichtungscode schreibt Haben beim Start ins Log, solange es noch kein Konto gibt, etwa `Einrichtungscode für https://haben.example.de/setup: K7QM-3XRP-W9TD`. Du findest ihn mit `docker compose logs app` bzw. `journalctl --user -u haben-app`. Er sorgt dafür, dass niemand anderes eine frisch gestartete Instanz zuerst erreicht und das Konto anlegt. Nach jedem Neustart gibt es einen neuen Code; einen festen setzt du mit `HABEN_SETUP_CODE`. Sobald es ein Konto gibt, lehnt Haben jede weitere Registrierung ab („Haben ist bereits eingerichtet. Weitere Zugänge gibt es nur per Einladung.“), und `/setup` leitet auf die Anmeldung um. Der Einrichtungscode gilt nur für dieses erste Konto.

Direkt danach bietet Haben an, einen Passkey hinzuzufügen. Damit meldest du dich künftig ohne Passwort an, etwa mit Fingerabdruck, Gesichtserkennung oder einem Sicherheitsschlüssel. Das Passwort bleibt als Rückfallebene. Du kannst den Schritt mit „Später“ überspringen.

Auf der Anmeldeseite wählst du „Mit Passkey anmelden“. Über „Passwort verwenden“ meldest du dich mit E-Mail und Passwort an. Unterstützt der Browser Passkey-Autofill, schlägt er den Passkey dort auch direkt im Feld E-Mail vor.

Passkeys verwaltest du unter **Einstellungen › Sicherheit › Passkeys**: weitere hinzufügen (z. B. für Handy und Laptop) oder alte nach einer Rückfrage entfernen. Passkeys hängen an der Domain aus `BETTER_AUTH_URL`; bei einem Domainwechsel musst du sie neu anlegen.

## Zugang für die Steuerberatung

Deine Steuerberatung bekommt auf Wunsch einen eigenen Zugang, der nur lesen kann: Auswertungen, Journal, Kontenblätter, Belege und Rechnungen ansehen, Dateien, DATEV-Export und Jahresarchiv herunterladen. Unter **Einstellungen › Sicherheit › Zugänge** erzeugst du einen Einladungslink, der einmal und 72 Stunden gilt; die Steuerberatung legt damit Passwort und Passkey selbst an. Sperren und Entfernen geht an derselben Stelle. Buchen, Festschreiben, Senden an ELSTER, Einstellungen, Zertifikat, Bankzugang und API-Tokens bleiben bei dir. Alles Weitere steht in [Zugang für die Steuerberatung](steuerberatung.md).

## Einstellungen und Darstellung

Die **Einstellungen** (unten links in der Navigation) sind in Bereiche geteilt: **Firma**, **Persönliche Angaben**, **Rechnungen** (Nummernkreis, Nummernformat, Vorlagen für den Zahlungsplan, Standardanhänge für Angebote, Kundennummern), **Beleggestaltung** (Farbe, Logo und Blatt, Briefpapier, Fußzeile, Layouts), **ELSTER** (Zertifikat, ERiC), **E-Mail** (Versand, Belege-Postfach), **Bank** (Kontoabruf, Google Play, App Store), **Sicherheit** (Passkeys, Zugänge), **Fremdwährung** (Umrechnungskurse), **KI-Assistenten und API** (MCP, [REST-API](api.md), Belegauslesung), **Eigene Seiten** ([eigene Werkzeuge im Menü](eigene-seiten.md)) und **Export** (Jahresarchiv, DATEV, Änderungsprotokoll prüfen, Backup). Links aus der App, etwa „Zertifikat hochladen“ in der Übersicht, führen direkt in den passenden Bereich; die Adresse lautet dann z. B. `/einstellungen?bereich=elster`. Darunter öffnet **Dokumentation** diese Seiten in einem neuen Tab.

Ebenfalls unten links wählst du **Farbe** und **Modus**: Wald (Grün, Standard), Ozean, Pflaume oder Graphit, jeweils hell, dunkel oder **System**, das der Einstellung deines Geräts folgt. Die Wahl gilt für diesen Browser und wird dort gespeichert, nicht auf dem Server; auf einem anderen Gerät wählst du sie neu. Rechnungen und PDFs bleiben in jeder Farbe gleich.

Darunter steht die **Version** von Haben, die auf dem Server läuft, verlinkt mit den Versionshinweisen auf GitHub. Nach einem Update siehst du dort, ob der neue Stand angekommen ist.

## Als App installieren

Haben lässt sich auf Handy und Rechner wie eine App installieren (Progressive Web App). Es öffnet sich dann in einem eigenen Fenster ohne Adressleiste und hat ein Symbol auf dem Startbildschirm bzw. im Startmenü.

| Gerät | So geht es |
| --- | --- |
| Rechner mit Chrome, Edge oder Brave | Haben öffnen, in der Adressleiste auf das Symbol **Installieren** klicken oder im Menü „App installieren“ wählen |
| Android | Haben in Chrome öffnen, im Menü **App installieren** bzw. „Zum Startbildschirm hinzufügen“ |
| Mac mit Safari (ab macOS 14) | Haben in Safari öffnen, **Ablage › Zum Dock hinzufügen**; Haben liegt dann als eigenes Programm im Dock |
| iPhone und iPad | Haben in Safari öffnen, **Teilen › Zum Home-Bildschirm** |

Die installierte App bringt zwei Kurzbefehle mit, **Beleg hochladen** und **Neue Rechnung**: am Handy lange auf das Symbol drücken, am Rechner mit der rechten Maustaste. Unter Android steht Haben außerdem im **Teilen-Menü**: Ein PDF oder Foto aus einer anderen App teilst du direkt als Beleg ([Belege](belege.md)). Safari auf iPhone und iPad bietet das Teilen an Web-Apps nicht an; dort lädst du Belege in Haben hoch oder nimmst sie mit der Kamera auf.

Die App ist dieselbe Seite wie im Browser und speichert nichts auf dem Gerät zwischen. Sie braucht also eine Verbindung zu deinem Server, und die Anmeldung mit Passkey gilt auch dort. Installieren lässt sich Haben nur über HTTPS, wie es die [Installation](installation.md) einrichtet.

## Firmendaten

Unter **Einstellungen › Firma** hinterlegst du die Angaben, die auf Rechnungen und in der Voranmeldung stehen. Fehlt etwas für ELSTER, zeigt das Formular oben „Für ELSTER fehlt noch: …“.

| Feld | Wofür |
| --- | --- |
| Name | Absender auf Rechnungen, Datenlieferant in der Voranmeldung. Pflicht für beides. Steht auch oben in der Navigation unter „Haben“, damit du bei [mehreren Instanzen](installation.md#mehrere-instanzen) siehst, in welcher Firma du gerade bist: am Desktop in bis zu zwei Zeilen, am Handy in einer. Ist er länger als zwei Zeilen, klappt er am Desktop beim Überfahren der Marke nach unten ganz auf |
| Art des Betriebs bzw. Gegenstand des Unternehmens | z. B. „Softwareentwicklung“; für die Anlage EÜR, bei GmbH und UG für die Gewerbesteuererklärung, siehe [Jahreserklärungen](jahreserklaerung.md) |
| E-Mail | Absender auf Rechnungen. Pflicht zum Festschreiben einer Rechnung |
| Straße und Hausnummer, PLZ, Ort | Anschrift auf Rechnungen und in der Voranmeldung. Pflicht für beides; die PLZ hat fünf Ziffern |
| Bundesland | Nötig, um die Steuernummer ins ELSTER-Format umzurechnen. Pflicht für ELSTER. Bestimmt außerdem die Feiertage für die Fälligkeit von Rechnungen und Voranmeldungen |
| Steuernummer | So eingeben, wie sie auf dem Bescheid steht (z. B. `21/815/08150`). Haben rechnet sie ins 13-stellige ELSTER-Format um; eine schon 13-stellige Nummer bleibt unverändert. Pflicht für ELSTER; für Rechnungen reicht Steuernummer oder USt-IdNr. |
| USt-IdNr. | Auf Rechnungen und im E-Rechnungs-XML. Form `DE123456789` |
| Finanzamt | Name des Finanzamts, steht auf der [Lohnsteuerbescheinigung](lohn.md#lohnsteuerbescheinigung). Das Empfänger-Finanzamt der Voranmeldung leitet Haben aus der Steuernummer ab |
| Telefon | Auf der Rechnung; für XRechnung Pflicht |
| Bank, IBAN, BIC | Zahlungsangaben auf der Rechnung. Die IBAN ist Pflicht zum Festschreiben; Eingabe ohne Leerzeichen, Haben entfernt sie aber auch selbst |
| Kontoinhaber | Nur nötig, wenn das Konto nicht auf den Firmennamen läuft. Steht im GiroCode, in der Fußzeile und in der E-Rechnung (BT-85); leer = Firmenname. Höchstens 70 Zeichen, siehe [GiroCode](rechnungen.md#girocode) |
| Gläubiger-ID | Nur für [SEPA-Lastschriften](rechnungen.md#sepa-lastschriftmandate) nötig. Die Bundesbank vergibt sie auf Antrag; 18 Stellen wie `DE98ZZZ09999999999`. Haben prüft die Prüfziffer nach EPC262-08 und speichert sie ohne Leerzeichen |
| Rechtsform | Einzelunternehmen, GmbH oder UG (haftungsbeschränkt), siehe [unten](#rechtsform-einzelunternehmen-gmbh-oder-ug) |
| Einkunftsart | Nur im Einzelunternehmen: selbständige Arbeit oder Gewerbebetrieb, für die Anlage EÜR, siehe [Jahreserklärungen](jahreserklaerung.md) |
| Sitz, Registergericht, Registernummer | Nur GmbH und UG, Abschnitt **Handelsregister und Geschäftsführung**: wie im Registerauszug, etwa „Amtsgericht Bremen“ und „HRB 12345 HB“. Sie gehören in den Jahresabschluss (§ 264 Abs. 1a HGB), stehen auf der [Bilanz zur Hinterlegung](buchhaltung.md#hinterlegung-beim-unternehmensregister-gmbh-und-ug) und auf jedem Geschäftsbrief (siehe [Pflichtangaben einer GmbH oder UG](rechnungen.md#pflichtangaben-einer-gmbh-oder-ug)). Sitz laut Gesellschaftsvertrag; leer = Ort der Anschrift |
| Geschäftsführer | Nur GmbH und UG: alle Geschäftsführer, einer je Zeile, mit Familiennamen und mindestens einem ausgeschriebenen Vornamen, etwa „Erika Mustermann“ (§ 35a Abs. 1 GmbHG). Stehen im Fuß von Rechnung, Angebot, Mahnung und Lieferschein und unter E-Mails an Kunden |
| Vorsitz des Aufsichtsrats | Nur, wenn die Gesellschaft einen Aufsichtsrat mit Vorsitz gebildet hat; sonst leer lassen |
| Kontenrahmen | SKR03 oder SKR04, siehe unten |
| Standard-Zahlungsziel in Tagen | Vorgabe für neue Rechnungen (0 bis 120 Tage) |
| Skonto | Vorgabe für neue Rechnungen, bis zu drei Stufen aus Satz und Frist in Tagen, z. B. 2 % in 10 Tagen; am Kunden und in der Rechnung änderbar (siehe [Skonto](rechnungen.md#skonto)) |
| Standardformat für Rechnungen | ZUGFeRD (PDF mit eingebettetem XML), XRechnung (CII) oder XRechnung (UBL). Vorgabe für neue Rechnungen |
| Standard-Einleitung für Rechnungen, für Angebote | Steht in neuen Rechnungen bzw. Angeboten als Einleitung über den Positionen, etwa eine Anrede oder „Für die erbrachten Leistungen berechne ich Ihnen:“. Im Beleg änderbar; bestehende Belege ändern sich nicht. Leer = keine Einleitung, höchstens 2000 Zeichen |
| Versteuerung | Ist oder Soll, siehe unten |
| Kleinunternehmer nach § 19 UStG | Haken setzen, wenn du die Kleinunternehmerregelung nutzt, siehe unten |

Fehlt einer GmbH oder UG etwas davon, zeigt das Formular im Abschnitt **Handelsregister und Geschäftsführung** „Für Rechnungen und Geschäftsbriefe fehlt noch (§ 35a GmbHG): …“, etwa „Geschäftsführer fehlt“ oder bei „E. Mustermann“ den fehlenden ausgeschriebenen Vornamen.

Die Umrechnung der Steuernummer prüft die Länge je Bundesland. Passt sie nicht, meldet Haben zum Beispiel „Steuernummer für Bayern muss 11 Ziffern haben“. Für Hessen setzt Haben die führende `0` der Finanzamtsnummer wie von ELSTER verlangt auf `6`.

Mehr zu den Pflichtangaben auf Rechnungen steht in [Rechnungen](rechnungen.md).

Unter dem Formular steht die Karte **Voranmeldung und EÜR aus dem Journal**. Sie zeigt das Stichjahr, ab dem Haben Voranmeldung und EÜR wie DATEV aus dem Journal rechnet, und ob das laufende Jahr noch aus Rechnungen, Belegen und Zahlungen rechnet. Liegt das Stichjahr nach dem laufenden Jahr, lässt es sich mit **Ab ‹Jahr› aus dem Journal** auf das laufende Jahr vorziehen, solange für das Jahr keine Voranmeldung gesendet ist und sich dadurch keine Zahl ändert; sonst nennt die Karte die Gründe. Zurück geht es nicht. Einzelheiten: [Wie die Kennzahlen entstehen](umsatzsteuer.md#wie-die-kennzahlen-entstehen).

### Zeichen in der Navigation

Unter **Einstellungen › Firma › Zeichen in der Navigation** wählst du, woran du die Firma oben links in der Navigation erkennst. Das hilft vor allem, wenn du [mehrere Firmen als eigene Instanzen](installation.md#mehrere-instanzen) führst.

- **„H“ in der Farbe des Themes:** wie ab Werk.
- **„H“ in eigener Farbe:** mit dem Farbfeld oder als Hex-Wert `#RRGGBB`. Die Schrift darauf ist weiß oder schwarz, je nachdem, was sich besser liest; so ist das „H“ in jeder Farbe lesbar (Kontrast mindestens 4,5 : 1 nach WCAG). Hebt sich eine sehr dunkle Farbe kaum von der Navigation ab, bekommt die Kachel eine feine helle Kante.
- **Logo aus der Beleggestaltung:** statt des „H“ steht das [Logo](#logo) der Belege auf weißer Fläche, in einem Quadrat so groß wie das „H“. Am besten wirkt ein quadratisches Bildzeichen; ein breiter Schriftzug wird darin klein. Das geht nur, wenn ein Logo hochgeladen ist, und es ändert sich mit diesem Logo. Wird es entfernt, zeigt die Navigation wieder die eigene Farbe bzw. das „H“ des Themes.

Das Zeichen gilt für alle Zugänge der Instanz, auch für die [Steuerberatung](steuerberatung.md), und hängt nicht an der Beleggestaltung: Ändern sich [Akzentfarbe](#akzentfarbe), Layout oder Logo-Einstellungen der Belege, bleibt die eigene Farbe, und Firmen mit gleich aussehenden Belegen haben trotzdem verschiedene Zeichen. Das Theme (Hell, Dunkel, Farbe der Oberfläche) wählt dagegen jeder Zugang für sich. Die Änderung steht im Änderungsprotokoll.

### Logo

Unter **Einstellungen › Beleggestaltung › Logo und Blatt** oder über das Zahnrad in der [Vorschau](rechnungen.md#vorschau) lädst du dein Logo hoch, als PNG (gern mit transparentem Hintergrund) oder JPEG bis 1 MB.

- Es steht oben im Briefkopf von Rechnungen, Angeboten und Mahnungen, ohne Verzerrung; Größe und Seite stellst du unter [Logo und Blatt](#logo-und-blatt) ein. Es wird sofort gespeichert.
- Die Vorschau im Rechnungs- und Angebotseditor zeigt es ebenfalls.
- Es gilt für alles, was ab dann festgeschrieben wird; schon festgeschriebene PDFs bleiben unverändert.
- Im Änderungsprotokoll steht, wann sich das Logo geändert hat, mit SHA-256, aber ohne die Bilddaten.

### Akzentfarbe

Unter **Einstellungen › Beleggestaltung › Akzentfarbe** stellst du die Farbe der Spaltenköpfe und Linien ein, etwa passend zu deinem Logo. Ab Werk ist es das Grün `#1F6F5C`.

- Text, Adressen, Beschriftungen, Positionen, dünne Linien und Fußzeile stehen in Grautönen, die Haben aus der Akzentfarbe ableitet: gleiche Helligkeit wie ab Werk, aber mit ihrem Farbton. Bei Blau sind sie leicht bläulich, bei einer grauen Akzentfarbe neutral grau; mit dem Standardgrün bleibt alles wie bisher.
- Du wählst sie mit dem Farbfeld oder trägst sie als Hex-Wert in der Form `#RRGGBB` ein; **Auf Standard zurücksetzen** stellt das Grün wieder her.
- Sie gilt für Rechnungen und Angebote, die ab dann festgeschrieben werden, und für die Vorschau im Editor; schon festgeschriebene PDFs bleiben unverändert.
- Eine Mahnung, Auftragsbestätigung oder ein Lieferschein zu einem älteren Beleg entsteht neu und bekommt deshalb die dann aktuelle Farbe und das aktuelle Logo.
- Ist die Farbe auf weißem Papier schwer zu lesen (Kontrast unter 4,5 : 1 nach WCAG), weist Haben darauf hin. Speichern geht trotzdem; eine dunklere Variante des Logo-Farbtons liest sich besser.
- Die Änderung steht im Änderungsprotokoll.

### Logo und Blatt

Unter **Einstellungen › Beleggestaltung › Logo und Blatt** oder über das Zahnrad in der [Vorschau](rechnungen.md#vorschau) legst du fest, wie das Blatt aussieht. Es gilt für alles, was ab dann erzeugt wird, auch für Mahnung, Auftragsbestätigung und Lieferschein zu älteren Belegen; schon festgeschriebene PDFs bleiben unverändert.

| Einstellung | Bedeutung |
| --- | --- |
| Schrift | IBM Plex Sans (ab Werk), IBM Plex Serif, Source Sans 3, Figtree, Fira Sans, Inter, Libre Franklin, Literata, Lora oder Nunito Sans; im PDF eingebettet, wie PDF/A es verlangt |
| Logo S, M, L | Höchstens 12 × 40 mm, 18 × 60 mm (ab Werk) oder 24 × 80 mm; auch L endet über dem Anschriftfeld |
| Logo links, rechts | Seite im Briefkopf |
| Falz- und Lochmarken | Striche am linken Rand für den Fensterumschlag nach DIN 5008 |
| GiroCode | QR-Code für die Überweisung, auf Rechnung und Mahnung |
| Kundennummer | Nur auf dem Blatt; das XML der E-Rechnung nennt sie weiter |
| Artikelnummer | Spalte „Art.-Nr.“, sobald eine Position eine Nummer hat; nur auf dem Blatt, das XML der E-Rechnung nennt sie weiter |
| Spalte USt je Position | Entfällt nur, wenn alle Positionen denselben Steuersatz haben; bei mehreren Sätzen bleibt sie stehen |

Pflichtangaben und Summen lassen sich hier nicht ausblenden; zur Fußzeile auf dem Briefpapier siehe [Briefpapier](#briefpapier).

### Briefpapier

Unter **Einstellungen › Beleggestaltung › Briefpapier** legst du ein Bild hinter den Beleg, etwa deinen gedruckten Briefbogen als Scan.

- Es geht PNG, JPEG oder PDF bis 2 MB, am besten im Format A4 hochkant mit mindestens 1240 × 1754 Pixeln. Ein abweichendes Seitenverhältnis wird beschnitten, damit die Seite voll bedeckt ist.
- Von einem PDF nimmt Haben die erste Seite und wandelt sie mit 200 dpi in ein Bild um, denn die Belege sind PDF/A-3 und können kein PDF einbetten. Beschädigte Dateien und Bilder im Farbraum CMYK lehnt Haben ab, weil sich aus ihnen kein PDF/A erzeugen lässt; speichere sie als RGB.
- **Erste Seite** (ab Werk) oder **Alle Seiten** legt fest, wo es erscheint. Die Vorschau zeigt es genauso, auf jeder Seite des Belegs.
- Logo und Falzmarken liegen über dem Bild. Hat dein Briefbogen schon ein Logo, entferne das hochgeladene.
- Trägt dein Briefbogen auch den Fuß, schalte **Fußzeile steht auf dem Briefpapier** ein. Haben fragt nach, denn dann druckt es nur noch die Seitenzahl: Steuernummer oder USt-IdNr. muss auf dem Briefpapier stehen (§ 14 Abs. 4 Nr. 2 UStG), bei Reverse Charge und innergemeinschaftlicher Lieferung die USt-IdNr. (§ 14a UStG), bei GmbH und UG auch die Angaben nach § 35a GmbHG. Prüfen kann Haben das im Bild nicht. Entfernst du das Briefpapier, druckt Haben die Fußzeile wieder.
- Jedes neu erzeugte PDF enthält das Bild, schon festgeschriebene PDFs bleiben unverändert. Im Änderungsprotokoll steht, wann es sich geändert hat, mit SHA-256, aber ohne die Bilddaten.

### Fußzeile

Unter **Einstellungen › Beleggestaltung › Fußzeile** schaltest du von der automatischen Fußzeile auf eigene Spalten um. Ab Werk setzt Haben sie aus den Firmendaten zusammen: Kontakt, Bank, Steuernummern.

- Du wählst zwei bis vier Spalten mit je höchstens fünf Zeilen und schreibst freien Text mit Platzhaltern: `{firma}`, `{strasse}`, `{plz}`, `{ort}`, `{email}`, `{telefon}`, `{bank}`, `{kontoinhaber}`, `{iban}`, `{bic}`, `{steuernummer}`, `{ustid}`. Unten in der Karte siehst du, wie sie auf dem Blatt steht.
- Text lässt sich auszeichnen wie in den Belegtexten: markieren und **F**, **K** oder **U** wählen, oder die Zeichen tippen (`*fett*`, `_kursiv_`, `__unterstrichen__`). Das gilt für deinen Text, auch um Platzhalter herum; Zeichen aus den Firmendaten bleiben wörtlich.
- Fehlt der Wert zu einem Platzhalter, entfällt die ganze Zeile: Ohne Telefonnummer erscheint keine Zeile „Telefon“.
- Steuernummer oder USt-IdNr. muss auf der Rechnung stehen (§ 14 Abs. 4 Nr. 2 UStG). Haben speichert die Fußzeile nur, wenn `{steuernummer}` oder `{ustid}` vorkommt. Die Pflichtangaben einer GmbH oder UG stehen weiter darunter.
- Hat deine Firma die genannte Nummer nicht, setzt Haben die vorhandene ans Ende der letzten Spalte. Bei Reverse Charge und innergemeinschaftlicher Lieferung steht die USt-IdNr. immer auf der Rechnung (§ 14a UStG).
- Bricht eine Zeile um oder sind die Spalten hoch, wächst der untere Rand mit; es steht dann weniger Inhalt auf der Seite.
- Dein Text wird nicht übersetzt: Auf englischen Belegen steht er so, wie du ihn schreibst.
- Sie gilt wie die übrige Gestaltung für alles, was ab dann erzeugt wird.

### Layouts

Unter **Einstellungen › Beleggestaltung › Layouts** wählst du je Belegart ein Layout: das eingebaute „Klassisch“ oder ein eigenes, das du hochgeladen hast. Wie man ein Layout schreibt, was Haben beim Hochladen prüft und wie Pakete freigegeben werden, steht unter [Eigene Belegvorlagen](belegvorlagen.md).

Verwendet ein eigenes Layout eine Einstellung der Gestaltung nicht, etwa den GiroCode oder die Falz- und Lochmarken, steht darunter ein Hinweis mit dem Namen des Layouts. Wirkt die Einstellung auf keinen Beleg mehr, ist sie aus; siehe [Einstellungen, die das Layout nicht verwendet](belegvorlagen.md#hochladen-und-zuordnen).

## Persönliche Angaben

Unter **Einstellungen › Persönliche Angaben** stehen die Angaben zu dir als Person, die ELSTER für manche Vorgänge braucht: Anrede, steuerliche Identifikationsnummer (Steuer-ID), Vor- und Nachname, Geburtsdatum, Religion und ausgeübter Beruf. Bei der Zusammenveranlagung kommen das Heiratsdatum und dieselben Angaben zum Ehegatten dazu.

Gebraucht werden sie für [Bankverbindung ändern](finanzamt.md#bankverbindung-ändern) und die Einkommensteuererklärung. Bei GmbH und UG fehlen Veranlagung und Ehegatte; die Angaben zur Person braucht ELSTER dort für Nachrichten, Postfach und Bankverbindung. Haben prüft die Prüfziffer der Steuer-ID. Die Religion bestimmt, ob Kirchensteuer anfällt; Haben nutzt die Religionsschlüssel von ELSTER. Änderungen landen wie die Firmendaten im Audit-Log.

## Rechtsform: Einzelunternehmen, GmbH oder UG

Die Rechtsform bestimmt, wohin Geld zwischen dem Unternehmen und dir gebucht wird und welche Erklärungen Haben anbietet.

| | Einzelunternehmen | GmbH, UG (haftungsbeschränkt) |
| --- | --- | --- |
| Geld vom und an den Inhaber | Privateinlage und Privatentnahme | Gesellschafter-Verrechnungskonto: SKR03 0730, SKR04 3510 „Verbindlichkeiten gegenüber Gesellschaftern“, für beide Richtungen |
| Beleg aus eigenem Geld bezahlt | „Privat bezahlt (Privateinlage)“ | „Vom Gesellschafter ausgelegt (Verrechnungskonto)“ |
| Bank ohne Rechnung oder Beleg | „Privat (Entnahme oder Einlage)“ | „Gesellschafter (Verrechnungskonto)“ |
| Kasse | „Einlage“ und „Entnahme“ | „Vom Gesellschafter“ und „An den Gesellschafter“ |
| Privatanteile, Kfz-Privatnutzung, [Pauschalen](pauschalen.md) | ja | nein |
| Anlage EÜR, Einkommensteuer, [Belege von ELSTER](jahreserklaerung.md#belege-von-elster), [Herabsetzung der Einkommensteuer-Vorauszahlungen](finanzamt.md#vorauszahlungen-herabsetzen) | ja | nein |
| [Gesellschafter-Geschäftsführer](lohn.md#was-haben-abrechnet) im Lohn | nein | ja |
| Voranmeldung, Umsatzsteuererklärung, DATEV-Export | ja | ja |
| [Manuelle und freie Buchungen](buchhaltung.md#manuelle-und-freie-buchungen) | ab dem Stichjahr | ja |
| [Saldenvortrag, Eröffnungsbuchung](buchhaltung.md#saldenvortrag-und-eröffnung-gmbh-und-ug) | nein, jedes Jahr beginnt bei null | ja |
| [Jahresabschluss](buchhaltung.md#jahresabschluss-gmbh-und-ug): Bilanz und GuV (Entwurf), Jahr abschließen | nein | ja |
| [Körperschaft- und Gewerbesteuer](buchhaltung.md#körperschaft--und-gewerbesteuer-gmbh-und-ug) rechnen, Rückstellungen buchen | nein | ja |
| [Körperschaft- und Gewerbesteuererklärung](jahreserklaerung.md#körperschaft--und-gewerbesteuererklärung-gmbh-und-ug) an das Finanzamt | nein | ja |
| [E-Bilanz](buchhaltung.md#e-bilanz-gmbh-und-ug) an das Finanzamt | nein | ja |
| [Gewinnausschüttung](buchhaltung.md#gewinnausschüttung-gmbh-und-ug) mit Kapitalertragsteuer-Anmeldung | nein | ja |

Eine Kapitalgesellschaft hat kein Privat. Was der Gesellschafter für sie auslegt oder von ihr bekommt, ist eine Verbindlichkeit bzw. Forderung ihm gegenüber; das Verrechnungskonto zeigt den Stand. Ein Privatanteil wäre bei einer GmbH Arbeitslohn oder eine verdeckte Gewinnausschüttung, die Privatnutzung eines Firmenwagens ein Sachbezug in der Lohnabrechnung. Beides bucht Haben deshalb nicht; die Pauschalen ersetzen Ausgaben eines Einzelunternehmers. Erstattet die GmbH dir Reisekosten, lädst du die Abrechnung als Beleg hoch und wählst „Vom Gesellschafter ausgelegt“.

Bilanz und GuV zeigt Haben als Entwurf für die Steuerberatung, rechnet Körperschaft- und Gewerbesteuer samt Rückstellungen und sendet die [E-Bilanz](buchhaltung.md#e-bilanz-gmbh-und-ug) und die [Erklärungen](jahreserklaerung.md#körperschaft--und-gewerbesteuererklärung-gmbh-und-ug) für eine GmbH ohne Beteiligungen, Organschaft und Ausschüttungen. Die laufende Buchhaltung mit Rechnungen, Belegen, Bank und Umsatzsteuer machst du in Haben und gibst den [DATEV-Export](auswertungen.md) an die Steuerberatung. Der Weg zum Abschluss steht in [Issue #213](https://github.com/firsttris/haben/issues/213).

Den Ablauf eines Jahres für eine GmbH oder UG zeigt [GmbH und UG](gmbh.md).

> [!WARNING]
> **Nur das Kalenderjahr als Wirtschaftsjahr:** Haben rechnet jedes Geschäftsjahr vom 1. Januar bis 31. Dezember. Ein abweichendes Wirtschaftsjahr unterstützt Haben nicht. Das betrifft eine GmbH, UG oder einen im Handelsregister eingetragenen Gewerbetreibenden, die mit dem Finanzamt einen anderen Abschlussstichtag vereinbart haben (§ 4a Abs. 1 Satz 2 Nr. 2 EStG, § 7 Abs. 4 KStG), und das Wirtschaftsjahr von Land- und Forstwirten (Nr. 1). In diesen Fällen wären [Jahresabschluss](buchhaltung.md#jahresabschluss-gmbh-und-ug), [Hinterlegung](buchhaltung.md#hinterlegung-beim-unternehmensregister-gmbh-und-ug), [E-Bilanz](buchhaltung.md#e-bilanz-gmbh-und-ug), Körperschaft- und Gewerbesteuer und der [DATEV-Export](auswertungen.md) falsch. Freiberufler und nicht eingetragene Gewerbetreibende rechnen ohnehin im Kalenderjahr (§ 4a Abs. 1 Satz 1 und Satz 2 Nr. 3 EStG). Für die Umsatzsteuer gilt immer das Kalenderjahr (§ 16 Abs. 1 Satz 2 UStG).

Die Rechtsform lässt sich nur vor der ersten Buchung festlegen. Danach sperren App und Datenbank die Änderung, auch über Jahre hinweg: Privatkonten und Gesellschafter-Verrechnungskonto gehören nicht in dieselben Bücher, und eine neue Rechtsform ist ein neues Unternehmen mit eigener Buchhaltung.

> [!IMPORTANT]
> Das Gesellschafter-Verrechnungskonto ist das Sammelkonto „Verbindlichkeiten gegenüber Gesellschaftern“ aus dem DATEV-Kontenrahmen. Im Abschluss steht sein Saldo je nach Seite unter den Verbindlichkeiten oder Forderungen, jeweils mit dem Vermerk „gegenüber Gesellschaftern“ (§ 42 Abs. 3 GmbHG); welcher Teil länger als ein Jahr läuft, bestätigst du beim [Jahresabschluss](buchhaltung.md#vermerke-unter-der-bilanz). Stimme die Konten vor dem Echtbetrieb mit der Steuerberatung ab.

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
| Basiszinssatz in % | Grundlage der Verzugszinsen. Er ändert sich zum 1. Januar und 1. Juli und wird von der Deutschen Bundesbank veröffentlicht. **Bei der Bundesbank abrufen** fragt den aktuellen Satz im [SDMX-Webservice der Bundesbank](https://statistiken.bundesbank.de/statistiken-de/hilfe-970224?article=bundesbank-sdmx-web-service-api-991208) ab (Zeitreihe BBIN1.M.DE.BBK.BBKBAS2.EUR.ME) und trägt ihn ins Feld ein; er gilt erst nach dem Speichern. Steht der neue Satz Anfang Januar oder Juli noch nicht in der Zeitreihe, sagt Haben das; dann später erneut abrufen oder von Hand eintragen. Leer heißt: keine Verzugszinsen. |
| Basiszinssatz automatisch abrufen | Aus, bis du den Haken setzt. Dann fragt Haben die Bundesbank nach dem 1. Januar und 1. Juli einmal am Tag, bis der Satz des neuen Halbjahrs in der Zeitreihe steht, und trägt ihn ein; dazwischen fragt Haben nicht, weil sich der Satz nur zu diesen Terminen ändert (§ 247 Abs. 1 BGB). Änderst du den Satz von Hand, prüft der nächste Lauf ihn einmal gegen die Bundesbank und ersetzt ihn durch den veröffentlichten Wert. |
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

Der erste gespeicherte Kleinunternehmerstatus gilt auch für die Zeit vor der Einrichtung. Andere Einstellungen ändern diesen Stand nicht. Wer die Vorgaben vorher schon für Buchungen, festgeschriebene Belege oder gesendete Anmeldungen verwendet hat, behält den damaligen Stand; bewusst gespeicherte Regelbesteuerung und spätere Wechsel bleiben erhalten.

Ins Vorjahr buchen geht nach einem Wechsel nur noch, wo es nicht von der Einstellung abhängt:

- **Kontenrahmen:** In ein Jahr, das im alten Kontenrahmen gebucht ist, bucht Haben nichts mehr, auch keine Gegenbuchung beim Aufheben einer Zuordnung. Ordne Zahlungen des Vorjahres also vor dem Wechsel richtig zu.
- **Versteuerung:** Eine Rechnung mit Datum im Vorjahr lässt sich nicht mehr festschreiben; ihre Umsatzsteuer stünde sonst doppelt (Soll → Ist) oder gar nicht (Ist → Soll) in den Voranmeldungen. Schreibe Entwürfe des Vorjahres vor dem Wechsel fest oder gib ihnen ein Datum im neuen Jahr.

Kläre einen Wechsel vorher mit deiner Steuerberatung.

Lehnt die Datenbank eine Umstellung ab, weil gleichzeitig gebucht wurde, siehst du ihre Begründung statt „Interner Fehler“.

## Rechnungsnummern

Rechnungsnummern haben ab Werk die Form `JAHR-NNN`, zum Beispiel `2026-034`; das Format lässt sich ändern (siehe unten). Der Zähler beginnt ab Werk jedes Jahr bei 1 oder läuft auf Wunsch weiter (siehe [Zähler](#zähler)); das Jahr kommt aus dem Rechnungsdatum. Eine Nummer vergibt Haben erst beim Festschreiben, in derselben Transaktion wie PDF, XML und Buchung. Schlägt dabei etwas fehl, wird keine Nummer verbraucht. Entwürfe haben noch keine Nummer, deshalb entstehen keine Lücken.

Lückenlos und fortlaufend sollen die Nummern sein, damit das Finanzamt bei einer Prüfung sieht, dass keine Rechnung fehlt.

Unter **Einstellungen › Rechnungen › Rechnungsnummern** siehst du die nächste Nummer des laufenden Jahres, bei durchlaufendem Zähler die nächste überhaupt; **Angebotsnummern** darunter dasselbe für Angebote. Kommst du aus Lexoffice oder sevDesk, trägst du dort die nächste laufende Nummer ein (z. B. `35`, wenn die letzte Rechnung `2026-034` war). Der Wert muss größer sein als die zuletzt vergebene Nummer; zurücksetzen geht nicht. Die letzte Lexoffice-Nummer zeigt dir auch der Abgleich in [Umzug aus Lexoffice](lexoffice.md).

### Nummernformat

Unter **Einstellungen › Rechnungen › Nummernformat** legst du fest, wie Rechnungs- und Angebotsnummern aufgebaut sind, etwa mit eigenem Präfix. Ab Werk sind es `{JJJJ}-{NNN}` (`2026-034`) und `AN-{JJJJ}-{NNN}` (`AN-2026-007`).

| Platzhalter | Wird zu |
| --- | --- |
| `{JJJJ}` | Jahr des Rechnungs- bzw. Angebotsdatums, z. B. `2026` |
| `{JJ}` | dasselbe zweistellig, z. B. `26` |
| `{MM}` | Monat des Rechnungs- bzw. Angebotsdatums zweistellig, z. B. `10` |
| `{N}` bis `{NNNNNN}` | laufende Nummer mit mindestens so vielen Stellen, vorne mit Nullen aufgefüllt; mehr Stellen werden nie abgeschnitten |

Beispiele: `RE-{JJJJ}-{NNNN}` ergibt `RE-2026-0034`, `R{JJ}{NNN}` ergibt `R26034`, `RE-{JJJJ}-{MM}-{NNNN}` ergibt `RE-2026-10-0034`.

- Jahr und Monat kommen aus dem Rechnungs- bzw. Angebotsdatum, nicht aus dem Tag des Festschreibens: Eine Rechnung vom 31. Oktober, die du am 2. November festschreibst, heißt `RE-2026-10-…`. Die Überschrift im Editor zeigt die voraussichtliche Nummer schon so.
- Die laufende Nummer muss genau einmal vorkommen. Beginnt der Zähler jedes Jahr neu, gehört auch das Jahr dazu, erst damit bleibt jede Nummer eindeutig (§ 14 Abs. 4 Nr. 4 UStG); der Monat allein reicht nicht.
- Außerhalb der Platzhalter gehen Buchstaben, Ziffern, Bindestrich, Unterstrich und Punkt, insgesamt höchstens 30 Zeichen. Leerzeichen und Schrägstrich gehen nicht, weil die Nummer auch im Dateinamen und im Verwendungszweck steht.
- Unter dem Feld steht ein Beispiel oder, was am Format nicht passt.

#### Zähler

Neben jedem Format wählst du für Rechnungen und Angebote getrennt, wie der Zähler läuft:

| Zähler | Verhalten |
| --- | --- |
| beginnt jedes Jahr neu (ab Werk) | Im Januar wieder bei 1: `RE-2026-0412`, dann `RE-2027-0001`. Das Jahr muss im Format stehen. |
| läuft weiter | Über den Jahreswechsel hinweg: `RE-2026-12-0412`, dann `RE-2027-01-0413`. Das Jahr im Format ist frei, `RE-{NNNN}` geht auch. |

Beides ist zulässig; eine Rechnungsnummer muss nur einmalig sein (UStAE 14.5 Abs. 10). Schaltest du auf **läuft weiter**, zählt Haben hinter der letzten Nummer des jüngsten Jahres weiter; die nächste Nummer kannst du danach unter **Rechnungsnummern** bzw. **Angebotsnummern** setzen, etwa auf die nächste aus sevDesk. Zurück auf **beginnt jedes Jahr neu** geht nur mit dem Jahr im Format; der Zähler des Jahres steht dann, wo er vor dem Umschalten stand. Ergibt das eine schon vergebene Nummer, meldet Haben sie wie bei einem Formatwechsel (unten). Storno und Korrektur zählen im selben Kreis wie Rechnungen.
- Das Format gilt für alles, was ab dann festgeschrieben wird; schon vergebene Nummern bleiben, wie sie sind. Der Zähler läuft beim Wechsel weiter.
- Ergibt das neue Format eine Nummer, die es schon gibt, schreibt Haben nicht fest, sondern meldet „Die Nummer … ist schon vergeben“; der Zähler bleibt stehen. Das passiert nur bei sehr ähnlichen Formaten.
- Der Bankabgleich findet die Nummer im Verwendungszweck in jedem Format.
- Die Änderung steht wie die übrigen Firmendaten im Änderungsprotokoll.

### Vorlagen für den Zahlungsplan

Unter **Einstellungen › Rechnungen › Vorlagen für den Zahlungsplan** legst du Zahlungspläne an, die du in Angeboten oft brauchst. Ab Werk gibt es **30/40/30** (Anzahlung 30 % bei Auftragserteilung, Abschlag 40 % bei Lieferung, Rest mit der Schlussrechnung bei Abnahme) und **50/50**.

- Jede Vorlage hat einen Namen und Zahlungen mit Bezeichnung, Anteil (Prozent oder fester Betrag) und Fälligkeit als Text. Die letzte Zahlung ist immer der Rest.
- Im Angebot übernimmt **Vorlage übernehmen** eine Kopie; du passt sie dort an. Spätere Änderungen an der Vorlage ändern kein Angebot.
- Die Änderung steht wie die übrigen Firmendaten im Änderungsprotokoll.

Wie der Plan im Angebot wirkt, steht unter [Zahlungsplan](angebote.md#zahlungsplan).

### Standardanhänge für Angebote

Unter **Einstellungen › Rechnungen › Standardanhänge für Angebote** hinterlegst du einmal PDF-Dateien, die mit fast jedem Angebot mitgehen, etwa AGB oder eine Widerrufsbelehrung. Es gelten dieselben Regeln wie für [Anhänge am Angebot](angebote.md#anhänge): nur PDF, bis 20 MB, höchstens zehn.

- Jedes **neue Angebot** bekommt sie beim ersten Speichern als Anhänge. Beim Versand sind sie vorausgewählt; im Entwurf nimmst du einen mit **Entfernen** nach einer Rückfrage heraus, wenn er für dieses Angebot nicht passt.
- Mit dem Festschreiben sind sie wie alle Anhänge mit dem Angebot gesperrt. So bleibt nachvollziehbar, welche Fassung der AGB mit welchem Angebot ging.
- Änderst du die Standardanhänge später, etwa mit neuen AGB, bekommen erst die danach angelegten Angebote die neue Fassung; bestehende Angebote und Entwürfe bleiben, wie sie sind. **Kopieren** übernimmt die Anhänge des kopierten Angebots, nicht die aktuellen Standardanhänge.
- Jede Änderung steht im Änderungsprotokoll.

### Kundennummern

Unter **Einstellungen › Rechnungen › Kundennummern** legst du ein Format fest, mit dem Haben beim Anlegen eines Kunden ohne eigene Nummer die nächste Kundennummer vergibt (reine Lieferanten bekommen keine), etwa `K-{NNNN}` → `K-0001`.

- Platzhalter wie beim [Nummernformat](#nummernformat); das Jahr ist hier nicht nötig.
- **Nächste laufende Nummer** setzt den Zähler (mindestens 1). Nummern, die ein Kontakt schon trägt (von Hand oder aus einem Import), überspringt Haben; lückenlos müssen Kundennummern nicht sein.
- Bleibt das Format leer, trägst du Kundennummern von Hand ein.
- Das gilt auch für Kontakte, die über die [REST-API](api.md) angelegt werden.

## ELSTER einrichten

Haben übermittelt Voranmeldung, Jahreserklärungen und Nachrichten über ERiC, die offizielle Bibliothek der Steuerverwaltung, und holt darüber Bescheide aus dem ELSTER-Postfach. Ohne ERiC laufen Prüfen und Senden simuliert, und die Oberfläche weist darauf hin. Welcher Weg zum Finanzamt ohne Hersteller-ID bleibt, steht in [Abgabe an ELSTER](elster-abgabe.md).

### Was du brauchst

| | Wofür | Woher | Dauer |
| --- | --- | --- | --- |
| **ERiC** | Bibliothek der Finanzverwaltung: prüft, verschlüsselt und überträgt | Haben lädt sie selbst, siehe [Schritte](#schritte) | Minuten |
| **Hersteller-ID** (fünf Ziffern) | Kennung der Software in jeder Übermittlung; ERiC verlangt sie seit Version 43 schon fürs Prüfen | ELSTER-Entwicklerbereich: auf elster.de als Entwickler registrieren, das Bayerische Landesamt für Steuern prüft den Antrag | Tage bis Wochen |
| **Zertifikatsdatei** (.pfx) und PIN | unterschreibt jede Übermittlung | ELSTER-Benutzerkonto mit der Anmeldeart „Zertifikatsdatei“, siehe [unten](#zertifikatsdatei-statt-elster-secure) | ein bis zwei Wochen (Brief) |

Bis Hersteller-ID und Zertifikat da sind, arbeitest du normal: Belege, Rechnungen, Bank, Auswertungen, Voranmeldung und Jahreserklärungen rechnet Haben vollständig, Prüfen und Senden laufen simuliert. Abgeben kannst du in der Zwischenzeit in Mein ELSTER: die Voranmeldung per XML-Import, alle Formulare mit der Erweiterung „Haben für Mein ELSTER“, mit einem KI-Assistenten oder von Hand. Die Wege im Vergleich: [Abgabe an ELSTER](elster-abgabe.md).

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
9. **Echtübermittlung.** Ohne Haken fragt Haben in einem Dialog nach („Verbindlich senden“). Nach erfolgreicher Übermittlung ist die Voranmeldung festgeschrieben; eine Korrektur ist eine neue, berichtigte Anmeldung.

Die PIN fragt Haben bei jeder Übermittlung ab. Nur für den automatischen Postfach-Abruf kannst du sie verschlüsselt speichern, siehe [Finanzamt](finanzamt.md#automatisch-abrufen). Für den Versand legt Haben das entschlüsselte Zertifikat kurz in ein temporäres Verzeichnis (Rechte `0600`) und löscht es danach. Jede Prüfung und Übermittlung landet mit Transfer-Ticket und ERiC-Protokoll-PDF im Verlauf der Voranmeldung.

Vor dem Senden prüft Haben die Firmendaten: Name, Anschrift, Bundesland und eine gültige Steuernummer müssen vorhanden sein.

> [!IMPORTANT]
> Die ERiC-Anbindung ist mit ERiC 44.3.6.0, 45.1.5.0 und 43.4.6.0 geprüft: Funktionssignaturen und Strukturen gegen die mitgelieferten Header, alle Nachrichten lokal gegen ERiCs Schemas und Plausibilitätsprüfungen, Zertifikat und PIN mit dem Testzertifikat aus dem ERiC-Paket. Die Übertragung an den ELSTER-Server lässt sich nur mit eigener Hersteller-ID testen; das ist deine erste Testübermittlung. ERiC-Updates spielst du erst ein, wenn eine Testübermittlung damit geklappt hat.

### Welche ERiC-Version

Haben lädt vorgeschlagen ERiC 44.3.6.0, die neueste für Echtfälle freigegebene Version. Haben arbeitet mit ERiC 43 bis 45 und erkennt die Version selbst; eine andere trägst du ins Feld **Version** ein.

ERiC 45.1.5.0 ist ein BETA-Release: Damit gehen nur Testübermittlungen mit Testmerker, Echtfälle lehnt ERiC ab (ERiC-Entwicklerhandbuch, Kap. 5.4.3). Nimm sie nur zum Ausprobieren der Formulare 2027. Das Hauptrelease 45.2 kündigt ELSTER für Mitte November an (Kap. 2.3); es bringt die Jahresversionen unten für Echtfälle, und dann hebt Haben den Vorschlag darauf.

| Was | ab ERiC |
| --- | --- |
| Voranmeldung, Dauerfristverlängerung und Sondervorauszahlung 2027, Kapitalertragsteuer-Anmeldung 2027, Anlage EÜR und Einkommensteuer 2026 | 45 |
| Sonstige Nachricht als Echtfall (Version 22) | 43.5 |
| E-Bilanz ohne rechtsformfremde Angaben | jede; ERiC prüft das ab 43.5 |
| Postfach und Belegabruf (Datenabholung Version 32) | 43.4 |

Mit dem Mindestversionswechsel im April sperrt ELSTER die Versionen 43 und 44 für den Versand (ERiC-Entwicklerhandbuch, Kap. 2.3); bis dahin brauchst du die 45.

Wie du Voranmeldungen erstellst und was die Vorprüfung meldet, steht in [Umsatzsteuer](umsatzsteuer.md). Gibst du nicht monatlich ab, stellst du dort den [Voranmeldungszeitraum](umsatzsteuer.md#voranmeldungszeitraum) ein: vierteljährlich oder keine Voranmeldung, so wie es das Finanzamt festgelegt hat.

## E-Mail

Für [Rechnungen, Angebote und Mahnungen per E-Mail](rechnungen.md#per-e-mail-versenden) und [Erinnerungen an Fristen](fristen.md#erinnerungen-per-e-mail) braucht Haben einen E-Mail-Zugang über SMTP oder, für Postfächer in Microsoft 365, über [Microsoft Graph](#e-mail-über-microsoft-365). Unter **Einstellungen › E-Mail › E-Mail-Versand** den Anbieter wählen (Gmail, GMX, web.de, Posteo, mailbox.org belegen Server, Port und Verschlüsselung vor) oder einen eigenen Server eintragen, dazu Benutzername, Passwort, Absender und den Empfänger der Erinnerungen. Der **Absendername** steht beim Empfänger vor der Adresse; bleibt er leer, nimmt Haben den Firmennamen aus den Firmendaten, ohne Firmennamen „Haben“. **Test-Mail senden** prüft den Zugang. Solange „Prüfwert des Änderungsprotokolls wöchentlich mailen“ eingeschaltet ist, kommt an dieselbe Adresse einmal pro Woche der aktuelle Prüfwert, wenn sich etwas geändert hat. Bewahre diese Mails auf: Mit ihnen lässt sich später zeigen, dass das Protokoll bis dahin nicht nachträglich verändert wurde (siehe [Buchhaltung in Haben](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel)).

- **Gmail:** Zwei-Faktor-Anmeldung einschalten und unter myaccount.google.com › Sicherheit › App-Passwörter ein App-Passwort erzeugen; das ist das Passwort für Haben, Benutzername ist die Gmail-Adresse. Eine eigene Gmail-Anbindung über die Google-API braucht es nicht.
- **GMX und web.de:** im Postfach unter Einstellungen › POP3/IMAP den Zugriff per externem Programm erlauben.

Unter **Vorlagen** legst du Betreff und Text der E-Mails je Art und Sprache fest (siehe [Per E-Mail versenden](rechnungen.md#per-e-mail-versenden)).

Das Passwort speichert Haben AES-256-GCM-verschlüsselt wie das ELSTER-Zertifikat; es steht nicht im Audit-Log und wird nie angezeigt. Zum Ändern anderer Angaben das Passwortfeld leer lassen.

### E-Mail über Microsoft 365

Microsoft schaltet Basic Auth für SMTP AUTH in Exchange Online ab. Für Postfächer in Microsoft 365 verschickt Haben deshalb auch über **Microsoft Graph**. Haben meldet sich dabei als App ohne Benutzer bei Microsoft Entra ID an (Client Credentials) und sendet mit `POST /users/{Postfach}/sendMail`. Das geht aus einem Benutzerpostfach und aus einer **Shared Mailbox**; die Mail steht danach in „Gesendete Elemente“ dieses Postfachs. SMTP bleibt unverändert, der Versandweg ist unter **Einstellungen › E-Mail › E-Mail-Versand** wählbar. Für die Einrichtung brauchst du Administratorrechte im Tenant (Entra ID und Exchange Online).

> [!WARNING]
> Die Berechtigung `Mail.Send` (Application) mit Administratorzustimmung erlaubt der App, **als jedes Postfach des Tenants** zu senden. Beschränke sie auf die Postfächer, aus denen Haben senden soll (Schritt 5).

**1. App registrieren.** Im Entra-Admin-Center unter **Anwendungen › App-Registrierungen › Neue Registrierung** einen Namen wählen (etwa „Haben Mailversand“), Konten nur in diesem Verzeichnis, keine Umleitungs-URI. Auf der Übersicht stehen **Anwendungs-ID (Client)** und **Verzeichnis-ID (Mandant)**; beide trägst du in Haben ein.

**2. Zertifikat erzeugen und hochladen (empfohlen).** Ein Zertifikat ersetzt das Secret, das nach höchstens 24 Monaten abläuft. Auf einem beliebigen Rechner:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout haben-mail.key -out haben-mail.crt -days 730 -subj "/CN=Haben Mailversand"
```

`haben-mail.crt` lädst du in der App-Registrierung unter **Zertifikate & Geheimnisse › Zertifikate** hoch. In Haben wählst du **Zertifikat** als Anmeldung und gibst beide Dateien an (`.crt` und `.key`, ohne Passwort). Haben prüft, dass Schlüssel und Zertifikat zusammengehören und das Zertifikat nicht abgelaufen ist, speichert den privaten Schlüssel AES-256-GCM-verschlüsselt und zeigt danach nur noch den Fingerabdruck. Lösche `haben-mail.key` anschließend vom Rechner. Das Zertifikat läuft nach 730 Tagen ab; Haben erinnert nicht daran, trage den Termin in deinen Kalender ein.

*Alternative Client Secret:* unter **Zertifikate & Geheimnisse › Geheimnisse › Neues Clientgeheimnis** erzeugen, den **Wert** (nicht die ID) sofort kopieren und in Haben unter **Client Secret** eintragen.

**3. Berechtigung vergeben.** Es gibt zwei Wege:

- **Eingeschränkt (empfohlen):** Die Rechte kommen aus **Exchange Online** (RBAC für Anwendungen), die App bekommt in Entra ID **keine** Graph-Berechtigung. Weiter mit Schritt 4 und 5.
- **Tenantweit (schnell, nicht empfohlen):** In der App-Registrierung unter **API-Berechtigungen › Berechtigung hinzufügen › Microsoft Graph › Anwendungsberechtigungen** `Mail.Send` wählen und **Administratorzustimmung erteilen**. Danach darf die App aus jedem Postfach senden. Eine Einschränkung nach Schritt 5 wirkt dann **nicht**, weil Microsoft die Rechte aus Entra ID und aus Exchange vereinigt.

**4. Dienstprinzipal in Exchange Online anlegen.** In PowerShell mit dem Modul `ExchangeOnlineManagement` als Administrator:

```powershell
Connect-ExchangeOnline
# AppId = Anwendungs-ID (Client). ObjectId = Objekt-ID der *Unternehmensanwendung* (Entra ID › Unternehmensanwendungen),
# nicht die Objekt-ID der App-Registrierung: Beide Seiten zeigen verschiedene Werte.
New-ServicePrincipal -AppId <Anwendungs-ID> -ObjectId <Objekt-ID der Unternehmensanwendung> -DisplayName "Haben Mailversand"
```

**5. Auf bestimmte Postfächer beschränken.** Ein Verwaltungsbereich nennt die erlaubten Postfächer, die Rollenzuweisung gibt der App `Mail.Send` nur dafür:

```powershell
New-ManagementScope -Name "Haben Postfächer" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'rechnung@firma.example'"
New-ManagementRoleAssignment -App <Objekt-ID der Unternehmensanwendung> -Role "Application Mail.Send" -CustomResourceScope "Haben Postfächer"
Test-ServicePrincipalAuthorization -Identity <Objekt-ID der Unternehmensanwendung> -Resource rechnung@firma.example
```

Mehrere Postfächer verbindest du im Filter mit `-or`; statt eines Filters geht auch eine Administrative Unit (`-RecipientAdministrativeUnitScope`). `InScope` muss bei `Test-ServicePrincipalAuthorization` für das Postfach `True` sein und für ein anderes `False`. Änderungen wirken laut Microsoft nach 30 Minuten bis 2 Stunden; der Testbefehl umgeht diesen Zwischenspeicher. Ältere Anleitungen nennen **Application Access Policies**; Microsoft hat sie durch RBAC für Anwendungen ersetzt. Quellen: [RBAC for Applications in Exchange Online](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac), [user: sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

**6. In Haben eintragen.** Unter **Einstellungen › E-Mail › E-Mail-Versand** den Versandweg **Microsoft 365 (Graph)** wählen und eintragen:

| Feld | Inhalt |
| --- | --- |
| Verzeichnis-ID (Tenant) | GUID oder Domäne des Tenants (`firma.onmicrosoft.com`) |
| Anwendungs-ID (Client) | GUID der App-Registrierung |
| Anmeldung | Zertifikat oder Client Secret |
| Absender | Adresse des Postfachs, aus dem gesendet wird, auch die einer Shared Mailbox |
| Postfach | Nur nötig, wenn es von der Absenderadresse abweicht: Benutzerprinzipalname (UPN) oder Objekt-ID, etwa bei einer Alias-Adresse |

Dann **Speichern** und **Test-Mail senden**; sie geht an die Adresse für Erinnerungen. Beim Ändern anderer Angaben lässt du Secret oder Zertifikat leer, dann bleibt das gespeicherte. Beim Wechsel des Versandwegs oder der Anmeldeart musst du das Geheimnis neu angeben.

**Shared Mailbox als Absender.** Trage die Adresse der Shared Mailbox als **Absender** ein. Die Mail geht als diese Mailbox hinaus und liegt in deren „Gesendeten Elementen“. Die Shared Mailbox braucht keine Anmeldung; die Rechte der App in Schritt 5 müssen sie einschließen. „Blindkopie an mich“ schickt die Kopie an diese Adresse.

**Grenzen gegenüber SMTP:**

- **Anhänge:** höchstens 2,5 MB zusammen. Darüber lehnt Haben den Versand vor dem Senden mit einer Meldung ab. Größere Anhänge bräuchten zusätzlich `Mail.ReadWrite` (die App könnte dann alle Mails der erlaubten Postfächer lesen); das hat Haben bewusst nicht eingebaut. Bei größeren Anhängen nutze SMTP.
- **Nur HTML:** Eine Nachricht über Graph hat einen Inhalt. Haben sendet den HTML-Teil, einen Nur-Text-Teil daneben gibt es nicht.
- **Absendername:** Haben schickt den Namen aus den Einstellungen mit. Ob Exchange ihn übernimmt oder den Anzeigenamen des Postfachs verwendet, ist nicht geprüft.
- **Ungeprüft:** Haben ist gegen einen gemockten Endpunkt getestet, nicht gegen einen echten Tenant. Meldet sich etwas anders als hier beschrieben, bitte als Issue melden (ohne Tenant-IDs und Adressen).

**Fehlerbilder.** Jeder Versuch steht im Versandprotokoll mit dem Versandweg. Die Meldung nennt dahinter den Fehlercode und die Anfrage-ID von Microsoft; mit ihr findet der Support die Anfrage.

| Meldung | Ursache und Abhilfe |
| --- | --- |
| „Die Anmeldung bei Microsoft Entra ID ist fehlgeschlagen … AADSTS…“ | Tenant, Client-ID, Secret oder Zertifikat stimmen nicht, das Secret ist abgelaufen oder das Zertifikat fehlt in Entra ID. Den Code (AADSTS) in der [Fehlerliste von Microsoft](https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes) nachschlagen |
| „Die App darf nicht aus dem Postfach … senden“ (403) | Die Rolle `Application Mail.Send` fehlt, das Postfach liegt nicht im Verwaltungsbereich, oder die Änderung ist noch nicht wirksam (bis zu 2 Stunden). Mit `Test-ServicePrincipalAuthorization` prüfen |
| „Das Postfach … gibt es nicht“ (404) | Absenderadresse oder Feld Postfach falsch; bei einer Alias-Adresse den Benutzerprinzipalnamen eintragen |
| „Microsoft 365 hat die Mail abgelehnt“ (400) | Ungültiger Empfänger oder Inhalt |
| „Microsoft 365 ist überlastet“ (429) | Haben hat nach der Wartezeit von Microsoft dreimal versucht (höchstens 30 Sekunden). Später erneut senden. Für Outlook gelten je App und Postfach 10 000 Anfragen in 10 Minuten und vier gleichzeitige ([Limits](https://learn.microsoft.com/en-us/graph/throttling-limits)) |
| „Keine Verbindung zu Microsoft 365“ | Netzwerk oder Zeitüberschreitung. Haben wiederholt dann **nicht** von selbst: Die Mail ist vielleicht doch angekommen, prüfe „Gesendete Elemente“, bevor du erneut sendest |

Client Secret und privater Schlüssel liegen wie das SMTP-Passwort AES-256-GCM-verschlüsselt in der Datenbank; sie stehen nicht im Audit-Log und werden nie angezeigt. Tenant, Client, Fingerabdruck und Postfach stehen im Audit-Log, sie sind keine Geheimnisse. Sichere `HABEN_ENCRYPTION_KEY` wie sonst getrennt vom Backup.

## KI-Auslesung von Belegen

Optional. E-Rechnungen (ZUGFeRD, Factur-X, XRechnung) liest Haben immer selbst aus. Für andere PDFs und Fotos (JPEG, PNG, WebP) kann ein Modell die Felder vorbefüllen: Lieferant, USt-IdNr., Rechnungsnummer, Datum, Fälligkeit, Beträge je Steuersatz und eine vorgeschlagene Kategorie. Dafür gibt es zwei Schnittstellen, eingestellt über Umgebungsvariablen auf dem Server.

| | Claude (Anthropic-API) | OpenAI-kompatibel, selbst betrieben | OpenAI-kompatibel, in der Cloud |
| --- | --- | --- | --- |
| Beispiele | Claude-Modelle von Anthropic | Ollama, LM Studio, vLLM, `docker model run` | OpenRouter, OpenAI, andere Anbieter mit OpenAI-kompatibler API |
| Einschalten | `ANTHROPIC_API_KEY` ([Installation](installation.md#ki-auslesung-anthropic)) | `EXTRACTION_BASE_URL` und `EXTRACTION_MODEL` ([Installation](installation.md#ki-auslesung-über-openai-kompatible-schnittstelle)) | `EXTRACTION_BASE_URL`, `EXTRACTION_MODEL` und `EXTRACTION_API_KEY` ([Installation](installation.md#ki-auslesung-über-openai-kompatible-schnittstelle)) |
| Wohin der Beleg geht | an Anthropic | nur an deinen Dienst, er verlässt deinen Server nicht | nur an diesen Anbieter (bei OpenRouter auch an den Anbieter des Modells) |
| PDFs | direkt | lokal in Seitenbilder umgewandelt, höchstens 4 Seiten | lokal in Seitenbilder umgewandelt, höchstens 4 Seiten |
| Kosten | ein paar Cent je Beleg | Rechenzeit auf deinem Server, mit CPU leicht ein bis mehrere Minuten je Beleg | nach Preisliste des Anbieters und Modells |
| Genauigkeit | sehr gut, auch bei Fotos und Kassenzetteln | gut bei sauberen PDFs, schwächer bei Fotos und Kassenzetteln | je nach gewähltem Vision-Modell |

Es gilt immer genau ein Dienst: Ist `EXTRACTION_BASE_URL` gesetzt, gehen Belege nur an diese Adresse, auch wenn zusätzlich `ANTHROPIC_API_KEY` gesetzt ist, und bei einem Fehler weicht Haben auf keinen anderen Anbieter aus. Welcher Weg gerade gilt, zeigt **Einstellungen › KI-Assistenten und API › Belegauslesung**. Ohne beides bleibt alles lokal, und du füllst die Felder von Hand aus. In jedem Fall bucht Haben einen Beleg erst, wenn du die Felder bestätigt hast. Weicht die Summe vom Gesamtbetrag ab oder ist die Währung nicht Euro, zeigt Haben einen Hinweis. Mehr in [Belege](belege.md).

### Beispiel: Ollama mit Qwen-VL

Läuft Haben mit Docker Compose und Ollama auf demselben Server:

1. Ollama installieren, so einstellen, dass es für Container erreichbar ist (`OLLAMA_HOST=0.0.0.0:11434`, Port per Firewall nur für den Server freigeben), und ein Vision-Modell laden: `ollama pull qwen2.5vl:7b`.
2. In `compose.yml` beim Dienst `app` die Zeilen `extra_hosts` mit `host.docker.internal:host-gateway` einkommentieren. Unter Linux kennt der Container `host.docker.internal` sonst nicht; Docker Desktop braucht das nicht.
3. In `.env` eintragen:

    ```sh
    EXTRACTION_BASE_URL=http://host.docker.internal:11434/v1
    EXTRACTION_MODEL=qwen2.5vl:7b
    ```

4. `docker compose up -d`, dann unter **Einstellungen › KI-Assistenten und API** prüfen, dass „Eigener Dienst (OpenAI-kompatibel)“ mit dem Modell angezeigt wird.
5. Einen Beleg als Foto hochladen. Er zeigt „Wird ausgelesen“ und danach die Felder; ein Fehler (nicht erreichbar, Zeitüberschreitung, falsches Antwortformat) steht am Beleg.

Mit Podman heißt die Adresse `http://host.containers.internal:11434/v1`. Ollama als eigenen Container neben Haben, Schlüssel und Wartezeit beschreibt [Installation](installation.md#ki-auslesung-über-openai-kompatible-schnittstelle).

### Beispiel: OpenRouter

OpenRouter vermittelt viele Modelle verschiedener Anbieter über eine OpenAI-kompatible Schnittstelle.

1. Bei OpenRouter einen API-Schlüssel anlegen und in der Modellliste ein Vision-Modell wählen (Eingabe „image“), etwa `qwen/qwen2.5-vl-72b-instruct`.
2. In `.env` eintragen:

    ```sh
    EXTRACTION_BASE_URL=https://openrouter.ai/api/v1
    EXTRACTION_MODEL=qwen/qwen2.5-vl-72b-instruct
    EXTRACTION_API_KEY=sk-or-…
    ```

3. `docker compose up -d`, dann unter **Einstellungen › KI-Assistenten und API** prüfen, dass „Eigener Dienst (OpenAI-kompatibel)“ mit dem Modell und beim Schlüssel „gesetzt“ angezeigt wird.

Der Beleg geht dann an OpenRouter und an den Anbieter des Modells. Wie lange sie Daten aufbewahren und ob sie damit trainieren, stellst du in deinem OpenRouter-Konto ein. Genauso funktionieren andere Dienste mit OpenAI-kompatibler API, etwa OpenAI selbst mit `https://api.openai.com/v1`.

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
- [Umsatzsteuer](umsatzsteuer.md): Voranmeldung monatlich oder vierteljährlich
- [Auswertungen](auswertungen.md) und Jahresexport

[Zurück zur Übersicht](ueberblick.md)
