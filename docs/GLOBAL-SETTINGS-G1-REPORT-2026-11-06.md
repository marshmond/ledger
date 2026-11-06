# G1 — Global Settings and Comprehensive Backup Integrity: implementation report (2026-11-06)

**Status (updated after the final pre-commit correction, see section 27): BUILT AND TESTED LOCALLY. NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED. Real-device acceptance NOT DONE. Household Services S3 NOT started.**
S2.1 itself IS committed and deployed (see section 2).

## 1. Plain-English summary

- **Backup was already whole-app.** Ledger's backup file was built from the *entire database* from the start (all 40 tables, including Tasks, Calendar, Projects, Home & Assets, Household Services, contacts, links and due items), is saved in one all-or-nothing transaction, and already had a "every table must be in the backup" test. The owner's Task test passing was therefore expected, not luck. It was never a Finance-only backup. G1 did not replace it; it added checks around it.
- **What G1 added to backup:** a contents list inside each new file (record counts per table) so a cut-short file is caught; stricter checks before any restore (every record has a usable id, no repeated ids, no sections this version cannot restore, newer-version files refused first); the export now reads everything in one read transaction (one consistent moment); the encrypted restore now uses the same checks as the plain one and also saves/restores screen preferences; a plain "what is in this backup" summary by area; plain wording and warnings.
- **What G1 added to Settings:** an **Appearance** tab (colors and light/dark) and a renamed **Data & Backups** tab in the app-wide Settings. Finance's "More" page no longer holds a second set of colour controls or a second export button; it links to Settings. Old addresses (`#/ledger/backup`) forward to Settings.
- **Not changed:** the backup file format and version (still data version 15), the database (no migration), sync, Finance maths, Tasks recurrence, Services (S3 untouched), dependencies, GitHub infrastructure.

## 2. Repository, S2.1 SHA and deployment verification

- Repository: `https://github.com/marshmond/ledger.git` (`origin`), folder `C:\Users\alexm\projects\finance-app`.
- **S2.1 = `afa05cb81747e061554420d6240b7af83fe47eab`** (`feat(services): S2.1 guarded lifecycle Undo and contact reference safety`). `git status` clean, branch `main` equal to `origin/main` after `git fetch`. Public Actions API (`gh` is not installed): "Deploy to GitHub Pages" **run #62, `head_sha` afa05cb…, status completed, conclusion success**. (The previous handoff text calling S2.1 uncommitted was stale; corrected.)

## 3. Initial working tree and baseline

