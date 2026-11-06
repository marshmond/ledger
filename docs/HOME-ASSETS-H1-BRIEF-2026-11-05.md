# Home & Assets H1: implementation brief (for review before any build)

Date: 2026-11-05. **Design only. Nothing here is built, committed, pushed or deployed.** Read with `docs/HOME-ASSETS-H0-PLAN-2026-11-05.md`
(Revision 2), which holds the reasoning. This brief is the build instruction for H1 only.

**Gate before any code (owner):** the owner CONFIRMED the eight decisions in H0 section 13 on 2026-11-05 (all "A"). What remains is the explicit
build go-ahead for H1. Earlier text: *(they were recommended defaults, ChatGPT recommended Q1 to Q8 all "A")*. H1 only depends on Q3 (deletion), Q4 (net-worth link deferred), Q5 (masking), Q8 (name and address);
Q1, Q2, Q6, Q7 affect H2/H3. Per `CLAUDE.md`: record the answers in `docs/BACKLOG.md` and wait for an explicit go-ahead.

**Verified facts this brief relies on (read in the code on 2026-11-05)**
- Projects P5 deployed: GitHub Actions run #53 "Deploy to GitHub Pages" for commit `47100bc` completed successfully; local `main` equals `origin/main`.
- Baseline: 1,366 tests pass (90 files) before any H1 change. Type check and build not re-run for H0.
- `RecordLinks` ("Link a record…") is already used by both the Task editor (`tasks/TaskEditor.tsx`) and the Event editor
  (`calendar/EventEditor.tsx`), and lists every module that registers `contributes.records`. So an Assets `records` hook alone enables
  linking from both, with no Tasks or Calendar change.
- Free Add-box words: `a`, `asset`, `item` (used today: `t`, `task`, `e`, `event`, `$`, `txn`, `transaction`, `expense`, `b`, `bill`, `scheduled`, `p`, `project`).
- `touchAll` (`lib/sync/track.ts`) and `mergeSnapshots` (`lib/sync/merge.ts`) are the only two sync-engine files H1 touches, and only in
  work packages P1 and P9.

---

## 0. Scope, work packages and order

**In H1:** asset registry; module registration; types property/area/system/appliance/vehicle/other; parent-child; create, edit, list, page;
optional details and shared Contacts; one basic warranty end date; asset links from Tasks and Calendar events (shown read-only on the asset page);
global search; Quick Add; archive, restore, retirement status; safe permanent deletion with cross-device precedence; masking; accessible
responsive UI; backup and sync compatibility.

**Not in H1 (do not build):** service records or "Done, log it" (H2); the Maintenance section, "Add maintenance" and suggestions (H2); transaction
references, spend totals, project links (H3); several warranties, warranty Calendar layer, replace/bulk-retire workflows, orphan-repair list (H4);
Today card, overview/dashboard (H5); `ledgerPropertyId` (reserved, H3); valuation of any kind; file storage; photos.

**Work packages, in build order** (each ends with the suite green; P9 can be cut without affecting the rest):

| WP | What | Touches shared sync/backup code? |
|---|---|---|
| P1 | Prerequisite: readable conflict labels for module records | `lib/sync/merge.ts` `labelOf` only |
| P2 | Prerequisite: one sentence on the plain-backup card | `pages/PlainBackupCard.tsx` text only |
| P3 | Record model, validation, data layer (no UI) | no |
| P4 | Module shell, registration, list, asset page, form, masking | `modules/index.ts` (one line) |
| P5 | `records` hook, linked tasks/events panel, global search | no |
| P6 | Quick Add destination | no |
| P7 | Archive, restore, retirement status | no |
| P8 | Accessibility/responsive pass and browser checks | no |
| P9 | Permanent deletion: guard, dialog, **cross-device precedence rule** | `merge.ts` (one call), `track.ts` (`touchAll`, one condition), new `assetDeletion.ts` |
| P10 | Docs: README, backlog, report | no |

### P1: conflict labels (small, safe, testable)
`labelOf(r, id)` in `merge.ts` looks for `name`, `payee`, `title`... at the top of a record. Module records keep those inside `data`, so a
conflict notice would read `#<id>` (read from the code; not seen in a browser). Change: after the existing top-level checks, look at `r.data`
(only if it is a plain object) for `name` then `title`, then fall back as before. Pure function, no change to merge results or the sync format.
**Tests:** a module record with `data.name` gives that name; with `data.title` gives it; non-string/empty falls back to `#id`; every existing label
assertion in `sync.test.ts` still passes unchanged. **Reviewer may drop P1**; H1 then records the limitation.

