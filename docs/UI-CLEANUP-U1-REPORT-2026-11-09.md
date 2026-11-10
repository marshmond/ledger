# Ledger U1: Targeted UI and usability cleanup (report, 2026-11-09)

Status: **BUILT AND TESTED LOCALLY. UNSTAGED, UNCOMMITTED, NOT PUSHED, NOT DEPLOYED. Awaiting independent review. NOT REAL-DEVICE TESTED.**

## 1. Repository and deployment gate

- Repository `marshmond/ledger` (origin `https://github.com/marshmond/ledger.git`), branch `main`.
- After `git fetch`: local `HEAD` = `origin/main` = `3fca9f2cafad0014b027e6f31ab49b5a045e5eb8` (Family F5).
- Pages run #88 for that exact SHA was `in_progress` at first check; I waited and it finished `completed` / `success` before any code was edited. (The GitHub CLI is not installed here, so the run was read from the public GitHub API.)
- Working tree was clean at the start.
- Read: `CLAUDE.md`, the F5 report, the handoff and the backlog header.
- Released test baseline from the F5 report: **4,207 tests in 235 files**. Not re-run (not needed for this phase).

## 2. Summary

Four small presentation fixes. No data model, migration, sync, route, module id or business logic changed. No dependency added.

## 3. Files changed (7, all modified, none new except this report)

| File | Change |
|---|---|
| `src/modules/household/OverviewPage.tsx` | page heading text only |
| `src/modules/tasks/TaskEditor.tsx` | two class names added (`tk-when`, `tk-due`) |
| `src/modules/tasks/tasks.css` | three small rules, scoped to those classes |
| `src/modules/family/model.ts` | new pure helper `memberHint` (display text only) |
| `src/modules/family/OverviewPage.tsx` | conflict links: hint text + touch class; same-name cards show "added" date |
| `src/modules/family/MemberPage.tsx` | conflict rows: hint text, touch class, distinct accessible name |
| `src/modules/family/family.css` | `.fm-touch` (44px) and wrapping for conflict rows |

## 4. Before and after

**1. Household Finances title.** Before: the page heading read "Household finances". After: "Household Finances" (matches the module name and the selector). Only the heading changed; the Today card title, the Search result title ("Household finances", asserted by an existing test) and the help text were left alone because they are different strings.

**2. Task editor overflow.** Cause found in the browser before editing: once a task has a due date, a time box appears beside the date. The date and time boxes have a fixed natural width, and the form's grid column would not shrink below it, so every field was 300px inside a 268px space (about 32px over at 320px wide). The Calendar already has a rule for this, but it is scoped to the Calendar page and does not reach the dialog. Fix: the Due row may shrink (`.tk-due`) and the two cells of the date grid may shrink (`.tk-when > .f`). Scoped to the Task editor only, no shared dialog style touched. After: dialog scroll width equals its visible width at 320 and 375.

**3. Me-conflict touch targets.** Before: overview links about 28px tall. After: 44px on every width (`.fm-touch`), rows wrap on narrow screens. On the member page the "This one is me" buttons are 44px. Each control now has a distinct accessible name, for example "Jo Example (Child, Blue, added Nov 9, 2026) is me". Same click handlers (`setMe`) and the same conflict detection as before.

**4. Same-name members.** Used only what is already shown elsewhere: role, colour name and the date the record was added (Search already uses "Added <date>"). The conflict lists on the overview and member page now read "Jo Example (Child, Blue, added Nov 9, 2026)". Family overview cards add "added <date>" only when two cards share a name (they already showed role and colour). No ids, notes, birth years, phones or emails are used.

## 5. Targeted tests

- `npx vitest run src/modules/family src/modules/tasks src/modules/household`: **32 files, 557 tests, all pass.** (One test failed first: a Family guard test scans the end of `model.ts` for the word "note", and my new code comment contained it. I reworded the comment only; no code changed.)
- `npx tsc --noEmit`: clean.
- `npm run build`: succeeded once.
- `git diff --check`: no whitespace errors (only the usual LF/CRLF notices).
- No new tests were added: the changes are copy and CSS, and I did not invent source-string assertions.

## 6. Browser results (disposable data in the local dev database)

- Household Finances page heading reads "Household Finances" (375px).
- Task editor with a due date, a very long title, and a very long Contact name selected: no overflow at 320 (dialog 294/294, no element past the edge) and 375 (349/349). Looked right in dark mode at 320 (screenshot). People picker is a dropdown; long names fit. Same-name Contacts show as "1 of 2 with this name" in the list and fit.
- Family at 320: two members named alike, both marked "This is me": warning shown, links 53px and 44px tall, no horizontal overflow. Member page: two buttons 44px, distinct accessible names, no overflow. Pressing one cleared the conflict and showed "Yes, this is your profile" (same action as before).
- Same-name overview cards read "Child · Blue · added Nov 9, 2026" and "Child · added Nov 9, 2026".
- Light and dark were both used (Task editor dark at 320, light at 375).
- Console: the only errors shown were an old Vite hot-reload message ("Module today is registered twice") from before my page reload; it is a dev-server artefact of hot-replacing `App.tsx`, not caused by these changes. I did not see new errors after a clean reload, but the console tool keeps old entries, so I cannot fully separate the two.

Not browser-verified: dark mode for the Family conflict screens, a Tab-order walk, a real phone, a screen reader. The test records created in the local dev browser database are disposable (not in the repository).

## 7. Full test suite

**Not run**, deliberately. Changes are copy, CSS and display-only text; nothing touches data writing, shared components or sync. Focused tests plus type check and build were enough.

## 8. Deliberately deferred

- Two same-name members with the same role, no colour and added the same day still read identically. That needs a new field (nickname or label), which U1 forbids; each still opens its own record and nothing is merged.
- The "Possible duplicate" list and Search already used an added-date; they were not changed.
- Remaining name-based Contact creation risks: separate phase.

## 9. Git status

Seven modified files (section 3) plus this report; `docs/BACKLOG.md` and `docs/CHATGPT-HANDOFF.md` updated for the record. Nothing staged, committed or pushed. Branch `main`, base `3fca9f2`.

## 10. Recommendation

Release-ready after review, with low risk: scoped CSS and display text only. Next phase is U2 Contact Creation Identity Safety, then Ledger UI design discovery. C3 (traditional CRM) remains deferred by owner decision.
