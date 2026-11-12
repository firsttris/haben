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
- Was und warum, `Umgesetzt #…` wenn der Pull Request das Issue fertig macht, sonst `Refs #…` (nie `Closes` oder `Fixes`, siehe „Branches, Titel und Commits“), wie geprüft, **was übersprungen wurde** (Skill `checks`).
- Bei Änderungen am Aussehen die Bilder nach Skill `pr-screenshots`.
- Die Beschreibung wird die Nachricht des Squash-Commits auf `main` (`docs/entwicklung.md`, „Branches, Titel und Commits“): Sie nennt alles, was der Pull Request ändert, und beschreibt das Ergebnis, nicht den Weg dorthin.
- Letzte Zeile „🤖 Generated with <Werkzeug>“.

## 4. Vor dem Push

- Gibt es zum Branch schon einen Pull Request, prüfen, ob er noch offen ist (`gh pr view <branch> --json state`, sonst auf GitHub nachsehen oder die Person fragen). Ist er gemergt, neu von `origin/main` beginnen, die eigenen Commits darauf setzen und einen neuen Pull Request anlegen; nie auf einen gemergten Branch weiterpushen.
- Force-Push nur mit `--force-with-lease` auf den eigenen Branch.

## 5. Pull Request anlegen

- Mit Werkzeug: als **Entwurf** gegen `main` (`gh pr create --draft --base main --title … --body-file …`).
- Nur git: den Link aus der Ausgabe von `git push` und den Pfad der Beschreibung an die Person geben.
- „Ready for review“ nur auf Freigabe der Person; erst dann läuft die CI.

## 6. Danach

Zuerst die Selbstprüfung nach Skill `beitrag-pruefen` (Wollen wir das, Quellen, einfachste Lösung, Regeln), dann das Review nach Skill `tdd-review`, wenn nur Markdown geändert ist nach Skill `doku-pruefen`; beides nie durch die Session, die den Code geschrieben hat. Ob die Änderung gewollt ist, klärt man am besten schon vor dem ersten Code im Issue. Link, Stand der Prüfungen und Übersprungenes zurückmelden.

Die Beschreibung bleibt bis zum Merge aktuell: Nach jedem Push, der ändert, was der Pull Request tut oder wie er geprüft wurde, auch nach Fixes aus dem Review und nach einem Rebase, die Datei anpassen und die Beschreibung mit dem vorhandenen GitHub-Werkzeug ersetzen, etwa `gh pr edit <nummer> --body-file …`. Ohne Werkzeug den neuen Text an die Person geben.
