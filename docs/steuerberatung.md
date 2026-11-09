---
title: "Lesezugang für die Steuerberatung"
description: >-
  Der Steuerberatung einen eigenen Lesezugang geben: Auswertungen, Journal, Kontenblätter, Belege
  und Rechnungen direkt einsehen und exportieren.
---

# Zugang für die Steuerberatung

Deine Steuerberatung kann mit einem eigenen Zugang direkt in Haben nachsehen, statt auf den nächsten Export zu warten. Der Zugang kann nur lesen: Er sieht Auswertungen, Journal, Kontenblätter, Belege und Rechnungen und lädt Dateien, den DATEV-Export und das Jahresarchiv herunter. Buchen, Festschreiben, Ändern, Löschen und Senden an ELSTER bleiben bei dir.

## Rollen

Haben kennt zwei Rollen:

| Rolle | Wer | Was |
| --- | --- | --- |
| **Inhaber** | Das Konto aus der [Einrichtung](einrichtung.md#konto-anlegen), genau eines | Alles |
| **Steuerberatung** | Jedes weitere Konto, nur per Einladung | Nur lesen |

Die Steuerberatung sieht:

- **Auswertungen** (EÜR, offene Posten, Monatsverlauf) und ihre CSV-Dateien
- **Buchungen** (Journal) und **Konten** (Saldenliste, Kontenblätter) mit CSV
- **Belege** mit Originaldatei
- **Rechnungen**, nur festgeschriebene, mit PDF, XML und Anhängen, dazu ihre Mahnungen
- **Exporte**: Jahresarchiv (ZIP), DATEV-Buchungsstapel, Saldenliste. Mit [Personenkonten im DATEV-Export](auswertungen.md#personenkonten) lädt die Steuerberatung den Stapel nur, wenn alle Debitoren und Kreditoren darin schon einmal vom Inhaber exportiert und damit festgeschrieben sind; sonst nennt Haben die neuen Nummern, und der Inhaber lädt den Stapel einmal selbst herunter

Nicht für die Steuerberatung sind: buchen, festschreiben, stornieren, ändern, löschen, hochladen, senden an ELSTER oder per E-Mail, die Einstellungen (Firmendaten, Nummernkreise, E-Mail, Eigene Seiten), ELSTER-Zertifikat und PIN, Bankzugang und SEPA-Überweisungen, API-Tokens für [KI-Assistenten](ki-assistenten.md) und die [REST-API](api.md), die Verwaltung der Zugänge. Ebenfalls beim Inhaber bleiben in dieser ersten Stufe Angebote, Bank, Kasse, Anlagen, Lohn, Umsatzsteuer, Jahreserklärungen, Finanzamt, Jahresabschluss und das Archiv aus dem Umzug; was davon für die Steuerberatung zählt, steht im Jahresarchiv.

Was die Steuerberatung nicht darf, blendet Haben aus. Das allein schützt aber nichts: Der Server prüft bei jeder Anfrage die Rolle (siehe [Architektur](architektur.md#anmeldung)) und lehnt alles Schreibende der Steuerberatung ab, auch wenn jemand die Anfrage von Hand stellt.

## Einladen

Einladungen gibt es im Standardmodus. Im SSO-Modus entsteht der Zugang ohne Einladung, siehe [Im SSO-Modus](#im-sso-modus).

1. Unter **Einstellungen › Sicherheit › Zugänge** eine Bezeichnung eintragen, etwa den Namen der Kanzlei, und **Einladungslink erzeugen**.
2. Den Link kopieren und der Steuerberatung auf einem sicheren Weg schicken. Haben zeigt ihn nur dieses eine Mal; gespeichert ist nur ein Hash.
3. Die Steuerberatung öffnet den Link, trägt Name, E-Mail und ein Passwort mit mindestens 12 Zeichen ein und legt den Zugang an. Danach kann sie einen Passkey hinzufügen und meldet sich künftig damit an.

Ein Link gilt **einmal** und **72 Stunden**. Ist er abgelaufen oder verloren, erzeugst du einen neuen; einen offenen Link ziehst du mit **Zurückziehen** zurück. Wer den Link hat, kann damit den Zugang anlegen. Ohne Einladung legt niemand ein Konto an: Der Einrichtungscode gilt nur für das erste Konto, und Haben lehnt jede Registrierung ohne gültige Einladung ab.

## Was sich geändert hat

Nach der Anmeldung landet die Steuerberatung auf ihrer Startseite **Steuerberatung**. Dort steht, was seit ihrem letzten Besuch dazugekommen ist, ähnlich dem Beleg-Alert in Lexware Office: neue und gebuchte Belege, festgeschriebene Rechnungen und Buchungen. Tragen neue Buchungen ein Datum vor dem letzten Besuch, weist Haben darauf hin, weil sie einen Zeitraum ändern, den die Steuerberatung vielleicht schon angesehen hat. Darunter stehen die Exporte je Jahr und die eigenen Passkeys.

Als Inhaber siehst du dieselbe Seite unter `/steuerberatung`, um zu prüfen, was deine Steuerberatung sieht.

## Sperren und entfernen

In der Liste der Zugänge steht bei jedem Konto die Rolle und die letzte Anmeldung.

- **Sperren** beendet alle Sitzungen des Zugangs sofort und verhindert jede weitere Anmeldung, auch per Passkey. **Freigeben** hebt die Sperre auf.
- **Entfernen** löscht den Zugang mit Passwort, Passkeys und Sitzungen. Name, E-Mail und Rolle bleiben im Änderungsprotokoll, ebenso jede frühere Anmeldung.

Den Zugang des Inhabers kann man weder sperren noch entfernen.

## Protokoll

Jede Anmeldung steht mit Zeitpunkt, Konto, Rolle und Art (Passwort, Passkey, SSO, nach der Einladung) im Änderungsprotokoll, das als Hash-Kette gegen nachträgliche Änderung gesichert ist ([Buchhaltung in Haben](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel)). Im SSO-Modus stehen dort auch jede Bestätigung, Änderung und jeder Entzug der Rolle (`sso_roles`) und jede Übernahme eines bestehenden Kontos durch den Betreiber. Ebenso stehen dort jedes Konto mit seiner Rolle, jede Einladung und jedes Sperren und Entfernen, jeweils mit dem Konto, das es getan hat. Jede Änderung trägt die ID des handelnden Kontos; Name und Rolle dazu stehen in derselben Kette. Passwörter und Sitzungen stehen nicht darin.

## Sicherheit

- Die Rolle eines Kontos ändert sich nie, auch nicht durch einen Fehler im Code: Die Datenbank lehnt das ab. Über eine Einladung entsteht nie ein zweiter Inhaber.
- Für die Steuerberatung lehnt der Server jede schreibende Anfrage ab. Selbst eine Funktion, die nur lesen soll, kann für sie nichts ins Änderungsprotokoll schreiben; Haben bricht sie dann ab.
- Zertifikat, PIN, Zugangsdaten für Bank, E-Mail und Lexware Office sowie API-Tokens liefert Haben an die Steuerberatung nicht aus.
- Anmeldeversuche sind wie beim Inhaber auf 20 je Minute begrenzt.

## Was noch fehlt

- Weitere Rollen, etwa Mitarbeitende, die Belege hochladen, oder eine Steuerberatung, die Belege bucht.
- Bank, Kasse, Anlagen, Lohn, Umsatzsteuer, Jahreserklärungen, Jahresabschluss und das Archiv aus dem Umzug für die Steuerberatung zum Ansehen.
- Kommentare oder Rückfragen der Steuerberatung an einem Beleg.

## Im SSO-Modus

Läuft Haben mit `OIDC_ONLY=true`, entscheiden die Gruppen im Anmeldedienst (etwa Authelia), wer die Steuerberatung ist: Mitglieder der Gruppe aus `OIDC_GROUP_STEUERBERATUNG` bekommen bei ihrer ersten Anmeldung automatisch einen Zugang mit Lesezugriff, ohne Einladung, Passwort oder Passkey. Die Rechte sind dieselben wie oben.

- **Einstellungen › Zugänge** zeigt statt „Sicherheit“ die schon angemeldeten Konten mit ihrer zuletzt bestätigten Rolle. Einladen, Sperren und Entfernen gibt es dort nicht; das geschieht über die Gruppen.
- Wer aus der Gruppe genommen wird, verliert den Zugang bei der nächsten Anmeldung sofort, sonst spätestens nach 15 Minuten. Eine Abmeldung in Authelia beendet die Haben-Sitzung nicht sofort.
- Die Steuerberatung kann eine neue Instanz nicht erstmals einrichten; das macht ein Inhaber.
- Alte Einladungslinks zeigen „Einladungen nicht verfügbar“.

Einrichtung, Authelia-Beispiel und Umstellung bestehender Konten: [Single Sign-on mit OpenID Connect](installation.md#single-sign-on-mit-openid-connect).

[Zurück zur Übersicht](ueberblick.md)

Bei einer Herabstufung vom Inhaber zur Steuerberatung werden beim geprüften SSO-Durchlauf zusätzlich die verantworteten API-/MCP- und Kalender-Tokens deaktiviert. Ein anderer Inhaber kann diese übernehmen; die Steuerberatung darf keine Tokens reaktivieren. Ohne erneute Anmeldung gelten die Tokens höchstens 30 Tage nach der letzten Bestätigung.
