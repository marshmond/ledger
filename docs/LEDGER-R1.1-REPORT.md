# Ledger R1.1: "Needs you" (unified attention list) — build report

**Date:** 2026-11-14. **Author:** Claude (local implementation assistant). **Status: APPROVED FOR RELEASE by the owner and ChatGPT after review (2026-11-15), with the decisions in section 22 and a small wording polish; COMMITTED AND PUSHED as `feat(today): add unified Needs you attention list` (its SHA and the GitHub Actions / Pages result are recorded in the handoff change log and in the release report to the owner). NOT real-device tested; real-device acceptance is NOT recorded.** No phase after R1.1 was started.

**Privacy:** every name, date and amount in this report, in the tests and in the screenshots is invented (the documented demo household, `scripts/dev-demo-seed.ts`, run only on its own demo address). No real household data, balance, backup, export or credential appears anywhere.

---

## 1. Summary (plain language)

Today now has a section called **Needs you**. It is one list of the things across Ledger that need the household's attention, most urgent first, with a short plain reason beside each and a link to where to act. On a computer it sits at the top of Today's right-hand column, above the existing "Household status" cards. On a phone it sits just under the status summary and above the long agenda. It shows the five most important items; when there are more it says **See all (N)** with the real count, and that opens a full list at `#/today/needs`. When nothing needs attention the section is simply not there.

It does **not** work anything out itself. Each module already knows what is overdue, broken or worth a look (Ledger alerts, Home & Assets, Household Services, Bills & Subscriptions, Household finances, Projects). R1.1 asks each module for what it already finds and ranks the answers with one small, visible rule. It stores nothing, writes nothing, shows no amounts, and an item disappears the moment the thing it points at is sorted out.

**What the owner will see**
- Order: (1) overdue, broken or serious first; (2) anything with a deadline in the next seven days; (3) everything else that needs a look. Inside each group, by date. The group is shown in words on every row ("30 days overdue", "Due tomorrow", "Needs review"), never by color alone.
- A Ledger alert you dismissed or snoozed on the existing "Needs attention" card is not listed (existing behavior, kept). There are no new dismiss or snooze buttons.
- Nothing about your saved Today arrangement changed (section 9).

**Two honest headline findings**
1. **Performance: the download-size and warm-load budgets are met; the slow-phone effect is small but not settled.** Entry JavaScript grew by 4.8 kB gzipped (budget about 10 kB). A first, coarse measurement of my first version suggested about +130 ms on a warm Today; the cause was a second copy of Ledger's alert calculation (about 25 live queries) running next to the existing card's copy. The shipped version runs **one** shared copy for both and starts the other reads after the agenda has loaded. In the final alternating comparison (11 runs each) warm Today is unchanged within noise, and an emulated slow phone shows roughly +0.1 to +0.15 s, which is on the edge of that noise. Section 15 has the numbers and the caveats; a real-phone look is on the owner's list.
2. **I found and prevented a hidden write.** Ledger's alert code includes the monthly check-in, which silently saves "this month's check-in is finished" when it notices it is. A list that merely reads Ledger's alerts would have inherited that write. The shared copy runs in a read-only form (section 11, judgment call 4).

---

## 2. Baseline and git state (verified, not assumed)

| Check | Result |
|---|---|
| `HEAD` / `origin/main` | both `29c80e1d3d5705262b6169d23634a23172901a29` (`feat(ui): make Ledger Signature the universal appearance`) |
| Deployed | GitHub Actions run **#115** "Deploy to GitHub Pages" for that SHA is `completed` / `success` (public API; `gh` is not installed on this machine). Nothing implemented is unreleased. |
| Working tree before R1.1 | `docs/BACKLOG.md` and `docs/CHATGPT-HANDOFF.md` modified (the R0 entries); untracked: `docs/LEDGER-R0-PRODUCT-ASSESSMENT.md`, `docs/LEDGER-R0-STRATEGIC-ROADMAP.md`, `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts` |
| Protected files | The three protected untracked files and the two R0 planning documents were **not edited, staged or combined** with this work. `scripts/dev-demo-seed.ts` was used unchanged, only on its own demo address. R0 is still uncommitted, so the R0 and R1.1 documents will appear together in the next review diff; they are separate edits and can be committed separately. |
| Test baseline | 289 files, 5,680 tests passing (matches the R0 record) |

Read first: the handoff (headings and the sections that apply), the R0 assessment and roadmap (including the R1.1 brief, Part D), the backlog status entries, `docs/module-hooks.md`, the Today composition and card code, each source module's attention reader, and the registry, lazy-boundary, accessibility and performance tests.

---

## 3. Design

### 3.1 The contract (`src/core/attention.ts`, pure)

