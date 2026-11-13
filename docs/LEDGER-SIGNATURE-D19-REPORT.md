# Ledger Signature D19: More, Settings and Documents redesign (report)

Date: 2026-11-13. Status: **BUILT AND TESTED LOCALLY; UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED; awaiting owner and ChatGPT review. D20 and D21 not started.** Not real-device or screen-reader tested. Pictures: `C:\Users\alexm\Documents\Ledger-Design-Concepts\D19-Evidence`. No approved D19 prototype exists and none was invented; every comparison is labeled **Before (D18.1) versus After (D19)**.

## 1. Release gate (D18.1)

- Repository `marshmond/ledger`, branch `main`; after `git fetch`, `HEAD` = `origin/main` = `18f58bd6b0ddfd2b68428ad110da417f2effbcb5` (`feat(ui): organize Income by person`).
- GitHub Actions: workflow "Deploy to GitHub Pages" run **#107** completed with conclusion **success** for that exact SHA. GitHub Pages: deployment `7772335102` for `18f58bd` has latest status **success** (the earlier deployments read `inactive`). Read from the public GitHub API because `gh` is not installed; no extra permission requested; polled once.
- D18.1's person-centric Income organization is present (confirmed in the D18.1 report and `docs/CHATGPT-HANDOFF.md`).
- Working tree at the start: only the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`). They were not opened for edit, staged or deleted (the seed script was read and copied to a scratch folder to build the demo household).

## 2. Routes redesigned

| ID | Route | Source |
|---|---|---|
| L-27 | `/ledger/more` | `src/pages/MorePage.tsx` |
| L-28 | `/ledger/review` | `src/pages/ReviewPage.tsx` |
| L-29 | `/ledger/guide` | `src/pages/GuidePage.tsx` |
| L-30 | `/ledger/taxpackage` | `src/pages/TaxPackagePage.tsx` |
| L-31 | `/ledger/sync` | `src/pages/SyncPage.tsx` (one component, shared) |
| G-01 | `/settings/general` | `GeneralSettings.tsx` (with `DevicePreferencesCard.tsx`) |
| G-02 | `/settings/appearance` | `AppearanceCard.tsx` |
| G-03 | `/settings/backup` | `BackupPage.tsx` (with `PlainBackupCard.tsx`) |
| G-04 | `/settings/sync` | `SyncPage.tsx` (the same component as L-31) |
| G-05 | `/settings/calendar` | `src/modules/calendar/CalendarSettings.tsx` |

Also the Settings frame (`SettingsPage.tsx`) and the print output. `/ledger/backup` still redirects to Settings; no duplicate Backup screen was made. No route, redirect or address changed.

## 3. Changed files

Modified: `src/pages/MorePage.tsx`, `ReviewPage.tsx`, `GuidePage.tsx`, `TaxPackagePage.tsx`, `SyncPage.tsx`, `SettingsPage.tsx`, `GeneralSettings.tsx`, `DevicePreferencesCard.tsx`, `AppearanceCard.tsx`, `BackupPage.tsx`, `PlainBackupCard.tsx`, `src/modules/calendar/CalendarSettings.tsx`, `src/palette.ts` (three color labels, two contrast messages, one preset blurb and three comments reworded; no key or value changed), `src/styles.css` (two obsolete `.sample-side` lines removed), `src/shell/uiCoverage.test.ts` (new IDs in the "built, not accepted" list), `docs/UI-COVERAGE.md`, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`.
New: `src/pages/SettingsParts.tsx` (`Pill`, `SettingsSection`, `SubHeading`), `src/pages/settings.css`, `src/pages/docs.css`, `src/pages/d19Settings.test.tsx` (16 tests), this report.
**Not changed:** anything in `src/lib` (no engine, backup, encryption, sync or reporting code), `src/db.ts`, `src/types.ts`, routing, Search, Quick Add, the service worker, the security policy, `ModuleLoadBoundary`, any dialog component, `buildReview`, `buildIncomeModel`, `buildTaxPackage`, `sectionCsv`, `downloadText`.

## 4. Page-by-page design summary

**More.** Was seven loose cards. Now five groups: Review and history; Documents and tax preparation; Settings, data and devices (Data & Backups, Sync devices, Appearance, General, Calendar settings, each with a one-line purpose); Money options (the existing amount-entry switch, unchanged); Help and shortcuts (shortcuts and About text, unchanged). Each destination is one whole-row link. A backup notice (warning banner with "Back up now") appears at the top only when the device has never been backed up or the last backup is over 30 days old (the same `BACKUP_STALE_DAYS` the Backup page uses); otherwise the last-backup sentence sits quietly on the Data & Backups row. Two balanced columns on a computer, one on a phone.

