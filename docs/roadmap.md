---
title: "Roadmap: was als Nächstes kommt"
description: >-
  Wo die Planung von Haben steht, was bewusst nicht kommt, was ohne Zertifizierung nicht geht und
  was blockiert ist.
---

# Roadmap

Was als Nächstes kommt, steht im **[Project „Roadmap“ auf GitHub](https://github.com/users/firsttris/projects/2)**.
Jede Karte ist ein Issue oder ein Entwurf, mit Aufwand, Bereich und Hinweis:

| Spalte | Bedeutung |
| --- | --- |
| Später | Kommt nach den geplanten Karten |
| Geplant | Wird gebaut, von oben nach unten |
| In Arbeit | Jemand baut daran |
| Im nächsten Release | Umgesetzt und gemergt, kommt mit der nächsten Version |
| Erledigt | Veröffentlicht; das Issue ist geschlossen. Fehlt danach etwas, gern ein neues Issue mit Verweis auf das alte |

Die Reihenfolge: zuerst Fehler bei Steuer und Buchung, dann kleine Wünsche aus dem Alltag, dann was
Freiberuflern und kleinen GmbHs beim Buchen am meisten fehlt. Wünsche kommen als
[Issue](https://github.com/firsttris/haben/issues/new/choose); beim Einordnen bekommt jedes Issue einen kurzen
Kommentar, ob und wo es ins Board kommt, oder eine Rückfrage; was umgesetzt ist, steht im jeweiligen
Kapitel der Doku und in den [Releases](https://github.com/firsttris/haben/releases).

## Bewusst nicht

| Thema | Grund |
| --- | --- |
| Lagerbestand | Kein Kern einer Buchhaltung; gehört in eine Warenwirtschaft (Lexware Office führt keinen, sevDesk nur als Zusatzmodul) |
| Stoppuhr, Projektverwaltung und Teamplanung | Gehören in eigene Werkzeuge; abrechenbare Leistungen erfasst Haben selbst oder übernimmt sie über die API („Abrechenbare Leistungen“, [#417](https://github.com/firsttris/haben/issues/417)) |
| Eigene Shop-Anbindungen, Bestellungen und Versand | Abrechnungen der Zahlungsdienste, API und n8n decken das ab; auch Lexware Office bindet Shops nur über Partner an. Bestellungen mit Status, Druck-Buttons, Sendungsnummern und Webhook-Aktionen würden Haben zum Versandtool machen; eigene Seiten bekommen bewusst keine Anmeldung von Haben, weil eine fremde Seite mit der Sitzung festschreiben oder an ELSTER senden könnte ([#199](https://github.com/firsttris/haben/issues/199)) |
| Lastschrifteinzug über einen Zahlungsdienst | Gehört zum Zahlungsdienst; Lexware Office macht es nur über Partner |
| Native Apps | Haben ist eine installierbare Web-App mit Kamera und Teilen-Menü; zwei App-Stores zu pflegen lohnt nicht |
| CRM mit Aufgaben und Push-Erinnerungen, Mitarbeiterportal | Kein Kern einer Buchhaltung für kleine Betriebe |
| Mehrere Firmen in einer Installation | Eine Instanz je Firma, Begründung unter [Mehrere Instanzen](installation.md#mehrere-instanzen) ([#66](https://github.com/firsttris/haben/issues/66)) |
| Vereine und gemeinnützige Körperschaften | Brauchen Sphären (ideeller Bereich, Vermögensverwaltung, Zweckbetrieb, wirtschaftlicher Geschäftsbetrieb), Zuwendungsbestätigungen, Anlage Gem und einen Vereinskontenrahmen wie SKR42 oder SKR49. Das planen wir nicht selbst; ausgeschlossen ist es nicht, wenn jemand mit Erfahrung in Vereinsbuchhaltung es umsetzen und dauerhaft betreuen will, nach einem gemeinsamen Entwurf, wie die Sphären ins Datenmodell passen ([#412](https://github.com/firsttris/haben/issues/412), [#497](https://github.com/firsttris/haben/issues/497)) |
| Mehrere Geschäftsidentitäten mit eigenen Steuerdaten | Ein Unternehmer hat ein Unternehmen (§ 2 Abs. 1 Satz 2 UStG), auf der Rechnung steht sein vollständiger Name; Marken mit Logo, Kontakt und Bankkonto kommen als Profile ([#245](https://github.com/firsttris/haben/issues/245)) |
| E-Mails als HTML mit Editor | Hoher Aufwand (Editor, Vorschau, sicheres HTML, Darstellung in vielen Mailprogrammen) bei wenig Nutzen; auch kein schlichter HTML-Rahmen mit Logo und Signatur. Textvorlagen je Art und Sprache mit Platzhaltern gibt es ([#115](https://github.com/firsttris/haben/issues/115)) |
| Vorlagen mit HTML-Renderer | Ein Renderer wie WeasyPrint brächte Python in den Container und ein Risiko für PDF/A; auch kein eigener Renderer-Container, denn zwei Wege zu PDF/A und ZUGFeRD wären doppelt zu prüfen und zu pflegen. Die Gestaltung läuft über die Typst-Vorlage, auch mit [eigenen Layouts](belegvorlagen.md) ([#113](https://github.com/firsttris/haben/issues/113)) |
| Eigenes lernendes Modell für Vorschläge | Vorschläge lernen ohne Modell aus allen früheren Zuordnungen ([Bank](bank.md#vorschläge-ohne-rechnung-und-geldtransit), [Belege](belege.md#vorschläge-aus-früheren-belegen), [#295](https://github.com/firsttris/haben/issues/295)); ein Modell kostet Pflege ohne deutlichen Gewinn ([#107](https://github.com/firsttris/haben/issues/107)) |
| Zins- und Tilgungspläne berechnen | Den Plan liefert die Bank, die Rate lässt sich aufgeteilt buchen; Zinsmethoden, Sondertilgungen und Schlussraten je Vertrag nachzurechnen kostet viel Pflege für wenig Gewinn. Vertrag und Tilgungsplan der Bank sollen als Unterlagen ans Darlehen ([#326](https://github.com/firsttris/haben/issues/326)) |
| Frei vergebene Rechnungsnummer je Entwurf | Nummern vergibt Haben beim Festschreiben aus dem Nummernkreis; eine Nummer von Hand müsste Eindeutigkeit und Zähler selbst absichern ([#328](https://github.com/firsttris/haben/issues/328)) |
| Bankumsatz frei auf jedes Konto mit Steuerschlüssel buchen | Voranmeldung, EÜR und E-Bilanz hängen an den Kategorien; im Bankabgleich wird [direkt auf eine Kategorie gebucht](bank.md#auf-eine-kategorie-buchen), später auch auf ein eigenes Konto mit geerbter Zuordnung. Was ohne Bankumsatz gebucht werden muss, etwa eine Sachentnahme, geht als [freie Buchung mit Steuerschlüssel](buchhaltung.md#manuelle-und-freie-buchungen) ([#324](https://github.com/firsttris/haben/issues/324), [#502](https://github.com/firsttris/haben/issues/502)) |
| Personenkonten im Journal | Offene Posten führt Haben je Rechnung und Beleg; Personenkonten braucht die Steuerberatung im DATEV-Export, dort setzt Haben sie ein ([Personenkonten](auswertungen.md#personenkonten)) ([#327](https://github.com/firsttris/haben/issues/327)) |
| Texterkennung (OCR) vor dem Modell | Für Scans und Fotos liest ein Vision-Modell besser als OCR mit Textmodell; eine OCR-Engine wäre eine weitere Abhängigkeit im Container ([#128](https://github.com/firsttris/haben/issues/128), [#329](https://github.com/firsttris/haben/issues/329)) |
| Getrennte Verzeichnisse für Kunden und Lieferanten | Eine Firma ist oft beides und stünde sonst doppelt drin; ein Kontakt hat die Rollen Kunde und Lieferant ([#224](https://github.com/firsttris/haben/issues/224)) |
| Zweite Farbe auf Rechnungen | Text und Beträge in der Akzentfarbe lesen sich schlecht; die Grautöne leiten sich aus der Akzentfarbe ab ([#222](https://github.com/firsttris/haben/issues/222)) |
| Sachkonto je Bankkonto | Alle Bankkonten buchen auf das Bankkonto des Kontenrahmens; getrennte Salden im Kontenblatt lohnen den Aufwand nicht. Benennen vor dem Anlegen würde den Ablauf mit Enable Banking unterbrechen, und der Zweck eines Kontos setzt nicht die IBAN auf Rechnungen ([#105](https://github.com/firsttris/haben/issues/105)) |
| Fremdwährungsrechnung mit deutscher Umsatzsteuer bei Ist-Versteuerung | Gesperrt statt nachgebildet: Sonst änderte sich die Steuer einer festgeschriebenen Rechnung mit dem Kurs bei der Zahlung ([#109](https://github.com/firsttris/haben/issues/109)) |
| Eigene Anbindung einzelner Dokumentenarchive (etwa Paperless-ngx), Beleg nur als Link | Das Original gehört nach Haben (§ 147 AO); ein Link auf ein fremdes Archiv sichert weder Unveränderbarkeit noch Aufbewahrung. Archive schicken Belege über die [API](api.md#paperless-ngx), für Paperless-ngx ohne eigenen Code; ein eigenes Archiv mit GoBD-Modus entsteht mit [Belegt](https://github.com/firsttris/belegt) ([#631](https://github.com/firsttris/haben/issues/631)) |
| Andere Datenbank oder Aufteilung in Dienste | Unveränderbarkeit nach GoBD hängt an Triggern in PostgreSQL; ohne sie hinge sie nur an Berechtigungen und App-Code ([#63](https://github.com/firsttris/haben/issues/63)) |
| Eigener `dev`-Branch | Trunk-based auf `main`, Release Candidates als Tags mit `:next` ([#92](https://github.com/firsttris/haben/issues/92)) |
| Paket `packages/contracts` | Server-Funktionen mit Zod und die Schnittstellen der Module (`index.ts`) decken die Verträge ab ([#81](https://github.com/firsttris/haben/issues/81)) |

## Nicht machbar ohne Zertifizierung oder Lizenz

| Thema | Warum nicht | Was Haben stattdessen tut |
| --- | --- | --- |
| Meldungen an die Sozialversicherung, Beitragsnachweise, Erstattungsanträge | Nur aus systemgeprüften Programmen (§ 95b SGB IV, Prüfung durch die ITSG) | [Ausfüllliste](lohn.md#sv-meldeportal) zum Eintragen im SV-Meldeportal der ITSG |
| Eigenes Geschäftskonto | Banklizenz | Abruf bestehender Konten über Enable Banking |
| DATEV-Online-Schnittstellen | Kostenpflichtige Partnerschaft mit DATEV | DATEV-Export (Buchungsstapel) |
| Hinterlegung des Jahresabschlusses als XML oder XBRL | Schema und XBRL-Vorgaben des Bundesanzeiger Verlags gibt es nur nach einer Freischaltung, ihre Nutzungsbedingungen untersagen die Weitergabe; die Testplattform nur auf Anfrage ([Hinterlegung](gmbh-abschluss.md#xml-oder-xbrl-statt-pdf)) | Bilanz als PDF, das das Register gegen ein Entgelt je Zeichen umwandelt, oder Abtippen im Webformular |
| Kassensystem mit TSE | Elektronische Kassen brauchen eine zertifizierte technische Sicherheitseinrichtung (§ 146a AO) | Kein Kassensystem für den Ladenverkauf; das Kassenbuch führt Bargeld, das nicht über eine Registrierkasse läuft ([Kasse](kasse.md)) |

## Blockiert

| Thema | Was fehlt |
| --- | --- |
| Umsatzsteuererklärung mit Kz 21, 45 und 48 | Die Feldkennungen der Zeilen für nicht steuerbare sonstige Leistungen im übrigen Gemeinschaftsgebiet, übrige nicht steuerbare Umsätze und steuerfreie Umsätze ohne Vorsteuerabzug. Bis dahin sperrt Haben die Übermittlung, wenn solche Umsätze gebucht sind |
| Bescheide automatisch prüfen | Das Format der Bescheiddaten (ESB), um festgesetzte Steuer und neue Vorauszahlungen zu lesen und mit der Erklärung zu vergleichen. Automatischer Abruf und Einspruchsfrist sind fertig ([Finanzamt](finanzamt.md#automatisch-abrufen)) |
| Belege von ELSTER in die Erklärung übernehmen | Die Schemas der Belegarten (Lohnsteuerbescheinigung, Beiträge zur Kranken- und Pflegeversicherung, Rentenbezüge …), um Beträge sicher den Feldern der Erklärung zuzuordnen. Abrufen und Anzeigen ist fertig ([Jahreserklärungen](jahreserklaerung.md#belege-von-elster)) |
| Lohnsteuerbescheinigung ab 2026 über ERiC | Die Schnittstelle der LSTMitteilung (Verfahren ElsterKMV), die ab 2026 die Datenart LStB ablöst; sie steht nur auf esteuer.de, nicht im ERiC-Paket. Bis dahin übermittelst du im ELSTER-Portal und vermerkst die Übermittlung ([Lohn](lohn.md#lohnsteuerbescheinigung)) |
| Strukturierter Antrag auf Anpassung der Vorauszahlungen | Ob es dafür eine ERiC-Datenart gibt und wie ihr Schema aussieht. Bis dahin geht der Antrag als Sonstige Nachricht mit Steuerprognose ([Finanzamt](finanzamt.md#vorauszahlungen-herabsetzen)) |

Das alles steht in der **Jahresdokumentation** der Finanzverwaltung (Schemas und Feldlisten aller Datenarten). Es gibt sie nur im ELSTER-Entwicklerbereich unter developer.elster.de, nach der Registrierung als Softwarehersteller.

## Quellen

Bei der Suche nach Feldkennungen und Abläufen geprüft:

| Quelle | Lizenz | Was drin ist |
| --- | --- | --- |
| [viking](https://github.com/capocasa/viking) | MIT | UStVA, USt-Erklärung, EÜR, ESt mit Anlagen, Sonstige Nachricht, Bankverbindung, Postfach mit Otto; Vorbild für Haben |
| [erica](https://github.com/digitalservicebund/erica) (DigitalService, Steuerlotse) | MIT | Belegabruf (VaSt): Freischaltung beantragen, freischalten, Belege auflisten und abrufen; vereinfachte Einkommensteuererklärung |
| [EasyCash&Tax](https://github.com/Thomas-Mielke-Software/EasyCash) | GPL-3.0 | Feldkennungen der Anlage EÜR und AVEÜR |
| [finamt](https://github.com/spaceoctahedron/finamt) | AGPL-3.0 | Umsatzsteuererklärung |
| [elster-form-helper-api](https://github.com/dennismenken/elster-form-helper-api) | MIT | Zeilen und Texte der Vordrucke für USt, GewSt und KSt 2020–2025, aber keine Feldkennungen |
| [sturm](https://github.com/C-0711/sturm.0711.io) | ohne Lizenzangabe | Feldliste der Jahresdokumentation 2024 (Kontext, Kennung, Format) für alle Anlagen der Einkommensteuer; Haben übernimmt daraus nur die amtlichen Feldkennungen der Anlage N und der Arbeitnehmerzeilen der Anlage Vorsorgeaufwand |
| [lohnsteuer-bmf](https://pypi.org/project/lohnsteuer-bmf/) | MIT | Einkommensteuertarif und Parameter 2024–2026 nach BMF-Programmablaufplan; Referenz für die Tests der Steuerprognose |

Nicht gefunden wurden die Kennungen für Kz 21/45/48 der Umsatzsteuererklärung und ein Schema für den Antrag auf Anpassung der Vorauszahlungen, weder in diesen Projekten noch in Paketen auf npm oder PyPI.
