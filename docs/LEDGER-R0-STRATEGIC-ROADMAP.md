# Ledger R0: strategic roadmap (PROPOSED, NOT APPROVED)

**Date:** 2026-11-14. **Author:** Claude (local analysis assistant). **Status:** PROPOSAL awaiting owner and ChatGPT review. **Nothing here is an approved decision, and nothing here authorizes building.** Planning only: no production code, schema, dependency, hosting setting or data was changed; nothing was committed, pushed or deployed.

Evidence and capability detail: `docs/LEDGER-R0-PRODUCT-ASSESSMENT.md`. Labels there ([Fact], [Reported], [Hypothesis], [UNVERIFIED]) apply here too.

**Privacy:** no real data. Every example is generic or invented.

---

## Part C. Executive summary (for the owner)

**1. How mature is Ledger today?**
Very mature as software, not yet proven as a daily tool. It has 11 modules, about 77,000 lines of code, 5,680 automated tests that all pass, encrypted sync and backups, offline use, and one consistent look. The latest version (`29c80e1`) is live and its deployment run succeeded. What it does **not** have is proof from real life: no phase since stabilization has been checked on a real phone, a second device, a screen reader or another browser, and the tracker shows none of its 163 screens as accepted.

**2. Three greatest strengths**
1. **The numbers can be trusted.** One way of counting spending, no double counting across Bills, Services, Assets and Projects, safe deletes, and 157 money tests that pin the results.
2. **It is genuinely connected.** Contacts, Tasks, Calendar and Finance are shared, so a cleaner's visit, a bill and a warranty all show up on Today without extra work. New modules plug in without disturbing old ones.
3. **It keeps your data yours and safe.** Local-first, encrypted sync you control, backups, every overwritten edit kept, and offline recovery drilled in simulation.

**3. Three greatest weaknesses or risks**
1. **Unproven in real use.** Hundreds of careful checks, but none on the devices you actually use. Building more on top of that increases the amount you would have to verify later.
2. **It only speaks when you open it.** There are no notifications or summaries anywhere in the code. Reminders, renewals and maintenance exist, but nothing reaches you unless you come looking, and the "what needs me?" answer is spread over up to seven separate cards.
3. **Manual bridges between modules.** You re-pick CSV columns every import, link each payment to its bill or contractor by hand, and log finished maintenance in a second place. Small each time, steady in total. (Also: the app grew about 25% in download size in five days; growth needs a budget.)

**4. Largest unrealized opportunity**
**Connect what Ledger already knows into one ranked, explainable view of what needs you, and a weekly review built from it.** Every ingredient exists in the code today (Today, Bills review, Services attention, Assets attention, Household review, Ledger alerts, Projects). Nobody has put them in one list with a reason beside each item. That is the cheapest, safest, most useful next step, and it is also the foundation any later "Ask Ledger" would need.

**5. Which major initiatives should be prioritized?**
In order: (a) a small closeout of known integrity gaps plus your real-device acceptance pass; (b) **"This Week"**: the ranked needs-you list, weekly review and finish-the-loop prompts; (c) **money intake**: remembered CSV layout and payment-link suggestions at import; (d) **answers and year-ahead**: quick answers in Search and a year-ahead view of known commitments; (e) records index and family lenses. Two **design-only** phases come later: Ask Ledger with a language model, and the Family Command Station.

**6. What should we deliberately avoid building?**
- **File storage inside Ledger** (it would bloat backups and sync and expose documents; keep links).
- **Personal-CRM features** (interaction logs, follow-ups): no household use case is evident.
- **An AI model layer now.** Most of the value comes from fixed, checkable answers that need no model.
- **Push notifications or email digests now.** They need a server; the app has none.
- **A tablet mode that merely hides finance menus.** That is not a safety boundary.
- **Another visual redesign, more modules, flex budgeting, receipt scanning.**

**7. What should we build next, and why?**
**R1.1, "Needs you": one ranked list of everything that needs attention across Ledger, shown on Today, read-only.** It uses only code that already exists, changes no stored data, adds no dependency, is small enough to review alone, and tells you immediately whether the idea helps. In parallel, when you give three small decisions, run the closeout (RS-1). Details in Part D.

---

## Part B. Ranked opportunities and scoring

### Method