Clean tree at start. A clean full test run before the first edit was NOT captured (same gap S2.1 noted). The last reported baseline is **1,918 tests in 111 files** (S2.1). The first run after my first edits showed 1,915 passing and 3 failing, all three caused by my own changes (a "page address" test that did not know the `/settings/…` pages, one test that hand-edited a file's records without its new contents list, one test that expected a duplicate id to get past the checker). Those three tests were adjusted (section 21).

## 4. Settings inventory (before G1)

| Control | Where it was | Stored | Synced? | Scope |
|---|---|---|---|---|
| Light / Dark / Device | Finance "More" page (`AppearanceCard`) and a quick cycle button in the shell bar (`ThemeToggle`) | `localStorage` `ledger-theme` | No (per device) | Global |
| Colour palette, custom colours | Finance "More" page (`AppearanceCard`) | `localStorage` `ledger-palette`, `ledger-palette-vars` | No (per device) | Global |
| Saved colour themes | same card | `settings` table key `savedThemes` | Yes | Global |
| Open-to module | Global Settings > General | `settings` key (shell settings) | Yes | Global |
| Calendar options | Global Settings > Calendar | `settings` | Yes | Calendar |
| Backup (plain + encrypted + weekly) | Global Settings > "Backup and restore" AND Ledger sidebar "Backup" (same page, two copies) | n/a | n/a | Global |
| Sync devices | Global Settings AND Ledger sidebar (same page) | `localStorage` `ledger-sync-config` (secret) | n/a | Global |
| "Type amounts without a decimal point" | Finance "More" | `localStorage` `ledger-keypad-amounts` | No | **Finance-specific, deliberately left** |
| Export button + backup link | Finance "More" | n/a | n/a | duplicate |

## 5. Appearance relocation

`AppearanceCard` (unchanged component, unchanged storage keys, unchanged `applyTheme`/`savePalette` calls) is now a route under Settings: `#/settings/appearance`. No second theme store was added. Finance "More" shows a short card linking to it; the old inline copy is removed. The one-tap shell button (`ThemeToggle`) stays, since it is the same single state. Browser-checked: chose Calm teal, the accent colour was identical on Tasks (outside Finance), dark mode survived a full reload, palette survived a reload and a restore.

## 6. Data & Backups UI (`#/settings/backup`)

Same page as before (plain export/restore, encrypted export/restore, weekly encrypted backup, storage protection), retitled "Data & Backups". The plain card now reads "Back up Ledger data" / "Restore Ledger data", says what is and is not included, shows the file format ("data version 15, written by Ledger 0.1.0"), carries the warning *"This backup may contain sensitive household and financial information. Store it securely."*, shows a by-area summary after export and before restore, and the restore confirmation says plainly that restore **replaces** (is not a merge), that later changes are lost and later deletions come back, that a copy of current data downloads first, and what happens with Sync. Escape and Cancel close it; focus moves to it. Old addresses `#/ledger/backup`, reminders and the sidebar item all land on Settings.

## 7–8. Persistent-data inventory and coverage matrix

All persistence is in one Dexie database (`ledger`, version 15, **40 tables**, read from `db.ts`) plus browser `localStorage` for per-device preferences and secrets. Attachments are metadata rows only (`storage: 'none'`): **Ledger stores no file contents anywhere**.

Legend: **CV** covered and verified (automated round-trip), **CN** covered, not verified by its own test, **DX** deliberately excluded.

| Store / family | Owner | Exported | Restored | Relations kept | Validated (G1) | Round-trip test | Notes |
|---|---|---|---|---|---|---|---|
| 33 Finance tables (`accounts`, `txns` incl. splits and project refs, categories, groups, budgets, assignments, recurring, loans…, investments, income, RSU, HSA, lots, property, snapshots, rules, goals, donations, targets…) | Finance | yes | yes | ids preserved | list/ids/duplicates/counts | **CV** (`backupCoverage` one row per table; G1 household incl. split txn) | |
| `settings` (incl. shell, saved themes, Today options, flowViews, lastBackup…) | shared | yes, **except `priceApiKey`** | yes; device's own key kept | by key | key present, unique | **CV** | key is a device secret (DX) |
| `contacts`, `tags`, `attachments`, `links`, `dueItems` | shared core | yes | yes | ids preserved | ids/duplicates/counts | **CV** | attachments are names/URLs only |
| `moduleRecords` — Tasks (recurrence, completion), Calendar events/recurrence, Projects (budget lines, commitments), Assets (items, service, warranty), Services (arrangements, visits, occurrence markers) | module stores | yes | yes | ids/links preserved | as above | **CV** (G1 household: recurrence, markers, links, txn refs, unknown fields) | one table, told apart by module/kind |
| Soft-deleted records (`deletedAt`) | all shared-store modules | yes (kept as markers) | yes | n/a | n/a | **CV** (stays deleted, no resurrection) | |
| Sync metadata (`ledger-sync-meta` DB, tombstones, last-sync lists) | sync | **no** | n/a | n/a | n/a | n/a | **DX**: device-local; restore re-stamps records instead (section 14) |
| Preferences in `localStorage` (14 allowed keys: theme, palette, layout, tabs, Today layout…) | per device | yes (`preferences`) | yes, only allowed keys | n/a | allow-list | **CV** | applied after the DB step, see 13 |
| Sync token, repo, sync passphrase (`ledger-sync-config`), weekly-backup passphrase (`ledger-autobackup`) | sync / backup | **no** | n/a | n/a | n/a | **CV** (not in file) | **DX**: secrets |
| Price-lookup API key | Finance | **no** | kept on device | n/a | n/a | **CV** | **DX** |
| Documents / files linked from records | owners | **URLs/names only** | same | n/a | n/a | n/a | Not applicable: nothing is embedded; originals must be kept |
| Service worker caches | PWA | no | n/a | n/a | n/a | n/a | Not applicable (rebuildable) |

Nothing was found that is persistent, supported and unintentionally omitted. **No coverage gap required a code change to the export.**

## 9. Existing format assessment (what was already true)

- Format: one JSON object, `version`/`schemaVersion` 15, `exportedAt`, `app`, `appVersion`, one list per table, `preferences` object. Plain JSON, **not encrypted**; a separate AES-GCM (PBKDF2 310,000 iterations) encrypted variant exists.
- Records are stored whole, so **unknown fields survive** (tested on a shared record and inside a module record). Ids are kept; nothing is renumbered.
- Older versions: files only ever *added* tables, so older files get empty lists for newer tables (never invented data). A newer-version file is refused with a clear message.
- Before G1 the export read tables one by one (not one snapshot) and had no contents list; the encrypted restore skipped the file checker.

## 10. Restore semantics (unchanged by G1)

**Full replacement**, not merge: all 40 tables are cleared and refilled in one transaction; the device's own price key is preserved. Records made after the backup are lost; records deleted since come back. A "Pre-Import" copy of current data downloads first; if that fails the restore does not start. UI now says all of this.

## 11. Gaps found and corrections

1. Export not a single snapshot → now one read transaction. 2. No cut-off detection → contents list + count check. 3. Records/ids/duplicates unchecked until the database refused them mid-restore → checked first with friendly messages. 4. Sections this version does not know would have been silently ignored → file refused. 5. Encrypted restore bypassed the checks and ignored preferences → now uses the same checker and `restoreChecked`; encrypted export now carries the screen preferences (never secrets). 6. Backup UI wording said "Finance"/"Backup" → renamed.

## 12. Format/version compatibility

**No version bump.** The contents list is a new *optional* field (`manifest`); files without it (all existing backups) are accepted unchanged. Older files still upgrade (migration table unchanged). Files with a `manifest` that disagrees with their lists are refused. A backup that lacks newer modules restores without inventing records (tested: version 14 file with no shared tables).

## 13. Validation and atomicity

Checks, in order: JSON parse; not encrypted; required lists; optional lists are lists; version known (future refused first); no unknown lists; contents list matches; every record an object with usable id (settings: key) and no repeats; gentle notes (never blocking) for transactions/categories pointing at something absent. **Database restore is one transaction**: injected failures in the last table written (`moduleRecords.bulkAdd`) and in `txns` left every table identical to before (tested), and a real duplicate-id failure also rolled back. **Not atomic with the database:** screen preferences in `localStorage` are applied only *after* the database commit succeeds (tested: not applied on failure), so the worst case is "data restored, appearance not", never the reverse. The final Pre-Import copy is a separate download and not part of the transaction.

## 14. Sync implications

Sync is not a backup and the backup does not carry sync identity: no token, passphrase, repo, device id, cursors or tombstones are in a file (tested). Restore re-stamps every record as changed now (tracking hooks, plus `touchAll` when sync is on). With the real `SyncEngine` and two devices (tested): deleting a Task and a visit on A, syncing to B, then restoring on A and syncing, brings both back on **both** devices, with no doubled records; the price key stays on A and is never sent to B. Documented risk (unchanged, stated in the UI): a restore on one synced device **replaces** the others' data at their next sync, including removing records the backup lacks. No sync rule was changed.

## 15. Round-trip test results (`src/lib/backupG1.test.ts`, 26 tests, all pass)

Fictional household built through the real data functions: account, plain and split transactions with project references, project, tasks (one recurring), calendar event (yearly), asset with Finance purchase reference, service entry with a split-transaction reference, arrangement, completed visit with occurrence markers, contact, tag, due item, attachment row, saved theme, unknown fields. Export through `buildBackup` → JSON text → `checkBackupText` → `restoreChecked` into a separate database, then: every table equal (ignoring only `updatedAt`, re-stamped on restore), ids unchanged, links, recurrence, markers, transaction references intact, project spend counted once (65,000 cents not doubled), unknown fields kept, theme/palette restored, secrets absent, restored module loaders read the records, same backup twice = no change. Destructive: delete Task → restore; modify account + add Task → restore (replacement); delete links + visit → restore; tombstoned task stays deleted; pre-Services-era file restores without inventing data.

## 16. Fault injection and mutation checks (each applied, observed, restored)

Drop `moduleRecords` from restore → 6 tests fail (incl. coverage guard). No transaction in restore → rollback test fails. Contents-list check off → truncation test fails. Future-version refusal off → test fails. Price key exported → round-trip test fails. Final run after restoring all: green.

## 17. Browser verification (built-in browser, local dev server, desktop and 375 px, dark mode)

Done: Settings > Appearance renders; chose Calm teal; same accent on Tasks; dark mode + palette persisted over reload; More no longer duplicates colour/backup controls; `#/ledger/backup` forwards; export (summary shown); added then deleted a fictional Task; malformed, truncated and incomplete files each refused with plain messages and nothing changed; valid file shows the warning/summary; Escape and Cancel close it, focus lands on it; restore completed, the deleted Task returned and an existing Household Services visit Task was still present, theme/palette intact (a non-Task record was not re-checked on screen in the browser; Projects, Assets and Services records are covered by the automated round trip instead); no console errors; no horizontal scroll at 375 px. Small targets noted at 375 px (23 px "What is and is not in a backup" summary row; inline "Sync devices" text link; the Settings tab row scrolls sideways) match existing patterns and were not changed. **Not done:** keyboard-only walk of the whole page, screen reader, real phone/tablet, light mode screenshots, the encrypted restore in a browser, actual file-save dialog (downloads were intercepted in the page).
The browser profile on `localhost:5173` already held invented test data from earlier phases; it was replaced by the same data during the restore test. Theme keys were reset afterwards.

## 18. Privacy and encryption

Plain backups are **readable JSON, not encrypted**; the UI now says so with the required warning. Home & Assets serials, plates and addresses are included. An encrypted variant already exists (passphrase, AES-GCM). Nothing is uploaded by G1; the weekly encrypted copy to the owner's private GitHub repository is existing, opt-in behaviour and was not touched.
**Recommendation (future phase "encrypted backups by default"):** threat = a lost/shared backup file, not a hostile device. Keep the existing passphrase approach (PBKDF2→AES-GCM via browser WebCrypto: feasible, already shipped, no dependency). Needs: a minimum passphrase length (exists: 8), a visible "no recovery" warning (exists), an optional "export encrypted by default" switch, include the manifest *inside* the ciphertext, test wrong-passphrase and tampering (GCM detects). Backward compatibility is free (the plain format stays). Recovery limit: forgotten passphrase = unrecoverable. A short separate security review is worthwhile before making it the default (key-derivation cost on phones, passphrase handling in memory), not before G1.

## 19. Future modules

A module that stores its records in the shared stores (`moduleRecords`, `links`, `contacts`, `tags`, `attachments`, `dueItems`) joins backup automatically; the summary counts unknown modules under "Other application data" instead of dropping them (tested with a made-up `pets` module). A module that adds a **new table** is caught by `backupCoverage.test.ts` and the new `backupG1.test.ts` coverage guard (exported, listed in the contents list, restored) and must be added to `exportAll`, `importAll`, the file checker lists (`OPTIONAL_LISTS`) and the sync walker. A module that needs a new `localStorage` preference must add its key to `PREFERENCE_KEYS` (and never a secret). Process is also in `docs/module-hooks.md`.

## 20. Regression

Full suite 1,944 tests in 112 files pass (includes Finance, Tasks, Calendar, Projects, Assets, Services, Contacts, Search, Quick Add, Today, sync). `npx tsc --noEmit` clean. `npm run build` succeeds (existing chunk-size warning). `git diff --check` clean (only line-ending notices). Dexie still version 15, no migration, no dependency change, no GitHub/Actions change.

## 21. Files

**New:** `src/lib/backupSummary.ts`, `src/lib/backupG1.test.ts`, this report.
**Modified:** `src/lib/backup.ts` (read transaction, contents list), `src/lib/backupFile.ts` (checks, summary, preferences hook-in), `src/pages/PlainBackupCard.tsx`, `src/pages/BackupPage.tsx`, `src/pages/SettingsPage.tsx`, `src/pages/MorePage.tsx`, `src/modules/ledger/LedgerModule.tsx` (backup address forwards), `src/shell/nav.ts` (label), `README.md`, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `docs/module-hooks.md`.
**Tests adjusted:** `src/core/core.test.ts` (allow `/settings/…` addresses), `src/lib/backupFile.test.ts` (duplicate id now refused earlier; rollback still tested directly), `src/modules/assets/assets.test.ts` (hand-built "old" file drops the contents list, as a real old file would).

## 22. Judgment calls (please review)

1. Reused the existing format; added only an optional `manifest`. 2. Unknown lists in a file are **refused**, not warned (silent partial restore was the thing to avoid). 3. A contents-list mismatch refuses the file, which also refuses a hand-edited file; old files are unaffected. 4. Referential problems (orphan transactions/categories) only produce a note, because older data may legitimately contain them. 5. `updatedAt` is re-stamped on restore (existing behaviour, now documented and tested). 6. Finance's "Type amounts without a decimal point" stays in Finance. 7. The shell's one-tap theme button stays. 8. Ledger's own Sync page stays (not asked). 9. ~~Encrypted restore has no automatic Pre-Import copy~~ SUPERSEDED by section 27: encrypted restore now makes the same safety copy as plain restore. 10. The summary shows counts only, grouped by area; groupings are presentation, not tables. 11. Preference restore is staged after the database, not atomic with it.

## 23. Limitations / not built

No new encryption format, no cloud upload, no automatic cloud backup, no attachment file storage (none exists), no partial/merge restore, no per-module restore, no sync redesign, no database migration, no S3. Encrypted weekly backups were not modified; to restore one, use the encrypted file card (which now has the same safeguards as plain restore, section 27). Real-device acceptance not done. Appearance on a synced second device is per-device by design (palette/theme are not synced; saved themes are).

## 24. Handoff and backlog

Handoff updated: **yes** (snapshot, S2.1 corrected to committed/deployed, G1 section, risks, change log, next action). Backlog: G1 status entry added on top.

## 25. Final Git status

Modified and untracked files as listed in section 21; nothing staged, committed, pushed or deployed.

## 26. Commit-readiness recommendation

Ready for architectural review. Suggested for the reviewer: judgment calls 2, 3 and 9; the NOT-done browser items; then explicit commit/push authorization. After a push, check the Actions run and record the SHA.

## 27. FINAL PRE-COMMIT CORRECTION: encrypted restore safety copy (2026-11-06)

ChatGPT withheld commit approval until encrypted restore made the same Pre-Import safety copy as plain restore. Done; supersedes judgment call 9 and the "encrypted restore has no Pre-Import copy" statements above.

**1. Actual behavior before the correction.** Plain restore: check file, confirmation panel, safety copy download (restore refused if that failed), one-transaction restore, preferences. Encrypted restore: a browser `confirm()` box FIRST, then decrypt, check, restore. It made **no** safety copy, and the confirmation came before the file had been decrypted or checked (a wrong passphrase was only discovered after you agreed).

**2. Code changes.**
- `src/lib/backupFile.ts`: new `prepareEncryptedRestore(text, passphrase)` (envelope check, decrypt, then exactly `checkBackupText`; every failure is a plain `BackupFileError` ending "Nothing was changed"), and new `restoreWithSafetyCopy(db, file, opts)`, the single sequence: safety copy through the existing `savePreImportCopy` (throws, so nothing is touched, if it fails) then `restoreChecked` (one transaction, preferences only after commit). The encrypted file format, passphrase handling and `decryptText` are unchanged.
- `src/pages/PlainBackupCard.tsx`: plain restore now calls `restoreWithSafetyCopy` (same behavior as before, same 1.2 s pause so the browser starts the download before the reload); the confirmation panel became an exported `RestoreConfirm` component, used by both.
- `src/pages/BackupPage.tsx`: encrypted restore is now: choose file (passphrase must already be typed) → decrypt and check → the shared confirmation panel (says it is decrypted and checked, full replacement, later changes lost, sync consequence, a plain unencrypted safety copy downloads first) → on confirm `restoreWithSafetyCopy` → sync stamp when sync is on → reload with the usual "Backup restored. Your previous data was saved first as …" message. The browser `confirm()` is gone. No dependency, no new security design.

**3. Tests added and results** (`src/lib/backupEncryptedRestore.test.ts`, 9 tests, real encryption, real checker, real safety-copy writer and real restore; only the browser download call is replaced so the saved text can be read): valid restore makes the copy first (database still held the old data when the copy was made) and the copy is one plain "Pre-Import" file holding the CURRENT data and is itself a valid backup; failed safety copy (real writer with a blocked download, and an injected saver failure) leaves every table and the preferences unchanged; wrong passphrase refused with no copy and no change; not-an-envelope, plain file pasted in, non-JSON, incomplete (contents list), newer version, unknown section, duplicate ids, not-a-backup, and non-JSON plaintext are each refused before anything destructive and with no copy; failure injected in the last table written rolls back every table and leaves preferences alone; success preserves module records, links, recurrence, money references, allowed preferences, and drops the secret sync key; the safety copy contains no price key, sync token or weekly-backup passphrase while the device keeps its own price key; plain restore still works through the same sequence (and a failed plain safety copy also changes nothing). **Mutation checks** (each reverted): safety copy skipped 6 fail; copy failure swallowed 2 fail; checks skipped after decrypt 1 fails. **Full run now: 1,953 tests in 113 files pass** (1,944 + 9); `npx tsc --noEmit` clean; `npm run build` succeeds; `git diff --check` clean (line-ending notices only).

**Browser check (invented data, dev server):** exported an encrypted backup (file has only the encryption envelope); a wrong passphrase gave "Wrong passphrase or corrupted backup. Nothing was changed."; a non-encrypted file gave the matching refusal; the right passphrase opened the confirmation (focus on it, "decrypted and checked; nothing has been changed yet"); with downloads made to throw, **Replace my data** showed "The restore did not finish, and your existing data was left as it was." and the page stayed as it was; with downloads working, the restore completed and the page showed "Backup restored. Your previous data was saved first as “Ledger Pre-Import …”". No console errors. Not browser-checked: 375 px for this new panel (same component as the plain restore, checked at 375 px earlier), keyboard-only, a real file picker, real phone.

**4. Are plain and encrypted restore now equivalent?** Yes for the safeguards that matter: both validate fully before confirming, both show the same confirmation (replacement, lost later changes, sync consequence, safety copy), both make the safety copy through the same function and refuse if it fails, both restore in one transaction and apply preferences only afterward, both stamp for sync afterward. Differences that remain on purpose: the encrypted path needs the passphrase first, and the safety copy is a plain (unencrypted) file in both cases, which the panel says.

**5. Remaining limitations.** A browser can only report that a download was STARTED; it cannot confirm the file was written to disk, so "safety copy made" really means "download initiated without an error", and the panel tells the owner to check the Downloads folder. A phone browser may show a save prompt the owner can dismiss; that cannot be detected. The safety copy is not encrypted. The weekly encrypted GitHub copies were not changed. Real-device restore acceptance is still NOT done.

**6. Final Git status.** Modified: README.md, docs/BACKLOG.md, docs/CHATGPT-HANDOFF.md, docs/module-hooks.md, src/core/core.test.ts, src/lib/backup.ts, src/lib/backupFile.test.ts, src/lib/backupFile.ts, src/modules/assets/assets.test.ts, src/modules/ledger/LedgerModule.tsx, src/pages/BackupPage.tsx, src/pages/MorePage.tsx, src/pages/PlainBackupCard.tsx, src/pages/SettingsPage.tsx, src/shell/nav.ts. Untracked: docs/GLOBAL-SETTINGS-G1-REPORT-2026-11-06.md, src/lib/backupEncryptedRestore.test.ts, src/lib/backupG1.test.ts, src/lib/backupSummary.ts. Nothing staged, committed, pushed or deployed. Handoff updated: yes. S3 not started.
