# haben-portal

Portal für [Haben](https://github.com/firsttris/haben), die selbst gehostete Buchhaltung, wenn man mehrere Firmen mit je einer eigenen Instanz betreibt. Wer sich per SSO anmeldet, sieht die Firmen, in deren Inhaber-Gruppe er beim Anmeldedienst ist, und wechselt mit einem Klick dorthin. In Haben führt „Firma wechseln“ hierher (`HABEN_PORTAL_URL`).

- Keine Datenbank und keine Buchhaltungsdaten: Das Portal kennt nur Namen, Adressen und Gruppen aus `PORTAL_FIRMEN`. Die Sitzung liegt 15 Minuten in einem signierten Cookie.
- Kein Proxy: Die Instanz meldet beim selben Anmeldedienst selbst an.
- Die Gruppen der Steuerberatung zählen nicht.

Einrichtung: [Installation › Portal](https://haben.app/installation.html#portal), Vorlagen in [`deploy/portal`](https://github.com/firsttris/haben/tree/main/deploy/portal).

Die Tags folgen Haben (`:latest`, `:0.2`, `:0.2.0`, `:next`).