Each candidate gets 1 to 5 on ten criteria. **Value** = usefulness + frequency + time saved + workflow improvement + cross-module value (5 to 25). **Deliverability** = incremental delivery + (6 − complexity) + (6 − data/security risk) + (6 − dependencies) + (6 − maintenance burden) (5 to 25). **Score** = Value + Deliverability (max 50).

**These numbers are my judgment, not measurements.** They encode assumptions: that the household opens Ledger at least weekly, that CSV import happens about monthly, that family-schedule features matter only if the household has dependants (unknown), and that a server is a heavy cost for a non-programmer owner. Scores within about 3 points of each other are effectively tied; the sequence in Part A is set by dependencies and risk, not by score alone. Where an item scores well but sequences later, the reason is stated.

### Scores

Columns: U usefulness, F frequency, T time saved, W workflow improvement, X cross-module; I incremental delivery, C complexity, S data/security risk, D dependencies, M maintenance burden (C, S, D, M: higher is worse).

| ID | Candidate | U | F | T | W | X | Value | I | C | S | D | M | Deliv. | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B | **This Week: ranked Needs-you list and weekly review** | 5 | 5 | 3 | 4 | 5 | 22 | 5 | 3 | 1 | 1 | 3 | 21 | **43** |
| C | **Import v2: remembered CSV layout per account, paste-in (OFX if banks offer it)** | 4 | 4 | 4 | 4 | 2 | 18 | 5 | 2 | 1 | 1 | 2 | 23 | **41** |
| Q | **Finish-the-loop: log from where you finish, bulk resolve** | 3 | 4 | 3 | 4 | 4 | 18 | 5 | 2 | 1 | 1 | 2 | 23 | **41** |
| A | **RS-1 closeout and integrity (atomic deletes, surtax constant, alerts, doc drift)** | 4 | 3 | 2 | 3 | 3 | 15 | 5 | 1 | 1 | 2 | 1 | 24 | **39** |
| F | **Year-ahead commitments view, then optional budget-target suggestions** | 4 | 3 | 3 | 4 | 5 | 19 | 4 | 3 | 2 | 2 | 2 | 19 | **38** |
| G | **Records index (document references, gaps, paper-copy hint)** | 3 | 2 | 3 | 3 | 4 | 15 | 5 | 2 | 1 | 1 | 2 | 23 | **38** |
| H | **Family lenses: member colors and filter on Today/Calendar/Tasks, family-week print/export** | 3 | 4 | 2 | 3 | 4 | 16 | 5 | 2 | 2 | 1 | 2 | 22 | **38** |
| R | **Richer calendar export (all layers, alarms) and BK-03 decision** | 3 | 3 | 3 | 3 | 4 | 16 | 5 | 2 | 2 | 1 | 2 | 22 | **38** |
| D | **Import-time link suggestions across Bills, Services, Assets, Projects** | 4 | 3 | 4 | 4 | 5 | 20 | 4 | 4 | 1 | 3 | 3 | 17 | **37** |
| E | **Quick answers in Search (deterministic question catalog)** | 4 | 3 | 3 | 3 | 5 | 18 | 4 | 3 | 1 | 2 | 3 | 19 | **37** |
| M | Bill to Finance Scheduled item (B3.2) | 2 | 2 | 2 | 2 | 3 | 11 | 4 | 3 | 3 | 2 | 3 | 17 | 28 |
| K | Push or email proactive alerts | 4 | 5 | 3 | 3 | 4 | 19 | 2 | 5 | 4 | 5 | 5 | 7 | 26 |
| I | Family Command Station (build) | 4 | 5 | 3 | 3 | 3 | 18 | 2 | 5 | 5 | 5 | 4 | 7 | 25 |
| N | Social Security claiming and survivor planner | 3 | 1 | 2 | 2 | 1 | 9 | 3 | 4 | 2 | 1 | 4 | 16 | 25 |
| L | Personal CRM / Contacts interaction history (C3) | 1 | 1 | 1 | 1 | 2 | 6 | 3 | 2 | 2 | 1 | 3 | 19 | 25 |
| J | Ask Ledger with a language model | 3 | 3 | 3 | 2 | 4 | 15 | 2 | 5 | 5 | 4 | 4 | 8 | 23 |
| O | File and receipt storage in Ledger | 2 | 2 | 2 | 2 | 3 | 11 | 3 | 5 | 5 | 4 | 5 | 8 | 19 |

