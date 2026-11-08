# Ledger stabilization ST-S3: mobile usability, accessibility, navigation and destructive-action dialogs

**Date:** 2026-11-08. **Status:** BUILT AND TESTED LOCALLY. **NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED.** Not tested on a real phone. Not tested with a screen reader. Awaiting independent review and the owner's explicit authorization.

Source: `docs/LEDGER-STABILIZATION-S0-AUDIT-2026-11-08.md` (findings `AX-01` to `AX-05`, `UX-03`, `UX-05`, `UX-06`) and the roadmap's ST-S3 section. This phase changes presentation, names, structure and interaction only. No financial figure, calculation, stored record, database table, sync format, backup format or dependency was changed.

---

## 1. Executive summary

| Finding | Result |
|---|---|
| **AX-01** unlabeled boxes | Fixed. Budget "Assigned" boxes (11 of 14 were unnamed) and Scheduled date and amount boxes (12 of 21 were unnamed) now carry a name that says the purpose and the record ("Assigned amount for Groceries", "Amount to post for Demo Internet, scheduled 2026-10-05"). Their Approve, Skip, Edit, Pause and Delete buttons and the transaction-row Edit, Delete, Clear, Unlink and checkbox are named by record too. Re-sweep of 18 screens at 375 px: **0 unnamed fields**. |
| **AX-02** small targets | Fixed on phones and touch screens only. 50 controls under 24 px (16 screens, 375 px) became **0** (18 screens, 375 px and 320 px). Desktop is untouched. Check boxes are 24 px (the WCAG 2.2 AA minimum); inline links in sentences stay small by design. |
| **AX-03** structure | Fixed. Skip link, one `main#main-content` on every screen, module bar is a named `nav`, Ledger's sidebar is a named `nav` (it was an `aside` called "Main"), one `h1` per screen, no skipped heading levels on the 18 screens, page titles and a polite spoken page name on every page change, focus placed on the page only when it was lost. |
| **AX-04** contrast | Fixed. All four S0 failures and the ones found while fixing them (warning, error and good-news words on their own tint; quiet text on tinted backgrounds; active sidebar link; the same pairs in the built-in palettes and in a custom palette built from Classic). Dark theme checked: no failures. |
| **AX-05** error announcements | Fixed where gaps were found: 10 legacy messages that were silent now announce; errors on the Scheduled, Transaction, Add account, Backup passphrase, encrypted-backup and Sync-setup forms are tied to the field they are about and take focus. |
| **UX-03** destructive dialogs | Account deletion, the backup-passphrase change, Stop syncing and clearing the Sync conflict list moved from browser pop-ups or an inline strip to the shared dialog (one small `ConfirmDialog` on the existing `Modal`). Cancel comes first and has focus. The ST-S1 dependency block, the ST-S2 transaction preview, atomic bulk delete and the Undo are unchanged. 51 native pop-ups remain (was 54); the reasons for each class are in section 10. |
| **UX-05** per-device settings | One card in Settings > General says what follows you to other devices, what stays on one device (with and without backup), and which secrets you retype. A test checks the card against the code that actually saves each choice. |

**Tests:** 3,449 in 189 files at the released baseline, **3,531 in 193 files** now (+82 tests, +4 files). `tsc` clean. Build, `git diff --check` and shifted-date runs: section 19. **Browser acceptance** on a disposable origin with invented data, with real key presses and real clicks: section 16.

---

## 2. Verified ST-S2 release gate

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (`origin` = `https://github.com/marshmond/ledger.git`) |
| Branch | `main` |
| Local HEAD vs `origin/main` after `git fetch` | both `a7ef63c7e300f7b51ec5e28c2af626277e0b1f80` |
| Commit | `feat(stabilization): ST-S2 dependency-aware transaction deletion, shared utilities, wording and search`, one commit after `5e1f182` (ST-S1) |
| Deployment | GitHub Actions "Deploy to GitHub Pages", **run #76** (id 42527646884), `completed` / `success`, `head_sha` = `a7ef63c...`, 2026-11-08 21:56:01Z to 21:57:47Z. Read from the public Actions API, because the `gh` command is not installed here |
| ST-S2 content | The commit contains `txnDeletion.test.ts` (434 lines: single, bulk, transfer, split, stale-preview and 50-transaction rollback tests), the reader tests and `hideAmounts.test.ts`. The first full run on this exact commit gave **3,449 tests in 189 files**, all passing: the released baseline |
| Working tree at start | clean (`git status` empty) |
| Unexpected commits | none (`git log 5e1f182..a7ef63c` is the single ST-S2 commit) |
| ST-S3 already started | no (no ST-S3 file in `docs/`, clean tree) |

The handoff and backlog still described ST-S2 as uncommitted. They are corrected in this batch (section 19).

---

## 3. Baseline and final test totals

| | Files | Tests |
|---|---|---|
| Released baseline (`a7ef63c`) | 189 | **3,449** |
| After ST-S3 | 193 | **3,531** |
| New | +4 | **+82** |

