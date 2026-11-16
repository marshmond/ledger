# Ledger R1.2: "This Week" (weekly household review) — build report

**Date:** 2026-11-15. **Author:** Claude (local implementation assistant). **Status: BUILT AND TESTED LOCALLY; UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED; awaiting owner and ChatGPT review. NOT REAL-DEVICE TESTED; real-device acceptance is not recorded.** No phase after R1.2 was started.

**Privacy:** every name, date and amount in this report, in the tests and in the screenshots is invented (the documented demo household, `scripts/dev-demo-seed.ts`, run only on its own demo address, port 5231). No real household data, balance, backup, export or credential appears anywhere.

---

## A. Executive summary

There is now a page called **This Week** (subtitle "Your household at a glance") at `#/today/week`. It is a one-page household briefing for the next seven days (today and the six days after it, with the exact range printed at the top, for example "Nov 15 to Nov 21"). It is opened from a small **"This week"** link in the header of Today's existing "Coming up" card; it is not a new Today card and Today's saved layout is untouched. **Back to Today** returns.

What it shows, top to bottom (any section with nothing to say is simply not drawn):

1. **The week in numbers:** up to four tiles (items that need you, events and tasks, payments expected, home and project items). A tile is drawn only when its number is above zero, and each one links to where those items live.
2. **Needs you:** the same five items Today's section shows, in the same order, with the same reasons, plus "See all (N)" to the full R1.1 list.
3. **Schedule:** the next seven days day by day, using Today's own list functions over the Calendar's own data (events, tasks, bills, services, projects and every other due provider).
4. **Payments and cash:** expected payments and commitments for the week (Bills and Household Services, from the B5 reader), what each amount is (fixed, estimate, not known, in dispute), a tally that keeps fixed and estimated apart, contract dates, and Finance's own cash-outlook figure.
5. **Home and projects:** projects over budget, maintenance coming up after this week, and anything from Home & Assets or Projects that the five-line Needs you preview left out.
6. **Family:** birthdays, important dates and activities that name a household member, with their colors and names.

