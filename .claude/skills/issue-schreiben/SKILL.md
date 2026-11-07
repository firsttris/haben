---
name: "issue-schreiben"
description: "Schreibt ein Issue für Haben in der Gliederung des Projekts: Anlass, Stand in Haben (auf main geprüft), Vorschlag, Akzeptanzkriterien, Bezug. Nutzen, wenn ein Issue für firsttris/haben entworfen oder überarbeitet wird, und vor dem Anlegen mit gh."
---

# Issue schreiben

Ein Issue für Haben ist so gebaut, dass ein Maintainer oder Agent daraus ohne Rückfrage arbeiten kann. Die Gliederung und der Rahmen stehen in [`docs/entwicklung.md`](../../../docs/entwicklung.md#issues-schreiben); die Formulare in `.github/ISSUE_TEMPLATE/` fragen dieselben Punkte in Alltagssprache ab.

## Vorgehen

1. **Typ wählen:** Fehler, Funktionswunsch, Steuerfall oder Format, Umzug aus einem anderen Programm, Frage oder Hinweis zur Doku. Ein Issue behandelt ein Thema; mehrere Probleme werden mehrere Issues, die aufeinander verweisen.
2. **Doppelte und Erledigtes suchen:** `gh issue list --repo firsttris/haben --state all --search "<Stichwort>"`, ebenso `gh pr list --repo firsttris/haben --state all --search "<Stichwort>"` (Erledigtes steht oft nur in Pull Requests, ohne eigenes Issue) und die [Roadmap](../../../docs/roadmap.md). Gibt es das Thema schon, bekommt der Nutzer den Fund mit Link gemeldet; ein Kommentar im bestehenden Issue folgt nur auf Anweisung. Ist es nur zum Teil umgesetzt, wird das neue Issue auf den fehlenden Teil begrenzt und nennt die Umsetzung unter „Stand in Haben“.
3. **Stand in Haben am Code prüfen:** Zuerst `git fetch origin`, dann auf dem aktuellen `origin/main` lesen, was Haben heute tut (`git show origin/main:<pfad>`, Doku-Seite des Bereichs, bei Bedarf der Code). Den geprüften Commit (`git rev-parse --short origin/main`) nennen und mit Permalinks auf Doku oder Datei (`https://github.com/firsttris/haben/blob/<commit>/<pfad>#L<n>`) belegen. Nichts behaupten, was nicht geprüft ist; Ungeprüftes als offen kennzeichnen.
4. **Quellen am Original lesen:** Gesetz auf gesetze-im-internet.de, BMF-Schreiben, Formularanleitung, Formatbeschreibung. Mit Link. Ratgeber sind keine Quelle. Quellen, die ein früherer Pull Request schon am Original geprüft hat, dürfen mit Link auf den Pull Request übernommen werden. Bei Fremdprogrammen die Hilfe-Seite oder die API-Antwort (anonymisiert).
5. **Schreiben**, auf Deutsch, mit diesen Abschnitten (nicht benötigte weglassen):
   - `## Anlass`: Alltagsbeispiel mit erfundenen Beträgen. Weicht der Vorschlag vom Wunsch des Nutzers ab, steht der ursprüngliche Wunsch hier und die Begründung unter „Vorschlag“. Bei Fehlern Schritte, erwartet, tatsächlich, Meldung im Wortlaut, Haben-Version.
   - `## Stand in Haben`: geprüfter Ist-Stand, mit Commit und Links.
   - `## Vorschlag`: was sich ändern soll, bei Bedarf in Stufen, mit Abgrenzung.
   - `## Akzeptanzkriterien`: drei bis sechs prüfbare Punkte als `- [ ]`. Bei Buchungen und Steuer SKR03 und SKR04, Ist und Soll nennen. Bei Änderungen am Aussehen Themes und Handy.
   - `## Bezug`: verwandte Issues und Pull Requests, Roadmap-Platz, Quellen mit Link.
   - Als letzte Zeile, nach einer Trennlinie `---`, steht der Hinweis auf das Werkzeug, das den Text geschrieben hat: `_Generated with [Claude Code](https://claude.com/claude-code)_`, bei einem anderen Agenten mit dessen Namen und Link. Bei Texten, die ein Mensch selbst geschrieben hat, und bei bloßen Korrekturen entfällt die Zeile.
6. **Prüfen vor dem Anlegen:**
   - Keine echten Belegdaten, Steuernummern, IBANs, Zugangsdaten, Zertifikate, auch nicht in Screenshots oder Logs.
   - Beträge und Namen erfunden oder anonymisiert.
   - Quellcode nur als Link, nicht als Auszug.
   - Das Issue ist höchstens ein bis zwei Bildschirme lang.
   - Bei einem vom Agenten geschriebenen Text (nicht bei einer bloßen Korrektur) steht die Zeile „Generated with …“ am Ende.
   - Unsicheres steht ausdrücklich als Frage oder als „mit der Steuerberatung zu klären“.
   - Der Titel nennt das Ergebnis, nicht den Anlass („Eigene Sachkonten bei Eingangsbelegen auswählen“).
7. **Anlegen** nur auf Anweisung des Nutzers, mit `gh issue create --repo firsttris/haben`. Der Typ kommt wie bei den Formularen als Label mit `--label` dazu (`fehler`, `wunsch`, `steuer`, `umzug`, `frage`; `gh label list --repo firsttris/haben` zeigt, was es gibt). Weitere Labels und den Platz in der Roadmap setzt der Maintainer; nichts davon erfinden.
