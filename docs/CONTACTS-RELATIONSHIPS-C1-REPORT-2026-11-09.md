# Contacts & Relationships C1: central directory, safe editing, Spouse and "This is me"

**Date:** 2026-11-09. **Status: BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. AWAITING INDEPENDENT CHATGPT REVIEW.** A passing test run does not authorize release. N1, C2, C3 and Family F4 are NOT started.
**All names and numbers in this document and in the tests are invented.**

---

## 1. Summary

- New module **Contacts & Relationships** (`contacts`, `#/contacts`, `#/contacts/c/<id>`), the eleventh module, registered last, screens loaded on demand. It works directly on the existing shared `contacts` table: **no new table, field, migration, sync or backup format, dependency or backend.**
- **Directory** (search by name, relationship, phone or email; A to Z and recently changed; same-name marker; where-used summary), **detail page** (four details, `tel:`/`mailto:` links, added/changed dates, where-used counts, Edit), **create** (`createDistinctContact` only, same-name warning plus explicit tick, "Open this one") and **safe edit** (no-op saves write nothing, stale-edit refusal, rename warning, honest note about name copies).
- **Usage reader** `src/core/contactUsage.ts`: one read-only pass; numeric-match counts per module; honestly labelled as a usage guide, not a relationship graph.
- **Global Search**: Contacts source (name and relationship only). The Tasks "Contact" hit is relabelled "Tasks for contact".
- **Family**: `spouse` role; optional explicit **"This is me"** designation with a deterministic, non-destructive cross-device conflict rule.
- **Module selector**: CSS-only height limit so the eleven-item list scrolls on short screens.
- **Tests:** 3,960 passing in 223 files (released baseline 3,879 in 216: **+81 tests, +7 files**). `npx tsc --noEmit`, `npm run build` and `git diff --check` clean. Browser acceptance: all 15 items checked (section 11).

## 2. Release gate (verified before any change)

| Check | Result |
|---|---|
| Repository | `origin` = `https://github.com/marshmond/ledger.git` |
| Branch / HEAD | `main`; local HEAD = `origin/main` (after `git fetch`) = **`0469af66c7e07d5710711b32310f03bd5fa4cb70`** (F3) |
| F3 deployed | Public Actions API: run **#83**, `head_sha` = `0469af6…`, `completed` / `success` (`gh` is not installed; read with `curl`) |
| Tree before C1 | Only `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md` (C0 edits) and the untracked C0 plan; preserved |
| Family and Contact safeguards | Present: `createDistinctContact`, the three Family guard tests (no `findOrCreateContact`, no `updateContactDetails`, no picker) all still pass after C1 |
| Released baseline | 3,879 in 216 files (documented; the full suite re-run at the end of C1 includes every earlier test, all green) |

Not re-run on the clean checkout before starting (the C0 session already did, same SHA, nothing committed since).

## 3. Files changed

