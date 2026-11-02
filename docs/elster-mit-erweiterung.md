# Jahreserklärungen in Mein ELSTER mit der Erweiterung

Ohne eigene **Hersteller-ID** sendet Haben nicht selbst an das Finanzamt ([einrichtung.md › Hersteller-ID](einrichtung.md#hersteller-id-wer-ist-hersteller)). Die Erklärungen gibst du dann im Portal **Mein ELSTER** ab. Für die **Voranmeldung** gibt es dort einen XML-Import ([Umsatzsteuer › XML-Import](umsatzsteuer.md#ohne-hersteller-id-xml-import-in-mein-elster)). Für **Umsatzsteuererklärung, Anlage EÜR und Einkommensteuererklärung** bietet Mein ELSTER keinen Import an; hier trägt die Browser-Erweiterung **Haben für Mein ELSTER** die Werte ein.

## Wie es funktioniert

- **Du meldest dich selbst bei Mein ELSTER an**, wie immer (Zertifikatsdatei, ELSTER Secure oder Ausweis). Haben und die Erweiterung kennen weder Passwort noch Zertifikat noch Steuer-ID.
- **Haben liefert die Werte**: Auf der Seite **Jahreserklärung** kopiert „Werte für Mein ELSTER kopieren“ eine Liste aus Feldkennung und Wert in die Zwischenablage. Die Werte stammen aus genau dem XML, das Haben über ERiC senden würde.
- **Die Erweiterung trägt sie ein**: Mein ELSTER benennt jedes Eingabefeld nach seiner amtlichen Feldkennung, zum Beispiel heißt das Feld für umsatzsteuerpflichtige Betriebseinnahmen der EÜR `fields[eruEUERBEinUSt_StPflichtSumE6000401]`. Die Erweiterung sucht auf der geöffneten Seite jedes Feld mit einer Kennung aus der Liste und trägt den Wert ein. Sie rät nichts aus Beschriftungen.
- **Du blätterst, prüfst und sendest**: Die Erweiterung klickt nie. Seiten wechseln, „Prüfen“ und „Absenden“ machst du in Mein ELSTER.

Die Werte liegen nur im Sitzungsspeicher der Erweiterung und sind weg, sobald du den Browser schließt. Die Erweiterung schickt nichts an Haben, an Anthropic oder sonst wohin; sie liest und schreibt nur auf `www.elster.de/eportal/interpreter/eingabe/…`.

## Einrichten

Die Erweiterung liegt im Quelltext von Haben unter `apps/elster-helfer`. Sie läuft in Chrome, Edge, Brave und anderen Chromium-Browsern.

1. Den Ordner `apps/elster-helfer` aus dem [Repository](https://github.com/firsttris/haben/tree/main/apps/elster-helfer) herunterladen (oder das Repository klonen).
2. Im Browser `chrome://extensions` öffnen (Brave: `brave://extensions`), oben rechts den **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** und den Ordner `elster-helfer` wählen.
4. Die Erweiterung über das Puzzle-Symbol an die Symbolleiste anheften.

## Erklärung abgeben

1. In Haben unter **Jahreserklärung** das Jahr öffnen. Bei der Erklärung, etwa der Anlage EÜR, auf **Werte für Mein ELSTER kopieren** klicken. Der Knopf erscheint, solange keine eigene Hersteller-ID eingerichtet ist; er ist gesperrt, solange die Prüfungen der Erklärung Fehler zeigen.
2. Auf das Symbol der Erweiterung klicken, die Werte in das Feld einfügen und **Werte übernehmen**.
3. In Mein ELSTER das Formular für dasselbe Jahr öffnen (Formulare und Leistungen › z. B. Einnahmenüberschussrechnung (Anlage EÜR) › Jahr), „Ohne Datenübernahme fortfahren“, die Anlagen wählen.
4. Seite für Seite durchgehen. Auf jeder Seite trägt die Erweiterung ein, was dorthin gehört, und rahmt die Felder grün. Unten rechts steht eine Leiste mit:
   - **eingetragen**: was die Erweiterung gerade gesetzt hat;
   - **vorbereitet**: In der Anlage EÜR sind die Summenfelder in Mein ELSTER gesperrt; Mein ELSTER rechnet sie aus Einzelposten. Die Erweiterung füllt deshalb die freie Zeile darüber (Bezeichnung „Laut Haben“, Betrag aus Haben) und rahmt den Knopf **Eintrag übernehmen** grün. Den klickst du, danach steht die Summe da;
   - **abweichend**: Felder, in denen schon ein anderer Wert stand. Die Erweiterung überschreibt nichts; prüfe, welcher stimmt;
   - **von Hand**: Mehrfachzeilen wie Anlagegüter oder Kinder. Diese Zeilen legst du in Mein ELSTER erst an („Hinzufügen“) und trägst die angezeigten Werte selbst ein;
   - **noch auf keiner besuchten Seite gefunden**: Werte, deren Feld du noch nicht geöffnet hast. Darunter stehen auch Angaben, die Mein ELSTER aus deinem Profil nimmt (Name, Steuernummer).
5. Nach der letzten Seite in Mein ELSTER **Prüfen**, Fehler und Hinweise mit Haben abgleichen und selbst **Absenden**.
6. Das Übermittlungsprotokoll herunterladen. In Haben bleibt die Erklärung ungesendet; Haben erfährt von der Abgabe in Mein ELSTER nichts.

Hast du eine Seite verlassen und kommst zurück, trägt die Erweiterung erneut ein; was schon gleich ist, lässt sie stehen. „Erneut eintragen“ in der Leiste wiederholt das für die offene Seite.

## Grenzen

- Geprüft an den Formularen Anlage EÜR 2025 und Umsatzsteuererklärung 2025 in Mein ELSTER (Stand November 2026): Feldnamen, gesperrte Summen mit Einzelposten-Zeile und der Knopf „Eintrag übernehmen“. Ein vollständiger Durchlauf mit echten Werten bis zum Prüfen in Mein ELSTER steht noch aus. Ändert Mein ELSTER die Feldnamen, findet die Erweiterung die Felder nicht mehr; sie listet die Werte dann unter „noch auf keiner besuchten Seite gefunden“.
- Mehrfachzeilen trägt sie nicht selbst ein (siehe oben).
- Felder, die Mein ELSTER aus dem Profil füllt (Steuernummer, Name, Anschrift), bleiben unberührt, wenn dort schon etwas steht.
- Werte in Auswahllisten setzt sie nur, wenn die Liste genau diesen Schlüssel anbietet; sonst steht das Feld unter „Ließ sich nicht setzen“.
- Wie beim [KI-Assistenten](elster-mit-assistent.md) ist offen, wie die Nutzungsbedingungen von Mein ELSTER das Ausfüllen durch eine Erweiterung sehen ([#124](https://github.com/firsttris/haben/issues/124)). Die Verantwortung für die Abgabe liegt bei dir.
