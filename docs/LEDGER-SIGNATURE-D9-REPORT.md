# Ledger Signature D9: Family member color picker and identity system

Date: 2026-11-11. Repository `marshmond/ledger`, branch `main`.

**Status: approved for release (section 18); committed and pushed; deployment pending until the Pages run for the release commit succeeds. NOT REAL-DEVICE OR SCREEN-READER TESTED.** D10 is not started. Sections 1 to 17 describe the batch as built, before approval.

D9 is a presentation and interaction phase. It restyles the Family Add and Edit member form (eight named swatches, a preview, a "No color" choice) and adds three small reusable identity pieces that the existing Family screens now use. Nothing stored changed: the eight colors, the field, the schema, the Contact rules and the Calendar colors are as they were.

## 1. Verified D8 deployment

- Repository `C:\Users\alexm\projects\finance-app`, remote `marshmond/ledger`, branch `main`.
- `HEAD` = `origin/main` = `8e08fd98b10816af99f8ee4d4aab4bbedba1c063` (`feat(ui): redesign Ledger financial navigation`, the D8 release).
- GitHub Actions run **#94** "Deploy to GitHub Pages" for that exact SHA: **completed / success**; jobs `build` (checkout, install, `npm test`, `npm run build`, configure and upload Pages) and `deploy` all `success`.
- The Pages deployment for `8e08fd9` has state **success** (`https://marshmond.github.io/ledger/`).
- Checked through the public Actions and Deployments API because `gh` is not installed.
- D8 report and `docs/CHATGPT-HANDOFF.md` read. The handoff and the D8 report still said "uncommitted" because they were written before the commit; this batch corrects the handoff, the backlog and the tracker.
- Working tree at the start: only the three pre-existing untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`). They were not touched. No branch, repository or remote was created, no wider permission was requested, and no production data was opened.

## 2. Existing Family functionality audit (read from the source before changing anything)

- **Color storage:** `MemberFields.color?: string`, one of the eight hex values in `COLORS` (`src/modules/family/model.ts`) or absent. `validateFields` refuses anything else; `asMember` drops an unreadable value and names it in `problems` without rewriting the row; `cleanFields` and `toStored` write the key only when it has a value. A member's own color is the only place a person's color is stored.
- **Picker before D9:** radio buttons styled as pills ("None" first, then eight with a dot and the name). Native radios, name `fm-color`.
- **Add flow:** "Use an existing contact" (search, a list that shows details, members already linked disabled and marked) or "Create a new contact" (name; a same-name warning with the existing Contact's details, a "Use this one instead" button and a "different person" confirmation box). Linking never changes the Contact. `createMember` runs one transaction, refuses a Contact that is already a member (active or past) and never matches by name.
- **Edit flow:** the linked Contact is shown as fixed with its explanation; there is no way to reassign it. Role (Parent, Spouse, Child, Grandparent, Other), birthday (month, day, year), "Show this birthday on my Calendar", private note (hidden until Show, 300 characters) are edited in the same form. "This is me" is **not** part of this form (it is a button on the member page).
- **Where color showed:** a small dot beside names on the overview cards and in the household "People" rows, and a dot with the color name on the member page.
- **Calendar:** Family's layer color is `FAMILY_LAYER_COLOR` `#c4398a`; schedule bars use the event's Calendar color. Neither reads a member color.

## 3. Files changed

New:
- `src/ui/memberIdentityModel.ts`: pure; the eight semantic ids, `memberColorToken`, `memberInitials`. No hex.
- `src/ui/MemberIdentity.tsx`: `MemberMark`, `MemberDot`, `MemberChip` and their class helpers.
- `src/modules/family/memberIdentity.ts`: pure; stored hex to semantic id (`memberColorId`), the eight choices, "No color" wording, `colorUsedByAnother`, `previewName`, `memberPreview`.
- `src/modules/family/family-d9-identity.test.tsx`: 63 tests.
- `docs/LEDGER-SIGNATURE-D9-REPORT.md` (this file).

