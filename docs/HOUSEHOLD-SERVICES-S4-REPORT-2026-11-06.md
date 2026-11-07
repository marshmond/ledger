# Household Services S4: cross-module workflows and contract dates. Implementation report

Date: 2026-11-06. Status: **BUILT AND TESTED LOCALLY. NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED.** S5 not started. All data in tests, screenshots and this report is invented (the repository is public).
**FINAL TOTALS after the pre-commit corrections (section 29): 129 test files, 2,194 tests pass.** Sections 1 to 28 describe the first S4 pass; **section 29 supersedes the parts of them it names** (the Calendar layer now also shows expected visits; the Today error is fixed). First-pass totals: **127 test files, 2,166 tests pass** (baseline 122 files, 2,085; 81 new in 5 new files: handoff 24, contract 21, assets and projects 23, two-device and backup 10, privacy and safeguards 3; 3 existing tests edited, see 22). `npx tsc --noEmit` clean. `npm run build` succeeds (the existing chunk-size warning only). `git diff --check`: line-ending notes only. Schema is still Dexie v15. No dependency, `package.json`, `src/db.ts`, `.github`, Tasks, Finance or sync-engine change. Backup format unchanged.

## 1. Executive summary (plain English)

**Home & Assets.** An asset's page now has a **Household services** card listing the standing services linked to it (title, provider name, active, paused or ended, how often, next visit). It is a pointer, never shown as maintenance that happened. On a **completed** visit, **Record maintenance in Home & Assets…** lets you pick the asset, opens the normal Home & Assets service form filled in from the visit, and saves nothing until you press **Save**. Save writes the service record and a link between the two in one step, once. Doing it again for the same asset is refused (and offers the existing entry). The Finance payment links on the visit are carried over as the same payment (no new expense). A typed ("paid outside Finance") amount is **not** copied unless you tick a separate, warned box.
**Replaced assets.** If an arrangement still serves an asset that was replaced, the arrangement page says so and offers **Move to replacement…** with a preview. Only that arrangement's current link changes; old visits keep pointing at the old asset. You can also leave it, edit the assets, or end the arrangement. Nothing moves by itself. The delete preview of an asset now says how many Household Services arrangements mention it.
**Projects.** From an arrangement or a visit you can link a Project (information only). The Project page shows a **Related household services** card. Linking changes no Project money and no payment.
**Contracts.** Each arrangement can hold a **renewal date** and a **notice-by date** (two different dates). They appear as separate markers on a new read-only **Household Services** calendar layer, and as counts on the existing Today card ("1 agreement notice deadline in the next 30 days", "2 renewal dates in the next 30 days"). An ended arrangement stops producing them but keeps its dates. Nothing renews, cancels, repeats or reminds by itself.
**Provider page.** Grouped into current, ended and replaced, completed visits, skipped and cancelled visits, assets, projects you linked, projects where they are a vendor, and documents.

## 2. Repository, S3 SHA and deployment verification

| Check | Result |
|---|---|
| Repository | `origin` = `https://github.com/marshmond/ledger.git`; local `C:\Users\alexm\projects\finance-app`; branch `main`. |
| First check at the start | HEAD `d1737c3` (S3) = `origin/main`, but its Pages run **#64 FAILED** at `npm test` (public Actions annotations: `visits.test.ts:437` compared a finish date to a fixed 2026-11-06 while the code stores the real clock; the run started 04:12 UTC, still the evening of Nov 6 locally). **S4 was stopped there, per the S4 stop condition.** Nothing was written. |
| After the fix | The owner committed the test fix: **`d5cd5f973e6841f0efcae235833b46584ef2ac3d`** (`test(services): make the finished-but-not-logged test independent of the calendar day`) = `origin/main`; Pages run **#65 `success`** (public API; `gh` is not installed). S3 itself is `d1737c3` (run #64 red, superseded by #65). So S3 plus its test fix is committed and deployed. |
| Working tree | Clean when S4 started (after the fix). |
| Dexie / dependencies | Version 15; unchanged. |
| Calendar layer id | `9_000_000_000_000_106` verified unused (ids 101 to 105 only; no other occurrence in `src`). |

## 3. Baseline tests and initial Git status

Initial status: clean. Baseline `npm test`: **122 files, 2,085 passed**; `npx tsc --noEmit` clean; `npm run build` succeeds. (Also run earlier, before the fix, at the same count.)

## 4. Architecture feasibility and code inventory

