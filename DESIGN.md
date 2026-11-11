# Gestaltung von Haben

Regeln für alles, was man in Haben sieht und bedient. Vor jeder Arbeit an der Oberfläche lesen. Der Aufbau folgt dem [DESIGN.md-Format](https://github.com/google-labs-code/design.md) von Google Labs, aber ohne dessen YAML-Block mit Tokens: Die Werte stehen in `apps/web/src/styles.css`, eine Kopie hier würde auseinanderlaufen.

## Überblick

Die Oberfläche ist schlichtes CSS mit Variablen, ohne Komponentenbibliothek. Hauptdatei ist `apps/web/src/styles.css`, einzelne Bereiche liegen in `apps/web/src/styles/`. Ändert sich eine Gestaltungsregel, ändert sich diese Datei im selben Pull Request.

## Farben und Themes

Keine Verläufe, Leuchteffekte oder Endlos-Animationen; Farbe trägt Bedeutung (Akzent, Status, Diagrammreihen).

Farben kommen aus den Variablen in `:root` von `styles.css`; die Themes überschreiben sie unter `[data-theme="…"]`:

| Rolle | Variablen |
| --- | --- |
| Text | `--ink`, `--ink-2`, `--muted` |
| Flächen | `--ground`, `--surface` |
| Linien | `--line`, `--line-soft`, `--line-strong` |
| Akzent | `--accent`, `--accent-hover`, `--accent-ink`, `--accent-soft`, `--accent-tint` |
| Links | `--link`, `--link-hover` |
| Navigation | `--brand`, `--nav`, `--nav-active`, `--nav-ink` |
| Status | `--warn-ink`, `--warn-soft`, `--warn-dot`, `--info-ink`, `--info-soft`, `--danger-ink`, `--danger-soft` |

Die Themes stehen in `apps/web/src/lib/theme.ts`: Wald (Standard), Ozean, Pflaume, Graphit, Nacht und Tiefsee (beide dunkel), dazu „Automatisch“, das der Systemeinstellung folgt.

## Schrift und Abstände

Abstände auf dem 4px-Raster, Schriftgrößen aus 12, 13, 14, 16, 18, 24 und 28px, Beschriftungen und Tabellenköpfe in Satzschreibung statt Versalien mit Sperrung.

Die Schriften stehen in `--sans` und `--mono`, die einheitliche Höhe von Eingabefeldern, Auswahllisten und Knöpfen in `--control-h`.

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
| `btn-sm` | Kleiner Knopf; ersetzt Inline-`minHeight`. |

### Symbole

Symbole kommen aus der `Icon`-Komponente, nicht als Emoji oder Unicode-Zeichen.

### Navigation

Oben in der Navigation steht die Marke: das „H“ und „Haben“ (18px, halbfett); beides bleibt immer gleich. Hat die Firma in den Firmendaten einen Namen, steht er darunter (13px, mittel, in `--nav-ink`, dem Grau der Menüpunkte, damit „Haben“ die Hauptzeile bleibt), denn er zeigt, in welcher Instanz man bucht (#504). Am Desktop nimmt er bis zu zwei Zeilen, damit auch lange Namen passen, am Handy eine, weil die Leiste dort `--nav-height` (60px) hoch bleibt; was nicht passt, endet mit Auslassungszeichen. Am Desktop klappt der Name dann beim Überfahren und mit Fokus auf „Haben“ nach unten ganz auf (Fläche `--nav-active`, weiße Schrift, über den ersten Menüpunkten), Escape und das Verlassen schließen ihn; ein `title` gibt es nicht, weil er nicht zu gestalten und nicht per Tastatur zu erreichen ist.

### Kennzahlen

Die Kennzahlenreihe zeigt nur Zahlen.

### Seitenkopf

Jede Seite beginnt mit `.page-head` als direktem Kind von `<main>`: Titel, Status und Hauptaktionen. Hat die ganze Seite einen Status (Rechnung, Angebot, Umsatzsteuer-Voranmeldung), steht er neben dem Titel (`.title-with-status`), damit er mit dem Kopf sichtbar bleibt. Er bleibt beim Scrollen stehen (#356).

Seine gemessene Höhe steht in `--page-head-height` (`usePageHeadHeight` in `lib/use-page-head.ts`), seine Unterkante samt Handy-Navigation in `--below-head`. Was darunter ebenfalls stehen bleibt (Unternavigation, Belegansicht, Tabellenköpfe, Sprungleisten), nimmt `top: var(--below-head)` statt eines festen Abstands; `scroll-padding-top` hält Sprungziele und Felder mit Fokus unter dem Kopf.

Auf dem Handy steht der Kopf kompakt: die Aktionen in einer Zeile, die seitlich scrollt; im Belegeditor (`.editor-actions`) brechen sie um, damit Speichern und Festschreiben sichtbar bleiben.

Der Kontaktdialog (`ContactDialog`) folgt demselben Muster: Titel in Seitentitelgröße oben und die Knöpfe unten stehen, nur das Formular dazwischen scrollt; der Dialog ist selbst die Karte, das Formular darin hat keinen eigenen Rahmen.

### Rückfragen

Folgenreiches bestätigt der Dialog `ConfirmDialog` (#404), nie ein zweiter Klick auf denselben Knopf und nie `window.confirm`. Der Titel ist eine Frage mit dem Objekt („Entwurf löschen?“), darunter stehen die Folgen, rechts die Aktion mit ihrem Namen, nie „OK“. Der Kopf hat keine Trennlinie und kein Schließen-X; die Linie unter dem Titel gehört zu Formular-Dialogen wie `ContactDialog`, deren Inhalt scrollt.

Geht es um Geld oder das Finanzamt, nennt `facts` über den Folgen, was bestätigt wird: beim Festschreiben einer Rechnung Nummer, Kunde und Betrag, bei ELSTER Steuerart, Zeitraum und Zahllast, beim Lohn Person, Brutto und Auszahlung, beim Beleg Lieferant, Datum und Betrag; ein Storno nennt dasselbe wie das, was es zurücknimmt. Ein Häkchen (`acknowledge`) gibt es nur beim Jahresabschluss, Eintippen gar nicht.

Am Handy ist der Dialog ein Blatt von unten mit der Aktion über „Abbrechen“; an Griff oder Titel nach unten gewischt schließt es wie „Abbrechen“. Fokus beim Öffnen auf „Abbrechen“, danach zurück auf den Auslöser; Esc führt nichts aus.

Rot (`danger`) sind Löschen, Stornieren, Entfernen, Widerrufen, Trennen, endgültiges Beenden und Abschließen, grün der erwartete nächste Schritt wie Festschreiben, Buchen und Senden. Der Dialog schließt vor der Aktion; das Ergebnis meldet die Seite. Tastenkürzel der Seite fragen `isDialogOpen()`.

### Karten

Inhalte stehen in `.card`: Fläche `--surface`, Linie `--line`, Ecken 12px, Innenabstand 20px. Am Handy stehen `.grid-3` und `.grid-4` in zwei Spalten mit 12px Abstand, die Karten darin haben 16px Innenabstand. Felder und normale Knöpfe sind auf Touchgeräten 44px hoch (`--control-h`); ausgenommen sind kleine Knöpfe (`.btn-sm`) und die Knöpfe der Auszeichnungen (`.format-bar`).

Karte in Karte gibt es nicht: Ist ein Dialog oder Blatt selbst die Karte, verliert der Inhalt seinen Rahmen (wie das Formular im `ContactDialog`).

### Blätter am Handy

Am Handy wird aus dem `ConfirmDialog` (bis 640px) sowie aus der Überblendung `PreviewDialog` und ihrer Gestaltungskarte `.design-sheet` (bis 720px) ein Blatt von unten. Formular-Dialoge wie der `ContactDialog` bleiben schwebende, fast bildschirmbreite Dialoge. Ein neues Blatt nutzt `SheetGrip` und `useSwipeToClose`, statt sie nachzubauen, und hält sich an diese Regeln:

- **Form:** volle Breite, unten bündig, nur oben gerundet: `border-radius: var(--sheet-radius) var(--sheet-radius) 0 0`. Der Radius steht einmal in `styles.css`; kein Blatt bekommt einen eigenen Wert, damit alle gleich aussehen.
- **Griff:** `SheetGrip` ist das erste Element des Blatts. `.sheet-grip` ist ausgeblendet; das Blatt schaltet ihn in seiner Media Query ein.
- **Wischen:** `useSwipeToClose` hängt am Griff und, wo das Blatt einen Titel hat, am Titel, nie am scrollenden Inhalt; beide tragen `touch-action: none`. Das Blatt folgt dem Finger und schließt ab 80px, sonst springt es zurück. Das wirkt wie „Schließen“ oder „Abbrechen“; der Knopf bleibt als Alternative. `media` ist dieselbe Breite wie in der Media Query des Blatts.
- **Übereinander:** Sichtbar ist nur der Griff des oberen Blatts, denn zwei übereinander verwirren; den des unteren blendet `.preview-dialog[data-design] > .sheet-grip` aus. Wischen schließt nur das obere Blatt; das darunter bleibt über seinen Titel wischbar.
- **Aufbau:** Kopf und Knöpfe stehen, nur der Inhalt dazwischen scrollt. Im `ConfirmDialog` sind die Knöpfe voll breit und 48px hoch, die Aktion über „Abbrechen“, unten mit Abstand für `env(safe-area-inset-bottom)`.

Die Gestaltungskarte ist am Desktop eine Spalte neben dem Blatt (`.design-sheet` mit `display: contents`). Am Handy steht die Vorschau oben in einem Streifen von `32dvh`, und die Karte überlappt ihn um 16px, damit ihre gerundeten Ecken auf der Vorschau liegen.

### Felder

Neue Formularfelder immer über `Field` (`components/Field.tsx`), je Feld ein `Field`; das gilt auch für zusammengesetzte Felder wie `Combobox`. Der Feldname ist ein `<label>` mit `htmlFor`, nur so breit wie sein Text: Er fokussiert das Feld, die Fläche daneben nicht. Ein umschließendes `<label>` gibt es nicht, denn sonst zählte der Hinweis zum Namen des Felds. Ein Bedienelement in `Field` funktioniert deshalb für sich, ohne dass ein Label darum seinen Klick weiterreicht (`FilePicker` öffnet den Dialog selbst).

Hinweis und Fehler gehen als `hint` und `error` an `Field`, das `aria-describedby` und `aria-invalid` setzt. Steht ein Hinweis außerhalb, etwa für zwei Felder gemeinsam, nennt `describedBy` seine `id`. `announceError` setzt `role="alert"` an die Meldung, für Fehler, die erst nach einer Aktion erscheinen; beim Tippen bleibt es aus. `className` und `style` gehören an die Hülle, etwa für `gridColumn`.

### Felder mit Auszeichnungen

Text, der auf dem Beleg fett, kursiv oder unterstrichen stehen kann, wird in `FormattedTextarea` eingegeben, nicht mit einer eigenen Werkzeugleiste. Die Knöpfe F, K und U (`.format-bar`) schweben an der Markierung, auf Touchgeräten rechts über dem Feld, weil das System sein Menü an die Auswahl legt. Dazu gelten Strg+B, I und U, am Mac mit Cmd. In der Leiste wechseln die Pfeiltasten den Knopf. Solange die Leiste zu sehen ist, schließt Esc nur sie; ein umgebender Dialog bleibt offen.

### Vorschau der Belegeditoren

`components/DocumentPreview.tsx` ist die Hülle für alle Editoren mit Dokumentvorschau (#357): `useDocumentPreview` hält den Modus, `PreviewButton` ist der Split-Button im Seitenkopf, `PreviewLayout` stellt Formular und Vorschau nebeneinander oder öffnet die Überblendung als `<dialog>`. Ob Anheften geht und was ohne gespeicherte Wahl gilt, entscheidet die Breite des Editors (`previewLayout` in `lib/vorschau.ts`, Mindestbreiten dort und in `.preview-layout`). Die Wahl liegt im `localStorage` (`haben-vorschau`). Die Vorschau steht nur im Dokument, wenn sie zu sehen ist.

## Barrierefreiheit

Barrierefrei und per Tastatur bedienbar: echte Knöpfe und Links, ein Label für jedes Feld, sichtbarer Fokus, Text in Akzentfarbe mit `var(--link)`. `barrierefreiheit.spec.ts` prüft das in der CI ([Barrierefreiheit und Tastatur](docs/barrierefreiheit.md)).

## Bekannte Abweichungen

Der Code hält diese Regeln noch nicht überall ein. Neuer Code hält sich an die Regel.

- **4px-Raster:** 71 Zeilen in `apps/web/src/**/*.css` haben in `padding`, `margin` oder `gap` (auch `scroll-padding-*`, `row-gap`, `column-gap`) mindestens einen px-Wert, der nicht durch 4 teilbar ist. Bei 19 davon sind das nur 1 oder 2px, die übrigen 52 enthalten 6, 9, 10, 14, 22, 30 oder 78px.
- **Farben:** 19 Zeilen in `apps/web/src/**/*.css` haben außerhalb von Variablendefinitionen und Kommentaren einen festen Hex-Wert, meist `#fff`, etwa für Text auf Akzent- und Navigationsflächen (`.btn-primary`, `.brand`, `.nav-link:hover`).
- **Schriftgrößen:** `components/IbanCheck.tsx` setzt an zwei Überschriften `fontSize: 15`. Das Blatt der Belegvorschau (`.sheet`) rechnet seine Schrift mit der Seitenbreite um (`var(--mm)`).
- **Verläufe:** `styles.css` nutzt `linear-gradient` für den auslaufenden Rand des Blatts in der Vorschau (`.preview-pane-body`, `.preview-dialog-body`, `.sheet-frame::before` und `::after`) und `conic-gradient` für das Farbfeld „Eigene Farbe“ (`.color-swatch-custom`).
- **Felder:** 413-mal in 86 Dateien steht noch `<label className="field">`. `Field` nutzen bisher das Kontaktformular und das Feld „Kunde“ im Rechnungseditor; die übrigen stellt ein Folge-Pull-Request um.
- **Symbole:** Als Unicode-Zeichen statt über `Icon` stehen `▾` und `▸` (mit `aria-hidden`) im aufklappbaren Abschnitt in `routes/_app/umsatzsteuer/$zeitraum.tsx`, `›` als Aufklapp-Pfeil (`.chevron` in `components/BilanzGuv.tsx`, `routes/_app/konten/index.tsx`, `routes/_app/buchungen/index.tsx`; `.est-block > summary::before` in `styles/auswertungen.css`), `‹` und `›` an Blätter-Knöpfen (`components/archiv/DatevBookings.tsx`, `routes/_app/auswertungen.tsx`, `routes/_app/buchungen/index.tsx`, `routes/_app/belege/$id.tsx`), `›` als Trenner im Pfad über dem Seitentitel und `→` in `routes/_app/kasse.tsx`.