### P2: plain-backup sentence (small, safe)
Add to the existing "NOT encrypted" paragraph on `pages/PlainBackupCard.tsx`: "It also includes any serial numbers, vehicle identification numbers,
plates and addresses you save in Home & Assets." Text only; no logic. **Test:** none needed beyond the existing page tests still passing; checked in
the browser.

---

## 1. Exact record types and validation

Storage: `moduleRecords`, `module: 'assets'`, `kind: 'asset'`, written only through `repo<ModuleRecord>(db.moduleRecords)` (soft delete, time ids,
unknown fields kept). **No new table, no migration; Dexie schema stays 15; backup version stays 15.**

```ts
export const MODULE = 'assets';
export const ASSET_TYPES = ['property', 'area', 'system', 'appliance', 'vehicle', 'other'] as const;
export const ASSET_STATUSES = ['active', 'stored', 'sold', 'disposed', 'replaced'] as const;

export interface AssetData {
  name: string;
  type: AssetType;
  parentId: number | null;
  status: AssetStatus;
  statusDate: string | null;      // YYYY-MM-DD, when it left service or went into storage
  statusNote: string;
  replacedById: number | null;    // only meaningful when status === 'replaced'
  archived: boolean;
  notes: string;
  manufacturer: string; model: string;
  serialNumber: string;           // SENSITIVE
  purchaseDate: string | null; installDate: string | null;
  purchaseCents: number | null;   // whole cents, >= 0; informational only in H1 (feeds nothing)
  warrantyEndDate: string | null; warrantyNote: string;
  contacts: { contactId: number; role: string }[];
  specs: { label: string; value: string }[];
  refs: { label: string; url?: string; note?: string }[];
  address: string;                // SENSITIVE, property only
  plate: string;                  // SENSITIVE, vehicle only
  // anything else found in a stored record is carried through untouched (extras())
}
```

`asAsset(r: ModuleRecord): AssetRecord` reads defensively (pattern of `asProject`): unknown `type` becomes `other`, unknown `status` becomes
`active`, bad dates become `null`, non-finite numbers become `null`, wrong-typed lists become `[]`, never throws; unknown keys are preserved via
`extras(d, KNOWN_KEYS)`. Fields reserved but not read in H1 (preserved as unknown): `ledgerPropertyId`, `txnRefs`, `purchaseTxnRef`.

**Validation (`validateAsset(input): string | null`, plain words, first problem only):**

| Field | Rule | Message (style) |
|---|---|---|
| name | trimmed, spaces collapsed, 1 to 120 chars | "Give it a name." / "That name is too long." |
| type | one of the six | n/a (picker) |
| parentId | null, or a live asset; not itself; no cycle (walk up, stop at depth 12); a `property` cannot have a parent | "A property sits at the top, so it cannot be inside something else." / "That would put it inside itself." |
| status | one of five; `statusDate` real date or null; `statusNote` <= 500 | "The date is not a real date." |
| replacedById | only when status is `replaced`; live asset; not itself; no replaced-by loop | "Pick the asset that replaced it, not itself." |
| dates | real calendar dates (`isDate`); `installDate < purchaseDate` is a **warning shown, not an error** | |
| purchaseCents | `parseAmountToCents`; >= 0 | "That is not an amount." / "The price cannot be negative." |
| text | manufacturer, model <= 80; serialNumber <= 60; plate <= 20; address <= 200; warrantyNote <= 500; notes <= 5,000 | "That is too long." |
| contacts | <= 20; `contactId` a number; role <= 40; same contact and role not twice; blank role allowed | |
| specs | <= 30; label <= 40 and value <= 200; fully blank rows dropped silently; a row with a value but no label is an error | "Give each spec a label." |
| refs | <= 20; label required (<= 80) when url or note is present; url <= 500 and must parse as `http:` or `https:` (anything else, including `javascript:` and `data:`, is rejected); note <= 200 | "Links must start with http:// or https://." |
| type-specific | `address` kept only for `property`, `plate` only for `vehicle`; changing type away from them asks before discarding | |

