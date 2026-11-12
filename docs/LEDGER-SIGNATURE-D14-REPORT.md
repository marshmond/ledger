# Ledger Signature D14: Projects, Home & Assets and Contacts redesign (2026-11-12)

**Status: BUILT AND TESTED LOCALLY. NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. Not tested on a real phone or with a screen reader. D15 not started.**

Everything below comes from this session's own runs. Every name, date and amount in the demo data, the tests and the pictures is invented. Screenshots are outside the repository in `C:\Users\alexm\Documents\Ledger-Design-Concepts\D14-Evidence\`.

## 1. Verified D13.1 release (the gate)

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (`origin` is `https://github.com/marshmond/ledger.git`) |
| Branch | `main` |
| `HEAD` equals `origin/main` after `git fetch` | Yes, both `11bb7e47c4fa39a18c8b47e3244b093b14275af4` |
| Actual D13.1 release commit | **`11bb7e4`** "feat(ui): refine Today dashboard to Ledger Signature design" (16 files; includes `composition.ts`, `d131MobilePreview.test.tsx` and the report). `bec7a86` was D13, as the prompt said, and was not enough on its own |
| CI for that exact commit | "Deploy to GitHub Pages", **run #100, completed, success** (2026-11-12 19:47 UTC) |
| Pages deployment of that commit | Deployment `7747927545`, sha `11bb7e4`, environment `github-pages`, **latest status `success`** (19:50:06 UTC) |
| D13.1 mobile Coming up preview and Cash outlook placement are in the baseline | Yes: `src/modules/today/composition.ts` holds `PHONE_PROMOTED` and the phone option of `composeToday`, and the commit's own report section 25 describes both |
| Working tree at the start | Only the three protected untracked files |
| Protected files | `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md` and `scripts/dev-demo-seed.ts` are untouched (I only read the seed script and imported it in a throwaway browser profile) |

How it was checked: `gh` is not installed here, so the Actions run and the deployment status were read from the public GitHub API without a login (read only). One stale thing was found and is fixed in this batch: the D13.1 files that were committed in `11bb7e4` still say "uncommitted, not deployed, D14 not started" (the handoff, backlog and tracker were written before the commit). This batch's handoff, backlog and tracker updates say it is committed and deployed.

## 2. Source and route inventory (read from the current source)

| Module | Routes (all unchanged) | Pages |
|---|---|---|
| Projects | `/projects` (index and any unknown address), `/projects/:id` | `ProjectsPage`, `ProjectPage` |
| Home & Assets | `/assets` (overview; unknown address falls back here), `/assets/list` (all assets; `?new=1` opens Add asset, `?parent=<id>` preselects a place), `/assets/:id` (deep links `?service=<id>` and `?warranty=<id>` are used by the overview) | `OverviewPage`, `AssetsPage`, `AssetPage` |
| Contacts & Relationships | `/contacts` (index and unknown address), `/contacts/c/:id` | `DirectoryPage`, `ContactPage` |

**Existing capabilities that were preserved (nothing removed):**