**Year in review.** Navy headline panel (net worth at the end of the year, with start, change and "Saved"), a jump row, then Highlights, Net worth, Income and spending, Pay, saving and taxes, Investing and debt as sections. Each section carries a word saying what kind of figure it is: **Saved snapshots**, **Transactions in your accounts**, **From your Income setup** (estimate), **Sales and loan schedules**. Key-value tables became labeled lines; the top-categories table and the chart are unchanged. Every number comes from the same `buildReview` result as before; no metric was added.

**If something happens to me.** An orientation panel (what the guide is for, three steps, and the "never put passwords" warning kept in full), a "Sections" jump row, and sections in the original order. Contacts are cards with labeled fields instead of a spreadsheet row; papers are rows with a labeled "where" field; the accounts, insurance and bills tables become labeled blocks on a phone. Each section says whether you fill it in or the app does. On paper the page is a clean document: typed answers print as text, empty answers print as a ruled blank, buttons, fields and the jump row are left off.

**Tax package.** A summary panel (what the worksheet is, the not-a-return statement, Print and Download all unchanged) with three counts of the worksheet itself (sections, with entries, nothing to report: empty sections are still shown), a jump row, then one section per worksheet table. Each section says what it is made of (**Estimate from Income setup**, **Recorded sales**, **Recorded gifts**, **Recorded and estimated** for HSA, **Recorded vests, estimated values**, **Estimate from loan schedules**, **Planning estimate**). Per-section "download CSV" kept. Wide tables scroll sideways with a hint.

**Settings frame.** A list of the five pages beside the page on a computer (each with a one-line hint, sticky, active page marked by color and an edge), and the original scrolling tab row on a phone with an edge fade. Same five addresses, same redirect, same `BackupReminder`.

**General.** "When the app opens" with the current landing shown as a plain strip ("Ledger opens to Today"), the same select and the same explanatory sentence, plus three short bullets on how the choices behave. The device-preferences card became four groups with a word tag each (Synced and backed up; This device, in backups; This device only; Never copied).

**Appearance.** A "Colors right now" strip, then Mode (the existing toggle and what Device, Light and Dark mean), Color palettes (cards with a visible "In use" tag, light and dark dot rows), My themes (saved themes, add from code), and, when "My own colors" is selected, "Your colors": actions, name form, theme-code box, Light/Dark switch, "Start over from", the color map and, beside it on a wide screen, a readability check and a preview. The preview is now a menu bar mock instead of a sidebar mock.

**Data & Backups.** A status panel first (last backup, pill, and one sentence saying that making a backup never changes data and restoring does). Plain backup and Encrypted backup are each a card with two zones: **Make a backup** (neutral) and **Restore** (red-edged and tinted, tagged "Replaces everything on this device", with a sentence saying it is not an additive import). Messages appear beside the button that caused them. Then Automatic weekly backup (status tag), the phone-and-computer note and Storage protection (status tag).

**Sync devices.** Not set up: a status section that explains **Send this device's data** versus **Replace this device's data**, the setup steps and form, then the one choice that fits the repository (send when nothing is synced yet; replace, red-edged and behind its checkbox, when a synced copy exists). Configured: a status section with a pill (up to date, syncing, problem) and facts, Sync now and Sync automatically; conflicts (amber edge); safety copies; token; and Turn off in its own red-edged section with a plain (not primary) button. Both addresses use it.

**Calendar settings.** Four groups: Display (week start, opening view), Defaults (where new events go), Finance items on the Calendar (past-due days) and Finance items: default priority (with Reset). All wording of the original explanations kept.

## 5. Functional behavior preserved

Same data, same calls, same stored values on every page. Specifically: Review year list and calculations; Guide's `settings` record (`guide`) and every edit action; Tax year list, rows, labels, `displayCell`, `sectionCsv`, `downloadText`, filenames and the 250 ms staggered Download all; General's `saveShellSettings` only on change (opening the page writes nothing, checked); the three Calendar layers and settings records; the theme and palette storage. Browser checks compared every authoritative figure and input value before and after (section 11).

## 6. Backup and restore safeguards (unchanged)

