# Household Services S5: Overview, household spending, insights and final acceptance. Implementation report

Date: 2026-11-07. Status: **BUILT AND TESTED LOCALLY. NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED, NOT ACCEPTANCE-TESTED ON REAL DEVICES.** No other module was started. All data in tests, screenshots and this report is invented (the repository is public).
**FINAL TOTALS: 133 test files, 2,265 tests pass** (baseline 129 files, 2,194; 71 new tests in 4 new files). `npx tsc --noEmit` clean. `npm run build` succeeds (the existing chunk-size warning only). `git diff --check`: line-ending notes only. Schema is still Dexie v15. No dependency, `package.json`, `src/db.ts`, `.github`, Finance, Tasks, Calendar, Projects, sync-engine or backup-format change. The Services suites (590 tests) also pass under `TZ=Pacific/Kiritimati`, `TZ=America/Los_Angeles` and `TZ=UTC`.

## 1. Executive summary (plain English)

**The Overview (`#/services`).** The landing page now answers five questions in order. *What needs attention?* One list of every exception, each with a link to the record (finished-but-not-logged visits with a Log button, schedule checks, no provider, a gone or retired asset, possible duplicate visits or duplicate Home & Assets records, a payment link that needs review, typed amounts that differ, a contract date inside 30 days). *What is coming up?* The next visit task of each arrangement plus the dates its schedule expects (clearly labelled "Expected from schedule", nothing created), with moved visits flagged. *Which agreements should I look at?* Renewal and notice dates in the next 90 days. *What was recorded?* A period you choose (last 12 months, 90 or 30 days, this year so far, a past year, all time). *Anything worth knowing?* A few plain observations. Filters (Active, Paused, Ended, All; provider) are lightweight, and nothing on the page changes anything.

**Household spending.** The page can now say how much the household has actually **recorded** paying across Household Services and Home & Assets **without counting any payment twice**. A Finance payment linked in both places counts once. A typed amount is only treated as the same money as another typed amount when a visit and its Home & Assets record are explicitly linked (the S4 `recorded-as` link); amounts that merely look alike always both count. The page shows the total, each module's own figure, the amount linked in both places, a plain-words explanation of why the total is not just the two figures added, every payment's fate (counted, counted once through another record, covered by a whole transaction, or not added), and anything that needs review. It says plainly that this is not all household spending and that Project spending is separate and never added.

**Insights.** Deterministic, no AI service, no stored result. Spending against the comparable earlier period; the 12-month estimate kept apart from what was recorded; an unusual amount for a regular service (needs three other clear payments and a steady usual price); a long gap in logged visits; repeated skipped or cancelled visits; dates that keep moving; optional "not recorded in Home & Assets" notes. Each names its records, is worded neutrally and says what it cannot know.

**Honest limits.** Everything is tested with real Dexie, the real backup export/restore and the real two-device `SyncEngine`, and checked in the browser pane at desktop and 375 px in light and dark. **Not done, and cannot be done by me:** real phone, two physical devices, offline use, a real screen reader. A checklist for you is in section 12.

## 2. Verified S4 commit and deployment evidence (the stop gate)

