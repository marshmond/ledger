# Home & Assets H4: Warranties and asset lifecycle (report)

Date: 2026-11-06. Status: built and tested, **not committed, not pushed**. H5 is not started.

## 1. Executive summary

An asset can now have several warranties (with provider, dates, coverage, claim notes and document references), warranty end dates appear on a new read-only Calendar layer "Home & Assets", and the Status and Replace flows are real workflows: a two-step review before anything changes, a choice for every open task (keep, move, stop repeating, delete), a previewed "include everything inside" option for selling a property, a "Past" list split by sold / disposed of / replaced, and a "Needs attention" card that finds and repairs records pointing at a missing asset. **1,585 tests pass** (was 1,521; 64 new), `tsc --noEmit` clean, build clean. No schema, backup-format, sync-format or dependency change; no Finance, Projects, Tasks or Contacts source file edited.

## 2. H3 deployment and prerequisite checks

1. H3 `30118dd` equals `origin/main` (`git fetch`, same hash).
2. GitHub Actions for `30118dd`: **completed, success** (public Actions API; the `gh` tool is not installed here).
3. Working tree clean before starting.
4. Baseline: 97 files, **1,521 tests pass**.
5-8. Read H0 sections 7.2, 8.1, 9 and 10 (H4), the H1-H3 reports, the asset, deletion, service, Tasks data, recurrence, link and Calendar provider code, and the sync deletion rule. Differences between H0 and the real code are listed in section 17.

## 3. Features versus the H4 scope

| Scope item | Result |
|---|---|
| 1 Several warranties per asset | Built (`kind: 'warranty'`, no schema change) |
| 2 H1 fields still work | Built (implicit warranty, never written) |
| 3 Provider and documents | Built (shared Contacts, http/https links only) |
| 4 Calendar expiry markers | Built (layer id `9_000_000_000_000_105`) |
| 5 Retirement and replacement | Built (one dialog for Status and Replace) |
| 6 Open-task handling | Built (4 choices, all in one transaction) |
| 7 Previewed bulk retirement | Built |
| 8 Past-assets navigation | Built (Past sub-filters, dates, links both ways) |
| 9 Orphan detection and repair | Built |
| 10 Deletion and sync safeguards | Extended and tested with the real sync engine |
| 11 Automated and browser checks | Done (browser: see 14) |

## 4. Files

Created in `src/modules/assets/`: `warranty.ts` (pure reader, validation, status, implicit warranty), `warrantyData.ts`, `dueProvider.ts`, `lifecycle.ts`, `orphans.ts`, `WarrantyCard.tsx`, `WarrantyForm.tsx`, `LifecycleDialog.tsx`, `OrphanCard.tsx`, and tests `h4-warranty.test.ts`, `h4-lifecycle.test.ts`, `h4-sync.test.ts`.
Modified: `data.ts` (`warrantyState` reads warranty records), `records.ts` and `searchSource.ts` (warranties), `index.tsx` (registers the due provider), `AssetPage.tsx`, `AssetsPage.tsx`, `AssetForm.tsx` (one hint line), `h3.css`; `calendar/model.ts` and `calendar/data.ts` (one constant, one seeded layer); tests `calendar.test.ts` and `sync.test.ts` (four built-in layers became five, nothing else weakened).
Deleted: `RetireDialog.tsx` (replaced by `LifecycleDialog.tsx`). `deletion.ts`, `model.ts` and `lib/sync/assetDeletion.ts` are unchanged: `ASSET_DEPENDENT_KINDS` already listed `warranty` (written that way in H1), which is why the guard and the sync rule cover warranties with no edit.

## 5. Warranty data model and H1 compatibility

Fields as in H0: `assetId`, `title`, `startDate`, `endDate`, `providerContactId`, `coverageNotes`, `claimInfo`, `refs`; unknown fields are kept on read and write. Limits: title 120, notes 2,000, 20 documents, 20 warranties per asset. Real dates only; end not before start; http/https links only; a missing provider is shown as "(contact removed)" and an unchanged one is not an error on edit. No end date is allowed (status "No expiration recorded", no Calendar marker). An edit cannot move a warranty to another asset (only orphan repair can).

Status: end day is still covered; within 60 days (counting the end day) is "Expiring soon"; the day after is "Expired".

