# Projects: spreading one contract across several budget lines (design review)

Date: 2026-11-05. Status: **proposal only. Nothing described here is built.** No Finance calculation and no commitment record was changed
for this review. It was written during Projects P3 as a read-only design pass; the build, if approved, is P4.

All figures below are invented examples.

## 1. The problem in one paragraph

Today a contract (an accepted agreement, with its change orders) has **one home budget line, or none**. Its "Agreed" and "Left to pay"
sit on that line. Payments are already more flexible: since the P2 follow-up, each piece of a payment can name its own budget line. So a
general contractor's $30,000 agreement, covering plumbing, electrical and tile, either sits entirely on one line or sits in "No budget
line", while the payments land on three different lines. The line rows then disagree with how the money is really planned: Plumbing shows
payments but no agreed amount, and "No budget line" shows $30,000 agreed that belongs elsewhere.

## 2. Recommendation (the short version)

**Store the split inside the commitment record, as a short list of (budget line, amount) pairs that must add up exactly to the
commitment's own amount.** Each change order carries its own list. Leave payments exactly as they are. Compute the per-line rows from
those lists; compute the project totals exactly as today (they never look at the lists). A contract with no list behaves exactly as it
does today, so there is no migration, no database change, and no backup or sync format change.

Why this over separate allocation records: the rule "the parts add up to the whole" can only be kept true under offline sync if the parts
and the whole are written together in one record. See section 3.

## 3. Evaluation, point by point

### 3.1 Allocation records under a commitment, or stored inside it?

| | Inside the commitment (recommended) | Separate allocation records |
|---|---|---|
| Shape | `allocations: [{ budgetLineId, amountCents }]` on the commitment's data | One `moduleRecords` row per (commitment, line) |
| "Parts add up to the whole" | Written and checked in one save, so **every stored version satisfies it** | Two devices can each save a valid set, and the merged result of the two can add up to something else |
| Sync merge | Whole-record last writer wins, the same as editing the amount today; never a blend of two edits | Per-row merge: more granular, but the blend is the problem above |
| Delete a commitment | Allocations go with it | Orphan rows to find and remove |
| Undo | One snapshot | Several rows to restore together |
| Rows to sync | None extra | One per line per commitment |
| Per-line queries ("everything on Tile") | Scan commitments of the project (a handful) | Direct |

The per-line query is not a real cost: a project has tens of commitments, not thousands. The atomicity is the deciding point. Separate
records become worth it only if a later phase gives each line its own life (invoices per line, per-line approvals); then revisit.

### 3.2 How the allocated total reconciles to the agreement's value

- **Exact equality at save time.** The list must add up to the commitment's amount to the cent. The form shows "Left to allocate $X" live
  and will not save until it is $0.00.
- **The remainder is explicit, never implied.** An entry may name **no line** (stored with `budgetLineId: null`). It counts toward "No
  budget line", exactly as an unfiled contract does today. So "I have not decided where $2,000 goes" is a stored, visible choice.
- **Reading is forgiving.** If a stored list does not add up (an older copy of the app edited the amount but kept the list as an unknown
  field; a hand-edited backup), the reader **ignores the whole list**, treats the commitment as it is treated today (home line), and the
  dashboard says "The split of this agreement no longer adds up; open it to fix". The totals are never affected.
- Allocations to lines that no longer exist are handled like dangling lines today: they fall into the "No budget line" row, with a warning.
- Rounding: whole cents everywhere. The form's "split evenly" helper gives any odd cent to the first line, deterministically, so two
  devices never disagree.

### 3.3 Positive and negative change orders

Each change order carries **its own** list, adding up to its own signed amount. A line's committed amount from a contract is the sum of
that line's entries across the original agreement and its **accepted** change orders. Declined, cancelled and merely quoted change orders
contribute nothing (the same rule the totals already use for amounts).

- A positive change order ("+$2,500 extra tile") normally has one entry (+$2,500 on Tile).
- A negative one ("-$1,000, plumbing scope reduced") normally has one negative entry (-$1,000 on Plumbing). This also covers a **vendor
  credit** once its negative change order is added (example 3).
- Mixed entries are allowed so long as they add up (for example +$500 Tile and -$1,500 Plumbing for a net -$1,000).
- A line's committed amount from one contract may not go below zero: the form refuses it in plain words.
- **No silent defaults.** When a contract already has a split, adding a change order opens with a suggested split (the same proportions as
  the original, rounded to whole cents) that the owner must look at and confirm; what is saved is always explicit numbers. If the owner
  skips it, the change order has no list, its amount goes to "No budget line" with a warning, and nothing else moves.

### 3.4 Payments already assigned to budget lines

**Payments are not changed.** A payment piece keeps its stored project, optional contract, optional budget line and optional
reversal/credit marker. The per-line "Paid" is still the sum of the pieces on that line.

