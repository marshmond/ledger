# Ledger Stabilization ST-S1: implementation report

**Date:** 2026-11-08 (America/New_York). **Author:** Claude. **Status:** BUILT AND TESTED LOCALLY. **UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED, NOT ACCEPTANCE-TESTED on real devices, NOT yet independently reviewed.** ST-S2 to ST-S5 are not started. No hosting, GitHub, DNS or credential change was made.

**Privacy:** all data in tests and browser checks was invented. Nothing real was read, reset, migrated or edited.

---

## 1. Executive summary (plain English)

ST-S1 fixes the four code items from the S0 audit and adds a separate hosting plan. Each fix has tests, and each test was shown to fail without the fix.

1. **DI-01, bank-account deletion.** An account can no longer be deleted while a Scheduled item still uses it (or a loan is linked to it). The screen says which items, says nothing was deleted, and links to the Scheduled page. Separately, approving a Scheduled item whose account is missing is now refused before anything is written, so no transaction can be posted to an account that does not exist.
2. **SY-01, sync conflict recovery.** Every version that a sync overwrites is now kept until you put it back or clear the list. While fixing it I found a **second, worse loss path** than the one in the audit: the old code saved the list only at the very end of a sync, so if the upload failed *after* this device had already been overwritten, those versions were never recorded at all. They are now saved *before* anything is overwritten.
3. **TS-01, date-fragile privacy tests.** The problem was wider than the single `1799` test: with the clock set so a forbidden number sat in the id prefix, **eight test files failed**. A small test-only helper now ignores generated ids and timestamps while still scanning every readable word and number, and a guard test stops new tests from reintroducing it.
4. **BK-01, backup preferences.** Three more device choices travel in a backup.

**Verification:** 3,357 tests pass in 183 files (47 new). The same suite passed with the clock set to 2027-01-08, 2027-01-12 (both inside the January window), 2028-02-29 (leap day) and 2026-12-31 23:50, and in four time zones. The five financial golden-master files pass unchanged. `tsc` is clean and the build succeeds. The new screens were checked in a real browser at desktop and phone width on an isolated test origin.

**What I did not do (by design or because it needs you):** no hosting action; no real-device, second-device, offline, older-build or screen-reader testing; no change to ST-S2 items such as the warning when deleting a transaction.

---

## 2. Exact repository and deployment baseline

| Check | Result |
|---|---|
| Repository, branch | `marshmond/ledger`, `main` |
| `HEAD` = `origin/main` | `8e77af465ed8b086c4b44106324c0991ac88d8f6` (B5), confirmed with `git ls-remote` |
| Pages run for that SHA | #74 `completed` / `success` (public Actions API; `gh` is not installed) |
| Working tree at start | Only the two expected untracked S0 documents (`docs/LEDGER-STABILIZATION-S0-AUDIT-2026-11-08.md`, `docs/LEDGER-STABILIZATION-ROADMAP-2026-11-08.md`); no unexpected source change or commit |
| Baseline | 3,310 passing tests in 179 files (re-run in S0 on the same source) |

---

## 3. Scope and decisions

In scope and built: `DI-01`, `SY-01`, `TS-01`, `BK-01`; hosting plan (document only); SY-02 instructions; documents. Out of scope and untouched: ST-S2 to ST-S5, any hosting or GitHub setting, financial calculations, the encrypted sync file format, the schema (no migration), any real data.

Decisions taken within the brief's guidance (also listed for review in section 19): conservative blocking, no cascading deletes, no automatic repair, no Undo feature, lossless conflict storage with a display-only row limit.

---

## 4. DI-01: defect reproduction and correction

**Reproduction (S0, repeated).** Delete an account that has Scheduled rules; the rules stay; approving one posts a transaction to the dead account id (`Unknown account` on the Transactions page; it counts in spending). In S0 this was reproduced in a disposable browser origin. In ST-S1 the same sequence is now a failing-without-fix test (section 6).

**Correction.**
- New `src/lib/accountDependents.ts`: a read-only reader of what depends on an account, the plain-language messages, `deleteAccountWithTransactions` (the one writer), and `orphanedRules`.
- `src/pages/LedgerPage.tsx`: the Delete account button reads the dependents first. If something blocks, a dialog explains; otherwise the existing confirmation (now also listing non-blocking notes) runs, and the deletion re-checks inside its own transaction.
- `src/lib/schedule.ts`: `postInstance` validates the posting account (and the transfer account) **inside its transaction, before any write**.
- `src/pages/ScheduledPage.tsx` and `src/modules/ledger/dueProvider.ts`: read-only warnings.

