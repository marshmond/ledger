# Household Services S2.1: lifecycle Undo and synchronization hardening. Implementation report

Date: 2026-11-06. Status: **BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED.** S3 not started.
All data in tests, screenshots and this report is invented. The repository is public.

## 1. Executive summary (plain English)

Before this change, only the Undo for logging a visit (S2) checked whether something had changed since. The older Undo buttons (Pause, Resume, End, Replace provider, Change schedule, schedule fixes, and adding an arrangement) did not: pressing Undo put the old values back even if another device had edited the record in the meantime, and Replace-provider Undo deleted every link on the new arrangement, including links someone else had added.

Now every Undo in Household Services works the same way. When an action finishes, the app writes down exactly how every record it touched looks (the whole record, not just its "last changed" time) and which links are attached to those records. When you press Undo, it checks all of that again first. If anything is different, it does nothing at all and says: "This action can no longer be undone because something it changed has been updated. No changes were made." Only if everything is as the action left it does it reverse the action, in one all-or-nothing step.

Because the whole record is compared, a change made in the very same millisecond as the action (which a time stamp alone cannot see) is also caught. An Undo that carries no such written-down state is refused rather than trusted. No new database table, no new dependency, no change to how devices sync, nothing outside Household Services was touched. **1,918 tests pass** (106 new, after the contact follow-up in section 19), type check and build are clean, four mutation checks each make the new tests fail as intended, and the main flows were checked in a real browser, including 375 px and dark mode. Nothing was committed or pushed. Real phone, second physical device and screen reader were not tested.

## 2. Repository, S2 commit and deployment verification

- Repository: `origin` = `https://github.com/marshmond/ledger.git` (fetch and push). Local folder `C:\Users\alexm\projects\finance-app`.
- Local `HEAD` = `origin/main` = **`2b9f845da27666f1ee5f1e21e8cf65f2687489e9`** (`feat(services): S2 visits, scheduling and history`). Parent `7b8c33f` is S1.
- Deployment: public GitHub Actions API (`gh` is not installed): "Deploy to GitHub Pages" **run #61**, head SHA `2b9f845...`, status `completed`, conclusion `success`. Run #60 (`7b8c33f`, S1) also `success`.
- Working tree at start: clean (`git status --short` empty). No unexplained owner changes; no source changes were overwritten.
- Documents read first: `CLAUDE.md`, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, S0 plan, S1 report, S2 report including section 20, `changes.ts`, `visits.ts`, `data.ts`, the Tasks data functions, the shared store (`repo`, `links`), `lib/sync/track.ts` and `merge.ts`, and the S2 two-device test harness.
- No GitHub permission was requested or used. No Actions, authentication, settings or deployment file was touched.

## 3. Current baseline tests

The S2 report states 1,812 tests in 109 files. **I did not run the full suite before my first edit** (I ran the services folder after the first code change: 183 passed, which includes the then-unchanged S1/S2 tests). The end state is 1,812 + 106 new = **1,918 tests in 111 files, all passing** (76 from the main pass, 30 from the contact follow-up, section 19), which is consistent with a green baseline, but a clean pre-change full run was not captured.

## 4. Inventory of lifecycle Undo paths (S2.1-A)

"Old protection" is what existed at the start of S2.1. All actions already ran in ONE Dexie transaction (all or nothing) and already refused a stale preview (`Expect`); that guards the ACTION, not the later Undo.