Changed:
- `src/modules/family/MemberForm.tsx`: two-column layout, preview, swatch picker, No color, reuse sentence, American spelling. The save, validation, contact-choice and safeguard code is unchanged.
- `src/modules/family/family.css`: old color-pill and dot rules removed; D9 form, preview, swatch and No color rules added.
- `src/modules/family/OverviewPage.tsx`, `HouseholdSections.tsx`, `MemberPage.tsx`: use the shared pieces.
- `src/modules/family/model.ts`: only two user-facing messages and comments (`colour` to `color`); no value, field or logic.
- `src/modules/family/dueProvider.ts`, `householdOverview.ts`: comment spelling only.
- `src/ui/components.css`: member identity rules (mark, dot, chip, `[data-mc]` selectors).
- `src/ui/tokens.css`: one token, `--swatch-check`, in the light block and both dark blocks.
- Tests edited (3): `family-a11y.test.tsx` (the color radio names), `family-model.test.ts` (message regex `colour` to `color`), `family-f4-render.test.tsx` (the decoration selector also accepts the new dot class). No assertion was removed or loosened.
- `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.

Not touched: `src/db.ts`, any migration, backup, sync, Calendar, Tasks, Contacts, Finance, `src/palette.ts`, `package.json` (no dependency added).

## 4. Stored color compatibility

| Color | Stored hex (unchanged) | Semantic id | Light token | Dark token |
|---|---|---|---|---|
| Blue | `#4a7bd0` | `blue` | `--mc-blue` `#4a7bd0` | `#7aa2ee` |
| Green | `#2f8f6b` | `green` | `#2f8f6b` | `#52c08f` |
| Orange | `#c0562f` | `orange` | `#c0562f` | `#e8946a` |
| Purple | `#8a5cc7` | `purple` | `#8a5cc7` | `#b894e8` |
| Pink | `#c4398a` | `pink` | `#c4398a` | `#ee86c0` |
| Gold | `#b8860b` | `gold` | `#b8860b` | `#e0b04a` |
| Teal | `#2a9fb0` | `teal` | `#2a9fb0` | `#5cc3d1` |
| Gray | `#6b7280` | `gray` | `#6b7280` | `#a3acbb` |

Verified against the source: values, names and order equal `COLORS` and the Calendar's `SWATCHES`. The dark variants are the D5 tokens; D9 added none and removed none. The id is the lower-case color name and is derived in `memberIdentity.ts`, so `COLORS` was not edited. No migration, no new color, no automatic assignment: a member with no color still has no color. A value that is not one of the eight, an upper-case spelling or an empty string has no id and shows as "No color" (and is still refused by `validateFields`).

## 5. Form and picker implementation

- **Layout:** the dialog is 880 px wide for this form (CSS `:has`, no change to `Modal`). From 780 px: left column = who is this / contact choice, role, birthday; right column = Display color (preview, swatches, No color, notes), private note. Below 780 px: one column in the same order. The Cancel and Save bar is sticky at the bottom of the dialog's own scroll area.
- **Preview** (inside the Display color group, as in the D3.4 design): a tinted initials tile, the name, the role and a chip with the color name, or "No color · neutral gray". It reads the form's current state only: the linked Contact when editing, the Contact picked from the list, or the exact name typed for a new Contact. With no name it shows "New member" and "?". No fuzzy matching.
- **Swatches:** eight circles, 48 px (52 px at 640 px and narrower), four columns, the color name printed under each. Selected: a ring in the main text color (`--fg`, not the accent), a check mark, a bold name. Keyboard focus: a separate 2 px accent outline set 7 px off the swatch. Each swatch's whole cell (68 x 90 px at 375 px) is the hit area.
- **Native radios:** nine real `<input type="radio" name="fm-color">` in one group (Blue to Gray, then No color), each inside its `<label>`, value = the stored hex (empty for No color). No ARIA radio roles, no `tabindex`, no key handlers; arrow keys, Space and the single tab stop are the browser's. Accessible names: "Blue" ... "Gray", "No color — neutral gray". The group sits in a `fieldset` whose legend is "Display color (optional)".
- **No color:** a separate dashed row labeled "No color — neutral gray". Choosing it keeps the existing absent value: the form leaves `color` out, `toStored` drops the key. It never writes the stored Gray swatch.
- **Reuse:** if the chosen color belongs to another **active** member, one polite live sentence appears: "This color is already used by another family member." Sharing remains allowed, there is no new query (it uses the members the form already loads), and nothing blocks saving (a test pins that `save()` never reads it). The member being edited does not count against themself; past members do not count.
- **Help text:** "A color helps tell people apart on Family screens, and its name always appears with it. Two people may share a color." and, in Edit only, "Calendars keep their own colors."
- **American English:** "Display color (optional)", "No color — neutral gray", "gray"; `validateFields` now says "Choose one of the listed colors." and the reader says "The color could not be read." Internal names, the stored field `color` and old reports were not renamed.