Two buttons help use it away from the screen: **Print** (the browser's own print dialog, with a print stylesheet) and **Copy summary** (plain text for a message or note). Both follow **Hide amounts**, which has the same switch on the page.

It reads, it never writes. Opening the page changes no record (a test compares every table of a real database before and after).

---

## B. Implementation details

### B.1 Where things are

| Piece | File | What it is |
|---|---|---|
| Composition | `src/modules/today/week/weekModel.ts` | Pure. Turns the readers' answers into one `WeekReview`. No React, no database, no clock, and **no import of any module**. |
| Words | `src/modules/today/week/weekText.ts` | Pure. The shared wording (amount words, tally lines, cash line) and the copied text `weekText()`. The page, the printed page and the copied text use these same functions. |
| Data | `src/modules/today/week/useWeekInputs.ts` | One hook that starts each read independently. A read that throws becomes "failed", never "nothing". |
| Page | `src/modules/today/week/WeekPage.tsx`, `week.css` | The screen and its print rules. Loaded on demand. |
| Registry seam | `src/core/weekReaders.ts`, `src/core/registry.ts` | The neutral shapes and one new optional hook, `contributes.weekReview` (like R1.1's `attention`). |
| Module readers (new, small) | `household/weekReview.ts` (payments), `family/weekReview.ts` (family), `assets/weekReview.ts` (maintenance), `projects/overBudget.ts` (over budget) | Each calls the module's existing reader and only cuts and hands over. Each is fetched only when the review opens. |
| Registration | `household`, `family`, `assets`, `projects` `index.tsx` (one `weekReview:` entry each) | Dynamic `import()`, so the readers are not in the first download. |
| Route and link | `TodayModule.tsx`, `cards.tsx`, `today.css`, `NeedsYou.tsx` | `/week` route (lazy), the "This week" link, one spacing rule, and `NeedsRow` (the existing row, now exported so the page reuses it). |
| Docs | `docs/module-hooks.md`, `README.md` | The new hook and the feature. |
| Tests | `src/modules/today/week/week.test.tsx` (32 tests), one assertion in `lazyBoundary.test.ts`, additive edits to six existing registration tests | See E and F. |

### B.2 Data sources (all existing, none rewritten)

| Section | Authoritative reader used | What this phase adds |
|---|---|---|
| Needs you | `useNeedsYou` (R1.1): `rankAttention`, `previewAttention`, `whenWords`, and the existing row component | Nothing. Ranking, identity, de-duplication and wording are R1.1's. |
| Schedule | `useCalendarData` (the Calendar's own hook), `todayList`, `upcomingDays` (Today's own list functions) | Cut to six days ahead; done items left out; two "show it once" rules (B.4). |
| Payments | `loadHouseholdOverview` then its `commitments.windows` (7-day) rows and `actions`; B5's own `addRow` for the tally (all inside `household/weekReview.ts`) | Cut to the seven-day window (C.2). |
| Cash | `loadForecast` and `cashOutlook` (the same function Today's Cash outlook card uses) | A shorter horizon (this week) beside the card's 90 days. |
| Home and projects | `loadOverview(...).upcoming` (Home & Assets, through `assets/weekReview.ts`), the R1.1 ranking (items beyond the preview), `loadProjectSummary` (through `projects/overBudget.ts`) | `overBudget.ts`. |
| Family | `readHouseholdOverview` (F4), the same reader as the Family household page (through `family/weekReview.ts`) | Dates cut to the window; a semantic color id instead of a stored color. |

### B.3 Composition approach

`useWeekInputs` runs the reads side by side. `buildWeekReview` turns each result into a `Section` that is `loading`, `failed`, or `ready` (with data and an `empty` flag). The page draws only ready, non-empty sections. A failed or still-loading source never blocks another section. Failed parts are named in one line near the top ("Some parts could not be read just now (...), so this review is incomplete."), and the copied text says the same.

Reads for Needs you and the Calendar are the same live hooks Today uses, so the page updates by itself when a record changes, and `useToday` moves the window when the date changes.

### B.3a Why the modules arrive through a registry hook (a correction made during this phase)

My first version imported the Household, Family, Assets and Projects readers straight into the Today folder. The repository's boundary tests rejected it, correctly: they pin that **Today never imports Family and Household finances are imported only by the module list and one Services page**. I did not weaken those tests. Instead the review follows R1.1's pattern: each module registers its own small reader through `contributes.weekReview` (`src/core/weekReaders.ts`), and the review asks the registry. A test now pins that the review's own files import no module. The cost is four small adapter files and one hook; the benefit is that Today stays unaware of Family and Household, as before.

### B.4 Avoiding the same thing twice

- **Needs you vs Home and projects:** the Home and projects section lists Home & Assets and Projects items from the full ranking *only if the five-line preview does not already show them*, so an item never appears in both. Anything beyond eight rows says "N more in Needs you".
- **Schedule vs Family:** a Family birthday or important date, and a stored event that Family lists as an activity (matched by the event's own occurrence key), are shown once, in Family, with the member's name and color. If Family could not be read, nothing is removed from the schedule.
- **Schedule vs Payments:** a Bills "Due: <bill>" marker whose bill and date match a row in Payments is shown once, in Payments (matched by the bill's id and the date, never by wording). Other Bills markers (renewal, notice dates) stay in the schedule. If Payments could not be read, the markers stay.
- Tasks that name a family member stay in the schedule only (no second copy in Family).

### B.5 Navigation, print and copy

- **Entry:** a small "This week" link in the "Coming up" card header on Today (screen-reader name "This week: open the weekly household review"). **Return:** "Back to Today" in the page header.
- **Print:** `window.print()`. The print stylesheet hides the controls, the global navigation and the page-only links, makes the layout one column, keeps each card whole across pages, and adds "and N more in the full Needs you list" and a "Prepared <date>" line. The printed page is the same markup as the screen, so Hide amounts applies to it identically.
- **Copy summary:** builds the text with `weekText()` and copies it (`navigator.clipboard`, with a select-and-copy fallback and, if that also fails, a text box to copy from). Both actions run only when pressed. No email, no scheduling, no sharing integration.

### B.6 What was not changed

No schema, migration, backup, sync, setting or storage key; no dependency; no network call; no model. The only edits to existing tests are additive (F, item 13). `package.json` and the lockfile are untouched. Today's arrangement, cards, agenda and the saved layout are untouched (the only change to an existing card is one link). The three protected untracked files were not edited.

---

## C. Financial correctness

### C.1 Three different things, never mixed

| Kind | Where it appears | Wording |
|---|---|---|
| **Commitments and expectations** (what is expected to be paid) | Payments and cash | "Expected payments and commitments for the week. These are not payments made." Each row says Fixed amount, Estimate, Amount not known, or Amount in dispute. |
| **Recorded payments** (what was actually paid) | Not shown on this page | They stay in Household finances and the modules. R1.2 states nothing as paid. |
| **Forecast** (Finance's projection of cash) | Cash outlook | Finance's own `cashOutlook`, reported as "Lowest point ... on <date>. Stays above / Under your <level>". |

The page never says an obligation is overdue, paid, completed, confirmed or funded unless its source already says so (Needs you carries the source's own words and dates).

### C.2 How the commitments agree with the source

- Rows are B5's own rows (`householdCommitments`, 7-day window). B5's "7 days" window runs from today through today plus seven, which is **eight** calendar days; the review is seven. `household/weekReview.ts` therefore keeps only rows dated inside the seven days. The row dated "day 8" is left out (a test pins this).
- A Household Services row that B5 folded into its linked bill's row is **not listed or added again** (`foldedInto`). The folded count is kept in the data.
- The tally uses B5's own `addRow`, and a test confirms it equals the sum of the listed rows, split four ways: fixed (known) cents, estimated cents, a count with no known amount, a count in dispute. **A fixed total and an estimated total are shown as separate lines and are never added into one figure.** "Not known" and "in dispute" are counted and described, never added as zero. A test checks that "$120 fixed + $40 estimate" is never rendered as "$160".
- Linked bills and services that B5 could not prove are the same charge get a plain warning ("a total could count it twice") only when one of the listed rows belongs to such a pair. Services arrangements with a non-per-visit estimate are counted as "expected with no figure for the week".
- Contract dates (renewal, notice, cancellation follow-up) come from B5's `actions`, cut to the week.
- Home & Assets contributes no commitments (B5's existing rule), and this page adds nothing.

### C.3 Cash outlook

`cashOutlook(forecast, today, 6)` for "this week" and `cashOutlook(forecast, today, 90)` for the long figure Today already shows. These are not recalculated or combined with payments. No cash account or no forecast means the block is not drawn, rather than a made-up figure. A test pins both figures against the function.

### C.4 Hide amounts

The page has the existing switch (same storage key as Today; this is an existing preference, not a new one). Hidden amounts are `$••••` on screen, in the printed page (same markup) and in the copied text (which also says "Amounts are hidden."). Titles are also passed through Today's `maskAmounts` (for example a task titled "Pay the $250 deposit"). A test renders the whole page and the text with real amounts, then hidden, and requires zero `$<digit>` sequences when hidden. Checked in the browser as well: zero `$<digit>` and nine `$••••` on the demo page.

### C.5 Over-budget projects

`readOverBudgetProjects` uses `loadProjectSummary`, the same summary the project page and Projects list use, and its own `flags.overBudget`. The amount is `expectedTotalCents - budgetCents`, as the project page words it. Only projects that are still going (planning or active, not archived) with a budget above zero are listed; a project with no budget is not "over budget by everything". No project figure is recalculated.

---

## D. UX evidence

Invented demo household, served on its own demo port; screenshots in `C:\Users\alexm\Documents\Ledger-Design-Concepts\R1.2-Evidence\` (outside the repository, as for R1.1):

| File | What it shows |
|---|---|
| `01-desktop-light-top.jpg` | 1440 px, Signature Navy Light: summary tiles, Needs you and Payments and cash side by side |
| `02-desktop-dark-top.jpg` | 1440 px, Signature Navy Dark, same view |
| `03-desktop-light-schedule-cards.jpg` | 1440 px, Schedule day by day beside Home and projects and Family |
| `04-phone-light-top.jpg` | 375 px Light: header, range, tiles, first Needs you items |
| `05-phone-light-schedule.jpg` | 375 px Light: the schedule with date tiles |
| `06-phone-dark-top.jpg` | 375 px Dark, after Copy summary ("Summary copied") |
| `07-print-simulation.jpg` | The page with the print stylesheet's rules applied (see limits below) |

Findings from the first look, fixed before this report: the phone header overlapped the title (actions now sit under it); the schedule's time column wasted a third of a phone row (time now sits in the line under the title); payment rows lost their padding to a more specific list rule (corrected); family links went through Today's address prefix (`#/today/family/...`; now `#/family/...`, with a test); bills "Due:" markers duplicated the Payments rows (shown once, B.4).

Honest limits: the print preview could not be opened from the built-in browser, so `07` applies the stylesheet's print rules to the live page at A4-like width; it shows hiding of controls and one-column layout, not real page breaks. Real-device, real-printer and screen-reader checks are not done.

---

## E. Verification

**Targeted tests (`week.test.tsx`, 32 tests, all passing):** the seven-day window (boundaries, month, year and leap-day rollovers, range wording); the schedule agrees with `todayList` and `upcomingDays` item for item, drops day eight, overdue leftovers and done items; Family and Payments "shown once" rules and their fallbacks; Needs you reuses `previewAttention` (same ids, order, remainder) and Home never repeats a shown item; payments window, fold, tally, certainty words, overlap rule, contract dates; cash agrees with `cashOutlook`; over-budget rules; empty, partial, loading and failed sources; Hide amounts on screen, print markup and copied text; copied-text content and absence of internal ids; Family links; and **a real-database test** that every reader the page uses leaves every table unchanged, plus a source scan that the review's files contain no database write, network call or storage access. `lazyBoundary.test.ts` gained an assertion that Today's first download contains none of the review's files.

**Existing tests run:** the Today, Household, Family, Assets, Projects, core, leak-scan, shared-stylesheet and lazy-boundary tests after each change, then the whole suite. Its first run failed 8 tests: six real boundary and registration guards (Today must not import Family or Household; five registration lists), one address check (`/needs` written literally), one stylesheet rule (I had used `!important` in the print rules) and one leak-scan rule (a dollar figure in a test). I fixed the cause each time (B.3a; `NEEDS_PATH`; a more specific selector; the `ids-ok` marker) and did not loosen any rule.

**Full suite (final):** **296 files, 5,835 tests, all passing** (baseline at the start: 295 files, 5,802 tests; +1 file, +33 tests: the 32 new ones plus one lazy-boundary assertion).

**TypeScript (`npx tsc --noEmit`):** clean. **Production build (`npm run build`):** clean (the existing "chunks over 500 kB" notice is unchanged). **The review's own code is a separate file,** `WeekPage-*.js`, 21.8 kB raw / 7.0 kB gzipped, fetched only on opening it.

**First-download size** (the entry file plus every file the start page loads; baseline `a39435b` built the same way in a scratch copy): **1,179.5 kB raw / 374.8 kB gzip before, 1,183.4 kB / 379.3 kB after: +3.9 kB raw, +4.5 kB gzip** (the budget in R1.1 was about +10 kB gzip). The build splits some shared code into extra small files because the readers are fetched on demand, so the file count is higher (23 to 33). Not measured: load time on a phone.

**Browser checks (demo household, built-in browser):** page loads with no console errors; 1440 px and 375 px (no horizontal overflow: page width 375 in a 375 window); Signature Navy Light and Dark; the entry link from Today and "Back to Today"; every link on the page has a real destination (one defect found and fixed: family links; re-checked after the registry change: all family links are `#/family/...`, four colored member chips drawn); Hide amounts toggled live (zero dollar figures when on); Copy summary reported "Summary copied" (the built-in browser would not allow reading the clipboard back, so the copied text itself is verified by the tests, not by pasting); print rules inspected as in D.

---

## F. Judgment calls (please review)

1. **Entry point is a link in Coming up's header,** not a new card or a link under Needs you (Needs you is hidden when empty; Coming up always exists). Alternative: also a link on the Needs you card.
2. **Seven days, not eight:** today plus six. B5's "7 days" is eight calendar days, so the page cuts B5's rows (C.2). The Today status band's "Coming up" uses a seven-day look-ahead after today; this page's schedule is therefore one day shorter than that band's range.
3. **Done items are left out of the schedule** (Today shows them with a "Done" chip). A briefing is about what is ahead.
4. **The schedule is read only** (no check box, no "Mark done"), unlike Today's rows. Marking things done stays in Today, Tasks and the modules.
5. **Items shown once:** Family dates and activities, and Bills "Due:" markers, appear in their own section instead of the schedule (B.4). This is a deliberate difference from the Calendar and Today, which list them in the agenda.
6. **Family section:** birthdays, important dates and activities only. Tasks that name a member remain in the schedule; no member filter was added.
7. **Cash:** both a one-week and the Today card's 90-day figure are shown (the week figure is often just today's balance when nothing dips).
8. **Home and projects** lists what Needs you's preview left out, plus over-budget projects and maintenance in days 8 to 30. Maintenance due this week and overdue maintenance are not repeated (schedule and Needs you). Home & Assets exposes only its next six upcoming rows, so "coming up after this week" can be capped at what that overview already returns.
9. **"Last reviewed"** (R0) is replaced by the page showing the current date range; nothing is stored.
10. **Hide amounts** has a switch on the page (same existing preference as Today's).
11. **Copy text** lists only the five Needs you items (like the screen) and says how many more exist.
12. **Today's and the page's amounts** in rows come from B5, so a Services visit estimate shows as "about $X" with "Estimate" (it is not a bill).

13. **Six existing tests were edited, all additively:** four registration-shape tests now list the new `weekReview` key (`family-guards`, `family-f3-guards`, `family-f4-guards`, and `household/b5-guards` plus `household/st-s2`), and two file-list tests name the new Family reader (`family-f3-guards`, `family-f4-guards`). No assertion was weakened, removed or loosened.
14. **A registry hook was added** (`weekReview`) instead of letting Today import modules (B.3a). If you would rather not have a second hook beside `attention`, the alternative is to wire the four readers in `modules/index.ts`.
15. **Family colors:** a member is shown by a name chip with a color dot from the existing shared chip (`ui-mchip`); the color reaches the page as a semantic id, never as a stored value.

**Not built (by design):** R1.3 finish-the-loop; R2 intake; R3 question answering; AI; notifications or delivery; a week picker; customization; Family command station; new calculations; calendar editing; any record change; new tables, schema or storage; the "last reviewed" mark.

**Known limits:** the page reads the whole household on open (the same readers other screens use); no timing measurement was made for this page. Time to open the page on a slow phone was not measured.

---

## G. Release recommendation

**Ready for owner and ChatGPT review.** Nothing was committed, staged, pushed or deployed. If approved, suggested commit message: `feat(today): add weekly household review (This Week)`; after the push, check the Actions tab for a green run. Real-device and real-printer acceptance remain separate.

**Handoff updated:** yes (`docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md`: R1.2 status, snapshot, next action, change log). **Git baseline at the start:** `main` = `origin/main` = `a39435b` (RS-1B); its Actions run #118 was still running when I began and had completed with success before any R1.2 work started.
