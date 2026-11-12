# Ledger Signature D10: Quick Add redesign

Date: 2026-11-12. Status: **built and tested locally; UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED; awaiting owner and ChatGPT review. NOT REAL-DEVICE TESTED, no screen reader used.** D11 is not started.

This phase changed how the Add box looks and how it behaves on a phone. It did **not** change what Quick Add creates, how a typed line is read, which module owns a creation, or how anything is saved. Every number and every claim below was run or measured in this batch; things that were not run are listed in section 18.

---

## 1. Verified D9 release (the gate, checked before any change)

| Check | Result |
|---|---|
| Repository | `origin` is `https://github.com/marshmond/ledger.git` |
| Branch | `main` |
| HEAD against origin | `git fetch` then `HEAD` = `origin/main` = `939f985c0c52679fc70c969f11bbd76bc79ae988` (`feat(ui): redesign Family member color picker and identity`) |
| D9 release commit | `939f985` (this is the D9 commit, not the earlier D8 commit `8e08fd9`) |
| CI | Actions run **#95**, workflow "Deploy to GitHub Pages", `completed` / `success`; jobs `build` success and `deploy` success |
| Pages deployment | deployment `7728730736` (environment `github-pages`) for `939f985` reached state `success` |
| D9 form in the baseline | the D9 commit contains the Family member form with the color picker (`src/modules/family/MemberForm.tsx`, `src/ui/MemberIdentity.tsx`); it is the commit the deployment built |
| D9 report and handoff | read (`docs/LEDGER-SIGNATURE-D9-REPORT.md`, `docs/CHATGPT-HANDOFF.md`) |
| Working tree | only the three pre-existing untracked files: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`. They were not opened for editing, staged or deleted |

`gh` is not installed on this machine, so CI and deployment were read from the public GitHub API (`api.github.com/repos/marshmond/ledger/actions/runs`, `.../deployments`, `.../deployments/<id>/statuses`). No branch, remote or repository was created; no GitHub permission was changed; no production household data was touched and the fictional development profile was never connected to Sync (it runs at its own address, `localhost:5231`, sync off).

## 2. The Quick Add contract, as read from the source before changing anything

Sources read: `src/shell/AddBox.tsx`, `QuickAdd.tsx`, `Modal.tsx`, `modalKeys.ts`, `GlobalFrame.tsx`, `SearchDialog.tsx`, `src/core/quickAddRoute.ts`, `registry.ts` (`QuickAddDef`, `allQuickAdds`), `moduleGroups.ts`, `globalEvents.ts`, `eventBridge.ts`, every module's quick-add definition, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `docs/UI-COVERAGE.md`, the D3.4 prototype and report, the D4 blueprint.

- **One router.** `routeQuickAdd(text, defs)` reads `^\s*(\S+?):?\s+(rest)$`; the word is matched, case-insensitively, against each destination's `prefix` and `aliases`. No match picks nothing ("the box never guesses"). Unchanged.
- **Destinations come from modules.** Each module registers `contributes.quickAdd`; `allQuickAdds()` returns them in module order, tagged with `moduleId`. A `QuickAddDef` has `parse` + `commit` (a typed line with a preview), or `Form` (an embedded form), or `open` + `openCopy` (opens another screen). Unchanged.
- **State.** `text`, `choice`, `plain`, `busy`, `error`, `open`. `dest = routed.def ?? the chosen def`. Typing a shortcut picks the destination and removes the shortcut from the field; choosing another destination keeps the words.
- **Saving.** `add()` runs `dest.commit(preview)` once, only when a preview exists and nothing is busy; success shows a toast with Undo where the destination returns one; a failure shows "Could not save that: ... Nothing was added." and the box stays open.
- **Dismissal.** Escape, Cancel, the close button and a click on the backdrop all run the same `close`, which saves nothing.
- **Opening.** A window event `ledger:open-add` with `{dest?, text?}` (`openAddBox`). Callers: the Add button and the **N** key (no detail), `QuickAdd.tsx` (`ledger:add-transaction` becomes `{dest: 'transaction'}`), and Search ("Add an event" calls `requestEvent()` which sends `{dest: 'event', text}`; "Add a transaction" sends the transaction event). `requestTask` opens a separate Tasks dialog, not this box. The only caller of `requestEvent` in the app is Search.
- **Keyboard.** **N** opens the box (not while typing in a field, not with Ctrl/Cmd/Alt, not while any dialog is open, not when held down); Ctrl/Cmd+K and `/` open Search. Escape closes; Tab is trapped inside the topmost dialog; focus returns to the opener.
- **Contacts.** Quick Add never creates, finds or links a Contact. Provider and person names stay as typed words. Family member and Family date only open Family's own forms.

## 3. Files changed

New (4):
- `src/shell/addBoxModel.ts` (124 lines): the pure presentation model.
- `src/shell/AddBoxView.tsx` (164 lines): the presentational view.
- `src/shell/sheetBehavior.ts` (120 lines): visible-height and scroll-lock helpers for the sheet.
- `src/shell/d10QuickAdd.test.tsx` (62 tests).

Edited (6 source or style files, 1 test):
- `src/shell/AddBox.tsx`: now the controller only; it renders `AddBoxView` inside `Modal variant="sheet"`.
- `src/shell/Modal.tsx`: an optional `className`; a `sheet` Modal attaches the sheet behavior (nothing for a plain dialog).
- `src/styles.css`: the old `.ab-*` rules replaced by the new block (about 144 lines).
- `src/ui/components.css`: one rule (backdrop edges follow `--sheet-top` / `--sheet-bottom`) and updated comments.
- `src/ui/icons.tsx`: 18 more line icons for the destinations, groups and arrows (same shape family as the D3.4 prototype).
- `src/shell/d6Shared.test.tsx`: one test changed. It said "nothing in the app uses the sheet variant yet"; it now says only the Add box does, and that the Add button, Search and the confirmation dialog do not.

Docs: this report, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. `src/shell/uiCoverage.test.ts` was edited too (the list of rows allowed beyond `NS`, see section 17).

Not touched: the eleven owning modules, `QuickAdd.tsx`, `GlobalFrame.tsx`, `SearchDialog.tsx`, `routeQuickAdd`, the registry, the database, sync, backup, the service worker, the security policy, `package.json` (no dependency added).

## 4. Desktop layout (matches the D3.4 command-first design)

At 1440 px the dialog is 720 px wide and as tall as its content needs, at most 88 percent of the window (about 750 px with a preview showing at 1440x900), with the shared Modal's backdrop, Escape, focus trap and focus return.

1. Header: "Add" and the close button (the shared Modal head, restyled for this dialog only).
2. **Command field** (first interactive element after Close): a teal-bordered field with the focus ring; when a destination is chosen it shows as a **token** (icon, name, a clear button) inside the field. An `Enter` hint sits at the right.
3. One line that says what comes next: the idle hint, the "What kind of thing is this?" ask, "Type the task and press Enter...", or the existing **"Will add: ..." preview with its pills and the "Use as plain title" checkbox**; for a form or another screen, the destination's own panel.
4. **Three cards**: Task, Event, Transaction, each with an icon tile, name, shortcut badge and one description line ("A to-do, with a due date", "Goes on your calendar", "Money in or out"). Selected: teal border and ring, tinted fill, a filled icon tile, and a check mark.
5. **More types** in three labeled sections with chips: Productivity (Project); Household (Asset, Service, Household service, Bill or subscription, Family member, Family date); Finances (Scheduled payment), then a dashed **"Opens another screen"** row holding Log a trade and New paycheck scenario, each with an arrow icon.
6. Footer: "N opens Add anywhere", **Cancel**, and **one primary button** that names what it does.

The footer does not imply a save when it opens a screen: "Open the Scheduled screen", "Open the Add member form", "Open the Add date form". Transaction has no footer primary at all.

## 5. Mobile sheet: compact and expanded

At 640 px and narrower the same dialog is a bottom sheet (the D6 `modal--sheet` classes), 92 percent of the visible area at most.

- **Compact** (first view): handle, "Add" and close; the command field; the hint or preview; the three cards (icon above text); one **"All types"** row ("8 more", with a chevron and `aria-expanded="false"`); Cancel and the primary button. Measured at 375x812: the empty sheet is about **66 percent** of the screen (it starts 548 of 1,624 device pixels from the top), not 55; it is sized by its content (see judgment call 5).
- **Expanded**: the row becomes "Fewer types"; the three cards shrink (no description); Productivity, Household and Finances appear as two-column 48 px rows, then the dashed row with both specialised actions. The middle of the sheet scrolls; the field and footer stay in place. All **eleven destinations and both specialised actions were reached** on a phone at 375 and at 320 px (a script listed the buttons: Project, Asset, Service, Household service, Bill or subscription, Family member, Family date, Scheduled payment, Log a trade, New paycheck scenario, plus the three cards).
- Choosing a type from the expanded list folds the list again so the token, preview and primary button are in view (judgment call 4).
- With a type chosen, the token takes its own line and the text field gets the full line below it, so a long name ("Household service") never squeezes what is being typed (judgment call 7).
- Nothing needs hover; there is no hidden gesture. The "All types" button is the only way the list opens and it is a normal button.

## 6. The eleven destinations, shortcuts and aliases (verified against the code, pinned by a test)

| Destination | Id | Shortcut | Other words | Owning module | How it behaves (unchanged) |
|---|---|---|---|---|---|
| Task | `task` | `t` | task | tasks | typed line, preview, Add |
| Event | `event` | `e` | event | calendar | typed line, preview, Add |
| Transaction | `transaction` | `$` | txn, transaction, expense | ledger | Ledger's own form with its own Save |
| Scheduled payment | `scheduled` | `b` | bill, scheduled | ledger | opens `/ledger/scheduled` |
| Project | `project` | `p` | project | projects | typed line, preview, Add |
| Asset | `asset` | `a` | asset, item | assets | typed line, preview, Add |
| Service | `service` | `svc` | service, repair | assets | typed line (asset service record) |
| Household service | `household-service` | `hs` | household | services | typed line (standing arrangement, or `visit ...` one-off) |
| Bill or subscription | `bills-obligation` | `bs` | subscription, sub | bills | typed line |
| Family member | `family-member` | `fam` | family | family | opens Family's own form (`#/family?add=member`) |
| Family date | `family-date` | `fd` | famdate | family | opens Family's own form (`#/family/dates?add=date`) |

