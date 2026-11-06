# Home & Assets H3 report: Finance references and Projects links

Date: 2026-11-06. Built to the H3 brief on the plan in `docs/HOME-ASSETS-H0-PLAN-2026-11-05.md` (Revision 2, sections 3.5, 6 and 10).
Status at time of writing: **built, tested, NOT committed, NOT pushed, NOT deployed.** H4 and H5 are not started. Invented data only.

## 1. Executive summary

An asset page now answers: what it cost to buy, what has been spent keeping it going, which Finance transactions that money is, what has been spent
across a property and everything inside it, and which Projects have improved or repaired it (with their paid-to-date shown beside, never added in).
Finance is untouched: a purchase or a service record can point at a whole transaction or one part of a split, the live transaction is the authority,
and anything that can no longer be trusted is left out of the totals and flagged for review instead of being guessed.

| Check | Result |
|---|---|
| Tests | **1,521 pass** (97 files). Was 1,464; **57 new**: `spending.test.ts` 34, `h3-data.test.ts` 17, `h3-sync.test.ts` 6 (real `SyncEngine`, two devices) |
| Type check (`npx tsc --noEmit`) | Clean |
| Production build (`npm run build`) | Succeeds (the existing "chunk larger than 500 kB" notice is unchanged) |
| Schema, backup format, sync format, dependencies | **No change** (Dexie stays 15; `package.json`, `db.ts`, `types.ts` untouched) |
| Finance, Tasks, Calendar, Contacts, sync code | **No file edited** |
| Projects | One file edited (`ProjectPage.tsx`, one import and one line) plus one new component. No calculation touched |
| Browser (desktop pane, invented data, throw-away database) | Main flows exercised (section 14); screenshots were NOT possible, see 14 |

No stop condition was triggered. Safe split referencing needed **no Finance change** (section 6), de-duplication needed no change to any balance or total,
and the Projects link needed no change to Projects' calculations.

## 2. H2 deployment and prerequisite verification

1. H2 is commit `f101e1b`; `HEAD` equals `origin/main` after `git fetch`.
2. GitHub Actions "Deploy to GitHub Pages" for `f101e1b`: read from the public Actions API (the `gh` tool is not installed here). It was `in_progress` on my first read and **completed, conclusion success** on the second, before I started editing.
3. Working tree was clean at the start (git status empty).
4. Baseline before any change: **1,464 tests passing** (94 files).
5. Read: `CLAUDE.md`, H0 plan sections 3, 6, 9 and 10, the H2 report, the whole assets module data/model/service code, `lib/txnProject.ts`, `lib/txnQuery.ts`, `Txn`/`Split` types, the shared links store, the record registry, Projects `ProjectPage`/`ProjectWork`/`deletion`/`records`, `lib/property.ts`, and the Transactions page's `?txn=` deep link.
6. **H0 Section 6 matched the code**, with one important finding: a `Split` has **no id**, only a position (`categoryId`, `amountCents`, optional `project`). That is why the split strategy uses a fingerprint (section 6), as H0 rule 6.8.3 already anticipated.

## 3. Implementation versus approved H3 scope