## 6. Identity components

All in `src/ui`, decoration only (`aria-hidden`), no module imports, no hex literal; the colors come from the `--mc-*` tokens so light, dark and every palette work.

- `MemberMark({ name, colorId, size })`: tinted tile with up to two initials (sizes `sm` 28, `md` 40, `lg` 48, `xl` 60 px; font never below 11 px).
- `MemberDot({ colorId })`: 14 px marker.
- `MemberChip({ colorId, children })`: pill with a dot and a label.
- With no `colorId` they draw a neutral gray: a dashed tile or chip, and a **solid** gray dot (the first version used a hollow dot, which looked like an empty radio button; changed after the first look at the screen).
- `memberInitials`: one word gives one letter; two or more words give first and last ("Mary Ann Smith" gives "MS"); extra spaces, hyphens, accents, symbols, emoji-only words and missing names are handled; never more than two characters.
- Used now on: the Family overview cards (mark), the household "People" rows (dot), the member page (mark beside "Profile" and a chip for the Display color row). Not used in Calendar, Tasks or Today (a test pins that no Calendar file reads them).
- The shared files do not import Family (a Family guard test forbids it), so they take a semantic id; Family converts the stored hex with `memberColorId`.

## 7. Contact safeguards (all intact, each checked in tests and in the browser)

Same-name warning with the existing Contact's details; the "different person" confirmation box is still required; "Use this one instead" links without creating anything; members already linked are disabled and marked; "Linking does not change the contact."; nothing is matched or merged by name; editing shows the linked Contact as fixed and offers no reassignment; changing a color changes that one field and nothing else (the Contact's bytes, the link and every other field were compared before and after).

## 8. Calendar color independence

`FAMILY_LAYER_COLOR` is still `#c4398a`; the Calendar swatches are unchanged; schedule bars still use the Calendar's own colors (on Charlie's member page the "Personal" calendar's blue bars sit beside an orange member color: see the screenshot). A test changes a member's color (and then clears it) and confirms every non-Family record, Contact and link is byte-identical; another pins that no Calendar file or Family schedule file reads the new helpers or `--mc-*`/`data-mc`. The browser run did the same with the demo Calendar.

## 9. Theme and contrast (computed on every palette; pinned by `family-d9-identity.test.tsx`)

Method: each palette's real values (Classic and the five presets, light and dark), the real `--mc-*` and `--swatch-check` tokens, the stylesheet's own mixes. Lowest value across the eight colors shown (which color is lowest in brackets).

| Check (needs) | Signature light | Signature dark | Classic light | Classic dark | Worst of the other four presets (light / dark) |
|---|---|---|---|---|---|
| Swatch edge on the dialog (3:1) | 4.95 (teal) | 7.77 (blue) | 4.91 | 8.96 | 4.60 / 9.01 |
| Swatch edge on a card (3:1) | 4.95 | 8.33 | 4.66 | 8.18 | 4.21 / 8.10 |
| Swatch fill alone on the dialog | 3.14 (teal) | 6.15 | 3.14 | 7.17 | 3.01 / 7.18 |
| Check mark on the swatch (3:1) | 3.14 (teal) | 7.34 | 3.14 | 7.34 | 3.14 / 7.34 |
| Mark initials on the tile (4.5:1) | 5.35 | 7.12 | 5.02 | 6.92 | 4.55 / 6.85 |
| Chip text on the preview (4.5:1) | 6.85 | 7.93 | 6.21 | 7.46 | 5.60 / 7.44 |
| Selection ring, `--fg` on the dialog (3:1) | 17.12 | 13.48 | 16.39 | 15.18 | 14.88 / 15.38 |
| Focus outline, accent on the dialog (3:1) | 5.15 | 7.48 | 5.85 | 6.60 | 5.24 / 6.94 |
| "No color" text on its fill (4.5:1) | 8.73 | 8.81 | 10.84 | 9.71 | 9.85 / 9.87 |