| Operation | Creates | Updates | Soft-deletes | Links | Tasks | Contacts | Old Undo | Old Undo protection | Shared with other modules |
|---|---|---|---|---|---|---|---|---|---|
| **Pause** | none | arrangement (status, openTaskId, notices cleared) | open visit Task if "remove" | none added or removed (a removed Task keeps its links) | removed, or repeat cleared ("stop"), or untouched ("keep") | none | restore arrangement data; restore Task (undelete + old data) | **none** | Task may be shared with a Project or other records (H4 warning at preview) |
| **Resume** | next visit Task if none is open | arrangement (active) | none | Task to arrangement link when a Task is made | reused open Task, optionally its repeat rewritten | none | remove created Task; restore arrangement and Task data | **none** | same |
| **End** | none | arrangement (ended, reason, date) | open visit Task if "remove" | none | as Pause | none | as Pause | **none** | same |
| **Replace provider** | **successor arrangement**, its asset links, its first Task and Task link | predecessor (ended, replaced) | old open Task if "remove" | adds successor to asset links and Task to successor link | as Pause plus a new Task | **may create a Contact** (never removed by Undo) | remove successor, Task, and **every link on the successor**; restore predecessor | **none; removed all current links of the successor, including ones added later** | assets (read-only links), Task sharing as above |
| **Change schedule** | Task if none open | arrangement cadence and time; open Task date and repeat | none | Task link when a Task is made | open Task re-dated or repeat changed | none | restore both; remove created Task | **none** | Task sharing |
| **Repair: schedule next** | Task, Task link | arrangement (openTaskId) | none | adds Task link | created | none | remove Task, restore arrangement | **none** | none |
| **Repair: keep one** | none | none | the other open Tasks | none | removed | none | undelete Tasks | **none** | Tasks may be shared |
| **Repair: task follows** | none | Task repeat and markers | none | none | edited | none | restore Task data | **none** | Task sharing |
| **Repair: arrangement follows** | none | arrangement cadence; Task markers | none | none | edited | none | restore both | **none** | Task sharing |
| **Repair: one-time move** | none | Task markers | none | none | edited | none | restore Task data | **none** | Task sharing |
| **Repair: re-align** | none | Task date, time, repeat | none | none | edited | none | restore Task data | **none** | Task sharing |
| **Repair: leave as is** | none | arrangement notices list | none | none | none | none | restore arrangement | **none** | none |
| **Add arrangement** (form and Quick Add) | arrangement, asset links, optional Task and link | none | none | adds asset and Task links | created | **may create a Contact** | token built by hand in the UI: remove both; Quick Add also dropped the contact | **none; removed all arrangement links; contact check looked only at Services records** | contact |
| **Visit: Done, Skip, Cancel, late** | visit, visit asset links, next Task | the finished Task; stale Task copy | spawned or stale Task copy removed | visit asset links | completed, re-dated, removed | none | remove created; restore Tasks | S2: `updatedAt` of created and Task records only | Task sharing |
| **Visit: one-off** | visit, asset links | none | none | visit asset links | none | may create a Contact (Quick Add dropped it if no Services record used it) | remove visit | S2: `updatedAt` only | contact |
| One-off pressed twice (`repeated`) | nothing | nothing | nothing | nothing | none | none | empty token (UI offers no Undo for it) | n/a | none |
| Edit visit, edit arrangement | n/a | n/a | n/a | n/a | n/a | n/a | **no Undo exists** | n/a | n/a |

**Gaps found beyond the two limitations in the brief** (all fixed): (1) the S2 guard recorded only created and Task records, never the arrangements an action changed; (2) it compared nothing about links; (3) Undo of a created record deleted all links on it; (4) the Quick Add contact removal ignored Tasks, Projects, assets and Calendar; (5) a refused lifecycle Undo would have been an unhandled promise rejection with no message (the lifecycle toasts did not catch errors).

## 5. Exact implementation changes (S2.1-B)

All inside `src/modules/services/`. No other source folder changed.

