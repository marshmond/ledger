# Contacts & Relationships C0: discovery and architecture plan

**Date:** 2026-11-09. **Status: PLANNING ONLY.** No application code, schema, route, module registration, UI or test was changed. Nothing is staged, committed, pushed or deployed. The phase names (C1 to C3) are labels, **not authorization**; each phase needs the owner's go-ahead after independent review. C1 is NOT started.
**All names and examples in this document are invented.**

---

## 0. Release gate (verified before planning)

| Check | Result |
|---|---|
| Repository | `origin` = `https://github.com/marshmond/ledger.git` |
| Branch | `main` |
| Local HEAD = `origin/main` (after `git fetch`) | Yes: both **`0469af66c7e07d5710711b32310f03bd5fa4cb70`** (`feat(family): F3 member activities and relationships`) |
| F3 committed and pushed | Yes (it is HEAD) |
| Pages deployed that exact commit | Yes. Run **#83**, `head_sha` = `0469af6…`, `completed` / `success`, attempt 1, all `build` steps green (`npm test`, `npm run build`, upload). The `github-pages` deployment for that SHA has status `success` (2026-11-09 19:07:24Z). Read from the public Actions API with `curl` (`gh` is not installed). At the very start of this session the run was still `in_progress`; planning continued only after it was seen complete. |
| Working tree clean | Yes (`git status --short` empty before this batch) |
| Family member and important-contact records present | Yes: `family/member`, `family/date`, `family/contact` code and tests exist in `src/modules/family/` (`model.ts`, `importantContactModel.ts`, `importantContactData.ts`, 15 test files) |
| F3 Contact-integrity safeguards in place | Yes, read in source: `createDistinctContact` exists in `src/core/contacts.ts`; Family never calls `findOrCreateContact` (three guard tests pin that: `family-guards.test.ts`, `family-f2-guards.test.ts`, `family-f3-guards.test.ts`); `ContactPicker` is not used by Family; same-name warning plus explicit tick in `MemberForm.tsx` and `ImportantContacts.tsx`; Family guards also forbid `updateContactDetails` |
| Released test baseline | **3,879 passing tests in 216 files**, re-run in this session on the clean checkout of `0469af6` (`npm test`, 108 s). It matches the F3 report. The deploy job also ran `npm test` green. |

Documents read: `CLAUDE.md`, `docs/CHATGPT-HANDOFF.md` (sections 1 to 6), `docs/BACKLOG.md` (top), the Family F0 plan, F1 and F3 reports, `docs/module-hooks.md` (Contacts and search parts), `docs/sync.md`. Source read: `src/core/contacts.ts`, `entities.ts`, `store.ts`, `registry.ts`, `ModuleBar.tsx`, `src/ui/pickers.tsx`, `src/db.ts`, `src/lib/sync/track.ts` and `merge.ts`, `src/modules/family/` (registration, references, data), the Contact-related files of Projects, Services, Assets, Bills, Calendar and Tasks. Where documents and source differed, source was followed (section 3).

---

## 1. Executive summary

