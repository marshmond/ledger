# Ledger stabilization ST-S5: final system acceptance, disaster recovery and release readiness

> **Update 2026-11-09 (ST-S5.1):** findings ST5-F1 to ST5-F4 below were corrected in ST-S5.1 (`docs/LEDGER-STABILIZATION-ST-S5-1-REPORT-2026-11-09.md`), and the owner decided to keep the existing GitHub hosting, so SE-01 is now a documented, owner-accepted risk. This report is kept unchanged as the historical record: its findings, reproduced failures and verdict describe the state at `4b827eb`.

**Date:** work started the evening of 2026-11-08 and finished 2026-11-09 (America/New_York). **Author:** Claude (local implementation assistant). **Status:** ACCEPTANCE AND VERIFICATION ONLY. **No production source file, test file, schema, dependency, hosting setting or application data was changed. Nothing was staged, committed, pushed or deployed.** The only files added or edited are this report, the owner checklist, the final disposition, and the handoff, backlog and README updates (section 22).

**Verdict: CONDITIONAL GO** for the stabilized application (section 23). **Family Management: functional readiness is conditional; the security gate is CLOSED** (the shared-origin exposure, SE-01, is unresolved and the owner has not accepted the risk). These are two separate decisions (section 20).

**Privacy:** every record, amount, name, passphrase and token used in this phase is invented. Nothing real was read, cleared or migrated. No real GitHub token or sync passphrase was requested or used. The repository is public; this document contains no financial or personal data.

---

## 1. Executive summary

Ledger is in good shape. The released version (ST-S4, commit `4b827eb`) passed everything I could throw at it on this computer, and I found **no problem that loses data today**. I did find **two real weaknesses in the sync safety net** that are not reachable in everyday use yet but should be fixed before the app grows (section 10 and 21), plus two small accessibility slips.

What I could **not** do is use a real phone, a second real device, airplane mode, an installed home-screen app, Safari, or a screen reader. Those are listed as **PENDING**, with step-by-step instructions for you in `docs/LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md`. A passing test run is not proof that a phone works.

| Question | Answer |
|---|---|
| Is the released site really the ST-S4 build? | **Yes.** `main` = `origin/main` = `4b827eb…`; Pages run **#78** succeeded; a fresh local build of that commit is byte-identical to the live `index.html` and `sw.js` (section 2). |
| Are the numbers right across modules? | **Yes** (section 8): the 157 financial golden-master tests pass unchanged; an independent hand calculation of the invented household ($647.98) matches to the cent; read-only reports leave the database byte-identical. |
| Is deleting things safe? | **Yes** (section 9): accounts with Scheduled items or loans refuse; a payment linked from four modules shows all four; a stale preview refuses; deleting 50 transactions with a failure injected at the 30th deletes none. |
| Does sync keep every overwritten edit? | **Within one browser tab, yes** at 50, 51, 120 and 500 conflicts. **Two findings** (section 10): a newer app version's *new database tables* would be erased by an older device (latent: no such table exists yet), and two open tabs can overwrite each other's saved conflict list (narrow). Real two-device sync was **not** run. |
| Can I recover from losing a phone? | **In a disposable environment, yes** (section 11): plain and encrypted backups restored into empty browser profiles, totals and Calendar identical, damaged files refused, wrong passphrase refused. **Only with the backup passphrase**; the sync token and passphrases are never in a backup and must be re-entered. Real-device recovery is PENDING. |
| Does it work with no connection? | **Yes in simulation** (section 12): 18 of 18 addresses, a restored 10,000-transaction household, writes and reads, backup export; five releases with old tabs, a partly failed update, and other apps' caches untouched. Real airplane mode and the installed app are **PENDING**. |
| Accessibility | Structure, names, keyboard, focus, dialogs, Hide Amounts and contrast pass in Chrome (section 14). Two small P3 slips found. **No screen reader and no phone were used**; those are PENDING. |
| Speed | Faster than ST-S3 under identical conditions (cold phone Today 5.1 s to 3.8 s; computer warm Today 224 to 139 ms). Absolute times on this machine today were 10 to 35% slower than the ST-S4 report's, so I compared like with like (section 15). |
| Biggest open risk | **SE-01**: Ledger shares a web address with two other apps. Code cannot fix it. It stays open and is your decision (section 17). |

**Counts:** 3,601 tests in 198 files at the released commit, **14 full executions all green** (0 failed, 0 skipped), including 8 shifted-clock and time-zone runs and 3 at once; 63 extra acceptance drill tests in 7 files (62 passed; the one that fails is the recorded reproduction of the sync finding ST5-F1, and two others print what they observed for ST5-F1 and ST5-F2); 21 + 38 + 20 + 18 + 4 browser checks in disposable Chrome profiles.

---

## 2. Exact deployed commit, GitHub Pages run and test baseline (required items 2, 3 and 4)

