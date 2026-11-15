# Ledger R0: product assessment

**Date:** 2026-11-14. **Author:** Claude (local analysis assistant). **Status:** PLANNING ONLY. No production code, test, schema, dependency, hosting setting or stored data was changed. Nothing was staged, committed, pushed or deployed. Every recommendation here is a **proposal awaiting owner and ChatGPT review**; none is an approved decision.

Companion document: `docs/LEDGER-R0-STRATEGIC-ROADMAP.md` (ranked opportunities, scoring, phases, executive summary, next-phase brief, backlog reconciliation).

**Privacy:** this file contains no real household data. Every example is invented or generic.

**How to read the labels.** **[Fact]** was read in source, a test or Git/Actions output, or measured in this session. **[Reported]** comes from a phase report or the handoff and was not re-checked here. **[Hypothesis]** is my judgment about how a household would experience something. **[UNVERIFIED]** could not be confirmed.

---

## 1. Baseline (verified first)

| Check | Result |
|---|---|
| Branch / HEAD / origin | `main`, `HEAD` = `origin/main` = `29c80e1d3d5705262b6169d23634a23172901a29` (`feat(ui): make Ledger Signature the universal appearance`) after `git fetch` **[Fact]** |
| Was D21.1 released? | **Yes.** The release commit contains the D21.1 change set and the final Calendar contrast correction (`src/modules/calendar/calendar.css`, `d211CalendarContrast.test.ts`). Actions run **#115** ("Deploy to GitHub Pages") for that exact SHA: `completed` / `success`, created 2026-11-14 05:38 UTC, read from the public API (`gh` is not installed). Run #114 (`582ce64`, D21) also succeeded **[Fact]** |
| Working tree | Only the three protected untracked files: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`. Untouched **[Fact]** |
| Implemented-but-unreleased code | **None.** Everything in `src/` is deployed. The handoff and backlog top notices still say the D21.1 SHA is "not known"; that is stale and is corrected by this batch **[Fact]** |
| Type check | `npx tsc --noEmit`: clean **[Fact]** |
| Tests | `npx vitest run`: **289 files, 5,680 tests, all passed**, 122 s **[Fact]** (matches the D21.1 report) |
| Build | A scratch build (output folder outside the repo): entry chunk **887 KB** (277 KB gzipped), Ledger screens 693 KB (186 KB gz), Bills 228 KB, shared components 183 KB. At ST-S5 (2026-11-09) the entry was 711 KB and Ledger 579 KB: **about +25% and +20% in five days** of module and design work. The 500 KB chunk warning is still present **[Fact]** |
| Size of the app | About 77,000 lines of non-test TypeScript, 289 test files, Dexie schema **version 15**, 11 registered modules (`src/modules/index.ts`) **[Fact]** |
| Acceptance state | `docs/UI-COVERAGE.md` tracks 163 surfaces: **about 140 `BLT` (built) and 23 `NS` (not started); none `ACC` (accepted).** No real phone, second device, screen reader, forced-colors, Safari or Firefox check is recorded for any phase since stabilization **[Fact/Reported]** |

**Evidence limits of this assessment.** I read the handoff by section (its lines are very long; I read the snapshot, invariants, roadmap, AI strategy and risk sections plus the change-log head, not every historical phase paragraph), the backlog's status entries, the UI tracker, the stabilization reports, the README, the module-hook docs, and the source for the readers and registries cited below. I did **not** run the app in a browser for R0 and I did not walk every screen. Statements about "what users can do" therefore rest on code, tests and reports, not on observed screens. Real-world usefulness claims are hypotheses.

---

## 2. Capability inventory

Status words: **Deployed** (in `main`, tests pass), **Incomplete** (works but a documented workflow is missing), **Planned** (written down, not built), **Possible** (my idea). "Accepted" is never claimed: nothing is owner-accepted on a real device.

### 2.1 Today and the unified household overview

- **What it does [Fact].** Opens by default. A fixed top ("Next up" bar and status band, `src/modules/today/todayModel.ts`, `TodayHero.tsx`), a wide agenda column (Today, Reminders due, Overdue for 30 days, Coming up for 7 days; `composition.ts` `AGENDA_IDS`), and a supporting column: Ledger "Needs attention" and "Cash outlook" plus a grouped **"Household status"** section holding five separate cards (Bills, Household finances, Home & Assets, Household Services, Projects; `STATUS_GROUP_IDS`). Seven modules feed dated items through due providers (`src/modules/{assets,bills,family,ledger,projects,services,tasks}/dueProvider.ts`). Hide Amounts, layout editing, per-card hide, an error boundary per card.
- **Strengths.** One source for dated items (`TodayDataProvider`, read once, sliced by cards; the band can never disagree with the cards, `todayModel.ts` header). Counts-only household cards avoid putting names, money or private details on the screen. Cards hide when empty.
- **Gaps.** (1) **There is no single ranked "what needs me" list.** The exceptions live in six places with six vocabularies: Ledger alerts (15 kinds, `src/lib/alerts.ts`), Assets `Attention` (`assets/overviewData.ts`), Services needs-attention (`services/servicesOverview.ts`), Bills Needs review (`bills/ReviewPage.tsx`), Household finances review (`household/review.ts` `householdReview`), Projects (`projects/todayLogic.ts` `projectAttention`). Grouping them visually (D13.1) helped, but the owner still scans up to seven cards. (2) The Projects card looks at overdue milestones, tasks and target dates; it cannot mention a project over budget **[Fact: the card loads only projects and tasks (`projects/todayCards.tsx`), never transactions; budget status lives in `projects/financialView.ts`]**. (3) No Family card by design (F4 judgment call). (4) Today ignores Calendar layer visibility (documented, F2). (5) Hide Amounts does not cover Ledger Home or Budget (UX-01, decided).
- **Integrations.** Everything. This is the best-connected screen.
- **Limits.** Not real-device tested. Phone page length was flagged at D15/D16.
- **Further investment justified? Yes**, but as *consolidation of what exists*, not new cards (see roadmap R1).

### 2.2 Calendar and scheduling

- **Deployed [Fact].** Month, Week, Work week, Agenda; events with repeats, reminders, priorities, tags, people, linked records; layers from the seven due providers; "Layers" menu with Select all / Deselect all (F2.1); event types (bill, finance date, birthday); `.ics` export (`src/modules/calendar/ics.ts`, `src/lib/calendar.ts`) with a one-day `VALARM` for events.
- **Strengths.** Derived items are computed, never copied; recurrence is one engine (`src/core/recurrence.ts`); D21.1 fixed Calendar contrast with a measured test.
- **Gaps.** The `.ics` export covers events and the Finance layer only. **The Family layer is not in it and has no alarm** (F2 open item); Bills, Services, Projects and Assets layers are not exported (a deferred item in the stabilization disposition). Layer visibility, last view and agenda range are **device-only and not in backups (BK-03, owner decision never made)**. A new user calendar may stay hidden while a subset is selected (documented F2.1 behavior).
- **Friction.** An export is a snapshot; a phone calendar that imported it goes stale. There is no subscription without a server.
- **Investment?** Small, targeted (richer export; BK-03 decision). Not a redesign.

### 2.3 Tasks and reminders

- **Deployed [Fact].** Shorthand quick-add, Today/Upcoming/Overdue/All and more views, lists, tags, checklists, repeating tasks (the shared recurrence engine), bulk actions, links to projects, assets, arrangements and bills. Modules create **ordinary Tasks** for their obligations (maintenance plans, next service visit, bill reminders), which is why household chores appear on Today and Calendar with no extra code.
- **Strengths.** Tasks are the one reminder substrate; every module reuses them, so there is no second reminder system to maintain.
- **Gaps.** **Nothing ever reaches the owner outside the app.** There is no notification code anywhere in `src/` (a search for `Notification`, push and badge APIs found nothing). A reminder works only if the owner opens Ledger. Family member chips on task rows were not built (D11 open item). The backlog still lists a 320 px Task-editor overflow as open while U1 reports it fixed: reconcile **[Reported]**.
- **Investment?** Only the delivery question (section 4B).

### 2.4 Household Finances: transactions, accounts, budgeting, recurring, reconciliation, importing

- **Deployed [Fact].** Accounts, per-account ledger with splits and transfers, all-account Transactions with filters and CSV export, envelope Budget with targets, Scheduled items approved before posting, statement **reconciliation** (`src/lib/ledger.ts`: compare statement balance with cleared activity, lock as reconciled), payee **Rules**, detected and suggested rules, monthly **Check-in**, **CSV import** with duplicate protection and per-batch undo (`src/lib/csvImport.ts`).
- **Strengths.** The engines are the product's backbone: whole-cent math, `spend()` (`src/modules/assets/spending.ts:90`) as the one spending reader, dependency-aware deletes (`src/lib/txnDeletion.ts`), and **157 financial golden-master tests** that ST-S5 re-ran unchanged **[Reported]**.
- **Gaps (the money-intake chain).** Import is CSV only: **no remembered column layout per account** (`ImportPage.tsx` re-detects every file), **no OFX/QFX**, no paste-in, no review queue. These were Wave 1 items A and C in `docs/roadmap.md` (2026-11-02) and were never built because the household modules took priority **[Fact: no `importMappings` key, no OFX parser in `src/`]**. The owner chose manual CSV over bank feeds on 2026-10-20 (SimpleFIN Bridge "maybe later"); that decision stands, and a better CSV workflow is consistent with it. Rules are creation-time and payee-contains only (no order, amount criteria or split actions). Non-atomic deletes remain: NC-18 (remove a holding: lots then holding), NC-19 (delete an investment account: holdings then account, **tax lots of those holdings are not removed**), NC-22 (delete a property: values then property) are each two separate database awaits with no transaction (`docs/LEDGER-SIGNATURE-D20.1-OD6-INVENTORY.md` lines 92 to 96). Three native `alert()` calls remain (`src/pages/CategoriesPage.tsx:90`, `bills/quickAddDef.ts:128`, `services/quickAddDef.ts:75`).
- **Integrations.** Finance is the payment source of truth for Bills, Services, Assets and Projects through `txnRef.ts` references; each module contributes a read-only `txnReferences` reader so deletes can warn.
- **Investment?** Yes, narrowly: import layout memory, the atomicity fixes, and link suggestions at import time (roadmap RS-1, R2).

### 2.5 Income, paycheck, tax, investments, retirement, projections

- **Deployed [Fact].** Per-person Income workspace (D18.1) with a gross-to-net statement (D18.2), RSU grants and vests, `paycheckCalc.ts` scenarios, tax planning (year-end, safe harbor, harvesting), Roth planner, Giving, Tax package, investments with tax lots and HSA, net worth with history, debt and payoff, retirement and projections on a Monte Carlo engine whose asset-class returns are compound and converted by `lognormalFromGeometric` (`src/lib/projection.ts`).
- **Strengths.** Deep and test-guarded; 2027 tables built (`src/data/taxYears.ts`); forecast and alerts read the same engines.
- **Gaps and known money-logic items.** (1) **The 2026 Massachusetts surtax threshold in code is $1,083,150** (`taxYears.ts:132`), which the T2027 report confirmed against the state revenue page is the **2025** figure; 2026 is $1,107,750 (the 2027 block already carries that number as a labelled placeholder, line 230). Impact: only households above about $1.08M of Massachusetts taxable income, overstated by at most about $984. **The owner has not yet decided** whether to correct it. (2) Roth IRMAA/ACA 2027 inputs remain labelled carry-forwards. (3) The January table update is a manual annual chore, mitigated by the old-table warnings added in T2027 **[Reported]**. (4) Social Security claiming and survivor scenarios, broker lot import and whole-plan scenarios are on the "not selected for now" list (`docs/BACKLOG.md` line 2379).
- **Investment?** Maintain, do not expand. One decision (the surtax constant) is overdue. A survivor-scenario tool is a plausible later design item but needs verified law and is not recommended before the product work in the roadmap.

### 2.6 Family Management

- **Deployed [Fact].** Household members as small records pointing at one shared Contact (no new table), birthdays and important dates feeding a Family Calendar layer, member schedule / to-do / projects / important contacts, a household overview, Search and Quick Add (`fam`, `fd`), a color and identity system (D9).
- **Strengths.** The person model decision (member → Contact id) is clean and sync-safe; masking rules for notes and birth year.
- **Gaps.** The F0 plan promised **one pure "family view" reader with an `audience` parameter** so a future tablet could use a safe subset; **that parameter and reader do not exist in the code** (a search for `audience` finds nothing in `src/`). Member colors do not appear on Calendar, Tasks or Today rows (D9 open item). No Today card (F4 call). No Family dates in `.ics`. [Hypothesis] Value depends on whether the household has children or dependants with schedules; the repository deliberately holds no family details.
- **Investment?** Moderate, as small "lenses" (section 4C), not a new module.

### 2.7 Contacts & Relationships

- **Deployed [Fact].** Central directory (A to Z, search, recently changed, same-name markers), safe editing, Spouse and "This is me", "where used" across modules via each module's `contactReferences` reader, guarded removal, creation-identity safety (U2, `src/core/contactIdentity.ts`). 762 non-test lines carrying 13 test files: heavily guarded.
- **Gaps.** A Contact is `name`, `relationship`, `notes`, `phone`, `email` only (`src/core/entities.ts:17`). No company, address, tags in the UI, or interaction history. C3 (interaction notes, follow-up tasks) is **not built**.
- **Assessment.** For one household, the existing "where used" view already answers the practical question ("which providers do we use, and for what?"). **A compelling Personal-CRM use case is not evident.** Recommend keeping C3 deferred indefinitely unless the owner names a concrete need (section 4E).

### 2.8 Projects

- **Deployed [Fact].** Status, dates, budget or budget lines, multi-line commitments, change orders, vendors (shared Contacts), milestones as flagged Tasks, linked events, Finance transaction tagging (whole and split attribution), financial dashboard and reporting (P2 to P5), Calendar layer and Today card, Quick Add `p`.
- **Strengths.** The most careful money modelling after Finance: split attribution, signed values, `PROJECTS-MULTILINE-COMMITMENT-DESIGN.md`.
- **Gaps.** No "projects over budget" surface outside the project page (Today card ignores budget; `financialView.ts` has the numbers). Completed projects can open a prefilled asset service form (good); no equivalent for a Services arrangement.
- **Investment?** One small attention-reader addition; otherwise leave.

### 2.9 Home & Assets

- **Deployed [Fact].** Asset tree, maintenance plans as linked Tasks, durable service history, "Done, log it", several warranties per asset, lifecycle (sold, disposed, replaced, stored), cost from typed amount or Finance references (one source at a time), Project links, an Overview (needs attention, upcoming maintenance, warranties ending, spending for a chosen year), a counts-only Today card, Quick Add `a`/`svc`.
- **Gaps.** No expected-replacement-cost field (so no capital plan; B5 notes "Home & Assets adds no commitment"). Documents are links only. Finished-but-unlogged maintenance has **no bulk dismiss or save** **[Reported]**.
- **Investment?** Small: a finish-the-loop prompt (section 3), and optionally an expected-cost field later.

### 2.10 Household Services

- **Deployed [Fact].** Providers are Contacts; arrangements with cadence (the engine handles every-other-week parity), next visit as a Task, visits done/skipped/cancelled with Undo, cross-module handoff to asset service history, renewal and notice dates on Calendar and Today, an Overview with period spending and `buildInsights` (seven deterministic kinds: trend, expected, unusual, gap, skips, moves, handoff; `src/modules/services/insights.ts:121`).
- **Gaps.** No seasonal schedules; a per-visit payment cannot be apportioned; duplicate visits are flagged, never resolved; estimate units other than monthly are "not known" in windows (O-18). Payment linking is manual, while Bills has suggestions (section 3).
- **Investment?** Leave, except reusing Bills' matcher.

### 2.11 Bills & Subscriptions

- **Deployed [Fact].** Obligation registry with dated schedule revisions, billing occurrences and due dates, reminder Tasks and a Calendar layer, Finance payment links under a one-source rule, discovery from repeating payments, payment-match **suggestions** (never automatic), lifecycle (trial, renewal, cancellation evidence, price history), the Services link, Quick Add `bs`.
- **Gaps.** B3.2 (create a Finance Scheduled item from a bill) not built and needs owner approval to touch a Finance page. **There is no link from an annual or irregular bill to Budget**: a search of `src/modules` finds `budgetTargets` only in a guard test. Bills do not feed the cash Forecast unless the owner links a Finance Scheduled item (by design in B0, to avoid double counting).
- **Investment?** Yes, via a read-only "year ahead" view and **optional** Budget-target suggestions (roadmap R3). Defer B3.2.

### 2.12 Household Finances consolidated overview

- **Deployed [Fact].** `#/household` (module `household`, `src/modules/household/`): recorded spending as a union across Bills, Services and Assets with each Finance piece counted once (`unionSpend.ts`, `b5-golden-master.test.ts`), commitments for 7, 30, 90 days and 12 months kept apart from spending (`commitments.ts:213`), a review list (`review.ts:38`), Today card, Services "Related bill" card.
- **Strengths.** The cleanest reader in the app: pure functions over resolved pieces, read-only fingerprint tests. **It is the best foundation for any future question-answering.**
- **Gaps.** Not in Search or Quick Add beyond a page link (O-19). Excludes Finance-only items (loans, taxes, scheduled payments) and Projects commitments, so "what should I prepare for?" is only partly answered.
- **Investment?** Yes, extend it (roadmap R3).