No backup, encryption or restore code changed (`src/lib/backup*.ts`, `autoBackup.ts` untouched). The page still: refuses a passphrase under 8 characters, decrypts and checks the file before showing anything, shows the contents summary and the **"This REPLACES all the data currently in this browser"** warning in the same `RestoreConfirm` (`role="alertdialog"`, focus lands on it, Escape cancels), downloads the plain safety copy first (if that cannot start nothing is replaced), restores in one transaction, touches every record when Sync is on so the restored data wins, and reloads with the "Backup restored" notice. The plain-backup privacy banner ("NOT encrypted") is unchanged. New: the restore zone is labeled as a replacement in words on both cards, and a sentence says restore is not an import that adds. Exercised against the disposable demo household only (section 12). `d19Settings.test.tsx` pins the sequence and the wording at source level.

## 7. Sync safeguards (unchanged)

No sync code changed. Same repository privacy check ("That repository is public…"), same send/replace split (`connect('upload')`, `connect('replace')`), replace still needs its checkbox and still takes the `before-replace` safety snapshot first, same token update, same stop-syncing and clear-versions confirmations (the `ConfirmDialog` components and their text are untouched), same conflict anchor `#conflicts`, same "Put that version back" action. Token and passphrase inputs are `type="password"` (three) and no stored secret is rendered; the test fixture confirmed the page HTML contains neither the fake token nor the fake passphrase.

## 8. Appearance and Calendar settings

Appearance: all presets, the custom editor, light/dark editing, saved themes, naming and renaming, the limit, import and export, contrast notes, the `confirm()` prompts (delete theme, start over) and every storage format are as before. Wording only: the three roles stored as `sideBg`, `sideFg` and `sideActive` read "Sidebar background / text / highlight" with the help "The menu on the left (desktop)", which has been wrong since D8 replaced the sidebar. Established from `styles.css` (`.lnav` uses `--side-bg`, `--side-fg`, `--side-active`): they color Ledger's **menu bar**, so the labels now read "Menu bar background / text / highlight", the two contrast messages and the Deep navy blurb ("navy menu bar") were reworded, and the preview shows a bar. Keys, values and the twelve-color structure did not change; Signature stays opt-in (the default theme is not touched; that is D21). Calendar: every setting, the select values, the blur-to-save past-due field and the Reset priorities button are as before.

## 9. Print and CSV

Print: Review, Guide and Tax package are wrapped in `.dc-doc`, which in print redefines the page's colors locally (white, black text, grey lines, no navy panel, no shadows) so a Dark palette on screen still prints dark on white (before D19, a dark screen printed dark input boxes and a dark table header on white, seen in the Before print picture). The chart surface prints on white too. Headers, menus, jump rows, buttons and fields are hidden; each document keeps its heading and year. Guide: typed text prints as text, empty fields as ruled blanks, balances only when "Show balances" is on (checked on screen and in print). Tax: tables use smaller type, the 13-column pay table 5.5 pt (choose Landscape in the print window for larger type; the page now says so). Money and date formats are the app's own. CSV: nothing changed; checked `tax-2025-sales.csv` (header row and the sale) and Download all (one file per section with rows, correct names).

## 10. Focused tests and build

- New `src/pages/d19Settings.test.tsx`: 16 tests (heading level, id override, status word, five Settings addresses and redirect, More links exist, backup and sync safeguards and wording at source level, no secret rendered, palette keys, print rules and wrappers).
- Existing suites run (all pass): `src/shell` (including `uiCoverage`, `stS3Structure`, `stS3Contrast`, `d8LedgerNav`), `src/core`, `src/modules/calendar`, `lazyBoundary`, and in `src/lib`: `autoBackup`, `backupCoverage`, `backupEncryptedRestore`, `backupFile`, `backupG1`, `guide`, `preferenceBackup`, `review`, `savedThemes`, `taxPackage`, `sync/*`; plus `palette` and `theme`. **55 files, 938 tests, all pass.** One existing test (`stS3Structure`, the device-preferences heading id) failed on the first run and was fixed by letting `SettingsSection` keep the existing id `device-prefs-title`. The only existing test file edited is `src/shell/uiCoverage.test.ts` (the new IDs added to its "built, not accepted" list).
- `npx tsc --noEmit` clean. `npm run build` clean (the existing large-chunk notice only). **The full suite was not run** (the task says CI runs it after an approved commit).

## 11. Browser checks (headless Chrome; fictional household; own address `localhost:5231`; sync off except the fixtures)

Before and after used the same data (a clean extract of `18f58bd` versus the working tree, one browser profile). Demo household extended with invented income, bonus, vest, sale, HSA withdrawal, gift, loan, home value, policies and guide records. Widths 1440, 375, 320; Signature Light and Dark; Classic Light at 1440 and 375: **no horizontal overflow in any of the 70 captures per set.**

