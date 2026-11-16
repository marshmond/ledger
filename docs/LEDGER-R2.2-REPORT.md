# Ledger R2.2: Money Intake, Possible Payment Matches (report)

Status (2026-11-16): **BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. NOT REAL-DEVICE TESTED.**

Gate verified first: `main` = `origin/main` = `c1707c7` (`feat(finance): remember import mappings and support pasted transactions`, R2.1) and GitHub Pages run **#121** is `completed` / `success` (public Actions API; `gh` is not installed), so R2.1 is committed and deployed and nothing of it is mixed in. The three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`) were not touched.

## A. Executive summary

Ledger now offers to connect a payment to the household record it probably belongs to, and never does it by itself.

- **After an import** that succeeded, a quiet line appears under the success message only when there is something credible: "6 transactions may match household records" with a button **Review possible matches**. Nothing is shown when there is no match. The import is complete and undoable whether or not the owner ever looks.
- **On the Transactions page** a **Possible matches** button in the toolbar does the same for the selected rows, or else the newest payments in the current filter. It reads only when pressed.
- The review shows, for each payment, the household record it may belong to (a **bill**, a **service visit**, a **maintenance record** or a **project**), the reasons in plain English, a link to open the record, and three actions: **Accept link**, **Review link** or **Not a match**.
- **Accept link** hands the payment back to the module that owns the record, which re-checks everything and uses its own existing link operation. **Review link** opens that module's own screen when a choice is still needed. **Not a match** is remembered for that one pair only.
- When more than one record could match, Ledger shows them all, says it has not chosen, and offers only Review.

The defining rule held: a suggestion is read only. Opening or viewing the review leaves every table byte-for-byte identical (tested, and checked again in the browser).

## B. Architecture (the design step the roadmap asked for)

### The six design questions, answered from the code

1. **Authoritative matching inputs and scoring.** Bills' `payeeMatch` (word-based; ignores filler and industry words) and `suggestMatches` (B3.1: payee, date window, amount only when reliable, linked Scheduled posting, refund and split checks, `suggestion-reject`). I did not write a second scorer for Bills. The payee comparison moved to `src/lib/payeeMatch.ts` (Bills keeps importing it from its old path through a one-line re-export, the `semimonthly` precedent) so the other three modules compare a payee exactly the same way.
2. **Which records can legitimately receive a payment.** A bill's billing period (`payment-link` fact); a logged service visit (`txnRefs`; a visit is only written after something happened); an existing home-maintenance service record (`txnRefs`); a project through the tag on the transaction itself (`Txn.project`). Not offered, on purpose: a Services arrangement as a whole (retainer), an asset's own purchase record, a scheduled-but-not-logged visit, and money coming back.
3. **The existing operations.** Bills `recordFact` (`payment-link`) and `rejectSuggestion`; Services `setVisitPayment`; Home & Assets `updateService`; Projects `setTxnProject` with the reference `buildRef` builds (the very call the transaction form makes).
4. **Gathering without Finance importing a household module.** One more optional `contributes` hook, `paymentSuggestions`, in the registry (like `attention`, `weekReview`, `taskFollowUp`). Each module's adapter loads only when asked (`import()` behind a thin wrapper). `src/core/paymentSuggestions.ts` asks every registered module; `src/shell/PossibleMatches.tsx` shows the result. Neither names a module (a guard test checks it).
5. **Remembering a rejected suggestion.** Bills reuses its own `suggestion-reject` fact (so a rejection in either place is honoured in both, tested). The other modules use one small row per (module, payment, record) in the existing `settings` table, `link-reject:<module>:<txn id>:<record key>`. It rides sync and backup with no migration, holds the pair and a snapshot of the payment (date, payee, amount) and is honoured only while the payment is unchanged.
6. **Preventing duplicate or inconsistent links.** The shell offers only payments that nothing uses yet (it asks every module's existing "who points at this transaction" reader, the one the delete check uses, plus the Project tag). If that cannot be completed, nothing is suggested. Accept re-asks, and then the module's own operation applies its own rules (same piece twice, whole beside part, typed amount versus Finance, one cost source). Ledger never replaces or unlinks, and does not offer to share one payment between two records.

### Files

| File | Role |
|---|---|
| `src/core/paymentSuggestions.ts` | The contract (`PaymentSuggestionSource`, `RawCandidate`, `LinkCandidate`), `eligibleTxns`, `gatherSuggestions`, `acceptCandidate`, `rejectCandidate`, the small "Not a match" settings memory. No module imported. |
| `src/core/registry.ts` | `contributes.paymentSuggestions` and `allPaymentSuggestionSources()`. |
| `src/modules/{bills,services,assets,projects}/paymentSuggest.ts` | The four small adapters (suggest, accept, reject). Registered lazily in each `index.tsx`. |
| `src/modules/bills/suggestData.ts` | One added reader, `suggestForTxns` (the same `suggestMatches`, started from payments instead of one period). |
| `src/lib/payeeMatch.ts` | The Bills payee comparison, moved (re-exported from the old path). |
| `src/shell/PossibleMatches.tsx`, `possibleMatches.css` | The review dialog and the import follow-up line. |
| `src/pages/ImportPage.tsx`, `TransactionsPage.tsx` | The two entry points; the Import "undo" now shows what depends on the imported payments. |

No new table, no migration, no new dependency, no network, no timer, no model, no change to backup or sync formats, to Finance posting, or to the Ledger Signature design system (one small stylesheet of `pm-` layout classes using existing tokens).

## C. Matching rules

A payee comparison is always the first requirement. **Amount alone never produces a suggestion**: a payment with the same amount as a bill or a visit but a different payee gives nothing (tested for both).

| Module | Identity (required) | Other signals | Excluded | Accept only when |
|---|---|---|---|---|
| Bills | Bills' own rules: payee matches the bill's remembered payee, provider or title, or the payment was posted from the bill's linked Scheduled item | due-date window (manual 7 before to 10 after, auto 2 before to 7 after), reliable amount, history range, category | amount that disagrees with a reliable amount; a period already recorded paid, skipped or not due; a payment already linked, rejected, or possibly refunded (those become review) | a strong match, an unsplit payment, no typed outside-Finance payment on the period, no open reminder Task to decide about, and nothing to look at closely |
| Household Services | payee matches the visit's provider (name on the visit, or the Contact's current name) | payment 7 days before to 30 after the visit; recorded charge must agree within 1% when there is one | a visit not completed (or not a cancellation fee), a visit that already has a payment, a charge that disagrees | the visit has no payment, and its charge agrees or (no charge and the payment is 3 days before to 14 days after) |
| Home & Assets | payee matches the provider Contact on the record | payment 7 days before to 30 after the work; a typed cost must agree within 1% | a record with a payment already, a record without a provider, an archived asset, a typed cost that disagrees | the record has no cost and no payment, the payment is unsplit, and dated 3 days before to 14 days after |
| Projects | payee matches a vendor Contact of an open (planning or active) project | the project's dates (30 days before start to 90 after target) and an agreed contract with that vendor | money in, a transfer, an already tagged payment, archived or finished projects | the vendor name is backed by project dates or by exactly one plain agreed contract, the payment is unsplit and has no contract choice to make |