New files: `src/shell/stS3Accessibility.test.tsx` (29 tests), `src/shell/stS3Contrast.test.ts` (30), `src/shell/stS3Structure.test.tsx` (18), `src/lib/sync/conflictClearSafety.test.ts` (5). No existing test file was edited or weakened. (The guard "pages only get Link/NavLink... from the module router" caught my first draft of the route announcer, which imported the raw router; the announcer now receives the path as a prop from `App.tsx`, so the guard is unchanged.)

Mutation check: four fixes were switched off one at a time (Budget label, `main` id, old muted colour, Scheduled amount label); **8 tests failed**, and every fix was restored afterwards.

---

## 4. Changed-file inventory

**New (13 source files):**

| File | Purpose |
|---|---|
| `src/shell/Main.tsx` | the one `main` landmark (`id="main-content"`, `tabIndex=-1`) used by every screen |
| `src/shell/SkipAndRoute.tsx` | `SkipLink`; `RouteAnnouncer` (title, spoken page name, focus only if lost) |
| `src/shell/routeFocus.ts` | pure helpers: `focusWasLost`, `pageTitle`, `headingTitle`, `focusMain` |
| `src/shell/ConfirmDialog.tsx` | small yes/no dialog on `Modal` (Cancel first and focused; action button names the action; errors inside; no double run) |
| `src/ui/rovingKeys.ts` | arrow-key behaviour for tab and radio groups |
| `src/lib/a11yLabels.ts` | the spoken names of row controls (no figures in any of them) |
| `src/lib/a11yTestkit.ts` | test helper: parses rendered markup and computes accessible names, headings and error links |
| `src/lib/devicePrefs.ts` | the single list behind the device-settings explanation |
| `src/pages/DevicePreferencesCard.tsx` | the explanation card |
| `src/shell/stS3Accessibility.test.tsx`, `stS3Contrast.test.ts`, `stS3Structure.test.tsx`, `src/lib/sync/conflictClearSafety.test.ts` | the 82 new tests |

**Modified (62 source files; with the three documents, 65 files, 516 insertions and 237 deletions):**
- Shell and structure: `App.tsx`, `core/ModuleBar.tsx`, `shell/Shell.tsx`, `shell/SearchDialog.tsx`, `shell/BackupReminder.tsx`, the eight module shells (`today`, `calendar`, `tasks`, `projects`, `assets`, `services`, `bills`, `household` `*Module.tsx`) and `pages/SettingsPage.tsx` (all now use `Main`), `ui/components.tsx` (heading level for pages nested in Settings).
- Names and errors: `pages/BudgetPage.tsx`, `ScheduledPage.tsx`, `LedgerPage.tsx`, `TransactionsPage.tsx`, `TxnForm.tsx`, `AmountInput.tsx`, `fields.tsx`, `AccountsPage.tsx`, `InvestmentsPage.tsx`, `ImportPage.tsx`, `BackupPage.tsx`, `PlainBackupCard.tsx`, `SyncPage.tsx`.
- Dialogs: `pages/LedgerPage.tsx`, `BackupPage.tsx`, `SyncPage.tsx`, `TxnDeleteDialog.tsx` (Cancel focus only), `lib/accountDependents.ts` (adds `confirmParts`; `confirmText` returns the same words), `lib/sync/conflicts.ts` (adds `removeConflicts`; nothing existing changed).
- Keyboard: `AppearanceCard.tsx`, `PageTabs.tsx`, `CalendarPage.tsx`, `TasksPage.tsx`, `AssetsPage.tsx`, `ProjectsPage.tsx`, `ProjectWork.tsx` (arrow keys and one tab stop per group).
- Headings: card titles became real `h2` in `today/cards.tsx`, `today/CardBoundary.tsx`, `today/TodayModule.tsx`, `pages/HomePage.tsx`, `pages/GeneralSettings.tsx`, `calendar/CalendarSettings.tsx` and the `todayCards.tsx` of ledger, bills, services, assets, projects and household; `calendar/AgendaView.tsx` and `tasks/TasksPage.tsx` group headings `h3` to `h2`; `calendar/CalendarPage.tsx` (`data-page-title`).
- Colour: `styles.css`, `ui/tokens.css`, `palette.ts`, `calendar/dialogs.tsx`, and the stylesheets `assets.css`, `h3.css`, `bills.css`, `calendar.css`, `household.css`, `projects.css`, `services.css`, `tasks.css` (text tone on tinted chips).
- `pages/GeneralSettings.tsx`, `PlainBackupCard.tsx` (explanation card and a pointer to it).

Not changed: anything under `src/lib` that computes money, the Finance engines, Scheduled recurrence, import, `schedule.ts`, the four spend readers, the B3 payment-link code, B4 cancellation evidence, B5 union, `db.ts`, `backupFile.ts`, the sync engine and merge.

---