(Deliverability arithmetic, example for B: 5 + (6−3) + (6−1) + (6−1) + (6−3) = 21.)

### Ranked top ten (by score; sequence is in Part A)

| Rank | Opportunity | Score | Plain-English tradeoff |
|---|---|---|---|
| 1 | **This Week: ranked Needs-you list and weekly review (B)** | 43 | Highest value for the least risk because it only reads what exists. The tradeoff is a product opinion (how to rank); keep the rule visible and simple. |
| 2 | **Import v2: remembered layout, paste-in (C)** | 41 | Removes the most repeated manual money step. OFX only if your banks offer it (ask first). Does not change the choice to avoid bank feeds. |
| 3 | **Finish-the-loop prompts (Q)** | 41 | Removes a hop between Tasks and Services/Assets. Small, but touches two modules' completion flow, so it needs careful tests. |
| 4 | **Closeout and integrity, RS-1 (A)** | 39 | Not exciting, but closes known partial-delete and wrong-constant gaps. Scored on risk reduction, sequenced in parallel because it waits on your decisions. |
| 5 | **Year-ahead commitments (F)** | 38 | Answers "what should I prepare for?" better than anything today. The budget-target suggestion step writes to Budget, so it is a separate, later batch needing your approval. |
| 6 | **Records index (G)** | 38 | Finds documents and shows gaps without storing files. Limited by link-only storage by design. |
| 7 | **Family lenses (H)** | 38 | Value depends on whether the household has schedules to manage (unknown). Cheap and a prerequisite to any tablet. |
| 8 | **Richer calendar export (R)** | 38 | The only reliable "reminder reaches my phone" path without a server. A snapshot, so it goes stale until re-exported. |
| 9 | **Import-time link suggestions (D)** | 37 | Biggest cross-module time saver, but needs the matcher generalized beyond Bills. Medium and best done after import v2. |
| 10 | **Quick answers in Search (E)** | 37 | Delivers the useful part of "Ask Ledger" with no model, no server, no privacy risk. Needs owner definitions (what counts as "home maintenance"). |

**Below the line:** M (B3.2) 28: defer; reassess after Year-ahead shows whether bills missing from the cash Forecast is a real problem. K 26 and I 25 and J 23: valuable ideas that are expensive and need infrastructure; gated behind design phases. N 25: plausible and high-stakes but needs verified law; revisit later. L 25 and O 19: **retire or defer indefinitely** (Part F).

---

## Part A. Proposed roadmap (3 to 5 implementation phases plus gates)

**Sequence.** Each phase is independently deliverable and reviewable. Nothing needs a new database table or a server.

```
 RS-1  Closeout & integrity (essential stabilization; parallel; waits on owner decisions)
 R1    This Week            R1.1 Needs-you list  ->  R1.2 Weekly review  ->  R1.3 Finish-the-loop
 R2    Money intake         R2.1 Import v2       ->  R2.2 Import-time link suggestions
 R3    Answers & year ahead R3.1 Year-ahead view ->  R3.2 Quick answers  ->  (R3.3 budget suggestions, optional)
 R4    Records & family     R4.1 Records index   ->  R4.2 Family lenses   ->  R4.3 Richer calendar export
 ----- design-only decision phases (no code) -----
 AI-D0   Ask Ledger with a model (after R3, with owner usage evidence)
 CS-0    Family Command Station design (after R4)
 OWNER   Real-use acceptance pass (parallel to everything; the owner's checklist)
```

**Ready to build now (needs only R0 approval):** R1.1. **Ready after small owner decisions:** RS-1, R1.2, R1.3, R2.1, R3.1. **Need a design/decision step first:** R3.2 (catalog definitions), R3.3 (writes to Budget), R4.2 (family lens design check), AI-D0, CS-0.

### RS-1. Closeout and integrity (ESSENTIAL STABILIZATION)

