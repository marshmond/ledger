# Ledger U2: Contact creation identity safety (report, 2026-11-10)

**Status: BUILT AND TESTED LOCALLY. UNSTAGED, UNCOMMITTED, NOT PUSHED, NOT DEPLOYED. AWAITING INDEPENDENT CHATGPT REVIEW. NOT REAL-DEVICE TESTED.** A passing test run does not authorize release.
All names, numbers and records in this document, in the tests and in the browser check are invented.

---

## 1. Summary (plain words)

- Before U2, four modules could attach a record to an existing person or business **just because a typed name matched**: Home & Assets (three forms), Bills & Subscriptions, Projects (vendors and commitments) and Household Services (arrangements, visits, "Replace provider"), and their Quick Add lines. If you had two different "Sam Example" contacts, the app could quietly pick the wrong one, or merge a new one into an old one.
- Now a Contact is chosen in one of only two ways: **by its own id** (picked from a menu where two same-name Contacts read differently), or **created on purpose**. If you type a name that is already taken, nothing is created: every match is listed with its details, each has "Use this contact", and a separate Contact needs the tick "This is a different person or organization with the same name".
- Quick Add (`bs …`, `hs …`) has no moment to choose a Contact, so it **no longer creates, finds or links one**. The provider name is kept as words only, and the preview says so. You can link the right Contact afterwards.
- One shared, tested boundary (`src/core/contactIdentity.ts`) and one small shared screen piece (`src/ui/ContactChoice.tsx`) do this for every form. The old name-matching helper `findOrCreateContact` is no longer called by any application file (it stays, marked deprecated, for older tests).
- **No new table, field, migration, sync or backup format, dependency or backend.** Dexie stays at v15. Family, Calendar, Tasks and the Contacts module were not touched. C2's reference readers and guarded removal were not touched and still work (section 7).
- **Tests: 4,278 passing in 239 files** (released baseline 4,207 in 235: **+71 tests, +4 files**; no test was removed). `npx tsc --noEmit`, `npm run build` and `git diff --check` clean. Browser acceptance in section 10.

## 2. Repository gate (verified before any change)

| Check | Result |
|---|---|
| Repository | `origin` = `https://github.com/marshmond/ledger.git` (`marshmond/ledger`) |
| Branch | `main` |
| Local HEAD = `origin/main` after `git fetch` | Yes: both **`a2cee67fd8a1ddd171d6c4fa0408d1546ac13470`** (`fix(ui): U1 targeted usability cleanup`) |
| U1 committed and pushed | Yes (that commit) |
| GitHub Pages deployed that exact commit | Yes: run **#89**, workflow "Deploy to GitHub Pages", `head_sha` = the U1 SHA, `completed` / `success` (read from the public Actions API with `curl`; the GitHub CLI is not installed here) |
| Working tree | Clean at the start |
| Documents read | `CLAUDE.md`; `docs/CHATGPT-HANDOFF.md` (snapshot, invariants, history, risks); `docs/BACKLOG.md` (newest entries); the C2 report (sections 1 to 9 and the "remaining name-matching creation paths" paragraph); the C1 report (headings, section 5 duplicate-name safeguards and the guard tests it names; **not read line by line**); the U1 report (all) |
| Source inspected | `src/core/{contacts,contactChoice,contactRemoval,contactReferences}.ts`, `src/ui/pickers.tsx` (C2 picker), every file in section 3, the module data layers and their Quick Add definitions |
| Released test baseline | **4,207 tests in 235 files**, taken from the F5/U1 reports (U1 added no tests). **Not re-run on a clean checkout**, as instructed. |
| Branches, remotes, repositories | None created. One dev server (process 11440, started by another session) was already listening on port 5173; I did not start or stop it, and used it through the Browser pane. |

## 3. Complete inventory of the affected creation paths

"Silent name matching" means the old code returned an existing Contact because the name matched (`findOrCreateContact`, or code that did the same comparison).

