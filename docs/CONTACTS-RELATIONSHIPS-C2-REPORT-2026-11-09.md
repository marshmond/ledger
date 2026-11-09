# Contacts & Relationships C2: cross-module references, safe Contact selection and guarded removal

**Date:** 2026-11-09. **Status: BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. AWAITING INDEPENDENT CHATGPT REVIEW.** A passing test run does not authorize release. C3, F4 and the Family Command Station are NOT started.
**All names and numbers in this document, in the tests and in the browser check are invented.**

---

## 1. Summary

- A Contact's page now answers "where is this person used?" with the **real records**, grouped by module, each opening its own screen, with dates and statuses. It comes from a new small, read-only hook, `contributes.contactReferences`: each module reads its **own** stored Contact fields and returns plain named rows. Seven modules contribute one (Family, Calendar, Tasks, Projects, Home & Assets, Household Services, Bills & Subscriptions).
- The directory has a **Show** filter built from stored relationships only: household members, important Family contacts, service providers, project participants, and "no confirmed references".
- The Calendar and Task **People** box no longer silently reuses a Contact because a typed name matches. It chooses by Contact id, tells two same-name Contacts apart, and creates a new Contact only on purpose, after the same-name list and a tick.
- **Guarded removal of an unused Contact is implemented** (soft delete, three checks, one transaction, same-id Undo). It is not claimed to be race-free across devices; a reference that arrives from another device first is kept and shown with a Restore button.
- **No new table, Contact field, migration, sync or backup format, dependency or backend.** Contact identity is still the stable id in the one shared `contacts` table.
- **Tests:** 4,065 passing in 229 files (released baseline 3,972 in 224: **+93 tests, +5 files**). `npx tsc --noEmit`, `npm run build` and `git diff --check` clean. Browser acceptance in section 10.

## 2. Release gate (verified before any change)