```ts
interface AttentionItem {
  id: string;            // "<module>:<stable parts>", never built from wording
  moduleId: string;
  recordId: string | null;   // the record in its own module ("task:12")
  condition: string | null;  // shared name of the underlying condition, only when another module can report the same one
  kind: 'overdue' | 'broken' | 'deadline' | 'review' | 'info';
  severity?: 'serious';      // ONLY when the source module already says so
  sourceSeverity?: string;   // the source's own word ("warn", "disagree")
  date: string | null;       // the source's own date; never invented
  title: string;  reason: string;  href: string;   // no amounts; internal "#/..." links only
  provenance: string;        // which existing reader produced it, in plain words
  count?: number;
}
```

`rankAttention(items, today)` = `dedupeAttention` then a deterministic sort. `tierOf`, `previewAttention` (five and the true remainder), `whenWords`, `containsMoney`, `isInternalHref` and `attentionProblem` are pure and exported. The rule is documented in the file header and pinned by 32 tests.

**Ranking rule (visible, tested):**

| Tier | Words shown | Meaning |
|---|---|---|
| 1 | "Overdue or urgent" | kind `overdue` or `broken`; the source marked it `serious`; or a deadline whose date has passed |
| 2 | "Due within 7 days" | a `deadline` from today through seven days ahead (both ends included) |
| 3 | "Needs review" | everything else unresolved: `review`, a deadline more than a week away, a deadline with no date |
| 4 | "For information" | supported by the function; **no module emits these** (an informational item is left out unless it truly needs action) |

Within a tier: relevant date (earliest first, no date last), then module id, then item id, compared character by character (so the order is identical on every device and in every language). A missing or impossible date (`2026-02-31`, which JavaScript would silently roll into March; a test caught my first version doing exactly that) never raises urgency.

**Identity and duplicates:** an item's `id` is namespaced and stable. The same `id` twice is one item. Two items with the same non-null `condition` are two views of one source condition and are shown once (the more urgent kept, the other module named in "also in"). Everything else stays separate, including two different unresolved actions on one record (a finished visit not logged AND the same task not saved to asset history), and a renewal and a notice deadline on the same day. **Titles and reasons are never compared.** Section 8 states which conditions actually overlap today.

### 3.2 Registry and lazy loading

