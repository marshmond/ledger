# Ledger — ChatGPT Project Handoff and Continuity Record

> **Purpose:** The canonical, concise-but-complete transfer of architectural context and working agreements between ChatGPT conversations. This document is **not** a replacement for code, `CLAUDE.md`, `docs/BACKLOG.md`, or detailed phase reports. Maintain it alongside those sources.
>
> **Last reviewed:** 2026-11-06 (America/New_York), by Claude during Household Services S0. **Status evidence:** H5 commit `442299939c18052854d1e2175015d6115d32b937` equals `origin/main` and its "Deploy to GitHub Pages" run #58 succeeded (public Actions API, checked at the start of S0). S0 is a design document only, uncommitted. **Data policy:** This file is suitable for the **public repository**: never add real household records, financial balances, addresses, personal identifiers, secrets, credentials, or production exports.

## 1. Read this first — current snapshot

- **Product:** Ledger, a local-first personal finance and household operating system, primarily a browser app. The owner is a **non-programmer** and uses ChatGPT for product/architecture oversight and Claude for local implementation.
- **Repository:** `marshmond/ledger` (public GitHub), local folder convention `finance-app/`, canonical backlog `docs/BACKLOG.md`; all paths below are relative to repository root. The app deploys via GitHub Pages on pushes to `main`.
- **Completed and deployed:** Projects P1–P5; Home & Assets H1–H5. Verified 2026-11-06 (start of S0): `origin/main` HEAD **`442299939c18052854d1e2175015d6115d32b937`** (`feat(assets): complete overview, Today integration and final acceptance`, H5) with a **successful** matching Pages run (**#58**). Earlier commits: Projects P4B `6545763`, P5 `47100bc`; Assets H1 `bf2d3d5`, H2 `f101e1b`, H3 `30118dd`, H4 `89ffde9` (run #57). The H5 Modal keyboard safeguard (`src/shell/modalKeys.ts`, 11 tests) is in the H5 commit.
- **Current in-flight:** **Household Services S0 (architecture and integration design) is written and UNCOMMITTED, NOT APPROVED**: `docs/HOUSEHOLD-SERVICES-S0-PLAN-2026-11-06.md`. No code. **S1 is PROPOSED, NOT AUTHORIZED.** Awaiting ChatGPT architectural review and the owner's answers to nine decisions (S0 section 18, each with a recommended "A"). Home & Assets is **not formally closed**: the owner's real-device checklist (H5 report section 17, 14 items) is entirely NOT TESTED and remains tracked.
- **Latest reported test baseline:** **1,629 passing tests across 102 files** (re-run read-only at the start of S0; matches the H5 report). `tsc` and `build` were green at H5 and not re-run in S0 (no code changed). Dexie schema **15**, with no new tables, backup/sync format changes or dependencies through H5; S0 proposes none for Services either.
- **Backlog status:** S0 status added on top; the H5 status heading corrected from "uncommitted" to committed and deployed `4422999` (run #58).
- **Owner expectation:** A new ChatGPT chat should read this file, verify present-day Git/deployment/backlog state, continue from the actual latest phase, review Claude reports, and give explicit commit/push verdicts and ready-to-paste Claude prompts.

## 2. Project goals and user experience

Ledger aims to be one cohesive household system, covering money, planning, activities, projects, possessions, upkeep, service relationships, bills, subscriptions, family coordination, contacts, documents, and eventually useful AI assistance. It is currently designed for one household, not a multi-tenant SaaS.

Design goals:

1. Simple everyday workflows, progressive disclosure, practical utility before complexity.
2. Local-first; data belongs to the household, with explicit controls over what may be shared externally.
3. One source of truth per domain; **link** records across modules instead of duplicating them.
4. Existing deterministic Finance calculations remain authoritative; AI, charts and summaries **must not invent or recalculate balances**.
5. Preserve historical records, deletion safety, backup/restore and synchronization behavior.
6. Desktop and phone (~375px), dark mode, keyboard/accessibility, clear errors, and cautious confirmation for destructive operations.
7. Keep development phased and reviewable; avoid broad refactors, unneeded dependencies, premature platforms/backends.

## 3. Roles and standard development loop

**Owner:** Sets priorities, approves material product decisions, authorizes commits/pushes, performs real-device acceptance. Explain consequences plainly and recommend defaults rather than asking technical questions without guidance.

**ChatGPT:** Product partner, architect, skeptic and reviewer. Drafts detailed implementation prompts for Claude; examines plan/reports against prior decisions and architectural risk; demands tests/evidence; issues explicit **APPROVED TO COMMIT/PUSH**, **APPROVED WITH FOLLOW-UPS**, or **HOLD — FIX BEFORE COMMIT** verdicts. Does not assert it has inspected uncommitted files without receiving them. Makes pragmatic decisions about when AI adds value. May verify committed GitHub repository and Actions when connected.

**Claude:** Works in the user's local repository; reads source and docs; implements only authorized scope; runs tests/typecheck/build and isolated browser checks with invented data; writes detailed dated implementation reports and updates backlog; **does not commit or push until specifically authorized**. Pushing `main` publishes the app; confirm green Actions afterwards.

**Normal workflow** (continue this pattern):

1. Plan/design milestone (when architectural questions are material); one concise recommended decision round if necessary.
2. Owner approves design and ChatGPT provides precise, bounded Claude prompt.
3. Claude builds, tests, documents, **stops before commit**.
4. Owner uploads Claude report to ChatGPT; ChatGPT reviews financial integrity, sync/deletion, backward compatibility, test/browser evidence, risks. Request tightly scoped fixes if necessary.
5. After explicit approval, Claude reruns `npm test`, `npx tsc --noEmit`, `npm run build`, checks working-tree scope, commits/pushes `main`, confirms successful deployment, reports SHA/status.
6. Conduct remaining real-device/offline/backup acceptance. **Refresh this handoff and `docs/BACKLOG.md` as part of every completed phase/release and material architecture decision**, never after the fact only.
7. Do not start the next phase until it is authorized.

**Source-of-truth priority for changing facts:** live source/code and current Git + Actions > most recent completed test/build evidence > latest dated phase report > current backlog > this handoff's last snapshot > old conversation context. For **decisions**, latest expressly approved owner decision takes priority, with deviations documented. If sources disagree, say so and reconcile deliberately; do not silently overwrite history.

## 4. Source map and crucial repo files

Read as applicable:

- `CLAUDE.md` — working rules, privacy constraints, conventions, commands, commit gates.
- `docs/BACKLOG.md` — requested/built/deferred work and decisions; newest summary at top (may have stale status; verify).
- `README.md` — app features and usage.
- `docs/roadmap.md`, `docs/ledger-inventory.md`, `docs/module-hooks.md`, `docs/due-provider.md`, `docs/sync.md` — architecture/interfaces and known limitations.
- `docs/HOME-ASSETS-H0-PLAN-2026-11-05.md` — **Revision 2** approved overall Home & Assets architecture, plus eight owner decisions later confirmed as recommended A choices.
- `docs/HOME-ASSETS-H1-BRIEF-2026-11-05.md`, `docs/HOME-ASSETS-H1-REPORT-2026-11-06.md`.
- `docs/HOME-ASSETS-H2-REPORT-2026-11-06.md` — read **FINAL FOLLOW-UP**, which supersedes some original judgment calls.
- `docs/HOME-ASSETS-H3-REPORT-2026-11-06.md`.
- Projects P1–P5 plan/report documents for specific commitments, reporting or deletion behavior.
- `src/db.ts`, `src/core/store.ts`, `src/core/registry.ts`, `src/modules/index.ts`, `src/lib/sync/*`, `src/lib/txnProject.ts`, `src/modules/projects/*`, `src/modules/assets/*` for actual contracts.

Suggested start of a new chat: “Continue as Ledger's architect and Claude implementation reviewer. Read attached `CHATGPT-HANDOFF.md` first, verify the current repo/backlog/deployment state, follow the working agreement, and help with [current task]. Do not assume the snapshot is current without checking.”

## 5. Architecture invariants

### Local-first and data ownership

- Browser app with IndexedDB/Dexie; version 15 at H3. Cross-module module records (Tasks/Projects/Assets) use the shared `moduleRecords` system; shared `links` point to stable identifiers. No database table or schema change has been needed for Assets H1–H3.
- Backup, restore and encrypted sync work over existing tables; new module-record kinds/fields ride established mechanisms. Sync is generally per-record last-writer-wins, with **narrow deletion precedence** rules for Projects and Assets. The app's plain export is **not encrypted** and can contain sensitive asset data; warn accordingly.
- No passwords, API keys, household exports, bank balances, actual serials/VINs/addresses, or private document links in GitHub docs/tests/prompts; repo is PUBLIC. Use entirely invented fixtures.
- Use existing Contacts records for people/providers, not duplicate vendor lists; existing Task recurrence and Calendar layers for due items; Finance owns transactions/valuations; Projects owns commitments/financial summaries; Assets owns physical assets/service history/warranties.

### Financial integrity

- Money stored in **whole cents**; Finance transaction balances, projects attribution and net worth use existing engines (`src/lib`); read them, don't recreate them in Assets.
- Project spending attribution supports whole and split transactions, budget lines, commitments, change orders and signed values. P4A established multi-line commitments and reconciliation; P4B/P5 integrated reporting and visualizations.
- H3 asset purchase/service expense is **one source at a time**: typed amount *or* refs to one/more existing Finance transaction pieces, never silently both. Switching source requires explicit confirmation; blank cost means unknown, not zero.
- H3 ref shape: `txnId`, optional `splitIndex`, explanatory snapshot `{date,payee,amountCents}`, and for split refs fingerprint of split count, amount, category. Finance splits **lack stable IDs**; changed/missing/removed/moved split refs require review and contribute nothing until reselected; do not use snapshot as live spend. Identical split parts with matching amount/category cannot be distinguished; documented limitation. Whole-transaction refs use current live Finance amount and flag changes.
- Spend totals computed on read; refunds reduce spend, transfers excluded, transaction pieces deduplicated across records and hierarchy. Whole transaction supersedes overlapping constituent split references within the same aggregate. Manually typed amounts cannot be deduplicated by coincidence.
- Project paid-so-far is shown **separately** on assets as context; never add Project paid totals to direct asset spend (avoid double counting). Existing net-worth `properties` stay Finance-owned; Assets may link read-only to one.

### Sync, deletion, history

- Projects permanent deletion: block if financially referenced; cleanup links without erasing Tasks/Events; narrow merge policy resolves stale edits while safeguarding financial dependencies.
- Assets H1: archive vs stored/sold/disposed/replaced status vs permanent deletion are different. Asset deletion uses tombstone/`permanentlyDeletedAt`; deletion wins stale edits unless live dependent child/history/reference needs preserving. `revivedAt` makes intentional backup restoration possible. A completed linked Task and live service/warranty records prevent deletion; H4 verified warranty deletion guards with real sync-engine tests. Replacement links are validated against cycles. Older app builds may lack the special merge rule; real-device testing remains important.
- H2 maintenance plans are **ordinary linked Tasks**. A durable Asset `service` record holds date, kind, work, provider, optional cost, notes, document refs, origin task ID and title snapshot; it remains after task edits/reopens/deletes. "Done, log it" joins Tasks' own `completeTask` with service write in one Dexie transaction; repeat occurrence created once and retains asset link. Task completed elsewhere appears "not yet saved to history" until explicitly logged.
- **H2 final follow-up:** duplicate records created for the same originating task on two offline devices are **preserved** and flagged for human review; no automatic deletion/merge; Undo can restore a record and warning. After-completion repeats use the entered actual service date as basis, while fixed repeats use the normal completion-day basis (no rewriting general Task recurrence).
- Real physical two-device/offline/older-version behavior has **not** been fully acceptance-tested at H3; simulations using the real sync engine are reported. Never conflate simulations with field verification.

### Privacy/UX

- Assets may store optional address, serial/VIN and plate; mask until deliberately shown and do not expose in list titles, Search snippets, Calendar/ICS or Today. Public docs use hypothetical data only. External document references are safe HTTP(S) metadata, not uploaded file storage.
- Rich UI must be accessible and responsive. Tests and 375px browser checks are required; label any unverified visual/keyboard/screen-reader paths rather than claiming success.

## 6. Delivered functionality — historical overview

### Projects P1–P5 — finished and deployed

- P1/P2/P3: project registration, planning and tasks/milestones, budgets/commitments and management workflows; consult detailed reports for exact features.
- **P4A:** agreement allocation across budget lines, change orders, payments/transaction tagging and reconciliation; pushed `1c478e0`.
- **P4B:** safe project permanent deletion, `+project` Quick Add, bulk task project assignment, task/milestone summaries in project list, project labels in Search, project-filtered Finance trends; sync deletion precedence with safeguards for monetary dependencies; pushed `6545763`.
- **P5:** "Where the money goes" segmented expected-cost bar, per-agreement allocations, paid vs left with signed exceptions, neutral/balancing "No budget line", filtered Reports deep link, project-filtered CSV with unchanged unfiltered output; pushed `47100bc`.
- Projects acceptance was **assumed complete by owner** before Home & Assets started; some real-device/offline acceptance tasks remained on the backlog. Treat them as open known risks unless explicitly verified subsequently.

### Home & Assets H0 — architecture

- One generic asset kind (`property`, `area`, `system`, `appliance`, `vehicle`, `other`) with optional parent pointer, specs, contacts, warranty dates, refs and lifecycle. No forced hierarchy; parent link and cycle/depth checks.
- Planned phases H1 registry; H2 maintenance/service records; H3 Finance/Projects linkage; H4 warranties/retirement/replacement/orphan repair; H5 overview/Today/final acceptance. H0 Revision 2 superseded an earlier suggestion to omit deletion-wins policy for Assets.
- Owner confirmed eight recommended “A” defaults (reference rather than mutate Finance, durable maintenance records, restrictive deletion, separate net-worth entries, masked sensitive details, minimal Projects-side integration, editable generic maintenance suggestions, route/name Home & Assets).

### H1 — asset registry (deployed `bf2d3d5`)

- `#/assets`: flat/tree lists; in-use/stored/past/archived filters; asset add/edit with optional make/model/identifiers, acquisition/warranty info, shared Contacts, specs, external document refs; parent hierarchy and validation; links from Tasks/Events; Search and Quick Add prefix `a`; masking; archive/retire/restore and safe permanent deletion; narrow Assets merge rule. H0.5 prerequisites: improved sync conflict labels and plain-backup warning.
- At H1 review: 1,407 tests passing.

### H2 — maintenance and durable history (deployed `f101e1b`)

- Asset maintenance from linked recurring Tasks with editable generic suggestions; atomic "Done, log it"; unscheduled service logs; service-history timeline; "Save to history" for tasks completed elsewhere; provider Contacts, typed costs, refs; service Search and Quick Add `svc`; deletion guards and sync tests. Follow-up: duplicate-warning and historically correct recurring-task basis.
- At H2 final review: 1,464 tests passing.

### H3 — Finance references and Project links (deployed `30118dd`)

- Read-only Finance transaction/split selection for asset acquisition and service records; typed-or-Finance source switching with explicit confirmation; split fingerprint/review; spend summary and parent rollups with piece deduplication; Related Projects and Related Assets cards; Project -> asset prefilled service-record handoff requiring explicit save; read-only net-worth entry pointer. Minimal Projects UI file additions; Finance, Projects financial calculations and sync implementation unchanged.
- At H3 review: 1,521 tests passing, 97 files; `tsc` and build green. Browser interacted with flows using isolated data but **no screenshot visual review**; pending visual/light-theme/a11y, stale ref replacement, handoff Save, unlink/Undo, refund UI, real phone/two devices/offline.
- GitHub verified H3 pushed/deployed on 2026-11-06, even though H3 report and top backlog status were written before commit.

### H4 — warranties and lifecycle (deployed `89ffde9`)

Report: `docs/HOME-ASSETS-H4-REPORT-2026-11-06.md` (final follow-up 2026-11-06). Built atop deployed H3 `30118dd`. **At H4 final review: 1,586 passing tests across 100 files**, TypeScript and production build clean; Dexie 15; no Finance/Projects/Tasks/Contacts source modifications or backup/sync format changes. Committed and pushed as `89ffde9`; Pages run #57 succeeded.

- Multiple durable warranty records with shared Contacts and safe document links; H1 simple warranty fields act as **implicit fallback** only when no live explicit warranty exists. Deleting last explicit warranty prompts whether to clear legacy fields; no silent deletion.
- Fifth read-only Calendar layer `9_000_000_000_000_105` derives warranty expiration markers. Stored and active assets show markers; archived/sold/disposed/replaced do not; expired markers are informational, not overdue. Maintenance reminders stay Tasks-owned.
- Atomic asset replacement with existing/new asset and review step; new asset gets only name/type/place, never copied sensitive identifiers or history. Existing service/financial/warranty/Projects history remains with old asset.
- Previewed retirement/bulk retirement of property descendants; open tasks explicitly Keep linked (default), Move, Stop repeating or Delete. A shared Task's **Delete** choice now warns it will be deleted for all linked assets; this was the final follow-up fix, covered by a focused test.
- Past-asset navigation, replacement links, orphan service/warranty/link detection and explicit re-home/clear/remove handling; protects absent-on-this-device sync cases.
- Real sync-engine tests cover warranty versus deletion, replacement conflicts, orphan repair and backup revival. **Actual two-device/real-phone/offline and complete keyboard/screen-reader testing remain outstanding**.
- Known limitation: simultaneous independent replacement on two devices may leave both created replacement assets, only one referenced as successor; other can be archived. Last writer wins per record. Other outstanding browser checks include some warranty editing/document rows, Undo, Stop repeating/Delete actions and shared-delete warning display.
- **Handoff procedure:** installed 2026-11-06 (`docs/CHATGPT-HANDOFF.md`, rule appended to root `CLAUDE.md`; `docs/CLAUDE-HANDOFF-SOP.md` kept as the source text) and committed with H4.

### H5 — overview, Today and acceptance (COMMITTED AND DEPLOYED `4422999`, Pages run #58; real-device acceptance NOT DONE)

Report: `docs/HOME-ASSETS-H5-REPORT-2026-11-06.md` (including its final follow-up, the Modal keyboard tests). Built on deployed H4. **1,629 passing tests across 102 files**, `tsc` and build clean; Dexie 15; no Finance, Projects, Tasks, Contacts or Calendar source edits; no schema, backup or sync change.

- `#/assets` now opens an **Overview** (Needs attention, Upcoming maintenance, Warranties ending soon, Recent service history, Spending on assets); the list is "All assets" at `#/assets/list`. One read-only reader (`overviewData.ts` → pure `overview.ts`) feeds both the page and the Today card; nothing is stored. It reuses Tasks' `isOverdue`, H4's `warrantyStatus` (60 days) and `effectiveWarranties`, H2's `unsavedTasks` and `duplicateTaskGroups`, H4's `detectOrphans`, and H3's `spend()` unchanged.
- Spending: household total counts each payment once; a year narrows by each piece's own date (Finance payment by transaction date, typed cost by service/purchase date, undated typed costs only under All time); per-property rows can exceed the household total when one payment is linked in two properties (stated on screen); unknown cost is never $0; stale references are left out and counted; project money is never included.
- Today card `assets.attention`: counts only, half width, hides when empty, no names/amounts/identifiers, does not list maintenance tasks (Tasks already do).
- Archived and sold/disposed/replaced assets raise no attention (same rule as Calendar warranty markers); their history and spending still count.
- Shared `shell/Modal.tsx` now keeps Tab inside the topmost dialog (found in the accessibility review); the logic is `shell/modalKeys.ts` with 11 tests (review follow-up).
- **Not verified:** real screen reader, real phone, second device, offline reload, older build. All remain **NOT TESTED** in the report's owner checklist.
- AI-readiness assessment (report section 14): no new interface is recommended yet; `loadOverview` and the pure readers are already a small read-only context surface.

### Household Services S0 — design (REVISION 2 WRITTEN, UNCOMMITTED; architecture approved in principle, Q1–Q9 accepted as planning defaults, final review pending; S1 PROPOSED, NOT AUTHORIZED)

Document: `docs/HOUSEHOLD-SERVICES-S0-PLAN-2026-11-06.md` (section 0 lists every Revision 2 change). Design only; no source change. **Revision 2 refinements (from ChatGPT's review):**
- **Scheduling authority:** arrangement owns the intended cadence (with `anchorDate`); the Task executes it. A reschedule moves one visit only; the standing cadence changes only via "Change schedule". At "Done, log it" (S2) Services sets the next due date from the cadence anchor via `generateDates` (no second engine). Drift (`scheduleHealth`) is detected and fixed only by explicit previewed choices. `ensureNextVisitTask` guarantees at most one open Task through pause/resume/replace; cross-device duplicates are detected, not auto-deleted. A timed visit is the Task with `dueTime`; no Calendar event in S1/S2. Regression lists in plan 6.10.
- **Visits:** completed, skipped and cancelled are distinct; cancelled visits can carry a fee (`chargeKind`) and a payment but are never service delivered; a Finance payment never proves work occurred.
- **Privacy:** no provider `accountNumber` in S1 (deferred); no codes, passwords or bank instructions in notes.
- **Household total:** `householdHomeSpend` specified in plan 7.6 (each linked payment once; whole supersedes parts; `recorded-as` pair rule; typed amounts never matched by value; shared payments never apportioned; never an allocation; no Finance change).
- **S1 scope:** arrangement-to-asset linking from the Services UI only; reverse Home & Assets UI is S4; S1 touches nothing under `src/modules/assets`.

Original model, still in force except where the above refines it:

- Provider = an ordinary shared **Contact** (no provider record; primary contact plus extra contacts; business-name snapshot). Two new `moduleRecords` kinds in module `services`: **arrangement** (standing relationship, cadence, expected cost, documents) and **visit** (created only when a visit is finished, skipped or cancelled; one-off visits need no arrangement). **No new table, schema stays 15.**
- Scheduling reuses Tasks: the arrangement stores the cadence; one linked recurring Task is "the next visit"; a Calendar event only for timed appointments. Skip/cancel are visit statuses; "Done, log it" is atomic with `completeTask` (H2 pattern). Seasonal ("April to October") needs a small optional wrapper in Services or a yearly-reminder fallback; Tasks and core recurrence are not changed.
- Money: H3-style read-only Finance references (`TxnRef`, `pieceKey`, live amount, split fingerprint); expected, quoted and charged amounts are labelled and **never counted as spent**; typed amounts only for "paid outside Finance"; one household-union helper de-duplicates by `pieceKey` (S5). Project money is shown beside, never added.
- Provider change = **successor arrangement**. History is preserved: no deletion-wins rule, no `merge.ts` change; arrangements with visits cannot be deleted; orphans repairable.
- Boundaries: maintenance of a thing -> Home & Assets (explicit prefilled "Record in Home & Assets", saves only on Save, `recorded-as` link); defined scope and budget -> Projects; subscriptions, bills and scheduled payments -> Bills & Subscriptions (Services never posts or schedules payments).
- Proposed phases (not authorized): S1 arrangements + provider page + next-visit Task; S2 visits and Today card; S3 Finance; S4 cross-module workflows, renewals and a sixth Calendar layer (`..._106`); S5 overview, insights, acceptance.
- Awaiting: final review of Revision 2 (Q1–Q9 accepted as planning defaults). Quick Add prefix `hs` proposed (`svc a b p t e $` are taken).

## 7. Post-H5 product roadmap (recommended, not rigid)

1. **Household Services** — S0 design written (above); S1 proposed, not authorized. Ongoing cleaner, landscaper, pest-control, service-contract relationships; provider, schedule, rates, visits, history; reuse Contacts/Tasks/Calendar/Finance/Assets; distinguish ongoing relationship from an individual Asset service event.
2. **Bills & Subscriptions:** enhance existing Finance scheduled payments into obligations, renewals, price changes and cancellation reminders; consider shared architecture with phase separation.
3. **Family Management:** household member context, school/childcare calendars, family activities and responsibilities; reuse Tasks, Calendar, Contacts.
4. **Personal CRM:** extend shared Contacts with relationship notes, interactions, important dates and follow-ups; no duplicate contact database.
5. **Documents:** shared record metadata and links initially, evaluate file storage, encrypted sync/backup impact separately.
6. **AI assistance and automations** as cross-cutting capability; see next section. Reassess priorities at each module gate. No requirement to complete every module before useful AI.

## 8. AI strategy — standing architectural direction

**Owner delegated to ChatGPT** the technical judgment of **where/how to introduce AI** and wants plain-language recommendations; **not** blanket authorization to send data externally or build an AI backend without a review.

- **H4:** do not expand H4 scope for AI; finish warranties/lifecycle correctly.
- **H5:** identify structured, permission-safe readers and potential insights; no chat integration required.
- **S0 (Household Services design) preserves this sequence:** deterministic insights only (S0 section 14), a name-only read-only reader modelled on H5's `loadOverview`, no AI interface in S1–S5, figures only from `spend()` and the household union, no phone/email/amount/URL/notes in any future AI context by default.
- **Household Services and Bills/Subscriptions:** add useful deterministic insights (maintenance due, upcoming payments, renewals, cost changes) without unnecessarily paying for an LLM. Label these "insights" rather than pretending they require AI.
- **First “Ask Ledger” conversational capability** likely after Services and Bills/Subscriptions reach stable form, earlier if justified. Let user ask household questions; resolve money/date facts with Ledger's established readers/calculation engine, using a model only to interpret/summarize.
- **Actions later:** proposals for task creation, categorization, service logging, etc. should show exact preview and require user confirmation. Deletion, purchases, high-stakes actions require stronger safeguards.
- **Proactive assistance** last: weekly briefings, reminders and permitted monitoring, with bounded scope, user controls, no surprise writes.
- **Security:** local-first, minimal selected data sent only with explicit controls. **Do not embed external AI API credentials in browser/client code.** Evaluate a small authenticated proxy/backend or secure alternative before external-model use, with a specific architectural approval covering privacy, operating cost, prompt injection and per-action permissions. No automatic sharing of whole household backups with a model.
- All AI findings are aids, not authoritative ledger postings or legal/tax/medical claims.

## 9. Known unresolved risks / acceptance work

- Real two-device sync and offline operation, including deletion vs stale edits, replacement/service/warranty conflicts, and older build compatibility — automated engine simulation is not a physical device test. **Still NOT TESTED at H5** (owner checklist in the H5 report). H4 shared Task deletion warning was unit-tested but not browser-tested.
- **Intermittent test:** `src/core/core.test.ts` "queries and tells you when something changes" (fixed 100 ms wait) failed once in ~9 full runs; pre-existing; not fixed; treat a single failure there as suspect before blaming a change.
- H5: no real screen-reader pass; transaction picker and some form controls are 40 px tall (under the 44 px touch target); Escape in the picker closes the whole form; the "saved twice" warning is shown on the asset page but the Overview only counts it.
- H3 visual screenshot review (both themes), complete keyboard/screen-reader testing, handoff Save, stale transaction ref reselect, refund picker rendering, links/Undo, real phone.
- Split fingerprint limitation: indistinguishable identical amount/category split parts; changes elsewhere in split structure may require review.
- Whole-record last-writer-wins means concurrent edits to different fields can overwrite one another; losing versions may surface as conflict notices.
- Plain backups reveal sensitive details; no binary document storage. Do not accidentally put private data in public repo or tool output.
- Historical Tasks completed before H2 may appear as “not yet saved” until logged; no bulk dismiss/save yet.
- **Household Services design risks (S0 section 17):** seasonal schedules unsupported by Tasks; rescheduling a weekly Task may shift later weekdays and every-other-week parity (read from code, NOT executed; S1/S2 tests must confirm); no Contacts screen and no company/archive field on Contact; two devices finishing the same repeating Task create two "next" Tasks (existing Tasks behaviour); one payment cannot be apportioned across visits; typed amounts have no de-duplication key; `spend()` and `txnRef.ts` need a small test-protected extraction in S3.
- Avoid building duplicate financial engines, calendar events, task recurrence or vendor lists.
- Keep backlog and handoff accurate after **commit/deploy**, not merely after implementation reports. Never mark draft/plan features as built.

## 10. Standing Operating Procedure — maintaining THIS handoff

**Target file:** `docs/CHATGPT-HANDOFF.md` in the user's local repo. **Update owner:** Claude working locally, or another tool with actual repo write access. ChatGPT can compose a replacement and review it; **ChatGPT cannot continuously or automatically modify the user's Windows directory from an ordinary chat**. Do not claim to have done so. The repository instruction in `CLAUDE.md` should direct Claude to update it routinely.

### When to update (mandatory checkpoints)

- After **every** approved architecture/design decision, changed user preference, phase boundary, material blocker, resolved issue, or change to long-term roadmap.
- At the **end of every Claude implementation/report batch**, update current phase status and tests, but mark **uncommitted** until explicitly committed.
- **After each commit/push and Actions completion**, refresh actual SHA, deployment state, newest test baseline and next step; don't leave “not pushed” status once deployed.
- Before handing off to a new ChatGPT chat, ensure the document reflects actual `main`, in-flight uncommitted work, current pending decision and exact next action.

### Maintenance procedure (for Claude/local agent)

1. Read `CLAUDE.md`, current handoff, latest backlog, recent phase report and `git status`/`git log`; when possible check deployment status. Verify facts, including whether files are local-only.
2. Update **Section 1** (snapshot/next action/test baseline/SHA), **Section 6** (phase delivery status), **Section 7** (roadmap), **Section 8** (AI direction), **Section 9** (open risks), and record material newly approved decisions in the appropriate section. Add a short dated update line in Section 11. Keep invariant sections stable unless consciously changed.
3. Preserve accurate architectural detail while pruning duplicate wording; link to full reports rather than copying long logs. Distinguish `planned`, `implemented but uncommitted`, `committed`, `deployed`, `accepted` and `not verified`.
4. Never embed actual data or secrets; audit the diff for accidental PII. Maintain plain Markdown, relative paths and public-repo compatibility.
5. Update `docs/BACKLOG.md` consistently; resolve contradictory top statuses. Neither file overrides tested code/Git. Ensure the handoff accurately reflects decisions made in ChatGPT **when they are explicitly supplied to Claude**.
6. **Include the handoff in the same reviewed change set as the relevant phase**; do not create a separate commit/push without authorization. If a deployment SHA isn't known until after push, update it in the next authorized documentation change or keep a labeled “verification pending” entry; avoid an unauthorized follow-up push solely to stamp a SHA.
7. In the final implementation report, include: `Handoff updated: yes/no`, what sections changed, outstanding items, and any difference between local docs, committed GitHub and deployment.
8. If no repo-write tool is available, prepare a complete Markdown replacement or patch and ask the owner to have Claude apply it. Do not claim the local file has changed.

### For ChatGPT in each future conversation

- Read the latest uploaded/accessible `docs/CHATGPT-HANDOFF.md` at the start of Ledger work. Cross-check current Git status and backlog where accessible. Do not infer access to the user's uncommitted Windows files.
- During ordinary architectural reviews, recommend exact handoff updates to include in Claude prompts. ChatGPT cannot guarantee updates in conversations it is not running.
- When a phase reaches implementation/review, explicitly require handoff maintenance in the Claude prompt and check the report says it was done.
- If user asks to “update the handoff,” produce the revised artifact or an actionable repo-local Claude prompt **now**, rather than promising invisible background edits.

## 11. Change log for handoff itself

- **2026-11-06 (S0 Revision 2, by Claude):** applied ChatGPT's five refinements (scheduling authority, cancelled-visit fees and payments, no `accountNumber`, full `householdHomeSpend` spec, S1 one-way asset linking); recorded Q1–Q9 as accepted planning defaults and Revision 2 as awaiting final review; S1 still proposed, not authorized. No code, no test run. Handoff updated: yes. Nothing committed.

- **2026-11-06 (Household Services S0, by Claude):** verified H5 `4422999` pushed and Pages run #58 green; recorded H5 as committed and deployed (it had said uncommitted); preserved the 14-item real-device checklist as NOT TESTED; recorded S0 design as written, uncommitted, NOT approved, S1 proposed not authorized; added decision/risk/AI notes. Baseline `npm test` re-run: 1,629 passed, 102 files. Handoff updated: yes. Nothing committed.

- **2026-11-06 (H5 batch, by Claude):** verified H4 `89ffde9` pushed and Pages run #57 green; marked H4 deployed; recorded H5 as built and tested locally (1,618 tests), uncommitted; refreshed snapshot, phase status, risks, next action. Handoff updated: yes. Nothing committed at that point.
- **2026-11-06 (installed by Claude):** handoff and `CLAUDE.md` rule installed locally; backlog H1-H3 statuses reconciled to deployed; H4 final state recorded (1,586 tests, shared-task delete warning, pending commit). Handoff updated: yes. Nothing committed.
- **2026-11-06 (H4 final follow-up):** Revised snapshot to reflect H4 locally implemented, shared-task deletion warning fixed, 1,586 passing tests and H4 pending commit. Identified missing on-disk handoff and root SOP as remaining gate; prepared the original SOP again for Claude installation.
- **2026-11-06:** Initial handoff composed from the Ledger conversation and verified public GitHub commits/Actions; confirmed H3 `30118dd` deployed; H4 detailed prompt drafted but no implementation evidence. Established the maintenance SOP and AI staged strategy. **This file has been created as a downloadable artifact; it is not automatically present in the user's Windows repo until copied there.**

---

**Next action as of 2026-11-06 (end of S0 Revision 2):** ChatGPT does the final review of `docs/HOUSEHOLD-SERVICES-S0-PLAN-2026-11-06.md` Revision 2 (Q1–Q9 already accepted as planning defaults). If the plan is approved, the owner authorizes committing the three S0 documents (plan, backlog, this handoff) and, separately, an S1 build prompt. No S1 work until then. In parallel and independent of code, the owner can work through the H5 real-device checklist (all 14 items NOT TESTED) so Home & Assets can be formally closed.