No stop condition was hit. The handoff is atomic with the existing infrastructure: Dexie runs the Home & Assets record insert and the link write in one transaction (the only Assets change needed was exporting the existing `insertService`). Move to replacement and Project links are single-transaction link edits. No new table, migration, dependency or backend.
**New (src):** `services/contract.ts`, `contractData.ts`, `dueProvider.ts`, `handoff.ts`, `assetLinks.ts`, `projectLinks.ts`, `S4Dialogs.tsx`, `CrossModuleUI.tsx`, `ProjectLinkCard.tsx`, `projects/RelatedServices.tsx`. **New tests:** `s4-handoff.test.ts` (24), `s4-contract.test.ts` (21), `s4-assets-projects.test.ts` (23), `s4-sync.test.ts` (10), `s4-misc.test.ts` (3).

## 5. Reverse Home & Assets implementation (S4-A1)

`loadAssetServices(assetId)` (`assetLinks.ts`) reads the live `serves` links to the asset and returns rows: title, saved provider name (`contactGone` when the Contact is removed), status, cadence text, next visit date (active only). Active first, then paused, ended. A link to a deleted arrangement or one not yet on this device is skipped and counted ("1 linked service is not on this device"). No contact details, notes, links or amounts are in a row (tested). Shown by `AssetServicesCard` on the asset page. No Today item and no reminder is made.

## 6. Completed-visit maintenance handoff (S4-A2)

`handoff.ts`. Eligibility (`handoffEligibility`): outcome `completed` only; skipped, cancelled and unsupported are refused with a plain reason (a fee or payment does not change that). The target asset is chosen by the owner in `HandoffChooser` (linked assets first, then any live unarchived asset); nothing is guessed from names, notes or payments. The chooser opens `#/assets/<id>?fromVisit=<visit id>` (ids only in the address). `AssetWork` re-reads the visit, refuses an archived asset, and opens the existing `ServiceForm` with a prefill (title, date, kind Maintenance, provider if the Contact exists, notes, safe document links, Finance links). The form says where it came from and offers to change anything, including the kind. After Save a panel links to the new entry and the original visit.
**Save (`saveHandoff`)**: validates the Finance references first (read only, exactly as Home & Assets does), then ONE transaction re-reads the visit and asset, checks the outcome is still completed, refuses when this visit already has a handoff for this asset, writes the service record through `insertService` (H2 validation unchanged) and adds the link.

## 7. `recorded-as` link and duplicate protection (S4-A2)

Link: `visit:<id>` to `assets:service:<id>`, type `recorded-as`, through the shared Links store. It is the handoff identity: both sides read it (`handoffsOfVisit`, `visitsOfServiceRecord`). Duplicate key: **visit plus target asset** (a visit may be recorded for two different assets, once each). Overlapping Saves: Dexie serializes them, the second finds the first's link and throws `HandoffExistsError` (tested with three overlapping calls: one record, one link). A link whose service record was **deleted** for that asset does not block and is removed in the same transaction; a link to a record merely not yet on this device is left alone. **Cross-device:** the engine cannot enforce uniqueness. If two devices record the same visit offline, both records and both links are kept; `duplicateHandoffs` raises a review notice on the visit page and as a chip on both Home & Assets entries ("Possible duplicate"). Nothing is merged or deleted (tested with the real `SyncEngine`). On the asset side each entry shows a chip "From Household Services: <visit title>" (a link); judgment call 4.

## 8. Finance reference and manual-payment behavior (S4-A3)

Finance links are carried over by reference (same `pieceKey`); H3 validation (`newRefsProblem`) applies, so a deleted transaction blocks the save and the visit keeps showing it for review. No Finance transaction is created or changed (asserted). A typed amount is **not copied by default**: the prefill offers an **unchecked** box "Also copy the amount typed on the visit" with the warning that two modules would then each hold an amount for one payment, that they are linked so a future household calculation can recognize the pair, and not to tick it if the payment is or will be linked to Finance. The service layer also refuses an equal typed cost that arrives without the tick. A visit with both Finance links and a typed amount (legacy): references win, the typed amount is not offered, a note says so. Later edits are never synchronized: `handoffDivergence` only SHOWS differences (dates, linked payments, typed amounts) on the visit page. No household-wide figure exists in S4 (asserted: no exported name matches a household total).

## 9. Asset replacement and retirement (S4-A4)

`AssetView` gained `status` and `replacementId` (set only when the asset is `replaced` and its `replacedById` is a live, unarchived asset other than itself). The arrangement page shows, per served asset that is replaced, sold, disposed of or archived: "This arrangement still serves a replaced asset." with buttons **Move to replacement…**, **Choose assets…**, **End this arrangement…**, and "or leave it as it is: this notice stays until you decide". A missing or unusable replacement gives a review state and no Move button.
**Move (`planMoveToReplacement`, `applyMoveToReplacement`)**: the preview names both assets and says history is not rewritten. The apply re-reads inside one transaction and refuses (`MOVE_STALE`, nothing written) when the arrangement changed, its `serves` links differ from the preview, the old asset is no longer replaced by that replacement, or the replacement is gone or archived. It removes the old link, adds the replacement link (or only removes if it already serves it), touches the arrangement's `updatedAt` (so an edit form opened earlier is refused and cannot quietly re-link the old asset), and returns a sealed Undo. Historical visits' links are never touched (tested; the mutation that rewrites them fails 3 tests). An ended arrangement is not offered a move. **Undo** uses a new additive `linkOps` on the S2.1 Undo (links added, links removed) and the same sealed state; it is refused if any link on the arrangement changed since, or if the old asset no longer exists (checked before anything is written).

