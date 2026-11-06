# Projects P4A (one agreement across several budget lines): implementation report

Date: 2026-11-05. Built on P3 (`50afaa4`, pushed). All figures and browser data are invented. P4B was **not** started.

## Status (stated first)
| | |
|---|---|
| Work package | P4A only. P4B not started. |
| Commit / push / deploy | **None.** Working tree only. Waiting for the owner's approval. |
| P3 gate | P3 is committed (`50afaa4`) and level with `origin/main`. The green deployment run could **not** be checked from here (no GitHub tool); please look at the Actions tab. |
| Tests | 87 files, **1,298 tests pass** (was 1,254; 44 new in `src/modules/projects/p4a.test.ts`). All 1,254 older tests pass **unchanged**. |
| Type check / build | `tsc --noEmit` clean; production build succeeds (the large-chunk warning was already there). |
| Schema / backup / sync | **No change.** Schema still 15; `db.ts`, `backup.ts`, `backupFile.ts`, `sync/*` untouched. |

## 1. Design review and the owner's answers
The design (`PROJECTS-MULTILINE-COMMITMENT-DESIGN.md`) was consistent with the code on: split stored inside the commitment (3.1), exact equality in cents (3.2), change orders with their own lists incl. negative (3.3), project totals never reading the split (3.5), unsplit contracts read as before (3.6), removed lines falling into "No budget line" (3.2).

The owner answered the design's open questions (all with the recommended option):
1. Payments on a split agreement must name a line, with a visible "Not sure yet".
2. A change order on a split agreement opens with a suggested split in the agreement's proportions, which the owner confirms.
3. Existing payments are left alone when an old agreement is split.
4. A split may be edited after payments exist; payments are never rewritten (a line may then show "paid beyond its share").

Gaps in the design that I resolved myself (see judgment calls 1 to 3).

## 2. What was built
- **Data model.** An optional `allocations: [{ budgetLineId | null, amountCents }]` field on a commitment record (inside `moduleRecords`; no table, no migration). An agreement has one list; each change order has its own. `null` line = the explicit "not decided yet" remainder. A commitment without the field behaves exactly as in P2.
- **Reading is forgiving.** A list that is malformed is ignored; a list that does not add up to the amount to the cent is ignored as a whole and flagged ("no longer adds up, open it and fix"). Totals are never affected.
- **Finance (`summariseProject`).** Project totals are computed exactly as before. For a split agreement, each line's *agreed* is the sum of its entries over the agreement and its **accepted** change orders; *paid* is the net of the payment pieces naming that line (reversals and credits lower it); *left* = agreed − paid, **signed** (negative = paid beyond its share). The "No budget line" row is now defined as project totals minus the named lines in every column, so the rows add up to the totals by construction. For data with no split it is identical to before (checked by the unchanged P2 tests).
- **Payments are untouched.** A payment split over three lines is three pieces but one payment toward the contract (contract paid, `paidByCommitment`, project paid all count it once). An accepted change order never creates a transaction or changes a balance.
- **Commitment form.** "Split across budget lines" button (only if the project has lines). Editor: line + amount per part, Add a line, Split evenly (odd cent to the first part), In proportion to planned amounts, Remove the split, and a live "Left to allocate" that must reach $0.00. A new change order on a split agreement opens already split in the agreement's proportions until a part is edited; "Do not split this change" is available.
- **Contract card.** A short "Split across N lines" label; the Original / Accepted changes / Agreed now / Paid so far / Left to pay figures are unchanged; the breakdown table (line, agreed, paid, left, together) is collapsed until opened (open by default only when a payment is unassigned). Change orders show their own lines; payments show "for <line>" or "not assigned to a line". At 375 px the table becomes labelled blocks.
- **Payment form.** Picking a split agreement replaces the Budget line box with "Which line is this for?" (lines + "Not sure yet"); saving without choosing is refused in words. "Not sure yet" stores nothing extra: the payment shows under "No budget line". The agreement's old home line no longer stands in as a default.
- **Warnings (Needs attention).** Split no longer adds up; change order on a split agreement not split; money on a line that no longer exists; payments on a split agreement not assigned to a line.
- **Guards.** A budget line used by a split cannot be removed. Accepting a quote or change order re-checks that no line ends up below zero across the agreement and its accepted change orders.

