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

### Automatisch abrufen

Mit Hersteller-ID und eingerichtetem ERiC kannst du beim Abruf „PIN verschlüsselt speichern und täglich automatisch abrufen“ wählen. Haben ruft dann sofort echt ab und speichert die PIN erst, wenn das klappt. Danach holt der Hintergrundjob das Postfach höchstens alle 20 Stunden selbst ab und bestätigt die Abholung; die 24-Stunden-Frist für die Bestätigung ist damit automatisch eingehalten.

Die PIN liegt wie das Zertifikat mit AES-256-GCM verschlüsselt in der Datenbank (Schlüssel aus `HABEN_ENCRYPTION_KEY`) und landet nicht im Audit-Log; dort steht nur, wann sie gespeichert wurde. Wer Datenbank und Schlüssel hat, kann damit in deinem Namen über ELSTER senden. Lässt du beim Belegabruf oder bei Anträgen auf Abrufberechtigung (Jahreserklärung) das PIN-Feld leer, nutzt Haben ebenfalls die gespeicherte PIN. „Ausschalten“ löscht die PIN; ein neues Zertifikat schaltet den automatischen Abruf ebenfalls aus.

### Einspruchsfrist

Zu jedem Bescheid zeigt Haben, bis wann ein Einspruch möglich ist (§ 355 AO): ein Monat ab Bekanntgabe. Die Bekanntgabe gilt am vierten Tag nach dem Bescheiddatum, für Bescheide bis 2024 am dritten. Fällt die Bekanntgabe oder das Fristende auf ein Wochenende oder einen Feiertag im Bundesland, gilt der nächste Werktag. Solange die Frist läuft, steht der Bescheid in der Übersicht unter den Aufgaben, in der letzten Woche hervorgehoben. Mitteilungen haben keine Frist.

Bei Bescheiden, die nur im Postfach bereitgestellt werden, beginnt die Frist genau genommen mit der Bereitstellung; Haben rechnet mit dem Bescheiddatum, das meist derselbe Tag ist. Im Zweifel gilt das Datum im Bescheid.

Der Testabruf läuft wie die Testübermittlung mit Testmerker und Test-Hersteller-ID. Ohne ERiC liefert er einen erfundenen Testbescheid, damit du die Seite ausprobieren kannst.

## Vorauszahlungen herabsetzen

Das Finanzamt setzt Einkommensteuer-Vorauszahlungen (fällig 10.3., 10.6., 10.9. und 10.12.) nach dem letzten Bescheid fest. Verdienst du in diesem Jahr weniger, kannst du die Herabsetzung formlos beantragen (§ 37 Abs. 3 EStG). Ein eigenes ELSTER-Formular dafür braucht es nicht; Haben schickt den Antrag als Sonstige Nachricht.

Haben füllt den Antrag mit den Zahlen aus deiner Buchhaltung und schätzt die Steuer des Jahres:

| Angabe | Woher |
| --- | --- |
| Gewinn bis heute | EÜR des laufenden Jahres, wie unter [Auswertungen](auswertungen.md) |
| Hochrechnung | Gewinn bis heute taggenau auf das ganze Jahr hochgerechnet |
| Vorjahr | EÜR des Vorjahres |
| Voraussichtliche Steuer | Einkommensteuer, Solidaritätszuschlag und Kirchensteuer aus der Hochrechnung, siehe unten |
| Gewünschte Vorauszahlung je Quartal | vorbelegt mit einem Viertel der voraussichtlichen Steuer, änderbar |
| Bisherige Vorauszahlung je Quartal | trägst du ein |

### Steuerprognose

Haben rechnet mit dem Tarif nach § 32a EStG (2023 bis 2026, für spätere Jahre mit dem jüngsten Tarif). Die Tarifwerte sind gegen den Programmablaufplan des BMF abgeglichen. Vom hochgerechneten Gewinn zieht Haben ab:

- Arbeitslohn: Einkünfte nach Werbungskosten bzw. Arbeitnehmer-Pauschbetrag kommen zum Gewinn hinzu,
- Vorsorgeaufwand: Rentenversicherung voll (bei Arbeitnehmern abzüglich des Arbeitgeberanteils), Basis-Kranken- und Pflegeversicherung voll, weitere Vorsorge bis zum Höchstbetrag von 2.800 € je Person, 1.900 € bei Arbeitnehmern,
- Sonderausgaben: Kirchensteuer und Spenden (bis 20 % des Gewinns), mindestens den Pauschbetrag von 36 € bzw. 72 €,
- Kinderbetreuungskosten (bis 2024 zwei Drittel, höchstens 4.000 €; ab 2025 80 %, höchstens 4.800 € je Kind),
- Krankheitskosten über der zumutbaren Belastung.

Bei Zusammenveranlagung gilt der Splittingtarif. Für Kinder vergleicht Haben Kindergeld und Kinderfreibeträge (Günstigerprüfung), haushaltsnahe Aufwendungen mindern die Steuer nach § 35a EStG. Solidaritätszuschlag mit Freigrenze und Milderungszone; Kirchensteuer mit 8 % in Baden-Württemberg und Bayern, sonst 9 %, bei nur einem kirchensteuerpflichtigen Ehegatten vereinfacht zur Hälfte.

Die Abzüge stammen aus den [Angaben zur Einkommensteuererklärung](jahreserklaerung.md#einkommensteuererklärung) des laufenden Jahres, sonst aus denen des Vorjahres. Gibt es keine, rechnet Haben nur mit dem Pauschbetrag. Einbehaltene Lohnsteuer samt Soli und Kirchensteuer wird angerechnet; die Vorauszahlungen beziehen sich nur auf den Rest. Vermietung, Renten und Kapitalerträge fehlen; die Prognose ist eine Schätzung, keine Steuerberechnung des Finanzamts. Die Nennung im Antrag lässt sich abschalten.

Die Herabsetzung wirkt ab dem nächsten Fälligkeitstermin. Die Antwort kommt als geänderter Vorauszahlungsbescheid, per Brief oder in dein ELSTER-Postfach.

## Freie Nachricht

Betreff (bis 99 Zeichen) und Text (bis 15.000 Zeichen) für alles andere, etwa eine Fristverlängerung oder eine Rückfrage. Anhänge sind über diesen Weg nicht möglich.

## Bankverbindung ändern

Teilt dem Finanzamt ein neues Konto für Erstattungen und, falls du eine Lastschrift erteilt hast, für den Einzug mit (Datenart AenderungBankverbindung, Version 20). Die Änderung gilt für alle Steuerarten zur Steuernummer, Kontoinhaber bist du selbst (Person A).

Vorbelegt ist die IBAN aus den Firmendaten. Haben prüft die IBAN-Prüfsumme vor dem Senden. ELSTER braucht dazu deine persönlichen Angaben, also Steuer-ID, Name und Geburtsdatum, aus [Einstellungen → Persönliche Angaben](einrichtung.md#persönliche-angaben).

## Verlauf

Jede Prüfung und Übermittlung speichert Haben mit Text, Transfer-Ticket und dem gesendeten XML; ändern oder löschen lässt sich das nicht. Ein Übertragungsprotokoll als PDF gibt es für Nachrichten nicht, das Transfer-Ticket ist der Nachweis.

Für die Anschrift im Absender braucht ELSTER Straße und Hausnummer getrennt; Haben trennt die Hausnummer am Ende der Straße ab. Fehlt sie, meldet die Seite das.
