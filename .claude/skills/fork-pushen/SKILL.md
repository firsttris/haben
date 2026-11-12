---
name: "fork-pushen"
description: "Eigene Commits (Fixes aus Review oder Beitragsprüfung, Ergänzungen) auf den Branch eines Pull Requests an Haben pushen, der aus dem Fork einer anderen Person kommt. In einer Cloud-Session (claude.ai/code) geht das nur über eine neue Session mit dem Fork als Quelle; nicht erst git push oder add_repo probieren. Vor jedem Push auf einen fremden Fork laden."
---

# Auf einen fremden Fork pushen

Voraussetzung: Im Pull Request ist „Allow edits by maintainers“ an; sonst darum bitten oder als letzten Ausweg einen eigenen Pull Request anlegen (`docs/entwicklung.md`, „Review“, Schritt 4). Commits der beitragenden Person nie umschreiben, nie Force.

**Lokal** (Claude Code auf dem eigenen Rechner): `git push` auf den Branch des Forks geht mit den eigenen Zugangsdaten. Der Rest dieses Skills betrifft nur die Cloud.

**Cloud-Session:** Sie schreibt nur in die Repositories, die beim Start als Quelle gewählt wurden. Ein Fork heißt meist ebenfalls `haben`; neben `firsttris/haben` lässt er sich nicht nachträglich hinzufügen (gleicher Name, gleiches Verzeichnis), und `git push`, `add_repo` und das GitHub-Werkzeug lehnen ihn ab. Das nicht durchprobieren und niemanden bitten, von Hand zu pushen, sondern sofort so:

1. Die Commits in dieser Session fertig machen und prüfen, auf einer lokalen Kopie des PR-Branches (`git fetch origin pull/<nr>/head:pr-<nr>`). Den erwarteten HEAD-SHA des Forks notieren.
2. `git format-patch <head-sha>..pr-<nr> --stdout` erzeugt den Patch mit Nachrichten, Autor und Trailern.
3. Mit `create_session` eine **Session mit dem Fork als einziger Quelle** starten: `source_url` `https://github.com/<owner>/haben`, `source_revision` und `outcome_branch` der Branch des PR. Im Prompt:
   - der Maintainer hat den Push angewiesen, sonst nichts ändern, keinen Pull Request, keine Kommentare;
   - der erwartete HEAD-SHA, bei Abweichung abbrechen;
   - der Patch zwischen Markern, anzuwenden mit `git am`;
   - die Kontrolle (`git log`, `git diff --stat`, bei Code die Prüfung wie Biome);
   - `git push origin HEAD:<branch-des-pr>` ohne Force und auf keinen anderen Branch, am Ende den neuen SHA melden.
4. Auf das Ende der Hilfssession warten (sie meldet sich nicht von selbst): `get_session` bis `status_bucket` nicht mehr `working` ist, ihre Antwort mit `list_events` und `kinds` `["assistant", "result"]`. Dann den Push prüfen: `git ls-remote origin refs/pull/<nr>/head` zeigt den neuen SHA. Die Hilfssession danach mit `archive_session` beenden.
