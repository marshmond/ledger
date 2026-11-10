# Family Management F5: global Search, Quick Add and final Family integration

**Date:** 2026-11-09. **Status: BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting independent (ChatGPT) review.** Family Management F1 to F5 are implemented locally, awaiting F5 release verification; they are not fully released until the commit and the Pages deployment succeed. Not real-device tested, no screen reader used.
All names, dates and contact details in the tests and browser checks are invented.

## 1. Summary

Family is now found by global Search and can be started from the Add box, and the whole of F1 to F4 was checked together.

- **Search** (new group "Family"): household members (past ones labelled), a member's birthday, and the important dates. Each hit opens a screen Family already serves (a member's page, or the Family dates page). A Family hit is labelled "Family member", "Family birthday" or "Family date", and sits under its own "Family" heading, apart from the "Contacts" heading. Contact phone, email and notes, a member's private note, birth years and anniversary start years are never searched or shown.
- **Quick Add** (two Add-box buttons): **Family member** (shortcut `fam`, also `family`) and **Family date** (`fd`, also `famdate`). Each one only **opens Family's own existing form**; the Add box saves nothing for Family. So the same-name Contact warning and confirmation, Spouse, the explicit (never automatic) "This is me", Contact ids, Cancel and the F2 date rules are exactly the existing ones.
- **Integration acceptance** of F1 to F4 with Contacts, Calendar, Tasks, Projects, Search, Quick Add, Today and the grouped selector: tests plus a real browser pass. One real defect was found and fixed (phone layout of the add-member contact list, section 9). Nothing in F4's overview needed correcting.

No database table, migration, sync or backup change (schema still version 15), no new dependency, no new network call, no Finance access, no Today card, no Task, Project or Calendar event is created by Family Quick Add.

Result: **4,207 tests in 235 files** (+70 tests and +3 files on the re-run released baseline of 4,137 in 232). `npx tsc --noEmit`, `npm run build` and `git diff --check` are clean (section 8).

## 2. F4 release gate and deployed SHA

| Check | Result |
|---|---|
| Repository | `origin` = `https://github.com/marshmond/ledger.git` (`marshmond/ledger`) |
| Branch | `main` |
| Local HEAD = `origin/main` (after `git fetch`) | yes, both **`83654020aad028141f0c8f1e32c77797b2873350`** (`feat(family): F4 household overview and coordination`) |
| F4 committed and pushed | yes (HEAD equals `origin/main`) |
| GitHub Pages for that exact commit | public Actions API (`gh` is not installed here): run **#87**, `head_sha` = `8365402…`. It was still `in_progress` at the start of the session; I stopped and waited (polling the run, not building) until it read `completed` / **`success`** (updated 03:43:23 UTC). Runs #84 to #86 (C1, N1, C2) are also green |
| Working tree clean | yes (nothing printed by `git status --short` before the first edit) |
| F1 to F4, Spouse, "This is me", C2 Contact references and N1 present | yes (all in `main`: Family member, date, important-contact, schedule and work readers; the overview; the C1 role and mark; the C2 reference hook and safe selection; the grouped selector) |
| **Released test baseline** | **re-run on the clean checkout before any edit: 4,137 passed in 232 files** (about 77 s). This matches the documented F4 final figure; the 4,135 in the F4 build notes was the pre-release number |

Documents read before code: `CLAUDE.md`, `docs/CHATGPT-HANDOFF.md` (top notices, snapshot), `docs/BACKLOG.md` (top), `docs/module-hooks.md` (in full), the F4 report (in full), the F0 plan's Search and Quick Add sections and phase table, and the registration conventions in `src/core/registry.ts`, `src/core/quickAddRoute.ts`, `src/shell/AddBox.tsx`, `src/shell/SearchDialog.tsx`, the Contacts and Calendar search sources and the Ledger Add-box destinations; plus the Family, Contacts, Calendar, Tasks and Projects integration source listed in section 3.

**F0 scope check (no stop).** F0 describes Quick Add as one `fam` destination with typed forms (`fam date Sam birthday 14 may`, `fam activity …`, `fam task …`, each making a Calendar event or a Task, with preview and Undo). This phase's prompt is narrower: member and date entry points only, preferring the existing forms, and no Family action that creates a Task, Project or Calendar event. I judged that a narrowing, not a conflict: the F0 decisions (Contact is the identity, no new table, Calendar and Tasks stay authoritative) are all kept. What is therefore not built, and should be read as deferred rather than dropped: typed `fam date …` parsing with a preview and Undo, `fam activity`, `fam task`, and the counts-only Today card. If the reviewer reads this as a material conflict, please say so; nothing is committed.