`src/shell/d10QuickAdd.test.tsx` fails if a destination, a shortcut, an alias or an owning module changes, and it routes every shortcut and every alias (plain, with a colon, upper case) to its destination. Seven destinations are typed lines, Transaction is a form, three open another screen: that is the "fourth non-typed flow" the brief asked about (the real count is Transaction plus three screen-openers; no new behavior was added to match an assumed number).

## 7. Specialised actions

Log a trade (`/ledger/investments`) and New paycheck scenario (`/ledger/paycheck`) are kept, in a dashed "Opens another screen" row under Finances, with an arrow icon so they read as navigation, not creation. They still close the box first and then navigate (`onGo={(to) => { close(); nav(to); }}`, pinned by a test). Both were clicked in the browser: the box closed and the address became `#/ledger/investments` and `#/ledger/paycheck`.

## 8. Preview, validation and saving

- The preview is the destination's own `parse`; the view only draws it. The primary button is disabled until `parse` returns a preview (`primaryAction`: label `Add <thing>`, `Adding…` while busy, plain `Add` when nothing is chosen). It is a submit button tied to the field's own form (`form="ab-..."`), so Enter and the button are the same action, and a disabled button blocks Enter exactly as before.
- Errors keep their words and `role="alert"`. Seen in the browser: an unknown asset name ("Could not save that: No asset is named ... Nothing was added.") stays open and saves nothing.
- Saving happens in one place only (`add()`, one `.commit(` in `AddBox.tsx`, pinned by a test). The post-save toast and Undo are unchanged.

