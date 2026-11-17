# Ledger CS-1: gate G1 report (2026-11-16)

> **UPDATE (same day): GATE CLEARED BY THE OWNER'S REPORT.** See section 6. The sections below are the original gate check, kept as written.

**Result: CS-1 was NOT started.** Gate G1 and the owner decisions are not documented as complete. No code, tests, database records or schema were changed. Documentation only.

## 1. Repository preflight (passed)

- Branch `main`. HEAD and `origin/main` are both `1fec899d9143fe313b0ce8465f1db21f77b02763` (`docs(family): finalize command station architecture`, the CS-0.1 closeout).
- GitHub Pages deployment for that commit: run #127, completed, success (read from the public API; `gh` is not installed).
- Working tree: only the three protected untracked files, untouched: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`.

## 2. Gate G1 (not met)

Source of the checks: `docs/LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md`. Its Part D results table has every box unticked, and the backlog and handoff both state "OWNER GATE G1 OUTSTANDING". Automated tests and working backup code do not count as the owner's real-device checks.

| Check | Status |
|---|---|
| Step 12: plain and encrypted backups downloaded | Not recorded |
| Step 13: encrypted backup restored in an isolated test window; wrong passphrase refused | Not recorded |
| Step 16: credentials, passphrases, recovery information and backup locations in the owner's password manager | Not recorded |
| Every household device on a build at or after ST-S5.1 (`ba4da59`) | Not recorded |

## 3. Owner decisions (not approved)

The backlog and handoff say the owner has not formally approved the L-series. The defaults in section L of `docs/LEDGER-CS-0-DESIGN.md` are ChatGPT's recommendations, not decisions.

| Decision | Proposed default | Status |
|---|---|---|
| L-2 | Sanitized household-service visits, maintenance reminders, names-only Family dates | Not approved |
| L-3 | Coarse adult/child/other grouping | Not approved |
| L-4 | Per-item and per-calendar grants, plus a Busy level | Not approved |
| L-6 | Event locations excluded | Not approved |
| L-11 | Approval follows edits to the same item | Not approved |

## 4. What the owner needs to do (nothing is entered in chat)

1. **Step 12.** In Settings > Backup download the plain backup. Save a passphrase in the password manager first, then Export encrypted backup. Confirm both files exist and "Last backup" shows today.
2. **Step 13.** In a test window with the make-believe household, export an encrypted backup (test passphrase `test only 123`). Restore it into a new empty test window and check the counts before pressing Replace my data. In a third test window a wrong passphrase must be refused ("Wrong passphrase or corrupted backup. Nothing was changed."). **Never restore over the real data.**
3. **Step 16.** Confirm the password manager holds: GitHub sign-in and two-factor recovery codes; the GitHub token and its expiry; the sync passphrase; the backup passphrase; where encrypted backups are kept; and that a trusted person knows how to find the password manager.
4. **Devices.** Reload Ledger on each device and confirm it runs the latest deployed build (at or after `ba4da59`).
5. **L-2, L-3, L-4, L-6, L-11.** Approve or change each default in the owner's own words.

**Evidence to report back:** P, F (with what was seen) or S for steps 12, 13, 16; whether the wrong passphrase was refused; the list of devices checked; the decision on each of the five items. Never send passphrases or tokens.

## 5. Not done

CS-1 implementation, the module-record compatibility audit, `docs/LEDGER-CS-1-REPORT.md`. Nothing committed, staged or pushed. Awaiting explicit authorization after the owner's evidence.

## 6. Gate cleared (owner-reported), and what that does and does not prove

The owner explicitly confirmed completion of all four G1 requirements, and approved the five CS-0 decisions with the recommended defaults:

| Check | Owner-reported status |
|---|---|
| Step 12: plain and encrypted backups downloaded | Complete |
| Step 13: encrypted backup restored in an isolated test window, wrong passphrase rejected | Complete |
| Step 16: credentials, passphrases and recovery information in the owner's password manager | Complete |
| Device verification: every household Ledger device on the required deployed build (at or after ST-S5.1 `ba4da59`) | Complete |

| Decision | Status |
|---|---|
| L-2 (sanitized visits, maintenance reminders, names-only Family dates) | Approved, recommended default |
| L-3 (coarse adult/child/other grouping) | Approved, recommended default |
| L-4 (per-item and per-calendar grants, plus Busy) | Approved, recommended default |
| L-6 (event locations excluded) | Approved, recommended default |
| L-11 (approval follows edits, with previews and warnings) | Approved, recommended default |

**What this is:** the owner's report, passed on in the CS-1 authorization. **What it is not:** independent testing by Claude. No device names, versions, dates or screenshots were supplied, so none are recorded, and the results table (Part D) of `docs/LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md` is intentionally left unticked with a note pointing here. Claude did not (and cannot) check any real device. CS-1 was authorized to proceed and was built (`docs/LEDGER-CS-1-REPORT.md`). Nothing was committed, pushed or deployed.