## 10. Asset deletion messaging (S4-A5)

`planAssetDeletion` now also returns `serviceArrangements` and `serviceVisits`, counted from the same live links that `deleteAssetPermanently` removes, only for arrangements and visits that are live. `DeleteAsset` shows: "N Household Services arrangements mention this asset. Their service history will remain, but the link to this asset will be removed." (plus a visit sentence). Verified against the result: the existing deletion removes all links in one transaction (`linksRemoved` equals the links counted); arrangements and visits stay with their provider snapshots. The deletion policy, blocking rules and sync marker are unchanged.

## 11. Projects linkage and reverse Project UI (S4-B)

`projectLinks.ts`: type `involves`, from `arrangement:<id>` or `visit:<id>` to the Project (numeric id, like every other Project link). `linkProject` / `unlinkProject`: one transaction, re-read both ends, refuse (nothing written) when either is gone, sealed Undo, idempotent. `ProjectLinkCard` on the arrangement and visit pages (picker through the Projects record registry, unlink with Undo toast). `RelatedServices` on the Project page lists linked arrangements and visits (title, provider name, status or date), with a missing-record count; no payment, no money, no Project task. A Project that is a vendor relationship creates no link (tested); deleting a Project removes the links through the existing Projects deletion; a link to a soft-deleted Project is listed as "(project no longer exists)" and a new link to a missing Project is refused. Project records, budget, commitments, paid-to-date and every Finance row are unchanged by linking (snapshot test). Replacing the provider keeps the visit's and the old arrangement's Project links and does not link the successor. The provider page separates "Projects you linked to their services" from "Projects where they are a vendor". The three unbuilt items (S4-B3) are not built.

## 12. Contract date model and validation (S4-C1)

`ArrangementData.renewalDate` and `noticeByDate` (`YYYY-MM-DD` or null). Stored only when set (an arrangement without them is stored exactly as before; tested); unknown or unreadable stored values read as none; an older build carries the fields through untouched. Validation blocks only non-real dates. Soft warnings (`contractWarnings`): notice after renewal; passed notice date; renewal date in the past ("Ledger never assumes a yearly renewal"); an ended arrangement keeping its dates (and an ended one is not nagged about passed dates). No yearly repeat, no offset calculation, no term extraction. Edited through the **Contract dates** dialog (`setContractDates`: one transaction, stale-edit refusal, sealed Undo); document links keep working as before.

## 13. Calendar derived layer and fixed id verification (S4-C2)

> **Superseded in part by section 29.1:** the first pass said ordinary visits are not Calendar markers. The owner then expressly approved a rolling 12-month view of expected recurring visits, which is now part of this same layer.

`SERVICES_ID = 9_000_000_000_000_106` (`calendar/model.ts`), seeded with the other built-ins in `ensureCalendarSeed` (once, even run twice at once; tested). `servicesDueProvider` (id `services`, "Household Services"): one marker per date, ids `services:<renewal|notice>-<arrangement>:<date>` (stable, distinct per kind even on the same day), title "Renewal: <title>" or "Notice deadline: <title>", priority medium for notice and low for renewal, past dates `handled`, range filtered, nothing stored, no Task or Calendar event created. Ended arrangements give no markers (paused ones do). Text is the arrangement title only (tested against provider contact, notes, links, account numbers, money). The marker's detail opens the arrangement.

## 14. Today integration (S4-C3)

`attentionCounts(snapshot, today)` adds optional `renewals` and `notices` (today through 30 days ahead, inclusive; each deadline once; separate categories even on the same day; same `contractDeadlines` as the Calendar). `attentionLines` adds "N agreement notice deadline(s) in the next 30 days" and "N renewal date(s) in the next 30 days" after the existing lines, which are unchanged. Counts only (tested for titles, provider, contact, notes, amounts).

## 15. Provider history and navigation (S4-D)

`ProviderPage`: current arrangements; "Ended and replaced arrangements" (end reason, successor link, note that contract dates are kept as history); upcoming visits; assets served; projects you linked; projects where they are a vendor; documents (arrangement document links); existing payment summary (S3, unchanged, not combined across successors); "Completed visits" (by provider at the time) and a separate "Skipped, cancelled and unreviewed visits". Navigation both ways: arrangement to asset (existing), asset to arrangement (new card), visit to Home & Assets entry and back (card and chip), arrangement or visit to Project and back, Calendar marker to arrangement. Missing-record fallbacks are in each reader. No private data in search or addresses (search code unchanged; tested).