Same-name siblings are allowed (two "Bedroom 2"); Quick Add and pickers handle ambiguity (section 6).

`createAsset(input)` and `updateAsset(id, input)` run `validateAsset` against the **current live data inside one transaction** (parent and
replacement targets are re-read, so a parent deleted on another device in the meantime is refused, not stored). `updateAsset` merges onto the stored
record so unknown fields survive.

**Helpers (pure, tested):** `ancestorsOf`, `childrenOf`, `breadcrumb(asset)` (names only, sensitive fields never), `wouldCreateCycle`,
`depthOf`, `publicLabel(asset)` (the one string allowed on lists, links, search, Add box and toasts: name, plus breadcrumb).

## 2. Module registration contracts

```ts
// src/modules/assets/index.tsx
export const assetsModule: ModuleDef = {
  id: 'assets',            // permanent: route #/assets, link rows, data namespace
  name: 'Home & Assets',
  icon: <svg .../>,        // house outline, same stroke style as Projects
  Component: AssetsModule, // ModuleBase + ToastProvider + BackupReminder, as ProjectsModule
  routePaths: ['/'], nav: [],
  contributes: { records: assetRecords, searchSource: assetsSearchSource, quickAdd: assetQuickAdd },
};
```

- `src/modules/index.ts`: `registerModule(assetsModule)` after Projects. No `dueProvider`, no `todayCards` in H1 (so no Calendar layer and no change to the
  "4 built-in calendars" tests).
- Routes: `/assets` (list), `/assets/:id` (asset page), `/assets?new=1[&parent=<id>]` (open the form; used by the page's "Add inside" button).
- Start-up checks (`checkHooks`) must pass: Quick Add id `asset`, prefix `a`, aliases `asset`, `item` are free.
- **Integration boundaries:** only `modules/assets/**` writes asset records. Tasks and Calendar are not modified. Finance, Projects, Contacts code is not
  modified (Contacts used through `core/contacts.ts` helpers). Shared pieces used: `core/store.ts` `repo`, `core/contacts.ts`, `ui/components.tsx`,
  `ui/pickers.tsx` `RefLabel`, `ui/Toast`.
- The tests `modules/records.test.ts`, `modules/search.test.ts`, `core/shellFoundations.test.ts` must be run and, only if they enumerate the module
  list, updated minimally (none was found asserting a module count).

## 3. Asset creation and editing

**List page (`AssetsPage`)**
- Header with an **Add asset** button and a search/filter row: text filter, type, status (Active default; "Past" = sold/disposed/replaced; "Stored"; "Archived"
  as a toggle), and "Show as tree / flat" (tree default when any asset has a parent).
- Tree view groups children under their parent with indentation and a fold button; flat view shows breadcrumbs. Row: name, type chip, status chip if not active,
  breadcrumb, **warranty badge** ("Warranty ends 2027-03-01", "Warranty ended"), no sensitive fields, no money.
- Empty state: "Nothing here yet. Start with your home." with Add button, and a line saying only a name is needed.

**Form (`AssetForm`, dialog on desktop, full-screen sheet at 375 px)** reuses the project's form conventions.
- First screen: **Name** (required, auto-focused), **Type**, **Where is it?** (parent picker). Everything else is under collapsed sections:
  *Make and dates* (manufacturer, model, serial number, purchase date, installed date, price, warranty end date and note), *Contacts*, *Specs*,
  *Documents* (references), *Notes*, and for a property *Address*, for a vehicle *Plate*.
- Parent picker: a text filter above a native `<select>` listing live assets as indented breadcrumbs, excluding the asset itself and its descendants
  (cycle prevention in the UI, re-checked in the data layer). A type default: creating from an asset's page ("Add inside") presets the parent and `appliance`.
- Contacts: choose an existing shared contact or create one (name, phone, email) through `findOrCreateContact` (no duplicate); role is free text with
  datalist-free suggestion chips (`installer`, `contractor`, `service`, `warranty`, `seller`). Manufacturer stays plain text (H0 3.6).
- Inline validation on save; the first error is announced (`role="alert"`) and focused.
- Saving a changed type from property/vehicle clears the matching sensitive field only after an explicit "Remove the address?" confirmation.
- Editing is a normal full-record save; unknown fields are preserved.

**Asset page (`AssetPage`, `/assets/:id`)** shows: heading with status/archived chips; breadcrumb links; key facts in a definition list (only filled
fields); warranty line; contacts (name, role, tap-to-call/mail links using the contact's stored phone/email); specs; documents (links open in a new tab with
`rel="noopener noreferrer"`); notes; **Inside this** (children, with "Add inside"); **Tasks and events linked to this** (read-only, 5.2); actions: Edit, Archive/
Restore, Retire (status), Delete permanently. A missing id shows "That asset no longer exists" with a link to the list; a removed contact shows "(contact removed)".

## 4. Parent-child integrity

- Child points at parent (`parentId`); the parent holds no list.
- Rules enforced in `validateAsset` (data layer) **and** mirrored in the picker: parent is live; not itself; no cycle; depth <= 12; a property has no parent.
- A parent's rename, archive or retirement never changes children. Moving a parent moves its subtree implicitly.
- **Dangling parent** (parent permanently deleted on another device, or created on a stale device): the child is shown at the top level with a "(parent
  removed)" marker and can be re-parented; never hidden, never crashes the list or the tree. Cycles that arrive through sync (two devices re-parent in
  opposite directions) are detected on read: the tree builder breaks the loop at the oldest-updated link, shows the affected assets at top level with a
  notice, and never recurses unbounded.