- **Problem.** Known gaps that each have a recorded fix: three partial-delete paths, one wrong 2026 tax constant, three native pop-ups, stale documents, intermittent tests.
- **Household benefit.** Nothing half-deleted; the surtax figure right for anyone above the threshold; fewer surprises when reading the docs.
- **Scope.** (1) Put the two-step deletes NC-18 (holding then its lots), NC-19 (investment account, its holdings **and the holdings' tax lots**) and NC-22 (property then its values) each in **one** database transaction, with tests that fail the second step and prove nothing is half-deleted. (2) Correct `TAX_2026.ma.surtaxThreshold` to $1,107,750 with a test and remove the UNVERIFIED wording (**owner decision**). (3) Replace the three `alert()` calls with the shared dialog or an inline message. (4) Fix NC-30 ordering (create the stock's security row only after the question). (5) Make the two intermittent tests deterministic and narrow the broad `555` assertion. (6) Reconcile docs: README stale statuses, backlog stale checkboxes (kept, marked superseded, never deleted), handoff superseded phase lines. (7) Record the BK-03 decision.
- **Expected user experience.** No visible change except the pop-up replacements.
- **Architectural impact.** Small. Transactions over existing tables; no schema change.
- **Prerequisites.** Owner decisions: surtax correction (yes/no), NC-19 tax-lot treatment (delete with the account, or refuse deletion while lots exist), BK-03 (back up layer choices or not).
- **Risks.** Changing deletes touches destructive paths; tests must run against fake IndexedDB with injected failures (a pattern already used in `txnDeletion.test.ts`).
- **Effort.** **Small.**
- **Acceptance.** Injected failure at step two leaves both tables unchanged for NC-18/19/22; no orphan tax lots after NC-19; the 2026 MA tax example matches a hand calculation above and below the threshold; `grep` finds no `alert(`; full suite, `tsc` and build pass; the 157 golden-master tests unchanged; docs updated.
- **Out of scope.** New features; any redesign; changing sync or backup formats; the 2027 placeholder and Roth IRMAA/ACA inputs (separate verification pass).
- **Why here.** Cheap, removes known data risk, and its three decisions are quick. It runs in parallel because R1.1 does not depend on it.

### R1. This Week

**Problem solved.** Attention is spread over about seven cards and six vocabularies; nothing says what matters most, and a person must remember to look.

**Household benefit.** One answer to "what needs me?" with a reason beside each item, and a weekly ritual that uses data already in the app.

**R1.1 Needs-you list (Medium; the recommended immediate phase).** See the full brief in Part D.

**R1.2 Weekly review (Small to Medium).**
- *Scope:* a page `#/today/week` (name to be decided) composing existing readers only: next seven days from `summarizeToday`/`upcomingDays`, the R1.1 list, commitments in the 7-day window (`householdCommitments`), cash outlook (Forecast low point), projects over budget (new small read from `projects/financialView.ts`), maintenance due and warranties ending (Assets), family dates (Family due provider). Printable and "copy as text". No writes.
- *UX:* a calm one-page digest, each line a link; hides empty sections; Hide Amounts respected; a "last reviewed" mark kept as a device-local convenience only.
- *Architecture:* a pure composer function plus one page; no storage.
- *Risks:* page length on a phone; duplicating Today (mitigate by showing only what Today does not: exceptions and commitments).
- *Acceptance:* every figure equals the figure on its source page (golden test that compares each section to its module reader on a seeded household); read-only fingerprint unchanged; 375 px and 1440 px browser check; print preview.
- *Out of scope:* sending it anywhere; scheduling; LLM summary.

**R1.3 Finish-the-loop (Small to Medium).**
- *Scope:* when a Task linked to an asset maintenance plan or a service arrangement is completed in Tasks, Today or Calendar, show an inline "Log it" that opens the existing "Done, log it" flow prefilled; add **bulk dismiss/save** for "Finished, not yet logged" on the Assets and Services overviews.
- *Architecture:* reuses existing completion-plus-log transactions (H2/S2); no new write path.
- *Risks:* two devices completing the same task (existing flagged-duplicate behavior must still hold); Undo guard (S2.1) must not weaken.
- *Acceptance:* tests for each entry point; duplicates still flagged, never merged; the existing H2/S2 suites pass unchanged.
- *Out of scope:* automatic logging without a tap.

**Why this position.** It is the highest-scoring work that needs nothing new from the owner, nothing new in storage, and no new infrastructure, and its result will tell the owner whether the unification idea is valuable before anything else is built on it.

### R2. Money intake

**Problem.** The most repeated manual money chores are choosing CSV columns and linking each payment to its bill, contractor or project.

**Household benefit.** Faster, more accurate monthly entry; payments land where they belong.