### 2.13 Documents and stored references

- **State [Fact].** Documents are **link-only metadata**: a label and a safe HTTP(S) URL (`src/lib/safeUrl.ts`) on assets, service records, arrangements and bills. The shared `Attachment` entity and table exist but are a stub (`storage: 'none'`, `src/core/entities.ts:41`). **Three modules each validate their own document references** (`assets/validate.ts`, `bills/util.ts`, `services/model.ts`, all through `safeUrl`); whether the three shapes are identical was not compared. There is no central index, no kind (warranty, receipt, contract, insurance), no expiry, no "where is the paper copy" field. Printable documents exist (Guide "If something happens", Tax package, Year in review). Whether Search indexes document labels: **[UNVERIFIED]**.
- **Assessment.** See section 4D. File storage is **not recommended**.

### 2.14 Search, Quick Add, navigation and global workflows

- **Deployed [Fact].** Every module registers a search source (11; the matching code is pure and tested), grouped by module; Quick Add accepts typed shortcuts with a "Will add" preview before saving (`t`, `e`, `$`, `b`, `p`, `a`, `hs`/`svc`, `bs`, `fam`, `fd`); grouped module selector (N1), Ledger group bar (D8), a phone tab bar; skip link and route announcer.
- **Gaps.** Quick Add does not prefill typed text for some destinations (F5 item 3); Household finances is not searchable; there is no "answers" or action layer in Search; discoverability of 11 modules and ~33 Ledger pages is unmeasured **[Hypothesis]**.

