# Family Management F1: household-member foundation and Contact integration

**Date:** 2026-11-09. **Status:** APPROVED WITH FINAL RELEASE CHECKS by independent review; release checks passed (section 12) and the batch was committed and pushed as `feat(family): F1 household member foundation` (the commit SHA and the Pages run result are recorded in the git history and the Actions tab, and in the owner hand-off message, not here, so no second commit is needed). Sections 1 to 11 below are the pre-release report and are kept as written (including the "uncommitted" git status in section 10). Not tested on a real device or with a screen reader. F2 to F5 and the Family Command Station are not started.
**All names, dates and notes in code, tests and this report are invented.**

## 1. Summary

A new **Family** module (`#/family`, `#/family/m/<id>`) lists household members and shows one profile page per member. Each member is a small record in the existing `moduleRecords` table (module `family`, kind `member`) that **points at one shared Contact**; the name always comes from the Contact. Adding a member makes the person choose, explicitly, between **using an existing Contact** (never changed) and **creating a new, separate Contact** (never matched by name). No new table, no Dexie version change (still 15), no dependency, no backend, no change to Calendar, Tasks, Projects or Finance.

Gate (verified first): repository `marshmond/ledger`, branch `main`, `HEAD` = `origin/main` = `ba4da59eb891e7c4696c63c11a76677f0905931e`, ST-S5.1 committed, Pages run **#79** `completed` / `success` for that commit (read from the public Actions API in this session), baseline 3,622 in 200 files, tree contained only the F0 documents, no `src/modules/family` existed.

## 2. Files changed

New, `src/modules/family/`: `model.ts` (pure model, validation, defensive reader, duplicate grouping), `data.ts` (load, create, update, status), `references.ts` (read-only "who points at this contact" reader), `MemberForm.tsx`, `OverviewPage.tsx`, `MemberPage.tsx`, `FamilyModule.tsx` (screens, loaded on demand), `index.tsx` (registration), `family.css`, and five test files.
Edited (small): `src/core/contacts.ts` (+1 export, `createDistinctContact`; existing callers unchanged), `src/modules/index.ts` (register last), `src/modules/moduleStyles.ts` (+1 import), `src/lib/backupSummary.ts` (Family label and group), `src/modules/lazyBoundary.test.ts` (ten modules instead of nine).
Docs: this report, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. `docs/module-hooks.md` not changed (registration rules did not change; Family follows them). README not changed.

## 3. Member model and storage