## 5. AX-01: accessible names

**Reproduced at the ST-S2 baseline (seeded invented data, 375 px):** Budget 11 of 14 fields unnamed (the "Assigned" boxes); Scheduled 12 of 21 (the per-row date and amount boxes). Every other screen had 0 unnamed fields in its default state. The browser's own accessibility tree (read through the pane's `find`) now reports `textbox "Assigned amount for Groceries"`.

**Shared component or page problem?** Both were page problems (a bare `<input>` in a table row). Two shared components were improved safely: `AmountInput` gained optional `id`, `invalid` and `describedBy` (nothing changes when they are not passed), and `MoneyField` now uses its visible label as an explicit name so an error message beside it is not folded into the name.

**Names added** (`src/lib/a11yLabels.ts`; purpose first, then the record; the date is included where the same record can appear twice; no money figure in any name):

| Control | Name |
|---|---|
| Budget Assigned box | `Assigned amount for <line>` |
| Budget fund, edit, set a target, fund payment line | `Fund the target for <line>` and similar |
| Scheduled due date box | `Posting date for <item>, scheduled <date>` |
| Scheduled due amount box | `Amount to post for <item>, scheduled <date>` |
| Scheduled Approve, Skip | `Approve <item>, scheduled <date>` |
| Scheduled recurring-item Edit, Pause or Resume, Delete | `Edit <item>` and so on |
| Transaction rows (account page and All Transactions): Edit, Delete, Clear, Unlink, row checkbox | `Delete Demo Market, 2026-11-06` |

Note: the Budget "cover $X" button's name repeats the amount that is already on screen, because Budget is outside Hide Amounts (owner decision O-4, unchanged). Every other new name is free of figures.

**Other screens audited:** text, amount, date, search, select, checkbox and textarea fields on the 18 screens in their default state all had names. Not audited: fields that only appear inside every possible dialog and form state (hundreds). The Add box, search box, account dialogs, Scheduled form and Sync setup form were opened and checked. **Blockers recorded:** none that stopped a fix. One item left alone: the inline "I need" target form on Budget is a `form` without a name (adding one would create a new landmark on every row).

**Tests (not just "an aria-label exists"):** the helper computes names the way a browser does (aria-labelledby, aria-label, `for=`, wrapping label; a placeholder is not a name) and its own test proves that. Then: every Budget box named for its line and purpose; names follow the record when the order changes; the same Scheduled item due twice gets two different names; Approve and Skip are unique and contain their visible words (WCAG 2.5.3); no figure in any name; transaction rows with the same payee on different dates differ. Mutation-checked.

---

## 6. AX-02: touch targets (measured in the browser, not inferred from icons)

Measurement: `getBoundingClientRect` of every visible link, button, field, summary and tab on **18 screens** (Today, Calendar, Tasks, Projects, Accounts, Transactions, Budget, Scheduled, Reports, Home & Assets, Services, Bills, Household finances, Ledger Sync and More, Settings General, Data & Backups and Sync). Emulated phone (touch points, mobile user agent). Light theme for the measurement, dark theme for the contrast pass.

| | Before | After |
|---|---|---|
| Controls under 24 px, 375 px, 16 screens | **50** (Settings link 46x20 on every page; text links 17 to 23 px high; check boxes 14 to 16 px; "About this page" 23 px; Today card title 23 px) | **0** on all 18 screens |
| Controls under 24 px, 320 px | not measured | **0** on all 18 screens |
| Horizontal overflow | none at 375 px | none at 375 px **and 320 px** (see the fix below) |
| Still between 24 and 44 px at 375 px | n/a | 14 links inside sentences (about 25 px with padding; allowed by WCAG 2.5.8 and padded anyway), 12 check boxes (24x24 px) and two items that measure 43.8 px |

What changed (all in one block at the end of `styles.css`, inside `@media (max-width: 640px), (pointer: coarse)`, the same test `tokens.css` already uses for `--control-h`): the module bar is 48 px high with 44 px controls; card links, alert actions and Today card titles 44 px; links in tables padded to about 25 px; links in sentences get 4 px of invisible padding above and below; summaries 44 px; tabs, radios, fold buttons and calendar chips 44 px; check boxes and radios 24 px with room around them; module-name button shrinks with an ellipsis. **Desktop and mouse-only layouts are not changed.** A tablet or laptop that reports a touch screen gets the phone rules too (as it already did for `--control-h`).

**Found and fixed while measuring at 320 px:** the module bar was wider than the screen on Bills, Services, Household finances and Calendar (layout width grew to 326 to 353 px). The long module name now shrinks. Re-measured: 320 px on all 18 screens.

**Not changed, and why:** inline links stay small (they are inside sentences); the 24 px check boxes in dense tables (a 44 px box would distort the tables; the whole label is tappable where a label wraps the box); Calendar day cells and the dense transaction table were not enlarged (grid behaviour is preserved). Real-phone usability is **not** judged: only measured.

