# Change backlog (from the owner's first-use notes)

**Working rule (still in effect for NEW notes):** collect notes tab by tab, ask clarifying questions up front, and wait for the owner's go-ahead before building.

Status key: `[ ]` not started, `[x]` built.

## STATUS 2026-11-06 (newest): HOME & ASSETS H4 (WARRANTIES AND ASSET LIFECYCLE) BUILT AND TESTED. NOT COMMITTED, NOT PUSHED. Waiting for owner and architectural review. H5 is NOT started.

Full report: `docs/HOME-ASSETS-H4-REPORT-2026-11-06.md`. Gate checked first: H3 `30118dd` equals `origin/main` and its Pages deploy completed with success (public Actions API). **1,586 tests pass** (was 1,521; 65 new in `h4-warranty.test.ts`, `h4-lifecycle.test.ts`, `h4-sync.test.ts`), `tsc --noEmit` clean, build clean. **No schema, backup-format, sync-format or dependency change; no Finance, Projects, Tasks or Contacts file edited.**
- [x] **Built:** several warranties per asset (dates, provider from Contacts, coverage, claim notes, document links, status Active / Expiring soon / Expired / No expiration recorded, soft delete with Undo); H1's simple warranty read as one implicit warranty and hidden once real records exist; a fifth built-in Calendar layer "Home & Assets" (id `9_000_000_000_000_105`, read-only, one marker per warranty, nothing stored); one Status/Replace dialog with a review step (replace with an existing or a new asset; open tasks: keep, move, stop repeating, delete; "include everything inside" for a sold property, nothing ticked by default; all in one transaction); Past tab split into sold / disposed of / replaced; "Needs attention" card to re-home or remove records that point at a missing asset; warranties in Search and in the Link-a-record picker, with deep links.
- **Mutation check:** with `warranty` removed from the dependent-kinds list, 5 tests fail (local deletion and three real two-device tests); restored, all pass.
- **Judgment calls (please review):** (1) deleting the last warranty record shows the old simple warranty again, with an opt-in box to clear it; (3) stored assets keep Calendar markers, archived/sold/disposed/replaced do not; (11) the H1 "Warranty ends" line in Details moved into the Warranties card. Others are in report section 17.
- **Browser-checked (invented data, throw-away pane database):** implicit and explicit warranty, Calendar layer and marker, deep link, Replace with a new asset (task moved, history stays), bulk Status with the review, Past tab, orphan found and re-homed, global search, delete-last-warranty notice, 375 px (no sideways scroll), dark chip contrast, Escape, no console errors.
- **NOT browser-checked:** editing a warranty and document rows, the "clear old fields" tick, Delete task and Stop repeating in the dialog (all unit-tested), keyboard-only and screen-reader runs, the Undo toast, two real devices, offline use.
- **Review follow-up (same day):** Delete task now warns when the task is also linked to other assets (inline alert and review line, tested). (Handoff files were then supplied and installed, see next line.)
- **Handoff installed (uncommitted):** `docs/CHATGPT-HANDOFF.md` and the standing rule in `CLAUDE.md` now exist; the H1 to H3 headings above were corrected to deployed.
- **Deferred (not built):** warranty claims, recall lookups, "start from purchase date" helper, Quick Add for warranties; Today card, overview and printable sheet (H5).

## STATUS 2026-11-06 (earlier): HOME & ASSETS H3 (FINANCE REFERENCES AND PROJECTS LINKS) BUILT, COMMITTED AND DEPLOYED (`30118dd`, Pages run succeeded). H4 was built afterwards (see above); H5 is NOT started.

Full report: `docs/HOME-ASSETS-H3-REPORT-2026-11-06.md`. Gate checked first: H2 `f101e1b` equals `origin/main` and its Pages deploy completed with success (read from the public Actions API). **1,521 tests pass** (was 1,464; 57 new in `spending.test.ts`, `h3-data.test.ts` and `h3-sync.test.ts`), `tsc --noEmit` clean, build clean. **No schema, backup-format, sync or dependency change; no Finance file edited; no Projects calculation touched.**
- [x] **Built:** a purchase or a service record can take its cost from linked Finance transactions (a whole transaction or ONE part of a split) instead of a typed amount, never both; a read-only picker (transfers never offered); one pure spending helper; a Spending card on the asset page (buying, maintenance and repairs, other work; typed versus from Finance; unknown is not $0); property rollups (itself / inside it / combined, each payment once); Related projects on the asset page (paid so far shown beside, never added) and Related assets on the project page; "Record in Home & Assets…" on completed projects (opens a prefilled form, saves nothing until Save); an optional read-only pointer from a property/vehicle to a Finance net worth entry.
- **Split safety:** Finance splits have no ids, so a split reference stores a fingerprint (part count, amount, category). If the part changed, was removed or reordered, the reference is "Needs review", counts $0, shows the old figures only as words, and must be picked again. Nothing is ever moved to another part.
- **Mutation check:** with the fingerprint check off, 4 tests fail; with the transfer guard off, 3 fail.
- **Judgment calls (please review):** (1) one cost source stored at a time; switching names what is dropped and needs a ticked box; (3) a whole-transaction link follows the live amount; (4) the same piece on several records is allowed and counted once (visible), not refused; (15) three H2 placeholder test lines renamed because `txnRefs` is now a real field. The rest are in report section 17.
- **Browser-checked (invented data, separate throw-away database, pane hidden so NO screenshots):** purchase from a transaction, split-part link, edit and delete of the linked transaction (review shown), rollup, typed-to-Finance switch, project links both ways, handoff opens prefilled and Escape saves nothing, dangling project link, 375 px no sideways scroll, dark-theme contrast measured, no console errors.
- **NOT browser-checked:** anything visual (screenshots), keyboard-only beyond Escape, screen reader, the handoff Save, Unlink/Undo toasts, replacing a stale reference, two real devices.
- **Known limits:** identical twin split parts are interchangeable to the check; the picker shows the newest 30; no "which asset is this transaction on" view in Finance (by design); project payments are never split between assets.
- **Deferred (not built):** `Txn.asset`/`Split.asset`, asset budgets, valuation, depreciation, cost basis, mileage (all out of scope); several warranties, warranty Calendar layer, replace workflow (H4); Today card, overview, printable sheet (H5).

## STATUS 2026-11-06 (later): HOME & ASSETS H2 (MAINTENANCE AND SERVICE HISTORY) BUILT, COMMITTED AND DEPLOYED (`f101e1b`, Pages run succeeded). H3 and H4 were built afterwards; H5 is NOT started.

