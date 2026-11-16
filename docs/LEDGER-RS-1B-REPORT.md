# Ledger RS-1B: Final Stabilization and Targeted Cleanup

Date: 2026-11-15. Status: **built and tested locally; UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED.** Not real-device tested.

## Executive summary

RS-1B fixes the last four known stabilization items: a wrong 2026 Massachusetts surtax threshold, three native browser pop-ups, a stock's security record being created before the user confirms a grant save (NC-30), and test weaknesses. It adds no features, schema, backup or sync change. Recommended next product phase: **R1.2, Weekly Household Review.**

Baseline checked first: branch `main`, `HEAD` = `origin/main` = `589c3ab` (RS-1A), GitHub Pages run #117 `completed` / `success` (public API; `gh` is not installed). Only the three protected untracked files were present, untouched.

## Changes

| File | Result |
|---|---|
| `src/data/taxYears.ts` | `TAX_2026.ma.surtaxThreshold` $1,083,150 to **$1,107,750**; UNVERIFIED wording removed for this item. 2027 placeholder untouched. |
| `src/lib/rs1bSurtax.test.ts` (new) | Threshold plus 4% surtax just below, at and above it, in the household tax calculator and the Roth planner (both read the shared table). |
| `src/lib/rothTax.test.ts`, `src/lib/tax2027.test.ts` | Existing expectations updated from the 2025 figure to the 2026 figure. |
| `src/pages/CategoriesPage.tsx` | "Delete or move this group's categories first." is now an inline `role="alert"` message, not `alert()`. |
| `src/modules/bills/quickAddDef.ts`, `src/modules/services/quickAddDef.ts`, `src/shell/AddBox.tsx` | A refused Quick Add Undo throws its plain-words message; the Add box shows it as a toast. Wording unchanged. |
| `src/lib/rsuGrant.ts`, `src/pages/RsuGrants.tsx` | NC-30: the form only looks the ticker up (`findSecurityForTicker`, read-only). A new ticker's security is created by `saveGrantWithStock` inside the same transaction as the grant, so cancelling creates nothing and a failed save rolls the security back. |
| `src/lib/rs1bNc30AndAlerts.test.ts` (new) | Cancel (nothing created), confirm (one security, grant linked, existing ticker reused), failure (injected write error leaves zero securities), no `alert()` anywhere in production source, Bills Undo refusal shows no alert. |
| `src/shell/d201bConfirmations.test.tsx` | The NC-30 source-order test now describes the new flow and is stricter (one save call site, no security creation on the page). |
| `src/core/core.test.ts` | Fixed 50/100 ms sleeps replaced by polling for the change (3 s limit). |
| `src/modules/family/family-f2-provider.test.ts` | Uses `scanText`; the broad `555` now matches the full phone number `555-0100`. |
| `README.md`, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md` | Stale B5 "uncommitted" line fixed; RS-1B recorded. |

## Tax verification

Source: Massachusetts DOR, https://www.mass.gov/info-details/massachusetts-4-surtax-on-taxable-income (page updated 2026-06-01): 2025 $1,083,150; 2026 **$1,107,750**. Rate stays 4%. Nothing else in the tax tables changed. Year 2027 remains a provisional placeholder.

## Test results

- Full suite: **295 files, 5,802 tests pass** (was 293 / 5,793). `npx tsc --noEmit` clean. `npm run build` clean.
- An earlier full run had two failures, both caused by this work and fixed: a leak-scan rule (a bare number in a test) and the old NC-30 source-order test.
- Flaky tests: `core.test.ts` timing fixed; the `555` assertion narrowed. `services/s4-calendar.test.ts` test 13 already scrubs generated ids with `scanText`, so no defect was found and it is unchanged.
- Browser (Chromium pane, invented data, local dev server, stopped afterwards): Categories refusal appears inline and no native alert fires. A new stock grant with an unseen ticker created nothing while the form was open and exactly one grant plus one security after Create. Console showed only the known F-2 message.
- NOT exercised in a browser: the vest-dropping confirmation dialog's cancel path and the Quick Add Undo refusal (covered by tests only). No real phone, second device or screen reader.

## Remaining issues

- Defects: none found in the changed workflows.
- Accepted or documented earlier: F-2 dev-mode asset-class "Key already exists" console error on an empty database; HSA withdrawals, RSU vests/grants and goals naming a deleted account; historical orphans (RS-1A findings).
- Open owner decision: **BK-03** (Calendar layer preferences are not in backups). Not changed.
- Deferred: the remaining native pop-ups outside these three (the earlier 51 count is from D20 history; none are `alert()`), real-device acceptance.

## Release recommendation

Ready for owner and ChatGPT review. Commit and push only on explicit authorization; then confirm the Actions run is green.