## 3. Files changed

New (all in `src/modules/family/`):

| File | What it is |
|---|---|
| `searchSource.ts` | Pure `searchFamilyData` plus the read-only reader `readFamilySearchData` and the registered `familySearchSource` |
| `quickAddDef.ts` | The two Add-box destinations, `FAMILY_QUICK_ADDS`, and the address words `add=member` / `add=date` (no React, no database import) |
| `useAddIntent.ts` | `addIntentOf(search)` (pure) and the small hook the two Family pages use to open their own form once and tidy the address |
| `family-f5-search.test.ts` (34), `family-f5-quickadd.test.ts` (21), `family-f5-integration.test.ts` (15) | 70 tests |

Edited:

| File | Change |
|---|---|
| `family/index.tsx` | `contributes` gains `searchSource` and `quickAdd` (module id, name, routes unchanged) |
| `family/OverviewPage.tsx`, `family/DatesPage.tsx` | One `useAddIntent(...)` line and its imports each: the overview opens its existing Add member form, the dates page its existing Add date form |
| `family/family.css` | One property: `.fm-opt { flex: none; … }` (the phone layout fix, section 9) |
| `core/registry.ts` | `QuickAddDef` gains one **optional** field, `openCopy` (what is being added, where it is set up, the button text). Optional, so every existing destination is unchanged |
| `shell/AddBox.tsx` | The "opens another screen" block reads its sentence and button from `openCopy`, with a generic fallback (previously the words "a scheduled payment" and "Open the Scheduled screen" were typed into the box) |
| `ledger/quickAddDef.tsx` | The Scheduled-payment destination states its own `openCopy`, with exactly the previous words, so Ledger's screen is unchanged |
| `family-guards.test.ts`, `family-f3-guards.test.ts`, `family-f4-guards.test.ts` | The three older "Family has no search source or Add-box destination" expectations now say what F5 registers (and still pin: no Today card, no Finance reference) |
| `lazyBoundary.test.ts`, `lib/readOnlyTrap.test.ts` | Their pinned list and count of search sources gain Family (11). The read-only trap test already ran every registered search source for several typed words against a write trap, so Family's source is covered by it with no further change |

Not touched: `src/db.ts`, any sync or backup file, Finance, Tasks, Projects, Today, Calendar, Contacts code, `package.json`.

## 4. Family Search implementation

Registered as `contributes.searchSource` (group "Family"), the same hook Contacts, Calendar and Tasks use. Linear scan over already-stored rows, no index.

| Hit | Label | Shown | Opens |
|---|---|---|---|
| A household member (active or past, readable, with a living Contact) | **Family member** | name, relationship; "Past member" when past; "Possible duplicate" when two active records name one Contact | `#/family/m/<id>` |
| A member's birthday (active members only, one per Contact, F2's rule; shown whatever the member's Calendar switch says) | **Family birthday** | "Sam Example's birthday", month and day (no year) | the member's page |
| An active important date | **Family date** | the owner's label, month and day (no year), kind, "About <name>" when it has a member | the member's page when it names a member, else `#/family/dates` |
| The pages | Page | "Family", "Family dates" | `#/family`, `#/family/dates` |

