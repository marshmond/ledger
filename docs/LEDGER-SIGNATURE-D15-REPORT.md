# Ledger Signature D15: Household Services, Bills & Subscriptions and Family detail redesign

**Status: BUILT AND TESTED LOCALLY. NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. Not tested on a real phone or with a screen reader. D16 not started.**

**Final Bills refinement (section 28) supersedes these earlier statements in this report: the Bills phone overview order and page heights (sections 9, 22), the "needs-review page was not recomposed" remarks (sections 2, 22, 23, 24, 25), the Bills phone page-height figures (section 22), and the test totals (section 19: now see section 28.11).**

Date: 2026-11-12. Everything below marked "seen" was seen in headless Chrome on throwaway copies of the fictional D1 demo household (own address `localhost:5231`, sync off). Anything only read in source is called that.

## 1. Verified D14 release (the gate)

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (origin `https://github.com/marshmond/ledger.git`) |
| Branch and sync | `main`; after `git fetch`, `HEAD` = `origin/main` = `6fd14a3a2cedc58d16a100ccfa22be73a22641e0` |
| Actual D14 release commit | **`6fd14a3`** "feat(ui): redesign Projects Assets and Contacts". The prompt's `11bb7e4` is the D13.1 commit and was not enough |
| CI for that exact commit | "Deploy to GitHub Pages", **run #101, completed, success** (2026-11-12 21:57:34 UTC) |
| Pages deployment of that commit | Deployment `7750753620`, sha `6fd14a3`, environment `github-pages`, **latest status `success`** (21:57:34 UTC); the earlier D13.1 deployment is `inactive` |
| D14 report and mobile release checks | `docs/LEDGER-SIGNATURE-D14-REPORT.md` section 26 records the focused mobile checks (62 scripted checks at 375 and 320, two defects found and fixed before release) |
| Working tree at the start | Only the three protected untracked files: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts` |

How it was checked: `gh` is not installed here, so the Actions run and the deployment status were read from the public GitHub API without a login (read only). Nothing was created, no branch, remote or permission was requested.

## 2. Source and route inventory

| Route | Component | What it is |
|---|---|---|
| `/services` | `services/OverviewPage.tsx` (+ `OverviewParts.tsx`, `VisitList.tsx`) | Overview: attention, status and provider filters, upcoming window, arrangements, agreements, recent activity, providers, recorded spending, estimates, insights |
| `/services/a/:id` | `services/ArrangementPage.tsx` | One arrangement: schedule and next-visit actions, health notices, money, related bill, assets, contract dates, project links, cost estimate, notes, finished-not-logged, booking reminders, visit history |
| `/services/providers/:contactId` | `services/ProviderPage.tsx` | One provider: contact, arrangements, upcoming and past visits, assets, projects, documents, money |
| `/services/v/:id` | `services/VisitPage.tsx` | One saved visit |
| `/bills` | `bills/OverviewPage.tsx` | Counts, attention, cash windows, 12-month known and estimated costs, coming up, review list, discovery |
| `/bills/list` | `bills/ListPage.tsx` | All bills with status, type and provider filters |
| `/bills/upcoming` | `bills/UpcomingPage.tsx` | Cash windows, past-date group, weeks, contract dates |
| `/bills/review` | `bills/ReviewPage.tsx` | Needs-review lists (recomposed in the final refinement, section 28) |
| `/bills/o/:id` | `bills/ObligationPage.tsx` | One bill: terms, next dates, billing periods, payment history, scheduled link, lifecycle, contract, review list, documents, notes |
| `/family/m/:id` | `family/MemberPage.tsx` (+ `MemberSections.tsx`) | One member |
| `/family/dates` | `family/DatesPage.tsx` | Birthdays and important dates |

Not changed (kept as approved): Family overview (D12), the D9 member form and color picker, all dialogs and forms (D20), Quick Add, Today, Calendar, Household Finances.

## 3. Baseline workflow inventory (recorded before any edit)

Recorded from the source and from the running pages: fields, filters, actions and links of each route above (the lists in section 2 are the record); the Services upcoming window (7, 14, 30, 90 days, default 30, saved on the device as `services-upcoming-days`, changes only the overview list); status filter radios (Active, Paused, Ended, All) and the provider select; Bills status radios, type and provider selects; Family role, status, "This is me", the eight stored colors and "No color", birthdays, important dates, Contact links. Hide Amounts applies through each module's own `money` function. Baseline pictures (78) and a values file are in `D15-Evidence\baseline\`; the authoritative values were read from the app's own functions (see section 11).

## 4. Exact files changed

Application (17 source and style files modified and 3 new, none of them an engine, schema, sync, Quick Add, Search, navigation, theme storage or service worker file):

- Household Services: `services/OverviewPage.tsx`, `OverviewParts.tsx`, `ArrangementPage.tsx`, `ProviderPage.tsx`, `VisitPage.tsx`, `VisitList.tsx`, `services.css`; new `services/presentation.ts`.
- Bills: `bills/OverviewPage.tsx`, `ListPage.tsx`, `UpcomingPage.tsx`, `ObligationPage.tsx`, `BillsParts.tsx` (chips only), `PeriodParts.tsx` (label chip only), `bills.css`; new `bills/presentation.ts`, `bills/DueList.tsx`.
- Family: `family/MemberPage.tsx`, `MemberSections.tsx`, `DatesPage.tsx`, `family.css`.
- Tests: three new files (`services/d15Services.test.tsx` 17 tests, `bills/d15Bills.test.tsx` 23, `family/d15Family.test.tsx` 19) and **two existing tests edited**: `family/family-f3-a11y.test.tsx` (the expected heading "To do" became "Related tasks", see judgment call 7) and `shell/uiCoverage.test.ts` (the tracker guard lists which rows are beyond NS; the D15 rows were added, as every phase does). No business-rule test was touched.
- Docs: this report, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.

## 5. Household Services overview redesign

Before: a full-width stack of eight equal cards (attention, filters, upcoming, agreements, arrangements, recent, spending, things to know, providers). After: a quiet or accented attention band, the filters, then two columns. Left: **Upcoming services** as visits grouped under date tiles (a visit that is a Task says "Next visit (a task)" with an "Open task" link; a derived date says "Expected from schedule"; overdue and moved-from are separate chips) and **arrangements as cards** (date tile of the next visit, name, provider, cadence in words, the estimate only when one was entered, status chip, next-visit words). Right: agreements to review with date tiles, recent activity, providers. Recorded spending and insights stay below in full width, structurally unchanged. The 7/14/30/90-day select is the same native control (restyled), the filters are the same radios restyled as a segmented control, and the page still opens with the saved window.

## 6. Household Services detail redesign

A hero card (date tile of the next visit with "Next visit" or "Overdue", name, status chip, cadence in words, provider link, the estimate) with the lifecycle actions, then two columns. Left: Schedule (with the health notice and the Done, Skip, Cancel actions), **Coming up after that** (new: the expected dates after the next visit, from `plannedVisitDates`, the same function the Calendar layer uses, labelled "Expected from schedule", with the 12-month count), finished-not-logged, visit history, booking reminders. Right: cost estimate, money, related bill, assets, contract dates (as date tiles), project links, notes. The provider page gets a hero and two columns; the visit page a hero with the visit date. Visit history rows show a date and an outcome chip (completed, skipped, cancelled, needs review).

## 7. Recurrence and Calendar-projection preservation

No scheduling code was edited. The new "Coming up after that" list calls `plannedVisitDates` and `scheduleStateOf` and is tested to equal the Calendar layer's own dates (same list, same 12-month total, every date after the one open Task). Seen in the browser on a copy of the household: a biweekly service created through the form got exactly one open Task and 26 dates exactly 14 days apart for the next 12 months; a twice-monthly service (the 15th and the last business day) got one open Task and a different, non-14-day pattern; the two are not interchangeable and the cadence words differ ("Every 2 weeks on Fri" versus "Twice monthly: the 15th and the last business day of the month"). The overview window (7, 14, 30, 90) changes only the overview list; the Calendar projection is unchanged (before and after values below).

## 8. One-actionable-Task verification

Unit test: every recurring arrangement has exactly one open visit Task however many dates are shown. Browser: after creating the two services the stored Task count rose by exactly two (one each) and the stored row count by exactly four (two arrangements, two Tasks); browsing the six overview and detail pages afterwards changed no stored row (rows before and after the 46-page pass were identical: 78 module rows, 5 links, 18 Tasks).

## 9. Bills & Subscriptions overview redesign

Before: eight equal cards in one column. After: a counts band, an accented attention list, then two columns. Left: **Coming up** as expected dates grouped under date tiles, each row keeping its due-date source line, its amount in words and its payment label chip with the line that says what Ledger knows; the review list and the notes. Right: **Expected cash needed** as three windows (7, 30, 90 days), each with **Known** and **Estimated** as two separate figures (the estimate drawn with a dashed edge, a wave icon and the word "Estimated"), and the count of bills with no known amount in words; **Expected recurring costs, next 12 months** as the same two figures. The discovery card moved below. List: rows with a date tile and amount in words; Upcoming: a card of week groups beside contract dates.

## 10. Bills & Subscriptions detail redesign

A hero (date tile of the next expected date, name, status, type and importance chips, the lifecycle flag, provider, actions), a **key terms band** (expected amount as a Known, Estimated or Not known figure, how often, payment arrangement), then two columns: next expected dates, billing periods, payment history and the Finance scheduled link on the left; the remaining terms, subscription life, related Household Services, contract dates, reminders, review list, documents, notes and lifecycle history on the right. Every card and action the page had is still there (a source test lists them). The five situations are drawn differently and always with words: paid or payment recorded (done), upcoming or scheduled for automatic payment, due soon and not confirmed paid (warning), "Overdue (billed, no payment recorded)" (the only label that uses the overdue tone), skipped or nothing due.

## 11. Financial and certainty-state preservation

Authoritative values were read from the app's own functions (`loadServicesOverview`, `derive`, `upcoming`, `cashTiming`, `attention`, `buildOverview`, `loadMembers`, `upcomingRows`) before the first edit and again after the final one, on the same data, and **the whole structure is identical** (`Verification\baseline-authoritative-values.json` against `after-authoritative-values.json`): the 12 expected-date lists and counts for 6 arrangements, next dates, open-Task counts, 16 upcoming rows, attention lines, estimates (30 days 580.00, 90 days 1,440.00, 12 months 5,610.00 of estimates), spending, the 8 bills with their amounts and schedules, 4 past-date and 17 upcoming expected dates with their labels and amounts, the three cash windows, counts, the 12-month known and estimated figures, 5 members with roles and colors, 8 upcoming family dates, and the stored row counts. Every money amount and button text printed on the 46 baseline pages is still printed after (0 lost). Unit tests pin: a fixed amount is Known, an amount that varies is an Estimate, no amount is Not known; no figure is ever shown as $0.00 for an unknown amount; known and estimated are never added; "None expected" replaces "$0.00" only where the count is zero; Hide Amounts leaves no digit in the cash figures, the date rows or the arrangement cards; reading and drawing write nothing. **Display wording that changed:** a cash window with no bills now says "None expected" instead of "$0.00 · 0 bills" (judgment call 6).

## 12. Family detail redesign

Member page: a hero with the D9 `MemberMark` (extra large), name, role, status and "This is you" as three separate chips, the next birthday as a date tile, and the edit actions; then two columns. Left: Schedule (rows now carry a date tile), **Related tasks** (renamed from "To do"; rows with a date tile; a sentence says that being named is not responsibility), Projects. Right: Profile (role, status, "This is me" with Clear or "This is me", birthday, Calendar switch, birth year, display color chip), Important dates (date tiles), Important contacts, Linked contact (unchanged text), Private note (masked until Show). Dates page: "Coming up" grouped by month and year, each row a date tile, the type as a chip, "Not on my Calendar" as a warning chip, and the same Open profile, Edit, Calendar on or off and Archive actions.

## 13. Family dates and identity preservation

Roles, the stored color values (the eight in `COLORS`), "This is me" (stored separately from role; a test proves a child can be "me" and stays a child), the D9 picker (the edit form still opens with the stored color selected) and the form are untouched. Birthdays and dates are shown from the stored month and day: the tile uses plain date arithmetic with no time zone; tests pin 14 March 2027 as a Sunday tile and 29 February never moving month. Creating a date in the browser listed it on its next 31 December and created no Calendar event (the 8 existing events stayed 8); the Family layer derives it.

## 14. Contact safeguards

No Contact code was touched. The member page has no merge, relink or create-Contact control (source test). Tests and the browser check: two Contacts with the same name stay two; a member points at the one that was chosen; adding a member with a "new" Contact of an existing name makes a separate Contact; neither Contact became a member by name.

## 15. Desktop evidence

`D15-Evidence\Household-Services`, `Bills-Subscriptions` and `Family`: for each, overview and detail before and after (Signature light, 1440), Signature dark, Classic, the add or edit form (add arrangement with the twice-a-month pattern chosen, add bill with an amount that varies, edit member showing the D9 picker), and extra states (paused, ended, twice-monthly, long name, provider, visit, list, upcoming, unknown amount, linked service, ended bill, member with no color, spouse, child).

## 16. Mobile evidence

Full-page 375 px pictures before and after for each overview and detail, dark versions, normal **375 x 812 viewport** pictures (navigation bar and floating Add visible), interactive states (All filter with the 90-day window, the bills list filtered, the add-date dialog) and three 320 x 640 viewports (arrangement, bill, member).

## 17. Before and after comparisons

`Comparisons\D15-HOUSEHOLD-SERVICES-DESIGN-REVIEW.png`, `D15-BILLS-SUBSCRIPTIONS-DESIGN-REVIEW.png`, `D15-FAMILY-DESIGN-REVIEW.png` (desktop, overview and detail, cropped to equal height) with `-DESKTOP` copies and `-PHONE` sets (four 375 px pictures each) because one combined picture would make the labels too small. **No page-specific approved D15 prototype exists, so every comparison is labelled Before versus After and none is presented as an approved prototype.**

## 18. Theme and accessibility verification

- **Sweep (scripted, headless Chrome):** 19 views x 5 widths (1440, 1024, 800, 375, 320) x 4 looks (Signature light and dark, Classic light, Slate light) = **380 cells: no horizontal overflow, exactly one h1, no skipped heading level, every interactive control has an accessible name, no clipped text.** Long names (a 110-character service, a very long bill) wrapped.
- **Keyboard:** a 70-stop Tab walk of seven pages with real key events: every stop in the page showed a focus ring except the native date field of "Remind me to book" (same exception as D13); the Add arrangement dialog opens with Enter, keeps focus inside, closes with Escape and returns focus to its button; arrow keys move the status filter. Synthetic events, not a physical keyboard.
- **Touch targets at phone widths:** the main links of each row and the selects were raised to 44 px. What remains under 44 px: inline links inside sentences (for example "See the next 90 days"), the Finance transaction link inside a linked payment row (a shared component) and a project link inside the Insights text.
- **Colors:** every status carries words and an icon shape; tones come from the existing tokens (no hex, no new color). Contrast was not re-measured by tool for the new compositions; the tones are the D6 chip and tile tones that were measured.
- **Not claimed:** screen-reader behavior, forced colors, real devices, Safari, Firefox.

## 19. Automated test results

`npx tsc --noEmit` clean. `npm run build` succeeds. Full suite, run once at the end on the finished code: **272 test files, 5,101 tests, 0 failures** (D14 ended at 269 files and 5,042 tests; +3 files and +59 tests, all new). Two earlier full runs each found one failure that was mine to fix: the leak guard wanted an `ids-ok` note on two of my assertions that look for formatted money text, and the tracker guard needed the D15 rows added to its allowed list. Both fixed; the last run below is clean. Targeted runs of `src/modules/services`, `bills`, `family` and `src/shell` (104 files, 2,311 tests) passed before the new tests were added, which also shows the existing guards (source scans for writes, imports, the single `formatCents` home) still hold.

## 20. Browser workflow results

A script of 49 checks drove real clicks and form input on a copy of the household; **49 of 49 passed on the final code** (`Verification\browser-workflows.json`). Services: the four filters, the 7, 30 and 90-day window (list sizes 6, narrower, wider; saved as "7"), the provider filter, opening an arrangement, its provider page and a visit, creating a biweekly and a twice-monthly service, one open Task each, the Calendar dates, editing. Bills: counts, filters (Ended 1, All 8, type), the variable and unknown-amount bills, Upcoming, Needs review, creating a known (42.50), an estimated (60.00) and an unknown-amount bill, existing bills unchanged, no Finance transaction added, editing, the Finance link. Family: the member page, the stored color, the edit form's selected color, role and "This is me" kept after an edit, a member with no color, two same-name Contacts, the dates page, creating and editing a date, no Calendar event created, date-only. Cross-module: Services to Tasks and Calendar, the linked bill, Household Finances, Today. Browsing the six overviews wrote no row; no console errors.

## 21. Cross-module regression checks

Services to Tasks (the open-task link), Services to Calendar (the cleaning visits still show), Services provider to Contacts-backed provider page, bill to its linked service (existing text; it is not a link, as before), bill to Finance, Bills to Household Finances (opens), Family to Today and Calendar (dates derived, none created), Quick Add (source untouched; destinations unchanged), Today (providers and counts untouched; same functions). Services to Assets: the asset links are unchanged and render the same cards, but the demo household had no asset linked to an arrangement, so that navigation was **not exercised in the browser**.

## 22. Honest design assessments

**Household Services: clearly better, less so on a phone.** *Composition:* the overview went from a stack of eight equal cards to a date-led left column and a supporting right column; arrangements are scannable cards with a date tile instead of text rows. *Hierarchy:* the next visit is the visual anchor on every arrangement and on the detail hero; what needs attention is first. *Recurrence:* the new "Coming up after that" list makes the cadence tangible without exposing the rule; the biweekly and twice-monthly examples read differently at a glance. *Density:* the desktop overview is 7 percent shorter (3,012 to 2,807 px) and the arrangement page 5 percent shorter. *Mobile:* readable and overflow-free, but the overview is 18 percent longer (4,883 to 5,757 px) and the arrangement page 21 percent longer (the new dates card, 44 px links); the spending and insights block is unchanged and dense. *Structurally close to the old UI?* The lower half of the overview (spending, estimates, insights) and the money card on the arrangement page keep their old structure on purpose.

**Bills & Subscriptions: a real improvement on the overview and list, a modest one on the bill page.** The overview gained a clear lead (what is coming up, with the cash figures beside it, known and estimated separated), and the list became date-led. The bill page gained a hero and key-terms band and a sensible split of "what is expected" from "what surrounds it". Weaknesses: the Billing periods, Payment history and Scheduled cards (which hold the payment logic and were deliberately left alone) are still long and button-heavy and make the page 4,134 px tall on a desktop, as before; on a phone the overview is 31 percent longer (4,669 to 6,114 px) and Upcoming 26 percent longer (5,730 to 7,216 px; 13 percent longer on a desktop), and the list 13 to 18 percent longer, because every date group has a tile, the row links are 44 px and each period's evidence line is printed in full. The needs-review page was not recomposed.

**Family detail: the biggest per-page gain.** The member page went from a nine-card single column to a hero (identity, role, status, next birthday) and two purposeful columns; on a desktop it is 34 percent shorter (1,991 to 1,312 px). The dates page went from a flat list to a month-grouped, tile-led list. Weaknesses: a member with little data gets a mostly empty left column, and on a phone the page is 5 percent longer (2,629 to 2,758 px) and the dates page about 30 percent longer on both desktop and phone (month headings, a tile and a type chip on every row; the before page was only 900 px on a desktop); the birthday tile sits on its own row under the name on a phone.

**Across all three:** this is a recomposition, not a recolor. What still resembles the old interface: the dialogs and forms (D20), the money and payment cards, and the spending and insights text.

## 23. Remaining design deviations

No page-specific prototype exists, so there is no deviation from an approved D15 design. Open points: phone pages are longer (see section 22); the Services overview right column is shorter than the left on a wide screen; the arrangement list sits below Upcoming (some may prefer arrangements first); the visit page stays one column; the not-found screens of Services and Bills have no h1 (as before; Family's has one).

## 24. Outstanding issues and owner decisions

Judgment calls (please review):

1. **Needs attention is a full-width band above the filters** (Services) and above the columns (Bills), not a card in the stack. It leads on a phone, and when nothing needs attention it shrinks to one line.
2. **Upcoming comes before the arrangement list** on Services. Option: arrangements first.
3. **"Coming up after that" is new content** on the arrangement page (derived dates, read only). It makes the page longer on a phone. Option: collapse it.
4. **The discovery card moved below the columns** on the Bills overview.
5. **The bill's "Terms" card was split:** amount, how often and payment arrangement moved to the key-terms band; the card is now "More about the terms".
6. **Cash windows:** known and estimated are separate figures; a window with nothing expected says "None expected" instead of "$0.00 · 0 bills" (the only wording change in a financial figure; no value changed).
7. **"To do" became "Related tasks"** on the member page, with a sentence that being named is not responsibility (same wording as the D12 overview). One existing heading-order test was updated for it.
8. **The hero replaces `PageHeader`** on the member page, arrangement, bill, provider and visit pages, so the page has its own h1 (still exactly one per page).
9. **Page widths** of the three modules went from 1,100 and 900 px to 1,500 px so two columns fit (as D14 did for Assets).
10. **The date link on the next-visit row** was replaced by "Open task" next to the status chips; the arrangement name opens the arrangement.
11. **Color is not repeated in the member hero** as a chip: the extra-large mark carries it and the profile still prints the color's name.
12. **Review page (B-04)** was not redesigned (kept as is, out of the listed scope).

Not built, by instruction: new scheduling rules, reconciliation, overlap detection, payment processing, Family permissions or accounts, Contact merging, task assignment, new colors, a CRM, a responsibility matrix, a tablet view, dialog replacement, new financial metrics, automatic Task creation.

## 25. Coverage tracker updates

`docs/UI-COVERAGE.md`: V-01 to V-04, B-01, B-02, B-03, B-05, F-02, F-03 read `BLT` with the marks actually recorded (`Kbd` only for the six pages a Tab walk covered); B-04 stays `NS`; W-33, W-34, W-35 read `BLT`; dialog rows stay `NS`; section 1.12 records what was seen; the residue note after D15 is added. Nothing is `ACC`. F-01 (D12) and unrelated rows are untouched.

## 26. Real-device and screen-reader limitations

No real phone, no physical keyboard, no screen reader (NVDA, VoiceOver, TalkBack), no forced-colors mode, no Safari or Firefox. The keyboard walk used synthetic key events in headless Chrome. The owner's phone and screen-reader pass is still to do.

## 27. Exact Git status

On `main` at `6fd14a3` (= `origin/main`), nothing staged, nothing committed. The closing message quotes the final `git status`.

Handoff: `docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md` were updated in this batch (planned, built, uncommitted, not deployed, not acceptance-tested).

## 28. Final Bills design-fidelity refinement (2026-11-12, after the first ChatGPT visual review)

**Asked:** (1) the Bills phone overview put a long Coming up list before the cash summary; (2) the Needs review page (B-04) kept its legacy layout. Household Services, Family and the approved Bills desktop were not reopened. Still not staged, committed, pushed or deployed.

**Baseline re-verified:** repository `marshmond/ledger`, branch `main`, `HEAD` = `origin/main` = `6fd14a3` (D14; run #101 and the Pages deployment succeeded, as in section 1), D15 uncommitted and unstaged, the three protected files untouched.

### 28.1 Bills phone overview: hierarchy
At 640 px and narrower the overview is now: heading and actions, counts band, Needs attention, **Expected cash needed**, a three-date **Coming up** preview, Expected recurring costs, review list, notes, discovery. Above 640 px nothing changed (the desktop order and pictures are the same: headings, buttons, links, amounts and page height are identical to the D15 first pass; see 28.6). It is one component choosing ONE tree with `useMediaQuery` (the same hook D13.1 Today uses), not CSS `order`: each section is built once and drawn once, the read model is asked once (`upcoming(x)` is called once; a test pins it), no figure is fetched or drawn twice, and Tab order equals reading order (checked with real key events on the Needs review page; the overview keeps ordinary document order).

### 28.2 Upcoming preview behavior
The phone preview draws the first **three populated due dates**, each complete (`previewByDate` in `bills/presentation.ts`; a date is never cut part-way, so the first date may hold any number of bills). It is fed the full 45-day list the overview already derives (the desktop list keeps its own 12-row cap). Fewer than three dates shows them all; none shows the existing "No expected dates" sentence. Each row is the same `DueList` row as before (name, date tile, due-date source line, amount in words, payment label and the line saying what Ledger knows, link to the bill). Below it: "Showing the next 3 dates (4 of 10 expected in the next 45 days)." when dates are hidden, and a **View all upcoming (17)** button to the existing Upcoming page. The count is `ahead.length`, the exact number of expected dates that page lists in its week groups (the page also lists the past-date group above them). Nothing is counted or summed in the component. There is no expanding list.

### 28.3 The dedicated Upcoming page
No row was hidden. A browser check counts the rows on the page at 375 and 320 px and finds exactly `ahead` plus past-date rows (21 on the demo data, from the engine). Density review: secondary lines (due-date source, how it is paid, the evidence sentence) are one step smaller on phones, padding is tighter, the date tile stays beside its bills (no extra row per date), and the week groups share one card with week headings. Every line is still printed. Page height at 375 px: original 5,730 px, D15 first pass 7,216 px, refined 5,918 px (3 percent above the original; the date tiles and 44 px links remain). Contract dates, cash windows and the past-date group are unchanged. Documented, not hidden: the long "from the schedule; no due date recorded" line is correctness information (it says where the date came from) and is kept on every row.

### 28.4 Needs review (B-04) redesigned
Route and file confirmed: `/bills/review`, `src/modules/bills/ReviewPage.tsx`. It now has a **summary card** (the count, and one jump button per existing group with its own count; a jump button scrolls to the group and focuses its heading) and **one card per existing group** (same titles, same hints, same order, same eligibility) with a tone edge and an "N items" chip. Each item is a row: a **date tile** (the item's own date, or its period's date; red tone only when the period is open and past), the existing sentence, the **amount in words** from the period's own `amountLine` (Expected, Billed, Estimate or "Amount not known"; Hide amounts masks it), and the same buttons as before with the same conditions (Open the bill, Mark paid…, Keep it on…, Leave as is, Update reminders). Conflict items still render the existing `ConflictCard`. "Left as is" is unchanged. The empty state is unchanged. No condition, status, certainty rule, matching, dismissal or write was added or changed; `REVIEW_TONE` only chooses an edge color and an icon, and the group title and count always carry the meaning. The page total uses `reviewTotal`, the same subtraction the Overview button prints (written once so they cannot drift). Nothing says or implies that reviewing marks anything paid. On a phone each row stacks (tile beside the text, buttons full width at 44 px), the summary buttons are a full-width list.

### 28.5 Financial values preserved
The structure read from the app's own functions (arrangements, expected dates, Bills obligations, amounts, cash windows, counts, attention lines, members, dates and the stored row counts) is **identical to the baseline taken before D15** after this refinement (compared again on the final capture, and the browser run re-reads the Bills part and the row counts after the pages are used: equal). Known stays Known, Estimated stays Estimated, Not known stays Not known; no amount is shown as zero; no figure is added into a new total; Hide amounts leaves no dollar digit on the overview or on Needs review (browser check on the whole page text). The new components receive existing values only (a source test forbids `formatCents`, `toFixed`, `new Date`, `addDays` and any write in `ReviewPage.tsx`).

### 28.6 Heights (375 px full page; desktop where stated)
| Page | Original | D15 first pass | Refined |
|---|---|---|---|
| Bills overview, phone | 4,669 | 6,114 | **4,401** |
| Bills Upcoming, phone | 5,730 | 7,216 | **5,918** |
| Needs review, phone | 1,076 | 1,098 | 1,498 |
| Needs review, desktop | 900 (one screen) | 900 | 1,037 |
| Bills overview, desktop | 2,778 | 2,784 | 2,784 (unchanged) |
| Bills Upcoming, desktop | 3,401 | 3,828 | 3,828 (unchanged) |
The Needs review page is taller because it now has a summary and date tiles; it is a short page (four items on the demo data).

### 28.7 New automated tests
`bills/d15BillsRefinement.test.tsx`, **18 tests**: three populated dates (complete groups, a first date holding four bills, five dates collapsing to three), fewer than three, empty, two bills sharing a date; the preview is a prefix of the engine's own `ahead` list and every other entry is on the Upcoming page; the label count equals `ahead.length`; known, estimated and not known keep their words and no row shows $0.00; one `upcoming(x)` call and the phone order (counts, attention, cash, preview, costs) with a single placement per section; every attention category has a Needs review group and a tone and nothing is dropped; `reviewTotal` equals the number of items the page can list and the Overview subtraction; empty and reduced data; amount lines for past-date items (including "Amount not known", masked with Hide amounts); the Not confirmed paid wording; the same buttons, conditions and links; no write and no new calculation in the page; reading writes no row; phone rules. `GROUP` in `ReviewPage.tsx` is now exported so the test can read the page inventory (no behavior change).

### 28.8 Browser verification (fictional household, sync off)
`refine-results.json`: **46 of 46** checks passed. Phone overview at 375 and 320: counts and Needs attention first; cash before the preview before recurring costs (by position); Known and Estimated separate with the Estimated tag; exactly three date groups; all four obligations on those dates shown (the engine's own list: 8 dates, 4 bills on the first three); the button reads View all upcoming (17); it opens the Upcoming page with all 21 rows (17 expected plus 4 past-date); Back returns to the preview; the list filter still works; the last card clears the floating Add; no overflow or clipped text. Desktop 1440: the Coming up list still shows 10 rows (not limited to three dates) beside the cash figures and the old "See the next 90 days" text. Needs review at 1440, 375 and 320: one h1, the engine's count (4) and the two existing groups, a date tile, an amount and an Open the bill link on every item, Mark paid… on the three not-confirmed items only, no overflow; Mark paid… opens its own dialog and Escape saves nothing (stored rows unchanged); a jump button focuses its group heading; Open the bill opens that bill; a 40-stop Tab walk showed a focus ring at every stop; Signature dark and Classic render both groups; Hide amounts left no dollar digit on the overview or the review page. `reduced-results.json`: **6 of 6** (a household with no bills: both pages show their empty states; one bill: the preview shows both of its dates in the window and the button reads View all upcoming (3); Needs review shows "Nothing needs review").
Sweep: 380 combinations (19 views, 5 widths, 4 looks): no horizontal overflow, one h1, no skipped heading, every control named, no clipped text. Keyboard walk (real key events, seven pages): services-overview 69, services-arrangement 68, bills-overview 68, bills-list 66, bills-detail 69, family-member 65, family-dates 67 stops; every stop in the page showed a focus ring except the native date field in "Remind me to book"; the dialog and arrow-key checks still pass.

### 28.9 Desktop regression
At 1440 px the Bills overview, list, Upcoming and bill pages have the same headings, buttons, links, money text and heights as the D15 first pass (compared item by item on the final capture); the redesigned Needs review page is the only desktop page that changed.

### 28.10 Screenshots (`Documents\Ledger-Design-Concepts\D15-Evidence`)
`D15-BILLS-MOBILE-FINAL-REVIEW.png` (full page: original, first pass, refined; normal 375 x 812 viewports; dark and 320) with `D15-BILLS-MOBILE-FINAL-REVIEW-VIEWPORTS.png` (larger viewport copies); `D15-BILLS-MOBILE-UPCOMING-REVIEW.png`; `D15-BILLS-NEEDS-REVIEW-DESKTOP.png`; `D15-BILLS-NEEDS-REVIEW-MOBILE.png`; `D15-BILLS-DESKTOP-REGRESSION.png`. Sources: `Bills-Refinement\`. Every image is Before versus After; no page-specific approved Bills prototype exists and none is claimed.

### 28.11 Tests and build
`npx tsc --noEmit` clean; `npm run build` succeeds; relevant suites (all of `src/modules/bills`, 36 files, 882 tests incl. the B5 golden-master and guards, `src/modules/household`, the UI-coverage, theme and contrast guards) pass; full suite run once after the refinement stabilized: **273 test files, 5119 tests, 0 failures** (was 272 and 5,101).

### 28.12 Remaining design compromises
Bills Upcoming and the Bills overview are tall on a phone because each expected date keeps its full evidence line; the preview is the remedy on the overview, and the dedicated page stays complete by design. Needs review has no per-item certainty chip: it prints the existing amount sentence instead (adding a chip would repeat the sentence). The Bills bill page's billing-period cards remain long (unchanged). Needs review was checked on demo data with two groups only; the other fourteen group types (conflicts, linked payments, lifecycle records and so on) use the same row layout and were not each reproduced in the browser (their code and buttons are unchanged and source-tested).

### 28.13 Real-device and screen-reader checks still outstanding
No real phone, physical keyboard, screen reader, forced-colors mode, Safari or Firefox. The keyboard walks used synthetic key events in headless Chrome.

### 28.14 Exact Git status
Quoted in the closing message. Still on `main` at `6fd14a3`, nothing staged. The handoff, backlog and tracker were updated in this pass.