| Scope item | Status |
|---|---|
| 1 Transaction references for service records | Done (`txnRefs` on the service record) |
| 2 Transaction references for asset purchases | Done (`purchaseTxnRefs` on the asset) |
| 3 Read-only picker incl. splits | Done (inline, search by payee/note, date box, amount box, using Finance's own filter code) |
| 4 Direct asset spending summary | Done (`SpendingCard`) |
| 5 Parent-property rollups | Done (own / inside / combined) |
| 6 Double-counting protection | Done (section 8) |
| 7 Links between Assets and Projects | Done (`projects:<id>` to `assets:asset:<id>`, type `involves`) |
| 8 Project spending separate from direct spending | Done (Related projects card; tested that it never enters the total) |
| 9 Small explicit Projects-side integration | Done (Related assets card; "Record in Home & Assets…") |
| 10 Search/navigation | Done: each linked transaction opens in Finance (`#/ledger/transactions?txn=`); review items open the record to fix. Global search unchanged (see 12) |
| 11 Regression and browser verification | Done (sections 13, 14, 15) |
| Net-worth pointer (brief section 7) | Done, minimal (section 11) |

Not built, by design (brief out-of-scope list): `Txn.asset`/`Split.asset`, editing transactions from Assets, asset budgets, valuation/depreciation, cost basis, mileage, warranties/replace flow (H4), dashboard (H5).

## 4. Exact files created and modified

**New, `src/modules/assets/`:** `txnRef.ts` (reference model, reader, fingerprint check, validation; pure), `spending.ts` (the one pure spending helper), `costSource.ts` (typed-or-Finance choice; pure), `txnLookup.ts` (read-only transaction reads), `TxnRefs.tsx` (picker, reference rows, cost-source field), `SpendingCard.tsx`, `RelatedProjects.tsx`, `NetWorthEntry.tsx`, `h3.css`, `spending.test.ts`, `h3-data.test.ts`, `h3-sync.test.ts`.
**New, other:** `src/core/projectAssetLink.ts` (the one place that defines the Project/Asset link shape, so the two modules cannot drift), `src/modules/projects/RelatedAssets.tsx`.
**Modified:** `assets/model.ts` (`purchaseTxnRefs`, `ledgerPropertyId`), `assets/service.ts` (`txnRefs`, rules), `assets/validate.ts`, `assets/data.ts` and `assets/serviceData.ts` (check new references before saving), `assets/AssetForm.tsx`, `assets/ServiceForm.tsx` (cost-source field; project prefill), `assets/AssetPage.tsx`, `assets/AssetWork.tsx` (cost display, project name, handoff), `assets/AssetsModule.tsx` (imports the css), `projects/ProjectPage.tsx` (one import, one line), `assets/service.test.ts` (3 placeholder lines, see judgment call 15), `README.md`, `docs/BACKLOG.md`, and this report.
**Not edited:** `db.ts`, `types.ts`, backup files, `src/lib/sync/*`, `lib/txnProject.ts` and every other Finance file, Tasks, Calendar, Contacts, Projects data/deletion/calculation code, `package.json`.

## 5. Transaction-reference data model

Stored inside the existing records (additive; no table or migration):

```
TxnRef = { txnId: number,
           splitIndex?: number,                 // absent = the whole transaction
           snapshot: { date, payee, amountCents },   // explanation only, never a total
           fp?: { splitCount, amountCents, categoryId } }   // split references only
asset.data.purchaseTxnRefs: TxnRef[]    (alongside the existing purchaseCents)
service.data.txnRefs:       TxnRef[]    (alongside the existing costCents)
asset.data.ledgerPropertyId: number | null   (net-worth pointer)
```

Older devices carry these as unknown fields. The reader never throws and drops junk entries. A piece is identified by `pieceKey` = `txnId:splitIndex` or `txnId:w` (whole). Maximum 20 references per record.

## 6. Split-transaction integrity strategy

Finance splits have only a position, so a position alone would silently attach to a different part after an edit. The reference therefore stores a **fingerprint** of the part when linked: how many parts the transaction had, that part's amount, its category. On every read:

- Same count, amount and category at that position: still the same part; the **live** amount is used.
- Anything else (part removed, reordered with different amounts, amount or category changed, transaction no longer split, no fingerprint present): state `split-changed`, **contributes 0**, listed under "needs review" with the old snapshot shown only as words ("was paid $100.00 when linked"). The owner must pick the part again. Nothing is moved to another part.
- Transaction deleted: `missing`, 0, flagged. Transaction became a transfer or a setup entry: `not-spending`, 0, flagged.
- Whole-transaction reference: follows the live amount; a changed date, payee or amount adds a quiet "changed in Finance" note (still counted, because the live transaction is authoritative).

**Honest limit:** two parts with the same amount AND the same category are interchangeable to this check. Swapping them changes no figure, so it is not flagged. Tested: reorder, amount change, category change, part removed, no longer split, deleted, turned into a transfer, missing fingerprint. No Finance change was needed, so the stop condition did not apply.

## 7. Manual versus transaction-linked cost rules

- A cost is **typed**, **from Finance**, or **unknown**. Unknown (blank) is never shown as $0; a typed 0 is a real $0. Tested.
- The form has a radio, "Typed amount / From Finance transactions". The data layer **rejects** a record with both ("a cost is either typed or taken from Finance, not both").
- Switching never erases silently. If saving would drop the other source, the form names exactly what ("the typed amount ($250.00)" or "the link to 2 Finance transactions") and requires a ticked box; without it Save refuses. Browser-checked for typed to Finance. What is on screen is kept until Save, so switching back loses nothing.
- A record that arrives with both (older device, hand edit): **references win**, and the asset page says so.
- Nothing creates a Finance transaction, and nothing changes net-worth values.

## 8. Deduplication implementation

`spend()` in `spending.ts`, pure. A transaction piece counts **once per aggregate**, however many records, assets or hierarchy levels reach it:
- same piece on two service records, or a purchase and a service: counted once, and listed as "linked from N records, counted once";
- same piece on several assets: counted once in a parent's combined figure; each asset alone still shows it, with "also linked on <asset>, not added here";
- a **whole** transaction and one of its **parts**: the whole counts, the part is left out, whichever record comes first (tested in both orders);
- typed amounts are never merged because the numbers match (tested);
- a shared piece is credited to the first record in a fixed order (purchase, then work by date), so the group split (buying / maintenance / other) is stable.
Within **one** record, the same piece twice, or a whole plus its part, is refused at save.

## 9. Asset and property spending calculations

Computed on read from source records; nothing is stored. Sign convention follows Finance: outflow is negative, so spend = minus the piece amount, and a refund lowers the total.
- **Asset page, Spending card:** total spent directly; Buying it / Maintenance, repairs and inspections / Improvements, replacements and other work, each marked "typed", "from Finance", or both; the linked transactions with a link to each in Finance; "needs review" box (not in the totals); count of records with no cost recorded; note for records holding both sources.
- **Property (or any asset with things inside):** On the asset itself / On things inside it / Combined, each payment once. "Inside" is combined minus own, so a payment also on the property is not double counted. The tree walk is cycle-proof and bounded (tested with a loop, a missing parent and a self-parent).
- Verified totals are kept apart from amounts needing review, which are never estimated.

## 10. Projects linking and handoff

- Link: `projects:<projectId>` to `assets:asset:<id>`, type `involves`, in the existing shared links (no new table). Many-to-many both ways. Linking twice makes one link. Removal is a soft delete, with an Undo toast on both pages.
- **Asset page, Related projects:** name (link), status, archived chip, start and target dates, and "Paid so far on the whole project" read from the existing `loadProjectSummary(...).paidCents` (not recomputed), captioned "shown for context, not added to this asset's spending". Archived projects resolve. A link whose project is gone shows "(project no longer exists)" with "Remove this link" and does not crash.
- **Project page, Related assets** (`RelatedAssets.tsx`): lists linked assets, picks existing ones (names and search come from the shared record registry, so Projects imports no Assets code), unlinks without deleting either side.
- **"Record in Home & Assets…"** (offered on a completed project, in both places): a plain link to `#/assets/<id>?fromProject=<id>`. The asset page opens its **own** service form prefilled with the project name as the description, kind Improvement and the project id, and a note saying nothing is saved until Save. **No cost, no transaction and no project payment is copied.** The form's date defaults to today and must be confirmed by the owner. Archived assets refuse it with a message. Escape cancels with nothing created (browser-checked); only Save creates a record.
- Deleting a project already removes its links (Projects' existing rule, no change); deleting an asset removes its links (H1). Tested both ways, including over real sync.

## 11. Net-worth entry integration

The asset form (properties, vehicles, other) has an optional "Net worth entry" select listing Finance's existing entries. The asset page then shows, read-only, "Net worth entry: <name>, latest value $X as of <date>, Open Net worth in Finance". A removed entry reads "(net worth entry removed)". Nothing is created, edited or valued by Assets; the two concepts are labelled separately. Advanced valuation presentation is deferred.

## 12. Lifecycle, deletion and synchronization impact

- Service history survives unlinking from Finance and survives the transaction being deleted (record intact, reference flagged). Retiring or archiving an asset keeps its references and its historical spending (tested).
- An asset with live service records stays protected from permanent deletion (H1/H2 rule; no sync code changed). A deleted project does not delete an asset; a deleted asset does not delete a project (tested).
- A record whose reference has gone stale can still be edited and saved: only **new** references are checked against Finance at save.
- Finance tables are read **before** the save's database transaction opens, so they never join it and can never be written. A tiny race (a transaction edited between the check and the save) is harmless because stale references are re-judged on every read.
- Real `SyncEngine` two-device tests: references and snapshots arrive and resolve to the same spend; a transaction deleted on one device flags the reference on both and keeps history; a project link made or removed on one device appears or disappears on the other with both records kept; a project deleted for good unlinks everywhere and leaves the asset; concurrent asset and service edits both survive; a stale permanent deletion does not destroy history made on another device.
- Global Search, Today and exports: `searchSource.ts` was not changed, so no transaction, amount or reference text was added to search or Today. Backup export carries the new fields (tested round trip, and an H2-era record restores with empty references).
- **Cannot be verified without two real devices:** actual network sync timing, offline edits made hours apart, a device on the older build syncing (it keeps the new fields as unknown data but will not show them), and the reference check on a device that has not yet received the Finance transaction (it would show "not on this device" until sync completes; this wording is in the note).

## 13. Automated test results

Full suite **1,521 pass**. New tests map to the brief's list: 1 manual purchase, 2 manual service, 3 unknown versus zero, 4 purchase whole, 5 purchase split, 6 service whole, 7 several pieces, 8 refunds, 9 transfers (and picker rule), 10 same transaction twice, 11 same piece on several assets, 12 whole/part overlap in both orders, 13 reordered, 14 amount changed (and category), 15 removed (and no longer split), 16 deleted, 17 payee/date changed, 18 parent-child, 19 several descendants, 20 cycle/malformed, 21 Finance figures unchanged (a snapshot of accounts, transactions, categories, assignments, recurring, goals, net-worth tables and project records is identical before and after adding, changing and removing references and links). Projects: one asset many projects, many assets one project, remove and restore, archived and deleted project, project totals from the existing summary and never added, the same transaction on a project and a service counted once with the project summary unchanged, completing a project creates nothing, linking changes no Finance or Projects data.
**Mutation checks:** with the fingerprint comparison disabled, 4 tests fail; with the transfer guard disabled, 3 fail; restored, all pass.
Existing tests: Finance, Projects P1 to P5, Tasks, Calendar, H1, H2 (including backup and sync) all pass unchanged except 3 placeholder lines (judgment call 15).

## 14. Browser verification

Dev server on a separate port (a separate empty database, so none of your real data was touched; stopped afterwards). The Browser pane was **hidden**, so screenshots timed out: everything below was checked through page reads, real clicks and form input, with some steps driven by script clicks. **No visual (screenshot) review was done.**

Exercised and working: (1) create a property with a purchase from a Finance transaction and a net worth entry (value shown read-only); (2) a transfer is not offered in the picker; (3) service record linked to ONE part of a split (whole transaction then disabled; $100 counted); (4) editing the split in test data turns the line into "Needs review · not counted" with the reason, total drops, nothing substituted; (5) deleting the transaction shows "deleted or not on this device", snapshot only as words; (6) rollup: property $1,200, inside $1,050, combined $2,250, with one transaction linked from two records counted once; (7) typed to Finance switch refused until the named box is ticked, then saved with the typed amount removed; (8) link a project from the asset page; link two more assets to one project from the project page; asset and project pages navigate to each other; (9) project paid $25,000 shown beside $800 direct and not added; (10) "Record in Home & Assets…" opens the prefilled form, no record exists, Escape creates none; (11) a dangling project link shows "(project no longer exists)"; (12) 375 px: no sideways scroll on the property page or in the form with the picker and parts open, picker controls at least 40 px tall; (13) dark scheme: warning colour contrast about 9.4:1 against the background (measured, not seen); (14) no uncaught errors or console errors across the asset and project pages.
**NOT browser-verified:** anything visual (screenshots); keyboard-only operation beyond Escape; screen reader; the handoff form's Save (covered by the data test only); the Unlink and Undo toasts; the refund line in the picker UI; replacing a stale reference (remove and re-link); the archived project's row on the asset page in the UI (data-tested, and it shows in the select); light-theme look; real phone; two real devices.

## 15. Financial and Projects regression evidence

Item-21 test above; the Finance invariant test in H2 still passes; `lib/txnProject.ts` and every Finance file have no diff; Projects calculation and deletion files have no diff; `loadProjectSummary` is called, not copied; the project summary JSON is byte-identical before and after attaching the same transaction to a service record (tested).

## 16. Backup and backward compatibility

Dexie stays 15; no new table; no backup or sync format change. New data lives only in `data` of existing `moduleRecords` and in `links` rows. Round trip through `exportAll`/`importAll` verified. A record saved before H3 reads with empty references. An H2 device keeps the new fields as unknown data (it will not display them).

## 17. Judgment calls and deviations from H0 (please review)

1. **One source stored at a time.** H0 6.8.1 says typed XOR references; I followed it and made the switch explicit (named box). I did NOT keep the typed amount as a dormant fallback, because a stale reference silently falling back to an old typed number would break "never substitute an unverified amount".
2. **Split identity is a fingerprint** (count, amount, category), as H0 6.8.3. Identical twin parts are interchangeable (section 6).
3. **A whole-transaction reference follows the live amount** even if it was edited (noted as "changed in Finance"); only split references go to review on change.
4. **Reuse across records is allowed**, not refused at save (H0 6.8.2 proposed refusing). The brief asks for counted-once plus visible reuse, so it is shown, not blocked. Same piece twice on ONE record is refused.
5. **Whole beats parts** in an aggregate, whichever is saved first.
6. **Groups:** Inspection counts with Maintenance and repairs; Improvement, Replacement and Other are "Improvements, replacements and other work".
7. **Credit for a shared piece** goes to the first record in a fixed order, so the group split is stable (the grand total is unaffected).
8. **Refunds are offered in the picker** (labelled "Money back") and lower the total.
9. **Link type is strictly `involves`**, project id stored as a number, asset id as `asset:<n>` (as the record registry does).
10. **Handoff is a link plus a query word on the asset page**, so Projects imports no Assets code and Assets owns the form. Default description = project name, kind Improvement; the owner changes either.
11. **New shared file `src/core/projectAssetLink.ts`** (not in the brief's file list) so both modules use one definition of the link.
12. **`ledgerPropertyId` is allowed on any asset type** in the data layer (the form offers it for property, vehicle and other).
13. **Transactions are read before the save transaction**, not inside it (section 12).
14. **The project card shows only "paid so far"**, not budget or agreed totals, to avoid inventing a second summary.
15. **Three H2 test lines changed.** H2 used `txnRefs: [1]` as a stand-in for an unknown future field; `txnRefs` is now a known field and junk entries are dropped on read, so those lines use `futureList` instead. Side effect: a malformed `txnRefs` value from another source is dropped (and so removed on the next save), not carried.
16. **Archived assets refuse the project handoff** (restore first), matching H2's rule for new history.

## 18. Known limitations and risks

- Identical-twin split parts (section 6). The picker shows the newest 30 matches (type to narrow). No reverse view from Finance ("which asset is this transaction on"), by design (no `Txn.asset`).
- If a device has not yet received a Finance transaction, its reference reads "not on this device" until sync completes.
- Typed amounts cannot be de-duplicated; the card says they are counted as typed.
- A project's payments are never attributed to individual assets unless the owner links the transactions on a service record.
- Everything in section 14's "NOT browser-verified"; real two-device sync is still untested on real devices.

## 19. Git working-tree status

On `main` at `f101e1b` (= `origin/main`). Nothing committed. Modified: `README.md`, `docs/BACKLOG.md`, `src/modules/assets/{AssetForm,AssetPage,AssetWork,AssetsModule,ServiceForm}.tsx`, `src/modules/assets/{data,model,service,serviceData,validate}.ts`, `src/modules/assets/service.test.ts`, `src/modules/projects/ProjectPage.tsx`. New: the 12 assets files, `src/core/projectAssetLink.ts`, `src/modules/projects/RelatedAssets.tsx` and this report. `package.json`, `db.ts`, `types.ts` and all Finance files: no diff.

## 20. Commit-readiness recommendation

Code is ready for architectural and owner review. Before a commit I would want the owner (or ChatGPT) to rule on judgment calls 1, 3, 4 and 15, and ideally a quick visual pass on a real screen (the one thing I could not do). Suggested order: review, then commit locally, then push only when ready (a push deploys; check the Actions tab for a green run). H4 should not begin until this is approved.