**New (application):** `src/core/contactUsage.ts`; `src/modules/contacts/{index.tsx, ContactsModule.tsx, DirectoryPage.tsx, ContactPage.tsx, ContactForm.tsx, model.ts, searchSource.ts, contacts.css}`.
**Edited (application):** `src/core/contacts.ts` (safe update, `StaleContactError`, `sameNameMatches`); `src/modules/family/{model.ts, data.ts, MemberPage.tsx, OverviewPage.tsx}`; `src/modules/index.ts` (register last); `src/modules/moduleStyles.ts` (one import); `src/modules/tasks/searchSource.ts` (one label); `src/styles.css` (one rule).
**New tests:** `src/core/contactEdit.test.ts` (12), `src/core/contactUsage.test.ts` (10), `src/modules/contacts/{contacts-directory (16), contacts-guards (13), contacts-a11y.tsx (5), contacts-sync (8)}.test.*`, `src/modules/family/family-c1.test.ts` (17).
**Edited tests (expected one-line updates):** `lazyBoundary.test.ts` (eleven modules, search source list), `search.test.ts` (new Tasks label), `lib/readOnlyTrap.test.ts` (search sources 9 to 10; this also proves the new Contacts source performs no write).
**Docs:** this report, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`. C0 and Family F0 to F3 reports untouched.

## 4. Contact directory and editing behaviour

- **Directory:** one list read plus **one** shared usage read for the whole list (not a scan per row). Rows show name, relationship, phone/email, "Same name as n other contact(s)" and "Used in Family, Tasks and Calendar". Search: every word must match name, relationship, email or phone (case and accent folding; a phone also matches by digits alone). Sorting is stable.
- **Detail:** name, relationship, phone and email (`tel:` keeps digits and `+` only; `mailto:` only for an address that passes the form's own email check and is encoded), added and last-changed dates, same-name notice with distinguishing details, where-used counts, Edit. Empty fields read "Not recorded". **Notes are neither read, shown nor written** (a guard test pins it); the existing `notes` value and unknown fields are preserved on every edit.
- **Rename explanation:** the edit form states that saving changes the one shared contact and, when the name changes, that provider names saved on past bills and service visits and birthday event titles already created are not rewritten. The detail page says the same. Nothing historical is rewritten.
- **`updateContactDetails`** (extended, still used by Projects and Services):
  - **Stable identity:** id, `createdAt`, unknown fields, `notes` and unrelated rows are preserved (test: unrelated Contact and the referencing Task row byte-identical).
  - **No-op save writes nothing** (database byte-identical, no new `updatedAt`). Returns `{ changed }` (was `void`).
  - **Stale-edit protection** (optional `expected`): inside the same transaction the stored Contact is compared with the version the form loaded; on a difference it throws `StaleContactError` and writes nothing. Two simultaneous saves from one opened version leave exactly one winner (test). The form shows the message and a **"Reload the current details"** button.
  - Callers that pass no `expected` behave as before (their existing tests pass unchanged).
- **Removal:** none. No deletion, archive, merge, tag, type, new field or notes UI.

## 5. Duplicate-name safeguards

- Creation uses **`createDistinctContact` only**; a guard test fails if the module ever references `findOrCreateContact`, `ContactPicker` or the pickers file.
- Same name (the established `nameKey`) when adding, or when renaming to another Contact's name: a warning lists each match with relationship, phone/email, added date and its "Used in" summary, an **Open this one** button, and a required tick ("different person or organization with the same name"). Submitting without the tick is refused (checked in the browser). With the tick, a separate Contact is created; the original stayed byte-identical (checked in the browser).
- A pre-existing duplicate does not demand a tick when you edit something else on it (only a rename onto a name does). No fuzzy matching. A matching phone or email is not treated as identity.
- Not changed (known C2 issue): the Calendar and Task `ContactPicker` still reuses a Contact by lower-case name.

## 6. Usage reader and measured performance

`readContactUsage(db, onlyIds?)` walks every live `moduleRecords.data`, live link end, live attachment and due item once, collects whole numbers (and `contact:<id>` text), and counts each live record once per Contact whose id it contains, by `module/kind`. It needs no field names, so a newer field cannot be missed; it can **over**-count (a number equal to an id) but not miss a stored numeric id. Deleted records and deleted Contacts are ignored; an unknown module or kind is still counted (shown under its own id / "record(s)"). Contacts with a short id (below 1e12, not time-based) are flagged `approximate` and the detail page says so.
- **Coverage tested** against the C0 inventory: Tasks, Calendar events, Projects, project commitments, Home & Assets (asset roles, service, warranty), Services (arrangement provider and extra contacts, visit), Bills, Family member and important-contact records, shared links (both ends, number and `contact:<id>`).
- **Not undercounting Family:** on a shared fixture every count of Family's existing reader (tasks, events, projects, links, other members) is matched or exceeded.
- **Read-only:** every table is byte-identical before and after (test); the file has no table write, transaction, storage, network or module import (guard).
- **Performance:** one scan of **1,500 Contacts and 15,000 records took 95 ms** (Node with `fake-indexeddb`; one run, no repeated benchmarking). **Not measured in a real browser's IndexedDB**, which is usually slower per row; so the directory computes once per load and the detail page reads only that Contact. If the owner's real data makes the directory slow, the fallback (summaries only on the detail page) needs no new infrastructure.
- Counts are shown with the wording "a guide to where it is used, not a full list of relationships, and they do not decide whether a contact can be removed". They are not used for any deletion, merge or relink.

## 7. Search integration

`searchContactsData` matches name (and relationship as a search word), shows the relationship as the only subtitle, and opens `/contacts/c/<id>`. Phone, email and notes are never searched or returned (tests; `scanText` is used because ids and timestamps are clock based and can contain digits by chance, which the repository's leak-scan guard caught in my first draft). The Tasks source's Contact hit is now **kind "Tasks for contact"** (it opens a Tasks list), so one person gives one "Contact" result (opens the page) and one clearly different Tasks result. Verified in the browser: Ctrl K, "sam" lists Contacts and Tasks groups; the Contact result opens the right page.

## 8. Spouse

`spouse` added to `ROLES` and `ROLE_LABEL` (order: Parent, Spouse, Child, Grandparent, Other). It appears in the add and edit forms, the member page, the overview card and every validator and defensive reader because they all read the one list. Existing members keep their role; Contact ids and the Contact's own relationship text are untouched (test with a Contact snapshot). It is a Family member relationship, not a Contact type; no configurable types. **Version skew:** a device still running F3 reads a `spouse` record as "needs review" (role not known) until it is updated, and does not alter it (F3's unreadable-row rule). Update every device before using Spouse.

## 9. "This is me" model and cross-device conflict handling

- **Representation:** `isMe: true` on the existing `family/member` data. Stored **only when true**; absent = not me; `false` or a non-boolean reads as off (a non-boolean is named in the member's "could not be read" notes and not rewritten). No new table or record kind. It rides backup and sync like any member field, and an F3 build keeps it as an unknown field.
- **Behaviour:** chosen explicitly on the member page ("This is me" / "Clear"); never automatic, not even for the only or first member. Header and overview card say "This is you". Only an **active** member can be me. Making a member past, or active again, removes the mark (a returning member does not silently become me again). Editing the profile keeps the mark.
- **Local atomicity:** `setMe(id | null)` runs in one transaction: it re-reads every member, removes every other readable member's mark and sets the chosen one, skipping rows already in the wanted state (no needless writes); unreadable rows are never rewritten; Contacts and every non-family table untouched. A concurrent-switch test ends with exactly one mark.
- **Cross-device rule (`effectiveMe`, pure, read-only):** exactly one marked active member = that member is me; **two or more = a conflict and nobody is treated as me** (no guessing from age, order or edit time); none = nobody. Both records are kept; reading never writes. The overview and each involved member page show a warning with "This one is me" buttons (named by member) that resolve it through `setMe`. A past member's leftover mark (older build) is ignored on read.
- **Real two-device `SyncEngine` tests:** one device chooses and the other sees it; two devices choose different members offline: both records and all Contacts survive, both devices converge to identical data, both show the same conflict, nobody is me, looking wrote nothing; resolving on one device leaves exactly one mark on both and it stays resolved; a stale profile edit on one device against a switch on the other is flagged, not silently resolved; Spouse and the mark pass through sync with unknown fields kept.
- **Scope:** not authentication, permission, an account or a data partition; no tablet or sharing field.

## 10. Backup and sync verification

- **Backup (plain and encrypted, real restore sequence):** an edited Contact restores with the same id, created time, notes and unknown fields (a restore re-stamps `updatedAt` by design, so the test compares everything else); the encrypted file shows no names; Spouse and `isMe` restore exactly. No new table (Dexie still v15).
- **Real `SyncEngine` (two devices):**
  - Different fields edited on each device: **one whole version wins on both devices** (Ledger is whole-record last-writer-wins and does not merge fields); the overwritten version is kept in the conflict list with its full content; unknown fields and notes survive.
  - An **unchanged save** is a no-op and cannot overwrite the other device's real edit; no conflict is produced.
  - A stale form is refused after a sync brings the other device's change.
  - Two devices each create the same-named Contact: both are kept, each keeps its own references.
  - A rename keeps the id; Task, Calendar and Family references still resolve on both devices.

## 11. Tests and browser results

**Automated:** `npm test` 3,960 passed in 223 files (95 s); `npx tsc --noEmit` clean; `npm run build` succeeds (the Contacts screens are their own lazy chunk, `ContactsModule-*.js`; the existing "chunk over 500 kB" warning is unchanged); `git diff --check` clean. One earlier full run had two failures (the module-count test in `readOnlyTrap.test.ts` and my own search privacy assertion, see section 7); both fixed; the final run is green. Source-string guard tests are used only for module boundaries; behaviour is tested on real databases, the real sync engine and real backup code.

**Browser** (built-in browser pane, its own isolated profile; it already held invented "Example" data from earlier phases, plus the data I added; Vite dev server stopped afterwards):

| # | Check | Result |
|---|---|---|
| 1 | Module appears in the selector | PASS (11 items) |
| 2 | Directory search (phone digits, relationship) and both sorts | PASS |
| 3 | Same-name create needs the tick | PASS (Enter without the tick was refused with the message; with it, created) |
| 4 | Original Contact unchanged | PASS (record JSON byte-identical before and after) |
| 5 | Edit keeps identity | PASS (renamed; same id and created time) |
| 6 | Stale edit rejected | PASS, but **simulated**: I changed the stored Contact behind the open form with a direct database write in the same tab, not with a second real tab or device. Newer value kept, message and Reload button shown, Reload loaded the new values, then the rename saved |
| 7 | Usage summaries | PASS (directory and detail; counts identical before and after the rename: Family 1, Tasks 4, Calendar 4, Projects 2) |
| 8 | Global Search opens the right Contact | PASS |
| 9 | Spouse offered when adding and editing | PASS (saved; page and header read "Spouse") |
| 10 | "This is me": assign, move, clear | PASS (assign, move to another member, clear via the Clear button; stored flags checked each time) |
| 11 | Never two effective "Me" | PASS (a forced two-mark state showed the conflict warning, no "This is you"; "This one is me" left exactly one mark). The forced state was written with a direct database write, so it is a simulation of the two-device case; the real engine case is the automated test |
| 12 | Family, Calendar, Tasks remain linked after a Contact name correction | PASS for Family (member listed under the new name) and Calendar (events show "Also for: <new name>"); Tasks checked by the usage count (4 before and after), **not** by opening the Tasks screen |
| 13 | 320 and 375 px | PASS (no horizontal overflow; no target under 44 px in the Contacts and Family-member screens; the edit dialog with a duplicate-name warning fits at 320). Directory, contact page and edit dialog at 320 px; directory, Family overview and member page at 375 px |
| 14 | Light and dark | PASS for the directory at 320 px dark and 375 px light and desktop light, plus the dark contact page and dialog. **Family screens were not viewed in dark mode** |
| 15 | Eleven-module selector on a short screen | PASS (667 x 300: menu 226 px high with 492 px of content, scrolls, last item reachable) |

Issues found and fixed in the browser: the Add dialog did not focus the Name field (added `autoFocus`); two "This one is me" buttons had identical spoken names (now "<name> is me"); the same-name list on a contact page gave no way to tell contacts apart (now shows relationship, phone/email and added date). Console: no errors. Not checked: any real device, a screen reader, a second real tab or device, Firefox/Safari.
Data I added to the pane's throwaway profile: an accidental extra contact named "sam examplesam example" (my first typed text had landed after all, so the name no longer matched), a same-name "Sam Example", the rename to "Sam Exampel", Spouse on one member and moving the "me" mark (cleared at the end). None of it is in the repository.

## 12. Judgment calls (please review) and known limitations

1. **`updateContactDetails` now returns `{ changed }` and skips no-op saves for every caller**, including Projects and Services. Their unchanged saves no longer re-stamp `updatedAt` (their existing tests pass). Recommended; if the owner wants the old behaviour for those two, the skip can be made opt-in.
2. **The stale token is the loaded Contact (time and the four details), not only `updatedAt`.** The change-tracking hook re-stamps `updatedAt` on every write, so a "strictly newer" time cannot be guaranteed inside one millisecond; comparing the details as well catches a same-millisecond change.
3. **Stale "Reload" discards what you typed** and re-fills the form from the stored Contact (a merge would be guesswork).
4. **Usage counts are numeric matches** (section 6); they may over-count, are not relationships, and short-id Contacts are flagged approximate.
5. **Conflict rule:** two "me" marks mean nobody is me until the owner chooses (no timestamp field added).
6. **A status change clears the "me" mark** (past or returning).
7. **Tasks hit relabelled "Tasks for contact"** (the one Tasks change).
8. **Spouse on an older build reads as "needs review"** until that device is updated.
9. **Whole-record last-writer-wins** means two devices editing different fields of one Contact keep only one version; the other is recoverable from the conflict list (verified), not merged.
10. **Selector limit:** `max-height: calc(100dvh - 72px)` with a `100vh` fallback and `overflow-y: auto`; 72 px is an estimate of the bar height plus gap. No change to order, routes, ids or keyboard behaviour; the grouped selector remains N1.
11. **Scale timing is Node-only** (95 ms); browser IndexedDB timing is unmeasured.
12. **Detail page counts one Contact only** (cheap); the directory reads usage for all Contacts on every load and on every change to those tables (`liveQuery`).
13. **Not built (by scope):** deletion, archive, merge, tags, types, extra fields, notes, history, reminders, named reference lists, ContactPicker redesign, Quick Add for Contacts, Family Calendar/Tasks/Projects changes, F4, N1, Command Station, hosting changes.
14. Existing, unchanged: the Calendar editor still crashes on a null event row (noted in F3); the Calendar and Task pickers merge by lower-case name.
15. Not verified: real-device and screen-reader behaviour; the browser tool listed the dialog's checkbox with the name "on" (likely the tool's own reading, since the label wraps the input and the static-markup accessibility test names it; not confirmed with a screen reader).

## 13. Git status (exact, at the end of the batch)

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M src/core/contacts.ts
 M src/lib/readOnlyTrap.test.ts
 M src/modules/family/MemberPage.tsx
 M src/modules/family/OverviewPage.tsx
 M src/modules/family/data.ts
 M src/modules/family/model.ts
 M src/modules/index.ts
 M src/modules/lazyBoundary.test.ts
 M src/modules/moduleStyles.ts
 M src/modules/search.test.ts
 M src/modules/tasks/searchSource.ts
 M src/styles.css
?? docs/CONTACTS-RELATIONSHIPS-C0-PLAN-2026-11-09.md
?? docs/CONTACTS-RELATIONSHIPS-C1-REPORT-2026-11-09.md
?? src/core/contactEdit.test.ts
?? src/core/contactUsage.test.ts
?? src/core/contactUsage.ts
?? src/modules/contacts/
?? src/modules/family/family-c1.test.ts
```