| Check | Result |
|---|---|
| Repository | `origin` = `https://github.com/marshmond/ledger.git`; local `C:\Users\alexm\projects\finance-app`; branch `main`. |
| S4 commit | **`c906b9c8c721a191b3f720463d046555d8274291`** (`feat(services): S4 cross-module workflows, contract dates and 12-month expected visits`) = `HEAD` = `origin/main` (checked after `git fetch`). Its predecessor `d5cd5f9` (S3 test fix) had Pages run #65 `success`. |
| Deployment | The matching "Deploy to GitHub Pages" run for `c906b9c` was **#66**. When S5 started it was `in_progress` and I did **not** start implementation (stop condition 8). I re-checked the public Actions API and it became **`completed` / `success`** before any S5 code was written. (`gh` is not installed; the public API was used.) |
| Owner approval of S4 | The commit and push of S4 happened before this session (the owner's note: "S4 is currently in process of being pushed"). I did not make that commit. |
| Working tree | Clean (`git status --short` empty). |
| Documents read before any code | `CLAUDE.md`, `docs/CHATGPT-HANDOFF.md` (first 140 lines and the S-sections), the S4 report (including section 29), `docs/HOUSEHOLD-SERVICES-S0-PLAN-2026-11-06.md` sections 0, 7.1 to 7.7, and the spending, handoff, overview, Today and Calendar code. **Stated gap:** of the S3 report I read sections 18 to 27 (mutation checks, browser notes, regression, judgment calls and the whole pre-commit corrections section 27); sections 1 to 17 I knew only through the code, the S4 report and the green tests. The handoff and backlog I read at their top and in the S-sections, not line by line. |

## 3. Initial Git status and baseline

Initial status: clean, `main` = `origin/main` = `c906b9c`. Baseline: `npm test` **129 files, 2,194 passed**; `npx tsc --noEmit` clean; `npm run build` succeeds.

## 4. Files added and modified

**New (src):** `modules/services/householdSpend.ts` (the union), `insights.ts`, `periods.ts`, `servicesOverview.ts` (the shared reader and its loader), `OverviewParts.tsx` (the new cards). **New tests:** `s5-spend-matrix.test.ts` (33), `s5-overview.test.ts` (18), `s5-insights.test.ts` (16), `s5-performance.test.ts` (4).
**Modified (src):** `modules/services/OverviewPage.tsx` (rebuilt on the reader), `views.ts` (one added function, `loadSnapshotAndLinks`, which also returns the links already read; `loadSnapshot` is now a one-line wrapper), `PaymentUI.tsx` (only the old `OverviewMoney` block removed; every other export is unchanged), `services.css` (about 17 lines).
**Docs:** this report, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/module-hooks.md`, `README.md`.
**Not touched:** `src/db.ts`, any other module's source, Tasks, Calendar, Finance, Projects, Home & Assets, the sync engine, backup code, `package.json`, `.github`. A mutation-test script lives in the session scratchpad, outside the repository.

## 5. Overview implementation and UX decisions

- **One shared reader (H5 pattern).** `loadServicesOverview(period, today)` reads the Services snapshot with its links (the `links` table is read **once**), the Home & Assets service records, and the Finance transactions any payment reference points at (one bulk read). The pure `buildServicesOverview` does everything else. Nothing is stored; derived values are recomputed each time. A test spies on the table reads: the same count however many arrangements exist, and a second load costs the same as the first.
- **No rule of its own.** Needs attention uses `buildOverview` (the function Today's counts come from), `contractDeadlines` (Calendar and Today), `duplicateHandoffs` (S4) and the household spend review list. A test pins that the Overview's counts equal Today's counts for unlogged visits, duplicate visits, schedule checks, review visits and contract deadlines.
- **Needs attention is one list** (previously three separate cards for unlogged, review and duplicates plus a list): each line has a small kind label, a link, and for unlogged visits the existing "Log this visit…" button. A healthy arrangement raises nothing (tested).
- **Upcoming services:** the open Task (its date, time, "Moved from <usual date>" when only that visit was moved) and later dates from `plannedVisitDates` for the next 60 days (the same function the Calendar layer uses; starts after the open Task so nothing is shown twice). Ten rows. Nothing is created (row counts and update times unchanged across ten loads, tested). Paused and ended arrangements list nothing.
- **Agreements to review** (next 90 days; notice deadlines inside 30 days are also under Needs attention, the same window Today counts). Ended arrangements give none.
- **Arrangements:** Active by default, with Paused, Ended and All as radio chips and a provider filter. Each row shows provider, cadence, next visit and the per-visit estimate (information) if one is set.
- **Recent activity:** the existing visit list (distinct labels and marks for completed, skipped, cancelled; fees as information), with a sentence separating logged visits from scheduled ones.
- **Spending card:** period selector; figures; difference explanation; review notes; "how these figures fit together" (collapsed); by provider (collapsed); S3's 30-day and 90-day estimates plus the 12-month estimate in a separately labelled "Estimates" block. Hide Amounts shows `$••••` everywhere (browser-checked: 42 masked amounts, no digit left).
- **Responsive and accessible by construction:** filter chips are real radio buttons (arrow keys work, visible focus ring, 40 px high, 44 px on phones); the period control is a labelled select; reconciliation details are native `<details>`; warnings that need action use `role="alert"` as elsewhere in the module.

## 6. Household spending reconciliation architecture

`householdSpend(input, lookup, period)` in `householdSpend.ts`: pure, read-only, no stored total. **It adds no financial engine.** It builds the cost records of both modules (H3's `costRecords` for Home & Assets, S3's `payRecords` for Services), removes the typed amounts that a linked job must not count twice, narrows each record to the period, and calls H3's `spend()` once over the union. Piece identity, live Finance amounts, whole-covers-parts, refunds, transfers, stale-split fingerprints and "needs review counts 0" are all `spend()` and `resolveRef`, unchanged.

- **Finance payments** deduplicate by `pieceKey` across both modules; a whole transaction anywhere covers its parts everywhere. Never by amount, date or payee.
- **Typed amounts** are never matched by value. The only thing that makes two typed amounts one payment is a valid S4 `recorded-as` link between a visit and a Home & Assets service record. Visit plus its record(s) form one **payment event** (union-find, so two offline copies of one handoff, or one visit recorded for two assets, are still one event). If any record in the event carries a Finance reference, every typed amount in it is left out and listed; otherwise the visit's typed amount counts once (else the lowest-numbered record's), and a different amount is flagged. The decision is made on all the data and dated by the claim that counts, so a period boundary cannot make a job count twice or not at all.
- **Missing partner:** a link whose visit or record is not on this device is no pair; each side counts alone (so a record arriving later by sync cannot change the answer to double counting) and a notice says so.
- **Claims:** every payment reference or typed amount is one claim ending as `included`, `merged` (counted once through another claim), `covered` (part of a counted whole) or `excluded` (needs review, or a typed amount on a linked job). The `included` amounts equal the total (`reconciles`), and the difference from the two module figures is split into three amounts derived claim by claim (`overlapBoth`, `coveredAcross`, `typedNotAdded`) that add up to it exactly (`explainsDifference`). Both are asserted on every matrix scenario and on 300 random worlds in three periods each.
- **Never an allocation:** a shared payment is never divided, and nothing says which module owns it. The label is "Recorded payments, each counted once".
- **Semantics kept apart:** completed-visit payments, fees, other charges, estimates and unknown payment status are not mixed. Estimates are never in the total. A completed visit with no payment is reported as "no payment recorded", never unpaid, and a Home & Assets record with no cost is "no cost recorded", never $0 (unless its linked job carries a payment elsewhere).
- **Projects:** Project money is never read. The output only counts how many counted pieces Finance also tags to a Project, shown as context.
- **Module figures** on the card are each module's own total computed from the same records and the same period rule; tests assert they equal the Home & Assets overview (`buildSpending`, calendar year and all time) and `servicesSpend`.

## 7. Complete financial test matrix (expected and actual, cents)

All in `s5-spend-matrix.test.ts` unless noted; **every row passes**. "Pieces" = distinct Finance pieces counted. Every row also asserts the invariants (included claims sum to the total; difference explained; statuses add up to the claim count).

| # | Scenario | Expected | Actual |
|---|---|---|---|
| 1 | Services payment only | 1 piece, 10,000 | pass |
| 2 | Home & Assets payment only | 1 piece, 5,000 | pass |
| 3 | Same whole transaction in both | 1 piece (1 included + 1 merged), 12,000; simple sum 24,000, overlap 12,000, linked in both 12,000 | pass |
| 4 | Same split part in both | 1 piece, 3,000 | pass |
| 5 | Whole on one side, overlapping part on the other (both ways round, both record orders) | 1 piece (the whole), 10,000; 1 covered; difference 3,000 | pass (4 variants) |
| 6 | Different split parts | 2 pieces, 10,000 | pass |
| 7 | One payment on three visits | 1 piece (1 included + 2 merged), 9,000 | pass |
| 8 | One payment on three assets | 1 piece, 4,000 | pass |
| 9 | One payment shared by completed, skipped and cancelled visits | 1 piece, 6,000 | pass |
| 10 | Refund in the other module; refund linked in both | 7,500; 7,500 | pass |
| 11 | Transfers | 1,000; 2 excluded claims, 2 review notes | pass |
| 12 | Finance amount changed since linking | live 12,500; listed as changed | pass |
| 13 | Transaction deleted | 0; 2 excluded | pass |
| 14 | Stale or reordered split; same part correctly linked elsewhere | 0; then 7,000, 1 piece, 1 review remains | pass |
| 15 | Identical splits: different positions / same position / typed equal to a piece | 6,000 (2 pieces); 3,000; 6,000 | pass |
| 16 | Typed amounts on unrelated records, identical values; same day, provider and asset; same day and provider, different asset | 10,000 and no hint; 10,000 with a hint only; 10,000, no hint | pass |
| 17 | Typed on a visit and its `recorded-as` record | 5,000; 1 included, 1 excluded; module figures 5,000 + 5,000, difference 5,000 | pass |
| 18 | Linked, different typed amounts; only the record typed | 5,000 + "typed-differs"; 4,500 | pass |
| 18b | Unknown status | no payment anywhere: `homeWork 1, completedVisits 1`; paid elsewhere in the job: 0, 0 | pass |
| 19 | Missing `recorded-as` target; target arrives later; visit gone | 5,000 + notice; 5,000; 2,000 | pass |
| 20 | Two offline devices each recorded the same visit (typed; record-only; Finance; two assets) | 5,000 (1 included, 2 excluded); 5,000; 5,000 (3 records reach 1 piece); 3,000 | pass; real `SyncEngine` version in `s5-overview.test.ts` |
| 21 | Finance payment plus a separate manual charge; linked as one job | 12,500; 12,500; 10,000 + "typed-left-out" | pass |
| 22 | Transaction dates versus service dates; a typed job across the year end | 0 / 10,000 / 10,000; 4,000 / 0 / 4,000 (periods sum to all time) | pass |
| 23 | Undated typed amounts | 90,000 all time, 0 in a period; visit 700 / 0 | pass |
| 24 | Records at several hierarchy levels | 15,000 once (3 records reach 1 piece) | pass |
| 25 | Payment also attributed to a Project | 30,000 once; 1 project-tagged piece; no Project data read | pass |
| 26 | (extra) Arrangement-level retainer payment against a Home & Assets record | 5,000 | pass |
| 26 (brief) | **Backup and restore** | identical total, reconciliation and claims after restoring into a new database | pass (`s5-overview.test.ts`, real G1 export and restore) |

Random checks (deterministic generator, no `Math.random`): on 300 worlds and three periods each, all invariants; each module total equals its own page (all time, 100 worlds) and a calendar year equals the H5 overview figure (100 worlds); the answer is identical when every input list is reversed (100 worlds); a linked typed job always counts exactly the visit's amount.

## 8. Insights implemented and deliberately deferred

**Implemented (`insights.ts`, all pure):** (1) recorded Services payments against the comparable prior period; (2) the 12-month estimate beside what was recorded over the last 12 months (per-visit estimates only; per-month, season, year and quote are not converted, as in S3); (3) unusual cost; (4) long gap; (5) two or more skipped or cancelled visits in 90 days; (6) dates that keep moving; (7) optional "not recorded in Home & Assets" note. Plus `providerBreakdown`: spending by provider where attribution is unambiguous (a payment more than one provider's records reach goes to a "shared or unclear" line; rows plus that line equal the total, tested on 60 random mixes in three periods).
**Standards:** deterministic (the determinism test found a real bug on its first run, evidence order depended on input order; fixed by a fixed internal order); every insight names its records; neutral wording (a test checks none contains "fraud", "error", "overcharge" and the like); no judgment on thin history; the absence of a visit is never read as the provider not coming; money only through a money function (Hide Amounts); capped at eight, "worth a look" first.
**Deferred (not built):** any AI or model, automatic actions, seasonal-aware thresholds beyond the simple steadiness guard, budgets or forecasts of non-per-visit costs, a Today insight card, notifications.

## 9. Cross-module regression coverage

All earlier suites pass unchanged (Services 589 incl. S1 to S4, Home & Assets, Projects, Tasks, Calendar, G1 backup, sync). New: the cross-module journey test (`s5-overview.test.ts`, last describe): create an arrangement with a provider contact and a phone, link an asset and a Project, check one open Task, derive the Calendar's expected visits (over 20, with renewal and notice markers coexisting and **no Calendar Event row**), log a visit, pay it through Finance (also tagged to the Project), record it in Home & Assets with the same payment, check the household total (once), replace the provider, check the old history and payment stay where they were, no money was added, each arrangement has exactly one open Task and the old one no longer repeats, and the Project record is unchanged. The Overview's Today counts equal Today's own. Search, Quick Add and the Today card code were not edited and their tests pass; a privacy test confirms Overview and insight words carry no phone, email, notes, links or typed amounts, and Today's lines carry no dollar sign, no long numbers and no names.

## 10. Calendar and Tasks recurrence acceptance

Not redesigned (S4 correct). Acceptance run: biweekly and twice-monthly cadences, the rolling 12-month horizon, derived-not-stored occurrences, only the next Task maintained, moved-visit does not shift later dates (the Overview shows "Moved from" and the later dates are identical before and after a move, tested), paused and ended arrangements produce no upcoming rows or expected visits, history intact, contract markers coexist with visit entries, and no duplicate visible occurrences (S4 `s4-calendar.test.ts`, 23 tests, still green; the Overview itself reuses `plannedVisitDates` so it cannot disagree with the Calendar). A paused arrangement whose open Task the owner chose to keep is not listed as upcoming (the Task stays in Tasks and its date shows under Paused). Existing limitation (S4 29.1, unchanged): a future one-off skip cannot be recorded in advance.

## 11. Sync and backup evidence

Real `SyncEngine`, two devices, one shared remote store: (a) both devices record the same typed visit in Home & Assets offline: two records exist, the household total counts the job **once on both devices**, the duplicate-handoff notice shows on both, nothing is merged or deleted; (b) one device links a Finance payment on a visit while the other links the same transaction on an asset record: after syncing both show each module once (12,000 each), 12,000 linked in both, 12,000 household total. Real G1 export, checker and restore into a separate database: identical totals, reconciliation, claim statuses and attention list. No backup-format or sync change.

## 12. Browser acceptance (browser pane, invented data, the pane's own database; not a real device)

**Done:** the Overview at desktop (about 1024 px), at 375 px **dark** and **light**: no horizontal overflow from any page element, main controls at least 40 px high; Needs attention with all kinds seen (agreement dates, not-yet-logged, schedule check, payment link, needs review) and the Log button; the filter chips (clicked, and arrow keys with visible focus); the period select (changed to All time and back); Upcoming with task, expected and moved rows; Agreements to review; the Spending card with a payment linked in both modules (150 once), a typed pair (50 once), a stale link warning and the explanation sentence; the unusual-cost insight and the estimates; Hide Amounts (42 masked, no digit left except the literal word "$0" in a sentence, which the page masks when it is an amount); opening the Log dialog from Needs attention (focus moves inside, **Escape** closes it, focus returns to the button); Today still loads with the Services card counts matching the Overview; no console errors.
**Not done in this pass (and why):** creating and editing an arrangement, completing and saving a visit, the asset handoff, Project linking and the Calendar view were **not re-run in the browser** in S5 (that code is unchanged since S4's browser checks and its tests pass; the Overview only reads them). The Move and Contract dialogs at 375 px (S4 gap) and the full-page keyboard Tab walk were not done. **Screen reader: NOT verified.** Contrast was judged by eye in both themes, not measured. The pane was narrowed to 320 px at the end by the app; the only overflow there was the shell's own "Settings" link, not S5.

**Owner-executable checklist (real devices; please tell me what you find):**
1. *Phone:* open `#/services`; read every card without sideways scrolling; change the status chips, provider and period; open Log this visit and close it.
2. *Two physical devices + offline:* on device A go offline and record a completed visit in Home & Assets (copy the typed amount only if you want to test the typed case); on device B (offline) do the same visit; go online on both; confirm both Home & Assets entries exist, the Overview shows "Recorded twice in Home & Assets", and the Recorded spending total counts the job once on both.
3. *Duplicate occurrences:* on both devices create the same arrangement name offline; after syncing confirm nothing was merged and the Overview lists both without error.
4. *Calendar horizon:* open the Calendar a month later (or change the device date) and confirm the expected visits extend one more month and no new Tasks appeared in Tasks.
5. *Backup and restore:* export a plain backup, restore it on a fresh browser profile, open the Overview and confirm the same Recorded spending figures and the same Needs attention list.
6. *Spending consistency:* pick one visit paid through Finance, link it in Home & Assets too, and confirm the total counts it once and "Linked in both" shows it.
7. *Keyboard and screen reader:* Tab through the filters and the period select; with a screen reader (VoiceOver or NVDA) confirm the status chips announce their name and count, the period select announces its label, and the "How these figures fit together" disclosure opens and reads.

## 13. Performance and accessibility findings

- **Performance (synthetic data, `s5-performance.test.ts`):** Finance look-ups are one per reference: 4 times the data costs under 5 times the look-ups (a quadratic method would be about 16 times). 5,000 visits, 2,500 asset records and 5,000 transactions: the household total, reconciliation and insights together complete in well under a second on this machine (the test only enforces a 6-second ceiling). **One real quadratic spot found and fixed:** the "may be the same job" hint compared every visit with every record (now one look-up by day and provider). The insights' "reliable payment" test was made linear with an index and a test pins that it agrees with S3's `typicalCost` for every arrangement. Table reads are constant per load (spied). Derived Calendar occurrences are not stored (S4 test: no growth). Repeated loads change nothing.
- **Robustness:** junk arrangement, visit, asset-service and link rows, and links to missing assets, visits and records are read defensively by the Overview and by Today's counts (tested); every period still gives a number; an empty database gives an empty page.
- **Accessibility:** native radio, select and details controls; labels on every control; visible focus; dialogs use the shared Modal (focus trapped, Escape closes, focus returns). **Unverified:** real screen reader, measured contrast, a complete keyboard-only walk. A noted nit: the browser tool reports the status radios by their value ("paused") rather than the label text; the label wraps the input so the visible text should be the accessible name, but I could not confirm it with a screen reader.

## 14. Numbered architectural judgment calls (please review)

1. **Purchases are included.** The union uses H3's `costRecords`, which includes asset purchase prices, as S0 7.6 specifies. The card labels the Home & Assets figure "including buying assets". If you want only maintenance, that is a one-line filter and a decision for you.
2. **A linked job is dated by the claim that counts** (the visit's date for a typed job). A job whose visit and record fall in different periods counts wholly in the visit's period.
3. **Typed amounts are left out whenever any record in the job holds a Finance reference, even a stale one** (S0 7.6: never double count over never undercount). While that reference needs review the job may therefore show less; the review note says so.
4. **Only the record has a typed amount:** counted once from the record (nothing else holds a payment).
5. **Module figures on the card** use the same period rule for both modules (Finance piece by live transaction date, else the snapshot date, else the record's date; typed by record date; undated only in All time). Services' own page falls back to the snapshot date only when a piece has no live date; the two can differ only for a reference with no snapshot date and no transaction on this device, a case that already counts 0.
6. **Periods** are my choice (last 12 months default, 90 and 30 days, this year so far, past years, all time). Every comparison uses the matching prior period.
7. **The trend uses Household Services payments only**, not the union (it answers "are service payments rising?"). The headline union is on the card above it.
8. **Unusual cost:** at least 3 *other* clear, unshared payments; usual price steady (largest at most twice the smallest); amount at least 1.5 times or at most half the median and at least $10 apart; visits in the last 120 days; at most 3 shown. Chosen to stay quiet.
9. **Long gap:** more than 2.5 times the schedule's usual interval and at least 60 days since the last completed visit, with two or more completed visits and no finished-but-not-logged visit.
10. **Skips:** two or more skipped or cancelled visits within 90 days. **Moves:** at least 3 of the last 6 logged visits (4 needed).
11. **Insights are capped at eight**, worth-a-look first. Nothing is stored or dismissible.
12. **Needs attention merges the old separate cards** into one list; look-alike one-off duplicates stay out (as on Today). Filters never hide attention items.
13. **Upcoming:** 60-day window of derived dates, ten rows; a paused or ended arrangement lists nothing even if a kept Task exists.
14. **Today is unchanged** and keeps its count-only card. Three Overview-only conditions (stale Finance references, duplicate handoffs, typed-amount notes) are not on Today because they need a Finance read Today avoids. Adding them is a small follow-up if wanted.
15. **Provider filter** applies to arrangements, upcoming, agreements and recent activity, not to money or insights (those are household-level).
16. **The S3 per-module "Money for household services" block was replaced** by the new Recorded spending card; S3's 30 and 90 day estimates were kept as a labelled Estimates block with a 12-month line added. The arrangement and provider pages are unchanged.
17. **The same-job hint** (same day, provider and asset, typed amounts on both, not linked) appears in the review notes only and never changes a total.
18. **Unknown is never $0:** counts of completed visits with no payment and Home & Assets records with no cost are shown as counts, not amounts.

## 15. Outstanding limitations and recommended future backlog

Limitations: all items in section 12's "not done"; a future one-off skip cannot be pre-recorded (S4); whole-record last-writer-wins can supersede one of two concurrent edits to one arrangement (S4); the union covers only these two modules; identical split parts with the same amount and category are interchangeable (H3, documented); Today does not show the three Overview-only conditions.
Recommended backlog (not built, per scope): Bills & Subscriptions (including linking a recurring Finance rule); a stored "skip this date" list; a Today card for stale payment links; an optional "maintenance only" switch for the union; validating accounts on restore (the S4-noted dateless account); bulk duplicate resolution with Undo; seasonal scheduling and holidays; Family Management; Personal CRM; AI assistant (the pure readers are a ready, read-only context surface).

## 16. Mutation and fault-injection evidence

28 one-at-a-time changes to the S5 code (script outside the repository; each applied, tests re-run, file restored): typed amount counted despite a Finance link (1 test failed), pairs ignored (9), visit/record owner swapped (4), second typed amount not left out (8), undated typed counted in a period (1), linked-in-both for every piece (2), cross-module covered part not shared (1), differing typed not flagged (1), dangling link not reported (1), covered parts dropped from the reconciliation (2), merged claims marked included (14), hint ignores the asset (1), unknown ignores the job (1), stale-reference attention removed (1), paused arrangements upcoming (1), expected visits ignore the open Task (2), contract window widened (1), duplicate handoffs never listed (1), unusual ratio loosened (1), no minimum history (1), seasonal swings judged (1), gap from one visit (1), shared payments judged (2), input-order dependence (1), shared payment given to a provider (2), prior period overlaps (2), per-month estimate multiplied (1). **First run: 24 of 28 caught.** The four survivors exposed gaps (no test for "unknown inside a linked job"; no test of a paused arrangement with a kept Task; the determinism test had no case where order mattered) and one **equivalent mutant** (a line that could not change behaviour, since a record with Finance references never had a typed amount; the dead line was removed). Tests were added; the three real survivors were re-run and **caught**. Final state: all caught or removed. Rollback and injected-failure tests for writes are S4's; S5 writes nothing.

## 17. Final passing test counts and Git status

`npm test`: **133 files, 2,265 tests, all pass.** `npx tsc --noEmit`: clean. `npm run build`: succeeds. `git diff --check`: line-ending notes only.
Git: branch `main`, `HEAD` = `origin/main` = `c906b9c8c721a191b3f720463d046555d8274291`. **Nothing staged. Nothing committed. Nothing pushed. No deployment triggered.** Changed: 4 modified source files (`OverviewPage.tsx`, `PaymentUI.tsx`, `services.css`, `views.ts`) and 5 docs (`README.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/module-hooks.md`, this report); untracked: 5 new source files and 4 new test files.

## 18. Handoff and backlog update confirmation

`docs/CHATGPT-HANDOFF.md` updated: **yes** (header and snapshot with the verified S4 commit and the green run #66, S5 section, risks, next action, change log; S4 recorded as committed and deployed; S5 as built, uncommitted, not accepted on real devices). `docs/BACKLOG.md` updated: **yes** (S5 entry on top). `docs/module-hooks.md` and `README.md` updated. **Unknown:** nothing beyond the not-verified list in section 12. Per `CLAUDE.md`, I did not commit or push; the owner authorizes that after independent review.