| # | File and entry point | Took (before) | Where names matched silently | Interactive? | Remediation |
|---|---|---|---|---|---|
| 1 | `assets/AssetForm.tsx` `addNewContact` ("Add contact" under Contacts) | name, phone, email | `findOrCreateContact`; toast said "was already in your contacts, so that contact was used" | Yes | `NewContactNow`: same-name review, "Use this contact" by id, tick to create a separate one |
| 2 | `assets/ServiceForm.tsx` `addContact` ("Add someone new as the provider") | name, phone, email | same | Yes | same |
| 3 | `assets/WarrantyForm.tsx` `addContact` | name, phone, email | same | Yes | same |
| 4 | Contact menus in 1 to 3 (and Projects vendor menus) | id | none (by id), but the menu showed the bare name, so two same-name Contacts read identically | Yes | `contactChoiceLabel` (details plus "1 of 2 with this name") |
| 5 | `bills/data.ts` `resolveProvider` (used by `createObligation`, `editObligation`) | id **or** name | name branch called `findOrCreateContact` | both | boundary: name means "create new"; a taken name throws `SameNameContactError`, nothing written |
| 6 | `bills/ObligationForm.tsx` (provider select, "A new provider…") | id or name | (a) the `typed` name branch above; (b) an effect that **pre-selected** the Contact whose name matched a Finance payee name | Yes | `ContactField`; the effect is removed |
| 7 | `bills/discoveryData.ts` `createFromSeed` (suggestion and Scheduled-item flows) | provider as in 5 | through 5 | Interactive (the form is reviewed) but the seed carried a name | no name is ever resolved; with no Contact chosen, the payee name stays as the bill's provider-name snapshot (words) |
| 8 | `bills/quickAddDef.ts` `commit` (`bs …`) | name from the typed line | `createObligation({ provider: { name } })`; preview said "existing contact / new contact" | **No** chance to choose or confirm | `provider: null`; the name stays in `providerNameSnapshot`; preview says "saved as a name only, no contact linked" |
| 9 | `projects/data.ts` `addNewVendor` + `projects/Vendors.tsx` "New vendor" form | name, role, phone, email | `findOrCreateContact` | Yes | always creates NEW (or refuses a taken name); one transaction with adding it to the project; "Use this contact" calls the existing by-id `addVendor` |
| 10 | `projects/CommitmentForm.tsx` "New vendor…" | name | `findOrCreateContact` at save, in its **own** transaction before the commitment's | Yes | `CommitmentFields.newVendor`: the Contact is made **in the same transaction** as the commitment |
| 11 | `services/data.ts` `resolveProvider` (`createArrangement`, `updateArrangement` assign) | id or name | name branch | both | boundary, as 5 |
| 12 | `services/ArrangementForm.tsx` | id or name | the same-name hint said "will be used" | Yes | `ContactField` |
| 13 | `services/changes.ts` `applyLifecycle` replace + `Dialogs.tsx` "Replace provider" | id or name | through 11 | Yes | `ContactField` (the current provider is left out of the menu); a refusal leaves the old arrangement active and creates no successor |
| 14 | `services/visits.ts` `logStandaloneVisit` + `VisitDialogs.tsx` `OneOffDialog` | id or name | through 11 | Yes | `ContactField`; new `providerNameOnly` for Quick Add (below) |
| 15 | `services/quickAddDef.ts` `commit` (`hs …` arrangement and `hs visit …`) | name | through 11 | **No** | arrangement: `provider: null`; visit: `providerNameOnly`; no Contact made, found or linked |
| 16 | `household/householdSeed.ts` | name (test seed used by tests only) | through 11 and 5 | n/a | uses the test helper (section 8) |
| 17 | Services "additional contacts" (`extraContactIds`) | no UI creates or edits them (the arrangement form passes the stored ids through unchanged) | none | n/a | nothing to fix; a test keeps them unchanged |

