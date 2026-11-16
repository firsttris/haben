---
title: "Verfahrensdokumentation nach GoBD aus Haben"
description: >-
  Haben erzeugt die Verfahrensdokumentation nach GoBD aus dem Stand der Instanz und deinen Angaben zum Betrieb:
  Gliederung nach Rz. 153, Druck, PDF, Markdown und Jahresarchiv.
---

# Verfahrensdokumentation

Die GoBD verlangen für jedes DV-System eine Verfahrensdokumentation, aus der Inhalt, Aufbau, Ablauf und Ergebnisse des Verfahrens für einen sachverständigen Dritten nachvollziehbar sind ([BMF-Schreiben vom 28.11.2019](https://www.lfst.bayern.de/fileadmin/RESSOURCEN/INFORMATIONEN/Steuerinfos/Weitere_Themen/Aussenpruefung/2019-11-28-GoBD-1.pdf), Rz. 151 bis 155). Haben erzeugt sie unter **Einstellungen › Export › Verfahrensdokumentation** bei jedem Aufruf aus dem Stand der Instanz.

> [!IMPORTANT]
> Das Dokument ist eine Vorlage, keine Rechtsberatung. Lass es von deiner Steuerberatung gegenlesen und ergänze, was der Betrieb außerhalb von Haben tut.

## Was Haben einträgt

- **Allgemein:** Firma, Rechtsform und Anschrift aus Einstellungen › Firma, Kontenrahmen, Ist- oder Soll-Versteuerung, Kleinunternehmer, die eingesetzte Version.
- **Erfassung:** Nummernkreise für Rechnungen, Angebote und Kunden, das Postfach für Belege, Bankkonten und Kontoabruf, ob ein ELSTER-Zertifikat hinterlegt ist und wie viele Voranmeldungen gesendet oder vermerkt sind, die Nummern für den DATEV-Export.
- **System:** wie Festschreibung, Siegel, Hash-Kette und Prüfwert arbeiten ([Manipulationserkennung](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel)), mit welcher Datenbankrolle die App läuft und ob ihre Rechte eingeschränkt sind ([Getrennte Datenbankrollen](installation-konfiguration.md#getrennte-datenbankrollen)), ob die Prüfwert-Mail an ist, und alle eingesetzten Versionen mit Link auf ihre Versionshinweise.
- **Betrieb:** jeder Zugang mit Rolle, Beginn, letzter Anmeldung und Sperre ([Anmeldung](architektur-anmeldung.md)), gültige API-Tokens mit Rechten, wenn der Zugang für Programme an ist, dazu Ziel, letzte Sicherung und letzter [Test-Restore](installation-backup.md#test-restore) des Backup-Containers.

Geheimnisse stehen nicht darin: keine Passwörter, Schlüssel, Token oder das Zertifikat. Aus der Adresse des Backup-Ziels fallen Nutzer und Passwort hinter `://` weg (`rest:https://nutzer:passwort@…`); den Nutzer einer SFTP-Adresse wie `sftp:backup@example.de:/srv/restic/haben` nennt das Dokument. Das Ziel trägt erst ein Backup-Image ein, das so neu ist wie diese Version; bis dahin fehlt es, und die Angabe „Datensicherung“ beschreibt es.

## Angaben zum Betrieb

Was Haben nicht wissen kann, trägst du darunter ein: wer verantwortlich ist und wer vertritt, wo Daten und Sicherungen liegen (§ 146 Abs. 2 bis 2b AO), wie mit Papierbelegen umgegangen wird (Rz. 136 bis 141), wer den Server betreibt und Updates einspielt, wie gesichert wird (Rz. 103 bis 106) und wo Schlüssel und Passwörter verwahrt sind, nur der Ort (Rz. 134). Ergänzungen nehmen alles Übrige auf, etwa weitere Programme.

Fehlt eine Angabe, steht im Dokument „Fehlt: …“, und der Kopf zeigt „Unvollständig“. Die Angaben speichert Haben in der Datenbank, jede Änderung mit altem und neuem Wert im Änderungsprotokoll.

## Fassungen

Jede Fassung trägt das Datum und die Haben-Version. Das [Jahresarchiv](auswertungen.md#jahresexport) enthält die Fassung vom Tag, an dem es erstellt wird, als `verfahrensdokumentation.md`; zusammen mit dem Änderungsprotokoll der Angaben und `protokoll/versionen.csv` bleiben Änderungen so nachvollziehbar, wie Rz. 154 es verlangt.

Zum Weitergeben druckst du die Seite oder sicherst sie im Druckdialog als PDF; Navigation und Formular erscheinen dabei nicht, auch im dunklen Modus kommt das Blatt hell. „Als Markdown“ lädt dieselbe Fassung als Text.

## Gliederung

Die Abschnitte folgen Rz. 153. Was dort nur kurz steht, beschreiben diese Seiten ausführlich:

| Teil nach Rz. 153 | Abschnitt im Dokument | Ausführlich |
| --- | --- | --- |
| Allgemeine Beschreibung | 1 | [Einrichtung](einrichtung.md), [Buchhaltung in Haben](buchhaltung.md) |
| Anwenderdokumentation | 2 | [Rechnungen](rechnungen.md), [Belege](belege.md), [Bank](bank.md), [Kasse](kasse.md), [Umsatzsteuer](umsatzsteuer.md), [Auswertungen und Jahresexport](auswertungen.md) |
| Technische Systemdokumentation | 3 Unveränderbarkeit und Änderungsprotokoll, 4 eingesetzte Versionen | [Buchhaltung in Haben](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel), [Architektur](architektur.md), [Datenmodell](architektur-datenmodell.md) |
| Betriebsdokumentation mit internem Kontrollsystem (Rz. 100 bis 102) und Datensicherung (Rz. 106) | 5 Zugänge und Rechte, 6 Betrieb und Datensicherung | [Anmeldung und SSO-Modus](architektur-anmeldung.md), [Backup und Updates](installation-backup.md), [Konfiguration](installation-konfiguration.md) |

Nicht darin steht, was ein Betrieb über die Software hinaus regelt: eine Organisationsanweisung für ersetzendes Scannen (Rz. 136), Kontrollen außerhalb von Haben und Programme neben Haben. Eine Verfahrensdokumentation ist auch keine ISMS-Dokumentation nach ISO 27001; Risikoanalyse und Richtlinien erstellt der Betrieb selbst.
