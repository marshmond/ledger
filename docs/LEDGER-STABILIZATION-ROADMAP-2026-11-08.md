# Ledger stabilization roadmap (companion to the S0 audit)

**Date:** 2026-11-08. **Source:** `docs/LEDGER-STABILIZATION-S0-AUDIT-2026-11-08.md` (finding IDs below are defined there, with evidence). **Status:** PLANNING ONLY. These phase names are labels, **not authorization** to build anything. Each phase needs the owner's explicit go-ahead after ChatGPT's review, and none is committed, pushed or deployed without a separate yes. Nothing here starts Family Management.

**Baseline for every phase:** `main` = `8e77af4` (B5, Pages run #74 success), **3,310 tests in 179 files**, `tsc` clean, build succeeds. Each phase re-verifies that gate before touching code, ends with a dated report, and refreshes `docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md` as `CLAUDE.md` requires.

---

## 1. Order and why

1. **ST-S1 first**, because it holds both P1 findings, the one confirmed edit-loss path, and a **dated trap**: the test failure that blocks deployment between **2027-01-03 and 2027-01-15** (`TS-01`). The hosting decision (`SE-01`) is the owner's, needs no code, and should start immediately because it takes calendar time.
2. **ST-S2** next: the same family of problem as `DI-01` (deleting something other records depend on), plus the small tidy-ups that stop the module tangle growing before Family Management.
3. **ST-S3** (accessibility and phones) after S2, so the owner's real-phone pass tests the fixed version, not the old one.
4. **ST-S4** is **optional in part**. Only the script-size item (`PF-01`) and the dated/timeout test items have real value; the rest is polish. It may be folded into S3 or S5.
5. **ST-S5** closes with owner-led acceptance on real devices and a disaster-recovery drill.

**Not recommended as phases (the evidence does not support them):** replacing or redesigning sync; changing the data model or schema; adding a backend or authentication; adding dependencies; rewriting any Finance engine; chasing performance beyond `PF-01`; a large UI redesign.

---

## 2. Gates at a glance

| Phase | Entry gate | Exit gate |
|---|---|---|
| **ST-S1** | S0 reviewed (ChatGPT and owner); O-1, O-2, O-3 answered; B5 gate re-verified (HEAD = `origin/main`, Pages success, tree clean, 3,310 / 179) | `DI-01`, `SY-01`, `TS-01`, `BK-01` fixed with tests; suite green **and** green with the clock at 2027-01-08; owner has chosen and carried out the `SE-01` option; Sync-page figures (`SY-02`) recorded; committed only on the owner's go-ahead; deployment green |
| **ST-S2** | ST-S1 deployed and verified; O-4 and O-7 answered | Delete messages name linked records; bulk delete is one transaction; shared helpers extracted with no behavior change (golden masters untouched); deployed green |
| **ST-S3** | ST-S1 deployed (S2 preferred); owner can test on a phone | Automated sweep: 0 unlabeled fields on all 16 screens; targets meet the agreed minimum; owner's phone and screen-reader smoke pass recorded; deployed green |
| **ST-S4** (optional) | ST-S1 deployed; owner agrees which items | Lazy loading in; initial script size reduced by the agreed amount; offline first launch still works; timeouts lowered; deployed green |
| **ST-S5** | S1 to S3 deployed (S4 if done); owner has the devices and time | Section 14 matrix and section 7.1 drill signed off; open defects triaged; Family Management go/no-go decided in writing |

---

## 3. Phase detail

### ST-S1: Highest-priority correctness and data-safety fixes
- **Scope:** `DI-01`, `SY-01`, `TS-01`, `BK-01`; carry out the owner's `SE-01` decision; the owner's `SY-02` check.
- **Entry requirements:** see section 2. Owner answers O-1 (hosting option), O-2 (what deleting an account should do), O-3 (how many overwritten edits to keep).
- **Concrete deliverables**
  1. `DI-01`: deleting an account that still has scheduled rules or other records tied to it is blocked or cleaned up as O-2 decides, with a clear message that offers "close account" instead; posting a scheduled item whose account is missing is refused with a plain message; a **read-only** notice that lists any scheduled rule whose account is already missing (no automatic change to existing data).
  2. `SY-01`: overwritten edits are kept until reviewed (O-3), the top bar and Sync page show the true count, and if anything is ever dropped the screen says how many.
  3. `TS-01`: every privacy test that asserts "no short digit string appears" stops scanning text that carries record ids (assert on titles and details, or strip ids first); the privacy intent is kept in full; add a small guard that fails if a new test scans id-bearing text for a short number.
  4. `BK-01`: add `services-upcoming-days`, `tasks-last-view`, `ledger-last-module` to the preference list that backups carry.
  5. `SE-01` (owner-led, mostly outside the code): choose A, B, C or D from the audit; back up first; publish; move the data with "use the synced copy" or restore; re-install the Home Screen shortcut; confirm from the other apps' address that Ledger's storage is not visible. Code changes, if any, are limited to deploy configuration.
  6. `SY-02`: the owner reads the file size and uploads in the last 30 days from the Sync page and tells us the two figures; no code unless the figures are large.
- **Acceptance tests:** account with rules: delete is blocked or cleans up exactly as decided; posting with a missing account refuses and writes nothing; Today and Calendar show nothing for a refused rule; account deleted on one device, rule approved on the other, after sync (two-device test on the real engine); 120 simultaneous conflicts: all 120 recoverable and counted; the full suite passes normally **and** with the clock at 2027-01-08 12:00, and again at one random-looking date; backup then restore round trip includes the three preference keys; golden masters unchanged.
- **Stop conditions:** any fix that needs a new database table, a stored-record shape change or a sync-format change (stop and ask); any test that has to be weakened to pass (stop); a hosting move that cannot restore the owner's data in a trial run (stop and keep the current host).
- **Estimated complexity:** S to M for code; M for the owner-led hosting move.
- **Dependencies:** O-1, O-2, O-3.
- **Explicit exclusions:** Undo for Finance deletes; any change to the merge rules; cross-module delete warnings (that is ST-S2); new dependencies; Finance engines.

### ST-S2: Cross-module integration and workflow fixes
- **Scope:** `DI-02`, `UX-04`, `ARCH-01`, `ARCH-02`, `ARCH-03`, `UX-02`; `UX-01` and `NV-01` as the owner decides (O-4, O-7).
- **Entry requirements:** ST-S1 deployed; O-4, O-7 answered.
- **Concrete deliverables:** one read-only "which records point at these transactions" reader in `src/core` that works through the module registry (Finance does not import module internals); the single and bulk delete confirmations say, for example, "This payment is linked from 2 bills and 1 service visit"; bulk delete becomes one transaction; `loadHideAmounts` moves to `src/core` (14 importers updated); one shared safe-link check replaces three copies; one local-date helper replaces four (behavior identical); B5 wording that collides with the Finance "reconciled" status is reworded; Hide Amounts wording or scope per O-4; an optional Household finances page link in Search and Quick Add per O-7.
- **Acceptance tests:** delete message counts per module for whole and split references; bulk delete of 50 transactions is atomic when one fails; the five golden-master files, `b5-guards` and all existing tests pass **unchanged**; import-graph script shows 0 file cycles and `core` no longer imported from `today` for Hide Amounts; Hide Amounts tests (if scope changes) cover each newly covered screen.
- **Stop conditions:** the reader would require Finance to import module code (stop; use the registry); any change to a spend reader's output (stop); a refactor that touches more than the agreed files.
- **Estimated complexity:** M.
- **Dependencies:** ST-S1; O-4, O-7.
- **Explicit exclusions:** Undo for deletes (a separate feature decision); a "referential integrity layer"; changing spending semantics; B3.2.

### ST-S3: Mobile, accessibility and usability improvements
- **Scope:** `AX-01`, `AX-02`, `AX-03`, `AX-04`, `AX-05` (owner-led screen reader smoke), `UX-03` (destructive dialogs first), `UX-05`, and the real-phone pass for the findings it touches.
- **Entry requirements:** ST-S1 deployed (S2 preferred); an owner with a phone and, ideally, VoiceOver or TalkBack for 15 minutes.
- **Concrete deliverables:** accessible names for the Budget "Assigned" boxes and the Scheduled date and amount boxes (for example "Assigned to Groceries"); a static test that every input on every page has a name; larger hit areas for the top-bar links, checkboxes and inline links at phone width (agreed minimums: 24 px for everything, 44 px for primary controls) with desktop density unchanged; a skip link, an id on `main`, a `nav` landmark for the module bar, one `h1` per page and no skipped heading levels; the four contrast failures fixed and the dark theme and one custom palette checked; the account and transaction delete confirmations moved from the browser dialog to the styled dialog with the consequence list (other `confirm()` calls later); one short page or note that explains per-device settings.
- **Acceptance tests:** the structure sweep from the audit re-run on the same 16 screens: 0 unlabeled fields, 0 targets under 24 px, one `h1`, no overflow at 375 px; Tab walk of Today, Budget, Scheduled, Transactions and the Add dialog with focus always visible and restored; owner's phone checklist (audit section 14 rows 2, 3, 12) and a screen-reader smoke on Budget and Scheduled; `tsc`, tests and build green.
- **Stop conditions:** a change that visibly alters desktop layout density (stop and show the owner first); anything that needs a redesign (stop; no redesign is proposed).
- **Estimated complexity:** M.
- **Dependencies:** ST-S1; S2 preferred.
- **Explicit exclusions:** redesign; new components library; replacing every `confirm()` in one go; keyboard shortcut changes.

### ST-S4: Performance and test-suite reliability (optional in part)
- **Scope:** `PF-01`, `TS-02`, `TS-03`, `TS-05`, `SE-03`; `DI-03` only if the owner wants it.
- **Entry requirements:** ST-S1 deployed; the owner agrees which items (O-9).
- **Concrete deliverables:** screens load on demand per module (route-level lazy loading) with the service worker still pre-caching the shell so the first offline launch works; a target set with the owner (for example, the first-load script at about half of today's 2.28 MB) and measured before and after on one real phone; per-test timeouts of 60 to 180 s lowered to values that fit the real durations; the name-list source guards tightened where a new writer could slip past; a shared "frozen today" test helper; the service-worker cache trims old bundles on update.
- **Acceptance tests:** the full suite passes with the same test count or higher, no test weakened or skipped; CI time not worse; offline first launch tested in the browser pane with the network blocked; initial bundle size reported from the build; shifted-clock runs still green.
- **Stop conditions:** lazy loading breaks the offline first launch or any route (stop); a bundler or dependency change is needed (stop and ask).
- **Estimated complexity:** S to M.
- **Dependencies:** ST-S1.
- **Explicit exclusions:** new dependencies; changing the framework; micro-optimizing code that measured well (providers, search, snapshot reads); purging soft-deleted records without a separate design.

### ST-S5: Final acceptance, release readiness and regression validation
- **Scope:** the disaster-recovery drill (audit section 7.1), the real-device matrix (audit section 14), a full regression, document refresh, and the `SE-01` verification.
- **Entry requirements:** S1 to S3 deployed (S4 if done); the owner has the devices and a free hour or two per device class.
- **Concrete deliverables:** a signed results table for the matrix; the drill done with times recorded and the three secrets confirmed written down; `npm test` normally, in three time zones and at three shifted dates; `tsc`, build, `npm audit`; handoff and backlog refreshed with true deployed status; Family Management go/no-go recorded.
- **Acceptance tests:** every row in the matrix marked pass, or a defect logged with severity; drill steps 1 to 11 pass; no P0 or P1 open.
- **Stop conditions:** any P0 or P1 found (fix first); a sync defect on real devices (stop and re-plan, do not patch ad hoc).
- **Estimated complexity:** M, mostly the owner's time.
- **Dependencies:** S1 to S3.
- **Explicit exclusions:** new features; starting Family Management.

---

## 4. Finding-to-phase mapping

| Finding | Sev | Phase | Notes |
|---|---|---|---|
| SE-01 shared web address with other apps | P1 | **ST-S1** (owner-led) | Verified again in S5 |
| DI-01 account deletion orphans scheduled items | P1 | **ST-S1** | Needs O-2 |
| SY-01 conflict list capped at 50 | P2 | **ST-S1** | Needs O-3 |
| TS-01 id-digit test traps, **2027-01-03 to 2027-01-15** | P2 | **ST-S1** | Must land before the window |
| SY-02 repository history growth | P2 | ST-S1 (owner reads two figures) | Act only if large |
| DI-02 no dependency warning on transaction delete | P2 | ST-S2 | |
| UX-04 destructive Finance actions, plain confirmation | P2 | ST-S2 (message) and ST-S3 (dialog) | |
| AX-01 unlabeled inputs | P2 | ST-S3 | |
| AX-02 touch target sizes | P2 | ST-S3 | Real-phone check |
| PF-01 single 2.28 MB script | P2 | ST-S4 | Optional phase, but recommended item |
| BK-02 restore of GitHub copies never rehearsed | P2 | ST-S5 | Drill; optional later in-app list |
| BK-01 three preferences not backed up | P3 | ST-S1 | |
| ARCH-01 shared helper hosted in Today | P3 | ST-S2 | |
| ARCH-02 three copies of safe-link check | P3 | ST-S2 | |
| ARCH-03 four local-date helpers | P3 | ST-S2 | |
| UX-01 Hide Amounts scope | P3 | ST-S2 | Needs O-4 |
| UX-02 "reconciled" term collision | P3 | ST-S2 | |
| NV-01 Household finances not in Search or Quick Add | P3 | ST-S2 | Needs O-7 |
| AX-03 skip link, landmarks, headings | P3 | ST-S3 | |
| AX-04 contrast (4 items) | P3 | ST-S3 | |
| AX-05 form-error announcements | P3 | ST-S3 / S5 | Needs a real screen reader |
| UX-03 57 native dialogs | P3 | ST-S3 (destructive first) | |
| UX-05 per-device settings placement | P3 | ST-S3 | Document |
| UX-06 legacy versus new form practice | P3 | ST-S3 | Covered by AX-01 |
| TS-02 long per-test timeouts | P3 | ST-S4 | |
| TS-03 name-list source guards | P3 | ST-S4 | |
| TS-05 real clock in 26 test files | P3 | ST-S4 | Contained today |
| SE-03 service-worker cache never trimmed | P3 | ST-S4 | Unverified on device |
| DI-03 soft-deleted records never purged | P3 | ST-S4 (optional) or later | Needs a design |
| SY-03 no clock-skew warning | P3 | Backlog | Cheap: compare with GitHub's `Date` header |
| SY-04 403 wording, no retry back-off | P3 | Backlog | |
| DI-04 non-transactional repo steps | P3 | Backlog | Unverified |
| SE-02 plain `localStorage` secrets | P3 | Backlog (after SE-01) | Optional device lock |
| SE-04 8-character passphrase minimum | P3 | Backlog | Strength hint |
| SE-05 no security headers on Pages | Info | None | Platform limit |
| SE-06 Actions pinned by major tag | P3 | Backlog | |
| TS-04 no DOM tests, thin Tasks and Calendar coverage | P3 | Backlog | Decide with S3 findings |
| TS-06 manual mutation scripts | P3 | Backlog | |
| PF-02 whole-database reads | P3 | None (no action now) | Re-check if the Sync page shows several MB |
| DOC-01 handoff, backlog and memory out of date | P3 | Next authorized batch (each phase refreshes) | Compact the opening paragraph (O-8) |
| DOC-02 `CLAUDE.md` layout omits modules | P3 | Next authorized batch | |

---

## 5. Owner decision gates (answer in this order)

1. **O-1** hosting option for `SE-01` (A separate account or organization; B custom domain; C move the other apps; D accept). *Recommended: A or C.*
2. **O-2** account deletion behavior (`DI-01`). *Recommended: block, with "close account" and the list.*
3. **O-3** overwritten edits kept (`SY-01`). *Recommended: all until reviewed.*
4. **O-5** read the Sync page: file size and uploads in 30 days.
5. **O-4** Hide Amounts scope; **O-7** Search and Quick Add link for Household finances; **O-9** keep or fold ST-S4; **O-8** compact the handoff.
6. **O-6** who tests on which devices; **O-10** the person model, only when Family Management is next.

## 6. Family Management go/no-go evidence (from audit section 21)

Start only when: `SE-01` is resolved and verified; `DI-01` and `SY-01` are fixed with tests; the person-model decision (O-10) is written down; the script is split (or the owner accepts the size); the disaster-recovery drill has been run on real devices; and no P0 or P1 is open.

## 7. Calendar of time-sensitive items

| Date | Item |
|---|---|
| Now | Answer O-1; owner reads Sync page figures |
| Before **2027-01-03** | `TS-01` fixed and deployed (otherwise pushes between 2027-01-03 and 2027-01-15 will not deploy) |
| January each year | Tax tables need updating (existing convention in `CLAUDE.md`; unrelated to stabilization but near the same window) |

*End of roadmap.*