- **Permanent deletion is blocked while children exist** (P9); archive and retire are allowed and leave children as they are.
- Tests listed in section 9.

## 5. Record linking and Search

### 5.1 `records` hook (`assetRecords: RecordSource`)
- Ids are text `asset:<n>` (so `service:` and `warranty:` can follow). `search(text)` returns up to 30 live, non-archived assets first, then archived
  (label gets "(archived)"; retired ones get "(sold)", "(disposed)" or "(replaced)"), labelled with the **breadcrumb**, `kind: 'Asset'`.
- `describe(id)`: parses `asset:<n>`; returns `{ label, kind: 'Asset', path: '/assets/<n>' }` or `null` when missing or soft-deleted. `openSource(id)` uses `goTo`.
- Never includes sensitive fields in `label`.

### 5.2 Links from Tasks and Calendar events (no change to either module)
- Creation: the existing "Link a record…" control in the Task editor and the Event editor lists "Home & Assets" and creates a shared `links` row of type
  `about` (task or event to `assets` / `asset:<n>`). Verified present in both editors.
- Display on the asset page (read-only, one live query): linked **open tasks** (title, due date, repeat marker; opens `/tasks?task=<id>`), linked **upcoming
  and recent events** (opens the Calendar deep link `#/calendar?v=agenda&d=<date>&open=<key>`; implementer reads `calendar/records.ts` for the id form), and
  a count of **completed linked tasks** ("12 completed"; list on request). A link to a deleted task/event is ignored.
- No "Add task for this asset" button in H1 (it belongs with H2's Maintenance section). The empty text says: "Link a task or event to this asset from the
  task's or event's own **Link a record** box."
- Links have no integrity: the deletion work package (P9) removes links to a deleted asset.

### 5.3 Global search (`assetsSearchSource`, `group: 'Home & Assets'`)
- Pure `searchAssetsData(raw, assets, cap = 8)` using `norm`/`score` from `lib/search.ts`, like `searchProjectsData`. Matches name (top weight), manufacturer,
  model, type word, notes, spec labels/values, and contact-role words. Page hit "Home & Assets".
- **Serial number and plate:** matched only by exact or prefix match on the normalized text and only when the query is at least 4 characters; the value
  is **never shown** in the result (title is the name, subtitle is breadcrumb plus status). Address is not searchable in H1.
- Ranking: active above stored above past above archived (archived and past subtract score). Results open `/assets/<id>`.
- A source that throws is already left out by the search dialog; reads are one linear scan of live records (hundreds at most).

## 6. Quick Add

- Destination: `{ id: 'asset', label: 'Asset', prefix: 'a', aliases: ['asset', 'item'] }`.
- `start()` takes a live snapshot of non-archived asset names (so synchronous `parse` can match), returns the stop function.
- `parse(text)`: the whole text is the name, except `Name in Where`: if the text after the **last** ` in ` equals exactly (case, accent and space
  insensitive, `nameKey` rule) the name of exactly one live asset, that asset becomes the parent. Otherwise the whole text stays the name and, if ` in ` was
  present, the preview shows a note ("No asset is named X, so 'in X' stays in the name", or "Two assets are named X, so it stays in the name"),
  the same behaviour as `+project`'s `projectNote`. No fuzzy or prefix matching. Name > 120 chars returns `null`. Type is preset by the parent (`appliance`
  inside anything, `other` at the top level); the preview lists Name, Where, Type. **Never sets sensitive fields.**