**R2.1 Import v2 (Small to Medium).**
- *Scope:* remember the column layout per account (a `settings` entry, no migration, rides existing sync and backup); "Using your saved layout" with a Change link; paste-in rows; OFX/QFX parser **only if the owner's banks provide it (ask first)**; unchanged duplicate protection and undo.
- *Architecture:* additions in `csvImport.ts`/`ImportPage.tsx` and one new setting key that must be added to the backup preference list (the BK-01 lesson: `PREFERENCE_KEYS` is hand-kept).
- *Risks:* bank format variation; sign conventions; never log file contents.
- *Acceptance:* second import skips mapping; existing import tests unchanged; new key appears in backup/restore round trip; nothing written before confirm.
- *Out of scope:* bank feeds (SimpleFIN stays "maybe later"); rules v2; receipt scanning.

**R2.2 Import-time link suggestions (Medium).**
- *Scope:* after an import (and on the Transactions page), show "Possible matches": this payment looks like bill X, arrangement Y, project Z, asset service W. Reuse and generalize Bills' scorer (`bills/payeeMatch.ts`, B3.1 suggestions). Every suggestion is a proposal; accepting uses each module's **existing** link function; a reject is remembered like Bills' `suggestion-reject`.
- *Architecture:* a registry contribution (provider per module) returning scored candidates; Finance never imports a household module (invariant), so suggestions are gathered by the shell.
- *Risks:* wrong matches (never automatic, one-tap unlink); amounts never matched by value alone for typed amounts (standing rule); performance on large imports.
- *Acceptance:* golden test that accepting a suggestion produces the same record the manual link would; no suggestion changes any total (read-only fingerprint until the owner accepts); rejection persists.
- *Out of scope:* auto-linking; changing the one-source cost rule.
- **Design step needed first** (a short design note) because it adds a cross-module contribution type.

**Why this position.** Import v2 needs no new concepts; R2.2 benefits from R1's "reason beside each item" pattern and from the registry-contribution precedent set by R1.1.

### R3. Answers and year ahead

**Problem.** "What should I prepare for?" and "How much did we spend on X?" require visiting several pages.

**Household benefit.** Direct answers with sources, and a plan for known irregular expenses.

**R3.1 Year-ahead view (Medium).**
- *Scope:* extend `#/household` (or a sibling page) with a 12-month list of known commitments: annual and quarterly bills, renewals and notice dates, project commitments, warranty and lifecycle dates, plus Finance-only items from the Forecast/Finance layer (loans, taxes, scheduled). Kept as **three separate figures** (commitments, expected, recorded) per the B5 invariant; never summed.
- *Architecture:* a pure composer over existing readers; Search/Quick Add entry for Household finances (closes O-19).
- *Risks:* double counting a bill that is also a Finance Scheduled item (B5 already folds only on exact equality; keep that rule and show overlap notices).
- *Acceptance:* each row traces to its source record; totals reconcile with the existing 30/90-day and 12-month windows; read-only fingerprint unchanged.
- *Out of scope:* writing anything; changing the Forecast.

**R3.2 Quick answers in Search (Medium).**
- *Scope:* a catalog of about ten named readers (`id`, parameters, `run()` returning figures, **source records, assumptions and an uncertainty note**) surfaced as an "Answers" group in Search ("home maintenance this year", "bills that went up", "projects over budget", "due in 30 days", "what needs me"). Matching by simple keywords and phrases, no model.
- *Architecture:* a new optional registry contribution `contributes.answers`. This catalog is deliberately the interface a later model would call.
- *Prerequisites:* R1.1 (the "needs me" reader) and **owner definitions** (for example, whether "home maintenance" means Assets service records plus Services visits, and which period default).
- *Risks:* wrong or over-confident answers; mitigate with mandatory sources and assumptions on every answer, and "not enough data" as a first-class result.
- *Acceptance:* each answer equals the figure on its own page for a seeded household; every answer lists its source records; an unknown question says so rather than guessing.
- *Out of scope:* any network call, any model, any write.

**R3.3 Budget-target suggestions (optional, Small to Medium, needs approval to touch the Budget page).** From a yearly or irregular commitment, propose a "set aside monthly" Budget target; accepting creates it through the existing target engine. Like B3.2, this touches a Finance page and needs explicit owner approval.

**Why this position.** It needs the reader catalog pattern from R1, and the owner's real use of R1 will show which questions matter.

### R4. Records and family