- *Projects.* List tabs Open, Finished, Archived and All with counts; progress chips from `progressChips`; budget shown as typed or "from lines", "No budget yet" for an unknown one. Detail: money figures (budget, planned in lines, agreed, paid, left to pay, expected total, left in budget, not planned in lines, quotes waiting), Needs attention warnings with fix buttons, Where the money goes (cost bars), Budget by line, Notes, Coming up, Milestones, Tasks (To do, Overdue, Done, All), Events, Related assets, Related household services, Commitments (agreements, change orders, splits, payments), Transactions on this project, Budget lines (add, edit, reorder, remove), Vendors and people. Lifecycle: status picker, Edit, Archive and Restore (with Undo), Delete permanently with its dependency plan. Forms: `ProjectForm`, `CommitmentForm`, `DeleteProject`. Native `confirm()` calls stay (D20). Quick Add "Project".
- *Home & Assets.* Overview (Needs attention, Upcoming maintenance, Warranties ending soon, Recent service history, Spending on assets with a period picker, orphan links). All assets: five tabs (In use, Stored, Past with a Sold, Disposed of, Replaced filter, Archived, All), find, type filter, flat list, a place tree with fold buttons, the orphan card. Asset page: lifecycle notes, Details (make, model, serial or VIN, plate and address behind a reveal, dates, price, specs, net worth entry, notes), Contacts, Documents, Inside this, Warranties, Spending, Household services link, Maintenance and service history, Related projects, linked tasks and events. Actions: Edit, Status, Replace, Archive and Restore, Delete. Forms: `AssetForm`, `AddMaintenance`, `ServiceForm`, `WarrantyForm`, `LifecycleDialog`, `DeleteAsset`. Quick Add "Asset" and "Service".
- *Contacts.* Directory: search (name, relationship, phone, email), Show filter (six filters, "No confirmed references" disabled when a module could not be checked), Sort (A to Z, recently changed), the same-name mark, the removed-but-still-in-use recovery card, empty states. Contact page: same-name warning with links, Details, Where this contact is used (named records by module), Stored mentions cross-check, Remove (guarded), Edit. Forms: `ContactForm` (duplicate-name warning with "Open this one" and an explicit different-person choice), `RemoveContact`. No Quick Add entry exists for Contacts, and none was added.
- *Data ownership* is unchanged: Projects, Assets and Contacts own their rows; Finance transactions are only read; no schema, migration, backup or sync file was touched.

## 3. Baseline workflow evidence (before)

