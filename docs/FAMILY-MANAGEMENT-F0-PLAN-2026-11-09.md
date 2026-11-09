# Family Management F0: discovery and architecture plan

**Date:** 2026-11-09. **Status:** PLANNING ONLY. No code, schema, test, dependency or setting changed. Nothing is staged, committed, pushed or deployed. The phase names below are labels, **not authorization**; each phase needs the owner's go-ahead after independent review.
**All names, dates and people in this document are invented examples.** Nothing was taken from earlier conversations or from the owner's data.

---

## 0. Release gate (verified before planning)

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (`origin` = `https://github.com/marshmond/ledger.git`) |
| Branch | `main` |
| Local HEAD = `origin/main` | Yes: `ba4da59eb891e7c4696c63c11a76677f0905931e` (after `git fetch`) |
| ST-S5.1 committed and pushed | Yes: `ba4da59` "fix(stabilization): ST-S5.1 sync compatibility and conflict safety" |
| Pages deployed that exact commit | Yes. Run **#79** (`42644441734`) for `ba4da59`: `completed` / `success`, job `build` all steps green (including `npm test` and `npm run build`), job `deploy` present. The `github-pages` deployment for sha `ba4da59` has state `success` (2026-11-09 15:29:31Z). |
| Live site is that build | Yes: the live `index.html` names `assets/index-CptuNPsh.js` and `assets/index-zNtjicYV.css`, the same two files a fresh local build of HEAD produces. |
| Working tree clean | Yes (`git status --short` printed nothing before this batch) |
| Released test baseline | **3,622 passing tests in 200 files.** Re-run locally in this session: 200 of 200 files, 3,622 of 3,622 tests, 57 s. The deploy job also ran `npm test` green. |
| ST-S5.1 safeguards present | Yes, read in source: `merge.ts` takes a `known` table list and carries other tables through untouched; `engine.ts` `knownIds` / `knownTables()` never remember unknown tables' ids; `codec.ts` refuses a sync file whose `v` is not 1; `MetaStore.update` (one IndexedDB transaction) is a required method on the interface; 17 sync tests (`src/lib/sync/stS51.test.ts`) and 4 UI tests (`src/shell/stS51Ui.test.tsx`) exist. |

**Stale text found and reconciled in this batch:** `docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md` still described ST-S5.1 as "uncommitted, not deployed". It is committed and deployed (above). Both are corrected.

---

## 1. Executive summary

- **Recommendation:** build Family Management as a **small new module (`family`) whose only own record is a "household member", stored in the existing `moduleRecords` table, and that points at one shared Contact for the person's identity.** Everything else reuses what exists: activities are ordinary Calendar events, actions are ordinary Tasks, initiatives are ordinary Projects. Tasks and Calendar events already carry a `contactIds` list, so "this is for Sam" needs **no change to Tasks or Calendar at all**.
- **No new database table, no migration, no sync-format change, no new dependency, no backend.** This keeps the ST-S5.1 rule intact (the deployed `4b827eb` build predates the fix, and `ba4da59` is only safe once installed on every device; `moduleRecords` needs neither).
- **Birthdays and important dates are derived, not copied.** A Family due provider works them out when the Calendar or Today asks (the same pattern as Household Services and Bills), so there is nothing to double up or go stale. An existing stored Calendar "Birthday" event is never touched, and a coordination rule avoids showing both.
- **Design for the Family Command Station now; build it later.** Four small decisions made today keep it possible: (1) stable person identity = the Contact id; (2) a display color on the member record; (3) **default private, per-item opt-in** for anything that may ever appear on a shared display, with revocation that a stale edit cannot undo; (4) one pure "family view" reader that Today, the Family overview and (later) a tablet projection all share. The tablet itself must receive only a purpose-built projection, **never the full sync file**; that is a separate project after F5.
- **Five phases, F1 to F5**, each small: foundation, dates and Calendar, responsibilities (Tasks, Projects, Contacts), overview and discovery, acceptance. The Command Station is a separate, later initiative (section 14).
- **Five owner decisions** (section 16). Only two need answering before F1.

---

## 2. Existing capabilities to reuse (verified in source)

| Need | What exists | Where |
|---|---|---|
| A person's identity | Shared `contacts` table: `name`, `relationship` (free text), `notes`, `phone`, `email`. Time-based ids, soft delete, synced. **There is no Contacts screen**: contacts are created and chosen through pickers (`ContactPicker`) and Projects' vendor list. | `src/core/entities.ts`, `src/core/contacts.ts`, `src/ui/pickers.tsx` |
| Creating a contact without duplicates | `findOrCreateContact` (matches by name ignoring case/accents, never overwrites, fills only blank phone/email/relationship, one transaction). **Hazard for families:** two different people with the same name become one (section 5.4). | `src/core/contacts.ts` |
| "Which people is this about" | `contactIds: number[]` on **both** Calendar events (`EventData`) and Tasks (`TaskData`), plus Projects' vendor contacts. | `calendar/model.ts`, `tasks/model.ts` |
| Birthdays today | Calendar event type `birthday` (yearly, all-day, reminder a day before) with a "People" picker. The editor titles it "<name>'s birthday". | `calendar/eventTypes.ts`, `EventEditor.tsx` |
| Recurrence | Calendar events have their own series rule with `skipped` and `overrides` per occurrence; Tasks have their own repeat. Both are existing engines. | `calendar/recurrence.ts`, `tasks/recur.ts` |
| Dated items without copying | Due-provider contract: read-only, pure, stable ids `module:record:date`, `coveredBy` display coordination, a built-in Calendar layer per module (ids `9_000_000_000_000_101` to `_107`). Today reads the same aggregate. | `docs/due-provider.md`, `calendar/model.ts`, `today/TodayData.tsx` |
| Module records | `moduleRecords` (`module`, `kind`, `data`), defensive readers that carry unknown fields through, defensive "needs review" for unreadable records. | `core/entities.ts`, pattern in `bills/`, `services/` |
| Cross-record pointers | `links` table (`fromModule/fromId/toModule/toId/type`), `contributes.records` for naming a record. | `core/registry.ts` |
| Today, Search, Quick Add | `todayCards`, `searchSource`, `quickAdd` hooks; Today also gets every due provider for free. | `docs/module-hooks.md` |
| Backup and sync | Whole database. New kinds in `moduleRecords` are exported, restored, encrypted and synced with no code; an optional friendly label goes in `MODULE_KINDS` (`backupSummary.ts`). Unknown kinds from newer builds pass through. | `docs/module-hooks.md` G1, `docs/sync.md` |
| Deletion safety pattern | Dependency readers and guarded, previewed deletes (Finance `txnReferences`, Assets/Projects deletion rules). | `core/txnDependents.ts`, `docs/module-hooks.md` |
| Finance "people" | A separate `people` table (name, `birthYear`) used **only** for tax rules (catch-up eligibility). Not a household-member list. | `src/types.ts` |