## 16. Transactional integrity and guarded Undo

Atomic (single Dexie transaction, re-read inside, refuse stale): handoff (record plus link), Move to replacement, link and unlink Project, contract dates. Sealed-state Undo (S2.1) for Move, Project link and unlink, contract dates; the replace-provider and end Undo already cover the dates. `undo.ts` gained only an additive `linkOps` field and a re-export of `linkSigs`. No unconditional restore and no indiscriminate link deletion: Undo removes exactly the links the change added and re-adds exactly those it removed. The handoff has no Undo (the service record has its own delete); a deleted record leaves a dead link the visit explains and that does not block a new handoff.

## 17. Full cross-module test matrix results (all pass)

1 to 14 handoff: `s4-handoff.test.ts` (prefill and save, cancel writes nothing, skipped and cancelled with fee and payment refused, one-off with explicit asset, missing and archived asset, repeat refused, three overlapping saves, failure injected on the record write and on the link write, Finance links without Finance writes, typed amount omitted, typed amount only with confirmation, restore, both sides). 15 to 20 assets: `s4-assets-projects.test.ts` (several arrangements per asset, one over several assets, ended, replaced provider, missing Contact; flag and preview; Move keeps visit links and arrangement fields; stale preview three ways; failure injection; Undo ok and refused; deletion count and result). 21 to 25 Projects (both sides, vendor is not a link, deleted and missing Project, money unchanged). 26 to 33 contract (`s4-contract.test.ts`, `s4-misc.test.ts`: validation, past and ended, two markers, stable ids, preserved across edit, pause, resume, end and Undo, replacement not copying dates, Today counts, privacy in Calendar, Today and Search). 34 to 42 financial: same piece on both sides (each module counts it once, never summed), whole versus split and refund, invalid reference, typed on one side and on both through opt-in, no Finance or Project writes, S3 and H3 definitions unchanged (their suites pass untouched), no household total exported.

## 18. Two-device synchronization tests (real `SyncEngine`, `s4-sync.test.ts`, 10 tests)

1 A records a handoff while B edits the visit: record, link and B's edit all survive; the two records stay independent. 2 Both record the same visit: both records and links kept, duplicate review on both. 3 A moves an arrangement while B edits it: both devices converge, the arrangement serves something valid, history unchanged. 4 B adds a Project link before A's Undo: Undo refused, nothing restored over it. 5 Project link added on one device and removed or changed on the other: identical result on both, no duplicates. 6 Renewal dates edited on A while B pauses: whole-record last-writer-wins gives ONE valid state on both (**one of the two edits may be superseded**; both orders tested). 7 A replaces the provider while B reads the predecessor's dates: B sees them until sync; afterwards they stay on the ended predecessor and the successor has none. 8 One device deletes an asset while the other logs a visit against it: the deletion holds, history kept, the dangling link reads as a missing asset. 9 A Finance transaction referenced on both sides changes on B: both modules show the new live amount, each once. Whole-record last-writer-wins is relied on, never promised to merge.

## 19. Backup and restore results

Test 10 (`s4-sync.test.ts`) uses the real G1 export, file checker and restore into a separate database, twice: every table equal; arrangement-to-asset, visit-to-Project, arrangement-to-Project and `recorded-as` links; the replaced-asset relationship; renewal and notice dates; Finance references; typed amounts; an unknown field on an arrangement; predecessor and successor; readers work; no duplicate service record or link. No backup-format change.

## 20. Mutation and rollback testing

12 mutations applied one at a time, tests re-run, file restored (script in the scratchpad, not in the repository), all caught: remove completed-only eligibility (2 failed); disable the duplicate guard (2); remove the atomic transaction (2); copy a typed amount without confirmation (1); rewrite historical visit links in Move (3); let a stale Undo restore older links (3); duplicate Calendar renewal markers (7); count ended agreements as upcoming (4); linking a Project also writes the Project record (1); drop the stale-preview check in Move (1); replace provider copies contract dates by default (3); Today counts notice and renewal as one (1). "Add Services payments into Project spending" has no code path to mutate (nothing here reads Services money into Projects), so the nearest meaningful mutation (a money-side write on link) was used. Final full run after restoring: green. Rollback: the two injected-failure tests (record write, link write) and the Move failure test prove nothing partial remains.

## 21. Browser verification (real browser pane, invented data, the pane's own database; not a real device)

