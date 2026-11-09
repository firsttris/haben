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