---

## 5. Account dependency behavior

**Inventory.** Records that name a Finance account (`accounts` table): transactions (deleted with the account, as before, including the other half of a transfer), Scheduled rules (`accountId` and `transferAccountId`), loans (`ledgerAccountId`), payee rules limited to the account, CSV import batches, Bills' expected funding account (stored in Bills' records, read live by Bills), and the primary-account setting. Holdings, HSA withdrawals, RSU grants and goals use the separate investment accounts table and are unaffected.

| Dependent | Effect on "Delete account" | Why |
|---|---|---|
| Scheduled rule posting to the account, or transferring to or from it, **active or paused** | **Blocks** | It would keep coming due with nowhere to post (the S0 defect) |
| Loan linked to the account | **Blocks** | The loan's payments would point at a missing account |
| Payee rules limited to the account, earlier imports, a bill that says it is paid from it, the primary-account choice | **Mentioned in the confirmation, never blocks** | Each is safely ignored or read as "missing" when the account is gone; nothing changes in them |
| Transactions | Deleted with the account, unchanged | That is the button's existing purpose and is stated in the confirmation |

The blocking message names the items (up to six, then "and N more"), says how many are active and how many paused, says "Nothing was deleted", says how to resolve (move each item to another account, or delete it yourself; pausing is not enough because a paused item can be turned back on), and links to the Scheduled page. Ledger shows a "closed" badge on an account but **no screen in this version closes an everyday account**, so the message does not suggest closing; building a closing workflow was out of scope. Nothing is silently deleted, moved or migrated. The broader "who points at this record" question for transactions is DI-02, left for ST-S2.

---

## 6. Scheduled posting guard

`postInstance` now checks, inside the same database transaction that would write the transaction and the log, that the posting account exists and, for a transfer, that the other account exists. If not, it throws `MissingAccountError` with a plain message ("Nothing was posted: the account this scheduled item belongs to no longer exists. You can skip this item, or delete it on the Scheduled page and add it again for an account that exists.") and writes nothing: no transaction, no recurring-log entry, no change to any balance. The Scheduled page shows the message in the row and also disables Approve for an orphaned item. **Skip stays available**, because skipping only records that a date was handled and is how an owner clears old dates. Cases covered: account missing now; account deleted on another device; account removed between the preview and the click (stale button); an invalid reference already in the database; either account of a transfer missing.

Orphans already in the data are **not repaired**: the Scheduled page shows a notice ("N scheduled items point at an account that no longer exists… Nothing has been changed"), each row gets an "account missing" badge and a warning, and Today and Calendar still list the item (so it is not forgotten) with a plain sentence added to its detail. Titles, dates and amounts are unchanged. Today's attention counts still include them.

### Tests (`src/lib/accountIntegrity.test.ts`, 16 tests)

| Required case | Test |
|---|---|
| 1 active rule blocks | "1. an ACTIVE Scheduled rule blocks…": nothing deleted; message has no amounts or ids |
| 2 inactive rule blocks | "2. an INACTIVE (paused) rule also blocks…", plus a transfer rule on another account, plus the active/paused mix wording |
| 3 other dependents | "3. other dependents…": a linked loan blocks; payee rules, imports, a bill, the primary choice are mentioned and do not block, and are untouched after deletion |
| 4 no dependents | "4. an account with no dependents is deleted…": its transactions only, other accounts untouched |
| 5 approval, missing account | "5. approving a rule whose account is missing is refused…" |
| 6 disappears between preview and posting | "6. an account that disappears between the preview and the click…" (and a rule appearing between check and delete is still seen) |
| 7 nothing written on refusal | "7. a refusal writes NO transaction and NO recurring log…" (full before/after comparison of four tables), transfer either-account case, healthy rule still posts, skip still works |
| 8 Today and Calendar | "8. the item is NOT hidden…" (provider output: title unchanged, detail carries the note, healthy item has none) |
| 9 backup and restore | "9. an orphaned rule and an orphaned transaction survive export and restore unchanged" |
| 10 two devices | "10. A deletes an account with no rules; B schedules and approves…": real `SyncEngine`; after syncing the account is gone on both, the rule remains unrepaired, approving again is refused on both devices, the one transaction B posted before it knew is kept; and "B schedules a rule … A is blocked" |