Done, desktop (pane ~1024 px): asset page card; completed-visit chooser (linked assets first); prefilled form (cost blank, nothing saved); Escape cancels and nothing is written (checked in the database); Save (success panel with both links, one `recorded-as` link); visit page shows "Recorded for ..."; repeat attempt disabled ("already recorded"); skipped visit shows no button; replaced asset notice, preview, Move (old visit keeps its link; Undo toast shown); Project link from the arrangement, Project page card; contract dates dialog (notice-after-renewal warning, then save); Calendar agenda (new "Household Services (auto)" layer, "Notice deadline" and "Renewal" markers, detail with "Open arrangement", which navigates); Today counts alongside the existing lines; End arrangement (dates kept, no markers). **375 px, dark mode:** no horizontal overflow on arrangement, visit, asset, project, provider, Calendar and Today pages; the handoff form and arrangement Contract and Projects sections viewed; typed-amount box unchecked by default and masked ("$••••") under **Hide Amounts** (no digits in the dialog); Escape closes the form. Main action buttons measured: only existing shell controls are under 36 px.
**NOT verified:** light mode of the new sections at 375 px; the Move and Contract dialogs at 375 px (desktop only); a keyboard-only Tab walk; screen reader; Hide Amounts on every new text; the Replace-provider tick box on screen; real devices, offline, a second real device. **Console:** one error source not from S4: Ledger's own Today attention card fails in this browser profile because an older test account ("Demo checking") has no opening date (`budget.ts`, untouched by S4; not reproduced by any test). Worth a separate look: a synced account without an opening date would do the same.

## 22. Existing-module regression testing

Full suite 127 files, 2,166 passed. H1 to H5 (Home & Assets 252 tests), P1 to P5, S1, S2, S2.1, S3 (and its corrections), G1 (28 backup tests including encrypted restore) all pass. Three existing tests were edited, none weakened: `calendar.test.ts` and `sync.test.ts` (two assertions) now expect six built-in calendars; the layer is the intended change. Tasks recurrence and semimonthly scheduling are untouched (no change under `src/modules/tasks` or `schedule`/`semimonthly`).

## 23. Complete created and modified file list

**New:** the 10 source and 5 test files in section 4; this report. **Modified (src):** `assets/AssetPage.tsx`, `AssetWork.tsx`, `DeleteAsset.tsx`, `ServiceForm.tsx`, `assets.css`, `deletion.ts`, `serviceData.ts` (one word: export); `calendar/data.ts`, `model.ts`; `projects/ProjectPage.tsx`; `services/ArrangementPage.tsx`, `Dialogs.tsx`, `ProviderPage.tsx`, `VisitPage.tsx`, `changes.ts`, `index.tsx`, `model.ts`, `services.css`, `todayCards.tsx`, `undo.ts`, `views.ts`; tests `calendar/calendar.test.ts`, `lib/sync/sync.test.ts`. **Docs:** this report, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `docs/module-hooks.md`, `README.md` (one sentence). Nothing else: no `package.json`, lockfile, `src/db.ts`, `.github` or config change.

## 24. Architectural deviations and numbered judgment calls (please review)

**Deviations from S0:** (a) S0 8.2 says a prefilled record is marked "in its notes"; I show the origin as a chip and a note in the form from the live link instead, so nothing is written into the owner's notes and the mark cannot be lost by editing them (call 4). (b) S0 puts the delete sentence under S4: done in `deletion.ts` and `DeleteAsset.tsx`.
1. Visits have no kind. Eligibility is "completed" plus an asset the owner chooses; the form defaults to Maintenance and the owner can change it. No guess from title or notes.
2. The duplicate key is visit plus asset: one visit may be recorded for several assets, once each.
3. Notes are copied only when `notesWarning` is quiet and they fit; document links only when safe and within Home & Assets limits.
4. Source indication by link (chip and form note), not text in notes.
5. A deleted service record's dead link does not block a new handoff and is removed in that transaction; a link to a record not yet on this device is left alone.
6. Cross-device duplicates are detected and flagged, not prevented (the engine cannot).
7. `insertService` exported from `assets/serviceData.ts` (the one Assets code change besides the UI and delete preview) so the record and link share a transaction.
8. The typed-amount guard compares the cost to the visit's typed amount; a different amount typed by the owner is their own number.
9. Move touches the arrangement's `updatedAt`; Undo watches the arrangement and its links (not the asset records, so renaming an asset does not block Undo) and is refused if the old asset is gone.
10. Move is offered only for a non-ended arrangement and a live, unarchived replacement; a replacement that was itself later sold or replaced is still offered (the owner sees its status).
11. A paused arrangement keeps its contract deadlines; an ended one produces none and no past or "historical" markers (dates stay on its page).
12. Calendar priority: notice medium, renewal low; titles as in 13.
13. Today window: today through 30 days inclusive; passed dates are not counted; notice line before renewal line.
14. Contract dates are edited in their own dialog, not in the Add or Edit forms, and not by Quick Add.
15. Replace provider copies dates only on an explicit tick (default off); the successor is never linked to Projects automatically.
16. Project links run from the services record to the Project (`involves`), Undo through the sealed state.
17. Asset deletion counts only live arrangements and visits; the sentence is shown in the deletable branch.
18. `AttentionCounts.renewals` and `notices` are optional so earlier callers and tests are unchanged.
19. The provider page's Documents section lists arrangement document links only (not every visit's).
20. S3's deploy failure (run #64) was a date-dependent test in S3's own suite; fixed by the owner in `d5cd5f9`.