`ModuleDef.contributes.attention?: AttentionSource` (`src/core/registry.ts`) is optional, like the other hooks, and registered at start-up with the module (not when a module's screens open). `liveAttention(moduleId, read)` (`src/core/liveAttention.ts`) turns a module's plain async reader into the source; a read that throws is reported as "failed" (the list says which module could not be checked) and never as zero. Ledger supplies its own hook-based source (section 4). An optional `Provider` lets a source share state with something else on the Today screen without Today importing the module (used once, by Ledger).

Lazy boundary: every adapter sits beside the module's existing Today card in the first download and imports only loaders that card already imported, so **no module screen, page or Settings enters the first download** (`lazyBoundary.test.ts` passes unchanged and gained two assertions; section 15 gives the byte measurement).

### 3.3 Where the section sits

Not a Today card and not part of the saved arrangement (judgment call 2). It is the first element of the two-column grid (`.td-cols`). On a wide area, CSS puts it at the top of column two and the supporting column starts beneath it (a measured 396 px top for both the agenda and Needs you at 1440 px). On one column it is first, so it follows the status band and precedes the agenda. One element, one set of controls, no duplicate list for responsive placement.

---

## 4. The six sources (what each calls, and what is deliberately not repeated)

| Source | Calls (existing authority) | Items | Judgment |
|---|---|---|---|
| **Home & Assets** | `loadOverview('all').attention` (the same reader as the Overview page and Today card) plus one read of asset names | one per overdue maintenance task (kind `overdue`, with real days), per warranty ending within 60 days (`deadline`), per completed task not saved to history (`review`); counted items for jobs saved twice, records pointing at a missing asset, linked payments to look at again | agrees with `attention` counts exactly (tested) |
| **Household Services** | `buildOverview(snapshot)`, `contractDeadlines` (what `attentionCounts` counts) | finished visit not logged, schedule check, possible duplicate visits, unsupported-status visit, renewal and notice dates in 30 days (separate items) | agrees with `attentionCounts` exactly (tested) |
| **Bills & Subscriptions** | `attention(derive(snapshot))` (the Bills read model's own items) | one per source item; dated conditions are `deadline` with the source's date; the rest `review`; a billing record that **disagrees** is `serious` because the source already calls it `disagree` | item count equals the Bills card total (tested) |
| **Household finances** | `loadHouseholdOverview` / `todayCounts` | possible duplicate payments, bill-and-service overlaps (not folded), expected payments with no known amount | equals the card's counts (tested). **Not repeated:** lifecycle items (the Bills source already raises them, so listing them again would show one condition twice), evidence items (Bills, Services and Assets each raise their own), informational notes |
| **Projects** | `projectAttention` (the Projects card's own list) | one per project; overdue milestones or tasks or a past target is `overdue`; a target within 14 days is `deadline` | count equals the card's (tested). Individual tasks stay in the agenda |
| **Ledger alerts** | `useLedgerAlerts` and `computeAlerts` (unchanged), minus alerts dismissed or snoozed | a "warn" alert is `serious` (tier 1, even with no date); an "info" alert is `review`; alert wording that carried an amount is replaced by amount-free words | see below |

**Ledger and the "smallest safe extraction" question.** The alert logic is a React hook (about 25 live queries plus tax-plan and check-in calculations). Extracting it into a plain function would have meant copying two more hooks and the income model, which is a larger and riskier change than the brief allows. I therefore changed no alert rule and moved no code. The source uses the hook as it is. Two small additions to existing hooks (option flags that default to today's behavior; section 11): `useCheckin({ remember })` and `useLedgerAlerts(today, { readOnly })`.

**Left out as informational:** the RSU "vest coming" alert and "losses could be harvested" (nothing to do, nothing wrong). **Tasks and the Calendar are not sources:** their overdue items are already Today's own agenda.

---

## 5. Files changed (actual)

New (12 source files, 3 test files and this report): `src/core/attention.ts`, `src/core/liveAttention.ts`, `src/core/AttentionProviders.tsx`, `src/modules/today/NeedsYou.tsx`, `src/modules/today/useNeedsYou.ts`, `src/modules/ledger/alertsShare.tsx`, and the six adapters `src/modules/{assets,bills,household,ledger,projects,services}/attention.ts`; tests `src/core/attention.test.ts`, `src/modules/today/needsYou.test.ts`, `src/modules/today/needsYouUi.test.tsx`; this report.

Modified (existing code, all small): `src/core/registry.ts` (the optional `attention` contribution and `allAttentionSources`); the six module `index.tsx` files (one line each: `attention: ...`); `src/modules/today/TodayModule.tsx` (route to the full list, the slot, the provider wrapper, one note in the edit panel); `src/modules/today/today.css` (one appended block); `src/modules/ledger/todayCards.tsx` (the "Needs attention" card now reads the shared alerts when a provider exists, otherwise exactly as before); `src/pages/useCheckin.ts` and `src/pages/useLedgerAlerts.ts` (the opt-out flags); `README.md` and `docs/module-hooks.md` (documentation); `docs/BACKLOG.md` and `docs/CHATGPT-HANDOFF.md` (status).

Existing tests edited (four, all additive): three registration-shape tests that pinned the exact list of `contributes` keys now include `attention` (`bills/hooks.test.ts`, `household/b5-guards.test.ts`, `household/st-s2.test.ts`), and `lazyBoundary.test.ts` gained two assertions. **No assertion was weakened, removed or loosened.**

Not touched: `package.json` and the lockfile (no dependency), the database schema and migrations, sync, backup, the Signature design system and tokens, every calculation file, `scripts/dev-demo-seed.ts`, and the R0 documents.

---

## 6. What is NOT stored, synced or changed

No new table, no schema change, no migration, no sync tracking, no backup change, no setting, no storage key, no network call, no timer apart from one short idle-time fallback (section 13), no dependency, no model. `rg` of the new files finds no `.put(`, `.add(`, `.update(`, `.delete(`, `.transaction(`, `fetch(` or `localStorage` (a guard test enforces this on every new source file).

---

## 7. Today experience, accessibility and layout

- **Compact list:** up to five rows, each one link (one Tab stop, one target). A row has the title, a chip with the urgency in words and an icon ("30 days overdue", "Urgent", "Due tomorrow", "Needs review"), the source module, a one-sentence reason, and goes to the record. "See all (N)" appears only when there are more than five and shows the true count.
- **Full list (`#/today/needs`):** the same order, grouped under the four ranking words (only groups that have items), each row also saying "From: <the reader it came from>". No filters or sort options (judgment call 10). Reachable by deep link; "Back to Today" at the top.
- **Empty:** the section is absent (no empty box); on the full list a short empty state. A module that could not be read is named in one quiet line; it is never shown as "nothing".
- **Semantics:** one `section` named by its heading, a count badge with a spoken label, the "See all" link with a spoken label ("See all 16 items that need you"), rows in a list. The full page has one `h1` and `h2` groups, no skipped levels. The existing route announcer sets the page title ("Needs you · Ledger") and moves focus to the page when the link that was used disappears (observed).
- **Targets:** every row is at least 52 px tall at 320 and 375 px; "See all" is 44 px. **Contrast:** 70 checks (5 palettes x Light/Dark x 7 text elements), lowest **5.15:1**, none under 4.5:1.
- **Keyboard:** Tab reaches "See all", then each row, with the app's 2 px focus ring; Enter follows the link (Tab, Shift+Tab and Enter checked with real key presses in Chromium).
- **Placement checked at 320, 375, 768, 1024, 1280 and 1440 px:** one column up to 768 px with Needs you first (after the status band); two columns from 1024 px with Needs you at the same top as the agenda in column two and Household status below it; no horizontal overflow at any width, on Today or on the full list.
- **Reading order (judgment call 11):** Needs you comes first in reading and Tab order on every width, so on a wide screen it is the first thing Tab and a screen reader reach even though it is drawn at the top of the right column.

## 8. Duplicate handling: what actually overlaps today

The identity rules are in section 3.1 and pinned by tests (same `id`, same `condition`, never wording). **In the six real sources no two modules report the same condition today**, so the cross-module merge has no live case; it is a tested safeguard for the next source (tests use synthetic items). What the tests do prove with real records:

- A completed task that is both "not saved to asset history" (Home & Assets) and "finished visit not logged" (Household Services) stays **two** items with different conditions.
- A renewal and a notice deadline on the same day are two items.
- The same task linked to three assets is one item (the overview's own rule).
- Similar or identical titles are never merged.

**Overlap with Today's own agenda (judgment call 3, owner decision):** an overdue maintenance task appears as a Task row under Today's "Overdue" and as an asset row in Needs you. They are two views of one unresolved task on the same screen. I kept both because the brief names "a maintenance task is overdue" as a reason and because the agenda row is an action while the Needs-you row is a summary; the alternatives are in section 18.

## 9. Today layout preferences: exactly what changed (nothing about the arrangement)

- Needs you is **not** a registered Today card and is **not** part of `today.layout.v2`. `allTodayCards()` is unchanged (11 cards, same ids), `DEFAULT_SIDE_ORDER`, the status group and the storage key are unchanged, and no code path of the new files touches browser storage (guard test).
- **Tested in a real browser:** a saved arrangement (side order Household status, Cash outlook, Needs attention; Projects card hidden) plus a saved earlier layout were loaded; the section appeared, the saved order and hidden card were honored exactly, and all three storage values were **byte-identical** after the page loaded. Test keys were removed afterwards.
- The one change to the Edit layout panel: an added sentence saying Needs you is not part of the arrangement.
- Consequence (judgment call 2): in this release the owner cannot hide or move Needs you.

## 10. Privacy and financial correctness

- No amount anywhere: `containsMoney` rejects any title or reason with a currency symbol or a figure with two decimals; the adapters are tested on a household full of amounts; Ledger alerts that carry amounts (a tax estimate, a cash low point, an account balance, a loss figure, "count as $0") are shown with amount-free wording only. Hide amounts is a second guard (any dollar amount that reached a row is masked) and was tested on and off.
- Titles are the household's own record names (task, asset, bill, project, arrangement) exactly as the household typed them, plus counts. **Those stored titles are user-entered text and are not guaranteed to be free of provider names, personal details or figures** (a bill titled "Pool service with Pat, $85" would show as typed; the amount check only stops amounts in wording the adapters write or read from a module's own messages, and in Ledger alerts). The adapters themselves never read or add a provider name, phone, email, note, link, serial number, plate, address or document number, and the Hide amounts mask is a second guard for dollar amounts.
- Read only, by any route: a database write-trap (create, update, delete, clear, any read-write transaction) saw nothing while every source ran, and a positive control proves the trap works; a row-by-row digest of every table is identical before and after.
- No financial calculation, tax table, schema, sync, backup, dependency, network or model change. The 157 financial golden-master tests and the full suite pass unchanged.

## 11. Judgment calls and deviations (please review)

1. **Registry contribution is a hook, `useItems`, not a plain function.** Ledger's alert logic is a React hook; a plain-function contract would have forced copying it. Every other module builds its source from a plain async reader with `liveAttention`. Cost: the sources are called in a loop over a registry that is fixed at start-up (documented; the order never changes).
2. **Needs you is a fixed section, not a Today card.** Zero effect on saved arrangements and the exact approved position, but it cannot be hidden or moved. Alternative: a registered card (then every saved arrangement appends it at the end of the side column, because that is how the existing code adds new cards).
3. **Overdue maintenance tasks are task-level rows** (see section 8).
4. **The check-in write.** `useCheckin` saves "this month's check-in is complete" on its own. The alert hook runs it, so a reader of Ledger alerts would write. I added `useCheckin({ remember: false })` and `useLedgerAlerts(today, { readOnly: true })`, both defaulting to the old behavior, and Today's single shared copy uses the read-only form. **Consequence:** Today no longer records a finished check-in month as a side effect; Ledger Home and the Check-in page still do. A month completed only by data changing while Today is open would not be recorded until one of those pages is opened.
5. **Severity only where a source already states it:** Ledger "warn" = serious (so "No backup yet", "Over budget" and also the lower-urgency "account has no owner" are tier 1); a Bills record that "disagrees" = serious. Nothing else is promoted. Revisit if "warn" feels too loud.
6. **Left out as informational:** RSU vest alert, loss-harvest alert; Household lifecycle, evidence and informational review items (raised by their own modules or not at all).
7. **Item titles use the household's own record names**, unlike the counts-only status cards. They are user-entered text: the adapters never add provider names or amounts, but a title the household typed could itself contain either (see section 10). The counts-only status cards remain the more private view.
8. **The shared Ledger copy and the deferral.** One copy of the alert hook for the whole Today screen (via a registry `Provider`, so Today never imports Ledger), and the other five sources start only after the agenda has its data and the browser is idle (at most 300 ms). The "Needs attention" card's own behavior is unchanged; it reads the shared alerts when a provider exists, and its old self-contained path remains.
9. **Wait for every source before drawing**, so the list never jumps as modules answer; a source that fails is named, not ignored. Cost: the section appears when the slowest source answers.
10. **No filters, snooze or settings** on the full list (the brief asked for none).
11. **Reading order** as in section 7.
12. **Four existing test files were edited, all additive** (three that pinned the exact `contributes` key list, plus `lazyBoundary.test.ts` assertions). Please look at that diff.
13. **Dismiss and snooze:** honored, not added. The existing "Needs attention" card keeps its buttons, so a Ledger alert is visible in two places on Today until dismissed there.
14. **Chip words for a dated item more than a week away:** "Due in N days", not "Needs review" (found in the browser).
15. **Bills' wording is the source's own** (for example "Due in 1 day." beside the chip "Due tomorrow"), lightly capitalized and ended with a full stop; I did not rewrite it.

## 12. Bugs found and fixed while building

| Found by | Problem | Fix |
|---|---|---|
| A unit test | An impossible date like `2026-02-31` was accepted and rolled into March, making an undated deadline look overdue | Dates must survive a round trip |
| The existing date guard | I used `toISOString().slice(0, 10)` | Rewritten with UTC parts; the guard is untouched |
| A real-browser reseed with the page open | "Maximum update depth exceeded" (3 errors) when the Ledger alert hook ran at the top of the Today screen | The data reading moved into its own small component (controlled A/B: 0 errors without the section, 3 with the hook at the root, 0 after the move), then the single shared copy (also 0 errors on a fresh reseed) |
| Reading `useCheckin` | The hidden write (judgment call 4) | The opt-out flags |
| Looking at the first screenshots | Rows too tall (580 px for five); a "From:" line leaking internal codes ("notConfirmed"); the hover underline covering a whole row | Two-line rows; plain-language labels; the underline only on the title |
| Reading the warranty row | "Needs review" on a dated item 40 days away | "Due in 40 days" |

## 13. Performance mechanism

- **Deferral:** the five async sources start after the agenda has its data and the browser is idle (`requestIdleCallback`, 300 ms limit; a 50 ms timer where it does not exist). This is the one timer in the new code and the guard test names it.
- **One shared copy of Ledger's alert hook** for the Today screen, offered through `contributes.attention.Provider` and wrapped around the columns by `AttentionProviders`. The wrapped content is the same element on every render, so only the two readers re-render when an alert changes.
- **Concurrent reads:** each source runs its own live query, so the five async reads run together (6.7 ms for all five on the demo household, section 15).


## 14. Verification: tests

**Full run: 292 files, 5,754 tests, all passing** (baseline 289 files, 5,680 tests: +3 files, +74 tests). `npx tsc --noEmit` clean. `npm run build` clean (type check plus production build).

| Requirement in the brief | Where it is proved |
|---|---|
| 1. Each adapter agrees with its authoritative reader | `needsYou.test.ts`: Home & Assets items = `attention` counts; Services = `attentionCounts` (unlogged, schedule checks, duplicates, review visits, renewals, notices); Bills = `attention(derive())` total; Household finances = `todayCounts`; Projects = `projectAttention`. Each test first asserts the seeded count is greater than zero, so none can pass on nothing. Ledger: `needsYouUi.test.tsx` (every alert maps; two left out on purpose) |
| 2. Stable identity, deterministic order | `attention.test.ts`: 24 shuffles and a reversal give one order; ties by module then id; antisymmetric comparator; input not changed; ids unique across modules |
| 3. Classification and urgency | `attention.test.ts`: every tier edge (today, +7, +8, a month and year boundary, serious without a date, informational) |
| 4. Missing and incomplete data | missing, unreadable and impossible dates; a deadline with no date; empty list; an empty household gives nothing in every source |
| 5. Duplicates without hiding distinct actions | same id, same condition (either arrival order), two actions on one record, renewal and notice on one day, look-alike titles, items with no condition |
| 6. Empty state | section is `''` when empty or before every source answered; the full list shows an empty state; browser check on an empty database |
| 7. Exactly five, accurate remainder | 7 gives 5 and "See all (7)"; exactly 5 gives no link; the count after de-duplication is the count shown |
| 8. Valid destination links | `isInternalHref`, `attentionProblem`; **and in the browser all 16 links of the demo household opened a real page** |
| 9. No monetary amounts | `containsMoney` unit tests; every adapter's items scanned; Ledger alerts that really carry amounts (checked first) come out clean; Hide amounts on and off |
| 10. No database writes | a behavioural write-trap (with a positive control), a table-by-table digest, and a source scan for write calls |
| 11. Layout preferences preserved | card list, side order and storage key unchanged; a saved arrangement loads exactly; the new files never touch storage; a render writes no layout key; and the real-browser byte-identical check |
| 12. Lazy loading and bundle size | `lazyBoundary.test.ts` (unchanged tests pass; two assertions added: the sources are in the first download, and none of the new files imports a screen, page or Settings) and the measured build sizes (section 15) |
| 13. Financial golden masters and module tests | the full suite, including the 157 golden-master tests, unchanged |

Also: the date-guard test, the registration-shape tests (key list now includes `attention`), and the module-hooks documentation contract are covered above.

## 15. Performance: before and after

**Method.** Production builds of the baseline commit (`29c80e1`, extracted to a scratch folder) and of this work, built with the same command. Timing in headless Chrome driven over the DevTools protocol by a scratch script (kept in the evidence folder, not in the repository), with the same invented household loaded into both. The two builds were measured **alternately in the same session, 11 runs each**, using timestamps recorded inside the page. "Warm": no throttling, files already cached. "Cold phone": 375 x 812, processor 4x slower, 1.6 Mbps and 150 ms network, nothing cached (the same recipe as the ST-S5 report). "Usable" = the agenda content is on screen; "settled" = nothing on Today still says "Loading".

**Bundle (production build, `npm run build`):**

| | Baseline | R1.1 | Change |
|---|---|---|---|
| Entry JavaScript, raw | 887.16 kB | 905.97 kB | +18.8 kB |
| Entry JavaScript, gzipped (Vite's figure) | 276.60 kB | 281.43 kB | **+4.8 kB** (level-9 gzip: +5.1 kB) |
| Stylesheet, raw / gzipped | 213.1 kB / 37.0 kB | 214.3 kB / 37.2 kB | +1.2 kB / +0.2 kB |
| Every other chunk (Ledger, Bills, Services, Assets, Calendar, Family, Contacts, Settings, ...) | | | **unchanged in size** |
| JavaScript and CSS files in the app | 49 | 49 | none added |

**Budget (about +10 kB compressed entry JavaScript): met, at about half of it.**

**Timing, medians of 11 interleaved runs (milliseconds):**

| | Baseline | R1.1 | Paired difference (median) |
|---|---|---|---|
| **Warm computer: agenda usable** | 351 (range 233 to 621) | 366 (257 to 800) | **-10** |
| Warm: settled | 435 (278 to 694) | 441 (300 to 919) | **-19** |
| Warm: first Needs-you row on screen | none | 469 (319 to 972) | +10 after the baseline had finished |
| Warm: busy (long-task) time | 186 | 201 | -41 |
| **Cold phone: agenda usable** | 2,231 (2,131 to 2,951) | 2,390 (1,413 to 2,530) | **+146** |
| Cold phone: settled | 2,577 (2,486 to 3,509) | 2,731 (1,645 to 2,970) | +122 |
| Cold phone: first Needs-you row | none | 2,933 (1,746 to 3,162) | +288 after the baseline had finished |
| Cold phone: busy time / longest single stretch | 1,470 / 489 | 1,713 / 551 | +106 / +62 |

**Reading it honestly.**
- **Warm budget (+100 ms): met.** The median paired difference is slightly negative; run-to-run differences span -230 to +449 ms on this machine, so the true effect is indistinguishable from zero here, not proven negative.
- **Slow cold phone: probably a small cost, roughly +0.1 to +0.15 s to usable and the list itself arriving about 0.3 s after the baseline's last content.** This is on the edge of the noise (paired differences span -776 to +350 ms) and there was no numeric budget for it. I did not hide it: it is the part most worth checking on a real phone.
- **Loader execution (cross-module reads):** with the real demo household in Chrome, Home & Assets 1.9 ms, Bills 2.5 ms, Household finances 4.9 ms, Projects 0.7 ms, Household Services 0.8 ms; all five run together in **6.7 ms**. Ledger's alerts are the existing hook, now one shared copy (as before this phase, there is one on Today).
- **What the first version cost, and why it changed.** The first version ran a second copy of Ledger's alert hook. A first, coarser measurement (polling from outside the page) put the warm agenda about 130 ms later than the baseline, and removing only the Ledger source brought it to within 10 ms. My later in-page measurements were too noisy to confirm the 130 ms exactly, but the busy-time totals pointed the same way, and sharing one copy is strictly less work, so I shipped the shared copy plus the deferral. I cannot give a precise saving.
- **Not measured:** a large household (ST-S5 used one; the demo household here has 203 records), a real phone, a real network, Safari or Firefox. A four-build interleaved run was discarded as too noisy to read (four browsers at once); its log is kept in the evidence folder and not used.

## 16. Browser verification (what was actually done)

On the documented invented demo household (served on its own demo address; sync off; nothing connected to any real data), in the Claude app's built-in browser (Chromium), plus headless Chrome for timing:

- Desktop 1440 px and phone 375 px, **Signature Navy Light and Dark** and the **Evergreen** palette (screenshots below); widths 320, 375, 768, 1024, 1280 and 1440 checked by script for placement and overflow.
- Keyboard: Tab, Shift+Tab, Enter on the rows; focus ring seen; navigation to the asset page confirmed.
- All 16 destination links opened real pages; the full list at 320 and 375 px has no horizontal overflow and no clipped text.
- Dismiss on the existing Ledger card removed the item from Needs you live (16 to 15 in the badge; later restored with "Bring back").
- A saved Today arrangement is honored and untouched (section 9).
- Empty household: no section, no console errors.
- Console: no errors in any of these runs after the fixes in section 12.

**Not done, and not claimed:** a real phone, a second device, a screen reader (VoiceOver, TalkBack, NVDA), Safari, Firefox, forced-colors mode, reduced-motion, a very large household, printing.

**Evidence (outside the repository, invented data only):** `C:\Users\alexm\Documents\Ledger-Design-Concepts\R1.1-Evidence\`

| File | Shows |
|---|---|
| `01-today-desktop-1440-light-signature-navy.jpg` | Today, 1440 px, Light, default palette |
| `02-today-desktop-1440-dark-signature-navy.jpg` | the same in Dark |
| `03-today-desktop-1440-light-evergreen.jpg` | an alternative palette (Evergreen) |
| `04-today-phone-375-light-signature-navy.jpg` | phone, Light |
| `05-today-phone-375-dark-signature-navy.jpg` | phone, Dark |
| `06-today-phone-375-light-evergreen.jpg` | phone, Evergreen |
| `07-full-list-desktop-1440-light.jpg`, `08-full-list-phone-375-dark.jpg` | the full list |
| `09-keyboard-focus-row-desktop.png` | a focused row |
| `measurements\` | the timing log, the discarded noisy log, the timing script, the bundle comparison |

(Screenshots 01 to 06 were taken before two small later changes that only affect the full list's "From:" wording and the hover underline, and before the single shared Ledger copy, which does not change what is drawn. The two full-list pictures are after those changes.)

## 17. Known limitations

1. **No real-device, screen-reader, Safari, Firefox or forced-colors check.** Nothing is accepted.
2. **A Ledger item can briefly be computed from defaults** while the alert hook's queries first load (an existing property of the "Needs attention" card, which this list inherits). It was not seen in my runs, but I cannot rule out a one-frame flicker.
3. **Today's overdue Task and its Needs-you row can both show** (judgment call 3).
4. **The Today card sets and the Services page differ by design:** Needs you follows what each module's Today card counts (the Services page also lists provider and finance-reference items; those are not here).
5. **Some module wording is long** (for example the Bills "date passed" sentence); rows wrap, nothing is cut.
6. **The first Needs-you paint waits for the slowest source** and for the agenda.
7. **Bills' redundant words** ("Due in 1 day." beside "Due tomorrow").
8. **A Ledger alert shows twice on Today** (in Needs you and on the "Needs attention" card) until dismissed.
9. **Timing evidence is noisy and from one machine** (section 15); the cold-phone effect is not settled.
10. **Household finances' "missing evidence" items are not listed** because the owning modules raise their own (so a mismatch between the household review page and Needs you is expected, not a bug).

## 18. Outstanding owner decisions (one round, recommended first)

1. **Should Needs you stay a fixed section (recommended), or become a movable, hideable Today card?** The card route appends it at the end of any saved arrangement, so people who ever opened Edit layout would see it last.
2. **Overdue maintenance tasks: keep one row per task (recommended; specific and actionable), one row per asset, or hide a row when the agenda already lists the task?**
3. **Is "Ledger warn = urgent" right?** It makes "account has no owner" as loud as "No backup yet". Option: demote selected warn alerts to "needs review" in the Ledger adapter only.
4. **Accept that Today stops saving "check-in finished" as a side effect (recommended)?** The alternative is a write-on-view, which the brief forbids.
5. **Should renewals more than a week away appear at all?** They are listed (as "Due in N days", lowest group) because their modules count them.
6. **Keep a Ledger alert in both places on Today, or hide the Ledger alerts from the status cards later?** (Not in this phase.)
7. **Tab order:** Needs you first (current) or after the agenda?
8. **A real-phone look at Today** (the cold-phone cost and the first screen) before release, and when.

## 19. NOT built (scope held)

R1.2 Weekly Review, R1.3 Finish-the-loop, RS-1 integrity fixes, notifications or push, any AI, any new dismiss or snooze behavior, any new household data storage, any change to the Signature design system or to another module's business rules, filters or settings for the list, a Tasks or Calendar source, Family, Contacts, Calendar or Tasks sources, Search or Quick Add changes.

## 20. Release readiness (as written before review; superseded by section 22)

**Recommendation: ready for owner and ChatGPT review; not yet ready to release.** The build is complete, tested (5,754 tests, type check and production build clean), verified in a real browser at desktop and phone widths in three palettes, within the download-size budget, within the warm-load budget, and read-only by tests and by a behavioural trap. What stands between this and a release is not code: (a) the owner's answers to decisions 1 to 4 in section 18 (defaults are in place and each is a small, local change); (b) a look at Today on the owner's real phone, because the one measurement that leans negative is a slow cold phone; and (c) the usual owner acceptance, which I have not recorded and cannot. **Do not commit or push until you say so.**

## 21. Handoff, backlog and records

`docs/CHATGPT-HANDOFF.md` (current snapshot, phase line, section 6 entry, risks, change log) and `docs/BACKLOG.md` (a new top status entry) were updated in this same batch; they distinguish **built but uncommitted** from committed, deployed and accepted, and preserve the R0 entries (R0 is still uncommitted and unapproved). `README.md` and `docs/module-hooks.md` gained the new hook. A project memory note was added. Nothing was committed, pushed or deployed.

## 22. Review outcome, polish and release (2026-11-15)

**Accepted decisions (from the owner and ChatGPT review; they answer section 18):**
1. Needs you stays a **fixed** section, above the supporting Today cards on desktop and before the long agenda on a phone. It is **not** to become a movable or hideable card.
2. **One actionable row per overdue maintenance task** (it may also show as the agenda's Task row).
3. **Keep the existing Ledger warning severity** for now (every "warn" alert is tier 1).
4. **Accept the read-only check-in behavior on Today**; Ledger Home and the Check-in page keep their existing persistence.
5. **Keep future renewal deadlines** in the list.
6. **Preserve the existing Overdue card and Ledger "Needs attention" card**, even where their content overlaps.
7. **Needs you stays first in keyboard and reading order.**
Still open: a real-phone look at Today (decision 8 in section 18).

**Polish made (wording only; no ranking, reader, persistence, navigation, identity or de-duplication change):**
- The full list's intro now reads "What needs a look across Ledger, most urgent first. Items drop off once they are sorted out."
- The "From: <module>: <reader>" line, which repeated the module already shown on the row, is replaced by the part not already said ("Bills not confirmed paid", "Overdue maintenance", "Same alert as on Ledger Home"). The attention item still carries its full `provenance` (module and reader) in the contract; a test pins that.
- The privacy description (section 10, judgment call 7) now states that stored bill, task and other titles are user-entered text and may contain provider names, figures or other personal details; the implementation does not guarantee otherwise.

**Re-verified after the polish:** the Today tests (201), then the full suite, `tsc` and `npm run build` (results in the release report to the owner and the handoff). In the browser at 320 px: no horizontal overflow, no clipped text, 16 rows, the new wording shown, a row link opened its page, and Today still shows the section with "See all (16)". The read-only trap, the write guard and the financial golden masters are unchanged and pass.

**Release:** the approved R0 planning documents were committed separately first (only the two R0 documents and the R0 hunks of the backlog and handoff; the protected and unrelated files were not staged); then this R1.1 work was committed as `feat(today): add unified Needs you attention list` and pushed to `main`. Real-device acceptance items still open: Today on a real phone (first screen, the slow-phone cost, thumb reach), a screen-reader pass of Today and `#/today/needs`, Safari and Firefox, forced colors, a large household, and the usual owner acceptance walk-through.