**Mutation check:** with the guards switched off (`blocksDeletion` always false, posting checks removed), **10 of the 16 tests fail**; restored, all 16 pass.

---

## 7. SY-01: reproduction and conflict-history solution

**Reproduction (S0 experiment E1, now a regression test).** Two devices change the same 80 records while apart; the merge detects 80 clashes; the stored list held 50. Cause: `engine.ts` stored `[...new, ...old].slice(0, MAX_CONFLICTS)` with `MAX_CONFLICTS = 50`.

**Further defects found while inspecting the code (all fixed):**
1. **Saved too late.** The list was written at the very end of `sync()`, after `applyLocal` had overwritten this device and after the upload. If the upload failed (network, 403, race retries exhausted) the exception skipped the save, so the overwritten versions were lost and never recorded; the next sync saw identical copies and detected no clash. Proven: moving the save back to the end makes two of the new tests fail.
2. **Stale-list write-back.** The Sync page kept its own copy of the list and, on "Put that version back" or "clear", wrote its stale copy back to storage, wiping any entries a sync had added since the page was drawn.
3. **Silent wipes.** "Clear this list" removed everything with one click; "Use the synced copy" and "forget the sync setup" emptied the list silently.

**Solution (reusing the existing sync-meta storage; no new format, no schema):**
- New `src/lib/sync/conflicts.ts`: `readConflicts`, `addConflicts` (keeps what is there, adds new, ignores the same overwritten version seen again, newest first, **no limit**), `removeConflict` and `clearConflicts` (read the *current* list), all queued so changes cannot interleave. The key is the table, record, which side lost, and the lost version's own edit time (not the sync time), so a retry cannot add a duplicate.
- `engine.ts`: removes the cap; calls `addConflicts` right after the merge and **before** `applyLocal` and the upload. If saving fails, the sync stops with nothing overwritten anywhere. `replaceFromRemote` and `forget` no longer clear the list.
- `auto.ts`: the top-bar count reads the stored list.
- `SyncPage.tsx`: shows the newest 50 with a **Show all N** button (display only), puts back and clears against the current list, and "clear this list" asks first ("Remove all N saved versions for good?").
- The merge, the choice of winner, the encrypted file and the field-level behavior are **unchanged**.

**Retention.** None. Nothing expires. Storage cost is one record per overwritten version in this browser's sync-meta database (the 500-conflict test, which keeps 500 full records, runs in a few seconds). If a retention policy is ever wanted it needs an explicit owner decision; none was invented.

---

## 8. Conflict counts, recovery and retention tests (`src/lib/sync/conflictHistory.test.ts`, 20 tests)

| Group | Result |
|---|---|
| 0, 1, 50, 51, 80, 120 and 500 clashing records | Every overwritten version kept (N of N), unique keys, each sampled lost copy is the correct version, the winner is unchanged (the later edit wins as before) |
| Regression of the S0 finding | 80 detected, **80 retained** (was 50) |
| The other side loses (this device wins) | 70 of 70 kept; winner unchanged |
| Several cycles | 80 unreviewed + 30 new = 110; the first 80 all still present; newest first |
| Put back one | 59 left of 60; the restored edit wins and reaches the other device; others untouched |
| Restart (recreated engine) | Same 66 entries; the count the status chip uses equals what is stored |
| Replace from the synced copy, forget setup | List kept (55 of 55) |
| List cannot be saved (storage full) | The sync **stops**: this device's own version is still there, nothing uploaded; with storage working, all 12 recorded |
| Upload fails after this device was overwritten | 40 of 40 already saved; retry adds none (still 40) |
| Version race (the upload is refused as stale, then retried) | 45 of 45, no duplicates |
| Wrong passphrase, damaged remote file | Refused; the 30 saved entries intact |
| A stale screen's copy | Removing by key reads the current list; newer entries survive |
| Idempotent add, no truncation, no interleaving; 300 entries; two different lost versions of one record | All behave as designed |

**Mutation checks:** (a) re-adding a 50 cap makes 11 tests fail; (b) moving the save back to the end of the sync makes 2 fail. Restored, all pass.