### 2.15 Settings, appearance, backup, restore, device synchronization

- **Deployed [Fact].** Five Signature palettes plus custom themes (D21.1), plain and encrypted backups of everything, weekly automatic encrypted copies to the private repository, sync as one encrypted file with record-level merge, every overwritten edit saved (SY-01), unknown tables passed through (ST5-F1), conflict list changed in one transaction (ST5-F2), per-build offline cache.
- **Known and accepted [Reported].** SE-01 (Ledger shares the `marshmond.github.io` origin with two other apps; owner **accepted**); SE-02 (sync token and passphrases in plain `localStorage`); restore is replacement; sync is not field-level; soft-deleted records never purged (DI-03); SY-02 (repository growth from whole-file uploads) never measured.
- **Gaps.** Real-device, two-device, real-GitHub and recovery acceptance is the owner's checklist (`docs/LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md`), **not recorded as done**.

### 2.16 Existing automation, insights and AI-ready readers

- **Deployed [Fact].** Ledger alerts (15 kinds), payee rule suggestions, repeating-charge detection, Bills discovery and match suggestions, Services insights, Household review classes, cash Forecast, Monte Carlo. Every one is deterministic, runs on open, and **suggests** rather than writes.
- **AI status [Fact].** No model call, no AI code. The only network calls in `src/` are the GitHub sync/backup (`src/lib/sync/github.ts`) and the optional Twelve Data price lookup (`src/lib/prices.ts:22`).
- **AI-readiness.** Good: pure, read-only readers with resolved pieces and reasons; read-only guard tests prove a report leaves the database byte-identical (ST-S5 FIN-11). Poor: no common registry of readers, so there is no single catalog a question-answering layer could call (section 4A).