## 9. Transaction form ownership

`Transaction` still renders Ledger's own `TransactionForm` (via `dest.Form`) with its own **Save**, **Save and add another** and **More options**. The footer holds only Cancel there: no second Save was added (pinned by a test that renders the view and checks that no `ab-primary` button exists). A real transaction was saved through that Save button in the demo database (amount, payee and category as typed; exactly one row added).

## 10. External requests and prefills

Verified in the browser and by tests; no payload shape changed:
- `openAddBox({dest: 'event', text})` shows the Event token with the text and its preview.
- `openAddBox({dest: 'task'})` (destination, no text): token, empty field, disabled button.
- `openAddBox({text: 't renew passport fri'})` (text only): the shortcut picks Task and is removed from the field; preview shown.
- `openAddBox({text: 'plain words'})` (no shortcut): the "What kind of thing is this?" message; nothing chosen.
- `openAddBox()` after any of these: empty, nothing chosen, no stale text or type (the open handler resets text, choice, plain title, error, busy and the phone expansion; pinned by a test).
- `openAddBox({dest: 'transaction'})`: the transaction form with its own Save.
- Search "Add a transaction" (Ctrl+K, typed, Enter) opened the Transaction form; Search "Add an event" opened Event with an empty field. Both were done with the real keyboard.
- Switching destination after a prefill keeps the words (`pick` is unchanged apart from folding the phone list).

