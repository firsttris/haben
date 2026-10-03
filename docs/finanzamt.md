# Finanzamt

Unter **Finanzamt** holst du Bescheide aus deinem ELSTER-Postfach und schreibst dem Finanzamt über ELSTER, ohne Mein ELSTER zu öffnen. Die Nachricht geht an das Finanzamt der Steuernummer aus den Einstellungen; für Einzelunternehmer ist das meist dieselbe Steuernummer wie für die Einkommensteuer. Gesendet wird wie bei der Voranmeldung mit Zertifikat und PIN, erst als Testübermittlung, dann echt.

## Bescheide aus dem ELSTER-Postfach

**Postfach abrufen** holt alles Neue aus deinem ELSTER-Postfach: Steuerbescheide (Einkommensteuer, Umsatzsteuer, Gewerbesteuer-Messbescheid und andere), Mitteilungen des Finanzamts und die Daten zum Steuerbescheid. Die Dokumente landen im Dokumentenspeicher und stehen in der Liste mit Art, Jahr und Bescheiddatum; ein Klick öffnet das PDF.

Damit Bescheide dort ankommen, musst du in Mein ELSTER einmal der elektronischen Bekanntgabe zustimmen. Bescheide, die nur per Brief kommen, kann Haben nicht abholen.

Der Abruf läuft in drei Schritten, wie bei viking:

1. **PostfachAnfrage** (Datenabholung Version 31) listet die bereitgestellten Bescheide und ihre Anhänge.
2. Die Anhänge kommen über Otto (`libotto.so`, liegt bei ERiC) vom ELSTER-Server.
3. **PostfachBestaetigung** meldet ELSTER die Abholung. Bestätigt wird nur, was vollständig gespeichert ist.

ELSTER erwartet die Bestätigung innerhalb von 24 Stunden, sonst droht die Sperre der Hersteller-ID. Scheitert sie, zeigt die Seite einen Hinweis; der nächste Abruf holt die Bestätigung nach. Abgeholte Dokumente legt Haben nicht doppelt ab. Jeder Abruf und jede Bestätigung wird mit dem XML gespeichert, ebenso wie die Dokumente unveränderlich.

Der Testabruf läuft wie die Testübermittlung mit Testmerker und Test-Hersteller-ID. Ohne ERiC liefert er einen erfundenen Testbescheid, damit du die Seite ausprobieren kannst.

## Vorauszahlungen herabsetzen

Das Finanzamt setzt Einkommensteuer-Vorauszahlungen (fällig 10.3., 10.6., 10.9. und 10.12.) nach dem letzten Bescheid fest. Verdienst du in diesem Jahr weniger, kannst du die Herabsetzung formlos beantragen (§ 37 Abs. 3 EStG). Ein eigenes ELSTER-Formular dafür braucht es nicht; Haben schickt den Antrag als Sonstige Nachricht.

Haben füllt den Antrag mit den Zahlen aus deiner Buchhaltung:

| Angabe | Woher |
| --- | --- |
| Gewinn bis heute | EÜR des laufenden Jahres, wie unter [Auswertungen](auswertungen.md) |
| Hochrechnung | Gewinn bis heute taggenau auf das ganze Jahr hochgerechnet |
| Vorjahr | EÜR des Vorjahres |
| Bisherige und gewünschte Vorauszahlung je Quartal | trägst du ein |

Welche Vorauszahlung passt, hängt von deiner gesamten Einkommensteuer ab (weitere Einkünfte, Sonderausgaben, Zusammenveranlagung). Deshalb rechnet Haben keine Steuer aus, sondern du trägst den gewünschten Betrag ein. Den fertigen Text kannst du vor dem Senden frei ändern.

Die Herabsetzung wirkt ab dem nächsten Fälligkeitstermin. Die Antwort kommt als geänderter Vorauszahlungsbescheid, per Brief oder in dein ELSTER-Postfach.

## Freie Nachricht

Betreff (bis 99 Zeichen) und Text (bis 15.000 Zeichen) für alles andere, etwa eine Fristverlängerung oder eine Rückfrage. Anhänge sind über diesen Weg nicht möglich.

## Bankverbindung ändern

Teilt dem Finanzamt ein neues Konto für Erstattungen und, falls du eine Lastschrift erteilt hast, für den Einzug mit (Datenart AenderungBankverbindung, Version 20). Die Änderung gilt für alle Steuerarten zur Steuernummer, Kontoinhaber bist du selbst (Person A).

Vorbelegt ist die IBAN aus den Firmendaten. Haben prüft die IBAN-Prüfsumme vor dem Senden. ELSTER braucht dazu deine persönlichen Angaben, also Steuer-ID, Name und Geburtsdatum, aus [Einstellungen → Persönliche Angaben](einrichtung.md#persönliche-angaben).

## Verlauf

Jede Prüfung und Übermittlung speichert Haben mit Text, Transfer-Ticket und dem gesendeten XML; ändern oder löschen lässt sich das nicht. Ein Übertragungsprotokoll als PDF gibt es für Nachrichten nicht, das Transfer-Ticket ist der Nachweis.

Für die Anschrift im Absender braucht ELSTER Straße und Hausnummer getrennt; Haben trennt die Hausnummer am Ende der Straße ab. Fehlt sie, meldet die Seite das.
