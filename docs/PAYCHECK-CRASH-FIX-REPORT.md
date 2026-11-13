# Paycheck page crash fix (standalone, 2026-11-13)

Status: BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. Not real-device tested. D18 has not started.

## Root cause
`PaycheckPage` sorted saved scenarios with `b.updatedAt.localeCompare(a.updatedAt)`, which assumes `updatedAt` is text. The sync layer (`src/lib/sync/track.ts`) stamps every saved row, including every pay scenario, with `updatedAt = Date.now()`, a NUMBER. So once any scenario was saved, the page threw while rendering.

Exact error: `Uncaught TypeError: b.updatedAt.localeCompare is not a function` at `PaycheckPage.tsx` (the `sorted` line), reported as "An error occurred in the <PaycheckPage> component".

## Predates D18? Yes
The `localeCompare` line has been there since the calculator was first added (commit `ddcf579`); it began failing when sync tracking started stamping numbers. D17 and D18 are not involved. Reproduced on the current D17 baseline code.

## When it happens
- Empty household (no scenarios): page loads fine.
- Any household with at least one saved scenario (new, copied, or duplicated): crashes on load, every time, including direct navigation and reload. It would not have been fixed by clearing anything; the scenario itself triggers it.
- Not related to tax tables, profile fields, or paycheck-event arrays (checked: Results calculate normally).

## Fix
- `src/lib/paycheckCalc.ts`: new `scenarioStampMs` (reads a number, an ISO text date, or nothing/garbage as milliseconds, never throws) and `sortScenariosNewestFirst` (returns a new array, newest first).
- `src/pages/PaycheckPage.tsx`: uses `sortScenariosNewestFirst` instead of the unsafe `localeCompare`.
- `src/lib/paycheckCalc.test.ts`: 3 regression tests (mixed number/text/missing/garbled stamps; input not mutated; both stamp kinds read as milliseconds).
No stored data is read-modify-written. No calculation engine changed; `runScenario` and the tax logic are untouched.

## Why one bad screen froze navigation (not changed)
`ModuleLoadBoundary` deliberately rethrows non-"file could not load" errors (a tested design choice). There is no other error boundary above it, so any render error on any screen unmounts the whole app, including the top bar. That is why nothing else was clickable.
Proposal for separate review (NOT built): make the boundary show a small "This screen hit a problem" message with the top bar left working and a way back, and reset when the route changes. It affects every module, so it needs its own approval and test updates (one existing test asserts the rethrow).

## Verification (in the app, invented household)
- Reproduced the crash first, with the error above.
- After the fix: Paycheck loads, heading and both saved scenarios list, selecting a scenario opens its editor and Results (24 paychecks, one paycheck breakdown, federal and MA yearly tax), navigating to Accounts and back works, reload works.
- Tests: `paycheckCalc.test.ts` 14 passed. `npx tsc --noEmit` clean. `npm run build` succeeded. Full suite NOT run (per instruction; CI runs it on release).
- Not tested: a scenario with a text `updatedAt` stored in the real database (the sync hook overwrites it on write, so I could only cover it in the unit tests); owner's real data; real phone.

## Data preservation
Existing scenarios are only read for display and ordering. Nothing was written, migrated or reset. The test people and scenarios I created lived only in the in-app browser's local database and were deleted afterwards.

## Remaining risks
- Other screens assuming a text `updatedAt`: a search of `src` found no other `updatedAt.localeCompare` use. Other patterns were not audited.
- The whole-app freeze on any screen bug remains until the boundary proposal is approved.
- Ordering fallback: scenarios with a missing or unreadable stamp sort last.

## Git status
Modified: `src/lib/paycheckCalc.ts`, `src/lib/paycheckCalc.test.ts`, `src/pages/PaycheckPage.tsx`, plus this report and the BACKLOG and handoff notes. Untracked and untouched: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`.
