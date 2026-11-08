# Mitwirken an Haben

Issues und Pull Requests sind willkommen. Haben ist eine selbst gehostete Buchhaltung für Freiberufler und kleine
Firmen. Wie die Teile zusammenhängen, steht in der [Architektur](https://firsttris.github.io/haben/architektur.html),
wie du es lokal startest, in der [Entwicklung](https://firsttris.github.io/haben/entwicklung.html).

## Fehler und Wünsche melden

Neues Issue über die Formulare: [Issue anlegen](https://github.com/firsttris/haben/issues/new/choose). Bitte vorher
in der [Roadmap](https://firsttris.github.io/haben/roadmap.html) nachsehen, ob das Thema schon geplant ist. Wie ein
gutes Issue aufgebaut ist, steht unter
[Issues schreiben](https://firsttris.github.io/haben/entwicklung.html#issues-schreiben).

**Keine echten Belegdaten, Steuernummern, IBANs oder Zugangsdaten** in Issues, Screenshots oder Logs. Sicherheitslücken
bitte privat melden, siehe [SECURITY.md](SECURITY.md).

## Pull Requests

- Ein Thema je Pull Request, auf einem eigenen Branch, in `main`. Direkt auf `main` wird nicht gepusht.
- Im selben Pull Request mitändern, was die Änderung betrifft: Tests (Vitest, Postgres-Tests neben dem Modul,
  Playwright in `apps/web/e2e/`), bei Buchungen und Steuer Testfälle für SKR03 und SKR04 sowie Ist und Soll, die Doku
  in `docs/`.
- Änderungen am Aussehen mit Screenshots vorher und nachher in der Beschreibung, in einem hellen und einem dunklen
  Theme, wo es darauf ankommt auch am Handy. Die Bilder für „vorher“ vor der ersten Änderung aufnehmen und als Anhang
  hochladen (ins Textfeld ziehen).
- Titel: `Bereich: was sich ändert (#Issue)`. Commits gern als `fix(bereich): …`, `test: …` mit Beschreibung auf
  Deutsch. Ein Entwurf ist willkommen; die CI startet mit „Ready for review“. Ändert ein Pull Request nur Markdown,
  `docs/` oder `LICENSE`, läuft sie gar nicht; dann die Doku vorher lokal bauen.
- Mit KI-Werkzeugen zu arbeiten ist in Ordnung. Der Transparenz halber bitte kennzeichnen: `Co-Authored-By:` im
  Commit, eine Zeile wie „🤖 Generated with <Werkzeug>“ im Pull Request. Siehe
  [Mit KI-Werkzeugen](https://firsttris.github.io/haben/entwicklung.html#mit-ki-werkzeugen).
- Sprache: Deutsch für Kommentare, Doku, Commits und alles, was Nutzer sehen. Bezeichner bleiben Englisch.
- Jeder Pull Request bekommt vor dem Merge ein unabhängiges **TDD-Review**: Ein Befund zählt nur mit einem Test, der
  auf dem Stand des Pull Requests fehlschlägt; Fixes kommen als eigene Commits obendrauf. Gemergt wird von einem
  Maintainer. Die Schritte stehen unter [Review](https://firsttris.github.io/haben/entwicklung.html#review).

Die vollständigen Regeln (Codestil, Geld in Cent, GoBD-Sperren, Migrationen, Modulgrenzen) stehen unter
[Mitwirken](https://firsttris.github.io/haben/entwicklung.html#mitwirken) und in [CLAUDE.md](CLAUDE.md), das auch für
andere KI-Agenten gilt ([AGENTS.md](AGENTS.md)).

## Prüfungen

Vor jedem Push, die CI macht dasselbe:

```sh
bun run lint
bun run typecheck
TEST_DATABASE_URL=postgres://…/haben_test bun run test
bun run build
E2E_DATABASE_URL=postgres://…/haben_e2e bun run e2e
```

Beide Datenbanken werden von den Tests geleert; nie auf einen Server mit echten Daten zeigen lassen.
Ohne Bun auf dem Rechner laufen dieselben Prüfungen im Dev-Container, siehe
[Prüfungen ohne Bun auf dem Rechner](https://firsttris.github.io/haben/entwicklung.html#prüfungen-ohne-bun-auf-dem-rechner).

## Lizenz

Mit einem Beitrag stimmst du zu, dass er unter der [AGPL-3.0](LICENSE) steht.

Test-Änderung, wird nicht gemergt.