Full report: `docs/HOME-ASSETS-H2-REPORT-2026-11-06.md`. Gate checked first: H1 `bf2d3d5` is on `origin/main` and its Pages deploy succeeded. **1,460 tests pass** (was 1,407; 53 new in `service.test.ts` and `service-sync.test.ts`), `tsc --noEmit` clean, build clean. **No schema, backup, sync-format or dependency change** (Dexie stays 15; no Tasks, Calendar, Projects, Finance, Contacts or core file edited; the H1 sync rule already covered `service`).
- [x] **Built:** Maintenance card on the asset page (open linked tasks, last serviced, next due, Overdue by Tasks' own rule, Needs attention); Add maintenance (an ordinary linked Task, shared repeat control) with six generic, UNVERIFIED suggestions; durable `service` records (date, kind, title, notes, one provider from shared Contacts, optional manual cost where blank is unknown and 0 is free, document references, source task id and title snapshot); Log service, edit, soft delete with Undo; service-history timeline; **"Done, log it" as one transaction** with Tasks' own `completeTask` (rollback tested both ways, next repeat made once, asset link kept); completed-elsewhere tasks shown as "Completed task — not yet saved to service history" with Save to history (de-duplicated by task id, re-checked in the transaction); search over service title and notes (asset context, nothing sensitive); Add box `svc` (`Replaced pump on Dishwasher $180 yesterday`, exact asset only, refuses with the reason when unclear, Undo); `service:<n>` in the records hook with deep links; permanent deletion blocked by live service history on this device and across devices.
- **Mutation check:** with `service` taken out of the dependent-kinds list, 5 tests fail (2 local deletion, 3 real two-device sync); with it in, all pass.
- **Judgment calls (please review):** (1) archived assets refuse new history, retired ones accept it; (2) the repeat counts from the service date entered, not the day the button is pressed; (3) Add maintenance requires a first due date; (4) suggestion titles start with the asset name, intervals are UNVERIFIED; (5) every open linked task is shown as Maintenance, completed linked tasks moved into the history, `LinkedWork` is events only; (6) an improvement does not count as "last serviced"; (7) Add box kind defaults to Other and a first word that equals a shortcut word is eaten by the Add box routing; (8) Save to history refuses a reopened or deleted task; (9) provider prefilled only when the task has exactly one person; (10) records can be deleted (task then shows as unsaved again); (11) two devices offline can each save the same task, both records kept; (12) service records appear in link pickers only when text is typed; (13) the edit form cannot move a record to another asset.
- **Browser-checked (invented data, throw-away database):** add maintenance, Tasks and Calendar show it once, Done, log it with a new Contact, completing in Tasks then Save to history, `svc` preview/refusal/add, unscheduled repair with $0 cost, edit, search and deep link, missing-record notice, delete blocked, archive disables the add buttons and Restore re-enables them, 375 px, dark theme, Escape cancels.
- **NOT browser-checked:** keyboard-only and screen-reader runs, the Task editor's Link a record box listing service records, document rows, the delete-record Undo toast, the Event editor, two real devices, offline use.
- **Known limits:** old completed linked tasks all show as "not yet saved" (no bulk save or dismiss); no mileage, uploads, warranty list or replace flow.
- **FINAL FOLLOW-UP (same day, after review):** duplicate service records for one task (two offline devices) are detected by task id and shown as a warning with the records listed, each openable and deletable with Undo (nothing merged or auto-removed; 1 restore guard removed so Undo always works); repeat basis changed: repeat-after-completion counts from the entered service date, fixed schedules and one-off tasks use today exactly like Tasks (judgment call 2 above is superseded). 1,464 tests pass. See the report's follow-up section.
- **Deferred (not built):** Finance transaction references, project links, asset spending, net-worth link (H3); several warranties, warranty Calendar layer, replace workflow, orphan repair (H4); Today card, overview, printable sheet (H5).

## STATUS 2026-11-06: HOME & ASSETS H1 (ASSET REGISTRY) BUILT, APPROVED BY ARCHITECTURAL REVIEW, COMMITTED AND DEPLOYED (`bf2d3d5`, Pages run succeeded). H2 to H4 were built later (see above); H5 is NOT started and needs a separate go-ahead. The unverified items below stay open.

Brief followed: `docs/HOME-ASSETS-H1-BRIEF-2026-11-05.md`. **1,407 tests pass** (was 1,366; 41 new in `src/modules/assets/assets.test.ts` and `assets-sync.test.ts`), `tsc --noEmit` clean, production build clean. **No schema, backup-format or dependency change** (Dexie stays 15; assets are shared module records). Owner decisions Q1 to Q8 (all "A") were confirmed 2026-11-05.
- **Built:** module "Home & Assets" at `#/assets` (list as tree or flat, tabs In use/Stored/Past/Archived/All, type filter, asset page, add/edit form with folded sections); six types; parent-child with cycle, depth and property-at-top rules; optional details, one warranty end date and badge, shared Contacts with roles, specs, document references (http/https only); masking of serial/VIN, plate and address (hidden until Show, per page view, not stored); archive/restore; status stored/sold/disposed/replaced with date, note and replaced-by; search (name, make, model, notes, specs; serial/plate by prefix, 4+ characters, never shown); Add box destination `a` (`Dishwasher in Kitchen`, exact name only, visible note otherwise, Undo only when nothing points at it); `records` hook so Tasks and Calendar events link to assets from their own "Link a record" box (the asset page lists them read-only); permanent deletion with plan and typed-name dialog; **cross-device deletion rule** (`src/lib/sync/assetDeletion.ts`, one call in `merge.ts`, one condition in `touchAll`) mirroring P4B. Prerequisites done: readable sync conflict labels for module records (P1), plain-backup sentence (P2). P5 deployment had been verified (run #53).
- **Mutation check:** with the deletion rule switched off, sync tests b, c, d, e and f fail; with it on all pass (11 real-sync-engine tests). All existing sync and Projects tests pass unchanged.
- **Judgment calls (please review):** (1) a COMPLETED linked task blocks permanent deletion (treated as maintenance history); open tasks and events are unlinked and kept; (2) a property cannot sit inside another asset (hard rule; saving a property clears its parent); (3) `ledgerPropertyId` deferred to H3 (preserved as an unknown field); (4) no "Add task for this asset" button in H1: link from the task's or event's own Link a record box; (5) Show/Hide state resets on reload; (6) Quick Add matches only an exact unique name after the last " in "; (7) `lib/sync/assetDeletion.ts` imports one constant list from `modules/assets/model.ts` (pure file) so the guard and the sync rule cannot drift; (8) archived assets are left out of the parent picker unless already chosen; (9) the warranty badge shows only for assets In use; (10) changing a type away from property/vehicle needs a tick to remove the saved address/plate; (11) Retire dialog does not touch children, tasks or links (the open-task prompt is H4).
- **Found and fixed in browser checks:** saving the form on the list page left you on the list instead of opening the new asset (close ran after navigate); the Add box preview read "Will add: Will add:".
- **Browser-checked (invented data, deleted afterwards):** create property/vehicle with parent and VIN/plate/warranty; masking and Show; reload re-hides; search by serial prefix (not shown); Add box preview and add; link from the Task editor and appear on the asset page; archive; blocked delete with reasons; real delete of three assets (soft-deleted with marker, linked open task kept, no live asset links left); 375 px (no sideways scroll, 44 px buttons) and dark theme for the form.
- **NOT browser-checked:** the Retire/Status dialog, restore from Archived tab, Past/Stored tabs, event linking from the Event editor, the edit form's contact/spec/document rows and type-change tick, keyboard-only and screen-reader runs, the plain-backup sentence on its page, two real devices (including a permanent-deletion conflict), offline use, an older app build syncing (all devices must run H1 before relying on deletion precedence). The browser pane's console buffer holds dev hot-reload entries ("Module today is registered twice", HTTP 500s) from my edits while the server was live; a fresh page load shows the module working and the production build is clean.
- **NOT built (by design):** service records, "Done, log it", maintenance suggestions (H2); money, projects links, net-worth link (H3); several warranties, warranty Calendar layer, replace workflow, orphan repair (H4); Today card, overview, printable sheet (H5).

## STATUS 2026-11-05: HOME & ASSETS H0 (ARCHITECTURE AND PLAN) WRITTEN. DESIGN ONLY: NOTHING BUILT, COMMITTED OR PUSHED. Waiting for owner and architectural review.

Document: `docs/HOME-ASSETS-H0-PLAN-2026-11-05.md`. Read-only review of the code (store, registry, sync merge, backup coverage, Tasks recurrence, Calendar/Today/Search/Add hooks, Projects deletion, Finance project attribution). Test baseline run once: **1,366 pass** (no code changed). Recommended model: one generic `asset` record in the shared module records (no new table, schema stays 15, no dependency); maintenance = ordinary Tasks linked to the asset; a durable `service` record for completed work; money by reference to existing transactions (no change to Finance), project spending shown beside an asset and never added to it; shared Contacts for vendors; document references only (no files).
- **Phases proposed:** H0.5 prerequisites (check P5 deployment; readable sync conflict labels for module records; backup-page note), H1 registry (with records/search/Add box), H2 maintenance and service history, H3 Finance references and Projects links, H4 warranties and lifecycle, H5 overview, Today card and acceptance.
- **Owner decisions needed (section 13, recommended defaults first):** money attachment; how maintenance becomes permanent history; permanent deletion rule; existing net-worth "properties"; sensitive details; touching the Projects page; built-in maintenance suggestions (intervals UNVERIFIED); module name.
- **Found while reading:** this file said P5 was not committed, but `git log` shows `47100bc` committed and the tree clean (push and deployment not checked from here: check the Actions tab); sync conflict notices appear to label module records by `#id` (read from code, not seen in a browser).
- **NOT built:** everything in the document. Home & Assets is not started.
- **OWNER DECISIONS CONFIRMED 2026-11-05: Q1 to Q8 all accepted as the recommended "A" options** (Finance transactions referenced from asset/service records; maintenance completed from the asset page saves durable history, other paths show unsaved history; archive/retire history, restrict permanent deletion; Finance net-worth properties stay separate; sensitive identifiers stored with masking; small Projects-side integrations allowed in H3; editable maintenance suggestions; module "Home & Assets" at `#/assets`). **H1 build go-ahead NOT yet given.**
- **Revision 2 (after ChatGPT review):** architecture approved by the reviewer, subject to the owner's acceptance of Q1 to Q8 (all recommended "A"; **recommended only, not owner-approved**). Plan updated (permanent deletion now follows the P4B deletion-wins design as a narrow sibling sync rule, built last in H1 with a cut line; exact "Done, log it" and financial-integrity rules written) and the H1 build brief is in `docs/HOME-ASSETS-H1-BRIEF-2026-11-05.md`. **Projects P5 deployment verified successful** (Actions run #53, commit `47100bc`). The conflict-label fix and a plain-backup sentence are folded into H1 as prerequisites P1 and P2. Waiting for review and the owner's go-ahead; no code written.

## DECISION FOR LATER (2026-11-04): push notifications to iPhone / Apple Watch. NOT being built now.

What it would take (from general knowledge of Apple's rules; nothing here was tested on the owner's devices):
- Ledger installed to the iPhone Home Screen (iOS 16.4 or newer), a small install file and background script, and a one-time permission prompt.
- Something always on that sends the notification at the due time (the app is a static page with no server): a free Cloudflare Worker on a timer is the likeliest fit; a GitHub Actions timer can run many minutes late. It also needs the phone's notification address and a list of what is due (read from the synced data, or handed over by the app at each sync).
- Privacy: notification text passes through Apple's servers. Keep it vague ("Task due: ...") and send only titles and times, never amounts or balances.
- Apple Watch needs nothing extra: iPhone notifications mirror to it when the phone is locked or not in use. No Watch screen for Ledger.
- Cheaper routes: (a) calendar alerts via the existing .ics alarms (iPhone Calendar and Watch alert natively; one-time import, so changes do not carry over unless a live calendar subscription is built, which Phase 2 excluded); (b) a notification app such as Pushover or ntfy.
- Recommendation: try the calendar-alert route first; build real push later only if wanted, as its own phase of roughly Part B's size.

## P4 INPUT (owner, 2026-11-05, after P3 was pushed): TOTAL COST VISUALIZATIONS. NOT built; waiting for the owner's P4 prompt.

The owner wants total-cost visualizations on projects, as part of the Projects analysis, and gave a mock-up: a card titled "Illustrative agreement allocation" showing one large total ($50,000, labelled "Total contract"), under it a single horizontal bar split into coloured segments, and below that a legend with one row per part: a colour dot, the name (Plumbing, Electrical, Finishes), its percentage of the total (40%, 30%, 30%) and its amount ($20,000, $15,000, $15,000). The three parts add up to the total. The card sits beside the multi-line commitment design (a contract allocated across budget lines).

Notes for when this is picked up (nothing decided):
- The same card shape would fit several totals: one contract split across its budget lines (needs the multi-line allocation in `docs/PROJECTS-MULTILINE-COMMITMENT-DESIGN.md`); the whole project's expected cost split by budget line (possible today from the existing per-line figures); and paid versus left to pay.
- The figures must come from Finance's existing project summary so the parts always add up to the total shown; no second calculation.
- Questions to ask the owner in one multiple-choice round before building: which total(s) to show first, where on the project page, whether to show paid versus left on each segment, and what to do with unfiled money ("No budget line") in the bar.
- Needs the usual checks: desktop and 375 px, dark theme, colours that are readable without relying on colour alone (the legend carries the names and numbers).

## STATUS 2026-11-05: PROJECTS P5 (VISUALIZATIONS) BUILT, NOT COMMITTED, NOT PUSHED. Waiting for architectural review and the owner's approval.

Full report: `docs/PROJECTS-P5-REPORT-2026-11-05.md`. **1,366 tests pass** (was 1,340; 26 new in `src/modules/projects/p5.test.ts`), type check and build clean, **no schema, backup, sync, calculation or dependency change**. **DONE (this closes the "TOTAL COST VISUALIZATIONS" input below):** project cost bar (expected total cost by budget line), agreement bar, Paid-and-left view with exact signed and negative amounts and "paid beyond its share" wording, "No budget line" as a neutral hatched segment (or an explanatory note when it only balances), grouping beyond seven lines, keyboard, accessible and light/dark/375 px layouts, "See spending over time" link into the project-filtered Reports, and a project-aware CSV (safe filename, no Income row; the unfiltered CSV is byte-identical). Decisions applied as recorded: bar = Expected total cost; a balancing-only "No budget line" is left out of the bar with a note; CSV change for the filtered view only. **Found and fixed in browser checks:** "No budget line" was wrongly labelled "paid beyond its share".
- **Deferred, with reasons (unchanged):** Calendar project filter; line pre-select helper; one-click proportional payment assignment; Budget page and Flow diagram not project-aware; a project budget-table export (not chosen); typing the transaction form's split rows by hand was not browser-checked in P4A. **Not verified:** the real-device acceptance checklist (`docs/PROJECTS-P5-PLAN-2026-11-05.md` section 6): deployed desktop and phone, backup, offline reload, two devices including permanent-deletion conflicts. Home & Assets not started.

## (Earlier) PROJECTS P5 PLAN, now built: see above.

Plan and acceptance checklist: `docs/PROJECTS-P5-PLAN-2026-11-05.md`. Gate passed (P4B `6545763` deployed successfully, tree was clean). Covers the total-cost bar (this closes the "TOTAL COST VISUALIZATIONS" input below once built), the agreement bar, paid-versus-left, the "No budget line" segment, the link to the filtered Reports view, a filtered-only CSV tweak, regression checks, and a deployed/phone/backup/offline/two-device checklist including permanent-deletion conflicts. **Owner decisions recorded (all recommended defaults):** bar = Expected total cost; a balancing-only "No budget line" is left out of the bar with an explanatory note; CSV change only for the filtered view. Still waiting for a go-ahead to build.

## STATUS 2026-11-05: PROJECTS P4B (INTEGRATION, USABILITY AND SAFE DELETION) BUILT, NOT COMMITTED, NOT PUSHED. Waiting for the owner's review.

Full report: `docs/PROJECTS-P4B-REPORT-2026-11-05.md`. Gate passed (P4A `1c478e0` pushed, its deployment succeeded). **1,340 tests pass** (was 1,300; 40 new in `p4b.test.ts` and `p4b-integration.test.ts`), type check and build clean, **no schema, backup or sync change**, no calculation change. All six workstreams built and browser-checked (desktop, 375 px, dark).
- **DONE: permanent project deletion** (tracked here explicitly). Archive and Restore are unchanged; "Delete permanently…" is a third action. Blocks while a commitment, a tagged transaction or a tagged split part remains (explained in plain words with links); unlinks tasks, milestones (become ordinary tasks) and events (repeats kept) without deleting them; removes shared links to the project, its budget lines and the project as soft-deleted records so it syncs. One atomic transaction. **FINAL conflict policy (narrow exception to last-writer-wins, only for permanently deleted projects):** the deletion WINS over any copy edited on another device, before or after, and its budget lines follow it; only money that still points at the project (a commitment or tagged transaction made on a stale device) or an intentional backup restore keeps it alive. Implemented with a marker inside the project's own data (`permanentlyDeletedAt`, and `revivedAt` stamped by restore), so no sync-format, schema or migration change; ten real-sync-engine regression tests. Old backups still contain the project; the app says so.
- **DONE:** `+project` in the Add box and Tasks bar (whole-name match only, never fuzzy, ambiguity and closed projects refused with a visible reason); bulk "Project…" in Tasks (preview, confirmation when replacing, all or nothing, Undo); task and milestone progress chips on the Projects list; "Project: name" on task, milestone and event search results; project filter on the Reports Trends tab (net, each transaction once; income and savings hidden while filtered; Flow diagram tab not filtered).
- **Judgment calls to review:** (1) `+` was chosen for the project word; (2) "No project (take off)" is the last option of the bulk menu; (3) Reports uses one optional `net` switch on the existing engine (default off, unfiltered results asserted unchanged); (4) the Calendar project filter was evaluated and NOT built (optional follow-up); (5) deletion wins over a stale edit on another device (policy above), the one exception to last-writer-wins.
- **Deferred, with reasons:** total-cost visualization card (owner's P4 input, below); Calendar project filter; line pre-select helper; one-click proportional payment assignment (would rewrite transactions into splits); Reports CSV and Budget page not project-aware.
- **Unresolved / not verified:** the Add-box Undo button was not clicked in the browser (unit-tested); one stale console error entry in the pane's buffer from the earlier P4A session (no new errors); two real devices, offline use, older app versions, real data; one first-run timeout of `csp.test.ts` under load (passes alone and in later runs).

## STATUS 2026-11-05: PROJECTS P4A (MULTI-LINE COMMITMENTS) COMMITTED AND PUSHED (`1c478e0`, deployment succeeded). Details below.

Full report: `docs/PROJECTS-P4A-REPORT-2026-11-05.md`. **1,300 tests pass** (was 1,254; 46 new in `src/modules/projects/p4a.test.ts`), type check and build clean, no schema, backup or sync change. **Final browser verification done (report section 11): P3 deployment succeeded; three wording/navigation defects fixed, no calculation defect; waiting for the owner's final approval.** The owner answered the four design questions with the recommended options (below). Built: an optional `allocations` list on a commitment, per-line agreed/paid/left (signed) in Finance with a reconciling "No budget line" row, split editor with "Left to allocate", suggested change-order split, breakdown on the contract card, "Which line is this for?" on payments, four new Needs-attention warnings, removal and below-zero guards. **Judgment calls to review:** (1) a change order without a split on a split agreement goes to "No budget line" with a warning; (2) a payment with no line on a split agreement is unassigned, not on the home line; (3) the one-click "assign existing payments in proportion" is NOT built (it would rewrite transactions into splits), each unassigned payment is fixed by opening it; plus six smaller ones in the report. **NOT built:** P4B; the total-cost visualization card; the pre-select-most-left helper. **Not checked in a browser:** the payment line box, the Budget-by-line table with payments, editing an existing split. Deployment of P3 not confirmed from here: check the Actions tab.

### P4A design review (earlier today; the owner's answers recorded)

P3 is committed (`50afaa4`) and level with `origin/main`; the green deployment run was not checked (no GitHub tool here), so please look at the Actions tab. Read `docs/PROJECTS-MULTILINE-COMMITMENT-DESIGN.md` against the code. The design is consistent with the code and covers: several lines per agreement summing exactly to the amount (3.2), change orders with their own lists incl. negative (3.3), single-line contracts read as one implicit entry (3.6), overpayment shown as a signed per-line "left" (3.5), a removed line falling into "No budget line" (3.2). Open items:
1. Payments on a split contract: must each name a line? (design Q1)
2. Change orders on a split contract: suggested split or empty? (design Q2)
3. Existing payments when an old contract is split: leave, or auto-assign? (design Q3)
4. NOT covered by the design: may allocations be edited after payments exist?
5. Gap found: 3.3 says a change order with no list goes to "No budget line", but 3.6 says no list means "home line". Recommended: under a split agreement, no list means "No budget line" with a warning.
6. Gap found: today a payment with no line falls back to the contract's home line. On a split contract that must not happen (it would misplace the money); it should show as "Not assigned". This changes the display only when the owner chooses to split a contract.
7. Design Q4 (helpers): recommended both "split evenly" and "in proportion to planned amounts".
8. The total-cost visualization card (P4 INPUT above) is not part of the P4A prompt; to be confirmed whether it is in or out.

## STATUS 2026-11-05: PROJECTS P3 (TASKS, MILESTONES, CALENDAR AND TODAY) BUILT, NOT COMMITTED, NOT PUSHED. Waiting for the owner's review. P4 is NOT started.

Full report: `docs/PROJECTS-P3-REPORT-2026-11-05.md`. Design review (read-only, nothing built): `docs/PROJECTS-MULTILINE-COMMITMENT-DESIGN.md`. **1,254 tests pass** (was 1,206; 48 new in `src/modules/projects/p3.test.ts`), type check and production build clean. **No database, backup or sync change** (schema still 15).

**What was built:**
- **Tasks on a project** (optional `projectId` on the existing task record): a Tasks section on the project page (add, add an existing one, tick, edit in the normal Task editor, remove from the project without deleting, To do / Overdue / Done / All, progress); a Project box in the Task editor; a project tag on task rows; a project filter on the Tasks page.
- **Milestones** (a task with `isMilestone`, no table of its own): a Milestones section with due date, tick, reopen, progress and overdue count; never double-counted with ordinary tasks; they reach the Calendar through the existing Tasks layer (filled-diamond title), no extra event.
- **Events on a project** (optional `projectId` on the existing event record, whole series for a repeating one): an Events section (add via the normal Calendar editor, add an existing one, remove, open in Calendar); a Project box in the event editor; a project marker on Agenda rows, day lists, tooltips and the detail dialog.
- **Project dates:** a read-only **Projects** calendar layer with each active project's start and target date (past ones are "handled", never overdue; a target marker is left out on a day when an open milestone of that project is due).
- **Coming up** list on the project page (next 30 days: tasks, milestones, events, plus overdue).
- **Today card "Projects":** active (Planning or Active) projects with overdue milestones or tasks, a target past or within 14 days; counts only, so no task or event shows twice.
- **Finance:** a Project filter on Transactions (chip, `?project=<id>`) and `?txn=<id>` to open one transaction; each project transaction row links to it, and "See in Finance".
- **Multi-line commitment allocation: design review written, not built.**

**Judgment calls (please review):** see section 8 of the report. In short: (1) Today shows only Planning and Active projects, 14-day target window; (2) a project's target marker and a same-day milestone are both shown (owner review); (3) past markers are "handled", not overdue; (4) one project per task or event, a repeating event's project covers the series; (5) linking something already on another project moves it, with Undo; (6) a repeating task cannot be made a milestone (enforced in the editor and `setMilestone`, not in the low-level repeat, because a Phase 0 test requires unknown fields to pass to the next repeat); (7) two existing tests that counted the built-in calendars were updated from 3 to 4.

**NOT built:** the multi-line allocation itself (P4); a project word in the Add box's task shorthand; bulk "move to project" in Tasks; project name in search result lines; project counts on the Projects list; a project filter in Reports or Calendar; file or document storage. **Not verified:** offline use and two real devices syncing; in a browser, changing or removing a project in the Calendar editor, the Milestone box in the Task editor, and dark theme.

## LONG-TERM ROADMAP (kept; NOT started; each item needs its own approval and design round)

From `docs/AUDIT-2026-11-05.md`: **Home & Assets** (properties, maintenance as repeating tasks, warranty dates, vendors), **Household Services**, **Bills** enhancements, **Subscriptions** (renewal and cancel-by dates), **Family Management**, **Personal CRM** beyond vendor contacts, **Documents** (records with a link, not file storage), and the **AI assistant**. Also parked: push notifications (decision at the top of this file) and a Projects P4 (recommended scope in the P3 report: multi-line commitment allocation first).

## P3 BACKLOG (owner, 2026-11-05, on approving P2 for push). STATUS: items 2 and 3 BUILT in P3 (uncommitted); item 1 has a design document (not built); item 4 still open.

1. **HIGH PRIORITY DESIGN ITEM: multi-line commitment allocation.** [Design written 2026-11-05: `docs/PROJECTS-MULTILINE-COMMITMENT-DESIGN.md`; the owner's multiple-choice round and the build are still to come.] Evaluate how one accepted contractor agreement can allocate its committed amount across several project budget lines, while payments remain independently allocated and all project totals reconcile without double-counting. Background: today a contract has one home line (or none), and its Agreed and Left to pay sit on that line; payments can already be allocated to other lines piece by piece (P2 follow-up), so for a general contractor the agreed amount sits in "No budget line". Questions the design must settle: how the committed amount is split (and what happens when a change order is added or the agreement is cancelled), how "Left to pay" per line is worked out when payments and commitments are allocated differently, and how the project totals and the per-line rows keep adding up to the same figures. Decide before building; ask the owner in one multiple-choice round.
2. **[built in P3, uncommitted]** **Direct transaction navigation from Projects:** a link from each project transaction row to the transaction itself in Finance.
3. **[Transactions built in P3, uncommitted; Reports NOT built]** **Project filter in Finance:** filter Transactions (and Reports) by project.
4. **Outstanding verification:** offline use and real two-device synchronization of Projects data have still not been checked. The owner's phone-width check (375 px) was also still to be done after the push.

## STATUS 2026-11-05: P2 FOLLOW-UPS FROM THE OWNER'S REVIEW BUILT, COMMITTED (ba2021e) AND PUSHED 2026-11-05 with P2 (9928eb9). 1,206 tests pass (was 1,194). P3 is NOT started.

P2 itself is committed (9928eb9) and was pushed together with ba2021e after the owner's approval. Owner ran the P2 checklist: sections A, B, D, E, G passed; F (phone width) to be checked after push. Two requests came out of it, both built:

1. **Split a payment by contract AND budget line.** Example: one $10k payment to a general contractor who coordinates the subs: $5k tile, $3k plumbing, $2k electrical, all counting toward the same project. Each piece of a split (and the whole-transaction box) now picks project, then optionally a contract, then optionally a budget line. Every piece on the contract counts against its "Left to pay"; each line gets its own piece. The Finance layer already read "the piece's own line, else the contract's line", so the change is in the form rules (`buildRef`) and the box (`ProjectTag`); the stored shape did not change (no schema, backup or sync change). The project's transaction list now shows "contract · line".
2. **N key opens the Add box** from anywhere (`GlobalFrame`), ignored while typing, with Ctrl/Cmd/Alt held, while a dialog is open, or when the key is held down. The Add button's tooltip says "Add (N)"; listed in More > Shortcuts and the README.

Tests added: 7 (split by contract and line; part payment; contract filed under a line; overpayment across parts; two contracts in one payment; wrong-project and money-back-on-a-part refusals; round trip through the form) and 5 (the N key rules). One older test changed meaning: a contract's own line is still not stored twice, but a DIFFERENT line is now kept.

Checked in a real browser (invented data, desktop and 375px, no console errors): N opened the Add box and typed nothing into it; Ctrl+N did nothing; a split of three pieces to one contract with three different lines saved through the form (this also covers the earlier unchecked "saving a tagged split through the form"), reopened with every tag intact, and the project page showed the contract paid for the whole amount with each line's share; no sideways scroll at 375px; the line list shows "Same as the contract (X)" first when the contract is filed under a line.

Judgment calls (please review):
1. A contract still has ONE home line (or none). Payments can go to other lines, but the contract's "Agreed" and "Left to pay" stay on its own line. For a general contractor, leave the contract with NO line: its agreed and left-to-pay then sit in the "No budget line" row, and the dashboard will say that amount is "not filed under any budget line". Splitting the agreed amount itself across lines is NOT built.
2. The same rule applies to the whole-transaction Project box (not only split pieces): a single payment can name a contract and a different line.
3. Money coming back on a split piece with a contract must still be marked reversal or credit (same rule as before).
4. The N key is ignored whenever any dialog is open, including a form in a dialog.
5. Bulk tagging still cannot set a contract line or split anything (unchanged).

NOT built: splitting a contract's agreed amount across lines; a contract picker that knows how much of each sub's quote remains; shortcuts for other single-key actions.

## STATUS 2026-11-05: PROJECTS P2 (COMMITMENTS AND FINANCIAL INTEGRATION) BUILT, COMMITTED (9928eb9) AND PUSHED. P3 is NOT started.

Full report: `docs/PROJECTS-P2-REPORT-2026-11-05.md`. **1,194 tests pass** (was 1,138; 56 new), type check and production build clean. No database, backup or sync change. Waiting for the owner's review before any commit or push.

**What was built:**
- **Commitments** on the project page: quotes, accepted agreements, change orders (positive or negative), declined and cancelled kept for reference; one optional vendor and budget line each; what is paid and left per agreement; payments listed.
- **Project money dashboard:** budget, planned, agreed, paid, left to pay, expected total, left in budget, unplanned amount, quotes waiting (never counted); budget by line (with a "No budget line" row); plain-words "Needs attention" warnings; click a figure or a line to see the commitments and transactions behind it.
- **Project box on transactions:** Add and Edit form (project, then only its lines and accepted contracts; a contract implies its line), per-split project and line, and a Project row in the Transactions bulk bar with a clear report of what was changed and what was left alone and why.
- **Refunds, credits, reversals:** money coming back on a project with contracts asks if it belongs to one; on a contract it must be a Reversal or a Credit (explained on the form); a credit not matched by a negative change order shows a warning and a button that opens a pre-filled change order (saves nothing until Add).
- **Safer editing:** a new `editTxn` runs the same project checks as creating, and the edit form no longer drops split tags.

**Tests added (56):** `src/modules/projects/commitments.test.ts` (33) and `src/modules/projects/txnTagging.test.ts` (23); see the report for the list.

**Checked in a real browser (invented data, deleted afterwards):** desktop and 375 px; see the report for what was and was not exercised.

**Judgment calls (please review):**
1. Payments are tagged to the original agreement, never to a change order directly (they reconcile on the agreement).
2. Only accepted agreements are offered for new payments (a chosen one stays visible even if later cancelled).
3. Bulk tagging cannot set reversal or credit and skips split transactions; both are reported with the reason.
4. Splits take a project and budget line but no contract.
5. Picking a vendor on a commitment adds that contact to the project's vendors automatically (no duplicate contact), and says so.
6. The quick Add box has no Project box; "More options" opens the full form that has it.
7. Three older bulk tests were loosened from exact match to "contains these fields" because the bulk result gained fields.
8. A change order cannot change another change order (this also rules out loops); change orders follow their agreement's budget line.
9. Until a credit has its matching negative change order, the contract shows as owed again (deliberate, with the warning).

**NOT built:** project-linked tasks, milestones or Calendar events; a Today card; project timeline; documents or file storage; a Project box in the quick Add box; vendor notes; re-attaching an orphaned change order; a link from a project transaction row to Finance. Not verified in a browser: accepting or declining a quote with the buttons, the Edit commitment form, removing a tag from the form, saving a tagged split through the form, offline use, real two-device sync.

## STATUS 2026-11-05: PROJECTS P1 (PROJECT FOUNDATION) BUILT AND COMMITTED, NOT PUSHED. P2 is NOT started.

Owner asked for the first usable Projects module: data model, module, budget lines, vendors. **1,138 tests pass** (was 1,111), type check and production build clean.

**What was built:**
- **Projects module** (fifth in the top-bar switcher, after Tasks): a list at #/projects (tabs Open, Finished, Archived, All, with counts) and one page per project at #/projects/<id>. Files in `src/modules/projects/`.
- **Project fields:** name, notes, status (Planning, Active, On hold, Completed, Cancelled), start date, target date, overall budget (cents; blank means the total of the budget lines is used), vendor contact ids, archived. Create and edit in a dialog with plain-words checks (name needed, real dates, target not before start, budget is an amount and not negative). Quick status change, Archive and Restore (with Undo) on the project page.
- **Budget lines:** add, rename, change the planned amount, reorder (up and down buttons), remove. The page shows the lines total against the overall budget in words: not planned yet, over by, matches, or "no overall budget so this total is the budget". A line that transactions are tagged to cannot be removed.
- **Vendors:** shared contacts, now with optional phone and email (`src/core/contacts.ts`). Add someone from your contacts, or add a new vendor (name, what they do, phone, email). An existing contact with the same name (ignoring case and spaces) is reused, never duplicated, and only its missing details are filled in. Edit a contact from the project (tel and mail links shown). Remove takes it off this project only. The same contact can be on several projects.
- **Search, linking and Add:** projects are found by name and notes in global search (grouped under Projects); the "Link a record" picker offers Projects (archived ones are labelled); the Add box has a Project destination (shortcut `p`, then the name; it starts in Planning; Undo removes it).
- **Finance compatibility:** the records use the field names Finance's project layer already reads, so tagging a transaction to a project and a budget line works, and `loadProjectSummary` gives the same planned total and not-yet-planned figure the screen shows. Nothing in Finance was changed.
- **No database change.** Projects and lines are `moduleRecords` (module `projects`, kinds `project` and `budgetLine`), one record each, so backup and sync cover them. No schema version bump, no backup format change.

**Tests added (27, `src/modules/projects/projects.test.ts`):** module registration and no Add-box clash; create, edit, every status, archive and restore; plain-words checks; the Add box and its undo; line totals, derived budget and the four comparison states; edit, soft removal and reordering (including a stable order for ties and no writes when nothing changes); removal blocked for tagged spending; vendors (new, same name reused, existing contacts compatible, several projects, remove, phone and email checks, clearing details, unknown contact fields kept); defensive reading and unknown fields kept through every change; search ranking; record lookup; Finance compatibility; export, restore and sync snapshot; two devices changing different lines.

**Checked in a real browser (invented data, since removed), desktop and 375 px:** empty list, create with bad budget and bad date messages, project page, three lines with the over-budget comparison, reorder, vendor with a bad email message then a good one, status change, archive, the Archived tab, search (Ctrl+K) opening the project, restore, Add box shortcut with its "Will add" preview and Undo toast. No console errors, no sideways scroll at 375 px.

**Decisions and deviations (please review):**
1. Status word is **Completed** (the Phase 0 plan said "done"); Finance does not read status.
2. **No delete for projects**, only archive and restore (plan decision R8). The Add box undo is the only removal, and only for a project made seconds earlier.
3. Vendor links are a list of contact ids **inside the project record** (as the plan said), so two devices adding different vendors to one project at the same moment would lose one (the lost edit is recoverable from the sync notices). Budget lines are separate records, so they do not have this problem.
4. A vendor is not a separate kind of record: it is a shared contact that a project points at. "What they do" uses the contact's existing `relationship` text. A future personal-CRM or household-services module can use the same contact without a second copy.
5. Contacts only gained two optional fields (`phone`, `email`); nothing requires them.
6. Unknown addresses under #/projects show the list.
7. The tab, form and list styles were written for Projects (`projects.css`); it does not import the Calendar stylesheet.
8. The Today screen has no Projects card yet, and project dates do not appear on the Calendar (both belong to later steps).

**Known limitations:** no way to delete a project or a contact from Projects; no Projects card on Today; vendors have no notes; no search of vendors from the Projects search group (contacts are still found by Tasks search); lines have no categories or notes; the "Link a record" picker was unit-tested for Projects but not opened in a browser; offline and real two-device sync were not exercised.

**Not built (as agreed):** commitments or change orders, transaction tagging screens, spending figures, project tasks and milestones, project Calendar events, documents, AI.

**Recommended scope for P2:** commitments (quote, accepted, declined, cancelled; change orders as child commitments) on the project page; a "Project" box on the transaction form and in bulk actions using the Finance layer (with the Reversal or Credit prompt, the pre-filled change order and the "is this refund about a contract?" question); then the dashboard figures from `loadProjectSummary` (paid, agreed, left to pay, expected total, left in budget) beside the existing budget summary.

## DECISION 2026-11-05 (owner): refunds versus credits in Projects. DECIDED AND BUILT into the project layer (uncommitted, with Phase 0). 1,108 tests pass.

The owner asked that money coming back be split into a **reversal** (undoes a payment) and a **credit** (reduces the contract), and that this be settled before the Projects dashboard is built. This replaces the single refund rule (plan edge case 7 and decision O2).

| Kind | Example | Agreed | Paid | Left to pay |
|---|---|---|---|---|
| Reversal | bounced cheque, duplicate charge returned, deposit returned to be paid again | unchanged | down | goes back up |
| Credit | discount, damaged item, scope cut | down, by a negative change order | down only if cash comes back | agreed minus paid, never below zero |
| Other money in (no contract) | insurance payout, rebate | no change | down | no change |

A credit applied to the balance has no transaction at all: it is only the negative change order.

**Owner's test case (becomes a test):** accept a $10,000 contract (paid $0, outstanding $10,000); pay a $3,000 deposit (paid $3,000, outstanding $7,000); the deposit is refunded and the contract stays active, marked Reversal (paid $0, outstanding must go back to $10,000). Under the old single refund rule outstanding would have stayed $7,000, which is wrong. Also test the same refund marked Credit with a -$3,000 change order (agreed $7,000, paid $0, outstanding $7,000).

Owner answers: (1) a refund tagged to a contract **must be marked** Reversal or Credit before it can be saved (no default); (2) marking a credit **offers a pre-filled negative change order** for the same amount, which can be unticked; if skipped, the dashboard flags "credit of $X has no matching reduction in the agreed amount".

**What was changed (done):** `ProjectRef` gets an optional `effect: 'reversal' | 'credit'`, used only on money-in tagged to a contract; `summariseProject` subtracts both reversals and credits from what was paid on the contract (so a credit with no matching negative change order makes the contract look owed again); new flags `creditsNotReflected` (credit with no matching reduction) and `unmarkedRefunds` (old or foreign data); `setTxnProject`, `bulkSetTxnProject` (counts `needsChoice`) and `createTxn` refuse money-in tagged to a contract with no mark, and refuse a mark on a payment or without a contract; the owner's $10,000 case, the credit version, a credit with and without its change order, and the database paths are tests; plan updated (edge case 7, rules, example 1 step 7, R5, O2). Not built: the "must choose" prompt and the offered change order (Projects screens). The "must choose" prompt and the offered change order belong to the Projects screens.

**Follow-up fix after the post-implementation check (uncommitted):** money coming back on a contract can no longer be more than what was paid on it. `setTxnProject`, `bulkSetTxnProject` (counts `exceedsPayments`) and `createTxn` refuse it with "That is more than the $X paid on this contract so far"; the summary has a `reversalsExceedPayments` flag and a `paidByCommitment` figure (never below zero) for old or synced-in data. A partial reversal of a partial payment is tested ($3,000 paid, $1,000 reversed: paid $2,000, outstanding $8,000 on a $10,000 contract). Two existing new tests were changed because they tagged a refund with nothing paid yet. 1,111 tests pass. Still a Projects-screen job: ask "is this refund about a contract?" when money coming back is tagged to a project only.

## STATUS 2026-11-05: PHASE 0 BUILT (all nine items), NOT COMMITTED. Projects is NOT started.

Owner said "go all" after the plan below. **1,098 tests pass** (was 1,050), type check and production build clean.

**What was built (numbers match the queue below):**
1. **Backup completeness test** (`src/lib/backupCoverage.test.ts`): fails if any database table is missing from the export, the file checker or the sync snapshot; one invented row per table is exported and restored; an old version-1 file restores empty. Did NOT change the backup code to build its lists automatically (offered as a later step).
2. **Unknown fields kept** on tasks and events (`asTask`, `asEvent` now carry fields they do not know). Tests (`src/modules/tasks/unknownFields.test.ts`): survive edit, bulk change, complete, reopen, repeat-spawn, event save; clearing a known field still clears.
3. **Finance project layer, no screens** (`src/lib/txnProject.ts`, `ProjectRef` on `Txn` and `Split` in `src/types.ts`): tag and untag a transaction or one split, bulk tag, refusals (transfers, setup entries, wrong project's line or commitment), tag cleared when a transaction becomes a transfer or is paired, bulk category change reports dropped split tags, and `summariseProject` / `loadProjectSummary` implementing the rules in the plan (change orders roll into their contract; refunds never re-open what is owed). The three worked examples from the plan are tests and match to the cent; reports and budget give identical results with and without tags; the field survives backup, restore and sync. No database version change, no index.
4. **Date fixes**: `asEvent` default date, Calendar search fallback, encrypted export filename now use the local day. `dateZones.test.ts` (Los Angeles, Auckland, UTC) and `dateGuard.test.ts` (fails if a new UTC-day slice appears outside five allowed files).
5. **Shared code moved**: `time` and `recurrence` to `src/core/`, priority names to `src/core/priority.ts`, `pickers`, `RepeatFields`, `PriorityMark` to `src/ui/`. One-line re-exports remain at the old Calendar paths. Tasks, Today and Ledger now import from the new places. CSS and the Calendar tests were not moved.
6. **Linkable Tasks and Calendar events** (`records.ts` in each): the "Link a record" picker now offers Ledger, Calendar and Tasks; a deleted target shows "(no longer exists)".
7. **Sync visibility**: Sync page shows file size, record count, uploads today and in 30 days, and a note past 5 MB. Automatic runs skip the download when GitHub's file is the version this device last saw and nothing changed here (Sync now always does a full run). Tests in `src/lib/sync/skip.test.ts`.
8. **Security policy** added to the production build only (`src/shell/csp.ts`, plugin in `vite.config.ts`): this site only, GitHub and the price service for connections, two inline theme scripts allowed by hash. A test fails if the app fetches from a host not on the list.
9. **One create path** (`src/lib/txnCreate.ts`): the Add form and the quick Add box now use `createTxn`.

**Checked in a real browser (desktop and 375 px, invented data, then removed):** Tasks, Calendar, Today open with no errors and no sideways scroll; the task editor shows the repeat box and the Link picker with Ledger, Calendar and Tasks; a transaction added through the quick Add box changed the balance correctly. On the production build the policy is in place, a connection to a non-listed host was blocked, and the dark-theme setting still applied (so the allowed inline script runs).

**NOT verified (honest list):** the offline service worker under the new policy (the preview browser cannot register a service worker even without the policy, so this needs your phone or Chrome after publishing); real GitHub sync with the skip logic and the new Sync page figures (tests use an in-memory copy only); two real devices; phone speed; the "More options" transaction form and the edit form were not opened after the create-path change (type-checked and unit-tested only); price lookups and sync under the policy (hosts are on the list; not exercised).

**Judgment calls (please review):**
1. Unknown fields are carried in `asTask`/`asEvent` (not merged at save time), so every writer, including spawn and bulk, keeps them. Calendar layers and task lists were not changed.
2. A transaction tag is one small object (`project`, optional `budgetLineId`, `commitmentId`) on the transaction and on each split; a split's own tag wins. Splits with no tag inherit the transaction's.
3. A change order is a commitment with `parentId`; payments tagged to the original or the change order count toward the whole contract. Payments on a quoted, declined or cancelled contract appear as "paid on inactive" and still count as paid.
4. "Expected total" ignores a contract's overpayment (shown as a flag only).
5. The skip check treats any changed record, any change in record counts, or any record without a timestamp as "changed here" and falls back to a full run. Device-only price key changes are ignored.
6. The policy allows inline styles (`'unsafe-inline'` for styles only) because screens set styles directly.
7. The Calendar tests stayed where they were and import through the old paths.
8. No test for `headSha` in the GitHub client itself (the listing code was refactored and the existing GitHub tests still pass).

**NOT built / still queued:** deriving the backup lists from the database automatically; compressing the weekly encrypted backup; passphrase hint (plan item B7, not in the nine); Projects itself (its own plan: record types, screens, dashboard, transaction "Project" field, Today card, Search, Add, vendor details on contacts); owner actions (GitHub two-step sign-in, token check, other-Pages-sites check, optional two-device test).

## PREVIOUS STATUS 2026-11-05: PHASE 0 PLANNED, DECISIONS RECORDED.

Full report: `docs/PHASE0-PLAN-2026-11-05.md` (read-only validation of sync, backup, credentials, shared code, Finance writes and dates; the Projects money model; the Phase 0 plan and the order of work). The earlier audit is `docs/AUDIT-2026-11-05.md`.

**Owner decisions (2026-11-05): all recommended defaults R1 to R16 and O1 to O8 in the plan are approved.** In plain words:
1. Project spending still counts in the monthly budget (nothing changes there).
2. A refund lowers what was paid but does not make a contract look unpaid again; a reduced job is a negative change order.
3. No "billed so far" figure on contracts in the first release.
4. If another GitHub Pages site shares the app's address, decide between a custom domain and a separate GitHub account after the check.
5. Projects with money attached are archived or cancelled, not deleted.
6. Sync is redesigned only if the encrypted file passes about 5 MB, the repository about 800 MB, or a sync takes about 3 seconds on the phone.
7. Shared Calendar code is moved (with old paths kept working) before the Projects screens are built.
8. The security policy is added before any AI work, not before.
9. Stay without a server through Projects; decide on one at the AI phase.

**Queued work, in order (nothing started):** owner actions (GitHub two-step sign-in, token check, look for other Pages sites, optional two-device test); 1 backup completeness test; 2 keep unknown fields on tasks and events (blocker for Projects); 3 Finance project layer, no screens (blocker); 4 date fixes and guard test; 5 shared-code move; 6 linkable Tasks and Calendar records; 7 sync visibility; 8 security policy; 9 one create path for transactions (optional). Then Projects, as its own plan.

A bare "go" means everything queued above; or name the numbers to build.

## STATUS 2026-11-05: Phase 3 PART E BUILT (verification and tuning). SIGNED OFF 2026-11-05 (all final checklist items passed, including the open Part A, C and D steps), committed and pushed. PHASE 3 IS COMPLETE. Phase 4 is NOT started.

Owner decisions: heavy invented data; also replace the remaining browser suggestion pop-ups; fix only obvious speed problems.

**What was done (Part E):**
- **Speed measured** (desktop browser, no slowdown, 20,000 transactions + 1,500 tasks + 600 events + 150 scheduled items, switching screens inside the app; 4 runs each; 'settled' = nothing on screen changed for 0.35 s; 'longest block' = the longest time the page was frozen):
  - Calendar: first content 0.15 to 0.3 s, settled about 0.25 s, longest block about 0.1 to 0.14 s.
  - Tasks: first content 0.1 to 0.2 s, settled 0.1 to 0.2 s, longest block 0.06 to 0.13 s.
  - Ledger Home: first content 0.03 to 0.5 s, settled about 0.9 to 1.0 s, longest block 0.13 to 0.21 s.
  - Today BEFORE the fix: settled 0.95 to 1.5 s, longest block 0.49 to 0.69 s, about 9,700 page elements.
  - Today AFTER the fix: first content 0.03 to 0.24 s, settled 0.57 to 0.87 s, longest block 0.16 to 0.23 s, about 2,000 elements.
  - Search (from Part C, same data): about 25 ms per search, about 130 ms from typing to results.
- **The one obvious problem, fixed:** with that much data, Today's Overdue card drew 643 rows at once. It now lists the first rows only (a shared setting: **Edit layout > Overdue lists up to 5, 10, 15, 20 or 25 items**, default 25, next to the look-ahead setting) and, beyond that, shows a link per module such as "Show 35 more overdue items in Tasks" that opens the module's own list (Tasks: Overdue view; Ledger: Scheduled; Calendar: Agenda from the start of the overdue window). The count badge always shows the true total. Checked in a real browser with 40 invented overdue tasks (set to 25: 25 rows and "Show 15 more"; set to 5: 5 rows and "Show 35 more"); removed again.
- **Slowest remaining part** is about 0.6 to 0.9 s of waiting for the cash forecast (about 0.18 s of it) and alerts to finish over 20,000 transactions; Ledger Home does the same work. Not changed (proposal: none needed unless it feels slow on your phone).
- **Widths:** at 700 px (the 641 to 899 range) and at 320 px (narrow phone), Today, Calendar, Tasks and Ledger have no sideways scroll; the round + sits in the bottom corner (above the tab bar in Ledger) and nothing was under it; the search dialog and Add box fit the screen.
- **Real backup and restore, run in the browser:** built a 5.3 MB backup of the heavy data, deleted 63 transactions and changed the Today layout and Hide amounts settings, then restored: all 20,009 transactions came back and both settings came back exactly. 
- **Pop-ups replaced:** the giving charity box, the investment ticker box and the RSU grant ticker box now use the in-app suggestion list (like the payee box). No browser pop-up lists remain in the app.
- Test data was all removed again (the browser is back to its original counts).

**Verified:** 1,046 tests, type check and production build clean.

**NOT verified (honest list):** speed on a phone-speed processor (my machine has no slowdown, and the preview tool cannot throttle it; your phone is the real test); the round + on a real iPhone; two real devices syncing; midnight rollover (see steps below); the new suggestion list on the Investments and RSU grant screens (type-checked, and the Giving screen was opened in a browser, but I did not open an investment account or the grant form); Today with 30-day look-ahead on heavy data.

**Judgment calls (please review):**
1. Overdue lists 25 rows by default (your choice of 5 to 25 in Edit layout). The "more" link goes to each module's own screen rather than expanding in place. The Calendar link opens the Agenda from the start of the overdue window, which shows only the next 14 days from there, so it may not list every Calendar item (Calendar events are rarely the overdue ones).
2. Only Overdue is capped. Coming up (up to 30 days) and Today's own list are not; they were 105 and 35 rows in the test.
3. I did not slow the processor, so I cannot say how a phone will feel; the numbers above are a desktop baseline.
4. The ticker boxes list tickers only (the company name is not shown next to each suggestion any more).

**Deferred or skipped, and why:**
- Phone-speed measurement: needs a real device.
- Two-device and midnight checks: need your real devices (steps below).
- A cap or collapse for the other cards: not needed on these numbers.
- Ledger fields for card due days and subscriptions, and real push notifications (see the notes at the top of this file): later phase.
- Part D item still open from you: re-test steps 3, 4, 5, 7, 9 and 11.

**Final Phase 3 checklist (for the owner):**
Part E items
1. Open Today on your real data, on desktop and phone. Does it feel quick? Note anything slow and on which device. Overdue lists up to the number you choose in Edit layout (5, 10, 15, 20 or 25); if there are more, a link such as "Show N more overdue items in Tasks" opens that module's own list. Try changing the number.
2. Narrow and mid widths: at about 700 px wide (a small window on desktop, or a tablet) and on a small phone, open Today, Calendar, Tasks and Ledger. No sideways scrolling; the + button covers nothing; open Search and the Add box and check they fit.
3. Suggestion lists: Giving (charity), an investment account (ticker) and the RSU grant form (ticker): each shows a list directly under the box as you type, and picking one fills the box.
4. Backup round trip on your real data: Settings > Backup, export, then restore the same file. Afterwards your accounts, tasks and events are all there, Today's layout and Hide amounts are as you had them.
Two-device checks (I cannot do these)
5. Today layout is per device: on the phone, hide a card or change its width; the desktop layout does not change (and the other way round). Hide amounts is also per device.
6. Dismissed or snoozed alerts are shared: on the desktop, dismiss an alert on Today; after the next sync the phone no longer shows it (and Bring back on one returns it on the other).
7. Edit on both: add a task on the phone and an event on the desktop; after syncing, both appear on both devices and on Today.
Midnight
8. Leave Today open on a screen past midnight (or set the computer clock to a few minutes before midnight). Within about 30 seconds after midnight the date heading changes, the Today list switches to the new day, and what was due yesterday moves to Overdue.
Earlier parts still open
9. Part D steps 3, 4, 5, 7, 9 and 11 (re-test after the fixes); Part C steps 10 and 11; Part A step 5 (the round + on a real phone).
10. Check the GitHub Actions tab shows green after the Part D push and after any push of this part.

## STATUS 2026-11-05: Phase 3 PART D BUILT (global quick-add, the Add box). Committed and pushed (78fc303). Owner re-test of steps 3, 4, 5, 7, 9 and 11 still open.

**Owner's first checklist pass (2026-11-05):** steps 1, 2, 6, 8, 10 passed; 11 to be tested later. Steps 3, 4, 7, 9 failed on one bug: after typing a shortcut (`t `, `e `) the next keystroke dropped the destination and went back to the opening question. FIXED the same day (the choice now sticks while typing; checked in a real browser with typed keystrokes: `t buy milk tomorrow` stays on Task, clicking Event keeps the words). Also fixed: the cursor now starts in the text box when the box opens and after each choice. Step 5: the payee suggestion list opens off to the left (the browser's own pop-up list, the same quirk seen earlier in Ledger's quick form). FIXED the same day: the payee box in both transaction forms (the quick form and the full form) now uses an in-app suggestion list directly under the box (new `src/ui/PayeeInput.tsx`; up to 6 matches, click, arrow keys and Enter, Esc closes) instead of the browser pop-up. Checked in a real browser. Other boxes that still use the browser pop-up (giving charities, investment tickers, RSU grant tickers) are unchanged. Awaiting re-test of 3, 4, 5, 7, 9.

Owner decisions that shaped it: (1) shortcuts both short and whole-word; (2) a date with no time is all-day; (3) no calendar named means the default calendar; (4) a transaction uses Ledger's existing quick form. (The Part C event-location note was answered "Not a problem": no change.)

**What was built (Part D):**
- **One Add box, from every module.** The "+" (round on phones) and Add button open one box with four choice buttons: **Task, Event, Transaction, Scheduled payment**. Shortcuts: `t `/`task `, `e `/`event `, `$ `/`txn `, `b `/`bill ` (a colon is fine: `task: ...`). The buttons show the short ones. With no choice and no shortcut it **asks** ("What kind of thing is this?") and never guesses.
- **"Will add:" preview** for Task and Event: a summary line plus one pill per understood field (event: when, calendar, repeat, priority, tags; "(new)" on tags that do not exist yet). You edit by changing the text; "Use as plain title" turns the shorthand off. Cancel, Esc and clicking outside save nothing.
- **Task:** the Tasks bar's own `parseQuickAdd`, unchanged, saved the same way. **Event:** new small parser (`modules/calendar/quickEvent.ts`) that reads time ranges (`3-4pm`, `3pm-4:30pm`, `from 3 to 4pm`, `11-1pm` = 11am to 1pm) and hands the rest (dates, `!priority`, `#tag`, repeats with the same number words, `@calendar`) to the Tasks parser so both bars agree. No date means today; no time means all-day; one time means one hour. Undo appears after saving either one.
- **Transaction:** Ledger's existing quick form (payee and category suggestions, amount math, account default, Save and add another) shown inside the box under "Will add: a transaction". **Scheduled payment:** a button that opens Ledger's Scheduled screen (not parsed inline).
- **Wrong shortcut recovery:** type `t dentist sat at 3pm`, click Event, and the shortcut is replaced by your choice and the words are kept.
- **Event bridge** (`core/eventBridge.ts`, `requestEvent({title, date})`) like `requestTask`: opens the box on Event with the text filled in. The search action "Add an event" now uses it (it used to open a blank Calendar form). `ledger:add-transaction` (and `openAddTransaction`) still work and open the box on Transaction.
- **Hooks:** `contributes.quickAdd` may now be a list, a destination may have `aliases`, `start()` (so the preview can name calendars, lists and tags), a `Form` (transaction) or an `open()` (scheduled payment); `parse` and `commit` are optional for the form kinds and `commit` may return an undo. Clashing shortcuts or whole words are rejected at start-up. See `docs/module-hooks.md`.

**Verified:** 1,046 tests (23 new: time ranges, event parsing and fields, shortcut routing, multi-destination registry rules), type check and production build clean. In a real browser (invented data, all removed again): event with range, priority, tag and an unknown `@name` saved, shown in the Calendar Agenda, with the right preview; task saved and undone; wrong-shortcut recovery; Cancel saved nothing; Transaction form and the Scheduled button; the old transaction event; 375 px width has no sideways scroll and the round button sits under the dimmed overlay. NOT verified: saving a transaction through the box (the form is unchanged Ledger code), a real iPhone, the 641 to 899 px range (Part E).

**Judgment calls (please review):**
1. **Edit before saving = edit the text.** The preview updates as you type; there is no separate field editor or "open the full event form" button.
2. **An `@word` that is not one of your calendars stays in the title** (so `@nothere` shows in the event name) instead of vanishing; a matching calendar name picks that calendar. Only your own local calendars can be named.
3. **Tags typed in an event are created if new**, same as tasks.
4. **The Transaction shortcut `$ coffee 4.50` only picks the form**; the words are not copied into it (the form has no way to take them yet).
5. **`b` / `bill` / `scheduled`** is my choice of shortcut for Scheduled payment.
6. **Old pop-up menu removed:** "Log a trade" and "New paycheck scenario" are now small links at the bottom of the box; "Add a scheduled item" became the Scheduled payment button.
7. **A shortcut needs a space after it** (`t buy milk`); `tomorrow call mom` is never read as a shortcut. Only the first word counts.
8. **Time ranges need am or pm on the end** (`3-4pm`, not `15-16`), so a date like 2026-11-12 is never read as a time. 24-hour `15:00` still works as a single time.
9. **Events are one-day only**: a range crossing midnight or a multi-day event is not parsed (use the full Calendar form).

**NOT built in Part D (by design or later):** event reminders and location in the line; an event for a date range; copying text into the transaction form; a "Save and add another" for tasks and events; phone-speed and 641 to 899 px checks (Part E).

**Part D checklist (for the owner):**
1. On desktop, from Calendar, Tasks, Today and Ledger click Add. The box opens with Task, Event, Transaction and Scheduled payment, and the shortcuts listed under it.
2. Type a line with no shortcut ("buy milk"): it asks what kind of thing this is and the Add button stays off. Click Task: a "Will add:" preview appears.
3. Task: type `t pay contractor fri !high #renovation every week`. The preview shows the date, priority, tag and repeat. Press Enter: a toast says Added, with Undo. Check it in Tasks, then try Undo on another.
4. Event: type `e lunch with sam fri 12-1pm`, then `e dentist tomorrow`, then `e call mom at 3pm`, then `e standup mon 9-9:30am every monday`. The preview shows all-day, timed, one hour and a repeat as expected. Save one and find it in the Calendar. Try `@` plus one of your calendar names, and `#newtag`.
5. Transaction: pick Transaction (or type `$ `). Ledger's quick form appears under "Will add: a transaction"; save one the usual way, including Save and add another.
6. Scheduled payment: pick it and press the button: Ledger's Scheduled screen opens.
7. Wrong shortcut: type `t dentist sat at 3pm`, then click Event: the shortcut disappears and the preview becomes an event.
8. Cancel, Esc and clicking outside the box: nothing is saved in any of the three.
9. Use as plain title: with `e lunch fri 12-1pm !high` ticked, the whole line becomes the title.
10. Search (Ctrl+K) then "add event" opens the Add box on Event; "add task" and "add transaction" still work; Ledger's old shortcuts still work.
11. On the phone (or 375 px): the round "+" sits at the screen edge in Calendar, Tasks and Today and above the tab bar in Ledger; the box fits with no sideways scrolling; nothing overlaps the "+".

## STATUS 2026-11-05: Phase 3 PART C BUILT (global search across Ledger, Calendar, Tasks and Today). SIGNED OFF 2026-11-05 and pushed (steps 10 and 11, phone and real-data speed, to be checked by the owner after the push). Owner note on step 3: searching by an event's notes seems to show the note, while a location match does not seem to show the location; location search itself works in tests and in the browser, so this is about what the result line displays. Not yet clarified or changed. Parts D and E not started.

Part B was signed off and pushed (b9d3bab) before this started.

**What was built (Part C):**
- **One search box, grouped by module.** Ctrl+K, `/` and the Search button now ask every module's own search source and show the answers under a heading per module (Ledger, Calendar, Tasks, Today), the module with the best match first. Each module offers its source through `contributes.searchSource` (documented in `docs/module-hooks.md`). A source that fails is left out; the others still answer.
- **Ledger** keeps everything it found before (pages, accounts, investment accounts, holdings, loans, paycheck scenarios, transactions with "See all N") and now also finds **scheduled items by payee or memo** (opens that item in Ledger's Scheduled edit form).
- **Calendar:** your **events** by title, notes and location (a repeating event opens its next occurrence), and the Calendar page. **Tasks:** **tasks** by title, notes and checklist items (open tasks above done ones when equally good), **tags** and **contacts** (open Tasks filtered to that tag or contact), and the Tasks page. **Today:** the Today page.
- **Open at the record.** A task opens its editor, an event opens its editor in the Calendar, a scheduled item opens its edit form, a tag or contact opens Tasks filtered to it (a "Contact: <name>" label and Clear filters appear). Existing Ledger hits open where they did.
- **Two new actions** in the list: **Add a task** (opens the quick-task form from anywhere) and **Add an event** (opens a blank event in the Calendar). The existing four actions are unchanged.
- **Speed (measured).** In the preview browser with 20,000 invented transactions, 1,500 tasks, 600 events and 150 scheduled items: before a fix a search took about 110 to 145 ms, almost all of it reading the transactions out of the database (about 90 ms; scanning them takes about 8 ms). Now, while the dialog is open, Ledger keeps a live in-memory snapshot (the same trick the old dialog used), so a search takes about 25 ms, and about 130 ms passes from typing to results on screen (including a 90 ms pause after you stop typing). No index and no database change were needed. NOT measured: a phone-speed processor (my machine is a desktop with no slowdown), and the first keystroke before the snapshot has loaded (it reads directly, about 110 ms here).

**Verified:** 1,023 tests (16 new: task and event matching and ordering, tag/contact hits and the contact filter, scheduled-item hits, repeating-event opening, group ordering), type check and production build clean. In a real browser (invented data): results are grouped as above; the event, task (found by a checklist word), scheduled item and tag each open at the right place; the contact link filters Tasks; "Add an event" and "Add a task" open their forms from the Calendar; the dialog at 375 px has no sideways scroll. Test data I added is removed again.

**Judgment calls (please review):**
1. **Tags and contacts are searched from the Tasks module** (they are shared records, and Tasks is where they can be filtered). Searching a contact shows only its tasks; events with that contact are not listed.
2. **Result caps:** up to 8 tasks, 8 events, 3 tags and 3 contacts; Ledger keeps its old 14. Done tasks are included but ranked lower.
3. **Groups are ordered by their best match,** not by a fixed module order, so the module with the closest hit comes first.
4. **A repeating event opens its next occurrence** (within about a year); one with none left opens its first.
5. **Add an event** goes through a link to the Calendar (`#/calendar?new=1`), not a real "create an event from anywhere" bridge; the proper bridge arrives with Part D.
6. **Search waits 90 ms after you stop typing,** then asks all modules in parallel; results from an older search never overwrite a newer one.
7. **Retired events** (turned into a Ledger scheduled item) are not searchable, to avoid duplicates.

**NOT built in Part C (by design or later):** search by an amount for tasks or events; searching attachments, categories, budgets, goals, payee rules or RSU grants; recent searches; highlighting the matched words; a search index (not needed on these measurements); the Add box with a destination chooser and preview (Part D); phone-speed measurement (Part E).

**Part C checklist (for the owner):**
1. From Calendar, Tasks, Today and Ledger press Ctrl+K (or `/`, or click Search). Type a word that is in a task, an event and a payee at once: results appear under separate headings (Ledger, Calendar, Tasks).
2. Click a **task** result: Tasks opens with that task's editor. Search a word that only appears in the task's notes, and in one of its checklist items: both find it.
3. Click an **event** result: the Calendar opens with that event's editor (try one by location, and one by its notes).
4. Click a **scheduled item** (a bill's payee): Ledger Scheduled opens with that item in the edit form.
5. Search a **tag** name and a **contact** name: Tasks opens showing only that tag's or contact's tasks; "Clear filters" returns to all.
6. Type "tasks", "calendar" and "today": each page appears as a result and opens.
7. Check the old results still work: an account, a ticker, a loan, a page such as "budget", and a payee with "See all N matching transactions".
8. Actions: type "add task" (a quick-task form opens on top of whatever page you are on) and "add event" (the Calendar opens a blank event for today). "add transaction" still works.
9. Type quickly and delete everything: no stale results stay; an empty box shows the hint; a word with no match says "Nothing matches".
10. Use arrow keys and Enter to pick results; Esc closes. Try it on the phone (or 375 px): results fit, no sideways scrolling.
11. Speed: on your real data, type a few searches. Note anything that feels slow, and on which device (a phone is the one to try).

## STATUS 2026-11-05: Phase 3 PART B BUILT (the Today screen) plus the minimum account balance. SIGNED OFF 2026-11-05 (all 13 checklist items passed) and pushed. Parts C to E not started. The owner will live with Part B for a few days before Part C.

Part A was signed off 2026-11-05 and pushed. The owner added a request during sign-off: **a minimum balance per account** ("never let checking go below $2,000"). It was folded into Part B; the design answers were: both checks (today's real balance per account, and the forecast), set on the account, shown on Today as an alert plus the cash outlook.

**What was built (Part B):**
- **Today screen** (`src/modules/today/`). Header with the date, a **Hide amounts** switch (per device) and **Edit layout**. Phone: one column; desktop: two.
- **Six cards.** Today (events, tasks, bills, vests, tax dates, all-day first), Reminders due, Overdue (last `overdueDays`, grouped by module, with "N older items in <module>" links), Coming up (next 7 days by default, grouped by day), Needs attention (Ledger's alerts), Cash outlook (low point of the next 90 days). Reminders due and Overdue disappear when empty; Cash outlook disappears when there is no meaningful forecast.
- **One shared row** for every list: colour bar, priority mark (a shape plus a hidden word), title, when, and either a round check button (tasks, and Calendar events you chose to keep until done) or an "Edit in Ledger / Edit in Calendar" button. Completing shows an Undo message. Bills and other Ledger items have NO money action here, only "Edit in Ledger".
- **Needs attention** uses the same alert code as Ledger Home (moved into `useLedgerAlerts`; Home calls it too and looks the same). Each alert can be **dismissed** or **snoozed** (tomorrow / next week) and is remembered against the alert plus the period it is about, shared across devices, so it comes back when the situation changes. "N dismissed or snoozed" lists them with "Bring back".
- **Edit layout** (per device): reorder, wider/narrower, hide/show, reset to default. New cards from future modules appear by themselves. The layout is in the backup's preference list. The "Coming up looks ahead" choice (3 / 7 / 14 / 30 days) is shared across devices.
- **Performance.** All dated items come from ONE aggregation (the Calendar's data hook) shared by four cards; the cash forecast is worked out once and shared (`useSharedLive`). Measured in the preview browser with 6,000 invented transactions and 400 invented tasks: Today shows all its cards about 100 to 125 ms after opening it from another page (3 runs: 126, 103, 116 ms), on a desktop with no slowdown applied. NOT measured: a phone-speed processor, a cold first load, the Calendar or Tasks load time (Part E).
- **Minimum balance.** New optional "Minimum balance" box on each checking or savings account's OWN page (Ledger > Accounts > the account), with a line saying whether it is above or under; the Accounts list only shows a read-only "Minimum $X" note. (1) An account whose real balance is under its minimum gives a warning alert ("Checking is $1,650.00, under your $2,000.00 minimum") on Today and Ledger Home. (2) The forecast now warns when the pooled balance would fall under the TOTAL of the minimums of the accounts it counts; with no minimum set anywhere it still uses the single "Warn me below" level. The Forecast page, the Afford page, Home and Today all use that same level; the Forecast page's "Warn me below" box says when it is not being used.
- New hook details and the "older items" provider method are in `docs/module-hooks.md` and `docs/due-provider.md`. Calendar links now accept `?open=` (opens one event); Today uses it.

**Verified:** 1,007 tests (40 new: minimum balance, alert periods, cash outlook, list rules, layout, settings, dismissed/snoozed alerts, Hide amounts), type check clean. In a real browser (invented data): Today renders all cards; the Overdue event opens in the Calendar editor from Today; a task is completed from Today and Undo brings it back; Hide amounts masks every amount (alert text, cash low point) and is remembered; Edit layout hides a card and the choice survives a reload; a minimum on an account produced the alert, Dismiss and Snooze hid it, it stayed hidden after a reload, and it came back when its period rule changed (the same mechanism as a new month or a different minimum, which the tests cover); 375 px: one column, no sideways scroll; the Accounts page shows the new box. **Not run:** second-device sync of dismissed alerts (it is a normal settings row, so it should follow the existing sync), midnight rollover on Today, a backup restore of the layout, a real iPhone, the minimum-balance forecast on a long-running real account, snooze "next week" return.

**Judgment calls (please review):**
1. **Forecast level = total of minimums.** If you set a minimum on any checking or savings account the forecast ignores "Warn me below" and uses the sum (savings only when "Count savings as cash" is on). A pooled forecast cannot tell which account a paycheck or bill touches, so a true per-account forecast is not possible. Side effect: with one large minimum you can see two alerts for one problem (the account one and "Cash may drop to ...").
2. **Minimums apply to checking and savings only,** not cards or loans. Closed accounts are ignored.
3. **(Changed after the first review: the minimum balance box moved from the Accounts list to the account page, and snooze gained a custom date.)** **Alert memory** is one settings row per dismissed or snoozed alert-and-period (so two devices never overwrite each other). "Bring back" marks the row active; rows are never deleted, so a long-lived install collects a few small rows.
4. **When a dismissed alert returns:** backup and check-in alerts each month; scheduled-items alert each day; cash-may-drop when the dip date changes; over-budget when the list of categories changes or a new month starts; minimum-balance when the month, the minimum or the sign of the balance changes; yearly alerts each year. Snooze is "tomorrow", "next week" or a date you pick (any real date after today).
5. **Hide amounts masks by text pattern:** any "$1,234.56" in an alert, bill name or task title becomes "$••••" (dates and counts stay). The cash outlook shows "$••••" for its figures.
6. **Today ignores the Calendar's "hidden calendars" switches** (they are a per-device Calendar view choice) so Today never silently drops bills or tasks.
7. **Reminders due** covers Calendar event reminders only. Tasks have no reminder times today (only a "reminder" priority). In-app only: nothing sends a notification.
8. **Calendar events kept until done** also get a check button on Today (completing writes the event's own done mark, like the Calendar). Calendar events that are overdue are listed under "Calendar" in Overdue.
9. **"N older items"** uses a new optional method on a due provider. Tasks counts open tasks due before the window; Ledger counts scheduled items never approved or skipped before it. Calendar events have no older link.
10. **Cash outlook shows the lowest point of the next 90 days,** not the whole 12-month forecast, and nothing if there is no cash account or nothing to forecast from.
11. **Coming up** has no check buttons on bills; tasks there can be completed. It lists the first day of multi-day events only.
12. **Home now reads its alert data through the shared hook** (so Home and Today cannot disagree). Home's own look is unchanged apart from the new minimum-balance alert.
13. **Edit layout shows hidden-because-empty cards** (labelled "nothing to show now") so you can still move or hide them.
14. The preview browser's own invented data had a temporary $50,000 minimum, 6,000 transactions and 400 tasks during testing; all removed. Nothing of yours was touched.

**NOT built in Part B (by design or later):** search sources and Add for Today's data (Parts C and D); money actions; push notifications; an alert history page; a minimum balance on cards or loans; per-card options beyond the look-ahead; measurements on a phone-speed processor and the Calendar/Tasks screens (Part E); drag to reorder.

**Part B checklist (for the owner):**
1. Open Today. You see Today, Reminders due (only if something is due), Overdue (only if something is), Coming up, Needs attention and Cash outlook. Compare with the other modules: today's events and tasks match Calendar's Agenda and Tasks > Today; Overdue matches Tasks > Overdue and Ledger > Scheduled for the last 30 days; Coming up matches the Calendar for the next 7 days.
2. In Overdue, if "N older items" appears, click it: it opens that module's own view (Tasks Overdue, or Ledger Scheduled).
3. Complete a task with its round check button: an "added/Done" message appears with **Undo**; Undo brings it back. A bill shows "Edit in Ledger" (opens the Scheduled item) and has no pay or skip button. An event opens in the Calendar editor when you click its title.
4. Turn on **Hide amounts**: every dollar amount on Today (alerts, bill names, cash low point) turns into $••••. Reload: it stays on. Open Today on another device: it is NOT on there.
5. **Minimum balance:** open a checking account (Ledger > Accounts > its name) and type a minimum (more than the balance) in "Minimum balance". Today > Needs attention shows "<account> is $..., under your $... minimum". Click **Dismiss**: it goes (and "1 dismissed or snoozed" appears). Reload: still gone. Change that account's minimum to a different number: the alert comes back. Try **Snooze**: tomorrow, next week, and a date you pick (the Snooze button stays grey until the date is after today; the list then says "snoozed until <date>"). Click **Bring back** from the list.
6. With a minimum set, open Ledger > Forecast: the warning level now equals the total of your minimums and the "Warn me below" box says it is not being used. Clear the minimum: the old level returns.
7. Cash outlook shows the lowest balance in the next 90 days with its date, and says whether it stays above your level. It disappears if you have no cash account.
8. **Edit layout:** move a card, make one wider (computer), hide one, press Done; reload: the layout stays. "Reset to default" restores it. Change "Coming up looks ahead" to 14 days: Coming up grows. (This look-ahead is shared with your other devices; the layout is not.)
9. Backup and restore: export a backup, then restore it: your layout and Hide amounts setting return. The dismissed alerts also return (they are normal data).
10. Two devices: dismiss an alert on the phone; after sync it is dismissed on the computer too. Hide amounts and layout stay per device.
11. Phone width (375 px): one column, no sideways scrolling, the round + button does not hide the last row when you scroll to the bottom, check buttons are easy to tap.
12. Midnight: leave Today open past midnight (or move the computer's clock past 12:00 am and wait half a minute): the date and the lists update by themselves.
13. Ledger Home still looks and behaves the same (its alerts are the same list; a minimum-balance alert also shows there if you set one).

## STATUS 2026-11-04: Phase 3 PART A BUILT (foundations: app-wide search and Add, hooks for Today/search/quick-add, Today module shell, landing setting, four defect fixes). SIGNED OFF and pushed 2026-11-05 (steps 5 and 9 left to check on a real phone and past midnight).

The prompt is `phase-3-today-prompt.md` (in the Claude project folder, not the repo); the facts behind it are `docs/phase3-audit.md`. Its decisions are fixed as written there.

**What was built (Part A):**
- **App-wide search and Add.** The search dialog and Ctrl+K and `/` moved out of Ledger's shell (`src/shell/GlobalFrame.tsx`); the Search and Add buttons now live in the top module bar and work in every module. Ledger's sidebar Search button stays. What they offer is still Ledger's (Parts C and D widen it).
- **One bottom-of-phone rule.** The round + button, the toasts and the page's bottom padding sit above the module's tab bar if it has one (Ledger) and at the screen edge if not (Today, Calendar, Tasks). Toasts now sit above the + button instead of overlapping it.
- **Registry hooks** `todayCards`, `searchSource`, `quickAdd` (typed, checked at start-up, documented in `docs/module-hooks.md`). No module uses them yet.
- **Today module** (first in the switcher): an empty frame with the date. **Landing setting** in Settings > General (Today / last used / a module), shared across devices. `/` and unknown addresses follow it; old Ledger addresses (`#/budget`) still reach Ledger. `legacyTarget` now validates the landing module and never lets a one-page module claim an old address.
- **Defects fixed:** (1) search actions split on the letter s instead of whitespace; (2) "Cash may drop to $0.00 today" no longer shows for a cash account with no transactions and nothing scheduled (real shortfalls still show); (3) midnight rollover: Ledger Home, Ledger's sidebar badge and net-worth snapshot, Tasks and Today now update their date when the day changes; (4) the Tasks List box uses a menu plus a new-name box, no browser pop-up.
- **Backup:** the per-device Today keys (`today.layout.v1`, `today.hideAmounts.v1`) are in the preference list now, so they survive a restore once Part B writes them.

**Verified:** 967 tests (23 new in `core/shellFoundations.test.ts`: landing, address routing, hook registry, palette word-splitting, the cash alert, backup keys), type check and build clean. In a real browser (invented data): the app opens to Today; Ctrl+K and `/` open search from Tasks and Calendar and an action opens the right Ledger page; Settings > General changes where `#/` goes (tried Tasks, then put back to Today); the + button and tab bar positions measured at 375 px in Today, Tasks, Calendar and Ledger (16 px clear of the edge or the tab bar) and at 700 px in Calendar; no sideways scroll; Add a transaction opens from Tasks; the task List menu shows. **Not run:** the toast position (only from the CSS), a real iPhone, the cash-alert fix in the browser (tests only), midnight rollover, backup restore and sync to a second device.

**Judgment calls (please review):**
1. **Search and Add moved to the top module bar** for every module, including Ledger on a computer (its top-bar Add button and phone search icon are gone; one set in the module bar instead). Ledger's sidebar Search button stays.
2. **The Add menu is still Ledger's four items** in Calendar, Tasks and Today. I did not add "Add a task" or "Add event" (that is Part D), because Part A was to change nothing visible except the frame.
3. **The cash alert rule:** shown only if a cash account exists AND there is something to forecast from (any transaction in a cash account, or any dated item in the forecast), and the dip is within 90 days. The Check-in page's own cash step uses a separate check that I did not change; it may still say something similar on an empty account (not verified).
4. **Midnight rollover covers** Ledger Home, Ledger's sidebar badge and snapshot, Tasks and Today (checked every 30 s and on returning to the tab). Other Ledger pages and the quick-task form read the date when they open, so a page left open overnight keeps yesterday until you navigate. Say if you want those too.
5. **Landing "Today" is the default for everyone**, including existing installs: the first launch after this goes to Today, which is an empty frame until Part B.
6. **The landing setting is shared** (a settings row), like the other Today options. Per device would have meant a second storage place.
7. **The search and quick-add files import `react-router-dom` directly** (they live outside any module, so the module router's prefixing does not apply) and add the `/ledger` prefix themselves; the router-import test now allows exactly those three files.
8. **A leftover test task** ("Sample list check") exists in the preview browser's own invented data; it is not in your real data.

**Owner sign-off (2026-11-05):** Part A signed off. Steps 1-4, 6, 7, 10 passed; step 5 (real phone) to be checked after the push; step 9 (midnight) assumed to pass, not run by the owner. Step 8 led to a new idea, queued (not built, questions not yet asked): **a minimum balance ("floor") per account**, e.g. never let checking go below $2,000, to drive the cash-low alert and forecast instead of a single global level.

**NOT built in Part A (by design):** the Today cards, search sources for tasks/events/contacts, the new quick-add box and event parser (Parts B to D); measurements on phone-sized profiles with realistic data (Part E); the two-device sync checks; the 38 other `confirm()` pop-ups.

**Part A checklist (for the owner):**
1. Open the app address with nothing after it: it opens **Today** (an empty frame with the date). The top bar shows the module switcher, Search, Add, sync, Settings.
2. From **Calendar** and from **Tasks**: press Ctrl+K (or `/` when not typing) or click Search. Type "scheduled": the Ledger action opens Ledger's Scheduled page. Click **Add > Add a transaction**: the form opens on top of Calendar or Tasks.
3. In Ledger: Ctrl+K and `/` still work, the sidebar Search button works, and the Add button is now in the top bar.
4. **Settings > General**: change "Open to" to Tasks, then open the app address with nothing after it: it opens Tasks. Put it back to Today. Old links such as `#/budget` still open Ledger's Budget.
5. **Phone** (or a narrow window, 375 px): the round + sits bottom right in Today, Calendar and Tasks with space below it, and above the tab bar in Ledger. Scroll to the bottom of a page: the last line is not hidden behind the button. Do the same at about 700 px.
6. Add a task: the "added" message sits above the + button, not on it. Open a task: **List** shows a menu (and a box for a new list), no browser pop-up.
7. In Search, type "add sched", then "new   transaction" (extra spaces): each finds its action.
8. The $0 account alert: with a brand-new checking account that has no transactions and nothing scheduled, Ledger Home no longer says "Cash may drop to $0.00 today".
9. Midnight: leave Today or Home open past midnight (or move the computer's clock past 12:00 am and wait half a minute): the date updates by itself.
10. Backup and restore, and sync to a second device: the only new stored thing is the "Open to" choice (a normal settings row). Confirm it follows you to the other device.


## STATUS 2026-11-04: Phase 2 PART C BUILT (Ledger on the calendar: click-through, Bill event -> Ledger scheduled item, Finance and Birthday event types). NOT committed or pushed. Part B signed off and pushed (94aa7f4); Part A pushed (e810001). Waiting for the owner's Part C checklist sign-off. Phase 3 not started.

**Owner review of Part C (same day), fixed after commit 2d66089:** (1) Delete on the Scheduled page did nothing in the owner's browser: it used the browser's own confirm pop-up, which can be blocked. It now asks in an in-app dialog (Cancel keeps it, Delete removes it and its Calendar dates). About 38 other places in the app still use the browser pop-up and could behave the same way; not changed. (2) "Start from" now shows the chosen item. (3) The People and Tag boxes used the browser's suggestion pop-up, which opened far to the left of the box; they now use a normal menu ("Pick a person…", "Pick a tag…") plus a box for a new name. The Tasks form's List box uses the same suggestion pop-up and was not changed. Tests: 944.

**What Part C covers (and what was already there):**
- **C1, Ledger provider.** Already built in Part A (it was needed for the Finance layer to show anything). Rechecked against the Part C list and left as is: scheduled items come from `dueInstances()` (unhandled only; posted, skipped, deleted, ended, paused drop out), vests/tax/RMD/pay milestones/next loan payment from `loadCalendar()`, 30-day overdue window as a Calendar setting, all-day only, default priorities by class editable in Settings > Calendar, budget goals/windfalls/goals/donations/HSA left out. Existing tests cover each of these.
- **C2, click-through.** Finance items offer **Edit in Ledger** only (no date moving, posting or skipping in the Calendar). For a scheduled item it now opens that item in the Scheduled page's edit form (`/ledger/scheduled?rule=<id>`; before, it opened the page without picking the item). Other Finance items open their Ledger page as before (Income, Tax plan, Debt). Ledger's record source gained `openSource`, so a record linked from an event opens the same way.
- **C3, calendar-first creation.** Event **Type** menu in the event form. For **Bill / scheduled payment** a button **Create scheduled item in Ledger…** opens Ledger's own form, prefilled (name from the title, first date, repeat mapped to weekly / every 2 weeks / monthly / quarterly / yearly), asking for account, in or out, amount and category or transfer. Repeats that do not fit (daily, every 3 weeks, several weekdays, "2nd Tuesday") say so and ask you to pick; "twice a month" is offered in the menu but never guessed. A **Review** step lists what will be created and what happens to the event, then **Create it in Ledger**, **Back** or **Keep it as a calendar event**. On create, the Ledger rule owns the item and the calendar event is soft-deleted with a note linking to the rule. Declining leaves an ordinary Personal event. Done through a registry hook (`contributes.createFromEvent`, plus `RecordSource.openSource`) so another module can offer the same; documented in `docs/due-provider.md`.
- **C4, Finance-adjacent dates (no Ledger changes).** **Finance date** type: starts at medium priority, "1 day before" reminder, "keep as overdue until done", tagged "Finance" (shared tag, created if missing), plus a "Start from" menu (card payment due, card statement closes: monthly; subscription renewal, tax-prep reminder: yearly; no date invented). **Birthday** type: all-day, yearly, low priority, "1 day before"; picking one person under People titles it "<Name>'s birthday" and links it to the shared contact. No birthday field on contacts, and Ledger's `people` table is not used.

**Verified:** 944 tests (17 new in `calendar/handoff.test.ts`: all six repeat mappings and the does-not-fit cases, one-time and ending repeats, next-date seed for old bills, registry offers the hook for `bill` only, one item remains after conversion with the dates matching Ledger's, the retired event keeps its note and can be restored, click-through paths, type defaults). Type check clean. Browser pane with invented data: Bill event -> Ledger form prefilled -> Review -> Create (new event: only the Ledger item appears; existing event: event retired, one Finance item remains, High priority when due today), Decline kept an ordinary Personal event with no Ledger item, "Edit in Ledger" opened the item in the edit form, Birthday defaults and auto title and contact link, empty-title error, phone width (375px) no sideways scroll. NOT checked in a browser: the Finance-date "Start from" menu, dark mode, a real second device, the .ics export after a conversion (tests cover export ids from Part A), converting a repeating event that has single skipped or changed dates.

**Judgment calls (please review):**
1. **A repeating bill starts the Ledger item at its NEXT date**, not its original first date, so an old event does not leave a pile of overdue items on the Scheduled page. The form warns if you move the first date into the past.
2. **A one-time bill** becomes a Ledger rule that ends on its date (Ledger rules always repeat), and says so.
3. **Single dates you skipped or changed on a repeating event do not carry over**; the form and the confirm text say so.
4. **Linked people, tags and notes on the event are not carried to Ledger** (Ledger has no place for them); the retired event keeps them. Notes become the rule's memo.
5. **If the Ledger item is created but retiring the event fails** (very unlikely), the form says so and asks you to delete the event by hand; no automatic rollback. There is no Undo for the conversion (the retired event can be restored from the database, but there is no screen for it).
6. **Choosing a type fills in starting values only on NEW events.** On an existing event it sets only the type and its tag, so nothing you set is overwritten.
7. **Birthday date:** it repeats from whatever date you enter (the real date or the next one). No age ("turns 41") is shown.
8. **Only Bill offers Ledger's button.** Finance date events stay Calendar events, as asked.
9. **Finance events live on Personal** (the Finance layer is read-only and worked out by Ledger), tagged "Finance". The tag, not the layer, groups them.

**Worth adding to Ledger's data model later (not done, per the brief):**
- **Credit card statement close day and payment due day on the account.** The biggest gap: today these are hand-made events, so they drift from the real card. Ledger could then show them on the Finance layer and compute minimum-payment reminders.
- **A renewal date and "cancel by" date on scheduled items** (annual subscriptions are already expressible as yearly scheduled items; only the cancel-by reminder is missing).
- **Birthday (and other special dates) on shared contacts** so one entry feeds the Calendar, gift reminders and Tasks. Better in the shared store than in Ledger.
- **Insurance, registration and other annual bills as yearly scheduled items** need nothing new, but a "document or policy number" field would help the "tax-prep" style reminders.
- **Tax-prep reminders** could derive from Ledger's tax-year data (filing deadline, estimated-payment dates are already shown); only the owner's own "gather documents by" date is manual.
- **A "last paid" date on bills** so the Calendar can show "paid" rather than dropping the item.
Not worth adding: a time of day (bills are all-day events), and per-occurrence editing of Ledger dates in the Calendar.

**Not built (Part C):** push, text or email reminders (see the push-notification decision above); Google Calendar; subscriptions; the Today dashboard (Phase 3); Undo for a conversion; a screen for retired events; changing Ledger's own calendar views or its existing .ics export; removing the unused `dueItems` table (still unused, still safe to drop later with a database version bump).

**Part C checklist (for the owner):**
1. Open Calendar > Finance layer. Scheduled items, RSU vests, tax dates and loan payments match Home's "Coming up" and the Scheduled page. Approve or skip one in Ledger: it leaves the Calendar. Delete a scheduled item in Ledger: all its dates leave.
2. Click a Finance item for a scheduled bill, then **Edit in Ledger**: the Scheduled page opens with that item in the edit form. There is no way to move or approve it from the Calendar.
3. In Settings > Calendar set the overdue window to a small number and see old unhandled items drop off the Calendar (they stay on the Scheduled page). Put it back to 30.
4. Add event > Type: Bill / scheduled payment > give it a title > **Create scheduled item in Ledger…**. Pick an account and amount, Review, then **Keep it as a calendar event**: nothing is created and the event is unchanged. Save the event, reopen it, convert it for real: afterward ONE item appears (the Ledger one, on the Finance layer) and the event is gone.
5. Try a repeat that does not fit (every 3 weeks): the form says so and asks you to pick.
6. Add event > Type: Finance date > "Start from" a card payment due: it gets a name, a monthly repeat, a reminder and the Finance tag. Add event > Birthday > add a person: it is titled for them, yearly, all day.
7. Export a calendar file with "Also include the Finance layer" on: the bill ids are the same as Ledger's own "Add to my calendar" file.
8. If you have two devices: convert a bill on one, sync, and confirm the other shows one item (not two). Create a backup and import it: events, Ledger items and the Finance layer come back the same. (Both covered by tests from Parts A and B; not run on real devices.)
9. Phone width (375px): the Bill form and the Ledger form fit the screen.

**Owner review of Part B (same day), fixed before push:** (1) quick-add now reads "every two weeks", "every other week/day", "biweekly", "fortnightly" (number words one to twelve). (2) Upcoming and Completed now obey the Sort box (Completed gains "Recently completed", its default); sorting Upcoming by anything but date shows one list. (3) "Add task" for an account moved off the Accounts list and into the account's own page (transaction and scheduled-item buttons unchanged). (4) Completed tasks stay hidden on the Calendar (owner's choice). NOT reproduced: the Calendar showing a done task until you switch tabs (it clears within a fraction of a second in Agenda and Month). NOT reproduced: a repeating task with no due date creating a next task dated today (it comes out one interval later, e.g. 14 days for "every 2 weeks", in both repeat modes); asked the owner for the exact steps. Tests: 927.

**Built:** Tasks module #3 (`src/modules/tasks`): stored tasks and lists (in `moduleRecords`, so backup and sync cover them with no database change); statuses To do / In progress / Waiting / Done; priority; due date (+ optional time); "do on" date; recurrence (fixed schedule or after completion); checklist; tags; people; list; linked records; `createdFrom`; completedAt. Views: Today, Upcoming (7/14/30), Overdue, All, By list, By tag, By priority, Waiting, Completed, Deleted; search, sort, filters; bulk actions (complete, reschedule, priority, list, tag, delete), each with Undo. Quick-add with shorthand and an always-visible "Will add" preview plus "Use as plain title". Tasks due provider (Calendar Tasks layer): completing or moving from the Calendar edits the task itself. Shared `createTaskFrom(module, record)` (`src/core/taskBridge.ts`) opens a prefilled form; "Add task" on the Calendar toolbar and day panel makes a TASK, never an event. Ledger: small "Add task" + open-task count on accounts, scheduled items and transactions (`TaskActions`); clicking the count lists the tasks, clicking one opens it; the task shows "Made from" with a link back.
**Ledger files touched:** AccountsPage, ScheduledPage, LedgerPage (one line + import each) and `records.ts` (adds transactions as linkable). Nothing else in Ledger.
**Verified:** 925 tests (23 new: shorthand parsing, both repeat modes and their endings, complete/undo, soft delete, links both ways, bulk edit, every view, filters and sorts, provider, write-through from the Calendar, backup round trip, two-device sync incl. a repeating task); type check and production build clean. Browser pane with invented data: shorthand preview and creation, Today/All/Completed views, complete + reopen, repeating task made its next one, Calendar showed a dated task (timed one in the time grid) and Mark done from the Calendar completed the task with no event copies created, Ledger account "Add task" -> prefilled form -> account shows "1 task" -> opens the task -> link back to the account; phone width (375px) no sideways scroll; no console errors. NOT checked in a browser: bulk actions, the Lists dialog, the Deleted view, dark mode, a real second device, a long list of transactions (the open-count lookup is one shared query, tested by reasoning only).

**Judgment calls (please review):**
1. **Repeat when finished late:** a fixed-schedule task finished weeks late gets its next date after TODAY on the schedule (no pile of missed ones).
2. **Undo of completing a repeating task** removes the next one only if you have not touched it.
3. **Quick-add date words:** a weekday name means the next one (never today; say "today"). "nov 12" already past this year means next year. Words like "sat"/"sun"/"mon" in a title will be read as dates; the preview shows it and "Use as plain title" turns it off.
4. **Tasks with only a "do on" date** show on the Calendar on that date; tasks with both show twice (the due date, and "Start: ..." on the do-on date). Done tasks leave the Calendar.
5. **Task views count only open tasks**; Completed shows the last 30 days.
6. **A task with a repeat but no due date** gets its first due date when you complete it.
7. **"Delete a list"** keeps its tasks (they just have no list).
8. **Tags and people are the shared ones** (same tags as the Calendar).
9. Tapping "Add task" on a Ledger record starts the title as the record's name; edit it before adding.
10. The new-task form is mounted once for the whole app (so Ledger and the Calendar do not import Tasks code).

**Not built (Part B):** Part C items; push/email reminders; a detailed "new task" form (quick-add plus the editor cover it); moving tasks by drag; the "Add task" button on loan, budget and other Ledger record types (only accounts, scheduled items, transactions).

## STATUS 2026-11-04: Phase 2 PART A BUILT (Calendar module + due-provider contract + Ledger's read-only Finance layer). NOT committed or pushed. Waiting for the owner's checklist sign-off before Part B (Tasks). Part C still to do (see "Not built").

**Built:** the due-provider contract (`src/core/dueProvider.ts`, doc `docs/due-provider.md`); Calendar module #2 (Month, Week, Work week, Agenda; events with repeats, reminders, priorities, tags, people, linked records; calendars/layers with toggles, rename, recolour, delete; .ics export; settings tab under Settings > Calendar). Ledger exposes a provider and a records source only; no Ledger page changed.
**Verified:** 902 tests (37 new: repeat rules, month-end clamping identical to Ledger, all-day dates identical under 7 time zones, this/following/all edits, deletes, calendars, .ics, Finance export ids equal to Ledger's existing export ids, Ledger provider vs `dueInstances`, two-device sync with no doubled built-in calendars); type check and production build clean. Browser pane (invented data): month, week (phone width too), agenda with Overdue section, quick-create with weekly repeat, Finance bill shown High when 2 days away, Settings tab, no console errors, no sideways scroll at 375px. NOT checked in a browser: editing "this and following" through the screens (tests only), drag to move, real downloads of the .ics, a second real device, dark mode.

**Judgment calls (please review):**
1. **I built the core of Ledger's provider (Part C1) now**, because the Part A checklist needs the Finance layer to show real items. Part C will add the rest (click-through polish, handoff, Finance event type).
2. **Calendar data lives in the existing `moduleRecords` table** (kinds `event` and `calendar`), so no database change; backup and sync already cover it. Calendar settings are one `settings` row (`calendarSettings`).
3. **Layer on/off switches are per device** (kept in this browser), not synced.
4. **Drag to move/resize was skipped** (stability). Edit an event to move it.
5. **Repeating timed events keep the same clock time on this device** (10:00 stays 10:00 through clock changes). Travelling to another time zone shifts them with the device.
6. **Pay milestones default to "reminder"** (you listed no default); year-end tax reminder counts as a tax date (High). All editable under Settings > Calendar.
7. **The Calendar shows scheduled items further ahead than Home does** (Home stops at 60 days); everything within 60 days matches. Vests/tax dates/loan payments are forward-looking only, as on Home, so past months show none of them.
8. **"Keep as overdue until done"** is an event option so past events can appear in Overdue; ordinary events never go overdue.
9. **Deleting a calendar asks** whether to move its events to Personal or delete them (soft delete).
10. **Reminders are in-app only** ("Due soon" flag); no pushes, texts, emails.
11. **`dueItems` table (Phase 1) is not used by anything and is not needed now.** Suggest removing it later (it would need a database version bump and backup tweak); not touched.
12. Existing Ledger calendar (Home "Coming up" + "Add to my calendar" file) is untouched. Later suggestion: keep the file download until you trust the new export, then point Home's "Coming up" at the Calendar's Finance layer.
13. Linking to records only supports Ledger accounts, scheduled items and loans for now.

**Not built (Part A):** Tasks (Part B); Ledger click-through beyond opening the page, "create scheduled item from event", Finance event type, birthdays (Part C); drag; subscriptions; push notifications.

## STATUS 2026-11-04: Phase 1 PART B BUILT (sync covers the shared store; conflict copies; status in the top bar; safety copies). Part A and Part B signed off by the owner (2026-11-04), pushed as eacd1bc. Owner ran the Part B checklist on the live app: steps 1-3, 5, 6, 8 confirmed; step 4 had nothing to see (no screen for the shared store); step 7 (fresh browser) deliberately NOT run, so first sync on a brand-new device is covered by tests only. Next: Phase 2 (Calendar/Tasks), not started. Revert point if ever needed: 5210524 (Part A).

Plain-language write-up of how sync works, its limits and the two-device risk table: `docs/sync.md`.

**Finding:** no switch of method was needed. The existing mechanism (one encrypted file in the owner's private GitHub repo, merged record by record, newest `updatedAt` wins) already walks every database table, so the shared tables sync with no engine change (proved by a two-device test). Google Drive was not added.

**Built in Part B:**
- **Conflict copies.** When both devices changed the same record, or one deleted what the other edited, the losing version is now saved in full. The Sync page lists them ("Edits that lost a tie") with a "Put that version back" button (applied as a fresh edit, so it syncs to the other devices). The top bar shows "Review N".
- **Sync status in the top bar** (all screens, desktop and phone): Synced / Syncing… / Offline / Needs attention / Review N / Paused / "Sync off" (links to setup), with a small panel holding "Sync now" and a link to Sync settings.
- **Safety copies.** One automatic full local snapshot before the first sync after this update (sync pauses with a message if it cannot be saved), and one before a device is replaced with the synced copy. Listed on the Sync page with a Download button (normal backup files; Import backup restores them).
- Two small Part A follow-ups from the owner's checklist: removed the duplicate "Ledger" title (sidebar heading; the phone's Home header now says "Home"), and the phone's round + button is now attached to the page body instead of the sticky header (some phone browsers nudged it while scrolling; NOT confirmed on a real phone, only that it still works in the browser pane).

**Verified:** 865 tests (6 new for Part B, plus 1 changed): same record edited on both, deleted-vs-edited, different records edited while apart (Ledger and shared store), put-back reaching the other device, restoring a backup with sync on, a new device that already made starter categories ends with no doubles, and the one-time snapshot. Browser pane: the status chip and its panel, the Sync page list, and "Put that version back" with invented data; at 375px the longest label fits beside the switcher and Settings. NOT checked: a real sync to GitHub from two real devices (nothing was sent to GitHub; tests use a pretend GitHub), airplane-mode behaviour on a real phone, and the + button on a real phone.

**Judgment calls (please review):**
1. **Conflict copies live on the device that lost** (in this browser's sync-meta store, newest 50), not in the synced file, so they do not grow the shared file or reach other devices.
2. **The snapshot blocks sync if it cannot be saved** (safety over convenience).
3. **"Sync off" shows as a small link** in the bar until sync is set up, rather than hiding.
4. **Deleted here + edited there** now also produces a saved copy (before, that edit vanished silently).
5. **Restore with sync on** keeps the existing rule (the restored data wins everywhere); the Import screen already says so.
6. **No automatic merge option for a second device** that already has its own data; it still has to choose "use the synced copy" (after the automatic copy). Merging two separate data sets was not built.

**Not built:** field-by-field merging, a screen to browse or restore from a snapshot inside the app (download then Import backup), cleaning up old conflict copies by age, any Calendar/Tasks screen, soft delete inside Ledger.

## STATUS 2026-11-04: Phase 1 PART A BUILT (shell, module switcher, shared data layer, shared entities, shell Settings). NOT committed or pushed. Waiting for the owner's checklist sign-off before Part B (sync).

**What was built (Part A):**
- **Top bar + registry.** A thin strip above every screen with a module switcher (Ledger only) and a Settings link. A module is added by writing one definition (`src/core/registry.ts`: id, name, icon, pages component, route list, nav map, optional empty `dueItems` / `tasks` hooks) and listing it in `src/modules/index.ts`. The app opens to the last module used (`ledger-last-module` in this browser).
- **Ledger under `#/ledger/...`.** `src/modules/ledger/LedgerModule.tsx` holds Ledger's sidebar/tab bar (the old Shell, unchanged) and all 32 page routes. Every old address (`#/budget`, `#/account/12`, `#/transactions?q=x`, `#/`) redirects to the new one (`src/core/legacy.ts`); unknown addresses open the last module.
- **Shared data layer** (`src/core/store.ts`): get / put / query / soft-delete / restore / watch for contacts, tags, attachments (description only), links (with "everything linked to X" in either direction), plus a private namespace per module (`moduleStore('calendar')`). **DueItem contract + publish/retract registry** (`src/core/dueItems.ts`, no UI). Entity shapes in `src/core/entities.ts`.
- **Database version 15** only ADDS six tables (`contacts`, `tags`, `attachments`, `links`, `dueItems`, `moduleRecords`), so no existing record is touched. Backups are now version 15 and include them; version 14 and older files still restore (new tables empty). Device sync already carries any table, and a new test proves contacts, links, due items and delete markers cross between two devices.
- **Shell Settings** at `#/settings` (Backup and restore, Sync devices): the same two pages Ledger shows, now reachable from the top bar. Ledger's sidebar still has its own Backup and Sync pages.
- New Ledger records get a `createdAt` time (set where updatedAt is set). Old records are not rewritten.

**Verified:** 859 tests (18 new), type check clean, production build OK. In the browser pane with invented data: all 31 Ledger addresses reached by their OLD address redirected to the right page with no errors; sidebar, quick-add and an account's ledger page worked; module bar, switcher menu and Settings looked right at desktop width; at 375px no sideways scroll, and the bar did not collide with the tab bar or "+" button. NOT checked: a real export/import round trip in the browser after this change (covered by tests only), the installed phone app, dark mode, and print.

**Judgment calls (please review):**
1. **Link wrapper instead of rewriting ~100 addresses.** Pages still write `/budget`; `Link`, `NavLink` and `useNavigate` from `src/core/router.tsx` add `/ledger` automatically. Same result as you chose, fewer edits and fewer chances to miss one. Tests fail if a page imports those from react-router-dom directly, and check that every address written in the code points at a real page.
2. **Settings pages exist twice** (Ledger's sidebar and the shell Settings page); same components, so they cannot differ. Inside shell Settings, the Backup and Sync pages link to each other within Settings.
3. **The bar is always visible (sticky)** and shifts Ledger's sticky table headers and sidebar down by its height (36px); the module name shows even on Settings (the last module).
4. **`moduleRecords`** is one generic table for any later module's own records, so a new module needs no new table until it has real query needs.
5. **Ids** stay numbers (time-based); links and due items accept text ids too for later modules.
6. **Contacts** is separate from Ledger's household "people" (tax math), as decided.
7. **createdAt for Ledger** is stamped on new records only; nothing was backfilled (a backfill would have marked every record "changed" and could beat newer edits on another device).
8. **Backup file summary** does not list the new shared tables yet (they are saved and restored; they have no screen).

**Not built:** any Calendar/Tasks screen, any screen for contacts/tags/links/due items, sync status in the shell, conflict copies, pre-sync snapshot (all Part B), and soft delete inside Ledger.

Original plan (kept for reference): Part A (module switcher top bar, module registry, shared data layer, shared entities, shell Settings), STOP for the owner's checklist, then Part B (cross-device sync for the new store). Do not build Calendar/Tasks; do not restyle Ledger.

**Audit findings (read-only):**
- Single Dexie database `ledger`, 33 tables, schema 14. Hash router, all Ledger routes at the root (`/budget`, `/account/:id`, ...), about 64 links in screens and about 37 address strings in `src/lib` mention them.
- Sync = one gzip + AES-GCM encrypted file (`ledger-sync.bin`) in the owner's private GitHub repo, using a token and passphrase kept in this browser only. It loops over ALL Dexie tables, merges record by record (newest `updatedAt` wins), notices deletes by comparing with the ids at the last sync, keeps tombstones a year, and records a notice (not a recoverable copy) for same-record conflicts. Status shows only on the Sync page, not in the shell. So new tables in the same database with `id` + `updatedAt` sync with no engine change; Part B needs conflict copies, a shell status, and a pre-sync snapshot.
- Ledger already has a `people` table (household members with birth year, used by tax and pay math).

**Decisions (owner, 2026-11-04):**
1. Routes: move Ledger under `#/ledger/...`; every old address redirects permanently. Safeguards: one central address helper; a test that fails if a hard-coded old-style Ledger address remains outside it; a redirect table test covering every old route (including `/account/:id`); a browser click-through of every page at desktop and 375px; a table of old address -> new address and the list of touched files recorded here for triage; done as its own commit so it can be undone alone.
2. Record fields: new shared tables get id, createdAt, updatedAt and deletedAt (soft delete). Existing Ledger tables only gain `createdAt` (no balance or report can change) and keep their current delete behaviour. Soft delete for Ledger is a possible later project.
3. People: keep Ledger's `people` untouched; new shared table named `contacts`. Links can connect them later.
4. Settings: new shell Settings page opened from the top bar, holding Backup/Export/Import and Sync. Old `#/backup` and `#/sync` addresses keep working. Ledger's "Settings & about" page stays for Ledger-only options.

Also from the notes: the module switcher remembers the last-used module; switcher must not collide with Ledger's mobile tab bar or the + button; DueItem is a data contract and publish/retract registry only (no UI).

## STATUS 2026-11-04: Phase 0 safety net BUILT (plain backup file, restore, 10-day reminder), pushed and signed off by the owner (checklist passed on the live app, including the encrypted-file refusal)

Verified with 841 automated tests (10 new), a type check, and a browser check with invented data: two exports named `Ledger Backup 11-04-26.json` and `..._2.json`; junk, broken and too-new files rejected with plain messages and data unchanged; a restore showed the summary, downloaded `Ledger Pre-Import 11-04-26.json` first, and removed a test transaction added after the backup; the reminder appeared after "11 days ago", hid on Dismiss, came back the next day, and cleared on Export now; no sideways scroll at 375px. NOT checked: a real download into the Chrome Downloads folder (the browser pane cannot show it), the phone share sheet, restoring with Sync turned on, and a production build.

Judgment calls (please review):
1. **The data version already existed** (the database and backup files were at version 14). The new `schemaVersion` is that same number (14); it is written into the file next to the old `version`. Older files without it still restore. Nothing was added to the stored data.
2. **The old encrypted backup, restore and weekly GitHub backup are unchanged** and now sit below the new plain controls on the Backup page. The plain file is the first card; an Export button is also on More.
3. **Not in the file, on purpose:** the price-lookup key, the Sync token and the weekly-backup passphrase. The file IS readable by anyone who opens it. `.gitignore` now also skips `Ledger Backup*.json` and `Ledger Pre-Import*.json`.
4. **Screen preferences** (theme, colours, Home layout, folded panels, etc.) are saved in the file and put back on restore. Preferences missing from a file are left as they are.
5. **"Last backup" and the per-day counter live in this browser only** (not in backups or Sync), so restoring an old file cannot reset them. A plain or encrypted export both count; a Pre-Import copy does not.
6. **Reminder rules:** calendar days in your local time, more than 10. If an older "last backup" date already existed it is used; otherwise the clock starts the first time this version runs. It only shows once there is at least one account.
7. **Testing tools:** a folded "Testing tools" section on the Backup page moves only the recorded last-backup date.
8. **appVersion** is the package number (0.1.0), which does not change by itself.

Not built: auto-backup to a folder, cloud sync changes, and Phase 1.

---

## STATUS 2026-11-02: Home "Refresh prices" button, and adding/subtracting in amount boxes BUILT ("go"), not committed

Verified with 831 automated tests (9 new, for the sum reading and the Budget `+25` / `-10` rule), a type check and a production build, plus a browser check with invented data: the Home button with no key saved showed "Save your API key first" with a link to Investments; typing 1537+123.86 key by key in the transaction form showed "= $139.23" and saved a -$139.23 transaction; in Budget, `100+50` gave 150.00 and then `+25` made it 175.00; the transaction form had no sideways scroll at 375px. NOT checked: a real price refresh from the Home button (no key was used; the shared lookup code is the same one Investments always used, and Investments was changed to call it, but I did not press its button with a key), `-10` and an invalid entry in the Budget box by hand (covered by tests only), sums in split rows, the quick-add box on the phone, and a phone's number keyboard (see 2).

Judgment calls (please review):
1. **Amount boxes everywhere that take a transaction or target amount now accept sums:** the transaction form (including split rows), the quick-add box, Budget "Assigned", the budget-target amount, and the general money boxes used on other screens (`MoneyField`). The "= $139.23" preview shows under the transaction and quick-add boxes only.
2. **A phone's number keyboard has no + key.** Transaction boxes use the number-only keyboard (for the digit-by-digit entry), so on a phone you may need to switch keyboards to type the +. I did not add a "+" button. Say if you want one.
3. **In the transaction boxes, the first number still fills in digit by digit** (1, 5, 3, 7 shows 15.37). Once you type a + or - after a number, the box switches to plain typing, so type the next amount with its decimal point (123.86). Deleting back to a single number returns to digit-by-digit.
4. **Budget "Assigned": a leading sign now adjusts.** `-10` takes $10 off what is there. It used to mean "set it to negative $10"; that is no longer possible by typing, which seemed an acceptable trade. A bad entry (such as `5+`) puts the old amount back and saves nothing, as before.
5. **Other money boxes elsewhere in the app** (loan, tax and planning screens that use `parseAmountToCents` directly) were NOT changed; they still take a single amount only.
6. **Home button** sits beside "Edit Home" (hidden while editing the layout). It refreshes every held security, shows progress, then the result. It does not skip prices already updated today.

Not built: multiply/divide and brackets (you chose + and - only), a + button for phones, sums in the other planning screens, skipping already-fresh prices.

Decisions behind this (your first choices):
1. **Refresh prices button on Home.** Does the same as the Investments > Prices "Refresh prices" button, for all holdings, then shows a plain result message (e.g. updated N, M failed). With no price key saved it says so and points to where to add one.
2. **Math in transaction amounts.** Amount boxes accept `+` and `-` only (e.g. `15.37+123.86`, `200-15.50`). A small running result ("= $139.23") shows under the box while typing; only the total is saved (nothing added to the memo).
3. **Math in the Budget screen's Assigned boxes, YNAB style.** Same `+`/`-` math (`100+50` becomes $150). A leading sign adjusts the existing amount: `+25` adds $25 to what is there, `-10` takes $10 off.

To settle while building: which other amount boxes get the math (split lines, transfers, targets); what happens with an invalid entry (plan: keep the box, show a plain message, save nothing). Money stays whole cents. No database change expected.

---

## STATUS 2026-10-30: repeating bill targets, accounts left out of the budget, reconciled-today cue, weekly GitHub backup BUILT ("Go, build all four"), not committed

Verified with 822 automated tests (19 new), a type check and a production build, plus a browser check with invented data: leaving a savings account out dropped Ready to Assign from $6,000 to $1,000; a $300 every-3-months bill due in December showed "needs $100.00 this month"; the reconciled-today tick and "Last reconciled <date>" showed; the weekly-backup card's passphrase checks worked; Accounts, Backup and Budget had no sideways scroll at 375px. NOT checked: a real upload to GitHub (I did not send anything to your repository; the upload code is tested against a pretend GitHub and pretend server replies only), restoring an automatic copy by hand, the sync of the new fields between two devices, dark mode, and the bottom "Targets" table at phone width.

Judgment calls (please review):
1. **No database migration was needed.** The new fields (`budgetExcluded`, `lastReconciledDate` on accounts; `everyMonths` on targets) are optional, so old data and old backups work unchanged, and backups and sync carry them like any other field. The backup file version stays 14.
2. **Left-out accounts:** a tick named "Include in budget" on each checking and savings account on the Accounts page. Anything bought or earned inside a left-out account (interest, a purchase) is NOT budgeted: it adds no income and takes nothing from a category. Moving money to or from it is a transfer, so it changes Ready to Assign by exactly that amount. A credit card paid from a left-out account should still draw down the card's payment line (from reading the code; UNVERIFIED, no test covers it). Net worth and every other screen still count the account.
3. **Repeating bills:** "A bill that repeats every few months" (every 3, 6 or 12 months, plus the next due month). The schedule counts forward from that month by the calendar, so it rolls to the next due date on its own the month after the due month; there is no "paid" detection. If you pay the bill EARLY, the target shows a need again until its due month passes (yearly targets already behave this way). Entered on the budget line or in the Targets section.
4. **Reconciled cue:** the date is recorded only when you press "Lock ... as reconciled" after a balanced check. Accounts show "✓ Reconciled today" in green, otherwise "Last reconciled <date>" or "Never reconciled", with no warning colours. Existing accounts show "Never reconciled" until reconciled again. Closed accounts show nothing. The date used is your device's local date.
5. **Weekly backup** goes to a `backups` folder of the same private repository (the sync file is untouched), named `ledger-YYYY-MM-DD.ledgerbackup`, at most one per week (the repository decides, so phone and computer do not both add one), about 30 seconds after the app opens and every 6 hours while it stays open. The newest 8 are kept; older ones are deleted. It uses its own passphrase (8+ characters, typed twice), saved in this browser only. A failure shows a plain message on the Backup tab and never blocks the app. "Back up now" forces a copy any time (one per day: a second press the same day does nothing new). The file day uses UTC, so a late evening backup can carry the next day's date.
6. **Restoring an automatic copy is manual:** download the file from GitHub, then use "Restore from backup" with the automatic-backup passphrase. There is no in-app list of copies.
7. A reconcile lock now saves in two steps rather than one all-or-nothing step (combining them tripped a quirk in the database library). The worst case is transactions locked without the date being remembered.

Not built: restoring from the repository inside the app, a warning when the weekly backup has failed for a long time, other repeat lengths (every 2 or 4 months), showing left-out accounts differently on the Budget page.

---

## (superseded) QUEUED 2026-10-30: repeating bill targets and choosing which accounts feed Ready to Assign (decided, now built)

Ask: bills paid quarterly / twice a year / yearly should be saved for in a way that fits; and long-term savings accounts (not daily cash) should be left out of Ready to Assign. Today every checking/savings/cash account counts and there is no switch (`cashAccts` in `src/lib/budget.ts`); targets are monthly, by date, or yearly only.

Decisions (your first choices):
1. **Repeating bill target:** amount, repeat every N months (3, 6 or 12 to start), next due month. Monthly set-aside = amount divided by months until due, rounded up; rolls to the next due date after the bill is paid.
2. **"Include in budget" tick on each checking/savings/cash account**, on by default so nothing changes until you turn it off. Excluded accounts still count in net worth and all other screens.
3. **Transfers to/from an excluded account** count as money leaving/entering the budget (moving $500 to long-term savings lowers Ready to Assign by $500).

Also queued (2026-10-30): **reconciled-today cue on the Accounts tab.** Today the app only marks individual transactions "reconciled" (LedgerPage "Lock ... as reconciled"); it does not remember WHEN an account was last reconciled. Decisions: record the date each time a balanced reconcile is locked; Accounts tab shows a green tick if that was today, otherwise a muted "last reconciled <date>" (or "never"); no amber/red warning colours. Needs a new account field (same migration, backup and sync support as below).

Also queued (2026-10-30): **automatic weekly backups to the private GitHub repo.** Decisions: reuse the Sync repo and token; at most one dated encrypted copy per week, taken the first time the app is opened after a week has passed; keep roughly the last 8 and delete older ones; same encryption as manual backups (AES-256-GCM, key from PBKDF2) but using its OWN separate "automatic backup passphrase" (your choice, 2026-10-30), set once on the Backup tab and saved on each device in this browser only (never in the repo, backups or sync, like the Sync passphrase), because an automatic backup cannot ask you to type one; manual backups still ask each time. Restoring an automatic copy needs the passphrase in force when it was made, so changing it must warn that older copies still need the old one. Each device that should back up needs it entered (it is not synced); keep it written down somewhere safe, it cannot be recovered. Manual export stays. Reason: Sync holds only the latest state, so a mistake spreads to every device and there is no older copy. Still to settle while building: where in the repo the copies go (separate folder from `ledger-sync.bin`), what happens if the token or network fails (show a plain message, never block the app), and showing "last automatic backup" on the Backup tab. Only works if Sync is set up.

Needs: a database migration (new account field and target fields), backup and sync support. Wording of "paid" detection for rolling the due date is still to be settled while building.

---

## STATUS 2026-10-29 (newest): foldable budget groups and drag-to-reorder BUILT ("go and push")

Ask: fold budget categories for easier viewing; drag and drop to re-order groups, categories and targets on the Categories page, with the Budget page following that layout. Decisions (all your first choices): targets shown and ordered on the Categories page; groups draggable, and categories movable within or between groups; Budget groups fold by clicking the heading, remembered on this device, with a collapse/expand-all button; the Categories page folds too.

Verified with 803 automated tests (5 new, for the ordering rules), a type check and a production build, plus a browser check with the starter categories (invented data): moving a group, moving a category with the arrows, dragging a category into another group, folding on both pages, the fold being remembered, the Budget page showing the new order, and the Categories page at 375px (no sideways scroll). NOT checked: dragging a target by hand (the same code as categories, but no target existed), a real mouse drag (I simulated the drag events), touch dragging, dark mode and the other colour palettes, sync between two devices.

Judgment calls (please review):
1. **Phones and touch screens cannot drag** (browsers do not support it), so every group, category and target also has small ▲ ▼ buttons.
2. **Order is saved on each record** (no database change needed). Anything you add later goes to the end of its list. Old data works unchanged. The order syncs and backs up with the records.
3. **Folds are per device and separate** for the Budget and Categories pages (a fold on one does not fold the other). The Initial setup group never folds.
4. **Targets on the Categories page** are a read-only summary line under each category (you still add and delete them on the Budget page). Targets can be re-ordered only within their own category.
5. **Budget page, folded group:** shows the group name, its available total and the number of categories. The "Collapse all groups" link appears when two or more groups are shown.
6. Only the Budget and Categories pages use the new order. Pickers in other screens (transaction forms, filters, Reports) still list groups and categories in the old order.

Not built: moving whole groups on a phone by touch drag, applying the order to the other screens, expand/collapse the target lines alone.

---

## STATUS 2026-10-29 (newest): RSU vests left out of budgeting income BUILT ("go"), pushed

Verified with 798 automated tests (2 new: pay by month without vests, and the Forecast per-person switch), a type check and a production build, plus a browser check with invented people and vests (since removed). Checked: the Budget page's projected take-home fell from $27,464 to $14,486 for a month with two vests (paychecks only), and on the Forecast page switching each person's vests off lowered "Money in" by that person's vests, one at a time. NOT checked: a month with a bonus by eye, dark mode and the other colour palettes, phone width.

Judgment calls (please review):
1. **Budget page:** projected take-home and the paycheck count now exclude vests. Wording otherwise unchanged and no note about vests. Ready to Assign, Home and Reports are untouched (they only count what you enter).
2. **Forecast page:** under Assumptions, one tick box per person who has vests: "Count NAME's stock vests as cash coming in". Ticked (the starting value) keeps today's behavior; unticked removes that person's vests from cash coming in. Paychecks and bonuses always stay. Shares you keep stay out as before.
3. **Taxes on the Forecast** (tax due or refund next spring) still include the vest income, because the tax is real whether or not you budget the cash.
4. The switch is saved with the other Forecast settings, so it follows your devices if you sync. Older saved settings work unchanged.
5. The Income page and the money-flow diagram still show vests (they report real pay).

Not built: a switch for the Budget page, a way to ignore a single grant instead of a whole person.

---

## STATUS 2026-10-29: expandable split transactions BUILT ("go"), not committed

Verified with 796 automated tests (unchanged: this is screen-only), a type check and a production build, plus a browser check with an invented split (since removed): account page and Transactions tab at desktop width, Transactions tab at 375px (no sideways scroll). Checked: opening and closing, the amounts lining up under Category and Amount on desktop, a phone list of category and amount. NOT checked: phone view of an account page by eye, dark mode and the other colour palettes, keyboard use.

Judgment calls (please review):
1. **The toggle** is the Category text itself (e.g. "▸ Split: Rent / Mortgage, Utilities"). On phones, where Category is hidden, a "Show split amounts" link sits under the payee.
2. **Open state** is remembered only while you stay on the page; it resets on leaving, and a filter or sort change keeps rows open.
3. **Opening a row** does not affect selection, sorting or totals. The parts always add up to the row amount shown above them.
4. Transfers and ordinary rows have no arrow.

Not built: per-part notes (parts have none), expand all / collapse all.

---

## STATUS 2026-10-29: Amount filter box right-aligned BUILT (after a yes), not committed

Ask: in the Amount filter box under the column header, the placeholder text ("45 or >100") is left-aligned, but the Amount header and amounts are right-aligned. Right-align the box's text (placeholder and what you type) so it lines up with the header and data.

Applies to: the Amount box on the Transactions tab and on account pages (a small style change; the phone block above the list is unchanged).

Verified in the browser on the Transactions tab (the box and the header both report right alignment) and the existing 796 tests are unaffected (style only). Judgment call: only the Amount box changed; Date, Payee and Category stay left-aligned like their data. NOT checked: account page by eye, phone width, dark mode.

---

## STATUS 2026-10-29: account filters, column boxes and Reconcile move BUILT ("go"), pushed

Verified with 796 automated tests (6 new, for the column boxes), a type check and a production build, plus a browser check with invented data (since removed): an account page and the Transactions tab at desktop width, and the Transactions tab at 375px (no sideways scroll). Checked: typing "logan" under Payee, "45" under Amount (finds $45.00 and $45.82, not $145.99), "2026-04" under Date, the true running balance staying put while filtering, Reconcile in its new spot. NOT checked: dark mode and the other colour palettes, a real phone touch, the Filters panel and chips on an account page by hand (same component as the Transactions tab), and an account page at 375px after the final styling fix.

Judgment calls (please review):
1. **Boxes** are under Date, Payee, Category and Amount. On the Transactions tab there are no boxes for Account or Status (Account is in the toolbar; Status is in Filters).
2. **Category box** matches the text shown in the column, so it also finds splits ("Split: Groceries, Dining Out") and transfers ("↔ Checking").
3. **Date box:** a 4-digit number is the year; otherwise month, then day ("03/15"). A lone "03" matches month 03 (and day 03 if no year was typed). A lone "0" is ignored until the next digit. Month names ("March") are not understood.
4. **Amount box:** "45" matches whole dollars exactly ($450 does not match). "45.8" matches $45.80 to $45.89. Ignores minus signs, $ and commas. Also understands >100, <50, >=100, <=50 (size of the amount).
5. **Account pages** got a search box, a date range menu, the Filters button and panel, chips, and a "Showing X of Y" note. No saved filters there. Balance column keeps the true running balance; the top Balance/Cleared/Pending figures and Reconcile are not affected by filters.
6. **On phones** the table header is hidden, so the four boxes appear as a small block above the list.
7. **Reconcile** moved up on account pages (under the credit-left box, above Add transaction; for accounts with no credit box it follows the Possible transfers box).
8. Saved filters from before still load (the new boxes simply start empty); saved filters do remember the column boxes from now on.
9. Column box text is not kept when you leave the page (same as the other filters).

Not built: boxes for Account/Status, month names in the Date box, remembering filters between visits.

---

## STATUS 2026-10-29: assets/liabilities bar chart with a net worth line BUILT ("go"), pushed

Verified with 790 automated tests (3 new, for the chart numbers), a type check and a production build, plus a browser check with invented data on Home and the Net worth page at desktop width and 375px (no sideways scroll). Checked: stacked bars, the net worth line, hover values (the parts add up to the total), a total-only past point, and the label spacing on a narrow card. NOT checked: dark mode and the other colour palettes, a real phone touch, keyboard arrow keys on the chart.

Judgment calls (please review):
1. **Same chart on both screens.** Home shows the last 12 months; the Net worth page shows up to the last 60. It replaces the old plain line on Home and the old three-line chart on the Net worth page.
2. **Colours:** up bars are cash (blue), investments (green), property (purple); down bars are credit cards (pink) and loans (orange). The net worth line is dark. Colour is never the only signal: hovering lists every amount.
3. **A month with only a total** (a past point you typed in) shows as a dot on the line with no bars, and its hover says "Total only".
4. **A negative cash, investments or property figure** is left out of the bars (the net worth line still counts it).
5. **Net worth page table:** the single "Debts" column is now separate "Cards" and "Loans" columns.
6. **The chart redraws at the card's real width**, so labels stay readable instead of shrinking on phones. Month labels thin out when space is tight.
7. The old Home trend line piece (`Sparkline`) is no longer used on Home.

Not built: choosing a time period, entering a past point part by part, a "last 12 months / all" switch on the Net worth page.

### Decisions it was built from (originally queued 2026-10-29)

Ask: on Home, show assets as upward bars and liabilities as downward bars, with net worth as a line on top. On the Net worth page, break the history out and track it the same way (cash, investments, property, cards, loans).

Today: Home shows a bare line of total net worth (monthly snapshots, no axes). The Net worth page has a three-line chart (net worth, assets, debts) that only appears once two months are saved.

Decisions:
1. Bars are stacked by type: up = cash, investments, property; down = credit cards and loans (each its own colour).
2. The chart has month labels, a dollar scale, and hover/tap values.
3. Both screens use the same chart. The Net worth page's table of saved points keeps its columns, with cards and loans shown separately.
4. No database change: snapshots already store cash, investments, property, cards and loans separately.
5. To settle while building: the Net worth page's "Add a past point" only records a total (the parts are saved as zero), so those points would show as a net worth dot with no bars. Expected: show them that way, and offer parts-by-part entry as a later option. Also what the chart shows with fewer than two months saved (expected: the same hint text as today).

## STATUS 2026-10-28 (newest): customizable Home page with charts BUILT ("go"), awaiting your review (not committed)

Verified with 787 automated tests (9 new, for the layout rules and the chart numbers), a type check and a production build, plus a browser check with invented data: desktop (two columns) and 375px (one column, no sideways scroll). Checked: every chart drawing, Edit Home, moving a card, removing a card (and it appearing under "Add a card"), making a card wider and saving it across a reload. NOT checked: dark mode and the other colour palettes, a real phone touch, and the Reset to default button (simple, covered only by the default-layout test).

Judgment calls (please review):
1. **Default layout:** same cards as before in a two-column grid (one column on phones), with the four new chart cards added. Get started is full width at the top and hides itself when finished or dismissed.
2. **Net worth card** now shows the number and trend only; the cash/investments/property/cards/loans figures moved to the new "What you own and owe" card (ring of assets, plus a bar of what is owed against them). The "add your home's value" hint was dropped.
3. **"This month"** (October and so on) replaces the text figures with Income and Spent bars, plus Ready to assign.
4. **Budget progress** shows the six most used-up categories. A category with spending but no money set aside shows as full red ("none set aside"). Card payment lines are left out. Bars turn amber past 85% and red when overspent.
5. **Income vs spending** is the last six months, same rules as the existing month figures (transfers and the "Initial setup" category left out).
6. **Spending by category** shows the top five plus "Other".
7. **Check-in** is a progress ring; **Goals** are bars by how many years away each starts (longer = further out). Goals have no cost or funding shown here because the Home card never had it.
8. **Needs attention, Recent transactions and Coming up** stay as lists. Coming up on Home no longer shows the calendar download link or footnote (still on its own use elsewhere, if any).
9. **Editing:** "Edit Home" in the page header. Arrows reorder, a wider/narrower button (computer screens only), Remove, and an "Add a card" row; "Reset to default" restores everything. Cards that are not showing right now (finished setup, no check-in) appear greyed in edit mode so you can still move or remove them.
10. **Saved on this device only** (browser storage); nothing synced, no backup change. Clearing site data resets it. Cards added in a future version will appear under "Add a card", not automatically.

Not built: drag and drop, per-chart settings (period, number of categories), chart tooltips on hover, a synced layout.

### Decisions it was built from

Ask: make Home a set of cards you can add, remove and reorder, and use more visuals and less text.

Decisions:
1. Editing: an "Edit Home" mode. Each card gets move up/down, half/full width, and remove; an "Add card" picker lists the cards not on the page. Arrows, no drag and drop (works the same on phone and desktop).
2. Saving: per device (browser storage), not synced. No database change, backup or sync work. A "Reset to default" button restores today's layout.
3. New chart cards: spending by category (this month), budget progress bars (spent vs budgeted, overspent in red), income vs spending (last 6 months), net worth breakdown (cash / investments / property / debts). Charts are hand-drawn SVG like the existing ones (no chart library).
4. Less text: lists become visuals (Top categories, net worth parts, goals, check-in as rings and progress bars). Needs attention and Coming up stay as short lists because they are action items.
5. Existing cards (net worth, month summary, recent transactions, check-in, goals, needs attention, coming up, get started) all become cards in the same system.
6. To settle while building: default order (expected: today's layout with the new charts added below), and what an empty chart shows when there is no data.

## QUEUED 2026-10-26: reconciled / not reconciled badges on the Accounts list (decisions made, waiting for "go")

Ask: on the main Accounts page (Money > Accounts), mark each account as reconciled or not.

Decisions:
1. Meaning: green "reconciled" when no transaction dated today or earlier is still pending or cleared (all are locked as reconciled, or there are none). Amber "N to reconcile" otherwise. Uses existing statuses; no database change, no sync/backup work.
2. Look: a coloured badge with words beside the account name, like the existing "primary" and "closed" badges. No row tint.
3. Scope: checking, savings, and credit cards that are open. Loans and closed accounts get no badge.
4. To settle while building: whether transactions before an account's "as of" date count (the app treats them as already in the starting balance, so expected: they do not), and how future-dated transactions are handled (expected: ignored until their date).

## STATUS 2026-10-26 (newest): visual redesign across the whole app BUILT, awaiting your review (not committed)

Ask: a calmer, less clunky look and better navigation, from a design brief. Verified with 778 automated tests (none new; presentation only), a type check and a production build, plus a browser check with invented data at desktop and 375px, light and dark, of Home, Transactions, Budget, Accounts, an account ledger, Income, Reports, Forecast, Investments, More, and a no-sideways-scroll check of all 32 pages at 375px. NOT checked: every page's every state, a real phone keyboard or touch, 768px width.

Judgment calls (please review):
1. **One design system** (`src/ui/tokens.css`, `src/ui/components.tsx`, `src/ui/Toast.tsx`, plus `src/styles.css`): six type sizes, 4px spacing, two corner sizes, three shadows, one control height (40px, 44px on phones). Your palettes and saved themes still drive the colors.
2. **Contrast:** Classic's blue, amber and dark-mode button text were slightly darkened to pass AA. Other palettes are unchanged.
3. **Every page has the same header** (title, one-line description, main action on the right). Pages that had a long explanation keep it under a collapsed "About this page". Only Accounts, Transactions and Budget-style pages got a real primary action; the rest have none or their old year/print controls.
4. **Sidebar** stays collapsible (your choice) but opens the group of the page you are on. Headings are larger and fully readable.
5. **Add** is a top-bar button on desktop and a round button on phones, kept clear of content. Ctrl K also runs actions.
6. **Home** is a dashboard: net worth with trend line, needs attention, then cards. "Quick links" removed. The first-run list is a dismissible card. The low-cash alert now needs a checking or savings account.
7. **Transactions and account ledgers:** two-line rows on phones, sticky headers, filters behind a Filters button with removable chips. Filters open as a panel, not a pop-up. Bulk status change has Undo; deletes still ask first.
8. **Budget:** every group's table shares column widths and a sticky header.
9. Fields and buttons are taller everywhere; content is up to 1120px wide.

Not built: Undo for deletes and bulk category changes; shared column widths on other tables (Debt, Investments holdings); a loading skeleton on pages other than Transactions; a rework of each page's internal layout (forms keep their old order).

## STATUS 2026-10-26: "Refresh prices" button on the Investments > Accounts subtab BUILT ("go")

Verified with 778 automated tests (none new; the change is layout and wiring) and a browser check (desktop and 375px, no sideways scroll). Checked: the button next to the "Accounts" heading, the no-key message, and the link jumping to Prices & assumptions. NOT checked: a real price lookup, because no Twelve Data key was available in the test browser. The button runs the same code as the existing one, so I expect it to behave the same, but I did not see it fetch.

Judgment calls (please review):
1. **Placement:** right of the "Accounts" heading, above the account list.
2. **Same action as before:** one shared refresh, same messages, greyed out while running. The message appears under the heading. It is shared with the Prices & assumptions page, so the same status text shows on both.
3. **No key:** "Save your API key first." plus a "Go to Prices & assumptions" link. That link changes the remembered tab for the Investments page, like clicking the tab yourself.
4. The old button on Prices & assumptions stays.

Not built: a "prices as of" date next to the button.

## STATUS 2026-10-24 (newest): move a transaction's account, keystroke-style amounts, primary payment account BUILT ("go")

Verified with 778 automated tests (21 new) and a browser check (desktop and 375px) using invented data: real keystrokes 1, 2, 4, 5 gave 0.01, 0.12, 1.24, 12.45; Backspace; saving with Enter; Quick add starting on the primary account; moving an ordinary, a reconciled, and a transfer transaction; the same-account error; the Settings switch off and on. NOT checked: typing on a real phone keyboard (the entry reads the whole text of the box, not individual keys, to work with phone keyboards, but I could only test with a computer keyboard).

Judgment calls (please review):
1. **Account on edit:** an "Account" box on the edit form (ledger and the all-transactions page). Offers open non-loan accounts plus the one it is on now. The Type labels (Charge, Inflow and so on) follow the chosen account's kind. Everything else on the transaction stays, and balances, budget, and reports follow because they read the transactions.
2. **Transfers:** either side can move. Both payees are renamed to name the right accounts ("Transfer to Test Savings"). Putting both sides on one account is refused. A transfer made in the same edit is set up against the new account.
3. **Reconciled:** a warning shows on the form and a confirmation is asked on Save. The moved entry goes back to Cleared (for a transfer, only the side that moved; the other side keeps its status because its own account's balance did not change).
4. **Imported transactions:** a moved one keeps its bank id and duplicate check, so importing the same file into the old account does not add it again. It is no longer tied to the import batch, so undoing that import will not delete an entry that now lives on another account. It also means the same bank row imported into the NEW account would not be recognised as a duplicate.
5. **Keystroke amounts:** digits shift in from the right, Backspace removes the last, with thousands commas (1,200.50). A typed decimal point or minus sign is ignored (1, 2, ., 4, 5 still gives 12.45, but typing 12.5 gives 1.25, so with this on, type the cents). Pasting a whole amount (12.45 or $1,200.50) works. The inflow/outflow choice stays separate. It is a per-device switch in More (default on), applies to the amount boxes in add, edit, Quick add and split amounts, and nothing else. Editing an existing transaction shows its amount in the box; typing a digit shifts it left, so clear it with Backspace first.
6. **Primary account:** "Make this my primary payment account" on the account's page (with a "primary" badge on the Accounts list); shared between devices and in backups. Quick add starts on it; with none set (or if it is closed or deleted) it falls back to the account you used last, then the first, as before. Loans and closed accounts cannot be primary.

Not built: a primary choice per device, and keystroke entry for other money boxes (budget, loans, and so on).

## STATUS 2026-10-21: Investments tab: accounts start collapsed, Add account moved up BUILT

Checked in the browser (desktop and 375px): order, collapsed on load, expanding, no sideways scroll. No new automated tests (layout only); the existing 757 still pass.

Judgment calls (please review):
1. **Collapsed:** each account shows its name, type, owner, and total, with "show" to open it (holdings, cash, buy and sell). It starts collapsed every time the page opens; opening one is not remembered. The uninvested cash box and "Invested" figure are inside the opened account, so they are hidden until you open it.
2. **Add account** now sits right under the allocation chart, above the Accounts list.
3. Not built: a "show all / hide all" button, or remembering which accounts you left open.

## STATUS 2026-10-21: held RSU vests shown in dollars, whole shares into the account BUILT

Verified with 753 automated tests (11 new or changed, 24 + 2 in the RSU file) and a browser check (desktop and 375px: a 33-share held vest at $50: after-tax value, the paycheck detail row, "add to holdings", the resulting holding, lot, basis, and account cash). The browser check used invented data, not yours.

Judgment calls (please review):
1. **Dollars, not shares, in the tables:** the vest table's "After tax" column now shows the after-tax value in dollars for held vests, with "N shares to the account, $X cash" under it. The paycheck detail row keeps Net at $0.00 (it is not cash) and adds "$X kept as shares" under it. Take-home totals, the cash forecast, the budget's expected pay, and Afford it still count cash only, so shares are not treated as spendable money.
2. **Whole shares:** the shares added to the account are the after-tax shares rounded down to a whole number (a tiny allowance stops float noise from rounding a whole number down).
3. **Cost basis:** the lot (taxable account) or holding (IRA, 401(k), HSA, 529) gets the whole shares times the vest price, and adds to what the holding already has. The leftover cash is not part of the basis. Every vest is its own lot (dated on the vest, source "RSU", with its own basis), even two vests on the same day; the holding's shares and basis are always the sum of its lots, and shares already in the holding before keep their basis as their own "opening" lot. Held vests can only be sent to a brokerage account (the pickers list nothing else), which always tracks lots; the IRA-style path in the code (holding only, no lots) cannot be reached from the screens.
4. **Leftover part of a share:** its dollar value is added to the same account's uninvested cash when you press "add to holdings", as a broker would pay cash for a partial share. A vest too small for one share adds only the cash. It does not touch your checking forecast.
5. **Already-recorded vests are left as recorded** (fractional shares and full basis). Nothing in your accounts changes.
6. If the company really rounds the sold shares up instead (so the cash is lower), set the withholding rates on the Income tab to match; the app still assumes the tax comes out of the vest.

Not built: a one-time round-down of vests already recorded, and showing kept value in the Roth planner or retirement pages (they already use vest value from the model).

## STATUS 2026-10-21: RSU grants with a generated vesting schedule BUILT ("go")

Verified with 748 automated tests (20 new) and a browser check (desktop and 375px: your 2/2/26 quarterly example, even fill, editing one row's shares and price, a stock grant with a new ticker and no price key). The browser check used invented test data, not yours. Database is now version 14; backups are version 14 (older backups still restore). NOT tried: the live price lookup against Twelve Data (the tests use a fake response), and changing a grant's schedule after shares are entered in the browser (covered by tests only).

Judgment calls (please review):
1. **Where:** Income tab, Stock awards (RSUs): a new "Grants with a vesting schedule" card above the existing form, which is now titled "Add a single vest (one-off or already vested)" and works exactly as before. Existing vests are untouched.
2. **Dates:** one every period after the start date, on the same day of the month (2/2/26 quarterly: 5/2, 8/2, 11/2, 2/2/27 ...), for the whole length (16 dates for 4 years quarterly). A day a month does not have falls on that month's last day, counted from the start date (Jan 31 monthly: Feb 28, Mar 31). Length is whole years, 1 to 10.
3. **Cliff (optional):** the first vest is on the cliff date and regular dates continue after it. A cliff that is not on a regular date still gets its own vest. The first vest after a cliff normally covers everything earned so far, so you enter a bigger number of shares there; the app does not work that out.
4. **Worksheet:** a table of the dates; type shares on a row to make that vest (zero or blank removes it), or "Fill evenly" from a total (whole totals split into whole shares with the extras on the earliest vests; replaces what is typed, after a confirmation). A price box on each row overrides the grant price for that vest (cash) or is the actual vest price (stock). Blank returns to the grant price.
5. **Vests are real vest rows:** a row exists once it has shares, linked to the grant. Taxes, alerts, the calendar, held-share lots, forecast and the Roth planner see ordinary vests. Vests with no shares do not exist, so nothing shows up with zero value.
6. **Cash grants:** one price per share on the grant. If you change it, vests that were using the old price follow; a vest with its own price keeps it.
7. **Stock grants:** type the ticker. A ticker the app does not know creates a holding vehicle in the first stock asset class (change it on the Investments tab). The price is looked up once when the grant is saved if the vehicle has no price yet, and the "refresh price" link on the grant looks it up again. It uses your own Twelve Data key on this device; with no key the price stays manual and the screen says so. The price is the stock's current price, used to value future vests until you type the actual vest price on that row. The ticker symbol is sent to Twelve Data, as in the Investments refresh. Sold or held, and the brokerage account, are set once on the grant.
8. **Changing a grant:** name, kind, stock, after-vest and account changes carry to its vests, except vests already added to holdings (they keep where they went). Changing the start date, length, frequency, or cliff keeps shares and prices on dates that still exist and removes vests that no longer fall on a date, after a confirmation that lists them. Vests already in holdings are never removed or changed by the worksheet; they show "in holdings".
9. **Deleting a grant** deletes its vests, except those already in holdings, which stay as single vests.
10. **Sync and backup:** grants are a new table, tracked for sync and in backups. A stock grant refers to its security and account by id.
11. A new stock vehicle created by a grant is created on this device; if the other device has its own copy of the same ticker, you may end up with two (the existing Investments page has the same issue).

Not built: ages, generating a worksheet from an existing set of vests, a quarterly "vest on the 15th" style rule other than the start date's day, vesting percentages per date (you type shares), and the "at risk" cash flag.

## STATUS 2026-10-21: year-by-year tables for the savings-through-retirement lines BUILT ("go")

Verified with 728 automated tests (9 new) and a browser check (desktop and 375px: all three lines, today's and future dollars, the money-runs-out year, a by-hand check that a row adds up to the cent). The browser check used invented test data, not yours. Not checked in the browser: the CSV download itself (the CSV text is covered by tests).

Judgment calls (please review):
1. **Chart lines, not one life:** each table is the chart's 10th percentile, median, or 90th percentile line (in each year the simulated futures are sorted and that one is read off), as you chose. The plan's flows (contributions, other income, spending, loan payments, tax, windfalls) are the same in every future, so only growth and balances differ between the three tables. Growth is what bridges one year's line to the next, so start + net flow + growth = end on every row.
2. **Today's dollars:** each year is divided by that year's inflation factor and the start balance by last year's (like the chart), so the growth column is labeled "Growth after inflation" there. Future dollars show nominal figures.
3. **Money running out:** the year it runs out shows the planned amounts (marked "money ran out"; growth is blank because the planned amount was not fully paid, and its withdrawal rate can top 100%). Later years show a zero balance and blank flows ("ran out earlier"). A note above the table names the year.
4. **Other income above spending** is capped at spending and the excess is not added to savings. This is how the existing model already worked; the table now shows it.
5. **Tax column** is the gross-up on withdrawals: (spending + loan payments, less other income) divided by (1 - tax rate), minus what it covers.
6. **Years, not ages:** rows say "working" or "retirement year N". The app does not store birth years.
7. **CSV download** exports the table as shown (the chosen line and dollars), dollars to the cent, blanks where the money had run out.
8. Internal: the retirement model now exposes the pieces of each year's cash flow (`parts`); the numbers it simulates are unchanged.

Not built: ages, a version that follows one real simulated future, and a printable layout.

## STATUS 2026-10-21: Retirement tab: typed confidence percent and monthly Social Security BUILT

Verified with 719 automated tests and a browser check (desktop and 375px: clearing and typing in the box, saved across a reload, 0 and 150, adding a $2,500 monthly benefit). The browser check used invented test data in the preview browser, not yours.

Judgment calls (please review):
1. **"Want the money to last in (% of futures)":** you can now clear the box and type any number. The limit is applied when you click away or press Enter: 0 to 99 (a higher number becomes 99; empty or non-numeric text goes back to the last good value). The old box forced 50 to 99 on every keystroke, which caused the snapping you saw.
2. **0% as a goal** is allowed as you asked; it means any result counts as success, so "Find spending that lasts" at 0% will return a very large number.
3. **Social Security (Other retirement income) is entered per month.** It is stored and projected per year (monthly x 12, in today's dollars), so nothing in the projection engine, database, backups, or sync changed, and entries you already had are untouched. The list now shows each one as a monthly amount (yearly / 12, rounded to the cent), so an old entry whose yearly amount is not a multiple of 12 cents may show a cent off.
4. This applies to all items in that section (pensions, rental income), not only Social Security.

Not built: the Roth planner's own "other income" list still asks for a yearly amount.

## STATUS 2026-10-20: asset class assumptions updated to compound (geometric) returns BUILT

Verified with 718 automated tests (including the update on a database holding the old defaults and two seeds at once) and a browser check of the migration and the table. The figures are the ones you supplied; I did not verify them against a source.

Judgment calls (please review):
1. **Meaning of the return column:** it is now the compound (geometric, CAGR) nominal return. The steady path grows at it. The Monte Carlo draws (Projections, Retirement, Goals, and the Roth planner's simulations) are centred so the typical (median) outcome tracks it; each yearly draw averages a little above it, as it should. Before this, the column was an arithmetic average, and the simulation's median ran below the steady path. The note on Projections and the Investments table heading say so.
2. **Classes:** US stocks, International stocks, Bonds and REITs became US large cap, Intl developed, US aggregate bonds and US REITs (same records, so holdings keep their class). Added US small cap, Emerging markets and High-yield bonds. Balanced / target-date, Cash and Other were not in your table and keep their old numbers (6%, 3%, 5%), which are now read as compound returns.
3. **Existing data:** updated once, only for classes still at the old defaults; an edited class is left alone, and a class you delete afterwards does not return. The three new classes have fixed ids so synced devices do not double up. They sit at the end of the list.
4. **High-yield bonds** are the "bond" kind, the closest the app has, so the simulation treats them as moving mostly apart from stocks. Real high-yield bonds fall with stocks more than that. A new "high-yield" kind with its own correlations is not built.
5. **Mixed portfolios:** the steady path uses the weighted average of the class compound returns. A rebalanced mix can compound slightly higher, so the steady path is a little conservative.
6. Also fixed: seeding the default classes twice at once (React dev mode does this) could fail or leave extras; the check and insert now happen in one transaction.

## STATUS 2026-10-20 (latest): split remaining amount and account renaming BUILT

Type check clean and 708 automated tests pass. Checked in the browser (desktop and phone width): split states (empty, partial, exact, over), rename on both tabs including duplicate rejection and the new name in the Investments allocation dropdown.

1. **Split form:** shows "Allocated $25.00 · Left to allocate $75.00 (of $100.00)" (amber until it reaches $0.00, then green; "Over by $X" if too much). It shows as soon as Split is chosen, and asks for the charge amount first if that is empty.
2. **Rename accounts:** a "rename" link next to the name on each account's page (Accounts tab) and on each card in Investments. Names must be non-empty, 60 characters or fewer, and not match another account of the same kind (case-insensitive). Everything refers to accounts by id, so history, budget, and reports follow the new name.
3. Not built: renaming loans from the Debt tab's loan cards (loans renamed from their ledger page only).

## STATUS 2026-10-20: targets can be set on the budget line itself BUILT

Verified with 708 automated tests and a browser walk-through (set, fund, edit, remove, empty-save message, phone width).

Judgment calls (please review):
1. **Where:** each category line on Budget has "+ set a target" (and "edit" once it has one) that opens a small form right under the line. The Targets section at the bottom still lists every target and can add them too.
2. **Monthly means "set aside another":** a monthly target of $2,400 shows "needs $2,400 this month" until you have assigned $2,400 this month (money left over from earlier months does not count toward it). YNAB's other monthly style, "refill up to $X" (top up what is left), is NOT built; say if you want it.
3. **One target per category from the line:** the inline form edits one target per category (like YNAB). The bottom section can still add a second one.
4. The amount is read when you press Save (or Enter), so you do not have to click out of the box first.

## STATUS 2026-10-19 (final): "Initial setup" category BUILT

Verified with 706 automated tests and a browser walk-through (balances, Home, Budget, Reports, Flow).

Judgment calls (please review):
1. **What it is:** a built-in category "Initial setup" in a "System" group, created at startup if missing, with fixed ids so each device makes the identical records (nothing doubles on sync). It cannot be renamed or deleted, and the group has no "add category" box. It appears in every category dropdown under "System".
2. **Counts as money, not as activity:** entries filed under it change the account's balance, net worth, cash, and Ready to Assign (like an opening balance would), and a card balance entered this way shows as owed and unfunded on the budget.
3. **Left out of:** income and spending in Reports, Year in review, Protection (spending runway), Home's monthly spending and its transaction count, the budget's categories, income, and uncategorized count, the forecast's everyday-spending estimate, retirement's trailing spending, payee rule suggestions, and repeating-charge detection. It still appears in the Transactions list, account ledgers, and CSV export, because they are real entries.
4. **Flow diagram:** left out by default, with a checkbox ("Include Initial setup entries") that shows positive entries as "Initial setup (money in)" and negative as "Initial setup (money out)". The checkbox is part of saved views.
5. **Splits:** a split line filed under it is ignored the same way.
6. Not built: a one-click "set this account's balance to match my bank" helper that would create the entry for you.

## STATUS 2026-10-19 (latest): saved color themes and credit limits BUILT

Verified with 692 automated tests and browser checks (themes: save, update, switch, copy code, import, bad code; credit limit: set, change, over the limit, no limit).

Judgment calls (please review):
1. **Saved themes:** the library (name, light and dark colors) lives in settings, so it is in backups and syncs between devices; which theme is active stays per device (localStorage), as before. Up to 20 themes; names unique (case-insensitive), up to 40 characters. Picking a saved theme copies its colors into the active palette, so a change made to that theme on another device appears here the next time you pick it. "Update" saves edits back; "Save as new" makes another. Deleting a saved theme keeps its colors on until you pick something else.
2. **Theme codes:** "ledger-theme-1:" followed by the name and 24 colors, encoded as text. An imported theme that clashes with a name gets "(2)", "(3)", and so on, and becomes the active theme.
3. **Credit limit:** optional, on credit card accounts only (set when adding the card, or from the card's page). Credit left = limit minus what you owe; a card in credit adds to it. 75% or more of the limit shows as a warning and over the limit in red, with a plain note about the usual 30% guideline. Accounts shows each card's credit left and a total.

## STATUS 2026-10-19 (later): flow (Sankey) diagram and one-open-at-a-time sidebar BUILT

Verified with 667 automated tests and browser checks (numbers hand-checked against test transactions, filters, custom dates, gross view, phone width).

Judgment calls (please review):
1. **Where:** a "Flow diagram" tab on Reports (the existing reports are the "Trends" tab).
2. **Counted:** every expense category, plus the principal part of loan, mortgage, and HELOC payments (they are transfers to the loan account, shown as "Loan principal"). Left out: credit card payments and moves to savings or investments. Card spending counts through its categories.
3. **Left over:** income minus spending shown as "Saved". If any category or account is switched off it is called "Left over" with a warning, since it is no longer true savings. If spending exceeds income, a "Drawn from savings" bar feeds the diagram instead.
4. **Periods:** "Last 3/6/12 months" are the whole months before this one; "This month" and "This year so far" run through today; "All time" starts at your first transaction; custom dates are inclusive and can be entered in either order.
5. **Gross view:** pay, taxes, and deductions come from your Income setup (the paycheck model), not from deposits, so they can differ from what reached your accounts. Spending still comes from your accounts. Taxes are withholding (federal incl. additional Medicare, Social Security and Medicare, state and family leave); deductions are listed by name (401(k), HSA, and so on). Years without a pay setup show a message.
6. **Account filter:** limits income and spending to the accounts you leave on; it does not affect the gross-view pay.
7. **Phone:** the diagram keeps about 200px per column so labels stay readable, so it scrolls sideways inside its box (with a hint).
8. **Sidebar (desktop):** all groups start collapsed and only one stays open at a time; the open one is remembered per device.
9. **Saved views (flow diagram):** a named view remembers net or gross, the period preset, groups or categories, and what is switched OFF (categories and accounts). Storing what is off means categories and accounts you add later appear in your saved views. Custom dates are not part of a view; they are remembered separately, with everything else, as what the page showed last time on this device. Views live in settings, so they are in backups and sync between devices.

## STATUS 2026-10-19: device sync BUILT (via a private GitHub repo)

Verified with 645 automated tests (two simulated devices through an in-memory remote, plus the GitHub client against a fake fetch) and browser checks. NOT yet tried against real GitHub: do the first real sync with a throwaway repo.

Judgment calls (please review):
1. **Where:** one encrypted file (`ledger-sync.bin`) at the root of a private repo you create. Gzip, then AES-GCM with a passphrase (PBKDF2). You create a fine-grained token limited to that repo (Contents: read and write); it and the passphrase are stored in this browser only. The app refuses a public repo.
2. **Merge:** per record, last edit wins (each record now has an `updatedAt`). Deletions are detected against the ids at the last sync and win unless the record was edited afterwards. Both-sides edits are listed on the Sync page (last 50). Budget lines, net worth months, tax settings per year, and scheduled-item log entries are collapsed to one per natural key if two devices made them at once.
3. **Ids:** new records now get time-based ids (about 1.8e15) so two devices cannot collide. Existing small ids are unchanged. The second device must REPLACE its data with the synced copy when it connects (small ids would collide otherwise).
4. **Not synced:** the price-data key (per device) and appearance/palette (per device, already in localStorage).
5. **Restoring a backup** on a synced device re-stamps everything so it wins, and deletes anything not in the backup on all devices (the restore confirmation says so).
6. **Timing:** on open, on return to the app, when back online, 8 seconds after a change, and every 5 minutes while open. Clock differences between devices could pick the wrong "later" edit if clocks are badly off.
7. Deletion markers are kept 365 days; a device offline longer could bring back something deleted elsewhere.

## STATUS 2026-10-17 (latest): monthly check-in, "Can I afford it?", budget targets, and charitable giving BUILT ("build: 1, 2, 3, 7")

Verified with 626 automated tests and browser checks (desktop and 375px phone width, no horizontal overflow). Database is now version 13; backups are version 13.

Judgment calls (please review):
1. **Targets:** monthly = assign a set amount; by date = remaining divided by months left, rounded up; yearly = next occurrence. When money is short, the soonest-due target is funded first.
2. **Giving:** gifts of shares assume a 15% long-term capital-gains rate for tax avoided. The 60% (cash) and 30% (shares) of income limits and carryforwards are not modeled. Gifts feed the Tax package and can set your itemized deduction in Tax planning.
3. **Afford it:** standard guidelines (28% housing, 36% total debt with 43% as a hard limit, car costs 15 to 20% of income and payment under 10%, 3 to 6 months of cash left over, a PMI note under 20% down). Rent vs buy ignores the mortgage-interest and property-tax deductions.
4. **Check-in:** the budget step counts as done when nothing is overspent and unassigned money is under $50. Prices older than 10 days, property values older than a year, and a backup older than 30 days count as to-do. Your own ticks are saved per month in settings. Home nudges you from the 25th if steps remain.

## STATUS 2026-10-20: cash-flow forecast, spending reports, debt payoff, "if something happens" guide, protection check, year in review, collapsible sidebar groups, and color palettes BUILT

Verified with 576 automated tests and browser checks of every new page (desktop and phone width).

Judgment calls (please review):
1. **Forecast:** starts from checking (and, optionally, savings). Everyday spending is the average of the last three full months, leaving out items posted from Scheduled and loan interest/escrow categories (forecast separately), and is editable. Transfers in scheduled rules are ignored (card payments would double-count card spending; loan payments come from the loan schedules). Tax due is placed on April 15 and refunds on March 15 of next year. A low-balance alert on Home looks 90 days ahead.
2. **Reports:** 13 months of data ending at the month you pick; income is whatever lands in income categories (or uncategorized money in), so it is only as complete as your entries.
3. **Payoff:** a mortgage is left out of the plan by default; card APRs and minimums are entered by you (a minimum of 2% or $25 is assumed until you do); loans use their next scheduled payment and current rate. "Extra vs invest" compares final money at the end of the original term, with an optional tax drag on investment returns.
4. **Protection:** guidelines only: life need = income x years + all debts + education goals (optionally minus savings); disability = 60% of pay; umbrella = net worth rounded up to $1M steps; emergency fund target 6 months (one earner) or 4 (two). Policies are entered by you (employer coverage included) and stored in settings, so they are in backups.
5. **Guide:** stores contacts, document locations, notes per account, and free text in settings (in backups). It warns not to store passwords. Balances are hidden by default so a printout shows less.
6. **Year in review:** net worth change uses saved monthly points (the last point of the previous year as the start when available).
7. **Sidebar:** each group's name collapses and expands its pages; the choice is remembered per device.
8. **Palettes:** Classic (original) plus four presets and a custom palette (12 colors, light and dark separately). The palette and mode are stored per device in the browser (not in backups). Charts keep their own validated series colors.
9. Payee matching now ignores store numbers of any length ("WHOLE FOODS #12" = "WHOLE FOODS #99").

Still open: Social Security claiming planner and survivor scenarios, cross-device sync, broker lot import, whole-plan scenarios, guided setup/demo mode, dividend/interest income tracking, rebalancing and asset location.

## STATUS 2026-10-17 (later): all six "larger scope" features BUILT ("go")

Verified with 472 automated tests and browser checks (net worth + property, tax planning page, Home alerts and Coming up, rules and quick add, tax package, phone layout of every new page).

Judgment calls (please review):
1. **Net worth history:** one point per month, updated automatically whenever the app is open (the month's last view is kept). Past months cannot be recomputed, so earlier points are added by hand (total only). Property is only what you enter; a value over a year old raises an alert. Home value is counted in net worth; mortgage/HELOC equity needs the loans ticked on the property.
2. **Tax planning:** estimates use the Income tab's settings plus sales and HSA withdrawals. The safe-harbor test compares total withholding with the smaller of 90% of this year's tax and 100% (110% if income is over $150,000) of last year's. Suggested extra withholding is spread over the remaining paychecks (one person at a time). Loss harvesting shows the tax saved by re-running the estimate with the selected lots sold; wash-sale risk is flagged when the same security is in an IRA/401(k)/HSA. The checklist's RMD estimate uses today's traditional balance, not last year-end.
3. **Alerts** (Home): backup, overspending, owing at tax time, estimated payment within 30 days, scheduled items due, accounts with no owner, missing/stale prices, lots missing cost or date, vests within 30 days, property value over a year old; and in the last 75 days of the year: year-end checklist and harvestable losses.
4. **Calendar:** a snapshot .ics (re-download to refresh), not a live subscription. Items: vests, estimated tax dates (only when you are on track to owe), RMD deadline, Dec 31 year-end reminder, pay-cap dates, scheduled items (next 60 days), next loan payments. Money/tax items include a reminder the day before.
5. **Rules:** a rule applies to a payee that contains its text (longest wins). Rules categorize and can rename on import; the quick-add and full transaction forms fill a category from rules or from how you filed that payee at least twice before (60% majority). Suggested rules need 3+ transactions, 90% the same category. Repeating charges need 3+ occurrences, regular spacing, similar amounts, and not already scheduled; stopped ones are skipped.
6. **Quick add** now opens a fast form (payee suggestions, amount, category, save and add another); splits, transfers, and memos are one click away.
7. **Tax package:** projected pay/withholding from the Income tab (use W-2 figures when you have them); sales by lot only for taxable accounts; mortgage interest from the loan schedule (simple monthly interest), not a 1098. PDF is the browser's print dialog ("Save as PDF"); CSV per table.

Still open: Social Security claiming planner and survivor scenarios, cross-device sync, broker lot import, whole-plan scenarios, guided setup/demo mode, dividend/interest income tracking.

## STATUS 2026-10-17: navigation and Home redesign BUILT (before the larger features below)

The 15-link top banner was replaced by an information architecture: Home / Money / Invest / Plan / More. Desktop: grouped sidebar; phone: bottom tab bar plus a scrolling row of the section's pages. Added: Home screen (net worth, ranked "needs attention" alerts, this month's spending, recent transactions, goals, quick links), global search (Ctrl+K or /), quick-add button (add a transaction from anywhere; shortcuts to trades, paycheck scenario, scheduled item), breadcrumbs, in-page tabs on Investments (Accounts / Realized gains / Prices & assumptions), a Settings page under More. Accounts moved from "/" to "/accounts"; every other address is unchanged.

Judgment calls: Import and Categories sit under Money; Income and Paycheck sit under Plan (with the planners) rather than their own group; the phone tab bar has five tabs; keyboard shortcuts are limited to search; the Home net worth excludes property until home value is added (next item in the queue).

The larger features (net worth history + home value, tax planning dashboard, alerts/Today expansion, calendar export, quick capture + rules, tax-time package) are still queued under "Larger scope" below; Home and alerts are the first slice of them.

## STATUS 2026-10-16: paycheck calculator, HSA accounts, and cost basis / realized gains were BUILT ("go")

Verified with 380 automated tests and a browser walkthrough (new scenario from a copy, live edit, compare; HSA account and withdrawal; lots, buy, sale with FIFO, undo, tax effect on the Income tab; phone layout).

Judgment calls (please review):
1. **Paycheck calculator** copies are independent of the Income tab (editing a scenario never changes the real setup). Scenario edits apply immediately (no Save button). The household yearly tax uses the other person's real income (optional) and your Income tab's tax settings. RSU vests are not part of a scenario (add bonuses to model a lump sum).
2. **HSA** is its own account type. A withdrawal logged as "not qualified" is added to other income on the Income tab with a 20% penalty if the owner is under 65 (no known owner or birth year assumes under 65). Death/disability exceptions are not modeled. Logging a withdrawal takes it out of the account's cash when cash is available. The Roth planner treats the HSA as a tax-free bucket that pays the "medical costs per year in retirement" you enter once everyone has retired; a leftover HSA is taxed at your heirs' rate for heirs.
3. **Tax lots:** existing taxable holdings become one "opening" lot with the recorded basis (or $0 if none was recorded) and an unknown purchase date, which counts as long-term. Fix the date and cost in the lots panel. Taxable holdings' share counts follow the lots (edit lots, not the share box). Adding shares to a taxable holding adds a lot (merged into the same holding).
4. **Sales:** the default method is remembered (FIFO to start); "pick specific lots" is per sale. Average cost allocates in proportion over all lots, and each lot's own date decides short vs long term. Proceeds go to cash only if you tick the box (same for buys). Wash sales and the carried-forward part of a capital loss are not modeled. A net loss deducts up to $3,000 against other income.
5. **Realized gains** feed the Income tab (short-term as ordinary income; long-term stacked at 0/15/20% using the 2026 thresholds for every year; 3.8% NIIT above $250,000; MA taxes them at 5%) and the first year of the Roth planner.
6. **Qualified accounts** (IRA, 401(k), Roth, HSA, 529): a sale only lowers the holding, with no gain or lots. You can edit the holding's total cost basis there.
7. **Held RSU vests** in a taxable account now create a tax lot dated on the vest.

Still open: dividend/interest income tracking (reinvested dividends create lots but the dividend itself is not counted as income), wash sales, the capital-loss carryforward, cost basis for inherited/gifted shares, importing broker lot data.

## STATUS 2026-10-14: the Roth conversion planner and RSU vesting (last two sections of this file) were BUILT ("build all")

Verified with 318 automated tests and a browser walkthrough (entering cash and stock vests, editing a vest price, recording held shares, running the planner and the simulations, phone layout).

Judgment calls (please review):
1. **RSU withholding** defaults to the federal supplemental rate (22%) and the MA flat rate (5%), plus Social Security/Medicare; set the real rates per person under "Withholding on vests". Over-$1M supplemental wages (37%) are not modeled.
2. **Held stock** assumes the tax is covered by selling shares at the vest (sell-to-cover): you keep the net shares, with the net value as cost basis. The paycheck-detail row shows net $0 for it (it is not spendable cash). "Add to holdings" only appears once the vest date has passed and creates or adds to a holding in the chosen brokerage account.
3. **Cash vests** are treated as wages paid on the vest date (taxed through payroll). The "at risk / escrow" flag was never answered, so it was not built.
4. **Roth planner scope:** two people at most; both live through the plan; conversions happen on January 1; a 401(k) rolls into the IRA when its owner retires (that is also when it becomes convertible); no early-withdrawal penalties or Roth 5-year rules; HSA ignored; survivor tax filing not modeled; heirs' tax is one flat rate.
5. **Before everyone has retired**, wages are assumed to cover spending and the ordinary taxes, so only the extra cost caused by a conversion (tax, IRMAA, lost ACA credit) comes out of savings. After that, spending plus all taxes come from Social Security, other income, RMDs, then taxable, traditional, Roth.
6. **Tax tables for the planner** are in `src/data/retirementTax.ts` (2026), with items marked UNVERIFIED (ACA applicable-percentage table, IRMAA dollar amounts, MA 65+ exemption, senior-deduction phase-out). Later years scale indexed amounts by your inflation assumption; non-indexed amounts (Social Security thresholds, NIIT threshold, senior deduction ending 2028) stay fixed.
7. **IRMAA** uses income from two years earlier; for the first two plan years it uses the first year's income. **ACA** credit assumes a two-person household and the "benchmark plan" premium you enter; spending should exclude health premiums before Medicare.
8. **Simulated futures** use one common market return per year for all accounts (lognormal), identical random paths for every strategy.
9. **Bracket-fill** strategies solve each year's conversion exactly for the ordinary-income bracket top (two passes, so withdrawals that change with the conversion are accounted for).

Still open: survivor/death scenarios, HSA, inherited-account 10-year payout, state tax other than MA, "at risk" cash vests, RSU vests feeding the Projections tab as separate cash flows.

## STATUS: everything below (through All Transactions) was BUILT on 2026-10-09 (owner asked "build these now")

Built and verified (242 automated tests, plus a walkthrough in the browser: theme switching, pay schedules and employer cap, ESPP/HSA switches,
collapse memory, price override, every transaction filter/sort/bulk/export, mortgage and HELOC numbers against independent calculations,
ledger link, budget, retirement panel, phone layout of all 13 pages).

### Judgment calls made while the owner was asleep (please review; all are easy to change)

1. **Weekend pay rule is OFF by default** (the box is unchecked on new and existing profiles). Turn it on per person under Pay schedule. Holidays are not considered. With the rule on, a pay day can move across a year boundary (e.g. a Saturday Jan 1 pays on Dec 31), which can make a 25-paycheck year; each paycheck is still salary / 24.
2. **"Last day of the month" is stored as day 31**, and day numbers past a short month's end clamp to its last day (tested for Feb, 30-day months, and leap years). "Last business day" is a separate choice. The **Scheduled** tab's recurring items still use the older day rules (no last-business-day option there yet).
3. **Employer 401(k) contribution** is one section with two formulas (match on contributions, or flat % of pay), an optional yearly dollar maximum, and a key-date line when the maximum is reached. With a match + true-up, the maximum applies to the year-end total.
4. **HSA / ESPP** appear only when switched on ("I have an HSA", "enrolled in ESPP"). Existing data that already has either shows them automatically. Switching one off removes its deduction (after a confirmation).
5. **Collapsible sections** remember per device what you collapsed; everything is open the first time. The Transactions filter panel starts collapsed on phone-width screens.
6. **Theme button** sits at the end of the top navigation bar and cycles Device, Light, Dark.
7. **Manual price**: refreshing prices overwrites a manual price (as asked); a ticker the API cannot price keeps the manual value. The Price cell in each holding row is now editable and always visible (it was hidden on phones).
8. **All Transactions**: totals include transfer rows with a note saying how many (use "Hide transfers" to exclude them). Bulk category skips transfers and replaces splits with the single category (it says how many). Selection only ever counts rows inside the current filter, and clears after a bulk action. The CSV defuses text starting with `= + - @` (prefixes an apostrophe); amounts stay plain numbers.
9. **Debt: interest accrual** is simple monthly (balance x rate / 12), shown in the app; reconcile against a statement.
10. **Debt: "keep my payment" vs "lower my payment"** is a per-loan setting (default: keep the payment and finish sooner). In "lower" mode a large recurring extra can still finish a little before the original end date. A rate change always recalculates the payment over the months that remain.
11. **Debt: ledger link.** A loan becomes a new "Loan" account kind (a balance you owe). Loans are never part of spendable cash. In the Budget a loan gets a "Payment: <loan>" line that you fund by assigning the principal you plan to pay; there is no "unfunded debt" warning for loans. Payments are recorded from the loan card ("Record a payment"): principal as a transfer to the loan, interest/escrow as an expense split across the categories you choose.
12. **Debt: escrow and PMI** are informational (shown in the total monthly payment and recorded as an expense when you record a payment); they do not change the loan balance.
13. **Debt feeds Retirement** through an opt-in checkbox, OFF by default, because a spending figure that already includes the mortgage would be double counted. Net worth (cash + investments - cards - loans) is on the Debt tab; property value is not included.
14. **Phone layout**: tables wider than the screen now scroll sideways inside their own box on every page, and long checkbox sentences wrap. Found and fixed during testing.

### Still open (not built, from the questions listed under the Debt tab below)
- Daily interest accrual; HELOC lifetime/periodic rate caps and prime + margin modeling; lender-specific HELOC minimum payments.
- Adding "last business day" to the Scheduled tab.
- Showing a "no price" holding more helpfully in totals (it still counts as $0, with a warning).

---

## Income tab

Collected 2026-10-08. All decisions below were confirmed by the owner.

- [x] **1. Collapsible sections.**
  - Add collapse/expand to the sections on the Income page: People, each person's setup (and its inner parts: Pay, Salary,
    Deductions, Employer contributions, Income tax withholding), Bonuses, Household tax settings, Results, and the paycheck detail.
  - **Default: open. Remember what the owner collapses** (per device, in browser storage; the page must still work if storage is unavailable).

- [x] **2. Pay setup line is confusing ("Model by / Paid / A real pay date").**
  - Owner's question: is it the start date for annual income? No. Explained to the owner: it picks how paychecks fall in the year; the "real pay date" is only an anchor.
  - **Decision: show only what is needed, with plain labels and a one-line explanation.**
    - Weekly / every 2 weeks: ask for "any past payday" (anchor; explains it decides which dates and which months get 3 paychecks).
    - Twice a month: ask for the two pay days (no anchor date).
    - Monthly: ask for the pay day of the month (no anchor date).
    - Annual numbers mode: no date at all.
  - **Twice-a-month pay days (owner's real case: the 15th and the final business day of the month).**
    - Entering 31 must never break short months (it already clamps to the last calendar day; keep a test for Feb, 30-day months, leap years).
    - Add an explicit **"last business day"** choice (not just 31) and a **"if the pay day lands on a weekend, pay on the prior business day"** option.
    - Assumption to confirm when implementing: weekends only; public holidays are ignored (note this in the UI).
    - Add tests for months ending on a weekend and for a 1st/15th on a weekend.

- [x] **3. Deductions table: spacing of the "reduces" checkboxes is off.**
  - The checkbox and its label (Fed / FICA / MA) sit on separate lines, so it is hard to tell which box goes with which label.
  - Fix: put each checkbox and its label on one line (checkbox directly beside its label), in a tidy aligned group.
  - Also consider clearer wording than "FICA" (e.g. "Social Security & Medicare").

- [x] **4. 401(k) match: add a dollar maximum, and support two formulas.**
  - Owner's example: "my employer matches 10% up to a total of $5,000".
  - **Decision: support both formulas, chosen per person:**
    - **(a) Match on contributions (the more likely case):** employer adds X% of what the employee contributes, up to Y% of pay.
    - **(b) Flat contribution based on pay:** employer contributes a % of pay regardless of what the employee contributes.
    - **Either formula gets an optional yearly dollar maximum** (the cap applies to the employer's total contribution for the year, including with true-up on).
  - Needs: engine change in `simulatePerson` (cap applied as the year progresses, so the match stops once the cap is reached), a new match config shape with a data migration for existing saved profiles, tests (cap reached mid-year; cap with true-up; flat formula; formula (b) with no employee contribution), UI fields, and a milestone line in the results ("employer match cap reached on ...").

- [x] **5. ESPP is lumped in with HSA under "Employer contributions". Only surface ESPP if enrolled; same rule for HSA.**
  - **Decision: each benefit appears only when switched on for that person.**
    - Add an "Enrolled in ESPP" checkbox; only then show the ESPP discount field and the "+ ESPP" deduction button.
    - HSA: show employer HSA contribution and coverage type only once an HSA deduction exists (or an "I have an HSA" switch is on).
  - Edge case to handle: existing saved data that already has an ESPP or HSA deduction must show those controls automatically.
  - Copy-from-last-year should carry the switches forward.
  - Consider renaming the section heading, since it will no longer be a single "Employer contributions" block (401(k) match, plus optional HSA and ESPP details).

---

## New feature: Debt tab

Requested 2026-10-09. Decisions confirmed by the owner. Same working rule: do not build until the owner says all notes are in.

- [x] **Debt tab: mortgage tracking, HELOC planner, and amortization for new or what-if loans.**
  - **What the owner has:** an outstanding mortgage (track amortization) and a HELOC with a **10-year interest-only draw period followed by a
    15-year payback**. Wants amortization tables for existing and new loans, and a calculator to forecast HELOC payments.
  - **Integration decision: tied into the ledger.**
    - Each loan appears as a liability (new account kind). A payment entered in a checking account is **split into interest (an expense,
      for the budget) and principal (reduces the loan balance)**, so budget and loan balances stay in sync.
    - Debts feed the **Retirement** tab (payments and payoff dates as known obligations) and a net-worth view.
    - Reuse the existing transfer machinery where possible; interest expense should land in a user-chosen category.
  - **Mortgage setup: either method, chosen per loan.**
    - Original terms (amount, rate, term, first payment date), or current balance + rate + remaining months.
    - Reconcile against the owner's latest statement balance and show any difference.
  - **HELOC.**
    - Variable rate, and **the owner may keep drawing**: model additional draws (and repayments) by date during the draw period.
    - Rate changes entered by date (a rate-change schedule), plus a **what-if shock** (e.g. +1%, +2%) to see sensitivity of payments and total interest.
    - Draw-period payment is interest only; **repayment period re-amortizes at each rate change** (payment recalculated to pay off the
      remaining balance over the remaining months at the new rate).
    - Make the draw length and repayment length editable (defaults 10 and 15 years).
  - **Extra principal payments in BOTH periods** (the owner corrected an earlier summary that implied interest-only only).
    - Support recurring extra amounts (e.g. monthly) and one-time lump sums by date, on any loan, in either phase.
    - Interest-only period: extra principal lowers the balance, so the interest-only payment falls.
    - Payback period: show the effect on payoff date and total interest.
  - **Outputs.** Full amortization table (month, payment, interest, principal, extra, balance), total interest, payoff date,
    interest saved by extra payments, a balance-over-time chart (base case vs rate shock), and a table view. Same engine for new/what-if
    loans (refinance, auto, student, other) so they can be compared with an existing loan.
  - **Open questions to confirm at implementation time (not yet asked):**
    - Interest accrual convention (simple monthly: balance x annual rate / 12, versus daily accrual). Default to monthly; say so in the UI.
    - Mortgage escrow (property tax / insurance) and PMI: track or ignore? (affects the real monthly payment shown).
    - HELOC rate caps (lifetime and periodic) and prime + margin structure, if the owner wants them modeled.
    - In the payback period, after extra principal: keep the payment the same and finish early, or re-amortize to a lower payment? (Rate changes
      always re-amortize; the choice is how extras behave between rate changes.)
    - HELOC minimum-payment rules during the draw period (interest only versus a lender-specific minimum).
  - **Engineering notes:** new tables (loans, loan rate changes, draws, extra payments) via a new DB version and backup version; pure schedule
    engine with tests (rate change mid-schedule, draw then payback, extra principal in each phase, final-payment rounding, balance reaches
    zero exactly); loans excluded from the budget's cash accounts; links with `createTransfer`-style split logic.

---

## New feature: theme switch (dark mode)

Requested 2026-10-09. Decisions confirmed by the owner. Same working rule: do not build until the owner says all notes are in.

- [x] **Light / Dark / Device theme switch in the top navigation bar.**
  - **Current state:** the app already follows the device's light/dark setting (CSS `prefers-color-scheme`), including the chart palettes.
    There is no way to override it inside the app.
  - **Decision: three choices, Device (default) / Light / Dark.** A small sun/moon button in the top nav, visible on every tab (including phone width),
    that cycles or opens the three choices and shows which is active.
  - **Persistence:** remember per device (browser storage; must still render correctly if storage is unavailable).
  - **Engineering notes:**
    - Today's colors are defined only under `@media (prefers-color-scheme: dark)`, in `src/styles.css` for the app and the `.viz` chart tokens.
      Add explicit `:root[data-theme="dark"]` and `:root[data-theme="light"]` scopes so a forced choice beats the device setting both ways
      (dark values declared under both the media query, guarded with `:root:not([data-theme="light"])`, and the `data-theme="dark"` scope).
    - Set `data-theme` on `<html>` as early as possible (inline script in `index.html`) to avoid a flash of the wrong theme on load.
    - Update `<meta name="theme-color">` to match the active theme, and keep `color-scheme` in sync so form controls and scrollbars follow.
    - Check every page in both modes, especially the budget colors (.pos/.neg/.warn), badges, tooltips, and the allocation/fan charts.

---

## Investments tab

Reported 2026-10-09. Same working rule: do not build until the owner says all notes are in.

- [x] **Manual price override is not available where the owner looks for it.**
  - **What the owner saw:** in an account's holdings table the Price column just says "none", with no way to enter a price.
  - **What exists today:** the editable price box is only in the separate "Holdings vehicles and prices" table near the bottom of the page.
    It is easy to miss, and the commit-on-blur behavior gives no confirmation.
  - **Requested behavior:** let the owner type a price manually, as a stopgap until the API refresh supplies it. **A later price refresh overwrites
    the manual price** (this already matches how `applyPrices` works; keep it, and keep a manual price when the API cannot price that ticker).
  - **Proposed fix (no decision needed unless the owner objects):**
    - Make the Price cell in each holding row an editable field (shown as "Enter price" when empty), saving on Enter or when leaving the field,
      with a brief "saved" confirmation.
    - Show where the price came from: "manual" vs "refreshed" and its date, next to the price.
    - Prices belong to the ticker, so entering one in one account prices every account holding that ticker; say so in a hint.
    - Keep the vehicles table as is.
  - **Related bug found while reviewing:** in the vehicles table, typing something that is not a valid number clears the stored price (invalid
    text is treated the same as an empty box). Invalid input should be rejected with a message and leave the price unchanged. Add a test.
  - Also consider showing the empty-price state more helpfully in the allocation/total (a "no price" holding currently counts as $0).

---

## New feature: All Transactions screen

Requested 2026-10-09 (the owner could not find a transaction history; history today is only per account, on each account's page).
Decisions confirmed by the owner. Same working rule: do not build until the owner says all notes are in.

- [x] **A screen that lists transactions from every account, with filtering and sorting.**
  - **Filters (all combinable):**
    - Account (by name; multi-select).
    - Date and date range (from/to, plus quick ranges such as this month, last month, last 90 days, this year).
    - Category (multi-select, including "uncategorized"; a split transaction matches if any of its parts matches).
    - Payee (text search, "contains"; also search memo).
    - Amount with comparison: **greater than, less than**, equal to, and between; handle inflow vs outflow clearly (filter on absolute amount, or on signed, with a visible choice).
  - **Sorting:** by account name, date, category, payee, and amount, ascending/descending, by clicking the column headers; sensible default is newest first.
  - **Actions (decision: edit/delete plus bulk):**
    - Edit or delete any transaction from this screen, using the same editor as the account page (including transfer handling: editing/deleting one half of a
      transfer keeps the other half in sync; a transfer is shown as one row with both accounts, or clearly marked).
    - Select several rows (with select-all for the current filter) and apply bulk actions: set category, change status (pending/cleared), delete. Confirm before
      deleting; show how many rows will change. Bulk category should skip or warn on transfers and handle splits (set one category and clear splits, with a warning).
  - **Extras (decision: all four):**
    - **Totals for the filtered results:** count, total money out, total money in, net.
    - **Export the filtered list to CSV** (exactly what is on screen, in the current sort; amounts as plain numbers).
    - **Quick filters:** uncategorized, pending only, include/exclude transfers (default: show transfers, since they are real entries, but make it one click to hide them).
    - **Saved filters:** name a combination of filters and sort, recall it with one click, delete it later (per device, in browser storage/DB, included in backups).
  - **Engineering notes:**
    - Needs a new route and nav item ("Transactions"); consider also linking to it from each account page ("see all").
    - Performance: handle thousands of rows (filter in memory with sorting; paginate or virtualize the table; keep the page responsive on a phone).
    - Pure filter/sort function with tests (each filter alone and combined, date boundaries, amount comparisons including negatives, split categories,
      transfers, sort stability and ties); CSV export test (quoting, commas, negative numbers); saved filters round-trip in backup (new settings key or table, backup version bump).
    - Phone layout: filters collapsed behind a "Filters" button; columns reduced to date/payee/amount with the rest in a detail line.
    - Existing CSV-export concerns: neutralize cells starting with `=`, `+`, `-`, `@` that are text (payee/memo) so spreadsheets do not run them as formulas.

---

## Other tabs

_Not yet received._ Accounts, Budget, Scheduled, Import, Categories, Projections, Retirement, Goals, Backup.

---

## New feature: Roth conversion scenario planner

Requested 2026-10-13. Decisions confirmed by the owner. Do not build until the owner says all notes are in.

- [ ] **Compare Roth conversion strategies over the retirement horizon.**
  - **Needs per-account tax type** (traditional / Roth / taxable / HSA) because Retirement currently pools savings. Ask about IRA after-tax basis (pro-rata rule) and after-tax/Roth 401(k) money.
  - **Inputs:** both birth years and retirement years; wages (from Income); Social Security benefit and claiming ages considered; pensions/rental/other income; interest, dividends and gains from taxable holdings; spending need (from Retirement); source of conversion tax (outside money vs from the conversion); growth assumptions reuse the per-asset-class returns; optional heir bracket.
  - **Strategies:** none (baseline); fill to a chosen bracket; fixed dollar per year; gap years only (retirement to Social Security/RMDs); owner's own year-by-year table.
  - **Decisions:** conversion income counts for MA income tax (yes); model the ACA subsidy cliff (yes); exact tax calculation per scenario, not an approximation; compare on all three objectives: lowest lifetime taxes, highest ending wealth, highest after-tax wealth for heirs.
  - **Output:** tax by year per scenario, IRMAA surcharge (two-year lookback), taxable share of Social Security, RMDs with and without conversions, marginal bracket by year with cliffs flagged, ending after-tax wealth, how long money lasts (existing Monte Carlo).

## New feature: RSU vesting

Requested 2026-10-13, for both spouses. Details being clarified.

- [ ] **RSU vest events for each spouse.** Decisions confirmed 2026-10-13:
  - Entry: one row per vest event (date, shares, grant name, which person, ticker).
  - Value: shares x the ticker's price in Investments (manual or refreshed), so projected vests follow the price.
  - Withholding: varies/unknown, so a per-person withholding rate (default federal 22% flat supplemental, plus Social Security/Medicare/MA) compared against actual liability on the Income tab.
  - After vest: shares are held; each vest creates a holding in a brokerage account with the vest-date price as cost basis.
  - Vest income counts as wages (FICA, Social Security wage-base cap, tax estimates) in the vest year.
  - **Update 2026-10-13 (owner):**
    - Past vests (already happened this year) are entered too; they count toward this year's wages and withholding.
    - Future vests are valued at the ticker's current price; each vest can be given its **actual vest price**, which then sets the value and the cost basis for that date.
    - "After vest" is a per-vest choice: **held in a brokerage account** (new holding, vest price as basis) or **sold immediately** (proceeds are cash income, no holding, no gain/loss). The earlier "held" decision is superseded by this.
    - Ticker is set per vest event, so it works whether or not both spouses share a company.
  - **Update 2026-10-13 (owner, supersedes the stock-price, ticker and holding decisions above):** the RSUs are in a private company that was acquired, so there is no market price to pull. Every vest **pays out as cash at a fixed price**. So: no ticker, no price lookup, no holding or cost basis, no held/sold switch. Each vest is a dated cash payment taxed as wages (withholding rate per person, FICA/Social Security cap, MA). Open: enter as dollars per vest or as shares x a per-share deal price; whether the amount is certain or contingent (escrow/holdback).
  - **Update 2026-10-13 (owner, final; replaces the previous update):** both kinds exist. The owner's RSUs are in an acquired private company and pay out as cash; the spouse's are in a public company and vest as shares. Each vest (or grant) therefore has a **type choice: "Vests as cash" or "Tied to common stock"**.
    - **Cash:** ask for the synthetic (deal) price per share; value = shares x that price. No ticker, no price lookup, no holding. The payout is dated cash income taxed as wages.
    - **Common stock:** link to a ticker (price from Investments, manual or refreshed). Future vests use the current price; an optional actual vest price overrides it and sets the cost basis. Per-vest choice of **held in a brokerage account** (new holding at the vest price) or **sold immediately** (cash income, no holding).
    - Both types: past vests this year are entered too; withholding rate set per person (default 22% federal supplemental plus Social Security/Medicare/MA) compared with actual liability; vest income counts as wages (FICA, wage-base cap).
    - Still open: for cash vests, whether any payout is contingent (escrow/holdback) and should be flagged "at risk".

---

## New feature: cost basis and realized gains (Investments)

Requested 2026-10-15. Not built; waiting on answers to clarifying questions.

- [x] (built 2026-10-16) **Update cost basis** on a holding (Investments tab).
- [x] (built 2026-10-16) **Log completed transactions (sales)** so realized gains year to date can be tracked.
  - Open questions: single basis per holding or tax lots; how a sale picks which shares (average cost, FIFO, specific lots); short- vs long-term gains (needs purchase dates); whether a sale reduces the holding's shares and adds proceeds to the account's cash; whether to also log buys; whether the YTD figure feeds the Income/Roth tax estimates.
  - **Decisions (owner, 2026-10-15):**
    - Cost basis is tracked by **tax lots** (date, shares, cost per lot). Taxable (brokerage) accounts show holdings at lot level; existing holdings become one lot the owner can split/edit.
    - Basis is editable (per lot).
    - **Sale method is chosen per sale**: a default method (FIFO, highest cost, or average cost) with the option to pick specific lots. Selling shares sells the associated lot(s) within the Investments tab.
    - **Qualified accounts** (IRA, 401(k), Roth, 529): selling a position does NOT trigger any tax calculation (and needs no lot-level tracking).
    - Logging a sale **reduces the holding's shares** and **feeds the tax estimates** (realized gains YTD count in the Income tab estimate; short vs long term from lot dates).
    - **Buys are logged too** (each buy creates a lot with date and cost; reinvested dividends included).
    - Open: whether net sale proceeds are added to the account's cash balance (not selected, so default is no unless the owner says otherwise); wash sales are not modeled unless asked.

---

## New feature: HSA account type

Requested 2026-10-15. Not built (owner said wait). Details being clarified.

- [x] (built 2026-10-16) **Ability to categorize an account as an HSA** (Investments tab).
  - **Decisions (owner, 2026-10-15):**
    - HSA is its **own investment account type** (holds cash and investments; shows in allocation and net worth).
    - **Contributions link to the Income tab**: payroll HSA saving plus employer HSA money flow into the account in projections (within the yearly limit), like the 401(k) link.
    - **Counts in the Roth planner** as a tax-free bucket for medical costs in retirement.
    - **Track qualified medical withdrawals**: log each withdrawal as qualified (tax-free) or not (taxed, plus penalty before 65).
    - **Included in Projections**, growing with its holdings' assumed returns.
    - Open: how to treat HSA spending in the Roth planner (a yearly medical-cost figure it covers tax-free), and owner per person (self vs family coverage already exists on the Income tab).

---

## Gap: account owner (Investments)

Reported 2026-10-15. The data model has an owner on investment accounts (`InvAccount.personId`), but the Investments tab has no way to set it. The Roth planner depends on it (it assigns each IRA/401(k)/Roth to a person for RMD ages and conversions, and tells the owner to "set the owner on the Investments tab"; unowned accounts are counted as the first person's).

- [x] (built 2026-10-15) Add an **Owner** picker (people from the Income tab, plus "Joint/none") when creating an account and on each account card, editable later.
- [x] (built 2026-10-15) Show the owner on the account card; warn on retirement accounts with no owner.

---

## New feature: paycheck calculator

Requested 2026-10-16. Not built; waiting on clarifying answers.

- [x] (built 2026-10-16) A calculator for a single paycheck, with the option to **carry over existing deductions** from the Income tab's setup, **or enter new deductions manually**.
  - **Decisions (owner, 2026-10-16):**
    - Purpose: what-if on a new salary or raise; try different deductions (401(k), HSA, insurance, etc.).
    - Carry over: pick a person and year from the Income tab; copy their salary, pay schedule, deductions, and withholding into the calculator as an editable starting point (editing never changes the real setup). Or start blank and enter deductions manually.
    - Scope: one paycheck's gross-to-net breakdown plus the year (annual totals, when caps like Social Security and the 401(k) limit are reached, federal and MA liability vs withholding).
    - Scenarios can be saved, named, and compared side by side (e.g. current vs. new job).
    - Not selected: checking against a real pay stub; one-off bonus/vest net (bonuses can still be entered in the scenario).

---

## Larger scope: tax planning, net worth, and usability features

Requested 2026-10-17. Not built; waiting for the owner's go-ahead. Everything below was selected.

- [x] (built 2026-10-17) **Year-end tax planning dashboard.** Bracket room and projected federal/MA tax for the year; withholding vs. estimated payments (on track to owe or be refunded, with W-4 / quarterly payment suggestions); tax-loss harvesting from tax lots (losses available, tax saved, 30-day rebuy warning); year-end checklist (401(k)/HSA room, Roth conversion room, RSU timing, charitable gifts, RMDs due).
- [x] (built 2026-10-17) **Net worth over time + home screen.** Monthly automatic snapshots (cash, investments, home value, debts) with a history chart; home value and equity (value entered and updated over time); goal progress and next actions on one page; spending snapshot (this month's budget status and recent transactions).
- [x] (built 2026-10-17) **Today screen with alerts.** A ranked list of what needs attention across the app (bills due, overspent categories, withholding gap, upcoming RMD or RSU vest, IRMAA/ACA cliff proximity, stale prices, overdue backup).
- [x] (built 2026-10-17) **Calendar export.** Key dates (RSU vests, RMDs, estimated-tax due dates, cap dates, scheduled items) as an .ics file for the phone calendar.
- [x] (built 2026-10-17) **Quick capture and rules.** One-tap add-transaction screen, payee rules that auto-categorize (including on import), and recurring-charge detection.
- [x] (built 2026-10-17) **Tax-time package for the CPA.** One export (PDF and CSV set): wages and withholding, realized gains by lot, HSA activity, RSU income.
- Not selected for now: cross-device sync, guided setup/demo mode, Social Security claiming and survivor scenarios, broker lot import, whole-plan scenarios.
