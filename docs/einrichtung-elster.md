---
title: "ELSTER in Haben einrichten: Zertifikat und Hersteller-ID"
description: >-
  Was du für ELSTER brauchst: Zertifikatsdatei, eigene Hersteller-ID, ERiC-Version, und warum Haben anders als Lexoffice mit deinem Zertifikat sendet.
---

# ELSTER einrichten

Haben übermittelt Voranmeldung, Jahreserklärungen und Nachrichten über ERiC, die offizielle Bibliothek der Steuerverwaltung, und holt darüber Bescheide aus dem ELSTER-Postfach. Ohne ERiC laufen Prüfen und Senden simuliert, und die Oberfläche weist darauf hin. Welcher Weg zum Finanzamt ohne Hersteller-ID bleibt, steht in [Abgabe an ELSTER](elster-abgabe.md).

## Was du brauchst

| | Wofür | Woher | Dauer |
| --- | --- | --- | --- |
| **ERiC** | Bibliothek der Finanzverwaltung: prüft, verschlüsselt und überträgt | Haben lädt sie selbst, siehe [Schritte](#schritte) | Minuten |
| **Hersteller-ID** (fünf Ziffern) | Kennung der Software in jeder Übermittlung; ERiC verlangt sie seit Version 43 schon fürs Prüfen | ELSTER-Entwicklerbereich: auf elster.de als Entwickler registrieren, das Bayerische Landesamt für Steuern prüft den Antrag | Tage bis Wochen |
| **Zertifikatsdatei** (.pfx) und PIN | unterschreibt jede Übermittlung | ELSTER-Benutzerkonto mit der Anmeldeart „Zertifikatsdatei“, siehe [unten](#zertifikatsdatei-statt-elster-secure) | ein bis zwei Wochen (Brief) |

Bis Hersteller-ID und Zertifikat da sind, arbeitest du normal: Belege, Rechnungen, Bank, Auswertungen, Voranmeldung und Jahreserklärungen rechnet Haben vollständig, Prüfen und Senden laufen simuliert. Abgeben kannst du in der Zwischenzeit in Mein ELSTER: die Voranmeldung per XML-Import, alle Formulare mit der Erweiterung „Haben für Mein ELSTER“, mit einem KI-Assistenten oder von Hand. Die Wege im Vergleich: [Abgabe an ELSTER](elster-abgabe.md).

## Zertifikatsdatei statt ELSTER Secure

Haben unterschreibt über ERiC, und ERiC braucht eine Zertifikatsdatei mit PIN. Mit der App ELSTER Secure meldest du dich nur im Browser bei Mein ELSTER an; Programme wie Haben können sie nicht nutzen.

Ein ELSTER-Benutzerkonto hat genau eine Anmeldeart. Du legst deshalb ein zweites Konto an; dein bisheriges bleibt:

1. Auf elster.de **Benutzerkonto erstellen**, Anmeldeart **Zertifikatsdatei**, **Für mich** mit deiner Steuer-ID. Das persönliche Konto reicht auch für Umsatzsteuer und EÜR deines Einzelunternehmens und ist für den [Belegabruf](jahreserklaerung.md) zur Einkommensteuer nötig.
2. Die Aktivierungs-ID kommt per E-Mail, der Aktivierungscode per Post.
3. Mit beiden das Konto aktivieren, die `.pfx`-Datei herunterladen und die PIN festlegen. Das Zertifikat gilt drei Jahre.

## Hersteller-ID: wer ist Hersteller?

Die Hersteller-ID gehört dem Softwarehersteller, nicht dem Steuerpflichtigen. Bei gekaufter Software senden alle Kunden mit der ID des Anbieters. Bei Haben ist jeder, der es betreibt, selbst Hersteller: Jede Installation trägt ihre eigene ID in `ELSTER_HERSTELLER_ID` ein, Haben bringt keine mit.

Betreibst du Haben für andere mit deiner ID, bist du für sie Softwarehersteller im Sinne des ERiC-Lizenzvertrags (`lizenz.pdf` im ERiC-Paket):

- Den Support für diese Nutzer leistest du (§ 7).
- Du setzt mindestens die Mindestversion von ERiC ein, die ELSTER vorgibt (§ 5).
- Die Nutzer bestätigen vor der ersten Nutzung die Datenschutzhinweise der Finanzverwaltung (§ 5); das fragt Haben unter **Einstellungen › ELSTER › ERiC** ab.

Bei Verstößen kann das Landesamt die Hersteller-ID sperren (§ 9); dann kann niemand mehr damit senden. Wer Haben verändert und weitergibt, braucht eine eigene ID (§ 4). Die Hersteller-ID ist kein Geheimnis, sie steht in jeder Übermittlung. Trag sie trotzdem nur in `.env` bzw. `haben.env` ein, nicht ins Repository oder Image.

## Open Source und die Hersteller-ID

Die Hersteller-ID ist für Software gedacht, hinter der ein Hersteller mit einem Produkt steht. Für ein freies Projekt wie Haben passt das schlecht: Jeder, der es betreibt oder verändert, ist selbst Hersteller und braucht eine eigene ID. Eine gemeinsame ID für ein Open-Source-Projekt sieht ELSTER nicht vor. Das ist seit Langem bekannt; schon 2005 kritisierte [netzpolitik.org](https://netzpolitik.org/2005/elster-in-der-kritik/), dass die Hersteller-ID an Produkt und Hersteller gebunden ist und freie Software damit kaum vorgesehen ist.

Eine offizielle Aussage der Finanzverwaltung zu Open-Source-Projekten haben wir nicht gefunden. Zuständig ist das Bayerische Landesamt für Steuern, das ELSTER bundesweit koordiniert. Registrierung und Hersteller-ID laufen über die [ELSTER-Entwicklerseite](https://www.elster.de/eportal/infoseite/entwickler); mit dem Zugang zum Entwicklerbereich kannst du dort auch nachfragen, wie das Landesamt freie Software sieht. Erfährst du dabei etwas, freuen wir uns über ein Issue, damit es hier stehen kann.

## Warum Lexoffice ohne dein Zertifikat sendet

Cloud-Dienste wie Lexware Office übermitteln in deinem Auftrag mit ihrem eigenen Zertifikat (Datenübermittlung im Auftrag, [§ 87d AO](https://www.gesetze-im-internet.de/ao_1977/__87d.html)). Der Anbieter muss sich dafür vor der Übermittlung Gewissheit über Person und Anschrift jedes Auftraggebers verschaffen und das festhalten. Diese Aufzeichnungen bewahrt er fünf Jahre auf, gerechnet ab dem Ende des Jahres der letzten Übermittlung, und kann so lange jederzeit sagen, wer Auftraggeber war (Abs. 2). Die Daten legt er dem Auftraggeber in leicht nachprüfbarer Form zur Zustimmung vor (Abs. 3). Haben läuft auf deinem eigenen Server, ohne Anbieter dazwischen: Du sendest selbst und brauchst dein eigenes Zertifikat.

## Schritte

1. **ERiC laden:** unter **Einstellungen › ELSTER › ERiC** den Nutzungsbedingungen zustimmen und **Herunterladen und einrichten** klicken. ERiC darf nicht weitergegeben werden und liegt deshalb weder im Repository noch im Image; Haben holt es direkt von der Finanzverwaltung (Linux x86_64).
2. **Oder von Hand:** das Paket z. B. nach `/opt/eric` entpacken (darin `lib/libericapi.so` und `lib/plugins/`) und `ERIC_HOME` setzen. Beides steht in [ERiC einbinden](installation-anbindungen.md#eric-einbinden).
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

## Welche ERiC-Version

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
