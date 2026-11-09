# Ledger stabilization ST-S4: measured performance, on-demand screens, offline reliability and test-suite health

**Date:** 2026-11-08. **Status:** BUILT AND TESTED LOCALLY. **NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED.** Not tested on a real phone. Awaiting independent review and the owner's explicit authorization.

Source: `docs/LEDGER-STABILIZATION-S0-AUDIT-2026-11-08.md` (`PF-01`, `SE-03`, `TS-02`, `TS-03`, `TS-05`, `TS-06`) and the roadmap's ST-S4 section. This phase changes how the app is delivered and how its tests are run. No financial figure, calculation, stored record, database table, sync format, backup format or dependency was changed.

---

## 1. Executive summary

| Item | Result |
|---|---|
| **PF-01** one 2.31 MB script | Done. Each module's **screens** now load the first time the module is opened; the first download holds the app shell, Today and every module's background contributions. **Scripts fetched at start-up: 638 KB compressed in one file before, 336 KB in 17 files now (-47%)**. Raw size 2,315 KB to 1,068 KB (-54%). Total code grew 1.2% (34 files, 2,343 KB) because of the split. |
| Is it faster? | **Yes in every scenario measured, by wide margins only where the network is the limit.** Mobile (emulated, 4x slower processor, 1.6 Mbps): Today usable **4.6 s to 3.2 s**, deep link to Ledger Budget 5.0 s to 4.1 s. Desktop and warm cache: 205 ms to 139 ms (Today), 151 ms to 102 ms (Bills deep link). Opening a module from inside the app stays near instant (17 to 37 ms, was 9 to 27 ms). Table in section 6. |
| Offline | **Preserved and tested with the server stopped:** 18 of 18 addresses (every module, Settings, Backup, Sync, deep links) open from scratch, in-app module switching works, a Task added through the Add box offline is found by Search, and backup export still starts a download. The service worker now saves **every** screen file when it installs, so a module that was never opened before going offline still opens. Simulated, not airplane mode on a phone. |
| **SE-03** cache never trimmed | Fixed and reproduced first. Each build gets its own cache; the build before it is kept for tabs still open; older ones are removed, so the cache is bounded to two builds (about 2.4 MB each) instead of growing about 2 MB per release forever. Only caches this app made are touched (the old worker deleted **every** other cache on the web address, including other apps' caches; that is fixed). |
| Old tab, new deploy | Tested end to end in Chrome with three releases: a tab one release behind still opens a screen it never loaded (served from the saved copy of its own release, no server request); a tab two releases behind gets a clear "did not load" message with **Reload Ledger**. |
| **TS-02** timeouts | 137 per-test timeouts of 60 to 180 seconds were removed. The slowest test takes 3.7 s alone and 6.1 s with three whole suites running at once (3.7x slower than normal); the 30 s default stays. A hung test now costs 30 s, not up to 3 minutes. |
| **TS-03** name-list guards | One new behavioral guard watches the database itself for any write by any route while the readers run, with a positive control for every write kind; one self-checking list. Section 13. |
| **TS-05** real clock | Full suite passed at 8 shifted clocks and time zones (section 12). No fragile test was found, so no shared clock helper was added (section 12 says why). |
| **TS-06** mutation scripts | Section 14: **55 of 55** existing mutations caught (Household finances B5 and Bills B4), source restored byte for byte; plus 24 new ones for this phase, 23 caught and 1 that is checked in the browser only. |
| Scale | 1,000, 10,000 and 50,000 transactions with 300 bills, 80 arrangements, 4,000 visits, 600 tasks: no operation passes 0.9 s, database requests do not grow with the transaction count, nothing needed optimizing. |

**Tests:** 3,531 in 193 files at the released baseline, **3,601 in 198 files** now (+70 tests, +5 files); no test skipped, deleted or weakened. `tsc` clean, `npm run build` succeeds (section 19).

---

## 2. Verified ST-S3 release gate

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (`origin` = `https://github.com/marshmond/ledger.git`) |
| Branch | `main` |
| Local HEAD vs `origin/main` after `git fetch` | both `6632576694cd07ea0147eb3a3536ccd12ed21587` |
| ST-S3 commit | `feat(stabilization): ST-S3 accessible names, phone targets, landmarks and focus, contrast, error announcements, destructive dialogs` (79 files); it contains the final keyboard, route-focus, contrast and destructive-dialog work (`SkipAndRoute.tsx`, `routeFocus.ts`, `ConfirmDialog.tsx`, `rovingKeys.ts` and the three ST-S3 test files are in it) |
| Deployment | GitHub Actions "Deploy to GitHub Pages", **run #77** (id 42537527077), `completed` / `success`, `head_sha` = `6632576...`, 2026-11-08 23:56:02Z to 23:57:52Z. Read from the public Actions API because the `gh` command is not installed here |
| Working tree at start | clean |
| Unexpected commits | none |
| ST-S4 already started | no |
| Actual post-release baseline | `npm test`: **3,531 passed in 193 files**, 66.9 s (12 logical processors, Windows 11, Node 24.15) |

---

## 3. Changed-file inventory

**New source (6 new files) and the rewritten worker:**

| File | Purpose |
|---|---|
| `src/core/lazyModule.ts` | `lazyModule(loader)`: the on-demand wrapper (asks once, own loading state, forgets a failure), `preloadLazyModule`, `retryLazyModule`, `isChunkLoadError`, `PendingView` |
| `src/shell/ModuleLoader.tsx` | `ModuleLoading` (empty `main` + marker, words after 150 ms), `ModuleLoadFailed`, `ModuleLoadBoundary` |
| `src/modules/bases.ts` | the six address prefixes, away from the screens |
| `src/modules/moduleStyles.ts` | every module's stylesheet in the original cascade order |
| `src/modules/ledger/routePaths.ts` | Ledger's address list, away from its page components |
| `src/swBuild.ts` | build-time helpers: file list, build fingerprint, fill the worker |
| `public/sw.js` | rewritten worker (see section 10) |

**Modified source and configuration (21 files):** `src/App.tsx` (lazy Settings, `preloadForAddress`, module boundary), `src/main.tsx` (start-up preload, waits at most 400 ms), `src/shell/SkipAndRoute.tsx` (route announcer waits while a screen is loading), `vite.config.ts` (`serviceWorkerBuild` plugin; timeout comment), the eight `src/modules/*/index.tsx` registrations (`Component: lazyModule(...)`; Today stays eager), `src/modules/index.ts` (imports `moduleStyles`), and the eight `*Module.tsx` shells (base constant and stylesheet import moved out; each still exports its constant where it had one). 27 existing test files lost only the trailing timeout argument (section 11).

**New tests (5 files, 70 tests):** `src/core/lazyModule.test.tsx` (18), `src/modules/lazyBoundary.test.ts` (13), `src/swBuild.test.ts` (10), `src/swBuilds.test.ts` (15), `src/lib/readOnlyTrap.test.ts` (14).

**Documents:** this report; `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `README.md` (one line), `docs/module-hooks.md` (new section on loading screens on demand).

Not changed: anything that computes money, the Finance engines, Scheduled recurrence, B3 payment links, B4 cancellation, B5 union, `db.ts`, `backupFile.ts`, the sync engine, `package.json`, `package-lock.json`, the CSS files, the hosting plan.

---

## 4. Architecture inspection (what was eager and why)

Every module's `index.tsx` imported its whole shell (`BillsModule`, `LedgerModule`...) only to put it in `Component`, and Ledger also built its address list from its page elements. Because the registry needs every module's contributions before it is opened, the bundler followed those imports and pulled **all pages of all modules** into one file. Nothing else ties the pages to start-up: a search for import-time side effects found one registration call (`registerModules()` in `App.tsx`) and none in any page file, so moving screens to a later file cannot lose a registration.

| Kind of import | Examples | Verdict |
|---|---|---|
| Needed immediately | the registry, router, shell, Today (its screens and cards), the six due providers, search sources, Add-box definitions, record sources, `txnReferences` readers, Today-card components, the data readers behind those cards | stays in the first download (they are background contributions) |
| Needed only when a module is opened | `LedgerModule` and its 30 pages, `BillsModule` and its pages, Services, Assets, Projects, Calendar, Tasks, Household finances screens, `SettingsPage` (Backup, Sync, Appearance) | now on demand |
| Shared helpers that pull large trees | Bills' read model (needed by the Today card and due provider), Services' views, Assets' overview, plus `react-dom`, `dexie`, `react-router` | stay eager; they are readers, not screens. Splitting them (making each Today card and due provider load its reader late) is possible but moves registry semantics; **not done** (section 5) |
| CSS | eight module stylesheets, 111 KB (19 KB compressed) | **kept eager, in the original order** (section 5) |
| Circularity risks | `lazyModule.ts` (core) imports nothing from the shell; `ModuleLoader.tsx` (shell) imports `lazyModule`; `SkipAndRoute` imports the marker name from `ModuleLoader` | none found; `tsc` and the import-graph test pass |

---

## 5. Chunk boundaries: proposed, implemented, and what was deliberately not done

**Implemented:** one on-demand file per module's screens (`LedgerModule` 579 KB / 154 KB compressed, `BillsModule` 223/57, `ServicesModule` 113/28, `AssetsModule` 110/28, `ProjectsModule` 82/21, `CalendarModule` 42/13, `HouseholdModule` 23/6, `TasksModule` 14/5) plus `SettingsPage` (21/7) and shared files the bundler found. Today's screens stay in the first download: it is where the app opens, and a second request would only slow it. The build produces 34 JS files; the first page loads 17 of them (the entry and 16 it names with `modulepreload`, so they download in parallel).

**Not done, with reasons:**
- *Styles are not split.* The stylesheet is 19 KB compressed; Today's cards use classes from several modules; keeping one sheet in one order means the cascade, and so every screen's look, is exactly what it was. The built CSS file is byte-identical to the baseline (`index-CEA-eZrc.css`, same hash).
- *Module readers are not split.* Making each Today card and due provider import its reader late would trim another 150 KB or so from the first download for deep links, but it changes when registered code runs and every Today launch needs all of them anyway. The brief prefers a proven partial split; this is the next boundary if a measurement ever asks for it.
- *No change to financial code, the router, URLs or the registry's meaning.* No dependency was added (`package.json` has no diff).

---

## 6. Measured performance (before and after)

**Method.** Headless Chrome 156 driven through the DevTools protocol from a scratch folder (nothing is added to the repository), on a **fresh disposable profile** per cold run, so no real browser database is touched. The production build (`vite build`) of each version is served by a small server that gzips text and sends `Cache-Control: max-age=600`, like GitHub Pages, under `/ledger/`. "Mobile" is a 375x812 emulated phone with touch, a 4x slower processor and 1.6 Mbps / 150 ms network. "Cold" = nothing cached, service worker absent. "Warm" = installed, service worker controlling the page, files in Cache Storage. Each cell is the **median of 5**; ranges are in the raw JSON kept in the scratchpad. Marks come from a page-side observer: *navigation usable* = the top bar exists; *usable* = the page heading exists (the cards then fill in). Empty database.

| Scenario | Navigation usable (ms) before to after | Page usable (ms) before to after | Scripts transferred before to after | Script run time (ms) |
|---|---|---|---|---|
| Desktop Today, cold | 248 to 229 | 294 to 265 | 638 KB, 1 file to 336 KB, 17 files | 116 to 93 |
| Desktop Today, warm | 158 to 99 | 205 to 139 | 0 (all from the device) | 107 to 82 |
| Mobile Today, cold | 4,290 to 2,658 | 4,575 to 3,240 | 638 KB to 336 KB | 823 to 864 |
| Mobile Today, warm | 593 to 364 | 836 to 573 | 0 | 628 to 452 |
| Desktop deep link Bills, cold | 356 to 265 | 356 to 265 | 638 KB to 392 KB, 18 files | 120 to 81 |
| Desktop deep link Bills, warm | 151 to 102 | 151 to 102 | 0 | 76 to 57 |
| Mobile deep link Ledger Budget, cold | 4,576 to 3,265 | 5,029 to 4,086 | 638 KB to 497 KB, 20 files | 909 to 831 |
| Mobile deep link Ledger Budget, warm | 568 to 439 | 852 to 772 | 0 | 522 to 443 |

**Large synthetic household in the browser** (invented; 10,000 transactions, 300 bills, 80 arrangements, 4,000 visits, 600 tasks, 200 assets, 10 projects; put in through the app's own **Replace my data** restore of a 4.8 MB file: 2.4 s before, 3.3 s after, both showed 10,000 transactions afterwards). Desktop, median of 5:

| Page | Warm, before to after (ms to heading) | Page-task time (ms) |
|---|---|---|
| Today | 150 to 130 | 851 to 696 |
| Bills | 167 to 122 | 602 to 309 |
| Calendar | 171 to 124 | 312 to 290 |
| Ledger Transactions | 165 to 133 | 325 to 302 |
| Household finances | 185 to 124 | 540 to 481 |
| Today, HTTP cache off and no service worker | 231 to 189 | 724 to 679 |

Page-task time includes the cards' data loading after the heading appears; it did not get worse. Memory (JS heap at the end of the load) was 16.3 MB before and after on Today with the large household, and 6 to 8 MB with an empty database; heap readings are noisy and are given only to show that nothing grew.

**Distinguishing the causes.** *Bytes sent*: halved for the first page, which is what helps on a slow connection (the mobile cold cases improved by 1.1 to 1.5 s, almost all network). *Parse and run*: the first-download script run time fell 20 to 30% on desktop and was flat on the emulated phone, so the saving there is the network, not the processor. *Data loading*: unchanged; the large household costs the same either way. *Latency*: more files add round trips (17 instead of 1), softened by `modulepreload`, which the numbers include. A smaller bundle is not assumed to be faster on a real phone: **no real phone was measured**.

**What the first measurement taught, and what was changed because of it.** The first version (React's `lazy` and `Suspense`) made a deep link to Bills *slower* than before (151 to 410 ms warm) and every first in-app module open 320 ms instead of 17 ms. A processor profile showed the page idle, not busy: React deliberately keeps a revealed "loading" state on screen for about 0.3 s so it does not flicker. Two changes removed it: (1) `lazyModule` has its own small loading state instead of `Suspense`, and shows the screens in the first pass once the file is here; (2) start-up starts downloading the module named in the address while the database opens, and the first draw waits at most 400 ms for it. In-app opening of the eight modules is now 17 to 37 ms (baseline 9 to 27 ms).

**Limitations.** One machine (12 logical processors, Windows 11), headless Chrome only (no Safari, Firefox or real mobile engine), emulated throttling, an empty-database launch for the matrix, local server (no real CDN or HTTP/2 behavior), and Chrome's start-up/parse behavior on a phone is unmeasured.

---

## 7. Lazy loading and the module registry

- **Registration is unchanged and complete before any screen opens.** `src/modules/lazyBoundary.test.ts` proves it: after `registerModules()` alone the registry holds all nine modules (Today first), the Today cards of every module that has one, a search source for all nine, the Add-box destinations (task, event, transaction, scheduled, asset, bill, household service...), the six Calendar due providers, the five `txnReferences` readers, record sources, and Ledger's address list equals the pages its screens serve (so an old bookmark such as `#/budget` still reaches Ledger). Registering twice does nothing.
- **No static route back to the screens.** The same test walks the static imports from `main.tsx` and fails if any lazy module's screens, any Ledger page, or Settings becomes reachable (that is how a future careless import would be caught). Today's screens are asserted to stay in the first download.
- **Cases from the brief:** Today first (eager, no extra request); Calendar first (its screens load; its data hook already had every provider); Search before any other module (search sources are registered, a result opens its page which then loads; checked offline too); a Finance transaction deleted before opening Bills or Services (their `txnReferences` readers are registered, `src/lib/readOnlyTrap.test.ts` runs the preview against the registered readers without any screen loaded); a scheduled approval or Task needing cross-module data (providers and record sources are registered); a deep link (the module is fetched during start-up); offline (section 9).
- **No duplicate registration:** the screens files register nothing (verified by search; the worker and the page cannot call `registerModule` from a late file), and `registerModule` still throws on a repeat.

---

## 8. Loading, failure, accessibility

- **Loading.** Opening a module draws an empty `main#main-content` with a marker and a polite status. "Loading Bills & Subscriptions…" appears only after 150 ms. The top bar, Search and Add box stay usable throughout. Exactly one `main` exists at every moment (browser-checked at 0.9 s per file).
- **ST-S3 behavior preserved (checked at 0.9 s per file, service worker bypassed):** the page title becomes "Bills & Subscriptions · Ledger", the spoken page name is announced once, focus lands on `main#main-content` after the screens arrive (the link that was clicked disappeared, so focus had been lost), the skip link and route announcer are unchanged, dialogs untouched. The route announcer now waits (up to 10 s) while the loading marker is on the page, so it reads the real heading, not the module name.
- **Failure.** With one module file blocked: a deep link shows "Bills & Subscriptions did not load" (`h1`, `role="alert"`, one `main`, **Try again**, **Reload Ledger**, "Nothing you saved has changed"); the top bar still works and Tasks opened normally; with the file unblocked **Try again recovered without a reload** in Chrome; the offline wording differs ("You are offline, and this part of Ledger is not saved on this device yet"). An in-progress form elsewhere is safe: with the Add box open and "Half typed task" typed, a move to a blocked Calendar left the Add box open with the text intact. A real bug in a screen is **not** dressed up as a loading problem (it passes through exactly as before; unit tested).
- **Not verified:** a screen reader (none used); Safari's and Firefox's wording of a failed import (matched by pattern, not observed); a failed import in an engine that remembers the failure (Try again would then not help; **Reload Ledger** does).

---

## 9. Offline reliability (the acceptance boundary)

A disposable origin (fresh profile, invented data), installed online, then the server **stopped** so the network was genuinely unreachable (a direct fetch of an unsaved file failed), then the page reloaded for each address:

| Check | Result |
|---|---|
| Cache after install | one cache, 43 entries, 2.4 MB (all 34 scripts, the stylesheet, the shell, manifest, icons and a small note); the worker controlled the page |
| 18 addresses loaded from scratch with no server | **18 of 18 opened**: Today, Ledger (Home, Budget, Scheduled, Transactions, Accounts, Reports), Calendar, Tasks, Projects, Home & Assets, Household Services, Bills (and Upcoming), Household finances, Settings, Backup, Sync; 102 to 247 ms each; no "did not load" |
| In-app switching offline to eight modules never opened in that page | all opened, 17 to 63 ms |
| Local write offline | a Task added through the Add box (`t Offline check task`) saved |
| Local read offline | Search found that Task after a full reload |
| Backup export offline | the plain backup button started a download ("Ledger Backup 11-08-26.json") |
| Sync of offline edits | not exercised here (no network by design); the sync engine and its tests are unchanged, and edits made offline stay in the database for the next sync |

*Simulated:* stopping a local server is a good test of the worker and cache, but it is **not** airplane mode on a phone, an installed home-screen app, or a browser that evicts storage. Seeing files in Cache Storage was not treated as proof; the pages were actually opened.

**How the screens become available offline.** The build writes the exact list of built scripts and styles into the worker (no hand-typed filenames, nothing to go stale), and installing saves all of them. If a save fails part-way (the connection drops during install) the install still completes and the worker marks its cache incomplete, so the previous builds are kept (section 10). The smallest approach: the existing worker, a build-written list, no new library.

---

## 10. Service worker and cache (SE-03)

**Reproduced first.** The old `public/sw.js` had the constant cache name `ledger-v1`, never changed (so a browser never updated the worker), saved every hashed file it saw into that one cache with no limit, and on activation **deleted every cache on the web address that was not named `ledger-v1`**. The web address is shared with the FBB and Foodventory apps (SE-01), so that last rule was a risk to them. **Reproduced** by running the original worker (taken from Git, unchanged) through four releases in the simulated worker environment: after each release `ledger-v1` held one more hashed script (1, 2, 3, 4) and was never trimmed; and on the very first activation two other apps' caches that had been placed on the same address (`fbb-v3`, `foodventory-cache`) were deleted. Not measured on a real device.

**Now:**

| Rule | How |
|---|---|
| New file each release | the build fills `dist/sw.js` with a short fingerprint of everything saved plus the file list (`src/swBuild.ts`, plugin `serviceWorkerBuild` in `vite.config.ts`); a worker that lost its placeholders makes the build **fail**, so a release cannot ship a cache that never changes |
| One cache per build | `ledger-<fingerprint>`, with a small note inside (`ledger-generation.json`: build, install order, time, address, complete?) holding no data from the app |
| Retention | keep the new build and the one before it; if the new build could not save everything, keep two before it; remove the rest. "Before" means **install order** (a counter one higher than any build already there), never the clock: a device whose clock moves back, or two installs in one millisecond, cannot make the wrong build look old. (An intermittent test failure found this: the first version ordered by time.) A leftover unmarked `ledger-v1` is removed. The cache is therefore bounded to two or three builds (about 2.4 MB each) |
| Ownership | only caches whose name starts `ledger-` AND that carry no note, or a note for this address, are ever considered; `fbb-*`, `foodventory-*`, `workbox-*`, `my-ledger-notes`, upper-case look-alikes and another copy of Ledger at a different address are left alone (tested) |
| Requests | only same-site GET requests inside the worker's own folder are handled; everything else is untouched. A hashed file is answered from the device without asking the network again (its name proves it never changes); fixed-name files keep "answer from the device, refresh in the background" |
| Unchanged hashed files | copied from the previous build's cache instead of being downloaded again (tested: a release that changed two files downloaded two) |
| User data | the worker never touches IndexedDB, localStorage or the app's database (nothing in it can) |
| Runtime caching | no new unbounded strategy; the existing on-first-use caching stays |

**Old tab, new deploy (browser test, 3 releases A, B, C on one address, caching off on the test server so only the worker's cache answers, two tabs open on A):**

| Step | Observed |
|---|---|
| A installed | 1 cache, 43 files, complete |
| B deployed (A's files gone from the server); tab 1, still running A, opens Bills (a screen it never loaded) | caches: A and B. Bills opened, built from A; **no request reached the server** (served from A's saved copy). After a reload tab 1 ran B |
| C deployed | caches: B and C (A removed). Tab 2, still on A and never opened Bills, opens Bills: **"Bills & Subscriptions did not load"** (A's file is gone everywhere). **Reload Ledger** loaded release C and Bills opened |

So an open tab survives one release behind and gets a clear message two behind. Before ST-S4 an old tab never failed this way (everything was already in memory), so this is a small, honest cost of splitting; it is documented to the owner as a limitation. Note that GitHub Pages sends `max-age=600`, so Chrome's own cache may extend this grace slightly (the first run of this test, with that cache on, never failed).

**Not done (by instruction):** nothing to solve SE-01 through the worker; hosting, DNS and permissions untouched.

---

## 11. Test-suite timeouts (TS-02)

| Measurement | Result |
|---|---|
| Tests with a per-test timeout above the 30 s default | **137**, in 27 files: 81 at 90 s, 47 at 60 s, 8 at 120 s, 1 at 180 s (10 more at exactly 30 s, left alone) |
| Slowest single test, alone | **3.7 s** (`h5-overview` performance); no test over 5 s |
| Slowest test with **three whole suites running at once** (36 workers on 12 processors, wall time 190 s vs 52 s, 3.7x slower; CI measured 2.4x in S0) | **6.1 s**; three tests over 5 s, none over 10 s; all 3 x 3,599 passed |
| Change | the 137 trailing timeout arguments removed (one line each, nothing else on the line); the default stays **30 s** (about 5x headroom in the harsh run). The comment in `vite.config.ts` records the numbers |
| Result | 3,601 passed in 198 files (3,599 in 198 when this was measured), 0 skipped, 0 todo, with no override above 30 s. A hung test now holds a run for 30 s instead of up to 3 minutes |

Not changed: the 10 tests with a 30 s limit (same as the default). Test-file parallelism is Vitest's default (one worker per file); a note from the runner says `isolate: false` could save about 7 s but shares state between files, so it is not adopted. Fake timers appear in two files; the SyncEngine tests use the real engine and real encryption on purpose. CI time was not measured on GitHub in this phase (the local suite went from 66.9 s to about 52 to 63 s, mostly machine variation).

---

## 12. Clock and time-zone consistency (TS-05)

**Method.** The whole suite was run with the clock moved and the time zone set from outside (a scratch setup file in the scratch folder replaces `Date`; a temporary Vitest config in the repository was deleted afterwards). The clock keeps running from the chosen moment.

| Clock (UTC) | Time zone | What it exercises | Result |
|---|---|---|---|
| 2027-01-08 17:00 | America/New_York | inside the 2027-01-03 to 01-15 window where record ids start with "1799" (TS-01, fixed in ST-S1) | 3,599 passed, 198 files |
| 2026-12-31 23:50 | UTC | ten minutes before new year | 3,599 passed |
| 2028-02-29 12:00 | UTC | leap day | 3,599 passed |
| 2027-03-14 07:30 | America/New_York | US spring-forward day, just after the skipped hour | 3,599 passed |
| 2026-11-01 06:30 | America/New_York | US fall-back day, inside the repeated 01:30 hour | 3,599 passed |
| 2027-03-28 00:30 | Europe/London | UK spring-forward night | 3,599 passed |
| 2026-12-31 10:30 | Pacific/Kiritimati (UTC+14) | already January 1 there | 3,599 passed |
| 2027-01-01 10:30 | Pacific/Pago_Pago (UTC-11) | still December 31 there | 3,599 passed |

(The two tests added after these runs, in the service-worker file, use no clock of their own: they pass the worker a fake `Date.now`.)

**Inspection.** 26 test files use the real clock; two use fake timers. Local-midnight, DST, recurrence, trial and cancellation dates, backup labels and sync timestamps are all inside the suites that just passed at those eight moments and zones, including both DST transition days. No failure, so nothing to repair.

**No shared "frozen today" helper was added.** The brief allows one only where it removes real duplication or real flakiness. There is none to remove: no fragile test exists (eight moments, zero failures, plus the ST-S1 fix for the one that did), and a helper that nobody needs would be a second way to do what `vi.useFakeTimers({ toFake: ['Date'] })` (already used in two files) does in one line. Recommendation for new tests: freeze with that call, or pass the date in, as the new tests do.

---

## 13. Source-guard quality (TS-03)

Audit of the guards that read source text: the Finance transaction-reader guard (`txnDeletionGuards`), the B5 household read-only guard, Bills and Services link guards (`b31-guards`, `b4-guards`, `guards`), the Calendar/Task boundary guards, the ST-S1/ST-S2 guards and the ST-S3 structure tests.

| Finding | Evidence | Action |
|---|---|---|
| Write detection by call name or `d.<table>.add(...)` shape would miss a write through an alias or a new helper name | e.g. `const t = d.table('moduleRecords'); t.put(...)` matches none of the patterns | **New behavioral guard** `src/lib/readOnlyTrap.test.ts`: records every table's create/update/delete hooks, `clear` and any read-write transaction while the readers run on a seeded household. It covers every Calendar due provider, every search source, the Bills snapshot, the Services snapshot, the household overview (twice), and Finance's transaction-reference preview. **Non-vacuity:** the trap is first shown to see `add`, `put`, `update`, `delete`, a bulk add, a `put` through an alias with an innocent name, a read-write transaction and `clear` |
| The reader file list in `txnDeletionGuards.test.ts` is a name list | a sixth module's `txnReferences.ts` would not be scanned | **New self-check:** the test lists `src/modules/*/txnReferences.ts` and requires it to equal the five known readers and the registry's provider count, so adding a reader forces the guard list to be updated |
| B5's `READERS` and the "imported from exactly two places" list | intentional allow-lists | kept and documented here as intentional: they name the files whose purity the golden-master tests also prove |
| Strings versus behavior for the high-risk boundaries | the B5 module's non-mutation is already proved by a test that compares every table before and after (`b5-data.test.ts`), and ST-S2's by `digest()` equality | no change needed |
| Harmless renames tripping guards | none observed; the ST-S3 guard that reads route imports was already adjusted in ST-S3 | none |
| A new structural guard | `lazyBoundary.test.ts` (import graph) pins the new chunk boundary | added |

Not replaced: every existing guard stays. Not done: a full static-analysis (AST) rewrite; the project has no such tool and the brief forbids a new dependency.

---

## 14. Mutation and non-vacuity evidence (TS-06)

**Scripts run (existing, from `scripts/`):** `household-b5-mutation-check.cjs` (25 mutations) and `bills-b4-mutation-check.cjs` (30). Chosen because B5 is the cross-module read-only boundary and B4 holds the cancellation and price rules, and both exercise the code ST-S4 sits next to. **The other four scripts (B1, B2, B3, B3.1) were not run:** ST-S4 changes none of the code they break, and each is a manual tool of 1 to 3 minutes per entry that the S0 audit left out of CI.

| Script | Mutations | Caught by a failing test | Survived | Not applied | Caught only by a parse or type error |
|---|---|---|---|---|---|
| Household finances (B5) | 25 | **25** (each with 1 to 25 failing tests) | 0 | 0 | 0 |
| Bills (B4) | 30 | **30** (1 to 85 failing tests) | 0 | 0 | 0 |

Every "caught" row names at least one failing test; a mutation that only broke parsing would show 0 failed tests and the script reports it differently. Examples that prove behavior, not text: "the load writes to Finance" was caught by the database-comparison test, the guard test and the release test; "a refund is ignored" by 13 tests in 4 files.

**Safety.** The scripts keep the original text in memory and restore after every run; the working tree was understood first (63 changed files, none of the files they break), a SHA-256 manifest of all 797 non-ignored files was taken before each batch, and after each the manifest matched **byte for byte**. No result file or generated file was left in the repository (output went to the scratch folder). No test was changed to make a mutation look caught.

**New mutations for this phase** (a scratch script, not added to `scripts/`): 24 breaks of the new code, run against the new tests and the unchanged `sw.test.ts`.

| Area | Mutations | Result |
|---|---|---|
| Service worker (S1-S9): previous build not kept, deletes any cache, no reuse of unchanged files, hashed file re-checked on the network, old tab's file not found, out-of-folder requests handled, another copy's cache trimmed, incomplete save not marked, **ordering by the clock** | 9 | all 9 caught |
| Build (B1-B2): placeholders no longer enforced, fingerprint ignores contents | 2 | both caught |
| Loader and boundary (L1-L4, M1-M3): failure remembered, loaded screen not used at once, file asked for repeatedly, Chrome's failure wording not matched, every error shown as a loading problem, words shown at once, marker missing | 7 | all caught (L1 first **survived**: it was an equivalent path through Try again, because retry also resets; a test for "a failure heals itself without Try again" was added and now catches it) |
| Import graph and registry (G1-G4): Ledger or Settings imported at start-up, a module dropped, an address dropped | 4 | all caught |
| Write trap control (T1): the trap stops watching deletes | 1 | caught |
| Route announcer waiting (R1) | 1 | **survives by design**: it is a few lines in a component, and the project has no browser-rendering test tool; it was checked in a real browser (section 8) and is the one honest gap |

Equivalent mutants: L1 (above) was the only one, and was turned into a caught mutant with a new test.

---

## 15. Synthetic-scale performance (Part V)

Environment: Node 24.15, fake IndexedDB in memory, one process; the app's own loaders and registered providers run over invented data (6 accounts; transactions spread over 8 years; 40 Finance scheduled rules; 300 monthly bills with a payment link on every second one; 80 weekly or fortnightly arrangements; 4,000 completed visits, 60% with a Finance reference; 600 tasks (a third dated in the next year); 200 assets; 10 projects). "Database requests" are counted at the IndexedDB layer (`get`, `getAll`, cursors, counts). These are relative figures on one machine.

| Operation | 1,000 txns | 10,000 txns | 50,000 txns | Database requests (all sizes) |
|---|---|---|---|---|
| All six due providers, Today window (14 days back, 7 ahead) | 65 ms | 61 ms | 56 ms | 180 |
| Same, one month | 50 ms | 56 ms | 54 ms | 180 |
| Same, twelve months (about 7,700 items) | 70 ms | 80 ms | 77 ms | 180 |
| Bills snapshot (Overview, Today card) | 12 ms | 16 ms | 15 ms | 155 |
| Household finances overview, last 12 months | 233 ms | 276 ms | 422 ms | 934 / 2,235 / 2,498 |
| Ledger cash forecast (Today cash card, alerts) | 16 ms | 37 ms | 217 ms | 18 |
| Search, Ledger source (open, then three queries) | 21 ms | 131 ms | 850 ms | 24 / 32 / 32 |
| Search, Services source (4,000 visits) | 193 ms | 167 ms | 201 ms | 6 |
| Search, every other source | under 35 ms each | under 35 ms | under 35 ms | 0 to 12 |
| Newest 100 transactions of one account | 0 ms | 0 ms | 0 ms | 1 |
| Every transaction, one pass | 4 ms | 29 ms | 142 ms | 1 |
| Backup export (build the text) | 79 ms (2.7 MB) | 80 ms (4.5 MB) | 243 ms (12.6 MB) | 40 |

Findings: **no N+1 pattern** (provider and snapshot requests are constant while transactions grow 50x; the overview's requests follow the number of *referenced* payments, one bulk read, not the table size); **no repeated full-table reads** found in the readers measured; recurrence enumeration is bounded by the requested window (twelve months costs about the same as one month); the heaviest single operation is the Ledger search snapshot at 50,000 transactions (850 ms once per opening of the search box; typing is then a scan of memory, about 8 ms a keystroke per the existing note in `docs/module-hooks.md`). **Nothing was optimized**: no demonstrated bottleneck within ST-S4's scope, and every candidate would touch search or forecast semantics. Browser memory and responsiveness are covered by the 10,000-transaction browser measurement in section 6. Excessive re-rendering was not profiled.

---

## 16. Financial and cross-module regression results

The whole suite passes unchanged apart from the removed timeout arguments: Finance and Budget, Scheduled integrity, B1 to B5, Household Services, Home & Assets, Projects, Calendar, Tasks, Hide Amounts, backup and restore, the ST-S1 conflict-history tests, the ST-S2 transaction-deletion tests and the ST-S3 accessibility and structure tests (3,601 tests). No file under `src/lib` that computes or moves money was edited. The 10,000-transaction household restored through the real restore path showed the same counts before and after.

## 17. Privacy and security boundaries

- Repository stays free of real data: every dataset is invented; the generated backup of the invented household and all measurement output stayed in a scratch folder outside the repository. No `.json`, CSV or backup file was added. The temporary files created inside the repository (an analysis config, a clock-shift config, a scale test) were deleted.
- No secrets were used or printed. No network call to any application server was added.
- The worker's note inside each cache holds only the build id, its install order, a time, the address and a complete flag.
- Shared-origin safety (SE-01 remains **open and owner-led**): the worker no longer reads, modifies or deletes any cache it did not make. This reduces the harm Ledger can do to FBB and Foodventory; it does **not** reduce what scripts on those pages can read of Ledger.
- The Content-Security-Policy meta tag is unchanged and still correct for module scripts from the same address (`script-src 'self'`).

## 18. Browser acceptance evidence

All on disposable origins (`127.0.0.1:5191` to `5197`), fresh Chrome profiles, invented data, real browser (headless Chrome 156), driven through the DevTools protocol with real navigations, real network failures (server stopped, requests blocked) and clicks:

| Journey | Result |
|---|---|
| Deep link to every module cold and warm, desktop and emulated phone | all opened (section 6) |
| Offline with the server stopped | 18 of 18 addresses, in-app switching, a local write, Search, backup export (section 9) |
| Module file blocked | message, Try again recovers, top bar and Add box unaffected (section 8) |
| Slow module (0.9 s per file) | one `main`, polite status, title and focus correct (section 8) |
| Three releases, two old tabs | one release behind works, two behind gets the message and Reload recovers (section 10) |
| 10,000-transaction household restored and measured | section 6 |

**Not done:** a physical phone or tablet; airplane mode; a home-screen installed app; a second browser engine; a screen reader; two physical devices; the real GitHub Pages site (the deployed site is still the ST-S3 build).

## 19. Verification

Final run, after the last source change (the worker's install-order fix):

| Command | Result |
|---|---|
| `npm test` (`vitest run`) | **3,601 passed, 198 files**, 0 failed, 0 skipped, 0 todo (baseline 3,531 / 193). 52 to 82 s locally across four runs (66.9 s at the baseline; machine load varies) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds. Entry file 711 KB (222 KB compressed), Ledger screens 579 KB (155 KB); Vite's 500 KB chunk-size warning remains for those two files. `dist/sw.js` carries the fingerprint and 34 listed files |
| `git diff --check` | no whitespace errors (Git prints line-ending notices for the working copy only) |
| `git status --short` | section 22 |

**Targeted suites** (all part of the full run): the financial golden masters (Household B5, Bills B3 spend, Home & Assets spending, Services household spend), the ST-S1 conflict-history tests, the ST-S2 transaction-deletion tests, the ST-S3 accessibility, contrast and structure tests, Calendar, Tasks, backup and restore, and the service-worker tests (`sw.test.ts`, unchanged, 8 tests, all green against the rewritten worker). **Shifted clocks and zones:** section 12. **Stress:** three whole suites at once, 3 x 3,599 passed (section 11). **Browser:** sections 6, 8, 9, 10, 18. **Mutation:** section 14.

**One intermittent failure found and fixed in this phase.** `swBuilds.test.ts` "keeps this release and the one before it" failed in about 1 run in 8: two installs in the same millisecond tied on the time stamp, so the wrong build was kept. That is a design flaw, not just a test quirk (a device clock that moves backwards would do the same), so the worker now orders builds by install order. The new test runs installs with a clock that goes backwards and with all installs in one millisecond; the test file then passed 12 of 12 repeated runs, and the full suite 3 of 3. The test that exposed it is kept.

## 20. Deviations, judgment calls and owner decisions

**Judgment calls (please review):**

1. **Only screens are split.** Module readers (needed by Today cards, search and Calendar providers) and all CSS stay in the first download. That halves the first page; a deeper split is possible but changes when registered code runs, so it is not done.
2. **React's `lazy` and `Suspense` were replaced** by a small loader (`src/core/lazyModule.ts`). Measured: with them, every first open of a saved module took 0.3 s instead of a few thousandths (React keeps a revealed loading state on screen for about 0.3 s). The replacement has the same error boundary and retry.
3. **Start-up waits at most 400 ms** for the module named in the address to arrive, so a deep link or a reload inside a module does not flash a loading state. On a slow connection the page draws anyway.
4. **The worker's install tolerates a failed save** (kept from the old behavior, which an unchanged test pins) and records that its cache is incomplete; older builds are then kept (up to three caches instead of two). The alternative, failing the install, is cleaner but would change a pinned behavior.
5. **A tab two releases behind a deploy can show "did not load"** for a screen it never opened (it offers Reload Ledger). Before ST-S4 an old tab never failed this way. This is the price of splitting; Chrome's own 10-minute cache may soften it.
6. **The first update on each device downloads the whole app once** (about 2.4 MB, installing all 34 files) and removes the old single cache. Later updates copy unchanged files from the device and download only what changed.
7. **Timeouts:** 137 overrides removed, the 30 s default kept (not lowered). A lower default (for example 15 s) would still have 2.5x headroom in the harsh run; not taken because the brief asks not to lower timeouts for tidiness and a CI machine slower than 3.7x this one is possible.
8. **No shared clock helper** (section 12).
9. **A behavioral guard was added; no existing guard was replaced.**
10. **The 500 KB build warning is left visible** (it is true for the entry file and Ledger's screens); raising Vite's limit would hide it.
11. The pre-existing `src/core/core.test.ts` "queries and tells you when something changes" intermittent (fixed 100 ms wait, noted in the handoff) did not fail in any of the 16 full-suite runs of this phase; it was not touched.

**Deviations from the brief:**
- "Document intentional allow-lists": documented in section 13 (B5 `READERS` and the two-importers list); the older guards themselves were not edited.
- "Distinguish simulated offline from real airplane mode": done (sections 9, 18, 21); **real-device acceptance was not performed**.
- "Run selected tests at ... a DST transition": the whole suite was run at both US DST transition days and the UK one, not only selected tests.

**Owner decisions needed:**
1. **Commit and push?** Pushing publishes the app and installs the new worker on every device that opens it. Recommended only after a quick look at this report; then check the Actions tab for a green run.
2. **Real-phone pass for ST-S5** (section 21): airplane mode with the installed home-screen app, and the first update (the one-time 2.4 MB download).
3. **A visible "update available" notice?** Not built. It would soften item 5 above (the tab could offer to reload when a newer build is waiting). Say if you want it.
4. The still-open items from ST-S3 (BK-03 Calendar choices in backups, which native pop-ups to convert next, O-4 Hide Amounts on Ledger's pages, an "adjust automatically" colour button) and SE-01 hosting isolation, which remains the biggest open risk.

## 21. Recommendations for ST-S5

1. **Do the real-device pass first** (the roadmap's gate): on a real phone, install the home-screen app online, switch on airplane mode, open every module and a deep link, add a task and a transaction, export a backup; then go online and confirm Sync; then deploy a trivial change and watch the first update. This is the one thing this phase could only simulate.
2. **Disaster-recovery drill and the real-device matrix** (S0 audit section 14) with the new build, since the worker is the part most likely to behave differently on iOS Safari (storage eviction, the home-screen app's separate storage).
3. **Re-measure on the phone**: the emulated numbers say bytes halved; a phone's parse and start-up time may matter more. If the entry file (711 KB) is still heavy there, the next boundary is the module readers, with a registry-level test that every Today card and provider still resolves.
4. **Consider the optional update notice** and, if the owner wants, a one-line `--shell` check in CI that fails the build when `dist/sw.js` has an unfilled placeholder (the build already fails; a CI line would make it visible).
5. Keep SE-01 (shared web address) at the top: it is the one finding that code cannot fix.
6. Do not start Family Management until the above, plus the S0 evidence list, is satisfied. Each new module now arrives as one more on-demand file, which is the benefit of this phase.

## 22. Final Git status

Taken at the end of the batch (nothing staged, committed or pushed):

```
branch: main   HEAD = origin/main = 6632576694cd07ea0147eb3a3536ccd12ed21587   (ST-S3, Pages run #77 success)
53 modified tracked files (26 source, configuration and document files plus 27 test files; 390 insertions, 196 deletions) and 12 untracked files (6 new source files, 5 new test files, this report)
```

Modified: `README.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/module-hooks.md`, `public/sw.js`, `vite.config.ts`, `src/App.tsx`, `src/main.tsx`, `src/shell/SkipAndRoute.tsx`, `src/modules/index.ts`, the eight `src/modules/*/index.tsx` registrations (Ledger, Calendar, Tasks, Projects, Assets, Services, Bills, Household), the eight `*Module.tsx` shells (Ledger, Calendar, Tasks, Projects, Assets, Services, Bills, Household; Today unchanged), and 27 test files that lost only a trailing timeout argument (one line each, 137 lines in total).

Untracked (new): `src/core/lazyModule.ts`, `src/shell/ModuleLoader.tsx`, `src/modules/bases.ts`, `src/modules/moduleStyles.ts`, `src/modules/ledger/routePaths.ts`, `src/swBuild.ts`, and the tests `src/core/lazyModule.test.tsx`, `src/modules/lazyBoundary.test.ts`, `src/swBuild.test.ts`, `src/swBuilds.test.ts`, `src/lib/readOnlyTrap.test.ts`, plus `docs/LEDGER-STABILIZATION-ST-S4-REPORT-2026-11-08.md`.

Not changed: `package.json`, `package-lock.json`, any CSS, `src/db.ts`, any backup or sync file, `.github/workflows/deploy.yml`. `dist/` was rebuilt by `npm run build` and is ignored by Git. All temporary files were removed: the analysis and clock-shift configs and the scale test (in the repository), and the disposable browser profiles (in the system temp folder). The measurement tools, the invented 10,000-transaction household backup and all raw results are in the session scratch folder outside the repository.

### Handoff and documents

| Document | Updated? | What changed |
|---|---|---|
| `docs/CHATGPT-HANDOFF.md` | **yes** | header and current snapshot (ST-S3 now committed and deployed `6632576`, run #77; ST-S4 in flight), test baseline, backlog status, new "Delivery and offline" architecture invariants, ST-S4 section, ST-S3 heading corrected, ST-S4 risks, change-log entry. Remains unknown: real-phone behavior |
| `docs/BACKLOG.md` | yes | new top entry for ST-S4 with numbered judgment calls and what is not built; the ST-S3 header corrected |
| `README.md` | yes | one bullet on offline use and the new "did not load" message |
| `docs/module-hooks.md` | yes | new section "Loading a module's screens on demand" (the rules a new module follows) |
| earlier reports, the hosting-isolation plan | untouched | historical evidence |