- **New `undo.ts`** (the one Undo framework; `changes.ts` re-exports `applyUndo`, `Recorder`, `Undo`, `UNDO_REFUSED`, `runUndo` etc., so existing imports keep working; it must not import `data.ts`, which uses it).
  - `fingerprint(row)`: the whole stored row as order-independent text (uses the existing exported `stable()` from `lib/sync/merge.ts`).
  - `Recorder.arr / task / made` as before; new `watch(task)` (guard only) and `seal(d, createdContactId?)`, called as the LAST step inside the action's transaction. Seals the fingerprint of every created, touched and watched record and the sorted link lines (`id|from|to|type`) attached to each record's reference.
  - `applyUndo(u, d, opts)`: one `rw` transaction on `moduleRecords`, `links`, `contacts`. (1) No sealed state: refuse (`UNDO_UNVERIFIED`). (2) Re-read every sealed record: any difference refuses (`UNDO_REFUSED`). (3) Re-read the links of every sealed record: any difference refuses. (4) Only then reverse: remove created records (for created Services records, only the links the action itself made, by their recorded ids), restore Tasks (undelete if needed, old data), restore arrangements, and, only when asked (`dropCreatedContact`), remove the created contact. Any throw rolls everything back.
  - `UndoRefused` error class and `isUndoRefused`; `runUndo(undo, say, d, opts)`: runs the Undo, shows the refusal in plain words through `say`, shows only a generic "Could not undo that. No changes were made." for anything else, never retries or forces.
  - `contactIsReferenced(id)`: **superseded by section 19.** (Original: keys ending `contactId(s)` in live module records, plus links to a "contacts" reference.) Now a conservative whole-number scan of every live record, link, attachment and due item.
- **`changes.ts`:** Undo definitions removed (moved); `applyLifecycle`, `applyScheduleChange`, `applyRepair` now `watch` every open visit Task they showed in the preview and call `rec.seal(d)` last.
- **`data.ts`:** `createArrangement` now returns a sealed `undo` (arrangement, Task, created contact), replacing the hand-built tokens in the UI.
- **`visits.ts`:** one line: the one-off visit seals with the contact it created.
- **UI wiring (no redesign):** `Dialogs.tsx` (Pause/Resume/End/Replace, Change schedule, repairs), `ArrangementForm.tsx`, `VisitDialogs.tsx` and `quickAddDef.ts` call `runUndo`. The existing Undo buttons, previews and dialogs are unchanged. Quick Add keeps its browser alert for a refusal (it has no toast), and its contact removal now happens in the same transaction.
- **Tests:** new `undo-guard.test.ts` (76); `visits-correction.test.ts` one test rewritten (see section 8).

## 6. State comparison approach and timestamp-collision findings (S2.1-C)

**How `updatedAt` is assigned:** by `repo.put` (`Date.now()`, milliseconds) and by the Dexie "creating" and "updating" hooks in `lib/sync/track.ts` (also `Date.now()`). Records written by sync itself keep the stamp they arrive with (the `applying` set).

**Can two writes share a stamp?** Yes: two writes in one millisecond get the same value (several writes in one transaction commonly do), and the action's last write and a later edit can fall in the same millisecond. **Do synced writes keep identical stamps?** Yes, by design. **Can equal stamps hold different data?** Yes. The merge (`merge.ts`) says "Ties go to the other device's copy so both converge": for equal stamps and different content one device's version simply wins, with no conflict notice, so a sealed stamp can match while the content differs. **Existing mechanisms:** nothing else in the write or sync path distinguishes them; this is documented, not changed (no global merge policy was altered).

**Conclusion:** `updatedAt` alone is not a sufficient guard. The S2.1 guard compares content. I considered a hash (rejected: adds nothing for records this small and a hash can collide), a new revision counter (rejected: needs a migration and touches every writer) and keeping the stamp only (rejected, shown insufficient). Chosen: store the whole row's order-independent text in the in-memory Undo token and compare exactly. No dependency, no table, no migration. Cost: one `get` per touched record plus one link query per record, a handful of small reads.

**Properties required by the brief, each tested** (`undo-guard.test.ts`, "an equal updatedAt does not hide a change"):
- Changed content with an identical `updatedAt` is detected (the test rewrites the row with the stamp preserved using the sync-apply bypass, asserts the stamp is unchanged and the content differs, then asserts the Undo is refused with the database byte-identical). A deterministic test, no waiting for a collision.
- Unknown fields are preserved by Undo (a field written before the action survives a successful Undo) and a changed unknown field counts as a change.
- Property order does not matter (`stable` sorts keys). A missing `deletedAt` equals null.
- Only fields the architecture defines as sets are order-insensitive: arrangement `extraContactIds` and `acknowledged`, Task `tagIds` and `contactIds`. Ordered lists (document `refs`, checklist, weekdays) compare in order: a reorder counts as a change (conservative).
- `updatedAt` is part of the compared row, so a re-save with identical content also refuses. This is the conservative direction (judgment call 1).
- Limit: if a change leaves the row byte-for-byte equal (same content AND same stamp) it is, correctly, not a change.

