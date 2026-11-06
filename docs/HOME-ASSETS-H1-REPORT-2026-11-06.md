# Home & Assets H1 report: asset registry

Date: 2026-11-06. Built to `docs/HOME-ASSETS-H1-BRIEF-2026-11-05.md`, on the plan in `docs/HOME-ASSETS-H0-PLAN-2026-11-05.md` (Revision 2).
Status at time of writing: built, not yet committed. H1 was later approved and committed (see git log). H2 to H5 are not started. Invented data only.

## 1. Summary

Home & Assets (module id `assets`, address `#/assets`) is the sixth module. It keeps a list of what the household owns that needs looking
after, with where each thing is, who is behind it, and its warranty date. H1 is the registry only: no maintenance, no service history, no money.

| Check | Result |
|---|---|
| Tests | **1,407 pass** (92 files). Was 1,366; 41 new |
| Type check (`npx tsc --noEmit`) | Clean |
| Production build (`npm run build`) | Succeeds |
| Schema, backup format, dependencies | **No change** (Dexie stays 15; assets are shared module records) |
| Browser (desktop, 375 px, dark form) | Main flows checked with invented data, deleted afterwards (section 6) |
| Owner decisions Q1 to Q8 | Confirmed 2026-11-05, all the recommended "A" |
| Projects P5 deployment | Verified green before starting (Actions run #53, commit `47100bc`) |

## 2. What was built (against the brief's scope)

| Brief item | Status |
|---|---|
| Asset registry, module registration | Done. Registered after Projects in `src/modules/index.ts` |
| Types property, area, system, appliance, vehicle, other | Done (`appliance` covers equipment) |
| Parent-child | Done: child points at parent; cycle, depth (12) and "property sits at the top" rules; breadcrumbs from names; dangling parent shows the child at the top ("place removed"); a loop arriving through sync is cut deterministically |
| Create, edit, search, navigation | Done: list (tree or flat; In use, Stored, Past, Archived, All; type filter; text filter), asset page, add/edit form. Only a name is required; other sections are folded |
| Optional details, shared Contacts | Done: make, model, serial/VIN, dates, price (informational), contacts with a free-text role (created or reused through `findOrCreateContact`), specs, document references (label, optional http/https link, note) |
| Basic warranty date | Done: end date and note, with a badge (ends / ends soon within 60 days / ended) for assets In use |
| Links from Tasks and Calendar events | Done through the `records` hook: both editors' "Link a record" box lists Home & Assets. The asset page shows linked open tasks, events, and a count of completed tasks, read-only |
| Archive, restore, retirement status | Done: Archive/Restore; Status dialog (In use, Stored, Sold, Disposed of, Replaced; date, note, optional "replaced by"); nothing inside or linked is changed |
| Safe deletion | Done: plan, typed-name dialog, one transaction, soft delete with marker; cross-device rule (section 5) |
| Quick Add | Done: destination `asset`, prefix `a`, aliases `asset`, `item` |
| Masking | Done: serial/VIN, plate, address hidden until Show; per page view only |
| Responsive, accessible UI | Done as far as checked (section 6); keyboard-only and screen-reader runs not done |
| Backup and sync compatibility | Done: covered by the existing `moduleRecords` paths; round-trip tested |
| Prerequisites P1, P2 | Done: conflict labels for module records; plain-backup sentence |

## 3. Record model (as built)

`moduleRecords`, `module: 'assets'`, `kind: 'asset'`, written only through `repo` (id, timestamps, soft delete, unknown fields kept).
Fields: `name`, `type`, `parentId`, `status`, `statusDate`, `statusNote`, `replacedById`, `archived`, `notes`, `manufacturer`, `model`,
`serialNumber` (sensitive), `purchaseDate`, `installDate`, `purchaseCents`, `warrantyEndDate`, `warrantyNote`, `contacts[{contactId, role}]`,
`specs[{label, value}]`, `refs[{label, url?, note?}]`, `address` (property, sensitive), `plate` (vehicle, sensitive). Unknown fields, including the
reserved `ledgerPropertyId` and `txnRefs`, pass through every read and write. `asAsset` never throws on a junk record.

Validation (`validate.ts`, plain-words messages): name 1 to 120 characters; type and status from the fixed lists; parent must be a live asset, not
itself, no cycle, depth at most 12, never above a property; replaced-by only when replaced, live, not itself, no loop; real calendar dates; price at
least 0; length limits; at most 20 contacts, 30 specs, 20 documents; same contact and role not twice; each spec needs a label; links must be
`http:` or `https:` (`javascript:`, `data:`, `file:` and others refused). Install-before-purchase is a warning, not an error. `createAsset` and
`updateAsset` re-check against the live assets inside the same transaction, so a parent deleted meanwhile is refused.

## 4. Search, Quick Add, linking

- **Records hook** (`records.ts`): ids `asset:<n>`; labels carry the place and "(archived)", "(sold)" etc.; `describe` returns null for a missing asset.
- **Search** (`searchSource.ts`, group "Home & Assets"): name, make, model, type word, notes, spec labels and values. Serial and plate match only as a
  prefix of 4 or more letters and digits and are never shown. Address is not searchable. Archived and past assets rank last.
- **Quick Add** (`quickAddDef.ts`): `Name in Exact Asset Name`. Only an exact (case, accent and space insensitive) unique, non-archived name after the
  LAST " in " becomes the parent. Otherwise the whole text is the name and the preview says why ("stays in the name"). Appliance type inside a parent, other
  at the top. Undo removes the new asset only if nothing is inside it or linked to it.

## 5. Permanent deletion and the sync rule

**Plan** (`deletion.ts`): blocked while a live child exists, another asset is marked as replaced by it, a live record of a dependent kind
(`service`, `warranty`, from `ASSET_DEPENDENT_KINDS`; none exist yet) points at it, or a **completed** task is linked to it. Open tasks and events are
unlinked and kept. The asset is soft-deleted after `data.permanentlyDeletedAt` is written, in one transaction; an error part-way changes nothing (tested).

**Cross-device rule** (`src/lib/sync/assetDeletion.ts`, mirroring `projectDeletion.ts`, which is untouched): after the ordinary merge, a flagged asset
stays deleted whatever any copy says, unless a live child, replacement pointer or dependent record points at it, in which case it is kept as on its live
side. It repeats until nothing changes, so chains give the same answer in either sync order. A backup restore still wins (`touchAll` stamps live assets
with `revivedAt`). Edits to shared sync code: one added call in `merge.ts` (both rules always run), one condition in `track.ts`, and the P1 label change.

**Mutation check:** with the rule switched off, sync tests b, c, d, e and f fail; with it on all 11 pass. All existing sync and Projects tests pass unchanged.

## 6. Verification

### Automated (41 new tests)
`assets.test.ts` (30): reader, validation, data layer, archive/retire round trips, removal for Undo, warranty state, tree and breadcrumbs (orphan,
loop), linked work (open, completed, events, deleted, repeating task keeps its link), search (fields, ranking, serial/plate prefix, never shown),
Quick Add (exact name, ambiguity, archived, plain, undo, registration clash), masking (invented sentinel values absent from every outward string),
backup export and restore (and a pre-H1 backup restoring with none), deletion plan blockers and atomicity.
`assets-sync.test.ts` (11): the ten two-device cases using the real `SyncEngine` and `mergeSnapshots` (a to j) plus the conflict-label test.

### Browser (desktop pane, invented data, all deleted afterwards)
Created a property and a vehicle with parent, VIN, plate and a warranty end date (Return submits; after the fix it opens the new asset); masking and Show
(secret absent from page text while hidden, present after Show, hidden again after reload); global search by serial prefix (found, serial not shown);
Add box preview and add for `a Toaster in Test Home`; Home & Assets listed in the Task editor's Link a record box, linked a new task to the vehicle and
saw it on the asset page; Archive; blocked delete with reasons; real delete of three assets (soft-deleted with marker, linked open task kept, no live
asset links left); 375 px (no sideways scroll, buttons at least 44 px high) and dark theme for the form.

### Defects found and fixed in browser checks
1. Saving the form on the list page left you on the list instead of opening the new asset (the form closed after navigating). Order changed.
2. The Add box preview read "Will add: Will add:" (the box already adds the prefix). Fixed, test updated.
3. The "Where is it?" picker was cramped; stacked vertically.

### NOT verified
Status dialog; restore from the Archived tab; Past and Stored tabs; linking from the Event editor; the form's contact, spec and document rows and the
type-change tick; keyboard-only and screen-reader runs; the plain-backup sentence on its page; two real devices (including a permanent-deletion
conflict); offline use; an older build syncing (all devices must run H1 first). The pane's console buffer held dev hot-reload entries from my edits
("Module today is registered twice", HTTP 500s); a fresh load works and the production build is clean.

## 7. Judgment calls (please review)

1. A **completed linked task blocks permanent deletion** (treated as maintenance history). Open tasks and events are unlinked and kept.
2. A **property cannot sit inside another asset** (hard rule; saving a property clears its parent).
3. **`ledgerPropertyId` is deferred to H3** (kept as an unknown field if present); H1 reads nothing from Finance.
4. **No "Add task for this asset" button**; linking is from the task or event's own Link a record box.
5. **Show/Hide resets on reload** (nothing stored, nothing synced).
6. Quick Add matches **only an exact unique name** after the last " in ", with a visible note otherwise.
7. `lib/sync/assetDeletion.ts` imports one constant list from `modules/assets/model.ts` (a pure file) so the guard and the sync rule cannot drift.
8. Archived assets are left out of the parent picker unless already chosen.
9. The warranty badge shows only for assets In use.
10. Changing a type away from property or vehicle needs a tick to remove the saved address or plate.
11. The Status dialog does not touch children, tasks or links (the open-task prompt belongs to H4).
12. Documents are references only (label, optional link, note); no file storage.

## 8. Known limits and risks

- Deletion precedence needs every device on the H1 build; an older build uses plain last-writer-wins and could recreate an asset on its side.
- When a protected asset reappears (a child or history made on a stale device), there is no notice; the sync conflict format was not changed.
- A mistaken permanent deletion is recoverable only from a backup, by design.
- Two devices editing different fields of one asset: the later whole record wins (documented sync limit).
- Plain (unencrypted) backups contain serial numbers, VINs, plates and addresses; the Backup page now says so.
- Real two-device sync has still never been tested on real devices.

## 9. NOT built (by design)

Service records and "Done, log it", maintenance suggestions (H2); money, transaction references, project links, net-worth link (H3); several
warranties, a warranty Calendar layer, the replace workflow, orphan repair (H4); Today card, overview, printable sheet (H5).

## 10. Files

New: `src/modules/assets/` (`index.tsx`, `AssetsModule.tsx`, `model.ts`, `validate.ts`, `data.ts`, `records.ts`, `searchSource.ts`, `quickAddDef.ts`,
`deletion.ts`, `AssetsPage.tsx`, `AssetPage.tsx`, `AssetForm.tsx`, `RetireDialog.tsx`, `DeleteAsset.tsx`, `LinkedWork.tsx`, `Sensitive.tsx`,
`assets.css`, `assets.test.ts`, `assets-sync.test.ts`); `src/lib/sync/assetDeletion.ts`; the H0 plan, H1 brief and this report.
Edited: `src/modules/index.ts`, `src/lib/sync/merge.ts`, `src/lib/sync/track.ts`, `src/pages/PlainBackupCard.tsx`, `README.md`, `docs/BACKLOG.md`,
`docs/module-hooks.md`. Not edited: `db.ts`, `types.ts`, backup files, Finance, Tasks, Calendar, Projects, Today, Contacts.

## 11. Suggested next steps

1. Owner review of this report and the judgment calls; run the checks marked NOT verified, ideally on the real phone after deployment.
2. On approval, commit (local) and then push when ready (a push deploys; check the Actions tab for a green run).
3. Then H2 (maintenance and service history), only after a go-ahead.
