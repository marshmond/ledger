# Ledger ST-S5.1: Final Safety Corrections (report, 2026-11-09)

Nothing is staged, committed, pushed or deployed. Built and tested on this computer only. Invented data throughout.

**Gate:** repository `marshmond/ledger`, branch `main`, HEAD = `4b827eb5e36fea8919708e2f0394d9667b5eda3e` (ST-S4, Pages run #78 success per the ST-S5 record); starting baseline 3,601 tests in 198 files; the only changes present at the start were the three ST-S5 documents plus the README/backlog/handoff edits, all preserved.

## 1. Summary of changes

| Item | What changed | Where |
|---|---|---|
| ST5-F1 | Tables this build does not have pass through sync untouched; this device never remembers their ids; a sync file in a format this build cannot interpret is refused before anything changes | `src/lib/sync/merge.ts`, `engine.ts`, `codec.ts` |
| ST5-F2 | Every change to the saved conflict list is one all-or-nothing IndexedDB transaction (`MetaStore.update`), so it is safe across tabs; the per-tab queue is gone | `src/lib/sync/engine.ts`, `conflicts.ts` |
| ST5-F3 | Household Services overview: the four claim headings are `h3` (were `h4`), same look | `OverviewParts.tsx`, `services.css` |
| ST5-F4 | "All" link on Ledger Home (every `.card-link`) is at least 44 px wide on phones/touch | `src/styles.css` |
| Owner request | Module dropdown says "Household Finances" | `src/modules/household/index.tsx` |

No schema change or migration (still version 15), no new table, no change to the encrypted sync-file format or the backup format, no dependency, no financial calculation, and the known-table merge rules are untouched (the same code runs for every table this build has).

## 2. ST5-F1: older builds and unknown tables

**Cause (reproduced in ST-S5):** the older device remembered the ids of a table it cannot see after the first sync; on the second sync it read "remembered but not here" as "deleted here", wrote deletion marks, and newer devices then deleted their own copies.

**Fix, two layers:**
1. `mergeSnapshots` takes the list of tables this build has (`known`). Any other table's records and deletion marks are copied to the output exactly as they arrived; nothing is added, changed, deleted or written locally, and the remembered ids (`base`) are ignored for it.
2. The engine no longer stores ids of unknown tables in `base` (after a sync or after joining), and drops any it already holds, so a device that later upgrades to the build that has the table receives the records instead of deleting them.
3. `decodeSnapshot` refuses a file whose `v` is not 1, whose `app` is not `ledger-sync`, or whose tables are not objects, with a plain message ("made by a newer or different version of Ledger ... nothing was changed"). It runs before any local or remote write, in both `sync` and `replaceFromRemote`. Files from the current format decode exactly as before.

**Tests** (`src/lib/sync/stS51.test.ts`, real `SyncEngine`, real encryption, fake-indexeddb; the "newer build" is a test-only subclass with one extra table, nothing added to the real schema): all 10 pass.
1. Newer device adds rows; older device syncs three times; rows survive on remote and on the newer device; no deletion marks written; the older device's normal edit still arrives.
2. Older device joins an existing newer remote; several syncs; a second older device joins later; rows survive.
3. Known-table edits and a real deletion still flow; a real deletion in the unknown table is carried through an older device to another newer device while the other rows stay.
4. Unknown fields on a known record survive an older device and reach a third device.
5. Upload failure then retry: remote unchanged by the failed run; rows survive the retry.
6. A newer device updates the unknown table between the failure and the retry: the newer content is not overwritten. 6b: the same through a real stale-version race (the engine merges again).
7. A device upgrading later to the build that has the table receives the rows.
8. A device that already remembered unknown ids from before this fix does not turn them into deletions and forgets them.
9. A version-2 sync file is refused on `sync` and `replaceFromRemote`; local data and the remote file are unchanged.

**Check that the tests catch the defect:** with both fixes reverted, 8 of the 10 fail (the original loss); with only the merge layer removed, test 8 fails; with only the "forget unknown ids" layer removed, tests 7 and 8 fail. Source restored afterwards (full suite green).

## 3. ST5-F2: concurrent tabs and the conflict list

**Choice:** a single IndexedDB read-modify-write transaction (no Web Locks needed). `dexieMeta` gets `update(key, change)`: inside one `rw` transaction it reads the current value, runs a synchronous `change`, and writes only if the value changed. The browser lets one read-write transaction use the store at a time across all tabs, so there is no window for a lost update. If `change` throws or the write fails (for example a value the browser cannot store) the transaction aborts and the stored list is exactly as before. `addConflicts`, `removeConflict`, `removeConflicts` and `clearConflicts` all use it. `MetaStore.update` is required, so there is no weaker fallback; the sync engine already stops before overwriting anything when `addConflicts` throws (existing test updated for the new method, same assertions).

**Tests** (same file, two separate connections to one database standing in for two tabs, no shared queue, no timing loops): all 7 pass.
- Control: a plain read-then-write from two connections loses a version (shows the problem is real in the test harness).
- Concurrent additions keep both (also 40 mixed adds from both connections: 40 of 40).
- Addition plus removal keeps unrelated entries.
- Clearing an older selection keeps entries another tab added afterwards.
- The same save repeated from both tabs adds exactly once.
- A failed save (the change throws, the browser refuses to store it, a record that cannot be cloned) leaves the list byte-identical and the store usable afterwards.
- A sync whose list cannot be saved changes nothing locally or remotely.

**Real two-tab browser check** (the app's built-in Chromium browser, two real tabs of the dev server on `localhost`, scratch databases deleted afterwards, the app's own databases untouched): each tab added 60 versions at once to the same database. The old read-then-write style kept **2 of 120**; the new `addConflicts` kept **120 of 120** (60 from each tab, 120 distinct). Start times of the two tabs differed by under half a second, so this is a real overlap but not a controlled one.

## 4. Three UI corrections

- **ST5-F3:** `ClaimList` now renders `h3`. Component test: under an `h2` the headings are 2,3,3,3,3 with no skip. In the browser the computed style of `.sv-h3` as `h3` and as `h4` is identical (15 px, weight 700, same margin and line height; `font-weight: bold` was added to the class so the h3's default 600 does not change the look). Not seen in a real populated overview (the scratch browser profile has no spending data).
- **ST5-F4:** at 375 px and 320 px "All" measures 44 x 44 (was 20 x 44), every card link is at least 44 x 44, and the page has no horizontal overflow (scroll width equals window width at both). The rule sits only inside the phone/touch block, so desktop is unchanged (a test checks the rule is not outside it).
- **Capitalization:** the rendered module dropdown lists "Household Finances" linking to `#/household`; id, route and the other eight entries unchanged. The page title, Today card, Search entry and Hide Amounts wording still read "Household finances" (the request named only the dropdown).

## 5. Financial, sync and backup regression results

Focused run (sync, backup and restore, preference backup, ST-S1 account integrity, ST-S2 transaction deletion, household and Services overview, shell and core UI): **38 files, 554 tests, all pass**. The financial golden masters are inside the full run below and were not edited; no financial calculation file was touched. No backup or restore code was touched.

## 6. Final test totals

| Check | Result |
|---|---|
| `npm test` (run once) | **3,622 passed in 200 files** (was 3,601 in 198; +21 tests: 17 sync, 4 UI; +2 files; 0 failed, 0 skipped, nothing weakened) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (the existing 500 KB chunk-size warning remains) |
| `git diff --check` | no whitespace errors (only line-ending notices) |

## 7. Changed files

Source: `src/lib/sync/merge.ts`, `engine.ts`, `codec.ts`, `conflicts.ts`; `src/modules/household/index.tsx`; `src/modules/services/OverviewParts.tsx` (heading, plus `ClaimList` exported for the test), `services.css`; `src/styles.css`.
Tests: new `src/lib/sync/stS51.test.ts`, new `src/shell/stS51Ui.test.tsx`; edited `src/lib/sync/conflictHistory.test.ts` (the failing-storage stand-in gained the new `update` method; assertions unchanged).
Docs: this report; `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md` updated (ST-S5 findings kept).

## 8. Remaining limitations

1. **This protects only devices that run this build.** The deployed build (`4b827eb`) still has ST5-F1. This must be committed, deployed and installed on every device before any release adds a database table. Until then: no new tables (module records still use `moduleRecords`).
2. A device that ran the old build, remembered a newer table's ids, and then upgrades to a build that has the table **without syncing on this build in between** could still treat those rows as deleted. Cannot happen until a table exists; the rule above covers it.
3. Older devices carry deletion marks of unknown tables through unchanged and never expire them; newer builds do.
4. The cross-tab fix covers the saved conflict list. Two tabs running a whole sync at the same moment were not changed (the remote's version check already refuses the second upload, and the engine merges again); other sync-meta values (`base`, `lastSync`) still use plain writes. Not re-tested in two real tabs beyond the list.
5. `clearConflicts` (remove everything) still exists but the Sync page does not call it; it is not selection-based by design.
6. File-format refusal covers `v` other than 1 and non-object tables. A newer build that changes the format must also change `v`.
7. Real phone, second physical device, real GitHub sync, Safari/Firefox and screen reader are still untested (owner checklist). The populated Services overview was tested by component test and computed styles, not seen with real data.
8. SE-01 (shared web address) stays a documented, owner-accepted risk; no hosting action was taken or proposed.

## 9. Exact Git status

`main` at `4b827eb` (unchanged); nothing staged. `git status --short` at the end of the batch:

```
 M README.md                                  (ST-S5 link, preserved)
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M src/lib/sync/codec.ts
 M src/lib/sync/conflictHistory.test.ts
 M src/lib/sync/conflicts.ts
 M src/lib/sync/engine.ts
 M src/lib/sync/merge.ts
 M src/modules/household/index.tsx
 M src/modules/services/OverviewParts.tsx
 M src/modules/services/services.css
 M src/styles.css
?? docs/LEDGER-STABILIZATION-FINAL-DISPOSITION-2026-11-09.md
?? docs/LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md
?? docs/LEDGER-STABILIZATION-ST-S5-1-REPORT-2026-11-09.md
?? docs/LEDGER-STABILIZATION-ST-S5-ACCEPTANCE-2026-11-09.md
?? src/lib/sync/stS51.test.ts
?? src/shell/stS51Ui.test.tsx
```

The handoff (`docs/CHATGPT-HANDOFF.md`) was updated: new top notice, current-phase bullet, version-skew paragraph, conditions, open-items status, test baseline and change-log entry; the historical ST-S5 wording is kept and marked superseded. Unknown: real-device behavior.

## 10. Recommendation

**Ready to commit**, subject to your review: both sync defects are fixed with tests that fail without the fixes, a real two-tab check agrees, the three presentation items are done, the full suite, type check and build pass, and no stop condition was reached (no schema change, no format change, no change to known-table merge rules, no financial change, no data-loss regression). Commit and push only on your explicit authorization; after the push, check the Actions tab for a green run and install the new build on every device before any release adds a table.