## 7. Link and Task safety (S2.1-D)

- Link membership is sealed for every created, touched and watched record, and re-checked on Undo. The guard looks at the CURRENT set of live links of that record against the set the action left, so a link added, removed or retargeted by anyone refuses the Undo. Tested: link added to the Task, link added to the arrangement, a Task added to the successor.
- Undo removes only the link ids the action recorded for a created Services record; it never "clears all links". Test: a link on an asset that the successor shares survives a successful Replace Undo, and the predecessor's own asset link is untouched.
- Successor scenario: Replace provider, then a Task is linked to the successor (single device test and the two-device test where B edits the successor): Undo refuses, the successor, its new Task and its links are all still there.
- H4 shared-Task protection preserved: the Pause/End/Replace preview (`sharedLabels`, the WARNING line) is untouched; the existing tests for it still pass. A new link on a shared Task after the action now also blocks the Undo.
- Contacts: Undo never removes a contact, except Quick Add's created contact. **Revised in section 19:** if that contact was edited since, the whole Undo is refused; if anything still refers to it (any shape, any module) the Undo happens but the contact is kept. Replace's new contact is kept after Undo.
- The guard covers: records the Undo reverses, and the open visit Tasks the preview showed (watched even when left in place). It does NOT cover records the Undo never touches. For the Tasks-only fixes (re-align, keep one, task follows) an edit to the arrangement afterwards does not block Undo (tested as such, deliberately).

## 8. Legacy Undo handling (S2.1-F)

Undo tokens are **transient**: closures held by a toast for about 8 seconds (or an alert callback), never saved to the database, never synced, never in a backup. So no migration is needed or added. A token with no recorded state can only come from older code running in a still-open tab, from a hand-made literal, or from a test. Such a token is **refused** (`UNDO_UNVERIFIED`) with the database unchanged; there is no unguarded fallback. Tested: stripped token from a real visit, and the old hand-written `{created: [ids]}` shape (arrangement and Task still live afterwards). One S2 test ("an Undo made before this guard existed behaves as before") asserted the old trusting behaviour; it was rewritten to assert the refusal (the only existing test whose meaning changed). Compatibility with no loss of safety is not possible for a token that proves nothing, so none is offered.

## 9. Two-device synchronization results (S2.1-E)

Real `SyncEngine` tests with two simulated devices (in-memory remote store, same harness as S2), `undo-guard.test.ts`. After each refusal the whole database of BOTH devices is byte-identical to before the attempt.

| # | Scenario | Result |
|---|---|---|
| 1 | A pauses, B edits arrangement, sync | A's Undo refused (on A and on B); B's edit and the paused state survive |
| 2 | A resumes, B changes its Task | refused; B's change survives |
| 3 | A ends, B modifies a linked Task | refused; arrangement stays ended |
| 4 | A replaces provider, B edits successor | refused; both records preserved |
| 5 | A changes cadence, B reschedules the Task | refused; B's date survives |
| 6 | A repairs (re-align), B modifies the repaired Task | refused |
| 7 | B adds a shared link to a Task A touched | refused; link survives on both |
| 8 | identical `updatedAt`, changed content | single device, deterministic (section 6): refused |
| 9 | unrelated records change on B | A's Undo succeeds, and the Undo reaches B |
| 10 | no change in between | Undo succeeds; both devices end identical |

