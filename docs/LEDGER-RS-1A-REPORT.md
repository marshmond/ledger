# Ledger RS-1A: Financial Integrity and Atomic Deletion Hardening

Date: 2026-11-15. Status: **BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review.** NOT REAL-DEVICE TESTED.

Release readiness: **released as approved (see final decisions).** NC-18 and NC-22 are fully corrected. NC-19 is corrected for the atomic part and is *fail-closed* for tax lots (provisional safety behavior): an account that still has tax lots cannot be deleted. Deleting lots together with an account (Option A below) is NOT built and needs your separate approval.

> **RS-1A FINAL DECISIONS (2026-11-15, owner and ChatGPT approved for commit and deployment; supersede any "provisional", "partially complete", "not accepted", "uncommitted" or "F-1 unresolved" wording below):** NC-18 resolved. NC-22 resolved. NC-19 atomic deletion implemented; **Option B (refuse while tax lots exist) is the approved current policy.** F-1 resolved: account deletion is blocked while recorded sales exist. **Option A (automatic tax-lot cascade) is NOT authorized and NOT needed for current completion.** Final verification: 293 files, 5,793 tests pass; `tsc` and build clean. Other findings (F-2 asset-class warning, HSA withdrawals, RSU vests/grants and goals naming a deleted account, historical orphans) stay documented, not reopened. Remaining RS-1: MA 2026 surtax, three `alert()` calls, NC-30 order, two intermittent tests, doc drift.

> **RS-1A FINAL CORRECTION (F-1, 2026-11-15, ChatGPT-approved; still uncommitted):** `deleteInvestmentAccount` now also refuses, before any write and inside the same transaction (`sales` added to its scope), when any recorded sale names the account (message: the account has N recorded sales and cannot be deleted while those records remain). Sales are never deleted or changed; the Undo engine is untouched; tax-lot blocking and successful deletion of accounts with no lots and no sales are unchanged. +2 tests (38 in `rs1aAtomicDeletes.test.ts`; one existing test adjusted because its demo account has a sale); full suite 293 files / 5,793 tests, `tsc` and build clean. **Option B is the approved NC-19 policy.** HSA withdrawals, RSU vests/grants and goals naming a deleted investment account are separate findings, behavior unchanged; historical orphans and the asset-class warning (F-2) not addressed. RS-1B not started.

## A. Executive summary (plain language)

Three buttons used to delete money records in two separate steps. If something went wrong between the steps (a closed tab, a crash, a full disk), you could end up with half a deletion. Now each one is a single all-or-nothing step: either everything goes, or nothing changes.

- **Removing a holding (NC-18):** the holding and its tax lots now go together. Before, the lots went first and the holding second, so a failure in between left a holding with no lots (its cost basis and purchase dates gone). Now that cannot happen.
- **Deleting a property (NC-22):** the property and its value history now go together. Before, a failure in between left a property with no value history. Now that cannot happen.
- **Deleting an investment account (NC-19):** this was the riskiest one. Before, it deleted the account's holdings and the account but **left every tax lot behind** (orphans pointing at an account that no longer existed), and the two steps were not atomic. Now: if the account or any of its holdings still has tax lots, Ledger **refuses before changing anything** and explains what to do (remove the holdings first; removing a holding already removes its lots and records no sale). Accounts without tax lots (for example IRAs, which do not track lots) delete with their holdings in one all-or-nothing step, as before.

What the household gains: no half-deleted records, no new orphan tax lots, and a clear message instead of a surprise. Nothing was added that deletes more than before; the only behavior change is that one deletion that used to leave orphans is now refused.

## B. Before-and-after deletion analysis

Baseline verified first: branch `main`, `HEAD` = `origin/main` = `0eb4d6553c30eda0d01084316e57ec6f04bfa472` (R1.1, `feat(today): add unified Needs you attention list`). R1.1 IS committed and deployed: GitHub Pages run **#116** `completed` / `success` for that SHA (public Actions API; `gh` is not installed). Working tree held only the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`), untouched. So there was no baseline conflict with R1.1.

Documents read: `docs/BACKLOG.md` (newest entries), `docs/CHATGPT-HANDOFF.md` (sections 1, 5, 6 headers, 9, 11 by search; the file is 444 KB, so it was read by section, not line by line), `docs/LEDGER-R0-PRODUCT-ASSESSMENT.md` and `docs/LEDGER-R0-STRATEGIC-ROADMAP.md` (the NC-18/19/22 passages), `docs/LEDGER-R1.1-REPORT.md` (only the golden-master and baseline statements), `docs/LEDGER-SIGNATURE-D20.1-OD6-INVENTORY.md` (rows NC-18, NC-19, NC-22 in all four tables).