| Check | Result | Evidence |
|---|---|---|
| Repository | `marshmond/ledger` | `git remote -v`: `origin https://github.com/marshmond/ledger.git` |
| Branch | `main` | `git branch --show-current` |
| `HEAD` equals `origin/main` | **Yes**: `4b827eb5e36fea8919708e2f0394d9667b5eda3e` | `git rev-parse HEAD origin/main`, and `git ls-remote origin refs/heads/main` (all three identical) after `git fetch` |
| ST-S4 committed and pushed | **Yes**: `feat(stabilization): ST-S4 on-demand module screens, per-build service worker cache, test timeouts, write-trap guard` | `git log` |
| Pages run for that exact commit | **Run #78** (id 42561314419), workflow "Deploy to GitHub Pages", event `push`, `completed` / **`success`**, `head_sha` = `4b827eb…`, 2026-11-09 04:20:49Z to 04:23:08Z (23:20 to 23:23 on 2026-11-08 New York). `build` job: checkout, setup-node, `npm ci`, **`npm test`**, `npm run build`, configure-pages, upload, all success; `deploy` job success | public Actions API (`gh` is not installed; read-only HTTP) |
| The deployed site is that build | **Byte-identical.** I built `HEAD` into a scratch folder: `index.html` and `sw.js` have the same SHA-256 as the files served at `https://marshmond.github.io/ledger/`; both carry build id `8a8eb81c6654`; the entry file is `index-D2FgirdO.js` | `curl` of the live files compared with `dist-A` |
| ST-S4's final cache-safety and old-tab checks are in | **Yes.** The worker in `HEAD` orders builds by install order (`seq`), marks incomplete installs, never touches caches that are not Ledger's own, and `sw.test.ts`, `swBuild.test.ts`, `swBuilds.test.ts` are in the commit. Re-proved in a browser in section 12 | files at `HEAD`; drills `PW-01` to `PW-19` |
| Module dropdown shows Household finances | **Yes**, as **"Household finances"** (lower-case "f", the app's sentence-case style; the brief wrote "Household Finances"). The nine labels are: Today, Ledger, Calendar, Tasks, Projects, Home & Assets, Household Services, Bills & Subscriptions, Household finances | read from the open dropdown in Chrome |
| Database schema and encryption formats unchanged | **Yes.** `git diff 8e77af4 HEAD` (B5, the last pre-stabilization release, to `HEAD`) shows **no change** to `src/db.ts` (Dexie version 15), `src/lib/backup.ts` (backup envelope, PBKDF2 310,000 rounds, AES-GCM), `src/lib/sync/codec.ts` (sync file), `package.json` or `package-lock.json`. Changed in that span and reviewed in earlier phases: `backupFile.ts` (three preference keys), `sync/engine.ts` and `sync/conflicts.ts` (conflict list) | `git diff --stat` |
| Working tree clean at start | **Yes** (`git status --short` printed nothing) | |
| ST-S5 not already started | **Yes** (no `ST-S5`, owner-acceptance or final-disposition file existed in `docs/`) | `ls docs` |

**Deployed test baseline.** CI ran `npm test` successfully for this commit (the Actions API does not print the count). The same commit run here: **3,601 passed in 198 files** (the figure ST-S4 reported before release; the released figure is the same). Environment: Windows 11 Home 10.0.26200, Node 24.15.0, Vitest 5.0.3, Vite 8.3.4, TypeScript 7.0.2, fake-indexeddb 6.2.5, headless Google Chrome 156.0.8078.81.

---

## 5. Acceptance methodology

Every result is labelled with how it was established. **A result from category A or B is never presented as proof of category C.**

| Cat | Meaning | Used here |
|---|---|---|
| **A** | Automated: a test running the real application code (no stand-ins for the engine, merge, encryption or readers) | The repository suite (3,601), and 63 extra drill tests I wrote in a scratch folder **outside** the repository (invented data; kept out of Git because the brief forbids adding files). A drill's expected figures are worked out by hand in the test itself |
| **B** | Browser: a real browser engine, a disposable profile, real clicks, key presses, file choosing, network failure | Headless Chrome 156 driven through the DevTools protocol; a fresh temporary profile per scenario; a local static server that behaves like GitHub Pages (gzip, 10-minute cache header) on `127.0.0.1`; the server is **stopped** to make the network genuinely unreachable |
| **C** | Physical device: a real phone, tablet, second computer, real GitHub, a screen reader | **None was available to me. Nothing in this report is category C.** |
| **D** | Owner acceptance pending: needs the owner's own devices or a sensitive action | Listed in section 19 and in the owner checklist |

Environments: **E1** = Node 24.15 + Vitest + in-memory IndexedDB. **E2** = disposable headless Chrome + local server. **E3** = read-only HTTP requests to public GitHub pages and the public Actions API.

Invented data sets: **H1** = the repository's own B5 test household (1 account, 6 transactions: a $150.00 cleaning payment linked from Bills, Services and Home & Assets; two $15.49 subscription payments; a $62.00 power bill; a $340.00 furnace repair with a $30.00 refund; a typed $95.00 gutter job; 3 bills with payment links; a fortnightly cleaning arrangement). **HF** = H1 plus a second account, a transfer, a split transaction, two Scheduled rules (one paused), a subscription cancellation plan, a repeating Task, a Calendar event and calendar, a contact, and a project with a budget line. **H10K** = 10,000 transactions, 300 bills, 80 arrangements, 4,000 visits, 600 tasks, 200 assets, 10 projects, 40 Scheduled rules (4.8 MB file).

**How "PASS" was decided:** a result is PASS only when I ran it and the output shows it. A check whose first version failed because of a mistake in my own test script is reported as such (sections 12 and 14 name them); I fixed the script, re-ran, and kept the first failure in the record. **Two of my first drill versions were vacuous** (the Calendar providers read the app's own database, not the one I seeded): I noticed from a count of zero, fixed them to read the right database and added assertions that the readers return real items (82 and 97 items). Only the corrected versions are reported.

**What I did not do, on purpose:** no commit, push, deploy, hosting, DNS, GitHub setting or permission change; no new repository; no dependency; no change to application code; no real data. Test-only scratch files were written outside the repository and a scratch copy of the source (also outside it) was used for builds of other releases and for mutation checks; the repository files were never edited.

---

## 6. Evidence categories and limitations (what is not proven)

- Nothing was run on a real phone, tablet, second computer, real GitHub, Safari, Firefox or with a screen reader.
- The extra drills are in a scratch folder outside Git, so they cannot be re-run from the repository. If you want the two new findings guarded permanently, a separate authorized change can add them as repository tests (section 21).
- The in-memory sync tests prove the algorithm, not real timing.
- Headless Chrome on a fast computer says nothing about iOS storage eviction, background tab timers or phone memory.
- Performance on this machine fluctuated by 10 to 35%.

---

## 7. Complete acceptance matrix

**Columns:** ID, scenario (precondition, steps, expected), environment, actual result, category, result, defect. "Pre" names the data set. Results: PASS, FAIL, PENDING, BLOCKED. Defect references are in section 21.

### 4.1 Finance: Accounts and Transactions

| ID | Scenario | Env | Actual | Cat | Result | Defect |
|---|---|---|---|---|---|---|
| FIN-01 | Pre H1. Run the five financial golden-master files unchanged (B5 golden master, union, commitments, S5 spend matrix, B3 spend) | E1 | 5 files, **157 of 157** passed | A | PASS | |
| FIN-02 | Pre H1. Household recorded spending equals the hand sum 150.00 + 15.49 + 15.49 + 62.00 + 340.00 - 30.00 + 95.00 = **$647.98**; the shared $150 payment counts once | E1 | total 64,798; Finance 55,298; typed 9,500; paid out 58,298; money back 3,000; shared 15,000. Adding the three module pages gives 94,798 (30,000 more), which the page explains | A | PASS | |
| FIN-03 | Pre H1. A split payment ($120 + $80) with part 0 linked from Home & Assets and part 1 from Bills counts each part once; adding a link to the whole payment never reaches $400 | E1 | +20,000 exactly, and still 20,000 with the whole also linked | A | PASS | |
| FIN-04 | Statuses: mark payments pending, cleared, reconciled | E1 | total unchanged (64,798); the breakdown moves (pending 1,549; reconciled 7,749) | A | PASS | |
| FIN-05 | No amount matching: add an unlinked Finance payment of exactly $95.00 on the typed gutter job's date | E1 | total unchanged; typed stays 9,500 | A | PASS | |
| FIN-06 | Unknown amount: add a repair with no cost | E1 | total unchanged; "unknown" count +1 (never zero, never invented) | A | PASS | |
| FIN-07 | Commitments are not spending: add a $12.99 monthly bill | E1 | commitments change; recorded spending identical | A | PASS | |
| FIN-08 | Periods (today 2026-11-08): 2026, last 12 months, year to date, 2025, last 30 days | E1 | 64,798 / 64,798 / 64,798 / 0 / **22,749** (= 15,000 + 1,549 + 6,200 worked out by hand) | A | PASS | |
| FIN-09 | Payment deleted after linking (the $62 power bill) | E1 | total falls by exactly 6,200; the Bills fact and its snapshot are still there; flagged for review | A | PASS | |
| FIN-10 | Payment edited after linking ($62 changed to $72) | E1 | total follows the live amount (+1,000); the report wrote nothing | A | PASS | |
| FIN-11 | Read-only reports: fingerprint (every row of every table) before and after the overview for six periods, Bills and Services snapshots, **all six Calendar providers (82 items)**, all search sources, and a deletion preview | E1 | byte-identical | A | PASS | |
| FIN-12 | Typed payments outside Finance, missing references, future commitments, expected payments, recorded spending kept apart | E1 | covered by FIN-02, -05, -07, -09 | A | PASS | |
| FIN-13 | The ten-thousand-transaction household restored into a fresh profile: Transactions and Household finances open with figures | E2 | opened in 114 and 101 ms warm; heap 11 to 16 MB | B | PASS | |
| FIN-14 | Finance on a real phone: add a transaction with the keypad, scroll a long list, use a row checkbox | | not run | D | PENDING | |

### 4.2 Budget, Scheduled, Today, Search and Quick Add, Settings

| ID | Scenario | Env | Actual | Cat | Result | Defect |
|---|---|---|---|---|---|---|
| BUD-01 | Pre H10K. Every Budget "Assigned" box has an accessible name saying what it is and which category | E2 | 10 of 10 named ("Assigned amount for Groceries"...) | B | PASS | |
| BUD-02 | No Budget box name carries a money figure | E2 | none contain digits or currency | B | PASS | |
| BUD-03 | Hide Amounts and Budget | E2 | Budget still shows figures when Hide Amounts is on: **by documented design** (UX-01); recorded, not a defect | B | PASS (limitation) | |
| BUD-04 | Edit a Budget amount on a phone | | not run | D | PENDING | |
| SCH-01 | Pre H10K. Scheduled date and amount boxes all named, no figure in a name | E2 | 6,835 of 6,835 named ("Posting date for Rule 0, scheduled 2024-01-05") | B | PASS | |
| SCH-02 | Approving an item whose account is missing refuses and writes nothing | E1 | refused (`MissingAccountError`); counts unchanged | A | PASS | |
| SCH-03 | Approve or skip a Scheduled item on a phone using disposable data | | not run | D | PENDING | |
| TOD-01 | Today opens, first Tab is a skip link, activating it focuses `main` | E2 | "Skip to main content" then `main#main-content` focused | B | PASS | |
| TOD-02 | Today, Calendar, Bills, Services, Home & Assets and Household finances show no figure in text or any accessible name while Hide Amounts is on | E2 | 6 of 6 clean | B | PASS | |
| TOD-03 | Today opens with no connection | E2 | 121 ms, offline | B | PASS | |
| SQ-01 | Ctrl+K opens Search as a combobox with focus in the input; ArrowDown makes an option active (`aria-activedescendant` to `role=option`) | E2 | 12 options; active option announced | B | PASS | |
| SQ-02 | Escape closes Search and returns focus to what opened it (button, or the focused control for Ctrl+K) | E2 | to "Search" button; to "Hide amounts" switch. (My first test opened it from nothing and saw focus on the page; re-tested properly) | B | PASS | |
| SQ-03 | Quick Add: dialog is modal, named "Add"; 25 Tab presses never leave; Escape returns focus to "Quick add" | E2 | all true | B | PASS | |
| SQ-04 | A task added offline through Add is saved, and Search finds it after a reload with no network | E2 | saved; found by Search | B | PASS | |
| SQ-05 | Search and Quick Add on a phone | | not run | D | PENDING | |
| SET-01 | Backup page and Sync page open offline | E2 | both open | B | PASS | |
| SET-02 | Device preferences travel in a backup exactly as documented; sync token and passphrases and the price key do not | E1+E2 | only `PREFERENCE_KEYS` came back on a new profile; `ledger-sync-config` and `ledger-autobackup` absent | A+B | PASS | |

### 4.3 Calendar, Tasks, Projects, Home & Assets, Household Services, Bills, Household finances

| ID | Scenario | Env | Actual | Cat | Result | Defect |
|---|---|---|---|---|---|---|
| CAL-01 | A fortnightly service (every other Friday from 2026-11-13) over the 12-month horizon | E1 | the Task on 11-13 then 25 expected visits to 2027-10-29; **every gap exactly 14 days**; all Fridays; no duplicate dates; none past 2027-11-08 | A | PASS | |
| CAL-02 | The same across the US clock change (14 March 2027) and a year end | E1 | gaps stay 14 days (03-12 and 03-26 both present) | A | PASS | |
| CAL-03 | The horizon rolls: three weeks later the window has moved on and there is still exactly one open Task | E1 | last date moved later; one open Task | A | PASS | |
| CAL-04 | Twice a month, 15th and last business day, for 12 months, against independent weekday arithmetic | E1 | 24 of 24 dates match; never a weekend; February 2027 = 15th and **26th** (27th and 28th are a weekend) | A | PASS | |
| CAL-05 | Leap year: 15th and last calendar day gives 2028-02-29; day 31 clamps to 28 February 2027 and 30 April | E1 | correct; no duplicate dates | A | PASS | |
| CAL-06 | The two modes are different (fixed 14 days versus calendar dates) | E1 | confirmed by construction | A | PASS | |
| CAL-07 | **Holidays** | E1 | **not supported by design** (`src/lib/dates.ts`, `semimonthly.ts` say weekends only). A business-day rule can land on a public holiday | A | PASS (documented limitation) | |
| CAL-08 | Overrides and skipped visits | E1 | not re-derived here; covered by the repository's `cadence-flows`, `visits-correction`, `s4-calendar` tests (all green in 13 runs) | A (existing) | PASS | |
| CAL-09 | Only the next actionable visit is a Task | E1 | exactly 1 open Task per arrangement, not 26 | A | PASS | |
| CAL-10 | After syncing to a second database and after a wipe-and-restore, the same visit ids and still one open Task | E1 | identical ids; 1 Task on both | A | PASS | |
| CAL-11 | Six Calendar layers (Finance, Tasks, Projects, Home & Assets, Services, Bills): unique ids over 12 months, identical on two runs and after a wipe-and-restore, nothing written | E1 | ledger 1, tasks 3, services 50, bills 37 (projects and assets had nothing dated); no id repeated across layers; identical after restore | A | PASS | |
| CAL-12 | Stable identity and time-zone boundaries | E1 | plain dates, same under UTC, UTC+14, UTC-11, both US clock-change days and the UK one (8 whole-suite runs, 3,601 each) | A | PASS | |
| CAL-13 | Reminder behavior and `.ics` export | | no push notifications exist by decision; export covers the Finance layer and personal calendars only (decision). Existing tests green; **not exercised on a phone calendar app** | A (existing) / D | PASS (existing) / PENDING (device) | |
| CAL-14 | Calendar, Tasks, Projects, Home & Assets, Services, Bills and Household finances all open with no connection | E2 | 18 of 18 addresses | B | PASS | |
| CAL-15 | Calendar navigation on a phone | | not run | D | PENDING | |
| TSK-01 | Tab group (Tasks, Calendar, Projects): ArrowRight/ArrowLeft move between tabs; one Tab stop per group | E2 | Today to Upcoming and back; Agenda to Month; Open to Finished; one Tab stop each | B | PASS | |
| PRJ-01 | A payment tagged to a project appears in the delete preview ("lowers what the project shows as paid") | E1 | `projects` named alongside bills, services, assets | A | PASS | |
| AST-01 | Home & Assets records count in the household union once; typed and linked kept apart | E1 | see FIN-02, -05 | A | PASS | |
| SVC-01 | Services visits and arrangements in the union and in Calendar | E1 | see FIN-02, CAL-01 | A | PASS | |
| BIL-01 | Bills payment links, price/cancellation facts and the cancellation plan survive backup, encrypted backup and restore | E1 | every table identical after restore | A | PASS | |
| HHF-01 | Household finances page text is identical after a plain restore and an encrypted restore of the same file | E2 | 3,435 characters, equal | B | PASS | |
| HHF-02 | Household finances never writes: fingerprint unchanged | E1 | see FIN-11 | A | PASS | |
| MOD-01 | Every module on a phone | | not run | D | PENDING | |

### 4.4 Synchronization

| ID | Scenario | Env | Actual | Cat | Result | Defect |
|---|---|---|---|---|---|---|
| SYN-01 | First device uploads; second joins from the copy; an ordinary edit travels both ways; a second "initial upload" is refused | E1 | all true; no conflicts | A | PASS | |
| SYN-02 | Pre: Bills records on two synced devices, both edited while apart. **50, 51, 120, 500** clashes | E1 | all **50 / 51 / 120 / 500** overwritten versions kept, each a complete copy of the loser; unique keys; winner unchanged; a re-created engine reads the same list | A | PASS | |
| SYN-03 | Restore one previous version of 120 | E1 | written like a fresh edit; reached the other device; list 120 to 119 | A | PASS | |
| SYN-04 | Clear a selected 40 while a new clash arrives with the question open | E1 | exactly 40 removed; the new versions stayed | A | PASS | |
| SYN-05 | Upload fails after this device was overwritten; retry | E1 | 60 saved before the upload; still 60 after the retry (not 120) | A | PASS | |
| SYN-06 | Both devices sync at the same moment (version race) | E1 | retried; converged | A | PASS | |
| SYN-07 | Deleted on one device, edited on the other | E1 | deletion stands; the edit is kept as a recoverable version | A | PASS | |
| SYN-08 | A Finance payment deleted on one device while the other links a Bills fact to it | E1 | both devices: payment gone, the link fact kept (reads "needs review") | A | PASS | |
| SYN-09 | Wrong passphrase | E1 | refused; local data unchanged | A | PASS | |
| SYN-10 | Corrupted remote file: flipped byte, cut in half, cut to 10 bytes, plain text | E1 | all refused; local data and conflict list untouched | A | PASS | |
| SYN-11 | Interrupted download then retry | E1 | first attempt changed nothing; retry succeeded | A | PASS | |
| SYN-12 | Three devices, offline edits on each, repeated syncs | E1 | identical data on all three | A | PASS | |
| SYN-13 | Unknown **fields** on a known record from a newer build | E1 | survive repeated syncs | A | PASS | |
| SYN-14 | Unknown **tables** from a newer build, an older device syncs | E1 | **the records are erased from the shared copy on the second sync (first sync if the device joined from it), and a newer device then deletes its own copy.** Reproduced at the merge level | A | **FAIL** | ST5-F1 |
| SYN-15 | Two browser tabs add different overwritten versions at the same moment | E1 | **one tab's set was lost in 24 of 25 rounds** (last writer wins; the queue is per tab, not per browser) | A | **FAIL** | ST5-F2 |
| SYN-16 | Newer sync-file format version | E1 | the reader ignores the `v` field; only the magic bytes are checked | A | PASS (info) | ST5-F6 |
| SYN-17 | Real two-device sync through real GitHub, airplane-mode edits on both, reconnect, conflict review, cross-module spending reconciliation | | not run | D | PENDING | |
| SYN-18 | Clock difference between two real devices; GitHub rate limits; iOS timers in the background | | not run | D | PENDING | |

### 4.5 Backup, restore and disaster recovery (the S0 eleven-step list and the brief's fourteen drills)

| ID | Drill | Env | Actual | Cat | Result | Defect |
|---|---|---|---|---|---|---|
| BKP-01 | (1) Plain backup of HF carries every module's records and screen preferences, never the sync token, passphrases or the price key | E1 | true | A | PASS | |
| BKP-02 | (2) Encrypted backup: only `v`, `salt`, `iv`, `data`; no payee, name, token or passphrase text anywhere in the file | E1 | true | A | PASS | |
| BKP-03 | (3) Manifest counts equal the real table sizes | E1 | every table | A | PASS | |
| BKP-04 | (4) Preview a restore (plain and encrypted) without applying | E1+E2 | counts shown (10,000 transactions); database unchanged | A+B | PASS | |
| BKP-05 | (5) Refuse damaged plain files: cut at 50% and 99%, empty, not JSON, a list, a required list missing, a list that is not a list, a record removed, a record added, a duplicate id, an unknown table | E1 | **11 of 11 refused**, each with a plain message ending "Nothing was changed" where it applies | A | PASS | |
| BKP-06 | (5) Same in a browser: truncated plain and truncated encrypted file | E2 | both refused with a message; data still empty | B | PASS | |
| BKP-07 | (6) Wrong passphrase, empty guess, wrong case, extra space | E1+E2 | all refused ("Wrong passphrase or corrupted backup. Nothing was changed."); database unchanged | A+B | PASS | |
| BKP-08 | (7) A backup from a newer version (16, 99) | E1 | refused: "made by a newer version of Ledger (data version 16; this copy understands up to 15)" | A | PASS | |
| BKP-09 | (8, 9) Restore into a new empty database, plain and encrypted: every table identical (ignoring the sync time stamp), household total, **97 Calendar items**, Search and review count identical to the source | E1 | identical | A | PASS | |
| BKP-10 | (8, 9) Restore the 10,000-transaction file into a new empty Chrome profile, plain and encrypted | E2 | 6 accounts, 10,000 transactions, 5,340 module records, 40 rules in both | B | PASS | |
| BKP-11 | A safety copy of the old data is offered before anything is replaced; if it cannot be saved nothing is replaced; a failure during the restore leaves the old data and the preferences untouched | E1+E2 | "Ledger Pre-Import 11-08-26.json" offered; both failure injections left the database identical | A+B | PASS | |
| BKP-12 | (10) Restore while sync is on: A restores an older backup, B (synced earlier) follows | E1 | both converge to the restored data (6 transactions each); a record added after the backup is gone and B's later edit replaced, as documented; no doubled payments; household total back to $647.98 | A | PASS | |
| BKP-13 | (11) A restore does not discard unreviewed sync conflicts held in that browser | E1 | count unchanged | A | PASS | |
| BKP-14 | (12) Loss of a device's browser data: a new empty profile recovered from the saved encrypted copy alone | E1+E2 | full recovery; 13 screens then open with the network gone | A+B | PASS | |
| BKP-15 | (13) Secrets must be re-entered: no sync token, sync passphrase or weekly-backup passphrase on the recovered device | E2 | only `ledger-backup-meta` and `ledger-last-module` in local storage | B | PASS | |
| BKP-16 | The backup passphrase appears nowhere in local or session storage, any non-record database table, the console, or any network request; no request left the machine | E2 | none (0 console lines; 51 requests, all local) | B | PASS | |
| BKP-17 | (14) Device-specific preferences behave as documented | E1+E2 | exactly the listed keys travel; `some-unlisted-key` does not | A+B | PASS | |
| BKP-18 | Without the passphrase an encrypted backup cannot be opened | E1 | no in-app path | A | PASS | |
| BKP-19 | Restore from a real weekly GitHub copy on a real device after clearing real browser data | | not run | D | PENDING | |
| BKP-20 | Time taken to recover on real devices; the three secrets confirmed written down | | not run | D | PENDING | |

### 4.6 Offline, installed app and updates

| ID | Scenario | Env | Actual | Cat | Result | Defect |
|---|---|---|---|---|---|---|
| OFF-01 | Install online: one cache `ledger-8a8eb81c6654`, 43 files (all 34 scripts, the style sheet, shell, icons, a note), 2,408 KB, the worker controls the page | E2 | true | B | PASS | |
| OFF-02 | Every module's screen file is saved | E2 | 8 module files plus Settings | B | PASS | |
| OFF-03 | Server stopped; 18 addresses loaded from scratch (Today, Ledger Home/Budget/Scheduled/Transactions/Accounts/Reports, Calendar, Tasks, Projects, Home & Assets, Services, Bills, Bills Upcoming, Household finances, Settings, Backup, Sync) | E2 | **18 of 18**, 105 to 250 ms; a direct fetch of an unsaved file failed (proof the network was gone) | B | PASS | |
| OFF-04 | Same, with the restored 10,000-transaction household | E2 | 13 of 13 | B | PASS | |
| OFF-05 | In-app switching offline to eight modules never opened in that page | E2 | 17 to 62 ms each | B | PASS | |
| OFF-06 | Local write and read offline: add a Task; find it with Search after a reload | E2 | saved in the database; Search found it (also on the large household) | B | PASS | |
| OFF-07 | Backup export starts a download offline | E2 | "Ledger Backup 11-09-26.json" | B | PASS | |
| OFF-08 | Release A installed, B deployed, a tab one release behind opens a screen it never loaded | E2 | built from its own release (A), with **no request to the server** | B | PASS | |
| OFF-09 | C deployed; a tab two releases behind opens that screen | E2 | truthful "did not load" message with Reload Ledger; the reload is explicit and lands on C | B | PASS | |
| OFF-10 | An update arrives while a form has unsaved typing | E2 | no reload; the text is still in the box | B | PASS | |
| OFF-11 | A partly failed update (one file missing on the server while D installs) | E2 | D recorded **incomplete** (42 of 43 files); A-era caches B and C kept (3 caches) | B | PASS | |
| OFF-12 | Offline start during the incomplete update | E2 | Today and Bills open; the screen whose file was not saved says "did not load" (truthful); back online, **Try again** recovers it with no reload | B | PASS | ST5-F5 |
| OFF-13 | A later successful update (D complete, then E) | E2 | complete current build; **2 caches after five releases** (never one per release) | B | PASS | |
| OFF-14 | Other applications' caches on the same address (`fbb-v3`, `foodventory-cache`, `my-ledger-notes`, `workbox-precache-v2`) through five releases | E2 | all four untouched | B | PASS | |
| OFF-15 | User records through five releases | E2 | unchanged | B | PASS | |
| OFF-16 | Real airplane mode with the installed home-screen app (iOS Safari and Android Chrome) | | not run | D | PENDING | |
| OFF-17 | The first update on each device (about 2.4 MB, one time) | | not run | D | PENDING | |

### 4.7 Mobile navigation and accessibility

| ID | Scenario | Env | Actual | Cat | Result | Defect |
|---|---|---|---|---|---|---|
| MOB-01 | 17 screens at 375 px: no horizontal overflow | E2 | 0 overflow on all 17 | B | PASS | |
| MOB-02 | No control under 24 x 24 px at 375 px (WCAG 2.2 AA 2.5.8) | E2 | **one**: the "All" link on Ledger Home is 20 px wide (44 px tall) | B | **FAIL (P3)** | ST5-F4 |
| MOB-03 | Controls under 44 px at 375 px (comfort, informational) | E2 | Today 11 of 395; Transactions 106 of 227; Services 277 of 362; Household finances 1,047 of 1,051 (a list of small links); Calendar, Projects, Home & Assets, Reports 0 | B | INFO | |
| MOB-04 | Phone navigation of every module with a thumb | | not run | D | PENDING | |
| ACC-01 | Exactly one `main` (id `main-content`) on all 17 screens, desktop and 375 px | E2 | 34 of 34 | B | PASS | |
| ACC-02 | Exactly one `h1` per screen | E2 | 34 of 34 | B | PASS | |
| ACC-03 | Every visible field and every button/link has an accessible name | E2 | 0 unnamed, both widths | B | PASS | |
| ACC-04 | No skipped heading level | E2 | **one skip**: Household Services overview, `h2` "Recorded spending" then `h4` "Counted (254)" | B | **FAIL (P3)** | ST5-F3 |
| ACC-05 | No duplicate id, no positive tabindex, language set, skip link present, nav landmarks all named | E2 | all true | B | PASS | |
| ACC-06 | First Tab stop is the skip link; it moves focus to `main` | E2 | true | B | PASS | |
| ACC-07 | Arrow keys in tab groups | E2 | see TSK-01 (Ledger Home has no tab group on desktop; it uses a named side navigation) | B | PASS | |
| ACC-08 | Search combobox navigation | E2 | see SQ-01 | B | PASS | |
| ACC-09 | Error announcements | E2 | "Enter the passphrase..." and wrong-passphrase errors appear as `role=alert`; field marked invalid by the ST-S3 tests (green). Spoken output **not** heard | B / D | PASS (structure) / PENDING (spoken) | |
| ACC-10 | Focus restoration: Add dialog, Search, Delete account | E2 | focus returns to the opener in all three | B | PASS | |
| ACC-11 | Destructive dialog on an unused invented account: a modal dialog named for the account; **Cancel is focused first**; 12 Tab presses never leave it; Escape cancels, nothing deleted, focus returns to "Delete account"; confirming deletes | E2 | all true. (Note: it is `role="dialog"` with `aria-modal`, not `alertdialog`; the backup-restore confirmation is `alertdialog`. Cosmetic inconsistency, not a failure) | B | PASS | |
| ACC-12 | An account that still has Scheduled items shows a refusal notice, not a dialog | E2 | true | B | PASS | |
| ACC-13 | Text contrast, light and dark: up to 900 text items per screen on 7 screens (Today, Budget, Scheduled, Calendar, Bills, Household finances, Backup), 4.5:1 or 3:1 for large text | E2 | **0 failing items** in both | B | PASS | |
| ACC-14 | Hide Amounts and accessible descriptions | E2 | see TOD-02 | B | PASS | |
| ACC-15 | Screen reader (VoiceOver, TalkBack or NVDA) on Budget and Scheduled first | | not run | D | PENDING | |

**Matrix totals:** 128 rows. **109 PASS** (including three that pass with a documented limitation: BUD-03 Hide Amounts does not cover Budget, CAL-07 public holidays are not supported, SYN-16 the sync file has no version gate; and two that pass on structure with the device part PENDING: CAL-13, ACC-09), **4 FAIL** (SYN-14 = ST5-F1, SYN-15 = ST5-F2, MOB-02 = ST5-F4, ACC-04 = ST5-F3), **14 PENDING** (all category D: FIN-14, BUD-04, SCH-03, SQ-05, CAL-15, MOD-01, SYN-17, SYN-18, BKP-19, BKP-20, OFF-16, OFF-17, MOB-04, ACC-15), **1 INFO** (MOB-03). **BLOCKED: none.**

---

## 8. Financial-integrity results

Finance stays the single source of truth. Everything below was run against the real readers (`householdSpend`, `billsRecordedPayments`, `recordedAcrossModules`) with figures worked out by hand.

| Invariant | Result |
|---|---|
| No silent double-counting | One payment reached by Bills, Services and Home & Assets counts once ($150); a split's parts are counted once each; a whole link plus a part link in one aggregate never adds up to more than the payment |
| No automatic amount-based matching | An unlinked Finance payment of exactly the typed amount on the same date changes nothing |
| No invented values for unknown amounts | A repair with no cost adds nothing and is counted as "unknown" |
| No replacement of missing Finance evidence with typed amounts | Deleting a linked payment lowers the total by that payment only; the Bills fact and its snapshot remain; the item is flagged for review |
| Commitments, expected payments and recorded spending are different figures | Adding a bill moved commitments, not recorded spending |
| No Finance writes to refresh household summaries | Database fingerprint identical before and after every reader, including all six Calendar providers (82 items) and the deletion preview |
| Reporting periods | 2026, last 12 months, year to date equal "all"; 2025 is zero; last 30 days is exactly the three payments inside it |

**Not covered here and noted:** the household overview deliberately does not attribute by Finance category; "Reconciled" in B5 wording was reworded in ST-S2.

## 9. Account and transaction-deletion results

All scenarios in the brief were run (`DEL-*` rows and the browser dialog rows): unused account deletes; **active rule, paused rule and linked loan each refuse and change nothing**; approving an item whose account is missing refuses and writes nothing; a payment linked from Bills, Services, Home & Assets **and** Projects shows all four modules in the preview, and deleting it removes only that transaction (no household record was deleted); a payment edited after the preview, or given a new link after the preview, refuses; opening and cancelling a preview or being refused leaves the database byte-identical; the other half of a transfer goes with the chosen half; a split transaction deletes with its dependents named; deleting 50 transactions with a failure injected at the 30th deletes none (checked on both the registry-based path and the older `bulkDelete` helper, which no screen uses).

The two mutation checks that matter here (account rules no longer block; stale preview no longer refused) are caught by the repository's tests (section 16).

---

## 10. Synchronization and conflict-recovery results

**What was run:** the real `SyncEngine`, the real merge and real AES-GCM encryption over in-memory databases with an in-memory remote. This is **not** proof that two real devices sync through real GitHub; it cannot show real clocks, rate limits or a browser killing a background tab (SYN-17 and SYN-18 are PENDING).

**Conflict recovery** (SYN-02 to SYN-06): at 50, 51, 120 and 500 clashes every overwritten version is kept and complete; restoring one, clearing a selected set, a new clash arriving while the question is open, a failed upload followed by a retry, a version race and a re-created engine all behave as the design says. The old 50-version cap is gone.

### ST5-F1 (P2, latent): an older device erases records in tables it does not know

- **What happens:** the sync merge works table by table over the tables *this build* has. If a newer build ever adds a database table and writes rows to it, the shared file will contain that table. An older device (a phone that has not updated) syncs: it has no such table, so from its side the rows look **deleted**. It records a deletion, uploads it, and the newer device then deletes its own copy at its next sync. I reproduced the whole chain: the rows disappear from the shared copy on the older device's second sync (or its first, if it had just joined from that copy), and the merge then instructs a newer device to delete its local row.
- **What survives:** unknown **fields** on known records survive (tested). Everything in Ledger today is safe because **no deployed build knows a table another build lacks** (schema is version 15 everywhere) and every module so far stores its data in the shared `moduleRecords` table, which needs no new table.
- **Why it matters:** it would bite the first release that adds a table while a device lags. A phone left on an old cached version is exactly that situation. Family Management should not add tables until this is fixed (section 20).
- **Correction (not made; it touches sync):** make the merge treat tables this build does not know as pass-through (carry the remote rows through unchanged and never compare them against the local snapshot), with a test that a two-sync sequence keeps them. Small (the merge and engine, one test file) but it changes sync, so it needs the owner's go-ahead.

### ST5-F2 (P2 residual of SY-01, narrow): two open tabs can overwrite each other's saved conflict list

- **What happens:** the conflict list is saved with a read-then-write guarded by a queue that exists **per tab**. Two tabs of the same browser each have their own queue over the same stored list. When both add *different* overwritten versions at the same instant, the second write replaces the first. In 25 simulated rounds, one tab's versions were lost in 24.
- **How likely:** low. Both tabs have to merge different conflict sets at the same moment (two tabs that merge from the same starting state produce the same set, which is harmless). The most likely trigger is editing in one tab while another syncs. A phone's installed app is a single window.
- **Correction (not made; touches sync):** serialize across tabs with the browser's Web Locks (`navigator.locks`) around each conflict-list change and each sync run; supported by current Chrome, Safari and Firefox. Or accept the risk and use one tab.

### Other notes

- **ST5-F6 (info):** the sync file has a magic number but its `v` field is never read, so an incompatible future file format would be read as if it were the current one. Acceptable while one person updates every device; worth a version gate if the format ever changes.
- SY-02 (repository growth) still needs the owner to read two figures from the Sync page (section 19).

---

## 11. Backup and disaster-recovery results

The eleven-step list from the S0 audit and the brief's fourteen drills were run in disposable environments with invented data (matrix BKP-01 to BKP-20). Result: **every step that can be done without a real device passed**, and the step list below is exactly what remains for you.

| S0 step | Result |
|---|---|
| 1 Seed a household touching every module | HF built (Finance, transfer, split, Scheduled, Bills with links and a cancellation plan, Services, Home & Assets, Projects, Tasks, Calendar, Contacts, preferences). Counts noted |
| 2 Plain and encrypted export | both made; plain file holds readable data (warned in the app); encrypted holds none |
| 3 Open each file in the checker | summary counts equal |
| 4 Tamper tests | 11 plain and 4 encrypted variants refused, each with "Nothing was changed" |
| 5 Restore into a new empty profile | every table identical; Calendar, Today, Bills, Household finances identical (text-for-text on the Household page) |
| 6 Wrong passphrase | refused, nothing changed |
| 7 Restore while sync is on, then sync a second profile | restored data wins; second profile matches; no doubled records |
| 8 Join a second profile with "use the synced copy" | covered by the repository's two-device tests and SYN-01; **not run on real devices** |
| 9 Clear the main profile and recover from the weekly GitHub copy using only written-down secrets | the *restore from a file* part passed (BKP-14). **Downloading the weekly copy from real GitHub and doing it with real secrets: PENDING** |
| 10 Secrets must be re-entered; layout reset | confirmed (BKP-15, BKP-17) |
| 11 Older backup on one device while the other edited more than 50 records | the restore wins (documented); overwritten edits on the *other* device are recoverable as conflict versions; covered by BKP-12 and SYN-02 |

**Critical pass criteria:** no unintended record loss (identical tables), no duplicated payments, no changed totals ($647.98 before and after), no missing cross-module relationships (links, facts and references identical), no silent failure (every refusal said so), no passphrase leakage (BKP-16), no partial restore (a failure injected mid-restore left everything unchanged).

### Recovery instructions for the owner

The plain-language recovery guide (new phone, cleared browser storage, lost computer, forgotten sync token, lost GitHub access, restoring a previous backup) is **Part C of the owner checklist**. In one paragraph: **your data lives only in your browser.** A saved backup file plus (if it is encrypted) its passphrase is enough to get everything back on any device. The GitHub sync token and the sync passphrase are never inside a backup and cannot be recovered; you re-create the token on GitHub and you must remember or have written down the passphrase. **An encrypted backup cannot be opened without its passphrase, by anyone, including me.**

---

## 12. Offline and PWA results

See matrix OFF-01 to OFF-17. In short: the worker installs and saves every screen; with the server stopped, **18 of 18** addresses (and 13 of 13 with the large household) open from scratch; local reads and writes work; backup export starts; five releases never grow the cache past two builds; other apps' caches and your records are untouched; an old tab gets a truthful message and an explicit **Reload Ledger**; unsaved typing is never discarded by an update.

**Two honest limits (ST5-F5):** (1) after a partly failed install the "incomplete" mark never clears, even after the missing file is fetched later, and the incomplete build stays as the only fallback until the next release (harmless: the newest build is complete); (2) when the computer believes it is online but the server is unreachable (as in my test), the "did not load" message says reloading may fetch a new version, which would not help offline. A phone in airplane mode reports itself offline and should show the offline wording from ST-S4; **that wording was not seen on a device.**

**Not done (D):** real airplane mode, the installed home-screen app, iOS Safari, Android Chrome, the one-time first-update download. Separate checklists for iOS Safari / Home Screen and Android Chrome / installed PWA are in the owner checklist (Part B2).

---

## 13. Calendar and recurrence results

See CAL-01 to CAL-15. A fortnightly service appears at exact 14-day intervals; a twice-a-month schedule follows its configured dates and business-day rules across short months, a leap year (2028-02-29) and weekends; the 12-month horizon rolls; exactly one open Task exists per arrangement; derived items have stable, unique ids; the same dates and the single Task survive sync and a wipe-and-restore. **Public holidays are not supported by design**; they are not considered by the business-day rule.

---

## 14. Mobile and accessibility results

Passes: names on every field and control, one `main` and one `h1`, a skip link, named navigation landmarks, arrow keys in tab groups, Search as a combobox, focus return, the destructive dialog (Cancel first, trapped, Escape safe), no overflow at 375 px, Hide Amounts clean in accessible names, contrast clean in light and dark.

Findings: **ST5-F3** (heading jumps from `h2` to `h4` on the Household Services overview when it has spending data) and **ST5-F4** (the "All" link on Ledger Home is 20 px wide). Both P3, presentation only.

**Everything that needs a person remains PENDING:** a real phone (thumb reach, readability, keyboard covering fields, rotation), VoiceOver/TalkBack/NVDA (do Budget and Scheduled first), spoken error announcements, and the "no amount is spoken while Hide Amounts is on" check.

---

## 15. Performance results

All measured on the **released build** (`dist-A`), headless Chrome, 5 runs, medians, same method as ST-S4 (emulated 375 x 812 phone with a 4x slower processor and 1.6 Mbps / 150 ms network; "cold" = nothing saved, "warm" = installed). The machine was slower today than during ST-S4 (the same ST-S3 build, measured now, took 5.1 s to be usable on a cold phone against ST-S4's 4.6 s), so the table gives both the ST-S4 figures and a **same-session A/B** against the ST-S3 build, which is the fair comparison.

| Scenario | ST-S4 report | This session, ST-S4 build | This session, ST-S3 build (same hour) |
|---|---|---|---|
| First JavaScript, compressed | 336 KB, 17 files | **336 KB, 17 files** | 638 KB, 1 file |
| Phone, cold, Today usable | 3,243 ms | **3,800 ms** (A/B run: 3,783) | 5,147 ms |
| Phone, cold, Budget deep link | 4,086 ms | **4,583 ms** (A/B run: 4,236) | 4,945 ms |
| Computer, warm, Today usable | 139 ms | **214 ms** (A/B run: 139) | 224 ms |
| Phone, warm, Today usable | 573 ms | 936 ms | not measured |
| Computer, cold, Bills deep link | 265 ms | 379 ms | not measured |
| Offline precache | 43 entries, 2.4 MB | **43 entries, 2.4 MB** | |

Reading: the **bytes and file counts are identical** to the ST-S4 report; the relative improvement over ST-S3 reproduced (phone cold Today -26%, computer warm Today -38%, phone cold Budget -14%); the absolute times are higher than ST-S4's because this machine was busier. **I do not treat the difference as a regression** (the same-hour ST-S3 build moved by the same amount) and I did not start any optimization.

**Large synthetic household (H10K, computer, warm, medians of 5):** Today 109 ms, Bills 121, Calendar 110 (usable 145), Transactions 114, Household finances 101; with the browser cache off and no service worker, Today 179 ms. JavaScript heap at the end: 11 to 16 MB. Restoring the 4.8 MB file took 2.8 s. Search, Calendar providers and the overview at 1,000, 10,000 and 50,000 transactions were measured in ST-S4 (nothing over 0.9 s) and not repeated.

**Not measured:** a real phone (parse and start-up time on a real device, memory pressure, thermal limits). The table says nothing about those.

---

## 16. Test-suite health

| Check | Result |
|---|---|
| `npm test` (baseline run) | **3,601 passed, 198 files**, 0 failed, 0 skipped, 0 todo; 58.1 s |
| `npm test` (second run) | **3,601 passed, 198 files**, 46.4 s; same pass list. A fourteenth run after the documents were written (final check): 3,601 passed, 43.1 s |
| Shifted clock or time zone, whole suite | 8 runs, **all 3,601 passed**: 2027-01-08 17:00 UTC New York (inside the old id-digit trap window), 2026-12-31 23:50 UTC, leap day 2028-02-29, US spring-forward day 2027-03-14, US fall-back day 2026-11-01, UK spring-forward 2027-03-28, UTC+14, UTC-11 |
| Three whole suites at once | all three 3,601 passed; wall 173 s against 46 to 58 s alone (about 3.5x slower) |
| `npx tsc --noEmit` | clean (3.4 s) |
| `npm run build` equivalent (`vite build`) | succeeds; 35 files in `assets/`; the usual 500 KB warning for the entry file (711 KB, 222 KB compressed) and Ledger's screens (579 KB, 155 KB) |
| `git diff --check` | clean |
| `npm audit` | 0 vulnerabilities |
| Named regression groups | golden masters **157/157**; ST-S1 accounts, conflicts, preferences and id scans **52/52**; ST-S2 transaction deletion, guards and shared utilities **92/92**; ST-S3 accessibility, contrast, structure, modal keys and navigation **100/100**; ST-S4 worker, lazy loading and write trap **78/78**; backup and restore **60/60**; SyncEngine and the two-device module suites **146/146** |
| Real `.skip`, `.only`, `.todo` markers | **0** |
| Per-test timeouts above the 30 s default | **0** (ten tests state 30 s, the same as the default) |
| Flakiness | no test failed in any of 14 executions. I looped the two tests earlier phases flagged as intermittent, 20 runs each: `core.test.ts` 0 failures, `swBuilds.test.ts` 0 failures |
| Slowest test | alone: 4.8 s (first run) and 3.7 s (second); under three suites at once: **9.5 s, 10.1 s and 11.0 s**, always `txnDeletion.test.ts` "the registry offers a reader from every module..." against the 30 s limit (about 2.7x headroom, narrower than ST-S4's 5x because this machine is busier). CI measured 2.4x slower than local in S0, so about 11.5 s there. **Watch item (ST5-F7), not a defect** |
| Source-guard non-vacuity (mutation) | on a scratch copy of the source, six deliberate breaks, **6 of 6 caught** by the repository's own tests: household overview writes to Finance (4 tests failed); account with Scheduled rules deletable again (5); sync conflict list capped at 50 again (11); stale deletion preview accepted (5); worker deletes other apps' caches (1); restore applies preferences before the database (1). The scratch copy was restored byte for byte |
| Test isolation / shared state | nothing found; each file builds its own database. The behavioural write trap (`readOnlyTrap.test.ts`) is non-vacuous (it first proves it sees add, put, update, delete, bulk add, alias write, read-write transaction and clear) |
| CI reliability | Pages run #78 succeeded first time; the S0 history shows 28 of 30 runs green with one cancelled and one fixed date-dependent failure |
| Bundle build consistency | the local build of `HEAD` is byte-identical to the deployed one (section 2) |

**Test-suite additions:** none. No test was weakened, skipped or deleted.

---

## 17. Security and hosting-isolation status

### SE-01 is still open (P1) and is not closed by ST-S4

- **Reconfirmed today (read-only HTTP, no vulnerability testing of the other apps):** `https://marshmond.github.io/ledger/`, `/FBB/` and `/Foodventory/` all answer 200 on the same origin; the account has exactly three public repositories, all with Pages enabled; the Foodventory page still loads `cdn.jsdelivr.net/npm/@zxing/library@0.19.1` and `accounts.google.com/gsi/client` and has 18 `innerHTML` assignments; FBB has 4 and no outside scripts. Nothing about this changed since S0.
- **Why code cannot fix it, shown locally:** in a disposable profile I put an invented token and an invented contact into Ledger's storage on `127.0.0.1:5341/ledger/`, then opened an unrelated page at `127.0.0.1:5341/other-app/` (same origin). That page listed both Ledger databases, read the sync configuration (including the invented token) and read the invented contact. This is the exposure in miniature. ST-S4 made Ledger's service worker stop touching other apps' caches (good for them); it does **not** stop their scripts reading Ledger.
- **Preferred solution (from the hosting plan, unchanged):** the plan's option **A**, a custom domain for the existing `ledger` repository (keeps history, Actions and deployment; costs a domain, roughly ten to fifteen dollars a year, UNVERIFIED). If you prefer free: option **B**, a separate GitHub account or organization for Ledger (a repository transfer). Option **C** (move the other two apps) needs no Ledger data move but leaves the problem one careless future publish away; best as an addition, not the only measure.
- **Prerequisites:** two-factor on every involved account; a decision on A, B or C and, for A, a domain; a fresh encrypted and plain backup; the sync passphrase and backup passphrase written down somewhere safe; a rehearsal on the new address with invented data first.
- **Every step needs your written authorization before anyone acts:** creating or choosing the domain or account, any DNS change, the Pages custom-domain setting, a repository transfer or remote change, unpublishing or moving the other apps, rotating the GitHub token. I have done none of them and will not without that authorization; no token should be pasted into chat.
- **How browser data would move safely:** browsers do not move stored data between addresses. Make a backup on the old address, open the new address, set up sync with the same private repository, token and passphrase and choose **"use the synced copy"** (a safety copy is saved first), compare counts and the Household finances figures, repeat on each device, re-install the home-screen shortcut. The old address keeps its data throughout; that is the rollback.
- **How to verify the new origin is isolated:** (1) note `location.origin` in Ledger (must not be `https://marshmond.github.io`); (2) in a different app still on the old origin, run `indexedDB.databases()` and `localStorage.getItem('ledger-sync-config')`: expect no `ledger` database and `null`; (3) from the old Ledger address, expect nothing after the data is cleared; (4) confirm sync and a backup restore still work; (5) record it in the next report.
- **Rollback and recovery:** remove the custom domain (A) or transfer the repository back (B); re-publish the other apps at their old addresses (C). The old origin's data was never deleted until you chose to, so nothing is lost. If the move is abandoned after data was entered at the new address, take a backup there and restore it at the old one.
- **Remaining weakness after the move:** none for the shared-origin problem, provided the new origin hosts nothing else. Separately, secrets in plain local storage (SE-02) stay an accepted trade-off.

### Other security checks

No change to the Content-Security-Policy; connections are only to GitHub and Twelve Data; no network request left the machine during backup, restore or offline use (BKP-16); `npm audit` found nothing; no real token or passphrase was requested or used.

---

## 18. Disposition of every original P0, P1 and P2 finding

Rule applied: a finding is closed only on evidence I can name. "Awaiting device" means the code behaves in a browser but a person has to try it on a phone or with assistive technology.

| ID | Sev | Disposition | Supporting evidence |
|---|---|---|---|
| (P0) | | none were ever found | |
| **SE-01** shared web address | P1 | **STILL OPEN** (owner-led; the risk is not accepted) | section 17; local demonstration; hosting plan unchanged |
| **DI-01** account deletion orphans Scheduled items | P1 | **FIXED AND VERIFIED** | DEL rows (active, paused, loan refuse; missing account refuses and writes nothing); repository `accountIntegrity` tests; mutation M2 caught; browser refusal notice |
| **SY-01** conflict list capped at 50 | P2 | **FIXED AND VERIFIED within one tab; residual cross-tab gap (ST5-F2)** | SYN-02 to SYN-06 at 50/51/120/500; mutation M3 caught; cross-tab race reproduced. Real-device sync still PENDING |
| **TS-01** id-digit tests fail 2027-01-03 to 01-15 | P2 | **FIXED AND VERIFIED** | whole suite green with the clock at 2027-01-08 and in 8 shifted runs |
| **DI-02** no dependency warning on transaction delete; bulk not atomic | P2 | **FIXED AND VERIFIED** | DEL rows; four modules named; stale previews refuse; 50-delete injected failure atomic; mutation M4 caught |
| **AX-01** unlabeled Budget and Scheduled inputs | P2 | **FIXED, AWAITING SCREEN-READER ACCEPTANCE** | BUD-01/02, SCH-01: 10 of 10 and 6,835 of 6,835 named in Chrome; no figure in any name. Nothing was heard through a screen reader |
| **AX-02** small touch targets | P2 | **FIXED, AWAITING PHONE ACCEPTANCE; one P3 residual** | 0 controls under 24 px at 375 px except the 20 px-wide "All" link (ST5-F4); comfort on a real thumb unverified |
| **PF-01** one 2.28 MB script | P2 | **FIXED AND VERIFIED in emulation; real-phone start-up time unverified** | 336 KB in 17 files (was 638 KB in 1); A/B against the ST-S3 build reproduced the improvement |
| **SY-02** repository history growth | P2 | **STILL OPEN (owner reading)** | needs the Sync-page file size and uploads in 30 days; unknown to me |
| **BK-02** restore of a weekly GitHub copy never rehearsed; secrets custody | P2 | **MITIGATED, with limits** | the restore-from-file path is now rehearsed end to end in disposable profiles; downloading from real GitHub and using real secrets is PENDING; the secrets are never in a backup |
| **UX-04** destructive Finance actions plain and no warning | P2 | **FIXED AND VERIFIED** | ACC-11/12, DEL rows |

**P3 items kept separate.** Fixed and verified: BK-01 (three preference keys travel), SE-03 (cache trimming, other apps' caches safe), AX-03/04/05 (landmarks, contrast, announced errors, in Chrome), UX-02/03/05, ARCH-01/02/03, TS-02/03/05/06, NV-01. Unchanged or deferred: SY-03 clock-skew warning, SY-04 back-off, DI-03 purge of old soft-deleted records, DI-04, SE-02 plain-text secrets, SE-04 8-character passphrase minimum, SE-05, SE-06, UX-01 (Hide Amounts scope, documented), TS-04 (still no DOM test tool; this phase added browser drills outside the repository), DOC-01/02 (handoff compaction not done; this phase updated the handoff and backlog).

**New in ST-S5:** ST5-F1 (P2 latent), ST5-F2 (P2 residual), ST5-F3 and ST5-F4 (P3), ST5-F5 to ST5-F7 (info). Section 21.

---

## 19. Outstanding owner acceptance tasks

1. Phone: open every module, use Search and Quick Add, edit a Budget amount, approve or skip a Scheduled item (disposable data), tick a Transactions checkbox, navigate Calendar, try a destructive confirmation without deleting anything real, judge readability and touch comfort.
2. Installed app and airplane mode on iOS Safari / Home Screen and Android Chrome / installed PWA, including offline data entry and reconnection; the one-time first update.
3. Two-device sync with real GitHub: offline edits on both, reconnect, conflict review, cross-module spending check.
4. Download a backup; restore an **invented** encrypted backup into a disposable profile.
5. Screen-reader smoke test (Budget and Scheduled first).
6. Recovery rehearsal in a **disposable** profile (never clear real data as a test).
7. Confirm the three secrets are stored in your password manager.
8. Read the two Sync-page figures (SY-02).
9. Decide the hosting-isolation option (SE-01).

## 20. Family Management readiness (two separate decisions)

- **Functional readiness: CONDITIONAL.** The foundations carry a new module (lazy loading, registry, providers, `moduleRecords`, backup and sync coverage). Conditions: (a) the person-model decision (O-10, whether a household member is a contact, a Finance `people` entry, or both) is made in writing; (b) **no new database tables** until ST5-F1 is fixed, so Family Management must live in `moduleRecords` like every module so far; (c) ST5-F2 fixed or the risk accepted; (d) a rule about masking sensitive family data and whether it belongs in plain backups; (e) the real-device acceptance in section 17 done.
- **Security gate: CLOSED.** Family Management must not be marked ready to implement while SE-01 is unresolved, unless you explicitly accept that risk after reviewing section 17. ST-S4's cache-isolation improvement does not change this. This is a separate decision from the functional one.

## 21. Defects and recommended corrections (nothing below was implemented)

| Ref | Sev | Finding | Recommended tightly scoped correction | Needs owner authorization because |
|---|---|---|---|---|
| ST5-F1 | P2 latent | An older device erases rows of tables it does not know, and newer devices then delete their copies | Make the merge pass unknown tables through unchanged; one two-sync test; **meanwhile: no new tables** | it changes the sync engine |
| ST5-F2 | P2 residual | Two tabs can overwrite each other's saved conflict list | Web Locks around conflict-list changes and sync runs; a two-instance test | it changes sync |
| ST5-F3 | P3 | Services overview jumps `h2` to `h4` ("Counted", "Same payment, counted once elsewhere") | change the two headings to `h3` | none (presentation); a separate small change |
| ST5-F4 | P3 | "All" link on Ledger Home is 20 px wide at 375 px | minimum width 24 px on phones | none (presentation) |
| ST5-F5 | P3 info | An incomplete-install mark never clears; the offline "did not load" wording is generic when the device still believes it is online | clear the mark when the missing file is saved; check wording on a real phone first | it touches the worker and offline behavior |
| ST5-F6 | info | The sync file's version field is never read | add a version gate if the format ever changes | sync |
| ST5-F7 | watch | Slowest test is 11 s under three-way load against a 30 s limit | none now; revisit if CI runs slower than 2.7x | |

---

## 22. Exact final Git status

Taken at the end of the batch, after the last test run, type check, `git diff --check` and privacy scan of the new documents. Nothing is staged, committed or pushed.

```
branch: main   HEAD = origin/main = 4b827eb5e36fea8919708e2f0394d9667b5eda3e   (ST-S4, Pages run #78 success; git ls-remote agrees)
 M README.md                                                      (one bullet: link to the owner checklist and recovery guide)
 M docs/BACKLOG.md                                                (new ST-S5 entry on top; ST-S4 heading corrected to committed and deployed)
 M docs/CHATGPT-HANDOFF.md                                        (header, snapshot, invariant, risks, change log; ST-S4 corrected)
?? docs/LEDGER-STABILIZATION-ST-S5-ACCEPTANCE-2026-11-09.md       (this report)
?? docs/LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md       (owner checklist and recovery guide)
?? docs/LEDGER-STABILIZATION-FINAL-DISPOSITION-2026-11-09.md      (one-page carry-forward)
```

| Confirmation | Result |
|---|---|
| Production source modified | **No.** `git diff` over `src/`, `public/`, `package.json`, `package-lock.json`, `vite.config.ts` is empty; `.github/workflows` untouched |
| Schema or dependency change | **No** |
| Application data touched | **No.** Only invented data in disposable Chrome profiles and in-memory databases; those profiles and the invented download folders were deleted afterwards |
| Real data cleared | **No** |
| Hosting, DNS, remotes, GitHub permissions | **No change.** Only read-only HTTP requests to public pages and the public API |
| Stage, commit, push, deploy | **None** |
| Handoff updated | **Yes** (header, snapshot, new version-skew invariant, new open-risk bullet, change log). Unknown: real-device behavior |
| Final checks | `npx tsc --noEmit` exit 0; `npm test` 3,601 passed in 198 files (final run); `git diff --check` exit 0 (only Git line-ending notices); privacy scan of the three new documents found no token, key or personal data |
| Scratch material (outside the repository, not committed) | the drill tests, browser scripts, a scratch copy of the source used for other-release builds and for mutation checks, an invented 10,000-transaction household file, run logs |

## 23. Final recommendation: GO / CONDITIONAL GO / NO-GO

### CONDITIONAL GO

Automated and browser evidence is strong and no data-loss problem is reachable today. The verdict is not a full GO because owner-device acceptance and the hosting-security decision are open, and because two sync findings should be fixed before the app grows.

**Conditions required before a full GO** (none of them blocks day-to-day use):

1. **C1 (hosting):** SE-01 resolved and verified from the other apps' address, or explicitly accepted by you in writing after reading section 17.
2. **C2 (phones):** section 19 items 1 and 2 passed on a real phone, iOS and Android if you use both; any failure logged and triaged.
3. **C3 (real sync):** the two-device, airplane-mode, conflict-review test passed with real GitHub.
4. **C4 (recovery):** one rehearsal of "restore an encrypted backup into a disposable profile", ideally a real weekly GitHub copy, with the secrets confirmed written down.
5. **C5 (screen reader):** the smoke test on Budget and Scheduled, or an explicit decision to skip it.
6. **C6 (ST5-F1):** fixed with a test **before any release adds a database table**; until then no new tables.
7. **C7 (ST5-F2):** fixed, or you accept the narrow risk and use one tab at a time.
8. **C8 (SY-02):** the two Sync-page figures read and found small.

**Why not NO-GO:** no material data-integrity, sync, backup, offline-access or security failure is reachable in normal use today. ST5-F1 needs a schema change that no release has made; ST5-F2 needs two tabs merging different conflicts in the same instant; SE-01 is a known, documented exposure with a plan and no sign of misuse.

**What should happen next (my recommendation):** (1) you decide the hosting option and tell me to prepare it; (2) authorize one small, separate "sync safety" change for ST5-F1 and ST5-F2 with tests, plus the two presentation fixes; (3) you run the owner checklist on your phone and a second device; (4) only then plan Family Management, starting with the person-model decision. I did not begin any of these.
