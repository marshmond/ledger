# Navigation N1: grouped, flat module selector (report, 2026-11-09)

**Status: BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting independent (ChatGPT) review. NOT REAL-DEVICE TESTED.**

## 1. Summary

The module dropdown now shows the eleven modules in labelled groups instead of one long list. It is still one flat list: no submenus, flyouts or accordions, and every module is one click away once the dropdown is open. Routes, module ids, names, icons, registration order and lazy loading are untouched. No data, schema, sync, backup or search code changed.

Today stands alone at the top with no heading (it is already a one-word label, and a heading above it would repeat it). The other groups carry a small uppercase label.

## 2. Release gate results

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` |
| Branch | `main` |
| Local HEAD equals `origin/main` | yes, both `eafae832d572cc3f1091f58b29abe08b7a5fa71b` (C1, `feat(contacts): C1 directory and family identity enhancements`) |
| GitHub Pages run | #84 for that exact SHA: `completed` / `success` (public Actions API; `gh` is not installed on this machine) |
| Working tree at start | clean |
| Contacts & Relationships registered as the eleventh module | yes (`registerModule(contactsModule)` is last in `src/modules/index.ts`) |
| Released baseline, re-run before any change | **3,960 tests in 223 files, all passing** |

## 3. Files changed

| File | Change |
|---|---|
| `src/core/moduleGroups.ts` (new) | `groupModules(mods)`: pure function that turns the registry's module list into ordered groups. |
| `src/core/ModuleBar.tsx` | The list is now an exported `ModuleList` component that renders the groups. The button, Escape handling, outside-click close and everything else in the bar are unchanged. |
| `src/styles.css` | Six small rules for group labels, group spacing, the Today row and the active row; links and labels wrap long text. |
| `src/core/moduleGroups.test.tsx` (new) | 12 tests (section 7). |
| `src/modules/contacts/contacts-guards.test.ts` | One C1 guard updated: it looked for the old `mods.map((m) =>` text and now looks for `groupModules(mods).map(`. Its other checks are unchanged. |
| `docs/NAVIGATION-N1-REPORT-2026-11-09.md` (new), `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md` | This report and status notes. |

## 4. Navigation architecture

I used a central mapping next to the navigation component, not a new field on `ModuleDef`.

- The mapping lists module **ids** per group in `moduleGroups.ts`. Modules are looked up in the existing registry, so nothing is duplicated and no route is written anywhere in the new code (links are still built as `/${m.id}` in `ModuleBar`).
- Why not a `ModuleDef` field: it would touch eleven module files and make the registry carry presentation detail. The mapping is one small file; moving to a field later is easy if wanted.
- **Fallback:** any module not named in the mapping appears last under an **Other** heading, in registration order, so a future module is never hidden. If a group has no registered modules it is left out (no empty headings). A module id repeated in the input appears once.
- `moduleGroups.ts` imports only a type from the registry, and imports no module screens, so lazy loading is unaffected.

## 5. Group structure

| Group | Modules, in order |
|---|---|
| (Today, no heading) | Today |
| Productivity | Calendar, Tasks, Projects |
| Household | Home & Assets, Household Services, Bills & Subscriptions, Family, Contacts & Relationships |
| Finances | Ledger, Household Finances |

Ids: `today`, `calendar`, `tasks`, `projects`, `assets`, `services`, `bills`, `family`, `contacts`, `ledger`, `household`. Names and icons are the registry's own.

## 6. Mobile behavior and accessibility

**Layout.** The existing C1 height limit (`max-height: calc(100dvh - 72px)` with a `vh` fallback, `overflow-y: auto`, `overscroll-behavior: contain`) is kept; the menu scrolls inside itself. Rows stay 44 px high on phones. Group labels are small uppercase muted text, `cursor: default`, not focusable. A thin line separates groups (not after every item).

**Accessibility (kept and checked):**
- The trigger is still a disclosure button with `aria-expanded` and `aria-controls="module-list"`. It is not an ARIA menu (no `role="menu"`, no `aria-haspopup`, no arrow-key handling), as the existing design requires.
- Each labelled group is `role="group"` with `aria-labelledby` pointing at its label. Labels are plain `div`s: not links, not buttons, not headings (so the page's heading outline is not disturbed), and not tab stops.
- The current module keeps `aria-current="page"` and gets the `active` class; the active row is now also semi-bold, so it does not rely on background shade alone.
- Escape closes the list and returns focus to the button, as before.

## 7. Tests and browser verification

**New focused tests (12, `src/core/moduleGroups.test.tsx`):** all eleven modules once with original ids; groups, names and order exactly as approved; links are `/<id>` in order and each keeps its icon; only the current module is marked; headings are group labels and not links, buttons, headings or menu items, and do not nest; an unknown module lands last under Other; no empty headings or duplicates; disclosure semantics unchanged in the source; no module screen imported and no routes in the new file; scrolling and wrapping rules present; styling uses theme tokens only, looks non-clickable, and phone rows stay 44 px.

**Limit of these tests:** there is no DOM test environment in this project (no jsdom), so keyboard behaviour and real overflow were verified in the browser below, not in unit tests. Light/dark is checked in unit tests only as "tokens, not fixed colours".

**Full checks (final run, after one line-ending repair described below):** `npm test` **3,972 tests in 224 files, all passing** (+12 tests, +1 file on the 3,960 / 223 baseline); `npx tsc --noEmit` clean; `npm run build` succeeded (run once, before the line-ending repair; the CSS and TypeScript did not change afterwards, and tsc re-ran clean); `git diff --check` clean.

**Two things that happened during checks, for honesty:**
1. One full run failed `family-f2-provider.test.ts` ("not to contain '555'"). It passed on four reruns and on the untouched baseline. The test searches serialized output for the text `555`, and time-based ids can contain it by chance, so I judge it an existing intermittent test, unrelated to navigation. I did not change it. It is worth a later fix.
2. While comparing against the baseline I used `git stash`, which rewrote five files with Windows line endings and made one existing CSS test (`stS51Ui`) fail. I converted the five files back to the repository's Unix line endings; the suite then passed in full. Git warns "LF will be replaced by CRLF" on these files; that is the machine's normal setting and also appears for other files.

**Browser acceptance** (built-in browser, local dev server on invented/disposable browser storage; no real data used; the dev server is stopped):
- Menu opens; text order is Today, PRODUCTIVITY, Calendar, Tasks, Projects, HOUSEHOLD, five modules, FINANCES, Ledger, Household Finances. `aria-expanded` true when open. Eleven links with the correct `#/<id>` addresses. Passed.
- Clicking Contacts & Relationships went to `#/contacts`, the list closed, the button named the new module, and the active row was semi-bold with `aria-current`. Passed.
- 320 x 400: menu bottom 377 px (inside the 400 px viewport), scrolls inside itself, last module reachable, page width 320 (no horizontal scroll), menu has no horizontal overflow, row height 44 px, long name "Contacts & Relationships" wraps. Passed.
- 375 x 667: page width 375, menu inside the viewport, 11 links. Passed.
- 640 x 300 (short landscape) in dark theme: menu inside the viewport, scrolls, labels and rows readable on the dark background. Passed. (Visually checked in a screenshot of the top of the list only.)
- Keyboard: focused the button, Enter opened the list, eleven presses of Tab moved focus through the eleven links in order and to the last one (group labels were skipped), focus ring visible (2 px solid), Enter on "Household Finances" navigated to `#/household`. Escape closed the list and kept focus on the button. Passed.
- Console: no errors.
- Not separately checked: desktop at a very wide window (the default pane was about 1,000 px wide and looked compact); light theme at 640 x 300; a real phone; a screen reader.

## 8. Known limitations

- The grouping lives in one mapping file; adding a module needs one line there (otherwise it appears under Other, which is the intended safe default).
- Today has no heading (a deliberate reading of "keep Today prominent"; one line to change if a "Today" heading is wanted).
- No DOM-level automated test of keyboard focus or scrolling (none exists project-wide); covered by the browser pass.
- Not tested on a real device or with a screen reader.
- The existing intermittent Family test noted above.
- The Search, Quick Add and Settings parts of the bar were not changed or redesigned.

## 9. Exact Git status

On `main`, HEAD `eafae832d572cc3f1091f58b29abe08b7a5fa71b` (= `origin/main`). Nothing staged, committed or pushed.

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M src/core/ModuleBar.tsx
 M src/modules/contacts/contacts-guards.test.ts
 M src/styles.css
?? docs/NAVIGATION-N1-REPORT-2026-11-09.md
?? src/core/moduleGroups.test.tsx
?? src/core/moduleGroups.ts
```

## 10. Recommendation for release

Ready for independent review. No data or route behaviour changed, the test suite and type check are green, and the browser checks passed at 320, 375, short-landscape, dark theme and keyboard. After review and your explicit go-ahead, commit and push; then check the Actions tab for a green run. C2 remains the next planned phase and is not started.

## 11. Final release verification (2026-11-09)

ChatGPT reviewed this report and approved N1 for final release verification. Decisions recorded: grouped, flat navigation is approved; Today is prominent without a redundant heading; modules not in the mapping fall under Other; existing navigation routes and module ids are unchanged.

**Gate.** Branch `main`; local HEAD and `origin/main` both `eafae832d572cc3f1091f58b29abe08b7a5fa71b`; C1 Pages run #84 succeeded for that commit. Only the eight files listed in section 9 were changed or added; `package.json` and the lock file are untouched (no new dependency).

**Diff review.** `git diff --numstat` shows small changes only (ModuleBar 26/6, styles 6/0, contacts guard 2/2, backlog 9/0, handoff 2/0), and `git ls-files --eol` shows every modified file as LF in both the index and the working copy: no line-ending churn from the earlier stash remains. Confirmed in the diff: every module appears once; group order is Today, Productivity, Household, Finances; ids, routes, names and icons come from the registry; unknown modules go under Other; module registration and lazy loading are unchanged; group labels are plain `div`s, not controls. Nothing in Contacts, Family, Calendar, Tasks, Projects, Finance, Search, Quick Add, backup, sync, schema or hosting was touched.

**Focused browser check** (disposable browser storage, invented data, no real data):
- Four group arrangements and all eleven links with the correct addresses: passed.
- Contacts & Relationships opened `#/contacts` by keyboard; the active row is semi-bold and carries `aria-current="page"`: passed.
- Tab from the button reached the ninth link (Contacts) after nine presses, so group labels are skipped; Enter activated it; Escape closed the list and put focus back on the button: passed.
- 320 px wide: page width 320, no horizontal overflow: passed.
- 640 x 300 (short landscape): menu fits, scrolls inside itself, last module (Household Finances) reachable: passed.
- Light and dark themes readable (dark: label grey on dark panel, link text near-white): passed (visual check on screenshots of the lower part of the list).
- Console: no errors.

**Final checks on the release candidate.** `npm test`: **3,972 tests in 224 files, all passing** (this run had no failure, including `family-f2-provider.test.ts`); `npx tsc --noEmit` clean; `npm run build` succeeded; `git diff --check` clean. The intermittent Family test was not changed.

**Corrections made:** none beyond the line-ending repair already described in section 7.

**Deferred maintenance (not done in N1):** Replace the intermittent Family F2 provider test's broad serialized-text `555` check with a targeted assertion against the intended sensitive field.

**Still outstanding (owner):** real-device and screen-reader acceptance. C2 is the next planned phase and is not started.