Values: every `$` amount and every input value on the pages that have them is present after (Review 28 distinct amounts, 41 occurrences before, 45 after: the four extra are the new headline panel; Tax package 34 distinct, 44 and 44; Guide 16 input values; Calendar settings 11 input values). One data note: the demo app saved a monthly net-worth snapshot between my first and second captures (today's live total), so I re-captured Before and After together after adding a fictional home value; all numbers in the comparison are from that matched pair.

Scripted real-control checks, all **PASS** in the final runs (earlier failures were my script, not the app: a case-sensitive text match, a checkbox read before the live query updated, an expected file count, and a wrong stored-key name): More: eight links open the right page and Back returns; Review: year change and back, identical text; Guide: edit phone persists after reload and is reverted, Show balances on and off on screen and in print, print has no visible fields and shows the typed text, add and remove a contact; Tax: 2025 rows, one CSV (name and header), Download all; General: no write on open, choices unchanged, landing set to "last" and restored; Appearance: preset switch, "In use", mode cycle, editor opens with no "sidebar" wording, saved, renamed and deleted a disposable theme (with `confirm`), Signature restored; Calendar: week start changed and restored, priority changed and Reset; Backup: short passphrase refused, encrypted export, plain export, wrong passphrase refused with no pending restore, restore preview with the replacement warning, Cancel leaves counts unchanged, one confirmed restore of the disposable file first downloads `Ledger Pre-Import…`, then the identical data is intact and the notice shows; Sync (an in-browser fake GitHub, no network, no real credentials): not-set-up explains send versus replace, empty form refused, empty remote offers only upload, upload gives "up to date", `/ledger/sync` shows the same page, secrets not in the page, conflict list (two fixture entries) with clear control, clearing asks first and Cancel keeps them, confirmed clear empties the list, stop-syncing asks first and Cancel keeps sync, a 401 shows "problem" with its message, stopping forgets the token and returns to the not-set-up page.
Console: the only error was the expected 401 from the failed-sync fixture.

**Not driven:** "Put that version back" (the fixture entries have no saved copy), Update token, the Replace-this-device's-data path and its checkbox, Automatic weekly backup in its configured state, the plain backup's confirmed restore (the encrypted one was), the theme-code import, a keyboard Tab walk, any real device or screen reader.

## 12. Before and after pictures

`D19-Evidence\D19-MORE-REVIEW.png`, `D19-GUIDE-TAX-PACKAGE.png`, `D19-SETTINGS-APPEARANCE.png`, `D19-BACKUP-SYNC-CALENDAR.png` (each: Before versus After at 1440 and 375, plus Signature Dark and print where relevant). Folders `More-Review`, `Guide-TaxPackage`, `Settings-General-Appearance`, `Backup-Sync` (includes the restore confirmation and the Sync states: not set up, connected, up to date, conflicts, clear confirmation, failed, and `/ledger/sync`), `Calendar-Settings`, `Print` (PNG and PDF, Before and After) and `Comparisons`; `_raw\before` and `_raw\after` hold every capture (seven looks per page, `values.json`, print captures). Caveat: the Before print pictures were taken at a 1000 px page width and the After ones at 720 px (a Letter page), so line breaks differ.

## 13. Design-quality review

| Page | Composition | Hierarchy | Readability | Action discoverability | Mobile | Warnings | Behavior kept | Remaining compromise |
|---|---|---|---|---|---|---|---|---|
| More | grouped, two columns | clear | good | whole-row links, backup notice | one column, 44 px rows | notice only when due | yes | column balance depends on content height |
| Review | headline panel plus six sections | strong | good | print button in header | tall (+30%) | kind words | yes | the chart still starts its axis at $0 (existing chart, flat-looking line) |
| Guide | orientation plus cards | clear | good | jump row, per-item remove | long (+73%): every contact is a card | password warning kept in full | yes | page is long on a phone; real content |
| Tax package | summary plus sections | clear | good | CSV in each header | tables scroll, hint shown | not-a-return stated twice | yes | the pay table is 13 columns: scrolls on screen, prints small |
| Settings frame | list beside page | clear | good | five pages one tap away | scrolling tabs | n/a | yes | the phone keeps tabs, not the list |
| General | strip plus explanation | clear | good | n/a | good | n/a | yes | the preferences card is long |
| Appearance | five sections | strong | good | "In use" tag | editor stacks | contrast notes kept | yes | `window.confirm()` remains (D20) |
| Data & Backups | status, two backup cards with zones | strong | good | create and restore apart | good | restore red-edged and worded | yes | each card holds both create and restore (kept to avoid splitting the shared state); long page |
| Sync | status or setup, then zones | strong | good | send versus replace explained | good | replace behind checkbox, turn off apart | yes | `ConfirmDialog` look is D20's |
| Calendar settings | four groups | clear | good | Reset beside its group | good | n/a | yes | short page |

## 14. Judgment calls (please review)

1. **Settings navigation:** a list with hints beside the page from 900 px up; the original tab row on a phone. The old `.settings-tabs` class is kept on the element (a test reads its CSS rule).
2. **Title added** to General, Appearance and Calendar settings (they had none; Backup and Sync already did): an h2 under the page's h1.
3. **Section headings follow the page:** h3 under Settings, h2 when Sync is opened at its Ledger address.
4. **Backup cards keep create and restore together** (zones) instead of splitting `PlainBackupCard`, whose messages and busy flag are shared. A display-only "zone" flag puts each message next to its own button.
5. **Added sentences:** "Restoring is not an import that adds to what you have…", the status panel sentence, and the send-versus-replace explainer. Each restates behavior the confirmation text already states.
6. **Palette label wording** (section 8) edited in `src/palette.ts`; the Deep navy blurb said "navy sidebar" and now says "navy menu bar".
7. **More backup notice threshold** reuses 30 days from the Backup page; before, More only had a sentence.
8. **Review headline** uses existing results only; "Saved" appears in the headline and again in its section.
9. **Kind words** on Review and Tax package are my labeling of where each section's figures come from (section 4); they change no figure. Please confirm "Recorded and estimated" for HSA and "Recorded vests, estimated values" for RSU.
10. **Guide order kept** ("What to do first" last, with a jump link) rather than moved first.
11. **Print** is forced light by local token values on the page wrapper (no `!important`); the chart override needs the `html:root` prefix to outrank its own dark rules.
12. **Sync facts** are shown as labeled facts instead of two long sentences; the information is the same.
13. **Inline styles** in the touched files went from 35 to 4 (the palette dots, which are data colors).

## 15. Remaining issues and limits

- Not real-device, screen-reader, forced-colors, Safari or Firefox tested; no keyboard Tab walk; no contrast measurement (`Kbd` is not marked on any D19 row; nothing is `ACC`).
- Long-document print was checked as a single-page capture and as emulated print at page width, not page by page in a PDF viewer.
- `window.confirm()` calls (theme delete, start over) and the `ConfirmDialog` look are D20's. The page-level crash-recovery requirement remains planned for D20 or stabilization.
- The Appearance and Backup pages are long; deliberate grouping was preferred to hiding safeguards.
- Pre-existing, not touched: the net-worth chart's axis starts at $0; `sideState.ts` is unused.
- No decision was inferred. D20 and D21 are not started.

## 16. Handoff

`docs/CHATGPT-HANDOFF.md` was updated (top notice, current phase, delivered functionality, change log), `docs/BACKLOG.md` (status entry) and `docs/UI-COVERAGE.md` (rows, section 1.16). Unknown: the SHA and CI result of the future D19 commit.

## 17. Git status (exact)

Branch `main`, `HEAD` = `origin/main` = `18f58bd6b0ddfd2b68428ad110da417f2effbcb5`. Nothing staged, committed, pushed or deployed; no branch, remote, repository or dependency was created.

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M docs/UI-COVERAGE.md
 M src/modules/calendar/CalendarSettings.tsx
 M src/pages/AppearanceCard.tsx
 M src/pages/BackupPage.tsx
 M src/pages/DevicePreferencesCard.tsx
 M src/pages/GeneralSettings.tsx
 M src/pages/GuidePage.tsx
 M src/pages/MorePage.tsx
 M src/pages/PlainBackupCard.tsx
 M src/pages/ReviewPage.tsx
 M src/pages/SettingsPage.tsx
 M src/pages/SyncPage.tsx
 M src/pages/TaxPackagePage.tsx
 M src/palette.ts
 M src/shell/uiCoverage.test.ts
 M src/styles.css
?? docs/LEDGER-SIGNATURE-D19-REPORT.md
?? docs/UI-DESIGN-D0-AUDIT-2026-11-10.md      (protected, untouched)
?? docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md  (protected, untouched)
?? scripts/dev-demo-seed.ts                   (protected, untouched)
?? src/pages/SettingsParts.tsx
?? src/pages/d19Settings.test.tsx
?? src/pages/docs.css
?? src/pages/settings.css
```

The demo server I started on port 5231 was stopped; the owner's server on 5173 was not touched. Scripts, the browser profile with the invented household and the disposable backup file are in the session scratch folder, outside the repository.
