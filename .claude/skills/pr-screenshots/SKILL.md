---
name: "pr-screenshots"
description: "Screenshots vorher und nachher für Pull Requests mit Änderungen am Aussehen von Haben: aufnehmen (hell und dunkel, Desktop und Handy) bevor die Oberfläche geändert wird, danach erneut, und als Anhang in den Pull Request hochladen. Zu Beginn jeder Arbeit an der Oberfläche laden, nicht erst beim Pull Request."
---

# Screenshots vorher und nachher

Regel in `docs/entwicklung.md` (Mitwirken): Änderungen am Aussehen zeigen Bilder vorher und nachher in der Beschreibung des Pull Requests. Die Bilder für „vorher“ entstehen **bevor** die Oberfläche geändert wird; danach müsste der alte Stand eigens wieder aufgebaut werden.

Was für die Oberfläche gilt, steht in `DESIGN.md` im Wurzelverzeichnis: vor der Arbeit lesen.

Nur Testdaten zeigen, nie echte Belege, Steuernummern, IBANs oder Zugangsdaten: Die Bilder sind öffentlich.

## 1. Vorher aufnehmen

- App starten: mit Bun `bun run dev`, sonst Dev-Container mit eigener Instanz (Skill `checks`, Schritt 2). Erstes Konto mit dem Einrichtungscode aus dem Log.
- Testdaten so anlegen, dass die betroffene Ansicht etwas zeigt, und sich merken, wie (dieselben Daten für „nachher“).
- Mit einem Browser-Werkzeug (Browserfenster der Session, Playwright o. Ä.) je betroffene Ansicht:
  - helles und dunkles Theme (Einstellungen › Darstellung oder `prefers-color-scheme`);
  - Desktop (etwa 1280 breit) und, wo es darauf ankommt, Handy (375 × 812);
  - nur der relevante Ausschnitt, wenn die Seite lang ist.
- Dateien benennen: `<ansicht>-<theme>-<desktop|handy>-vorher.png`, im Scratchpad ablegen, nicht im Repository.

## 2. Nachher aufnehmen

Dieselben Ansichten, Themes, Größen und Daten, Endung `-nachher.png`.

## 3. Hochladen, als Anhang

In dieser Reihenfolge, das erste, das geht:

1. **GitHub-Werkzeug mit Datei-Upload:** Kann das vorhandene GitHub-Werkzeug (egal unter welchem Namen) Bilder an Pull Request oder Kommentar hängen und gibt eine Anhang-URL zurück (`github.com/user-attachments/…`), das nutzen. Ein Werkzeug, das die Bilder als Dateien ins Repository committet, zählt nicht; das ist Weg 4.
2. **Browser-Werkzeug mit Datei-Upload:** Pull Request auf GitHub öffnen, Bilder ins Kommentar- oder Beschreibungsfeld hochladen, die erzeugten Anhang-URLs übernehmen. Den Kommentar nur absenden, wenn die Person das will; die URLs gelten schon nach dem Hochladen.
3. **Person lädt hoch:** Pfade der Bilder nennen und bitten, sie ins Textfeld des Pull Requests zu ziehen.
4. **Notlösung, Branch nur für Bilder:** nur im **eigenen Fork**, nie in `firsttris/haben` (jeder Klon lädt alle Branches). Branch ohne gemeinsame Historie (`git switch --orphan pr-bilder`), je Pull Request ein Ordner `pr-<n>/`, nur neue Commits, nie Force-Push. Einbinden über `https://raw.githubusercontent.com/<fork>/<sha>/pr-<n>/<datei>.png` mit dem Commit-SHA. Mit dem Branch oder dem Fork verschwinden die Bilder; das in der Beschreibung nicht verschweigen.

## 4. In die Beschreibung

Vorher und nachher nebeneinander, je Theme und Größe eine Zeile:

```markdown
| | Vorher | Nachher |
| --- | --- | --- |
| Hell, Desktop | <img src="…" width="400"> | <img src="…" width="400"> |
| Dunkel, Handy | <img src="…" width="200"> | <img src="…" width="200"> |
```

## Nachträglich

Fehlen die Bilder für „vorher“, weil schon geändert ist: einen Worktree auf `origin/main` anlegen, dort eine eigene Instanz starten (Skill `checks`, Schritt 2, anderer Projektname und Ports), dieselben Testdaten anlegen und aufnehmen. Danach die Instanz mit `down -v` und den Worktree wieder entfernen.
