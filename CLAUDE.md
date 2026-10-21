# Ledger: notes for Claude

A personal finance and investment planning app that runs in the browser (data stays on the device). `README.md` lists every feature;
`docs/BACKLOG.md` is the running log of what was asked, what was built, and the judgment calls made (newest status at the top).
Read both before starting work.

## How the owner likes to work

- The owner is not a programmer. Use plain language, avoid jargon, and say honestly what could not be verified.
- Ask clarifying questions in one round, as multiple choice with a recommended option first.
- **Collect, then build.** New notes: ask questions, record the decisions in `docs/BACKLOG.md`, and wait for a go-ahead. A bare
  "go" or "build all" means everything queued. A small defect in an already-shipped feature can be fixed after a one-line offer and a yes.
- **Commit only when asked** (offer at the end of a build). **Pushing publishes the app**: every push to `main` runs the tests and
  deploys GitHub Pages, so ask before pushing. Then tell the owner to check the Actions tab for a green run.
- End each batch with a backlog entry: what was built, the test count, numbered "judgment calls (please review)", and what is NOT built.
- Check changes in a real browser at desktop and phone width (375px), not only with tests. Do not claim something works that you did not run.
- Money and tax logic must be correct. Mark anything unconfirmed as UNVERIFIED rather than guessing.

## Privacy (the repository is PUBLIC)

- Never put financial data, balances, backups, CSV exports, personal or family details, or credentials in code, tests, docs, or commit
  messages. Test data must be invented. `.gitignore` already excludes backups and CSV files.
- Never ask for passwords, API keys, or tokens in chat.

## Commands

```bash
npm run dev          # http://localhost:5173 (the app uses hash routes: http://localhost:5173/#/accounts)
npm test             # all unit tests (vitest)
npx tsc --noEmit     # type check
npm run build        # type check + production build
```

`.claude/launch.json` defines a `ledger-dev` server, but the preview tool only finds it when the session starts in this folder. Otherwise
start `npm run dev` in the background. Stop the server by its own process id (the one listening on port 5173), not by killing every `node.exe`.
On Windows, use the Write tool for files containing apostrophes or backticks (shell heredocs mangle them).

## Conventions that are easy to get wrong

- Money is whole cents. Engines in `src/lib` use rates as fractions; stored settings and asset classes use percents.
- Records point at each other by id; names are only labels (so renaming an account is safe).
- The database is `src/db.ts` with versioned migrations; backups are versioned too. New tables need a migration, backup support, and
  sync tracking (see `src/lib/sync`).
- New records get time-based ids. Built-in records use FIXED ids (around 9e15: the "Initial setup" category, three asset classes) so
  synced devices create the same record instead of doubling up. Insert fixed-id rows after automatic-id rows in the same bulk insert,
  or the automatic ids climb into the fixed ones.
- Do check-then-insert in one database transaction (React dev mode runs effects twice).
- Asset class returns are COMPOUND (geometric) nominal returns. The Monte Carlo code converts them (`lognormalFromGeometric` in
  `src/lib/projection.ts`) so the median tracks the steady path. Today's-dollars views deflate at display time.
- Tax tables live in `src/data` and need updating every January; items marked UNVERIFIED could not be confirmed from an official source.

## Layout

```
src/lib/      calculation engines and their tests
src/pages/    the screens
src/data/     tax tables by year
src/db.ts     database schema and migrations
docs/         BACKLOG.md
```
