# Mitwirken an Haben

Issues und Pull Requests sind willkommen. Haben ist eine selbst gehostete Buchhaltung für Freiberufler und kleine
Firmen. Wie die Teile zusammenhängen, steht in der [Architektur](https://haben.app/architektur.html),
wie du es lokal startest, in der [Entwicklung](https://haben.app/entwicklung.html). Für alle, die mitmachen, gilt
unser [Verhaltenskodex](CODE_OF_CONDUCT.md).

## Fehler und Wünsche melden

Neues Issue über die Formulare: [Issue anlegen](https://github.com/firsttris/haben/issues/new/choose). Bitte vorher
im [Project „Roadmap“](https://github.com/users/firsttris/projects/2) nachsehen, ob das Thema schon geplant ist, und
unter [Bewusst nicht](https://haben.app/roadmap.html#bewusst-nicht), ob es ausgeschlossen ist. Wie ein gutes Issue
aufgebaut ist, steht unter [Issues schreiben](https://haben.app/entwicklung.html#issues-schreiben).

**Keine echten Belegdaten, Steuernummern, IBANs oder Zugangsdaten** in Issues, Screenshots oder Logs. Sicherheitslücken
bitte privat melden, siehe [SECURITY.md](SECURITY.md).

## Etwas übernehmen

Such dir eine Karte aus „Geplant“ im [Project „Roadmap“](https://github.com/users/firsttris/projects/2) aus, für den
Einstieg gern mit dem Label [`einstieg`](https://github.com/firsttris/haben/issues?q=is%3Aopen+label%3Aeinstieg), und
schreib im Issue, dass du es übernimmst; ein Maintainer weist es dir zu. Wie das genau abläuft, steht unter
[Etwas übernehmen](https://haben.app/entwicklung.html#etwas-übernehmen).

## Pull Requests

- Ein Thema je Pull Request, auf einem eigenen Branch, in `main`. Direkt auf `main` wird nicht gepusht.
- Im selben Pull Request mitändern, was die Änderung betrifft: Tests (Vitest, Postgres-Tests neben dem Modul,
  Playwright in `apps/web/e2e/`), bei Buchungen und Steuer Testfälle für SKR03 und SKR04 sowie Ist und Soll, die Doku
  in `docs/`.
- Änderungen am Aussehen mit Screenshots vorher und nachher in der Beschreibung, in einem hellen und einem dunklen
  Theme, wo es darauf ankommt auch am Handy. Die Bilder für „vorher“ vor der ersten Änderung aufnehmen und als Anhang
  hochladen (ins Textfeld ziehen).
- Titel: `Bereich: was sich ändert (#Issue)`, die Nummer nur, falls es ein Issue gibt. Commits gern als
  `fix(bereich): …`, `test: …` mit Beschreibung auf Deutsch. Ein Entwurf ist willkommen; die CI startet mit „Ready for
  review“. Was bei einem Pull Request nur mit Doku geprüft wird, steht unter
  [Branches, Titel und Commits](https://haben.app/entwicklung.html#branches-titel-und-commits).
- Issues in der Beschreibung mit `Umgesetzt #…`, wenn der Pull Request das Issue fertig macht, sonst mit `Refs #…`.
  Nie `Closes` oder `Fixes`: Das Issue schließt das Release, nicht der Merge.
- Mit KI-Werkzeugen zu arbeiten ist in Ordnung. Der Transparenz halber bitte kennzeichnen: `Co-Authored-By:` im
  Commit, eine Zeile wie „🤖 Generated with <Werkzeug>“ im Pull Request. Siehe
  [Mit KI-Werkzeugen](https://haben.app/entwicklung.html#mit-ki-werkzeugen).
- Sprache: Deutsch für Kommentare, Doku, Commits und alles, was Nutzer sehen. Bezeichner bleiben Englisch.
- Zuerst schaut ein Maintainer oder Collaborator, ob die Änderung zu Haben passt, gegen die Quellen geprüft ist und
  Tests und Doku mitbringt ([Beiträge annehmen](https://haben.app/entwicklung.html#beiträge-annehmen)). Ein Issue
  vorab spart dir Arbeit an etwas, das wir nicht übernehmen können.
- Jeder Pull Request bekommt vor dem Merge ein unabhängiges **TDD-Review**: Ein Befund zählt nur mit einem Test, der
  auf dem Stand des Pull Requests fehlschlägt; Fixes kommen als eigene Commits obendrauf. Gemergt wird von einem
  Maintainer oder, mit dessen Zustimmung, von einem Collaborator. Die Schritte stehen unter
  [Review](https://haben.app/entwicklung.html#review).

Die vollständigen Regeln (Codestil, Geld in Cent, GoBD-Sperren, Migrationen, Modulgrenzen) stehen unter
[Konventionen](https://haben.app/entwicklung.html#konventionen) und
[Mitwirken](https://haben.app/entwicklung.html#mitwirken). KI-Agenten starten mit [CLAUDE.md](CLAUDE.md)
([AGENTS.md](AGENTS.md)), das dorthin verweist.

## Prüfungen

Vor jedem Push dieselben Prüfungen wie in der CI; die Befehle stehen unter
[Mitwirken](https://haben.app/entwicklung.html#mitwirken). Die Tests leeren ihre Datenbanken; nie auf einen Server mit
echten Daten zeigen lassen. Ohne Bun auf dem Rechner laufen dieselben Prüfungen im Dev-Container, siehe
[Prüfungen ohne Bun auf dem Rechner](https://haben.app/entwicklung.html#prüfungen-ohne-bun-auf-dem-rechner).

## Lizenz

Mit einem Beitrag stimmst du zu, dass er unter der [AGPL-3.0](LICENSE) steht.