| Check | Result |
|---|---|
| Repository | `origin` = `https://github.com/marshmond/ledger.git` |
| Branch | `main` |
| Local HEAD = `origin/main` (after `git fetch`) | Yes: both **`73eb7d9621f92d1204c5f0fdc7e1ba192fa953b2`** (`feat(navigation): N1 grouped module selector`) |
| C1 committed and deployed | Yes: **`eafae832d572cc3f1091f58b29abe08b7a5fa71b`** (`feat(contacts): C1 directory and family identity enhancements`), Pages run **#84** `completed` / `success` |
| N1 committed and deployed | Yes: **`73eb7d9621f92d1204c5f0fdc7e1ba192fa953b2`**, Pages run **#85** `completed` / `success` |
| How the runs were read | The public Actions API with `curl` (`gh` is not installed). Runs #80 to #85 are all `success`. |
| Working tree | Clean (`git status --short` empty) before any change |
| C1 behaviour intact | Directory, safe edit, Spouse and "This is me": the C1 test files (`contacts-*`, `family-c1`, `contactEdit`, `contactUsage`) all still pass. In the browser I re-checked the directory, the Contact page, Global Search and the same-name behaviour; I did NOT repeat C1's stale-edit, Spouse or "This is me" browser checks (their automated tests pass and C2 does not touch that code) |
| Released test baseline | **3,972 tests in 224 files**, re-run on the clean checkout at the start of C2 (57 s). It matches the N1 report. (The C1 pre-release figure of 3,960 in 223 is the N1 figure minus N1's 12 tests in 1 file.) |

Documents read: `CLAUDE.md`, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, the C0 plan, the C1 report (including its section 15), the N1 report, `docs/module-hooks.md`. Source read: `src/core/{contacts,contactUsage,registry,store,txnDependents}.ts`, `src/lib/txnDeletion.ts` (the plan-and-apply pattern), `src/ui/pickers.tsx`, `src/modules/family/references.ts`, the Contacts module, and the record, model and data files of Calendar, Tasks, Projects, Home & Assets, Household Services, Bills and Family. N1 was not touched.

## 3. Files changed

**New (application):** `src/core/contactReferences.ts`, `src/core/contactRemoval.ts`, `src/core/contactChoice.ts`; `src/modules/{family,calendar,tasks,projects,assets,services,bills}/contactReferences.ts` (seven readers); `src/modules/contacts/{references.ts, WhereUsed.tsx, RemoveContact.tsx}`.
**Edited (application):** `src/core/registry.ts` (the hook type and `allContactReferenceProviders`); the seven module `index.tsx` files (one import and one `contactReferences:` entry each); `src/modules/calendar/records.ts` (`pathFor(event, today)`: an optional date, default unchanged); `src/ui/pickers.tsx` (the Contact picker only); `src/modules/contacts/{ContactPage,DirectoryPage}.tsx`, `contacts.css`; `src/modules/calendar/calendar.css` (picker styles).
**New tests:** `src/modules/contacts/c2-references.test.ts` (28), `c2-removal.test.ts` (19), `c2-picker.test.tsx` (21), `c2-sync.test.ts` (10), `c2-ui.test.tsx` (15), and the shared kit `c2-testkit.ts`.
**Edited tests (deliberate, because C2 adds a registered hook and removal):** `contacts-guards.test.ts` (the test kit is not module code; Contacts still contributes only a search source and no reader; removal only through the guarded core helper), `family/family-guards.test.ts` and `family/family-f3-guards.test.ts` (Family now contributes `dueProvider` and `contactReferences`), `bills/hooks.test.ts` (the list of Bills' contributions).
**Docs:** this report, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, and `docs/module-hooks.md` (a section for the new hook; not on the brief's short list of docs, added because the hook convention is documented there). C0, C1, N1, Family and stabilization documents untouched.
Not changed: `package.json`, the lockfile, `src/db.ts` (Dexie stays v15), any sync or backup file, any Finance file, N1's `ModuleBar` and `moduleGroups`.

## 4. Cross-module reference-reader design

**Two layers, as C0 planned.** Layer 1 (`contactUsage.ts`, from C1) counts records that mention a Contact's id and knows no field names. Layer 2 (new) asks each module for real, named references.

**The interface** (`src/core/contactReferences.ts`, registry hook `contributes.contactReferences`, documented in `docs/module-hooks.md`):

```ts
find({ ids: ReadonlySet<number>, d, today }) => Promise<ContactReference[]>
ContactReference = { contactId, module, kind, recordId, role, title, relation, href?, date?, status?, inactive?, facet? }
```

It follows the `txnReferences` precedent: a small provider with a label and one `find`, and a shared function (`readContactReferences`) that asks every provider, in one pass per module for all the Contacts asked about. No graph, no new store.

**Rules the readers follow, and how each is proved:**

| Rule | How |
|---|---|
| Read only; no timestamps changed; nothing created; no sync side effect | A hook on every table counts creates, updates and deletes while the readers run (zero), and every table is byte-identical afterwards; a source guard rejects table writes, `.transaction(`, storage, network and restore/remove calls in the eight reader files |
| By stored id only; never by name, title, payee, amount or provider-name snapshot | A fixture whose names, titles and snapshots all say "Pat Example" but whose ids are empty returns nothing |
| Deleted records skipped; archived, ended, finished or retired records listed quietly (`inactive`) | Tests per module |
| Damaged records safe | Each row is parsed on its own (`readRows`); a row the module's parser rejects is skipped and cannot stop the list. Tasks and the Calendar's own loaders throw on a row whose data is null; the new readers do not use them |
| Unknown fields preserved | Nothing is written, so nothing is lost |
| Fails transparently | A provider that throws is "could not check" (the others still run); no providers is not verified; a malformed item is dropped, counted, and makes the result unverified |
| No Finance access | A "reading" hook on every non-shared table fires zero times with a transaction and an account in the database; the files import nothing from Finance |
| A link is a path inside Ledger | `cleanReference` keeps `href` only if it starts with a single `/` (a full URL, `//` or `javascript:` is dropped) |

**Layer 1 versus layer 2.** `unlistedMentions()` compares, per record kind, the complete scan's count with the distinct records the readers could name. A shortfall (a kind with no reader, a damaged or handed-over record, an attachment, or a number that only looks like an id) is shown as "Ledger found N more stored records that mention this contact than it can name here. Other stored references may exist, so this list may not be complete." It is never read as "unused", and never invents a record.

**Shared links.** A built-in reader honours a shared link that names a Contact (either end, number or `contact:<id>`), naming the other end through its own module when it can. No module creates such links today.

**Eager loading.** Each reader file imports only parts its module's registration already loads (`records.ts`, models, labels); no screen file is imported. `lazyBoundary.test.ts` passes. The build size of the first download was not compared with N1's (see section 12).

## 5. Coverage by module

| Module | Field read | Shown | Opens |
|---|---|---|---|
| Family | `family/member.contactId` | "Household member", the role in words ("Spouse in the household"), In the household / Past member (past is quiet) | `/family/m/<memberId>` |
| Family | `family/contact.contactId` | the purpose as the title ("Soccer coach"), "Important contact for <member name>" (the member's own Contact name, read, never copied), Active, or "Removed from the member's list" (archived: quiet, not a filter match) | the member's page |
| Calendar | event `contactIds` | title, next date (the Calendar's own `occurrenceToOpen`, only for events that name a requested Contact), "Repeats" | `/calendar?v=agenda&d=<date>&open=e:<id>:<key>` (the Calendar's own format) |
| Tasks | task `contactIds` | title, its status word, due date, "repeats" | `/tasks?task=<id>` |
| Projects | `project.vendorContactIds` | name, "Listed under Vendors and people", status, target date | `/projects/<id>` |
| Projects | `commitment.vendorContactId` | the commitment's title, "Vendor on this commitment (accepted) in the project "<name>"", no amount | its project |
| Home & Assets | `asset.contacts[]` | asset label (place and name; no serial, plate or address), "Related person on this item, as "installer"" | `/assets/<id>` |
| Home & Assets | `service.providerContactId`, `warranty.providerContactId` | service or warranty label, date | `/assets/<id>?service=<id>` / `?warranty=<id>` |
| Household Services | `arrangement.providerContactId`, `extraContactIds` | title, "Provider for" / "Also involved in", status and the schedule in words | `/services/a/<id>` |
| Household Services | `visit.providerContactId` | title, date, Completed / Skipped / Cancelled; the **provider-name snapshot is never read** | `/services/v/<id>` |
| Bills & Subscriptions | `obligation.providerContactId` | title, "Provider of this bill/subscription", status; the snapshot is never read; no payments or amounts | `/bills/o/<id>` |
| Shared links | links naming the Contact | the other end's name | its own module's path |
| Anything else | not read by a named reader | counted by layer 1 and shown as a limit of the list | none |

Every address is checked against the module's own record source in a test (tasks, projects, assets, services, visits, bills, calendar), and every address was opened in the browser (section 10).

## 6. Contact detail and directory behaviour

- **Contact page:** "Where this contact is used" has one section per module in reading order (Family, Calendar, Tasks, Projects, Home & Assets, Household Services, Bills & Subscriptions, Other supported references), each with a count, a preview of **five** and a named "Show all N in <section>" button (the hard limit is 100 per section; the screen says how many are not shown). Items have a link title, the relationship in words, and a date and status line; finished records are quiet. Long names wrap. A useful empty state appears only when nothing could be named, nothing more was found by the scan, and every module was checked. The C1 counts remain beneath as "Stored mentions (a cross-check)".
- **Directory:** a **Show** menu with six options and counts (All contacts; Household members; Important Family contacts; Service providers; Project participants; No confirmed references), beside the C1 search (name, relationship, phone, email) and sort (A to Z, Recently added or changed). A Contact can match several. A row also lists its facets and the C1 "Used in ..." line. Same-name warnings are kept.
- **What each filter means:** household member = an **active** `family/member`; important Family contact = an **active** `family/contact` (an archived one is listed on the page but is not a match); service provider = provider of a Household Services arrangement or visit, a Home & Assets service or warranty, or a bill (ended and past records still count, because they are stored relationships); project participant = a project's vendor list or a commitment's vendor. A typed relationship such as "plumber" is **not** a facet (tested).
- **"No confirmed references"** requires the named readers **and** the complete scan to find nothing, and every reader to have run. If a module could not be checked the option is disabled and a note says so. The directory says it is a way to find Contacts, not a check that they can be removed.
- Readers run once for the whole directory (not per row). Cost: section 12.

## 7. ContactPicker changes (Calendar event editor and Task editor)

**Callers inspected first.** A test pins that `ContactPicker` is used only by `calendar/EventEditor.tsx` and `tasks/TaskEditor.tsx` (plus its definition); no other module uses it (Family and Contacts never did).

**Behaviour now (`src/ui/pickers.tsx`, `src/core/contactChoice.ts`):**
- **Choosing an existing Contact is by its stable id.** The menu lists every unchosen Contact; two same-name Contacts are two options. Names used once read "Name (how you know them)"; a name used more than once always reads "Name (details; added <date>; 2 of 3 with this name)", so two entries can never read the same, even with identical details. Chosen Contacts are chips with the same label and a "Remove <name>" button. A chosen Contact that no longer exists says so.
- **Typing a name never reuses a Contact.** The button reads **Add new contact** (it used to read "Add" and silently reused a lower-case match). If the name is free, a new Contact is created (`createDistinctContact`) and chosen. If the name is taken (ignoring case, accents and spacing, the app's `nameKey`), **nothing is created**: a warning lists every match with its details, a **Use this one** button for each (by id), and a tick "This is a different person or organization with the same name" that must be set before **Add as a new contact** works. The check and the create are one transaction, so a Contact added a moment ago (another tab, a sync) is still noticed.
- Existing associations are untouched on edit: the editors pass the stored `contactIds` through; nothing re-resolves by name.

**Tests:** the pure labels, the picker's markup in every state (static markup, the same technique as the C1 and Family tests), `addPickedContact` on a real database (free name, taken name in four spellings, confirmation, a concurrent pair, a removed same-name Contact, invalid names), and the Task and event data paths. **Limit:** this project has no DOM test environment (no jsdom), so the real editors were exercised in the browser, not in unit tests; the data path they use (`createTask`, `saveTask`, `createEvent`, `loadEvents`) is tested with the real functions.

**Remaining name-matching creation paths (documented, NOT changed in C2, pinned by a test that lists the exact files):** `findOrCreateContact` is still used by Home & Assets (`AssetForm`, `ServiceForm`, `WarrantyForm`), Bills (`data.ts`, `discoveryData.ts`), Projects (`data.ts`, `CommitmentForm`) and Household Services (`data.ts`), and so by their Quick Add paths. Each still returns an existing Contact with the same name instead of creating a second one. Family and Contacts never use it. Each of those needs its own review.

## 8. Contact removal: decision and rationale

**Decision: implemented.** The brief's stop condition was "complete local eligibility checks, safe transaction boundaries or non-destructive Undo cannot be implemented within existing architecture without major redesign". None of the three needed a redesign:

- **Eligibility.** A Contact is removable only when (1) it is live; (2) the complete layer-1 scan finds nothing; (3) the older conservative text rule (the Contact's digits anywhere in any live record, link end, attachment or due item, the same rule as `contactIsReferenced`, copied into core so core imports no module) finds nothing; (4) every module reader ran and returned nothing. A reader that cannot run, returns something unreadable, or no reader at all, **blocks** removal. The directory filter and the named lists are not used as authorization (a test pins that the removal card and plan never reference them).
- **Transaction.** Same shape as deleting a Finance transaction: `planContactRemoval` (read only, the preview) then `applyContactRemoval`, which in **one transaction over contacts, moduleRecords, links, attachments and dueItems** (the only tables a Contact id can be in) plans again, refuses on "gone", "referenced", "could not check" or "changed since you looked" (a fingerprint of the Contact's stored fields), then soft-deletes through the shared store. Tests: refused for every kind of stored reference (fourteen fields, plus a link, an attachment, a due item, and the id as text), refused when a reference appears between preview and confirmation (also checked in the browser), refused when the Contact itself changed, atomic when a write fails, never a hard delete, and unrelated records and unknown fields untouched.
- **Undo.** `undoContactRemoval` restores **the same row and id** through the shared store. Its token holds the removed row's full fingerprint, so a change made in the same millisecond is noticed; if the removed row is no longer exactly as the removal left it, Undo refuses and writes nothing. Offered in the toast after removal.

**Screen.** The Contact page has a "Remove this contact" section, clearly separate from Edit. The button is offered only when the page's own data shows nothing uses the Contact and every module was checked; pressing it re-runs the full plan, and a blocked plan says why. The preview names the Contact, says the shared contact changes for every module, that it is hidden not erased, that Undo restores it, and that two devices cannot be promised never to cross. **Cancel has focus** (checked in the browser). A used Contact shows "This contact is in use, so it cannot be removed".

**Cross-device limit, stated plainly.** A local transaction cannot know about an offline device. If device B adds a reference to a Contact that device A removes, Ledger's whole-record sync keeps **both**: the Contact stays removed and B's record stays, so the reference points at a removed Contact. Nothing is destroyed or silently repaired. To make this visible, the directory shows **"Removed contacts that are still in use"** (found by the layer-1 scan over removed Contacts) with a **Restore** button that brings back the same id. Proven with two real `SyncEngine` devices (section 9). This is a limit of last-writer-wins sync, not a guarantee.

**Not done:** archive (needs a field and about thirty call sites), merge, hard delete, removal of a used Contact, a list of every removed Contact (only the ones still in use are surfaced).

## 9. Backup and synchronization results

All on Ledger's real backup code and the real `SyncEngine` with two devices (`c2-sync.test.ts`, 10 tests):

- **Plain backup and restore:** a Contact named in every module restores with the same id, the same 13 named references and its unknown fields; the Contact count is unchanged (no duplicate).
- **Encrypted backup:** the file does not contain the Contact's name; the real restore sequence returns the same references.
- **Removal and restore through a backup:** the removed row is kept; restoring it brings back the same id.
- **Two devices, same-name Contacts:** each device creates a Contact named "Sam Example"; both are kept on both devices, each keeps its own Task or Calendar link, and nothing merges.
- **Editing a Task on one device** keeps its Contact id on both, with no second Contact made.
- **Removal syncs:** the other device sees the Contact removed, row and unknown fields intact. **Undo syncs back** with the same id and no duplicate.
- **Race:** A removes an unused Contact while B (not yet synced) adds a Task using it. After syncing, both devices show the Contact removed, the Task intact, the "removed but still in use" entry on both; Restore on one device syncs back, both agree, and the entry goes away.
- A Contact that already has a reference cannot be removed on either device.
- Dexie is still v15; `package.json`, the lockfile and `src/db.ts` unchanged; no new table, protocol or backend.

## 10. Tests and browser verification

**Automated:** `npm test` **4,065 passed in 229 files** (96 s). `npx tsc --noEmit` clean. `npm run build` succeeds (the existing chunk-size warning is unchanged in kind). `git diff --check` clean. A first full run had 5 failures, all existing guard tests that pin the old registered contributions (listed in section 3); I updated them deliberately and the second run was fully green. Focused suites were run first at each step. Test coverage against the brief's list: references (1 to 10), selection (11 to 18; 17 is the data path plus the browser, see the limit in section 7), removal (19 to 25), UI (26 to 30 in `c2-ui.test.tsx` and the browser).

**Browser** (built-in browser pane, its own isolated profile; I seeded invented data through the app's own database module in that profile; Vite dev server stopped afterwards):

| # | Check | Result |
|---|---|---|
| 1 | One Contact with Family (spouse and important contact), Calendar, Task, Project (and commitment), Home & Assets (asset, service, warranty), Household Services (arrangement, visit) and Bills | PASS |
| 2 | The Contact page lists the actual records, by group, with relationship, date and status | PASS |
| 3 | Every link opens the right existing record | PASS: Family member page, Calendar event editor, Task editor, Project, Asset (service entry), Services arrangement, Services visit, Bill (checked by title). The warranty link uses the same format as the service link (tested against the module's own source) and was not separately opened |
| 4 | A Contact in several modules shows every group | PASS (7 groups) |
| 5 | A Contact with no references: useful empty state; the removal card is offered | PASS |
| 6 | Directory filters (household members, service providers, no confirmed references; the others by test) | PASS: counts matched the data; the Contact in four categories appeared in each |
| 7 | Calendar and Tasks tell two same-name Contacts apart | PASS: chips and the menu showed "(school coach; ... 2 of 2 with this name)" and the plumber entry apart |
| 8 | Typing a taken name creates nothing | PASS (Task editor and Calendar editor): the list of matches appeared, the Contact count stayed the same, "Add as a new contact" was disabled until the tick |
| 9 | With the tick, a separate Contact is created and the originals are byte-identical | PASS |
| 10 | Reopening and saving a Task or event keeps its Contact id | PASS: the Task's id list was the same after a save, after reopening and after a second save; the event saved the two chosen ids with no new Contact |
| 11 | Removal refuses a referenced Contact | PASS (no button on a used Contact; a reference added behind an open preview made "Remove contact" refuse with a message, Contact still live) |
| 12 | Removal and Undo of an unused Contact | PASS: removed (soft; the row remained), toast Undo restored the same id; a second removal then a late reference showed the "removed but still in use" card, Restore worked |
| 13 | 320 and 375 px | PASS for the Contact page and directory at both widths (no horizontal overflow, no target under 44 px). The same-name warning in the Task editor **overflowed at 320 px at first** (fixed: the picker grid could not shrink, the menu of people is now on its own line, chips get 44 px buttons); it then fitted. See the note on the Task editor below |
| 14 | Light and dark | PASS for the Contact page and the same-name warning at 375 px in dark, the rest in light; the new styles use theme variables only (test) |
| 15 | No unexpected change to any record | PASS: a snapshot of **every table** was byte-identical after visiting the directory, three Contact pages, every filter, the removal preview (opened and cancelled) and the Family, Calendar, Tasks, Projects, Assets, Services and Bills screens |

Also checked: Global Search still lists the Contact (name and relationship) and the separate "Tasks for contact" result; the Contact result opens the page. Console: no new errors after a reload (old Vite hot-reload messages from my own module edits remain in the tool's buffer).
**Not checked:** a real device, a screen reader (the browser tool names the same-name checkbox "on", its own fallback; the DOM label is correct, as in C1), a second real tab or device (the two-device cases are the automated real-engine tests), Safari and Firefox, the browser timing of the directory at scale, opening the warranty deep link by hand, and the "important Family contacts" and "project participants" filters by hand (tested by data).
**Pre-existing, found, not fixed:** the **Task editor dialog is about 38 px wider than a 320 px screen** even with the People box hidden (the dialog scrolls sideways); unrelated to C2.

## 11. Architecture judgment calls (please review)

1. **One small hook, no graph.** `contributes.contactReferences` follows `txnReferences`. A reference is a flat row; grouping is words, not structure.
2. **Family's own reader is kept** (`family/references.ts`, used by the member page for its count line). Replacing it would change what a member page says for little gain; the new readers name everything it counted (compat test) and add Home & Assets, Services, Bills, important contacts and commitments. The Family file and its tests are unchanged.
3. **Removal is implemented**, with the layer-1 scan and the text rule as the authority and the named readers as an extra block. Rationale in section 8.
4. **"Removed but still in use" Restore card** is an addition the brief did not name, made so the cross-device limit is visible and repairable rather than silent.
5. **The picker's button was renamed** "Add" to "Add new contact", because "Add" used to mean "find or create".
6. **Creation in the picker is immediate for a free name** (as before): the Contact exists once added, even if the event or task form is then cancelled. A created-but-unused Contact can be removed from Contacts.
7. **Facet definitions** (section 6): active only for household member and important contact; ended and historical records still make a provider or a project participant.
8. **Retired (handed-over) Calendar events are listed quietly with no link**, because the Calendar no longer shows them.
9. **Each reader parses rows one by one** instead of using the module loaders, so one damaged row cannot hide the rest. This is the one place the new code does not reuse a module's loader.
10. **The removal text rule is copied into core** (`idAppearsInStoredData`) rather than importing the Services module's `contactIsReferenced`, so core imports no module. Both use the same digits-as-a-whole-number rule.
11. **Four existing guard tests were changed on purpose** (section 3). Each now pins the new, narrower truth (for example: Contacts contributes a search source and no contact reader).
12. **`pathFor(event, today)`** got an optional date (default unchanged) so the Calendar reader is deterministic.
13. **The Contact page shows named lists first and the C1 counts as a "cross-check"**; the C1 wording that counts "do not decide whether a contact can be removed" is kept.
14. **`docs/module-hooks.md`** documents the new hook.

## 12. Known limitations

- **Not real-device, screen-reader, Safari or Firefox tested.** The two-device behaviour is the automated real `SyncEngine`, not two physical devices.
- **Removal cannot be race-free across devices** (section 8). The visible Restore card is the mitigation.
- **Three other name-matching creation paths remain** (section 7), by scope.
- **Directory cost at scale (Node only, one run, not repeated):** all 1,500 Contacts' named references over 15,000 records took about **860 ms** (66 ms for the C1 usage scan; about 140 ms for a single Contact). The directory re-reads on every change to the shared tables, so on a very large household it could feel slow; the fallback (load the filters on demand, keep the list instant) needs no new infrastructure. Browser (real IndexedDB) timing is unmeasured.
- **A row a module's own parser rejects is skipped** by its reader; the Contact page says other stored references may exist, and removal stays blocked (the scan sees it).
- **Task editor width at 320 px** (pre-existing).
- **The picker creates a Contact at Add time** even if the editor is cancelled.
- **A removed Contact's name still appears in the "removed but still in use" card** (the owner's private screen); other removed Contacts are not listed anywhere.
- First-download size was not compared with N1's.

## 13. Git status (exact, at the end of the batch)

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M docs/module-hooks.md
 M src/core/registry.ts
 M src/modules/assets/index.tsx
 M src/modules/bills/hooks.test.ts
 M src/modules/bills/index.tsx
 M src/modules/calendar/calendar.css
 M src/modules/calendar/index.tsx
 M src/modules/calendar/records.ts
 M src/modules/contacts/ContactPage.tsx
 M src/modules/contacts/DirectoryPage.tsx
 M src/modules/contacts/contacts-guards.test.ts
 M src/modules/contacts/contacts.css
 M src/modules/family/family-f3-guards.test.ts
 M src/modules/family/family-guards.test.ts
 M src/modules/family/index.tsx
 M src/modules/projects/index.tsx
 M src/modules/services/index.tsx
 M src/modules/tasks/index.tsx
 M src/ui/pickers.tsx
?? docs/CONTACTS-RELATIONSHIPS-C2-REPORT-2026-11-09.md
?? src/core/contactChoice.ts
?? src/core/contactReferences.ts
?? src/core/contactRemoval.ts
?? src/modules/assets/contactReferences.ts
?? src/modules/bills/contactReferences.ts
?? src/modules/calendar/contactReferences.ts
?? src/modules/contacts/RemoveContact.tsx
?? src/modules/contacts/WhereUsed.tsx
?? src/modules/contacts/c2-picker.test.tsx
?? src/modules/contacts/c2-references.test.ts
?? src/modules/contacts/c2-removal.test.ts
?? src/modules/contacts/c2-sync.test.ts
?? src/modules/contacts/c2-testkit.ts
?? src/modules/contacts/c2-ui.test.tsx
?? src/modules/contacts/references.ts
?? src/modules/family/contactReferences.ts
?? src/modules/projects/contactReferences.ts
?? src/modules/services/contactReferences.ts
?? src/modules/tasks/contactReferences.ts
```

Nothing is staged, committed, pushed or deployed. HEAD = `origin/main` = `73eb7d9`.

## 14. Recommendation for release

**Recommend release after independent review, in one commit.** Reviewer focus, in order: (a) the removal safety argument and the cross-device behaviour (section 8 and 9), including whether the "removed but still in use" card is the right mitigation; (b) the picker's identity rules (sections 7 and 10, rows 7 to 10); (c) reader completeness against the C0 inventory (section 5) and the decision to keep Family's own reader; (d) the four guard-test changes; (e) the filter definitions (section 6). The owner's own real-device and second-device pass remains owner acceptance, as for every phase. After release: C3 and F4 each need their own go-ahead; the other name-matching creation paths need their own review.

**Handoff and backlog:** `docs/CHATGPT-HANDOFF.md` was updated (top notice, current phase, baseline, section 6, risks, change log); `docs/BACKLOG.md` was updated (C2 entry on top; the C0-era C2 line marked superseded); `docs/module-hooks.md` gained the hook section.

---

## 15. Final release verification (2026-11-09)

ChatGPT verdict: **APPROVED FOR FINAL RELEASE VERIFICATION, with extra scrutiny on Contact removal.** Sections 1 to 14 above are the original implementation findings and are unchanged (their test count of 4,065 and the git status in section 13 describe the tree before this verification). The commit SHA and Pages result are given in the final message, not here, to avoid a second commit.

**Gate.** Branch `main`; HEAD = `origin/main` = `73eb7d9621f92d1204c5f0fdc7e1ba192fa953b2` (after `git fetch`); Pages run #85 for that SHA `completed` / `success`, attempt 1; C1 `eafae83` (run #84) still deployed; the tree held only the reviewed C2 files (21 modified, 20 new); `package.json`, the lockfile and `src/db.ts` unchanged; no migration, dependency, sync, backup, Finance or hosting file touched.

**Contact removal, read again in the source (not only the report).**
- *Local eligibility.* `planContactRemoval` refuses when the Contact is not live; when the complete numeric scan or the text rule finds any mention (the named readers are then not even needed); when any reader throws, returns something unreadable, or none is registered (`verified` false); and when a named reader reports a record. The fingerprint (every stored field of the Contact except its sync time stamp, plus the clear result) makes a change to the Contact between preview and confirmation refuse as "stale"; a reference that appears refuses as "referenced". Tests cover every case, plus a record kind the app does not know, which is kept untouched.
- *Transaction integrity.* `applyContactRemoval` plans again inside ONE `rw` transaction over `contacts, moduleRecords, links, attachments, dueItems`, the only tables a Contact id can be stored in; every read in the recheck (the scans, the seven readers, the member-name lookup) uses only those. All checks come before the single write, so any refusal throws before anything is written, and a thrown error rolls back. Three probes were added in this verification: (1) a reader that reads a table outside the transaction (a Finance table) cannot authorize removal (the read fails, the result is unverified, nothing written); (2) a reader that waits on something that is not a database call, which ends the transaction, cannot lead to a write (the removal rejects, every table unchanged, the Contact still live); (3) a refused removal leaves an unknown record kind and every table byte-identical. The shared-link reader, the only code that could read through another module, runs only when the scans already found nothing, which means no link names the Contact, so it never runs in a removal.
- *Undo and restoration.* The same row and id come back with unknown fields (tested earlier). Added probes: a token for one removal cannot restore a different Contact (refused as "stale", or "gone" for an unknown id), a refused Undo leaves every table unchanged, and the token's own Undo still works afterwards. The "removed but still in use" list and its Restore button were exercised in the browser (below) and with two real devices.
- *Cross-device.* The real-`SyncEngine` tests (`c2-sync.test.ts`) were reviewed and re-run: removal on one device syncs; a reference created on another device before the removal reaches it survives alongside the removed Contact; both devices then show it as removed-but-in-use; Restore converges on both with the same id. The wording in the confirmation dialog ("It cannot promise that two devices never cross"), in the directory card ("This can happen when another device added something before the removal reached it") and in section 8 makes no claim that a local transaction protects an offline device. No distributed deletion protocol was added.
- **Result: no blocker. The removal rules were not weakened.**

**Same-name selection (real editors, fresh browser profile, invented data).** Two same-name Contacts stayed separate choices by id in both the Task and the Calendar editor, with labels that tell them apart ("2 of 2 with this name"). Typing the name and pressing Enter created nothing (contact count unchanged) and showed the matches; "Add as a new contact" was disabled until the tick (the tick path itself is covered by the data-level tests and was exercised in the earlier browser pass); "Use this one" chose by id. Saving, reopening and saving again kept the exact Contact ids for the Task and the event, and no Contact was created. Duplicate check and creation are one transaction (a concurrent pair gives one created and one needing confirmation, tested). A Contact removed elsewhere is shown as "A contact that no longer exists" and is never replaced by a same-named Contact (test added). The confirmation is a native checkbox inside its label: its computed name is "This is a different person or organization with the same name", it is in the normal tab order and not disabled (test added; the browser tool's own listing calls it "on", as in C1; a real screen reader is unverified).

**Named readers and deep links.** All seven modules register a reader (test). Only stored ids are used; the provider-name snapshots and matching names create nothing (test); reads change no table and fire no write hook; damaged and missing records are skipped or listed as "needs review"; no reader file imports a screen or a Finance module (the registration imports are the ones each module already loaded), and `lazyBoundary.test.ts` passes; the Contact page keeps the named lists and the "Stored mentions (a cross-check)" card visibly separate, says "other stored references may exist" for a shortfall, and its removal button depends on the complete checks, never on the named list alone. No amount, note or Finance field appears in any reference. In the browser, links were **clicked** from the Contact page and landed on the right records: the Calendar event editor (V Parent meeting), the Task editor, the Project, the service visit, the Bill, and, newly, the **Home & Assets warranty deep link** (`#/assets/<id>?warranty=<id>`), which opened the asset with that warranty expanded.

**Browser (fresh profile, 0 Contacts before seeding):** grouped lists (7 groups); filters (Household members 2, Important Family contacts 1, Service providers 1, Project participants 1, No confirmed references 1, All 5); empty state for an unused Contact; no removal button on a referenced Contact; a reference added behind the open preview made "Remove contact" refuse with Cancel-focused dialog intact; removal soft-deleted the same row, Undo restored the same id; a second removal followed by a late reference showed the "Removed contacts that are still in use" card and Restore brought back the same id; at 320 and 375 px the Contact page and directory had no horizontal overflow and no target under 44 px; the picker's same-name list had no target under 44 px; at 375 px in dark the directory, Contact page and picker were legible. **Task editor width:** the dialog's scroll width was 316 px (viewport 320) with the People picker shown, with it hidden and with the same-name warning open, so C2 does not worsen the existing overflow. N1's grouped menu text was unchanged; a no-op Contact edit wrote nothing ("No changes to save"); C1 automated tests pass. Spouse and "This is me" code was not touched.

**Corrections.** None to the application code. Six tests were added (four removal probes, two picker probes), so the count is 4,071, not 4,065.

**Final checks (one run):** `npm test` **4,071 passed in 229 files**; `npx tsc --noEmit` clean; `npm run build` succeeds; `git diff --check` clean.

**Deferred items (recorded, not changed in C2):**
1. **Contact creation safety.** Some Home & Assets, Bills, Projects and Household Services creation paths still match Contacts by name (`findOrCreateContact`); a targeted review should remove unintended Contact reuse there.
2. **Mobile Task editor.** The Task editor dialog overflows a 320 px viewport independently of the People picker (a focused responsive-layout fix).
3. **Contact directory performance.** The named-reference aggregation was measured in simulated IndexedDB (about 860 ms for 1,500 Contacts and 15,000 records) but not at scale in a real browser; monitor before adding caching.
4. **Contact creation cancellation.** A Contact created from a Task or Calendar editor persists even if that editor is cancelled; possible future UX review.
C3 and Family F4 remain separate future phases.

**Still not done:** real-device, screen-reader, Safari and Firefox acceptance; two physical devices (the cross-device cases are the real `SyncEngine` tests).