**Critical invariant:** for N detected overwritten versions, all N remain recoverable unless the owner removed some. Shown for every N above. **The UI count equals the stored count** (browser check, section 17).

---

## 9. TS-01: false-failure repairs

**What the S0 audit found:** `b4-calendar.test.ts:112` forbids `1799`, which appears in new record ids from 2027-01-03 to 2027-01-15.

**What a wider reproduction found.** I set the clock so each forbidden number sat in the id prefix and ran the 13 suspect test files:

| Forbidden number in the id prefix (clock set) | Failing before the repair |
|---|---|
| `1234` | `b2-views` |
| `12345` | `assets/service`, `b2-views`, `s4-calendar`, `s4-contract`, `s4-misc` (6 tests) |
| `4455` | `s4-assets-projects`, `s4-calendar`, `s4-contract`, `s4-misc` |
| `4242`, `424242` | `b4-calendar` |
| `4244` | `bills/hooks` |
| `9900` | `assets/service` |
| `12345678` | `b2-views`, `s4-calendar`, `s4-misc` |
| `1799` (2027-01-09) | `b4-calendar` |
| `5000`, `7000`, `12000`, `11420`, `1549`, `9981`, `114520`, `99887766`, `1800` | passed |

The short ones are brief windows (10 s to 100 s), but together they give a small chance of a failure on every CI run, and CI gates deployment.

**Correction.** New test-only `src/lib/leakTestkit.ts`: `scrubGeneratedIds` replaces generated-id-shaped numbers (16 digits starting 1, 2 or 9) and 13-digit epoch timestamps with `#`, and `scanText(value)` serializes then scrubs. Everything a person could read (titles, details, notes, amounts, account numbers, provider names, even the non-numeric part of a calendar id) is still scanned, so a real leak still fails. Applied to 13 existing test files: `assets/service`, `bills/b2-sync`, `b2-views` (two places), `b3-sync`, `b4-calendar`, `b4-data`, `hooks` (two), `projects/p5`, `services/s4-assets-projects`, `s4-calendar`, `s4-contract` (two), `s4-misc` (two), `visits-hooks`. I inspected the 42 candidate assertions the scan found; date strings like `'2026-11-18'`, hyphenated codes like `555-0100` and word codes like `SN-777` cannot sit inside a numeric id and were left alone. No privacy protection in production code was changed.

**Guard.** `src/lib/leakScanGuard.test.ts` (5 tests) proves the helper hides ids but not leaks (a price in cents, an account number, a card number starting 4, a note, text inside an id-bearing string), and fails any test file that forbids a bare 3-or-more-digit number without going through the helper (or an explicit `// ids-ok: reason`). Its detector has its own self-test.

**Proof.** After the repair all 18 probe clock times pass. Injected leaks still fail: with a price appended to a Bills calendar title and a note appended to a Services visit title, four tests across `b4-calendar`, `s4-calendar` and `b2-views` fail (and their messages show the ids replaced by `#`); restored, they pass.

---

## 10. Shifted-date and time-zone tests (full suite, 3,357 tests each)

All passed, 183 of 183 files.

| Run | Clock | Time zone |
|---|---|---|
| Real clock, as today | 2026-11-08 | America/New_York (normal run) |
| Inside the January window | 2027-01-08 12:00 | America/New_York |
| Another day in the window | 2027-01-12 09:30 | America/New_York |
| Leap day | 2028-02-29 12:00 | America/New_York |
| Year end | 2026-12-31 23:50 | America/New_York |
| Real clock | today | UTC |
| Real clock | today | Pacific/Kiritimati (UTC+14) |
| Window, far-east zone | 2027-01-08 12:00 UTC | Pacific/Kiritimati |
| Window, far-west zone | 2027-01-14 12:00 UTC | Pacific/Pago_Pago (UTC-11) |

The clock was moved with a scratch setup file outside the repository (subclassing `Date`; I confirmed in S0 that the tests see the shifted date). Before the repair, the 2027-01-08 run had failed with one test.

---

## 11. BK-01: preference backup and restore tests (`src/lib/preferenceBackup.test.ts`, 6 tests)

