# Projects P2 (commitments and financial integration): implementation report

Date: 2026-11-05. Built on top of P1 (`docs/PROJECTS-P1-REPORT-2026-11-05.md`) and Phase 0 (`docs/PHASE0-PLAN-2026-11-05.md`, `docs/PHASE0-VERIFICATION-2026-11-05.md`). Contains no personal or financial data; all test and browser data was invented.

## Status
| | |
|---|---|
| Work package | P2 of four planned Projects work packages. P3 not started. |
| Commits | `9928eb9` (P2 as first built and reviewed) and `ba2021e` (two follow-ups from the owner's review, section 12), on top of `4cca91e`. |
| Pushed / deployed | **No.** Both commits are local only. |
| Tests | 85 files, **1,206 tests, all pass** (before P2: 82 files, 1,138 tests. P2 as first built: 1,194. The follow-ups added 12 more; three older tests were loosened, see section 6) |
| TypeScript | `tsc --noEmit` clean |
| Production build | Succeeds |
| Schema / backup / sync format | **No change.** `src/db.ts`, `src/lib/backup.ts`, `src/lib/backupFile.ts` and `src/lib/sync/*` untouched. Schema version still 15. |

## Discrepancies found between the earlier documents and the actual code (before building)
1. **Editing a transaction could silently drop split tags.** The edit form rebuilt the splits from scratch, so a split that was tagged to a project lost its tag on any save. Fixed (the form now carries each split's tag).
2. **Editing did not run the project checks.** `updateTxn` writes whatever it is given, so changing a tagged payment into money coming back could leave a tag Finance would have refused. Fixed with one new entry point, `editTxn` (section 3).
3. **Removing a budget line only looked at transactions.** A line that commitments were filed under could be removed, leaving them pointing at nothing. Fixed: it is now refused with a plain message.
4. **A small inconsistency, left alone:** in the Finance summary a commitment's agreed amount is filed under its own budget line (or its agreement's), but its left-to-pay is filed under the agreement's line only. The screens never create a change order with its own line, so the figures agree today. Noted for later.

Everything else in the documents matched the code, including the reversal/credit rules.

## 1. Features implemented

**Commitments (project page).** Quotes, accepted agreements and change orders in one section: *Accepted*, *Quotes waiting*, and a collapsed *Declined and cancelled*. Create and edit; accept or decline a quote; cancel an agreement; reinstate a cancelled one or put a declined one back to a quote; add positive or negative change orders. Each agreement shows Original, Accepted changes, Agreed now, Paid so far and Left to pay, its change orders (each with its own Accept, Decline, Cancel, Edit, Remove), and the transactions paid on it. One optional vendor and one optional budget line per agreement.

**Vendor and the project directory.** Choosing a vendor on a commitment (an existing contact, or "New vendor…" which reuses a contact with the same name) puts that contact on the project's vendor list too, once, and says so in the confirmation. No second copy of the contact is ever made. Taking a vendor off a project now warns if commitments still name them (they keep them).

**Project money dashboard.** Headline figures from Finance: Project budget, Planned in lines, Agreed (accepted), Paid so far, Left to pay, Expected total cost, Left in budget (or Over budget by), Not planned in lines (when relevant), Quotes waiting (never counted). *Needs attention* lists problems in plain words. *Budget by line* shows planned, agreed, paid, left to pay, expected and remaining per line, plus a "No budget line" row; it turns into labelled cards on a phone. *Transactions on this project* lists the tagged transactions. Clicking Agreed or Quotes scrolls to the commitments, Paid scrolls to the transactions, and clicking a line name shows only that line's commitments and transactions (click again, or "Show all lines", to reset).

**Warnings (all from Finance's own flags):** expected total over budget; budget lines add up to more than the budget; a line on track to cost more than planned; spending not filed under any line; paid more than agreed; money paid on a cancelled, declined or quote-only commitment; credit received but agreed amount not lowered; reversals/credits larger than what was paid; money coming back on a contract without a reversal/credit choice (old data); payments dated outside the project's dates; tags pointing at a line or commitment that no longer exists.

**Transaction forms.** A *Project* box on the Add and Edit transaction form (opened from the Transactions page, an account, or "More options" in the quick Add box). Choices are hierarchical: Project, then only that project's budget lines and accepted contracts. Picking a contract that has a budget line uses that line by default ("Same as the contract") and does not store it twice; another line can be chosen (updated in section 12; the first build greyed the line out). Transfers and setup entries get no box. Removing or changing the tag works from the same box.
- **Money coming back on a project that has accepted contracts** asks: "Is this money about a contract?" with *No, a general refund or reimbursement for the project* or *Yes, money back on a contract*. Saving without answering is refused.
- **Money coming back on a contract** must be a **Reversal** (a payment undone: paid goes down, contract owed again) or a **Credit** (price came down: paid goes down and the agreed amount should too). The choice is explained in words on the form. Saving a credit shows a reminder to lower the agreed amount.
- **Credit reconciliation.** A credit that is not matched by a negative change order shows under *Needs attention* and on the contract, with a button "Add a change order of −$X". It opens the change-order form pre-filled (title, amount, status Accepted) and **saves nothing until you press Add**. The totals before and after are visible. Verified end to end in the browser.
- **Split transactions.** Each split row has its own Project, Contract and Budget line choice (Contract added in section 12), and the transaction-level box is labelled "Project for splits without their own". A split's own tag wins, as in Phase 0. Switching back to a single category asks first if any split has a tag.
- **Bulk.** On the Transactions page, selected transactions get a *Project* row: project, optional contract or budget line, *Apply project*, *Remove project*. Afterwards a panel says how many were updated and how many were left alone, grouped by reason with the transactions listed. Never changed silently: transfers/setup entries; split transactions (tag a split by editing the transaction); transactions already on a different project or line (unless "Replace tags that are already there" is ticked); money coming back on a contract (needs reversal/credit, so it must be opened); money coming back on a project with contracts when it is unclear whether it belongs to one (unless "general refund for the project" is ticked); money coming back that is more than was paid.

## 2. Files

**Created**
- `src/modules/projects/commitmentModel.ts` (commitment records, defensive reader, plain-words checks, status-change check, credit change-order draft)
- `src/modules/projects/financialView.ts` (contracts grouped by state, warnings, broken-tag count; no money is worked out here)
- `src/modules/projects/Commitments.tsx`, `CommitmentForm.tsx`, `Financials.tsx` (screens)
- `src/lib/txnProjectTag.ts` (the Project box's rules: state to reference, contract implies line, refund questions, descriptions)
- `src/pages/ProjectTag.tsx`, `src/pages/BulkProject.tsx` (the box and the bulk row)
- `src/modules/projects/commitments.test.ts`, `src/modules/projects/txnTagging.test.ts`

**Modified**
- `src/lib/txnProject.ts` (per-contract figures, line `expectedCents`, `checkTxnProjects`, `loadProjectChoices`, `loadProjectPieces`, `onlyThisProject`, safer `bulkSetTxnProject`)
- `src/lib/txnCreate.ts` (`createTxn` uses the shared check; new `editTxn`)
- `src/lib/txnProject.test.ts` (three bulk expectations loosened, see section 6)
- `src/pages/TxnForm.tsx`, `src/pages/TransactionsPage.tsx`, `src/styles.css`
- `src/modules/projects/ProjectPage.tsx`, `data.ts`, `model.ts` (exports four small helpers), `Vendors.tsx`, `projects.css`
- `docs/BACKLOG.md`

Two logic files are named `commitmentModel.ts` and `financialView.ts` because Windows treats `commitments.ts` and `Commitments.tsx` as the same name.

## 3. Data model and calculation changes

**Commitment records** use the existing `moduleRecords` table: module `projects`, kind `commitment`, one record per commitment or change order. Fields: `projectId`, `budgetLineId`, `vendorContactId`, `title`, `status` (quoted, accepted, declined, cancelled), `amountCents`, `parentId`, `acceptedDate`, `notes`. Finance already read the first six by exactly these names. Readers are defensive and carry unknown fields through; every save keeps them (tested). Removal is a soft delete (a marker record, so it syncs). A commitment cannot be removed while money is tagged to it or it has change orders; cancel it instead, which keeps it and the payments visible.

**Rules enforced on save (plain-words messages):** title required; amount valid; an agreement or quote must be above zero; a change order must be non-zero and may be negative; the change order's agreement must exist, be in the same project and be an original agreement (no change orders of change orders, which also rules out loops); an agreement that has change orders cannot become one; a change cannot be accepted before its agreement is accepted, or if it would take the agreed amount below zero; the budget line must belong to the project; the vendor must be a live contact.

**Finance layer (`src/lib/txnProject.ts`), with tests:**
- The summary now also returns one row per original contract (original, accepted changes, agreed now, paid net, left, overpaid, credits received, credit gap), and each line row gets `expectedCents`. Totals and flags are unchanged.
- `checkTxnProjects` is the single check for a new or edited transaction and every split. `createTxn` uses it, and `editTxn` (new) uses it when an edit touches the amount, splits or tag. An edit that touches none of those (a memo, a date) is never held up by an old tag.
- `loadProjectChoices` gives forms the projects with their own lines and contracts. `loadProjectPieces` lists a project's tagged transactions for the page.
- `bulkSetTxnProject` gained the skip reasons and two options described above. Its old result fields are kept.

## 4. Tests added (56 new in the first build; 12 more in section 12)

**`src/modules/projects/commitments.test.ts` (33):** quote creation and acceptance (not counted until accepted, date stamped); declined and cancelled; a cancelled agreement with money already paid (payment stays, flagged, warning text); reinstating; positive and negative change orders and the effective amount without counting the parent twice; a payment tagged to a change order counts on the agreement; history preserved; every refusal (missing parent, other project, change of a change, zero, below zero, agreement not above zero); self-reference and loops; accepting before the agreement; changes stop counting when the agreement is cancelled; line and vendor validation; vendor added to the project once with no second contact copy; line removal blocked by commitments; line breakdown including a change order following its agreement; soft removal and the refusals; unknown fields and bad stored values; orphaned change orders never hidden; the $10,000 / $3,000 / $1,000 reversal example; reversal larger than payments refused; vendor credit, the warning, the pre-filled draft saving nothing, and the negative change order reconciling it; overpayment; a payment deleted after a reversal (warning, not a crash); project-level refunds; whole-project figures and the line rows adding up to them; budget overruns; lines above budget; broken tags; split transactions (one split tagged, line on a split, transaction untouched); transfers refused; tagging changes no amount, balance or report; editing or deleting a tagged transaction changes the figures at once; export, restore and sync snapshot carry commitments, change orders and unknown fields; two devices editing different commitments both survive.

**`src/modules/projects/txnTagging.test.ts` (23):** what the Project box offers (own lines and contracts only, no change orders, accepted plus the one already chosen, archived marked); contract implies line; every state-to-reference case; the contract/refund questions and their refusals; reversal or credit required, and never attached to a payment; split rows; round trips and descriptions; creating tagged; changing and removing a tag; editing the amount into money-coming-back refused until classified, and a reversal not counting against itself; edits untouched by a stale tag; split references checked and kept on edit; transfers; bulk (mixed selection with every reason, replace only on request, ambiguous refunds, general-refund option, contract refunds needing a choice, exceeding payments, no-contract projects, clearing).

**Not covered by automated tests:** the screens themselves. The project has no component-testing library and I did not add one, so the screens were checked in a real browser instead (section 5) and the rules behind them are tested as pure functions.

## 5. Browser verification (invented data, deleted afterwards)

Done at desktop width: the project page with a $10,000 agreement, a +$1,200 change order and a quote; headline figures and line breakdown matched the hand calculation; the Edit transaction form showing the Project box, the hierarchical Contract and Budget line choices, the greyed line "comes from the contract", the "Is this money about a contract?" question, the refusal when saving without answering, the Reversal/Credit explanation; saving a $45 credit; the project page then showing the "Needs attention" credit warning and the changed totals; the pre-filled change-order form; pressing Add and the warning disappearing with the totals reconciled; bulk selection with Project, the result panel ("1 updated, 2 left alone" with the two transactions and the reason); the split view with a Project choice per split. At 375 px: the project page (stat cards, the line breakdown as labelled cards, commitments and change orders, quote actions), and the Edit transaction form with the contract and credit controls. No sideways scroll at 375 px (page width equals the window), no console errors.

**Not verified by me in a browser:** the credit reminder message after saving (the save worked, I did not catch the message); the line-name filter on the dashboard; offline use; real two-device sync. The owner ran a manual checklist afterwards and reported these passing: commitments including accept, decline and edit, tagging one transaction and removing the tag, money coming back (reversal, credit, the pre-filled change order, refusals), bulk tagging, and the quick Add "More options" route. The owner's phone-width check (375 px) is to be done after the push. Saving a tagged split through the form was checked by me during the follow-up (section 12).

## 6. Deviations from the specification
1. **Contracts only, not change orders, on a transaction.** The Contract choice lists original agreements. A payment for a change order is tagged to its agreement, which is how the money reconciles (the Finance rule from Phase 0).
2. **Only accepted agreements are offered** for new tags (an agreement that is already chosen stays visible, even if it was later cancelled). Paying a quote is not offered.
3. **Bulk cannot set reversal or credit** and **skips split transactions**, reporting why; both need a person to look at them.
4. **Splits took a project and a budget line but no contract** in the first build, per the spec's wording. **Changed after the owner's review: splits can now name a contract and a line (section 12).**
5. **The vendor is added to the project directory automatically** when picked on a commitment (and the confirmation says so), rather than asking. No duplicate contact is possible.
6. **The quick Add box has no Project box.** "More options (split, transfer, memo)" opens the full form, which has it.
7. **Three Phase 0 bulk tests were loosened** from an exact match to "contains these fields" because the bulk result gained new fields (`skipped` and counts). Their meaning is unchanged.
8. **Change orders have no budget line of their own in the screens**; they follow their agreement's line.

## 7. Known limitations and unresolved risks
- **Credit before change order.** Until the matching negative change order is added, the contract looks owed again by the credit amount. This is deliberate (it is the warning), but the Expected total and Left to pay are overstated until it is added.
- **Two devices accepting or editing the same commitment at once:** the later edit wins (whole-record last writer), as with every other record.
- **A commitment's vendor list entry** on the project record can lose one edit if two devices add different vendors at the same instant (P1 decision 3).
- **Orphaned change orders** (agreement removed on another device) are shown as agreements of their own so they are not hidden, but they cannot be re-attached from the screen.
- Payments are shown in the project transactions list but there is no link from a row to the transaction itself in Finance.
- The edit form is long on a phone when a split has several project choices; usable but busy.
- Item 4 under "Discrepancies" (line attribution of left-to-pay for a change order with its own line).

## 8. Existing modules
All 1,138 earlier tests still pass (three loosened as explained). No Calendar or Tasks file was touched. Finance changes are limited to the project layer, the transaction form and the Transactions page's bulk bar. A test confirms tagging and committing change no transaction amount, balance or spending report. In the browser the Transactions page, Edit form and bulk bar still worked for untagged transactions.

## 9. Schema, backup and sync
No Dexie schema change, no migration, no backup-format change. Commitments are `moduleRecords` rows, covered by the existing backup lists and sync (tested: export and restore, the sync snapshot, and two devices editing different commitments). Transaction tags live in the existing `project` field on transactions and splits.

## 10. Recommended P3
1. **Project tasks, milestones and Calendar dates:** link existing Tasks and Calendar events to a project; milestones as dated items; project dates on the Calendar and a Projects card on Today.
2. **A "paid" link from each project transaction row to the Transactions page** (filter by project), and a Projects filter in Transactions and Reports.
3. **Small P2 follow-ups:** a Project box in the quick Add box; vendor notes; re-attaching an orphaned change order; a project tag on scheduled (recurring) transactions.
4. Leave documents/receipts, AI and the household modules for later, as the specification says.

## 11. Commit and deployment status
Committed locally as `9928eb9` and `ba2021e` after the owner's review and an explicit "commit". **Nothing is pushed or deployed.** Pushing publishes the app (every push to `main` runs the tests and deploys GitHub Pages), so it needs the owner's separate yes, after which the Actions tab should show a green run.

## 12. Follow-ups from the owner's review (commit `ba2021e`)
The owner ran a manual checklist and asked for two changes. Both are built.

**1. Split a payment by contract AND budget line.** Example: one payment to a general contractor who coordinates the subs, with part counting as tile, part plumbing, part electrical, all against the one contract. Each split piece (and the whole-transaction Project box) now picks a project, then optionally a contract, then optionally a budget line. Every piece counts against the contract's "Left to pay"; each line gets its own piece.
- The Finance layer already read "the piece's own line, else the contract's line" (`p.budgetLineId ?? lineOf(contract)`), so nothing changed in the stored shape: no schema, backup or sync change.
- Changed: `buildRef` in `src/lib/txnProjectTag.ts` (a contract's own line is still not stored twice, but a different chosen line is now kept; `describeRef` names the line); `src/pages/ProjectTag.tsx` (contract choice also on split rows; the line choice is always open, first option "Same as the contract (X)", with a one-line explanation); `src/modules/projects/Financials.tsx` (the transaction list shows "contract · line").
- Tests (7 new in `txnTagging.test.ts`, one existing test updated): 5,000 / 3,000 / 2,000 pieces all against one contract (paid, left, per-line figures); a part payment leaving the rest to pay; a contract filed under a line, with some pieces on other lines; overpayment across pieces still flagged; pieces on two different contracts; a contract from another project refused; money back on a piece must be a reversal or credit; stored pieces read back into the form unchanged.
- Browser (desktop and 375 px, invented data, removed afterwards): a three-piece split to one contract with three lines saved through the form, reopened with every tag intact, and the project page showed the contract paid for the whole amount and each line's share; no sideways scroll at 375 px; "Same as the contract (GC Tile)" appears first when the contract has a home line.
- Judgment calls: (a) a contract still has ONE home line (or none): payments can go elsewhere but its Agreed and Left to pay stay on its own line, so for a general contractor leave the contract with no line, which puts its agreed amount in the "No budget line" row and triggers the "not filed under any budget line" warning; splitting the agreed amount itself across lines is NOT built. (b) The same rule applies to the whole-transaction box. (c) Money coming back on a split piece with a contract must still be marked reversal or credit. (d) Bulk tagging is unchanged (still cannot split or set a line on a contract).

**2. N key opens the Add box.** `GlobalFrame.tsx` (`wantsAddShortcut`): works for n or N when not typing, with no Ctrl, Cmd or Alt, not held down, and no dialog open. Tooltip "Add (N)" on the Add button, listed in More > Shortcuts and the README. 5 tests in `src/shell/addShortcut.test.ts`. Browser: N opened the Add box and typed nothing into it; Ctrl+N did nothing.

Files touched by the follow-ups: `src/lib/txnProjectTag.ts`, `src/pages/ProjectTag.tsx`, `src/modules/projects/Financials.tsx`, `src/modules/projects/txnTagging.test.ts`, `src/shell/GlobalFrame.tsx`, `src/shell/QuickAdd.tsx`, `src/pages/MorePage.tsx`, `src/shell/addShortcut.test.ts` (new), `README.md`, `docs/BACKLOG.md`.