Single-device matrix: 11 operations x (success restores state exactly) and x (refused after: arrangement edited, Task edited, link on Task, link on arrangement) = 55 tests (the three Tasks-only fixes assert the arrangement cases are NOT blocked). Other new tests: add-arrangement Undo guarded, unrelated change does not block, contact handling, legacy refusal, fingerprint ordering rules.

## 10. Atomic rollback and mutation testing

- **Injected failure:** a spy makes the second `moduleRecords.put` throw during Undo. Replace provider (create, link removal, restore) and Pause (Task restore then arrangement restore): after the failure the whole database is byte-identical to before, and the same Undo then succeeds once the fault is removed.
- **Mutation checks** (each applied to `undo.ts` temporarily, the two Undo test files, 111 tests, then restored; final run green):

| Mutation | Tests failing |
|---|---|
| Record state comparison disabled | 34 |
| Equal-timestamp detection disabled (fingerprint reduced to `updatedAt`) | 3 |
| Link-membership check disabled | 21 |
| Unsafe refusal bypassed (an unrecorded token is trusted) | 2 |

The file was restored from a saved copy and verified identical (`diff`), then `npm test` ran in full.

## 11. Browser verification

Real browser (the app's built-in browser pane, dev server, the pane's own database, invented data only). Stated plainly: a second device was **simulated by writing to the database directly**, not a second physical device.

- Normal lifecycle Undo (desktop): Pause, then Undo: arrangement active again, Task back to To do, no leftover toast. Passed.
- Refused lifecycle Undo (desktop, twice): Pause, edit the arrangement behind the app, press Undo: the arrangement stayed paused with the edit kept, the refusal message appeared with no Undo button and no success toast. Passed.
- Provider replacement Undo (375 px, dark mode): Replace provider through the real dialog (main button measured 44 px high), Undo restored the original provider as the only active arrangement and removed the successor. Passed. Then Replace again, edited the successor, Undo: DB shows both records and the edit intact (refused). The toast frame captured late for that one; the message itself was captured on the next case.
- Refused Undo at 375 px dark mode: the message is fully readable, no horizontal scroll, no Undo button. Passed.
- Console: no errors. Dev server stopped afterwards.
- **Not browser-checked:** Quick Add Undo and its alert, Resume, End, Change schedule and each repair Undo, keyboard-only use, screen reader, light mode at 375 px. The refusal toast uses the existing toast (about 4.5 s on screen, no navigation button; the message tells the person to open the record).

## 12. Existing-module regression results

Whole suite: **111 files, 1,918 tests, all passing**; `npx tsc --noEmit` clean; `npm run build` succeeds (pre-existing chunk-size warning); `git diff --check` reports only the repository's usual line-ending notices. The existing S1 and S2 suites ran unchanged (apart from the one rewritten test) and cover: Pause, Resume, End, provider replacement and predecessor/successor history, Change schedule, schedule-health notices and repairs, one-open-Task semantics, completed/skipped/cancelled visits, late visits, one-offs, duplicate detection, booking reminders, Today card, Search, Quick Add, backup/restore, two-device sync and S2 visit Undo. Not driven again by hand in the browser: all of these other than the flows in section 11. Finance, Projects, Tasks, Contacts, Calendar, Home & Assets and global sync source were not modified.

## 13. Architectural deviations and judgment calls (please review)

No stop condition was triggered. No global sync rule changed, no migration, no dependency. Deviation: `Created` (the result of `createArrangement`) gained an `undo` field, and `Undo` lost the S2 `after` field (replaced by `sealed`, plus optional `watched`).