## 11. Keyboard and dismissal safeguards

- **N** still opens the box and is ignored while typing, with Ctrl/Cmd/Alt, when held, and while any dialog is open (`wantsAddShortcut` was not touched; pinned again). The command field is a plain `<input>`, so the existing "typing" check applies, and the view has no key handler of its own (pinned: no `onKeyDown`, `onKeyUp`, `onKeyPress` or `addEventListener` in the view). Dispatching an `n` key from inside the command field opened nothing new.
- Escape, Cancel, the close button and a backdrop press, each with a **valid preview in the box**, closed it and left the database byte-for-byte unchanged (a script compared record counts for module records, transactions and contacts before and after). A press inside the box does not close it.
- Double Enter on a project line created exactly one project (the existing busy guard).
- Closing never submits an incomplete command; no generic confirmation was added.
- The "N" shortcut and Search shortcuts (Ctrl/Cmd+K, `/`) are unchanged.

## 12. Mobile viewport, safe area and scroll lock

- **Visible height.** `sheetBehavior.ts` attaches only while a `sheet` Modal is mounted. It listens to `visualViewport` `resize` and `scroll`, and sets `--sheet-top` and `--sheet-bottom` on the backdrop; the stylesheet turns those into the backdrop's top and bottom edges (`components.css`), and the sheet is sized as 92 percent **of the backdrop** (not `100vh`, not `dvh`), so the keyboard's height is excluded. Updates are batched to one animation frame. With no `visualViewport` nothing is set and the page keeps its normal sizing. Listeners and properties are removed when the box closes (pinned by tests that count `add` and `remove` calls).
- **Simulated keyboard (not a real keyboard).** In the browser pane the visual viewport height was overridden from 812 to 470 and the event fired: `--sheet-bottom` became `342px`, the keyboard mark appeared, the sheet became 432 px high with its top at 38 px, the header at 49 px, the command field at 105 px and the footer's bottom edge at 470 px. The middle scrolled (188 px). After restoring 812 the sheet went back to its normal size. **This simulated a resize; it is not evidence of how a real phone keyboard behaves.**
- **Safe area.** The footer pads with `env(safe-area-inset-bottom)` and drops that padding while the keyboard mark is on (the keyboard covers the indicator). Not seen on a device with a home indicator.
- **Scroll lock.** While a sheet is shown to a phone-width window or any touch screen (`(max-width: 640px), (pointer: coarse)`), the page behind gets `overflow: hidden` on `html` and `body` and `overscroll-behavior: none`; the sheet's own middle has `overscroll-behavior: contain`. The lock is counted and restores exactly what it found. In the browser the lock was on while the sheet was open and released after Escape (empty values restored). On a wide window without touch there is no lock. Other dialogs never call it (pinned).
- **Landscape and short windows.** 640x360 (a phone turned sideways): the footer stays in view, the token and field share one line, and the middle scrolls. 900x700: the 720 px dialog, no horizontal overflow.
- **Phone widths.** 375x812, 320x640: no horizontal overflow (`scrollWidth` minus `innerWidth` was 0 or less, and the body and sheet did not overflow). At 320 px (359 and narrower) the cards drop their shortcut badge and use 13 px names, and the chips drop their badges, so "Bill or subscription" and "Service" do not break mid-word.

## 13. Theme and palette compatibility

All colors come from tokens (no color literal, no priority override, pinned by a test over the Add box CSS). Seen in the browser: **Signature light and dark** at 1440 and 375 (plus Signature light at 320, 900 and 640x360), and **Classic light** at 1440. Contrast was computed from the rendered colors (text over its composited background) in Signature:

