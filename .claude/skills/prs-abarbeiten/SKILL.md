---
name: "prs-abarbeiten"
description: "Die offenen Pull Requests an Haben als Maintainer der Reihe nach abarbeiten: alle, die nicht Draft sind, als Rangliste von „am einfachsten zu mergen“ bis „wartet auf den Autor“, dann von oben nach unten je Pull Request beitrag-pruefen in einem frischen Agenten, Fixes auf den Branch, Befunde posten, bei grüner CI mergen und danach wieder von vorn. Bei Steuer, Buchung, ELSTER und GoBD erst nach OK des Maintainers. Wenn der Maintainer sagt „arbeite die Pull Requests ab“; auf eine Frage wie „was können wir mergen?“ nur die Rangliste."
---

# Pull Requests abarbeiten

Der Skill ordnet und verteilt nur. Die Prüfung eines Pull Requests macht `beitrag-pruefen` mit `tdd-review` und `doku-pruefen`, den Push auf einen Fork `fork-pushen`. Die Regeln dafür stehen in `docs/mitwirken.md` unter „Beiträge annehmen“ und „Review“. Er läuft nur für einen Maintainer oder einen Collaborator mit dessen Zustimmung.

## 1. Lage erfassen

`git fetch origin`, dann alle offenen Pull Requests ohne Drafts. Für jeden festhalten:

- Head-SHA, Autor, Fork und „Allow edits by maintainers“, `mergeable`
- CI auf dem Head: grün, rot (welcher Job, welcher Test) oder nicht gelaufen. Nicht gelaufen heißt bei einem Erstbeitrag meist, dass der Maintainer die CI in GitHub freigeben muss.
- Wer zuletzt etwas getan hat: neue Commits oder Kommentare des Autors seit unserem letzten Kommentar? Wartet er auf uns oder wir auf ihn?
- Migrationen im Diff mit ihrer Nummer
- Heikel, also Steuer, Buchung, ELSTER, GoBD oder Migration auf bestehenden Daten?

Ist auf `main` ein Check rot, kommt das vor allem anderen: Sonst ist er in jedem Pull Request rot. Einen Fix legt der Maintainer an oder lässt ihn anlegen.

Pull Requests, die der Maintainer anderen überlassen hat (eigene Pull Requests eines Collaborators, Pull Requests, die ein Collaborator betreut), fasst der Skill nicht an. Steht dazu nichts im Verlauf, fragt er einmal.

## 2. Rangliste

Von oben nach unten, wie einfach der Merge ist:

1. **Fertig:** Prüfung durch, Befunde behoben, CI grün, Beschreibung stimmt. Nur noch Nachprüfung der letzten Commits und Merge.
2. **Klein und neu:** wenige Dateien, keine Migration, nicht heikel, CI grün
3. **Neu und heikel oder groß:** braucht eine volle Prüfung und das OK des Maintainers
4. **Autor hat nachgeliefert:** nur die neuen Commits gegen die offenen Befunde prüfen
5. **Konflikt oder rote CI**, die der Pull Request selbst verursacht
6. **Wartet auf den Autor:** Befunde stehen schon im Pull Request, seitdem nichts Neues. Nichts tun.

Gleich einfache Pull Requests nach Alter. Belegen zwei dieselbe Migrationsnummer, kommt der fertigere zuerst; der andere erzeugt seine Migration nach dem Merge neu.

Die Rangliste geht als Tabelle an den Maintainer, mit einer Zeile je Pull Request: Platz, Nummer, Titel, Stand, nächster Schritt.

Hat der Maintainer nur gefragt, endet der Skill hier; Schritt 3 erst auf sein Wort.

## 3. Von oben nach unten

Je Pull Request einen frischen Agenten mit `beitrag-pruefen` in der Rolle des Maintainers. Unabhängige Pull Requests laufen parallel. Der Auftrag an den Agenten:

- eigener Worktree und eigene Test-Datenbank, nie die Compose-Instanz `haben-dev`
- nichts posten, pushen oder mergen
- jeder Befund als roter Test und Fix in eigenen Commits auf einem lokalen Branch
- Bericht mit Befunden, Commits, HEAD und Tree, gelaufenen und übersprungenen Checks und „Red Flag ja/nein“

Mit dem Bericht:

- **Red Flag:** Ist fachlich etwas falsch, eine Sperre aufgeweicht, eine Migration falsch oder eine Grundsatzfrage offen, anhalten und den Maintainer mit Empfehlung fragen.
- **Fixes von uns:** Vor dem Push den Head des Pull Requests erneut lesen, weil Autoren während der Prüfung force-pushen. Dann `fork-pushen`, danach den Tree des neuen Heads mit dem Tree des lokalen Branches vergleichen.
- **Autor muss liefern:** nur die Befunde posten, vor dem Merge nötig und Vorschläge getrennt
- **Fertig:** siehe 4

Jeder Pull Request bekommt einen Kommentar mit dem Ergebnis. Bei heiklen Pull Requests gehört die fachliche Einschätzung mit Quelle dazu.

## 4. Merge

Nach `beitrag-pruefen`, Schritt 7: nur bei grüner CI auf dem Head, heikel erst nach OK des Maintainers. Ist ein Check auch auf `main` rot, wartet der Pull Request auf den Fix von `main` (Schritt 1). Dazu:

- Squash mit dem vollen Head-SHA als erwartetem Head
- Worktree, lokale Branches und Test-Datenbank aufräumen

## 5. Wieder von vorn

Nach jedem Merge kann sich die Rangliste ändern: Konflikte, Migrationsnummern, eine grüne CI auf `main`. Wieder bei 1 anfangen. Auf CI oder Hilfssessions wartet der Skill mit einem Monitor statt mit `sleep`. Sind nur noch wartende Pull Requests übrig, meldet er die Liste und hört auf; für regelmäßiges Nachsehen gibt es `/loop`.
