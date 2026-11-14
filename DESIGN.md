# Gestaltung von Haben

Regeln für alles, was man in Haben sieht und bedient. Vor jeder Arbeit an der Oberfläche lesen. Der Aufbau folgt dem [DESIGN.md-Format](https://github.com/google-labs-code/design.md) von Google Labs, aber ohne dessen YAML-Block mit Tokens: Die Werte stehen in `apps/web/src/styles.css`, eine Kopie hier würde auseinanderlaufen.

## Überblick

Die Oberfläche ist schlichtes CSS mit Variablen, ohne Komponentenbibliothek. Hauptdatei ist `apps/web/src/styles.css`, einzelne Bereiche liegen in `apps/web/src/styles/`. Ändert sich eine Gestaltungsregel, ändert sich diese Datei im selben Pull Request.

## Farben und Themes

Keine Verläufe, Leuchteffekte oder Endlos-Animationen; Farbe trägt Bedeutung (Akzent, Status, Diagrammreihen).

Farben kommen aus den Variablen in `:root` von `styles.css`; die Farben überschreiben sie unter `[data-theme="…"]`, der dunkle Modus unter `[data-mode="dark"]`:

| Rolle | Variablen |
| --- | --- |
| Text | `--ink`, `--ink-2`, `--muted` |
| Flächen | `--ground`, `--surface` |
| Linien | `--line`, `--line-soft`, `--line-strong` |
| Akzent | `--accent`, `--accent-hover`, `--accent-ink`, `--accent-soft`, `--accent-tint`, `--accent-fg` (Schrift auf Akzentfläche) |
| Links | `--link`, `--link-hover` |
| Navigation | `--brand`, `--nav`, `--nav-active`, `--nav-ink`, `--nav-ink-strong` (hervorgehobene Schrift, immer weiß) |
| Status | `--warn-ink`, `--warn-soft`, `--warn-dot`, `--info-ink`, `--info-soft`, `--danger-ink`, `--danger-soft` |

Einzige Ausnahme ist das Zeichen der Firma links neben „Haben“ (`NavMarkSymbol`), eine eigene Einstellung der Instanz unter Einstellungen › Firma, getrennt von der Beleggestaltung. Ein „H“ in eigener Farbe bekommt Fläche und Schrift als Inline-Style, die Schrift wählt `inkOnAccent` (`packages/core/src/accent.ts`): Weiß oder Schwarz, je nachdem, was den höheren Kontrast hat, so hält jede Farbe mindestens 4,5 : 1. Ein Logo steht auf weißer Fläche (`.brand-logo`), weil Logos für Papier gemacht sind und ein dunkles auf der dunklen Navigation verschwände, verkleinert in dieselbe quadratische Kachel wie das „H“ (`object-fit: contain`). Ab Werk bleibt `--brand` des Themes.

Farbe und Modus wählt man getrennt (`apps/web/src/lib/theme.ts`): Wald (Standard), Ozean, Pflaume oder Graphit, jede hell, dunkel oder nach der Einstellung des Geräts („System“). Im hellen Modus hat jede Farbe ihre eigene dunkle Navigation.

Der dunkle Modus ist für alle Farben gleich aufgebaut: neutrale Flächen ohne Farbstich (`--ground`, `--surface`, Linien und Text in Grau), Farbe nur im Akzent. Der Akzent ist dort heller als im hellen Modus und trägt dunkle Schrift (`--accent-fg`), damit er auf dem Grund leuchtet; Links nehmen das noch hellere `--accent-ink`. Die Navigation hat den Ton des Grunds und trennt sich mit einer Linie ab. Eine neue Farbe braucht deshalb im dunklen Modus nur ihre fünf Akzentwerte.

## Schrift und Abstände

Abstände auf dem 4px-Raster, Schriftgrößen aus 12, 13, 14, 16, 18, 24 und 28px, Beschriftungen und Tabellenköpfe in Satzschreibung statt Versalien mit Sperrung.

Die Schriften stehen in `--sans` und `--mono`, die einheitliche Höhe von Eingabefeldern, Auswahllisten und Knöpfen in `--control-h`.

Beträge und Kennzahlen stehen in `--sans` mit gleich breiten Ziffern (`font-variant-numeric: tabular-nums`), damit sie bündig untereinander stehen: in Tabellen `.num`, im Fließtext `.amount`. `--mono` bleibt für Kennungen und Code wie IBAN, Token, Kennzahlen der Formulare und Eingaben, deren Zeichen man einzeln prüft.

## Komponenten

### Knöpfe

Die Knopfarten (#30, `styles.css`):

| Klasse | Wofür |
| --- | --- |
| `btn btn-primary` | Eine Hauptaktion je Karte bzw. Kopf. |
| `btn` | Alle übrigen Aktionen. |
| `btn btn-danger` | Löschen, Entfernen, Stornieren, Widerrufen, Abo beenden, Ausschalten. |
| `btn btn-destructive` | Bestätigung von Unumkehrbarem im `ConfirmDialog` (`danger`): voll in Rot. |
| `btn btn-dashed` | Nur zum Anfügen einer Zeile oder eines Eintrags im Formular, etwa „+ Position“, „+ Steuersatz“, „+ Kind“. |
| `btn btn-ghost` | Nebenaktion in einer Werkzeugleiste, etwa Blättern oder Vergrößern und Ausblenden der Vorschau: ohne Rahmen, Fläche erst beim Überfahren. Nie für die Hauptaktion. |
| `btn-icon` | Quadratischer Knopf nur mit Symbol, mit `aria-label`; zusammen mit `btn-ghost` oder `btn-sm`. |
| `btn-sm` | Kleiner Knopf; ersetzt Inline-`minHeight`. |

Knöpfe und Karten tragen einen feinen Schatten (`--shadow-xs`), randlose Knöpfe (`btn-ghost`, `btn-dashed`) keinen. Beim Überfahren färbt sich die Fläche (`--hover`), Übergänge dauern `--fade`; ein gesperrter Knopf färbt sich beim Überfahren nicht.

Der Fokusring der Knöpfe steht mit 2px Abstand außen. Bei Feldern (Eingabe, Auswahlliste, Textfeld, Combobox) liegt er auf dem eigenen Rahmen, der dabei die Akzentfarbe annimmt, statt als zweiter Rahmen daneben.

### Gesperrte Knöpfe

Ein gesperrter Knopf ist per Tab nicht erreichbar und sagt nicht, was fehlt. Die Hauptaktion eines Formulars ist deshalb nur gesperrt, solange sie läuft (`busy`), nie weil eine Angabe fehlt oder nicht stimmt. Ein Druck prüft die Angaben: `useSubmitCheck` (`lib/use-submit-check.ts`) setzt den Fehler als `error` an jedes betroffene `Field`, bricht das Absenden ab und setzt den Fokus aufs erste Feld mit Fehler; das hilft bei WCAG 3.3.1 und 3.3.3, weil der Fehler am Feld als Text steht. Danach verschwindet ein Fehler, sobald die Angabe stimmt. Das Formular trägt `noValidate`, damit der Browser keine eigene Meldung davorschiebt; `required` bleibt an den Feldern, Grenzen wie `min` und `max` prüfen `datumFehler` und `monatFehler` mit. Was man vor der Eingabe wissen muss, etwa „mindestens 10 Zeichen“, steht als `hint` am Feld. Kontrollkästchen ohne `Field` (etwa die Mahlzeiten der Verpflegung) tragen bei einem Fehler selbst `aria-invalid` und zeigen per `aria-describedby` auf eine `.field-error` darunter, sonst findet der Fokus sie nicht.

Gesperrt sein darf ein Knopf, wenn der Grund nicht im Formular liegt oder direkt daneben zu sehen ist: Es fehlt etwas außerhalb (Zertifikat, Firmendaten, Fehler im Jahr), dann steht der Grund als Hinweis über der Knopfzeile, mit Link dorthin, wo er sich beheben lässt; oder es gibt nichts zu tun (nichts geändert, nichts ausgewählt, mit dem Zähler daneben). Geht die Aktion gerade grundsätzlich nicht, fehlt der Knopf. Ein Satz mit dem Grund steht nie als loser Text in `.actions`; ein Zähler wie „2 ausgewählt“ darf dort stehen.

### Reihenfolge der Knöpfe

In einer Knopfzeile (`.actions`, auch `.form-footer` und Dialoge) steht die Hauptaktion (`btn-primary`) als letzter Knopf, rechts; Abbrechen und Nebenaktionen („Entwurf speichern“, „Nur prüfen“) stehen davor. Das Überlaufmenü `⋯` ist keine Aktion der Zeile und zählt dabei nicht mit: Am Laptop steht es ganz rechts hinter der Hauptaktion, am Handy links neben der Vorschau (#355, Variante E).

In einer Zeile mit Hauptaktion steht ein Gefahrknopf (`btn-danger`: Löschen, Entfernen, Trennen) ganz vorn, links, so weit wie möglich von ihr weg: Ein Klick oder Tipp, der die Hauptaktion knapp verfehlt, trifft dann einen harmlosen Knopf. Löscht er Gespeichertes oder lässt sich die Folge nicht zurücknehmen, öffnet er erst den `ConfirmDialog` (siehe Rückfragen). Das ist nötig, weil er vorn auch der erste Tab-Stopp der Zeile ist: Tab aus dem letzten Feld und Enter dürfen nichts löschen. Ohne Rückfrage bleiben nur Umkehrbares (Ausschalten, das sich wieder einschalten lässt) und das Entfernen einer Zeile aus einem noch nicht gespeicherten Formular. In Zeilen ohne Hauptaktion, etwa „Bearbeiten · Entfernen“ an einem Listeneintrag, ist die Folge frei; die Rückfrage gilt dort genauso.

Die Tab-Reihenfolge folgt dem Markup und gleicht der sichtbaren (WCAG 1.3.2 und 2.4.3). Die Folge steht deshalb so im Markup; nicht per `order` oder `flex-direction: row-reverse` umdrehen und keinen positiven `tabindex` setzen, um den Fokus zuerst auf die Hauptaktion zu lenken: Ein positiver `tabindex` zieht den Knopf vor alle übrigen Elemente der Seite, Sprunglink und Navigation eingeschlossen, und Screenreader lesen die Zeile in anderer Folge vor, als sie zu sehen ist.

Ausrichtung: auf der Seite linksbündig an der Kante der Felder, im Dialog rechtsbündig (`dialog .form-footer`), im Seitenkopf rechts. Auf dem Handy füllen die Knöpfe die Zeile und brechen bei Bedarf um, die Hauptaktion bleibt rechts; kleine Knöpfe (`btn-sm`) in Tabellen und Bannern bleiben so breit wie ihr Text. Kein Stapeln mit der Hauptaktion oben: Das ginge nur gegen die DOM-Reihenfolge. Einzige, gewollte Ausnahme ist das Blatt von `ConfirmDialog` am Handy (siehe Rückfragen). `e2e/knopfreihenfolge.spec.ts` prüft in Zeilen mit Hauptaktion Reihenfolge, Gefahrknopf vorn und dass weder CSS noch `tabindex` die Folge ändern (#394).

### Symbole

Symbole kommen aus der `Icon`-Komponente, nicht als Emoji oder Unicode-Zeichen.

### Navigation

Oben in der Navigation steht die Marke: das Zeichen und „Haben“ (18px, halbfett). Das Zeichen ist fest quadratisch und voll gefüllt, am Desktop 40px, am Handy 36px, für das „H“ wie für ein Logo (auf weißer Fläche, weil Logos für Papier gemacht sind); ein breites Logo nimmt dem Namen so keinen Platz, und nichts springt, wenn das Bild lädt. Hebt sich ein „H“ in eigener Farbe in einem der Themes nicht mit 3 : 1 von der Navigation ab (WCAG 1.4.11), bekommt die Kachel eine feine helle Innenkante (1px, `--nav-ink` mit 60 % Deckkraft); die Hintergründe der Themes stehen dafür auch in `NAV_BACKGROUNDS` (`packages/core/src/accent.ts`) und müssen mit `--nav` übereinstimmen. Die Kachel steht bündig mit den Symbolen der Menüpunkte, rechts hat die Marke am Desktop keinen Innenabstand, am Handy 8px zum Menüknopf. Hat die Firma in den Firmendaten einen Namen, steht er darunter (13px, mittel, in `--nav-ink`, dem Grau der Menüpunkte, damit „Haben“ die Hauptzeile bleibt), denn er zeigt, in welcher Instanz man bucht (#504). Am Desktop nimmt er bis zu zwei Zeilen, damit auch lange Namen passen, am Handy eine, weil die Leiste dort `--nav-height` (60px) hoch bleibt; was nicht passt, endet mit Auslassungszeichen. Am Desktop klappt der Name dann beim Überfahren und mit Fokus auf „Haben“ nach unten ganz auf (Fläche `--nav-active`, weiße Schrift, über den ersten Menüpunkten), Escape und das Verlassen schließen ihn; ein `title` gibt es nicht, weil er nicht zu gestalten und nicht per Tastatur zu erreichen ist.

Gibt es Instanzen anderer Firmen (`HABEN_FIRMEN`, #504), beginnt der rollende Menübereich unter der Schnellsuche mit der Zeile „Firma wechseln“ (`FirmaWechsler`), mit einer Linie zu den Menüpunkten; die Marke hat dann am Desktop unten 8px statt 28px Abstand. Sie klappt die Liste der anderen Firmen im Fluss darunter auf, am Desktop wie am Handy, ohne schwebendes Fenster; die eigene Firma steht nicht darin, ihr Name steht schon unter „Haben“. Zeile und Firmen sehen aus wie Menüpunkte ohne Symbol (36px hoch, am Handy 44px), die offene Zeile trägt keine Fläche, damit sie nicht wie der aktive Menüpunkt aussieht. Die Firmen sind Links im selben Tab, weil man die Firma wechselt und nicht daneben eine Seite aufschlägt. Mehr als sechseinhalb Zeilen rollen in der Liste, ab 20 Firmen steht darüber ein Suchfeld in den Farben der Navigation. Beim Öffnen steht der Fokus im Suchfeld, sonst auf der ersten Firma; Escape, ein Klick daneben und Tab hinter die letzte Firma schließen, am Handy schließt Escape erst die Liste und dann das Menü.

Eigene Seiten stehen in ihrer Gruppe mit einem Symbol, das zeigt, wohin der Eintrag führt (#636): `embed` (Fenster mit Seitenleiste) für eine Seite, die Haben im Rahmen neben dem Menü zeigt, `external` (Pfeil aus dem Kasten) für eine, die in einem neuen Tab öffnet. Diese hat für Screenreader zusätzlich „(öffnet in neuem Tab)“ im Namen.

Ist die Navigation höher als das Fenster, bleibt am Desktop die Marke mit dem Firmennamen stehen und nur die Menüpunkte darunter rollen. Die Leiste, auch die der Liste unter „Firma wechseln“, ist schmal, erscheint nur beim Rollen, wo das System es so vorsieht, und hat in `--nav-ink` mit 55 % Deckkraft mindestens 3 : 1 gegen `--nav` (WCAG 1.4.11).

### Befehlspalette

**Schnellsuche** sitzt am Desktop unter der Marke außerhalb des rollenden Menüs, am Handy als Lupe neben **Menü**. `Strg+K` bzw. `Cmd+K` öffnet die Suche auf jeder Seite, solange kein anderer Dialog offen ist.

`CommandPalette` übernimmt Fläche, Rahmen und Hintergrund der Formular-Dialoge. Sie ist bis zu 720px breit und bleibt beim Tippen am selben oberen Abstand. Im Kopf steht ein Feld mit Lupe und eigenem Fokusrahmen. Die Treffer rollen zwischen Kopf und festem Fuß. Am Handy füllt der Dialog den Bildschirm und **Abbrechen** steht neben dem Feld, der Fuß entfällt.

Eine Trefferzeile zeigt Symbolkachel, Titel und darunter Kontext. Am Desktop stehen Betrag und Status mit Auskunft in festen, rechtsbündigen Spalten. Am Handy teilen sie sich die dritte Zeile mit dem Betrag links und dem Status rechts. Die aktive Zeile zeigt die Fläche `--hover` und rechts einen Pfeil. Die Maus setzt denselben Zustand wie die Tastatur. Der Link **Alle anzeigen** steht in der Gruppenüberschrift und öffnet die gefilterte Liste.

### Kennzahlen

Die Kennzahlenreihe zeigt nur Zahlen.

### Status

Den Zustand eines Objekts (Rechnung, Angebot, Beleg, Umsatz, Bankverbindung, Frist, Voranmeldung, Lohnabrechnung, Protokolleintrag) zeigt `Status` aus `components/Status.tsx`: ein Punkt in der Farbe des Tons, das Wort und darunter in Grau eine Auskunft, was der Status gerade heißt. Gefüllte Pillen gibt es nicht mehr.

```tsx
<Status tone="warn" emphasis="urgent" detail="seit 40 Tagen">Überfällig</Status>
```

**Auskunft (`detail`):** Sie beantwortet die Frage, die man beim Draufschauen hat, kurz und mit Zahl oder Datum: „fällig 23.11.“, „seit 40 Tagen“, „2.380,00 von 4.760,00 €“, „am 30.10.“, „durch RE-2026-0137“, „gilt noch 25 Tage“. Was ohnehin in einer Spalte daneben steht, wiederholt sie nicht. Fehlt die Angabe, bleibt die Zeile leer; eine Auskunft ohne Inhalt („Status: offen“) gibt es nicht.

**Ton (`tone`):** Er sagt, welcher Art der Zustand ist, nicht wie dringend.

| Ton | Wofür | Beispiele |
| --- | --- | --- |
| `neutral` | Wartet, ohne dass etwas fehlt | Offen, Getrennt, Storno |
| `ok` | Erledigt, gültig, angenommen | Bezahlt, Gebucht, Aktiv, Gesendet, OK |
| `info` | Läuft oder ist zur Hälfte da | Teilbezahlt, Wird ausgelesen, Vorschlag, Hinweis |
| `warn` | Etwas fehlt oder ist abgelaufen | Überfällig, Beleg fehlt, Zu prüfen, Abgelaufen, Prüfen |
| `danger` | Aufgehoben oder fehlgeschlagen | Storniert, Abgelehnt, Fehler, Fehlgeschlagen |

**Entwurf (`draft`):** Der Punkt wird ein leerer Ring: noch nicht festgeschrieben. Nach dem Festschreiben ist er voll. Das gilt für jeden Entwurf, ob Rechnung, Angebot, Voranmeldung oder Lohn. Der Ring sagt das schon, eine Auskunft „noch nicht festgeschrieben“ gibt es deshalb nicht.

**Stufe (`emphasis`):** Sie entscheidet, wie laut der Status ist. Weil fast alles ruhig ist, springt das Dringende heraus; deshalb ist „dringend“ selten.

| Stufe | Wann | Aussehen |
| --- | --- | --- |
| ohne | Der Normalfall, auch Erledigtes und Storniertes: das ist Geschichte, keine Aufgabe | Nur der Punkt trägt die Farbe |
| `notice` | Du bist am Zug und der nächste Schritt ist klar, aber ohne Frist: Vorschlag bestätigen, Beleg zuordnen oder prüfen, angenommenes Angebot abrechnen, abgelaufenes Angebot nachfassen, Lohn gegenprüfen, fehlende Angabe nachtragen | Das Wort steht in der Farbe des Tons |
| `urgent` | Eine Frist ist überschritten oder kommt in höchstens 7 Tagen, Geld steht aus, etwas ist fehlgeschlagen | Das Wort auf weicher Fläche, die Auskunft in der Farbe |

Die Grenze von 7 Tagen ist dieselbe wie auf der Seite Fristen. Was nur wartet, ohne dass du etwas tun kannst (Offen, Teilbezahlt, Wird ausgelesen, Hinweis), bleibt ruhig, auch wenn es noch nicht erledigt ist. Eine Liste, in der jede zweite Zeile dringend ist, hat die Stufe falsch gewählt: Dann ist der Zustand der Normalfall dieser Liste und bekommt `notice`.

**Anordnung:** In Tabellen steht der Status in der letzten Spalte, Punkt über Punkt, die Auskunft darunter, mit 12px mehr Abstand zur Spalte davor; eine Trennlinie davor gibt es nicht. Alle Zellen der Zeile stehen auf der ersten Grundlinie (`align-items: first baseline`), so liegt das Statuswort auf der Textzeile daneben, und jede Zeile reserviert zwei Zeilen für den Status, damit Zeilen mit und ohne Auskunft gleich hoch sind. Am Handy stehen Auskunft und Wort nebeneinander in der zweiten Zeile, das Wort rechts an der Kante unter dem Betrag, damit es von Zeile zu Zeile an derselben Stelle steht; eine zu lange Auskunft endet mit „…“, die Zeile bleibt zweizeilig. Die Fläche eines dringenden Worts ragt in Listen in den Rand, am Desktop nach links, am Handy nach rechts, damit das Wort mit den ruhigen Wörtern fluchtet; im Seitenkopf und in Fließtext steht sie bündig mit Titel und Text. Das Brief-Symbol „per E-Mail versendet“ steht am Desktop hinter dem Status, am Handy vor der Auskunft. Wo links zwei Zeilen stehen, wie Lieferant und Rechnungsnummer bei den Belegen, zeigt das Handy nur das Wort. Im Seitenkopf (`.title-with-status`) und mit `inline` steht die Auskunft in derselben Zeile. Ein Status steht nie allein für die Bedeutung: Das Wort trägt sie, der Punkt ist Zusatz.

**Wortlaut:** Ein Status beginnt groß („Offen“, „Gesperrt“, „Übermittelt“), ein Merkmal bleibt klein („archiviert“, „inaktiv“). Das Wort ist kurz; alles, was es genauer macht, gehört in die Auskunft, nicht ins Wort („Storniert“ mit „am 02.11.“, nicht „storniert am 02.11.“).

**Merkmal (`Tag`):** Eine Eigenschaft ohne Zustand, etwa Lieferant, eine Rolle, archiviert, inaktiv oder Test, ist kein Status. Sie bekommt keinen Punkt und keine Farbe, nur eine Haarlinie. Ein Verweis auf ein anderes Objekt, etwa die Quelle einer Buchung, ist ein normaler Link.

**Ergebnis im Protokoll (`OutcomeStatus`):** Einträge von ELSTER und E-Mail zeigen Erfolg ruhig und einen Fehler dringend, mit dem Fehlercode im Wort.

**Hüllen:** Zustände, die an mehreren Stellen vorkommen, stehen einmal in einer Hülle mit einer Tabelle Zustand → Aussehen (`StatusLook`) und einer Funktion für die Auskunft: `InvoiceStatus`, `QuoteStatus` mit `BillingStatus`, `DocumentStatus` und `BankStatus.tsx`. Ein neuer Zustand dieser Bereiche kommt dort dazu; ein Status, den nur eine Seite kennt, steht als `<Status>` in der Seite.

### Seitenkopf

Jede Seite beginnt mit `.page-head` als direktem Kind von `<main>`: Titel, Status und Hauptaktionen. Hat die ganze Seite einen Status (Rechnung, Angebot, Umsatzsteuer-Voranmeldung), steht er neben dem Titel (`.title-with-status`), damit er mit dem Kopf sichtbar bleibt. Er bleibt beim Scrollen stehen (#356).

Seine gemessene Höhe steht in `--page-head-height` (`usePageHeadHeight` in `lib/use-page-head.ts`), seine Unterkante samt Handy-Navigation in `--below-head`. Was darunter ebenfalls stehen bleibt (Unternavigation, Belegansicht, Tabellenköpfe, Sprungleisten), nimmt `top: var(--below-head)` statt eines festen Abstands; `scroll-padding-top` hält Sprungziele und Felder mit Fokus unter dem Kopf.

Auf dem Handy steht der Kopf kompakt: die Aktionen in einer Zeile, die seitlich scrollt; im Belegeditor (`.editor-actions`) brechen sie um, damit Speichern und Festschreiben sichtbar bleiben.

Der Kontaktdialog (`NewContactDialog`) folgt demselben Muster: Titel in Seitentitelgröße oben und die Knöpfe unten stehen, nur das Formular dazwischen scrollt; der Dialog ist selbst die Karte, das Formular darin hat keinen eigenen Rahmen. Formular-Dialoge laufen über `FormDialog`, und der setzt Rand, Abstände und die stehende Knopfzeile selbst: Das Formular darin ist ein schlichtes `<form>` mit Feldern und als letztem Kind einer `.actions`-Zeile, ohne eigene Klassen für Rand oder Fußzeile. Abschnitte (`form-section`) und die Knopfzeile reichen bis an den Rand des Dialogs.

### Rückfragen

Folgenreiches bestätigt der Dialog `ConfirmDialog` (#404), nie ein zweiter Klick auf denselben Knopf und nie `window.confirm`. Der Titel ist eine Frage mit dem Objekt („Entwurf löschen?“), darunter stehen die Folgen, rechts die Aktion mit ihrem Namen, nie „OK“. Der Kopf hat keine Trennlinie und kein Schließen-X; die Linie unter dem Titel gehört zu Formular-Dialogen wie `NewContactDialog`, deren Inhalt scrollt.

Geht es um Geld oder das Finanzamt, nennt `facts` über den Folgen, was bestätigt wird: beim Festschreiben einer Rechnung Nummer, Kunde und Betrag, bei ELSTER Steuerart, Zeitraum und Zahllast, beim Lohn Person, Brutto und Auszahlung, beim Beleg Lieferant, Datum und Betrag; ein Storno nennt dasselbe wie das, was es zurücknimmt. Ein Häkchen (`acknowledge`) gibt es nur beim Jahresabschluss, Eintippen gar nicht.

Am Handy ist der Dialog ein Blatt von unten mit der Aktion über „Abbrechen“. Das ist eine gewollte Ausnahme von der Reihenfolge der Knöpfe: „Abbrechen“ liegt unten im Daumenbereich, damit man Löschen oder Festschreiben nicht aus Versehen trifft. Die Knöpfe stehen dafür per `column-reverse` umgedreht, im Markup kommt „Abbrechen“ zuerst. Weil der Fokus beim Öffnen dort liegt, schadet die abweichende Tab-Folge nicht. An Griff oder Titel nach unten gewischt, schließt es wie „Abbrechen“. Fokus beim Öffnen auf „Abbrechen“, danach zurück auf den Auslöser; Esc führt nichts aus.

Rot (`danger`) sind Löschen, Stornieren, Entfernen, Widerrufen, Trennen, endgültiges Beenden und Abschließen, grün der erwartete nächste Schritt wie Festschreiben, Buchen und Senden. Der Dialog schließt vor der Aktion; das Ergebnis meldet die Seite. Tastenkürzel der Seite fragen `isDialogOpen()`.

### Karten

Inhalte stehen in `.card`: Fläche `--surface`, Linie `--line`, Schatten `--shadow-xs`, Ecken 12px, Innenabstand 20px. Am Handy stehen `.grid-3`, `.grid-4` und `.grid-5` (fünf Kennzahlen, am Desktop in einer Reihe, wenn sie passen) in zwei Spalten mit 12px Abstand, die Karten darin haben 16px Innenabstand. Felder und normale Knöpfe sind auf Touchgeräten 44px hoch (`--control-h`); ausgenommen sind kleine Knöpfe (`.btn-sm`) und die Knöpfe der Auszeichnungen (`.format-bar`).

Karte in Karte gibt es nicht: Ist ein Dialog oder Blatt selbst die Karte, verliert der Inhalt seinen Rahmen (wie das Formular im `NewContactDialog`).

### Blätter am Handy

Am Handy wird aus dem `ConfirmDialog` (bis 640px) sowie aus der Überblendung `PreviewDialog` und ihrer Gestaltungskarte `.design-sheet` (bis 720px) ein Blatt von unten. Formular-Dialoge wie der `NewContactDialog` bleiben schwebende, fast bildschirmbreite Dialoge. Ein neues Blatt nutzt `SheetGrip` und `useSwipeToClose`, statt sie nachzubauen, und hält sich an diese Regeln:

- **Form:** volle Breite, unten bündig, nur oben gerundet: `border-radius: var(--sheet-radius) var(--sheet-radius) 0 0`. Der Radius steht einmal in `styles.css`; kein Blatt bekommt einen eigenen Wert, damit alle gleich aussehen.
- **Griff:** `SheetGrip` ist das erste Element des Blatts. `.sheet-grip` ist ausgeblendet; das Blatt schaltet ihn in seiner Media Query ein.
- **Wischen:** `useSwipeToClose` hängt am Griff und, wo das Blatt einen Titel hat, am Titel, nie am scrollenden Inhalt; beide tragen `touch-action: none`. Das Blatt folgt dem Finger und schließt ab 80px, sonst springt es zurück. Das wirkt wie „Schließen“ oder „Abbrechen“; der Knopf bleibt als Alternative. `media` ist dieselbe Breite wie in der Media Query des Blatts.
- **Übereinander:** Sichtbar ist nur der Griff des oberen Blatts, denn zwei übereinander verwirren; den des unteren blendet `.preview-dialog[data-design] > .sheet-grip` aus. Wischen schließt nur das obere Blatt; das darunter bleibt über seinen Titel wischbar.
- **Aufbau:** Kopf und Knöpfe stehen, nur der Inhalt dazwischen scrollt. Im `ConfirmDialog` sind die Knöpfe voll breit und 48px hoch, die Aktion über „Abbrechen“, unten mit Abstand für `env(safe-area-inset-bottom)`.

Die Gestaltungskarte ist am Desktop eine Spalte neben dem Blatt (`.design-sheet` mit `display: contents`). Am Handy steht die Vorschau oben in einem Streifen von `32dvh`, und die Karte überlappt ihn um 16px, damit ihre gerundeten Ecken auf der Vorschau liegen.

### Felder

Neue Formularfelder immer über `Field` (`components/Field.tsx`), je Feld ein `Field`; das gilt auch für zusammengesetzte Felder wie `Combobox`. Der Feldname ist ein `<label>` mit `htmlFor`, nur so breit wie sein Text: Er fokussiert das Feld, die Fläche daneben nicht. Ein umschließendes `<label>` gibt es nicht, denn sonst zählte der Hinweis zum Namen des Felds. Eine Gruppe mit `<legend>` ist ein `<fieldset className="field">`; jedes andere eigene Element mit der Klasse `field` meldet `bun run lint`. Ausgenommen sind Kontrollkästchen und Optionsfelder (`label.checkbox`): Ihr Text ist der Name und die ganze Zeile die Klickfläche. Ein Hinweis steht nie im Label, sonst zählte er zum Namen: Er folgt außerhalb, in `.checkbox-hinted` (`<div className="checkbox-hinted">` mit dem `<label className="checkbox">` und danach `<span id=… className="field-hint">`), und der Eingabe gehört er per `aria-describedby` auf diese `id`. Der Hinweis rückt auf die Textkante der Beschriftung ein (35px); ein Klick darauf schaltet nicht um. Auf Touchgeräten ist die Zeile mit dem Kästchen wie jedes Kontrollkästchen 44px hoch, am Desktop nur so hoch wie der Text. `barrierefreiheit.spec.ts` prüft auf den Seiten der Routenliste, dass kein Kontrollkästchen und kein Optionsfeld den Hinweis im Label trägt. Ein Bedienelement in `Field` funktioniert deshalb für sich, ohne dass ein Label darum seinen Klick weiterreicht (`FilePicker` öffnet den Dialog selbst).

Auswahllisten sind Formularfelder wie die übrigen: `<select>` steht in `Field` und nimmt `{...control}` an, auch wenn kein Feldname zu sehen sein soll (`hideLabel`, etwa die Auswahl „Textbaustein einfügen …“ unter einem Textfeld). Rahmen, Höhe, Radius und Pfeil kommen aus der Grundregel `select` in `styles.css`, nicht aus der Hülle. Ohne `Field` stehen nur Zellen einer Tabelle oder Positionszeile, deren Spaltenkopf und `aria-label` sie benennen (`.line-row`, `.report-table`), und die Auswahl des Farbschemas auf der dunklen Navigation (`.nav-theme`); jedes andere `<select>` ohne `Field` meldet `bun run lint`, eine Ausnahme steht mit `// biome-ignore lint/plugin: Grund` im Code.

Hinweis und Fehler gehen als `hint` und `error` an `Field`, das `aria-describedby` und `aria-invalid` setzt. Steht ein Hinweis außerhalb, etwa für zwei Felder gemeinsam, nennt `describedBy` seine `id`. `announceError` setzt `role="alert"` an die Meldung, für Fehler, die erst nach einer Aktion erscheinen und bei denen der Fokus bleibt, etwa eine Antwort des Servers; beim Tippen bleibt es aus, ebenso bei Fehlern aus `useSubmitCheck`: Deren erstes Feld bekommt den Fokus, der Screenreader liest den Fehler dabei, und `role="alert"` an allen Feldern läse alle auf einmal. `hideLabel` nimmt den Feldnamen aus dem Bild (Suchfelder), er bleibt für Screenreader. `className` und `style` gehören an die Hülle, etwa für `gridColumn`.

### Datei-Felder

Eine Datei, die mit einem Formular abgeschickt wird, wählt `FilePicker` (`components/FilePicker.tsx`) in einem `Field`, nie ein sichtbares `<input type="file">`: Dessen Knopf beschriftet der Browser in seiner Sprache („Choose File“). `FilePicker` zeigt „Datei wählen“ und den gewählten Namen, nimmt `{...control}` von `Field` an, öffnet den Dialog per Klick und Tastatur selbst und kennt `disabled` und `onChange`. Leeren lässt er sich samt Anzeige über einen neuen `key`.

Wird eine Datei sofort hochgeladen, ohne Formular (Belege, Kontoauszüge, Anhänge, Logo, Mandat), ist das eine Aktion: `UploadButton` (`components/UploadButton.tsx`), ein echter Knopf mit unsichtbarem Eingabefeld dahinter, das weder per Tab noch für Screenreader erreichbar ist. Kein `label.btn` um ein Eingabefeld.

### Felder mit Auszeichnungen

Text, der auf dem Beleg fett, kursiv oder unterstrichen stehen kann, wird in `FormattedTextarea` eingegeben, nicht mit einer eigenen Werkzeugleiste. Die Knöpfe F, K und U (`.format-bar`) schweben an der Markierung, auf Touchgeräten rechts über dem Feld, weil das System sein Menü an die Auswahl legt. Dazu gelten Strg+B, I und U, am Mac mit Cmd. In der Leiste wechseln die Pfeiltasten den Knopf. Solange die Leiste zu sehen ist, schließt Esc nur sie; ein umgebender Dialog bleibt offen.

### Vorschau der Belegeditoren

Das Blatt setzt Typst aus derselben Vorlage wie das PDF (`RenderedSheet`), es gibt keinen Nachbau in HTML. Eine Änderung am Aussehen eines Belegs gehört deshalb in die Vorlage unter `packages/einvoice/templates/`. Das Papier bleibt in jedem Theme weiß und liegt wie eine Karte auf dem Grund (`--ground`), mit mehrstufigem Schatten aus `--paper-shadow`; in dunklen Themes hält eine helle Haarlinie die Kante, weil ein Schatten auf Dunkel kaum trägt. Das Bild ersetzt den Text nicht: Für Screenreader steht derselbe Inhalt versteckt daneben (`sheetText`).

`components/DocumentPreview.tsx` ist die Hülle für alle Editoren mit Dokumentvorschau (#357): `useDocumentPreview` hält den Modus, `PreviewButton` ist der Split-Button im Seitenkopf, `PreviewLayout` stellt Formular und Vorschau nebeneinander oder öffnet die Überblendung als `<dialog>`. Ob Anheften geht und was ohne gespeicherte Wahl gilt, entscheidet die Breite des Editors (`previewLayout` in `lib/vorschau.ts`, Mindestbreiten dort und in `.preview-layout`). Die Wahl liegt im `localStorage` (`haben-vorschau`). Die Vorschau steht nur im Dokument, wenn sie zu sehen ist.

## Barrierefreiheit

Barrierefrei und per Tastatur bedienbar: echte Knöpfe und Links, ein Label für jedes Feld, sichtbarer Fokus, Text in Akzentfarbe mit `var(--link)`. `barrierefreiheit.spec.ts` prüft das in der CI ([Barrierefreiheit und Tastatur](docs/barrierefreiheit.md)).

## Bekannte Abweichungen

Der Code hält diese Regeln noch nicht überall ein. Neuer Code hält sich an die Regel.

- **Gesperrte Knöpfe:** Viele Formulare sperren die Hauptaktion, solange Angaben fehlen, meist ohne Grund (etwa `AssetForm`, `RecurringForm`, `routes/_app/belege/$id.tsx`, `routes/_app/bank.tsx`, `routes/_app/rechnungen/mahnwesen/$id.tsx`, Abruf und Versand mit PIN bei ELSTER).
- **4px-Raster:** In `apps/web/src/**/*.css` haben manche `padding`, `margin` und `gap` px-Werte, die nicht durch 4 teilbar sind (meist 1 oder 2px, auch 6, 10 oder 14px).
- **Farben:** Einige Regeln setzen einen festen Hex-Wert statt einer Variable, meist `#fff` für Text auf Navigationsflächen (`.brand`, `.nav-link:hover`).
- **Schriftgrößen:** `components/IbanCheck.tsx` setzt an zwei Überschriften `fontSize: 15`.
- **Verläufe:** `styles.css` nutzt `linear-gradient` für den auslaufenden Rand des Blatts in der Vorschau (`.preview-pane-body`, `.preview-dialog-body`, `.sheet-frame::before` und `::after`) und `conic-gradient` für das Farbfeld „Eigene Farbe“ (`.color-swatch-custom`).
- **Symbole:** Als Unicode-Zeichen statt über `Icon` stehen `▾` und `▸` (mit `aria-hidden`) im aufklappbaren Abschnitt in `routes/_app/umsatzsteuer/$zeitraum.tsx`, `›` als Aufklapp-Pfeil (`.chevron` in `components/BilanzGuv.tsx`, `routes/_app/konten/index.tsx`, `routes/_app/buchungen/index.tsx`; `.est-block > summary::before` in `styles/auswertungen.css`), `›` als Trenner im Pfad über dem Seitentitel und `→` in `routes/_app/kasse.tsx`.
