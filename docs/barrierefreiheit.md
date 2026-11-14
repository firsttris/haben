---
title: "Barrierefreiheit und Tastaturbedienung (WCAG 2.2 AA)"
description: >-
  Haben ist vollständig per Tastatur bedienbar und erfüllt nach automatischen Prüfungen WCAG 2.2
  AA – mit Tastenkürzeln und Hinweisen für Screenreader.
---

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
- **Knopfzeilen:** `Tab` geht die Knöpfe in der Folge durch, in der sie zu sehen sind. Hat die Zeile eine Hauptaktion wie **Speichern**, steht sie zuletzt und ein Gefahrknopf wie **Löschen** zuerst. Ein Gefahrknopf, der Gespeichertes löscht, fragt erst nach. Ausnahme ist die Rückfrage auf dem Handy: **Abbrechen** steht unter der Aktion, wo der Daumen liegt, hat beim Öffnen den Fokus, und `Tab` geht von dort nach oben zur Aktion.
- **Fehlende Angaben:** Unter **Pauschalen**, im **Bankabgleich** (Zuordnen, Aufteilen, Verrechnen, Name des Kontos, Bank verbinden), beim **Beleg**, bei der **manuellen Buchung** und bei **Anlagen** bleibt der Knopf bedienbar, auch wenn noch etwas fehlt. Ein Druck darauf schreibt unter jedes betroffene Feld, was fehlt, und setzt den Fokus ins erste davon; der Screenreader liest dabei Feldname und Fehler.
- **Dateien hochladen:** Statt Drag-and-drop öffnen **Dateien auswählen** und **Foto aufnehmen** den Dateidialog des Systems.
- **Kunde, Lieferant und Artikel suchen** (Kunde im Rechnungs- und Angebotseditor, bei Serienrechnungen und Textbausteinen, Lieferant im Beleg und im Dauerbeleg, Artikel im Editor): Beim Tippen erscheint eine Trefferliste. `Pfeil runter` und `Pfeil hoch` bewegen den aktiven Treffer, `Enter` übernimmt ihn, `Esc` schließt die Liste; `Alt+Pfeil runter` öffnet sie, ohne einen Treffer zu wechseln. Bei Kunden und Lieferanten übernimmt auch `Tab` den aktiven Treffer.
- **Diagramm unter Auswertungen:** Mit `Tab` springst du von Monat zu Monat und siehst die Werte. Dieselben Zahlen stehen unter **Als Tabelle anzeigen**.

Tastenkürzel einzelner Seiten:

