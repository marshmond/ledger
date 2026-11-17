# Ledger CS-2: gate report (2026-11-16)

> **UPDATE (same day): SUPERSEDED.** The owner resolved gates B and C and deferred gate D; CS-2 was then built locally. See `docs/LEDGER-CS-2-REPORT.md`. The text below is the original gate check, kept as written.

**Result: CS-2 was NOT started.** Gate A passed. Gates B, C and D are not documented as met, so nothing was built. Documentation only: no code, tests, database records, schema, repository or credentials were created or changed.

## 1. Gate A: CS-1 release (passed)

- Branch `main`. HEAD and `origin/main` are both `f82554f25c45d6a2fc1580375cc79af66e78a5d9`, `feat(display): add secure display eligibility and projection preview`. This is the CS-1 implementation commit, not the earlier CS-0.1 documentation commit `1fec899`.
- The commit contains the editor Save/Cancel correction (`src/display/pending.ts`, `pending.test.ts`).
- GitHub Pages run #128 for that SHA: completed, success (read from the public API; `gh` is not installed).
- Working tree: only the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`), untouched.

## 2. Gate B: G2 owner acceptance (NOT met)

CS-0 section M defines G2 as the "full GO" set: steps **1** (phone opens every part), **2** (Search and Quick Add), **3-6** (Budget, Scheduled, Calendar, confirmations), **7** (home-screen install), **8** (airplane mode and offline), **12**, **13**, **16**, and, if Sync is used, **9** (two-device sync), **10** (conflicts), **11** (numbers agree), **18** (first update). Source: `docs/LEDGER-STABILIZATION-OWNER-ACCEPTANCE-2026-11-09.md`.

| Steps | Status |
|---|---|
| 12, 13, 16 and device versions | Owner-reported complete on 2026-11-16 as G1 (no per-device evidence; see the CS-1 G1 gate report). Not repeated. |
| 1, 2, 3-6, 7, 8 | **Not recorded** |
| 9, 10, 11, 18 (only if Sync is used) | **Not recorded** |

The G1 confirmation was narrower than G2, and the results table in Part D is unticked. Nothing was inferred.

## 3. Gate C: design decisions (NOT approved)

| Decision | Subject | Status |
|---|---|---|
| L-1 | Separate private encrypted GitHub display repository (Option A) | Not approved |
| L-5 | Tablet app on its own origin (T1: new free GitHub organization recommended) | Not approved |
| L-7 | 3-minute polling; amber at 15 minutes; banner at 2 hours; 3-day offline retention | Not approved |
| L-8 | Fresh sync, causal-history check, fail-closed publishing | Not approved |

L-2, L-3, L-4, L-6, L-11 were approved with the recommended defaults for CS-1 and are unchanged.

## 4. Gate D: credentials and infrastructure (NOT authorized)

The owner has not authorized creating the private display repository or its two credentials (a write token for Ledger devices; a read-only token for the tablet). Claude created nothing and asked for nothing.

## 5. What the owner needs to do (nothing is entered in chat)

1. **Phone checks.** On the phone, using the make-believe household, do steps 1, 2, 3-6, 7 and 8 from the acceptance checklist and report P, F (with what was seen) or S for each. If you use Sync, also steps 9, 10, 11 and 18. Steps 12, 13 and 16 need not be repeated.
2. **Decisions.** Approve or change L-1, L-5, L-7 and L-8 in your own words. Recommended defaults: L-1 approve; L-5 a new free GitHub organization for the tablet app; L-7 approve (all adjustable); L-8 approve.
3. **Repository and keys (later, only after steps 1 and 2).** Say explicitly that Claude may proceed. You will then be given numbered instructions to create the private repository and two separate keys directly in GitHub. Never send a key, passphrase or pairing code to a chat.

## 6. Not done

All CS-2 implementation (encryption, publisher, protocol, older-build mitigation, Settings, tablet client, tests, `docs/LEDGER-CS-2-REPORT.md`). Nothing committed, staged or pushed.

## 7. Notes for when CS-2 is authorized

The older-build recurrence risk recorded in the CS-1 report is a release blocker for live publication. The CS-1 preview's throwaway opaque-ID key must be replaced by a stable display key. Both are already in the CS-2 brief and are not forgotten.
