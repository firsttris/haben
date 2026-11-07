# Notes for coding agents

The rules for this repository are in [`CLAUDE.md`](CLAUDE.md): setup, checks, module boundaries, GoBD,
money in cents, German for code comments, docs and commit messages. They apply to every agent, not only
Claude.

Every pull request gets an independent TDD review before it is merged: a finding counts only with a test
that fails on the pull request, fixes go on top as their own commits. The steps are in
[`docs/entwicklung.md`](docs/entwicklung.md#review); Claude Code has them as the skill
[`.claude/skills/tdd-review`](.claude/skills/tdd-review/SKILL.md).

Issues follow the structure in [`docs/entwicklung.md`](docs/entwicklung.md#issues-schreiben); Claude Code has
it as the skill [`.claude/skills/issue-schreiben`](.claude/skills/issue-schreiben/SKILL.md).
