# Notes for coding agents

The rules for this repository are in [`docs/entwicklung.md`](docs/entwicklung.md), in German, for people and
agents alike. [`CLAUDE.md`](CLAUDE.md) is the short entry point: where to look and what must never happen. Both
apply to every agent, not only Claude.

The steps for recurring tasks are the skills in [`.claude/skills`](.claude/skills); other agents follow the same
files: `checks` (checks with and without Bun), `beitrag` (branch, commits, draft pull request), `tdd-review`
(independent review, a finding needs a failing test), `issue-schreiben`, `pr-screenshots` and `belegvorlage` (own
Typst layouts for documents, with the field contract).
