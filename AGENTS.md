# Notes for coding agents

The rules for this repository are in [`docs/entwicklung.md`](docs/entwicklung.md) and [`docs/mitwirken.md`](docs/mitwirken.md), in German, for people and
agents alike. [`CLAUDE.md`](CLAUDE.md) is the short entry point: where to look and what must never happen. Both
apply to every agent, not only Claude.

The steps for recurring tasks are the skills in [`.claude/skills`](.claude/skills); other agents follow the same
files: `checks` (checks with and without Bun), `beitrag` (branch, commits, draft pull request,
then self-check and independent review), `beitrag-pruefen` (wanted, sources, simplest solution, rules: contributors
check their own pull request first, maintainers and collaborators then judge it), `tdd-review`
(independent review, a finding needs a failing test), `doku-pruefen` (review of the Markdown in a pull request, alongside `tdd-review` if code changes too: matches code
and sources, short, every rule in one place), `fork-pushen` (push to someone else's fork, from the cloud through a
session with the fork as source), `prs-abarbeiten` (all open pull requests as a ranking from easiest to merge, then one by one), `issue-schreiben`, `pr-screenshots`, `belegvorlage` (own
Typst layouts for documents, with the field contract), `board-pflegen` (the roadmap board on GitHub), `jahreswerte` (official yearly values, ERiC and laws after a
`jahreswerte` issue) and `release` (choose and check a release, trigger it only with the maintainer's approval).
