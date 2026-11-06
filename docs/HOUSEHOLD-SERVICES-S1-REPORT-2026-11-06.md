# Household Services S1: providers and standing arrangements. Implementation report

Date: 2026-11-06. Status: **BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT PUSHED, NOT DEPLOYED.** S2 to S5 not started.
All data in tests, screenshots and this report is invented. The repository is public.

## 1. Executive summary (plain language)

Household Services now exists as a module you can use. You can add a provider (a shared Contact) and a standing arrangement with them ("House cleaning, every other Friday"), link it to a property or appliance, see the provider's contact details and arrangements, and have the next visit appear as an ordinary Task in Tasks, on the Calendar and on Today. You can pause, resume, end or replace the provider; each action shows what it will do first, does everything or nothing, and can be undone. If the Task and the arrangement stop agreeing, the arrangement page says so in words and offers previewed fixes; nothing is ever repaired silently. Search and Quick Add (`hs`) find and create arrangements.

Results: **1,694 tests pass** (baseline 1,629; 65 new), type check clean, build succeeds, schema still Dexie v15, no new dependency. Only one existing source file changed (a two-line registration). It was also checked in a real browser (desktop, 375 px, dark mode). **Not done:** any real-device, screen-reader or offline check. No stop condition was triggered.

## 2. S0 approval and prerequisite verification