- **Ledger already has one shared Contact identity.** One `contacts` table (id, name, relationship, phone, email, an unused `notes`), time-based ids, soft delete, and about a dozen places that point at a Contact by id. The plan keeps exactly that. **No second table, no CRM identity store, no merge.**
- **The gap is a front door, not a data model.** There is no Contacts screen. Contacts are created in about a dozen places under three different identity rules, can be edited only inside Projects' vendor list and Services' provider page, and cannot be deleted at all (apart from Undo of a just-created one). The owner cannot see who is in the system, find a duplicate, or correct a Family member's phone number.
- **Recommendation:** a small new module `contacts` ("Contacts & Relationships", `#/contacts`) that is a **directory, a detail page, an explicit create form and a safe edit form over the existing `contacts` table.** C1 needs **no new table, no new record kind, no Contact field, no migration, no sync or backup format change and no dependency.** It writes only the `contacts` table and only through helpers that never match by name.
- **"Where is this Contact used?" is the safest and most valuable cross-module feature**, and it can be made complete at low cost: a single shared, read-only scan over the shared tables (the pattern `contactIsReferenced` already uses) gives a **complete** in-use count per module today. Named lists with links per module come in C2 through small per-module readers (the pattern Finance's `txnReferences` uses).
- **Deletion and archive are deliberately NOT in C1.** Soft delete makes a Contact vanish from every picker and turns every reference into "(no longer exists)"; an archive state would need a new field that every picker honours. Neither is safe yet (section 4.6). C2 can add a previewed, guarded removal for Contacts that nothing uses.
- **Personal CRM (C3) is small and reuses what exists:** interaction notes as the one new record kind (in `moduleRecords`), "last contacted" derived from them, follow-ups as ordinary Tasks, no automatic collection of calls, messages or email, no AI, nothing sent off the device.
- **Four owner decisions** (section 13), all needed before C1.

---

## 2. Existing Contacts architecture (verified in source)

### 2.1 The record

`src/core/entities.ts` `Contact extends BaseRecord`: `name`, `relationship?` (free text: "sister", "plumber"), `notes?`, `phone?`, `email?`, plus `id`, `createdAt`, `updatedAt`, `deletedAt`. Dexie table `contacts: '++id, name'` (version 15). Only `name` is indexed, so adding optional fields later needs **no migration**.
Ids come from `newId()` (`src/lib/sync/track.ts`): milliseconds x 1000 plus a random part, about 1.78 x 10^15, always above old 1, 2, 3 ids and below 2^53. This matters for the usage scan in section 6.
**`notes` is declared but nothing writes or reads it** (searched `src`): no helper accepts it, no screen shows it. It is a free, unused slot, but a sensitive one.

### 2.2 Helpers (`src/core/contacts.ts`)

| Helper | Behaviour | Used by |
|---|---|---|
| `validateContact` | name required, up to 120 characters; email shape; phone up to 40 characters | all |
| `nameKey` | name compared ignoring case, accents and spacing | `findOrCreateContact`, Family warnings |
| `findOrCreateContact` | finds a live Contact with the same `nameKey` and **returns it** (filling only blank phone, email, relationship), else creates; one transaction | Assets (`AssetForm`, `ServiceForm`, `WarrantyForm`), Bills `data.ts`, Services `data.ts`, Projects `data.ts` and `CommitmentForm`; Quick Add for Bills and Services goes through the same functions |
| `createDistinctContact` | **always** creates, never looks at names; joins a caller's transaction | Family only (member and important contact) |
| `updateContactDetails` | changes name, phone, email, relationship of one live Contact in one transaction; an empty value removes the field; **unknown fields are kept** (`{...existing}`); always sets a new `updatedAt` | Projects `Vendors.tsx` (vendor edit), Services `ProviderPage.tsx` (edit contact details). Family guards forbid it |

### 2.3 Picker and identity semantics

- `ContactPicker` (`src/ui/pickers.tsx`) is used by the **Calendar event editor and the Task editor**. A typed name is matched by `toLowerCase()` equality only (no spacing or accent folding, unlike `nameKey`) and, if found, **silently reuses that Contact**; otherwise it creates one. This is the same merge hazard F1 removed from Family, and it still sits in the two modules whose `contactIds` Family relies on.
- Identity is **the numeric Contact id** everywhere. Names are labels. Renaming is safe for everything that stores the id.
- Some modules also keep a **copy of the name as text**: Bills `providerNameSnapshot` (used by its payee-matching hints), Services visit `providerNameSnapshot` (deliberately "provider at the time"), and the Calendar editor titles a birthday event "<name>'s birthday" when it is created. A rename does not change these copies. This is correct for history but the edit screen must say so (section 5).

### 2.4 Deletion

- `store.shared.contacts.remove` (soft delete: `deletedAt`) has **one production caller**: Undo of a Household Services addition that created the Contact (Bills' Undo deliberately keeps its Contact), and only if `contactIsReferenced` is false and the Contact is unchanged since (`src/modules/services/undo.ts`). **No screen deletes a Contact.**
- Soft-deleted Contacts disappear from every normal read (`isLive`). References to them stay in place and render as "contact" or "(no longer exists)" depending on the screen; nothing repairs them.

### 2.5 Backup and sync

- The `contacts` table is in the plain and encrypted backup (`backup.ts`, `backupFile.ts`, summary label "Contacts") and in sync (`docs/sync.md`: every table is covered). Merge is **whole-record last-writer-wins by `updatedAt`**; there is no Contact-specific merge rule (unlike Projects and Assets deletion rules). The ST-S1 conflict list keeps an overwritten sync edit; whether it records Contact overwrites must be proved by a C1 test, not assumed.
- Unknown fields on a Contact pass through sync, backup and every existing helper (all use `{...existing}`).
- ST-S5.1 rule: **no new database table until every device runs ST-S5.1** (a Dexie version with a new store). C0 to C3 as planned need none.

### 2.6 Modules, navigation, search

- A module is one `ModuleDef` (`src/core/registry.ts`) registered in `src/modules/index.ts`; screens load on demand through `lazyModule` (`src/modules/family/index.tsx` is the smallest current example); `src/modules/lazyBoundary.test.ts` counts the lazy modules (ten today).
- The module selector (`src/core/ModuleBar.tsx`) is a flat disclosure list in **registration order**; `.modmenu` in `src/styles.css` has **no maximum height and no internal scrolling** today. A phone gives each item 44 px.
- Search: nine modules contribute a `searchSource`. **No module contributes Contacts as a thing of its own.** The only "Contact" result comes from the Tasks search source (`tasks/searchSource.ts`): name plus "n open tasks", opening the Tasks list filtered by that Contact.
- Routes: hash routes. Family uses `#/family`, `#/family/m/<memberId>`; Services uses `#/services/providers/<contactId>`.

---

## 3. Problems and opportunities (including corrections to earlier statements)

**Corrections found by reading source (the earlier documents are history and are not rewritten):**

1. F1 report section 9 and the F3 report say "no screen edits a Contact". That is true for a Family member's Contact, but **two screens already edit Contacts** (Projects vendor edit and Services provider edit) through `updateContactDetails`. They are reachable only for Contacts that are a project vendor or a services provider.
2. F1's dependency reader (`family/references.ts`) says it excludes Home & Assets and Household Services. In fact it also **misses Bills providers, Projects commitments, and Family important contacts** (section 6 lists every field). Its `total` must never be used to decide a deletion.

**Problems:**

| # | Problem | Consequence |
|---|---|---|
| P1 | No directory | The owner cannot see, search or review all Contacts, or spot two people with one name |
| P2 | Three identity rules (merge by name, never merge, picker's lower-case match) | Same-name people can be merged silently from Add forms, Quick Add and the Calendar/Task People pickers |
| P3 | `updateContactDetails` has no stale-edit check and always bumps `updatedAt`, even when nothing changed | Opening the dialog and pressing Save on an unchanged Contact makes a new version that can overwrite another device's edit in sync |
| P4 | No "who uses this" view across all modules | A rename or (later) removal cannot be previewed |
| P5 | `notes` exists but is unused | Free slot; sensitive; needs a decision, not a default |
| P6 | Global Search cannot find a Contact as a person | Only Tasks exposes a "Contact" hit, and it opens a filtered task list |
| P7 | Name copies in Bills, Services and stored birthday titles | A correction of a name is not "everywhere"; the screen must not promise it |

**Opportunities:** the id-based model, the numeric time-based ids, the conservative usage scan that already exists in `contactIsReferenced`, the `txnReferences` precedent for module-owned read-only readers, F1/F3's tested same-name UI pattern, and `Tasks ?contact=<id>` already working as a deep link.

---

## 4. Contact identity, types and the safe workflow

### 4.1 Can the existing model represent the people and organizations listed in the brief?

| Kind of Contact | Today | Verdict |
|---|---|---|
| Household member | Contact plus a `family/member` row | Works; the Contact is the identity |
| Relative, friend | Contact, `relationship` "sister" | Works |
| Professional, financial professional | Contact, `relationship` "accountant" | Works |
| School, childcare, coach, teacher | Contact; person or school is just a name | Works; no link between a teacher and a school |
| Contractor, service provider | Contact, referenced by Projects/Services/Assets/Bills | Works (this is the most-used case) |
| Business or organization | Contact whose name is the business | Works; indistinguishable from a person except by reading |

**The existing four fields (name, relationship, phone, email) cover every case in the brief well enough for a directory.**

### 4.2 Proposed extensions, evaluated one by one (none is added automatically)

| Extension | Needed for | Cost | Recommendation |
|---|---|---|---|
| Person versus organization (`kind`) | Sorting people from businesses; address-book feel | Small: one optional field on `contacts`, no migration; but every creation path would ignore it, so it would be blank for most Contacts | **Not in C1.** Decide in C2 only if the owner finds the mixed list hard to use. The "relationship" text and the usage badges carry most of the value |
| Categories or tags | Filtering | The shared `tags` table exists, but Contact has no `tagIds`; adding an optional `tagIds` field is cheap, but tag management and filtering UI is not | **C2**, optional |
| Roles | "Who is the plumber for the house project" | Already modelled where it matters: Assets store a per-asset `role`; Projects and Services store the relationship in their own record | **Do not add a Contact role.** A role belongs to the relationship (record), not the person |
| Nickname | Search | Optional field; every search/warning path would need to know it | **Later**, only if asked |
| Multiple phones or emails | Real address-book use | Changes `phone: string` to a list; touches every reader of `phone`/`email`; sync/older-build compatibility cost | **Not planned.** One phone, one email. Free text lets the owner put "work 555-0100" in the phone box (40 characters) |
| Address | Mailing, "where do they live" | Privacy-sensitive; Assets already masks address | **Not planned** |
| Preferred contact method | Follow-ups | Trivial field, little value without messaging features | **C3 at the earliest, probably never** |
| Notes | Remembering context | The field exists and is unused. Sensitive. Needs masked display like Family's note | **C3**, with the masked pattern, or earlier if the owner asks (decision D1) |

### 4.3 Creation rules (the central workflow)

1. **The Contacts module creates only through `createDistinctContact`.** It never calls `findOrCreateContact` (a guard test pins this, as Family's do).
2. **Duplicate check is advice, not a gate.** When the typed name matches a live Contact by `nameKey`, the form lists each match with what tells them apart (relationship, phone, email, "added <date>", and a one-line "used in" summary) and offers **Open this one**. Saving a same-name Contact needs the explicit tick "This is a different person or organization with the same name" (the F1 and F3 wording and tests are reused).
3. **Near matches** (same `nameKey` apart from a trailing word, or the same email or phone) are shown as a softer "Possible match" list. They never block and never merge.
4. **No silent merge anywhere.** The module offers no merge, no "combine", no automatic relink.

### 4.4 Editing rules

The edit form changes only the four existing fields on one Contact id, through an improved `updateContactDetails` (an additive change to a core helper that Projects and Services already call; their behaviour must stay identical):

- **Keeps** the id, `createdAt`, every reference, and every field it does not know (already true).
- **No-op saves write nothing** (fixes P3).
- **Stale-edit check inside the transaction:** the form remembers the `updatedAt` it loaded; if the stored one differs at save time (another tab or a sync arrived), save is refused with "This contact changed while you were editing. Reload it and try again." Nothing is overwritten.
- **Renaming to an existing name** shows the same-name warning and needs the same tick. It never blocks and never merges.
- **Rename and correction text:** the screen states "This changes the shared contact, so every place that uses it shows the new details. Names already written into titles (for example a birthday event titled with the old name) or kept as history are not changed", and shows the in-use summary (section 6) before saving. Wording to be confirmed with the owner at C1 review.
- **Empty name refused; length and email rules from `validateContact`.**

### 4.5 Same-name policy (decision D2)

Recommended: **warn, show what tells them apart, require an explicit tick, never merge, never block.** The directory also marks any set of live Contacts with the same `nameKey` ("Same name as 1 other") so a pre-existing duplicate is visible. Alternatives in section 13.

### 4.6 Deletion and archive: audit and policy

**Audit result:** to remove a Contact safely, every field in section 6 must be counted. Three readers exist and none is both complete and labelled: F1's `readContactReferences` (5 sources, incomplete), `contactIsReferenced` (conservative scan of all live `moduleRecords` data, both ends of live links, live attachments and due items; complete for the shared tables, boolean only), and the per-module readers that do not exist yet.
**Why archive is not free:** the Contact record has only `deletedAt`. A "hidden but still resolvable" state needs a new `archivedAt`, honoured by about thirty `store.shared.contacts.query()` call sites in seven modules. Not in scope.

**Policy:**
- **C1: no delete and no archive.** The directory is read-and-correct only. This is the one fully safe position, and it matches what exists today (nobody can delete a Contact).
- **C2 (optional): "Remove from Ledger" only for a Contact that the complete scan finds unused,** with a preview, a confirmation (Cancel focused, same `ConfirmDialog`), the re-check inside the same transaction, soft delete (`deletedAt`, so sync carries it), an **Undo** that restores it, and a refusal if anything references it by the time of confirmation. A stale reference after a two-device race stays VISIBLE ("(no longer exists)") and is never repaired, the same rule as ST-S2.
- **Never in C1 to C3:** permanent (hard) deletion, and removal of a Contact that is in use.

### 4.7 Merge

A merge/consolidation feature would have to repoint references in about a dozen kinds of record owned by seven modules, none of which has a "repoint" writer today. It is **a separate, carefully designed future feature** with its own plan, preview and Undo. It is not in C1 to C3. If two Contacts are really one person, the owner's workaround is to edit the module records that use the wrong one, using the "Where used" view of C2.

---

## 5. Proposed directory and detail experience

### 5.1 Navigation (follows existing conventions)

- Module id `contacts`, name **"Contacts & Relationships"**, routes `#/contacts` (directory) and `#/contacts/c/<contactId>` (detail; stable numeric id, the same style as `family/m/<id>`). Edit and "Add contact" are dialogs on those routes, not extra pages (Family and Services precedent), so there is no nested navigation.
- Icon: one simple inline SVG in the style of the others (a person in a card or a circle). Registered **last** in `registerModules()` so existing order is unchanged.
- Screens load on demand (`lazyModule`); registration (including the search source) is in the first download; `lazyBoundary.test.ts` count becomes eleven.
- Mobile first: single column at 375 and 320 px, 44 px targets, no horizontal scroll, dialogs that fit at 320 px, light and dark tokens, one `h1`, card titles `h2`, keyboard and focus rules from ST-S3 (`Main`, `ConfirmDialog`, `Modal`).

### 5.2 Directory (C1)

Essential: search box (name, relationship, phone, email; the owner's own screen), A to Z list (default), "Recently added/changed" sort, an "Add contact" button, one row per Contact showing name, relationship, phone/email when present, a **"Same name as 1 other"** note, and **where it is used as module names** ("Family, Tasks, 2 projects"), which are the usage badges of section 6. Each row opens the detail page.
Deferred to C2: category or tag filter, "linked to a Family member" as a filter (the badge exists in C1 as the module name), "service provider" and "project participant" as filters, person/organization split, sort by recent activity.

### 5.3 Detail (C1)

Name, relationship, phone (`tel:` link) and email (`mailto:` link; safe, built with `safeUrl`-style checks like other link code), "Edit", "Where this contact is used" as **counts per module in plain words** (section 6), "Added <date>, last changed <date>". Nothing else. No notes in C1 (decision D1).

### 5.4 Search (C1, small)

A `searchSource` for Contacts: title = name, subtitle = relationship only, **never phone or email**, kind "Contact", path `/contacts/c/<id>`. The Tasks source's existing "Contact" hit (opens filtered tasks) would then give two "Contact" results for one person; C1 relabels the Tasks one's subtitle ("n open tasks") or its kind to keep them distinguishable. This is a one-line Tasks change and a judgment call for C1 review.

---

## 6. Cross-module reference inventory

### 6.1 Every place a Contact id is stored (verified by search; relationships are all explicit)

| Module / kind | Field | Shape | Meaning | F1 reader counts it? | Note |
|---|---|---|---|---|---|
| tasks / `task` | `contactIds` | `number[]` | People the task is about | Yes | Deep link `#/tasks?v=all&contact=<id>` works today. Bills' Tasks carry their provider here |
| calendar / `event` | `contactIds` | `number[]` | People at/for the event | Yes | Birthday events title themselves with the name text |
| projects / `project` | `vendorContactIds` | `number[]` | "Vendors and people" | Yes | Family F3 reads it |
| projects / `commitment` | `vendorContactId` | `number \| null` | Contract vendor | **No** | Projects also adds the vendor to the project list (`ensureProjectVendor`), so the project count usually covers it |
| assets / `asset` | `contacts` | `{contactId, role}[]` | Related people with a role | **No** | |
| assets / `service` | `providerContactId` | `number \| null` | Who did the work | **No** | |
| assets / `warranty` | `providerContactId` | `number \| null` | Warranty provider | **No** | |
| services / `arrangement` | `providerContactId`, `extraContactIds` | `number \| null`, `number[]` | Provider, other people | **No** | |
| services / `visit` | `providerContactId` (+ `providerNameSnapshot`) | `number \| null` | Provider at the time | **No** | Name copy is deliberate history |
| bills / `obligation` | `providerContactId` (+ `providerNameSnapshot`) | `number \| null` | Provider | **No** | Name copy feeds payee hints |
| family / `member` | `contactId` | `number` | Identity of the member | Yes (as "other members") | |
| family / `contact` | `contactId` (+ `memberId`) | `number` | Important contact | **No** | F3 |
| shared `links` | `fromModule`/`toModule` = `contacts` | any | Explicit link | Yes | **No module creates such links today** (searched) |
| Finance tables | none | | | | No Finance table stores a Contact id |

**Derived** (computed, never stored): Family birthdays come from `family/member` and the member's Contact name through the Family due provider; Family F3's Schedule/To do/Projects sections read the three explicit fields above.
**Not existing and not to be invented:** a Contact-to-Calendar-event link other than `contactIds`; a Contact-to-Bill link other than `providerContactId`; any link from a Contact to a school, a doctor or a "relationship between two people". A Contact page must show **only** what these fields say. **No relationship is ever inferred from a matching name, payee, title or amount.**

### 6.2 Recommended approach: one shared read-only reader, built in two layers

**Layer 1 (C1): counts per module, complete.** A new pure-plus-read function in `src/core/` (for example `contactUsage.ts`; core, because it reads only shared tables and imports no module):

- One pass over `moduleRecords`, `links`, `attachments`, `dueItems`; for each live row it finds every whole number in the row's JSON that equals an id in the set of live Contact ids, and tallies it by `module/kind`. A friendly label table maps `module/kind` to words ("task", "calendar event", "project", "provider record", ...); an unknown `module/kind` still counts and shows its module id.
- Complete by construction (it needs no knowledge of field names, so a newer field cannot be missed), the same reasoning as `contactIsReferenced`. A false match requires a number equal to a time-based Contact id (about 1.78 x 10^15) in an unrelated field, which no stored quantity (cents, counts, dates as strings) reaches; a false match only over-counts and never under-counts. Ids below 2^53 stay exact in JSON.
- Read-only, no transaction needed to read; one pass for the whole directory rather than a scan per row (cost to be **measured in C1** against the ST-S4 scale fixtures, not assumed).
- A guard test: byte-identical tables before and after, and no write/transaction/network/storage in the file (same style as `references.ts` guards).

**Layer 2 (C2): named lists with links, owned by each module.** A new optional `contributes.contactReferences` hook (read-only, same rules as `txnReferences`: reads shared tables only, never matches by name, throws when it cannot read so the screen says "could not check"), implemented by Tasks, Calendar, Projects, Services, Assets, Bills and Family. Each returns plain rows (title, relation in words, an address like `#/tasks?task=<id>`). This puts field knowledge where it belongs and avoids Contacts importing six modules. The Layer 1 scan stays as the **deletion safety net**: a removal is allowed only if the scan finds nothing, regardless of what the module readers report. A test then fails if a module record kind holds a Contact id that no reader reports (the same self-checking idea as the ST-S4 reader list).

**Family's reader:** `family/references.ts` stays untouched in C1 (a released, tested Family file). A C1 test asserts Layer 1 counts a superset of it on the same fixtures. In C2 Family's reader is replaced by a call to the shared one in a small, separately reviewed refactor. Do not build a general graph engine: both layers are flat tallies and lists.

---

## 7. Personal CRM opportunities (what needs new records and what does not)

| Capability | Reuse or new | Notes |
|---|---|---|
| Who/what/contact info/where used | Reuse | C1 |
| How I know them | Reuse `relationship` | Text only |
| Categories, tags | Reuse shared `tags` plus one optional field | C2, optional |
| Interaction history / notes from a conversation | **New record kind** `contacts/interaction` in `moduleRecords` (contactId, date, short text) | C3. No new table. Manual only |
| Last contacted | **Derived** from the newest interaction; never stored | C3 |
| Follow-up reminders | **Reuse Tasks**: an ordinary Task with `contactIds` plus a small marker in its carried-through fields (the Bills/Services pattern) | C3. No new reminder system; Tasks already appear on Today and the Calendar |
| Important relationship dates | Family already stores `family/date` (anniversaries) keyed to a member. A date for a non-member Contact would need either a generalised record or a Contacts-owned one | Design choice for C3, deliberately deferred; do not duplicate the Calendar |
| Related people / organizations | Needs a new relationship record (person A is on staff at business B) | Later, only if wanted. The brief's "teacher at a school" case is not covered by the current model |
| Preferred communication method | One optional field | Probably never |
| Relationship context on Today | A read-only card from Tasks (follow-ups due) and interactions | After C3; counts only, `hideWhenEmpty` |
| AI-assisted summaries | None | **Not in C1 to C3.** Any later AI feature requires its own plan, an explicit decision on what data leaves the device, and must work locally or not at all. The first CRM release is fully useful without it |

**Hard exclusions:** no automatic import of calls, messages, email or location; no "relationship score", pipeline, lead, forecast or any commercial CRM concept; no contact-sharing or "send details" features; nothing monitored. Any such idea needs separate consent design and architecture review.

---

## 8. Privacy, backup and synchronization

- **Data minimization:** C1 stores nothing new. Phone and email already exist and remain optional. No new copy of a Contact's data is made anywhere (Family's rule: store the id, never a copy).
- **Search privacy:** global Search shows name and relationship only; never phone, email or notes (same rule as Assets and Services).
- **Notes (C3):** masked until deliberately shown (Family's `note` pattern: absent from the page until "Show", `aria-expanded`), never in Search, Calendar, Today, labels, logs, summaries or toasts; length limit; a warning against health details, identity numbers and passwords; plain backups are not encrypted and the form says so.
- **Backup and restore:** the `contacts` table is already in plain and encrypted backup and restore; C1 adds no format. C3's interaction records ride `moduleRecords` and need one friendly label in `MODULE_KINDS` (`backupSummary.ts`). Restore tests for edited Contacts (unknown fields kept) are required.
- **Synchronization:** whole-record last-writer-wins. Two devices editing different fields of one Contact keep one version; the other should be in the conflict list. Required C1 test with the real `SyncEngine`: concurrent edits, an edit versus an unchanged re-save (fix P3), a same-name pair created on two devices (both kept, both shown with "Same name"), unknown fields preserved.
- **Version skew:** no new field in C1, so an older build cannot lose anything. A future optional field is safe on older builds because every existing writer spreads `{...existing}`; this must be re-verified when a field is added.
- **Archival and deletion:** section 4.6. Soft delete only, never in C1.
- **Family Command Station:** the tablet must never receive full Contact records. Projection is built only from explicit, minimal fields chosen per item (for example a member's display name and colour) from Family's own records, **never by reading the `contacts` table.** The Contacts module adds no display, share, publish or tablet field; a guard test pins that, as Family's do. A Family member being a Contact does not make the Contact's phone, email, relationship or notes eligible for any display.
- **Hosting:** the owner's GitHub organization, repository and Pages hosting are retained. Shared-origin exposure (SE-01) is a documented, owner-accepted risk and is not reopened. No new encryption scheme and no backend.

---

## 9. Module navigation implications

- Contacts & Relationships becomes the **eleventh** module. The flat list has no maximum height; at 11 items on a landscape phone (about 375 px tall) the 44 px rows (about 490 px plus the bar) cannot fit and cannot scroll. This is a real, small, imminent usability defect that C1 would introduce for those screens.
- **Approved refinement (recorded, NOT built, not part of C0 or C1):** a **grouped, flat dropdown, not nested flyouts.**
  - **Today** prominent at the top.
  - **Productivity:** Calendar, Tasks, Projects.
  - **Household:** Home & Assets, Household Services, Bills & Subscriptions, Family, Contacts & Relationships.
  - **Finances:** Ledger, Household Finances.
  - Requirements: clear but subtle group labels; every module directly selectable (no second-level hover); existing routes, module ids and icons preserved; keyboard access kept (it is a disclosure of links, not an ARIA menu; arrow keys are not promised); fits the viewport height and scrolls internally; the existing `ModuleBar` tests (`stS3Accessibility`, `stS51Ui`, `stS3Structure`) updated to the grouped structure.
  - Suggested size: one small standalone phase **"N1"** right after C1 is released: `ModuleBar.tsx` plus one optional `group` field on `ModuleDef` (default "Other", so an unlisted module still appears), CSS, and tests. It needs no data change.
  - **Interim option for C1 (decision for review, not assumed):** add only `max-height` and `overflow-y: auto` to `.modmenu` so the 11-item list scrolls on short screens until N1. That is a CSS-only change, but it is a navigation change, so it is listed as a C1 judgment call rather than done here.
- Module order stays registration order: Contacts last, after Family.
- The Projects label "Vendors and people" (rename to "People and vendors") remains a separate recorded item and is not part of C1.

---

## 10. Recommended roadmap

Phases are small and each ends in independent review and explicit release authorization. Adjustments from the suggested structure: N1 (navigation) is separate and small; C1 does not need record kinds; the guarded removal moved from the base directory to C2.

### C0: discovery and architecture
This document. No code. Exit: owner and independent review accept the architecture and answer the four decisions.

### C1: central directory, detail, create, edit (the first useful release)
- **Scope:** module `contacts` (registration, lazy screens); directory (search, A to Z, recently changed, same-name marker, usage badges); detail page; explicit create (`createDistinctContact`, same-name warning and tick); edit (improved `updateContactDetails`: no-op skip, stale check, same-name warning on rename, honest wording about name copies); Layer 1 usage scan in `src/core`; a Contacts search source; relabel of the Tasks "Contact" hit; no delete, no archive, no notes, no new field.
- **Dependencies:** none (no migration, no ST-S5.1 constraint triggered).
- **Key risks:** the core-helper change touches Projects and Services edit paths (tests must pin their behaviour); the scan's cost on a large household; Search duplicates; the 11-item module list on short screens.
- **Deliverables:** code, report with judgment calls, backlog and handoff updates.
- **Essential tests:** see section 14. **Exit criteria:** tests, `tsc`, build and `git diff --check` clean; browser pass at desktop and 375/320 px in light and dark with disposable data; byte-identical unrelated records after create/edit; real-sync concurrent-edit test; a Family member's Contact corrected without changing its id or any reference; owner real-device pass is the owner's.

### N1: grouped flat module selector (small, standalone, after C1)
Section 9. **Exit:** all 11 modules reachable with the same routes, ids and icons; scrolls on short screens; keyboard and landmark tests updated; browser check at 375 and 320 px.

### C2: organization and cross-module context
- **Scope:** Layer 2 `contributes.contactReferences` readers and the detail page's named lists with links; Family's reader switched to the shared one; guarded **"Remove from Ledger"** for unused Contacts with preview, re-check in the transaction and Undo; optional tags and/or person/organization `kind` if the owner asks (decision deferred); `ContactPicker` disambiguation in the Calendar and Task editors (show relationship or phone beside same-name options, never silently reuse an ambiguous match); directory filters.
- **Dependencies:** C1 released. **Risks:** touching Calendar/Tasks editors; reader drift as modules change (mitigated by the self-checking test); deletion races across devices.
- **Essential tests:** every reader read-only and byte-identical; self-check against `moduleRecords` kinds; removal refused for every reference kind in section 6.1 and for a Contact that gains a reference between preview and confirm; Undo; real-sync removal versus a new reference on another device.
- **Exit criteria:** as C1, plus the superset test between old and new readers is retired with Family's reader replaced and its tests green.

### C3: personal CRM foundations
- **Scope:** interaction notes (`contacts/interaction`), derived last-contacted, follow-up Tasks with a marker, optionally masked Contact notes, optionally important dates for non-member Contacts (design choice made at C3 planning), a small Today card.
- **Dependencies:** C2 (so the detail page can show a coherent timeline); owner confirmation that the CRM is wanted. **Risks:** sensitive text; scope drift toward a commercial CRM.
- **Essential tests:** masked notes absent from the page, Search and labels; backup/restore/encrypted sync of interactions; follow-up Tasks complete and repeat through Tasks' own engine; nothing sent anywhere.
- **Exit criteria:** as C1, plus privacy guard tests.

### Later (not planned)
AI-assisted insights (own plan and consent design), relationship records between Contacts, merge/consolidation, further integrations only when approved. Family F4 and the Family Command Station are separate initiatives; none depends on C1.

---

## 11. Important risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Silent same-name merge continues through Add forms, Quick Add and the Calendar/Task People pickers (P2) | C1 makes duplicates visible; C2 fixes the pickers; the Contacts module itself never merges |
| R2 | A Contact edit overwrites another device's edit (P3, whole-record LWW) | No-op skip, stale check, conflict-list proof by real-sync test |
| R3 | A rename is assumed to change every place; name copies remain | Honest wording; usage view; no promise of "everywhere" |
| R4 | A deletion based on an incomplete reader (F1's reader is incomplete) | No deletion in C1; C2 deletion gated by the complete scan; F1's `total` never used for it |
| R5 | Readers drift as modules add Contact fields | Layer 1 needs no field names; Layer 2 has a self-checking test |
| R6 | The usage scan is slow at scale | Single pass for the directory; measure in C1 on ST-S4 scale fixtures before relying on it; fall back to a per-detail-page scan if needed |
| R7 | Contact data leaks to a future shared display | No share/display field; projection never reads `contacts`; guard test |
| R8 | Two Search results for one person | Relabel Tasks' hit; review in C1 |
| R9 | Module list overflows on short screens | Interim CSS-only option, N1 right after C1 |
| R10 | Scope creep into a commercial CRM | Section 7 exclusions; C3 needs owner confirmation |
| R11 | Existing tests that enumerate modules or the module list break | Expected one-line updates (`lazyBoundary`, ModuleBar tests) reported as such |
| R12 | Not real-device or screen-reader tested | Standing limitation; owner acceptance |

---

## 12. Documentation and release housekeeping

C0 changes only this plan, `docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md`. Contacts & Relationships C0 is recorded as **planned, not implemented**; the module-selector refinement is recorded as **future work after C1**; Family F0 to F3 and stabilization history is preserved.

---

## 13. Owner decisions (four; all needed before C1)

**D1. Which fields does C1 show and edit?**
- **A (recommended):** the existing four: name, "how you know them or what they do" (`relationship`), phone, email. Nothing new stored.
- B: A plus the existing but unused `notes`, masked (hidden until you press Show). Needs the masked-note UI and privacy tests in C1; pulls C3 work forward.
- C: A plus new fields (person/organization, address, more than one phone or email). A new field touches the data model and every older build and every reader of phone/email.
- *If you choose B or C:* C1 grows by roughly a third and gains a privacy and compatibility review. *Deferrable?* No, it sets C1's scope.

**D2. What happens when a new or renamed Contact has the same name as an existing one?**
- **A (recommended):** warn, show what tells them apart (how you know them, phone, email, where used), and require a tick that they are different. Never merge, never block.
- B: block it; the owner must change the name (for example add "Sr."). Simple, but two real people with one name (two aunts called Maria) cannot both be stored under the real name.
- C: allow silently (today's behaviour in some forms).
- *Deferrable?* No: it defines the create and edit forms.

**D3. Deleting or hiding Contacts.**
- **A (recommended):** none in C1. In C2, a "Remove from Ledger" only for Contacts that nothing uses, previewed, confirmed and undoable.
- B: the guarded removal of unused Contacts already in C1 (adds a confirmation flow, a re-check inside the transaction, Undo and sync tests to C1).
- C: also an "archive" for Contacts that are in use (hide from pickers). Needs a new field honoured by about thirty call sites in seven modules; a separate phase.
- *Deferrable?* The C1 line must be chosen now; C and the exact C2 shape can wait.

**D4. How much "where it is used" context in C1?**
- **A (recommended):** per-module counts in plain words ("used in 2 tasks, 1 project, as a provider in Household Services"), complete, from the one shared scan. Named lists and links come in C2.
- B: named lists with links in C1 (needs the per-module readers, so C1 doubles in size and touches six modules).
- C: none until C2 (smallest, but the rename warning and the same-name view lose their evidence).
- *Deferrable?* No: it fixes C1's size and whether other modules are touched.

**Deferred (no answer needed now):** person/organization type, tags, notes and CRM scope, important dates for non-members, `ContactPicker` changes, merge, any AI. The N1 navigation phase needs no data decision; the owner may simply approve it after C1.

---

## 14. Recommended C1 starting scope

**Build:**
1. Module `contacts`, registered last; lazy screens; icon; routes `#/contacts` and `#/contacts/c/<id>`.
2. Directory: search, A to Z and recently-changed sorts, "Add contact", rows with name, relationship, phone/email, "Same name as n other", where-used module names.
3. Detail page: fields, `tel:` and `mailto:` links, "Edit", where-used counts, dates added/changed.
4. Create dialog using `createDistinctContact`; same-name warning with distinguishing details and the explicit tick; atomic; no `findOrCreateContact`.
5. Edit dialog using improved `updateContactDetails` (no-op skip, stale-edit refusal, same-name rename warning, unknown fields kept, honest wording about name copies); Projects' and Services' edit screens unchanged in behaviour.
6. `src/core` Layer 1 usage scan (read-only), with a friendly label table.
7. Contacts search source (name and relationship only) and the Tasks "Contact" hit relabelled.
8. Registration-level updates only: `modules/index.ts`, `moduleStyles.ts`, `lazyBoundary.test.ts` count.

**Do not build in C1:** delete or archive, notes, new Contact fields, tags, person/organization type, merge, named reference lists, interaction history, follow-ups, Today card, Quick Add destination, tablet/sharing anything, `ContactPicker` changes, the grouped module selector (N1), Family or other modules' edits (except the single Tasks search label), Finance, schema, sync/backup format, dependencies, hosting.

**Essential tests:** (a) create never merges (two same-name Contacts exist after; the original is byte-identical); (b) guard test: the Contacts module never uses `findOrCreateContact`, the picker, storage, network or any share/display field, writes only `contacts`; (c) edit keeps id, `createdAt`, unknown fields and all other tables byte-identical; no-op save writes nothing; stale edit refused; rename to an existing name needs the tick; (d) Projects and Services edit behaviour unchanged after the helper change; (e) usage scan: counts every field in section 6.1, ignores deleted records, unknown kinds counted, read-only, superset of Family's reader; (f) real-`SyncEngine`: concurrent edits, same-name pairs from two devices, unknown fields; (g) backup/restore plain and encrypted with an edited Contact; (h) search never returns phone or email; (i) accessibility (names, one `h1`, dialog focus, 44 px phone targets) and a 320 px overflow check in the browser; (j) the module-count test updates; (k) scan timing on the ST-S4 scale fixtures.
**Exit criteria:** as in section 10 for C1.

---

## 15. What is unknown or unverified

- Whether the ST-S1 conflict list records overwritten Contact edits (expected from the generic design; to be proved in C1).
- The scan's cost on the owner's real data volume (measured only on fixtures in C1).
- Real-device, screen-reader and second-device behaviour (owner acceptance, as for every phase).
- Whether Bills' `providerNameSnapshot` and Quick Add's cached contact names (`known` lists in Bills/Services) behave sensibly after a rename; read in source, not exercised. C1 should test and document, not change them.
- The exact friendly wording of the rename and same-name messages (to be agreed at C1 review).