Nothing staged, committed, pushed or deployed. HEAD = `origin/main` = `0469af6`.

## 14. Recommendation

**Recommend release after independent review, in one commit with the C0 plan and the two doc updates.** Reviewer focus: (a) the `updateContactDetails` change and its effect on Projects and Services (judgment call 1); (b) the "me" conflict rule (call 5); (c) the Spouse version-skew note (call 8); (d) wording of the rename and same-name messages (C0 left it open). The owner's own real-device pass, and a second-device try of a same-name rename and "This is me", remain owner acceptance, as for every phase. After release: N1 (grouped selector) is the next small navigation phase; C2, C3 and F4 each need their own go-ahead.

**Handoff:** `docs/CHATGPT-HANDOFF.md` was updated (top notice, current phase, baseline, change log); `docs/BACKLOG.md` was updated (C1 entry, D1 to D4 recorded as approved).

---

## 15. Final release verification (2026-11-09)

ChatGPT verdict: **APPROVED FOR FINAL RELEASE VERIFICATION.** Sections 1 to 14 above are the original implementation findings and are unchanged, including the Git status in section 13 (which describes the tree before release).

**Gate:** branch `main`; HEAD = `origin/main` = `0469af6` (after `git fetch`); Pages run #83 `success` for that exact SHA; the only changes were the reviewed C0 plan and the C1 work (the file list in section 13). The report matched the implementation.