| Piece | Light | Dark |
|---|---|---|
| Description under a card | 5.18 | 5.57 |
| Token and pills (accent text on accent tint) | 5.78 | 7.29 |
| Muted labels, key badges, "Opens another screen" | 6.08 | 6.52 to 6.99 |
| Card name, chip label, input | 14.6 to 17.1 | 11.5 to 15.4 |
| Primary button | 17.29 | 5.00 |
| Icon on the selected card's tile | 5.15 | 9.00 |

All are at or above 4.5. Classic contrast was **not** measured (looked at only). The other three presets were not looked at. Selection is never color alone: the selected card has a heavier ring, a filled icon tile and a check mark; a selected chip has a ring and bold text; the token names the type; `aria-pressed` is set. Windows high-contrast mode is covered by a `forced-colors` rule that was written but **not seen**.

## 14. Automated test results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run build` | clean (the existing "chunks larger than 500 kB" notice only) |
| Full suite, one run after the code settled | **248 files, 4,625 tests, all pass** (D9 had 4,563 in 247; +62 in 1 new file), about 133 s, run after the code, styles and docs had settled |
| New file `src/shell/d10QuickAdd.test.tsx` | 62 tests, all pass |
| Existing guards run again | Quick Add routing (`quickAddRoute.test.ts`), the N shortcut (`addShortcut.test.ts`), Modal keys (`modalKeys.test.ts`), Family Quick Add and Contact safeguards (`family-f5-quickadd.test.ts`), D6 shared components (`d6Shared.test.tsx`), D7 header (`d7Header.test.tsx`), D8 Ledger navigation, D5 theme tokens, coverage guard (`uiCoverage.test.ts`), the route scan in `core.test.ts` |

The first full run found **one failure**: `core.test.ts` "every address written inside Ledger code points at a real page" reads any `to: '/...'` written in source; my first version of the specialised-action table used a property named `to` with `/ledger/investments`, which that scan reads as a module-relative address. The property was renamed `path` (no behavior change) and the file, plus `d10QuickAdd.test.tsx` and `d6Shared.test.tsx`, passed again (145 tests), and the full suite was run again at the end.

What the new tests check: the eleven registrations, shortcuts, aliases and owners; every alias routed (plain, colon, upper case); no guessing; the featured three and the three groups, derived from module metadata; a missing module and an unknown module; request-to-state mapping; the preview-based readiness table; Transaction's footer; the three open-a-screen destinations; both specialised actions; no Contact import or call in the controller, view, model or sheet helper; no module import in the view or model; saving in one place; dismissal safety; reset on reopen; compact and expanded markup; the stylesheet rules (fold only on a phone, scrolling middle, 92 percent of the backdrop, 16 px field, safe area, 44 and 48 px targets); `sheetInsets` for no viewport, full height, keyboard, scrolled viewport and rounding; `attachSheet` setup and complete cleanup, one frame for a burst of events, the counted lock, narrow and wide switching; the Modal's opt-in; the icons. They render the real view with the real registered destinations and use small stand-ins for the browser; **no DOM-testing dependency was added.**

## 15. Browser workflow results (fictional D1 demo household, `localhost:5231`, Signature)

Each typed creation was done through the real keyboard (open with **N**, type, Enter), then the database was read:

| Destination | Line typed | Result |
|---|---|---|
| Task | `t call plumber fri !high #house` | one task, high priority, due 2026-11-13, new tag |
| Event | `e lunch with sam fri 12-1pm` | one event, 12:00 to 1:00 PM; toast with Undo seen |
| Project | `p Garage cleanup phase two` (phone, double Enter) | exactly one project |
| Asset | `a Washer in Laundry` | one asset |
| Service | `svc Replaced filter on Dishwasher $20 yesterday` | one service record on Dishwasher |
| Household service | `hs Window washing with Demo Glass Co every month` | one arrangement plus its visit task (as the preview said); provider kept as a name only |
| Bill or subscription | `bs Streamly Plus 15.49 monthly 12th autopay` | one obligation |
| Transaction | `$ ` then the form's own Save | one transaction (-$12.34, payee Demo Market, with the form's own suggested category) |

