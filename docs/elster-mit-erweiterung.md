# In Mein ELSTER mit der Erweiterung abgeben

Ohne eigene **Hersteller-ID** sendet Haben nicht selbst an das Finanzamt ([einrichtung.md › Hersteller-ID](einrichtung.md#hersteller-id-wer-ist-hersteller)). Die Erklärungen gibst du dann im Portal **Mein ELSTER** ab. Die Browser-Erweiterung **Haben für Mein ELSTER** trägt die Werte aus Haben dort ein, für alle vier Formulare:

| Formular in Mein ELSTER | Werte in Haben | Weitere Wege ohne Hersteller-ID |
| --- | --- | --- |
| Umsatzsteuer-Voranmeldung | **Umsatzsteuer** › Monat › „Werte für Mein ELSTER kopieren“ | [XML-Import](umsatzsteuer.md#ohne-hersteller-id-xml-import-in-mein-elster) |
| Umsatzsteuererklärung | **Jahreserklärung** › Jahr › Umsatzsteuererklärung | – |
| Anlage EÜR | **Jahreserklärung** › Jahr › Anlage EÜR | – |
| Einkommensteuererklärung | **Jahreserklärung** › Jahr › Einkommensteuererklärung | – |

Mit eigener Hersteller-ID sendet Haben alle vier direkt über ERiC; den [KI-Assistenten](elster-mit-assistent.md) gibt es für alles, was die Erweiterung nicht abdeckt. Alle Wege im Vergleich: [Abgabe an ELSTER](elster-abgabe.md).

## Wie es funktioniert

- **Du meldest dich selbst bei Mein ELSTER an**, wie immer (Zertifikatsdatei, ELSTER Secure oder Ausweis). Haben und die Erweiterung kennen weder Passwort noch Zertifikat noch Steuer-ID, und Haben verbindet sich nicht mit ELSTER.
- **Haben liefert die Werte**: „Werte für Mein ELSTER kopieren“ legt eine Liste aus Feldkennung und Wert in die Zwischenablage. Die Werte stammen aus genau dem XML, das Haben über ERiC senden würde.
- **Die Erweiterung trägt sie ein**: Mein ELSTER benennt jedes Eingabefeld nach seiner amtlichen Kennung und führt dazu den Pfad im ERiC-XML. Die Erweiterung sucht auf der geöffneten Seite jedes Feld mit einer Kennung aus der Liste und trägt den Wert ein. Sie rät nichts aus Beschriftungen.
- **Du blätterst, prüfst und sendest**: Die Erweiterung klickt nie. Seiten wechseln, „Eintrag übernehmen“, „Prüfen“ und „Absenden“ machst du in Mein ELSTER.

| Formular | Beispiel für ein Feld in Mein ELSTER | Kennung |
| --- | --- | --- |
| Voranmeldung 2026 | `data-eru-name="/Anmeldungssteuern/Steuerfall/Umsatzsteuervoranmeldung/Kz81"` | Kz81 |
| Umsatzsteuererklärung 2025 | `fields[eruUSt2AUmsaetzeTabelleUms_allgE3003303]` | E3003303 |
| Anlage EÜR 2025 | `data-eru-name="/EUER/BEin/USt_StPflicht/Sum/E6000401"` | E6000401 |
| Einkommensteuer 2025 | `data-eru-name="/S/Gewinn/Freiber_T/E0803202"` | E0803202 |

Die Werte liegen nur im Sitzungsspeicher der Erweiterung und sind weg, sobald du den Browser schließt. Die Erweiterung schickt nichts an Haben, an Anthropic oder sonst wohin; sie liest und schreibt nur auf `www.elster.de/eportal/interpreter/eingabe/…`.

## Einrichten

Die Erweiterung liegt im Quelltext von Haben unter `apps/elster-helfer`. Sie läuft in Chrome, Edge, Brave und anderen Chromium-Browsern.

1. Den Ordner `apps/elster-helfer` aus dem [Repository](https://github.com/firsttris/haben/tree/main/apps/elster-helfer) herunterladen (oder das Repository klonen).
2. Im Browser `chrome://extensions` öffnen (Brave: `brave://extensions`), oben rechts den **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** und den Ordner `elster-helfer` wählen.
4. Die Erweiterung über das Puzzle-Symbol an die Symbolleiste anheften.

## Abgeben

1. In Haben bei der Voranmeldung bzw. Jahreserklärung auf **Werte für Mein ELSTER kopieren** klicken. Der Knopf erscheint, solange keine eigene Hersteller-ID eingerichtet ist; er ist gesperrt, solange Prüfungen Fehler zeigen oder ein Entwurf der Voranmeldung nicht gespeichert ist.
2. Auf das Symbol der Erweiterung klicken, die Werte einfügen und **Werte übernehmen**.
3. In Mein ELSTER das Formular für denselben Zeitraum öffnen (Formulare und Leistungen › Formular › Jahr), „Ohne Datenübernahme fortfahren“, bei Jahreserklärungen die Anlagen wählen.
4. Seite für Seite durchgehen. Auf jeder Seite trägt die Erweiterung ein, was dorthin gehört, und rahmt die Felder grün. Unten rechts steht eine Leiste mit:
   - **eingetragen**: was die Erweiterung gerade gesetzt hat;
   - **vorbereitet**: In der Anlage EÜR (und in der Anlage S der Einkommensteuer) sind Summenfelder gesperrt; Mein ELSTER rechnet sie aus Einzelposten. Die Erweiterung füllt die freie Zeile darüber (Bezeichnung „Laut Haben“, Betrag aus Haben) und rahmt den Knopf **Eintrag übernehmen**. Den klickst du;
   - **rechnet Mein ELSTER**: gesperrte Felder wie die Steuer zu Kz 81 und Kz 83 der Voranmeldung füllt Mein ELSTER selbst. Sobald dort ein Wert steht, vergleicht die Erweiterung ihn mit Haben und meldet eine Abweichung;
   - **abweichend**: Felder, in denen schon ein anderer Wert stand, etwa aus dem Vorjahr übernommen. Die Erweiterung überschreibt sie nicht von selbst. Prüfe, welcher stimmt; mit **Abweichende mit Haben überschreiben** trägt sie die Werte aus Haben ein;
   - **von Hand**: Mehrfachzeilen wie Anlagegüter, Kinder oder Beiträge je Person. Diese Zeilen legst du in Mein ELSTER an („Weitere Daten hinzufügen“) und trägst die angezeigten Werte ein; im Editor einer Zeile trägt die Erweiterung einzelne Werte auch selbst ein;
   - **gehört zur Anlage einer anderen Person**: siehe unten;
   - **noch auf keiner besuchten Seite gefunden**: Werte, deren Feld du noch nicht geöffnet hast. Darunter stehen auch Angaben, die Mein ELSTER aus deinem Profil nimmt (Name, Steuernummer).
5. Nach der letzten Seite in Mein ELSTER **Prüfen**, Fehler und Hinweise mit Haben abgleichen und selbst **Absenden**.
6. Das Übermittlungsprotokoll herunterladen. In Haben bleibt die Erklärung bzw. Voranmeldung ungesendet; Haben erfährt von der Abgabe in Mein ELSTER nichts.

Hast du eine Seite verlassen und kommst zurück, trägt die Erweiterung erneut ein; was schon gleich ist, lässt sie stehen. „Erneut eintragen“ in der Leiste wiederholt das für die offene Seite.

### Umsatzsteuer-Voranmeldung

Die Werte enthalten Monat und Kennzahlen. Auf der Startseite des Formulars wählt die Erweiterung den **Voranmeldungszeitraum**, wenn er noch leer ist. Die Steuer zu Kz 81 und 86 und die Zahllast Kz 83 rechnet Mein ELSTER; die Erweiterung vergleicht sie nur mit Haben. Kz 09 (Hersteller-ID) gehört nicht ins Formular und fehlt in den Werten.

### Einkommensteuer

Mein ELSTER füllt die Einkommensteuererklärung aus dem gewählten Haushalt und der Vorjahresabgabe vor; viele Felder haben also schon Werte. Die Erweiterung zeigt sie als **abweichend**, wenn Haben etwas anderes hat, und überschreibt sie nur auf deinen Klick.

Anlagen wie **S**, **N** und **Vorsorgeaufwand** führt Mein ELSTER je Person, mit dem Namen in der Überschrift: „Anlage S (Erika Muster)“. Haben gibt die Namen beider Personen aus den Steuerdaten mit; die Erweiterung trägt Werte einer Person nur auf deren Anlage ein. Stimmen die Namen in Haben und Mein ELSTER nicht überein, erkennt sie die Person nicht und listet die Werte unter „gehört zur Anlage einer anderen Person“.

Der Gewinn aus freiberuflicher Tätigkeit steht in der Anlage S als Eintrag einer Liste („Gewinn aus freiberuflicher Tätigkeit“). Öffne den Eintrag mit **Eintrag bearbeiten** (oder lege ihn mit „Weitere Daten hinzufügen“ an); im Editor trägt die Erweiterung Tätigkeit und Betrag ein, übernehmen klickst du.

## Grenzen

- Geprüft an den Formularen Voranmeldung 2026, Umsatzsteuererklärung 2025, Anlage EÜR 2025 und Einkommensteuer 2025 in Mein ELSTER (Stand November 2026): Feldnamen, gesperrte Summen mit Einzelposten, gerechnete Felder, Anlagen je Person und der Editor einer Zeile. Ein vollständiger Durchlauf mit echten Werten bis zum Prüfen in Mein ELSTER steht noch aus.
- Ändert Mein ELSTER die Feldnamen, findet die Erweiterung die Felder nicht mehr; sie listet die Werte dann unter „noch auf keiner besuchten Seite gefunden“.
- Mehrfachzeilen legt sie nicht selbst an.
- Werte in Auswahllisten setzt sie nur, wenn die Liste genau diesen Schlüssel anbietet; sonst steht das Feld unter „Ließ sich nicht setzen“.
- Wie beim [KI-Assistenten](elster-mit-assistent.md) ist offen, wie die Nutzungsbedingungen von Mein ELSTER das Ausfüllen durch eine Erweiterung sehen ([#124](https://github.com/firsttris/haben/issues/124)). Die Verantwortung für die Abgabe liegt bei dir.