**Targeted browser verification** (built-in browser, its own isolated profile, invented data; 20 of 20 PASS):
- **A. Identity:** the Contact referenced by Family, Calendar and Tasks was renamed in the Contacts module; id and created time unchanged. The Family member page showed the new name; the actual Calendar event (opened from the member's Schedule) showed the new name under People; the actual Task opened in the Tasks module showed the new name under People (this closes the gap in section 11, row 12). A birthday-style event title and a service-visit provider-name snapshot that I added for the test (both naming the old name) were byte-identical after the rename.
- **B. Forms:** a same-name create was refused without the tick (no row added); with the tick it created a separate Contact and the original stayed byte-identical. A no-op edit left `updatedAt` unchanged and said "No changes to save". A simulated stale edit (database write behind the open form, as before) was refused, the newer data stayed, and Reload loaded it.
- **C. Family:** Spouse shown on a member; "This is me" assigned, moved and cleared (stored flags checked); a forced two-mark state showed the warning with nobody marked, legible in dark mode; choosing one member left exactly one mark and no warning.
- **D. Navigation:** directory and detail pages had no horizontal overflow at 320 and 375 px; the eleven-item list scrolled at 667 x 300 with the last item reachable; all ten earlier module routes loaded; the Search "Contact" result opened the right Contact.
- **Limits unchanged:** the stale edit and the two-mark state were created by direct database writes in one tab (the real two-device engine is covered by the automated tests). No real device, second tab or screen reader was used.

**Correction made:** item 11 asked for the same-name checkbox's accessible name in the real browser. The DOM is correct (its wrapping label and `labels` list give the full sentence), but the browser tool's listing showed the name "on". As the permitted minimal change I added `aria-labelledby` to a `<span>` holding the sentence (`ContactForm.tsx`). The tool still prints "on", so that is the tool's own fallback, not a missing name; a real screen reader remains unverified. No other correction.

**Integrity checks (all hold):** existing shared `contacts` table; creation only through `createDistinctContact`; edit preserves id, created time, notes, unknown fields and references; Projects and Services editors pass their existing tests; no-op saves write nothing; the stale comparison and write are one transaction; the usage reader is read-only and authorizes nothing; Search excludes phone, email and notes; no delete, archive or merge; Spouse is a Family role; "This is me" is explicit, optional and not authentication; conflicting marks give no effective identity; backup (plain and encrypted) and two-device sync tests pass; `package.json`, the lockfile and `src/db.ts` unchanged (Dexie v15); no Finance change, backend, hosting change or tablet functionality.

**Final regression (one run on the release candidate):** `npm test` **3,960 passed in 223 files**; `npx tsc --noEmit` clean; `npm run build` succeeds; `git diff --check` clean.

**Accepted design decisions:** existing four Contact fields only; duplicate-name warning with explicit confirmation; no Contact deletion or archival in C1; conservative usage counts; Spouse is a Family relationship; "This is me" is an optional Family identity designation; multiple conflicting "me" markers need owner resolution; existing name snapshots remain historical; **ContactPicker identity ambiguity (Calendar and Tasks) is deferred to C2.**

**Next planned phase: N1, Grouped Flat Module Selector** (not started): Today prominent; Productivity: Calendar, Tasks, Projects; Household: Home & Assets, Household Services, Bills & Subscriptions, Family, Contacts & Relationships; Finances: Ledger, Household Finances; no nested flyouts; module ids, routes and icons kept; every module directly selectable; accessible keyboard use; viewport-aware scrolling. C2, C3 and F4 remain separate future phases.

**Release:** the C0 plan is in the release commit. The commit SHA and Pages result are given in the final message, not here, to avoid a second commit.