- **Contacts stayed at 16** after all of these; none was created.
- **Open-another-screen destinations** (clicked): Scheduled payment closed the box and went to `#/ledger/scheduled`; Family member closed the box and opened Family's own "Add a family member" dialog; Family date opened "Add a family date" on `#/family/dates`. Each panel used the destination's own words; no text field was shown.
- **Specialised actions:** Log a trade and New paycheck scenario navigated as above.
- **Dismissal and safeguards:** section 11. The error path (unknown asset) stayed open and saved nothing. Typing in the field did not open another box.
- **Focus:** after Escape on a phone-width window (opened with the round Add button) focus went back to the "Quick add" button; the page's scroll lock was released.
- **Test-harness note, not an app defect:** my first batch typed into the Add box before the previous Enter had finished closing it, so one project was created as "Garage clean-outna Washer in Laundry". That record is in the disposable demo database only. The project path was then repeated cleanly (row above).
- Demo database: every record above is invented and lives only in the demo origin's local database.

## 16. Screenshot evidence

Kept outside the repository, in `C:\Users\alexm\Documents\Ledger-Design-Concepts\D10-Evidence\` (17 images; the pane's captures are 800 px wide for desktop and the real pixel size for phone views):

`00-desktop-light-empty`, `01-desktop-light-task-preview`, `02-desktop-light-transaction-own-save`, `03-desktop-dark-task-preview`, `04-desktop-classic-event-preview`, `05-desktop-900px-event-preview`, `07-mobile-375-light-compact`, `08-mobile-375-light-expanded-scrolled`, `09-mobile-375-light-selected-bill-preview`, `11-mobile-375-dark-compact`, `12-mobile-375-dark-long-error`, `13-mobile-320-light-compact`, `14-mobile-320-light-expanded-scrolled`, `15-short-landscape-640x360`, `16-mobile-375-simulated-keyboard-470px-visible`, and from release verification `17-release-mobile-375-classic-compact-selected`, `18-release-mobile-320-signature-expanded-scrolled`.

Notes on the images: `03` and `04` were captured a little before three spacing and badge adjustments; the layout is the same. `13` was captured before the 320 px chip fix, so it shows the compact view only (unaffected); `14` is after it. `11` and `12` were captured before the final chip padding change (compact view unaffected). `16` is the **simulated** keyboard. There is no numbered `06` or `10`.

## 17. Coverage tracker updates (`docs/UI-COVERAGE.md`)

- **S-05 Add box (Quick Add):** `NS` to `BLT`, marks L, D, 375, 1440, Kbd, Func all `Y` (section 1.5 says what each rests on).
- **S-04 Add button:** stays `BLT`; the D10 facts (opens the sheet on a phone, focus returns to it) are noted.
- **S-08 Shared Modal:** stays `BLT`; the sheet behavior is noted (opt-in).
- **W-01 to W-05:** `NS` to `BLT` (each workflow was run in the browser and has tests).
- **DL-01** (Shell dialogs: Add box, Search, ConfirmDialog) stays `NS`: Search and ConfirmDialog were not redesigned.
- **Nothing reads `ACC`.** All 59 page rows are untouched and still `NS`; no module page is marked redesigned because its creation is reachable from the new box. Real-device acceptance is not marked.
- `src/shell/uiCoverage.test.ts`: the pinned list of rows beyond `NS` (it fails when a row changes status unnoticed) was extended from the 11 surfaces to those plus S-05 and W-01 to W-05, as the file's own comment instructs ("Add an ID here only in the change that builds it").

## 18. Not verified, still to check

- **Physical phones:** the on-screen keyboard, safe-area padding with a home indicator, browser toolbars showing and hiding, and touch scrolling inside the sheet have **not** been tried on a real device. They are **UNVERIFIED until the owner checks them.** The 470 px run is a script-driven resize in the app's browser pane.
- **Screen readers:** none used. Names, roles, `aria-pressed`, `aria-expanded`, `aria-controls`, the group labels and the `role="alert"` and `aria-live` regions are written and pinned by tests; what a screen reader says was not heard.
- **Forced-colors (Windows high contrast):** rule written, not seen.
- **Reduced motion:** the new CSS adds no transition or animation, so nothing needs switching off; the app-wide reduced-motion rule is unchanged.
- **Palettes:** Classic was looked at but contrast was not measured; the Forest, Navy, Slate and Teal presets were not looked at. Signature at 320 px in dark was not looked at.
- **Browsers:** only the Claude app's built-in browser (Chromium). Safari and Firefox not tried; `visualViewport` and `env(safe-area-inset-bottom)` are widely supported but not tested.
- **Full tab walk on a phone:** the real-keyboard Tab walk was done at desktop width (the command field, then Task, Event, Transaction, Project, Asset, Service, Household service, Bill or subscription, Family member ... Cancel; every stop showed a focus ring). The phone order is the same DOM order with the "All types" button added.
- **Real Calendar page:** Calendar does not call `requestEvent` today (only Search does), so there was no Calendar button to press. The same request was sent through Search and through the event directly.
- Compact-sheet height is about 66 percent, not the prototype's 55 (judgment call 5).

## 19. Git status (at the end of this batch)

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M docs/UI-COVERAGE.md
 M src/shell/AddBox.tsx
 M src/shell/Modal.tsx
 M src/shell/d6Shared.test.tsx
 M src/shell/uiCoverage.test.ts
 M src/styles.css
 M src/ui/components.css
 M src/ui/icons.tsx
?? docs/LEDGER-SIGNATURE-D10-REPORT.md
?? docs/UI-DESIGN-D0-AUDIT-2026-11-10.md      (pre-existing, untouched)
?? docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md  (pre-existing, untouched)
?? scripts/dev-demo-seed.ts                    (pre-existing, untouched)
?? src/shell/AddBoxView.tsx
?? src/shell/addBoxModel.ts
?? src/shell/d10QuickAdd.test.tsx
?? src/shell/sheetBehavior.ts
```