The one new rule: when a piece names a contract that has a split and **no line**, that piece cannot be attributed to a line. Rather than
guess, the form asks ("This agreement is split across lines. Which line is this payment for?" with "Not sure yet" as a visible choice).
Existing payments recorded before a contract was split are left alone; the owner is offered a one-click **"Assign my existing payments in
proportion"** with a preview, never automatic. A payment with no line stays visible in a "Not assigned to a line" row (section 3.5).

### 3.5 Avoiding double counting at the project level

Three rules, each testable:

1. **Project totals never read allocations.** Agreed, Paid, Left to pay and Expected total are computed per contract exactly as today
   (`summariseProject`). The split only decides which row a contract's money is *shown on*.
2. **Per-line figures** for one contract with split entries `a_i` and net payments `p_i` assigned to line `i`:
   - Agreed on line `i` = `a_i`
   - Paid on line `i` = `p_i` (reversals and credits lower it, as today)
   - Left to pay on line `i` = `a_i - p_i`, **signed**. A negative number means "this line is paid beyond its share" and is shown as such.
   - Expected on line `i` = Paid + Left to pay.
3. **One reconciling row.** "Not assigned to a line" is defined as *project totals minus the sum of the named lines*, in every column. So
   the rows add up to the totals **by construction**. It is non-zero only for three named causes: unfiled amounts (null-line entries or
   contracts with no split), payments with no line on a split contract, and a contract paid beyond its agreed amount overall (where the
   project clamps "left" at zero). For ordinary data it is empty and hidden.

A property test makes rule 3 permanent: for generated projects (random contracts, splits, change orders, payments, reversals, credits),
the sum of line rows plus the reconciling row equals the project figure in every column, and equals zero in the ordinary case.

### 3.6 Existing P2 data and unallocated agreements

- A commitment **without** `allocations` is read as one implicit entry: 100% on its home line (or none). That is today's behaviour, to the
  cent, so every existing project shows identical numbers after P4 ships.
- No migration. Splitting is opt-in per contract: a **"Split across budget lines"** button on the commitment form.
- Removing the split (button, or clearing the list) returns the contract to its home line. The home line stays stored all along, so this
  is lossless.
- Declined, cancelled and quoted commitments may carry a list but it counts for nothing until accepted, like their amounts.

### 3.7 Edits and offline sync conflicts

- Commitments are `moduleRecords`, merged per record, last writer wins (the existing sync). Allocations ride in the commitment, so they
  merge exactly like an amount edit: the later whole commitment wins, never a half-and-half.
- Two devices editing **different** records never conflict: payments (transactions) and commitments are different tables; a change order
  is its own record. Each record is internally valid, so the union is valid.
- One device removes a budget line while another has just allocated to it: the existing rule (a line with tagged spending cannot be
  removed) is extended to lines with allocations. A race across devices is still possible, and the reader copes: the entry falls into
  "No budget line" with a warning.
- Older app version on one device (does not know the field): it keeps `allocations` as an unknown field. If it changes the amount, the list
  stops adding up and rule 3.2 applies (ignored, warned). Nothing is lost, and the list reappears as valid if the amount is changed back.
- Undo for a split edit is one snapshot of one record.

### 3.8 What the minimal P4 build involves

Small and mostly contained; no schema version change.

1. **Model** (`commitmentModel.ts`): `allocations` as a known field with defensive reading; `validateAllocations` (sum equals amount, lines
   belong to this project and are not duplicated, sign rules, per-line committed not below zero).
2. **Finance** (`src/lib/txnProject.ts`, `summariseProject`): per-line agreed and left from allocations (formulas in 3.5), the reconciling
   row, new warnings. The project totals code path is untouched.
3. **Commitment form**: "Split across budget lines" editor with "Left to allocate", "Split evenly", and the proportional suggestion for
   change orders.
4. **Transaction Project box**: when the chosen contract has a split, the line choice is required (with "Not sure yet"); a helper that
   pre-selects the line with the most left to pay; the one-click "assign my existing payments" tool.
5. **Dashboard**: the "Needs attention" list gains "split no longer adds up", "change order not split", "payments not assigned to a line".
6. **Line removal guard** extended to allocated lines.
7. **Tests**: validation, the three worked examples below as exact-number tests, the property test in 3.5, reading a bad or stale list,
   old-data-unchanged (every P2 test must pass untouched), export/restore/snapshot keep the field.
8. **Docs**: P4 report, backlog entry.

Not in P4: invoices, retainage or holdbacks, per-line approvals, vendor-side line items, line-level documents.

## 4. Worked examples

Contract: **General contractor, $30,000**, split Plumbing $10,000, Electrical $8,000, Tile $12,000 (adds to $30,000).

### Example 1: unevenly split, payments on each line