**H1 fields:** if an asset has no live warranty record, its `warrantyEndDate`/`warrantyNote` read as ONE implicit warranty ("From the asset's details"). Any live record replaces it (never both). Nothing is written by opening a page. The implicit row offers "Make this a warranty record" (form prefilled, saves nothing until Save, old fields untouched). **Removal rule (decision requested):** deleting the last record makes the old fields show again; the delete confirmation says so and offers a box "Tick to clear it as well" (explicit, never automatic). Tested both ways. The list badge uses the same logic (nearest upcoming end wins, else latest ended; only for assets In use).

## 6. Calendar

Fifth built-in layer "Home & Assets", fixed id `9_000_000_000_000_105` (checked: 101-104 were the only ids in use, no conflict). Read-only provider, stable item ids `assets:warranty-<id>:<date>` (or `asset-<id>` for the implicit one), one marker per warranty, title "Warranty ends: Dishwasher — Extended protection" (asset name and warranty title only; tested against serial, notes, make). Past end dates are `handled` (never Overdue). Archived, sold, disposed and replaced assets show no markers; stored and in-use assets do (history stays on the asset page). Maintenance stays on the Tasks layer only (tested that no duplicate appears). Provider is two indexed reads and writes nothing (tested by comparing the table before and after).

## 7. Replacement workflow and atomicity

