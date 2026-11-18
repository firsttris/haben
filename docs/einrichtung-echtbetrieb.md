---
title: "Von der Testinstanz in den Echtbetrieb: Einstellungen übernehmen"
description: >-
  Nach dem Testen mit frischer Datenbank in den Echtbetrieb: Firmendaten, Gestaltung, Vorlagen und
  Stammdaten als Datei exportieren und in die neue Instanz übernehmen.
---

# Von der Testinstanz in den Echtbetrieb

Rechnungen, Buchungen und Bankumsätze aus dem Testen lassen sich nicht löschen (GoBD). Für den Echtbetrieb beginnst du deshalb mit einer frischen Datenbank und nimmst die Einrichtung als Datei mit: Unter **Einstellungen › Export** lädt **Datei herunterladen** in der Karte **Einstellungen exportieren** ein ZIP herunter: die Einstellungen in `einstellungen.json`, Logo, Briefpapier und Standardanhänge als Dateien daneben. Es enthält:

- Firmendaten mit Mahnwesen, Privatanteilen und DATEV-Nummern, persönliche Angaben, ausgeblendete Bereiche und den [Voranmeldungszeitraum](umsatzsteuer.md#voranmeldungszeitraum)
- Beleggestaltung mit Logo, Briefpapier und eigenen Layouts
- Nummernformate, Vorlagen für den Zahlungsplan, Standardanhänge für Angebote, Format und nächste Kundennummer
- Absender und Vorlagen der E-Mails, [Erinnerungen an Fristen](fristen.md#erinnerungen-per-e-mail), Textbausteine, eigene Konten, eigene Seiten und die Angaben zur Verfahrensdokumentation
- Einheiten, Artikel und Kontakte mit Ansprechpartnern

Nicht darin sind Zugangsdaten (Kontoabruf, Google Play, App Store und Etsy, ELSTER-Zertifikat, E-Mail-Versand und Belege-Postfach, Ablage im Dokumentenarchiv, KI-Schlüssel, API-Tokens, Kalender-Abo), Zugänge und Passkeys, die Zählerstände der Rechnungs- und Angebotsnummern, Bankkonten, Mitarbeiter, Darlehen, SEPA-Lastschriftmandate, wiederkehrende Rechnungen, Dauerbelege und alles Gebuchte. Das ZIP enthält Steuernummer, Steuer-ID und Bankverbindung. Bewahre es so sicher auf wie ein Backup; herunterladen kann es nur der Inhaber.

Nimm für beide Instanzen dieselbe Version von Haben: Aktualisiere die Testinstanz vor dem Export auf die Version, die du neu installierst. Eine neuere Version kann Werte speichern, die eine ältere beim Übernehmen nicht annimmt; ein ZIP mit neuerem Format lehnt sie ab. Die Rückfrage beim Übernehmen nennt die Version, mit der exportiert wurde.

## In der neuen Instanz

1. [Konto anlegen](einrichtung.md#konto-anlegen). Soll der E-Mail-Versand Absender, Vorlagen und Erinnerungen mitbringen, richte ihn jetzt unter **Einstellungen › E-Mail** ein ([E-Mail-Versand](einrichtung-email.md)). Bleibt bei Microsoft 365 das Feld **Postfach** leer, behält diese Instanz ihre Absenderadresse, denn aus deren Postfach sendet Haben.
2. Unter **Einstellungen › Export** in der Karte **Einstellungen übernehmen** mit **Datei übernehmen …** das ZIP wählen und bestätigen. Haben prüft die Prüfsummen von `einstellungen.json` und jeder Datei daneben und jeden Wert wie im Formular und übernimmt alles oder nichts; ein Fehler nennt den Eintrag. Schon eingetragene Firmendaten und Gestaltung ersetzt das ZIP.
3. Braucht ein eigenes Layout Pakete, unter **Einstellungen › Beleggestaltung** **Pakete neu laden**; bis dahin lässt sich mit dem Layout nichts erzeugen.

Übernehmen geht nur, solange die Instanz neu ist: ohne Kontakte, Artikel, eigene Einheiten, Textbausteine, eigene Konten, eigene Layouts, eigene Seiten, Standardanhänge, Angebote, Rechnungen, Belege, Buchungen, Bankumsätze, Kassenbuch, Anlagen, Mitarbeiter und Leistungen. Danach verschwindet die Karte. Anlagen per [CSV-Import](csv-import.md#anlagen) und einen Umzug ins Archiv, der Kontakte anlegt, machst du deshalb erst danach. Rechnungs- und Angebotsnummern beginnen bei 1; die nächste Nummer stellst du unter [Rechnungsnummern](einrichtung.md#rechnungsnummern) ein.
