# Barrierefreiheit und Tastatur

Haben lässt sich vollständig mit der Tastatur bedienen und erfüllt nach den automatischen Prüfungen die Kriterien der WCAG 2.2 auf Stufe AA. Jede Änderung wird in der CI mit [axe-core](https://github.com/dequelabs/axe-core) und eigenen Tastaturtests geprüft (siehe [Wie das geprüft wird](#wie-das-geprüft-wird)).

> [!NOTE]
> Automatische Prüfungen finden etwa ein Drittel bis die Hälfte aller Barrieren. Mit Screenreadern (NVDA, VoiceOver, Orca) ist Haben noch nicht systematisch getestet. Wenn dir etwas auffällt, freuen wir uns über ein [Issue](https://github.com/firsttris/haben/issues).

## Mit der Tastatur bedienen

| Taste | Wirkung |
| --- | --- |
| `Tab` / `Umschalt+Tab` | Zum nächsten bzw. vorigen Bedienelement. Das Element mit dem Fokus hat immer einen sichtbaren Rahmen. |
| `Enter` | Link öffnen, Knopf auslösen, Formular absenden |
| `Leertaste` | Knopf auslösen, Haken setzen, Abschnitt aufklappen |
| `Esc` | Schließt das Menü auf dem Handy; der Fokus steht danach wieder auf **Menü** |

- **Zum Inhalt springen:** Der erste `Tab` auf jeder Seite zeigt den Link **Zum Inhalt springen**. Mit `Enter` überspringst du die Navigation.
- **Nach einem Seitenwechsel** steht der Fokus am Anfang des Inhalts, nicht mehr in der Navigation. Der nächste `Tab` führt zum ersten Element der neuen Seite. Filter und Suche ändern nur die Liste, der Fokus bleibt, wo er ist.
- **Anmelden:** Nach **Passwort verwenden** steht der Fokus im Feld **E-Mail**.
- **Dateien hochladen:** Statt Drag-and-drop öffnen **Dateien auswählen** und **Foto aufnehmen** den Dateidialog des Systems.
- **Diagramm unter Auswertungen:** Mit `Tab` springst du von Monat zu Monat und siehst die Werte. Dieselben Zahlen stehen unter **Als Tabelle anzeigen**.

Tastenkürzel einzelner Seiten:

| Seite | Kürzel |
| --- | --- |
| [Bankabgleich](bank.md#zuordnen) | `Enter` ordnet zu, `J` nächster, `K` voriger Umsatz |
| [Beleg prüfen](belege.md#belege-nacheinander-prüfen) | `J`/`→` nächster, `K`/`←` voriger Beleg, `Strg+Enter` bucht, `Esc` zurück zur Liste |

Die Kürzel wirken nicht, solange der Fokus in einem Eingabefeld steht.

## Darstellung

- **Kontraste:** Text, Links und Knöpfe erreichen in allen sieben Themes mindestens 4,5:1, Fokusrahmen und Bedienelemente mindestens 3:1. In den dunklen Themes (Nacht, Tiefsee) sind Links dafür heller als die Akzentfarbe der Knöpfe.
- **Vergrößern:** Die Seiten passen sich der Breite an. Auch bei 390 px Breite (Handy oder stark vergrößert) gibt es keine waagrechte Bildlaufleiste. Breite Tabellen scrollen dann in ihrer Karte; ist eine Tabelle breiter als der Platz, erreichst du sie mit `Tab` und scrollst mit den Pfeiltasten.
- **Tippflächen** sind mindestens 24 × 24 px groß, Knöpfe und Eingabefelder auf Touch-Geräten 44 px hoch.
- **Weniger Bewegung:** Ist im System „Bewegung reduzieren“ eingestellt, verzichtet Haben auf Übergänge.
- **Sprache:** Die Seiten sind als Deutsch ausgezeichnet (`lang="de"`), damit Vorlese- und Übersetzungsprogramme richtig betonen.

## Wie das geprüft wird

`apps/web/e2e/barrierefreiheit.spec.ts` läuft in der CI nach dem Durchlauf in `app.spec.ts`, also mit Kunden, Rechnungen, Belegen und Bankumsätzen in der Datenbank:

1. **axe-core** prüft jede Seite gegen WCAG 2.0, 2.1 und 2.2 (A und AA) und die Best Practices von axe, am Desktop und am Handy (320 px, die Breite aus WCAG 1.4.10), dazu die Anmeldeseite und das offene Handy-Menü.
2. Die **Farbkontraste** prüft axe zusätzlich in allen übrigen Themes.
3. **Anmelden nur mit der Tastatur:** Tab, Enter und Tippen, ohne Mausklick.
4. **Sprunglink und Seitenwechsel:** Der erste Tab trifft den Sprunglink, Enter setzt den Fokus auf den Inhalt; ein Seitenwechsel über die Navigation ebenso.
5. **Sichtbarer Fokus:** Der Test tabbt durch die wichtigsten Seiten. Jedes Element, das den Fokus bekommt, muss einen mindestens 2 px breiten Rahmen haben.
6. **Handy-Menü:** öffnet mit Enter, Tab führt hinein, Esc schließt es und gibt den Fokus an den Menüknopf zurück.

Findet axe einen Verstoß, nennt der Testbericht Regel, Element und Grund. Wie du die Tests lokal startest, steht unter [Entwicklung](entwicklung.md#ende-zu-ende-tests-mit-playwright).

Für neue Oberflächen gilt:

- Bedienelemente sind `<button>`, `<a>` oder Formularelemente, keine `<div>` mit `onClick`.
- Jedes Eingabefeld hat ein `<label>` oder ein `aria-label`, auch versteckte Dateiauswahlen.
- Farben über die Variablen in `styles.css`: Text in Akzentfarbe mit `var(--link)`, nicht `var(--accent)`, sonst fällt der Kontrast in den dunklen Themes durch.
- Wer `outline: none` setzt, zeigt den Fokus anders (z. B. `:focus-within` am umgebenden Element).
- Verschwindet das Element mit dem Fokus (ein Knopf, der ein Formular aufklappt), bekommt das nächste sinnvolle Element den Fokus.
