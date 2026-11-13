# Ledger Signature D20.1: OD-6 inventory of every browser-native confirmation

Date: 2026-11-13. Source baseline: `ff39a9a` (the D20 core release; Actions run #111 and the `github-pages` deployment succeeded for it).
**OD-6: Owner approved option (a), replacement of all 38 native confirmations, in controlled batches with high-risk workflows last.**
This file is the living inventory for D20.1A to D20.1D. A test (`src/shell/d201aConfirmations.test.tsx`) reads it and checks it against the source, so it cannot drift silently.

## 1. The count, honestly

| Measure | Value at `ff39a9a` | Value now (after D20.1A) | Where it comes from |
|---|---:|---:|---|
| **Historical tracker metric** (`measure()` in `src/shell/uiBaseline.ts`: `confirm(` followed by a quote) | 37 in 24 files | 32 in 20 files | Unchanged rule. Baseline stays 37 / 24 (the D4 baseline); the residue report prints "down". |
| **Actual browser-native `confirm()` calls** (this inventory) | **38** | **33** | Recounted by hand and by a broader pattern (any `confirm(` that is not a member call and not a local `function confirm`). |
| Difference | 1 | 1 | `confirm(msg)` in `TasksPage.tsx` passes a variable, so the tracker's pattern (a quote right after the bracket) cannot see it. NC-06 below. |

Not counted, on purpose: five **local functions named `confirm`** (`LifecycleDialog.tsx`, `PaymentUI.tsx` and `ScheduledUI.tsx` x3, `RemoveContact.tsx`) are ordinary handlers behind Ledger's own buttons, not browser boxes; they are listed in section 5 so nobody converts them by mistake. Native `alert()` calls (`CategoriesPage.tsx:87`, `bills/quickAddDef.ts`, `services/quickAddDef.ts`) are outside OD-6 and were not touched.

The tracker rule was **not** changed (changing a measurement definition to flatter the result is not allowed). The accurate count lives here and in the new test; the historical metric stays comparable with D4 to D20.

## 2. How to read the tables

IDs `NC-01` to `NC-38` are stable (sorted by file, then line at `ff39a9a`; the line is where the call was **before** D20.1A). Risk: Low (one leaf record, one write), Medium (one record with side effects, or several records through an existing helper), High (cascade, money, several tables, or a decision inside a computation). **Batch** is the proposed release group: A (done in this batch), B (moderate), C (financial and multi-record), D (complex interaction or save order). Status: `Migrated (D20.1A)` or `Native, not started`.

## 3. Identification, risk, batch and status

| ID | Source (line at `ff39a9a`) | Action | Native message (abridged) | Risk | Batch | Status |
|---|---|---|---|---|---|---|
| NC-01 | `modules/projects/BudgetLines.tsx:72` | Remove a budget line | Remove the budget line "{name}"? | Medium | B | Native, not started |
| NC-02 | `modules/projects/Commitments.tsx:44` | Remove a commitment | Remove "{title}"? If anything is paid on it, cancel it instead. | Medium | B | Native, not started |
| NC-03 | `modules/projects/Commitments.tsx:161` | Cancel an agreement | Cancel "{title}"? It stays on the project and anything paid stays in the totals... | Medium | B | Native, not started |
| NC-04 | `modules/projects/Vendors.tsx:64` | Take a vendor off a project | Take {name} off this project? (adds how many commitments and other projects use them) | Medium | B | Native, not started |
| NC-05 | `modules/tasks/ListsDialog.tsx:20` | Delete a Tasks list | Delete the list "{name}"? Its tasks are kept and will have no list. | Medium | B | Native, not started |
| NC-06 | `modules/tasks/TasksPage.tsx:140` | Bulk move or clear the project on selected tasks | Computed text (`confirm(msg)`): how many tasks move off which project, milestones becoming ordinary tasks | High | D | Native, not started |
| NC-07 | `pages/AppearanceCard.tsx:190` | Delete a saved theme | Delete the theme "{name}"? The colors stay on until you pick something else. | Low | A | **Migrated (D20.1A)** |
| NC-08 | `pages/AppearanceCard.tsx:208` | "Start over from" a palette (replace your colors) | Replace your colors with {palette}? Your saved themes are not affected. | Medium | D | Native, not started |
| NC-09 | `pages/BulkProject.tsx:82` | Remove the project tag from selected transactions | Remove the project tag from {n} selected transaction(s)? Tags on individual splits stay. | Medium | C | Native, not started |
| NC-10 | `pages/CategoriesPage.tsx:75` | Delete a category that transactions use | {n} transaction(s) use this category. They will become uncategorized. Delete anyway? | High | C | Native, not started |
| NC-11 | `pages/FlowViews.tsx:64` | Delete a saved flow view | Delete the view "{name}"? | Low | A | **Migrated (D20.1A)** |
| NC-12 | `pages/GivingPage.tsx:134` | Delete a charitable gift | Delete this gift? | Low | A | **Migrated (D20.1A)** |
| NC-13 | `pages/GoalsPage.tsx:44` | Delete a goal | Delete "{name}"? | Low | A | **Migrated (D20.1A)** |
| NC-14 | `pages/HsaLog.tsx:34` | Delete an HSA withdrawal | Delete this withdrawal? | High | C | Native, not started |
| NC-15 | `pages/ImportPage.tsx:211` | Undo a CSV import | Undo this import? | High | C | Native, not started |
| NC-16 | `pages/IncomePage.tsx:247` | Replace a year's income setup with last year's | Replace {name}'s {year} setup with {year-1}'s? | High | C | Native, not started |
| NC-17 | `pages/IncomePage.tsx:248` | Remove a year's income setup | Remove {name}'s {year} income setup? | High | C | Native, not started |
| NC-18 | `pages/InvestmentsPage.tsx:193` | Remove a holding | Remove {ticker} from {account}? (To record a sale, use sell instead.) | High | C | Native, not started |
| NC-19 | `pages/InvestmentsPage.tsx:214` | Delete an investment account and its holdings | Delete {account} and its {n} holding(s)? | High | C | Native, not started |
| NC-20 | `pages/LoanCard.tsx:206` | Delete a loan | Delete "{name}" and its rate changes and extra payments? (notes the ledger account is kept) | High | C | Native, not started |
| NC-21 | `pages/NetWorthPage.tsx:70` | Delete a property value | Delete this value? | Low | B | Native, not started |
| NC-22 | `pages/NetWorthPage.tsx:77` | Delete a property and its value history | Delete {name} and its value history? | High | C | Native, not started |
| NC-23 | `pages/NetWorthPage.tsx:179` | Add a second net-worth point in the same month (a "continue?" prompt, not a delete) | There is already a point in that month. Add another? | Low | B | Native, not started |
| NC-24 | `pages/NetWorthPage.tsx:200` | Delete a net-worth point | Delete the {date} point? | Low | B | Native, not started |
| NC-25 | `pages/PaycheckPage.tsx:133` | Delete a saved paycheck scenario | Delete "{name}"? | Medium | B | Native, not started |
| NC-26 | `pages/PaycheckPage.tsx:310` | Reset a scenario to a blank setup | Reset this scenario to a blank setup with the same salary? | Medium | B | Native, not started |
| NC-27 | `pages/ProfileEditor.tsx:94` | Turn off the HSA or ESPP deduction (a checkbox) | Turning this off removes the {HSA or ESPP} deduction from {name}'s setup. Continue? | Medium | D | Native, not started |
| NC-28 | `pages/ProtectionPage.tsx:38` | Delete an insurance policy record | Delete this policy? | Low | A | **Migrated (D20.1A)** |
| NC-29 | `pages/RsuGrants.tsx:53` | Replace entered vests with an even split | Replace the {n} vest(s) already entered with an even split of {t} shares? | High | D | Native, not started |
| NC-30 | `pages/RsuGrants.tsx:191` | Save a grant whose new schedule drops vests | This schedule drops {n} vest(s) that no longer fall on a vest date (...). Continue? | High | D | Native, not started |
| NC-31 | `pages/RsuGrants.tsx:320` | Delete an RSU grant and its unrecorded vests | Delete "{name}" and its {n} vest(s)? (notes recorded vests stay as single vests) | High | C | Native, not started |
| NC-32 | `pages/RsuSection.tsx:288` | Delete one RSU vest | Delete this {date} vest? (notes shares already in holdings stay) | Medium | B | Native, not started |
| NC-33 | `pages/TradePanels.tsx:70` | Remove a tax lot | Remove this lot? The holding shrinks by its shares. | High | C | Native, not started |
| NC-34 | `pages/TradePanels.tsx:253` | Undo a logged sale | Undo this sale? The shares go back into their lots. | High | C | Native, not started |
| NC-35 | `pages/TransactionsPage.tsx:123` | Bulk set the category on selected transactions | Set the category to "{label}" on {n} transaction(s)? Split transactions are replaced...; transfers are skipped. | High | C | Native, not started |
| NC-36 | `pages/TransactionsPage.tsx:221` | Delete a saved filter (a select) | Delete saved filter "{name}"? | Low | B | Native, not started |
| NC-37 | `pages/TxnForm.tsx:112` | Move a reconciled transaction to another account | This transaction is reconciled. Moving it to {account} changes the reconciled balance of both accounts... Move it? | High | D | Native, not started |
| NC-38 | `pages/TxnForm.tsx:240` | Switch a split transaction to a single category | Using a single category removes the project tags on the individual splits. Continue? | Medium | D | Native, not started |

**Per batch:** A = 5 (NC-07, 11, 12, 13, 28; all migrated), B = 12 (NC-01 to 05, 21, 23, 24, 25, 26, 32, 36), C = 14 (NC-09, 10, 14 to 20, 22, 31, 33, 34, 35), D = 7 (NC-06, 08, 27, 29, 30, 37, 38). 5 + 12 + 14 + 7 = **38**. Remaining native after D20.1A: **33**.

## 4. Behavior of each call (what the dialog must preserve)

"Before" means: does anything change before the person answers. For every call the answer is **no**: the native box is the first statement that matters, and cancel returns (or does nothing) without a write. "Plan" means a calculation or lookup that happens before or inside the question.

| ID | On approval (existing behavior) | On cancellation | Multiple writes? | Depends on validation or a plan? |
|---|---|---|---|---|
| NC-01 | `removeLine` inside `guard`; refuses (message toast) when commitments or transactions use the line | Nothing | One record, but the helper is one transaction over lines, commitments and transactions (checks only) | Yes: the refusal checks run after the answer |
| NC-02 | `removeCommitment` through `act`; refuses when change orders or tagged transactions exist | Nothing | One soft-delete in one transaction (checks first) | Yes: refusal checks run after the answer |
| NC-03 | `setCommitmentStatus(c, 'cancelled')`; refuses on a bad status change | Nothing | One record write in one transaction | Yes: `checkStatusChange` |
| NC-04 | `removeVendor` (takes the contact off this project only) | Nothing | One project record | Yes: the text needs two lookups (other projects, commitments) made BEFORE the question |
| NC-05 | `deleteList`: clears the list on its tasks, then removes the list; toast says how many tasks kept | Nothing | Yes, many tasks plus the list, in one transaction | No |
| NC-06 | `assignTasksToProject` (undoable); the question appears only when `planTaskProject` finds tasks that would be replaced | Nothing (returns before the write) | Yes, many task records | **Yes: the plan decides whether to ask and what to say** |
| NC-07 | `removeTheme` from the list, write the list, keep the colors on as "My own colors" | Nothing | One settings value (the whole list) plus the local color choice | No |
| NC-08 | Replace the custom colors with a preset (`startCustom`); the select value is set BEFORE the question | The select keeps showing the new name (existing behavior), the colors are NOT replaced | Local color choice (device storage) | No; the select state sits inside the handler |
| NC-09 | `bulkSetTxnProject(..., null)` over the selection; shows a result with skipped rows | Nothing | Yes, many transactions | Yes: the helper decides skipped rows |
| NC-10 | One transaction: uncategorize transactions and splits, then delete the category | Nothing (returns before the transaction) | Yes, categories plus transactions | **Yes: the count query runs before the question and decides whether to ask** |
| NC-11 | Write the saved-view list without it; clear the active selection | Nothing | One settings value | No |
| NC-12 | `db.donations.delete(id)` | Nothing | No | No |
| NC-13 | `db.goals.delete(id)` | Nothing | No (the funding account is not touched) | No |
| NC-14 | One transaction: delete the withdrawal and give its cash back to the account | Nothing | **Yes, two tables in one transaction** (money moves back) | Looks the row up first |
| NC-15 | `undoBatch`: one transaction deleting created transactions, restoring matched ones, deleting the batch | Nothing | **Yes, many records** | No |
| NC-16 | `save(rollForward(prev, year))` replaces that year's profile | Nothing | One profile write | The new profile is computed first |
| NC-17 | `db.incomeProfiles.delete` | Nothing | One record (income data) | No |
| NC-18 | Delete the holding's lots, then the holding (two awaits, NOT one transaction) | Nothing | **Yes, two tables, no transaction** | No |
| NC-19 | Delete the holdings of the account, then the account (two awaits, NOT one transaction) | Nothing | **Yes, two tables, no transaction** | The holding count in the text is computed first |
| NC-20 | One transaction deleting the loan, its rates and its events | Nothing | **Yes, three tables in one transaction** | No |
| NC-21 | `db.propertyValues.delete` | Nothing | No | No |
| NC-22 | Delete the property's values, then the property (two awaits, NOT one transaction) | Nothing | **Yes, two tables, no transaction** | No |
| NC-23 | Add one extra net-worth point (a "continue" prompt; nothing is deleted) | The point is not added | One add | The question only appears when a point already exists |
| NC-24 | `db.netWorthSnapshots.delete` | Nothing | No | No |
| NC-25 | `db.payScenarios.delete` then clears the selection and comparison state | Nothing | One record plus screen state | No (the delete is not awaited before the state changes) |
| NC-26 | Rebuild a blank scenario from the latest salary and patch the profile | Nothing | One record | The salary is read in the handler |
| NC-27 | Turn the benefit off and remove its deductions, in one `set` call | The checkbox stays as it was | One profile write | The handler reads the profile's deductions |
| NC-28 | `useInsurance().remove(id)` writes the policy list without it | Nothing | One settings value | No |
| NC-29 | `fillEvenly`: replaces the entered vests with an even split | Nothing (the entered count is read first) | **Yes, many vests** | **Yes: only asked when vests are entered** |
| NC-30 | Saves the grant (`saveGrant`) which drops the vests that no longer fit | The save is abandoned (returns before `setBusy` and the save) | **Yes, grant plus vests** | **Yes: validation, then a computed list, then the question, then the save** |
| NC-31 | `deleteGrant`: one transaction deleting unrecorded vests, detaching recorded ones, deleting the grant | Nothing | **Yes, several records in one transaction** | The counts in the text are computed first |
| NC-32 | `db.rsuVests.delete` (recorded shares stay in holdings) | Nothing | No | The text depends on the vest's recorded flag |
| NC-33 | `deleteLot`: one transaction deleting the lot and re-syncing the holding's shares | Nothing | **Yes, two tables in one transaction** | No |
| NC-34 | `undoSale`: one transaction restoring lots, holdings and cash, deleting the sale | Nothing | **Yes, up to four tables** | No |
| NC-35 | `bulkSetCategory` then a toast with how many changed, skipped, replaced; clears the selection | Nothing | **Yes, many transactions** | The helper decides skips |
| NC-36 | `deleteSavedFilter` (one settings value) | The select was already reset to blank; nothing changes | One settings value | The select change reads the filter first |
| NC-37 | The transaction is saved and moved (several writes), after validation | `save()` returns; nothing is saved, the form stays open | **Yes: update, move, status reset** | **Yes: validation runs first; the question sits between validation and the save** |
| NC-38 | Switches the form from split to single category (local form state only) | The toggle is not changed | No (form state, nothing stored) | Only asked when splits carry project tags |

## 5. Local functions named `confirm` (NOT browser calls; do not migrate)

`modules/assets/LifecycleDialog.tsx:73`, `modules/bills/PaymentUI.tsx:111`, `modules/bills/ScheduledUI.tsx:104, 166, 200`, `modules/contacts/RemoveContact.tsx:39`. They run after a Ledger dialog's own button; they are already part of a styled dialog.

## 6. Reassignments against the D20 report's earlier table

- `HsaLog` withdrawal delete was listed as Low "single delete". It moves cash back to the account in a second table, so it is **C**, not a leaf delete.
- `RsuGrants:320` (delete a grant) was grouped with the two RSU "needs design" rows. Its question is asked in a plain click handler and the delete is one tested transaction, so it is **C**; the other two RSU rows stay **D**.
- `RsuSection:288` (delete one vest) and the Net Worth leaf deletes are **B**: single records, but linked to income and net-worth figures.
- `BulkProject:82` is **C** (bulk change across transactions), not a "simple bulk with safeguards".
- `ProfileEditor:94` (checkbox) is **D** because the question sits inside a toggle.
- `TransactionsPage:221` (saved filter, inside a select) is **B**: the select is already reset to blank, so cancel needs no revert, which makes it a simple case.
- `InvestmentsPage:193, 214` and `NetWorthPage:77` delete across two tables in two separate awaits (no transaction). That is existing behavior and is **not** changed here; it is called out so the C batch can decide whether a transaction is wanted (a persistence change that needs review).

## 7. Path to zero

D20.1A: 38 to 33. D20.1B: 33 to 21. D20.1C: 21 to 7. D20.1D: 7 to 0. Each batch must update this file (status column), the residue baseline note, `docs/UI-COVERAGE.md` (CF-03) and the handoff, and run an invented-data delete and cancel check for what it converts. D20.1D rows must document the existing and proposed save sequence and get a focused review BEFORE implementation.
