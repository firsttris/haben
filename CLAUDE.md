# Notes for Claude

Haben: self-hosted bookkeeping for freelancers (invoices with ZUGFeRD/XRechnung, receipts, bank
reconciliation, EÜR, VAT returns to ELSTER). TanStack Start app in `apps/web`, logic without a
database in `packages/core`, ELSTER in `packages/elster`, bank and DATEV import in `packages/import`,
invoice PDF and XML in `packages/einvoice`.

## Never

The rules whose breach costs the most; the details follow below.

- Floats for money: amounts are whole cents, tax rates basis points.
- Weakening a GoBD lock or seal, renaming or recomputing a sealed column, editing an existing migration.
- Running ERiC in the app process, or tests against a database with real data.
- Skipping, weakening or deleting a test to get green; reporting a skipped test as passed.
- Pushing to `main`, rewriting a contributor's commits, merging without a maintainer.

Scripts check some rules (module boundaries, pages in the E2E specs, file size, pull request title, agent marker); the
table is in `docs/entwicklung.md`, "Automatische Prüfungen der Regeln". A rule you can turn into such a check
is better there than here.

## Documentation

The documentation is in `docs/` (<https://haben.app/>). Read the pages that touch the
change before starting: `docs/entwicklung.md` for setup, commands, migrations and conventions,
`docs/architektur.md` for modules, tables, the audit hash chain and seals, and the user page of the
area (`rechnungen.md`, `bank.md`, `umsatzsteuer.md`, `lexoffice.md`, …). Links in the README point
to the GitHub Pages site, not to `docs/*.md`.

## Reference implementations

Base details on the sources, not on memory, and name the source in comments and commit messages
where it settles a detail:

- E-invoice: EN 16931 / XRechnung (business terms like BT-22), checked by the KoSIT validator with
  `itplr-kosit/validator-configuration-xrechnung` (versions in `.github/workflows/ci.yml`).
- ELSTER: the ERiC developer documentation (<https://www.elster.de/elsterweb/entwickler/infoseite/eric>).
- DATEV: the DATEV format description for EXTF/Buchungsstapel; Lexware Office exports deviate
  from it (column names, see `docs/lexoffice.md`).
- Enable Banking: <https://enablebanking.com/docs/api/reference/>; Lexware Office:
  <https://developers.lexware.io/docs/>.

Clone GitHub sources shallowly (`git clone --depth 1`) into the scratchpad.

## With every change

Update what the change affects, in the same pull request, and only that:

- the tests for what changed: Vitest unit tests, Postgres integration tests next to the module,
  Playwright in `apps/web/e2e/` for what a user clicks; a bug fix starts with a test that fails;
- bookings and tax: test cases for SKR03 and SKR04 and for Ist and Soll;
- the docs in `docs/` that describe it, in German;
- the README only when a feature area is added or removed or its one-line summary no longer fits; details go into `docs/`, the table row stays short;
- a new page: add it to `e2e/barrierefreiheit.spec.ts` and the route list in `e2e/seiten.spec.ts`
  (`bun run lint` fails otherwise; `scripts/seitenabdeckung/ausnahmen.ts` is for redirects, not new pages);
- a change to the look (UI/UX): screenshots before and after in the pull request description, in a light and
  a dark theme, desktop and phone where it matters. Take the "before" pictures first, before touching the UI,
  so the old state need not be rebuilt later; skill `pr-screenshots` has the steps and how to upload them;
- the screenshots after a change to the look: **Actions → Update screenshots → Run workflow**, then
  look at the new pictures.

## Checks

Green before every push, then check CI:

```sh
bun run lint
bun run typecheck
TEST_DATABASE_URL=postgres://…/haben_test bun run test     # without it the Postgres tests are skipped
bun run build
E2E_DATABASE_URL=postgres://…/haben_e2e bun run e2e         # name must end in "e2e"; it is emptied
zensical build --strict                                 # when docs/ or mkdocs.yml changed
```

Both databases are wiped by the tests, and `bun run test` also creates and drops `<name>_vorlage` and
`<name>_<n>` next to the test database; never point them at a server with real data. In a container without
PostgreSQL 18, the installed PostgreSQL works for the tests (`initdb`, `pg_ctl … -o '-p 5433'`).

Skill `checks` has the details:

- No Bun on the machine: run the checks in the dev container from `compose.yml`
  (`docker compose run --rm -u bun app …`, see `docs/entwicklung.md`, "Prüfungen ohne Bun auf dem Rechner"),
  not in ad-hoc containers of your own.
- In a git worktree or next to a running environment: an own compose project and free ports
  (`HABEN_DEV_PORT=3001 HABEN_DEV_DB_PORT=5433 docker compose -p haben-<branch> …`); never touch the
  user's `haben-dev` project. Clean it up with `down -v` when done.
- Some tests skip without a tool (`TEST_DATABASE_URL`, `pdftotext`, `cc`, ERiC, network; table in
  `docs/entwicklung.md`, Tests). Report what was skipped; a skipped test proves nothing.

## Pull requests

- One feature per pull request; it carries only its own commits. Skill `beitrag` has the steps from branch
  to draft.
- Branch in `firsttris/haben` with write access, otherwise in a fork; never push to `main`. Pull requests
  start as drafts when the user wants to look first; CI skips drafts until "Ready for review". For a pull request
  that only touches Markdown, `docs/` or `LICENSE` and deletes or moves no file, the job `changes` in `ci.yml` skips the other jobs, which
  counts as passed for the required checks but tests nothing; the "Docs" workflow builds changed docs in the
  pull request, still build them locally first.
- Title: `Bereich: was sich ändert (#Issue)`, in German; a squash merge makes it the commit on `main`.
  The "PR-Regeln" workflow checks it, also for drafts. Reference issues in the description with `Refs #…`,
  never `Closes`/`Fixes`: GitHub would close the issue on merge, but it stays open with `rückmeldung` until the
  release and the author's answer. Commits inside a pull request: Conventional Commits types with a German
  description (`fix(belege): …`, `test: …`); a recommendation, but `fix` without a changed test gets a warning.
- Agents mark their work, for transparency only: a `Co-Authored-By:` trailer naming the tool or model in
  each commit, and a "🤖 Generated with <tool>" line in the pull request description ("PR-Regeln" fails
  without it when a commit names an agent). Using agents is welcome; the person who opens the pull request
  stays responsible for it.
- Before every push check whether the branch's pull request is still open. If it is merged, start
  again from the current `origin/main` and open a **new** pull request.
- Merge method: always **squash**, and merge the pull request itself, also a contributor's, so GitHub
  shows it as merged and the squash commit carries its author; `main` keeps a linear history (merge
  commits are switched off). Our fixes go as commits onto the pull request's branch (in the repo, or
  in a fork with "Allow edits by maintainers"). If that is not possible, ask the contributor to allow
  edits; only as a last resort open an own pull request from their state, squash it with
  `Co-authored-by: <contributor>` and close theirs with a link. A branch that is only behind `main`
  needs no update before the merge. Never rewrite a contributor's commits.
- Force-push: allowed with `--force-with-lease` on the own branch after a merge.
- Every pull request gets an independent **TDD review** before it is merged: skill `tdd-review` in
  `.claude/skills/`, the same steps without Claude in `docs/entwicklung.md` (Review). Whoever wrote
  the code does not review it (in a session that wrote it, a separate subagent does); a finding counts
  only with a test that fails on the pull request; fixes go on top as their own commits. Only a
  maintainer merges.

## Issues

Write issues in German with the headings Anlass, Stand in Haben, Vorschlag, Akzeptanzkriterien, Bezug.
Search issues and pull requests first (done work often lives only in a pull request). Check
"Stand in Haben" against the current `main` and link commit, docs or code; name sources with links;
invented amounts, no real receipts, tax numbers, IBANs or credentials. End an agent-written issue (not a mere
correction) with a rule and `_Generated with [Claude Code](https://claude.com/claude-code)_` (or the
agent's own name). Create or comment on issues only when the user says so. Steps and detail level:
skill `issue-schreiben` in `.claude/skills/`, the same steps without Claude in `docs/entwicklung.md`
(Issues schreiben). The type label (`fehler`, `wunsch`, `steuer`, `umzug`, `frage`) is set when creating
the issue; other labels and the roadmap order are the maintainer's call. Besides the types there are area
labels (`oberfläche`, `buchung`, `schnittstelle`, `technik`, `doku`), `sammlung` and the status `rückmeldung`:
implemented and released, the issue stays open until its author confirms that nothing is missing, and is closed
with a short note after 14 days without an answer (the release comment says so).

## Working rules

- Commands as root (`sudo`, `pkexec`) are run by the user; don't work around that.
- The user's running processes are not stopped; use other ports for tests (the E2E server uses 3100).
- Language: German for code comments, docs, commit messages, pull requests and everything the user
  sees, including error messages. Identifiers stay English.

## Code style

Technology choices follow `tech-stack.md` in firsttris/workflows: Bun is runtime and package manager,
no Node, npm or pnpm (`bun run test` runs Vitest; `bun test` would be Bun's own runner). Deviations
here: plain CSS with variables in `apps/web/src/styles.css` and an own `Icon` component instead of
Tailwind and lucide, Typst for the invoice PDF.

Clean Code, written functionally: clear names, small functions that do one thing, dependencies
passed in, no duplication or dead code, comments that say why; the ideas behind SOLID and the
design patterns are welcome as functions, data and closures, but not as classes, inheritance or
class hierarchies.

Functional, not object-oriented: pure functions that take data and return data, side effects at
the edges; function components and hooks, no classes (except the `UserError` subclasses); errors as
values where the code already does so. A file does one thing: split it past ~400 lines, a function
past ~80. Older files that are larger are listed in `scripts/dateigroesse/grenzen.json`; `bun run lint` fails
when one grows or a new file passes 400 lines, so put new code into a new file. Split the old ones only in
a pull request of their own, not on the side, then run `bun scripts/dateigroesse/pruefen.ts --senken`.
A refactor changes no behaviour.

## Haben specifics

- **Money in whole cents** (`Cents`), tax rates in basis points (1900 = 19 %), quantities in
  thousandths. Never floats.
- **Module boundaries:** import another server module only through its `index.ts`; the
  check in `scripts/modulgrenzen/` (part of `bun run lint`) fails CI otherwise. Server functions in `server/functions/` stay thin:
  `authMiddleware`, Zod validation, then a call into `server/modules/`.
- **GoBD:** finalised invoices, bookings, sent VAT returns, bank transactions and imported Lexoffice
  data are locked by Postgres triggers; corrections are new records (Storno, counter-booking).
  Sealed tables (`invoices`, `journal_entries`, …): never rename, drop or recompute a column; new
  columns are fine. Never weaken a lock or seal to make something work.
- **Audit log:** writes go through `withActor`; new tables get an audit trigger. Secrets (keys,
  passwords, tokens) are stored AES-256-GCM-encrypted in a column named `ciphertext`, which
  `haben_audit` leaves out.
- **Migrations:** change `apps/web/src/server/db/schema.ts`, then `bun run db:generate`; never write
  snapshots in `drizzle/meta/` by hand. Triggers and functions go into a separate migration from
  `drizzle-kit generate --custom`. Never change an existing migration.
- **ERiC** never runs in the app process, only in the worker (`packages/elster/src/worker.ts`).
- **Accessibility:** real buttons and links, a label for every field, visible focus;
  `barrierefreiheit.spec.ts` checks every page in CI.