## 25. Remaining limitations and deferred functionality

Not built, by design: S5 household-wide deduplicated total (the `recorded-as` link is ready for it); advanced Insights and full Overview; duplicate-visit resolution; seasonal scheduling; holiday calendars; Bills and Subscriptions; Finance scheduled-payment linking; automatic renewal, cancellation or yearly repetition; contract text extraction; AI; a general Contacts CRM; convert-visit-to-Project and the reverse; automatic Project creation or budgeting; extra Calendar events for visits. Limits: a handoff cannot be undone from the toast (delete the record in Home & Assets); no bulk handoff; no divergence repair; real-device checks outstanding for Home & Assets and Household Services; section 21 NOT-verified list; whole-record last-writer-wins can supersede one of two concurrent edits to the same arrangement.

## 26. Handoff and backlog updates

Handoff updated: **yes** (header, snapshot, S3 deployment facts including the red run #64 and green #65, S4 section, risks, next action, change log; S3 recorded as committed and deployed; S4 as built locally and uncommitted; S5 not started; outstanding real-device checks). Backlog updated: **yes** (S4 entry on top). `docs/module-hooks.md` updated (S4 hooks, link types, the sixth Calendar layer, Today lines). `README.md`: one sentence. Unknown: nothing beyond the NOT-verified lists.

## 27. Final Git status

Branch `main`, `HEAD` `d5cd5f973e6841f0efcae235833b46584ef2ac3d` = `origin/main`. **Nothing staged.** Modified: 23 source and test files plus four docs; untracked: 10 source files, 5 test files and this report. Not committed, pushed, merged or deployed.

## 28. Commit-readiness recommendation

**Ready for independent review.** All S4-A, B, C and D requirements are implemented and automatically tested; the browser checks cover the eleven required workflows with the gaps stated in section 21. Please review judgment calls 1, 2, 4, 7, 9, 11 and 14 first, and the unrelated console finding. No commit, push or deployment will happen without your explicit say-so; after a push I will check the Actions run and report the SHA and result. S5 has not been started.

## 29. FINAL PRE-COMMIT CORRECTIONS (2026-11-06, after ChatGPT's review of the first S4 pass)

Two items. Nothing was staged, committed, pushed or deployed; S5 not started; the completed S4 work (handoff, `recorded-as` linkage, replacement workflow, Project links, contract dates, provider history, Undo and sync safeguards) was not rewritten. Dexie is still v15, no dependency, backup format unchanged. **Final totals: 129 test files, 2,194 tests pass** (first pass 127 and 2,166; 28 new: 23 Calendar, 5 legacy account). `npx tsc --noEmit` clean, `npm run build` succeeds (chunk-size warning only), `git diff --check` line-ending notes only. The Services suite (519 tests) also passes under `TZ=Pacific/Kiritimati` and `TZ=America/Los_Angeles`; the Calendar and contract files also under `TZ=UTC`.

### 29.1 Rolling 12-month expected visits on the Calendar

**Finding that shaped the design.** The existing Tasks Calendar layer shows ONLY the single open Task's date. It does not expand repeats. So before this correction the Calendar showed one future visit per arrangement, for biweekly and twice-monthly alike.

**Architecture (no new recurrence engine, nothing stored).**
- `src/modules/services/plannedVisits.ts` (new, pure): `plannedVisitDates(arrangement, scheduleState, today, from, to)` returns the expected dates through the existing `cadenceBetween`, so every-N-weeks, monthly and the S3 twice-monthly adapter (with its leap-year, short-month and weekend rules) are the one source. `ScheduleState` is the existing `scheduleStateOf` from the S3 estimate code.
- `src/modules/services/dueProvider.ts` (extended): the same read-only "Household Services" layer now emits three kinds of entry: renewal, notice and **expected visit**. It reads the arrangements and the visit Tasks (one pass over the links) and writes nothing.
- **Single-next-actionable-Task model preserved.** The open visit Task is still THE next visit and is shown by the Tasks layer. Expected-visit entries start strictly AFTER it, exactly as the real scheduler (`nextAfterVisit`) does when a visit is logged: later dates are the cadence's own dates after BOTH the open Task's date and the date it stands for, after any visit already finished (logged or not), and never before today. This is how a moved visit, a visit finished in Tasks and not yet logged, and a visit already represented by its Task never appear twice.
- **Decision on the Tasks integration (rule 11):** the Tasks provider is unchanged and shows the one open Task; the Services layer shows the rest, starting after it. Chosen over changing Tasks (out of scope) and over making the Task itself repeat visibly (that would create stored copies). Documented in code and in `docs/module-hooks.md`.
- **Identity:** `services:visit-<arrangement id>:<date>`. Renewal and notice keep `services:renewal-...` and `services:notice-...`; the three kinds cannot collide (tested: the three entries of one day have three distinct ids).
- **Horizon convention (documented and tested):** from today through the same day-of-month 12 calendar months later, BOTH ends included, clamped to the month length. Today 2026-11-06 gives 2027-11-06; 2028-02-29 gives 2029-02-28. It is computed from the date the Calendar asks with, so it moves forward with the clock with no write and no stored occurrence. Dates before today are never produced (history stays the visit records). Normal Calendar range filtering still applies (single day, week, month and agenda ranges tested).
- **Display:** the title is the same wording as the visit Task ("House cleaning: Rosa's Cleaning"); the assigned time is shown on every expected visit (all day when there is none); priority low; status always open and no actions (read only; the detail text says it is not a task and nothing marks a visit done). No phone, email, notes, link, account number or amount (tested). Calendar and Today rendering, Hide Amounts and accessibility conventions are the shell's own and unchanged; the entries carry no money.
- **Not produced:** paused, ended and on-demand arrangements (their history is untouched; a resumed arrangement shows them again), a schedule "after each visit" (its dates depend on when each visit is done), and a damaged schedule (it reads as none).

**Limitation stated, not hidden (single-occurrence changes).** An arrangement does not persist a FUTURE one-off skip or cancellation (a skipped or cancelled visit is only logged afterwards, and the Task then moves on). So a future single occurrence that the household already knows will not happen cannot be removed from the expected list in advance; it stays until that visit is logged as skipped or cancelled. A visit MOVED once is handled correctly (it is the open Task's date). Smallest safe approach if wanted later (NOT built): an explicit "skip this date" list on the arrangement (a few dates, additive, with Undo) that the derived layer subtracts. It adds a stored field and a screen, so it needs its own approval.

**Observed results (browser pane, invented data; "today" in the pane was 2026-11-07):**
- Biweekly cleaners on Fridays at 9:30 (open Task 2026-11-13): 25 expected Fridays from 2026-11-27 to 2027-10-29, plus the open Task, so 26 occurrences inside the horizon (the next, 2027-11-12, is beyond it). 14 days apart across the year end (Jan 8 and Jan 22, 2027 seen in the month view). Every one shows 09:30.
- Twice-monthly lawn crew (15th and last business day; open Task 2026-11-15): 23 expected dates from 2026-11-30 to 2027-10-29; Dec 31 2026 and Jan 29 2027 (last business days) seen in the month view.
- **One actionable Task per arrangement:** the open-Task count was 1 for each, before and after every read; the Tasks layer showed exactly those 2 Task dates.
- **Clock advanced 28 days with no write:** the far end of the cleaners' window moved from 2027-10-29 to 2027-11-26; the database counts (89 records, 36 links) were identical before and after.
- **Moved visit:** the Friday 2026-11-13 Task moved to Sunday 2026-11-15: the expected dates were identical before and after (first two 2026-11-27 and 2026-12-11), the arrangement's anchor stayed 2026-11-13, the agenda showed the moved Task on Nov 15 and nothing on Nov 13.
- **Renewal and notice markers intact** (Notice deadline Dec 10 and Renewal Dec 17 in the December month view).
- **No duplicates:** over a 400-day query of every provider, 52 entries for the demo arrangements (2 Tasks, 48 expected visits, 2 contract markers): 0 repeated title-and-date pairs and all ids unique; the December month view showed one cleaner entry on each of Dec 11, Dec 25 and Jan 8.
- **Browser matrix:** Calendar month, agenda, week and Today at desktop (light and dark) and 375 px (light and dark): no horizontal overflow in any; month and agenda screenshots checked; no new console errors.

**New tests (`s4-calendar.test.ts`, 23):** horizon convention with clamps; biweekly 12 months with parity across the year end; the 1st and 15th; the 15th and last business day over February (non-leap and leap), short months and weekends, and equality with the S3 adapter; assigned time; boundary day included and the next day excluded, single-day, month, history and beyond-horizon ranges; a moved visit (to Sunday, past the next date, earlier); an occurrence represented by the open Task (no date shown twice, one open Task); finished-not-logged (repeating, and twice-monthly finished early); same-day renewal, notice and visit (three distinct ids); pause, resume, provider replacement and end (history still writable); after-each-visit, on-demand and damaged schedules produce nothing; a schedule end date; clock advance with no write (row counts and update times unchanged); reading creates no reminder, Task, Event, visit or Finance row; privacy; backup and restore gives identical entries; arrangements without S4 fields; contract edits do not change expected visits; calendar-only date arithmetic; nothing before today even with no Task; the pure function refuses paused, ended, on-demand and "after" schedules; two real-`SyncEngine` devices show identical entries and a moved visit shifts nothing on either. **Modified:** `s4-contract.test.ts` (one superseded assertion replaced: "ordinary visits are not derived markers" is no longer the rule).
**Mutation checks (9 applied, each restored, final run green):** start at today instead of after the open Task (10 tests failed); no horizon clamp (8); paused and ended allowed in the pure function (1); visit ids collide with renewal ids (14); horizon 11 months (9); ignore the date the Task stands for (1); ignore a finished-not-logged visit (1); allow dates before today (1). One mutation (non-active arrangements let through in the provider's own filter) is an **equivalent mutant**, because the pure function guards the same condition again. Three of these were first NOT caught, which exposed test gaps; the tests were strengthened and the mutations rerun.
**Compatibility:** the layer is derived and stored nowhere, so older builds are unaffected (they simply do not draw it); no schema, sync or backup change. **Real devices, a second physical device, offline use and a screen reader were not tested.**

### 29.2 The unrelated Today error: diagnosis and fix

**Reproduced** with invented data (`src/lib/legacyAccount.test.ts`, 5 tests; the first four failed with "Cannot read properties of undefined (reading 'slice')" before the fix) and in the browser pane with its older "Demo checking" account.
**Root cause:** `computeBudget` (`budget.ts`) built its list of months from `monthOf(a.openingDate)`, and `trailingAnnualSpending` (`retirement.ts`) did the same. An account with no `openingDate` made `monthOf(undefined)` throw. The Today "Ledger attention" card and the budget page both read the budget, so both stopped.
**Is it a valid state?** The `Account` type requires `openingDate`, and the only creation paths (the Accounts page and the loan ledger) always write it, so normal use does not produce this state. It can arrive from a restored or hand-edited backup (restore does not check account fields) or an older or foreign record; the pane's profile had one from earlier test data. So it is an incomplete-data state worth tolerating, **not a production-wide failure**. When it happened, only that card showed the shell's "card failed" fallback and the rest of Today kept working.
**Fix (smallest, one guard in each of two places):** both now skip an account whose opening date is not a string. **No date and no opening balance is invented and no calculation changed:** the dateless account's opening balance has no date, so the existing comparison (`openingDate <= end`) leaves it out exactly as before; its own transactions still count (tested); every other figure equals the same code run without that account (tested); an account with a date behaves exactly as before. The budget, phase 5 and retirement suites pass untouched.
**Browser:** after the fix, `loadBudget` ran on the pane's real data (cash and 10 rows returned) and the Today "Needs attention" card rendered its content; the three old console entries do not grow after a reload.
**Remaining:** other screens may still show "undefined" text for such an account (for example the account page's "Opening ... on undefined"). A fuller fix would validate accounts when a backup is restored. Not changed here.

### 29.3 Documentation corrections

Stale statuses corrected in the handoff, backlog and this report: **S3 (`d1737c3`) and its test fix (`d5cd5f9`, Pages run #65 success) are committed and deployed; S4 is locally implemented and uncommitted; S5 is not started.** `docs/module-hooks.md` updated for the Calendar contract change (the layer now carries expected visits).

### 29.4 Files changed in this correction

**New:** `src/modules/services/plannedVisits.ts`, `src/modules/services/s4-calendar.test.ts`, `src/lib/legacyAccount.test.ts`. **Modified (src):** `src/modules/services/dueProvider.ts` (expected visits added), `src/lib/budget.ts`, `src/lib/retirement.ts`; test `src/modules/services/s4-contract.test.ts` (one assertion). **Docs:** this report, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/module-hooks.md`. No change to Tasks, Finance calculations, sync, backup, schema or dependencies.

### 29.5 Unresolved issues

1. Future single-occurrence skips or cancellations cannot be recorded in advance (29.1; needs approval for a stored "skip this date" list).
2. A schedule "after each visit" shows only its one open visit.
3. A dateless account can still show odd text on a few screens (29.2); the crash is fixed.
4. Still NOT verified: real devices, a second physical device, offline, a screen reader, a keyboard-only Tab walk, and light mode of the earlier S4 dialogs at 375 px (the Calendar itself was checked in both themes at both widths). Home & Assets and Household Services real-device acceptance remain outstanding.

### 29.6 Final Git status

Branch `main`, `HEAD` `d5cd5f973e6841f0efcae235833b46584ef2ac3d` = `origin/main`. **Nothing staged. Nothing committed. Nothing pushed.** 48 changed paths: 29 modified and 19 untracked (new files). Final totals: 129 test files, 2,194 tests pass; tsc, build and diff check clean.