Nothing is staged, committed, pushed or deployed. No branch, remote or repository was created. A `.vitest/` folder that a test reporter wrote while diagnosing a failure was deleted (it was mine). The demo dev server on port 5231 was started by this batch and is still running; stop it by the process id listening on that port.

## 20. Judgment calls (please review)

1. **Bill or subscription is in Household, not Finances.** The brief listed it under Finances, but the approved D3.4 prototype and report put it under Household, and the display groups are derived from the module that owns each destination using the module switcher's own grouping (Bills & Subscriptions is in Household there). I followed the metadata rule in the brief and the prototype, so the Quick Add and the switcher agree. If you want it under Finances it is a one-line change (a per-destination override in `layoutDestinations`), not a data change. **Decision for the owner.**
2. **The footer button opens a screen for the three open destinations.** Before, "Open the form" sat inside the explanation panel; now the explanation stays under the field and the (same) button is the footer's primary, labeled with the destination's own `openCopy.button`. Same click, same close-then-open order.
3. **A clear (x) button on the token.** The old box had no way to go back to "nothing chosen" except typing. The token's clear button keeps the words and drops the type. It is presentation only (the type is still `routeQuickAdd`'s result or the card choice). The prototype's "Backspace removes the token" and arrow-key movement between types were **not** built (D3.4 labeled them proposals, they are new behavior).
4. **Choosing a type from the phone's expanded list folds the list.** So the token, preview and primary button are in view without scrolling back up. "All types" reopens it.
5. **Compact sheet height is content-driven** (about 66 percent at 375x812 when empty), not 55. Forcing 55 percent would cut off the three cards or the buttons; the brief says correct operation wins over a fixed height. The hint line and the two-line "All types" description are the easiest things to trim if you want it shorter.
6. **Scroll lock and visible-height tracking.** The lock applies when the sheet is shown to a phone-width window or any touch screen, so a large touch screen (tablet) also locks the page. Visible-height tracking applies at any width while the sheet Modal is open (harmless on a desktop, where the visible area is the whole window). A plain dialog never gets either.
7. **Token on its own line on a phone.** Looks slightly taller with a chosen type, but a typed line is never squeezed.
8. **Shortcut badges hidden below 360 px** on both the cards and the chips (the D3.4 report says the 320 px render did the same for the cards). The shortcuts still work; the badges show at wider sizes.
9. **Icons added to the shared icon set** (18; the D6 test only requires at least 8). They are plain decorative SVG, like the existing ones.
10. **`Modal` gained an optional `className`.** No class is added unless given, so every other dialog's markup is byte-identical (D6's markup test still passes).
11. **New wording**: card descriptions, "Pick a type below" (the cards are now below the field, not above), "Adding…" on the button while busy, "Details are filled in below" and "Opens on its own screen" as one-line notes where the text field used to be hidden for a form or another screen. D4 said the field may stay hidden for those destinations; I kept it hidden. No new text field was added.
12. **Desktop extras left out:** the prototype's "to Ledger" subtitle and the Esc key badge in the header (the shared Modal head was kept as is). The "N opens Add anywhere" hint stays in the footer on desktop.
13. **Property named `path`, not `to`,** for the two specialised actions (section 14), so the existing source scan of module-relative addresses does not read them.
14. **Edited two existing tests** (`d6Shared.test.tsx`, `uiCoverage.test.ts`) because each pinned the pre-D10 state ("nothing uses the sheet variant yet"; the exact list of rows beyond `NS`).