- Preview line: `Will add: Dishwasher, in Home > Kitchen, Appliance` (uses `publicLabel`, no sensitive data).
- `commit(preview)`: revalidates parent in one transaction (parent may have vanished), creates the asset via `createAsset`, returns an **Undo** that soft-
  deletes the new asset **only if nothing points at it yet** (no children, no links); otherwise Undo says why it cannot.
  Undo is an ordinary removal (not the permanent-deletion protection; H0 section 9.7, point 7).
- Tests: parse variants, exact-match rules, ambiguity note, no sensitive fields, commit/Undo, prefix/alias clash check passes at start-up.

## 7. Archive, retirement and deletion

| Action | Data | Rules |
|---|---|---|
| Archive | `archived: true` | Any status. Hidden from default list and Add-box parent matching and the parent picker (shown with "(archived)" if already chosen). Still searchable (last), linkable, history intact |
| Restore | `archived: false` | Always allowed |
| Retire | `status` = `sold` / `disposed` / `replaced` (or `stored`), `statusDate`, `statusNote`, `replacedById` for `replaced` | Dialog with date (defaults to today, editable), note, and for `replaced` an optional "replaced by" picker. **Open linked tasks and children are not touched in H1** (the dialog says so; the task-handling prompt is H4). Reversible: "Set back to active" clears status fields |
| Delete permanently | soft delete plus marker (P9) | See below |

**Deletion plan (`planAssetDeletion(id)` / `deleteAssetPermanently(id)` in `deletion.ts`, modelled on `projects/deletion.ts`):**
- **Blocks while:** a live child asset exists; another live asset has `replacedById` pointing at it; **any live record of a dependent kind points at it**
  (none exist in H1; the check is written from the `ASSET_DEPENDENT_KINDS = ['service','warranty']` constant now so H2/H4 cannot forget it); or a **completed** task
  is linked to it (completed tasks are maintenance history; unlink them first). Reasons are listed in plain words with links.
- **Unlinks (keeps):** open tasks and events (their links are removed; they remain ordinary tasks and events).
- **Deletes:** the asset record, as a soft delete, after writing `data.permanentlyDeletedAt = Date.now()`, in **one transaction** (`moduleRecords`, `links`). If
  anything throws, nothing changes. The dialog requires typing the asset name (like `DeleteProject`), shows counts, and says "Old backups still contain it."
- **Deletion cannot be undone in the app.** Archive/retire are the reversible actions and are offered first in the dialog.
- **Precedence across devices (P9, `src/lib/sync/assetDeletion.ts`):** exactly the rule in H0 section 9.7: flagged deletion wins over any copy; kept alive only by a live
  child, replacement pointer or dependent-kind record; repeat until no change; `touchAll` stamps live assets with `revivedAt` so a restored backup wins; only
  module `assets` kind `asset` is affected; one added call in `mergeSnapshots` beside the project call; no change to file format, schema, tombstones or other tables.
  Reuse the two marker names exported by `projectDeletion.ts` (`PERMANENT_DELETE_KEY`, `REVIVED_KEY`); do not refactor project code.
- **Cut line:** if P9 testing or review shows any problem, ship H1 with the Delete button hidden (archive and retire only) and move P9 to its own review. Nothing in
  P3 to P8 depends on it.

## 8. Sensitive-data masking

- **Fields:** `serialNumber`, `plate`, `address`. (Notes carry a warning line: "Do not store alarm codes, passwords or account numbers here.")
- **Display:** on the asset page they show as "Hidden" with a **Show** button per field (button text toggles to Hide; `aria-pressed`). The revealed state is
  **per page view only**, held in component state, **not stored**, reset on navigation and reload (no new preference, no backup-list change, nothing synced).
- **Never in:** list rows, tree rows, breadcrumbs, link labels (`records.describe/search`), global-search titles or subtitles, Quick Add preview/toasts, page `<title>`,
  `aria-label` strings, error messages, console output. All outward strings are built by `publicLabel`/`breadcrumb` which cannot read those fields.
