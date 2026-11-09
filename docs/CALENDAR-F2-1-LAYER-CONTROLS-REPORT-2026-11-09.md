# Calendar F2.1: "Calendars & Layers" menu

**Date:** 2026-11-09. **Status:** BUILT AND TESTED LOCALLY, **UNCOMMITTED**, awaiting independent review. Nothing was staged, committed, pushed or deployed. Not tested on a real phone or with a screen reader. F3 is not started.
**All layer names, colours and data used in tests and browser checks are invented.**

## 1. Summary

The row of coloured chips, "Select all / Deselect all" buttons and the "Manage calendars" link that sat above the Calendar is replaced by **one small button, `Layers (5/8)`**, in the second toolbar row (beside the Month / Week / Work week / Agenda switcher). It opens a list of every Calendar layer with its colour and a checkbox, plus Select all, Deselect all, Manage calendars and Done.

It is a presentation change only. The menu is given the existing `useLayerVisibility` functions; **no new preference, storage key, table, sync field, dependency or visibility list was added**, and nothing about events, layers, providers, Today, Finance, Bills, Family, search or backup changed.

## 2. F2 release gate and deployed SHA

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (`origin` = `https://github.com/marshmond/ledger.git`) |
| Branch | `main` |
| Local HEAD = `origin/main` | Yes, after `git fetch`: **`1232372513beb07f3edf859cea2352c51a8b384d`** (`feat(family): F2 dates and calendar integration`) |
| F2 committed and pushed | Yes |
| Pages deployment of that exact commit | Run **#81** for `1232372`: `completed` / `success`, read from the public Actions API (`gh` is not installed here). #80 was F1 `ca8a485`, #79 was `ba4da59`. |
| Working tree before this batch | Clean |
| F2 Family layer and birthday coordination present | Yes: `FAMILY_ID` is registered (the real layer list in the browser showed "Family"), and `markerCoordination.ts` / the Family provider are unchanged by this batch |
| **Actual released test baseline** | **3,769 passing in 209 files**, run in this session at that exact commit before any change (the same figure F2's report gave) |

## 3. Files changed

| File | Change |
|---|---|
| `src/modules/calendar/LayerMenu.tsx` | **New.** The button and menu (presentation, open/close, focus). |
| `src/modules/calendar/layerMenuModel.ts` | **New.** Pure words and small decisions: button label, spoken label, count sentence, safe colour. |
| `src/modules/calendar/layerMenu.test.tsx` | **New.** 30 tests. |
| `src/modules/calendar/CalendarPage.tsx` | The old `Legend` is replaced by `<LayerMenu>` (inside the second toolbar row); the "every calendar is off" message now says "Open **Layers**". |
| `src/modules/calendar/dialogs.tsx` | The old `Legend` component and an import it alone used are removed. Everything else in the file (Manage calendars, Export, detail, day panel) is untouched. |
| `src/modules/calendar/calendar.css` | Old `.cal-legend*` rules replaced by `.cal-lm*` rules; print rule updated. `.cal-swatch` stays (the item detail dialog uses it). |
| `src/styles.css` | One selector in the existing touch-target rule: `.cal-legend-item` becomes `.cal-lm-btn`. |
| `docs/` | This report, `BACKLOG.md`, `CHATGPT-HANDOFF.md`. |

Not changed: `layerVisibility.ts`, `useCalendarData.ts` (including `useLayerVisibility`), the layer registry and seed (`data.ts`, `model.ts`), providers, `db.ts`, sync, backup, `package.json`.

## 4. UI behavior

- **Closed:** `Layers (5/8)` plus a caret. A screen reader hears "Calendars & Layers: 5 of 8 shown". The border turns to the accent colour when not every layer is on, so a filtered Calendar is noticeable. The button never grows with long layer names.
- **Open:** a labelled panel under the button with a header ("Calendars & Layers", **Select all**, **Deselect all**), a scrolling list, and a footer ("5 of 8 calendars shown.", **Manage calendars**, **Done**).
- **Stays open** while boxes are ticked, Select all / Deselect all are used, and the count updates at once. The Calendar behind it redraws; the date and view do not change (checked in the browser by reading the address after each action).
- **Closes** on: the button again, Escape (focus returns to the button), **Done** (focus returns to the button), Manage calendars (opens that dialog), a click or tap outside, or Tab moving focus out of the menu. Switching Month/Week/Agenda while it is open counts as a click outside, so it closes (judgment call 2).
- **Desktop and tablet width:** drops down under the button, 24rem wide. At 900px and narrower it is as wide as the toolbar under it, so it cannot run off the edge.
- **Phone (640px and narrower): a bottom sheet** fixed to the screen, so the whole menu is always on screen and only the list scrolls (judgment call 3).
- **Hover opening was NOT built** (judgment call 1).
- **Manage calendars** (add, rename, recolour, delete, default calendar, per-calendar export) is kept and now lives in the menu footer. Visibility checkboxes and these management actions are separate controls.
- Printing: the menu is hidden like the rest of the toolbar.

## 5. Layer registry and colour handling

- The list is exactly `data.layers` from `useCalendarData` (the same list the Legend used): the seeded built-in layers (Personal, Finance, Tasks, Projects, Home & Assets, Household Services, Bills & Subscriptions, Family), every calendar the owner created, and any layer a future module seeds. **Nothing in the menu names a layer, an id, a count or a colour.** The count comes from the list length. Order is whatever `loadLayers` returns (unchanged: alphabetical in the browser).
- The menu is written against a small `LayerMenuLayer` shape (`id`, `name`, `color`, `derived`), not against `CalendarLayer`, so it can be reused (section 10 of the brief).
- **Colour:** the dot uses the layer's own colour string, unchanged, the same value Calendar items use. If a colour is empty or not `#RRGGBB`, a neutral grey (`var(--muted)`) is used and nothing throws (tested with empty, a word, `rgb()`, a `url(...)`, `undefined`, `null`, a number). Colour is never the only signal: each row has the name as text and a real checkbox. An unchecked row's name is greyed and the dot dimmed.
- Automatic (read-only) layers show "(auto)" as before, and are announced as "automatic, read-only" to a screen reader.

## 6. Select all / Deselect all semantics

Unchanged from B3.0B, because the menu calls the same functions. In the existing two-state model:

- **Select all** returns to **"everything on"** (`[]`), including any layer registered later. This is the preferred behaviour in the brief.
- **Deselect all** is the explicit empty choice (`{"only":[]}`): the Calendar is empty and a layer registered later stays off until switched on. Zero visible is a valid state; the existing message explains it and nothing is deleted.
- **One box:** switching a layer off from "everything on" becomes an explicit chosen set; switching layers on until all are on returns to "everything on". Unknown layer ids in stored text are ignored when reading and dropped on the next write (existing behaviour); unreadable text means "everything on".
- Select all / Deselect all are never disabled (a button that disables under the pointer or the keyboard loses focus).
- Rapid clicks cannot race: each change is a functional state update applied to the latest state (existing `useLayerVisibility`), and a test replays the same clicks fast and slow to the same result.

## 7. Persistence

The one existing device-local key, `calendar-hidden-layers`, in the existing two formats (old plain array; `{"only":[...]}`). Verified in the browser: the choice survives closing and reopening the menu, moving between months, switching views, leaving the Calendar and coming back, and a full page reload (0/8 came back as 0/8). **No new key, table, format or sync field; the preference stays on this device only**, as before. The menu draws without writing (a test checks parse then serialize of untouched values is identical, and that neither new source file mentions any storage, database or network API).

## 8. Accessibility and mobile results

Checked in the built-in browser pane with an invented, disposable database (the in-app localhost browser, not the owner's data).

| Check | Result |
|---|---|
| Desktop light, 1024px | Pass: closed, open, toggling, Select all / Deselect all, count |
| Desktop dark | Pass: contrast and dimming of unchecked rows look right; colours distinguishable |
| 375px | Pass: no horizontal overflow (`scrollWidth` = 375); sheet inside the screen; rows and buttons 44px tall; list scrolls |
| 320px (640px tall) | Pass **after a fix**: first version ran below the screen; now a bottom sheet (top 12, bottom 628 of 640), no overflow, the 80-character calendar name wraps, Select all / Deselect all / Manage / Done all visible |
| Mouse / touch toggling | Pass **after a fix** (below). Several consecutive clicks on boxes and on name text keep it open |
| Keyboard | Pass: Enter opens; Tab goes Select all, Deselect all, each layer, Manage calendars, Done, then out to Export (menu closes; no trap); Space toggles and the menu stays open; Escape closes and focus is on the button |
| Outside click | Pass: closes without changing anything |
| Persistence | Pass (section 7) |
| Month, week, work week, agenda | Pass: switching every automatic layer off emptied each view, Select all restored the same items; address (view and date) unchanged each time |
| Manage calendars | Pass: closes the menu and opens the existing dialog; added two calendars from it, which then appeared in the menu |

**A real bug found by browser testing and fixed:** clicking a layer's *name text* (not the box) closed the menu without toggling, because the browser hands focus to the page's main landmark and my "focus left the menu" rule treated that as leaving. The menu body now takes focus itself (`tabIndex=-1`, no outline), and a test pins it. The unit tests alone did not catch this.

Accessibility structure (tested without a browser): the button has an accessible name with the count, `aria-expanded`, `aria-haspopup="dialog"` and `aria-controls` pointing at the open panel; the panel is a labelled dialog (non-modal, no focus trap); every checkbox has an accessible name; every button is typed `button` (cannot submit a form); no button is disabled; the count sentence is a polite live region. **Not tested:** a real screen reader, a real phone, or a real touch device (the pane emulates the size and the touch rules only).

## 9. Test totals

| Run | Result |
|---|---|
| Released baseline before the change | 3,769 passed, 209 files |
| Focused: `layerMenu.test.tsx` | 30 passed |
| Final `npm test` | **3,799 passed in 210 files** (+30 tests, +1 file) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (the usual large-chunk notice only) |
| `git diff --check` | clean (only the usual LF/CRLF notices) |

The 30 tests cover: all registered layers appear (including a calendar created in a real, fake-indexeddb database, and Family), their colours (and a recolour), the neutral fallback, per-layer and multiple toggles, Select all, Deselect all, zero visible, count text in the button and under the list, a newly registered layer, unknown and unreadable stored values, persistence (stored text read back), long names and a 60-layer list, no layers, the accessible names and states, narrow-screen and touch-target rules, no write on draw, and that the existing key and the single read/write place are unchanged. One earlier full run failed because my own code comment contained the text of a main-landmark tag, which an existing structure test rejects; the comment was reworded and the second full run was green.

**Honest limit on the tests:** this repository's test environment has no browser DOM (and adding one would be a new dependency), so the tests draw the markup, use the project's accessibility test kit, and replay clicks through the real visibility functions and stored text. They do not click the real component. Click, focus, Escape, outside-click and Tab behaviour were verified by hand in the browser (section 8), not by an automated test.

## 10. Known limitations

1. **No hover-to-open** (see judgment call 1).
2. **Layers created while a chosen set is active start off.** Existing B3.0B behaviour (a layer registered later stays off after an intentional choice). In the browser, adding two calendars from Manage while one layer was selected showed "Layers (1/10)". Select all brings them in. Worth reviewing whether a *calendar the owner just created* should switch itself on; not changed here because it is the visibility model.
3. The list is not grouped (owner calendars versus automatic ones) and keeps the registry order.
4. Not tested on a real device, with a screen reader, or with a real touch screen; no automated click-level test (section 9).
5. Reuse for the future Family Command Station (below) is design intent only.

## 11. Judgment calls (please review)

1. **Hover opening is not built.** The brief allowed prioritising click and tap if hover would need brittle event code. Hover does not exist on touch, needs a delay and flicker handling, and is not needed for keyboard. The one reliable way in is click, tap or Enter/Space. This differs from the F2.1 wording in `BACKLOG.md` ("open on hover or click"); the backlog entry is updated to say so.
2. **Switching Month/Week/Agenda with the menu open closes it** (it is a click outside). Adding special handling to keep it open would mean another focus rule for little value.
3. **On a phone the menu is a bottom sheet**, not a drop-down. The drop-down version overflowed the screen at 320px (the toolbar is tall there). A **Done** button was added because the sheet leaves almost no space to tap outside.
4. **Manage calendars moved into the menu footer** (it used to be a link in the chip row). Creating or deleting calendars is a rare action, and this keeps it one tap from the menu without another toolbar item.
5. **The old "N of M calendars shown" line is now inside the menu**, and the button shows the count; the "Every calendar is off" explanation stays visible on the page and now points to "Layers".
6. **Select all is never greyed out** when everything is already on, because it also restores "everything on, including future layers" from a stored chosen set that happens to list every current layer.
7. The checkbox is a native input (browser-drawn, accent-coloured), not the custom tick-square the chips used, for correct semantics and keyboard behaviour. The colour dot is separate.

## 12. Compatibility with the future Family Command Station

`LayerMenu` takes plain props (`layers`, `isVisible`, `onToggle`, `onSelectAll`, `onDeselectAll`, optional `onManage`), has no knowledge of Calendar storage, and the words live in a pure helper, so a later screen could pass it a different list. It is **not** a generalised filter framework, there are no family-member filters, no tablet layout, and nothing financial was exposed or moved toward a shared display. A tablet screen organised by household member would more likely want its own simpler control and its own list; that remains a separate future initiative, to be designed on its own.

## 13. Documentation

`docs/BACKLOG.md` (F2.1 entry marked built-locally, hover note) and `docs/CHATGPT-HANDOFF.md` (new top paragraph, F2.1 status, change-log line) are updated; F2 history and the Contacts & Relationships roadmap are untouched. The handoff says "built, uncommitted, not deployed, not acceptance-tested on a device".

## 14. Exact Git status

Nothing staged, committed or pushed. Branch `main`, HEAD still `1232372`.

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M src/modules/calendar/CalendarPage.tsx
 M src/modules/calendar/calendar.css
 M src/modules/calendar/dialogs.tsx
 M src/styles.css
?? docs/CALENDAR-F2-1-LAYER-CONTROLS-REPORT-2026-11-09.md
?? src/modules/calendar/LayerMenu.tsx
?? src/modules/calendar/layerMenu.test.tsx
?? src/modules/calendar/layerMenuModel.ts
```

(Line breaks in `git diff` warnings are only LF/CRLF notices.)

## 15. Recommendation for release

**Recommend approval for release after review**, with the two things worth a deliberate decision: (a) accept no hover-to-open, and (b) decide whether limitation 2 (a just-created calendar starting off while a chosen set is active) needs its own small follow-up. Suggested owner check on a real phone and with a screen reader after deployment, as with earlier phases. The release itself needs a separate authorization; none is assumed.

## 16. Final release verification (2026-11-09)

**Decision recorded:** independent review returned APPROVED FOR FINAL RELEASE VERIFICATION. Sections 1 to 15 above are the pre-release report and are kept as written (including the "uncommitted" status and git status in section 14, which are superseded by the release; the commit SHA and Pages run are read from `git log` and the Actions tab, not recorded here, so no second commit is needed).

- **Repository gate:** `main`; `HEAD` = `origin/main` = `1232372513beb07f3edf859cea2352c51a8b384d`; Pages run #81 `completed` / `success` for that exact commit; no unexpected commits; the working tree held only the reviewed F2.1 files (no change to `package.json`, `db.ts`, `layerVisibility.ts`, `useCalendarData.ts`, the layer registry, providers, sync or backup).
- **Final browser checks (disposable in-app browser, invented data), all 14 passed, no correction needed:** compact Layers control present; opens on click; a checkbox click and a name click each toggle without closing; several consecutive changes; Select all returns to "everything on" (stored `[]`); Deselect all gives a valid empty Calendar (stored `{"only":[]}`, explanatory message, 0 items drawn); choices survive a refresh (0/10 came back as 0/10); Manage calendars opens the existing dialog (menu closes, calendars of your own listed with Delete); Escape closes and focus returns to the button; a click outside closes; 320 px (dark) and 375 px (light): no horizontal overflow, bottom sheet inside the screen, all four actions visible with 44 px targets (Manage calendars is a 36 px text link); light and dark readable; month, week and agenda each respected a single layer being switched off and restored exactly.
- **Regression:** no layer id, colour source, event, recurrence, Family birthday coordination, Finance, Tasks, Projects, sync, backup, schema or dependency change (confirmed from the diff). The Family layer is in the menu. Visibility is still the original device-local `calendar-hidden-layers` key.

**Accepted decisions (unchanged):** opening by click, tap or keyboard instead of hover is accepted; on a phone the menu is a bottom sheet; Manage calendars remains available from the menu; layer visibility remains device-local.

**Still outstanding (owner):** acceptance on a real phone and with a screen reader.

**Backlog item added (NOT implemented here):** evaluate whether a newly created user calendar should become visible automatically when an explicit layer subset is active, while preserving the existing semantics for newly registered automatic module layers.