### NC-18, remove a holding (`src/pages/InvestmentsPage.tsx`)

| | |
|---|---|
| Original | `db.taxLots.where('holdingId').equals(id).delete()` then `db.holdings.delete(id)`, two awaits, no transaction. |
| Dependencies found | Tax lots point at the holding by `holdingId` (and carry `accountId`, `securityId`). Recorded sales keep their own copy of the lots they used (`Sale.lots`), so they do not point at live lots. Nothing else points at a holding. |
| New behavior | `deleteHoldingWithLots(db, holdingId, accountId)` in `src/lib/confirmedDeletes.ts`: ONE read-write transaction over `holdings` and `taxLots`. It re-reads the holding inside the transaction, refuses (no write) if it is gone or now belongs to a different account than the screen showed, deletes its lots, then the holding. |
| Tables | `holdings`, `taxLots`. |
| Semantics changed? | No. Same records are deleted; the confirmation text is unchanged ("removes the holding and its tax lots ... does not record a sale"). New: a stale press (already removed, or moved to another account) shows a message instead of silently doing nothing. |
| Remaining limitation | None known for the holding. |

### NC-19, delete an investment account (`src/pages/InvestmentsPage.tsx`)

| | |
|---|---|
| Original | `db.holdings.where('accountId').equals(id).delete()` then `db.invAccounts.delete(id)`, two awaits, no transaction. **Tax lots were never deleted**, so every taxable account deletion left orphan lots (they still named the deleted account). |
| Dependencies found | `holdings.accountId`, `taxLots.accountId` and `taxLots.holdingId` (via its holdings). Also naming the account, and **not touched** by this phase or by the old code: `sales.accountId` (recorded sales, history and tax reporting), `hsaWithdrawals.accountId`, `rsuVests.accountId` and `rsuGrants.accountId` (where held shares go), `goals.accountId` (the account that funds a goal). Nothing else. |
| New behavior | `deleteInvestmentAccount(db, accountId)`: ONE transaction over `invAccounts`, `holdings`, `taxLots`. Inside it: re-read the account (refuse if gone); read its holdings and every lot that names the account or one of its holdings; **if any lot exists, refuse before any write** with a plain-language message; otherwise delete its holdings then the account. The dialog also shows a short warning from the live data when lots exist (the real check is the one inside the transaction). |
| Tables | `invAccounts`, `holdings`, `taxLots` (read for the check; written only on the success path, where there are no lots to delete). |
| Semantics changed? | **Yes, in one direction only: more cautious.** An account with tax lots can no longer be deleted in one step. Because Ledger automatically gives every holding in a taxable account an opening lot, in practice **a taxable account that holds anything must now have its holdings removed first** (each removal also removes that holding's lots). Accounts without lots (Ledger only tracks lots for accounts whose tax type is "taxable"; IRA, 401(k), HSA and 529 accounts have none) delete exactly as before. In the browser check, the demo accounts were set up with lots entered directly in the database so the blocked path could be shown; I did not exercise the automatic opening-lot creation in the browser. |
| Remaining limitation | NC-19 is only **partially** resolved: the atomicity and the orphan lots are fixed by refusing; the "delete everything in one go" convenience is not offered (see section C). Sales, HSA withdrawals, RSU vests and grants and goals that name the deleted account are still left in place, as before (see findings F-1 and F-4). |

### NC-22, delete a property (`src/pages/NetWorthPage.tsx`)

| | |
|---|---|
| Original | `db.propertyValues.where('propertyId').equals(id).delete()` then `db.properties.delete(id)`, two awaits, no transaction. |
| Dependencies found | `propertyValues.propertyId`. A property names loans (`loanIds`, property to loan, not the reverse). A Home & Assets record may point at it with `ledgerPropertyId`; that screen already reads a missing property and says "(net worth entry removed)" (`src/modules/assets/NetWorthEntry.tsx`), so it is safe and is not touched. Net-worth snapshots do not point at properties. |
| New behavior | `deletePropertyWithValues(db, propertyId)`: ONE transaction over `properties` and `propertyValues`; re-reads the property inside (refuse if gone); deletes its values, then the property. |
| Tables | `properties`, `propertyValues`. |
| Semantics changed? | No. Valuation model, equity, net worth and every calculation are untouched. New: a stale press shows a message. |
| Remaining limitation | None known for the property. |

Transaction rules followed (section 3 of the instruction): everything related is in one `d.transaction('rw', ...)` listing every table touched; no network, timers, React state or user interaction inside (a test checks the helper source for those); confirmation happens before the transaction begins; cancelling only clears a remembered id; targets and dependencies are re-checked inside the transaction; a thrown error rolls the whole thing back and reaches the dialog (the shared runner shows it and keeps the dialog open). No new framework: the three functions sit in the existing `src/lib/confirmedDeletes.ts`, beside the two D20.1B deletes (category and HSA withdrawal) that already followed this pattern.

## C. NC-19 owner decision

| | Option A: delete account, holdings AND their tax lots together | Option B: refuse while tax lots exist (BUILT, provisional) |
|---|---|---|
| What happens | One transaction deletes the account, its holdings and all their lots. | Refused before any write if any lot exists. You remove the holdings first (each removal deletes that holding's lots), then delete the account. |
| Consistency with Ledger today | Matches how a holding already owns its lots (NC-18 deletes them together) and what the dialog already says (deletes the account and its holdings). | Uses only deletions you have already authorized (NC-18). Adds no new destructive power. |
| Historical records | Loses lot-level cost basis and purchase dates for everything in the account in one click. Recorded sales keep their own lot snapshot, but the lots themselves are gone. | Same loss, but one holding at a time with a dialog each, so it is hard to do by accident. |
| Reference integrity | No orphan lots. | No orphan lots. |
| Convenience | One step. | Two or more steps for a taxable account. |
| Risk | A larger, one-click loss of tax history; needs a dialog that states the lot count and total cost basis; best done after finding F-1 is understood. | A slightly annoying path; the message explains it. |
| Status | **NOT built. Needs your separate approval.** | **Built, as the fail-closed policy for this phase. NOT accepted as the final policy.** |

Recommendation: **end state A, interim state B.** A is the most consistent with how Ledger already treats a holding and its lots, but it deletes more with one click, so it should come with its own dialog that names the number of lots and the total cost basis, and it should wait until finding F-1 (below) is decided. Until you choose, B is in place and is the safe default. Do not treat the NC-19 policy as accepted.

Exact behavior of B: the dialog opens as before; if the account has lots it shows "This account still has tax lots, so it cannot be deleted yet...". Pressing "Delete account" changes nothing and shows the full reason (for example: "Demo Brokerage still has 3 tax lots in 2 holdings. Ledger does not delete tax lots along with an account, so nothing was deleted. Remove the holdings first ..."). Cancel changes nothing. If a lot appears after the dialog opened (another device), the check inside the transaction still catches it.

## D. Failure-injection results

New test file: `src/lib/rs1aAtomicDeletes.test.ts`, **36 tests, all pass.** Fake IndexedDB, invented data only. A failure is injected with a Dexie `deleting` hook that throws on the Nth delete of a table, which aborts the transaction. Every comparison is of the **full contents of every table before and after** (row by row, with ids), not counts.

| Scenario | NC-18 | NC-19 | NC-22 |
|---|---|---|---|
| Normal success, only authorized rows removed, every other table identical | pass | pass (IRA, no lots) | pass |
| Nothing to delete underneath (no lots / no values) | pass | pass | pass |
| Failure before the first write | pass, identical | pass, identical | pass, identical |
| Failure after one child is already deleted | pass, identical | pass, identical (second holding) | pass, identical |
| Failure during the final (parent) delete | pass, identical | pass, identical | pass, identical |
| Failure while reading, before any write | pass, identical | covered by the above | covered by the above |
| Multiple child records | 2 lots | 2 holdings; 3 lots across 2 holdings | 3 values |
| Unrelated records survive (other holding, account, property, sales, HSA, goals, loans, net-worth points) | pass | pass | pass |
| Missing or already-deleted target: refused, nothing written | pass | pass | pass |
| Stale target (holding now in another account) | pass (refused) | n/a | n/a |
| Dependency conflict | n/a | pass: lots present is refused, tables identical; a lot added after the dialog opened is caught inside the transaction; a lot with no holding in the account is also refused | n/a |
| Repeated or concurrent press | one succeeds, one refused, neighbours untouched | same | same |
| Reading what blocks an account writes nothing (opening or cancelling a dialog) | n/a | pass (a counter on every table's create, update and delete hooks stays at 0) | n/a |
| Pre-existing orphans are not "repaired" | n/a | n/a | pass (an orphan value row for another property id is left alone) |

**Control tests** prove the injection is real: with the OLD two-step code, the same injected failure leaves a holding with no lots, a property with no values, and (with no injection at all) the old account delete leaves 3 orphan lots. These pass, so the safe-path tests above are not passing by accident.

Also tested: with sync change tracking installed, a transactional delete still tells sync something changed (deletions are found by sync by comparing id lists, so no schema or sync format change). Source-level checks (the app has no browser DOM in tests, same as D20.1B): the screens call the three functions, the old separate awaits are gone, `onCancel` only clears the remembered id, a refusal is returned as a message so the dialog stays open, and the helper code contains no timers, network calls or React state.

**What was NOT tested by automation:** a real browser tab closing in the middle of a transaction (IndexedDB guarantees rollback for that, but I could not trigger it).

**Browser verification (Chromium in the app's browser pane; invented demo household; a throwaway server on port 5231 and a throwaway browser database that was deleted afterwards; the real dataset and the normal dev port 5173 were not touched):**

- Blocked account (2 holdings, 3 lots): the dialog showed the short warning; pressing the button showed the full reason and stayed open; counts of accounts, holdings and lots were unchanged; Cancel closed it with no change.
- Removing a holding: Cancel changed nothing; confirming removed that holding and exactly its one lot (holdings 6 to 5, lots 4 to 3); the other brokerage's lots were intact.
- A holding removed behind the dialog (simulated by deleting its rows directly in the database while the dialog was open): the dialog closed itself (this is the existing "row not found" behavior), no error.
- Account with no lots (an emptied brokerage, then an IRA with 2 holdings): Cancel changed nothing; confirming deleted the account and its holdings only (accounts 3 to 2, holdings 4 to 2).
- Property: Cancel changed nothing; confirming removed the property and its 3 values (properties 2 to 1, values 5 to 2); the other property's values were intact.
- Phone width 375 px: the blocked-account dialog (warning, red reason, buttons) fits with no horizontal scroll; the property dialog fits.
- Console: no errors from this work. One unrelated error exists (finding F-2).
- **Not browser-tested:** any error-injection scenario (those are automated database tests only), desktop-versus-phone behavior beyond the two dialogs above, a real phone, a screen reader, Safari, Firefox, a second device.

## E. Regression and build results

- `npx vitest run`: **293 files, 5,793 tests pass** (36 new in 1 new file; I did not run the suite before my change, so the 5,755 existing tests are inferred as 5,793 minus 36 and are consistent with the 5,754 in the R1.1 report plus its post-review polish; I did not separately confirm that +1).
- `npx tsc --noEmit`: clean (exit 0).
- `npm run build`: clean (entry JavaScript 906.11 kB raw / 281.48 kB gzipped; the R1.1 figure was 905.97 / 281.43; the 0.14 kB difference is the new helper code).
- Golden masters: the full suite, which includes the financial golden-master tests (for example `b5-golden-master.test.ts` and `semimonthly.shared.test.ts`), passes with no test file changed. I did not separately recount the "157" figure from earlier reports.
- No existing test was edited, removed, skipped or weakened (the only test file in the diff is the new one).
- Scope check (complete `git diff`): 3 source files modified, 1 test file added, nothing under `src/db.ts` (no schema or migration change), `src/lib/backup*`, `src/lib/sync/` (no backup or sync format change), `package.json` (no dependency change), `src/ui` or any stylesheet (no design change), `src/data` (no tax table change; the Massachusetts surtax is untouched). The three native-`alert()` calls and NC-30 were not touched.

## F. Files changed and release readiness

| File | Change |
|---|---|
| `src/lib/confirmedDeletes.ts` | MODIFIED: three transactional functions (`deleteHoldingWithLots`, `deleteInvestmentAccount`, `deletePropertyWithValues`), a read-only reader (`readInvAccountContents`) and the message function (`invAccountBlockMessage`). The two older D20.1B functions are unchanged. |
| `src/pages/InvestmentsPage.tsx` | MODIFIED: the holding and account dialogs call the new functions; a refusal is returned to the dialog; a short warning shows when lots exist. |
| `src/pages/NetWorthPage.tsx` | MODIFIED: the property dialog calls the new function. |
| `src/lib/rs1aAtomicDeletes.test.ts` | NEW: 36 tests. |
| `docs/LEDGER-RS-1A-REPORT.md` | NEW: this report. |
| `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md` | MODIFIED: RS-1A recorded (new top notice and status, risks, change log). Historical entries kept. |

**Release readiness: APPROVED FOR RELEASE.** The code is built and tested and can be released as is (NC-18 and NC-22 fully; NC-19 as fail-closed). It is **not** complete for NC-19 in the sense of "an account with lots can be deleted"; that waits for your decision on Option A. Nothing was committed, pushed or deployed.

### Judgment calls (please review)

1. **NC-19 is fail-closed (Option B)**, which means that in practice a taxable account with holdings must have each holding removed first. This is more restrictive than before and was chosen because the instruction says not to widen deletion scope without approval.
2. **A lot that names the account but belongs to none of its holdings also blocks deletion**, with its own wording ("not attached to any holding"). It is not expected to exist; if it does, Ledger cannot tell what it is, so it refuses. It cannot be cleaned up from the screens today (see F-6).
3. **The delete-holding function takes the account the owner was looking at** and refuses if the holding is now in a different one.
4. **The "Delete account" button stays enabled** when lots exist, and answers with the full reason. The shared confirmation dialog has no "disabled" option and I did not change that shared component.
5. **The new functions went into the existing `confirmedDeletes.ts`** rather than a new file, to follow the established pattern.
6. **Recorded sales, HSA withdrawals, RSU vests and grants and goals that name a deleted investment account are left as they are** (as before); I did not add them to the blocking list because that would widen scope. They are findings below.

### Findings outside RS-1A (documented, not fixed)

- **F-1 (RESOLVED by the final correction above: account deletion is now refused while recorded sales name it; original finding follows):** recorded sales survive an investment account's deletion. The Realized gains list shows them with "?" as the account and an **Undo** button. `undoSale` (`src/lib/lots.ts:260`) would then add a holding, and for taxable sales new lots, under the deleted account's id: new orphans. Deleting an account with recorded sales therefore still carries a risk. Options for a later phase: block account deletion while sales name it, or make Undo refuse when the account is gone. Needs your decision.
- **F-2 (reproduced; cause not found):** on a completely empty database in the dev server, opening the Investments page logs "assetClasses.bulkAdd(): 7 of 10 operations failed, Key already exists" twice (an uncaught promise). The asset classes do end up complete (10). The code involved (`seedAssetClassesIfEmpty` in `src/db.ts`) was not touched by RS-1A. Not checked in the production build.
- **F-3:** by reading `AccountBlock` in `src/pages/InvestmentsPage.tsx`, every holding in an account whose tax type is "taxable" is automatically given an opening tax lot when the account is shown, so "taxable account with holdings" always means "has lots" (this is why B blocks it in practice). Read from code; not exercised in the browser.
- **F-4:** HSA withdrawals, RSU vests and grants and goals that name a deleted investment account remain. I read that the Goals screen copes with a missing account; I did not verify every reader of the others.
- **F-5:** a Home & Assets record that points at a deleted property shows "(net worth entry removed)" (checked in code), as before.
- **F-6:** existing orphan lots or values already in the real household data (from earlier account deletions, which always left lots behind) were not looked for, because I did not touch the real data, and Ledger has no screen that lists them. They are not repaired or purged by RS-1A. A read-only "find orphans" report would be a separate, small phase if you want it.

### Not built

The Massachusetts surtax correction, replacing the remaining native `alert()` calls, NC-30 sequencing, any lot cascade (Option A), blocking account deletion because of sales, HSA, RSU or goals, an orphan finder, notifications, schema or backup or sync changes, new dependencies, any design change.

### Handoff and backlog

`docs/CHATGPT-HANDOFF.md` updated (top notice, current-phase bullet, risks, change log) and `docs/BACKLOG.md` updated (new newest status). They distinguish: fully corrected (NC-18, NC-22), provisional fail-closed (NC-19), awaiting owner decision (Option A, F-1), remaining RS-1 work (MA surtax, three `alert()` calls, NC-30, two intermittent tests, doc drift), and implemented but unreleased (all of RS-1A).
