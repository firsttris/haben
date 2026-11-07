---
name: "issue-schreiben"
description: "Schreibt ein Issue für Haben in der Gliederung des Projekts: Anlass, Stand in Haben (auf main geprüft), Vorschlag, Akzeptanzkriterien, Bezug und Quellen. Nutzen, wenn ein Issue für firsttris/haben entworfen oder überarbeitet wird, und vor dem Anlegen mit gh."
---

# Issue schreiben

Ein Issue für Haben ist so gebaut, dass ein Maintainer oder Agent daraus ohne Rückfrage arbeiten kann. Die Gliederung und der Rahmen stehen in [`docs/entwicklung.md`](../../../docs/entwicklung.md#issues-schreiben); die Formulare in `.github/ISSUE_TEMPLATE/` verwenden dieselben Überschriften in kurz.

## Vorgehen

1. **Typ wählen:** Fehler, Funktionswunsch, Steuerfall oder Format, Umzug aus einem anderen Programm, Frage oder Hinweis zur Doku. Ein Issue behandelt ein Thema; mehrere Probleme werden mehrere Issues, die aufeinander verweisen.
2. **Doppelte suchen:** `gh issue list --repo firsttris/haben --state all --search "<Stichwort>"` und die [Roadmap](../../../docs/roadmap.md). Gibt es das Thema schon, kommt ein Kommentar dorthin statt eines neuen Issues.
3. **Stand in Haben am Code prüfen:** Auf dem aktuellen `origin/main` nachsehen, was Haben heute tut (Doku-Seite des Bereichs, bei Bedarf der Code). Commit und Links auf Doku oder Datei in den Text. Nichts behaupten, was nicht geprüft ist; Ungeprüftes als offen kennzeichnen.
4. **Quellen am Original lesen:** Gesetz auf gesetze-im-internet.de, BMF-Schreiben, Formularanleitung, Formatbeschreibung. Mit Link. Ratgeber sind keine Quelle. Bei Fremdprogrammen die Hilfe-Seite oder die API-Antwort (anonymisiert).
5. **Schreiben**, auf Deutsch, mit diesen Abschnitten (nicht benötigte weglassen):
   - `## Anlass`: Alltagsbeispiel mit erfundenen Beträgen. Bei Fehlern Schritte, erwartet, tatsächlich, Meldung im Wortlaut, Haben-Version.
   - `## Stand in Haben`: geprüfter Ist-Stand, mit Commit und Links.
   - `## Vorschlag`: was sich ändern soll, bei Bedarf in Stufen, mit Abgrenzung.
   - `## Akzeptanzkriterien`: drei bis sechs prüfbare Punkte als `- [ ]`. Bei Buchungen und Steuer SKR03 und SKR04, Ist und Soll nennen. Bei Änderungen am Aussehen Themes und Handy.
   - `## Bezug`: verwandte Issues und Pull Requests, Roadmap-Platz, Quellen.
6. **Prüfen vor dem Anlegen:**
   - Keine echten Belegdaten, Steuernummern, IBANs, Zugangsdaten, Zertifikate, auch nicht in Screenshots oder Logs.
   - Beträge und Namen erfunden oder anonymisiert.
   - Quellcode nur als Link, nicht als Auszug; ein bis zwei Bildschirme lang.
   - Unsicheres steht ausdrücklich als Frage oder als „mit der Steuerberatung zu klären“.
   - Der Titel nennt das Ergebnis, nicht den Anlass („Eigene Sachkonten bei Eingangsbelegen auswählen“).
7. **Anlegen** nur auf Anweisung des Nutzers, mit `gh issue create --repo firsttris/haben`. Die Reihenfolge in der Roadmap legt der Maintainer fest, Labels wählt er; kein Platz und keine Labels erfinden.