Payments: Plumbing $6,000, Electrical $4,000, Tile $3,000 (each piece names its line).

| Line | Agreed | Paid | Left to pay |
|---|---:|---:|---:|
| Plumbing | 10,000 | 6,000 | 4,000 |
| Electrical | 8,000 | 4,000 | 4,000 |
| Tile | 12,000 | 3,000 | 9,000 |
| **Rows add up to** | **30,000** | **13,000** | **17,000** |
| Project (contract level, unchanged) | 30,000 | 13,000 | 17,000 (30,000 - 13,000) |

The "Not assigned" row is empty. An even split would be $10,000 on each line; the mechanics are identical.

### Example 2: part payments and a change order (one positive, one negative)

Start from the same contract. Accept a change order **+$2,500, all Tile**: Tile becomes 14,500 and the agreement 32,500. Payments so far:
Plumbing $6,000, Electrical $4,000, Tile $8,000 (total 18,000).

| Line | Agreed | Paid | Left to pay |
|---|---:|---:|---:|
| Plumbing | 10,000 | 6,000 | 4,000 |
| Electrical | 8,000 | 4,000 | 4,000 |
| Tile | 14,500 | 8,000 | 6,500 |
| **Rows add up to** | **32,500** | **18,000** | **14,500** |
| Project | 32,500 | 18,000 | 14,500 (32,500 - 18,000) |

Now accept a second change order **-$1,000, all Plumbing** (scope reduced): Plumbing agreed 9,000, left 3,000; agreement 31,500; project
left 13,500 (31,500 - 18,000); rows: 3,000 + 4,000 + 6,500 = 13,500. If the +$2,500 change order is accepted **without a split**, its
amount shows in "Not assigned to a line" (agreed 2,500, left 2,500) with a warning, and the totals are still right.

### Example 3: a reversal and a vendor credit

Payments so far: Plumbing $10,000 (paid in full), Tile $12,000 (paid in full), Electrical $5,000. Net paid 27,000; left 3,000, all Electrical.

- **Reversal.** The $5,000 plumbing payment bounces and is reversed (+$5,000 piece, marked "reversal", on Plumbing). Plumbing paid 5,000,
  left 5,000. Contract paid 22,000, left 8,000. Rows: Plumbing 5,000 + Electrical 3,000 + Tile 0 = 8,000. ✔
- **Vendor credit** (starting again from the 27,000 position). The contractor refunds $1,500 because the tile job came in smaller (+$1,500
  piece, marked "credit", on Tile). Tile paid 10,500, agreed still 12,000, so Tile shows 1,500 left; contract left 4,500 (30,000 -
  25,500); rows 1,500 + 3,000 = 4,500. ✔ The existing "credit not matched by a negative change order" warning appears. The owner adds a
  **-$1,500 change order on Tile** (the one-click pre-filled change order already exists): Tile agreed 10,500, paid 10,500, left 0;
  agreement 28,500; contract left 3,000 (28,500 - 25,500) = Electrical 3,000. ✔

(One extra case, for completeness, on a smaller $22,000 contract split Plumbing 10,000 and Tile 12,000: if Plumbing were paid $11,000 and
Tile $5,000, Plumbing would show left -1,000 "paid beyond its share", Tile left 12,000 - 5,000 = 7,000, and the rows would still add to
the contract's left of 6,000 (22,000 - 16,000).)

## 5. Questions to settle with the owner before building (one multiple-choice round)

1. **Payments on a split contract.** Must each payment name a line? *Recommended: yes, with a visible "Not sure yet".* Alternative: allow
   blank and share it across lines in proportion automatically (less typing, but the line figures become estimates).
2. **Change orders on a split contract.** *Recommended: open with a suggested split in the original proportions that the owner confirms.*
   Alternative: always start empty.
3. **Existing payments when an old contract is split.** *Recommended: leave them, offer the one-click "assign in proportion" with a
   preview.* Alternative: assign automatically at the moment of splitting.
4. **Helpers on the split form.** *Recommended: both "split evenly" and "split in proportion to my budget lines' planned amounts".*

## 6. Risks and what would change the recommendation

- If the owner wants line-by-line invoices or approvals soon, separate allocation records become the better home; the migration from
  embedded lists to records is mechanical (one record per list entry) and can be done later, because the list is a plain stored value.
- The signed per-line "left" (a negative number on an overpaid line) is correct but unusual; the form labels it plainly ("paid beyond its
  share"). Worth a look in the owner's review.
- Older copies of the app on other devices are tolerated (3.7) but will not show the split; syncing everything to the new version before
  relying on it is recommended.
- Unverified: none of this was run against real data, and nothing here was tested on two devices. The worked examples were checked by hand
  (every table's rows add to the stated totals), not by running code, because no code exists yet; the P4 tests make them executable.
