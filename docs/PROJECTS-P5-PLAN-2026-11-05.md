# Projects P5 (final visualizations and acceptance): design plan

Date: 2026-11-05. **Plan only. Nothing here is built.** No application code was changed. Contains no personal or financial data.

## 0. Gate (checked before planning)
- P4B (`6545763`) is on `origin/main`; the "Deploy to GitHub Pages" run for it concluded `success` (read from GitHub's public API). The working tree was clean.

## 1. What already exists and will be reused
- **`AllocationBar`** (`src/pages/charts.tsx`): the stacked bar plus legend (swatch, name, %, amount, tooltip, keyboard focus, `role="img"` label) that matches the owner's mock-up. It uses eight theme-aware colour slots (`--s1` to `--s8`, defined for light and dark) and keeps a colour tied to the thing, not its rank. It is used by Investments, so it will **not be changed**; P5 adds a small sibling component in the Projects module that uses the same classes and tokens.
- **Numbers:** `ProjectSummary.lines` (per line: agreed, paid, left to pay, expected = paid + left, the "No budget line" row built as totals minus named lines) and `ContractSummary.split.lines` (per line of one agreement: agreed, paid, signed left; unassigned payments). `noLineNotes` already explains what is in "No budget line".
- **Reports:** the P4B project filter (`projectOnlyTxns`, `net` mode) and `categoryCsv`.

## 2. The plan

### 2.1 Overall project cost bar (item 1)
A card **"Where the money goes"** on the project page, between "Needs attention" and the "Budget by line" table (the table stays as the exact numbers).
- Big figure: **Expected total cost** (= paid + left to pay; the same figure as the headline stat), one bar, one segment per budget line, legend rows `colour dot · line name · % of total · amount`.
- Segments are each line's **expected** figure from the summary, so they add up to the headline by construction. Percentages are of that total.
- Colour follows the line's position in the project's own line order (stable when amounts change). More than 7 lines: the smallest are grouped as "Other lines (n)" in the bar and expand in the legend.
- A line whose expected cost is zero or below is kept out of the bar and shown in the legend with "—" (a bar cannot show a negative width).

### 2.2 Same pattern for one agreement (item 2)
On each split agreement card, above the (collapsed) breakdown table: a bar of **agreed** by line (the current split, change orders included), same legend. Unsplit agreements get no bar (one segment would say nothing). Reuses the same component and `ContractSummary.split`.

### 2.3 Paid versus remaining (item 3)
An optional switch on the card: **Expected cost | Paid and left**. Default: Expected cost.
- In "Paid and left" each segment is two-tone: **paid** solid, **left to pay** lighter, legend columns Paid, Left, Expected.
- **Signed or negative left** (a line paid beyond its share): the segment's width is its expected cost; the segment is fully "paid" and carries a visible **"over share" notch**; the legend shows the left amount with a minus sign **and the words** "paid beyond its share" (never colour alone). The project total is unaffected and a one-line note explains that the extra comes out of other lines.

### 2.4 "No budget line" (item 4)
- Shown as its own **neutral, hatched segment** (not one of the categorical colours), named exactly "No budget line", at the end of the bar and legend.
- Its legend row carries a short "what is this?" line from `noLineNotes` (genuinely unassigned payment, unsplit change order, removed line, stale split, overpaid agreement, or plainly unfiled).
- If its expected figure is zero or negative (the balancing case where an unassigned payment is offset against the lines' left), it is **not drawn**; a note under the bar says so ("$2,000 paid without a line; the lines above show that much too much left to pay"). This never presents a balancing figure as a cost.

### 2.5 Responsive, accessible, dark (item 5)
- Bar fills the card width; at 375 px the legend becomes stacked label/value rows (the pattern the project tables already use). No horizontal scroll.
- The legend **is** the accessible data table (names, percentages, amounts, signed values in words). The bar has one `role="img"` label summarising it, segments are keyboard-focusable with the existing tooltip pattern, and nothing depends on colour alone (hatching and words).
- Uses only the existing theme tokens; checked in light and dark; no animation.

### 2.6 Link to the filtered Finance report (item 6)
- A link **"See spending over time"** in the card, to `#/ledger/reports?project=<id>`.
- Reports reads that address on arrival (the same pattern the Transactions page already uses for `?project=`), selects the project in the existing filter, shows the "Only: project" chip, and tidies the address. A missing or deleted project id is ignored with the filter left off.

### 2.7 Project-aware CSV (item 7, evaluation)
Today's CSV (category by month, plus total spending and income rows) is correct for an unfiltered view. When a project filter is on, the same download currently carries an all-zero Income row and a generic filename.
**Recommendation: do a small, safe change only for the filtered case**: filename `project-<name>-spending-<from>-to-<to>.csv`, and no Income row. The unfiltered output stays **byte-for-byte identical** (a test pins it). A separate "project budget table" export (lines by agreed/paid/left) is a different feature and is **not** proposed for P5.

### 2.8 Regression checks (item 8)
Because P5 only reads existing summary data:
- A pure helper `costSegments(summary)` in `financialView.ts` does grouping, percentages and the "Other lines" bucket; **no money is computed there beyond adding existing figures**. Tests assert the segments add up to `expectedTotalCents` for: no lines, one line, many lines, overpaid line, unassigned payment, unsplit change order, removed line, P4A multi-line agreement, an agreement after editing allocations, a deleted project's reference.
- P4A: all allocation and reconciliation tests unchanged. P4B: deletion and sync tests unchanged. A test also confirms the report CSV for an unfiltered view is identical before and after.
- Full suite, `tsc`, production build, and browser checks at desktop and 375 px in dark mode (no console errors).

## 3. Expected files
New: a `CostBar` component and CSS in `src/modules/projects/`, a test file. Modified: `financialView.ts` (`costSegments`), `Financials.tsx` (the card), `Commitments.tsx` (agreement bar), `projects.css`, `ReportsPage.tsx` (arrival link, filtered CSV name and rows), `reports.ts` only if the CSV helper needs a flag. **No schema, backup, sync, transaction or calculation change; no charting dependency.**

## 4. Owner decisions (answered 2026-11-05: all three took the recommended default)
**Decided:** (1) the main bar adds up to Expected total cost; (2) a zero or negative "No budget line" is left out of the bar and explained in a note; (3) CSV: filtered-view filename and no Income row only. The list below is kept for the reasoning.
1. **What the main bar adds up to.** Recommended: **Expected total cost** (paid + left to pay, equal to the dashboard figure). Alternative: planned budget by line (plan versus actual).
2. **What to do when "No budget line" is only a balancing figure.** Recommended: **leave it out of the bar and explain it in a note**. Alternative: draw it anyway.
3. **CSV scope.** Recommended: **filtered-view filename and no Income row only**. Alternative: also add a project budget-table export.
Everything else above is a default I will use unless told otherwise (placement of the card, Expected-cost default view, "Other lines" grouping beyond seven, no bar on unsplit agreements).

## 5. Out of scope
New charting libraries; any new calculation; Calendar project filter; the one-click proportional payment assignment; Home & Assets and other modules.

## 6. Projects acceptance checklist (deployed app, run by the owner on real devices)
Use a test project with invented names, and export a backup first.

**A. Desktop, deployed site**
1. Open the deployed address; hard-refresh; no error screens.
2. Create a project with three budget lines; add a $50,000 agreement split across them; add a negative change order with its own split.
3. Record payments from the transaction form: one on each line, one split across lines, one "Not sure yet". Confirm the "Needs attention" text, the budget table, and the agreement card agree.
4. Open Reports, filter to the project (from the new link once P5 is built), confirm the total equals the project's "Paid".
5. Quick Add `+project`, bulk move tasks with Undo, search shows the project name.
6. Archive then Restore; then try Delete permanently on a project with a payment (it must refuse) and on an empty one (it must delete).

**B. Phone (about 375 px), light and dark**
Repeat A.2 to A.6 on the phone browser; check the delete dialog, the bulk bar, the Reports filter and the new bars fit without sideways scrolling and are readable in dark mode.

**C. Backup**
1. Export a backup; delete a test project; import the backup; confirm the project, lines, agreements and tagged payments are back and totals match.
2. Confirm an exported file contains no surprises (open it as text only if comfortable; it is your data).

**D. Offline reload**
1. Open the deployed app online once so it is cached; turn on airplane mode; reload; confirm the Projects screens open and show your data.
2. Add a task and a payment offline; turn the network back on; confirm they are still there and sync (if sync is on).

**E. Two real devices (sync on, both on the latest version)**
1. Same project on both. Edit different things on each (a task on one, a payment on the other); sync both; confirm both edits appear on both.
2. Edit the same agreement on both while offline; sync; confirm the later edit wins on both and nothing is duplicated.
3. **Permanent deletion conflicts:** (a) on device A delete an empty project; on device B (not yet synced) rename it; sync both several times; it must stay deleted everywhere. (b) Same, but B adds a budget line; the line must also be gone. (c) On B (stale) tag a payment to the project A deleted; after syncing the project must come back with its lines, and the payment must be intact. (d) Restore an older backup on one device; confirm the restored project survives the next sync.
4. Confirm an older, un-updated device is not used during this test.

Record each result (pass, fail, or not tried) in the backlog; any fail is a bug to fix before relying on the feature.