Findings the measurement forced (the first draft did not pass everywhere):
1. The fixed stored **Gold and Teal fills fall under 3:1 against pale cards** on Classic light and the four older light presets (lowest 2.76, Teal on the Forest card; Classic Teal 2.98); on Signature light they are 3.14. The stored values cannot change, so each swatch and dot now has a 1.5 px outline of the color pulled 28% toward the text color; that outline is 4.2:1 or better on every surface, and the fill is identity that always carries its printed name. The check mark on Teal is exactly 3.14:1 (white on `#2a9fb0`).
2. Chip text on the preview failed 4.5:1 for Teal on Forest (4.41) with the monogram's 58% mix; the chip uses a 44% mix (above table).
3. **Signature dashed No color border** uses the shared control line (3:1 or better in both modes, pinned). On the older palettes the dashed border is the quieter default line; the choice is still told by the radio button, the bold label and the solid border when selected.
4. Forced-colors (Windows high contrast) rules are written (swatch keeps its color with a text-colored edge, ring and focus map to system colors) but **not seen**.

Palettes: Signature light and dark, and Classic (light) were looked at in the browser; the other presets are covered by the computed measurements only.

## 10. Tests performed

- `npx tsc --noEmit`: clean. `npm run build`: succeeds (the existing chunk-size warning only).
- **Full suite, one run after the code settled: 4,563 tests in 247 files, all pass** (about 135 s). D9 adds 63 tests in one new file (`family-d9-identity.test.tsx`). The D8 report's 4,499 plus 63 is 4,562, one fewer than measured; that one-test difference was not investigated (D7 and D8 noted the same kind of gap).
- Earlier targeted runs: 25 files, 514 tests, all pass (Family, tokens, D6 shared, coverage guard) before the new tests; the new file alone passed after two rounds of fixes.
- **What the 63 tests cover:** eight stored colors unchanged and still the Calendar swatches; semantic ids and tokens; invalid, upper-case, empty and unknown values rejected or "No color"; No color stores no key (new member, clearing, `cleanFields`, `toStored`) and never Gray; initials (16 cases plus a never-more-than-two guard); preview name rules (linked, picked, typed, no borrowing) and preview markup (add form and edit form); native radio semantics (nine radios, one group, names, values, one checked, no ARIA radio, no key handlers); edit-form initialization from a stored record (role, birthday, year, calendar box, note, color) and no contact reassignment controls; reuse sentence (active only, never self, never blocks; live region; two members may share a color); Contact safeguards (color change touches nothing else, duplicate member refused with nothing written, same-name new Contact stays separate, safeguard text in the form); Cancel and Save wiring (Cancel is a plain button, only submit writes, drawing the form writes nothing); shared piece markup for all eight ids and none; shared files free of module imports and hex; Family screens use the shared pieces and no hand-painted dot; Calendar independence (data and source); token and dark-variant checks; contrast on all six palettes in both modes; stylesheet rules (sizes, columns, ring and focus rules, 780 px split, sticky bar, forced-colors, no literals or overrides); American spelling.
- **Limit (stated):** the project has no DOM test library and none was added, so clicking, typing and keys are **not** in the automated tests. They were checked in a real browser (section 11). The tests read the form as server-rendered markup and call the same data functions the form calls.

## 11. Browser verification and screenshot evidence