---

## 3. Overall user experience: does it work as one household operating system?

Honest summary: **the data model is unified; the daily experience is still a set of well-built modules.** Information flows through shared Contacts, Tasks, Calendar and Finance references. The seams show where the owner must still act as the integration layer.

| Question | Finding |
|---|---|
| Does Today direct attention to what matters? | Partly. Dated items: yes, well. Exceptions: spread over up to seven cards, no ranking, no "why this first" **[Fact]**. |
| Can the owner tell what needs action? | Per module, yes (each has a needs-attention list). Across modules, no single answer. |
| Does module navigation scale? | The grouped selector (N1) and Ledger bar (D8) are sound. 11 modules and ~33 Ledger pages are discoverable only by browsing or Search **[Hypothesis, unmeasured]**. |
| Unnecessary movement between modules? | Yes in three loops: (a) finish a service task in Tasks, then go to Services or Assets to log it ("Finished, not yet logged"); (b) import transactions in Ledger, then open Bills, Services, Assets or Projects to link each payment by hand; (c) see an annual bill in Bills, then separately think about Budget. |
| Repeated entry? | Column mapping on every import; payee/provider matching by hand; document links retyped per record (three separate implementations). |
| Information flowing between finance, projects, services, assets, family, calendar? | Strong for dates (due providers) and payments (Finance references). Weak for **plans**: nothing turns known commitments into budget targets, and Family does not reach Tasks/Calendar visually beyond a layer. |
| Do Quick Add and Search work as shortcuts? | Quick Add yes. Search finds records but offers no *answers* (for example "spent on maintenance this year"). |
| Discoverability | Features are findable once you know the module; Household finances, Needs review pages and the Year in review are the kind of surfaces that go unseen **[Hypothesis]**. |
| Defaults useful? | Today's default layout is carefully designed (D13.1). Ledger Home still shows a generic card set; Hide Amounts does not cover it (decided). |
| Mobile vs desktop | Phone parity was a design goal (tab bar, sheets, 44 px targets). Phone page length grew in D15/D16; checkboxes are 24 px and a few inline links under 44 px **[Reported]**. Nothing is verified on a real phone. |