**Problem.** Documents are scattered inside records; family members are invisible outside the Family module.

**Household benefit.** Find paperwork and gaps quickly; see the family week by person.

**R4.1 Records index (Small to Medium).** Read-only list of all document references from Assets, Services and Bills through a shared adapter; filter by owner module, kind (optional new field), expiry; gap rows (warranty with no document); optional "paper copy at" text; labels in Search. **No file storage.** Acceptance: every listed link opens the original record; adapter output equals each module's own list; no schema change (optional fields only). Out of scope: uploads, OCR, encryption of files.

**R4.2 Family lenses (Small to Medium).** Member colors on Calendar, Tasks and Today rows, a member filter, a printable "family week" and a Family-only `.ics`. Introduce the **shared family-view reader with an `audience` parameter** promised in F0 (only `owner` used). Acceptance: the `owner` view equals today's Family overview; golden test that the reader's output type cannot carry a Finance field. Out of scope: any tablet or publishing.

**R4.3 Richer calendar export (Small).** Export Family, Bills, Services, Projects and Assets layers with alarms and privacy options (an option to omit amounts); decide BK-03. Acceptance: round-trip import into a standard calendar of a seeded household; Hide Amounts respected; amounts included only when the owner chooses.

**Why this position.** All three are small, independent and low-risk; R4.2 prepares the ground for the tablet design.

### Design-only decision phases (no code)

- **AI-D0, Ask Ledger with a model.** *Prerequisites:* R3.2 delivered and used for a few weeks; owner usage evidence; SE-01/SE-02 re-examined. *Decides:* router-only versus narrate mode; the proxy (hosting, token, cost cap, logging); the redaction list; the confirm-only action path; failure behavior. *Output:* a decision document, not code. *Go/no-go test:* the owner can name questions the deterministic catalog failed to answer.
- **CS-0, Family Command Station design.** *Prerequisites:* R4.2 (shared reader), a real tablet, the owner's wish to proceed. *Decides:* container-based eligibility, publish destination (separate private repository and read-only single-repository token, or alternatives), projection format and size, threat model for a wall-mounted device, revocation, offline behavior, read-only first.
- **OWNER acceptance pass (parallel).** The owner runs `docs/LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md` (about 90 minutes) on a real phone, two devices, offline, backup restore into a private window, and a screen-reader pass, and reports. **Gate:** no new module, database table, backend, token or hosted page starts until this exists.

---

## Part E. Challenge to the existing roadmap (the matching entry in `docs/BACKLOG.md` is proposed, not approved)

Compared with `docs/BACKLOG.md` and handoff section 7. **Historical completion records and accepted decisions are untouched.** The proposals below concern *future* items only and are not approved.

| Existing item | Proposal | Why |
|---|---|---|
| Ledger Signature acceptance (tracker: about 140 `BLT`, 23 `NS`) | **Keep as the owner's acceptance track; do not start new design phases.** The 23 `NS` rows are mostly dialogs and rare states | The system is complete; what is missing is acceptance, not features |
| Stabilization leftovers (NC-18/19/22, alerts, surtax) | **Move earlier: RS-1** | Known, small, and safer to fix before more features add references |
| Real-device acceptance (owner checklist) | **Keep as a gate** for anything needing new tables, backends, tokens | Largest evidence gap |
| B3.2 (create Finance Scheduled item from a bill) | **Defer; reassess after R3.1** | Value unclear until Year-ahead shows whether bills missing from the Forecast hurts |
| Search/Quick Add for Household finances (O-19) | **Consolidate into R3.1** | Same surface |
| Family `audience` reader (F0 item 7) | **Consolidate into R4.2** | It was promised, never built; needed by CS-0 |
| Family Command Station | **Move later and split:** CS-0 design after R4; build only if the design supports it | Needs infrastructure and a real tablet |
| Calendar export of Bills/Services/Projects (stabilization deferred list), BK-03 | **Consolidate into R4.3** | One export story |
| "First Ask Ledger conversational capability likely after Services and Bills" (handoff section 8) | **Move later:** deterministic Quick answers (R3.2) first, then AI-D0 | Deterministic answers deliver most value without privacy or server cost |
| Contacts C3 (interaction notes, follow-up tasks), Personal CRM | **Retire / defer indefinitely** unless the owner names a use case | Score 25; no evident household need; "where used" covers the practical need |
| Documents roadmap item ("evaluate file storage") | **Re-scope to Records index (R4.1); retire file storage** | Sync file size, repository growth, backup exposure, phone storage |
| Push notifications / email digest | **Defer** (needs a server); partially met by R1.2 and R4.3 | Revisit only if real use shows missed reminders |
| Monarch-gap Wave 1 and 2 items: Import v2 saved mappings, OFX, paste-in | **Bring forward as R2.1** | Never built; the most repeated money chore |
| Rules v2, flex budgeting, receipt scanning, demo mode, activity log | **Defer / retire** (flex budgeting conflicts with the envelope model; receipt scanning needs OCR; a dev demo seed already exists) | Low value for this household |
| Social Security claiming and survivor scenarios, broker lot import, whole-plan scenarios | **Keep "not selected"; revisit after R3** | Plausibly important, but needs verified law and a design pass |
| Stale backlog checkboxes (for example Roth strategy comparison at line 2282, RSU vest events per spouse at 2293, Task-editor 320 px overflow) | **Verify and mark superseded** in RS-1; do not delete | Avoid re-planning finished work |
| 2026 Massachusetts surtax correction (T2027 report section 13) | **Put to the owner now; build in RS-1** | Money logic known to be one year behind |
| SE-01, SE-02 (accepted risks) | **Keep documented; reopen only when a credential or hosted page is proposed** | Not new evidence today |
| Soft-delete purge, device lock for secrets, Undo for Finance deletes, "update available" notice | **Remain later** | Low frequency; no new evidence |