Fictional D1 demo household on `http://localhost:5231` (own address, sync off, the owner's 5173 data not involved). Evidence folder: `C:\Users\alexm\Documents\Ledger-Design-Concepts\D9-Evidence\`. The pane returns 1440-wide pictures scaled to 800 px and sometimes returns a stale picture on the first capture after a change; each state was confirmed by script (computed styles, checked radios, stored records) and a second capture.

Flows run in the browser:
1. **Add with an existing Contact:** picked an existing Contact, chose Teal, role Other, saved: stored `{color: "#2a9fb0", contactId, role: "other", status: "active"}`; Contact count unchanged (15), Contact not modified.
2. **Add through explicit new Contact:** typed a unique name, chose Teal, saved: one new Contact, member linked to it, `#2a9fb0`, "Added, with a new contact".
3. **Edit a color:** Orange to Pink saved as `#c4398a`, no other key changed, no other record changed.
4. **Display after save:** the member page chip showed the new color (or "No color"), and the overview list showed the new members with their marks.
5. **No color:** the stored key was removed (the record had no `color` key; not `#6b7280`), the member page showed "No color", the preview showed "No color · neutral gray".
6. **Cancel:** chose Pink, pressed Cancel: dialog closed and the whole database snapshot (every record and Contact) was byte-identical.
7. **Duplicate safeguards:** typing an existing Contact's name showed the warning with its details; Add was refused with the existing message and nothing was written; "Use this one instead" switched to the existing-contact list with that Contact picked and wrote nothing; the preview then showed that Contact's real name.
Afterwards the demo's Charlie record was set back to Orange. (Test side effects in the demo-only database: Dana Demo, an existing demo Contact, is now a member with Teal, and a new demo Contact and member "Casey Demo" exists. Fictional, isolated, not in the repository.)

Pictures:
- `D9-desktop-1440-signature-light-add-member-no-color-default.jpg`: Add Member, desktop, Signature light (default: No color).
- `D9-desktop-1440-signature-light-add-member-blue-selected-gray-focused.jpg`: Blue selected with the reuse sentence, and a keyboard-focused Gray swatch showing the focus outline apart from the ring.
- `D9-desktop-1440-signature-light-edit-member.jpg`: Edit Member (Orange; fixed contact; "Calendars keep their own colors.").
- `D9-desktop-1440-signature-light-edit-member-no-color-selected-BEFORE-dot-fix.jpg`: the No color state; this picture still has the hollow dot that was then replaced by a solid one (the later pictures show the final look).
- `D9-desktop-1440-signature-dark-edit-member-teal-in-use.jpg`: Signature dark, Teal selected, solid No color dot.
- `D9-mobile-375-signature-light-add-member-new-contact-teal.jpg`, `D9-mobile-375-signature-dark-add-member-gold.jpg`, `D9-mobile-375-signature-dark-add-member-top.jpg`: Add Member at 375 px, light and dark, with the sticky bar.
- `D9-mobile-320-signature-light-add-member-purple-in-use.jpg`: 320 px, no horizontal overflow.
- `D9-desktop-1440-classic-light-add-member-gold.jpg`: the Classic palette.
- `D9-desktop-1440-signature-light-family-overview.jpg`: Family overview with the marks and dots.
- `D9-desktop-1440-signature-light-member-page-orange-calendar-bars-blue.jpg` (final) and `...-teal-BEFORE-heading-fix.jpg` (an earlier picture where the "Profile" heading was pushed to the right by a stylesheet tie; fixed by one more specific selector).

Measured in the browser: no horizontal overflow at 1440, 375 and 320; dialog 880 px at desktop, 351 px at 375, 296 px at 320; swatch dot 48 px (52 px at 375 and 320); swatch cell 68 x 90 px at 375; No color row 48 px; Cancel and Save 44 px high on a phone; the action bar is `position: sticky` and sits at the dialog's bottom edge.

Keyboard (real key presses): Tab order in the Add dialog: Close, "Use an existing contact", Search contacts, the contact list (one stop), Role, Month, Day, Birth year, "Show this birthday on my Calendar", **the color group (one stop, on the checked color)**, Private note, Cancel, Add member. Arrow Right moved Teal to Gray with the focus outline visible. Escape and Cancel close (Cancel verified; Escape is the unchanged `Modal` behavior).

## 12. Coverage updates (`docs/UI-COVERAGE.md`)

- New section 1.4 recording what D9 built and what was seen (member form, color picker, identity pieces) with the marks and what was not checked.
- S-21 (shared pieces) now names the identity pieces and `src/ui/MemberIdentity.tsx`, phase D6, D9; its marks are unchanged (`L`, `D`, `1440`, `Func` `Y`; `375` and `Kbd` stay `.`: the older shared pieces were not seen at phone width, and the identity pieces' phone evidence is in 1.4).
- **No Family row changed status.** F-01, F-02, F-03, DL-09 and W-35 stay `NS`: D9 changed the member form and small markers, not those whole screens (D12 and D15 own them). The totals, the complete inventory and the acceptance rules are untouched; the intro now says D8 is committed and deployed (`8e08fd9`, run #94) and describes D9; the D8 evidence heading was corrected the same way.
- Section 8 ("not authorised") still lists "used by" badges and member colors in Tasks, Calendar or Today rows: neither was built.

## 13. Unverified items

Real phones and tablets (touch, the sticky bar with the on-screen keyboard open, safe areas); any screen reader (NVDA, VoiceOver, TalkBack): the selected-state announcement, the polite reuse sentence and the radio group name are written to the standard and checked as markup only; forced-colors mode (CSS written, not seen); Safari and Firefox (the pane is Chromium; the form relies on `:has()` and `color-mix()`, both supported by current browsers, older ones would lose the wider dialog and the tints); Signature dark at 320 px and Edit on a phone; the other presets at phone width; the Family overview and member page in dark mode; print. The unselected No color row's dashed edge on older palettes is quieter than 3:1 (finding 3).

## 14. Git status (verified at the end of this batch)

Branch `main`, `HEAD` `8e08fd9` = `origin/main`. Nothing staged, committed, pushed or deployed.
- Modified, unstaged: `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/UI-COVERAGE.md`, `src/modules/family/HouseholdSections.tsx`, `MemberForm.tsx`, `MemberPage.tsx`, `OverviewPage.tsx`, `dueProvider.ts`, `family-a11y.test.tsx`, `family-f4-render.test.tsx`, `family-model.test.ts`, `family.css`, `householdOverview.ts`, `model.ts`, `src/ui/components.css`, `src/ui/tokens.css`.
- New, untracked: `docs/LEDGER-SIGNATURE-D9-REPORT.md`, `src/modules/family/family-d9-identity.test.tsx`, `src/modules/family/memberIdentity.ts`, `src/ui/MemberIdentity.tsx`, `src/ui/memberIdentityModel.ts`, and the three pre-existing untracked files (unchanged).
- `dist/` from the build is ignored. A temporary contrast script was created and deleted; the demo dev server on port 5231 was stopped by its own process id at the end (restart with `npx vite --port 5231 --strictPort --host localhost`, as in the D1 document).

## 15. Judgment calls (please review)

1. **Semantic ids live in `src/ui` with no hex; Family converts the stored value.** A Family guard forbids other modules importing Family, so the shared pieces cannot read `COLORS`. `COLORS` and the model data were not edited; a test pins that the eight ids, the stored values and the tokens agree.
2. **"No color — neutral gray" is the ninth radio, after Gray**, in the same native group (before, "None" came first). New members still start on No color.
3. **Reuse sentence counts other active members only** and gives no names (the "used by" badges of the design stay out, as section 8 of the tracker says). A past member's color is not "in use".
4. **The swatch has a darker outline** (the color mixed 28% toward the text color) because the fixed Gold and Teal fills fall under 3:1 on pale older palettes (section 9, finding 1). The look is a thin darker edge on every swatch and dot, not a new color.
5. **Chip text mixes 44% of the color, the monogram 58%**, because the chip sits on the soft preview fill.
6. **The check-mark token is `--swatch-check`**, not `--mc-…`, because the D5 guard pins the `--mc-` prefix to the eight colors.
7. **The No color dot is solid gray**, and the mark and chip are dashed, so the chip never looks like an empty radio button.
8. **The dialog is widened to 880 px for this form with `:has()`** (plus `scroll-padding-bottom`, added in release verification), not by changing `Modal`; the Cancel and Save bar is sticky for every width.
9. **Member page:** a 48 px mark beside the "Profile" heading and a chip in the Display color row (the page title and the rest of the page are as before; the full member page is D15). **Overview cards:** a 40 px mark replaces the 14 px dot; the household "People" rows keep a dot.
10. **Role is wrapped in a card like the other groups** (visual only; same select).
11. **"Calendars keep their own colors." appears in Edit only**, as in the design; the general help line appears in both.
12. **Spelling:** two model messages ("Choose one of the listed colors.", "The color could not be read.") changed and the three tests that read them were updated; internal identifiers, the stored field name and older reports and other modules (for example the Calendar) keep their wording.
13. **Existing tests edited (3):** the color radio names in the F1 accessibility test, the message regex, and the decoration selector; each now asserts the same thing in the new markup.
14. **No DOM test library was added** (no new dependency), so interaction is verified in the browser and recorded here, not automated.
15. **Demo side effects:** two demo records were added in the isolated demo database during verification (section 11).

## 16. Not built

Calendar, Tasks or Today member colors; "used by" badges or any name list of who uses a color; color uniqueness, conflict warnings or save restrictions; a custom color or any ninth color; migration or automatic assignment; contact reassignment; "This is me" in the form; the Family overview redesign (D12) or the member page redesign (D15); task assignment, per-person matrices, tablet displays, sharing, permissions. D10 is not started.

## 17. Handoff

`docs/CHATGPT-HANDOFF.md` was updated in this batch (new top notice, current and previous phase bullets, baseline, delivered-functionality entry with the contract for later phases, roadmap line, open items, change log; D8 marked committed and deployed `8e08fd9`, run #94). `docs/BACKLOG.md` has the D9 entry on top. Unknown: real-device and screen-reader results, and whether the one-test count difference (section 10) matters.

## 18. Release verification (after owner and ChatGPT approval)

Status: **approved for release; committed and pushed together with this section; deployment is verified in CI and Pages after the push (the result is in the final hand-off message and is not recorded here, to avoid a second commit).**

- **Baseline:** repository `marshmond/ledger`, branch `main`, `HEAD` = `origin/main` = `8e08fd9` (D8; run #94 and its deployment succeeded, checked in section 1). Nothing was staged; the working tree matched section 14; the three pre-existing untracked files were preserved.
- **Scope review of the diff against HEAD:** the eight stored hex values unchanged; no change to `src/db.ts`, no migration, no `package.json` or lock-file change; the only Family model edits are two user-facing messages and comments (`colour` to `color`); Contact identity code (`data.ts`, `ContactChoice`, the safeguard text in the form) not changed; No color drops the field (not Gray); duplicate colors still allowed; Calendar files untouched; no other Family, Calendar, Tasks or financial feature added; only the isolated demo household was used.
- **Dialog sizing:** the only rule that widens a dialog is `.modal:has(.fm-form--cols)`; it matches only a dialog that contains the Family member form. Measured: the Family Edit dialog 880 px, a non-Family dialog (the "Mark as a past member?" confirmation) stays 480 px and does not match the selector; both closed with Cancel; Escape closed the Family dialog; `Modal.tsx` is unchanged (a test now pins that it holds no reference to the form or `:has`). The Family dialog stayed inside the viewport and its Cancel and Save bar stayed visible at 1440, 375 x 812, 320 x 640 and a reduced 375 x 420 height.
- **One correction made:** at 320 px a keyboard-focused swatch could end up under the sticky bar. Added `scroll-padding-bottom: 88px` to the same scoped rule (one declaration); re-measured at 320 px (three swatches, top and bottom of the scroll) and at 375 x 420 (the note box): focused controls stay clear of the bar. The CSS test was updated to match.
- **Dark mode (Signature dark, desktop, demo household):** Family overview marks, dots and the color names matched the stored values (Blue, Teal, Orange, Teal, Green, Purple for the six members; dot colors were the dark tokens, for example Orange `#e8946a`, Blue `#7aa2ee`); a member page with No color showed a neutral gray mark and chip with the text "No color" (chip text 195/205/223 on 30/43/70, about 9:1). Pictures: `D9-release-desktop-1440-signature-dark-family-overview.jpg`, `D9-release-desktop-1440-signature-dark-member-page-no-color.jpg`. (The demo record used for this was set back afterwards.)
- **Mobile Add/Edit form at 375 and 320 px:** no horizontal overflow (page or dialog); eight swatch names present; the dialog scrolls; the sticky bar at the bottom edge. The emulated short viewport is **not** a real on-screen keyboard and proves nothing about one.
- **Accessibility re-checked:** nine native radios named Blue to Gray and "No color — neutral gray"; selection (ring, check, bold name, checked radio) and focus (separate outline) distinct; No color is a different input and value from Gray; no custom radio key handler; Contact-choice controls unchanged; the reuse sentence is a live region that never reaches `save()`; the chip and mark always sit beside the name or color name.
- **Tests:** TypeScript clean, production build succeeds, focused run 27 files and 579 tests pass (Family, tokens, shared components, coverage and residue guards). The full suite was not repeated because application code did not change beyond one CSS declaration; CI runs it after the push.
- **Still unverified (not claimed):** real-phone touch and on-screen keyboard behavior; any screen reader; forced-colors mode; Safari and Firefox. The tracker is unchanged by this verification: D9 does not complete the Family Overview or member page.