1. **Whole-row comparison including `updatedAt`.** A re-save with identical content refuses. Safe direction; the cost is an occasional unnecessary refusal inside the 8-second window.
2. **Unrecorded Undo is refused**, so the S2 test asserting the opposite was rewritten (the one changed existing test).
3. **Guard set = what Undo reverses plus every open visit Task shown in the preview.** This is what makes "A resumes, B edits its Task" (scenario 2) refuse even though Resume does not change that Task. It means Undo can be blocked by an edit to a Task the action only left in place.
4. **Link membership is checked on every guarded record**, so any new link on a guarded Task or arrangement refuses. Arrangements get new links (booking reminders) in normal use; within an 8-second window that is rare and the safe outcome.
5. **Order-insensitive fields limited to four named set fields.** Document `refs` and checklists stay ordered.
6. **Contact removal only for Quick Add**, in the same transaction. **Revised in section 19:** whole-number reference scan; an edited created contact refuses the Undo. The one-off visit dialog and Replace still never remove contacts (unchanged S1/S2 behaviour).
7. **Tasks-only repairs do not guard the arrangement** (it is not reversed). A reviewer who wants them guarded can add `rec.watch` of the arrangement.
8. **Refusal wording** follows the brief's sentence, plus one instruction sentence; Quick Add shows it in a browser alert (no toast there). Technical errors are replaced by a generic sentence.
9. **S2 visit Undo is now slightly stricter** because link membership is also checked (it previously ignored links of the Task and visit).
10. **Sealing happens inside each action's own transaction** (not after it), so there is no window between action and record.

## 14. Known limitations

- Tokens live in memory for about 8 seconds; a page reload loses them (unchanged, by design).
- A refusal leaves the person to edit by hand; there is no automatic merge or "undo anyway".
- Sync is unchanged: whole-record last-writer-wins and tie-to-the-other-device still apply; the guard only protects the Undo.
- The guard cannot see changes to records the Undo does not touch (for example a Project a Task belongs to).
- The refusal toast disappears after about 4.5 s and has no link; Quick Add uses an alert.
- A second physical device, real phone, screen reader and offline use were not tested. Home & Assets real-device acceptance and Household Services real-device acceptance remain outstanding.
- Full pre-change baseline run was not captured (section 3).

## 15. Complete changed-file list