- **Edit form:** fields are shown plainly while typing (the owner is entering them), `autocomplete="off"`, `spellcheck="false"`; not logged.
- **Search matching** of serial/plate is exact or prefix, >= 4 characters, never displayed (5.3).
- **Backup/sync:** encrypted in sync and the weekly backup; present in the plain backup (P2 sentence). No CSV export of assets in H1.
- **Tests:** a test builds an asset with distinctive sentinel values (invented, e.g. `SENTINEL-SERIAL-001`) and asserts none appears in: `publicLabel`, `breadcrumb`,
  `assetRecords.search/describe` output, `searchAssetsData` output (when matched by serial, the result still lacks it), the Quick Add preview, and the rendered list
  row text. Test data is invented (public repo).

## 9. Test coverage and browser acceptance

### 9.1 Automated tests (new files under `src/modules/assets/`; full suite must stay green; target is at least the groups below)
1. **Model/reader:** unknown fields round-trip; bad type/status/date/number/list fall back; reader never throws on `{}` or junk `data`; invented-data fixtures only.
2. **Validation:** every rule in section 1 including URL schemes, length limits, duplicate contact-role, property-has-no-parent, cycle (direct, indirect, depth 12),
   replacedById loops, inline warning for install-before-purchase.
3. **Data layer:** create/update inside one transaction; parent deleted mid-way is refused; update preserves unknown fields; archive/restore/retire/set-active round trips.
4. **Tree:** breadcrumb, descendants, dangling parent shown at top, sync-induced cycle broken deterministically.
5. **Records hook:** `search` ordering and cap, `describe` null when missing/soft-deleted, labels carry (archived)/(sold), no sensitive text.
6. **Search:** field matches, serial/plate prefix rule and 4-character minimum, ranking, cap, result lacks sensitive value, page hit.
7. **Quick Add:** section 6 cases; Undo only when nothing points at it; clash check at registration (`registerModule` does not throw).
8. **Masking:** sentinel test (section 8).
9. **Backup/restore:** an export with assets restores them with all fields; backup coverage test unchanged and green; a backup made before H1 restores with none.
10. **Deletion plan:** blocked by child, by `replacedById` pointer, by a synthetic `service` dependent record, by a completed linked task; open task and event links removed and the
    task/event kept; asset soft-deleted with marker; transaction atomicity (a thrown error mid-way leaves everything unchanged).
11. **Sync, using the real `SyncEngine` and `mergeSnapshots` (mirror the ten P4B tests):** (a) older edit on the other device does not bring it back; (b) newer
    stale edit pushed first does not; (c) repeated syncs from both devices keep it deleted; (d) a stale device's new child keeps the asset alive; (e) a stale device's new
    dependent-kind record keeps it alive; (f) chain parent/child/grandchild gives the same answer in both sync orders; (g) archive and restore still last-writer-wins
    across devices; (h) a plain Add-box-Undo removal gets no protection; (i) an intentional backup restore (`touchAll`) wins; (j) unrelated assets and every other module
    merge exactly as before. **Mutation check:** with the rule switched off, (b), (c), (d), (e) fail.
12. **P1:** `labelOf` cases. **No regression:** all 1,366 existing tests pass unchanged except any minimal module-list assertion.
13. Type check (`npx tsc --noEmit`) and `npm run build` clean.

### 9.2 Browser acceptance (invented data only; desktop and 375 px; light and dark; no new console errors)
1. Fresh state: module appears in the top bar after Projects; empty state text; only-a-name creation works with Enter.
2. Build Home > Kitchen > Dishwasher and Home > Heating > Furnace; tree folds; flat view shows breadcrumbs; rename Kitchen and see breadcrumbs update.
3. Parent picker excludes self and descendants; a property cannot be placed inside another asset.
4. Fill every optional section on one appliance (make/model, dates, price, warranty, a contact created inline and one reused, specs, a document link, notes);
   save; reload; everything persists; the link opens in a new tab; a `javascript:` link is refused.
5. Masking: serial/plate/address hidden on the page, absent from list, search results, Add box and tab title; Show/Hide works with keyboard; reload re-hides.
6. Link a task and an event to the dishwasher from their own editors; both appear on the asset page; complete the task and see it count under completed.
7. Search by name, by model, and by serial prefix (finds it without showing the serial); Add box `a Toaster in Kitchen` shows the preview, adds, Undo works;
   `a Toaster in Kitchn` shows the "stays in the name" note.