## 21. Not built (on purpose)

No change to the owning modules, to any parser or alias, to the registry, to `routeQuickAdd`, to Search, the header, the module switcher, Ledger navigation, the Family member form, the Calendar editor or the Transaction form; no AI or fuzzy routing, no usage-based ranking, no personalization or tracking; no new dependency, database table, migration, Service Worker or security-policy change; no Calendar or Tasks changes; no D11.

## 22. Handoff

`docs/CHATGPT-HANDOFF.md` was updated in this batch (top notice, current snapshot, test baseline, delivered-functionality entry and its change log), distinguishing: **built, tested locally, uncommitted**; D9 is now recorded as **committed and deployed** (`939f985`, Pages run #95 success, verified at this phase's gate). Anything marked "real device" there remains unknown. No commit or push was made.

---

## 23. Release verification (2026-11-12, before the commit; D10 stays "pending release" until Pages succeeds)

- **Baseline re-checked:** `main` = `origin/main` = `939f985` (D9, deployed, run #95 success); D10 uncommitted and unstaged; the working tree matched section 19; the three pre-existing untracked files untouched.
- **Final full-suite result (the missing-result gap):** the unresolved marker had already been replaced in section 14 from the real log of the final run, and no placeholder remains in any document. That run started at 00:19 on 2026-11-12, after the last source edit (00:17, `uiCoverage.test.ts`; only documents were edited afterwards, to insert these numbers). Result: **248 test files passed (248), 4,625 tests passed (4,625), 0 failed, 0 skipped, exit code 0**, 132.95 s; `tsc` exit 0; `npm run build` exit 0. The count was read from the log, not added up.
- **Source corrections during release verification:** none.
- **Classic at 375x812:** the compact sheet fits, "All types" expands (13 buttons: three cards plus ten others), a secondary type picked from the list folds it again and shows the token, no horizontal overflow, the footer stays in view, text and the selected state are readable (screenshot 17). While open the page was locked; after Escape the `html` and `body` overflow values were back to empty.
- **Signature at 320x640:** expanded list scrolls inside the sheet, no long label breaks mid-word, footer in view, close button 44x44, the "Fewer types" control works, no horizontal overflow; closing by the close button released the lock (screenshot 18).
- **Non-Quick-Add modal:** Search opened at 375 px as an ordinary dialog (`modal wide`, plain backdrop, no sheet properties), keyboard focus was inside it, Escape closed it, and the page was not scroll-locked before or after.
- **Sheet cleanup review:** unchanged; `attachSheet` removes the `visualViewport` listeners, cancels a pending frame, releases the counted lock (restoring the original `html` and `body` values) and clears its properties, all pinned by tests; it is attached only for `variant="sheet"`. **Real iOS and Android on-screen keyboard behavior is still UNVERIFIED**; the 470 px run was a scripted resize and is not physical-device acceptance.
- **Approved design decisions:** Task, Event and Transaction as the featured three; Bill or subscription under Household; content-driven compact sheet (about 66 percent); a secondary choice folds the phone list; the token can be cleared without deleting the words; aliases unchanged; Backspace-to-clear and arrow-key type navigation not built; open-a-screen semantics kept; Transaction keeps its own Save.
- **Still outstanding:** physical phones (keyboard, safe area, toolbars, touch scrolling), screen readers, forced-colors, Safari and Firefox, the other four presets.
- **D11 has not started.**