**Reuse verdict:** every Family Management need in the brief can be met with existing mechanisms plus one new kind of record. No new store, service, recurrence engine, task model or calendar is justified.

---

## 3. Product definition

**What problems it solves (single household):**
1. "Who is where, when?" in one place: this week's school, sports and appointments, by person.
2. "What do I need to do for it?" Tasks about a person's activities (sign the form, pack the bag, register for the season) show up with the person.
3. "What dates matter?" Birthdays and other yearly dates, with lead time, without a separate reminder system.
4. "Who do I call?" The few important contacts for each person (school office, coach, pediatrician's front desk), as links to shared Contacts.
5. "What is the bigger thing?" A family initiative (a summer camp plan, a move, a school application) as an ordinary Project.

**What it is not:** it is not a personal CRM. A CRM tracks relationships *with* people (last contacted, follow-up cadence, pipeline, interaction logs). Family Management tracks *the household's own members and what they are doing*. There is no contact-frequency, touchpoint or relationship-scoring feature, and none is proposed. (The shared Contacts table continues to serve everyone else: vendors, providers, relatives.)

### Who owns which record

| Record | Owner | Family Management's role |
|---|---|---|
| Person's name, phone, email | **Contacts** (shared table) | Reads; edits through the same contact helpers; never copies |
| "Is a household member", birthday, color, status, short note | **Family** (new `member` record) | Owns |
| Other important dates (anniversary, adoption day) | **Family** (new `date` record, F2) | Owns, derives Calendar markers |
| Activities, appointments, school events, games | **Calendar** (ordinary events with `contactIds`) | Reads and displays by person; may create through Calendar's own data functions |
| Things to do | **Tasks** (ordinary tasks with `contactIds`, optional `projectId`) | Reads and displays by person; creates through Tasks' own functions |
| Larger initiatives | **Projects** | Reads and links; never a parallel system |
| Documents | Existing external-link metadata (`attachments`/safe `http(s)` links), as Assets does | Reference only |

### Dashboard (F4 overview, `#/family`)
Household members (cards with color), **This week** by person (Calendar events + open Tasks for each member's contact), **Coming up** (birthdays and dates, next 30 days), **Needs attention** (counts only: overdue family tasks, members with no birthday set, a member whose Contact was merged away), **Important contacts** (links per member), **Initiatives** (Projects linked to a member).

### Today
Birthdays and important dates arrive through the due provider with no card. Activities and tasks already appear in Today because Calendar and Tasks feed it. **No Today card in F1 to F3.** F4 may add one counts-only card ("2 family dates this week") only if the owner finds Today too quiet; it must not repeat what the agenda shows.

### Calendar
A new built-in layer "Family" (derived, read-only) for member-derived dates. Activities stay in whichever existing calendar the owner puts them in. Color-by-person is a *display rule* from the member record (section 6.5), not a calendar per child.

### Search
Members (name only), important dates (label only). Activities and Tasks are already searchable by their own modules; Family does not index them again. Birth *year*, notes and contact details are never searched or shown in a result.

### Quick Add
One destination, prefix `fam` (alias `family`; clash-checked at start-up like every prefix; current prefixes are `$ a b bs e hs p svc t`). Forms: `fam date Sam birthday 14 may`, `fam activity Sam soccer sat 9am` (creates an ordinary Calendar event with Sam's Contact in `contactIds`), `fam task Sam sign trip form fri` (an ordinary Task). Always a preview first and an Undo, as elsewhere.

### What might one day suit a shared household tablet
Member names (first name or nickname) and colors; family-eligible events and tasks (title, date, time, who for); birthdays the owner chose to show. **Never** by default: notes, locations of private appointments, phone/email, anything linked to Finance, Bills, Services costs, Projects money, health or school-record detail. See section 10.

---

## 4. Scope and exclusions

**Candidate capabilities and my assessment** (value / complexity / sensitivity / fit):

| Capability | Verdict | Why |
|---|---|---|
| Household-member profiles | **Include (F1)** | Core. Small record, high fit |
| Relationships between members | **Include minimal (F1)**: one role label per member (parent, child, grandparent, other) | A full relationship graph is high complexity, low value for one household. Free-text/limited role covers it |
| Birthdays and important dates | **Include (F2)** | High value, low complexity via derived provider |
| Activities and appointments | **Include as Calendar events (F2, F4)** | Already supported; only display by person and a creation shortcut are new |
| School and childcare information | **Defer a dedicated record; F3 as links** | School name, hours, teacher contacts are better as Contacts plus a few Calendar series; a structured "school profile" is speculative |
| Emergency and important contacts | **Include as links (F3)**, not a second address book | Member -> Contact links with a short "what for" label |
| Family-related Tasks | **Include (F3)** via `contactIds` | Already supported |
| Associations with Projects | **Include (F3)** via the existing link | Reuse |
| Document references | **Include later, reference only (F3 or later)** | Same safe-link metadata as Assets; no file storage |
| Family overview | **Include (F4)** | Read-only composition |
| Today / Calendar / Search / Quick Add | **Include (F2 to F4)** | See section 3 |
| Future family-safe display eligibility | **Design now, build later** | Section 10 |

**Out of scope for F0 and initial implementation (unchanged from the brief):** separate user accounts, member logins, roles/access control, multi-tenant, invitations, real-time collaboration, messaging, location tracking, medical-record ingestion, school-portal integration, new external-calendar integrations, AI profiling, new backend services, the tablet frontend, restricted tablet sync. Ledger remains a single-household app.

---

## 5. Recommended Contacts / identity architecture

### 5.1 The three approaches

| | **A. Family fields added to Contact** | **B. Family record linked to a Contact** (recommended) | **C. Family record with its own name** |
|---|---|---|---|
| Idea | Add `isMember`, `birthday`, `color`... to each `contacts` row | New `family/member` record holding family fields plus `contactId` | Independent person list |
| Benefits | One row per person; nothing to keep in step | Identity stays in Contacts; family data has an owner; Tasks/Events already point at the Contact | Simple to write |
| Disadvantages | Contacts is a *shared* table every module can rewrite (`put`s by Projects, pickers, Undo); family-only data (birth date, display flag) would sit on a record vendors and pickers also use; no module owns it; no friendly "needs review" for damaged fields; the table has no kinds | One extra record per member; must keep link valid | **Second address book**; duplicate identities; Tasks/Events would have two ways to say "Sam" |
| Duplicate identity risk | Low | Low if creation goes through a "use existing or create separate" step | **High** |
| Existing Contacts compatibility | Edits an existing shared row's shape | **None changed** | Parallel |
| Family relationships | Awkward (relationship is free text on a shared row) | Role stored on the member record | Own field |
| Search | Contacts has no search source of its own (Tasks searches contacts as a filter) | Family adds a member search source | Own |
| Profile editing | Mixed shared/family edits | Name/phone/email edited through the contact helpers; family fields on the member | Own |
| Command Station | A filter would need to *drop* fields from a shared table; hard to prove family-safe | Projection is built from member records plus the *name only* of the Contact; clean | Clean but duplicated |
| Migration | Existing contacts silently gain meaning: risk | **None** (no existing data touched) | None |
| Cost | Low | **Low to medium** | Low, but pays back as bugs |

**Alternative C2 considered:** "membership is only a `links` row (type `household-member`) from a Contact, no record". Rejected: there is nowhere to hold a birth date, color, status or display eligibility, and a link row has no defensive reader or kind.

### 5.2 Recommendation
**Approach B.** `family/member` -> `contactId`. The Contact stays the single identity (and the id that Tasks, Events and Projects already use). Family adds only what Contacts cannot hold.

### 5.3 If the person already exists as a Contact
Creating a member offers: **"Use an existing contact"** (searchable list; this is the normal path) or **"Create a new contact"**. Nothing is merged, overwritten or renamed. Linking a Contact never edits it; only fields the owner types in the Family form are written, through the existing contact-update helper, and only blank ones are filled (the same rule `findOrCreateContact` follows). Existing Tasks and Calendar events that already list that Contact in `contactIds` **immediately belong to the member's profile**, with no migration.

### 5.4 Duplicate-identity safeguards (must be in F1)
- **Same-name trap:** `findOrCreateContact` treats two people with the same name as one. The Family create flow therefore must not silently reuse a name match: when a Contact with that name exists it asks "Use the existing contact, or create a separate one?" (default: separate is never assumed; the owner chooses).
- **One member per contact:** saving refuses a second *live* member for the same `contactId`; if two devices create one offline, both are kept and flagged "possible duplicate member" for review (the same non-destructive rule Services/Assets use), never merged automatically.
- **Finance `people`:** not linked or merged. Birth year already exists there for tax math. An optional, explicit "this is the same person as Finance's <name>" pointer is **deferred** (and would never copy a value).

### 5.5 Deletion and reference integrity
- **No Contacts screen deletes a contact today** (the only removal in source is Household Services' Undo of a contact it created, and only when nothing refers to it). Family never deletes a Contact.
- Because Tasks/Events/Projects point at the **Contact**, removing or archiving a *member* record cannot leave a dangling link in them. "Leave household" = status change (`status: 'past'`), keeping history. Permanent member deletion is allowed only after a previewed "who points at this person" read (section 11) and removes only the Family record.
- The Final Disposition's prerequisite "a shared who-points-at-this-person reader" is satisfied by one read-only function (members' `contactId` found in Tasks, Events, Projects, links), built in F1 with a guard test that it writes nothing.

---

## 6. Minimal data model

**Storage:** `moduleRecords`, `module: 'family'`. **No schema migration, no new table** (none is authorized, and ST-S5.1's rule is respected). Defensive reader: unknown fields carried through, unreadable record -> "needs review", never rewritten, as in Bills/Services. Ids are time-based, assigned by the store.

### 6.1 `member` (F1)

| Field | Kind | Notes |
|---|---|---|
| id | Required (store) | Stable record id; **the stable person identity for Family** is `contactId` |
| `contactId` | **Required** | Reference to the shared Contact. Name/phone/email live there |
| `role` | Required, small list | `parent`, `child`, `grandparent`, `other`. Display and grouping only; no permissions |
| `status` | Required | `active` or `past` ("no longer in the household"); never a delete |
| `birthMonthDay` | Optional | `MM-DD`. Enough for reminders |
| `birthYear` | Optional | Only if the owner enters it; needed for "turns 9" and nothing else. Never searched, never in Calendar titles by default |
| `color` | Optional | One of a fixed palette (reuse `SWATCHES`); the member's display color. Absent = neutral |
| `note` | Optional | Short, plain text; masked behind a "Show notes" action like Assets' sensitive fields; never searched or shown in a result |
| `displayName` | **Deferred** | A nickname for a shared screen. Until then the display uses the Contact's name; see section 10 |
| `display` | Optional, F2 | `'show'` or absent. **Absent means hidden** from any future shared display (fail closed) |
| Derived (never stored) | | age, next birthday, upcoming items, open tasks, "turns N" |
| References owned elsewhere | | name/phone/email (Contact); events (Calendar); tasks (Tasks); initiatives (Projects) |
| Fields deferred | | grade, school, allergies, sizes, medications, pickup rules, per-member default calendar |

### 6.2 `date` (F2): an important date
`memberId` (optional; absent = whole household), `kind` (`birthday` | `anniversary` | `other`), `label`, `monthDay` (`MM-DD`) and optional `year` (for "10th anniversary"), `remindDays` (optional list), `display` (as above). A member's own birthday does **not** need a `date` record: it is read from `member.birthMonthDay`. Fewer records, no drift between two copies of the same date.

### 6.3 `link` (F3)
Family-specific relationships that are not already `contactIds`: *important contact for this member* (`memberId`, `contactId`, short `purpose` such as "school office"), and *initiative for this member* is simply the existing Project link or the Project's own people. Stored as `family/contact` records to keep one-record-per-fact and avoid last-writer-wins clobbering (two devices adding different contacts both survive).

### 6.4 What is NOT stored
Social Security numbers, identity-document scans, medical records, credentials, financial account details, detailed personal tracking, precise addresses of children, school-portal logins. **No concrete requirement exists for any of them**; adding one later is a separate decision with a masking and backup rule (section 11).

### 6.5 Display identity (for the future tablet and for color-coding today)
`color` lives on the **member**, not on a Calendar layer. An event listing two members' Contacts shows both colors (dots/stripes). This needs **no Calendar change**, and it avoids "one calendar per child", which breaks the first time one event involves two children (an event has exactly one `calendarId`).

### 6.6 Does `moduleRecords` suffice?
Yes, with the kind-per-fact pattern the repo already uses (`member`, `date`, `contact`, later `share`). A newer build's unknown `family` kind passes through older builds untouched (ST-S5.1 proves unknown *tables*; unknown *kinds* and *fields* were already safe).

---

## 7. Calendar integration

**Principle: Calendar remains the single source of truth for events.** Family adds no event store and no recurrence engine.

| Thing | Where it lives | Mechanism |
|---|---|---|
| School play, soccer game, dentist, recurring practice | **Calendar event** (stored), `contactIds` = who it is for | Existing editor ("People"), existing repeat, skip and per-date overrides |
| Birthday of a member | **Derived** from `member.birthMonthDay` | Family due provider, layer "Family" |
| Anniversary / other yearly date | **Derived** from a `date` record | Same provider |
| Something to *do* (sign a form, pack bag) | **Task** with `contactIds` | Tasks' own due/repeat; appears on Calendar's Tasks layer |
| Informational only | Calendar event with no Task | Nothing else created |

**Requirements met by design**
- *Stable identities:* derived markers use `family:birthday-<memberId>:<date>` / `family:date-<recordId>:<date>` (the `module:record:date` convention) and `icsUid` `family-...@ledger.local`. Event identities are Calendar's own.
- *Consistent date arithmetic:* the next occurrence of `MM-DD` is a **pure function** over local `YYYY-MM-DD` strings (the project's existing date helpers; no time zones for all-day items). It is not a recurrence engine. **Feb 29** (a leap-day birthday) falls on **Feb 28** in non-leap years; this is a stated convention and an **owner-visible choice**, not verified against Calendar's yearly rule (UNVERIFIED: F2 must test Feb 29 against the Calendar's existing yearly behavior and make the two agree or state the difference).
- *Correct recurrence:* never re-implemented; stored events recur through Calendar's engine unchanged.
- *No duplicate calendar records:* Family never writes a derived date into Calendar. **Existing stored "Birthday" events** (type `birthday`, same Contact) are left untouched; the Family marker carries `coveredBy` pointing at that event's item so the Calendar and Today show one, using the existing display-only rule (`markerCoordination.dropCovered`). The exact event item id format must be confirmed in F2 (UNVERIFIED here).
- *No duplicate Task generation:* a birthday creates **no Task** by default. An optional "remind me to buy a gift" would be a single opt-in Task with a marker, created once under a re-read inside the transaction (the Services/Bills pattern), and is out of F2 unless the owner asks.
- *Provider conventions:* read-only, pure, fast, never fails the Calendar, `getDueItems({from,to,today,overdueDays})`, rolling window like Bills (today through the same day 12 months later). New layer id: next free is `9_000_000_000_000_108`, but `layerVisibility.test.ts` already uses `_108` as a made-up "new layer", so F2 must either pick `_108` and update that test or pick another unused id.
- *Multiple members per event:* an event's `contactIds` already allows many. Family finds "events for Sam" by `contactIds` containing Sam's `contactId`.
- *Titles:* "Sam's birthday" (name only). No age, no birth year, no notes in a marker title or detail. ".ics" export unchanged (Family layer not exported by default; export would be a separate privacy choice).

---

## 8. Tasks, Projects and responsibilities

**Smallest sufficient integration:** a Task or Calendar event is "about" a member when its `contactIds` contains the member's `contactId`. That is **already a stored, editable, synced, searchable relationship**. Family reads it; it adds no field to Tasks and no link table.

| Workflow | Implementation |
|---|---|
| Task for a member | Task with `contactIds=[member.contactId]` (the "People" field Tasks already has). Family shows it under the member |
| Prepare for a school event | Calendar event (informational) + one or more Tasks for the same member, optionally linked with the existing `about` link from the Task to the event. Family does not generate them automatically |
| Pack sports gear | A **repeating Task** using Tasks' own repeat; completion is Tasks' completion |
| Register for an activity | Task, optionally linked to a Project |
| Larger initiative | A **Project** (existing); link by `involves`-style link from the member to the Project, or by the Project's own task/event membership. No Family project type |
| Family responsibilities in Today | Tasks already appear on Today; Family adds nothing. A "for Sam" label can be shown from `contactIds` |

**Explicitly not created:** a second Tasks database, independent completion states, duplicate reminders, a parallel Projects system, a new recurrence model.

**Risk to manage (F3):** if a Task's `contactIds` is edited to remove Sam's contact, the Task silently leaves Sam's view. That is correct behavior (it is no longer about Sam) but it must be stated in the UI. Whole-record last-writer-wins applies to Tasks as it does today.

---

## 9. Overview and navigation

- **Module name:** "Family" (route `#/family`, id `family`). Registered last in `src/modules/index.ts`; screens load on demand through `lazyModule` (ST-S4); nothing registers at import time; a style entry in `moduleStyles.ts`.
- **Pages / tabs (mobile first, bottom-friendly, no module tab bar needed):**
  1. **Overview** (`#/family`): members, This week, Coming up, Needs attention (F4; F1 shows just members).
  2. **Member** (`#/family/m/<id>`): header (name, role, color, age if known), tabs/sections **Schedule** (events for the member), **To do** (open tasks), **Dates**, **Contacts**, **Notes** (masked).
  3. **Dates** (`#/family/dates`, F2): all important dates in order.
  4. **Settings** (small, inside Family): palette defaults, show/hide birth year, per-member birthday on/off.
- **Initial release (F1):** member list, add/edit/archive, Contact link/create, member page with empty states. Everything else arrives in later phases.
- **Quick Add actions:** `fam date`, `fam activity`, `fam task` (F4).
- **Search results:** group "Family": member, important date (F4).
- **Today contributions:** none as cards; derived dates via the provider (F2).
- **Mobile:** cards stack, controls at least 44 px, one `main` via `Main.tsx`, one `h1`, labelled controls (`a11yLabels.ts` rules: no money in names; Family has none), `ConfirmDialog` for destructive actions.
- **Not in the initial release:** dashboards of charts, gift lists, sizes, school profiles, documents, tablet anything.

---

## 10. Future Family Command Station: vision and architecture considerations

**Vision (not a requirement for F1):** an iPad or Android tablet in a shared area showing glanceable day/week/month schedules, events color-coded by member, birthdays, selected reminders and chosen tasks; read-only first, touch interaction (complete a task) possibly later.

### 10.1 Which design decisions to make *now*
1. **Identity:** the display refers to people by Family `memberId`/Contact id only inside the projection; names shown are the member's display name (default: the Contact's name). Done by approach B.
2. **Event-to-person:** `contactIds` on events (already there).
3. **Task-to-person:** `contactIds` on tasks (already there).
4. **Display identity:** `member.color` (and later `displayName`). Done in the model.
5. **Single Calendar source of truth:** no tablet calendar database. The tablet receives a *derived, expanded list of occurrences for a window*, produced by Ledger's existing engines, so the tablet needs **no recurrence engine** and cannot disagree about recurrence.
6. **Eligibility and privacy defaults:** below.
7. **One shared reader:** build the "family view" (this week by person, coming up) as **one pure function** in F4 that takes an *audience* (`owner` or `display`). The owner's Today/Family overview use `owner`; a future projection uses `display` with the eligibility filter. This prevents two diverging readers and is the only place the "is this allowed on the display" rule lives.

### 10.2 Visibility and privacy (recommended safe defaults)
- **Default is private.** A Calendar event or Task is *not* eligible for a shared display just because it references a member. Eligibility is a separate, explicit, per-item opt-in (and may be set for a whole series).
- **Fail closed:** anything unreadable, unrecognized, newly added or from a newer build is **excluded**.
- **Inheritance:** an *unset* item inherits nothing (hidden). An optional per-member convenience ("show all of Sam's events by default") is a *later* owner choice, never the default, and an item can always override it to private. Birthdays/dates derived from a member use that member's/date's own `display` flag (absent = hidden).
- **Revocation must be safe.** Because Ledger syncs whole records by last-writer-wins, a plain mutable flag on an event could be **resurrected by a stale device** after the owner made it private (a "make private" edit losing to a later unrelated edit made on a device that still held `visible`). Therefore eligibility should be stored as **append-only decisions** (the Bills `ack` / lifecycle pattern: one record per decision, newest decision wins, never edited) or as an allow-list the owner re-publishes, **not** as a bare boolean inside the event/task row. *The storage form is decided in the Command Station phase; the rule that revocation cannot be undone by a stale edit is fixed now.*
- **What is never family-eligible, even if opted in by mistake:** notes, free-text locations flagged private, phone/email, anything with a Finance/Bills/Services/Projects-money link, attachments, birth year, and any record of kinds the display builder does not explicitly know.

### 10.3 Financial isolation (hard requirement)
Hiding financial screens is insufficient if the device downloads the database. Ledger's sync file is **the entire database, encrypted with one passphrase, in one private repository, reachable with one token** (`docs/sync.md`). Giving a tablet that passphrase or token gives it everything, including every transaction and balance. So:

**Concept: a restricted data projection.** Ledger (on the owner's main device) *builds* a small, separate "family display file" from **only** allow-listed items and **publishes** it to a **different destination with a different, read-only credential**. The tablet reads that file and nothing else. It never holds the Ledger sync passphrase, the Ledger sync token, or any Ledger data.

| Aspect | Recommendation |
|---|---|
| Direction | **One-way**, main device -> tablet. The file is *regenerated and overwritten*, never merged |
| Contents | A rolling window (e.g. today minus 7 days through plus 60 days) of already-expanded occurrences: `{date, time, title, memberId(s), color}`, member names/colors, birthdays opted in. No ids of Finance, Bills, Services or Projects records |
| Destination (simplest viable, consistent with today's model) | A **separate private GitHub repository** holding one file, read by the tablet with a **fine-grained, read-only, single-repository token**. No new backend. (Not GitHub Pages: Pages content is public.) |
| Credentials | Separate from Ledger sync. Tablet token can read one file, cannot write, cannot see the Ledger sync repository |
| Encryption | Reuse the existing passphrase-encryption helper with a *different* passphrase typed once on the tablet. No new scheme |
| Interactive (later) | Writes go to a separate small **inbox file** the tablet may append to ("task X done"); the main device ingests it deliberately. The tablet never writes to Ledger's data. Decide later |
| Offline | The tablet caches the last file and shows "updated <time>"; a stale banner past a limit; the day rolls over locally |
| Alternatives considered | Manual export/import (safe, tedious); a public/secret-URL `.ics` feed (a leaked URL exposes children's schedules; reject); a custom backend (out of scope) |

**Likely dependencies:** the main device must be running Ledger to publish (a "publish now" button and publish-on-change); a second GitHub repo and token; a tiny read-only display page that **imports no Ledger data code** (so it cannot even read a Ledger database if one were present). **Security implications:** the display token is a credential on a wall-mounted device (revocable, scoped, read-only); a stolen tablet reveals only the published schedule; the publish step is the one place a leak could occur, which is why it must be an allow-list builder with tests, not a filter over the full database.

**Hosting:** the owner has chosen to keep the existing GitHub organization, repositories and Pages arrangement; shared-origin exposure (SE-01) is a **documented, owner-accepted risk** and is not reopened here. The tablet's isolation requirement is independent of that decision: the display must run in a **separate browser profile / separate page** that never contains Ledger's database.

### 10.4 Read-only vs interactive; technology
First version read-only. Interactive features add a write path and must not weaken isolation (inbox pattern above). **No tablet model, framework, host or UI design is chosen in F0.**

---

## 11. Privacy, backup and sync

- **Data minimization:** only the section 6 fields. Birth *year* optional. No notes by default; notes masked until deliberately shown (Assets' pattern); notes and year excluded from Search, Calendar titles, Today and any future projection.
- **Child-related information:** no precise addresses, no school IDs, no medical or school-portal data. A visible line on the member form: "Do not store health, ID or account details here."
- **Plain backups:** member notes ride in the ordinary backup like Assets' sensitive fields. The existing plain-backup warning applies; the owner decides (D2) whether member notes exist at all. If notes are included, the Backup summary names "Family members" so the owner can see them.
- **Encryption:** unchanged. Family records use the existing encrypted backup and encrypted sync. No new scheme.
- **Sync conflicts:** member and date records are small and whole-record last-writer-wins, which loses the other device's *edit* (kept in the conflicts list, ST-S1) but not the record. The kind-per-fact design (`contact` links, later `share` decisions) avoids clobbering independent facts. A duplicate member made offline on two devices is flagged, never merged or deleted.
- **Unknown tables and conflict history (ST-S5.1):** the proposal adds **no table**, so ST5-F1 does not apply; a newer build's unknown `family` kinds pass through older builds. Conflict history writes go through `MetaStore.update` unchanged; Family writes nothing to it directly.
- **Deletion and references:** section 5.5. No reader may write; a guard test (like `txnDeletionGuards`) enforces it.
- **Backup coverage:** `MODULE_KINDS` gains `family: { member: 'Family members', date: 'Important dates', contact: 'Important contacts' }` (a cosmetic label; unlabelled kinds are still listed and never dropped).
- **Device preferences:** any new screen preference in `localStorage` must be added to `PREFERENCE_KEYS`; none is needed in F1.
- **Ordinary vs tablet data:** the boundary is the projection builder (10.3). Ordinary Family records are ordinary Ledger data; only items with an explicit, current "show" decision ever leave through it.

---

## 12. Integration map

| Existing module | Relationship | Status | Notes |
|---|---|---|---|
| Contacts | Person identity | **Supported** (`contacts` table, helpers) | Small risk: same-name merge in `findOrCreateContact`; Family create flow must ask |
| Calendar | Activities, birthdays, dates | **Supported** (events + `contactIds`); needs **small extension**: one new derived layer id and `coveredBy` use | Calendar must never import Family; the layer arrives through the registry |
| Tasks | Responsibilities | **Supported** (`contactIds`) | No change to Tasks |
| Projects | Larger initiatives | Supported (links; Projects reads tasks/events) | Family -> Projects read-only; no Family project kind |
| Today | Dates/obligations | **Supported through the provider**; optional counts-only card (F4) | No amounts, no names beyond titles |
| Search | Members, dates | Small extension (new `searchSource`) | Names/labels only |
| Quick Add | `fam ...` | Small extension (new destination) | Preview first, Undo, no prefix clash |
| Home & Assets | Only if a workflow needs it | **Defer** | e.g. a child's bike as an asset needs no link today |
| Household Services | Only for family scheduling | **Defer** | A nanny/cleaner visit is already a Services visit/Task; can carry `contactIds` later |
| Household Finances | None | **No automatic integration** | |
| Finance | None | **No direct integration** | Finance `people` stays separate (tax). No transaction link |
| Bills | None | **No integration** | |
| Backup/Sync | Existing persistence | **Supported** | No code beyond a label |

**Dependency direction (no cycles):** `family` reads `calendar`, `tasks`, `projects` data modules and shared `core`; **none of them imports `family`**. Family reaches Calendar/Today only through the registry (`dueProvider`, `todayCards`, `searchSource`, `quickAdd`), exactly as Bills/Services/Assets do. A guard test (like `b5-guards.test.ts`) pins this and pins that Family opens no Finance table.

---

## 13. Recommended roadmap F1 to F5

Each phase ends with a stop for review and the owner's authorization. Combine F4 and F5 if F4 turns out small.

### F1: Family foundation
- **Scope:** module shell; `member` record; add (use existing or create a separate contact), edit, mark "past"; member page skeleton; read-only "who points at this person" reader; backup label; the duplicate-member check.
- **Dependencies:** owner decisions D1 and D2; the section 5 identity rules.
- **Deliverables:** `src/modules/family/` (registration, screens on demand, model, data, reader), `family` kind labels, tests, a short report, handoff and backlog update.
- **Risks:** same-name contact merge; a second address book by accident; masking of notes; bundle growth (lazy screens keep the first download unchanged).
- **Essential tests:** defensive reader (damaged/unknown/newer fields carried through); no second live member per contact; creating with an existing contact never edits it; "create separate" never reuses a name match; reader writes nothing; real `SyncEngine` two-device duplicate member kept and flagged; backup/restore round trip; unknown-kind carry-through; import-graph guard (Calendar/Tasks/Projects never import Family; no Finance table touched); `lazyBoundary` still passes.
- **Exit criteria:** members can be added/edited/archived on desktop and 375 px; no Contact changed by linking; all guards green; no schema change; handoff and backlog updated.

### F2: Family dates and Calendar
- **Scope:** `date` record; derived birthdays and dates; Family due provider and layer; coordination with stored Birthday events; per-member birthday on/off; Feb 29 rule; first `display` field (absent = hidden).
- **Dependencies:** F1; D3.
- **Deliverables:** provider (read-only, pure), layer seed, tests, report.
- **Risks:** double birthdays; Feb 29; layer id collision with the `_108` test; timezone drift (all-day plain dates only).
- **Essential tests:** provider is pure/read-only (database byte-identical); stable ids across devices; Feb 29 in leap and non-leap years and across year-end; shifted clock/time zone runs (as ST-S4); no title carries year/age/note; stored Birthday event for the same contact wins and shows once, and Family marker returns if the Family layer or the event is hidden; Today shows it with no new card.
- **Exit criteria:** a birthday appears once on Calendar and Today; no stored Calendar record created; the existing Calendar tests unchanged.

### F3: Family responsibilities
- **Scope:** member page "Schedule" and "To do" read by `contactIds`; `contact` links (important contacts); link a member to a Project; document references (links only); a "for whom" display helper.
- **Dependencies:** F1 (F2 optional); D4.
- **Deliverables:** readers over Calendar and Tasks data, link records, tests.
- **Risks:** reading large Task lists on a phone; a Task edited to drop the contact; a Project deleted.
- **Essential tests:** reads never write; a Task with two members appears under both; completing a Task from the member page is Tasks' own `completeTask` (or not offered); deleting a Project/Contact/Task leaves Family consistent (no dangling error); two devices adding different important contacts keep both.
- **Exit criteria:** from a member page the owner sees the next events and open tasks, and every action is performed by the owning module's own function.

### F4: Family overview and discovery
- **Scope:** Overview; Search source; Quick Add `fam`; optional counts-only Today card; the shared pure "family view" reader (with the audience parameter, `display` unused).
- **Dependencies:** F1 to F3.
- **Risks:** duplicating what Today already shows; Quick Add parsing ambiguity (two members with similar names); search leaking private fields.
- **Essential tests:** no prefix clash; ambiguous name refuses with a reason; preview first and Undo removes only what it made; search never returns notes/year/phone; Today card counts agree with the Overview; Hide-Amounts irrelevant (no money) is stated.
- **Exit criteria:** one cohesive Overview; Search and Quick Add work for members/dates; Today not noisier.

### F5: Acceptance and polish
- **Scope:** mobile (375 and 320 px) and dark checks, keyboard and screen-reader pass, focused backup/sync regression, owner device checklist.
- **Essential tests:** accessibility structure (one `main`, one `h1`, named controls, 44 px targets); backup (plain and encrypted) and restore with Family data; real-engine sync of Family kinds including an older-build carry-through; a documented real-device pass by the owner (not claimable by me).
- **Exit criteria:** acceptance report with evidence categories separated (automated, browser, owner device), handoff and backlog true to the evidence.

---

## 14. Separate future initiative: Family Command Station (after F5)

Provisional, **not authorized, not scheduled, outside F1 to F5**. Rough shape:

1. **CS-0 Design:** pick the publish destination and credential model; decide the eligibility storage form (append-only decisions vs allow-list); define the projection format and size limits; threat model for a wall-mounted device.
2. **CS-1 Projection builder (in Ledger):** pure allow-list builder using the shared family-view reader with `audience: 'display'`; golden-master tests that **no non-eligible record, no Finance/Bills/Services/Projects data, no note/contact detail/birth year can appear**; fuzz tests with deliberately hostile records.
3. **CS-2 Publish:** explicit "Publish to family display" (and publish-on-change), separate credential, regenerate-and-overwrite, revoke by publishing again or deleting the file.
4. **CS-3 Read-only display page:** separate entry that imports no Ledger data code; large-type day/week/month views, color by member, offline cache with a staleness banner, touch-friendly.
5. **CS-4 Optional interaction:** inbox-style "mark done" the main device ingests; never direct database access.

**Realistic dependencies:** mature Calendar (done), Tasks (done), the Family member model (F1), eligibility decisions (CS-0), and the owner's real two-device sync passing first (the tablet adds a third device to a system whose real-device acceptance is still open). No tablet model or infrastructure provider needs choosing before CS-0.

---

## 15. Important risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | A second address book or duplicate identities | Approach B; no own name field; same-name prompt; one member per contact; duplicates flagged not merged |
| R2 | `findOrCreateContact` merges two same-named people | Family create flow never reuses a name match silently (section 5.4) |
| R3 | A stale device resurrects "visible" on a shared display | Append-only eligibility decisions; default private; fail closed (10.2); decided before any display work |
| R4 | The tablet is handed Ledger's sync credentials "for convenience" | Hard rule: separate projection, separate read-only credential (10.3); written into the plan and the handoff |
| R5 | Child data creeping into notes and plain backups | Minimization rules; masked notes; D2 may remove notes entirely; backup warning |
| R6 | Birthday shown twice (stored Birthday event + Family marker) | `coveredBy` coordination; F2 tests |
| R7 | Feb 29 and year-end date errors | Pure function; explicit leap tests; shifted-clock runs |
| R8 | A task disappears from a member's view when its contact list is edited | Stated in the UI; correct by construction |
| R9 | Scope creep into school profiles, medical info, tracking | Explicit exclusions; each addition needs a concrete requirement and an owner decision |
| R10 | Real-device acceptance still open (phone, two-device sync, screen reader) | F5 and the Command Station depend on the owner's checklist; I cannot claim device results |
| R11 | Layer id `_108` collision with a test placeholder | Check in F2 |
| R12 | Whole-record last-writer-wins loses an edit of the same member made on two devices | Kept in the conflict list; records are small; accepted |
| R13 | Bundle/first-download growth | Screens on demand; registration only in the first download (ST-S4 rules) |

---

## 16. Owner decisions (five)

**D1. Who is a "family member"? (before F1)**
Options: **(A) a Family record linked to a Contact (recommended)**; (B) extra fields on the Contact; (C) a separate people list.
Default: A. It keeps one identity, changes no existing Contact, and lets today's Tasks and events attach to a person immediately.

**D2. What a profile holds at the start (before F1)**
Options: **(A) name (from the contact), role, active/past, birthday (month and day), optional birth year, color, short masked note (recommended)**; (B) the same without a note field at all (strictest); (C) add school, grade, allergies, sizes now.
Default: A, with C explicitly deferred. Choose B if you do not want any free-text note about family members in backups.

**D3. Do birthdays and dates appear on the Calendar automatically? (before F2)**
Options: **(A) yes, derived and read-only, with a per-member off switch; an existing Birthday event is left alone and shown instead (recommended)**; (B) only when you add an event yourself; (C) create real Calendar events for them.
Default: A. C would create copies that can drift or double.

**D4. How is a Task or event tied to a person? (decide with D1; needed by F3)**
Options: **(A) the existing "People" field on Tasks and events (recommended)**; (B) a new "for whom" field on Tasks and events.
Default: A. It needs no change to Tasks or Calendar and already works.

**D5. The future tablet rule, decided now (before F2; no technology chosen)**
Options: **(A) accept: default private, per-item opt-in, the tablet only ever gets a purpose-built projection and never Ledger's sync file or credentials (recommended)**; (B) defer all tablet rules until the project starts.
Default: A. It costs one optional field in F2 (absent means hidden) and prevents building something that cannot later be made safe.

---

## 17. Recommended F1 starting point

1. Owner answers **D1 and D2**, plus a nod on D4 and D5 (so F1's model has no surprises).
2. Gate first (as always): release verified, baseline re-run (currently 3,622 in 200 files).
3. Start with the **pure parts**: the member model and defensive reader, the "who points at this person" reader, and the guard tests (import graph, no Finance table, no writes in readers), then the create/edit flows, then the thin member page and the module registration.
4. Keep F1 to one commit-sized batch: no provider, no Calendar layer, no Quick Add, no Search (these come in F2 to F4).
5. Stop for review after F1; do not begin F2 automatically.

*No code, tests, schema, dependencies, settings or deployment configuration were changed to produce this plan.*