---

## 7. AX-03: landmarks, headings, keyboard and focus

**Landmarks.** Before: no skip link; `main` without an id; the module bar was a `div`; Ledger's sidebar was an `aside` labelled "Main"; two `h1` on the Settings backup page. Now, on every one of the 18 screens: exactly one `main#main-content`; a first-Tab-stop "Skip to main content" link (visible when focused, 174x44 px; it moves focus itself and never changes the `#/` address); `nav` landmarks named "Modules and tools" (module bar), "Ledger pages" (sidebar), the existing "Sections", "Breadcrumb" and per-section names, "Settings pages".

**Module switcher.** It was `aria-haspopup="menu"` with `role="menu"` and `menuitem`, which promises arrow-key movement that did not exist. It is now an honest disclosure (button with `aria-expanded`/`aria-controls`, a list of ordinary links, Escape closes it and returns focus to the button). The button is announced as "Switch module. Current module: Bills & Subscriptions".

**Headings.** One `h1` per page. Card titles were bold text; they are now `h2` styled identically, so Today, Home and the module cards sit under the page `h1` (the old tree jumped from `h1` to `h3`). Calendar agenda days and Tasks group headings are `h2`. Pages shown inside Settings (Data & Backups, Sync) use an `h2` under the one "Settings" `h1` (`PageHeadingLevel` context in `ui/components.tsx`). Heading skips on the 18 screens: **0**. Headings inside dialogs ("What will happen") were not restructured.

**Page changes.** After a route change (not the first load): the browser-tab title becomes `<page heading> · Ledger` (Calendar says "Calendar" through `data-page-title`, not its date range); a hidden polite status says the same; if focus was lost because the control you used disappeared, focus goes to `main` without scrolling; if focus is still on a real control (the tab you just pressed) nothing moves. On first load only the title is set. A page still loading its record gets one retry.