### Ten most meaningful daily-usability opportunities (workflow, not cosmetic)

1. **One ranked "Needs you" list** across modules, with the reason each item is there (replaces scanning seven cards).
2. **A weekly review page** ("This week"): next seven days, exceptions, commitments due, cash outlook, over-budget projects, maintenance due; printable. It gives the data a ritual.
3. **Finish-the-loop prompts:** when a linked maintenance or service task is completed anywhere, offer "log it" right there, plus bulk resolve for the "finished, not yet logged" list.
4. **Remember the CSV layout per account** (and paste-in; OFX only if the owner's banks offer it).
5. **Link suggestions at import:** after importing, propose "this looks like the power bill / the cleaner / the roofing project" using the matcher Bills already has; never automatic.
6. **Year-ahead view of known commitments** (annual renewals, taxes, scheduled and project commitments, warranty and lifecycle dates) with an optional "set aside monthly" Budget-target suggestion.
7. **Quick answers in Search** for a fixed catalog of household questions, each showing sources and assumptions (deterministic, no model).
8. **A read-only Records index** of document references with gaps ("warranty with no document on file") and a "where is the paper copy" hint.
9. **Family lenses:** member colors and a member filter on Today, Calendar and Tasks; a printable "family week".
10. **Richer calendar export** (Family, Bills, Services, Projects, Assets layers with alarms) so the phone's own calendar can raise reminders, plus the BK-03 decision on backing up layer choices.

Not on the list on purpose: another visual redesign (the Signature system is complete; the open problems are functional), new modules, or new dashboards.

---

## 4. Evaluation of the candidate initiatives

### 4A. Ask Ledger (AI assistance)

**What can already be answered with existing structured data**

| Sample question | Today | Needs |
|---|---|---|
| Upcoming household expenses to prepare for | Mostly: `householdCommitments` windows (`household/commitments.ts:213`), Calendar Finance layer, Forecast | A year-ahead composition that also includes Finance-only items (loans, taxes) and project commitments (small read-only aggregation) |
| Spent on home maintenance this year | Partly: Assets overview year spending (`assets/overviewData.ts` `loadOverview`, `spend()`), Household union | **A definition** ("maintenance" = which kinds of service records, which Services visits?) and one aggregation. Owner decision |
| Which bills have increased recently | Price history per bill (B4) and price events on the due provider | A cross-bill "recent changes" list (small) |
| Projects exceeding budget | Per project (`projects/financialView.ts`) | A cross-project list (small) |
| Financial commitments coming due | Yes: commitments and Finance layer | Presentation only |
| What should I focus on this week | No single answer | The ranked "Needs you" reader (section 3, item 1). The ranking rule is the value; a model adds little |
| How is household spending changing | Reports (Finance); Services insights compare periods; household union has period selection | A household-level comparison (small) |
| Important maintenance neglected | Assets attention (overdue tasks), Services "gap" insight | A combined "overdue by asset" list (small) |

**Result:** of eight sample questions, about four are already answerable by an existing page or reader, three need a small read-only aggregation, one needs the ranked reader. **None requires a language model for correctness.**

**Where an LLM would actually help.** (a) Mapping free-form wording to the right reader and parameters; (b) a plain-language summary of several results at once; (c) follow-up questions. These are convenience, not capability. Convenience is worth buying only after the deterministic catalog exists and the owner shows they would use it.

**Three layers that must stay distinct**

1. **Deterministic insights.** Ledger computes and displays them; no model. Exists today; extend first.
2. **Conversational analysis.** A model interprets results Ledger has already computed. It never recalculates money (standing invariant, handoff section 2 item 4).
3. **AI-initiated actions.** A model proposes a change. It may only produce a *proposal* that opens the existing Quick Add or form preview ("Will add: …") and requires the owner's confirm. No deletes, payments or settings.

**Keeping calculations authoritative.** Design the answer layer as a **catalog of named readers** (`id`, parameters, `run()` returning figures, source records, assumptions, uncertainty). The same catalog serves a keyword matcher today and tool-calling later. The model chooses a reader and parameters; **the client runs it locally**; figures are rendered by Ledger, not retyped by the model.

**Minimizing what leaves the device.** Strongest mode, **router-only**: only the typed question (and the catalog's reader names) go out; the model returns a reader id and parameters; nothing about the household is sent. Optional second mode, **narrate**: send a minimal, masked result (counts, category names, no payee, provider, contact, note, address or account text, amounts only if the owner switches that on) so the model can phrase it. No whole backups, ever.

**Backend need.** The API key must not be in the client, and the client is public on a shared origin (SE-01), so any model use needs a **small authenticated proxy** (for example one serverless function holding the key, a per-device token, a daily cost ceiling, and logging that stores nothing). That is the first server in a product that has none. Recommended only after the deterministic catalog proves use, and after re-examining SE-01 because a spendable token in `localStorage` (SE-02) is readable by other apps on the same origin.

**Privacy, credentials, cost, failure.** Off by default; per-device switch; a visible "what will be sent" preview for the first use of each mode; key only in the proxy; token revocable; hard daily spend cap at the provider; timeouts and offline fall back to the local catalog; one kill switch. Cost [Hypothesis]: pennies per month for router-only use at household volume.

**Prompt injection and unsafe actions.** The risky text is anything an outsider can influence and the app stores: imported payee names, pasted notes, provider names, link labels. Controls: (1) router-only means no household text ever enters a prompt; (2) in narrate mode, strip free-text fields and send only structured aggregates; (3) model output is parsed against a fixed schema (reader id + parameters), anything else is discarded; (4) no tool exists that writes; proposals go through the existing preview-and-confirm path; (5) the answer always shows its source records so a wrong answer is checkable.

**Verdict.** **Do not build the model layer now.** Build the deterministic catalog first (roadmap R3: "Quick answers"), because it delivers most of the value at zero privacy risk and produces the exact interface an LLM would need. Schedule a design-only decision phase (AI-D0) after that, with owner usage evidence.

### 4B. Intelligent household automation

**Already automatic (on-device) [Fact].** Maintenance and visit reminders as Tasks; bill due, renewal, cancellation-cutoff and price-change markers on Calendar and Today (`bills/dueProvider.ts`); warranty end dates; Ledger alerts; discovery and match **suggestions** that never write without a tap. These all compute when the app opens.

**What cannot run reliably without more infrastructure.** Anything that must reach the owner while the app is closed: push notifications, email digests, a scheduled weekly summary. A browser app has no dependable background timer, installed-PWA push on iOS needs a push server, and Ledger has no server. Options, honestly ranked:

| Option | Reliability | Infrastructure | Verdict |
|---|---|---|---|
| Compute on open and show a ranked list and weekly review | High while the owner opens the app | None | **Build** (roadmap R1) |
| Export to the phone's own calendar with alarms | High once imported; stale until re-exported | None | **Build, small** (richer `.ics`) |
| App-icon badge / local notification when opened | Low value (only when already open) | None | Skip |
| Scheduled job in the private sync repository that decrypts and emails | Workable, but puts the sync passphrase into a repository secret | GitHub Action, a mail service | Defer; needs a security design |
| Web push via a small server | Medium; iOS needs a home-screen install | A server and push keys | Defer; revisit only if real use shows missed reminders |

**Rule for any automation.** Generated *information* (lists, summaries, suggestions) is automatic. Anything that changes stored records stays a **proposal with a preview and a confirm**, as Quick Add, Bills suggestions and Services fixes do today.

### 4C. Family Command Station

**Requirement:** a shared tablet showing family calendar, member tasks and dates, **with no financial data reachable, and never the full backup, database, sync file or secrets.**

**What exists.** Member records, colors, dates, a Family layer, member schedule, the F0 design (`docs/FAMILY-MANAGEMENT-F0-PLAN-2026-11-09.md` section 10): a separate **projection** built on the owner's device from allow-listed items only, published to a different destination with a different **read-only** credential. **Not built:** the `audience` parameter and shared family-view reader, per-item eligibility decisions, the builder, any publish step.

**Architecture options**

| Option | Verdict |
|---|---|
| Open Ledger on the tablet with finance navigation hidden | **Reject.** The tablet would hold the full database and sync secrets; hiding menus is not a boundary. |
| Tablet joins the normal sync | **Reject.** It would receive everything. |
| **Projection file in a separate private repository, read with a read-only, single-repository token, shown by a separate tiny static page on a different origin** | **Sound and needs no new server.** Worst case on theft: family calendar data and a read-only token to that one repository. A separate origin also avoids SE-01 for the tablet page. |
| Projection through a purpose-built backend | Cleaner, but a server to run and secure; overkill now. |

**Hard parts.** (1) *Eligibility:* the F0 design stores "show on display" as append-only decisions because last-writer-wins sync can resurrect a revoked flag. A simpler first version is **container-based**: only a designated "Family" calendar and list are shared. (2) *Freshness:* the projection updates only when the owner's device runs the builder, so the tablet can be hours old; acceptable for a wall display, wrong for "just added" expectations. (3) *Read-only first:* ticking tasks from the tablet needs a write path, conflict handling and a second credential; defer. (4) *Operations:* creating a second repository, a token, and a page is real work for a non-programmer owner and one more thing to revoke. (5) *Acceptance:* needs an actual tablet.

**Cheaper alternative with most of the value:** a printable and exportable **family-week** (Family layer by member, `.ics` limited to Family) with zero security surface.

**Verdict.** Valuable, **not near-term**. Needs a dedicated design phase (CS-0: container-based eligibility, publish destination, token model, projection format, threat model) and prerequisite work on the shared family-view reader. Sequence it after the family lenses and real-device acceptance.

### 4D. Documents and household records

**Facts.** Link-only references in three modules, validated separately, a stub `Attachment` entity, no index (section 2.13). Backups and sync serialize the **whole database into one encrypted file** that is uploaded to a git repository on every sync; GitHub rejects files over 100 MB and the repository history grows with each upload (SY-02 unmeasured). Browser storage on phones can be evicted.

**Assessment.** Storing file contents in Ledger would hit the sync file size, repository growth, backup size, phone quota, and the plain-backup exposure the app already warns about, in exchange for something a cloud drive already does well. **Do not build file storage.** Invest in **references and retrieval** instead:

- A shared **document reference adapter** (not a data migration): one read function that turns the three modules' existing references into a common list.
- A read-only **Records index**: filter by kind (warranty, receipt, contract, insurance, manual), owner record, expiry; surface gaps; open the link.
- Optional per-reference fields: kind, "paper copy at…" text, expiry. Optional fields need no migration.
- Include labels in Search (confirm whether they already are: **[UNVERIFIED]**).
- Keep the safe-URL rule and the masked-until-shown rule for private fields.

Insurance policies already live in Finance's Protection page; the index should link to them, not duplicate. Family records (birth certificates, passports) are exactly what the Guide ("If something happens") already tells the household where to find; a "paper copy at" field serves that without storing the document.

### 4E. Contacts & Relationships

Current state in 2.7. **Recommendation: no expansion.** The practical household needs (which plumber, which roofer, when did they last come) are met by Contacts "where used" plus Services history. Interaction logs, follow-up reminders and relationship notes are Personal CRM, which was deprioritized and has no evident one-household use case. Two small, optional improvements if the owner asks: a `company` field and tap-to-call/email links from Services and Assets provider rows. Keep C3 deferred indefinitely.

### 4F. Additional opportunities (not on the current roadmap)

1. **Ranked attention inbox and weekly review** (section 3 items 1 and 2): the largest unrealized opportunity, built only from readers that exist.
2. **Payment matching across modules at import time:** Bills B3.1 already scores candidate matches (`bills/payeeMatch.ts`); Services and Assets link payments by hand. One matcher serving all four.
3. **Annual commitments to Budget targets:** Budget already supports yearly and repeating targets; nothing derives them from Bills. This is "sinking funds from commitments".
4. **Replacement planning:** an optional expected replacement cost on assets (H4 lifecycle already tracks end of life) would yield a five-year capital view and feed Goals. Possible later; needs an optional field only.
5. **Ledger health card:** one place for last backup, last sync, unresolved conflicts, stale references. Fold into the attention list as a class rather than a page.
6. **Survivor and Social Security planning:** high stakes for a planning app, but needs verified law and a design pass; revisit after the product work.

---

## 5. Technical architecture and reliability

| Area | Assessment |
|---|---|
| Module boundaries | Strong. Registry contributions (`todayCards`, `searchSource`, `quickAdd`, `txnReferences`, `contactReferences`, due providers; `src/core/registry.ts`) let a module plug in without touching others. `lazyBoundary.test.ts` protects first-download size. New cross-cutting reader work should be one more optional contribution, not new coupling. |
| IndexedDB and transactions | Good where it matters (`planTxnDeletion`/`applyTxnDeletion`, completion plus log in one transaction). **Gaps:** NC-18/19/22 (above); DI-04 read-then-write in the shared repo is unverified. |
| Backup and restore | Strong in simulation (ST-S5: plain and encrypted restores into empty profiles, damaged files refused). Restore is replacement; real-device recovery unrecorded. |
| Encryption and sync | Sound design; two sync findings fixed (ST-S5.1). Record-level LWW remains by design. Secrets in `localStorage` (SE-02) and the shared origin (SE-01, accepted) matter most if a future feature adds a spendable credential. |
| Data ownership | Clear: Finance owns money; modules link by id; "never sum commitments, expected and recorded" is enforced by tests. |
| Golden-master integrity | 157 financial golden-master tests, read-only fingerprint guards. The strongest asset for any future aggregation work. |
| Data-reader consistency | Each module has a pure reader. There is **no shared contract** for "an item that needs attention" or "an answer", so consistency is by convention. |
| Search and cross-module indexing | Linear scans over in-memory snapshots; fine at current scale (ledger source measured). Household finances and document labels are gaps. |
| Calendar and recurrence | One engine, derived items never copied; good. Exports incomplete (above). |
| Performance and bundle | Entry 887 KB raw / 277 KB gz, +25% in five days; ST-S5 measured an emulated cold-phone Today load of 3.8 s [Reported]. The trend matters more than the number; any new reader should come with a budget. |
| Test reliability | 5,680 tests green, deterministic enough to deploy. Two known intermittent tests (`core.test.ts` fixed 100 ms wait; `services/s4-calendar.test.ts` test 13 scans random ids); the Family F2 provider `555` assertion is broad. Date-dependent test failure happened once (run #64) and was fixed. No in-repo browser test tool (TS-04). |
| Accessibility and real devices | Structure, names, contrast and keyboard are test-guarded; **no real phone, screen reader, Safari or Firefox pass is recorded.** This is the largest evidence gap. |
| Dependency maintenance | Six runtime dependencies, small and current-looking (React 19.3, Dexie 4.4, Vite 8, TypeScript 7). Low burden. No change recommended. |
| Documentation drift | README still says Services S5 and Bills B5 are "built and being reviewed" and that Household finances is "not yet committed" though all are deployed; backlog keeps stale unchecked items (for example "Compare Roth conversion strategies", line 2282, though a Roth planner exists; "RSU vest events for each spouse", line 2293); handoff section 1 carries about thirty superseded phase lines. Not a code risk, but it slows every new conversation. |
| Security of future backends | Any backend adds a credential and an attack surface to a no-server design. Treat as an explicit, separately approved decision (handoff section 8). |

### Classification of unresolved items

**1. Should block new feature development (very short list)**

- *Nothing blocks a read-only reader feature built on existing loaders* (roadmap R1).
- **Blocks any new module, new database table, backend, token or hosted page:** an owner real-use acceptance pass (phone, two devices, backup recovery). ST5-F1 also requires that every device has installed a build with the unknown-table fix before a Dexie version bump.

**2. Important debt for an early stabilization phase (roadmap RS-1)**

- NC-18, NC-19, NC-22 non-atomic deletes (and the NC-19 orphaned tax lots).
- 2026 Massachusetts surtax constant (needs the owner's yes).
- Three native `alert()` calls; NC-30 creating a stock's security row before its question.
- Focus falls to the page start after a delete removes its opener (D20.1A).
- Stale documents: README statuses, backlog checkboxes, handoff phase lines, the missing D21.1 SHA.
- The two intermittent tests and the broad `555` assertion.
- Decision on BK-03 (back up Calendar layer choices or not).

**3. Safely wait**

SE-04 (8-character passphrase minimum), SY-03 clock-skew warning, SY-04 back-off, DI-03 purge of soft-deleted records, Undo for Finance deletes, device lock for secrets, removing dead `var(--x, old)` fallbacks, splitting module readers out of the first download, "update available" notice, an in-app list of GitHub backups, forced-colors polish.

**4. Previously accepted; keep documented, do not reopen without new evidence**

SE-01 (shared origin; owner accepted 2026-11-09), SE-02 (secrets in `localStorage`), whole-record last-writer-wins, plain backups are unencrypted by design, Hide Amounts not covering Ledger Home and Budget (UX-01), public holidays ignored by business-day rules, no bank aggregation (manual CSV by choice), Calendar `Today` ignoring layer visibility. **One caution:** SE-01 and SE-02 were accepted for a no-credential app; a future proxy token or family-display token changes that calculation and should reopen the discussion *then*.

---

## 6. Where the product stands, in one paragraph

Ledger is a mature, unusually well-tested, deeply integrated household system whose engineering outpaces its real-world validation. The next gains are not more modules but (1) making what it already knows reach the owner as one ranked, explainable view, (2) removing three manual "bridge" tasks between modules (import layout, payment linking, finish-the-loop), (3) turning known commitments into plans, and (4) proving the whole thing on real devices. The ranked list, scoring and phased plan are in `docs/LEDGER-R0-STRATEGIC-ROADMAP.md`.