Taken on a throwaway Chrome profile with the fictional D1 household plus invented edge cases (a completed project with an accepted agreement and a Finance payment tagged to it, a cancelled project with a 110-character name, an on-hold project, a vehicle with a current and an expired warranty, a disposed appliance with a very long name, two contacts both called "Jordan Rivera" with different relationships, and an organization with a very long name). Stored in `D14-Evidence\baseline\` (52 pictures): overviews, details, creation forms at 1440 and 375, Signature light and dark, Classic light.

Representative baseline figures (also read again after the redesign, and equal):

| Page | Figures before = after |
|---|---|
| Project "Kitchen refresh" | budget $12,000.00; planned in lines $11,500.00; agreed $4,800.00; paid $0.00; left to pay $4,800.00; expected total $4,800.00; left in budget $7,200.00; not planned in lines $500.00 |
| Project "Replace garage door opener" | budget $900.00; planned $900.00; agreed $865.00; paid $865.00 (the tagged Finance transaction); left to pay $0.00; expected $865.00; left in budget $35.00; the Needs attention line ("Opener unit is on track to cost $865.00, which is $265.00 over its $600.00 plan") |
| Home & Assets | 6 assets (5 in use), 1 needing attention, 1 upcoming maintenance, 2 warranties ending soon; Demo House has 3 assets inside; spending $883.00 |
| Contacts | 18 contacts listed (19 in the data once the test contact was added); both "Jordan Rivera" marked "Same name as 1 other contact"; Morgan Demo used in Projects (3 named records, "2 projects, 1 project commitment" stored mentions) |

## 4. Exact files changed

**Edited (16):** `src/modules/projects/ProjectsPage.tsx`, `ProjectPage.tsx`, `Financials.tsx`, `Commitments.tsx` (two status labels now use the shared chip), `ProjectWork.tsx` (one class name), `projects.css`; `src/modules/assets/OverviewPage.tsx`, `AssetsPage.tsx`, `AssetPage.tsx`, `assets.css`; `src/modules/contacts/DirectoryPage.tsx`, `ContactPage.tsx`, `references.ts` (one new pure helper, `facetList`; `facetText` returns the same text), `contacts.css`; `src/shell/uiCoverage.test.ts` (the expected built rows); `docs/UI-COVERAGE.md`.
**New (6, plus this report):** `src/modules/projects/presentation.ts`, `src/modules/assets/presentation.ts` (pure presentation helpers, no database), and four test files: `src/modules/projects/d14Projects.test.tsx`, `src/modules/assets/d14Assets.test.tsx`, `src/modules/contacts/d14Contacts.test.tsx`, `src/shell/d14Compat.test.tsx`.
**Also edited:** `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`.
No change to the database, schemas, migrations, backups, sync, Quick Add, search, navigation, theme storage, service worker or security policy. No dependency was added.

## 5. Projects overview redesign

Before: a flat list of text rows with a status pill and one amount. After: a segmented filter (the same four tabs and counts, still `role="tablist"` with arrow keys), then a responsive grid of cards ordered by status (Active, Planning, On hold on the Open tab; the original order elsewhere). Each card has the project name, a status chip (word, icon and tone), the dates, budget lines and vendors, the progress chips (Tasks 0/1, Milestones 0/2, "n overdue" in the overdue tone), and a figure strip: **Budget, Agreed, Paid so far**. Budget uses the page's old rule ("from lines" note; "No budget yet", never $0.00). Agreed and Paid come from `loadProjectSummary`, the same function the project page uses (one read per project), so they are the same numbers. The whole card opens the project at its existing address. Empty states are unchanged.

## 6. Projects detail redesign

A hero card (name, status chip, date tiles for the start and target dates with the full date in hidden text, and the actions: status picker, Edit, Archive or Restore, Delete permanently…). Under it a **money band in four labeled groups that keep the concepts apart: Plan, Committed, Spent, Outlook** (see 7). Below that two columns: the left is the money (Needs attention, Where the money goes, Budget by line, Commitments, Transactions, Budget lines); the right is the work and the people (Notes, the archived-or-completed note, Coming up, Milestones, Tasks, Events, Related assets, Related household services, Vendors). On a screen narrower than 1000 px it is one column with an "On this page" jump row (Money, Tasks and milestones, Commitments, Spending, Vendors). Page height on the same project: 3,482 px before, 2,489 px after at 1440; **on a phone it is longer: 5,355 px before, 5,846 px after** (see 21).

## 7. Projects financial integrity

- **The figures are not recomputed.** `FinancialBand` takes the Finance `ProjectSummary` and prints each value with `formatCents`; the arithmetic is in `lib/txnProject.ts`, which was not touched. A source test fails if the page or the overview does arithmetic on cents.
- **Budget, commitments and actual spending stay separate.** Plan (budget, planned in lines, not planned or lines over budget), Committed (agreed from accepted agreements; quotes waiting shown separately and worded "not counted"), Spent (paid so far), Outlook (left to pay, expected total, left in budget or over budget). A test renders the band with agreed $1,000.00 and paid $0.00 and checks they are separate figures.
- **An unknown budget is not zero:** the overview says "No budget yet"; the page's "(total of lines)" label is kept.
- **Equality:** Kitchen and the garage project show the same eight figures before and after (section 3). The scripted flow also checked that the paid figure equals the tagged Finance transaction.
- Changed in presentation only: the order of the figures (previously one row of nine). Commitment status labels are chips now; the amounts, buttons and rules are untouched.

## 8. Home & Assets overview redesign

Before: a stack of cards. After: a band of four counts (Assets with "n in use", Needs attention, Upcoming maintenance, Warranties ending soon with "next 60 days"), then two columns. Left: Needs attention, Upcoming maintenance and Recent service history, each row led by a date tile (overdue and special tones come from the module's own flags). Right: **Places and assets** (new panel) and Warranties ending soon with end-date tiles. The Spending block spans the page below. The band's numbers are the lengths of lists already on the page; nothing is calculated. "Places and assets" lists the in-use assets that have no place above them, each with how many in-use assets sit directly inside, using the asset's own `parentId` only; nothing is inferred from names or addresses (a test checks that two properties with the same name and address stay separate).

## 9. Asset detail redesign

A hero (the place trail, name, type, status and warranty chips, make and model, date tiles for "Bought" and "In use" when present, and the actions Edit, Status…, Replace…, Archive, Delete…). Lifecycle notes sit under it. The left column is the asset itself (Details, Maintenance and service history, the Household services pointer, Spending); the right column is what surrounds it (Warranties, Contacts, Documents, Inside this, Related projects, linked tasks and events). One column with an "On this page" jump row on a phone. Sensitive values still show "Hidden" until Show is pressed (checked in the browser).

## 10. Maintenance and service relationships

Preserved by construction: `AssetWork`, `AssetServicesCard`, `SpendingCard`, `WarrantyCard`, `RelatedProjects` and `LinkedWork` are the same components in the same data flow, only rearranged. Maintenance tasks, service records, Household Services arrangements and calendar projections stay separate cards with their own links. The page creates no task and no service record while rendering (a source test checks that no create call appears). Recurrence and warranty logic were not touched (`warrantyState` is used as before; its label and tone are shown in a chip).

## 11. Contacts directory redesign

Before: one text stack per contact (name link, relationship, phone, email, the same-name note, relationship words, usage), 2,623 px for 18 contacts. After: the same toolbar (Search, Show, Sort; on a phone Search is one row and Show and Sort share the next), then a card of hairline rows: a **neutral initials tile**, the name (one link whose target covers the whole row), the relationship text, a "Same name as n other contact(s)" chip, the phone and email, the stored relationship chips (Household member, Important Family contact, Service provider, Project participant) and the unchanged "Used in …" sentence. 1,644 px for 18 contacts. Empty states and the "Removed contacts that are still in use" recovery card are unchanged.

## 12. Contact page redesign

A summary card (the initials tile, the stored relationship chips and a strip of per-module counts taken from the same grouped references the page lists), then two columns: Where this contact is used and the Stored mentions cross-check on the left; Details (relationship, phone and email as `tel:` and `mailto:` links, added, last changed, the shared-contact note) and the guarded Remove card on the right. On a phone one column with **Details first**. The same-name warning stays at the top with links to the other contacts.

## 13. Identity safeguards preserved

No merge, link-by-name, archive, reassign or delete control was added; the only lifecycle action is the existing guarded Remove, which still says "This contact is in use, so it cannot be removed" for a used contact (checked in the browser). Duplicate warning: typing "Jordan Rivera" in Add contact shows "2 contacts with this name already exist", "Open this one" for each, and saving is blocked until the explicit different-person choice (checked: the contact count did not change). The two Jordan Riveras stay separate and each says so. The initials tile is neutral gray: no Family color, no `MemberMark`, no `--mc-*` token appears in any Contacts file (tests). `ContactForm.tsx` and `RemoveContact.tsx` are unchanged.

## 14. Existing Contact usage and relationships

Usage text ("Used in Family and Calendar") and the named lists are the same readers as before (`readContactUsage`, `readContactReferences`). The relationship chips come from the same stored facets (`factsFor`), in the same fixed order as before; `facetText` is now `facetList(...).join(', ')` and returns the same string (a test pins it). The per-module count strip on the page is `groupReferences(refs)` item counts, the same numbers shown next to each group heading. **Contacts C2 boundary:** no C2 feature was built or assumed; the C2 features that already exist today (named references, picker safety, guarded removal) are shown as they were, and nothing unresolved was found.

## 15. Desktop evidence

`D14-Evidence\Projects\P-D01` to `P-D11`, `Home-Assets\A-D01` to `A-D10`, `Contacts\C-D01` to `C-D10`: overview before and after, detail before and after, Signature Dark, Classic, creation or edit form, and one interaction (the blocked delete dialog, the status dialog, the duplicate-name warning; the global search results).

## 16. Mobile evidence

`P-M01` to `P-M08`, `A-M01` to `A-M09`, `C-M01` to `C-M09`: overview before and after (full pages), detail after, the form, Signature Dark, an interaction, and "actual viewport" pictures at 375 x 812 with the header and the floating Add button (`P-M06`, `A-M06`, `C-M06` and the `M07` detail pictures).

## 17. Before and after comparisons

`D14-Evidence\Comparisons\`: `D14-PROJECTS-DESIGN-REVIEW.png`, `D14-HOME-ASSETS-DESIGN-REVIEW.png`, `D14-CONTACTS-DESIGN-REVIEW.png` (desktop sheets), and the matching `...-DESKTOP.png` and `...-MOBILE.png` sheets. **No page-specific approved prototype exists for these three modules, so every sheet is labeled "BEFORE" and "AFTER"; none claims to match a prototype.**

## 18. Theme and accessibility verification

- **Looks:** Signature light and dark, Classic light and dark (overviews and details at both widths in the pictures), Slate light (in the sweep). Every variable the three stylesheets use without a fallback exists (test). The D14 styles use tokens only (no new hex color, no `!important`).
- **Sweep (scripted, headless Chrome):** 11 views x 5 widths (1440, 1024, 800, 375, 320) x 4 looks (Signature light and dark, Classic light, Slate light) = **220 cells: no horizontal overflow, exactly one h1, no skipped heading level, every control has an accessible name, no clipped text.** Long names (a 110-character project, a very long asset and organization name) wrapped.
- **Touch targets at phone widths:** the jump rows, text-style buttons, vendor links and page actions were raised to 44 px (the first sweep found 36, 32 and 31 px ones). Remaining: the Tasks check circle in the project task list is 28 px with a 46 px hit area (a shared Tasks control), and the Contacts name link is 32 px with a whole-row target.
- **Keyboard (synthetic Tab key events):** the Tab order on Projects, All assets and Contacts follows the page; every stop draws a focus indicator; on Contacts the ring surrounds the whole row (`ContactsC-D12-keyboard-focus-row.png`, `ProjectsP-D13-keyboard-focus-card.png`). The project, asset and contact detail pages were not Tab-walked. Status is never color alone (chips carry words and icons). Reduced motion: no animation was added.
- **Not tested:** real phones, screen readers, forced colors, Safari and Firefox.

## 19. Automated test results

- New tests: **80 in 4 new files** (`d14Projects.test.tsx` 26, `d14Assets.test.tsx` 24, `d14Contacts.test.tsx` 19, `d14Compat.test.tsx` 11). They test behavior (grouping, places, figures rendered by `FinancialBand`, facets, same-name counts) and source facts (sections and actions kept, no write calls, no merge or archive control, no Family colors, phone rules), not class names.
- Targeted: `src/modules/projects`, `assets`, `contacts`, `src/shell`, `src/ui` passed before the new tests (49 files, 1,091 tests); the tracker guard `uiCoverage.test.ts` was updated for the 19 newly built rows and passes (15 tests).
- **Full suite, once, after the last source edit: 269 files, 5,042 tests, all passed, 0 failed** (107 s). The previous baseline was 265 files and 4,962 tests, so +4 files and +80 tests, equal to the new tests. No existing business test was changed.
- `npx tsc --noEmit`: clean. `npm run build`: succeeds (the existing chunk-size warning remains).

## 20. Browser workflow results

Scripted with real DOM events on the fictional household (sync off, throwaway profiles): **100 checks in the main flow, 99 passed; the one failure was my own selector for a search box (the global search is a dialog), which a second script checked properly (6 of 6 passed: Kitchen, Dishwasher and Morgan are found and Enter opens a project, an asset and a contact), and Quick Add Project and Quick Add Asset each created exactly one record owned by its module.** Covered: Projects tabs and counts, card figures, every project section, create, edit, status change, archive and restore, the delete dialog (a project with a commitment is blocked with its plan; Cancel kept the project); Home & Assets sections, search, type filter, Past tab, vehicle page with current and expired warranty, plate reveal, Add asset by deep link, edit, delete confirmation; Contacts count, same-name marks, search, filter, same-name warning on the page, duplicate-name warning in the form (nothing saved without the explicit choice), create, edit, removal refused for a used contact and offered for the new unused one, the where-used link to a project; Quick Add, global search; no console error in any run. Empty states were seen on an empty profile at 1440 and 375 (`P-D12`, `P-M09`, `A-D11`, `A-D12`, `A-M10`, `C-D11`, `C-M10`); they read correctly. The scripts' result files are in `D14-Evidence\Verification`.

## 21. Remaining design deviations (candid)

1. **Phone project page is longer** than before (5,846 vs 5,355 px): the hero and band stack, and money comes before work. The jump row is the mitigation; reordering work first on a phone is an owner decision.
2. Projects overview with only three or four projects leaves most of a wide screen empty; the grid fills as projects are added.
3. Commitments and the Budget by line table keep their old inner structure (only chips changed): they are dense financial tables and were not recomposed.
4. No asset photos: the asset model has no image storage, so the identity is a date tile, a type chip and status chips.
5. The contact summary card is sparse for contacts with no relationships.
6. The old small `as-chip` class is restyled in place (used inside Maintenance, Warranty, Related projects and the Services module's asset card, which is D15's); it was not converted to the shared chip.
7. Forms and dialogs keep their old markup (D20): the Add project, Add asset and Add contact forms look as they did, in the Signature tokens.

## 22. Outstanding issues or decisions

1. Owner decision: on a phone, should the project page put Coming up and Tasks before the money tables?
2. Owner decision: should the overview show "Agreed" and "Paid so far" on every project card (built) or only Budget?
3. Not exercised: budget-line, commitment and vendor edits on the project page after the redesign (their code is untouched), the project task filter (IV-31), the asset maintenance, service and warranty dialogs.
4. Real-device and screen-reader acceptance (section 24).

## 23. Coverage tracker updates

`docs/UI-COVERAGE.md`: P-01, P-02, A-01, A-02, A-03, N-01, N-02 are `BLT` with `L`, `D`, `375`, `1440` and `Func` recorded; `Kbd` only for P-01, A-02 and N-01; IV-15 to IV-23 are `BLT` with `Func` only; W-31, W-32 and W-36 are `BLT`; DL-04 to DL-06 and IV-31 stay `NS`. Section 1.11 records the evidence. Nothing is `ACC`. The guard test list was extended by those 19 IDs.

## 24. Real-device and screen-reader limitations

No physical phone, no screen reader (NVDA, VoiceOver, TalkBack), no forced-colors mode, no Safari or Firefox. The keyboard walk used synthetic key events in headless Chrome. The owner's own phone and screen-reader pass is still to do.

## 25. Exact Git status

On `main` at `11bb7e4`, nothing staged, nothing committed. Modified (16): the 16 edited files in section 4 (including `docs/UI-COVERAGE.md`; `docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md` are modified too, so 18 in all). Untracked: the three protected files, `src/modules/projects/presentation.ts`, `src/modules/assets/presentation.ts`, the four new test files, and this report. The final `git status` is quoted in the closing message.

## Design assessments

**Projects: substantially better, with one honest regression on phones.** *Composition:* the overview moved from a list to scannable cards with the three money figures that matter; the detail page went from a nine-card stack to a hero, a four-group money band and a money column beside a work column. *Hierarchy:* money is organized by meaning (plan, committed, spent, outlook) instead of one undifferentiated row, and the hero carries the dates and actions. *Desktop balance:* good; the detail page is 28 percent shorter. *Mobile:* readable and overflow-free, but longer and money-first. *Consistency with Signature:* date tiles, chips, hairlines and tokens match Today and Calendar. *Structurally close to the old interface?* The commitments and budget tables are, deliberately (they are dense financial tables); everything around them is recomposed.

**Home & Assets: the largest improvement per screen.** The overview gained a count band, date tiles and a Places and assets panel and lost the equal-weight card stack; the asset page gained a hero with key dates and a clear split between the asset and what surrounds it; the list became a card of hairline rows with segmented tabs. Remaining weakness: no imagery (not in the data model) and the inner Maintenance and Spending cards are unchanged in structure.

**Contacts: a directory that now reads as a directory.** The row carries identity, how to reach, relationships and usage in aligned columns, in 37 percent less height, with a whole-row target and a neutral tile that cannot be mistaken for a Family color. The contact page is better organized (details first on a phone) but remains plain; that is intentional, since a CRM-style profile was explicitly out of scope.

## What is NOT built

No new metric, health score or completion percentage; no property or classification model; no image storage; no Contact merge, archive, delete or reassign; no C2 feature; no change to forms, dialogs or native confirmations (D20); no new route; no Quick Add entry for Contacts; D15 not started.

## Housekeeping from the evidence tooling (outside the repository)

The demo dev server for the fictional household that I started on port 5231 was stopped at the end of the session (restart it with the command in `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`). A mistyped path in one of my capture runs made Chrome create a throwaway profile folder at `C:\c\Users\...` (not in the repository; it can be deleted). Scratch profiles and scripts live in the session's scratchpad directory.

## 26. Release check (2026-11-12, after ChatGPT's visual approval): focused mobile checks

Baseline re-verified: `main` = `origin/main` = `11bb7e4`, run #100 success, nothing staged, 28 changed paths (18 modified, 10 untracked, three of them the protected files). The mobile checks were scripted with real pointer and key events in headless Chrome on the fictional household (375 x 812 and 320 x 640), 62 checks. **The first run found two real defects and the harness itself had four mistakes of mine (a click that landed on the floating Add button, state carried over between runs, a too-short wait for smooth scrolling, and the wrong "header" element); the corrected run passed all 62 after the two small CSS corrections below.**

1. **Segmented tabs (Projects, All assets).** Before the correction the strip scrolled sideways: at 375 px the last Projects tab ("All") and, in All assets, "Archived" and "All" were partly outside the window and nothing showed that the strip scrolls. Every tab was reachable by touch (once scrolled) and by arrow keys, and there was no page-wide overflow, but discoverability was weak. **Correction (CSS only, `projects.css` and `assets.css`, phones only): the tabs wrap onto a second row and share the width, so all of them are visible with no hidden scrolling.** After it: every tab of both pages is fully visible, a tap selects it, ArrowRight reaches the last tab, Enter selects it, and there is no overflow at 375 and 320.
2. **Project detail jump row.** All five items are at least 44 px tall and reachable by touch and keyboard (Tab, Enter). Money, Tasks and milestones and Vendors landed correctly. **Defect found and fixed: Commitments and Spending (and the "Budget by line" target) landed with their headings behind the fixed header (heading at 17 px under a 60 px header), because those three sections had no scroll margin; the money band's own "Agreed" and "Paid so far" buttons use the same targets.** The fix is one CSS rule (`#pj-commitments, #pj-txns, #pj-breakdown { scroll-margin-top: ... }`). After it all five destinations land below the header at 375 and 320, ordinary scrolling works and Back leaves the page normally.
3. **Contact duplicate warning.** No change was needed. At 375 x 812 and 320 x 640 the dialog scrolls inside its window; both matches show; after scrolling to the bottom both "Open this one" buttons, the explicit different-person checkbox, Cancel and Add contact are inside the window (48 px tall); Add contact without the explicit choice saves nothing; Cancel and Escape dismiss without creating or merging anything (the contact count stayed 18); "Open this one" opens the existing contact. A 375 x 380 window with a focused input (a stand-in for a soft keyboard, **not a real keyboard**) still scrolls and keeps Cancel reachable.
4. **Remaining Project mobile tradeoffs (accepted for release).** The page is longer on a phone (5,846 px versus 5,355 px before D14) because money comes first; the jump row is the remedy. **Future decision, not implemented:** "Consider whether mobile Projects should prioritize Coming up, Tasks and milestones before the detailed financial tables."
5. **Source-scope findings (diff against `11bb7e4`).** Only files under `src/modules/projects`, `src/modules/assets` and `src/modules/contacts`, `src/shell/uiCoverage.test.ts` and `docs/` differ, plus the new `d14Compat.test.tsx`. No change to the database or migrations, financial engines, recurrence, Quick Add, Search, Backup or Sync, global navigation, theme storage, service worker or security policy; no dependency changed. Financial figures are printed from the unchanged Finance summary, an unknown budget still reads "No budget yet", the project delete dialog still blocks with its plan, warranty logic and the separation of maintenance from Household Services are untouched, Contacts have no merge, archive or reassign control, Remove is unchanged, and no Family color is used on a Contact.
6. **Tests after the two corrections.** `src/modules/projects`, `assets`, `contacts` and `src/shell`: 52 files, 1,166 tests passed; `npx tsc --noEmit` clean; `npm run build` succeeds. The full suite was not repeated locally (the corrections are CSS only and the last full run, 269 files and 5,042 tests, was on the same TypeScript); GitHub Actions must pass it on the release commit.
7. **Still not tested:** real phones and real soft keyboards, screen readers, forced colors, Safari and Firefox.

Evidence: `D14-Evidence\Verification\mobilecheck.json`, `tabs-*.png`, `dup-bottom-375.png`, `dup-debug-320.png`.
