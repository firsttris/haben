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

Further skills for Claude Code in [`.claude/skills`](.claude/skills); other agents follow the same steps from the
files: `checks` (checks with and without Bun, own compose project per worktree), `beitrag` (branch, commits, draft
pull request) and `pr-screenshots` (pictures before and after a change to the look).