**Newly discovered opportunities added:** R1.1/R1.2 (Needs-you and weekly review), R1.3 (finish-the-loop), R2.2 (cross-module link suggestions), R3.1 (year-ahead), R3.2 (quick answers), R3.3 (budget suggestions), R4.1 (records index), AI-D0 and CS-0 as design phases, and a replacement-planning field (idea only, unscheduled).

---

## Part D. Next-phase implementation brief: R1.1 "Needs you" (PROPOSAL, NOT AUTHORIZATION TO BUILD)

**Title.** R1.1 Needs you: one ranked, explained attention list across Ledger, shown on Today. Read-only.

**One-sentence goal.** Gather the exceptions each module already computes into a single list ordered by a simple visible rule, with the reason beside each item, so the owner sees what needs attention without scanning seven cards.

**Effort.** Medium (about one reviewed batch).

**Owner decisions needed before building (one round, recommended first).**
1. *Where does it appear?* **(A) A "Needs you" section at the top of Today's supporting column, with the Household status cards unchanged below it (recommended)**; (B) replace the Household status group; (C) a separate page only.
2. *Ranking rule.* **(A) Tiers: overdue or broken first, then due within 7 days, then needs-review, then informational; within a tier by date, then module order (recommended)**; (B) owner-ordered module priority.
3. *Dismiss/snooze.* **(A) Keep existing Ledger alert dismiss/snooze behavior; other items disappear when resolved (recommended)**; (B) add a new device-local snooze for every item.
4. *Name.* **(A) "Needs you" (recommended)**, (B) "Needs attention", (C) "Inbox".

**Scope.**
1. A small pure type, for example `AttentionItem { id, moduleId, tier, date?, title, reason, href }`, and a pure `rankAttention(items)` function implementing decision 2, with the rule documented in the file header (same style as `todayModel.ts`).
2. A new **optional registry contribution** `contributes.attention` (module id prefix required on ids, validated at start like `todayCards`), whose adapters **only call existing loaders**: Assets `loadOverview(...)` attention (`assets/overviewData.ts:29`), Services needs-attention (`services/servicesOverview.ts`), Bills review (`bills/` review data behind `ReviewPage.tsx`), Household `householdReview` (`household/review.ts:38`), Projects `projectAttention` (`projects/todayLogic.ts:32`), and Ledger alerts (`src/lib/alerts.ts`; assembled today inside a hook, so a small extraction of the input-gathering into a plain async function is the likeliest refactor; flag it in the report).
3. A Today section that shows the top five with "See all N", and a list page for the rest. A card per module remains available (nothing is removed).
4. Titles and reasons are built from counts and names only; no amounts; `maskAmounts` and Hide Amounts respected; no private fields (follow the counts-only precedent of the existing household cards).
5. De-duplication by source key so an item already listed in Today's agenda (for example an overdue Task) is not listed again.

