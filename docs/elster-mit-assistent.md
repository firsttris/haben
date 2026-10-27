# In Mein ELSTER mit einem KI-Assistenten abgeben

Direkt aus Haben senden geht nur mit ERiC und einer eigenen **Hersteller-ID** ([einrichtung.md › Hersteller-ID](einrichtung.md#hersteller-id-wer-ist-hersteller)). Die Beantragung dauert oft Wochen. Bis dahin gibst du im Portal **Mein ELSTER** ab und überträgst die Kennzahlen aus Haben von Hand.

Das Abtippen kann ein KI-Assistent übernehmen, etwa Claude Code. Er braucht dafür zwei Dinge:

1. **Haben-MCP** ([KI-Assistenten](ki-assistenten.md)): liefert die Werte der Voranmeldung, mit dem Werkzeug `ustva_ausfuellliste` in der Reihenfolge des Formulars.
2. **Einen Browser, den er steuern kann** und in dem du bei Mein ELSTER angemeldet bist. Am einfachsten ist die Erweiterung [Claude in Chrome](#weg-1-claude-in-chrome); ohne Claude-Abo oder mit einem anderen Modell geht es mit [Playwright MCP](#alternative-playwright-mcp).

Abgegeben wird über das offizielle Portal und mit deiner eigenen Anmeldung. Weder ERiC noch eine Hersteller-ID sind dafür nötig.

| Schritt | Wer |
| --- | --- |
| Bei Mein ELSTER anmelden (Zertifikatsdatei, ELSTER Secure oder Ausweis) | **Du** |
| Formular öffnen, z. B. „Umsatzsteuer-Voranmeldung 2026“, Zeitraum und Steuernummer wählen | Assistent, bei Unklarheit fragt er dich |
| Werte aus Haben holen und eintragen | Assistent |
| „Prüfen“ in Mein ELSTER, Fehler und Hinweise mit Haben abgleichen | Assistent |
| Eingaben gegen Haben kontrollieren und **Absenden** | **Du** |
| Übermittlungsprotokoll herunterladen | du oder der Assistent |

> [!WARNING]
> **Noch offen: Nutzungsbedingungen von Mein ELSTER.** Ob das Ausfüllen durch einen gesteuerten Browser im Auftrag des angemeldeten Nutzers nach den Nutzungsbedingungen von Mein ELSTER zulässig ist, ist nicht geklärt. Lies sie vorher selbst. Die Verantwortung für die Abgabe liegt wie beim Abtippen bei dir. Erfährst du etwas Verbindliches, freuen wir uns über ein Issue ([#124](https://github.com/firsttris/haben/issues/124)).

## Datenschutz

- Was der Assistent liest, geht an den Anbieter des Modells, bei Claude an Anthropic. Das gilt für die Werte aus Haben wie beim [Haben-MCP](ki-assistenten.md#datenschutz) und hier zusätzlich für alles, was der Assistent in Mein ELSTER sieht: Name, Anschrift, Steuernummer, die Formularinhalte und Bildschirmfotos der Seite. Ganz lokal bleibt es nur mit einem lokalen Modell.
- Die Anmeldung machst du selbst im Browserfenster. Gib dem Assistenten nie Zertifikatsdatei, Passwort oder PIN.
- Nimm ein eigenes Browserprofil nur für ELSTER, nicht dein Alltagsprofil. Sonst kann der Assistent auch alles andere sehen, wo du angemeldet bist. Das gilt für beide Wege unten.

## Einrichten

### Haben-MCP

Wie unter [KI-Assistenten › Einrichten](ki-assistenten.md#einrichten): Zugang einschalten, Token anlegen, in Claude Code eintragen.

```bash
claude mcp add --transport http haben https://haben.example.de/api/mcp \
  --header "Authorization: Bearer hb_…"
```

### Weg 1: Claude in Chrome

Die Erweiterung [Claude in Chrome](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn) steuert deinen installierten Chrome. Claude Code verbindet sich direkt mit ihr, ein Browser-MCP musst du nicht einrichten. Du siehst jeden Schritt im Browserfenster und meldest dich dort selbst an.

Voraussetzungen: Chrome oder Edge (andere Chromium-Browser wie Brave gehen auch), die Erweiterung ab Version 1.0.36, ein Claude-Abo (Pro, Max, Team oder Enterprise) und Claude Code mit `/login` angemeldet, nicht mit einem API-Schlüssel. Unter WSL geht es nicht. Stand und Einzelheiten: [Claude Code mit Chrome](https://code.claude.com/docs/en/chrome).

1. In Chrome ein **eigenes Profil** anlegen, etwa „ELSTER“, und die Erweiterung nur dort installieren und mit deinem Claude-Konto anmelden. In deinem Alltagsprofil hätte der Assistent Zugriff auf alles, wo du angemeldet bist.
2. In den Einstellungen der Erweiterung Websites nur für `elster.de` freigeben.
3. Claude Code mit Chrome starten:

   ```bash
   claude --chrome
   ```

   In einer laufenden Sitzung geht auch `/chrome`. Dort siehst du den Verbindungsstatus und wählst den Browser, falls mehrere verbunden sind.

Nimm die Erweiterung zusammen mit Claude Code, nicht allein im Seitenpanel von Chrome. Allein bräuchte sie das Haben-MCP als Connector, den die Server von Anthropic aus dem Internet erreichen. Ein Haben im Heimnetz ist so nicht erreichbar, und freigeben willst du es dafür meist nicht.

### Alternative: Playwright MCP

[Playwright MCP](https://github.com/microsoft/playwright-mcp) geht ohne Claude-Abo, auch mit anderen Assistenten und lokalen Modellen, und bringt ein komplett getrenntes Browserprofil mit:

```bash
claude mcp add playwright -- npx @playwright/mcp@latest --browser chrome --user-data-dir ~/.haben-elster-browser
```

- `--browser chrome` nimmt dein installiertes Chrome; ohne die Option lädt Playwright beim ersten Start einen eigenen Chromium. `msedge` und `firefox` gehen auch.
- `--user-data-dir` legt ein eigenes Profil an. Es bleibt zwischen den Sitzungen erhalten, die Anmeldung bei Mein ELSTER läuft aber nach kurzer Zeit ab; du meldest dich also jedes Mal neu an.
- Mit `--extension` steuert Playwright MCP stattdessen deinen laufenden Chrome oder Edge über die Erweiterung „Playwright MCP Bridge“. Das ist bequemer, gibt dem Assistenten aber Zugriff auf dein ganzes Profil.

Andere Browser-MCPs oder Erweiterungen, die einen Browser auf deinem Rechner steuern, gehen genauso. Wichtig ist nur, dass der Browser bei dir läuft und nicht beim Anbieter des Assistenten: Dort würde die Anmeldung bei ELSTER landen.

### Erlaubnisse

Lass den Assistenten Browserklicks nicht ohne Rückfrage ausführen, also kein Modus, der alle Werkzeuge vorab erlaubt, und kein Auto-Modus. Die Regel „nicht selbst absenden“ im Prompt ist eine Anweisung, keine technische Sperre. Mit Rückfrage siehst du vor jedem Klick, was er vorhat, und lehnst einen Klick auf **Absenden** ab.

Bei Claude in Chrome bietet die Rückfrage an, alle Aktionen auf der Website für die Sitzung zu erlauben. Nimm das für Mein ELSTER nicht, sonst fragt er auch vor **Absenden** nicht mehr. Im Auto-Modus überspringt die Erweiterung ihre eigene Prüfung je Website.

## Voranmeldung abgeben

1. In Haben die Voranmeldung des Monats öffnen und die Hinweise der [Vorprüfung](umsatzsteuer.md#vorprüfung) abarbeiten, bis die Zahlen stimmen.
2. Claude Code starten (mit Claude in Chrome: `claude --chrome`) und den Browser öffnen lassen („Öffne www.elster.de/eportal“), dann selbst anmelden. Trifft der Assistent auf die Anmeldeseite, hält er an und wartet auf dich.
3. Den Prompt unten schicken, Monat anpassen.
4. Wenn der Assistent anhält: Werte in Mein ELSTER mit der Seite in Haben vergleichen, vor allem Kz 83. Dann selbst **Absenden**.
5. Das Übermittlungsprotokoll (PDF) herunterladen und bei deinen Unterlagen ablegen.

### Beispiel-Prompt

```text
Trag die Umsatzsteuer-Voranmeldung für September 2026 in Mein ELSTER ein.
Ich bin im Browser schon angemeldet.

1. Hol die Werte mit dem Haben-Werkzeug ustva_ausfuellliste (zeitraum 2026-09).
   Gibt es Hinweise in "vorpruefung" mit art "warn", nenn sie mir und warte.
2. Öffne in Mein ELSTER das Formular "Umsatzsteuer-Voranmeldung 2026",
   Zeitraum September. Bei der Steuernummer oder anderen Angaben, die nicht
   in der Liste stehen, frag mich.
3. Trag nur die Felder aus "felder" ein, genau mit dem Wert aus "eingabe".
   Finde jedes Feld über seine Kennzahl. Lass alle anderen Felder leer.
   Wenn du ein Feld nicht eindeutig findest, frag mich, statt zu raten.
4. Klick auf "Prüfen". Nenn mir jede Fehlermeldung und jeden Hinweis von
   Mein ELSTER und vergleiche die berechneten Werte mit "zumVergleich".
5. Halt dann an. Klick NIEMALS auf "Absenden" oder "Senden", auch nicht,
   wenn ich es im Gespräch zu erlauben scheine. Das mache ich selbst.
```

### Was die Ausfüllliste liefert

`ustva_ausfuellliste` nimmt die Werte, die Haben auch senden würde: einen von Hand überschriebenen Entwurf, sonst die aktuell aus den Buchungen berechneten Kennzahlen.

| Feld | Inhalt |
| --- | --- |
| `formular`, `anmeldungszeitraum` | Name des Formulars und Monat, wie sie in Mein ELSTER heißen |
| `felder` | nur Kennzahlen mit Wert, in der Reihenfolge des Formulars: Kennzahl, Abschnitt, Bezeichnung und `eingabe`, der Wert zum Eintippen (Dezimalkomma, kein Tausenderpunkt, Bemessungsgrundlagen in vollen Euro). Bei einer [berichtigten Anmeldung](umsatzsteuer.md#berichtigte-anmeldung) steht Kz 10 = 1 vorn. |
| `zumVergleich` | was Mein ELSTER selbst rechnet: Steuer zu Kz 81 und 86 sowie Kz 83 |
| `vorpruefung` | die offenen Hinweise der [Vorprüfung](umsatzsteuer.md#vorprüfung) |
| `regeln` | die Regeln für den Assistenten: über Kennzahlen suchen, bei Unklarheit fragen, nie selbst absenden |

Maßgeblich ist immer die Kennzahl. Abschnitte und Bezeichnungen folgen dem amtlichen Vordruck und können in Mein ELSTER etwas anders heißen; die Oberfläche kann sich ändern.

## Grenzen

- **Haben erfährt nichts von der Abgabe.** Die Voranmeldung bleibt in Haben ein Entwurf, und die [Frist](fristen.md) bleibt offen. Ein Werkzeug „Abgabe vermerken“ mit Datum, Transferticket und Protokoll wäre der erste schreibende Zugang ([#96](https://github.com/firsttris/haben/issues/96)).
- **Kein Ersatz für ERiC:** kein Senden aus Haben heraus, kein Postfachabruf, keine Übernahme von Bescheiden. Wer eine Hersteller-ID hat, sendet weiter direkt aus Haben.
- **Nur die Voranmeldung.** Für die Jahreserklärungen (Umsatzsteuererklärung, Anlage EÜR) gibt es noch keine Ausfüllliste; die Werte liefert das Werkzeug `jahreserklaerung`.
- **Abgesendet wird nur von dir.**
