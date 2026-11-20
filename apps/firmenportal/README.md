# haben-firmenportal

Firmenportal für [Haben](https://github.com/Speicherstadt/haben), die selbst gehostete Buchhaltung, wenn man mehrere Firmen mit je einer eigenen Instanz betreibt. Wer sich per SSO anmeldet, sieht die Firmen, in deren Inhaber-Gruppe er beim Anmeldedienst ist, und wechselt mit einem Klick dorthin. In Haben führt die Zeile „Zum Firmenportal“ hierher (`HABEN_FIRMENPORTAL_URL`).

- Keine Datenbank und keine Buchhaltungsdaten: Das Firmenportal kennt nur Namen, Adressen und Gruppen aus `PORTAL_FIRMEN`, dazu wahlweise Farbe und Logo jeder Firma (Logos aus `PORTAL_LOGOS`; Logo und Farbe gibt es nur für angemeldete Personen, die die Firma sehen). Sitzung und ID-Token (für die Abmeldung beim Anmeldedienst) liegen 15 Minuten in signierten, nicht verschlüsselten `HttpOnly`-Cookies.
- Kein Proxy: Die Instanz meldet beim selben Anmeldedienst selbst an.
- Die Gruppen der Steuerberatung zählen nicht.

Einrichtung: [Installation › Firmenportal](https://haben.app/installation.html#firmenportal), Vorlagen in [`deploy/firmenportal`](https://github.com/Speicherstadt/haben/tree/main/deploy/firmenportal).

Die Tags folgen Haben (`:latest`, `:0.2`, `:0.2.0`, `:next`).
