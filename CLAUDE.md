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

## ChatGPT handoff continuity — mandatory

`docs/CHATGPT-HANDOFF.md` is the rolling, public-safe context document for future ChatGPT conversations. Read it alongside `docs/BACKLOG.md` and the relevant phase reports before every Ledger development phase. It summarizes project vision, approved architectural decisions, feature status, risks, AI strategy, current milestone, and next steps; current source code and Git/deployment evidence take precedence over stale text.

**Always update `docs/CHATGPT-HANDOFF.md` as part of the same reviewed work batch** whenever you implement a feature, update an architectural decision, resolve a blocker, change the roadmap, or prepare a phase report. At each stage correctly distinguish planned, built but uncommitted, committed, deployed, and acceptance-tested. After a commit/push, verify GitHub Actions and report the SHA/status; update the handoff during the next authorized change if a separate commit would otherwise be needed. Never make an unauthorized commit/push simply to refresh this document.

Before finishing a work batch:

1. Check Git status, newest report, `docs/BACKLOG.md`, and (where possible) GitHub Actions.
2. Refresh the handoff's **current snapshot, phase status, next action, approved decisions, open risks, AI roadmap and change log**. Preserve architectural invariants. Reconcile stale backlog statements.
3. Keep the public repo free of real household data, private addresses, identities, financial balances, exported files, credentials and secrets. Use invented examples only.
4. In your report state whether the handoff was updated, what changed, and anything that remains unknown.
5. Include the handoff in the phase's review and git diff; **never commit/push until the owner explicitly authorizes it**.

If ChatGPT sends a new decision or change request, apply that information to the handoff during the work batch once the owner has approved it; do not infer decisions merely from a discussion or suggestion. The handoff is a maintained summary, not a substitute for authoritative code, tests, Git state or detailed reports.
