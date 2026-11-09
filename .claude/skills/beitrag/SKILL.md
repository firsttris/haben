---
name: "beitrag"
description: "Eine Änderung an Haben als Pull Request einreichen: Branch im Repo oder Fork, Commits, Titel, Beschreibung mit KI-Kennzeichnung, Screenshots bei UI-Änderungen, Draft. Funktioniert mit GitHub-Werkzeug (CLI, MCP, Plugin, Connector) oder nur mit git. Wenn eine Änderung gepusht oder ein Pull Request angelegt werden soll."
---

# Beitrag einreichen

Die Regeln (was in einen Pull Request gehört, Branch, Titel, Commits, KI-Kennzeichnung) stehen in `docs/entwicklung.md` unter „Mitwirken“. Hier die Schritte. Ohne ausdrücklichen Auftrag nichts pushen.

Ist ein Werkzeug für GitHub da, egal unter welchem Namen (`gh`, MCP-Server, Plugin, Connector), damit Rechte prüfen und den Pull Request anlegen. Sonst geht alles mit `git` und der Person.

## 1. Branch

- Vom aktuellen `origin/main` (`git fetch origin`), ein Thema je Branch.
- Schreibrecht in `firsttris/haben` prüfen: mit `gh` über `gh repo view firsttris/haben --json viewerPermission` (`WRITE`, `MAINTAIN`, `ADMIN`); nur mit git über `git push --dry-run origin HEAD:refs/heads/<branch>` (`403` heißt nein); ohne Zugang die Person fragen.
- Mit Schreibrecht in `origin`, sonst im Fork der Person.

## 2. Commits

Prüfungen nach Skill `checks`, dann Commits wie unter „Branches, Titel und Commits“, jeder mit `Co-Authored-By: <Werkzeug/Modell> <Adresse>` als letzter Zeile.

## 3. Beschreibung

Als Datei (im Scratchpad), auf Deutsch:

- Titel `Bereich: was sich ändert (#Issue)`; den Rest prüft der Workflow „PR-Regeln“.
- Was und warum, `Refs #…` (nicht `Closes`, siehe „Branches, Titel und Commits“), wie geprüft, **was übersprungen wurde** (Skill `checks`).
- Bei Änderungen am Aussehen die Bilder nach Skill `pr-screenshots`.
- Letzte Zeile „🤖 Generated with <Werkzeug>“.

## 4. Pull Request anlegen

- Mit Werkzeug: als **Entwurf** gegen `main` (`gh pr create --draft --base main --title … --body-file …`).
- Nur git: den Link aus der Ausgabe von `git push` und den Pfad der Beschreibung an die Person geben.
- „Ready for review“ nur auf Freigabe der Person; erst dann läuft die CI.

## 5. Danach

Review nach Skill `tdd-review`, nie durch die Session, die den Code geschrieben hat. Link, Stand der Prüfungen und Übersprungenes zurückmelden.
