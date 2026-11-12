# Ledger UI coverage tracker (Ledger Signature rollout)

Created in **D5** (2026-11-10, uncommitted until the owner approves). Source of the inventory: the D4 blueprint (`D4-APPLICATION-COVERAGE.md`, 2026-11-10, counted at commit `8ab1789`), re-checked against the source in D5. This file holds route names, file names and ticks only. No data, no balances, no screenshots.

The goal is **every page, surface, view and dialog in Ledger**, including every Ledger financial sub-page, looking and behaving as one application. Nothing is "done" until it is accepted in both themes at phone and desktop width and its functions are unchanged.

## How to read it

**Status** (one value per row): `NS` not started, `INH` inherited look verified, `BLT` built (uncommitted), `CMT` committed, `DEP` deployed (Actions green), `ACC` accepted.

**Acceptance columns**, filled with `Y` when recorded and `.` when not:
`L` light, `D` dark, `375` phone width, `1440` desktop width, `Kbd` keyboard and focus, `Func` functional acceptance (existing tests plus the flow check passed, nothing about behaviour changed).
A row reaches `ACC` only when **L, D, 375, 1440, Kbd and Func are all `Y`**. The visual checklist V1 to V12 and functional checklist F1 to F6 are in the D4 roadmap (section 6).

**D5 left everything at `NS` / `.`. D6 (committed and deployed `17e509d`, Pages run #92) restyled the shared component layer, so a few GLOBAL SURFACES read `BLT` with the marks that were actually recorded (section 1.1 says what each mark rests on). D7 (committed and deployed `13acc04`, Pages run #93) restyled the global header and module switcher: S-01 to S-04 read `BLT` and S-12 has two marks (section 1.2). D8 (committed and deployed `8e08fd9`, Pages run #94) replaced Ledger's desktop sidebar by a bar under the header: S-13, S-14 and S-17 read `BLT` (section 1.3); S-15 and S-16 are untouched and stay `NS`. D9 (2026-11-11, committed and deployed `939f985`, Pages run #95 success) added the Family member color picker and the shared member identity pieces (mark, dot, chip): S-21 now includes the pieces and section 1.4 records what was built and seen. No routed page, dialog or workflow row changes status: the Family rows F-01, F-02, DL-09 and W-35 stay `NS`, because only the member form and the identity markers changed, not those whole screens.** No routed page, in-page view, workflow or dialog call site is beyond `NS`, and nothing is `ACC`: a page that merely inherits the shared look has not been redesigned, and no page has all six marks. The Signature preset is opt-in; the pages have not been redesigned for it.

**D10 (2026-11-12, built and tested locally, uncommitted) redesigned the Add box (Quick Add): S-05 reads `BLT` with all six marks, and the five Quick Add workflows W-01 to W-05 read `BLT` (section 1.5). S-04 and S-08 keep their `BLT` rows (notes in section 1.5). DL-01 stays `NS` (Search and the confirmation dialog are untouched). No routed page, view or other dialog changed, nothing is `ACC`, and real-device acceptance is not recorded.**

**D11 (2026-11-12, committed and pushed after the final correction; deployment read from Actions) redesigned Today and Tasks: T-01 and K-01 read `BLT` with all six marks, the ten Tasks views IV-05 to IV-14 read `BLT` with only `Func` recorded, and W-12 and W-13 read `BLT` (section 1.6). The Tasks Filters sheet adds one `<Modal>` site, so DL-02 now has four and the dialog total is 63 in 42 files. S-07 (the Task creator dialog) and the other Tasks dialogs were not touched and stay `NS`. Nothing is `ACC`: no real phone, screen reader, forced-colors or Safari/Firefox check was done.**

**D13 (2026-11-12, built and tested locally, uncommitted) redesigned the Calendar page: C-01 and the four views IV-01 to IV-04 read `BLT` with the marks actually recorded (section 1.9), DL-03 and W-09 and W-10 read `BLT` for the parts section 1.9 names, W-11 and every other dialog row are untouched. `Kbd` is recorded only for C-01 and the Month view (a 30-stop Tab walk and arrow-key runs with synthetic key events); the other three views are left open. Nothing is `ACC`: no real phone, screen reader, forced-colors or Safari/Firefox check was done.**

**Phases** are those of the D4 roadmap (D5 to D21). D5 itself is the foundation (tokens, preset, this tracker, guards). D6 is the shared controls; D7 header and switcher; D8 Ledger navigation (gated); D9 Family color picker and member identity; D10 Quick Add; D11 Today and Tasks; D12 Ledger Home, Family overview, Household Finances; D13 Calendar; D14 Projects, Home & Assets, Contacts; D15 Services, Bills, Family detail; D16 Ledger everyday money; D17 Ledger analysis and Invest; D18 Ledger Plan; D19 Ledger More, documents, Settings; D20 dialogs and states sweep; D21 finishing.

## Roll-up

| Inventory | Total | Accepted |
|---|---|---|
| Routed page destinations | 59 | 0 |
| Global surfaces | 23 | 0 |
| In-page views | 31 | 0 |
| Dialogs (`<Modal>` call sites) | 63 | 0 |
| Named workflows | 37 | 0 |

A guard test (`src/shell/uiCoverage.test.ts`) fails if a registered route is missing from section 2, if an ID is duplicated, if a referenced file no longer exists, or if any total above stops matching the rows below. Add the row **in the same change** that adds the page.

---

## 1. Global surfaces (23)

| ID | Surface | Source | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| S-01 | Global header: switcher button, Search, Add, Sync chip, Settings | `src/core/ModuleBar.tsx` | D7 | BLT | Y | Y | Y | Y | Y | Y |
| S-02 | Module switcher list (11 modules, 4 groups) | `src/core/moduleGroups.ts` | D7 | BLT | Y | Y | Y | Y | Y | Y |
| S-03 | Sync status chip and pop-over | `src/core/SyncChip.tsx` | D7 | BLT | Y | Y | Y | . | Y | Y |
| S-04 | Add button (desktop in-bar, phone round button) | `src/shell/QuickAdd.tsx` | D7, D10 | BLT | Y | Y | Y | Y | Y | Y |
| S-05 | Add box (Quick Add) | `src/shell/AddBox.tsx`, `AddBoxView.tsx`, `addBoxModel.ts`, `sheetBehavior.ts` | D10 | BLT | Y | Y | Y | Y | Y | Y |
| S-06 | Search dialog | `src/shell/SearchDialog.tsx` | D6, D20 | NS | . | Y | . | Y | Y | . |
| S-07 | Task creator dialog | `src/modules/tasks/QuickTask.tsx` | D11 | NS | . | . | . | . | . | . |
| S-08 | Shared Modal and ConfirmDialog | `src/shell/Modal.tsx` | D6 | BLT | . | Y | . | Y | Y | Y |
| S-09 | Toasts (Undo) | `src/ui/Toast.tsx` | D6 | BLT | . | Y | . | Y | . | . |
| S-10 | Backup reminder banner | `src/shell/BackupReminder.tsx` | D6 | NS | . | Y | . | Y | . | . |
| S-11 | Module loading and load-failed states | `src/shell/ModuleLoader.tsx` | D6 | NS | . | . | . | . | . | . |
| S-12 | Skip link, route announcer, main focus | `src/shell/SkipAndRoute.tsx` | D7 | NS | . | . | . | . | Y | Y |
| S-13 | Ledger desktop navigation bar (replaces the 248 px sidebar) | `src/shell/LedgerNav.tsx` | D8 | BLT | Y | Y | . | Y | Y | Y |
| S-14 | Ledger top bar and breadcrumbs | `src/shell/Shell.tsx` | D8 | BLT | Y | Y | Y | Y | . | Y |
| S-15 | Ledger section tabs (below 900 px) | `src/shell/Shell.tsx` | D8 | NS | . | . | . | . | . | . |
| S-16 | Ledger bottom tab bar (below 900 px) | `src/shell/Shell.tsx` | D8 | NS | . | . | . | . | . | . |
| S-17 | Theme toggle (Device, Light, Dark) | `src/pages/ThemeToggle.tsx` | D8, D19 | BLT | Y | Y | . | Y | Y | Y |
| S-18 | Unknown-address fallback and legacy redirects | `src/core/legacy.ts` | all | NS | . | . | . | . | . | . |
| S-19 | Print styles | `src/styles.css` | D19 | NS | . | . | . | . | . | . |
| S-20 | App identity: browser-bar colour, manifest, icons | `src/theme.ts` | D5, D21 | NS | . | . | . | . | . | . |
| S-21 | Shared page pieces: PageHeader, EmptyState, Banner, Stat, Sparkline; member identity mark, dot and chip (D9) | `src/ui/components.tsx`, `src/ui/MemberIdentity.tsx` | D6, D9 | BLT | Y | Y | . | Y | . | Y |
| S-22 | Pickers and suggestion lists | `src/ui/pickers.tsx` | D6, D15 | NS | . | . | . | . | . | . |
| S-23 | Charts | `src/ui/charts.tsx` | D6, D12, D17 | BLT | Y | Y | Y | Y | . | Y |

S-20 note: D5 deliberately left the browser-bar colour, `index.html` and the manifest alone (the default look is unchanged). When Signature is selected the bar takes the Signature canvas colour at run time; the fixed values move in D21.

### 1.1 D6 evidence behind the marks above, and what was seen on the routed pages (no routed row changed)

Everything below was seen under **Ledger Signature**, in the Claude app's built-in browser, against the fictional D1 demo household (own address, sync off). Screenshots were kept outside the repository.

- **Marks recorded on the surfaces:** `D` = Signature dark, desktop width (about 1280 px); `1440` = the same desktop view (the pane could not be made wider, so 1440 is read as "desktop width", not measured at 1440); `L` = Signature light; `375` = phone width. **S-04** (Add button): navy in light, teal in dark, round on a phone; focus returned to it after the Add box closed. **S-05/S-06/S-08**: opened, Tab kept inside, Escape closed, focus returned to the opener (Add button, Delete account button); in the confirmation Cancel had focus first. **S-09**: seen live in Signature dark on the Tasks page; the Undo path itself was NOT exercised live (the 8-second window passed), so Func stays `.`. **S-10**: the unsaved-data banner on Accounts. **S-21**: gallery and pages in both themes; text and structure pinned by `src/shell/d6Shared.test.tsx`. **S-23**: Reports chart (spending, income) in dark.
- **Routed pages looked at in Signature** (inherited look only, never a redesign): light desktop for Today, Calendar, Tasks, Projects, Home & Assets, Household Services, Bills, Family, Contacts, Ledger Home, Ledger Transactions and Household Finances (all eleven modules); dark desktop for Ledger Transactions, Ledger Accounts, Ledger Reports, Household Finances, Calendar and Family (Family in the older "Deep navy" palette); phone width (375 px) for Tasks, Ledger Transactions and Household Finances. Horizontal-overflow measurement only (no visual check) on 17 addresses at 375 px and 14 at 320 px, light: none overflowed.
- **Not checked:** light mode on Ledger Reports, any page at 320 px visually, Signature dark at phone width, every in-page view and every dialog call site (62), real phones, screen readers, forced-colours mode.

### 1.2 D7 evidence behind the marks on S-01 to S-04 and S-12 (built, uncommitted; nothing is `ACC`)

Seen under **Ledger Signature** in the Claude app's built-in browser, against the fictional D1 demo household on its own address (sync off). Screenshots are kept outside the repository (`DocumentsLedger-Design-ConceptsD7-Evidence`). Report: `docs/LEDGER-SIGNATURE-D7-REPORT.md`.

- **S-01 header and S-02 switcher:** `L` = Signature light, desktop; `D` = Signature dark, desktop (the phone list was **not** seen in dark); `1440` = viewport set to 1440 x 900 (pictures come back scaled); `375` = phone width, **light only**, also seen at 320 px and 660 px, with 800 px for the tablet range. `Kbd` = desktop only: Tab order (skip link, switcher, Search, Sync, Settings, Add), Tab through the open list, Escape returns focus to the button, Enter on a link navigates and closes; the phone list foot was clicked, **not** reached by keyboard. `Func` = the 24 new tests and the whole suite (4,446) pass, and Search (button and Ctrl+K), Add (button and N), Settings (phone foot) and module switching were exercised. Classic and the "Deep navy" preset were looked at **at desktop width only**.
- **S-03 sync chip:** restyled; on a phone the bar shows it only as a warning icon when sync has an error or edits to review (D7 correction). Seen live: the error state at 375 and 320 px in Signature light, 375 px in Signature dark, Classic and "Slate and indigo"; the popover from the bar and from the list foot (opens, Escape closes, focus returns to the chip, Sync settings link present); "Sync off". Not seen live: the healthy and edits-to-review states (mocked tests only), desktop width in an error state, real devices. **`L`, `D`, `375`, `Kbd` and `Func` are marked for the phone attention state and its popover only;** `1440` stays `.` because the desktop chip was not looked at in any state other than "Sync off".
- **S-04 Add button:** the in-bar Add (900 px and up) is navy in light and teal in dark; the round floating button (below 900 px) is unchanged apart from the shared colour already recorded in D6. Header Add and the N shortcut open the Add box. Its redesign belongs to D10, so the row stays `BLT` and the Add box (S-05) is untouched.
- **S-12 skip link:** still the first Tab stop; its visible state in the new header was **not** looked at, so the row stays `NS` with only `Kbd` and `Func` marked.
- **S-17 theme toggle:** not touched in D7 (it lives in Ledger's sidebar and Settings > Appearance). D8 moved it (section 1.3).
- **Not checked:** real phones, screen readers, forced-colours mode, Safari and Firefox, print preview, toast placement, the ⌘K hint on a Mac.

### 1.3 D8 evidence behind S-13, S-14 and S-17 (committed and deployed `8e08fd9`; nothing is `ACC`; the 31 financial pages are NOT marked redesigned)

Seen in the Claude app's built-in browser, fictional D1 demo household on its own address (sync off). Screenshots are outside the repository (`Documents\Ledger-Design-Concepts\D8-Evidence`). Report: `docs/LEDGER-SIGNATURE-D8-REPORT.md`. **Navigation verification is not visual acceptance of the pages' contents:** every Ledger page row in section 2.4 stays `NS`.

- **S-13 (navigation bar replacing the sidebar):** `L` Signature light and `D` Signature dark at 1440 x 900; also looked at in Classic (light) and the "Deep navy" preset (light). `1440` measured (bar 62 to 108, page content 1267 px wide). `375` is `.` on purpose: the bar does not exist below 900 px (checked at 899, 800, 375, 320 and a landscape 812 x 375: the bar is absent and the phone bars show). `Kbd`: Tab, Enter, Escape (focus returns to the chevron), Tab out of an open list (closes it), switching lists. `Func`: all 31 destinations opened from the bar (21 from the lists plus Home, Money's ten), active section and page, an account page, direct link with reload, Back and Forward, due-count badges with two temporary demo rules (removed afterwards).
- **S-14 (top bar and breadcrumbs):** the crumb row is unchanged in content and behaviour; it now sits below the bar, lines up with the page content, and is hidden on desktop Home only (its sole crumb, "Home", repeats the bar). Phone: unchanged, seen at 375 (light). `Kbd` is `.` (crumb links were not Tabbed through separately).
- **S-15 section tabs and S-16 bottom tab bar:** NOT visually modified, so they stay `NS` (their code and styles are untouched; only the shared "active page" rule they call now comes from the navigation model, with the same result). Their behaviour was re-checked at 375: five tabs, same destinations, ten, four, ten and six section tabs.
- **S-17 (theme toggle):** now at the right end of the Ledger bar (still the same component, same Device, Light, Dark cycle and storage; cycle and persistence seen). Still also in Settings > Appearance.
- **Not checked:** real phones or tablets (touch, 44 px targets measured by style only), screen readers, forced-colours mode, Safari and Firefox, print preview, dark mode at phone width, Classic and navy at phone width.

### 1.4 D9 evidence: Family member color picker and member identity pieces (committed and deployed `939f985`, Pages run #95 success, verified at the D10 gate; nothing is `ACC`; no Family row is marked redesigned)

Seen in the Claude app's built-in browser against the fictional D1 demo household (own address, sync off). Screenshots are outside the repository (`Documents\Ledger-Design-Concepts\D9-Evidence`). Report: `docs/LEDGER-SIGNATURE-D9-REPORT.md`. **This phase changed the member form and the small identity markers, not whole screens, so every Family row (F-01, F-02, F-03, DL-09, W-35) stays `NS`.** The marks below say what was actually seen.

- **Member form (the Add and Edit dialog; one of the three call sites in DL-09, the other two untouched):** two columns from 780 px, one column below, with a sticky Cancel and Save bar. `L` and `D` Signature, `1440` (880 px dialog), `375` (light and dark), `320` (light, no overflow), Classic (light, desktop). `Kbd`: Tab order checked with the real keyboard (close, who is this, contact search, contact list, role, month, day, year, calendar box, the color group as ONE stop, note, Cancel, Add), arrow keys moved the color choice (Teal to Gray) with the focus outline visible. `Func`: add from an existing Contact, add through an explicit new Contact, edit a color, No color (the stored key is removed, never Gray), Cancel (database byte-identical), the same-name warning and its confirmation, "Use this one instead".
- **Color picker:** eight native radio buttons plus "No color — neutral gray" in one group. 48 px swatches (52 px at 640 px and narrower), four columns, ring in the main text color, check mark, bold name, separate accent focus outline. Contrast measured on all six palettes in light and dark (report section 9; pinned by `family-d9-identity.test.tsx`).
- **Shared identity pieces (S-21):** `MemberMark`, `MemberDot`, `MemberChip` in `src/ui/MemberIdentity.tsx`, colors from the existing `--mc-*` tokens. Used on the Family overview cards (F-01), the household "People" rows (F-01), and the member page profile (F-02). They are not used in Calendar, Tasks or Today.
- **Not checked:** real phones, screen readers, forced-colors mode (CSS written, not seen), Safari and Firefox, the sticky bar when a phone keyboard is open, Signature at 320 px in dark, the other presets at phone width, Edit on a phone.

### 1.5 D10 evidence: the Add box (Quick Add) (built, uncommitted; nothing is `ACC`; no module page is marked redesigned)

Seen in the Claude app's built-in browser against the fictional D1 demo household (own address, sync off). Screenshots are outside the repository (`Documents\Ledger-Design-Concepts\D10-Evidence`). Report: `docs/LEDGER-SIGNATURE-D10-REPORT.md`. **This phase redesigned the box and its phone sheet, not the pages it can create things for, so no page row and no other dialog row changed.**

- **S-05 Add box:** `L` and `D` Signature at 1440 and 375, `375` (compact and expanded sheet; 320 light; 640x360 sideways), `1440` (and 900), Classic light (looked at). `Kbd`: a real Tab walk (field, Task, Event, Transaction, Project, Asset, Service, Household service, Bill or subscription, Family member, to Cancel; every stop showed a focus ring), Escape, **N**, Enter, and Escape returning focus to the Add button. `Func`: all eleven destinations and both specialised actions exercised (seven typed creations each made exactly one record, Transaction saved through its own Save, three open-a-screen destinations opened the right screen or form), existing prefills, Escape, Cancel and backdrop saving nothing, and the full test suite.
- **W-01 to W-05:** each was run through the real keyboard and read back from the database (report section 15). They read `BLT` only: a workflow is accepted when its pages and dialogs are accepted, and none of the destination pages has been.
- **S-04 Add button:** opens the sheet on a phone and focus returns to it on close (seen). Row unchanged.
- **S-08 Shared Modal:** one opt-in addition: `variant="sheet"` now also follows the visible area when the keyboard opens and locks the page behind it on a phone or touch screen (`src/shell/sheetBehavior.ts`); a plain dialog is unchanged. Row unchanged; its marks were not extended (only the Add box was checked as a sheet).
- **Not checked:** real phones (the on-screen keyboard, the home-indicator padding, browser toolbars, touch scrolling: UNVERIFIED until the owner checks), screen readers, forced-colors mode (CSS written, not seen), Safari and Firefox, Classic contrast (looked at, not measured), the other four presets, Signature dark at 320 px. The 470 px keyboard run was a scripted resize of the visual viewport, not a real keyboard.

### 1.6 D11 evidence: Today and Tasks (committed and pushed; nothing is `ACC`; Today's contributed cards were not redesigned)

Seen in headless Chrome on a throwaway profile holding the fictional D1 demo household (own address `localhost:5231`, sync off), driven by DevTools-protocol scripts; the Claude app's browser pane was used only to read the existing data first. Screenshots are outside the repository (`Documents\Ledger-Design-Concepts\D11-Evidence`, `baseline` and `after`). Report: `docs/LEDGER-SIGNATURE-D11-REPORT.md`. **Synthetic key events are not a physical keyboard, and none of this is a real phone or a screen reader.**

- **T-01 Today:** `L` and `D` Signature at 1440 and 375 (light also at 800 and 320; Classic light looked at on the empty profile; Classic dark and Slate light captured, and Slate on a phone seen only as a thumbnail; an empty profile at 1440 and 375), `375`, `1440`. `Kbd`: a Tab walk of 34 stops (header controls, Next up, every row and its action) in order, each stop showing a visible focus indicator. `Func`: the three overdue and 17 coming-up items equal the pre-change baseline; the card list, default order and widths unchanged; card links, Open bill, Next up, mark done and Undo, Edit layout (reorder, hide, reload keeps it, Reset), Hide amounts (no amount in page text, accessible names or tooltips; survives a reload) all checked; the full suite. The 11 cards' own insides were not redesigned (they sit in the new layout unchanged).
- **K-01 Tasks:** same widths and themes (phone at 375 and 320, dark at 375, 320 and 1440; Classic light at 1440 looked at; Classic and Slate at 375 and Slate at 1440 captured, not looked at closely). `Kbd`: Tab walks on desktop and phone (all stops visible), Escape closes the Filters sheet and the More menu and returns focus. `Func`: all ten views reachable on desktop and phone with the same tasks in the same order as before; one filter state shared by the computer's chips and the phone's sheet (same results for five combinations, kept across a width change, Clear filters returns to the default); search, sort, empty result, complete and reopen, edit, create, long and unbroken titles, no-due-date, bulk Reschedule, Complete and Undo, selection cancel, D10 Quick Add still creates a Task. **A bulk Priority, List or Tag change stores the wrong value; this was already so before D11 and was not changed (report section 16, finding D11-F1).**
- **IV-05 to IV-14 (ten Tasks views):** `Func` only. Each was opened on desktop and on a phone and compared with the baseline. They were looked at as pictures only for Today (phone, dark), Upcoming (desktop), All (desktop, phone, dark) and By priority (phone), so the visual marks are left open.
- **W-12 and W-13:** read `BLT`. W-12 (create, edit, complete, bulk, lists): the Lists dialog was not opened. W-13 (Edit layout, Hide amounts): all checked as above.
- **DL-02 Tasks dialogs:** now four sites; the new one is the phone Filters sheet (the shared `Modal`, `variant="sheet"`; focus inside, Escape closes, focus returns). The other three are untouched, so the row stays `NS`. **S-07** also stays `NS` (`QuickTask.tsx` and `TaskEditor.tsx` were not edited).
- **Not checked:** real phones (touch targets, the floating Add button over rows, on-screen keyboard in the sheet), screen readers, forced colors (no rule was added), Safari and Firefox, the other three presets, the Lists dialog and the Task editor in Signature, the Completed and Deleted views as pictures in dark, 800 px for Tasks beyond one picture. New text colors were measured by arithmetic for Classic and every preset in both modes (all 4.5:1 or better; `src/modules/today/d11Contrast.test.ts`); no foreground was checked on a real screen.

### 1.7 D12 evidence: Ledger Home, Family overview, Household Finances (built, NOT committed; nothing is `ACC`)

Seen in headless Chrome on a throwaway profile holding the fictional D1 demo household (own address `localhost:5231`, sync off), driven by DevTools-protocol scripts. Screenshots are outside the repository (`Documents\Ledger-Design-Concepts\D12-Evidence`, `baseline` and `after`). Report: `docs/LEDGER-SIGNATURE-D12-REPORT.md`. **Synthetic key events are not a physical keyboard, and none of this is a real phone or a screen reader.**

- **L-01 Ledger Home:** `L` and `D` Signature at 1440 (light also at 1024, 800, 375, 320; dark also at 375), Classic light and Slate light at 1440, Edit Home mode and "Show all steps" open. `Kbd`: a Tab walk of 25 stops on a computer and on a phone, each with a visible focus indicator. `Func`: all 12 card ids in the default order; every money figure equals the pre-change baseline; chart labels carry the provider values; a saved layout (order, widths, removed card) honored after a reload; Edit Home bars; removing a card saved in the same format; Reset to default; "Show all steps". Seven-digit amounts and an unbroken 55-character payee name were tried at 320 and 375 (DOM text only, nothing saved): no overflow. The card list, ids, order, widths and the stored layout are unchanged; Hide amounts does not cover Ledger Home (its documented scope), so none was added.
- **H-01 Household Finances:** same widths and themes, plus the certainty summary at 1440 and 375, Needs review, the 90-day view, and Hide amounts at 1440 and 375. `Kbd`: Tab walks of 22 stops (both widths). `Func` (browser): every baseline figure still present with the same count, the only additions being the ten repeats in the summary tiles and the equation; the Expected tile and card follow 7, 30 and 90 days and equal the reader's values; the Recorded tile follows the period menu (Last 90 days checked); Needs review count equals the reader's list; all five disclosures open; "See ..." buttons move focus to their section; with Hide amounts on there is no dollar digit in text or in any accessible name and no proportion bar; hidden is a mask, never $0.00.
- **F-01 Family overview:** same widths and themes, plus the person filter, the Add member form (8 swatches and No color), and a member with no color (a stored color was cleared on the throwaway profile for the check and put back). `Kbd`: Tab walks of 32 stops on a computer and 28 on a phone. `Func`: every active member is one card; each card and mark carries its stored color id; choosing a person narrows the three sections (activities 3 to 2, tasks 4 to 1 for one member) and Everyone restores them; Add member opens the D9 form and Escape closes it without saving; a card opens that member's page. Long, unbroken names were tried at 320 and 375: no overflow.
- **S-23 charts:** the Home charts (spending ring, income and spending columns with the dollar axis and the dashed "so far" month, assets ring, the net-worth chart's colors). The net-worth trend chart itself was not drawn (the demo household has no saved history), so its keyboard behavior was not exercised and `Kbd` stays `.`.
- **W-37:** read `BLT`: period, disclosures and Hide amounts were run as above. No overlap marker was built (not authorized).
- **Not checked:** real phones, screen readers, forced colors (no new rule), Safari and Firefox, the other two presets ("Calm teal", "Forest") and Deep navy for these three pages, the Family member pages and dates (D15), the Household pages' modules (Bills, Services, Assets), a Home with a saved net-worth history (the dark hero with the white chart band below it was seen only through its empty-trend state), and any real household data. Text colors for the hero and the new Home words were measured by arithmetic for Classic and every preset in both modes (`src/pages/d12Contrast.test.ts`); no foreground was checked on a real screen.

### 1.8 D12 refinement evidence: Ledger Home composition (built, NOT committed; nothing is `ACC`)

Owner priority recorded: the approved prototypes are the visual targets; the old layout is not sacred; a designed default beats an unrestricted dashboard builder; reordering matters more than add, remove, hide or resize; financial and functional integrity stay non-negotiable; material deviations need justification and review. Report: `docs/LEDGER-SIGNATURE-D12-REFINEMENT-REPORT.md`. Same method as section 1.7 (headless Chrome, throwaway profile, fictional data, synthetic key events; **not** a real phone or screen reader). Pictures: `D12-Evidence\refinement`.

- **L-01 Ledger Home (marks unchanged, now resting on the new composition):** full-width hero (net worth and the month), Needs attention strip, one-row Get started, two columns (analysis 5 : 3 supporting), one-card Spending & budget; `L` and `D` at 1440 (also 1024, 800, 375, 320 light; 375 dark; Classic and Slate at 1440); `Kbd`: Tab walks, every stop with a visible focus indicator, phone links 44 px or taller; `Func`: all baseline figures and labels equal (31 of 31), sections reordered, hidden, shown and reset with the result kept after a reload, a fictional customized `ledger.home.layout.v1` carried over with a visible note and left byte for byte unchanged, "Use my earlier arrangement again". The net-worth trend chart was seen with six fictional saved months in light and dark, read with the arrow keys, and with none or one month (note, no chart). **The earlier one-card-per-widget customization is gone by design** (widths, removing the top cards, moving Spending and Budget separately).
- **L-01, D12 final pass (marks unchanged):** hero "Assets (positive balances)" and "Owed (cards and loans)" figures; What you own and owe as two bars on one scale; Monthly check-in as a segmented bar; a divider between the spending and budget panels. Seen at 1440 (light, dark, Classic, Slate), 1024, 800, 375 (light, dark) and 320, with seven-digit amounts at 320 and 375; `Kbd`: Tab walks re-run (every stop visible, phone links 44 px or taller); `Func`: 43 browser checks and the new unit tests. A category-keyed spending and budget table was NOT built (report 22.2).
- **L-01, D12 final mobile correction (marks unchanged):** on a phone the top panel is two cards (net worth, then the month), from the same markup and data; the chart is 176 px tall on a phone. Seen as real 812 px viewports at 375 (light and dark, with and without six fictional months) and as pages at 320 (light, dark, long amounts); bottom navigation and the Add button checked in a normal viewport (fixed, nothing permanently covered, a tap opens the Add box); arrow-key reading of the chart on a phone-sized page; 55 phone checks and the 43 desktop checks pass. Real phones and screen readers are still not tested.
- **F-01 Family overview:** the tasks section now reads "Related tasks" and the intro says "associated with"; nothing else changed.
- **S-23 charts:** the Income vs spending chart draws at its card's width; the net-worth chart takes light colors inside the dark hero.
- **Not checked:** real phones, screen readers, forced colors, Safari and Firefox, the other three presets for Home, the Home alerts' Snooze and Dismiss (not built), a merged spending and budget table (not built).

### 1.9 D13 evidence: Calendar (built, NOT committed; nothing is `ACC`)

Seen in headless Chrome on a throwaway profile holding the fictional D1 demo household (own address `localhost:5231`, sync off), driven by DevTools-protocol scripts. Screenshots are outside the repository (`DocumentsLedger-Design-ConceptsD13-Evidence`, `baseline` and `after`). Report: `docs/LEDGER-SIGNATURE-D13-REPORT.md`. **Synthetic key events are not a physical keyboard, and none of this is a real phone or a screen reader.** There is no approved Calendar prototype; the design applies the approved Today and Tasks language.

- **C-01 and IV-01 (Month):** `L` and `D` Signature at 1440 (also 1280 and 1024; Classic light and dark, Slate light at 1440), `375` and `320` (light; 375 also dark), a phone held sideways (812 x 375) and 800 wide. `Func`: the 42 cells list the same items in the same order as the pre-change baseline; next, previous, Today, a month boundary (Jan 31 to Feb 28); select a day, a dense day (4 items, "+1 more", all 4 in the list); a 30-stop Tab walk (the grid is one stop; every stop showed a focus ring except the native date picker button of the jump-to-date field), arrow keys, Home, PageUp, PageDown; double-click and the selected day's Add event create with the date filled in; open an existing event, create, edit, cancel an edit (stored record byte-identical); layer menu: Deselect all, Personal only, persisted across a reload, kept across a view change, Select all; address links `?new=1`, `?open=` and `?d=`; Search and Quick Add create exactly one event; 13 months of Household Services visits equal the baseline (37 dates, 26 house-cleaning visits, no duplicates), browsing wrote nothing, only one open House cleaning Task.
- **IV-02, IV-03, IV-04:** opened on desktop and phone with no horizontal overflow; Week and Agenda also in dark; Agenda also with a filter active and the overdue section. Week and Work week were not compared item by item with the baseline (`Func` left open for them; the time-grid logic was not edited).
- **DL-03:** the event editor (five named sections, sticky Save and Cancel, phone sheet) and the day dialog. **W-09/W-10:** as the rows say.
- **Not checked:** real phones, screen readers, forced colors, Safari and Firefox, a Tab walk of Week, Work week and Agenda, the Calendars manager, .ics export, delete and the repeat-scope dialog in the browser, the other two presets, Signature dark at 320.

Addresses are written as they appear after `#` in the browser. Ledger pages are under `/ledger`. The guard compares this column with the app's route registrations.

### 2.1 Today, Calendar, Tasks (3)

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| T-01 | `/today` | `src/modules/today/TodayModule.tsx` | D11 | BLT | Y | Y | Y | Y | Y | Y |
| C-01 | `/calendar` | `src/modules/calendar/CalendarPage.tsx` | D13 | BLT | Y | Y | Y | Y | Y | Y |
| K-01 | `/tasks` | `src/modules/tasks/TasksPage.tsx` | D11 | BLT | Y | Y | Y | Y | Y | Y |

### 2.2 Projects, Home & Assets (5)

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | `/projects` | `src/modules/projects/ProjectsPage.tsx` | D14 | NS | . | . | . | . | . | . |
| P-02 | `/projects/:id` | `src/modules/projects/ProjectPage.tsx` | D14 | NS | . | . | . | . | . | . |
| A-01 | `/assets` | `src/modules/assets/OverviewPage.tsx` | D14 | NS | . | . | . | . | . | . |
| A-02 | `/assets/list` | `src/modules/assets/AssetsPage.tsx` | D14 | NS | . | . | . | . | . | . |
| A-03 | `/assets/:id` | `src/modules/assets/AssetPage.tsx` | D14 | NS | . | . | . | . | . | . |

### 2.3 Household Services, Bills & Subscriptions (9)

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| V-01 | `/services` | `src/modules/services/OverviewPage.tsx` | D15 | NS | . | . | . | . | . | . |
| V-02 | `/services/a/:id` | `src/modules/services/ArrangementPage.tsx` | D15 | NS | . | . | . | . | . | . |
| V-03 | `/services/providers/:contactId` | `src/modules/services/ProviderPage.tsx` | D15 | NS | . | . | . | . | . | . |
| V-04 | `/services/v/:id` | `src/modules/services/VisitPage.tsx` | D15 | NS | . | . | . | . | . | . |
| B-01 | `/bills` | `src/modules/bills/OverviewPage.tsx` | D15 | NS | . | . | . | . | . | . |
| B-02 | `/bills/list` | `src/modules/bills/ListPage.tsx` | D15 | NS | . | . | . | . | . | . |
| B-03 | `/bills/upcoming` | `src/modules/bills/UpcomingPage.tsx` | D15 | NS | . | . | . | . | . | . |
| B-04 | `/bills/review` | `src/modules/bills/ReviewPage.tsx` | D15 | NS | . | . | . | . | . | . |
| B-05 | `/bills/o/:id` | `src/modules/bills/ObligationPage.tsx` | D15 | NS | . | . | . | . | . | . |

### 2.4 Household Finances, Family, Contacts (6)

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| H-01 | `/household` | `src/modules/household/OverviewPage.tsx` | D12 | BLT | Y | Y | Y | Y | Y | Y |
| F-01 | `/family` | `src/modules/family/OverviewPage.tsx` | D12 | BLT | Y | Y | Y | Y | Y | Y |
| F-02 | `/family/m/:id` | `src/modules/family/MemberPage.tsx` | D9, D15 | NS | . | . | . | . | . | . |
| F-03 | `/family/dates` | `src/modules/family/DatesPage.tsx` | D15 | NS | . | . | . | . | . | . |
| N-01 | `/contacts` | `src/modules/contacts/DirectoryPage.tsx` | D14 | NS | . | . | . | . | . | . |
| N-02 | `/contacts/c/:id` | `src/modules/contacts/ContactPage.tsx` | D14 | NS | . | . | . | . | . | . |

### 2.5 Settings (5)

The Settings frame (heading and tab row) is `src/pages/SettingsPage.tsx`; each row below is one tab.

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| G-01 | `/settings/general` | `src/pages/GeneralSettings.tsx` | D19 | NS | . | . | . | . | . | . |
| G-02 | `/settings/appearance` | `src/pages/AppearanceCard.tsx` | D5, D19 | NS | . | . | . | . | . | . |
| G-03 | `/settings/backup` | `src/pages/BackupPage.tsx` | D19 | NS | . | . | . | . | . | . |
| G-04 | `/settings/sync` | `src/pages/SyncPage.tsx` | D19 | NS | . | . | . | . | . | . |
| G-05 | `/settings/calendar` | `src/modules/calendar/CalendarSettings.tsx` | D19 | NS | . | . | . | . | . | . |

G-02 note: D5 added the Ledger Signature choice (labelled preview) to this screen. The row stays `NS` because the screen itself has not been restyled; the palette builder and saved themes are unchanged.

### 2.6 Ledger (31)

Ledger has 32 route entries and 31 pages. `/ledger/backup` is a redirect to `/settings/backup` (section 7), not a page. `/ledger/sync` and `/settings/sync` are one component at two addresses (L-31 and G-04).

| ID | Address | Component | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| L-01 | `/ledger` | `src/pages/HomePage.tsx` | D12 | BLT | Y | Y | Y | Y | Y | Y |
| L-02 | `/ledger/checkin` | `src/pages/CheckinPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-03 | `/ledger/accounts` | `src/pages/AccountsPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-04 | `/ledger/account/:id` | `src/pages/LedgerPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-05 | `/ledger/transactions` | `src/pages/TransactionsPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-06 | `/ledger/budget` | `src/pages/BudgetPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-07 | `/ledger/scheduled` | `src/pages/ScheduledPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-08 | `/ledger/forecast` | `src/pages/ForecastPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-09 | `/ledger/reports` | `src/pages/ReportsPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-10 | `/ledger/rules` | `src/pages/RulesPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-11 | `/ledger/import` | `src/pages/ImportPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-12 | `/ledger/categories` | `src/pages/CategoriesPage.tsx` | D16 | NS | . | . | . | . | . | . |
| L-13 | `/ledger/networth` | `src/pages/NetWorthPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-14 | `/ledger/investments` | `src/pages/InvestmentsPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-15 | `/ledger/payoff` | `src/pages/PayoffPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-16 | `/ledger/debt` | `src/pages/DebtPage.tsx` | D17 | NS | . | . | . | . | . | . |
| L-17 | `/ledger/income` | `src/pages/IncomePage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-18 | `/ledger/taxplan` | `src/pages/TaxPlanPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-19 | `/ledger/giving` | `src/pages/GivingPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-20 | `/ledger/afford` | `src/pages/AffordPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-21 | `/ledger/paycheck` | `src/pages/PaycheckPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-22 | `/ledger/projections` | `src/pages/ProjectionPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-23 | `/ledger/retirement` | `src/pages/RetirementPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-24 | `/ledger/goals` | `src/pages/GoalsPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-25 | `/ledger/protection` | `src/pages/ProtectionPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-26 | `/ledger/roth` | `src/pages/RothPage.tsx` | D18 | NS | . | . | . | . | . | . |
| L-27 | `/ledger/more` | `src/pages/MorePage.tsx` | D19 | NS | . | . | . | . | . | . |
| L-28 | `/ledger/review` | `src/pages/ReviewPage.tsx` | D19 | NS | . | . | . | . | . | . |
| L-29 | `/ledger/guide` | `src/pages/GuidePage.tsx` | D19 | NS | . | . | . | . | . | . |
| L-30 | `/ledger/taxpackage` | `src/pages/TaxPackagePage.tsx` | D19 | NS | . | . | . | . | . | . |
| L-31 | `/ledger/sync` | `src/pages/SyncPage.tsx` | D19 | NS | . | . | . | . | . | . |

Dashboard cards (Today 11, Ledger Home 12) are tracked inside T-01 and L-01.

## 3. In-page views (31)

Views share their page's address. Each needs its page's checks plus its own empty and populated state.

| ID | Page | View | Phase | Status | L | D | 375 | 1440 | Kbd | Func |
|---|---|---|---|---|---|---|---|---|---|---|
| IV-01 | C-01 Calendar | Month | D13 | BLT | Y | Y | Y | Y | Y | Y |
| IV-02 | C-01 Calendar | Week | D13 | BLT | Y | Y | Y | Y | . | . |
| IV-03 | C-01 Calendar | Work week | D13 | BLT | Y | . | Y | Y | . | . |
| IV-04 | C-01 Calendar | Agenda | D13 | BLT | Y | Y | Y | Y | . | Y |
| IV-05 | K-01 Tasks | Today | D11 | BLT | . | . | . | . | . | Y |
| IV-06 | K-01 Tasks | Upcoming | D11 | BLT | . | . | . | . | . | Y |
| IV-07 | K-01 Tasks | Overdue | D11 | BLT | . | . | . | . | . | Y |
| IV-08 | K-01 Tasks | All | D11 | BLT | . | . | . | . | . | Y |
| IV-09 | K-01 Tasks | By list | D11 | BLT | . | . | . | . | . | Y |
| IV-10 | K-01 Tasks | By tag | D11 | BLT | . | . | . | . | . | Y |
| IV-11 | K-01 Tasks | By priority | D11 | BLT | . | . | . | . | . | Y |
| IV-12 | K-01 Tasks | Waiting | D11 | BLT | . | . | . | . | . | Y |
| IV-13 | K-01 Tasks | Completed | D11 | BLT | . | . | . | . | . | Y |
| IV-14 | K-01 Tasks | Deleted | D11 | BLT | . | . | . | . | . | Y |
| IV-15 | P-01 Projects | Open | D14 | NS | . | . | . | . | . | . |
| IV-16 | P-01 Projects | Finished | D14 | NS | . | . | . | . | . | . |
| IV-17 | P-01 Projects | Archived | D14 | NS | . | . | . | . | . | . |
| IV-18 | P-01 Projects | All | D14 | NS | . | . | . | . | . | . |
| IV-19 | A-02 Assets list | In use | D14 | NS | . | . | . | . | . | . |
| IV-20 | A-02 Assets list | Stored | D14 | NS | . | . | . | . | . | . |
| IV-21 | A-02 Assets list | Past (with sold, disposed, replaced sub-filter) | D14 | NS | . | . | . | . | . | . |
| IV-22 | A-02 Assets list | Archived | D14 | NS | . | . | . | . | . | . |
| IV-23 | A-02 Assets list | All | D14 | NS | . | . | . | . | . | . |
| IV-24 | L-14 Investments | Accounts | D17 | NS | . | . | . | . | . | . |
| IV-25 | L-14 Investments | Realized gains | D17 | NS | . | . | . | . | . | . |
| IV-26 | L-14 Investments | Prices and assumptions | D17 | NS | . | . | . | . | . | . |
| IV-27 | L-20 Afford | Can I afford it? | D18 | NS | . | . | . | . | . | . |
| IV-28 | L-20 Afford | Rent or buy? | D18 | NS | . | . | . | . | . | . |
| IV-29 | L-09 Reports | Trends | D17 | NS | . | . | . | . | . | . |
| IV-30 | L-09 Reports | Flow diagram | D17 | NS | . | . | . | . | . | . |
| IV-31 | P-02 Project detail | Task filter groups | D14 | NS | . | . | . | . | . | . |

## 4. Dialogs and confirmations

### 4.1 Dialogs: `<Modal>` call sites (63 in 42 files)

Each site is a form, a question or a detail view. Counted from the source in D5 (the number below must equal the guard's recorded baseline in `src/shell/uiBaseline.ts`).

| ID | Module | Sites | Files | Phase | Status |
|---|---|---|---|---|---|
| DL-01 | Shell (Add box, Search, ConfirmDialog base) | 3 | `AddBox`, `SearchDialog`, `ConfirmDialog` | D6, D10 | NS |
| DL-02 | Tasks | 4 | `TaskEditor`, `QuickTask`, `ListsDialog`, `TasksPage` (the phone Filters sheet, D11) | D11 | NS |
| DL-03 | Calendar | 8 | `EventEditor` (2), `dialogs` (5), `HandoffDialog` | D13 | BLT |
| DL-04 | Projects | 3 | `ProjectForm`, `CommitmentForm`, `DeleteProject` | D14 | NS |
| DL-05 | Home & Assets | 7 | `AssetForm`, `AddMaintenance`, `ServiceForm` (2), `WarrantyForm`, `LifecycleDialog`, `DeleteAsset` | D14 | NS |
| DL-06 | Contacts | 2 | `ContactForm`, `RemoveContact` | D14 | NS |
| DL-07 | Household Services | 13 | `ArrangementForm`, `Dialogs` (3), `PaymentUI`, `ProviderPage`, `S4Dialogs` (4), `VisitDialogs` (3) | D15 | NS |
| DL-08 | Bills & Subscriptions | 17 | `ObligationForm`, `Dialogs` (3), `CycleDialogs` (2), `LifecycleDialogs` (2), `PaymentUI`, `RepairDialogs` (2), `ScheduledUI` (3), `ContractCard` (2), `DiscoverCard` | D15 | NS |
| DL-09 | Family | 3 | `MemberForm`, `DateForm`, `ImportantContacts` | D9, D15 | NS |
| DL-10 | Ledger pages | 3 | `LedgerPage`, `ScheduledPage`, `TxnDeleteDialog` | D16 | NS |
| | **Total** | **63** | 42 files | | |

Inline (non-modal) forms in Ledger pages (transaction form, income setup, scenario editors, loan forms) are covered by their page rows.

### 4.2 Confirmation styles

| ID | Style | Sites | Phase | Status |
|---|---|---|---|---|
| CF-01 | Shared `ConfirmDialog` (`RemoveContact`, `DatesPage`, `ImportantContacts`, `MemberPage`, `BackupPage`, `LedgerPage`, `SyncPage` x2) | 8 in 7 files | D6 | NS |
| CF-02 | Bills-local confirm component (`src/modules/bills/LifecycleCard.tsx`) | 1 | D15 | NS |
| CF-03 | **Browser-native `confirm()`**: cannot be styled; replacing it changes behaviour (decision OD-6, gated, D20) | 37 in 24 files | D20 | NS |

### 4.3 Pop-overs and suggestion lists (5)

Module switcher list (S-02), Sync status pop-over (S-03), Calendar layer menu (`src/modules/calendar/LayerMenu.tsx`, D13), picker pop-ups and payee suggestions (S-22).

## 5. Named workflows (37)

A workflow is accepted when its pages and dialogs are accepted and the flow check for it has passed.

| ID | Workflow | Phase | Status |
|---|---|---|---|
| W-01 | Quick Add: typed shortcut, preview, Add (Task, Event, Project, Asset, Service, Household service, Bill or subscription) | D10 | BLT |
| W-02 | Quick Add: Transaction (Ledger's form with its own Save) | D10 | BLT |
| W-03 | Quick Add: Scheduled payment (opens `/ledger/scheduled`) | D10 | BLT |
| W-04 | Quick Add: Family member, Family date (open Family's own forms via `?add=`) | D10 | BLT |
| W-05 | Quick Add specialised actions: Log a trade, New paycheck scenario | D10 | BLT |
| W-06 | Global search (Ctrl/Cmd+K, `/`) and its 7 actions | D6 | NS |
| W-07 | Add-a-task dialog (from search or `requestTask`) | D11 | NS |
| W-08 | Module switching, "open where I left off" landing | D7 | NS |
| W-09 | Calendar events: create, edit, delete, repeating-event scope | D13 | BLT |
| W-10 | Calendars manager, layer menu, .ics export | D13 | BLT |
| W-11 | Calendar event handed to Ledger as a scheduled item | D13, D16 | NS |
| W-12 | Tasks: create, edit, complete, bulk select, lists | D11 | BLT |
| W-13 | Today: edit layout, hide amounts | D11 | BLT |
| W-14 | Monthly check-in | D16 | NS |
| W-15 | Transactions: add, edit, split, reconcile, bulk category, delete with dependency check | D16 | NS |
| W-16 | CSV import and undo import | D16 | NS |
| W-17 | Scheduled items: create, post, skip, delete recurring | D16 | NS |
| W-18 | Rules and detect-recurring | D16 | NS |
| W-19 | Budget assign, targets, reorder | D16 | NS |
| W-20 | Trades, lots, prices, realized gains | D17 | NS |
| W-21 | RSU grants and vest schedule | D18 | NS |
| W-22 | Income setup per person, HSA log, paycheck scenarios | D18 | NS |
| W-23 | Planning calculators: tax plan, afford, projections, retirement, Roth, giving, protection, goals | D18 | NS |
| W-24 | Loans and payoff | D17 | NS |
| W-25 | Net-worth valuations and snapshots | D17 | NS |
| W-26 | Documents: Year in review, If something happens guide, Tax package (print and export) | D19 | NS |
| W-27 | Backup and restore (plain and encrypted), auto-backup | D19 | NS |
| W-28 | Device sync set-up and conflicts | D19 | NS |
| W-29 | Appearance: palette, custom palette builder, saved themes | D5, D19 | NS |
| W-30 | General and Calendar settings | D19 | NS |
| W-31 | Projects: create, edit, delete (plan), budget lines, commitments, vendors | D14 | NS |
| W-32 | Assets: add, maintenance, service, warranty, lifecycle, delete | D14 | NS |
| W-33 | Household Services: arrangements, visits, payments, schedule changes, contract dates, hand-offs | D15 | NS |
| W-34 | Bills: add/edit, periods and payments, lifecycle, discovery, review list, links | D15 | NS |
| W-35 | Family: member add/edit (contact choice, colour), dates, important contacts, removal | D9, D15 | NS |
| W-36 | Contacts: add/edit/remove, where used | D14 | NS |
| W-37 | Household Finances review: period, disclosures, hide amounts | D12 | BLT |

W-29 note: D5 added the Signature choice to Appearance and left the rest of the flow untouched; the flow is re-accepted in D19.

## 6. Residue baseline (report only)

Measured by `src/shell/uiBaseline.ts` at commit `8ab1789` plus the D5 change. The aim is for them to go **down**; `src/shell/uiResidue.test.ts` prints each count against this baseline on every run and **never fails** because one moved (D5 release correction). The targets are the D4 roadmap (section 7) and are reached phase by phase, not in D5.

| Measure | D4 baseline | D5 measured | D6 measured | Target |
|---|---|---|---|---|
| Static inline `style={{` (non-test screens) | 307 in 83 files | 307 in 83 files | 308 in 84 files (one data-driven bar width in `Figure.tsx`) | only data-driven values |
| Raw `border-radius` pixel values in CSS (including 999px pills) | 67 | 67 | 69 (two in the new stylesheet: a 4px bar, a 2px sheet handle) | 0 outside token files and chart geometry |
| Raw `font-size` px or rem values in CSS | 36 | 36 | 38 (two date-tile day sizes in the new stylesheet) | tokens only |
| Font sizes below 12 px (px only / px and rem) | 9 | 9 / 11 | 9 / 11 | none except the date-tile label |
| Hex colours in CSS | 152 | 152 | 150 | only palettes and chart sets |
| Hex colours in module CSS | 56 | 56 | 56 | 0 |
| Own `<h1>` instead of `PageHeader` (files) | 13 | 13 | 13 | listed exceptions only |
| `className="card…"` uses | 395 | 395 | not re-measured | n/a (restyled in place) |
| Browser-native `confirm()` calls | 37 in 24 files | 37 in 24 files | 37 in 24 files | 0, or owner-accepted list (OD-6) |
| `<Modal>` sites | 62 in 41 files | 62 in 41 files | 62 in 41 files | not above 62 (D11 made it 63 in 42: the phone Filters sheet; the baseline constant was raised with it) |
| `!important` | 11 | 11 | 11 | not above 11 |

Discrepancies found while re-measuring (none changed the baseline): D4's "9 font sizes below 12 px" counts `px` values only; the two further `rem` values (0.7rem and 0.68rem) make 11. D4's "37 confirm()" counts calls with a message; the source also has five local functions named `confirm` (not the browser's) which are not counted.

Measured after D11 (informational): inline `style={{` 306 in 82 files, raw border-radius pixel values 61, raw font-size values 38, hex colours 147 (module CSS 54), own `<h1>` files 12 (Tasks now uses `PageHeader`), `<Modal>` sites 63 in 42 files, `!important` 11, native `confirm()` 37 in 24 files. The baseline constants in `src/shell/uiBaseline.ts` were not lowered except for the Modal count, which the guard needs.

## 7. Aliases and redirects (not pages)

1. `/ledger/backup` redirects to `/settings/backup`.
2. `/settings/<anything else>` redirects to `/settings/backup`.
3. In Assets, Bills, Contacts, Family, Household, Projects and Services an unknown sub-address shows the module's first page; in Ledger it shows Home; Today, Calendar and Tasks have a single screen.
4. Old addresses from before modules (for example `#/budget`) forward to the owning module (`src/core/legacy.ts`).
5. An address with no module opens the landing module (Settings > General choice, else the last module used).

## 8. Not authorised (kept out of every phase)

Family "This week by person"; a per-row Tasks menu; Household Finances overlap markers; a Household Services block on Today; milestone flag icons on Tasks; new derived Ledger figures and per-member counts (OD-9); Quick Add personalisation or new shortcuts; "used by" badges on Family swatches; member colours in Tasks, Calendar or Today rows; Ledger phone navigation redesign (OD-2); wording changes (OD-7); a tablet command centre.

## 9. Keeping this file complete

- Adding a page: add its row to section 2 in the same change, or `src/shell/uiCoverage.test.ts` fails.
- How the guard finds routes (and what it cannot): Ledger pages come from the registry list `LEDGER_ROUTE_PATHS`; every other module's addresses are declared in the test as an explicit list and checked against the `<Route path>` lines of the eight files that declare them. A tenth file that declares routes fails the guard. Today, Calendar and Tasks have no sub-routes. Query-string states (`?new=1`, `?add=member`) and views inside a page are not routes and are tracked in section 3.
- Final sweep (D21): every ID opened in both themes at 375 and 1440 against fictional demo data; the roll-up must read 59/59, 23/23, 31/31.
