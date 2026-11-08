# Ledger Stabilization S0: full-system audit (architecture, integration, reliability, usability)

**Date:** 2026-11-08 (America/New_York). **Author:** Claude (local implementation assistant). **Status:** AUDIT AND PLANNING ONLY. No application code, test, configuration, dependency, schema or existing document was changed. Nothing was staged, committed, pushed or deployed. The two new files are this report and `docs/LEDGER-STABILIZATION-ROADMAP-2026-11-08.md`.

**Privacy:** this document contains no real financial, personal or family data. All data used in checks was invented. The only outside names are the owner's public GitHub repositories, which are already public.

**How to read this:** every finding has an ID (for example `DI-01`), a severity (P0 to P3), a confidence level and its evidence. **Confirmed** means I reproduced it or the source states it unambiguously. **Unverified** means the risk follows from the source but I could not show it failing. Where something needs a real phone, a second device, a screen reader or real GitHub, it is listed as an unknown, never as a pass.

---

## 1. Executive summary (plain English)

**Short answer: Ledger is in good shape. It is not safe to call it finished, and a handful of things should be fixed before a new big module (Family Management) is built on top of it.** There are **no P0 findings**, **two P1 findings**, nine P2 findings and 29 P3 items (mostly tidiness and polish). Nothing I found is silently corrupting your data today.

The seven questions the brief asked:

1. **Is Ledger safe from foreseeable data loss and wrong money totals?** Mostly yes. Backup and restore are unusually careful, and the household spending maths agrees with an independent calculation. I found **one confirmed way to get a wrong total** (`DI-01`: deleting a bank account leaves its scheduled items behind, and approving one then posts a real transaction to an account that no longer exists) and **one confirmed way to lose edits during sync** (`SY-01`: if more than 50 edits clash at once, the extras are thrown away although the screen says nothing is lost).
2. **Do the modules cooperate without contradicting each other?** Yes. There are no circular imports at file level, one shared rule for counting a payment once, and the golden-master tests (157 tests in the five spending test files) all pass. Some modules lean on each other more than ideal (section 4), which is a tidiness issue, not a defect.
3. **Can it sync, back up and restore reliably?** Backup and restore: yes, on the evidence (checked files, "nothing was changed" on any failure, one all-or-nothing restore). Sync: the engine behaved correctly in every failure I simulated except the 50-conflict limit, but **it has never been tested on two physical devices**, and a phone with a wrong clock can win ties it should lose.
4. **Is it understandable and usable on every device?** No horizontal scrolling on any of the 16 main screens at phone width, and the Add dialog traps and restores keyboard focus correctly. But the Budget and Scheduled screens have **unlabeled input boxes** (a screen reader hears "edit text" with no name), and many tap targets are smaller than the usual 44 px. No real phone and no screen reader was used.
5. **Are the tests reliable enough to keep building on?** Yes, with one dated trap. All 3,310 tests pass, and they also passed under three time zones and five shifted dates. But **one test will fail between 2027-01-03 and 2027-01-15** (new record ids then start with "1799", which that test forbids), and because tests gate deployment, a push in that window would not deploy (`TS-01`, reproduced).
6. **What to fix now, and what can wait?** Fix now (ST-S1): `DI-01`, `SY-01`, `TS-01`, plus decide `SE-01` below. Next (ST-S2/S3): dependency-aware deletes, labels and tap targets. Later or optional (ST-S4): splitting the 2.28 MB script, tidying tests.
7. **What evidence would justify starting Family Management?** Section 21 lists it. In short: the `SE-01` decision (below) made and carried out, `DI-01` and `SY-01` fixed, a plan for what a "person" is (the app has two kinds today), and the script split.

**The most important finding is a hosting one (`SE-01`, P1).** Ledger is published at `https://marshmond.github.io/ledger/`. The same account also publishes two other web apps (`/FBB/` and `/Foodventory/`) on **the same web address root**. Browsers keep stored data per address root, not per folder, so **any page on those other two apps can read Ledger's database and the saved GitHub token and passphrases**. One of them loads two outside scripts and builds pages with `innerHTML` in 18 places. I did **not** test either app for vulnerabilities and found no sign of misuse; the exposure is how browsers work, and it is fixable without changing Ledger's code (section 8).

**What was run:** the full test suite (3,310 passed, 0 failed, 0 skipped, 49 s), the type check (clean), the production build (succeeds), `git diff --check` (clean), the five household spending test files by themselves, the whole suite again under three time zones and six clock dates, ten throw-away experiments on the real sync engine and a 50,000-transaction synthetic household, and an automated structure/accessibility sweep of 16 screens at desktop and 375 px in an isolated browser origin.

**What was not run (by design or because it needs your hands):** physical phones and tablets, a second real device, offline/airplane-mode tests, a screen reader, real GitHub sync, an older app build, and the six `scripts/*mutation-check.cjs` scripts (they edit source files in place, which S0 forbids).

### Findings at a glance

| Severity | Count | IDs |
|---|---|---|
| P0 critical | 0 | none |
| P1 high | 2 | `SE-01`, `DI-01` |
| P2 medium | 9 | `SY-01`, `TS-01`, `DI-02`, `AX-01`, `AX-02`, `PF-01`, `SY-02`, `BK-02`, `UX-04` |
| P3 low | 29 | see section 17 |

---

## 2. Exact repository and deployment state (the gate)

| Check | Result | Evidence |
|---|---|---|
| Repository | `marshmond/ledger` | `git remote -v` |
| Branch | `main` | `git branch --show-current` |
| Local HEAD | `8e77af465ed8b086c4b44106324c0991ac88d8f6` (`feat(household): B5 unified finances and cross-module reconciliation`) | `git rev-parse HEAD` |
| Equals `origin/main` | Yes, including the real remote | `git rev-parse origin/main` and `git ls-remote origin refs/heads/main` both `8e77af4…` |
| B5 committed and pushed | Yes | the B5 commit is the remote tip |
| Pages run for that exact commit | Run **#74** (id 42484194798), "Deploy to GitHub Pages", `push`, `completed` / `success`, 2026-11-08 13:16:53Z to 13:19:22Z | public Actions API (`gh` is not installed on this machine) |
| Run detail | `build` job: checkout, setup-node, `npm ci`, `npm test` (119 s), `npm run build` (4 s) all success; `deploy` job success (7 s) | jobs API |
| Working tree at start | Clean | `git status --short` printed nothing |
| Unexpected commits | None; `origin/main..HEAD` and `HEAD..origin/main` both empty | `git log` |
| Stabilization already started | No. The only existing file with "S0" in its name is `HOUSEHOLD-SERVICES-S0-PLAN-2026-11-06.md` (an older design plan) | `ls docs` |

**Gate result: passed.** The audit proceeded.

**B5 commit SHA:** `8e77af465ed8b086c4b44106324c0991ac88d8f6`. **Deployment run:** #74, success.

**Exact test baseline: 3,310 passing tests in 179 files** (re-run locally; section 23). The handoff and backlog still say 3,304 in 178; the six extra tests and one extra file came from B5's "final release checks" (Today unavailable state), which were added after those figures were written. This is a documentation drift item (`DOC-01`), not a test problem.

**Environment for all measurements:** Windows 11, Node 24.15.0, npm 11.12.1, Vitest 5.0.3, Vite 8.3.4, TypeScript 7.0.2, fake-indexeddb 6.2.5 (an in-memory stand-in for the browser database), Edge/Chromium-based Browser pane. CI uses Node 22 on `ubuntu-latest`.

---

## 3. Application inventory (read from source, not from earlier reports)

Counts: **484 non-test source files**, **179 test files**, **40 database tables** (34 Finance tables plus 6 shared tables), Dexie schema **version 15**. Module records for Tasks, Calendar, Projects, Home & Assets, Household Services and Bills all live in one shared table, `moduleRecords`, told apart by `module` and `kind`.

### 3.1 Modules (from `src/modules/index.ts` and the live registry)

Contribution columns come from the running registry: **D** = due provider (Calendar layer), **R** = linkable records, **S** = Search, **Q** = Quick Add prefix, **T** = Today cards.