## 3. Files
**Created:** `src/modules/projects/p4a.test.ts`, `docs/PROJECTS-P4A-REPORT-2026-11-05.md`.
**Modified:** `src/lib/txnProject.ts` (types, reader, per-line calculation, flags, `split` on choices), `src/lib/txnProjectTag.ts` (line rule, `splitContract`), `src/pages/ProjectTag.tsx`, `src/modules/projects/commitmentModel.ts` (field, validation, helpers), `data.ts` (store, validate, removal guard, status check), `CommitmentForm.tsx`, `Commitments.tsx`, `financialView.ts`, `ProjectPage.tsx`, `projects.css`, `docs/BACKLOG.md`.

## 4. Backward compatibility
No stored record changes unless the owner edits it. Records without `allocations` are read through the original code path; `ContractSummary.split` is absent for them; `ProjectChoice.contracts[].split` is omitted unless true. Unknown fields are preserved (tested: save with the split untouched, save with the split removed). A record saved by an older app (amount changed, list kept) falls back to the home line and is flagged; changing the amount back revives the list.

## 5. Automated tests (new, 44)
Design examples 1, 2, 2b, 3a, 3b and the overpaid case to the cent; a payment split over three lines counted once; lineless payment on a split agreement stays unassigned; unsplit, no-payment, partly paid, fully paid, overpaid; declined, cancelled and quoted agreements and change orders; stale and dangling lists; malformed stored lists; a 250-seed property test that rows add up to the totals in every column and the leftover row is empty in the ordinary case, plus a 250-seed "messy data" run (unsplit change orders, lineless payments, overpayment, reversals, credits, removed lines); validation messages; editing after payments with payments unchanged; below-zero guard; cancel and reinstate; removal guard; payment-box rules; spending report and balances unchanged; backup export/restore equality of the project summary; sync snapshot; a real two-device sync run (split made on one device arrives whole on the other while the other device's edit of a different agreement survives).

## 6. Browser verification (done, desktop and 375 px, dark)
Created an agreement with a split; the editor showed "Left to allocate: $15,000.00" in red, saving was refused with a plain message, then "$0.00. The parts add up" in green and it saved as one agreement ("Split across 2 lines", breakdown collapsed, then opened; Together = $30,000.00). At 375 px in dark mode: no horizontal overflow, table stacks into labelled blocks. A new change order of −1,000 opened already split −333.34 / −666.66 in the agreement's 1:2 proportions. No console errors.
**NOT checked in a browser:** the payment form's "Which line is this for?" box; the "Budget by line" table with real payments; the Needs-attention texts; editing an existing split. These are covered by tests only.

## 7. Judgment calls (please review)
1. **A change order with no usable split on a split agreement goes to "No budget line" with a warning** (the design said both that and "home line"; the first is safer).
2. **A payment with no line on a split agreement is unassigned, not put on the home line** (the home line would misplace the money). Effect: it changes what an existing payment shows only once the owner chooses to split that agreement (the owner's answer 3).
3. **One-click "assign my existing payments in proportion" is NOT built.** A proportional assignment would split each existing transaction into several tagged splits, which rewrites the transaction. Instead each unassigned payment is flagged and the owner opens the transaction and picks the line.
4. Opening an old unassigned payment on a split agreement to edit it asks for a line (or "Not sure yet") before saving.
5. The helper that pre-selects the line with the most left to pay (design 3.8 item 4) was not built; "Split evenly" and "In proportion to planned amounts" were.
6. Bulk tagging a split agreement from the Transactions page leaves the line unassigned (it counts as "Not sure yet") and the dashboard flags it.
7. Change orders on an agreement that is **not** split ignore any list they carry, so a contract with no split behaves exactly as before.
8. When a split agreement is paid beyond its total, the leftover shows under "No budget line" (as the design says), and the existing "spending not filed under any line" warning can fire for it.
9. An empty list is refused; "no split" is stored as the field being absent.

## 8. Known limitations and NOT built
Not built: P4B; the total-cost visualization card from the backlog (not part of the P4A prompt); invoices, retainage, per-line approvals. Not verified: two real devices, an older app version on another device, real data. Older app versions will not show the split; update every device before relying on it.

## 9. Git working-tree status
`M` docs/BACKLOG.md, src/lib/txnProject.ts, src/lib/txnProjectTag.ts, src/pages/ProjectTag.tsx, src/modules/projects/{CommitmentForm.tsx, Commitments.tsx, ProjectPage.tsx, commitmentModel.ts, data.ts, financialView.ts, projects.css}; `??` src/modules/projects/p4a.test.ts and this report. Nothing staged. `HEAD` is `50afaa4`. (BACKLOG.md also held a small uncommitted P4-input note from before this work.)

## 10. Commit-readiness
Ready for review. All checks pass and the tree contains only P4A work. Recommend the owner glance at judgment calls 1 to 3 and try the payment form box on a real split agreement before approving a commit. (Superseded by section 11, which records the final verification.)

---

# 11. FINAL VERIFICATION (follow-ups from the review of this report)

Date: 2026-11-05. Invented data only, in the Browser pane's own storage (an isolated 127.0.0.1 origin was refused by the pane, so a separate project was created on localhost; two older invented projects were also in that storage and were not touched). Nothing was committed, pushed or deployed. P4B not started.

## 11.1 Results at a glance
| | |
|---|---|
| Tests | 87 files, **1,300 pass** (was 1,298; two new tests for the "No budget line" explanations). The 1,254 pre-P4A tests still pass unchanged. |
| TypeScript / build | `tsc --noEmit` clean; production build succeeds. |
| P3 deployment | **Succeeded.** GitHub's public API shows the "Deploy to GitHub Pages" run for `50afaa4` (P3) concluded `success`, as did `b96c37b`. The earlier run for `ba2021e` shows `cancelled` (no reason given; a later run superseded it). Read from the API, not from the Actions page. |
| Defects found | **Three presentation defects, all fixed. No calculation defect.** See 11.3. |
| Schema / backup / sync | Unchanged. No stored record changed except by the owner-style actions performed in the browser on invented data. |

## 11.2 What was checked in the browser
**1. Payment assignment (transaction form, desktop)**
- Created a three-line $50,000 agreement. Opened Add transaction, More options, chose the project and the agreement: the Budget line box became "Which line is this for?" with "Choose a line…" and "Not sure yet". Saving without a choice was refused with the plain-words message. Chose Plumbing and saved a $6,000 payment.
- Reopened it with Edit: project, agreement and Plumbing were all still selected. The stored record held exactly the project, agreement and Plumbing line.
- "Not sure yet": saved a $1,500 payment; stored as project plus agreement and **no** line (explicitly unassigned). It appears in the unassigned figures.
- Split transaction: one $9,000 payment in three tagged pieces (Plumbing $5,000, Electrical $3,000, Finishes $1,000) on the same agreement. **Created with the app's own database call, not typed into the form's split rows** (the split-row typing was not exercised). It counts once toward the agreement and each piece appears on its own line.
- Editing it in the form and saving: all three split tags (project, agreement, line) showed correctly and were stored unchanged; the only field that changed in the record was `updatedAt`. Project paid did not change.

**2. Reconciliation** (realistic project: $50,000 agreement over Plumbing $20,000 / Electrical $15,000 / Finishes $15,000; accepted change order of -$5,000 on Finishes; payments $6,000 Plumbing, $4,000 Electrical, $3,000 Finishes, $7,000 Finishes, the $9,000 three-line payment, and $2,000 with no line). Seen on the project page:
- Agreement: original $50,000.00, accepted changes -$5,000.00, agreed $45,000.00, paid $31,000.00, left $14,000.00.
- Lines (agreed / paid / left): Plumbing 20,000 / 11,000 / 9,000; Electrical 15,000 / 7,000 / 8,000; Finishes 10,000 / 11,000 / **-1,000** (shown as "paid beyond its share"); "No budget line" 0 / 2,000 / -2,000. Columns add to the project totals (45,000 / 31,000 / 14,000).
- No double counting: the six transactions add to $31,000 (6+4+3+7+9+2); the three-line payment counted once.
- The change order created no transaction (transaction count and paid total unaffected by it).
- Negative per-line left is shown with words; the unassigned $2,000 is shown (see 11.3 for the wording fix).

**3. Editing allocations after payments exist.** Opened the agreement's editor, set Plumbing to 10,000 only: "Left to allocate: $10,000.00" in red, save refused with a message. Set Finishes to 25,000 and saved. Result: every transaction record was **byte-identical** before and after (compared whole records); Plumbing agreed $10,000 vs paid $11,000 shows "$1,000.00 paid beyond its share"; Finishes agreed $20,000 (25,000 less the -5,000 change); Together $45,000 / $32,500 / $12,500 (the $1,500 unsure payment had been added); the "Finishes ... over its plan" warning appeared.

**4. Needs-attention warnings** (second invented project, data bent the way real life would): all four displayed, each with a plain sentence and a button:
- Unassigned payments: "$3,500.00 in 2 payments on split agreements are not assigned to a budget line…" with a **Show the payments** button.
- Invalid list (an agreement whose amount was changed behind the app's back): "The split of 'Windows' … no longer adds up … is being ignored" with **Open the agreement**; it opens with the stored list and "Left to allocate: $100.00", ready to fix.
- Removed line: "'Landscaping' has money on a budget line that no longer exists…" with **Open the agreement**.
- Change order without a split: "The change order 'Extra flashing' … is not split…" with **Open the change order**.
- A new note under "Budget by line" lists each cause of the "No budget line" row separately, and their sum matched: $6,600 = $500 unsplit change order + $2,000 on the removed line + $4,100 ignored split. (The older "spending not filed under any line" warning still also fires; it is the unchanged P2 text.)

## 11.3 Exact changes made during this verification
No financial calculation was changed. Only wording and navigation:
1. **Misleading unassigned row.** On the contract card an unassigned payment appeared as a line with "$2,000.00 paid beyond its share". Now it reads "Paid, line not chosen" / "balances the lines", plus a sentence that until it is assigned the lines above show that much too much left to pay and the "Together" row is the true total. (`Commitments.tsx`)
2. **"8 transactions on this" for 6 transactions.** The count was of split pieces. Now "6 transactions on this (8 parts, each counted once)". (`Commitments.tsx`)
3. **Residual not explained / no way to act.** Added `noLineNotes` (`financialView.ts`) and a "What is in 'No budget line'" note (`Financials.tsx`) that names each cause separately (genuinely unassigned payment, unsplit change order, removed line, stale split, overpaid agreement, or simply unfiled); the unassigned warning now states the dollar amount; added the Open / Show buttons (`Financials.tsx`, `ProjectPage.tsx`).
4. Two tests added to `p4a.test.ts` (the $50,000 scenario to the cent, and each residual cause).

## 11.4 Unresolved limitations
- The split-row part of the transaction form (typing three split rows by hand) was not exercised in the browser; the split was created by the app's database call and then edited through the form. The form's split-row tagging was covered earlier by tests and by the edit check above.
- An overpaid line's "Expected" is paid + signed left, so Finishes showed Expected $10,000 and Remaining $5,000 while $11,000 had actually been paid. This follows the approved design (the extra comes out of the agreement's other lines); a line view that hid this would be wrong in the other direction, but the owner may want a note on the line row. Not changed.
- The general "not filed under any line" warning can fire alongside the more specific ones.
- The phone-width and dark-mode check was done for the split form and contract card in the first round; the new note, the changed table row and the new buttons were checked at desktop width only.
- Not verified: two real devices, older app versions, real data, offline use.

## 11.5 Git working-tree status
Modified: docs/BACKLOG.md, src/lib/txnProject.ts, src/lib/txnProjectTag.ts, src/pages/ProjectTag.tsx, src/modules/projects/{CommitmentForm, Commitments, Financials, ProjectPage}.tsx, {commitmentModel, data, financialView}.ts, projects.css. New: p4a.test.ts and this report. Nothing staged; `HEAD` is `50afaa4`.

## 11.6 Recommendation
Ready for the owner's final approval to commit. Suggested before pushing: glance at the new note and button wording on a phone.