Modified: `src/modules/services/ArrangementForm.tsx`, `Dialogs.tsx`, `VisitDialogs.tsx`, `changes.ts`, `data.ts`, `quickAddDef.ts`, `visits.ts`, `visits-correction.test.ts`; `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.
New: `src/modules/services/undo.ts`, `src/modules/services/undo-guard.test.ts`, this report.
No package, schema, config, workflow, README or other-module file changed. (The temporary mutation edits to `undo.ts` were reverted and verified.)

## 16. Handoff and backlog updates

Both updated. Handoff: snapshot and "last reviewed" rewritten; S2 corrected from "uncommitted" to "committed and deployed `2b9f845`, run #61" (verified); new S2.1 section; roadmap, risks (real-device acceptance for Home & Assets and Household Services, Undo limits, seasonal and duplicate-resolution deferrals, S3 next), change log and next action. Backlog: new S2.1 status entry at the top; the S2 entry's "newest/uncommitted" wording corrected. States distinguished: planned / built / tested / uncommitted / deployed. Unknown: real-device results.

## 17. Git working-tree status

Branch `main`, `HEAD` `2b9f845da27666f1ee5f1e21e8cf65f2687489e9` (equals `origin/main`). Modified (unstaged) and new (untracked) files exactly as in section 15. Nothing staged, committed, pushed, merged or deployed.

## 18. Commit-readiness recommendation

**Ready for independent review, with the caveats in sections 13 and 14.** Automated evidence is strong: 1,918 passing, type check and build clean, atomic rollback proven with injected failures, real two-device `SyncEngine` scenarios, four mutation checks, deterministic timestamp-collision test, and the main flows checked in a real browser (desktop, 375 px, dark mode). Not covered: real devices, screen reader, offline, the remaining browser flows listed in section 11. No commit or push will be made without your explicit say-so; after a push I will check the Actions run and report the SHA and result.


## 19. Follow-up: final contact reference safety check (same day, after ChatGPT's review)

Scope: `contactIsReferenced()` only (plus the contact rule in `applyUndo`). Nothing committed, staged, pushed or deployed. No change to shared Contacts, sync, schema, other modules or dependencies.

**1. Was the concern valid?** Partly. I listed every Contact representation the app really uses: Home & Assets `contacts: [{ contactId, role }]` (a nested array of objects) and service-history `providerContactId`; Projects `vendorContactIds` and commitment `vendorContactId`; Tasks and Calendar `contactIds`; Household Services `providerContactId`, `extraContactIds` (arrangements and visits). Contacts are not linked through the shared links table by any current code, and no other table (Finance, attachments, due items) holds a contact id today. The original check recurses through nested objects and arrays and matches any key ending `contactId` or `contactIds`, so it **did detect every shape the app currently writes**: I proved this by running the new tests against the OLD implementation, where 26 of 30 passed (all Home & Assets, Project, Task, Calendar, arrangement, visit and numeric-link cases). It was nevertheless **not safe enough**: it failed 4 tests, a link whose end is written as a string (`contact:<id>`) and a record whose field name or shape this version does not know (for example one a newer version adds); it also never looked at attachments or due items; and an edited created contact was simply kept while the rest of the Undo went ahead.

**2. Precise code changes** (`src/modules/services/undo.ts` only):
- `contactIsReferenced(contactId, d)` now looks for the contact's id as a **whole number anywhere** (no digit on either side) in the JSON of the `data` of every live module record, in `fromId` and `toId` of every live link, and in every live attachment and due item (their own id and time stamps excluded). It does not depend on field names or nesting, so unknown or future shapes keep the contact. Ids are time-based and unique, so a false match is very unlikely, and a false match only means the contact is kept (the documented conservative fallback: an unused contact is better than a lost referenced one). References held only by deleted records do not keep it.
- `applyUndo` with `dropCreatedContact`: if the created contact's row differs from how the action left it, the whole Undo is refused (`UNDO_REFUSED`, before any write). Without that option (the one-off dialog) an edited contact does not affect the Undo.
- The Undo transaction's table list now also includes `attachments` and `dueItems` (read only, needed for the scan). Judgment call: previously an edited contact was kept and the rest of Undo proceeded; the review asked for refusal, which is also lossless.

**3. Tests** (new `contact-safety.test.ts`, 30; real builders: `createAsset`/`blankAsset`, `createService`, `createProject`, `createTask`, `createEvent`, `createArrangement`, `logStandaloneVisit`, the shared links store): every reference shape (Home & Assets nested role object, asset service provider, Project vendor, Task, Calendar event, numeric and string-form shared link, another arrangement, extra contact, another visit, unknown shape) x Quick Add visit and Quick Add arrangement = 22 tests, each asserting the contact survives and an unrelated Task is byte-identical; digits-only look-alike ids are not references; a deleted referencing record does not keep the contact; a genuinely unused contact is removed (and another visit and contact are untouched); an edited created contact refuses the whole Undo with the database byte-identical; an injected failure while removing the contact rolls the whole Undo back, and the same Undo then works; three real two-device `SyncEngine` tests (B attaches the contact to a Home & Assets asset and a Project: references reach A through sync, A's Undo keeps the contact on both devices and the arrangement is still undone; B edits the contact: A's Undo refused, nothing changed; nothing attached: removal syncs to both). One earlier test (`undo-guard.test.ts`, "edited since: kept") was updated to expect the refusal.

**4. Results.** Full suite **111 files, 1,918 passed**; `npx tsc --noEmit` clean; `npm run build` succeeds. Mutation: the OLD scan fails 4 of the 30 new tests (restored and verified identical). Not browser-checked in this follow-up (data-layer change only; the Quick Add Undo flow itself remains one of the NOT browser-checked items in section 11).

**5. Remaining limits.** The scan reads every live module record once per Quick Add Undo (fine at household size). A reference held only in a deleted-but-restorable record is not counted. Contacts referenced from a place outside `moduleRecords`, links, attachments and due items (none exists today) would not be seen.

**Git:** branch `main`, `HEAD` `2b9f845`. Additional new file: `src/modules/services/contact-safety.test.ts`; additional changes in `undo.ts`, `undo-guard.test.ts`, this report, the backlog and the handoff. Nothing staged or committed.