| Module | What it does today | Data it owns | Writes data? | Contributes | Tests (files) | Known limits and backlog |
|---|---|---|---|---|---|---|
| **Finance (Ledger)**, incl. Accounts, Transactions, Budget, Scheduled, Forecast, Reports, Rules, Import, Investments, Debt, Income and tax, Retirement | Everything on `docs/ledger-inventory.md`: envelope budget, scheduled approvals, 2-year forecast, CSV import, tax and retirement engines | 34 typed tables (`txns`, `accounts`, `recurring`, `recurringLog`, `categories`, ...) plus the `settings` key/value table | **Yes**, directly from screens (49 of the 64 page files import the database; this is how the app was built) | D, R, S, Q (`$`, `b`), T (`ledger.attention`, `ledger.cash`) | `lib` 65 files / 914 tests, `modules/ledger` 2 / 15 | Hard deletes with no dependency check (`DI-01`, `DI-02`); money and tax engines were NOT re-audited for correctness (out of S0 scope); see `docs/roadmap.md` for the older feature wish-list |
| **Calendar** | Month/week/agenda, personal events, repeats with exceptions, reminders, derived layers from every due provider, `.ics` export, layer switches | `moduleRecords` kinds `calendar`, `event` | Yes (own events) | R, S, Q (`e`); consumes every provider; no provider of its own | 6 / 84 | Export offers only the Finance layer plus personal calendars (by decision); rolling 12-month view is the convention |
| **Tasks** | Quick add, lists, tags, checklists, repeats (`fixed` or `after completion`), bulk actions | kinds `task`, `list` | Yes | D, R, S, Q (`t`) | 2 / 29 (see `TS-04`) | No assignee concept (only `contactIds`) |
| **Projects** | Projects, budget lines, multi-line commitments, change orders, milestones, transaction tagging (`projectId` on `txns`), safe deletion | kinds `project`, budget lines, `commitment` | Yes | D, R, S, Q (`p`), T | 8 / 250 | Real-device acceptance was assumed by the owner, not performed |
| **Contacts (shared core)** | Names, relationship, notes, phone, email used by providers, vendors, projects | table `contacts` (also `tags`, `links`, `attachments`, `dueItems`) | via the shared store | n/a | `core` 3 / 47 | Very thin model (no birthday, address, role); `attachments` and `dueItems` were unused by any screen as of 2026-11-05 (not re-checked) |
| **Home & Assets** | Asset registry and hierarchy, maintenance as linked Tasks, durable service history, Finance references, warranties, lifecycle, overview | kinds `asset`, `service`, `warranty` | Yes | D, R, S, Q (`a`, `svc`), T | 11 / 252 | Real-device acceptance not done |
| **Household Services** | Providers, standing arrangements, recurring visits (12 months visible), only the next actionable visit is a Task, payments, contract dates, insights | kinds `arrangement`, `visit` | Yes | D, R, S, Q (`hs`), T | 28 / 610 | Real-device acceptance not done |
| **Bills & Subscriptions** | Obligation registry, billing cycles and reminders, Finance payment links, discovery of recurring charges, Finance Scheduled link, subscription lifecycle and price history | kinds `obligation`, `cycle` (billing facts), `lifecycle`, `discovery` | Yes | D, R, S, Q (`bs`), T | 34 / 841 | B3.2 (create Finance Scheduled from a bill) not started; legacy B1 future-dated End presentation |
| **Household finances** | One read-only overview of commitments, expected payments and recorded spending across Bills, Services and Home & Assets | none (derives only) | **No** (guarded by tests) | T only (no Search, no Quick Add, by decision O-19) | 7 / 141 | Export deferred; exact-equality fold rule |
| **Today** | Agenda, reminders, overdue, upcoming, plus each module's attention card; Hide Amounts switch; per-device layout | none | No | S, T | 1 / 32 | Layout and Hide Amounts are per device (browser storage) |
| **Search and Quick Add (shell)** | Global search (`Ctrl+K` or `/`), Add box with prefixes, N shortcut | none | via modules | n/a | `shell` 5 / 28, `search.test` 16 | Household finances not registered (decision) |
| **Global Settings (G1)** | Appearance, Data & Backups, saved themes, preferences | `settings` table plus `localStorage` | Yes | n/a | in `lib` | `PREFERENCE_KEYS` list is hand-kept (`BK-01`) |
| **Backup and restore** | Plain and encrypted export, checked restore, pre-import safety copy, 10-day reminder, weekly encrypted copies to the private repo | reads all tables | restore replaces all | n/a | `lib` (60 tests across five files: `backupFile`, `backupG1`, `backupCoverage`, `backupEncryptedRestore`, `autoBackup`) | Restoring a GitHub copy is manual (download, then restore) |
| **Synchronization** | One encrypted file in a private GitHub repo, record-level merge, conflict copies, safety copies | meta database `ledger-sync-meta` | writes merged data | n/a | `lib/sync` 28 (`sync.test`) + 8 (`skip.test`), plus each module's two-device tests | Whole-database each time; never run on two real devices |
| **Navigation and shell** | Module switcher, per-module tab bars, hash routes (`#/bills`), legacy address forwarding | none | No | n/a | `shell`, `core` | Module bar is not a `nav` landmark (`AX-03`) |

### 3.2 Today cards and Calendar layers (from the running registry)

Today cards: `today.agenda`, `today.reminders`, `today.overdue`, `today.upcoming`, `projects.attention`, `bills.attention`, `assets.attention`, `household.attention`, `services.attention`, `ledger.attention`, `ledger.cash` (11 in all). Calendar layers from providers: Finance, Tasks, Projects, Home & Assets, Household Services, Bills & Subscriptions.

### 3.3 Duplicate responsibilities, overlapping workflows and inconsistent terminology

- **Two kinds of "person".** Finance's `people` table (name, birth year, used only for tax rules) and the shared `contacts` table. Birthdays link to `contacts`. This matters for Family Management (section 21).
- **Three copies of the safe-link check** (`isSafeUrl` in `assets/validate.ts`, `bills/util.ts` and `services/model.ts`) and **four local-date helpers** (`core/time.localISO`, `lib/money.todayISO`, `lib/backupFile.localDay`, `assets/maintenance.ts`). They agree today; `ARCH-02`, `ARCH-03`.
- **"Reconciled" means two different things**: a Finance transaction status (matched to a bank statement) and the B5 word for "the household figures add up". `UX-02`.
- **Service work appears in three places** (a Services visit, a Home & Assets service record, a Bills payment). The design handles this on purpose (one payment is counted once, typed amounts are never matched by value). The three can still show a "possible duplicate" hint that needs a person to decide.
- **Hide Amounts** is called one thing but applies to some screens only (`UX-01`).
- **Two Calendar export paths** (Finance's own "Add to my calendar" file and the Calendar's export dialog) that deliberately share event ids so a phone calendar does not show doubles.

---

## 4. Architecture and dependency map

### 4.1 Diagram

