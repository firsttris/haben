# Notes for Claude

Haben: self-hosted bookkeeping for freelancers (invoices with ZUGFeRD/XRechnung, receipts, bank
reconciliation, EÜR, VAT returns to ELSTER). TanStack Start app in `apps/web`, logic without a
database in `packages/core`, ELSTER in `packages/elster`, bank and DATEV import in `packages/import`,
invoice PDF and XML in `packages/einvoice`.

The rules live once, in `docs/entwicklung.md` and, for the UI, `DESIGN.md` (German, also for people); the skills in `.claude/skills/`
have the steps. This file says where to look and what must never happen. Read the sections that touch
the change before starting.

## Where to look

| Topic | `docs/entwicklung.md` | Skill |
| --- | --- | --- |
| Setup, commands, tests and what they skip | Lokale Umgebung, Mit Docker Compose, Befehle, Tests | `checks` |
| Cents, GoBD, audit, secrets, modules, ERiC, code style, sources | Konventionen | |
| UI, buttons, dialogs, themes | `DESIGN.md` (repo root) | |
| Schema and migrations | Migrationen | |
| What a pull request contains, branch, title, commits, agent marker | Mitwirken | `beitrag` |
| Screenshots of a change to the look | Mitwirken | `pr-screenshots` |
| Review and merge | Review | `tdd-review` |
| Issues and labels | Issues schreiben | `issue-schreiben` |
| Rules a script checks | Automatische Prüfungen der Regeln | |

Modules, tables, the audit hash chain and seals: `docs/architektur.md`; the user page of the area
(`rechnungen.md`, `bank.md`, `umsatzsteuer.md`, …) for behaviour. README links point to the site
(<https://haben.app/>), not to `docs/*.md`.

## Never

- Floats for money: amounts in whole cents, tax rates in basis points, quantities in thousandths.
- Weaken a GoBD lock or seal, rename or recompute a sealed column, change an existing migration, write
  `drizzle/meta/` by hand.
- Store a secret outside a `ciphertext` column; run ERiC in the app process.
- Point tests at a database with real data; skip, weaken or delete a test to get green; report a skipped
  test as passed.
- Push to `main`, rewrite a contributor's commits, merge (only a maintainer merges), review your own code.
- Create or comment on issues and pull requests without being asked.
- Stop the user's processes or touch their `haben-dev` compose project; work around `sudo`.

## With every change

- Tests for what changed: Vitest, Postgres tests next to the module, Playwright for what a user clicks; a bug
  fix starts with a failing test; SKR03 and SKR04, Ist and Soll for bookings and tax.
- Docs in `docs/` in the same pull request; the README only when a feature area or its one-line summary changes.
- Reference issues with `Refs #…`, never `Closes`/`Fixes`: the issue stays open with `rückmeldung`.
- A change to the look: take the "before" screenshots before touching the UI (`pr-screenshots`).
- A design rule changes: `DESIGN.md` changes in the same pull request.
- Checks green before every push, skipped tests reported (`checks`); then check CI.
- Before a push: is the branch's pull request still open? If merged, start again from `origin/main`.
- An independent TDD review by a separate subagent before the merge (`tdd-review`).

## Working style

- German for code comments, docs, commit messages, pull requests and everything the user sees;
  identifiers stay English.
- Functional, no classes (except the `UserError` subclasses); a file past ~400 lines and a function past ~80
  get split (Konventionen).
- Writes go through `withActor`; a new table gets an audit trigger (nothing checks this automatically).
- Bun, not Node, npm or pnpm: `bun run test` runs Vitest, `bun test` would be Bun's own runner.
- Server functions in `server/functions/` stay thin: `authMiddleware`, Zod, then a call into
  `server/modules/`; another module only through its `index.ts`.
- Name the source (EN 16931, ERiC docs, DATEV format) where it settles a detail; clone GitHub sources
  shallowly into the scratchpad.
- Use other ports for tests (the E2E server uses 3100); an own compose project per worktree (`checks`).