| # | Check | Result |
|---|---|---|
| 1 | H5 `4422999` deployed | Taken from the S0 record (checked at the S0 start: `origin/main` equals it, "Deploy to GitHub Pages" run #58 succeeded). I re-ran `git fetch`: local `main` equals `origin/main` plus the committed S0 plan (`e460c51`). I did **not** re-query the Actions API this session (no `gh`). |
| 2 | Working tree | **Clean** at the start (S0 had already been committed as `e460c51`, so there were no uncommitted S0 documents to preserve). |
| 3 | S0 Revision 2 present | Yes. It is now marked final-approved (plan header, last section superseded note). |
| 4 | Baseline | `npm test`: 102 files, 1,629 passed. |
| 5 | Task editor and unknown fields | `asTask` carries unknown fields; the editor builds its save from `...base` of that data and `saveTask` writes it whole. **Confirmed by a test replicating the editor's save and, separately, by changing a Task's date in the real Task editor in the browser**: both markers were still on the stored Task afterwards. |
| 6 | Existing Task and Contact write functions | `createTask`, `saveTask`, `removeTasks`, `completeTask`, `findOrCreateContact`, `updateContactDetails` used unchanged. Ownership semantics unchanged (Tasks still own Tasks; Contacts still own contacts). One caveat: Dexie nested transactions needed `d.contacts` listed in the outer transaction. |
| 7 | Handoff instructions installed | Yes (`CLAUDE.md` section "ChatGPT handoff continuity" and `docs/CHATGPT-HANDOFF.md` exist and were followed). |

## 3. Features implemented versus scope

| Required | Status |
|---|---|
| Add provider (inline Contact creation, reuse, no duplicate) | Built, tested, browser-checked |
| Standing arrangement (title, provider, status, dates, cadence, estimate, links, notes, predecessor, task hint) | Built |
| Missing provider ("no provider yet") | Built; listed under Needs attention |
| Frequency, anchor date, time | Built (weekday always explicit) |
| Link to existing property/asset (Household Services only) | Built (link and unlink, tested; linking browser-checked) |
| Provider contact info and arrangements | Provider page built |
| Schedule next visit through an ordinary Task | Built; exactly one |
| Pause, Resume, End, Replace provider | Built; atomic, Undo |
| Search, Quick Add `hs`, deep links, records hook | Built |
| Attention list | Built (no provider, schedule health, asset gone or retired) |
| Landing page, arrangement page, provider page | Built |
| Excluded items (visits, Finance, Today card, Calendar layer, seasons, reverse asset UI, AI) | Not built |

## 4. Exact files created and modified

**Modified (code):** `src/modules/index.ts` (+2 lines: import and `registerModule(servicesModule)`).
**Modified (documentation):** `docs/HOUSEHOLD-SERVICES-S0-PLAN-2026-11-06.md` (approval status, 7.6 reconciliation, Calendar-event wording), `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `README.md`, `docs/module-hooks.md`.
**Created:** `docs/HOUSEHOLD-SERVICES-S1-REPORT-2026-11-06.md` (this file) and, under `src/modules/services/` (3,179 lines in total):

| File | Lines | Purpose |
|---|---|---|
| `model.ts` | 218 | Record type, defensive reader, validation, cadence helpers, notes nudge |
| `schedule.ts` | 138 | Pure: markers, signatures, `scheduleHealth`, nearest cadence date |
| `data.ts` | 228 | Loaders, `ensureNextVisitTask`, create/update, provider and asset-link helpers |
| `changes.ts` | 437 | Pause/Resume/End/Replace, Change schedule, repairs, Undo, stale-write guard |
| `views.ts` | 119 | Snapshot loader and read models for the screens |
| `records.ts`, `searchSource.ts`, `quickAddDef.ts` | 32, 45, 75 | Module hooks |
| `index.tsx`, `ServicesModule.tsx`, `paths.ts` | 16, 34, 3 | Registration, routes, address helpers |
| `OverviewPage.tsx`, `ArrangementPage.tsx`, `ProviderPage.tsx` | 106, 180, 120 | Screens |
| `ArrangementForm.tsx`, `Dialogs.tsx` | 194, 233 | Add/edit form; lifecycle, schedule and fix dialogs |
| `services.css` | 56 | Styles (theme variables, so light and dark both work) |
| `services.test.ts`, `services-sync.test.ts`, `services-hooks.test.ts` | 653, 130, 162 | 65 tests |

## 5. Arrangement data model

Module `services`, kind `arrangement`, in `moduleRecords`. Fields: `title`, `providerContactId` (null = none yet), `providerNameSnapshot`, `extraContactIds`, `status` (active, paused, ended), `endReason`, `startDate`, `endDate`, `cadence {mode, rule, anchorDate}`, `visitTime`, `expected {basis, cents}` (informational), `refs` (document links, http/https only), `notes`, `predecessorId`, `openTaskId` (hint only; the link is the truth), `acknowledged` (see judgment call 5). The reader never throws and unknown fields survive saves (tested). Validation is strict on every save (title required, real dates, end not before start, valid time, safe links, whole-cent non-negative estimate, a cadence whose first date lies on its own pattern, no "ends after N times"). **There is no account-number, password, access-code or bank field** (a test asserts no such key exists). Notes show a warning and a best-effort nudge. Seasons, renewal dates and other later fields are not present; if they appear they are preserved as unknown fields.

## 6. Contact integration

A provider is a shared Contact. `findOrCreateContact` (unchanged) finds by case- and accent-insensitive name or creates one, inside the same transaction as the arrangement, so a failure leaves no stray contact (tested). A second arrangement with the same name, in any case, reuses the contact (tested). Phone and email can be entered when creating a new provider and are written to the Contact only; they are never copied to the arrangement, Task, link, search result or label (tested with planted values). The provider page reads the Contact live and edits it through `updateContactDetails`. If the Contact is removed, the saved name is shown with "(contact removed)" and nothing breaks (tested).

## 7. Task scheduling and recurrence authority

The arrangement owns the intended cadence; the Task is the working next occurrence. No new recurrence engine: dates come from `generateDates`/`normalizeRule`. `ensureNextVisitTask` is the only creator of a visit Task. It runs in a transaction on moduleRecords, links and contacts, **re-reads the live linked Tasks first**, reuses an open one, and creates exactly one otherwise (three overlapping calls produce one Task; tested; mutation-checked). The Task gets: title "Title: Provider", due date, due time if set, the cadence's repeat (weekday written out), the provider as Contact, one `about` link to the arrangement, and markers `servicesArrangement` and `servicesOccurrence`. It appears in Tasks and on the Calendar's Tasks layer (browser-confirmed, once, no separate event). The next date is never in the past and never on or before a visit already finished. An arrangement with no schedule can have one visit scheduled on a chosen date (no repeat).

Moving the Task's date leaves the arrangement record byte-identical (tested; same `updatedAt`) and the page reads "moved from". Finishing the Task in Tasks respawns a copy that inherits the old marker (existing Tasks behaviour, unchanged): this is detected as `stale-marker` and fixed by "Re-align" (tested). The final completed-visit progression (cadence-anchored next date at "Done, log it") is **S2**; S1 only preserves the marker and the data-layer behaviour S2 needs.

## 8. Schedule-health detection and repair

`scheduleHealth` is pure and read-only (tested with a before/after snapshot of every table). States: not-applicable (paused or ended), no-task, duplicate-open, rule-differs, stale-marker, off-cadence, moved-once, ok. Each fix is an explicit button that opens a preview built from the **same pure function** the write uses (so preview and result cannot disagree), re-reads live records, and refuses with "This changed since you opened it, nothing was changed" if the arrangement or any open visit Task changed since the preview (tested for keep-one, schedule-next and Change schedule). Fixes: schedule the next visit; keep one and remove the others (Undo); make the Task follow the arrangement; make the arrangement follow the Task (round trip tested); treat as a one-time move; re-align; leave as it is (remembered only until the Task's rule changes; tested). Change schedule offers "move the current visit" and "keep its date, use the new pattern after it", with the stated dates verified for both (tested), both-way refusal on stale data, and rollback when a Task write fails (tested by injecting a failure).

## 9. Pause, Resume, End, Replace provider behaviour

Each: plan (read-only, with `Expect`), preview text, one transaction, Undo.
- **Pause:** cadence kept; the open Task is removed (default, Undo), kept as a single visit (stop repeating), or kept exactly (all three tested; at most one open Task after each).
- **Resume:** reuses a kept Task, else creates one on the first schedule date on or after today (no overdue backlog; tested with a past anchor); optional "make the existing task repeat like the schedule" (shown, never silent; tested).
- **End:** reason and date recorded, Task handled as chosen, history stays; an ended arrangement cannot be resumed or ended again; ensure creates no Task for it.
- **Replace provider:** ends the old (reason "replaced"), keeps its original provider and name snapshot, creates a successor with its own Task. Copies title, schedule, cost estimate and linked assets. **Does not copy** notes (unless the box is ticked), document links or other contacts. Simultaneous submits create one successor (three overlapping calls: one succeeds; tested), the same provider is refused, a failure after the old one is ended and the successor created rolls everything back (tested via an injected link failure), and Undo removes the successor and its Task and restores the old state (tested).
- The H4-style warning appears in the preview whenever a Task chosen for removal is also linked to other records (tested).

## 10. Asset linking

Shared links `arrangement -> assets:asset:<n>`, type `serves`, created from Household Services only. `syncAssetLinks` is idempotent and refuses an asset that no longer exists. The page shows each asset's name (public label), type and lifecycle status (In use, Replaced, Sold, ...) and "replaced by" when known; a removed asset reads "An asset that no longer exists" and is listed under Needs attention. Retired assets also raise an attention row. No Home & Assets file, screen, count or text changed; asset records were verified unchanged by a test.

## 11. Search and Quick Add

Search group "Household Services": arrangement title and provider name only (notes and phone are not searchable). Result lines show title, provider name, how often and status. Deep links `#/services/a/<id>` and `#/services/providers/<contact>`. Record source ids `arrangement:<n>`, label = title, provider name, status. Quick Add prefix `hs`, alias `household`; no clash with existing prefixes (tested, including that a duplicate registration is refused; `svc`, `service` and `repair` stay with Home & Assets). Grammar `hs <what> [with <provider>] [every ...] [day] [at time]` using the existing Tasks shorthand; the preview lists service, provider (existing or new contact), how often and first visit, and nothing is saved until Add; Undo removes the arrangement and its Task (and a contact made just for it, if unused). Phone, email, notes, URLs and amounts never appear in results or previews (tested).

## 12. Privacy and accessibility

Privacy: local-first, no network call added, no secret fields, notes warning and nudge, document links http/https only, contact details only on the provider page, nothing private in Task titles, notes, links, search or labels (tested with planted phone, email, notes, URL and amount). Expected cost honours Today's "Hide amounts" setting (read from the same stored setting). Accessibility (checked): labelled fields and buttons, dialogs reuse the shared Modal (Escape closes, focus returns; observed), alerts use `role="alert"`, 44 px buttons at 375 px (measured), no colour-only status (chips carry words). **Not checked:** a real screen reader and a full keyboard-only walk of every dialog.

## 13. Automated tests (65 new; total 1,694)

`services.test.ts` (47): model and validation, defensive reader and unknown-field preservation, no secret fields, Contact reuse and fallbacks, creation rollback, one Task with weekday and markers, overlapping ensure, one-off visit, Task editor save path, one-time move, Tasks-screen completion and re-align, every health state, no-write detection, every fix with preview and stale refusal, Change schedule (both options, rollback, refusal), Pause/Resume/End (all choices, Undo), Replace (copy rules, no duplicate successor, rollback, Undo, stale plan), asset link/unlink and missing assets, removed contact, privacy. `services-sync.test.ts` (5): schema still v15, real `SyncEngine` two devices (arrival, cancel versus edit converges, **both devices Resume offline: both Tasks kept and flagged `duplicate-open`, nothing deleted**, Task edit versus Pause), backup export and restore with markers intact. `services-hooks.test.ts` (13): registration and prefix, search and privacy, record source, Quick Add grammar, read models and asset views, provider page model. **Mutation check:** disabling the "reuse an open Task" guard makes 4 tests fail; restored.
Regression requirement 23 to 25 (existing Tasks recurrence, Home & Assets and Projects, no unintended infrastructure change): the whole existing suite passes unchanged (1,629 tests); `git diff` shows no change to any other source file.

## 14. Browser verification (real browser pane, invented data)

The pane's own database already held earlier invented demo data (Demo House, TilePros, and so on); no real data was involved, and only new invented records were added (Sparkle Test Cleaners, Bright Test Maids, Green Test Lawns). Checked: add a provider and an every-other-Friday arrangement with asset link and estimate; the Task in Tasks and on the Calendar (once); **real Task editor** date change kept both markers and the arrangement was untouched; moved-from indicator; Pause then Resume (previews, new Task); Replace provider (preview, successor page, old keeps its provider); Change schedule preview; Search; provider page; Quick Add `hs` preview and Add; 375 px (no sideways scroll, 44 px buttons, dialogs fit); dark mode; Escape closes and returns focus; no console errors. One defect found and fixed during the check: the line "Choose a fix" showed under the harmless moved-once notice.
**Not browser-checked:** End, the shared-task warning, the stale/duplicate/rule-differs notices, the Undo toasts, asset unlink and document rows in the form, the edit-contact dialog (all covered by automated tests only).

## 15. Backup and sync verification

**Automated and simulated-device:** records live in `moduleRecords` so backup and sync cover them with no code change; export then restore on a fresh database reproduces arrangements, links, the Task with its markers and the contact (health `ok` after restore); two simulated devices through the real `SyncEngine` and merge behave as in section 13. **Real devices: not tested.** Older app builds will carry the records as unknown `moduleRecords` kinds; not tested. No backup or sync format changed.

## 16. Existing module regression results

All 1,629 pre-existing tests pass unchanged (final full run 105 files, 1,694 tests). The repository's address check initially flagged inline route strings; they were moved into small helper functions (as Home & Assets does) rather than changing the check. Finance, Projects, Tasks recurrence, Contacts and Home & Assets source are byte-unchanged (`git diff --name-only` over those folders is empty). Dexie stays at v15 (test and browser both read version 150 = 15 x 10). `package.json` and the lockfile are unchanged.

## 17. Architecture deviations and judgment calls (please review)

No deviation from the approved S0 plan that needed a broad cross-module change. Calls made:
1. Any live open Task linked (`about`) to an arrangement counts as its visit task; manually linking a second open Task shows `duplicate-open` (acknowledgeable).
2. Health order is no-task, duplicate-open, rule-differs, **stale-marker**, off-cadence, moved-once (S0's table listed stale-marker after moved-once; it must come first or a respawned copy reads as a harmless move).
3. `stale-marker` is detected from finished linked Tasks' markers because visit records do not exist until S2.
4. A cadence may not "end after N times" (the count shrinks on each spawned copy and would raise false drift); use an end date.
5. "Leave as it is" is stored on the arrangement as small `acknowledged` keys that stop matching when the Task's rule changes (an extra field beyond S0's list).
6. An extra `visitTime` field on the arrangement stores the clock time written to the Task's due time.
7. Replace provider does not copy notes (unless ticked), document links or other contacts (S0 5.3 said notes would be copied; the S1 prompt says not to copy private provider-specific information).
8. Pause and End default to removing the Task (with Undo); Replace defaults to keeping one visit and stopping the repeat.
9. Resume's date is the first schedule date on or after today and after any finished visit; it makes a kept Task follow the schedule only if the box is ticked.
10. Editing cannot change an existing provider (use Replace); it can assign one when none.
11. No delete button for arrangements in S1 (End instead); Undo on add and on Quick Add removes the new one.
12. Task title is "Title: Provider name" and nothing else.
13. Cost estimate honours Today's "Hide amounts" via its stored setting.
14. A schedule-less arrangement can have one dated, non-repeating visit Task.
15. Quick Add grammar: the words after the last " with " are the provider; a repeat with no date starts today.
16. A contact created by Replace provider stays after an Undo of the Replace (it is an ordinary Contact; Quick Add Undo removes it when unused).

## 18. Outstanding limitations

No visit history, "Done, log it", skip or cancel (S2). No Finance references (S3). No Today card or Calendar layer. No seasonal schedules. No reverse Home & Assets view, replacement flag action or delete-plan sentence (S4). No arrangement delete. The provider's "extra contacts" exist in the model but have no screen in S1 (preserved on edit). Weekly rules with several weekdays are accepted but only tested with a single weekday. The intermittent `core.test.ts` timing test did not fail in my runs but remains a known risk. Real-device, screen-reader, offline and older-build checks are all NOT done. Home & Assets real-device acceptance (H5 section 17, 14 items) is still NOT TESTED.

## 19. Handoff and backlog updates

Handoff updated: **yes** (`docs/CHATGPT-HANDOFF.md`: header, snapshot, in-flight, test baseline, phase section, roadmap, risks, change log, next action). Backlog updated: **yes** (S1 entry on top: built, 1,694 tests, numbered judgment calls, NOT built list). README and `docs/module-hooks.md` updated. Unknown: nothing else is unknown beyond the NOT-verified lists above.

## 20. Git working-tree status

Branch `main` at `e460c51` (S0 plan). Uncommitted: modified `README.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/HOUSEHOLD-SERVICES-S0-PLAN-2026-11-06.md`, `docs/module-hooks.md`, `src/modules/index.ts`; new `src/modules/services/` and this report. Nothing staged, committed, pushed or deployed. GitHub Actions: nothing to check yet.

## 21. Commit-readiness recommendation

**Ready for architectural review; I recommend committing after that review, not before.** Automated evidence is strong (1,694 green, type check and build clean, mutation-checked, real two-device sync). The remaining gaps are real-device and accessibility checks and the browser items listed in section 14, none of which block a commit but all of which belong on the owner's acceptance list. Please look especially at judgment calls 2, 4, 5 and 7. No commit or push will be made without your explicit say-so; after a push I will check the Actions tab and report the SHA and result.