```
                       BROWSER (static site on GitHub Pages; no server of Ledger's own)
 ┌───────────────────────────────────────────────────────────────────────────────────────────────┐
 │ SHELL  ModuleBar · GlobalFrame · Search (Ctrl+K) · Add box (N) · hash router · per-module tabs │
 └───────────┬───────────────────────────────────────────────────────────────────────┬───────────┘
             │ registry (src/core/registry.ts): each module declares what it contributes│
   ┌─────────▼──────────────────────────────────────────────────────────────────────────▼───────┐
   │  MODULES                                                                                    │
   │  Today ◄──────── cards ───────────────────────────────────────────────────────────────┐     │
   │  Calendar ◄── due providers (derive, never store) ◄── Finance · Tasks · Projects ·     │     │
   │                  queryProviders(window) in parallel     Home&Assets · Services · Bills │     │
   │  Tasks  ◄── single place Tasks are created: assets maintenance, services next visit,    │     │
   │              bills reminders, project milestones  (core/taskBridge, tasks/data.ts)      │     │
   │  Finance transaction-reference flow:                                                    │     │
   │     Bills facts / Services visits / Assets service records ── txnRefs ──► Finance txns  │     │
   │         readers: spend() · householdSpend() · billsRecordedPayments()  (unchanged)      │     │
   │                        └──────► Household finances: merge by pieceKey (read-only) ──────┘     │
   └───────┬─────────────────────────────────────────────────────────────┬──────────────────────┘
           │ shared store (src/core/store.ts): soft delete, links, repo     │
   ┌───────▼────────────────────────────────────────────────────────────────▼───────────────────┐
   │ DEXIE / INDEXEDDB "ledger" v15: 34 Finance tables + contacts, tags, attachments, links,       │
   │ dueItems, moduleRecords (JSON `data`, indexed by module and [module+kind])                    │
   └───────┬──────────────────────────────────────┬──────────────────────────────┬──────────────┘
           │ installTracking: updatedAt on every   │ exportAll/importAll          │ Sync meta DB
           │ write; time-based ids                 │ (backup.ts, backupFile.ts)   │ "ledger-sync-meta"
   ┌───────▼───────────────┐              ┌────────▼─────────────┐     ┌──────────▼──────────────┐
   │ SyncEngine (merge.ts) │              │ Plain / encrypted    │     │ safety copies, conflict │
   │ whole DB → JSON → gzip│              │ backup; weekly copy  │     │ list, base ids          │
   │ → AES-GCM → 1 file    │              │ to private repo      │     │ (this browser only)     │
   └───────┬───────────────┘              └────────┬─────────────┘     └─────────────────────────┘
           └────────────► private GitHub repo `ledger-sync.bin` + `backups/*.ledgerbackup` ◄──────┘
   Outside hosts allowed by the Content-Security-Policy: api.github.com and api.twelvedata.com only.
```

### 4.2 Measured dependency facts (script run on all 484 non-test files)

- **Circular imports: 0 at file level** (value imports), with or without test files.
- **Mutual module pairs** (A imports B and B imports A): `assets` and `services`; `household` and `services`; `projects` and `services`; `calendar` and `today`. Each pair is file-acyclic, but the modules are tangled at module level. The specific cross-module edges:
  - `bills` imports `assets/spending.ts` (the shared spend engine), `tasks`, `today`.
  - `household` imports `assets`, `bills`, `services`, `today` (this is its job: it reads them).
  - `services` imports `assets`, `projects`, `tasks`, `today`, and one file from `household` (`RelatedBillCard`, so Services shows the related bill).
  - `assets` imports `calendar`, `projects`, `services`, `tasks`, `today`.
  - `projects` imports `calendar`, `services`, `tasks`.
  - `calendar` imports `tasks/quickAdd.ts` (the event shorthand reuses the task parser) and `today`.
  - `ledger` imports `today`. `today` imports `calendar`.
- **A hidden shared helper:** 14 files in 8 modules import `loadHideAmounts` from `src/modules/today/layout.ts`. That one function belongs in `src/core/` (`ARCH-01`).
- **Resolved since the 2026-11-05 audit:** Tasks no longer imports Calendar (recurrence and time helpers now live in `src/core/recurrence.ts` and `src/core/time.ts`; the cross-module edge list contains no Tasks-to-Calendar import); the backup-coverage test now exists. I did not check which modules read another module's tables directly; the guard tests cover the Household finances module only.

### 4.3 Where a shared helper is right, and where isolation must stay

| Shared helper is appropriate | Keep modules isolated |
|---|---|
| `loadHideAmounts` (to `core`), the safe-link check, one local-date helper, one "who references this record" reader (before Family Management) | The Household finances overview must stay read-only and must keep calling the three spend readers unchanged (guard tests enforce it). Bills' single link writer (`assertBillsLink`). Each module's own deletion guards (assets, projects). Finance's money engines. |

No restructuring was done in S0.

---

## 5. Data integrity assessment

**What is strong (verified by reading source and running tests):**
- Stable identities: time-based ids from `newId()` (`src/lib/sync/track.ts`); built-in records use fixed ids; names are labels only.
- Unknown-field preservation: shared-store `repo.put` spreads the existing record; Tasks and Events have dedicated tests (`unknownFields.test.ts`); my experiment E4 showed unknown tables and fields from a newer app version survive a sync through an older version.
- Atomic operations: module writers use Dexie transactions; restore is one transaction (`importAll`); sync's local write re-checks that a record was not changed while syncing.
- Soft deletion for shared records, with guarded Undo in Bills and Services (tested).
- Duplicate prevention: natural-key collapse in the merge, check-then-insert in a transaction for built-ins, one actionable Task per arrangement.
- Versioned migrations: 15 Dexie versions; the backup `schemaVersion` is tested against the Dexie version.

**Findings**

### DI-01 (P1, Confirmed, reproduced) Deleting a Finance account leaves scheduled items pointing at it, and approving one posts to a missing account
- **Evidence:** `src/pages/LedgerPage.tsx:243-246` deletes each of the account's transactions, then `db.accounts.delete(id)`. Nothing touches `recurring`, `recurringLog` or any other record that stores an account id.
- **Reproduction (disposable browser origin, invented data):** (1) seed an account with two scheduled rules; (2) run the same two calls the Delete account button runs; (3) the two rules still exist with the dead account id; (4) open Scheduled, Home, Calendar and Today: the rules still appear, overdue, each with an Approve button, with no error; (5) press Approve: a real transaction (`-$1,800.00`, pending) was written with the dead account id; the Transactions page shows it as "Unknown account"; (6) `src/lib/spending.ts` and the reports do not filter by account, so it counts in spending.
- **User impact:** after closing a bank account the "wrong way", every missed monthly or biweekly item stays on Today and Calendar as overdue forever (in my test: 34 Approve buttons), and approving one inflates spending with a transaction no account page can reach.
- **Why P1 and not P0:** it needs two deliberate steps (delete an account that still has rules, then approve one); the orphan is visible ("Unknown account") and deletable; no existing data is damaged.
- **Correction:** block deleting an account that has scheduled rules or linked records unless the owner chooses what happens to them (end, move, or delete the rules), prefer "close account" in the wording, and refuse to post a scheduled item whose account is missing.
- **Complexity:** S to M. **Depends on:** owner decision O-2. **Tests needed:** account delete with rules (blocked or cleaned), posting with a missing account refuses, Today and Calendar show nothing for a refused rule, backup/sync round trip of the cleaned state. **Blocks Family Management:** no, but it is the pattern every new cross-link will need.

### DI-02 (P2, Confirmed by source) Deleting a Finance transaction gives no warning that household records depend on it, and cannot be undone
- **Evidence:** `deleteTxn` (`src/lib/transfers.ts:189`) hard-deletes (`d.txns.delete`). The confirmations say only "Delete this transaction?" (`LedgerPage.tsx:223`, `TransactionsPage.tsx:317`). `bulkDelete` (`src/lib/txnBulk.ts:50`) deletes one at a time, each in its own transaction, so an interruption can leave a partial deletion. Bills, Services, Home & Assets and Projects all hold references (`txnRefs`, payment-link facts, `projectId`).
- **What already protects you:** the household readers treat a missing transaction as "counts nothing, needs review" (golden-master test), and each reference keeps a snapshot (date, payee, amount). So nothing crashes and no total is wrong afterwards; the owner just learns about it later.
- **Impact:** a bill silently reverts to unpaid, or a service payment disappears from the household total, with the cause far from the screen where the delete happened.
- **Correction:** one shared read-only reader, "which records point at these transactions", used by the delete confirmation to say "This payment is linked from 2 bills and 1 service visit"; make bulk delete one transaction. Do not add Undo in S0's scope; it is a separate decision.
- **Complexity:** M. **Tests:** counts per module in the message, bulk delete atomic.

### DI-03 (P3, Confirmed by source) Soft-deleted shared records are never purged
`src/core/store.ts` only sets `deletedAt`; no code path removes old soft-deleted `moduleRecords`, `links` or `contacts`. They stay in the database, every backup and every sync file. Growth is slow and no data is at risk; the cost is size over years. A purge would need care with the 365-day tombstone rule.

### DI-04 (P3, Unverified) Read-then-write in the shared `repo` is not transactional
`repo.remove` and `repo.put` read a record and then `put` it in separate steps (`src/core/store.ts`). Module writers wrap them in transactions where it matters, so I could not make it fail.

### Orphaned references (assessment)
There is no referential-integrity layer. Each module guards its own deletions (assets, projects, contacts have guard tests); Finance does not (`DI-01`, `DI-02`). Stale references are handled at read time by every household reader.

---

## 6. Synchronization and offline reliability

I read the whole engine (`src/lib/sync/*`) and ran five experiments on the **real** `SyncEngine` and merge over fake-indexeddb with real encryption (scratch files outside the repository). Four classes of evidence are kept apart.

### 6.1 Proven safe by the existing tests
Two devices converge both ways; the later edit wins and the loser is saved and can be "put back"; deleted-on-one and edited-on-other (deletion stands, edit saved); a clash on the remote retries up to three times; wrong passphrase changes nothing; first sync on a new device never merges blindly and takes a safety copy; restoring a backup while sync is on; calendar, tasks and every module's records ride along; GitHub client maps 401, 404, 409 and 422 correctly (stubbed network); weekly backup upload, trimming and failure reporting. Each Bills, Services, Assets and Projects phase added two-device tests on the real engine.

### 6.2 Simulated in this audit (scratch harness, invented data)
| # | Scenario | Result |
|---|---|---|
| E1 | Both devices edit the same 80 records while apart | The merge reported all 80 conflicts; **only 50 were kept** in the "edits that lost a tie" list. 30 overwritten versions are gone (`SY-01`) |
| E2 | One device's clock is a day fast | Its earlier edit beat a later real edit on the correct clock; the loser was saved as a conflict (`SY-03`) |
| E3 | The upload fails after this device already applied the other device's changes | The next sync converged; both devices ended identical, nothing duplicated or lost |
| E4 | The shared file contains a table and a field from a newer app version | An older device synced without dropping either; both survived in the uploaded file |
| E5 | Two devices edit different fields of one record | Whole-record last-writer-wins: the other device's field is dropped (documented behavior; the loser is saved) |

### 6.3 Plausible risks supported by source evidence (not shown failing)
- **`SY-02` (P2) Sync history growth.** Every upload is a new encrypted file in git, which cannot be compressed against the previous one. On a synthetic household of 50,000 transactions the encrypted file was **0.72 MB** (0.97 MB uploaded as text). The Sync page shows the real file size and uploads in the last 30 days, so the owner can check; I could not (no real data, no real repository). If the real file were 0.2 MB and uploaded 10 times a day, history would grow about 0.7 GB a year. This is the unresolved item 1 from the 2026-11-05 audit. See O-5.
- **`SY-03` (P3) No clock-skew warning.** `updatedAt` is the device clock (`track.ts`). GitHub's reply carries a `Date` header the app could compare. Documented trade-off in `docs/sync.md`.
- **`SY-04` (P3) GitHub failure handling.** A 403 from rate limiting is explained as a token-permission problem (`github.ts` `explain`), and an expired token (401) is retried every five minutes, on every tab return and after every change, with no back-off.
- Tombstones are remembered 365 days; a device offline longer could bring back a deleted record (documented).
- No format or app-version field is checked when reading the shared file (only a magic number); acceptable while one person updates every device.

### 6.4 Unknowns that need hands-on acceptance
Two physical devices syncing through real GitHub; airplane-mode edits on both; iOS Safari behavior of timers and background tabs (the "every 5 minutes while open" trigger); an older cached build syncing with a newer one; GitHub rate-limit behavior; Safari's storage-eviction rules for sites not added to the Home Screen (the app asks the browser for persistent storage at start, `src/pwa.ts:11`, and the Backup page shows whether it was granted).

**Not recommended:** replacing or re-architecting sync. The evidence does not justify it.

---

## 7. Backup and disaster recovery

**What I verified in source and tests:** exports read every table in one read-only transaction; the file carries a manifest of record counts; restore checks version (refuses a newer file), unknown tables (refuses rather than silently dropping), duplicate or missing ids, record counts (detects a truncated file), then makes a safety copy of current data and restores in **one all-or-nothing transaction**; encrypted files use PBKDF2 (310,000 rounds) plus AES-GCM with a fresh salt and nonce; the price-API key is never exported or synced; sync secrets are deliberately excluded from backups; the file-check failure messages say "Nothing was changed", and a failed restore says the existing data was left as it was. `backupCoverage.test.ts` fails if a new table is not in the backup (the 2026-11-05 audit's gap is closed).

**Could a normal household user restore without losing important information?** Yes for the data. Three things need the owner's attention:
1. **The GitHub token and both passphrases live only in that browser** (by design). The Backup and Sync pages say plainly that a passphrase cannot be recovered. If the browser's data is cleared and the passphrases were not written down, the encrypted copies cannot be opened. The "If something happens" guide page tells family where a password manager is, but nothing in the app prompts the owner to record these three secrets.
2. **Restoring a weekly GitHub copy is manual** (download from GitHub, then use "Restore an encrypted backup"). Fine, but it is a rehearsal-worthy path (`BK-02`).
3. **Per-device preferences** restore only if listed in `PREFERENCE_KEYS`; three are missing: `services-upcoming-days`, `tasks-last-view`, `ledger-last-module` (`BK-01`, cosmetic).

### 7.1 Disaster-recovery acceptance checklist (proposed; use a throw-away browser profile and invented data)
| # | Step | Pass criteria |
|---|---|---|
| 1 | Seed a household that has at least one record of every kind (tasks with repeat, an arrangement with a logged visit, a bill with a linked payment, an asset with a warranty, a project with a commitment, a contact) | Counts noted per table |
| 2 | Export a plain backup and an encrypted backup | Both files download; plain file warns it is unencrypted |
| 3 | Open each file in the checker (Restore screen) without restoring | Summary counts equal step 1 |
| 4 | Tamper tests: cut the file in half; edit a count; add a fake table; set a newer version; change one id to a duplicate | Each is refused with a plain message and "Nothing was changed" |
| 5 | Restore into a **new empty browser profile** | Every count equal; Calendar, Today, Bills and Household finances show the same figures as before |
| 6 | Wrong passphrase on the encrypted file | Refused, nothing changed |
| 7 | Restore while sync is on, then sync from a second profile | Restored data wins; second profile matches; no doubled records |
| 8 | Join a second profile with "use the synced copy" | Safety copy saved first; result equals the main profile |
| 9 | Clear the main profile's browser data, then recover from the weekly GitHub copy using only written-down secrets | Full recovery; time taken recorded |
| 10 | Confirm after restore that sync token and passphrases must be re-entered, and that per-device layout is reset | As expected, documented |
| 11 | Restore an older backup on one device while the other has edited more than 50 records (after `SY-01` is fixed) | Every overwritten edit is recoverable |

Not run in S0: destructive restore on real data (forbidden); steps 5 to 11 on real devices.

---

## 8. Privacy and security

Distinguishing existing design trade-offs from vulnerabilities:

### SE-01 (P1, Confirmed configuration fact; exploitability Unverified) Ledger shares a web address root with two other apps
- **Evidence (public, read-only):** `https://marshmond.github.io/ledger/`, `/FBB/` and `/Foodventory/` all returned HTTP 200 on the same host; the account has exactly three public repositories and all three have Pages enabled. The live Foodventory page loads `cdn.jsdelivr.net/npm/@zxing/library@0.19.1` and `accounts.google.com/gsi/client`, uses `localStorage`, and contains 18 `innerHTML` assignments. FBB is a static page (its repository has a nightly workflow and daily data files) with 4 `innerHTML` uses and no outside scripts.
- **Why it matters:** browsers scope IndexedDB, `localStorage` and Cache Storage by **origin** (`https://marshmond.github.io`), not by folder. Ledger's Content-Security-Policy applies only to Ledger's own pages. Any script that runs on another page of that origin (a cross-site-scripting hole in one of those apps, or a compromised outside script) can read Ledger's whole database plus `ledger-sync-config` (GitHub token, sync passphrase) and `ledger-autobackup` (backup passphrase). With the token and passphrase an attacker could also read and overwrite the encrypted sync file and backups.
- **What I did not do:** I did not test either other app for vulnerabilities and have no evidence of misuse. The finding is the shared origin plus the presence of risky patterns next door.
- **Distinction:** this is a deployment-configuration weakness, not a bug in Ledger's code. A code change cannot fix it, because any code on the origin can read the storage.
- **Correction (owner choice, O-1):** serve Ledger from its own origin. Options: (A) publish Ledger under a separate GitHub account or organization (free; its address becomes that account's `github.io`); (B) give the Ledger repository a custom domain (costs a domain); (C) move or unpublish the two other apps. Moving origins means the new address starts with an empty database, so the migration is: make a backup, publish, then "use the synced copy" or restore, then re-install the Home Screen shortcut. A partial interim measure is an optional device passphrase that encrypts the saved token (not enough on its own, because the data in IndexedDB is readable too).
- **Complexity:** M (hosting change plus one careful migration). **Tests needed:** after the move, confirm from the other apps' address that Ledger's database and `localStorage` are not visible; confirm sync and backup still work. **Blocks Family Management:** it should be settled first (children's information is more sensitive than bills).

### Other privacy and security observations
| ID | Sev | Finding | Evidence and note |
|---|---|---|---|
| SE-02 | P3 | **Secrets in plain `localStorage`** (token, sync passphrase, backup passphrase) | `src/lib/sync/auto.ts`, `src/lib/autoBackup.ts`. Design trade-off for a no-server app; the damage is limited by `SE-01` being fixed and by the Contents-only token on a private repository. Optional device-lock encryption is the known improvement |
| SE-03 | P3 | **Service-worker cache never cleaned** | `public/sw.js` uses a constant `VERSION = 'ledger-v1'`, caches every hashed bundle it fetches, and only deletes caches with other names. Each deploy a device loads adds about 2 MB that is never evicted. Unverified on a real device |
| SE-04 | P3 | **Minimum passphrase length is 8** | `SyncPage.tsx:68`, `autoBackup.ts`. A leaked token allows an offline guess against the encrypted file; 310,000 PBKDF2 rounds slow it. A strength hint or 12 characters is cheap |
| SE-05 | Info | **Security headers cannot be set on GitHub Pages** | The policy is a `<meta>` tag (`src/shell/csp.ts`, build-only), so `frame-ancestors` (clickjacking) and other headers are not available. Platform limit, not a defect |
| SE-06 | P3 | **GitHub Actions are pinned by major tag** (`@v4`, `@v5`, `@v3`), not by commit | `.github/workflows/deploy.yml`. Workflow permissions are already minimal (`contents: read`, `pages: write`, `id-token: write`) |

**Checked and fine:** no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` in `src`; the only network calls are GitHub and Twelve Data (allow-listed in the CSP and guarded by `csp.test.ts`); external document links must be http(s) (`isSafeUrl`) and open with `rel="noopener noreferrer"`; the setup screen refuses a public repository; sync and backups are encrypted before leaving the device; `npm audit` reports **0 vulnerabilities across 99 packages in total**; the app has only six direct runtime dependencies. No telemetry or remote error logging exists.

**Hide Amounts and exports:** see `UX-01` (scope) and section 10 (Calendar export). The export dialog warns when Hide Amounts is on that the file still holds amounts; this is a deliberate, documented decision.

---

## 9. Finance and household reconciliation (the B5 architecture)

**Boundaries verified:** Finance owns transactions; Home & Assets, Services and Bills each hold references (`txnRefs` or payment-link facts) plus optional typed amounts; Household finances calls `householdSpend()` and `billsRecordedPayments()` **unchanged** and merges their resolved pieces by `pieceKey`. The household module's guard tests forbid it from writing or from importing the readers' internals.

**Golden-master and reconciliation tests run by themselves:** `b5-golden-master`, `b5-union`, `b5-commitments`, `s5-spend-matrix`, `b3-spend`: **157 tests passed in 1.5 s** (and all passed again in the full suite). They pin, with hand-worked dollar figures: whole and split de-duplication (the $150 payment reached by Services, Bills and Home & Assets counts once), refunds, partial payments and provider credits, typed amounts never matched by value, deleted or changed transactions ("counts nothing, needs review"), unknown is never zero, cash timing, the confirmed future-dated cancellation, and a 300-household random oracle.

| Question in the brief | Assessment |
|---|---|
| Whole/split de-duplication | Covered by golden masters and an independent oracle |
| Refunds | Covered, including across period boundaries (B5 release checks) |
| Typed payments | Never deduplicated against Finance by value (decision); a "possible duplicate" hint needs amount, a date within 7 days and the same provider or a `bills-for` link |
| Missing or stale references | Count nothing, flagged for review. No warning at the moment of deletion (`DI-02`) |
| Shared associations | One module or "Shared between modules"; never by list order |
| Category attribution | The overview attributes by module, not by Finance category; it deliberately says it is not all household spending |
| Pending, cleared, reconciled | All count as recorded spending; Finance's own status words are shown as a breakdown (`statusCents`) and never decide inclusion |
| Unknown amounts | Never zero; counted separately |
| Read-only behavior | Guard tests plus non-mutation fingerprints |
| Terminology | "Reconciled" collides with the Finance status word (`UX-02`) |

**Missing integration coverage (all P3, none a defect):**
- No automated check that **deleting an account or a transaction** leaves every module's figures consistent (this is exactly where `DI-01` lives).
- No test of a **Finance transaction edited to a transfer** after being linked beyond the unit case (`not-spending` state is covered at the unit level only).
- Browser-level checks of the overview were manual (B5 report section 21); nothing automated drives the page.
- Real two-device and real-data behavior: unknown.

**Possible "silent double count" to keep in mind (documented design, not a defect):** a payment typed as an amount in one module and also linked from Finance in another is two payments until a person resolves the hint.

---

## 10. Calendar and Tasks

**Method:** read each due provider; ran the provider code against a synthetic household (section 15); relied on the existing test suites for recurrence and Task conventions; inspected the export code.

| Area | Result |
|---|---|
| Rolling 12-month visibility (Services visits, Bills billing dates, renewals, cancellation deadlines, trial ends, Finance Scheduled approvals, asset warranties, project dates, milestones) | All are **derived at draw time** by providers (`queryProviders`) and never stored, so there can be no second copy to double up after a sync. A 12-month window produced about 9,000 derived items (Services 3,136; Bills 3,611; Tasks 1,600; Finance 483; Assets 184) in under 100 ms per provider in my benchmark |
| Only the next actionable service Task | Services creates the next visit Task only when the previous visit is logged; expected visits beyond are Calendar-only markers. The next-visit flow is exercised by Services' own test files (for example `cadence-flows`, `services-sync`, `visits-correction`), including two devices; I did not re-check the individual assertions or run the flow in a browser |
| Duplicate Tasks or markers | The same stable item id (`module:recordId:date`) is used for every redraw; Bills and Finance Scheduled coordinate with `coveredBy` so the same payment shows once while the other layer is visible (B3.1, tested) |
| Wrong date boundaries and time zones | Day arithmetic is done on date strings in UTC (`src/lib/dates.ts`); "today" comes from local-date helpers. **The whole suite passed unchanged in three time zones (UTC, UTC+14, UTC-11) and with the clock set to 2026-12-31 23:50, 2027-01-01 00:30, 2027-03-14 (US clock change), 2027-03-31 and 2028-02-29.** The two evening-time-zone defects flagged on 2026-11-05 are gone |
| Incorrect recurrence after moving an occurrence | Covered by Calendar and Bills tests (schedule identity, twice-monthly slot identity); no failure found |
| Orphaned Tasks | Bills and Services keep markers on their Tasks; a Task completed or deleted elsewhere is handled (tests); not exhaustively exercised by me |
| Misleading completed/paid states | B4's pre-commit correction (a future-dated cancellation never reads as Ended) is pinned by tests; Bills avoids words like "settled". No contrary evidence found |
| Layer visibility | Per-device (localStorage); Select all and Deselect all exist; the Finance layer honors Hide Amounts on screen |
| ICS identity and privacy | Derived items use stable ids (`icsUid`, for example `bills-<id>-<slot>@ledger.local`), so re-importing does not duplicate. Only the **Finance layer** and personal calendars can be exported (Bills, Services, Assets, Projects layers are not offered). The Finance export keeps full amounts even when Hide Amounts is on, and the dialog says so. Personal events export their notes and location. Calendar-export privacy options remain a deferred feature, not a defect |

**No confirmed defect** in Calendar or Tasks. Unverified: behavior on real phones, notifications (none exist), and Tasks has the thinnest direct test coverage of any module (`TS-04`).

---

## 11. Today, Search and Quick Add

- **Today** shows 11 card types (section 3.2). Each module card is counts-and-links; the household card shows only what the Bills and Services cards cannot, and now distinguishes loading, zero and unavailable. In my seeded test Today rendered correctly and the Add dialog opened from the "+" button.
- **Search** is a linear scan per module. With 50,000 transactions, 4,000 tasks, 300 bills and 200 assets the slowest source averaged **34 ms** (Tasks) and Finance **16 ms**; the rest under 5 ms.
- **Quick Add** prefixes: `$` and `b` (Finance), `e`, `t`, `p`, `a`, `svc`, `hs`, `bs`.
- **Deep links** use hash routes (`#/bills`, `#/household`); old addresses are forwarded.
- **Household finances is the only module with no Search and no Quick Add** (owner decision O-19, deferred). It is reachable from the module switcher, from the Today card, and (for a linked bill) from the Services arrangement page. It is **discoverable but not obvious**: a person who thinks "what do I spend on the house?" has no search hit for it. See `NV-01`.
- Missing or deleted references: handled with explanatory states in each module; no crash seen in my deletion test (`DI-01`).
- Duplicate notifications: one overdue bill can appear in the Today Overdue list and in the Bills attention card by design (list versus count); I did not find a case of the same item counted twice in one card.
- Workflows that need extra navigation (observed, P3): to see why a bill is unpaid you leave Today for the bill page; the household overview is two taps away from Today.

---

## 12. UX consistency

Findings are about consistency with existing standards; no redesign is proposed.

| ID | Sev | Finding | Quick win or larger? |
|---|---|---|---|
| UX-01 | P3 | **Hide Amounts covers some screens, not others.** It applies to Today, Calendar, Home "Coming up", Bills, Services, Assets, Household finances (18 screen files consult it). It does **not** apply to Accounts, Transactions, Budget, Reports, Net worth or Finance Home (none consults it). Anyone using it to protect a screen sees full balances one tap later | Owner decision O-4; quick win is clearer wording |
| UX-02 | P3 | **"Reconciled" has two meanings** (Finance statement status; B5 "figures agree") | Quick win: reword B5 |
| UX-03 | P3 | **57 browser `confirm()`/`alert()`/`prompt()` calls** (38 on 2026-11-05) beside the styled Modal. Native dialogs are accessible, but they look different, cannot carry a list of consequences, and cannot be tested | Larger; convert the destructive ones first |
| UX-04 | P2 | **Account and transaction deletion wording and Undo** (see `DI-01`, `DI-02`): the most destructive Finance actions have the plainest confirmation and no Undo | With DI-02 |
| UX-05 | P3 | **Settings placement**: per-device choices (layout, Hide Amounts, layer visibility) live in different places and are not synced, so a new device looks different (by design, documented) | Document in one place |
| UX-06 | P3 | **Legacy Finance screens vs newer modules differ in form and label practice** (section 13) | Part of ST-S3 |

Positive observations: consistent page headers and "About this page" panels; empty states with an action on Accounts and Transactions; no horizontal overflow on any checked screen at 375 px; calm wording in Bills and Services.

---

## 13. Accessibility

**Evidence levels are kept separate. No screen reader was used.**

| Level | What was done |
|---|---|
| Automated source/DOM checks | A DOM sweep of 16 screens at desktop width and at 375 px emulated width: missing names on buttons and links, unlabeled fields, headings, landmarks, duplicate ids, positive tabindex, image alt text, touch-target sizes, text-contrast sampling (about 2,800 text items at desktop width), reduced-motion CSS |
| Browser simulation | Emulated 375 px viewport (mobile user agent and touch points) in the Browser pane; real key events for the dialog test |
| Real keyboard tests | One dialog only (Add): see below. No full Tab walk of the app |
| Assistive technology | **None. Not done.** |

**Results**
- Passed everywhere checked: no unnamed buttons or links; no duplicate ids; no positive tabindex; no images without alt text; exactly one `main`; `lang="en"`; reduced-motion CSS present; live regions present (3 to 5 per page).
- **Add dialog (real keys):** `role="dialog"`, `aria-modal="true"`, labelled "Add"; focus moves into the dialog on open; **30 Tab presses and 3 Shift+Tab presses never left the dialog; Escape closed it and returned focus to the "Quick add" button.** The dialog does not scroll-lock the page or hide the background from assistive technology (`aria-modal` is relied on).

### AX-01 (P2, Confirmed by automated check) Unlabeled input boxes on two core screens
- **Budget (`/ledger/budget`):** 10 of 13 fields have no label, `aria-label`, `aria-labelledby` or `title`. They are the per-category **Assigned** boxes (`class="assign"`, placeholder "0.00" only).
- **Scheduled (`/ledger/scheduled`):** **68 of 77** fields have no name: the per-row **date** and **amount/text** boxes on due items.
- The newer modules (Bills, Services, Assets, Projects, Household, Calendar, Tasks) had **zero** unlabeled fields, so this is a legacy-screen gap, not a team habit.
- **Impact:** a screen-reader user hears "edit text" with no category or item name on the two screens used for money entry. **Correction:** add an `aria-label` that names the row ("Assigned to Groceries"). **Complexity:** S. **Tests:** a static-markup test that every input has a name.

### AX-02 (P2, Confirmed measurement; real-device impact Unverified) Small touch targets
At 375 px, for example `/today` has 77 interactive items and 40 are below 44 px in height or width; `/ledger/transactions` has 338 interactive items and 107 below 44 px. The "Settings" link in the top bar is **46 × 20 px on every page**; text links are 17 to 23 px tall; row checkboxes are 14 to 16 px. Items below 24 px fail the WCAG 2.2 AA minimum (2.5.8) unless an exception applies. **Correction:** raise the hit area (padding) of top-bar links, checkboxes and inline links on small screens without changing layout density on desktop. **Complexity:** M. **Needs** a real-phone pass to judge.

### P3 accessibility items
- **AX-03** No skip link; `main` has no id; the module switcher bar is not a `nav` landmark (Ledger pages have navs, the other modules have none); heading levels skip on Today, Tasks and Backup (h1 to h3), and the Backup page has **two `h1` elements**.
- **AX-04** Contrast: light theme only. 1 failure on Backup ("Data & Backups" 2.80:1) and 3 on Calendar (check marks 3.7 to 4.2:1). Dark theme and custom palettes were not checked.
- **AX-05** Form error announcements were not evaluated beyond noting that live regions exist; this needs a real screen reader.
- Focus restoration was verified for one dialog only; other dialogs share the same `Modal` (11 key tests in `modalKeys.test.ts`).

---

## 14. Mobile acceptance plan

Browser emulation (done here for 16 screens at 375 px) is only reconnaissance. **Nothing below has been done on a physical device.** Use invented data throughout. Record device, OS, browser, date, tester and result for each row.

### 14.1 Device matrix

| Class | Examples to cover | Notes |
|---|---|---|
| Narrow phone (about 360 to 375 px) | A small iPhone or an Android with 360 px width | Tests overflow and tap size |
| Standard phone (about 390 to 430 px) | A current iPhone and a current Android phone | The main daily device |
| Tablet (768 to 1024 px, portrait and landscape) | An iPad or Android tablet | Tab bars and two-column cards |
| Desktop | Chrome or Edge, Safari, Firefox at 1280 px and a narrow window | Keyboard focus and shortcuts |

### 14.2 Scenarios, expected results and pass/fail

| # | Scenario | Steps | Pass criteria | Evidence today |
|---|---|---|---|---|
| 1 | First-time setup | Open the site on a fresh browser, add to Home Screen, open it | Today opens; starter categories present; app launches full-screen; offline shell opens after one visit | Not done |
| 2 | Navigation | Visit every module from the switcher; use the bottom tab bar in Ledger; browser Back | No horizontal scroll; Back returns to the previous screen; no dead ends | Emulated 375 px: no overflow on 16 screens |
| 3 | Finance transaction entry | Add an expense with the "+" button and with the Transactions form, with the keypad-style amount option on and off | Amount, payee, category saved; keyboard does not cover the Save button | Not done |
| 4 | Household Service creation | Add a provider and an arrangement (every other Friday) | Arrangement saved; Calendar shows the visits for 12 months; exactly one actionable Task | Logic tested; UI not done on a phone |
| 5 | Recurring visits | Log the visit; open the next | The next visit becomes the Task once; a duplicate is not created if you tap twice | Tested in code; not on a phone |
| 6 | Bill creation and payment linking | Add a bill; link a Finance payment; link a second bill to the same payment | Payment counted once in Household finances; both bills show it | Logic tested; UI manual only in B3/B5 reports |
| 7 | Subscription cancellation | Record a future-dated cancellation | Status stays "Active until the date"; the effective-date marker shows; no "Ended" until the date arrives | Pinned by tests; not on a phone |
| 8 | Calendar visibility | Switch layers off and on, "Select all/Deselect all", open an item | Items appear and disappear as chosen; no layer can hide both halves of a covered pair | Not done on a phone |
| 9 | Tasks and reminders | Create, complete, reschedule a Task; check the reminder behavior | State changes persist after closing the app; note that **no push notifications exist** | Not done |
| 10 | Offline edits and sync | Turn on airplane mode on phone and laptop, edit the same and different records on each, go online, sync both | Both converge; the Review count shows overwritten edits; nothing lost; with `SY-01` fixed, every overwritten edit is listed | **Never done on real devices** |
| 11 | Backup and restore | Export plain and encrypted; restore into a second browser profile | See the checklist in section 7.1; counts equal | Not done |
| 12 | Hide Amounts | Switch on at Today; visit Bills, Services, Household finances, Calendar, then Accounts and Budget | Amounts masked on the first group; **record honestly that Accounts and Budget still show amounts** (`UX-01`) | Static tests only |

### 14.3 Cross-cutting pass criteria
Tap targets reachable with a thumb and not mis-hit; text readable at the phone's default size; dark mode readable; rotating the phone keeps the state; the on-screen keyboard never hides the field being typed in; Home Screen app and browser tab show the same data.

---

## 15. Performance

**Method:** a repeatable synthetic household (invented, deterministic) built in a scratch harness against the real code: **50,000 transactions** over 8 years in 6 accounts, 40 Finance scheduled rules, **300 bills**, **80 arrangements** with weekly or biweekly schedules, **4,000 tasks** (1,800 dated in the next year), 200 assets. Environment: Windows 11, Node 24.15, fake-indexeddb (in memory). **These are relative figures; phone speed was not measured and cannot be inferred.**

| Operation | Time |
|---|---|
| All six due providers, Today window (14 days overdue + 7 ahead) | 161 ms total |
| All six providers, one month | 134 ms total |
| All six providers, **twelve months** (about 9,000 derived items) | 159 ms total (Services 45, Bills 62, Tasks 36, Ledger 12, Assets 3) |
| Household finances overview, last 12 months | 168 ms |
| Backup export (`exportAll`) | 129 ms; JSON 11.7 MB (50 ms to stringify) |
| Sync snapshot read | 159 ms |
| Sync encode (JSON, gzip, PBKDF2 310,000 rounds, AES) | 148 ms; **0.72 MB** file |
| Search, per source, average of five queries | Tasks 34 ms, Finance 16 ms, others under 5 ms |

**Reading the numbers:** derivation cost is mostly constant (it loads each module's records) rather than growing with the window, so a 12-month Calendar costs about the same as a month. Each change that re-runs the live queries recomputes all providers, so a phone that is 5 to 10 times slower would still be well under two seconds. No full-table scan of `moduleRecords` was found in the module readers (they use the `[module+kind]` index). Existing tests also assert bulk-read counts (for example, B5 loads with at most two transaction reads for 300 bills and 3,000 transactions).

### PF-01 (P2, Confirmed) One script file of 2.28 MB (646 KB compressed), no code splitting
`npm run build` produces a single `index-*.js` of **2,278,657 bytes (641 KB gzip)** plus 109 KB of CSS. On 2026-11-05 it was 1.27 MB (369 KB gzip): **+80% in three days**, from the five new modules. Every launch parses all of it, including pages the user may never open. **Correction:** load each module's screens on demand (route-level lazy loading). **Complexity:** M. **Phone parse time is unmeasured** (needs a real device). Each new module (Family Management) adds to it.

### P3 performance notes
- **PF-02** Sync and backup read the whole database each time (159 ms and 129 ms here); fine at this scale, no action needed now. Re-evaluate if the Sync page's file size passes a few MB.
- Initial load: the page builds in 0.54 s; first-visit download is 646 KB compressed; the service worker serves repeat visits. Unmeasured on a phone.
- Memory: not measured.
- Redundant network activity: auto-sync's cheap "has the file changed" check is one request per run; confirmed by `skip.test.ts`.

---

## 16. Test-suite health

**Baseline:** 3,310 passed, 0 failed, 0 skipped, 0 todo, in 179 files; **49.4 s** locally (transform 9%, setup 8%, import 9%, tests 74%); **119 s** on the CI runner (2.4 times slower). No `.skip`, `.only` or `.todo` markers exist.

| Check | Result |
|---|---|
| Flakiness by time zone | **Passed in UTC, UTC+14 and UTC-11** (3,310 each) |
| Flakiness by calendar date | **Passed with the clock shifted to 2026-12-31 23:50, 2027-01-01 00:30, 2027-03-14 12:00, 2027-03-31 and 2028-02-29** (3,310 each). I proved the shift reaches the tests (they saw 2028-02-29 12:00) |
| Failure on one date | **2027-01-08 (inside 2027-01-03 to 2027-01-15): 1 failure** (`TS-01`) |
| Slowest single test | 3.8 s locally (Home & Assets overview performance test); 113 tests take over 1 s; none over 5 s |
| Longest file wall time | `b4-sync.test.ts`, 22 s with 20 tests (it runs with the other test files in parallel) |
| CI history | The last 30 runs: 28 success, 1 cancelled (superseded push), 1 failure (run #64: S3's date-dependent test, fixed in `d5cd5f9`) |

### TS-01 (P2, Confirmed, reproduced) A test will fail on a predictable date range and blocks deployment
- **Cause:** record ids are `Date.now() * 1000 + random(0..999)` (about 16 digits). Several privacy tests assert that short digit strings never appear in text that includes those ids. `src/modules/bills/b4-calendar.test.ts:112` forbids `1799`. Ids begin `1794` today; they begin `1799` from **2027-01-03 to 2027-01-15**.
- **Reproduction:** full suite with the clock at 2027-01-08: `b4-calendar.test.ts > titles and details never carry an amount...` failed; the message shows `bills:due-1799427600891530-m2…` matching `1799`. All other 3,309 passed.
- **Also flaky at random:** simulating 300,000 ids over the next two years, a given id contains a four-digit sentinel such as `1234`, `4455`, `4242` or `9900` about **0.11%** of the time (`1799`: 1.7% overall because of the window). Other tests that assert absence of `1234`, `12345`, `4455`, `4244`, `5000`, `7000`, `12000` or `11420` in text carrying ids (examples: `b2-views.test.ts:158`, `b4-calendar.test.ts:112`, `b3-sync.test.ts:250`) therefore have a small per-run failure chance.
- **Impact:** because `npm test` runs before every deploy, a push in the January window (or on an unlucky run) would build but **not deploy**. No product impact.
- **Correction:** assert on the title and detail text only (not on JSON that embeds ids), or strip ids before matching. Do not weaken the privacy intent. **Complexity:** S. **Must land before 2027-01-03.**

### Other test-health findings (P3 unless stated)
- **TS-02** Per-test timeouts: the global default is 30 s (raised from 5 s in B4), and **at least 126 tests override it to 60 to 180 s** (counted by pattern, so the true number may be slightly higher). The slowest real test is 3.8 s locally (about 9 s on CI at 2.4 times slower), so a hung test would hold CI for minutes. Lowering them does not reduce coverage. The brief asked me to revisit the 30 s default: it has roughly 3 times headroom over the slowest test on CI and is reasonable; the 90 to 180 s overrides are not.
- **TS-03** Source guards: 14 test files read source files as text (45 `readFileSync` calls) and match with regular expressions. Examples: Household files must not match `put|bulkAdd|update(`, must not call a named list of writers (`createTask`, `recordFact`, ...). They are useful tripwires, but a **new writer with a new name would slip past the name list**, and a refactor can trip them without any real change. They are backed by behavioral non-mutation fingerprint tests, which are the real proof. No vacuous assertions were found in the sample I read.
- **TS-04** No automated browser or screen tests. Only 5 test files render markup (`renderToStaticMarkup`); there is no DOM library or end-to-end tool. Tasks (2 files, 29 tests) and Calendar (6 files, 84 tests), the base of every other module, have the thinnest direct coverage, although recurrence is also exercised through Services, Assets, Bills and Projects tests.
- **TS-05** 26 test files use the real clock (`Date.now()` or `new Date()`) and only one file uses fake timers. The shifted-date runs show this is contained today. A shared "frozen today" helper would make it deliberate.
- **TS-06** The six `scripts/*-mutation-check.cjs` files are manual and **not** in CI; they edit source in place, so S0 did not run them.
- **Two-device simulations (known limitation):** they use the real `SyncEngine`, real encryption and fake-indexeddb with an in-memory remote. They cannot show real GitHub timing, rate limits, a real clock difference between devices, or a browser killing a background tab. The earlier correction of the backup-summary tests was not re-examined in detail; the summary logic is exercised by `backupG1.test.ts` and by the Bills sync-and-backup test files, which all pass (their module-specific summaries are tested in `b2-sync`, `b3-sync`, `b31-sync`, `b4-sync` and `sync-backup`).
- **Can the suite be faster or more reliable without reducing coverage?** Yes: lower the long timeouts (`TS-02`), fix `TS-01`, share seeding helpers. Speed is not a problem (49 s local, 2 min CI).

---

## 17. Findings register (P0 / P1 / P2 / P3)

Complexity: S = hours, M = about a day, L = several days. "Blocks" means blocks starting Family Management.

### P0: none.

### P1
| ID | Category | Confidence | Summary | Evidence | Fix | Complexity | Blocks | Phase |
|---|---|---|---|---|---|---|---|---|
| SE-01 | Security | Fact confirmed; exploit unverified | Ledger shares `https://marshmond.github.io` with two other Pages apps; one loads outside scripts and uses `innerHTML` | section 8 | Separate origin (owner decision O-1) | M | Yes (decide first) | ST-S1 (owner-led) |
| DI-01 | Data integrity | Confirmed, reproduced | Account deletion orphans scheduled rules; approving posts to a missing account | section 5 | Block or clean on delete; refuse to post | S-M | No | ST-S1 |

### P2
| ID | Category | Confidence | Summary | Fix | Complexity | Phase |
|---|---|---|---|---|---|---|
| SY-01 | Sync | Confirmed, reproduced (E1) | Conflict list capped at 50; extras discarded though docs promise nothing is lost (`engine.ts` `MAX_CONFLICTS`, `slice(0, 50)`); a restore on one device plus many edits on another can exceed it | Keep all until reviewed; warn on truncation | S | ST-S1 |
| TS-01 | Tests | Confirmed, reproduced | Id-digit sentinels fail 2027-01-03 to 2027-01-15 and about 0.1% of runs | Assert on text, not ids | S | ST-S1 (before 2027-01-03) |
| DI-02 | Data integrity | Confirmed by source | No dependency warning or Undo when deleting a Finance transaction; bulk delete not atomic | Reference reader in the confirmation; one transaction | M | ST-S2 |
| AX-01 | Accessibility | Confirmed (automated) | Unlabeled inputs: Budget (10 of 13), Scheduled (68 of 77) | Add names | S | ST-S3 |
| AX-02 | Accessibility | Measured; device impact unverified | Many targets under 44 px; some under 24 px | Larger hit areas on small screens | M | ST-S3 |
| PF-01 | Performance | Confirmed | Single 2.28 MB script, +80% in 3 days | Lazy-load routes | M | ST-S4 |
| SY-02 | Sync | Plausible, unverified | Repository history growth from whole-file uploads | Owner reads Sync page figures; act only if large | S (check) | Owner check, ST-S1 |
| BK-02 | Backup | Unverified | Restoring a weekly GitHub copy and the new-device path were never rehearsed end to end; secrets custody rests on the owner | Run checklist 7.1; optional in-app list and a reminder to record the three secrets | M | ST-S5 |
| UX-04 | UX | Confirmed | Most destructive Finance actions have the plainest confirmation and no Undo | With DI-02 | M | ST-S2 |

### P3 (low; none blocks anything)
`SY-03` clock skew; `SY-04` 403 wording and no back-off; `DI-03` soft-deleted records never purged; `DI-04` non-transactional repo steps (unverified); `BK-01` three preference keys not backed up; `SE-02` plain `localStorage` secrets (trade-off); `SE-03` service-worker cache never trimmed (unverified on device); `SE-04` 8-character passphrase minimum; `SE-05` no security headers on Pages (platform limit); `SE-06` Actions pinned by major tag; `AX-03` skip link, landmarks, headings, two `h1`; `AX-04` four contrast failures (light theme); `AX-05` form-error announcement unevaluated; `UX-01` Hide Amounts scope; `UX-02` "reconciled" collision; `UX-03` 57 native dialogs; `UX-05` per-device settings placement; `UX-06` legacy-versus-new form practice; `NV-01` Household finances not in Search or Quick Add; `ARCH-01` shared helper hosted in Today; `ARCH-02` three copies of `isSafeUrl`; `ARCH-03` four local-date helpers; `TS-02` long per-test timeouts; `TS-03` name-list source guards; `TS-04` no DOM tests and thin Tasks/Calendar direct coverage; `TS-05` real clock in 26 files; `TS-06` manual mutation scripts; `PF-02` whole-database reads (no action); `DOC-01` documents out of date; `DOC-02` `CLAUDE.md` layout omits modules.

### DOC-01 and DOC-02 detail
- `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md` and the auto-memory index still describe **B5 as "built, uncommitted, not pushed, not deployed"** and quote **3,304 tests in 178 files**. Actual: committed and deployed as `8e77af4` (run #74); 3,310 in 179. The handoff's opening status paragraph is also about 20 KB of nested "earlier text", which makes the current state hard to find. `CLAUDE.md` requires the handoff to be refreshed with each batch; S0 was forbidden to edit it, so this report only records the drift.
- `CLAUDE.md`'s "Layout" lists `lib`, `pages`, `data`, `db.ts` and `docs`, and omits `src/modules`, `src/core` and `src/shell`, where most of the app now lives.

---

## 18. Confirmed defects versus unverified risks

**Confirmed (reproduced or unambiguous in source):** `DI-01`, `SY-01`, `TS-01`, `DI-02`, `AX-01`, `PF-01`, `UX-04`, `BK-01`, `DOC-01`, `DOC-02`, `SE-01` (as a configuration fact), plus the measured P3 items `AX-02`, `AX-03`, `AX-04`, `UX-01`, `UX-03`, `ARCH-01` to `ARCH-03`, `DI-03`, `SE-03` (source only), `SE-04`, `TS-02`, `TS-05`.

**Unverified (follows from source, not shown failing, or needs a device):** exploitation of `SE-01`; `SY-02` real growth; `SY-03` real-world clock drift; `SY-04` real rate-limit behavior; `DI-04`; `SE-03` on a device; real touch-target usability (`AX-02`); screen-reader behavior (`AX-01`, `AX-05`); phone launch and parse time (`PF-01`); real-GitHub two-device sync; older-build interaction; iOS storage eviction; the disaster-recovery checklist steps 5 to 11; the Today and Calendar layout on a real phone.

**Not defects, deliberately:** whole-record last-writer-wins; unknown never zero; typed amounts never matched by value; Hide Amounts not hiding the Calendar export; no push notifications.

---

## 19. Recommended stabilization roadmap (summary)

The full roadmap with entry and exit gates is `docs/LEDGER-STABILIZATION-ROADMAP-2026-11-08.md`. These are planning labels, not authorization.

| Phase | Theme | Items | Size |
|---|---|---|---|
| **ST-S1** | Correctness and data safety | `DI-01`, `SY-01`, `TS-01`, `BK-01`, the `SY-02` check, and carrying out the owner's `SE-01` decision | S to M |
| **ST-S2** | Cross-module integration and workflow | `DI-02`, `UX-04`, `ARCH-01`, `ARCH-02`, `ARCH-03`, `UX-02`, `UX-01` (after O-4), `NV-01` (after O-7) | M |
| **ST-S3** | Mobile, accessibility and usability | `AX-01`, `AX-02`, `AX-03`, `AX-04`, `UX-03` (destructive dialogs first), real-device pass | M |
| **ST-S4** | Performance and test reliability | `PF-01`, `TS-02`, `TS-03`, `TS-05`, `SE-03`, optional `DI-03` | S to M, **optional in part** |
| **ST-S5** | Acceptance and release readiness | Disaster-recovery drill, real-device matrix, regression, documents refreshed, `SE-01` verified from the other origin | M, owner-led |

**Evidence-based deviations from the suggested sequence:** `SE-01` and `TS-01` are on a clock or an external decision, so they start first and run beside code work. No phase is needed for **replacing sync, re-architecting the data model, new dependencies or a backend**; the evidence does not support any of them. ST-S4 is the one phase that may be folded into S3 or S5 if the owner prefers fewer phases.

---

## 20. Future feature opportunities (explicitly NOT stabilization)

Family Management; Personal CRM; expanded Home & Assets; additional financial integrations (the owner has deferred bank-feed automation); optional Finance Scheduled creation from Bills (B3.2); expanded recurring-payment discovery; Calendar-export privacy options (including exporting the Bills, Services and Projects layers); new reports and exports from Household finances; Search and Quick Add for Household finances; an in-app list of GitHub backups to restore from; push notifications (deferred by the owner); an optional device lock for saved secrets; Undo for Finance deletes (a feature, with `DI-02` only adding a warning). Multi-user distribution readiness is **not** a priority and nothing here proposes it.

---

## 21. Family Management prerequisites (what matters before starting; no design)

Can the foundations carry Family Management without a major architecture change? **Yes, if the following are settled first.** None needs a new platform.

| Foundation | Today | What must be decided or done first |
|---|---|---|
| People | Two kinds: Finance `people` (name, birth year for tax rules) and shared `contacts` (name, relationship, notes, phone, email) | One decision: how a household member is represented and linked, **without** merging Finance's tax `people`. Contacts v2 fields (birthday and similar) will be needed. Two devices editing different fields of one record means one whole record wins, so a person with many details should be several small records (the convention the newer modules follow) |
| Important dates | Derived-not-copied due providers and rolling 12-month Calendar fit this well; a Birthday event type exists | A new provider is a normal contribution. Decide the Calendar-export privacy rule for family names before any export of that layer (deferred option today) |
| Tasks | Tasks have `contactIds`, no assignee; unknown fields survive sync | Adding fields is safe; the "who is it for" semantics need a decision |
| Document references | External http(s) links only (three copies of the check); no file storage, and the whole-file sync cannot carry files | Plan around links; one shared link check before a fourth copy |
| Childcare and school data | Not present | These are more sensitive than bills. **Settle `SE-01` first**, decide a masking rule like Assets' (address, serial numbers masked until shown), and decide whether such notes belong in plain backups |
| Referential safety | No integrity layer; per-module guards | A shared "who points at this" reader (also needed for `DI-02`) and the `DI-01` pattern, so deleting a person or school cannot leave dangling links |
| Local-first model | Sound; one file synced; new kinds ride `moduleRecords` with no migration | The 2.28 MB script grows again (`PF-01`) |
| Process | Reports, golden masters, guard tests | The `TS-01` fix, and a decision on how much of Family Management is read-only first |

**Evidence that would justify starting:** the `SE-01` move completed and checked; `DI-01` and `SY-01` fixed with tests; the person-model decision made in writing; the lazy-loading split in place; and a disaster-recovery drill done on real devices.

---

## 22. Owner decisions and unresolved questions

Recommended option first. Each is also in the roadmap.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| O-1 | How to isolate Ledger's web address from the other two apps (`SE-01`) | (A) publish Ledger under a separate free GitHub account or organization; (B) custom domain for Ledger; (C) move or unpublish the other two apps; (D) accept the risk | A or C, whichever is easier for you; both are free. Back up first; the new address starts empty and you restore or "use the synced copy" |
| O-2 | What deleting an account should do when it still has scheduled items or links (`DI-01`) | (A) block with a clear list, offer "close account" instead; (B) offer to remove its scheduled items too; (C) leave as is | A, with B as the action offered inside the message |
| O-3 | Limit on saved overwritten edits (`SY-01`) | (A) keep all until you review them; (B) raise the limit; (C) keep 50 but say loudly when more were dropped | A |
| O-4 | Scope of Hide Amounts (`UX-01`) | (A) leave as a Today-and-modules switch, relabel it; (B) make it app-wide | A for now; B if the purpose is protecting the screen in public |
| O-5 | Please read the Sync page: file size and "uploads in the last 30 days" (`SY-02`) | n/a | Tell us the two figures; act only if the file is above a few MB or uploads are in the hundreds a month |
| O-6 | Real-device acceptance: who tests, on which devices | The matrix in section 14 | Do ST-S5's matrix after ST-S3 so you test the fixed version |
| O-7 | Add Household finances to Search and Quick Add (`NV-01`) | (A) page link only; (B) leave | A |
| O-8 | Compact the handoff's opening paragraph (`DOC-01`) | (A) yes, in the next authorized batch; (B) leave | A |
| O-9 | Skip ST-S4, or fold it into S3/S5 | Fold, skip, or keep | Keep `PF-01` and `TS-01/02`; the rest optional |
| O-10 | The person model for Family Management (section 21) | Decide before that module's design phase | Later |

Unresolved and not answerable from here: the real size of the sync file and repository; what the owner's other two apps do with browser storage beyond what is visible in public code; whether the owner uses the Home Screen app or the browser tab on each device.

---

## 23. Exact test results

| Command | Result |
|---|---|
| `npm test` (first, baseline) | **179 files passed, 3,310 tests passed**, 0 failed, 0 skipped; duration 49.44 s |
| `npm test` under `TZ=UTC` | 179 / 3,310 passed, 48.23 s |
| `npm test` under `TZ=Pacific/Kiritimati` (UTC+14) | 179 / 3,310 passed, 53.13 s |
| `npm test` under `TZ=Pacific/Pago_Pago` (UTC-11) | 179 / 3,310 passed |
| `npm test` with the clock shifted, five dates | 2026-12-31 23:50, 2027-01-01 00:30, 2027-03-14 12:00, 2027-03-31 09:00, 2028-02-29 12:00: all 179 / 3,310 passed |
| `npm test` with the clock at 2027-01-08 12:00 | **1 failed, 3,309 passed** (`b4-calendar.test.ts`, finding `TS-01`) |
| Five spending golden-master files only | 5 files, 157 tests passed, 1.5 s |
| `npx tsc --noEmit` | No errors (about 2.5 s) |
| `npm run build` | Succeeds (0.54 s). `dist/assets/index-*.js` 2,278,657 bytes (641,036 gzip); CSS 108,847 bytes (18,685 gzip); the usual "chunks larger than 500 kB" warning |
| `npm audit` | 0 vulnerabilities (99 packages) |
| `git diff --check` (and `--cached`) | Clean, exit 0 |
| Final re-run at the end of the audit | `npm test`: 179 files, **3,310 passed**, 42.2 s; `npx tsc --noEmit`: exit 0; `npm run build`: succeeded (0.55 s) |
| Import-graph script | 484 non-test files; 0 file-level cycles |

Time-shifted and time-zone runs used scratch files outside the repository (a setup file that moves the clock without freezing it, and a Vitest config pointing at the repository). Nothing in the repository changed. All measurements were taken with other processes running, so timings are indicative.

---

## 24. Exact Git status

**At the start:** branch `main`, HEAD = `origin/main` = `8e77af465ed8b086c4b44106324c0991ac88d8f6`, working tree clean.

**At the end** (`git status --short`, run after the last test, type check and build):

```
?? docs/LEDGER-STABILIZATION-ROADMAP-2026-11-08.md
?? docs/LEDGER-STABILIZATION-S0-AUDIT-2026-11-08.md
```

HEAD is still `8e77af4` and equals the remote `main` (`git ls-remote`). `git diff --stat` shows no modified tracked file and nothing is staged. Nothing was committed, pushed or deployed. `dist/` and `node_modules/` are git-ignored (the build refreshed `dist/`, a build artifact, and Vitest wrote its cache under `node_modules`). Scratch files for the experiments (import-graph script, sync and performance probes, clock-shift setup, saved test logs) were kept outside the repository, in the session's scratch folder.

**Browser checks:** done in an isolated `*.localhost` origin that I confirmed held only the app's own starter categories before I seeded invented data; that origin's databases were deleted afterwards and the dev server was stopped. No unknown or real browser database was read, reset or modified.

**Existing documents** (`BACKLOG.md`, `CHATGPT-HANDOFF.md`, `CLAUDE.md`, `README.md`, the phase reports) were **not** modified; their staleness is recorded as `DOC-01` and `DOC-02` for the next authorized batch.

---

## 25. Recommended next action

1. **Review this report and the roadmap** (ChatGPT and the owner), and answer O-1 (hosting) and O-2 (what deleting an account should do) first.
2. **Authorize ST-S1 only**: `DI-01`, `SY-01`, `TS-01` (before 2027-01-03), `BK-01`, and carry out the `SE-01` decision. This is small, reviewable on its own, and clears both P1 findings and the dated test failure.
3. In parallel and without code: read the Sync page numbers (O-5) and update the handoff and backlog in the next authorized batch (`DOC-01`).
4. Keep Family Management on hold until the section 21 evidence exists.

*End of report.*