"Replace…" on the asset page (and Status → Replaced). Choose an asset you already have, or create a new one. A new one gets only name, type and place (Where defaults to the same parent; the old asset and what is inside it are not offered); serial/VIN, plate, address, warranty, price, dates and history are never copied (tested, also when the form tries to). The review step lists exactly what will change. `applyRetirement` is one Dexie transaction over `moduleRecords` and `links`; it re-reads everything, and throws (changing nothing) if the asset, the replacement, an included asset or a chosen task is missing or changed, if the replacement is itself or loops (H1's `validateAsset` is reused), or if the asset was already replaced and a second NEW replacement is requested (so a double submit makes one asset; tested with two simultaneous calls). Rollback is tested (new asset not left behind when a later task step fails).

## 8. Open tasks

Preview lists the open linked tasks; default **Keep linked**. Move: only the shared link changes (the task record is not written, so its completions and repeat stay; the next repeat follows the moved link; no duplicate task or link). Stop repeating: Tasks' own `saveTask` with `repeat: null`. Delete: Tasks' own `removeTasks` (soft delete). Move is disabled with no replacement and for tasks attached to something inside the asset. No Tasks API change was needed. Completed tasks and service history stay with the old asset. Any failure rolls back everything.

## 9. Bulk retirement

Offered for stored / sold / disposed only. The review shows the number and names of what is inside, each item's current status, which are ticked, and how many open tasks remain un-handled for un-ticked items. Default: only the selected asset. Items already out of use are shown and left alone. Everything applies atomically; a stale tick (item moved or already retired) fails the whole thing. Parents are never changed, so no cycle is possible. For a replacement, inside items are never included (they have no replacement); the dialog says so.

## 10. Past assets and navigation

Past tab has sub-filters All / Sold / Disposed of / Replaced; rows show status, date and "replaced by X"; Stored and Archived stay their own tabs. A retired asset page shows a banner (status, date, note), the replacement link, "Replaces X" on the new asset, and keeps Warranties, Spending, Service history and Related projects. Search keeps retired assets (ranked below in-use ones, labelled with their status); warranty hits do the same.

## 11. Orphans

Detected (read-only): service records, warranties, "replaced by" pointers, and shared links from Tasks, Events and Projects whose asset is not live. Each says why: deleted permanently, removed, or "this device has no record of it (sync may still deliver it)". Repairs are per record: Re-home (target checked inside the transaction; archived targets refused for service/warranty), Delete record / Clear the link / Remove the link, or leave it. "Absent" orphans need an extra tick "I have synced my other devices". Tasks, events and projects are never edited; only the shared link is moved or removed. Finance references inside a service record are never touched when it is re-homed. Replacement re-home reuses `validateAsset` (loops refused). A repair re-checks the asset first and refuses if it has arrived meanwhile.

## 12. Deletion and sync

A live warranty blocks permanent deletion and keeps an asset alive across devices (existing rule, now tested for warranties; mutation check: with `warranty` removed from the dependent-kinds list 5 tests fail, restored: all pass). Real two-device tests: warranty vs metadata edit; warranty on a stale device vs permanent deletion (before and after); warranty edited on both devices; replacement offline vs an older edit (both orders; the new asset always survives and no pointer dangles); two conflicting replacements (one pointer wins everywhere, both new assets kept); bulk retirement vs a later rename of a child (each record keeps its own last writer; documented); orphan repair then sync; asset temporarily missing (reported as "absent", nothing changed, resolved by a full copy); backup restore and intentional revival.

## 13. Tests

New: `h4-warranty.test.ts` 29, `h4-lifecycle.test.ts` 25, `h4-sync.test.ts` 10 = 64. Full suite **1,585 pass**, `npx tsc --noEmit` clean, `npm run build` clean. Items 1-24 of the brief are each covered (22: Finance tables compared before and after; Projects untouched; 24: all H1-H3 tests unchanged and green except the two intentionally updated layer counts).

## 14. Browser verification (Browser pane, invented data written straight into the pane's own throw-away database; the pane's storage is separate from the owner's browser)

Done: implicit H1 warranty shown once; added a warranty (status "Expiring soon", badge changed, implicit hidden); Calendar layer and marker, marker detail and Open asset, deep link expands the warranty; Replace with a new asset (review text, task moved, old asset keeps service history and shows the link, new asset shows "Replaces" and the task); Status → Sold with two of four inside items ticked and the review text; Past tab; an orphaned service record found, Re-home resolved it; global search finds the warranty (labelled Replaced, no notes or serial) and Enter opens it; deleting the last warranty shows the old-date notice and the old date returned; 375 px: no sideways scroll on five screens, no target under 40 px in the dialog; dark theme contrast of the "Expiring soon" chip 8.6:1; Escape closes the dialog without saving; no console errors.
**Not done:** editing (not deleting) a warranty and the document rows in the browser; the "clear old fields" tick in the browser (unit-tested); Delete task and Stop repeating in the browser (unit-tested); keyboard-only run of the whole flow and screen reader; the Undo toast; two real devices; offline. Screenshots were taken for the Replace dialog, review, Calendar, orphan card and search.

## 15. Finance, Projects, Tasks regression

Finance tables compared before and after replace and warranty writes: identical. No Projects file edited; all existing Projects and sync tests pass unchanged. Task recurrence suites pass; moved and stopped tasks tested for next-repeat behaviour.

## 16. Backup and compatibility

Dexie stays 15 (asserted in a test). Warranties are ordinary `moduleRecords`, so backup, restore and sync carry them (restore tested). An older build ignores warranty records (shown as nothing) and keeps the H1 date. Every device needs the H4 build before the new Calendar layer appears there (the layer seed is the same check-then-insert as before).

## 17. Judgment calls and deviations from H0 (please review)

1. Deleting the last warranty record shows the older simple warranty again, with an opt-in "clear it too" box (see section 5).
2. A warranty cannot be added to an archived asset (same as service history); retired assets accept them.
3. Stored assets keep their Calendar markers; archived, sold, disposed and replaced lose them.
4. "Expiring soon" is within 60 days, matching the H1 badge.
5. Replacement keeps only name, type and place for a new asset; make and model are not copied (a replacement usually differs).
6. "Include everything inside" is offered for stored/sold/disposed, not for replaced.
7. Task choices apply only to tasks in the retire scope; "Move" is only for tasks linked to the asset itself.
8. "Stop repeating" on a task that no longer repeats does nothing (counted as nothing).
9. Re-home refuses archived targets for service and warranty records (links may go to any asset).
10. The orphan "replacement" repair offers Re-home and "Clear the link" (the asset stays Replaced, with no replacement recorded).
11. The H1 "Warranty ends" line in Details was removed; the Warranties card is the one place (the implicit one is shown there).
12. No "start from purchase date + N years" helper (H0 suggested one; not in the H4 scope).
13. Parent-of-an-asset orphans stay as H1 shows them ("place removed"); not added to Needs attention.
14. A warranty hit appears in the Add-box record picker only when text is typed (same as service records).

## 18. Known limits and deferred

Not built: warranty claims, recall lookups, automatic start dates, Today card and overview (H5), warranty Quick Add. If a task is linked to several assets, "Delete task" deletes it for all. Two devices that both replace the same asset keep both new assets (one pointer wins; the other new asset remains and can be archived). Last-writer-wins applies per record (documented). Re-home cannot change the asset of a service record whose Finance links belong to another asset's spending (the owner decides).

## 19. Git status

Modified: 12 files; new: 12 files; deleted: 1 (`RetireDialog.tsx`, staged by `git rm`). Nothing committed or pushed. `package.json`, `src/db.ts`, backup and sync libraries are unchanged.

## 20. Commit-readiness

Ready for owner and architectural review. Before pushing: decide judgment calls 1, 3 and 11; run the checklist items marked "Not done" in section 14 on a real phone and with two real devices. Pushing publishes the app (Pages deploy), so check the Actions tab afterwards.

## 21. Final follow-up (same day, after architectural review)

**1. Shared-task deletion warning.** Checked first: no such warning existed (section 18 only noted the limit). Added, narrowly: `planRetirement` now returns `sharedWith` (for each open task also linked to other assets, the names of those assets, public labels only). When "Delete task" is chosen for such a task, the dialog shows an inline alert naming the other assets and saying deletion removes it for every one of them, and the review step repeats it as a "WARNING" line. Only assets other than the one being retired are named. Tasks' ownership and deletion semantics are unchanged (still `removeTasks`). Regression test in `h4-lifecycle.test.ts`: names listed, solo tasks not flagged, warning only for Delete, and the shared task is really deleted for the other asset afterwards. The inline alert was not checked in a browser; the plan data and review text are unit-tested.

**2. Permanent ChatGPT handoff.** **Missing.** `docs/CHATGPT-HANDOFF.md` does not exist (never in Git history) and root `CLAUDE.md` has no handoff instruction. The handoff materials the owner supplied earlier are not available to this session (not in the repository and not in this conversation), so nothing was installed or invented. Request: please re-send the original handoff procedure/materials; I will then install the file and the `CLAUDE.md` rule and fill in the status items (H1-H3 deployed, H4 pending, decisions, limits, H5 next, test baseline, outstanding checks, AI roadmap).

**3. Final verification.** Full suite **1,586 pass** (100 files; one new test), `npx tsc --noEmit` clean, `npm run build` clean. Against `HEAD`: no change to `package.json`, lockfile, `src/db.ts`, `src/lib` (apart from one test, `sync.test.ts`, expecting five built-in Calendar layers instead of four), Finance, Projects, Tasks or `src/core`. Dexie version still 15 (asserted by a test); backup and sync format untouched.

**Remaining limitations:** unchanged from sections 14 and 18, plus the handoff item above.

**Git working tree** (nothing committed): modified `docs/BACKLOG.md`, `src/lib/sync/sync.test.ts`, `src/modules/assets/{AssetForm,AssetPage,AssetsPage}.tsx`, `data.ts`, `h3.css`, `index.tsx`, `records.ts`, `searchSource.ts`, `src/modules/calendar/{calendar.test.ts,data.ts,model.ts}`; deleted (staged) `src/modules/assets/RetireDialog.tsx`; new: this report, `LifecycleDialog.tsx`, `OrphanCard.tsx`, `WarrantyCard.tsx`, `WarrantyForm.tsx`, `dueProvider.ts`, `lifecycle.ts`, `orphans.ts`, `warranty.ts`, `warrantyData.ts`, `h4-lifecycle.test.ts`, `h4-sync.test.ts`, `h4-warranty.test.ts`.

**Handoff (follow-up 2, same day).** The owner supplied the materials. Installed: `docs/CHATGPT-HANDOFF.md` (already reflects H1-H4 status, decisions, limits, H5 next, test baseline, outstanding checks, AI roadmap and the maintenance rule; I updated its in-flight status, blocker line, change log and next action), and the standing rule appended to root `CLAUDE.md` without removing anything. `docs/CLAUDE-HANDOFF-SOP.md` stays as the source text. `docs/BACKLOG.md` headings for H1-H3 corrected from "not committed" to deployed (commits verified earlier via Git and the Actions API). Contents audited for personal data: none (invented examples only). Handoff updated: yes. All three files are uncommitted.