| Seite | Kürzel |
| --- | --- |
| [Bankabgleich](bank.md#zuordnen) | `Enter` ordnet zu, `J` nächster, `K` voriger Umsatz |
| [Beleg prüfen](belege.md#belege-nacheinander-prüfen) | `J`/`→` nächster, `K`/`←` voriger Beleg, `Strg+Enter` bucht, `Esc` zurück zur Liste |

Die Kürzel wirken nicht, solange der Fokus in einem Eingabefeld steht; nur `Strg+Enter` (Mac: `Cmd+Enter`) bucht einen Beleg auch aus einem Eingabefeld.

## Darstellung

- **Kontraste:** Text, Links und Knöpfe erreichen in allen vier Farben, hell und dunkel, mindestens 4,5:1, Fokusrahmen und Bedienelemente mindestens 3:1. Im dunklen Modus sind Links dafür heller als die Akzentfarbe der Knöpfe.
- **Vergrößern:** Die Seiten passen sich der Breite an. Auch bei 390 px Breite (Handy oder stark vergrößert) gibt es keine waagrechte Bildlaufleiste. Breite Tabellen scrollen dann in ihrer Karte; ist eine Tabelle breiter als der Platz, erreichst du sie mit `Tab` und scrollst mit den Pfeiltasten.
- **Tippflächen** sind mindestens 24 × 24 px groß, Knöpfe und Eingabefelder auf Touch-Geräten 44 px hoch. Felder haben dort 16 px Schrift, damit Safari auf dem iPhone die Seite beim Antippen nicht vergrößert; mit zwei Fingern vergrößern geht weiterhin.
- **Weniger Bewegung:** Ist im System „Bewegung reduzieren“ eingestellt, verzichtet Haben auf Übergänge.
- **Sprache:** Die Seiten sind als Deutsch ausgezeichnet (`lang="de"`), damit Vorlese- und Übersetzungsprogramme richtig betonen.

## Wie das geprüft wird

`apps/web/e2e/barrierefreiheit.spec.ts` läuft in der CI nach dem Durchlauf in `app.spec.ts`, also mit Kunden, Rechnungen, Belegen und Bankumsätzen in der Datenbank. Seiten, deren Daten `rechnungen.spec.ts` und `belege-steuern.spec.ts` anlegen (Angebote, Kasse, Anlagen, Darlehen, Zusammenfassende Meldung …), prüfen diese Dateien am Ende selbst mit axe, am Desktop und am Handy; die ELSTER-Einstellungen mit Zertifikat dazu in allen Themes auf Farbkontraste. Die Seiten sind auf mehrere Tests verteilt, die parallel laufen:

1. **axe-core** prüft jede Seite gegen WCAG 2.0, 2.1 und 2.2 (A und AA) und die Best Practices von axe, am Desktop und am Handy (320 px, die Breite aus WCAG 1.4.10), dazu die Anmeldeseite und das offene Handy-Menü.
2. Die **Farbkontraste** prüft axe zusätzlich in allen übrigen Themes.
3. **Anmelden nur mit der Tastatur:** Tab, Enter und Tippen, ohne Mausklick.
4. **Sprunglink und Seitenwechsel:** Der erste Tab trifft den Sprunglink, Enter setzt den Fokus auf den Inhalt; ein Seitenwechsel über die Navigation oder über einen Link im Inhalt ebenso.
5. **Sichtbarer Fokus:** Der Test tabbt durch die wichtigsten Seiten. Jedes Element, das den Fokus bekommt, muss einen mindestens 2 px breiten Rahmen haben.
6. **Handy-Menü:** öffnet mit Enter, Tab führt hinein, Esc schließt es und gibt den Fokus an den Menüknopf zurück.
7. **Aktueller Bereich:** Im Archiv tragen nur der gewählte Bereich und die gewählten Filter `aria-current`.

Findet axe einen Verstoß, nennt der Testbericht Regel, Element und Grund. Wie du die Tests lokal startest, steht unter [Entwicklung](entwicklung.md#ende-zu-ende-tests-mit-playwright).

Für neue Oberflächen gilt:

- Bedienelemente sind `<button>`, `<a>` oder Formularelemente, keine `<div>` mit `onClick`.
- Formularfelder und Auswahllisten stehen immer in `Field`, Dateien wählt `FilePicker` oder `UploadButton`; die Regeln dazu stehen in [`DESIGN.md`](https://github.com/firsttris/haben/blob/main/DESIGN.md#felder) unter „Felder“ und „Datei-Felder“.
- Farben über die Variablen in `styles.css`: Text in Akzentfarbe mit `var(--link)`, nicht `var(--accent)`, sonst fällt der Kontrast in den dunklen Themes durch.
- Wer `outline: none` setzt, zeigt den Fokus anders (z. B. `:focus-within` am umgebenden Element).
- Was beim Scrollen stehen bleibt, verdeckt kein Element mit Fokus (WCAG 2.4.11): Unter dem festen Seitenkopf beginnt es bei `var(--below-head)`, `scroll-padding-top` an `html` rechnet den Kopf schon ein. Bleibt darunter noch etwas stehen (am Handy die Bereiche der Einstellungen), bekommt es eine feste Höhe, die `scroll-padding-top` dazurechnet. In Formular-Dialogen hält `FormDialog` das Feld mit Fokus über der stehenden Knopfzeile, auch wenn es nur halb dahinter läge; das prüft `belege-steuern.spec.ts` an „Abgabe vermerken“. `kopfzeile.spec.ts` tabbt dazu durch den langen Rechnungsentwurf und den Kontaktdialog. Bei sehr niedrigem Fenster (400 % Zoom, bis 300 px Höhe) scrollt der Kopf mit, weil er sonst das Fenster füllte.
- Was eine Aktion im stehenden Kopf meldet oder nachfragt, liegt sonst oft außer Sicht: `NoticeBanner` holt sich selbst ins Bild, eigene Hinweise über `useRevealWhen`.
- Folge der Knöpfe und Tab-Reihenfolge: [`DESIGN.md`](https://github.com/firsttris/haben/blob/main/DESIGN.md#reihenfolge-der-knöpfe), „Reihenfolge der Knöpfe“; `knopfreihenfolge.spec.ts` prüft sie.
- Dialoge sind `<dialog>` mit `showModal()`: Der Fokus geht hinein, in Formular-Dialogen auf das erste Feld, Esc schließt, der Rest der Seite ist nicht bedienbar, und beim Schließen kehrt der Fokus auf den Auslöser zurück (`FormDialog`, Vorschau in `DocumentPreview.tsx`).
- Eine Suche mit Trefferliste nutzt `Combobox.tsx` nach dem Muster „Editable Combobox With List Autocomplete“ der [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): Der Fokus bleibt im Feld, `aria-activedescendant` zeigt den aktiven Eintrag. Für kurze, feste Auswahlen bleibt es beim `<select>` in `Field` (siehe `DESIGN.md`), es ist von Haus aus zugänglich und auf dem Handy besser.
- Ein Split-Button (Vorschau der Belegeditoren) folgt dem Muster „Menu Button“ der [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/): Hauptaktion und Pfeil sind getrennt fokussierbar, der Pfeil trägt `aria-haspopup="menu"` und `aria-expanded`, Enter, Leertaste und die Pfeiltasten öffnen das Menü mit dem Fokus auf dem ersten Eintrag, Esc schließt es zurück auf den Pfeil. `vorschau.spec.ts` prüft das.
- Verschwindet das Element mit dem Fokus (ein Knopf, der ein Formular aufklappt), bekommt das nächste sinnvolle Element den Fokus.