Architecture rule confirmed: screen preferences live in the browser's `localStorage`; the backup carries only an allow-listed set under `preferences` (secrets are excluded and a test pins that); restore copies listed keys' text as it is; unlisted keys are never touched; the preferences are **not** database data and are **not** synchronized. The three keys are now on the list (`services-upcoming-days`, `tasks-last-view`, `ledger-last-module`). Each reader already validates its value and falls back to a default, which is why restore does not need to judge values.

Tests: the keys are listed and no secret is; export carries them and restore puts them back exactly, replacing an existing listed key and leaving unrelated keys (and other sites' keys) alone; missing keys and malformed `preferences` are harmless and a device's own value is not wiped by an older backup; invalid values (`9999`, an unknown view, an unknown module) restore as text and the readers return their defaults (the upcoming window and the module chooser are tested directly; Tasks' view check is pinned by a source guard because that page is not rendered in tests); the preferences never appear in the database tables of the backup.

---

## 12. SE-01: hosting isolation (recommendation, separate from the code)

Written as a separate document: **`docs/LEDGER-HOSTING-ISOLATION-PLAN-2026-11-08.md`**. It compares A (custom domain for Ledger), B (dedicated GitHub account or organization) and C (move the other apps) on cost, upkeep, effect on the repository, deployment changes, data migration, Home Screen shortcuts, sync continuity, rollback and how isolation is verified, and gives a migration route and a planning default (A, keeping the existing repository; B as the free equivalent; C as a complement). **No hosting action was taken** and none is proposed without the owner's explicit authorization.

---

## 13. SY-02: measuring repository growth

The Sync page (**Settings, Sync devices**, route `#/settings/sync`) shows, on the device that has synced at least once, a line of the form:

> Synced file: *N KB or MB*, *N* records. Sent to GitHub *A* times today and *B* in the last 30 days.

**Please tell us two values:** the synced file size and the "in the last 30 days" number. If the line is not there, open Sync devices and press **Sync now** once, then look again (it appears after a successful sync on that device). The page also warns in words when the file is above 5 MB. Each upload adds one new copy of that file to the private repository's history, so a rough yearly growth is `file size × uploads per 30 days × 12`. No sync behavior was changed on speculation, no Git history was touched, and no token was accessed or disclosed.

---

## 14. Files changed

**Production (10):** `src/lib/accountDependents.ts` (new), `src/lib/schedule.ts`, `src/lib/sync/conflicts.ts` (new), `src/lib/sync/engine.ts`, `src/lib/sync/auto.ts`, `src/lib/backupFile.ts`, `src/pages/LedgerPage.tsx`, `src/pages/ScheduledPage.tsx`, `src/pages/SyncPage.tsx`, `src/modules/ledger/dueProvider.ts`.

**Test support (new):** `src/lib/leakTestkit.ts`.

**New tests (4):** `src/lib/accountIntegrity.test.ts` (16), `src/lib/sync/conflictHistory.test.ts` (20), `src/lib/leakScanGuard.test.ts` (5), `src/lib/preferenceBackup.test.ts` (6).

**Existing tests edited for TS-01 only (13):** `assets/service.test.ts`, `bills/b2-sync.test.ts`, `bills/b2-views.test.ts`, `bills/b3-sync.test.ts`, `bills/b4-calendar.test.ts`, `bills/b4-data.test.ts`, `bills/hooks.test.ts`, `projects/p5.test.ts`, `services/s4-assets-projects.test.ts`, `services/s4-calendar.test.ts`, `services/s4-contract.test.ts`, `services/s4-misc.test.ts`, `services/visits-hooks.test.ts` (each changed only where a forbidden-number scan now goes through the helper; no assertion was weakened or removed).

**Documents:** `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `README.md` (three table rows), `docs/sync.md`, `docs/due-provider.md`, and new `docs/LEDGER-STABILIZATION-ST-S1-REPORT-2026-11-08.md`, `docs/LEDGER-HOSTING-ISOLATION-PLAN-2026-11-08.md`. The two S0 documents are unchanged (still untracked). Not touched: `CLAUDE.md`, `docs/module-hooks.md`, the dependency list, configuration, the database schema.

---

## 15. Financial non-mutation evidence

- **No financial calculation changed.** The spend readers (`spending.ts`, `householdSpend.ts`, `billsSpend.ts`, the household union and commitments) were not edited. The only Finance-library change is the account check at the top of `postInstance`; amounts, signs, dates, categories, status and the transfer logic are as before.
- **Golden masters pass unchanged:** `b5-golden-master`, `b5-union`, `b5-commitments`, `s5-spend-matrix`, `b3-spend`: 5 files, 157 tests, none edited.
- **A valid Scheduled approval is byte-for-byte as before** (a test asserts the transaction and the log entry).
- **Deleting an account with nothing depending on it is unchanged**, including removal of the other half of transfers (tested).
- **Refusals change nothing** (full before/after comparison of transactions, log, accounts and rules).
- The seeded browser checks used invented data only.

---

## 16. Sync and backup evidence

- Sync: all existing sync tests pass (`sync.test.ts` 28, `skip.test.ts` 8) plus the 20 new ones, using the real `SyncEngine`, the real merge, real encryption and fake-indexeddb with an in-memory remote. The winner of a clash, the merge rules and the file format are unchanged. Two-device Scheduled test (section 6).
- Backup and restore: 66 tests across the six backup test files pass, including the table-coverage guard, restore with sync on, the encrypted restore, and the new preference tests; an orphaned rule and transaction survive a restore unchanged (section 6, case 9).
- Not tested: real GitHub, physical devices, offline, an older build.

---

## 17. Browser acceptance results and limitations

Done in the Browser pane on an isolated `*.localhost` origin that I confirmed held only the starter categories before seeding invented data; the origin's databases were deleted afterwards and the server stopped. Real clicks where the pane allowed; otherwise a direct DOM click (the pane timed out while the background test runs used the CPU).

| Check | Result |
|---|---|
| Delete account with 3 Scheduled items (2 active, 1 paused) | Dialog "This account cannot be deleted yet" named all three, said 2 active and 1 paused, said nothing was deleted, linked to `#/ledger/scheduled`; database unchanged (3 accounts, 3 rules, 3 transactions) |
| Delete an unused account | Plain confirmation text read correctly; only its one transaction was removed; Scheduled items untouched; returned to Home |
| Orphaned items on Scheduled | Page notice ("3 scheduled items point at an account that no longer exists… Nothing has been changed"), all 3 Approve buttons disabled, 3 "account missing" badges and row warnings (screenshot reviewed) |
| Today and Calendar for an orphan | Items still listed with the note in their detail; titles unchanged |
| Sync page with 120 saved versions | Heading "(120)", top-bar chip "Review 120", 50 rows drawn and a "Show all 120" button; Show all drew all 120 including the oldest |
| Put back one version | 119 left; heading and chip say 119; the overwritten version was restored to the record |
| "Clear this list" | Asked "Remove all 119 saved versions for good?" with "Yes, remove all" and "Keep them"; Keep left all 119 |
| 375 px width | No horizontal overflow on Scheduled or Sync; the blocked-delete dialog (351 px wide) fits the screen with focus inside |

**One defect found and fixed during this check:** the blocked-delete message first told the owner to "pause it, or give it an end date", but a paused item still blocks; the wording now says pausing is not enough.

**Limitations:** no real phone, no screen reader, no full Tab walk of the new dialog beyond the existing shared `Modal` behavior (it is the same component the Add dialog uses, whose focus trap I tested in S0), no dark-theme or custom-palette check of the new text, no second device. The delete-account confirmation still uses the browser's own dialog (existing behavior); I auto-accepted it to read its text.

---

## 18. Full test totals

| Command | Result |
|---|---|
| `npm test` (final, real clock) | See section 20 for the last run: **183 files, 3,357 tests passed, 0 failed, 0 skipped** |
| Baseline before ST-S1 | 179 files, 3,310 tests |
| New | +4 files, +47 tests (16 + 20 + 5 + 6) |
| Golden-master and spending files | 5 files, 157 tests passed |
| Finance Scheduled, Calendar, Today, Ledger module | 12 files, 186 tests passed |
| Sync and conflicts | 3 files, 56 tests passed |
| Backup, restore, preferences | 6 files, 66 tests passed |
| Shifted-date and time-zone runs | 8 runs, each 183 files and 3,357 tests passed |
| `npx tsc --noEmit` | Clean |
| `npm run build` | Succeeds; usual chunk-size warning (the single script is 2.28 MB, S0 finding PF-01, unchanged by ST-S1) |
| `git diff --check` | Clean |

---

## 19. Known limitations and deferred decisions

**Judgment calls (please review):**
1. Only Scheduled items and linked loans **block** an account deletion; payee rules, imports, Bills' funding account and the primary-account choice are only mentioned.
2. A **paused** item blocks as well (it can be turned back on); an item with a past end date blocks too (conservative; no "ended" exemption).
3. A transfer item on **another** account that targets the account blocks.
4. **Skip** stays allowed on an orphaned item; Approve is disabled in the screen and refused in the code.
5. Orphans still appear on Today and Calendar (with a note) rather than being hidden or auto-removed; Today's counts include them.
6. Account deletion still uses the browser's confirmation and has **no Undo**.
7. Conflicts are saved before anything is overwritten, so a failed upload can leave an entry for a version that was not in the end lost (harmless, deduplicated, and removable).
8. "Use the synced copy" and "forget sync" now keep unreviewed overwritten versions.
9. "Clear this list" now asks first (a small addition beyond the brief, needed so a deliberate removal really is deliberate).
10. `scanText` hides 16-digit ids starting 1, 2 or 9 and 13-digit epoch times; a card number starting 4 or 5 is still scanned.
11. The guard accepts an explicit `// ids-ok: reason` marker.
12. Restore copies preference text as it is; each reader validates.

**Known limits:** a transaction posted before another device's deletion arrives is kept (it cannot be prevented across devices; the guard stops every later one); two browser tabs on one device could still race on the conflict list (a lost removal only brings an entry back); an existing orphan is flagged but the owner must fix it by hand (edit its account or delete it); no check yet warns when a *transaction* that other modules reference is deleted (DI-02, ST-S2).

**Deferred to later phases:** ST-S2 (DI-02 and UX-04, shared helpers, Hide Amounts scope, wording), ST-S3 (labels and touch targets), ST-S4 (script size, test timeouts; optional), ST-S5 (real-device matrix and disaster-recovery drill). **Owner decisions pending:** the hosting option (the plan document), the two Sync-page figures (section 13).

---

## 20. Exact Git status

At the start: branch `main`, `HEAD` = `origin/main` = `8e77af465ed8b086c4b44106324c0991ac88d8f6`, only the two S0 documents untracked.

At the end, after the final `npm test` (183 files, **3,357 passed**, 0 failed, 0 skipped, 100 s with other work running), `npx tsc --noEmit` (exit 0), `npm run build` (succeeds), `git diff --check` (clean, exit 0, also for the index):

```
 M README.md                                    ?? docs/LEDGER-HOSTING-ISOLATION-PLAN-2026-11-08.md
 M docs/BACKLOG.md                              ?? docs/LEDGER-STABILIZATION-ROADMAP-2026-11-08.md
 M docs/CHATGPT-HANDOFF.md                      ?? docs/LEDGER-STABILIZATION-S0-AUDIT-2026-11-08.md
 M docs/due-provider.md                         ?? docs/LEDGER-STABILIZATION-ST-S1-REPORT-2026-11-08.md
 M docs/sync.md                                 ?? src/lib/accountDependents.ts
 M src/lib/backupFile.ts                        ?? src/lib/accountIntegrity.test.ts
 M src/lib/schedule.ts                          ?? src/lib/leakScanGuard.test.ts
 M src/lib/sync/auto.ts                         ?? src/lib/leakTestkit.ts
 M src/lib/sync/engine.ts                       ?? src/lib/preferenceBackup.test.ts
 M src/modules/ledger/dueProvider.ts            ?? src/lib/sync/conflictHistory.test.ts
 M src/pages/LedgerPage.tsx                     ?? src/lib/sync/conflicts.ts
 M src/pages/ScheduledPage.tsx
 M src/pages/SyncPage.tsx
 M 13 existing test files (TS-01, section 14)
```

**26 modified files** (5 documents, 8 production files, 13 existing test files), **11 untracked files** (7 new source and test files, 4 documents: the S0 audit, the S0 roadmap, the hosting plan and this report). **Nothing is staged**, `HEAD` still equals `origin/main` (`git ls-remote` agrees; 0 commits ahead), and nothing was committed, pushed or deployed. `dist/` and `node_modules/` are git-ignored. Every changed file is within the ST-S1 authorization.