`moduleRecords` row, `module: 'family'`, `kind: 'member'`, id from the store (time-based). Fields: `contactId` (required), `role` (`parent | child | grandparent | other`), `status` (`active | past`), optional `birthMonthDay` (`MM-DD`), `birthYear`, `color` (one of eight named swatches, same values as the Calendar's), `note` (plain text, at most 300 characters). **No name, phone or email is stored.**
Reading is defensive and lossless: a damaged required field (contact, role, status) makes the row "Needs review" (listed, not editable, never rewritten); a damaged optional field is left out of the view and named, and the stored value stays until the person saves that field again. Fields this version does not know are carried through every edit (tested, including through real two-device sync). Birth year is shown as given; no age is computed anywhere. Feb 29 is a valid birthday; Feb 29 with a non-leap birth year is refused.

## 4. Contact creation and linking

- **Use an existing contact:** a searchable list showing relationship, phone, email, or "added <date>" when there is nothing else, so same-named contacts can be told apart. Linking writes nothing to the Contact (a test compares the stored row byte for byte).
- **Create a new contact:** an intentional choice. If the typed name matches a live Contact (ignoring case, accents and spacing) a warning lists the matches with **Use this one instead**, and saving needs a ticked "This is a different person with the same name". The data function never looks at names at all; the existing name-matching helper `findOrCreateContact` is **not used** by Family (a guard test pins that, and a data test shows it would have merged the two).
- **Atomic:** the new Contact and the member are written in one transaction over `moduleRecords` and `contacts`; a forced failure of the member write leaves no new Contact and touches no existing one (tested). Nothing is ever deleted as part of rollback.
- **The link is fixed.** Editing cannot change `contactId`; the form shows which Contact is linked. A general relink workflow is **not built**; a correction would be a future controlled operation that first shows what points at the old Contact (the reader below).

## 5. Duplicate-member safeguards

- Adding a second member for a Contact that already has an **active** member is refused; adding one for a Contact that only has a **past** member is also refused, with a message to mark the first one active again instead. Three simultaneous saves create one member (tested).
- Marking a past member active is refused while another active member points at the same Contact.
- **Cross-device duplicates** (two devices add the same Contact offline): both records survive real sync; the overview and both member pages show **"Possible duplicate member"** (an alert), listing the records. Nothing is merged, deleted or chosen. The warning clears when the owner marks the extra one as past. Tested with the real `SyncEngine`.
- Only **active** pairs are flagged; a past record beside an active one is normal history.

## 6. Archive behaviour

"Mark as past member" (with a plain confirmation) is a status change **only**: every other stored field, including unknown ones, is written back exactly; the Contact and every Task, Calendar event and Project that names it stay as they are (a test compares all other rows before and after). Past members show under "Past members" and can be brought back. There is no permanent delete in F1.
**Dependency reader** (`references.ts`): read-only, indexed (`[module+kind]` for Tasks, Calendar events, Projects, Family; link indexes for saved links); counts Tasks, events, projects, saved links and other Family records for a Contact; shown on the member page ("used on 3 tasks, 1 calendar event"). A test proves every table is byte-identical after it runs, and a guard bans writes, transactions, storage and network in the file.

## 7. Backup and sync results

- Backup summary names **Family members** under a "Family" heading; unknown Family kinds are still listed ("family records (…)") and never dropped.
- Plain backup and restore: members and their Contacts restore exactly (tested). **Encrypted** backup: the file does not contain the note or the name (tested); restore through the real safety-copy sequence returns everything.
- Real `SyncEngine`, two devices: member, Contact and note arrive; a past-versus-edit conflict converges to one record; the duplicate case above; an unknown field and an unknown Family kind from a "newer build" pass through sync untouched and survive an edit here; an unreadable member row and an unknown kind survive a backup round trip.
- Notes are not in Search, Calendar, Today, any label or message, or any log (guard tests). They are preserved in ordinary backups and encrypted sync like any other record, and a plain backup is not encrypted (the form says so).

## 8. Tests and verification

| Check | Result |
|---|---|
| Family tests | **63 tests in 5 files**: model 19, data 19, sync and backup 8, guards 11, accessibility 6 |
| `npm test` (full, once, plus one rerun after a fix) | **3,685 passed in 205 files** (baseline 3,622 in 200: +63 tests, +5 files). The first full run had one failure: an existing test that scans source for hand-written addresses; I replaced them with a `memberRoute()` helper |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds; Family screens are a separate on-demand chunk of about 23 KB (uncompressed) |
| `git diff --check` | clean (only the usual line-ending notices) |
| Browser (dev server, DOM and script checks) | add flow with a same-name warning, refusal without the tick, separate Contact created, original untouched; note hidden until Show (`aria-expanded` toggles, text absent from the page while hidden); duplicate warning shown, cleared by marking one past; confirm dialog focuses Cancel; **no horizontal overflow at 375 and 320 px** on the overview, member page and form; heading order `h1` then `h2`; every form control has a name |

Not verified: the browser pane was hidden, so **no screenshots could be taken** (checks used the page's own structure and measurements); dark mode was not inspected; no real phone, no screen reader. I left invented test data in the dev browser profile on `localhost:5173` (one extra Contact and two Family records); it is separate from any deployed site.

## 9. Remaining limitations

1. **No screen edits a Contact.** There is no Contacts screen in Ledger, so a member's name, phone and email cannot be corrected anywhere yet. Choosing "Use an existing contact" is the way to link a correctly named Contact.
2. No relink and no permanent delete (by design). A wrong link is fixed by marking the member past and adding the right one.
3. The dependency reader covers Tasks, Calendar events, Projects, saved links and Family records only. Home & Assets and Household Services provider contacts are not included; a future delete or relink must add them first.
4. Past members cannot be re-added; they are reactivated (so there is one history per person).
5. Whole-record last-writer-wins applies: an edit made on two devices keeps one version (the other is in Ledger's conflict list).
6. Nothing in F1 reaches Calendar, Today, Search or Quick Add (by scope). Birthdays are stored but not yet shown anywhere else.
7. Real-device and screen-reader checks remain the owner's.

## 10. Exact Git status (at completion of the report)

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M src/core/contacts.ts
 M src/lib/backupSummary.ts
 M src/modules/index.ts
 M src/modules/lazyBoundary.test.ts
 M src/modules/moduleStyles.ts
?? docs/FAMILY-MANAGEMENT-F0-PLAN-2026-11-09.md
?? docs/FAMILY-MANAGEMENT-F1-REPORT-2026-11-09.md
?? src/modules/family/
```
Nothing staged, committed, pushed or deployed. `HEAD` = `origin/main` = `ba4da59`.

## 11. Recommendation for release

Suitable to review and, if approved, commit as one batch. Risk is low: no schema, sync, backup-format or dependency change; the only edit to shared code is one additive Contact helper; the module cannot affect Finance. After release, the owner's first real use should be adding one member from an existing Contact on a phone. Do not start F2 until F1 is reviewed; F2 will need the Feb 29 and stored-Birthday-event questions from the F0 plan answered.

**Judgment calls (please review):** (1) one active member per Contact, and a Contact with only a past member is also refused (reactivate instead); (2) only active pairs count as duplicates, so marking one past clears the warning; (3) birth year allowed from 1900 to this year, note limit 300 characters; (4) the Contact helper was added to `core/contacts.ts` rather than inside Family, so it can be reused; (5) the eight colours are listed in Family and pinned equal to the Calendar's by a test, to avoid Family importing Calendar code; (6) the member page shows the birth year as entered but never an age; (7) a status change rewrites the stored row from its raw form, so unreadable optional fields are never lost by archiving.

## 12. Release verification (2026-11-09, after ChatGPT review: APPROVED WITH FINAL RELEASE CHECKS)

**Repository check.** `main`, `HEAD` = `origin/main` = `ba4da59eb891e7c4696c63c11a76677f0905931e` (after `git fetch`), Pages run #79 `success` (public Actions API). The working tree held exactly what section 10 lists (7 modified files, the F0 plan, this report, `src/modules/family/`); no unrelated change or extra commit.

**Browser acceptance** (dev server; a **disposable browser profile**: a separate storage origin `accept.localhost:5173`, empty at the start, seeded with invented contacts "Sam Example" and "Pat Sample", one invented Task and one invented Calendar event naming Sam; deleted afterwards). Results:

| # | Check | Result |
|---|---|---|
| 1 | Family is in the module dropdown (link `#/family`) and opens at `#/family` | PASS |
| 2 | Added a member by choosing an existing Contact | PASS |
| 3 | Contacts, Tasks, Calendar events, links, transactions and accounts compared before and after as stored text | PASS, identical |
| 4 | Added a separate Contact whose name matches ("sam  example"): refused without the tick, with the warning showing the existing Sam and "already a member"; created after ticking | PASS |
| 5 | The two Contacts stay distinct; the original Contact is byte-identical; no merge | PASS |
| 6 | Edited role, birthday (29 February), colour and note | PASS (the link shown as fixed; no contact picker in edit) |
| 7 | Note not in the page before Show (searched the page's HTML); "Hidden" shown; Show reveals, Hide hides again | PASS |
| 8 | Marked past (confirmation focuses Cancel; moves to "Past members") and reactivated | PASS |
| 9 | After past and reactivate: the Contact, the Task and the event are byte-identical; Family row keeps every other field | PASS |
| 10 | Overview, member page, edit form, add form (existing and new-contact modes) at **320 and 375 px** | PASS: no horizontal overflow, no page-width dialog overflow |
| 11 | Same screens in **light and dark** (4 combinations, 5 screens each): text contrast measured against its real background, small touch targets, focus ring, screenshots of dark overview with the duplicate alert and light add form | PASS: no text below 4.5:1 (3:1 for large text); duplicate-alert heading 6.32:1 light and 9.4:1 dark; keyboard focus shows a solid 2 px accent outline; readable in screenshots |

**Correction made (one, minor).** In the first run the member-name links in the overview were 32 px high and "All family members" 28 px high at phone width (above the app's 24 px floor, below the 44 px used for main actions). Added `min-height: 44px` for those two at 480 px and below (`family.css`, `MemberPage.tsx` class `fm-back`); rerun on all four size and theme combinations: none under 36 px.

**Integrity and regression (automated, all in the suite):** identity is Contact-based; no name-matching helper is used by Family (guard test); atomic create (forced member-write failure leaves no orphan); a second active member is refused (also three simultaneous saves create one); cross-device duplicates are preserved and flagged with the real SyncEngine; unknown fields survive edits, archive, sync and backup; the dependency reader and the defensive reader write nothing (tables byte-identical); members survive plain and encrypted backup/restore and sync; no Finance, Calendar, Task or Project row changed by ordinary Family operations (before/after comparison); no schema change (Dexie 15), no sync-format change, no new dependency.

**Final run, once:** `npm test` **3,685 passed in 205 files**; `npx tsc --noEmit` clean; `npm run build` succeeds; `git diff --check` clean.

**Known limitations (kept documented).** No Contact-editing screen yet (a member's name, phone and email cannot be corrected anywhere); no general Contact-relinking workflow; no permanent Family deletion; no Calendar birthdays until F2; no Family Tasks, Search, Quick Add or overview integrations yet; the dependency reader excludes Home & Assets and Household Services provider contacts; real-phone and screen-reader testing remain owner acceptance items. **Backlog item added (future usability enhancement, NOT a prerequisite for F1 and NOT built):** *Family profile Contact editing: provide a safe, explicit way to correct a member's shared Contact details, without creating a duplicate identity or changing unrelated Contacts.*
