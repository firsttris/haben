---
title: "Kontakte: Kunden und Lieferanten"
description: >-
  Ein Verzeichnis für Kunden und Lieferanten in Haben: Felder, Ansprechpartner, Rechnungen und Belege
  am Kontakt, SEPA-Lastschriftmandate.
---

# Kontakte

Kontakte erreichst du in der Navigation unter **Verkauf › Kontakte**. Es gibt ein gemeinsames Verzeichnis für Kunden und Lieferanten: Eine Firma, bei der du einkaufst und der du auch Rechnungen schreibst, steht nur einmal drin. **Alle**, **Kunden** und **Lieferanten** über der Liste filtern nach Rolle. Das Suchfeld filtert nach Name, Kundennummer, E-Mail, Telefon und Ort; **Archivierte zeigen** blendet archivierte Kontakte ein.

| Feld | Hinweis |
| --- | --- |
| Name oder Firma | Pflicht |
| Rolle | **Kunde**, **Lieferant** oder beides; mindestens eine. Kunden stehen bei Rechnungen, Angeboten, Serienrechnungen und Textbausteinen zur Auswahl, Lieferanten bei den [Belegen](belege.md) und Dauerbelegen. Das prüft auch der Server, etwa bei einem Aufruf über die API: Ein Kontakt ohne die passende Rolle lässt sich dort nicht zuordnen, die Meldung nennt die Rolle. Geprüft wird beim Zuordnen und beim Wechsel des Kontakts; ein bestehender Verweis auf einen Kontakt, der die Rolle inzwischen nicht mehr hat, bleibt beim Speichern anderer Felder stehen. |
| Lieferantennummer | Frei, z. B. deine Kundennummer beim Lieferanten. |
| Kundennummer | Erscheint auf der Rechnung und als Käuferkennung im XML. Mit einem Format unter **Einstellungen › Rechnungen › Kundennummern** vergibt Haben sie beim Anlegen selbst, wenn du das Feld leer lässt (siehe unten). |
| DATEV-Debitor, DATEV-Kreditor | Personenkonten für die Steuerberatung, getrennt von Kunden- und Lieferantennummer; ein Kontakt mit beiden Rollen kann beide tragen. Fünfstellig wie bei DATEV mit vierstelligen Sachkonten: Debitoren 10000 bis 69999, Kreditoren 70000 bis 99999 ([DATEV-Kontenrahmen SKR 03](https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/mandant/unternehmer/branche/bau/11174%20SKR03%20BilrUg.pdf) und [SKR 04](https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/mandant/unternehmer/branche/bau/11175%20SKR04%20BilrUg.pdf) 2026, jeweils S. 36). Andere Längen lehnt Haben ab, statt sie zu kürzen. Jede Nummer gehört genau einem Kontakt; ist sie schon vergeben, nennt das Formular den Kontakt. Mit [Personenkonten im DATEV-Export](auswertungen.md#personenkonten) steht sie im Buchungsstapel und ist ab dem ersten Export fest; leer vergibt sie der Export, wenn der Kontakt eine braucht. |
| E-Mail | Eine oder mehrere Adressen, mit Komma getrennt (höchstens fünf), etwa zentraler Rechnungseingang und Freigeber. Der Versand per E-Mail schreibt an alle. Für XRechnung gilt die erste als elektronische Adresse des Käufers (BT-49). |
| Telefon | Frei, mit Ziffern, Leerzeichen und `+ ( ) / - .`, z. B. `+49 941 123456`. Steht in der Kontaktliste unter der E-Mail und lässt sich suchen, aber nicht auf Rechnungen; für eine Person bei der Firma gibt es die [Ansprechpartner](#ansprechpartner). |
| Straße und Hausnummer, PLZ, Ort | Für das Festschreiben vollständig nötig. |
| Land (ISO-Code) | Zwei Buchstaben, Vorgabe `DE`. Andere Länder erscheinen ausgeschrieben in der Anschrift. |
| USt-IdNr. | Form `DE123456789`, steht dann auf der Rechnung. Gibt es sie schon bei einem anderen Kontakt, auch einem archivierten, weist Haben nach dem Tippen darauf hin, mit Link auf den Kontakt, statt einen zweiten anzulegen; gespeichert wird trotzdem, zusammengeführt nichts. |
| IBAN | Hilft beim Bankabgleich. Wird beim ersten zugeordneten Zahlungseingang automatisch gemerkt, wenn das Feld leer ist. |
| Leitweg-ID (öffentliche Auftraggeber) | Steht auf der Rechnung und wird im XML als Käuferreferenz verwendet. |
| Standardformat für Rechnungen | ZUGFeRD, XRechnung (CII), XRechnung (UBL) oder „wie in den Einstellungen“. |
| Sprache von Rechnungen und Angeboten | Deutsch oder Englisch, siehe [Rechnungen auf Englisch](rechnungen.md#rechnungen-auf-englisch). |
| Skonto | „wie in den Einstellungen“ oder „eigenes für diesen Kunden“ mit bis zu drei Stufen; ohne Stufe bekommt der Kunde kein Skonto (siehe [Skonto](rechnungen-zahlung.md#skonto)). |

**Kundennummern automatisch.** Unter **Einstellungen › Rechnungen › Kundennummern** trägst du ein Format wie `K-{NNNN}` und die nächste laufende Nummer ein. Legst du dann einen Kontakt ohne Kundennummer an, vergibt Haben die nächste (`K-0001`, `K-0002` …); das Formular zeigt sie vorab an. Platzhalter wie beim [Nummernformat](einrichtung.md#nummernformat), das Jahr ist hier aber nicht nötig, weil der Zähler nicht jährlich neu beginnt. Eine eingetragene Nummer bleibt, wie sie ist, und zählt nicht mit; Nummern, die ein Kontakt schon trägt, etwa aus einem Import, überspringt Haben. Beim Bearbeiten eines Kontakts vergibt Haben keine Nummer, und einem reinen Lieferanten (ohne Häkchen **Kunde**) auch nicht. Leeres Format schaltet die automatische Vergabe ab.

## Ansprechpartner

Auf der Detailseite eines Kontakts steht die Karte **Ansprechpartner**: eine oder mehrere Personen mit Name, E-Mail, Telefon und Funktion (etwa „Einkauf“). Im Entwurf von Rechnung und Angebot wählst du unter **Kunde** den **Ansprechpartner**; das Feld erscheint nur, wenn der Kunde Personen hat, und setzt sich beim Wechsel des Kunden zurück.

- **PDF:** Hinter dem Firmennamen steht eine Zeile **z. Hd. <Name>**, englisch **FAO <Name>**; Firmenname und Anschrift bleiben. Das gilt für Rechnung, Angebot, Auftragsbestätigung, Lieferschein und Mahnung, in der Vorschau wie im PDF. Die Zeile kommt als Eintrag im Feld `recipient` bei der Vorlage an, auch bei [eigenen Belegvorlagen](belegvorlagen.md).
- **E-Rechnung:** Der Name steht als **BT-56** (Ansprechpartner des Käufers), in XRechnung (CII und UBL) und in ZUGFeRD. Die E-Mail des Kontakts bleibt BT-49 und BT-58; E-Mail, Telefon und Funktion der Person stehen nicht in der Datei und nicht im PDF.
- **Festschreiben:** Mit der Rechnung oder dem Angebot wird der **Stand der Person** festgehalten. Ändert sich ihr Name später oder wird sie deaktiviert, bleiben Beleg und Siegel unverändert; Storno, Korrektur, Mahnung und Lieferschein nennen dieselbe Person wie die Rechnung. Die Rechnung aus einem Angebot und die Kopie eines Angebots übernehmen die Person, solange sie aktiv ist.
- **Deaktivieren statt löschen:** Eine Person lässt sich nicht löschen, denn sie kann an Entwürfen und an festgeschriebenen Belegen hängen. **Deaktivieren** nimmt sie aus der Auswahl; ein Entwurf, der sie schon gewählt hat, behält sie. Jede Änderung steht im Änderungsprotokoll.
- **Nicht dabei:** wiederkehrende Rechnungen (sie tragen keine Person), die REST-API (ein PATCH lässt die gewählte Person unverändert, außer der Kunde wechselt: dann entfällt sie) und der Umzug aus anderen Programmen.

**Versionen.** Jede Änderung erhöht die Versionsnummer, der vorige Stand bleibt als Version erhalten. Die Detailseite listet alle Versionen mit Zeitpunkt.

**Aus einer Liste übernehmen.** **CSV importieren** über der Liste übernimmt Kunden und Lieferanten aus einer CSV-Datei, etwa dem Kontakt-Export von Lexware Office, mit Vorschau und ohne Dubletten ([CSV-Import](csv-import.md#kontakte)), auch Debitoren und Kreditoren aus einem DATEV-Export ([Kontakte aus DATEV](csv-import.md#kontakte-aus-datev)).

**Archivieren.** Kontakte lassen sich nicht löschen, nur mit **Archivieren** ausblenden und mit **Wiederherstellen** zurückholen. Archivierte Kontakte stehen nicht in der Kundenauswahl des Editors; in der Liste zeigst du sie mit **Archivierte zeigen**.

## Rechnungen und Belege am Kontakt

Unter dem Formular zeigt die Detailseite, was mit dem Kontakt gelaufen ist ([#587](https://github.com/firsttris/haben/issues/587)):

- **Umsatz und Rechnungen** (Kunde): festgeschriebene Rechnungen aus Haben und die Einnahmen aus dem Archiv des Umzugs. Entwürfe zählen nicht. Stornorechnung, Rechnungskorrektur und Gutschrift mindern mit ihrem negativen Betrag, und zwar im Jahr ihres eigenen Datums: Ein Storno im Januar zu einer Rechnung vom Dezember mindert das neue Jahr.
- **Ausgaben und Belege** (Lieferant): gebuchte [Belege](belege.md) und die Ausgaben aus dem Archiv. Ein stornierter Beleg steht in der Liste, zählt aber nicht; ungebuchte Belege fehlen.

Oben stehen die Summen je Jahr, netto und brutto, mit dem Anteil aus dem Altbestand und bei mehreren Jahren einer Zeile **Gesamt**. Ab zwei Jahren zeigt ein Säulendiagramm darüber die Nettosummen, in den Farben der Einnahmen bzw. Ausgaben wie unter [Auswertungen](auswertungen.md#einnahmen-und-ausgaben-je-monat); Zeigen oder Fokus nennt netto, brutto und den Anteil aus dem Altbestand. Ein Klick auf ein Jahr in der Tabelle oder auf seine Säule (per Tastatur mit Enter) zeigt seine Einträge darunter; ohne Wahl ist es das neueste Jahr mit Einträgen. Jede Zeile führt zur Rechnung, zum Beleg oder zum archivierten Beleg.

- **Zugeordnet wird nur über den Kontakt**, nie über den Namen: Ein zweiter Kontakt mit gleichem Namen zählt nicht mit, ebenso wenig eine Rechnung, ein Beleg oder ein archivierter Beleg ohne Kontakt.
- **Das Jahr ist das Rechnungs- bzw. Belegdatum.** Die Seite ist eine Übersicht, keine EÜR: Zahlungsdatum, Ist- und Soll-Versteuerung spielen keine Rolle.
- **Der Altbestand rechnet wie unter Archiv › Belege**, Gutschriften negativ. Ein [übernommener offener Posten](lexoffice.md#schritt-3-offene-posten-übernehmen) steht nur einmal da, als Rechnung bzw. Beleg in Haben.
- Ein Abschnitt erscheint mit der Rolle oder sobald es Einträge gibt: Ein Lieferant, dem du früher auch Rechnungen geschrieben hast, zeigt beide.

## SEPA-Lastschriftmandate

Ziehst du Rechnungen per Lastschrift ein, hinterlegst du das Mandat des Kunden auf seiner Detailseite unter **SEPA-Lastschriftmandate**. Dafür braucht es zuerst die Gläubiger-ID in den [Firmendaten](einrichtung.md#firmendaten). Mandate gibt es nur von Kunden.

| Feld | Hinweis |
| --- | --- |
| Mandatsreferenz | Wie auf dem Mandat; bis 35 Zeichen aus `A–Z a–z 0–9`, Leerzeichen und `+ ? / - : ( ) . , '` (Schema der Deutschen Kreditwirtschaft, [Anlage 3 des DFÜ-Abkommens](https://www.ebics.de/de/datenformate/gueltige-version), Kap. 2.3.1). Jede Referenz gibt es nur einmal, ohne Rücksicht auf Groß- und Kleinschreibung (Kap. 2.2.2). Sie beginnt und endet nicht mit `/` und enthält kein `//` ([Clarification Paper EPC132-17](https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2026-09/EPC132-17%20v5.1%20Clarification%20Paper%20SDD%20Core%20and%20SDD%20B2B%20scheme%20rulebooks.pdf), Kap. 2.1). |
| Unterschrieben am | Datum der Unterschrift; nicht in der Zukunft. |
| Verfahren | Basislastschrift (CORE) oder Firmenlastschrift (B2B). Eine Firmenlastschrift setzt voraus, dass der Kunde kein Verbraucher ist und das Mandat auch seiner Bank vorliegt. |
| Kontoinhaber, IBAN, BIC | Das Konto, von dem eingezogen wird; vorbelegt mit Name und IBAN des Kontakts. Die IBAN muss aus dem EWR sein, wie bei SEPA-Überweisungen: Das Konto muss in SEPA liegen (Rulebook, Kap. 2.2), und außerhalb des EWR verlangt das Mandat die Anschrift des Zahlungspflichtigen. Die BIC ist optional. |
| Schon eingezogen | Für ein Mandat, auf das vor Haben schon Lastschriften liefen: Der nächste Einzug ist dann eine Folgelastschrift. Mit dem Tag des letzten Einzugs rechnet Haben den Verfall richtig. |

**Verfall nach 36 Monaten.** Ein Mandat, auf das 36 Monate lang keine Lastschrift eingereicht wurde, darf nicht mehr genutzt werden; gezählt ab dem letzten Einzug, auch wenn er zurückgegeben wurde ([SDD Core Rulebook](https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2026-09/EPC016-06%202025%20SDD%20Core%20Rulebook%20version%201.2.pdf) und [SDD B2B Rulebook](https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2026-09/EPC222-07%202025%20SDD%20B2B%20Rulebook%20version%201.2.pdf) des EPC, Version 1.2, Kap. 4.2). Als Einzug zählt der letzte Einzug vor Haben und jede festgeschriebene Rechnung per [Lastschrift](rechnungen-zahlung.md#lastschrift) mit ihrem Fälligkeitstag, außer sie ist storniert. Für ein Mandat ohne Einzug nennt das Rulebook keinen Beginn; Haben zählt dann vorsichtig ab der Unterschrift. Der Status neben jedem Mandat zeigt, bis wann es gilt oder seit wann es abgelaufen ist; für einen neuen Einzug braucht es dann ein neues Mandat.

**Nichts wird überschrieben.** Mandate, ihre PDFs und Widerrufe lassen sich nur anlegen, nicht ändern oder löschen; jede Zeile steht im Audit-Log. Ändert sich etwas am Mandat, etwa die Bankverbindung, legst du ein neues an. **PDF hinterlegen** speichert das unterschriebene Mandat; ein späteres PDF ersetzt es in der Anzeige, das frühere bleibt gespeichert. **Widerrufen** beendet ein Mandat ab heute, nach einer Rückfrage.