**Reviewed and not affected:** Calendar and Tasks (`ContactPicker`, fixed in C2), Family (`createDistinctContact` with explicit same-name confirmation), the Contacts module (`createDistinctContact`), the Calendar Quick Add (`contactIds: []`), Family Quick Add (opens Family's own form), `Vendors.tsx` `VendorEdit` (edits an existing Contact; not creation).

**Not every helper call site can use one UI pattern**, so there are three patterns: (a) a **deferred** choice for forms that save once (Bills, Projects commitment, Household Services: the new Contact is made in the same transaction as the record); (b) a **now** choice for the Home & Assets forms (the Contact belongs to a list the form edits; created when the owner confirms); (c) **no Contact at all** for Quick Add.

## 4. Shared identity strategy

**Core boundary, `src/core/contactIdentity.ts` (new, 68 lines):**
- `resolveContactChoice(d, choice)` turns the owner's choice into an id. `choice` is **either** `{ contactId }` (existing, must still be live; a removed or missing id is an error "That contact no longer exists", never replaced by a same-name Contact) **or** `{ name, phone?, email?, relationship?, confirmedDifferent? }` (new).
- A new name that matches a live Contact (C2's `nameKey`: ignoring case, accents and spacing; never fuzzy; removed Contacts do not count) throws `SameNameContactError` listing every match, **writes nothing**, and does not fill details into the existing Contact. With `confirmedDifferent` it makes a **separate** Contact through C2's existing `createDistinctContact` (not copied).
- The check and the create are one transaction, so a Contact added a moment ago (another tab, a sync) is still noticed. It joins a caller's larger transaction, so a later failure rolls the new Contact back with the record that uses it.
- `findSameNameContacts` (read only, for showing the owner), `hasContactChoice`.
- An id beside a name always wins; a name never selects.

**Module data layers.** Bills' and Services' `ProviderInput` is now `ContactChoice` and `resolveProvider` is a one-line call to the boundary (the two copies of the old code are gone). The field called `name` is kept, but it now only ever means "create a new Contact"; a caller that wanted a lookup gets a refusal, never the wrong Contact. Projects: `addNewVendor` and a new `CommitmentFields.newVendor` use the same boundary.

**Shared screen piece, `src/ui/ContactChoice.tsx` + `contactChoice.css` (new):** `ContactSelect` (menu by id, "(contact removed)" kept selected for a missing id), `NewContactBox` and its pure `NewContactBoxView` (fields, same-name warning, "Use this contact", the tick, Cancel), `ContactField` (menu plus new, deferred), `NewContactNow` (immediate), `PendingNewContact`. It reuses C2's `contactChoiceLabel`, `contactBrief`, `sharedNameIds`; it adds no new labelling rules. Plain wording: "Use existing contact", "Create new contact", "This name already exists", "This is a different person or organization with the same name".

**Retiring `findOrCreateContact`:** no application file calls it; it stays in `core/contacts.ts` with a `@deprecated` note because older tests (Family guards, `contactEdit`) still reference it. A test pins that no application file uses it. It was not removed blindly.

## 5. Changes by module

**Home & Assets** (`AssetForm`, `ServiceForm`, `WarrantyForm`): menus show details, so same-name Contacts differ; "Or create a new contact" opens the box; a taken name shows the matches; "Use this contact" adds/chooses the existing one by id; the tick creates a separate one. Contact roles and provider ids on stored records are untouched by an unrelated save (tested for assets and warranties, including a removed Contact). Small CSS: `.as-line` columns may shrink (`minmax(0, 1fr)`) so a long menu entry cannot widen the form.

**Bills & Subscriptions** (`ObligationForm`, `data.ts`, `ObligationPage`, `quickAddDef`): one `ContactField`. An unchanged choice sends `provider: undefined` (the stored Contact is left alone); "No provider" clears it; a new Contact is made in the same transaction as the bill (`createObligation` was already one transaction over `contacts`). The old effect that pre-selected a Contact because a Finance payee name matched is removed. The bill page says "(name only, no contact linked)" for a name-only provider. No financial calculation, amount, payment state, recurrence or due-provider code changed.

**Projects** (`CommitmentForm`, `Vendors`, `data.ts`): the commitment's vendor is a `ContactField`; the new vendor is made in the **same transaction** as the commitment (it used to be a separate step before it). The Vendors list "Create a new vendor contact" uses the box; `addNewVendor` makes the Contact and adds it to the project in one transaction. One small correction beyond the brief: **saving a commitment whose stored vendor was removed since no longer fails** (the stored id is kept; only a change to another removed Contact is refused), matching how Home & Assets already treats a removed provider. No project status, budget, timeline or commitment amount changed.

**Household Services** (`ArrangementForm`, `Dialogs` Replace provider, `VisitDialogs` one-off, `data.ts`, `visits.ts`, `ArrangementPage`, `quickAddDef`): `ContactField` in the three dialogs; a refused Replace leaves the old arrangement active and makes no successor; the arrangement header says "(name only, no contact linked)" for a name-only provider (it used to say "No provider yet", hiding the name). `logStandaloneVisit` gains `providerNameOnly` for Quick Add. The "similar visit" warning now also compares the provider name when neither visit has a Contact (otherwise every Contact-less same-day visit would look alike). Cadence, tasks, Calendar and the 12-month recurring visibility are untouched.

## 6. Automated and discovery-style flows (decision)

- **Quick Add (Bills `bs`, Services `hs` and `hs visit`):** there is no moment to choose a Contact or confirm a same-name one. Decision: **keep the provider name as words only** (`providerNameSnapshot`, which the existing model already allows with no `providerContactId`) and **link nothing**. The preview line reads, for example, "U2 Sam (saved as a name only, no contact linked; a contact with this name exists, link the right one afterwards)". A one-off visit has no editable provider (by the existing S2 design), so a Quick Add visit stays name-only; Services' spend views already group name-only providers by name. Unrelated creation is never blocked.
- **Bills discovery ("create from this suggestion" and from a Scheduled item):** the form is reviewed, but it used to default to "A new provider" with the Finance payee name and silently picked a same-name Contact. Now it starts with no provider, shows "Provider name kept as words only: …", and if you pick nothing the payee name is saved as the snapshot (so payee matching for future suggestions keeps working through the existing `namesOfBill`). Linking a Contact is a choice you make.
- Nothing invents a Contact id, merges providers or rewrites stored references.

## 7. C2 reference and removal compatibility

- Stored fields are unchanged (`asset.contacts[]`, `service/warranty.providerContactId`, `obligation.providerContactId`, `arrangement`/`visit.providerContactId` and `extraContactIds`, `project.vendorContactIds`, `commitment.vendorContactId`). `contactReferences.ts`, `contactRemoval.ts`, `contactUsage.ts` and the seven module readers were **not edited**.
- Tests (`u2-data.test.ts`): records written through the U2 paths are found by the C2 named readers, **per Contact** (two same-name Contacts: one is used by four modules, the other only by one bill, and each reader row belongs to the right one); a Contact used by a U2-written record is **not removable** (`planContactRemoval` not eligible); an unused one still is; a refused same-name creation leaves no stray unused Contact. The C2 suites (references, removal, sync, picker, UI) all pass unchanged in the full run.
- The cross-device recovery path ("Removed contacts that are still in use" with Restore) is C2 code that U2 does not touch; its two-device proof (`c2-sync.test.ts`) passes. U2 adds nothing to it.

## 8. Tests

**New (71 tests, 4 files):**
- `src/core/contactIdentity.test.ts` (17): the shared boundary, once, thoroughly: existing by id; two same-name Contacts; an id beats a name; missing/removed; free name; taken name in several spellings (nothing created, existing Contacts byte-identical, matches listed); confirmed-different makes a separate one; removed twin ignored; never fuzzy; bad input; overlapping requests make one; joins and rolls back with a larger transaction; the small helpers; the test helper is imported only by the test seed.
- `src/modules/contacts/u2-data.test.ts` (28): per writer pattern, not per form. Bills (by id; refusal writes nothing; atomic create; unrelated edit and same-Contact edit leave the Contact alone; switching to a same-name new Contact refused; removed Contact keeps its id; "No provider"; Quick Add; discovery path), Projects (by id; new vendor atomic with the commitment; refusal writes nothing; failed commitment leaves no stray Contact; edit and removed vendor; `addVendor`), Services (create/edit/assign/replace/one-off visit/removed provider/Quick Add), Home & Assets (contact roles, warranty, service, the create step), C2 compatibility (three tests).
- `src/modules/contacts/u2-ui.test.tsx` (20): the shared pieces as drawn (static markup, the C1/C2 technique): menu by id, labels that differ, "(contact removed)" selected, exclusions, labelled fields and buttons, the same-name warning (every match, distinguishable buttons, tick gates creation, singular/plural, announced), the pending line, helpers, and guards on the code (every form uses the shared choice; none compares names or writes `contacts` directly; Quick Add commits pass no provider choice; no application file uses the old helper; the Bills form has no name-matching effect).
- `src/modules/contacts/u2-sync.test.ts` (6): section 9.

**Existing tests changed (deliberately; 24 test files plus the shared seed, none loosened):** many older fixtures built several records for "Rosa's Cleaning" and silently relied on name reuse. Those now call a **test-only** helper `providerNamed(d, name)` (`src/core/contactTestkit.ts`, imported by no screen or data layer) that returns the explicit id; tests whose point was name reuse were rewritten to assert the new behavior (a taken name is refused; by id works; confirmed-different is separate): `bills/data.test.ts`, `bills/b31-discovery-data.test.ts`, `projects/projects.test.ts`, `services/services.test.ts`; Quick Add expectations in `bills/hooks.test.ts` and `services/visits-hooks.test.ts`; the C2 pin in `contacts/c2-picker.test.tsx` now asserts that **only** `core/contacts.ts` mentions `findOrCreateContact`. The rest are fixture-only edits (`b2/b3/b31-data`, `b5-data`, `householdSeed`, and the services files listed in section 12).

**Mutation check:** I temporarily changed the boundary to return the first same-name match; 14 of the new tests failed; I restored it (verified).

**Regression runs:** affected suites (Bills, Services, Projects, Home & Assets, Household, Contacts, core) repeatedly until green (2,350 tests); `npx tsc --noEmit` clean; `npm run build` succeeds (the existing chunk-size warning is unchanged in kind); `git diff --check` clean (only the usual LF/CRLF notices).

**Full-suite decision:** a full `npm test` was run **once**, at the end, because a shared boundary changed and 24 older test files and a shared fixture seed (also used by `src/lib/*` tests) were edited. Result: **4,278 passed, 0 failed, 239 files.**

## 9. Sync and backup verification (real engines)

`u2-sync.test.ts`, on Ledger's real `SyncEngine` with two devices and the real backup code. The storage and sync formats are unchanged, so this is a focused check, not the whole backup suite.
- A Bills provider made on device A and a Services provider made on device B, **both named "Sam Example"**, stay two Contacts on both devices; each record keeps its own id; the C2 readers give each record to its own Contact.
- After both devices have synced, typing that name again is **refused on either device** (the boundary sees the other device's Contact).
- Editing an unrelated field of a bill on B keeps its Contact id on both devices; no second Contact appears.
- A project with a confirmed-different same-name vendor: both vendor ids and both commitments' vendors survive sync.
- A plain backup restores two same-name Contacts as two, with the bill, arrangement and commitment still pointing at their ids, no duplicate made, and a typed same name is still refused (both matches found).
- A Quick Add result (name only, no Contact) survives a backup exactly: still no Contact and no invented id.
Not repeated: the encrypted backup (same format; covered by C2's test) and the race of a removal against a new reference (C2's test; unchanged code).

## 10. Browser results

Built-in Browser pane (its own profile, not the owner's Chrome), the dev server already running for this folder, invented records prefixed "U2 " (two Contacts named "U2 Sam", a project, an asset, a bill, an arrangement). The pane's profile already held invented records from earlier phases; I left those alone and, at the end, removed only my own (contacts back to 9, records back to 26).

| Path | 375 px | Result |
|---|---|---|
| **Bills**: menu | yes | Provider menu lists the two Contacts as two options with different values and labels ("plumber · 555-0101 · added … 1 of 2 with this name", "school coach … 2 of 2") |
| Bills: typed taken name | yes | Typing "u2 sam" and pressing Enter shows "This name already exists" with every match and one "Use this contact" each; "Add as new contact" is disabled |
| Bills: Cancel | yes | After ticking and adding, pressing Cancel on the form left the bill and Contacts unchanged (no Contact created; the bill still had no provider) |
| Bills: existing by id | yes | Choosing the school coach and saving stored that exact id; still two "U2 Sam" Contacts |
| Bills: reopen and distinct creation | yes | Reopening showed the stored id selected; with the tick, a **third**, separate Contact was created on Save and the bill moved to it; the first two Contacts' stored rows were unchanged (created = updated time) |
| Bills: Quick Add | 320 | `bs … with U2 Sam`: the preview says "saved as a name only, no contact linked; a contact with this name exists…"; after Add the bill had no Contact id, snapshot "U2 Sam", Contact count unchanged |
| **Projects**: commitment | yes | Vendor menu showed the three same-name Contacts distinctly; saving stored the chosen id and added it to the project's vendors once; editing, then typing a taken new-vendor name showed all three matches and a disabled create button; "Use this contact" only picked by id; Cancel left the commitment's title, vendor and updated time unchanged |
| **Household Services** | yes | Edit arrangement: menu distinct; a taken name showed matches, and Cancel left the arrangement unchanged; a new unique name showed "New contact to be created when you save", **nothing was created until Save**, then the arrangement held the new Contact's id and the header showed its name |
| **Home & Assets**: asset | yes | Contacts: a taken name showed three matches; "Use this contact" added the school coach **by id** with no new Contact; Save stored `{ contactId, role }`; reopening showed the same id |
| Home & Assets: warranty | yes | Menu distinct and no overflow; "Or create a new contact as the provider" with a unique name created it and chose it (see limitation 1) |

Also checked: **320 px** (Bills form with the warning: dialog 294/294, document 320/320, nothing past the edge, every button 44 px) and **375 px** (dialog 349/349 in the Bills, Projects, asset and warranty forms I measured) in **dark** (320) and **light** (375); **keyboard**: Enter in the name field submits the check, the tab order is Name, Phone, Email, each "Use existing contact …", the tick, Cancel (the disabled button is skipped), Space toggled the tick and enabled the create button; the box is a labelled group, the warning and errors are announced (`role="alert"`), and each "Use existing contact" button has a distinct spoken name. **Console:** no errors after a clean reload and the flows above.

**Defect found and fixed in the browser:** with the longer menu entries, the Bills form grew to 1,032 px wide at 375 (a grid column would not shrink below the longest option). Fixed with `minmax(0, 1fr)` columns and `width: 100%` menus in `contactChoice.css`, and `.as-line` in `assets.css`; re-measured (349/349).

**Not browser-tested:** "Replace provider", the one-off visit dialog, the Home & Assets service form and the Vendors "Create a new vendor contact" box individually (they use the same tested boundary and view; markup and data paths are covered by tests); Services Quick Add (data and preview text are tested; I ran the Bills one); light theme at 320; a real phone; a screen reader.

## 11. Known limitations and judgment calls (please review)

**Limitations**
1. **Home & Assets forms create the Contact when you confirm it, not when you save the asset.** If you then cancel the form, that new Contact stays (I saw this in the browser). This is the old timing (those forms always did it), it is visible (a toast says it was created), and C2's guarded removal can take an unused one away. Making it atomic would need the asset, service and warranty save functions to accept a new Contact; I judged that a disproportionate redesign. Bills, Projects commitments and Household Services forms **are** atomic (one transaction).
2. A Quick Add bill, arrangement or one-off visit stays **name-only** until you link a Contact (bills and arrangements can be edited to link one; a visit's provider cannot be edited by existing design). Name-only providers do not appear on the Contact's "where used" page or the Services provider page (those read stored ids), by design: no identity is guessed.
3. In deferred forms, if a same-name Contact appears between your check and Save (another tab or a sync), Save is refused with a message and nothing is written; press Change on the new contact to review the matches.
4. A Contact removed elsewhere that a record still points at is shown as "(contact removed)" and kept; you can choose another Contact deliberately. Home & Assets and (now) Projects let you edit other fields meanwhile; Bills and Services already did.
5. Not real-device tested; no screen reader used.
6. `findOrCreateContact` still exists (deprecated, tests only).

**Judgment calls**
1. Kept the field name `name` on `ProviderInput` but redefined it as "create new, refuse a taken name" instead of renaming it, to keep the change small and impossible to misuse as a lookup.
2. Quick Add keeps the provider as words only (rather than blocking or opening the form), so unrelated creation is never blocked and no identity is invented.
3. The Bills form no longer pre-selects a Contact from a Finance payee name; with nothing chosen, the payee name is saved as the snapshot.
4. Deferred (same-transaction) creation where the form saves once; immediate creation in the three Home & Assets forms (limitation 1).
5. Existing menus now show details for every Contact (not only for same-name ones in some places), reusing C2's labels; entries are longer, hence the layout fix.
6. A removed stored vendor no longer blocks editing other commitment fields (small behavior change in Projects, in line with Home & Assets).
7. Test fixtures use a test-only helper rather than a production "reuse by name" switch.
8. The "similar visit" warning compares provider names for Contact-less visits.
9. Pages say "(name only, no contact linked)" for such providers instead of hiding the name or implying a link.

## 12. Files changed

**New (application):** `src/core/contactIdentity.ts`, `src/ui/ContactChoice.tsx`, `src/ui/contactChoice.css`. **New (test support):** `src/core/contactTestkit.ts` (tests only). **New tests:** `src/core/contactIdentity.test.ts`, `src/modules/contacts/u2-data.test.ts`, `u2-ui.test.tsx`, `u2-sync.test.ts`.
**Edited (application):** `src/core/contacts.ts` (deprecation note only), `assets/{AssetForm,ServiceForm,WarrantyForm}.tsx`, `assets/assets.css`, `bills/{data,discoveryData,ObligationForm,ObligationPage,quickAddDef}.ts(x)`, `projects/{data.ts,CommitmentForm.tsx,Vendors.tsx}`, `services/{data,visits,quickAddDef}.ts`, `services/{ArrangementForm,ArrangementPage,Dialogs,VisitDialogs}.tsx`.
**Edited (existing tests/fixtures):** `contacts/c2-picker.test.tsx`; `bills/{data,hooks,b2-data,b3-data,b31-data,b31-discovery-data}.test.ts`; `projects/projects.test.ts`; `household/{householdSeed.ts,b5-data.test.ts}`; `services/{services,visits,visits-hooks,visits-correction,undo-guard,b30a-upcoming,corrections-estimates,corrections-spend,payments,s4-assets-projects,s4-calendar,s4-contract,s4-handoff,s4-misc,s5-overview}.test.ts`.
**Docs:** this report, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.
**Not changed:** `package.json`, the lockfile, `src/db.ts` (Dexie v15), any sync or backup file, `contactReferences.ts`, `contactRemoval.ts`, `contactUsage.ts`, the seven module readers, `ui/pickers.tsx` (C2 picker), Calendar, Tasks, Family, the Contacts module, any Finance file, `.github`.

## 13. Git status (exact, at the end of the batch)

Branch `main`, base `a2cee67` (= `origin/main`). **Nothing staged, committed or pushed.**
`git status --short`: **47 modified** (45 under `src/`: 21 application/CSS/seed files and 24 test files; plus `docs/BACKLOG.md` and `docs/CHATGPT-HANDOFF.md`) and **9 untracked**:
```
?? docs/CONTACT-IDENTITY-U2-REPORT-2026-11-10.md
?? src/core/contactIdentity.test.ts
?? src/core/contactIdentity.ts
?? src/core/contactTestkit.ts
?? src/modules/contacts/u2-data.test.ts
?? src/modules/contacts/u2-sync.test.ts
?? src/modules/contacts/u2-ui.test.tsx
?? src/ui/ContactChoice.tsx
?? src/ui/contactChoice.css
```
`git diff --cached` is empty (nothing staged). `HEAD` = `origin/main` = `a2cee67fd8a1ddd171d6c4fa0408d1546ac13470`. `git diff --stat` on tracked files: 47 files, 365 insertions, 388 deletions.

## 14. Recommendation

**Release after independent review.** The risk is moderate (identity-writing code in four modules, 24 older test files adjusted), but it is covered by a shared boundary tested once and thoroughly, a mutation check, per-pattern integration tests, a real two-device sync check, a full green run, and a real-browser pass. Reviewer focus: (a) section 11 limitation 1 (Home & Assets creating the Contact at confirmation) and whether it is acceptable; (b) judgment call 2 and 3 (Quick Add and Finance-payee names stay as words, unlinked); (c) the edited older tests (section 8): confirm each fixture edit only makes a shared provider explicit and no assertion was weakened; (d) the small Projects change for a removed vendor (judgment call 6).

**Scope statement.** U2 closes the **known** unsafe name-based Contact creation and reuse paths listed in section 3 (every non-test call of `findOrCreateContact` is gone and a test pins that). It does **not** claim universal Contact identity safety: paths not in the inventory were not reviewed, and name-only providers are a deliberate, visible state. Traditional C3 CRM stays deferred. **Next planned initiative: Ledger UI design discovery**, not started.

## 15. Final release verification (2026-11-10)

ChatGPT approved U2 for focused release verification. No code or test file was changed during this step, so no tests were re-run (the 4,278-test run, `tsc` and build from section 8 apply to the committed content).

- **Gate:** branch `main`; local HEAD = `origin/main` = `a2cee67fd8a1ddd171d6c4fa0408d1546ac13470`; Pages run #89, attempt 1, `completed`/`success` for that SHA; nothing staged; the tree held only the reviewed U2 files (47 modified, 9 new); `git diff --check` clean (only the LF/CRLF notices); `git diff --stat` small (365 insertions, 388 deletions), so no line-ending churn.
- **Boundary inspected** (`contactIdentity.ts`, `ContactChoice.tsx`): existing Contacts are selected by id and must be live; a name only ever means "create new"; a taken name throws `SameNameContactError` unless confirmed; check and create are one transaction that joins the caller's, so a failed owning save rolls the new Contact back (tested for Bills, Projects commitments, Services); a missing or removed id is an error, never replaced by a same-name one; same-name menu entries carry details and "n of m with this name". The only non-test `findOrCreateContact` hit is its deprecated definition. `contactTestkit` is imported by no screen or data layer (only the test seed `householdSeed.ts` and tests).
- **Write paths:** Bills (unchanged choice sends no provider change; payee name kept as words), Projects (`createCommitment`/`saveCommitment` run in one transaction over `moduleRecords` + `contacts`; a removed stored vendor keeps its id and only a change to another removed Contact is refused), Household Services (a refused Replace leaves the old arrangement active and creates no successor: tested), Home & Assets (Contact created when confirmed; limitation documented and visible via a toast).
- **Existing test diffs:** every removed assertion was replaced by its explicit-id or refusal counterpart (reuse tests now assert the refusal, the by-id choice and the confirmed-separate Contact); the "not listed twice" vendor assertion is kept in the new test; the C2 pin now asserts only `core/contacts.ts` mentions the helper. No meaningful regression test was lost; no correction needed.
- **Quick Add:** Bills and Services store the provider name as `providerNameSnapshot` with no Contact id, previews say "saved as a name only, no contact linked", records are still created, and schedules, billing and recurrence code are unchanged. **A one-off visit's provider cannot be edited after creation (existing S2 design), so a Quick Add visit stays name-only.**
- **C2:** reference readers, removal code and usage code are unchanged; U2 records keep recognized fields; referenced Contacts cannot be removed; same-name Contacts stay distinct after sync; backup keeps ids and name-only records (`u2-data.test.ts`, `u2-sync.test.ts`, unchanged C2 suites).
- **Limitations retained:** Home & Assets immediate creation; name-only Quick Add providers need explicit later linking; the deprecated helper stays for legacy tests; not real-device tested; not every Contact-related workflow has been audited. C3 CRM stays deferred; Ledger UI design discovery is next.
