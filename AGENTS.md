# Notes for coding agents

The rules for this repository are in [`docs/entwicklung.md`](docs/entwicklung.md), in German, for people and
agents alike. [`CLAUDE.md`](CLAUDE.md) is the short entry point: where to look and what must never happen. Both
apply to every agent, not only Claude.

The steps for recurring tasks are the skills in [`.claude/skills`](.claude/skills); other agents follow the same
files: `checks` (checks with and without Bun), `beitrag` (branch, commits, draft pull request), `beitrag-pruefen`
(maintainers and collaborators judge someone else's pull request: wanted, sources, rules), `tdd-review`
(independent review, a finding needs a failing test), `doku-pruefen` (review of a pull request without code: matches code
and sources, short, every rule in one place), `issue-schreiben`, `pr-screenshots`, `belegvorlage` (own
Typst layouts for documents, with the field contract), `board-pflegen` (the roadmap board on GitHub) and `release`
(choose and check a release, trigger it only with the maintainer's approval).
