---
name: "beitrag"
description: "Eine Änderung an Haben als Pull Request einreichen: Branch im Repo oder Fork, Commits, Titel, Beschreibung mit KI-Kennzeichnung, Screenshots bei UI-Änderungen, Draft. Funktioniert mit GitHub-Werkzeug (CLI, MCP, Plugin, Connector) oder nur mit git. Wenn eine Änderung gepusht oder ein Pull Request angelegt werden soll."
---

# Beitrag einreichen

Regeln in `CLAUDE.md` (Pull requests) und `docs/entwicklung.md` (Mitwirken); hier die Schritte. Pull Requests bleiben Entwurf, bis die Person sie freigibt, wenn sie das so will. Ohne ausdrücklichen Auftrag nichts pushen.

## GitHub-Werkzeug oder nur git

Ist ein Werkzeug für GitHub verfügbar, egal unter welchem Namen (CLI wie `gh`, MCP-Server, Plugin, Connector), damit Schreibrecht prüfen, Pull Request anlegen und Beschreibung setzen. Sonst geht alles mit `git` und der Person; `gh` ist nur der Schnellweg, keine Voraussetzung.

## 1. Branch

- Vom aktuellen `origin/main` (`git fetch origin`), ein Thema je Branch. Nie auf `main` pushen.
- **Schreibrecht in `firsttris/haben`?**
  - mit GitHub-Werkzeug: Rechte des Repos abfragen (mit `gh`: `gh repo view firsttris/haben --json viewerPermission`; `WRITE`, `MAINTAIN` oder `ADMIN`);
  - nur git: `git push --dry-run origin HEAD:refs/heads/<branch>`; `403`/`Permission denied` heißt kein Schreibrecht;
  - kein Zugang zum Remote (keine Anmeldung): die Person fragen.
- Mit Schreibrecht: Branch in `origin`. Sonst Fork der Person als eigenes Remote und dort pushen.
- Vor jedem Push prüfen, ob der Pull Request des Branches noch offen ist; ist er gemergt, neu von `origin/main` und neuer Pull Request (`CLAUDE.md`).

## 2. Commits

- Deutsch, Typen nach Conventional Commits mit optionalem Bereich: `feat(belege): …`, `fix: …`, `test: …`, `docs: …`, `refactor: …`, `chore: …`. Quelle nennen, wo sie ein Detail entscheidet.
- KI-Kennzeichnung in jedem Commit, den ein Agent geschrieben hat: `Co-Authored-By: <Werkzeug/Modell> <Adresse>` als letzte Zeile.
- Vorher die Prüfungen (Skill `checks`).

## 3. Beschreibung

Als Datei schreiben (etwa im Scratchpad), auf Deutsch:

- Titel: `Bereich: was sich ändert (#Issue)`.
- Was und warum, `Refs #…` (nicht `Closes`/`Fixes`: das Issue bleibt bis zur Rückmeldung offen, siehe Label `rückmeldung`), wie geprüft, **was übersprungen wurde** (Skill `checks`, Schritt 4).
- **UI/UX geändert:** Bilder vorher und nachher, hell und dunkel, wo nötig Handy (Skill `pr-screenshots`). Fehlen die Vorher-Bilder, dort Schritt „Nachträglich“.
- Letzte Zeile: „🤖 Generated with <Werkzeug>“, wenn ein Agent wesentlich mitgeschrieben hat.

## 4. Pull Request anlegen

- Mit GitHub-Werkzeug: als **Entwurf** gegen `main` anlegen, Titel und Beschreibung aus der Datei (mit `gh`: `gh pr create --draft --base main --title … --body-file …`).
- Nur git: nach dem Push nennt GitHub in der Ausgabe den Link zum Anlegen. Link und Pfad der Beschreibungsdatei an die Person geben; sie legt den Entwurf an.
- Die CI läuft für Entwürfe nicht. Erst mit „Ready for review“, und das nur auf Freigabe der Person. Ändert der Pull Request nur Markdown, `docs/` oder `LICENSE` und löscht oder verschiebt dabei keine Datei, werden ihre Jobs auch dann übersprungen (Job `changes` in `.github/workflows/ci.yml`) und die Doku baut erst auf `main`: Doku-Build vorher lokal (Skill `checks`) und das im Pull Request vermerken.

## 5. Danach

- Review nach Skill `tdd-review`, nie durch die Session, die den Code geschrieben hat.
- Link zum Pull Request, Stand der Prüfungen und Übersprungenes zurückmelden.