**Expected user experience.** On a normal day: 0 to 5 lines such as "Furnace service is 12 days overdue (Home & Assets)", "A finished visit has not been logged (Household Services)", "Gym membership renews in 5 days (Bills)", each with a link. When nothing needs attention the section hides. Phone: one column, 44 px rows.

**Architectural impact.** One new optional contribution type in `src/core/registry.ts`; one pure module; one Today section; no database, schema, sync, backup, route-format, calculation, theme or dependency change. Adapters must not make module screens reachable from the first download (`lazyBoundary.test.ts`), so loaders are imported lazily or via the existing registration path.

**Prerequisites.** R0 approval and the four decisions above. No dependency on RS-1.

**Major risks and mitigations.**
- *Disagreeing numbers.* The list could disagree with a module's own page. Mitigation: adapters call the module's own loader, and a golden test compares each adapter's count with its loader on the seeded household (the D11 principle that the band "can never disagree with the cards").
- *Slow Today on a phone.* Seven loaders in one view. Mitigation: read in parallel, show Today first and fill the section when ready, and measure against the ST-S5 numbers (warm Today about 139 ms on the dev machine, cold emulated phone 3.8 s); budget at most +100 ms warm and +10 KB gzipped on the entry file (887 KB raw / 277 KB gz today).
- *Ranking is an opinion.* Keep the rule tiny and visible; show the tier as words.
- *Ledger alerts extraction.* A refactor of working code. Mitigation: move code, do not change it; the existing alerts tests must pass unchanged.
- *Scope creep into actions.* No resolve buttons in R1.1; links only.

**Acceptance criteria.**
1. A seeded household with one exception in each module shows exactly those items, ordered by the stated rule, each with its reason and a working link.
2. For each adapter, its item count equals its module loader's count (tests).
3. Nothing is written: a read-only fingerprint test of every table is byte-identical before and after rendering and ranking.
4. Hide Amounts on: no digits or currency appear in any title or reason.
5. Empty household: the section is absent; no console errors.
6. Existing tests unchanged and passing: the full suite (289 files, 5,680 tests at baseline), the 157 financial golden-master tests, `lazyBoundary`, Today composition tests; `tsc` and build clean.
7. Entry file growth within the stated budget; Today warm load within +100 ms.
8. Browser check at 375 px and 1440 px, light and dark, with invented data only; keyboard order and accessible names checked; **no real-device or screen-reader claim is made**.
9. Report with test counts, numbered judgment calls, what is NOT built, handoff and backlog updated; **stop before commit**.

**Explicitly out of scope.** The weekly review page (R1.2); any notification, email or push; any model or network call; resolve/snooze buttons beyond the existing alert behavior; new storage; Family member filters; redesigning Today; Search or Quick Add changes.

**Why this phase first.** It is the highest-scoring item that needs nothing the owner has not already approved in principle, changes no stored data, is reviewable alone, and its outcome tells us whether the unification idea earns the larger R1.2 and R3.2 work.

---

## Part F. Things to deliberately not build (summary)

| Item | Reason |
|---|---|
| File, receipt or scan storage in Ledger | Sync/backup size, repository growth, phone storage, document exposure; links already work |
| Personal CRM / interaction history | No evident one-household use; "where used" already answers the practical question |
| Model-based Ask Ledger before the deterministic catalog | Most value needs no model; a model adds a server, a credential and an injection surface |
| Push/email alerts now | Needs a server the product does not have |
| Tablet mode by hiding menus | Not a boundary; the device would hold everything |
| Another visual redesign, new modules, flex budgeting | No functional problem justifies them |

---

## Part G. Open questions for the owner and ChatGPT

1. Approve R1.1 as the immediate phase, with the four decisions in Part D?
2. RS-1 decisions: correct the 2026 MA surtax constant? NC-19 tax lots: delete with the account or block deletion? BK-03: back up Calendar layer choices?
3. Which banks do you use, and do they offer OFX/QFX? (Decides whether R2.1 includes OFX.)
4. Does the household have children or dependants with schedules? (Decides how much R4.2 and CS-0 matter.)
5. Is there a calendar app on your phones you would trust for alarms (R4.3)?
6. When can the real-device acceptance pass happen?

**Not approved until the owner and ChatGPT say so. The handoff records these as PROPOSED.**
