# Ledger stabilization: final disposition (carry this into the next planning phase)

**Date:** 2026-11-09. **Source of truth for detail:** `docs/LEDGER-STABILIZATION-ST-S5-ACCEPTANCE-2026-11-09.md` (evidence, matrix, findings), `docs/LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md` (what the owner must still do). This page is the short version. It contains no real data.

**Verdict: CONDITIONAL GO.** Released build: `main` = `4b827eb5e36fea8919708e2f0394d9667b5eda3e`, Pages run #78 success, 3,601 tests in 198 files, `tsc` clean, build identical to the live site. Schema version 15, encryption formats and dependencies unchanged since B5.

## What each phase accomplished

| Phase | Commit / run | Accomplished |
|---|---|---|
| **S0** audit | with ST-S1 | Found 0 P0, 2 P1 (SE-01 shared web address, DI-01 account deletion), 9 P2, 29 P3; defined the acceptance plan |
| **ST-S1** | `5e1f182`, run #75 | DI-01 (accounts with Scheduled items or loans cannot be deleted; a missing account refuses posting); SY-01 (every overwritten sync edit kept, saved before anything is overwritten); TS-01 (date-fragile tests); BK-01 (three more preferences in backups); hosting-isolation plan written, nothing done |
| **ST-S2** | `a7ef63c`, run #76 | DI-02/UX-04 (a delete preview names every module that depends on a payment, refuses when stale, deletes all-or-nothing); shared helpers; wording |
| **ST-S3** | `6632576`, run #77 | AX-01 to AX-05 (spoken names, 24/44 px targets, landmarks and skip link, contrast, announced errors), styled destructive dialogs, device-settings explanation |
| **ST-S4** | `4b827eb`, run #78 | PF-01 (first download 638 KB to 336 KB, screens load on demand), SE-03 (per-build cache, two builds kept, other apps' caches never touched), test timeouts and a behavioral read-only guard |
| **ST-S5** (this) | none (verification only) | Independent acceptance: financial integrity, deletion, sync at 50/51/120/500 conflicts, full backup and recovery drills, offline and five-release update drills, accessibility, performance, test health, mutation checks, hosting re-check. Found two sync findings and two small accessibility ones |

## What ST-S5 verified (and how)

All with invented data; **none of it on a real phone, second device, real GitHub, Safari or a screen reader**.
- Automated: 14 full-suite runs green (including 8 shifted clocks and time zones, 3 at once), 157 golden-master tests unchanged, 6 of 6 deliberate breaks caught, plus 63 extra drill tests outside the repository.
- Browser (disposable Chrome profiles, server stopped for offline): 18 of 18 addresses offline; a 10,000-transaction household restored from plain and encrypted files into empty profiles and then used offline; five releases with old tabs, a partly failed update and untouched foreign caches; 17 screens at 375 px and desktop for structure and names; keyboard, focus and dialog behavior; contrast in light and dark.

## Findings left by ST-S5 (none implemented)

| Ref | Sev | One line | Action |
|---|---|---|---|
| ST5-F1 | P2 latent | An older device erases rows of database tables it does not know, and newer devices then delete their copies | **No new tables until fixed**; then make the merge pass unknown tables through, with a test |
| ST5-F2 | P2 residual of SY-01 | Two open tabs can overwrite each other's saved conflict list | Web Locks around conflict changes and sync, or use one tab |
| ST5-F3 | P3 | Household Services overview jumps from `h2` to `h4` | two headings to `h3` |
| ST5-F4 | P3 | "All" link on Ledger Home is 20 px wide at 375 px | minimum 24 px |
| ST5-F5 to F7 | info | incomplete-install mark never clears; sync file version never read; slowest test has 2.7x headroom under load | note only |

## Remaining technical debt

- ST5-F1 and ST5-F2 (above).
- Soft-deleted records are never purged (DI-03); secrets are in plain local storage (SE-02); passphrase minimum is 8 characters (SE-04); no clock-skew warning (SY-03); no back-off after repeated GitHub failures (SY-04); no security headers possible on GitHub Pages (SE-05).
- 51 native pop-up boxes remain beside the styled dialog (UX-03); confirm dialogs are `dialog`, restore confirmation is `alertdialog` (cosmetic).
- Public holidays are not considered by any business-day rule (by design, documented).
- Still no browser test tool inside the repository (TS-04): the browser drills of this phase live outside Git. Hide Amounts does not cover Ledger's own pages (UX-01, decided).
- The two largest chunks (entry 711 KB, Ledger screens 579 KB) still trigger the 500 KB build warning; module readers and styles are still in the first download (ST-S4 judgment call).

## Remaining user acceptance (category D)

Real phone (every module, Search, Quick Add, Budget edit, Scheduled approve/skip, checkbox, Calendar, a cancelled destructive confirmation, readability and touch comfort); installed app on iOS Safari / Home Screen and Android Chrome; airplane mode with offline entry and reconnection; two-device sync with real GitHub including a conflict and a cross-module numbers check; restoring a real weekly GitHub copy into a disposable profile; screen-reader smoke test (Budget and Scheduled first); the one-time first update on each device; confirming the three secrets are in a password manager; reading the two Sync-page figures (SY-02). Steps: owner checklist.

## Hosting-security decision (SE-01): OPEN

Ledger, FBB and Foodventory share the origin `https://marshmond.github.io`. Reconfirmed today (public pages only): Foodventory still loads two outside scripts and has 18 `innerHTML` assignments. A local demonstration with invented data showed an unrelated page on the same origin reading Ledger's databases and saved sync configuration. ST-S4's cache change protects the **other** apps from Ledger, not Ledger from them. Options (plan unchanged): **A** custom domain for Ledger (default), **B** separate free GitHub account/organization, **C** move the other apps, **D** accept the risk. Every step needs the owner's written authorization first; nothing was done. Data would move by backup then "use the synced copy" on the new address; rollback is leaving the old address as it is.

## Deferred optional work

B3.2 (create a Finance Scheduled item from a bill); Search and Quick Add for Household finances beyond the page link; Calendar export of the Bills/Services/Projects layers and privacy options; push notifications; an in-app list of GitHub backups; an optional device lock for saved secrets; splitting module readers and styles out of the first download; a visible "update available" notice; purging soft-deleted records; Undo for Finance deletes; real-phone performance tuning if the owner's measurement asks for it.

## Family Management prerequisites (two separate decisions)

- **Security gate: CLOSED** until SE-01 is resolved and verified from the other apps' address, **or** the owner explicitly accepts the risk after reading the acceptance report section 17. This is separate from functional readiness.
- **Functional readiness: CONDITIONAL.** Needed first: (1) a written person-model decision (O-10: household member as a contact, a Finance `people` entry, or both) with small records, because a whole record wins in a sync clash; (2) **no new database tables** until ST5-F1 is fixed (build on `moduleRecords` as every module has); (3) ST5-F2 fixed or accepted; (4) a masking rule for sensitive family data and a decision on whether such notes may appear in plain backups; (5) a shared "who points at this person" reader like the transaction one, so deleting a person cannot leave dangling links; (6) the real-device acceptance in the owner checklist; (7) a read-only-first scope.

## Conditions before a full GO (from the acceptance report, section 23)

C1 hosting resolved or accepted; C2 phone checks passed; C3 real two-device sync passed; C4 a restore rehearsal passed with the secrets confirmed written down; C5 screen-reader smoke done or consciously skipped; C6 ST5-F1 fixed before any table is added; C7 ST5-F2 fixed or accepted; C8 SY-02 figures read and small.

*No Family Management implementation prompt is included, by instruction.*