Rules (each is a test):
- **One record, one hit.** A plain name finds the member; the birthday hit appears only when the typed words are about the date ("sam birthday", "14 may", "birthday"), so one person is not listed twice for one name. Two member records for one Contact (a cross-device duplicate) are each listed, flagged, and give one birthday.
- **Two people with one name stay two hits**, with their own ids and pages (never merged). When names collide the subtitle also says "Added <date>" (see limitation 1).
- **Not offered:** archived dates, unreadable or deleted records, a member whose Contact is gone (a "Contact no longer exists" hit would help nobody).
- **"family"** names the module: alone it lists the two pages (not every person); next to other words it is dropped, so "family birthday" works.
- **Separate from Contacts:** a member and their Contact are two hits under two headings with different labels and destinations (tested and seen in the browser, including after a rename). Contacts search is unchanged.
- **Privacy:** the Contact is reduced to a name before the search code sees it. Searching for a note word, a phone fragment, an email, a relationship or a birth year finds nothing; the whole serialised result list for broad queries contains none of them (checked with the repository's `scanText`); a source test pins that the search file never reads `.phone`, `.email`, `.notes`, `.relationship`, `.note` or a year.
- **Read-only:** every table is byte-identical before and after many searches; no network call; no write, transaction, storage or logging call in the file (source test); the registry's existing write-trap test also exercises it.

## 5. Quick Add implementation

Both destinations are `open` destinations (the contract the Scheduled-payment one already uses), because adding a person needs choices the Add box must not guess: which Contact it is, the role, and (for a date) the member and the day.

| Destination | Label | Shortcuts | Does |
|---|---|---|---|
| `family-member` | Family member | `fam`, `family` | Goes to `#/family?add=member`; the overview opens its existing **Add a family member** form and tidies the address |
| `family-date` | Family date | `fd`, `famdate` | Goes to `#/family/dates?add=date`; the dates page opens its existing **Add a family date** form and tidies the address |

Existing prefixes were `$ a b bs e hs p svc t`; none clash (the registry checks this at start-up and a test checks every word is unique). Every older shortcut still routes as before (tested). Typed words such as "famous" are not shortcuts.

- **No parser, no commit, no inline form:** the destinations cannot save anything. The Add box says "Will add: a family member. You choose or create the contact and the role on Family's own form. Nothing is saved until you press Add member there." and offers one button.
- **Safeguards come from the form itself** (browser-checked): choose an existing Contact or "Create a new contact"; typing a name that already exists shows the match, refuses to save, and needs the explicit "different person" tick; the new Contact is created through `createDistinctContact` (Family never calls `findOrCreateContact`, a source test covers every Family file); the existing Contact is untouched; Spouse is in the role list; there is no "This is me" control and nothing is marked (the mark is on the member's page, opt-in); Cancel and Esc save nothing (byte-identical snapshot); a member and their Contact keep their ids.
- **Date form:** the existing F2 form and save. Saving writes one Family date row and nothing else: no Calendar event (event count 1 before, 1 after, in the browser and in tests), no Task, no link. The Calendar shows the date through the existing provider, one marker per year.
- **No logging** of form data (`console.` is absent from every Family file, source test).

## 6. Cross-module acceptance

One invented household (three active members, one past, a swim event naming two members, a dentist event, an overdue Task, a Project, an important contact, a household date and an anniversary) was read by every Family reader, by the overview, by Search and by the C2 reference reader.

**Household overview (F4)**: re-verified end to end by the 64 F4 tests (unchanged and green) plus the browser pass. Covered: active and past members distinct; Spouse shown; "This is you" for nobody until chosen, and two marks shown as a conflict; one row per shared event; distinct events with one title stay two rows; skipped and moved occurrences (real Calendar functions); hidden-layer counts; Tasks one row per Task, overdue in words, repeating Tasks through Tasks' own engine, "Associated with" wording; birthdays and dates with F2's leap-day rule; the person filter is page state and changes no record. In this phase I added: the filter test over the combined household (activities, tasks, dates agree, snapshot unchanged), and the stored-Birthday-event coordination test (covered for the same Contact and day, not for a different person).

**Member profile (F3)**: Schedule, To do, Projects, Important contacts and Important dates for one member agree with the overview and with Search through one Contact id (test); the browser showed all six sections for the renamed member.

**Contact rename and missing Contact (tests and browser)**: renaming a Contact changes the name in Search, the overview, the schedule and the member page; the member id, Contact id, important-contact association and every reference are unchanged. A soft-deleted Contact makes Search leave the member out and the overview name it plainly; nothing throws. Two same-named people stay separate in Search, the overview, the schedule and To do.

**Routes** (browser, real navigation): Search → member page ✓, Search → Family dates ✓, Quick Add → Add member form ✓, Quick Add → Add date form ✓ (also by the typed shortcut `fd `), member page → Calendar occurrence (opened "Edit event", Swim meet) ✓, → Task (opened the Task editor) ✓, → Project ✓. No new routing convention was invented: Search uses `path`, Quick Add uses `open`, the address word `add` is the same shape as the Calendar's `new=1`.

**Backup, restore and sync (tests)**: a plain backup and an encrypted backup (through the real safety sequence) restore into empty profiles and Search gives identical answers; the encrypted file contains none of the names, labels, notes or purposes; two devices through the real sync engine see the same Family search results; no table was added (schema still 15). No format changed, so the older backup and sync suites apply unchanged and pass.

**Today and the selector**: Today still receives Family dates through the due provider (one marker per date, tested); no Today card was added; the module list, ids and routes (`family`, `/family`) are unchanged and the N1 grouping tests pass.

## 7. Contact identity and privacy safeguards

- Family creation never uses `findOrCreateContact` (source test over `data.ts`, `importantContactData.ts`, `dateData.ts`, `MemberForm.tsx`, `ImportantContacts.tsx`, `quickAddDef.ts`, `searchSource.ts`, `useAddIntent.ts`). Distinct Contacts only through `createDistinctContact` after the form's explicit confirmation. No name matching joins two records anywhere in F5; the only name logic is the existing warning.
- Search and Quick Add read or write no Finance table (the existing Family guards still pass: no Finance import, no Finance table).
- Search shows no phone, email, Contact note, private note, birth year or anniversary start year (section 4). The member page (F3, unchanged) still shows the Contact's phone and email to the owner on the member's own screen; Search does not.
- Quick Add receives no form data (nothing is typed into it for Family) and logs nothing.
- No export, sharing, projection, tablet view, authentication, remote integration, AI or automatic enrichment was added.
- **Not changed (still tracked):** Home & Assets, Bills, Projects and Household Services still match Contacts by name when they create one; that is a separate follow-up and F5 did not touch it.

## 8. Tests and browser results

**Behaviour tests (70 new):**

| Required topic | Where |
|---|---|
| Search 1 active, 2 past, 3 same-name, 4 birthdays, 5 important dates | `family-f5-search` (members, birthdays, important dates) |
| Search 6 valid routes, 7 uniqueness, 8 separate from Contacts, 9 no leaks, 10 read-only | `family-f5-search` (routes, uniqueness and limits, Contact results, privacy, read-only, rename) |
| Quick Add 11 registration and routing | `family-f5-quickadd` (registration and routing) |
| 12 member form reuse, 13 date form reuse | `family-f5-quickadd` (member and date form reuse; static markup of the real forms) |
| 14 same-name safeguards, 15 Spouse, 16 "This is me" opt-in, 18 stable Contact ids | `family-f5-quickadd` (what the form does when it saves: the same `createMember` and `createDate` the forms call) |
| 17 cancellation, 19 no duplicate Calendar event, 20 no unrelated writes | `family-f5-quickadd` (table-by-table snapshot: only `moduleRecords` changes; Calendar events unchanged) |
| Integration 21 to 27 | `family-f5-integration` (combined household, filter, links, rename and missing Contact, "This is me", birthday coordination, recurrence) plus the existing F1 to F4 suites, reused rather than copied |
| 28 no mutation from read-only pages | `family-f5-integration` ("nothing reads by writing": Search, overview, member readers, reference readers and the due provider leave every table byte-identical) |
| 29 backup and encrypted sync | `family-f5-integration` (plain and encrypted backup, two-device sync) |
| 30 mobile accessibility and theme | the real forms' static markup (every field and button named, no "This is me") plus the browser checks below; no new colour or new control was added |

Page-level behaviour that needs a DOM (clicking a chip, the form opening from the address) is not unit-testable here (the test environment has no DOM, the same limit as F1 to F4): the pure address check and the source wiring are tested, and the clicks were done in the real browser.

**Commands.** Targeted suites first (Family, core, shell, contacts, the privacy rule). Then, once on the final candidate (after the last edit to any code or test file):
- `npx tsc --noEmit`: clean.
- `npm test`: **4,207 passed in 235 files** (about 121 s).
- `npm run build`: succeeds (the existing chunk-size warning only).
- `git diff --check`: exit 0 (LF/CRLF notices only).
- `git status --short`: the 18 code paths in section 12 (the documents were edited after these runs and cannot affect them; the privacy-rule test that scans test files was re-run after the document edits).
- Earlier in the session the full suite found two failures that were mine to fix: two older tests that pin the exact list and count of search sources (now include Family), and the repository's privacy rule that three of my assertions broke (now written with `scanText`). Both were fixed and the suite re-run green.

**Browser (built-in pane, `npm run dev` on `localhost:5199`, a fresh origin and empty profile; invented data).** The household was seeded through the app's own data modules loaded in the page (not through the forms), then the page was reloaded. Search, navigation and the Quick Add flow were driven with real keystrokes and pointer clicks. The member-creation and date-creation saves were done through the real forms; two clicks were made by script (noted).

| # | Check | Result |
|---|---|---|
| 1 | Search finds Family members | PASS ("sam": one Family member hit, "Child") |
| 2 | Family and Contact results distinguishable | PASS (headings Family / Contacts / Tasks; badges "Family member" / "Contact"; also after a rename) |
| 3 | Search opens the right member | PASS (Enter opened `#/family/m/<id>`, heading "Sam Example") |
| 4 | Dates in Search | PASS ("birthday": two Family birthday hits and the Family dates page; "pool": the household date opened `#/family/dates`; "may": the birthday) |
| 5 | Add box exposes member and date | PASS (chips "Family member fam" and "Family date fd"; shortcuts line; typed `fd ` picked the date destination) |
| 6 | Add box opens the existing forms | PASS (button opened "Add a family member" and "Add a family date"; the address was tidied to `#/family` and `#/family/dates`) |
| 7 | New member keeps same-name safeguards | PASS (typed "Jo Example": warning shown, save refused, Contacts stayed 6; after the explicit tick a separate Contact was created, Contacts 7, the original Jo's id unchanged) |
| 8 | Spouse available | PASS (role list: Parent, Spouse, Child, Grandparent, Other; saved as Spouse) |
| 9 | "This is me" not assigned | PASS (no such control in the form; no member carries the mark after creation; the overview shows "This is you" for nobody) |
| 10 | Creating a date makes no duplicate Calendar record | PASS (event count 1 before and after; the new date was listed once) |
| 11 | Overview activities, Tasks, dates | PASS (Swim meet naming two members once; overdue Task in words; renamed member shown; the past member in Past members) |
| 12 | Member Schedule, To do, Projects, Important contacts | PASS (all four present for the member; links opened Calendar "Edit event", the Task editor and the Project) |
| 13 | Renaming keeps ids | PASS (member and Contact ids identical before and after; Search, overview and member page show the new name) |
| 14 | Module navigation | PASS (Family, Calendar, Tasks, Projects, Today reached by address and link) |
| 15 | No writes from read-only screens | PASS (a snapshot of every table was byte-identical after searching, viewing the overview, member and dates pages, opening and cancelling both forms by Cancel and Esc) |
| 16 | 320 and 375 px | PASS after one fix: no horizontal page or dialog overflow and no control under 24 px at 320 (overview, Add member, Add date, Add box) and at 375 (Add member, Search with seven results) |
| 17 | Light and dark | PASS for the Add box (375, dark) and the Search dialog (375, dark), both read and screenshotted; the member form was checked in light only |
| 18 | Keyboard and focus | PARTIAL PASS: Ctrl+K opens Search and Enter opens a hit; focus lands inside the dialog when the form opens from the address; Esc closes it. A full Tab-order walk and a screen reader were not done |
| 19 | Console | PASS with one note: the only error is a Vite hot-reload message (`Module "today" is registered twice`) caused by editing source while the page was open; it is a development-server effect, not an app error, and no other error or warning was logged |

**Not browser-verified:** a Tab-order walk of the new Add-box button states, the Search dialog at 320, the member form in dark mode, screen reader, real phone, a second device. The same-name check was done with two members (different roles) created in this pass.

## 9. Targeted fixes

1. **Phone layout of the add-member contact list (found in the browser, fixed).** At 375 px the contact list inside "Add a family member" squashed its rows, so a row's name and detail text overlapped the next row (the list is a flex column with a maximum height, whose rows shrank to their 44 px minimum). It is F1 code, not new, but Quick Add now sends people straight to that form. One CSS property (`flex: none` on `.fm-opt`); the list scrolls instead. Re-measured: 0 clipped rows at 375 and 320, screenshot checked. A source test pins the rule.
2. **Same-name members in Search:** not a fix to F1 to F4 but a precaution in the new code: when two members share a name, their hits also say when each was added.

No change was needed in the overview, the member sections, Contacts, Calendar, Tasks or Projects.

## 10. Known limitations

1. **Two same-named members remain hard to tell apart.** In Search the subtitle says the role and (when names collide) when each was added, but two people added the same day with the same role read identically. The overview cards and the "About" list in the date form have the same limit (F4 limitation 6). Each hit opens its own correct record, and nothing is merged. A small follow-up could add a per-member label.
2. **Quick Add carries no typed text.** `fam Robin` opens the Add member form but does not prefill "Robin" (the Add box passes nothing to an `open` destination). Typed parsing with a preview and Undo is the deferred F0 form.
3. The Add box hides its text box once an `open` destination is chosen (existing behaviour of every such destination, including Scheduled payment); the buttons and Cancel remain.
4. Search always returns birthdays only for date-style words, so searching a name does not list the birthday separately (judgment call 4).
5. The member page still shows the Contact's phone and email to the owner on the member's own screen (F3, by design); Search never does.
6. The overview's Me-conflict member links are 28 px tall on a phone (C1 code, recorded in the F4 report, not fixed).
7. Not real-device tested, no screen reader, no second physical device, no real sync, no offline run.
8. The browser data was seeded by direct module calls, as in F3 and F4; live refresh from an outside write was not demonstrated.

## 11. Judgment calls (please review)

1. **Two destinations** (`fam` member, `fd` date) rather than one with sub-words. The Add box routes on the first word and a form-opening destination has no parser, so a sub-word would not be understood.
2. **Forms are opened by an address word** (`?add=member`, `?add=date`) that the page consumes once and then removes (replace, so Back does not reopen it). It is the Calendar's `new=1` pattern.
3. **No typed text is passed to the form** (limitation 2). The alternative, a parsed preview and Undo, is a new Family creation path; the prompt asked for the smallest integration.
4. **Birthday hits only for date-style words**, to give one record one hit. The alternative (always list both) made every name search return the same person twice.
5. **Birthdays are searchable whether or not the member's Calendar switch is on** (Search is not the Calendar; F2's list does the same). Active members only, one per Contact.
6. **A date about a member opens that member's page; a household-wide date opens Family dates**, as F4 does.
7. **Archived dates, unreadable records and members with a missing Contact are not offered.**
8. **Past members are findable**, ranked below active ones and labelled "Past member".
9. **The Family and Family dates pages are searchable** (as Calendar's page is), so the module can be found by name.
10. **The word "family" is dropped from the record match when other words are present**, so "family birthday" works and "family" alone does not list every person.
11. **A registry type gained one optional field (`openCopy`)** and the Ledger destination states its own words; the Add box's generic fallback replaces text that used to be typed for Scheduled payment only.
12. **Five older tests were edited** to expect Family's new registration (three Family guards, the lazy-boundary list, the read-only-trap count). No assertion was loosened: each still pins what it protected and now states Family's contributions.
13. **The CSS fix** was made (section 9) although it is F1 code, because the new entry point routes people to it.
14. **No Today card, no `audience` parameter, no typed `fam date/activity/task`** (the F0 items this prompt deliberately excluded).

## 12. Exact Git status

`HEAD` = `origin/main` = `83654020aad028141f0c8f1e32c77797b2873350` (F4, Pages run #87 success). **Nothing staged, committed, pushed or deployed.** `git status --short` at the end of the build:

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M docs/module-hooks.md
 M src/core/registry.ts
 M src/lib/readOnlyTrap.test.ts
 M src/modules/family/DatesPage.tsx
 M src/modules/family/OverviewPage.tsx
 M src/modules/family/family-f3-guards.test.ts
 M src/modules/family/family-f4-guards.test.ts
 M src/modules/family/family-guards.test.ts
 M src/modules/family/family.css
 M src/modules/family/index.tsx
 M src/modules/lazyBoundary.test.ts
 M src/modules/ledger/quickAddDef.tsx
 M src/shell/AddBox.tsx
?? docs/FAMILY-MANAGEMENT-F5-REPORT-2026-11-09.md
?? src/modules/family/family-f5-integration.test.ts
?? src/modules/family/family-f5-quickadd.test.ts
?? src/modules/family/family-f5-search.test.ts
?? src/modules/family/quickAddDef.ts
?? src/modules/family/searchSource.ts
?? src/modules/family/useAddIntent.ts
```

## 13. Remaining backlog and deferred enhancements

Recorded, not built, not authorized:
- **Typed Family Quick Add** (F0): `fam date <who> <what> <day>` with a preview and Undo, `fam activity` (an ordinary Calendar event naming the member's Contact) and `fam task` (an ordinary Task); the form-opening entry points built here would remain.
- A per-member label (for example the Contact's relationship, or a short owner-chosen tag) to tell same-named people apart in Search, the date form and the overview.
- A counts-only Family Today card and the `audience` parameter on the shared reader (Command Station design).
- **Contact creation safety** in Home & Assets, Bills, Projects and Household Services (still name-matching).
- The mobile Task editor overflow at 320 px, Contact directory performance at scale, and the C2 item about a Contact created from a cancelled editor persisting.
- The two small Me-conflict links (28 px on a phone) in the C1 warning.
- C3 (Contact interaction notes), the Family Command Station and any tablet or sharing surface: separate initiatives, not started.
- Owner-device acceptance: real phone, a second device, real sync, offline use and a screen reader.

## 14. Documentation

`docs/CHATGPT-HANDOFF.md` updated (new top notice, current-phase bullet, delivered-functionality entry, baseline, risks, next action, change log). `docs/BACKLOG.md` updated (new status entry on top). `docs/module-hooks.md` updated (Family's `searchSource` and `quickAdd`, the new optional `openCopy`, and the `?add=` address words). Earlier phase reports and history are preserved. Family Management F1 to F5 are recorded as **implemented locally, awaiting F5 release verification**.

## 15. Recommendation for release

**Recommend independent review, then release verification if approved.** F5 is additive and small: one search source, two form-opening Add-box buttons, one optional registry field, one CSS property and tests. Nothing it adds can create a record by itself; every save goes through a form that already existed and already carried the identity safeguards. Points for a reviewer to look at first: the two judgment calls that change what a user sees (3, the Quick Add does not prefill typed text; 4, birthdays appear only for date-style searches), the `openCopy` registry field (11), the five older tests edited (12), and the CSS fix (13). Real-device and screen-reader checks remain the owner's. **Nothing may be committed or pushed until the owner explicitly authorizes it after review.**

---

## 16. Release verification (2026-11-09)

Decision received: **APPROVED FOR FOCUSED RELEASE VERIFICATION**. Sections 1 to 15 above are the original implementation report and are kept unchanged (including the pre-release Git status).

**Gate (fresh):** branch `main`; `HEAD` = `origin/main` = `83654020aad028141f0c8f1e32c77797b2873350` after `git fetch`; Pages run #87 (attempt 1) for that SHA `completed` / `success`; the working tree held exactly the 22 reviewed paths (15 modified, 7 new) and nothing else; `git diff --check` exit 0 (LF/CRLF notices only). The 15-file diff (89 insertions, 26 deletions) was re-read against the eight verification points: Search reads shared Contact ids and names only with `/family` routes; Quick Add destinations have no parse, commit or form and only navigate; the same-name confirmation and Spouse and "This is me" code are untouched; `openCopy` is optional and Ledger's destination states its previous words; the CSS change is one property; the five older tests changed by narrow expectation edits; no `db.ts`, backup, sync, hosting or `package.json` change.

**Evidence reused, not re-run:** 4,207 tests in 235 files, clean `tsc`, successful build and the browser acceptance are the results recorded in section 8. No code or test changed during release verification, so no new test, type-check or build run was made; only `git diff --check`, `git diff --stat` and `git status --short` were run fresh.

**Owner decisions recorded in the handoff and backlog:** Family F1 to F5 complete, subject to successful F5 deployment; C3 (traditional CRM) is deferred indefinitely; no interaction logging or last-contacted tracking is planned. **Next:** targeted UI and Contact-identity cleanup (Household Finances page title capitalization; name-based Contact creation in Home & Assets, Bills, Projects and Household Services; Task editor overflow at 320 px; small Me-conflict touch targets on phones; other recorded usability issues), then separate product design and visual identity work. None of these is implemented in this release.

**Release:** committed and pushed as `feat(family): F5 search quick add and final integration`. The SHA and Pages result are read from `git log` and the Actions tab (not recorded here, to avoid a second commit).
