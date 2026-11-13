# Sicherheit

## Unterstützte Versionen

Sicherheitsfixes gibt es nur für das neueste Release. Bitte vor einer Meldung auf die neueste Version aktualisieren,
wie unter [Updates](https://haben.app/installation.html#updates) beschrieben.

| Version | Unterstützt |
| --- | --- |
| [neuestes Release](https://github.com/firsttris/haben/releases/latest) | ja |
| ältere Releases | nein |

## Eine Lücke melden

Bitte **kein öffentliches Issue** für ein Sicherheitsproblem. Melde es privat über GitHub:
[Security › Report a vulnerability](https://github.com/firsttris/haben/security/advisories/new).

Eine gute Meldung nennt die Version (steht unten in der Navigation), wie sich das Problem nachstellen lässt und was
ein Angreifer damit erreicht. Keine echten Belegdaten, Steuernummern, IBANs oder Zugangsdaten mitschicken. Wir bestätigen
die Meldung, arbeiten den Fix in einem privaten Security Advisory aus und veröffentlichen es mit dem Release, das ihn
behebt.

Haben verwaltet Buchhaltungsdaten, ELSTER-Zertifikate und Bankzugänge. Besonders wichtig sind deshalb Lücken bei
Anmeldung und Rechten, beim Schutz festgeschriebener Daten (GoBD-Sperren, Audit-Log), bei gespeicherten Geheimnissen
und bei der Übermittlung an ELSTER.

Probleme in PostgreSQL, Caddy, ERiC oder anderen eingebundenen Programmen gehören zu diesen Projekten; macht erst die
Konfiguration von Haben in `deploy/` sie ausnutzbar, bitte hier melden.

## Getrennte Datenbankrollen

Bei [getrennten Rollen](https://haben.app/installation.html#getrennte-datenbankrollen) verwendet die laufende App eine eigene Anmeldung ohne Eigentümer- oder Administrationsrechte. Nur der Migrationsschritt verwendet die Eigentümerverbindung und vergibt anschließend die benötigten Rechte neu. Die mitgelieferten Container-Startskripte geben deren private Verbindungsadresse nicht an den Server weiter. Bestehende Installationen mit einer Adresse bleiben nutzbar; **Einstellungen › Export › Datenbankzugriff** zeigt die tatsächlich wirksamen Rechte.

Die Trennung verhindert, dass die App Sperr-Trigger abschaltet oder Anwendungsobjekte per DDL verändert. Erlaubte Datenänderungen prüfen weiterhin die vorhandenen Trigger. Sie schützt nicht gegen den Betreiber mit Server- oder Eigentümerzugang; dafür bleiben Prüfwerte außerhalb des Servers und Backups erforderlich.

## Abhängigkeiten aktuell halten

Die Abhängigkeiten hält [Renovate](https://github.com/apps/renovate) aktuell (`.github/renovate.json5`, gemeinsame
Einstellungen aus [firsttris/workflows](https://github.com/firsttris/workflows/blob/main/renovate/default.json5)).
Jedes Update kommt als Pull Request und läuft durch die ganze CI, auch die Tests gegen PostgreSQL und die Prüfung der
E-Rechnungen mit dem KoSIT-Validator.

- **Sicherheitslücken:** Renovate erfährt von bekannten Lücken in den Abhängigkeiten aus den Dependabot-Warnungen von
  GitHub und unabhängig davon aus der [OSV-Datenbank](https://osv.dev/). Der Fix kommt außerhalb des Zeitplans als
  eigener Pull Request mit dem Label `security`, frühestens einen Tag nach seinem Release, und wird von Hand gemergt.
- **Übrige Updates:** Minor- und Patch-Updates kommen einmal im Monat gesammelt in einem Pull Request, der sich bei
  grüner CI selbst merged. Hauptversionen warten im Issue „Dependency Dashboard“, bis jemand sie anfordert.
- **Wartezeit:** Ein neues Release übernimmt Renovate erst nach drei Tagen; die meisten fehlerhaften oder
  kompromittierten Releases sind bis dahin zurückgezogen.
- **Eigene Pull Requests mit Prüfliste:** Bun, PostgreSQL, Caddy, restic sowie KoSIT-Validator und
  XRechnung-Konfiguration bekommen je einen eigenen Pull Request, der nicht von selbst merged.
- **Fest eingefrorene Versionen:** CI und Images installieren mit `bun install --frozen-lockfile` genau die Versionen
  aus `bun.lock`; die geteilten Workflows sind per Commit-Hash eingebunden.
- **Nicht über Renovate:** ERiC hebt der Maintainer von Hand, nachdem eine Testübermittlung geklappt hat. Neue
  ERiC-Versionen meldet der Workflow „Jahreswerte prüfen“ wöchentlich als Issue.

Ein Fix erreicht eine Installation mit dem nächsten Release von Haben. Wie du aktualisierst, steht unter
[Updates](https://haben.app/installation.html#updates).