**Ambiguity.** Per payment, the shell collects every candidate from every module (at most four shown). When there is more than one, all of them become **Review**, the card says "2 records could match this payment. Ledger has not chosen one", and nothing can be accepted from the list. Rejecting one (or recording the payment where it belongs) leaves the rest.

**Why these are conservative.** A missed suggestion is cheap (the manual link still exists in every module); a wrong link changes spending. The reasons list only what was actually compared; there are no percentages, scores or "confidence" (a guard test checks the new files).

## D. Module integrations

| Module | Suggest reuses | Accept calls (existing) | Reject | Not offered, preserved as manual |
|---|---|---|---|---|
| Bills & Subscriptions | `suggestMatches` (B3.1) | `recordFact` with a `payment-link` fact (what the Link-a-payment dialog calls) | `rejectSuggestion` (`suggestion-reject` fact, this period only; Undo uses Bills' own guarded undo) | a payment on a period with a typed amount or an open reminder Task (Review: the dialog asks which counts and whether to finish the reminder) |
| Household Services | visit records (`loadVisits`), `payeeMatch` | `setVisitPayment` (`source: 'finance'`), guarded by the visit's `updatedAt` | shared settings memory | arrangement-level (retainer) payments; a visit with a typed outside-Finance amount (Review); a scheduled visit is never a candidate and no visit is created or completed |
| Home & Assets | service records (`loadServices`), `payeeMatch` | `updateService` with `txnRefs` added, guarded by the record's `updatedAt`; **nothing is invented or backdated** | shared settings memory | asset purchase references; a record with a typed cost is always Review (the existing form asks which one counts) |
| Projects | project vendors and `loadProjectChoices` | `setTxnProject` with the reference `buildRef` builds (same as choosing the contract in the transaction form) | shared settings memory | split payments (Review: the transaction editor tags each part), several agreed contracts or a contract split across budget lines (Review), money coming back (never suggested) |

**Review link destinations:** the bill (`#/bills/o/<id>`), the visit (`#/services/v/<id>`), the maintenance record (`#/assets/<asset>?service=<id>`), and for Projects the existing transaction editor (`#/ledger/transactions?txn=<id>`). No module could be made to support Accept for every case, so each keeps its manual workflow for the cases above.

**Honest limitation (Undo import).** R2.1's Undo deleted the imported payments without asking what depends on them, so a payment linked after import would have left a "payment not found, needs review" record behind. R2.2 adds the same read-only check the Transactions delete uses (`planTxnDeletion`): the Undo dialog now lists the bills, visits, records and projects that use the imported payments, says what will happen to them, and turns Undo off if the check cannot be completed. With nothing linked the dialog and the Undo are exactly as before. The records themselves are never changed by an Undo (their references read "payment not found" and count nothing, the existing behavior); this report does not claim Undo can restore a link.

## E. Financial correctness

- **A suggestion changes nothing.** `gatherSuggestions` is read only: a test snapshots every table before and after, and the browser walkthrough hashed every table before and after opening the review (identical).
- **Finance's transaction is never edited by an Accept**, except the one field Projects owns on it (`project`): tests compare the transaction before and after for all four modules (amount, payee, account, date, splits, status identical). The Project tag is added through `setTxnProject`, and a test compares it with what the transaction form's call produces.
- **Accept equals the manual link.** For Bills and Services the stored result is compared with the one the existing dialog's call produces on a twin database (identical apart from ids); for Home & Assets the record keeps every other field and no cost is invented; for Projects the tag equals the manual reference.
- **One-source spending preserved.** A Home & Assets record with a typed cost, a Services visit with a typed amount, and a Bills period with a typed payment are never auto-switched: they are Review, and the module's own preview asks. Bills' period rules, the shared `spend()`, `householdSpend()`, the B5 union, project paid figures and change orders were not edited; only existing write operations are called.
- **Stale or already-linked candidates cannot become links.** Tests: the payment edited after it was suggested; the payment linked elsewhere in the meantime; the visit edited; a record given a typed cost; a Review candidate cannot be accepted from the list.
- **Transaction deletion protections** are unchanged and now also used by the Undo import dialog.
- **Duplicate detection, import confirmation and undo** (`classifyRows`, `commitImport`, `undoBatch`) are untouched; only what the dialog says before Undo is new.

## F. UX evidence

Screenshots (outside the repository, invented data): `Documents\Ledger-Design-Concepts\R2.2-Evidence`

1. `1-import-success-notice-desktop.jpg`: after a pasted import, "6 transactions may match household records" and **Review possible matches** (the import itself is already done).
2. `2-possible-matches-after-import-desktop.jpg`: the review: a bill and a service visit, each with reasons, Accept link and Not a match.
3. `3-review-typed-cost-and-project-accept-desktop.jpg`: a maintenance record with a typed cost shown as **Review link** with the one-source explanation; a project suggestion that can be accepted.
4. `4-accepted-feedback-and-ambiguity-desktop.jpg`: after Accept, "Linked to ... Nothing in Finance was changed." and the accepted payment gone from the list.
5. `5-ambiguous-two-visits-desktop.jpg`: "2 records could match this payment. Ledger has not chosen one", both Review.
6. `6-from-transactions-page-desktop.jpg`: the same review opened from the Transactions page.
7. `7-review-link-opens-existing-record.jpg`: Review link opened the maintenance record in Home & Assets, where its Edit button asks which cost counts.
8. `8-possible-matches-mobile-375.jpg`: 375 px phone width (no sideways scrolling; page width 375 in a 375 window).
9. `9-undo-import-shows-linked-records-desktop.jpg`: Undo import now lists the linked bill and project.

Rejection evidence: pressing **Not a match** on one of two Pat Pools visits wrote one `link-reject:services:...` settings row and removed that pair; the other visit became a single, acceptable candidate; a **new** Pat Pools payment still got both visits (the pair, not the provider, was dismissed).

## G. Verification

- **Focused tests:** `src/core/paymentSuggestions.test.ts`, 31 tests on a real (fake-indexeddb) database with invented records: a credible match for a bill, a visit, a maintenance record and a project; no suggestion from an amount-only coincidence (bill and visit); a disagreeing recorded charge; refund, transfer and tagged payments never suggested; ambiguity (two visits; a bill and a project) with no pick; a split payment, two contracts, a typed cost and a vendor-name-only project all become Review; reading writes nothing; an already linked payment is not offered; "cannot check" suggests nothing; a failing module is named; a rejection stays, applies to one pair, is judged again when the payment is edited, and is shared both ways with Bills' dialog; one settings row and no schema change; Accept equals the manual link for all four modules with the payment unchanged; the four stale-candidate refusals; the Undo-import plan lists the linked record; source guards (no network, console, storage, timer or model; no direct write path; the shell names no module; no percentage or score).
- **Existing guards edited (4 one-line list updates, disclosed):** `b31-guards.test.ts` (the file that imports `financeRead` no longer includes the moved `payeeMatch.ts`; the rejection writers include `paymentSuggest.ts`), `b3-spend.test.ts` (the files that use `loadTxnMap` and `txnLookup` and build a `payment-link` fact include the adapter), `hooks.test.ts` (Bills' contribution list), and `d201bConfirmations.test.tsx` (Import's `onConfirm` now checks dependents before `undoBatch`; the test still requires the write to be inside `onConfirm`). No assertion was weakened beyond adding the new file.
- **Full suite, `tsc`, build:** see the results line at the end of the handoff entry ("RESULTS" below, filled in from the final runs).
- **Browser walkthrough** (Chromium pane, `npm run dev`, invented demo household: one bill, three visits, two maintenance records, one project with a vendor, a split payment): paste import then Review possible matches; Accept on a bill, a project and a maintenance record (stored link checked in the database; the payment's other fields unchanged); Not a match; ambiguity; opened from Transactions; a Review link followed to the existing record; Hide Amounts on (every amount showed `$••••`, no digits); Undo import listing dependents; 375 px layout. A development hot-reload glitch once showed the page error screen with a stale `Link` reference; a full reload cleared it and the final code was exercised afterwards without errors.
- **Not checked:** a real phone, a screen reader (labels name the payment and the record, but this was not listened to), other browsers, real bank data, the sync merge of two devices rejecting the same pair at once (separate settings rows, so no overwrite), the Undo toast after "Not a match" (its position was not captured in a screenshot).

## H. Judgment calls (please review)

1. **Moved `payeeMatch.ts` to `src/lib`** (Bills keeps its import path through a re-export) so Services, Home & Assets and Projects compare payees the same way. The alternative was a cross-module import, which the boundary rules forbid.
2. **Only payments nothing uses yet are suggested.** A payment already linked to any household record (or tagged to a project) is never offered again, even where sharing it would be legitimate (a real payment can cover a bill and a visit). Sharing stays a manual choice in the module. This is the most conservative reading of "do not replace existing associations".
3. **Any ambiguity turns every candidate into Review.** The alternative was to allow Accept on each of several plausible candidates. I chose to make the owner open the record, because a mis-tap would change spending.
4. **Bills: Accept needs a strong match.** Bills' "possible" tier (payee and date, no reliable amount) is always Review. Services and Home & Assets, whose records often have no amount to compare, allow Accept when the payee matches the provider and the payment is dated near the work (-3 to +14 days) and there is no amount to contradict it. Please confirm that difference.
5. **A recorded charge or typed cost that disagrees excludes the candidate** (one invoice that covers several visits stays a manual link).
6. **Bills periods with an open reminder Task are Review**, because the manual dialog asks whether to finish the reminder in the same step and Accept must not decide that silently.
7. **Projects: the vendor name must be backed by project dates or exactly one agreed contract to Accept.** A vendor name alone is Review. With one plain agreed contract the contract is tagged too (as choosing it in the form would).
8. **Rejections for Services, Home & Assets and Projects live in `settings` rows** (one per pair) rather than a new record kind in each module; they are honoured only while the payment is unchanged. Rows are not cleaned up when a payment or account is later deleted (harmless; each is a few bytes).
9. **Import Undo now warns and refuses only when it cannot check.** It still deletes the imported payments after the owner confirms, as before; it does not block on linked records. The warning mirrors the delete dialog.
10. **Hide Amounts is honoured in the new dialog** even though Ledger's own pages (Transactions, Import) still show amounts by the existing documented scope.
11. **Four existing guard tests were edited** (list updates, see G).
12. **Limits:** at most 400 payments are looked at in one go (newest first, and the screen says so); at most four candidates per payment.

## I. Release recommendation

Ready for owner and ChatGPT review. Nothing is committed, pushed or deployed. Suggested owner checks on a real device: one real import followed by Review possible matches; accept one real bill payment and open the bill to see the link; Not a match on one suggestion; Undo import on a batch that includes a linked payment.

**Next proposed phase: R3.1 Year-ahead Commitments** (not started; needs its own approval).

**Not built (out of scope as instructed):** automatic linking, automatic bill payment confirmation, new visit or maintenance-record creation, background monitoring, bank integrations, OFX/QFX, import parser changes, rules v2, auto-categorization changes, receipt scanning, AI matching, new dashboards, R3 features, any Finance redesign. Also not built: arrangement-level (retainer) payments, asset purchase references, a "look at rejected matches again" list for the non-Bills modules (the Bills dialog already has one for its own).

## J. Results line

Final runs on the finished code (2026-11-16): `npx tsc --noEmit` clean; full suite **299 files, 5,912 tests pass** (R2.1 baseline 298 / 5,881; +1 file, +31 tests); `npm run build` clean (entry chunk 857.11 kB raw / 269.81 kB gzip; the new code sits in the Ledger and module chunks and loads on demand, and `lazyBoundary.test.ts` still passes). The run before the last guard additions failed 4 existing guard tests (list updates, section G) and the 1 missing Bills contribution entry; all were corrected and the final full run is green.
