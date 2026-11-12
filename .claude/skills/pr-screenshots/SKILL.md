---
name: "pr-screenshots"
description: "Screenshots vorher und nachher für Pull Requests mit Änderungen am Aussehen von Haben: aufnehmen (hell und dunkel, Desktop und Handy) bevor die Oberfläche geändert wird, danach erneut, und in `firsttris/haben-bilder` ablegen oder als Anhang hochladen. Zu Beginn jeder Arbeit an der Oberfläche laden, nicht erst beim Pull Request."
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
- Dateien benennen: `<ansicht>-<hell|dunkel>-<desktop|handy>-vorher.png`, im Scratchpad ablegen, nicht im Repository von Haben.

## 2. Nachher aufnehmen

Dieselben Ansichten, Themes, Größen und Daten, Endung `-nachher.png`.

## 3. Hochladen

Der erste Weg, der geht:

1. **`firsttris/haben-bilder`**, für alle mit Schreibrecht dort (Maintainer, Collaborators); prüfen mit `gh api repos/firsttris/haben-bilder --jq .permissions.push`. Das README dort gilt (`gh api repos/firsttris/haben-bilder/contents/README.md --jq .content | base64 -d`):
   - flach klonen (`git clone --depth 1 https://github.com/firsttris/haben-bilder` ins Scratchpad), auf `main` je Pull Request ein Ordner `pr-<n>/`;
   - nur neue Commits, nie Force-Push: Die Beschreibung verlinkt über den Commit-SHA;
   - einbinden über `https://raw.githubusercontent.com/firsttris/haben-bilder/<sha>/pr-<n>/<datei>.png`, `<sha>` aus `git rev-parse HEAD` nach dem Push.
2. **Anhang über ein GitHub-Werkzeug:** Kann das vorhandene GitHub-Werkzeug (egal unter welchem Namen) Bilder an Pull Request oder Kommentar hängen und gibt eine Anhang-URL zurück (`github.com/user-attachments/…`), das nutzen. Ein Werkzeug, das die Bilder als Dateien in ein Repository committet, zählt nicht als Anhang.
3. **Anhang über ein Browser-Werkzeug:** Pull Request auf GitHub öffnen, Bilder ins Kommentar- oder Beschreibungsfeld hochladen, die erzeugten Anhang-URLs übernehmen. Den Kommentar nur absenden, wenn die Person das will; die URLs gelten schon nach dem Hochladen.
4. **Person lädt hoch:** Pfade der Bilder nennen und bitten, sie ins Textfeld des Pull Requests zu ziehen.
5. **Notlösung, eigener Fork von `haben-bilder`:** für Agenten ohne jeden Upload und ohne Person, die hochlädt. `firsttris/haben-bilder` forken, nicht den Fork von Haben um einen Branch erweitern. Ordner und Dateinamen wie in Weg 1, nur neue Commits, Einbinden über `https://raw.githubusercontent.com/<konto>/haben-bilder/<sha>/pr-<n>/<datei>.png`. Mit dem Fork verschwinden die Bilder; das in der Beschreibung nicht verschweigen.

Nie ein Branch nur für Bilder in `firsttris/haben`: Jeder Klon lädt alle Branches.

## 4. In die Beschreibung

Als Tabelle, Vorher links, Nachher rechts, je Theme und Größe eine Zeile:

```markdown
| | Vorher | Nachher |
| --- | --- | --- |
| Hell, Desktop | <img src="…" width="400"> | <img src="…" width="400"> |
| Dunkel, Handy | <img src="…" width="200"> | <img src="…" width="200"> |
```

## Nachträglich

Fehlen die Bilder für „vorher“, weil schon geändert ist: einen Worktree auf `origin/main` anlegen, dort eine eigene Instanz starten (Skill `checks`, Schritt 2, anderer Projektname und Ports), dieselben Testdaten anlegen und aufnehmen. Danach die Instanz mit `down -v` und den Worktree wieder entfernen.