8. Warranty badge shows ending/ended correctly around today's date.
9. Archive hides it from the list and picker, still searchable; Restore returns it. Retire as sold with a date; appears under Past; set back to active.
10. Delete: blocked while it has a child (reasons readable, links work); unlink/delete the child, then delete permanently (typed name); asset gone; linked open task
    still exists and is unlinked; a completed linked task blocks deletion with an explanation.
11. Backup (plain) export includes assets and the new sentence; import restores them. Offline reload shows the module.
12. 375 px: no sideways scroll, buttons >= 44 px, form is a full-screen sheet, tree readable; keyboard-only run through create/edit/archive/delete; focus is returned
    after dialogs; headings and labels read sensibly (checked with the accessibility tree). Dark theme contrast checked.
13. Not verifiable here and to be stated in the report: two real devices (including a permanent-deletion conflict), offline use on a phone, an older app build syncing.

## 10. Expected files and integration boundaries

**New**
```
src/modules/assets/index.tsx            ModuleDef
src/modules/assets/AssetsModule.tsx     routes, ModuleBase, ToastProvider
src/modules/assets/model.ts             types, asAsset, extras, constants
src/modules/assets/validate.ts          validateAsset, helpers
src/modules/assets/data.ts              load/get/create/update/archive/retire, tree helpers, linked-work queries
src/modules/assets/records.ts           RecordSource
src/modules/assets/searchSource.ts      searchAssetsData + SearchSource
src/modules/assets/quickAddDef.ts       QuickAddDef
src/modules/assets/deletion.ts          plan + deleteAssetPermanently
src/modules/assets/AssetsPage.tsx, AssetPage.tsx, AssetForm.tsx, RetireDialog.tsx, DeleteAsset.tsx, LinkedWork.tsx, Sensitive.tsx
src/modules/assets/assets.css
src/modules/assets/*.test.ts            groups in 9.1
src/lib/sync/assetDeletion.ts           (P9) cross-device deletion rule
```
**Edited (each a few lines):** `src/modules/index.ts` (register); `src/lib/sync/merge.ts` (P1 `labelOf`; P9 one call); `src/lib/sync/track.ts` (P9 `touchAll`
condition); `src/pages/PlainBackupCard.tsx` (P2 text); `README.md` (feature list); `docs/BACKLOG.md` (report entry); `docs/module-hooks.md` (note the new record ids).
**Not edited:** `src/db.ts`, `src/types.ts`, `src/lib/backup*.ts`, anything in Finance, Tasks, Calendar, Projects, Today, Contacts.

## 11. Unresolved architectural blockers and open points

**Blockers:** none found. Permanent-deletion precedence is implementable in H1 (H0 9.7); the only gate is the owner's confirmation of the eight decisions.

**For reviewer attention (my judgment calls, none silently decided):**
1. **Permanent deletion ships last (P9) with a cut line.** If review prefers, build it as its own step after the rest of H1.
2. **A completed linked task blocks permanent deletion** (treated as maintenance history). H0 9.4 only listed future dependent kinds; this is stricter. Alternative: allow and unlink.
3. **A `property` cannot have a parent** (hard rule). Alternative: advisory only.
4. **`ledgerPropertyId` is deferred to H3**; H1 reads nothing from Finance.
5. **No "Add task for this asset" button in H1**; linking is done from the task/event editor. The asset page lists links read-only.
6. **Sensitive reveal is per page view** (nothing stored), so a reload hides again.
7. **Quick Add uses `in <exact asset name>`**, not a symbol, with a visible "stays in the name" note instead of a refusal when no unique match.
8. **Sync-engine edits twice in H1** (P1 label function, P9 rule). P1 can be dropped without effect on anything else; P9 can be cut as above.
9. **Not verified and cannot be by tests:** real two-device sync, older app versions (all devices must run the H1 build before relying on deletion precedence), offline phone use.
10. **Plain-backup sentence (P2)** assumes the owner wants the warning; harmless text, easy to drop.

**Report format at the end of H1 (per `CLAUDE.md`):** what was built, test count, numbered "judgment calls (please review)", what is NOT built, browser checks done and not
done. **No commit or push without the owner's yes.**
