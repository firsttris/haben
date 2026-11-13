---
name: "issue-schreiben"
description: "Schreibt ein Issue für Haben in der Gliederung des Projekts: Anlass, Stand in Haben (auf main geprüft), Vorschlag, Akzeptanzkriterien, Bezug. Nutzen, wenn ein Issue für firsttris/haben entworfen oder überarbeitet wird, und vor dem Anlegen mit gh."
---

# Issue schreiben

Ein Issue für Haben ist so gebaut, dass ein Maintainer oder Agent daraus ohne Rückfrage arbeiten kann. Die Gliederung und der Rahmen stehen in [`docs/mitwirken.md`](../../../docs/mitwirken.md#issues-schreiben); die Formulare in `.github/ISSUE_TEMPLATE/` fragen dieselben Punkte in Alltagssprache ab.

## Vorgehen

1. **Typ wählen:** Fehler, Funktionswunsch, Steuerfall oder Format, Umzug aus einem anderen Programm, Frage oder Hinweis zur Doku. Ein Issue behandelt ein Thema; mehrere Probleme werden mehrere Issues, die aufeinander verweisen.
2. **Doppelte und Erledigtes suchen:** `gh issue list --repo firsttris/haben --state all --search "<Stichwort>"`, ebenso `gh pr list --repo firsttris/haben --state all --search "<Stichwort>"` (Erledigtes steht oft nur in Pull Requests, ohne eigenes Issue) und das [Project „Roadmap“](https://github.com/users/firsttris/projects/2) mit seinen Entwürfen ohne Issue, dazu „Bewusst nicht“ in der [Roadmap](../../../docs/roadmap.md#bewusst-nicht). Gibt es das Thema schon, bekommt der Nutzer den Fund mit Link gemeldet; ein Kommentar im bestehenden Issue folgt nur auf Anweisung. Ist es nur zum Teil umgesetzt, wird das neue Issue auf den fehlenden Teil begrenzt und nennt die Umsetzung unter „Stand in Haben“.
3. **Stand in Haben am Code prüfen:** Zuerst `git fetch origin`, dann auf dem aktuellen `origin/main` lesen, was Haben heute tut (`git show origin/main:<pfad>`, Doku-Seite des Bereichs, bei Bedarf der Code). Den geprüften Commit (`git rev-parse --short origin/main`) nennen und mit Permalinks auf Doku oder Datei (`https://github.com/firsttris/haben/blob/<commit>/<pfad>#L<n>`) belegen. Nichts behaupten, was nicht geprüft ist; Ungeprüftes als offen kennzeichnen.
4. **Quellen am Original lesen:** Gesetz auf gesetze-im-internet.de, BMF-Schreiben, Formularanleitung, Formatbeschreibung. Mit Link. Ratgeber sind keine Quelle. Quellen, die ein früherer Pull Request schon am Original geprüft hat, dürfen mit Link auf den Pull Request übernommen werden. Bei Fremdprogrammen die Hilfe-Seite oder die API-Antwort (anonymisiert).
5. **Schreiben**, auf Deutsch, mit den Abschnitten aus der Tabelle in `docs/entwicklung.md` (`## Anlass`, `## Stand in Haben`, `## Vorschlag`, `## Akzeptanzkriterien`, `## Bezug`; nicht benötigte weglassen). Weicht der Vorschlag vom Wunsch des Nutzers ab, steht der Wunsch unter „Anlass“ und die Begründung unter „Vorschlag“. Bei Änderungen am Aussehen nennen die Akzeptanzkriterien Themes und Handy. Als letzte Zeile, nach `---`: `_Generated with [Claude Code](https://claude.com/claude-code)_` (bei einem anderen Agenten dessen Name); nicht bei bloßen Korrekturen.
6. **Prüfen vor dem Anlegen:**
   - Keine echten Belegdaten, Steuernummern, IBANs, Zugangsdaten, Zertifikate, auch nicht in Screenshots oder Logs.
   - Beträge und Namen erfunden oder anonymisiert.
   - Quellcode nur als Link, nicht als Auszug.
   - Das Issue ist höchstens ein bis zwei Bildschirme lang.
   - Unsicheres steht ausdrücklich als Frage oder als „mit der Steuerberatung zu klären“.
   - Der Titel nennt das Ergebnis, nicht den Anlass („Eigene Sachkonten bei Eingangsbelegen auswählen“).
7. **Anlegen** nur auf Anweisung des Nutzers (beim Einordnen nach `board-pflegen` ist das OK des Maintainers zum Vorschlag die Anweisung), mit `gh issue create --repo firsttris/haben`. Der Typ kommt wie bei den Formularen als Label mit `--label` dazu, Pflicht: Ohne `--label` hat das Issue keinen Typ (`fehler`, `wunsch`, `steuer`, `umzug`, `frage`, `technik`, `doku`; `gh label list --repo firsttris/haben` zeigt, was es gibt). Weitere Labels (Thema, `sammlung`, `einstieg`; Bedeutung in `docs/mitwirken.md` unter „Issues schreiben“) und die Karte im Project „Roadmap“ kommen mit `board-pflegen`; nichts davon erfinden.