**Tabs, radios and search.** Tab groups (Calendar views, Tasks views, Assets and Projects tabs, Project work filter, page tabs) and the palette radio groups claimed `role="tab"`/`radio` but had no arrow keys and every button in the Tab order. Now: Left/Up/Right/Down/Home/End move and choose, wrapping, and the group is one Tab stop. Native radio buttons (Finance references) were already right. Search is a proper combobox (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`) with a polite "13 results. Use the up and down arrow keys, then Enter." status.

**Real keyboard checks done in the browser:** Tab order (skip link, module switcher, Search, Add...); Shift+Tab; Enter on the skip link (focus on `MAIN`, hash unchanged); Enter and Escape on the module list (list closes, focus returns to its button); Tab through the list and Enter to change module with the keyboard only (focus lands on `main`, title and spoken page name correct); Tab trapped inside a dialog over 6 presses; Escape in four dialogs; ArrowDown in Search moves `aria-activedescendant`. Visible focus rings are the existing `:focus-visible` outline (the skip link and Cancel buttons were seen in screenshots; no per-control screenshot of all rings).

---

## 8. AX-05: error and status announcements

**Fixed (silent before):** Accounts Add account, Scheduled form and due row, Transaction form, Backup (encrypted export and restore messages, plain backup messages, auto-backup passphrase), Sync setup, Investments, Ledger reconcile result, Import result, the Backup reminder, and `AmountField`/`MoneyField`. The newer modules already used `role="alert"`.

**Tied to the right field with focus:** Scheduled form (account, name, amount, transfer account, semi-monthly days), Transaction form (amount, date, other account, account), Add account (name, balance, limit), Scheduled due-row amount, Backup passphrase boxes, Sync repository, token and passphrase. The field gets `aria-invalid` and `aria-describedby` pointing at the message, and focus moves to it; when the problem is fixed the markers go away.

**Not turned into live regions:** ordinary descriptions and hints. A background sync failure is a polite `status`, not an `alert`, because the owner did not just press anything. A test checks that every `div.error` in the app is announced.

**Real checks:** on the Scheduled form, Add recurring item with an empty form announced "Choose an account" with focus on the account list; after choosing one, the message became "Give it a name" and moved to the Name box while the account list stopped being flagged. **Not tested:** the words a real screen reader speaks.

---

## 9. AX-04: contrast

Measured two ways: (a) the browser, every visible text node on the 18 screens, composited over the real background and opacity (disabled controls excluded as WCAG allows); (b) unit tests that read the colours out of `styles.css` and compute every pair, for Classic light and dark and every built-in palette.

**Original failing combinations (S0 four, plus what the sweep found):**

| Combination | Before | After |
|---|---|---|
| "Data & Backups" active Settings tab (dark text on blue; a style clash) | **2.80** light, **2.30** dark | no coloured fill; underline marks the active tab; text 16.4 |
| Calendar check marks on 3 calendar colours (white mark) | 3.99, 3.72, 4.17 | 4.73, 5.08, 4.53 (mark colour chosen per swatch) |
| Warning words on a warning banner | 4.47 | 6.50 |
| Quiet text on a warning banner | 4.10 | 4.65 |
| Quiet text on a badge | 4.33 | 4.96 |
| Quiet text on an error banner | 4.05 | 4.63 |
| Error words on their tint | 4.44 | 6.36 |
| Good-news words on their tint | 4.24 | 6.07 |
| Active sidebar link | 4.41 | at least 4.5 (measured in the browser) |
| Built-in palettes, warning words on their tint (for example Slate and indigo) | 4.14 | at least 4.8 |
| A custom palette built from Classic's values | many (links 4.40, quiet text 4.18, banner words 3.9 to 4.2) | the starting values now match the stylesheet and pass |

**How:** four tokens moved a little (`--muted` #667085 to #5d6779, `--neg` #c92a2a to #c02424, `--pos` #1b7f3b to #187636, `--warn` #9a5b00 to #8c5200; same hues, light theme only); four new derived tokens in `tokens.css` (`--accent-text`, `--warn-text`, `--pos-text`, `--neg-text`: the palette colour pulled 22% toward the text colour) are used only where words sit on that colour's own light tint (22 rules across the stylesheets, plus banners). Because they are derived, they work with every palette, light and dark. `palette.ts`'s `CLASSIC.light` (used for the Classic preview and as the start of a custom palette) was aligned with the stylesheet.

**Browser results after the change:** Classic light 0 text failures, Classic dark 0, Slate light 0, Slate dark 0. Only the decorative `▾` chevron remains (3.5 to 4.5, a graphic that meets 3:1, state also carried by `aria-expanded`). **Exceptions and remaining issues:** disabled buttons are dimmed (exempt); a custom palette whose colours are chosen below AA still shows the existing warning in the palette editor, because the app cannot repair an owner's colour choice; a custom palette built from Classic was re-measured only by the unit tests after the final change (the browser run was before it). Status words ("pending", "reconciled", "overdue", "Off by...") are text, so no status relies on colour alone.

---

## 10. UX-03: destructive dialogs

The native pop-ups were counted by search: **54 before, 51 after** in `src` outside `src/lib` (S0 counted 57 with `quickAddDef`).

| Action | Before | Now |
|---|---|---|
| Delete a Finance account | native `confirm()` | `ConfirmDialog`: title "Delete "<name>"?", the same words as before as a headline plus a list of what else happens, Cancel first and focused, red "Delete account". The ST-S1 block still comes first (a blocked account never reaches the question); `deleteAccountWithTransactions` still re-checks inside one transaction, so a Scheduled item added after the question opened shows the block dialog and deletes nothing |
| Delete a transaction, single or bulk | ST-S2 `TxnDeleteDialog` | unchanged, except Cancel focus is now explicit (it lost to `Modal`'s own focus when React re-runs effects in development) |
| Backup restore (plain and encrypted) | `RestoreConfirm` alert-dialog panel | **unchanged**: it already shows the file, the date, counts, "this REPLACES", the safety-copy sentence and Cancel; focus, Escape and the safety-copy and validation steps are untouched. After Cancel, focus now returns to the file chooser |
| Change the weekly-backup passphrase | native `confirm()` | `ConfirmDialog`: says old copies stay locked with the old passphrase; never shows a passphrase |
| Stop syncing on this device | native `confirm()` | `ConfirmDialog`: says data stays, GitHub copy untouched, token and passphrase forgotten here |
| Clear the Sync conflict list | inline strip "Remove all N for good?" | `ConfirmDialog`: says the versions cannot be put back and that **only the versions listed now** are removed. Confirm calls the new `removeConflicts(meta, keys)`, which removes exactly those keys in one queued step. A version a sync adds while the question is open is **kept** and the screen says so. Sync conflict history is never erased silently |

**Deferred, with reasons:** the reconciled-transaction move confirmation inside the transaction form's Save, the bulk "set category" confirmation, "delete saved filter", and about 45 others (Net worth, RSU, paycheck, loans and more). Replacing the first two needs the Save flow split into two steps, which is more than a dialog swap and would risk a data-integrity gate; the rest are low-risk edits and are not on the financial-action priority list. No broad confirmation framework was added: `ConfirmDialog` is one 60-line component.

**Tests:** structure tests (no `confirm(` left in the Ledger account page, Backup page or Sync page; the dialog is wired after the dependency block; the late-block path is kept); five store tests for `removeConflicts` (120 versions; late arrivals kept; empty and repeated calls; queueing with adds).

---

## 11. UX-05: device-local settings explained

One card in **Settings > General** ("What follows you to other devices, and what does not"), written from `src/lib/devicePrefs.ts`, plus a pointer from the backup card. Four groups:

1. **Follows you (Sync on) and is in backups:** records; the module the app opens to; Today's look-ahead, overdue length and dismissed alerts; Calendar options in Settings.
2. **This device only, but saved in a backup file:** Hide amounts; Today layout; colors and light/dark; the Tasks view; Household Services "Upcoming" window; the module used last; Finance layout and convenience choices.
3. **This device only and NOT in a backup:** Calendar layers shown, last view and agenda range.
4. **Secrets, retyped on each device:** sync token and passphrase; weekly-backup passphrase; price-lookup key.

A test proves the words match the code: every backed-up key appears exactly once, the keys said not to be backed up really are not in `PREFERENCE_KEYS`, no secret key is in the list, and the names written match the constants the code uses. **Finding for the owner (not changed, by instruction):** Calendar layer visibility, last view and agenda range are not in backups (gap `BK-03`); adding them is a one-line owner decision. ST-S1's three preferences remain backed up. No preference sync was added, nothing was moved into backups, no secret was touched.

---

## 12. Shared component changes (consumers checked)

| Component | Change | Consumers and how they were checked |
|---|---|---|
| `Modal` | unchanged | all dialogs; its key tests (`modalKeys.test.ts`) untouched and green |
| `ConfirmDialog` (new) | built on `Modal` | 4 consumers (account delete, passphrase, stop sync, clear conflicts); exercised in the browser |
| `TxnDeleteDialog` | Cancel focus made explicit | single and bulk delete; browser-checked |
| `PageHeader` | `h1`, or `h2` inside Settings | all pages; heading tests and the 18-screen sweep |
| `AmountInput` | optional id, invalid, describedBy | Transaction form, quick forms; no change when not passed |
| `MoneyField` | explicit name from its label, error linked | Afford, Retirement and other calculators; the name equals the visible label |
| `ModuleBar` | `nav`, disclosure | every screen; rendered in a test and used by hand in the browser |
| `Shell` | `Main`, `nav` sidebar | Ledger pages |
| Card titles | `strong` to `h2`, same style (`.card-head h2.card-title`) | 28 places in 12 files; no layout shift seen at 1280 and 375 px |
| Colour tokens | see section 9 | every screen; 30 contrast tests |

---

## 13. Financial non-mutation evidence

- **No file under `src/lib` that computes or moves money was edited.** The only `src/lib` edits are `accountDependents.ts` (the text of one confirmation split in two, same words, same checks), `sync/conflicts.ts` (one function added) and the new label, test-helper and preference-list files.
- The Budget edit was done with real typing: Groceries Assigned 600.00 to 650.00 stored **60,000 to 65,000 cents**, and Ready to Assign went **$19,060.00 to $19,010.00** (exactly minus $50.00), the same path as before.
- Scheduled recurrence, approval, posting and `postInstance` were not touched; the Scheduled change is names, error wiring and focus.
- Everything in the whole suite that tests Finance, Budget, Scheduled integrity, B1 to B5, Services, Home & Assets, Projects, Calendar, Tasks, Hide Amounts and backup/restore passes unchanged (3,449 existing tests, 0 edited).
- Database schema: unchanged (no migration). Dependencies: unchanged (`package.json` has no diff). Backup file format and sync format: unchanged.

---

## 14. Sync and backup protection

- Clearing the Sync conflict list removes only what the owner was shown (section 10); a new unit test covers the late-arrival case and a browser check did too (dialog said 6, store held 8 when confirmed, 6 removed, 2 kept, message shown).
- Cancel and Escape in that dialog left all versions in place and returned focus to "clear this list".
- "Stop syncing" does exactly what it did (`engineFor(c).forget()` then `clearConfig()`); only the question changed. Cancelled in the browser; confirmed path not run on a real repository.
- Backup restore, its safety copy and its validation were not modified. `PREFERENCE_KEYS` unchanged.
- No new network call. During the browser work with a deliberately fake sync setting (automatic sync off, invented values on a disposable origin, removed afterwards) no request to `api.github.com` was seen in the pane's request buffer (it keeps only the latest few hundred requests, so earlier ones were not visible).

---

## 15. Privacy and masking of accessible text

- With Hide Amounts **on**, an automated scan of every accessible-name source (`aria-label`, `title`, `alt`, `aria-description`, hidden `sr-only` text, targets of `aria-describedby` and `aria-labelledby`) on Today, Calendar, Bills, Services, Home & Assets and Household finances found **0 money figures**, and 0 visible figures. (With masking off, the Calendar's tooltips carry amounts, as designed; they are masked when it is on.)
- New names contain no amounts, balances or account numbers, except the Budget "cover" button on a screen outside Hide Amounts, noted above.
- The destructive dialogs name the account, not credentials; the passphrase dialog never echoes a passphrase; the Sync dialogs show no token. Error messages added show no secrets.
- Search results were not changed; the new result-count status contains only a number. Calendar export untouched.
- Hide Amounts scope is unchanged (its `help` text and the covered screens are as ST-S2 left them).

---

## 16. Browser acceptance evidence

All on a **fresh origin** (`http://localhost:5199`, a different port from the owner's usual 5173, so a separate browser storage), with invented data (three accounts, six transactions, three scheduled items, two budget amounts, one project, one throwaway account that was created and deleted). Nothing existing was cleared or reset.

| Journey | What was done | Kind of evidence |
|---|---|---|
| **A** Budget and Scheduled | Tab order from the page top; skip link; Budget boxes read from the browser's accessibility tree; edited Groceries by real typing and Enter (stored and Ready to Assign checked); Scheduled form submitted empty, then with an account only; error text, `aria-invalid`, `aria-describedby`, focus checked each time | real keys and clicks; DOM inspection |
| **B** Mobile | 375 px: opened all nine modules by real taps on the switcher (title, one `main`, no overflow, focus on `main` each time); Ledger tab bar present; Search (typed, arrow keys, Escape returned focus to the Search button); Add (focus in the dialog, 52 px round button, Escape returned focus); hitbox sweep of 18 screens; 320 px sweep; one 320 px screenshot (Bills) | real clicks and keys; DOM measurement; screenshot |
| **C** Destructive | Account with 3 linked Scheduled items: blocked dialog, Escape, focus back, counts unchanged (3 accounts, 6 transactions, 3 rules). Account without links: new dialog, Cancel focused, Tab trapped, Escape, focus back, nothing deleted. Throwaway account: keyboard-only confirm (Tab, Enter): account and its transaction gone, others intact, focus to `main`. Transaction tagged to a project: ST-S2 preview names the project, Cancel focused, Escape, focus back, count unchanged. Sync: conflict list cleared with a late arrival (above); Stop syncing cancelled | real keys and clicks; DOM and database counts; screenshots |
| **D** Contrast and themes | Sweeps on Classic light and dark, Slate light and dark; known problem pairs measured by unit test; Settings tab and calendar marks checked | DOM measurement; unit tests; screenshots |
| **E** Preferences | Hide Amounts turned on with a real click; six covered screens scanned; Settings > General card checked and screenshotted | real click; DOM scan; screenshot |
| Keyboard-only modules | Tab to the switcher, Enter, Escape (focus returns), Enter, Tab to a module, Enter | real keys |

**Not done:** physical phone or tablet; **any screen reader** (VoiceOver, TalkBack, NVDA); a second browser (only the app's Chromium-based pane); two physical devices; the real GitHub repository. **Simulated:** the phone is an emulated 375 and 320 px viewport with touch points, not a device. Dev-server note: in development React runs effects twice, which is why Cancel's focus is now set explicitly; the production build was built but not driven by hand.

---

## 17. Accessibility limitations (read before relying on this)

1. No screen reader was used. Names, roles and live regions are checked by the browser's accessibility tree, by DOM inspection and by tests. How a screen reader speaks them is unknown.
2. No real phone. Target sizes are measured, not felt.
3. Only the app's embedded browser was used. Safari and Firefox behaviour (focus after `Escape`, `color-mix`) is unverified; `color-mix()` is already used throughout the stylesheet, so nothing new is needed.
4. 18 screens in their default state were swept; dialogs and rare form states were sampled, not all enumerated.
5. Dense tables keep 24 px check boxes and about 25 px links, by design.
6. Headings inside dialogs and a few `h3` subheadings on module pages were not reviewed.
7. The 51 remaining native pop-ups are accessible in browsers but look different and cannot list consequences.
8. A palette the owner builds with low-contrast colours is shown a warning but is not corrected.
9. The skip link and the route announcer were built for hash addresses; a future move to path addresses would need review.

---

## 18. Deviations from the S0 roadmap

- Roadmap: "one `h1` per page and no skipped heading levels" on 16 screens; done on 18, but dialog interiors and some module subheadings are not part of that claim.
- Roadmap: "the account and transaction delete confirmations moved to the styled dialog". The transaction one was already done by ST-S2; the account one is done here. Three more sensitive-setting confirmations were included; the rest are deferred (section 10).
- Roadmap: "owner's phone and screen-reader smoke pass recorded". **Not done** (needs the owner's phone and a screen reader). Section 20 gives the procedure.
- Added beyond the roadmap, inside the brief: arrow keys on tabs and radios (an ARIA promise that was not kept), Search as a combobox, the module switcher as a disclosure, the 320 px overflow fix, and a palette-base alignment.
- `CLASSIC.light` in `palette.ts` was changed (an editable starting palette, not a new palette) so a custom palette starts accessible.

---

## 19. New tests and complete regression totals

| Command | Result |
|---|---|
| `npm test` (`vitest run`) | **3,531 passed, 193 files** (baseline 3,449 / 189) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (script 2.31 MB; the same chunk-size warning as before, finding `PF-01`, ST-S4) |
| `git diff --check` | no whitespace errors (Git prints line-ending notices for the working copy only) |

**Shifted clock and time zones, full suite (3,531 tests, 193 files each, all passed).** The clock was moved with a scratch setup file kept outside the repository (it subclasses `Date`); a temporary vitest config inside the repository was deleted afterwards.

| Clock | Time zone | Result |
|---|---|---|
| 2027-01-08 12:00 (inside the January window) | America/New_York | 3,531 passed |
| 2028-02-29 12:00 UTC (leap day) | UTC | 3,531 passed |
| 2026-12-31 23:50 | Pacific/Kiritimati (UTC+14) | 3,531 passed |
| 2027-01-12 03:00 UTC | Pacific/Auckland | 3,531 passed |

**Targeted suites** (all part of the full run, none edited): Finance and Budget, Scheduled integrity (`schedule`, `accountIntegrity`), ST-S1 sync conflicts (`conflictHistory`), ST-S2 transaction deletion (`txnDeletion`, `txnDeletionGuards`), Bills B1 to B5, Household Services, Home & Assets, Projects, Calendar, Tasks, Hide Amounts, backup and restore.

**The 82 new tests, by topic**
- Accessible names (helper proof; Budget; Scheduled; transaction rows; reorder; no figures in names), error links, page structure (one `main`, skip link, headings and skip detector, module bar landmark and disclosure), focus after a page change, arrow keys, the confirmation dialog: `stS3Accessibility.test.tsx` (29).
- Contrast: Classic light and dark from the stylesheet, calendar mark colours, every built-in palette, the text-tone tokens, no rule that puts a colour on its own tint without the tone, `CLASSIC` matches the stylesheet: `stS3Contrast.test.ts` (30).
- Structure and truthfulness: no raw `<main>`, every module shell uses `Main`, skip link mounted first, every `div.error` announced, the device-settings list against `PREFERENCE_KEYS` and the code's own key names, secrets not in backups, the account question's words unchanged, no native pop-up in the account, Backup and Sync pages: `stS3Structure.test.tsx` (18).
- Sync conflict clearing: `conflictClearSafety.test.ts` (5).

**Handoff, backlog, README, hooks document**

| Document | Updated? | What changed |
|---|---|---|
| `docs/CHATGPT-HANDOFF.md` | yes | the stale "ST-S2 uncommitted" wording corrected (ST-S2 is committed and deployed, `a7ef63c`, run #76); ST-S3 current snapshot, phase status, next action, risks and change-log entry added |
| `docs/BACKLOG.md` | yes | new top entry for ST-S3 with numbered judgment calls and what is not built; the ST-S2 entry's status line corrected |
| `README.md` | yes | one bullet on keyboard and phone use and the new Settings explanation (user-facing behaviour changed) |
| `docs/module-hooks.md` | no | no module hook changed |
| earlier reports (S0, roadmap, ST-S1, ST-S2) | untouched | historical evidence |

---

## 20. Known limitations and owner decisions

**Owner decisions (please answer; none blocks review):**
1. **Calendar preferences in backups (`BK-03`).** Calendar layers shown, last view and agenda range stay on the device and are not in backup files. Add them to the backed-up list? (One line in `PREFERENCE_KEYS`; restoring a backup would then also restore which calendars are visible.)
2. **Replacing more of the 51 native pop-ups.** Recommended next batch: the reconciled-transaction move (needs the Save step split in two), the bulk "set category", "delete saved filter", Net worth and RSU deletes. Or leave them.
3. **Hide Amounts on Budget and the other Ledger pages (`UX-01`, still O-4).** The Budget "cover $X" button's spoken name includes the amount that is visible on screen. If masking is ever widened to Budget, that label needs masking too.
4. **Palette editor.** A custom colour below AA still only shows the existing warning. Offer an "adjust automatically" button? (A feature; not done.)

**Owner acceptance still to do (the roadmap's gate; I could not do these):**
- **Phone pass** (audit section 14, rows 2, 3 and 12): on a real phone, open each module from the switcher, use Search and Add, tick a check box in Transactions, edit a Budget amount, approve a Scheduled item. Note anything you cannot hit comfortably.
- **Screen-reader smoke on Budget and Scheduled** (VoiceOver, TalkBack or NVDA, 15 minutes): move through the Budget "Assigned" boxes and the Scheduled rows and check that each says what it is and which record it is for; submit the Scheduled form empty and check that the message is spoken and focus lands on the box to fix.
- Hold-out items from section 17.

**Known limitations:** section 17. **Deployment:** none; pushing `main` would publish all of this, so it needs the owner's explicit authorization first.

---

## 21. Final Git status

Taken at the end of the batch (nothing staged, committed or pushed):

```
branch: main   HEAD = origin/main = a7ef63c7e300f7b51ec5e28c2af626277e0b1f80   (ST-S2, Pages run #76 success)
65 modified files (62 source files plus README, BACKLOG and the handoff; 516 insertions, 237 deletions) and 14 new files (13 source and test files plus this report)
```

The full list is in section 4. The temporary test config and the scratch clock file were removed or kept outside the repository. `dist/` and all backups remain ignored by Git. No `package.json` or `package-lock.json` change, no migration.
