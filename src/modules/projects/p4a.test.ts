import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { spendingSnapshot } from '../../lib/spending';
import { dexieMeta, RemoteConflict, SyncEngine, snapshotOf, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import {
  loadProjectChoices, loadProjectSummary, setTxnProject, summariseProject,
  type AllocationEntry, type BudgetLineInfo, type CommitmentInfo, type ProjectSummary,
} from '../../lib/txnProject';
import { buildRef, EMPTY_TAG, impliedLine, splitContract, type TagState } from '../../lib/txnProjectTag';
import type { ProjectRef, Txn } from '../../types';
import {
  activeSplit, asCommitment, committedByLine, splitEvenly, splitProportionally, suggestChangeSplit, validateAllocations, type CommitmentRecord,
} from './commitmentModel';
import {
  createCommitment, createLine, createProject, getCommitment, loadCommitments, removeLine, saveCommitment, setCommitmentStatus, type CommitmentFields,
} from './data';
import { noLineNotes, projectWarnings } from './financialView';
import { blankProject } from './model';

/** Invented data only. */
const $ = (x: number) => Math.round(x * 100);
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-p4a-${n++}`); installTracking(d); return d; };

// ---------- pure helpers: summariseProject on plain records ----------

const PLUMB = 1, ELEC = 2, TILE = 3;
const LINES: BudgetLineInfo[] = [
  { id: PLUMB, projectId: 1, name: 'Plumbing', plannedCents: $(10000) },
  { id: ELEC, projectId: 1, name: 'Electrical', plannedCents: $(8000) },
  { id: TILE, projectId: 1, name: 'Tile', plannedCents: $(12000) },
];
const GC = 100;
const com = (id: number, amountCents: number, over: Partial<CommitmentInfo> = {}): CommitmentInfo =>
  ({ id, projectId: 1, budgetLineId: null, title: `C${id}`, status: 'accepted', amountCents, parentId: null, ...over });
const split = (...e: [number | null, number][]): AllocationEntry[] => e.map(([budgetLineId, amount]) => ({ budgetLineId, amountCents: $(amount) }));
const gcSplit = split([PLUMB, 10000], [ELEC, 8000], [TILE, 12000]);
const GC30 = com(GC, $(30000), { allocations: gcSplit });
let tid = 0;
/** A payment (positive `amount`) or money back (negative `amount`) tagged to a contract and optionally a line. */
const pay = (amount: number, ref: Partial<ProjectRef> = {}): Txn =>
  ({ id: ++tid, accountId: 1, date: '2026-11-03', amountCents: -$(amount), payee: 'GC', memo: '', status: 'cleared', categoryId: null, project: { projectId: 1, commitmentId: GC, ...ref } }) as Txn;
const sum = (a: { commitments: CommitmentInfo[]; txns?: Txn[]; lines?: BudgetLineInfo[] }) =>
  summariseProject({ project: { budgetCents: $(100000) }, lines: a.lines ?? LINES, commitments: a.commitments, txns: a.txns ?? [] });
const row = (s: ProjectSummary, id: number | null) => s.lines.find((l) => l.lineId === id);
const fig = (s: ProjectSummary, id: number | null) => { const r = row(s, id); return r ? [r.agreedCents, r.paidCents, r.leftToPayCents].map((c) => c / 100) : undefined; };
/** The reconciliation invariant: the rows add up to the project figures in every column. */
function expectRowsAddUp(s: ProjectSummary) {
  expect(s.lines.reduce((t, l) => t + l.agreedCents, 0)).toBe(s.agreedCents);
  expect(s.lines.reduce((t, l) => t + l.paidCents, 0)).toBe(s.paidCents);
  expect(s.lines.reduce((t, l) => t + l.leftToPayCents, 0)).toBe(s.leftToPayCents);
  expect(s.lines.reduce((t, l) => t + l.expectedCents, 0)).toBe(s.expectedTotalCents);
}

describe('P4A: one agreement across several lines (the design document worked examples, to the cent)', () => {
  it('example 1: uneven split, a payment on each line', () => {
    const s = sum({ commitments: [GC30], txns: [pay(6000, { budgetLineId: PLUMB }), pay(4000, { budgetLineId: ELEC }), pay(3000, { budgetLineId: TILE })] });
    expect(fig(s, PLUMB)).toEqual([10000, 6000, 4000]);
    expect(fig(s, ELEC)).toEqual([8000, 4000, 4000]);
    expect(fig(s, TILE)).toEqual([12000, 3000, 9000]);
    expect([s.agreedCents, s.paidCents, s.leftToPayCents].map((c) => c / 100)).toEqual([30000, 13000, 17000]);
    expect(row(s, null)).toBeUndefined(); // nothing left over, so no reconciling row
    expectRowsAddUp(s);
  });

  it('example 2: a positive then a negative change order, each with its own split', () => {
    const up = com(101, $(2500), { parentId: GC, allocations: split([TILE, 2500]) });
    const down = com(102, -$(1000), { parentId: GC, allocations: split([PLUMB, -1000]) });
    const txns = [pay(6000, { budgetLineId: PLUMB }), pay(4000, { budgetLineId: ELEC }), pay(8000, { budgetLineId: TILE })];
    let s = sum({ commitments: [GC30, up], txns });
    expect(fig(s, TILE)).toEqual([14500, 8000, 6500]);
    expect([s.agreedCents, s.paidCents, s.leftToPayCents].map((c) => c / 100)).toEqual([32500, 18000, 14500]);
    expectRowsAddUp(s);
    s = sum({ commitments: [GC30, up, down], txns });
    expect(fig(s, PLUMB)).toEqual([9000, 6000, 3000]);
    expect(s.leftToPayCents).toBe($(13500));
    expect(row(s, PLUMB)!.leftToPayCents + row(s, ELEC)!.leftToPayCents + row(s, TILE)!.leftToPayCents).toBe($(13500));
    expect(row(s, null)).toBeUndefined();
    expectRowsAddUp(s);
  });

  it('example 2b: a change order accepted without a split sits under "No budget line" and is flagged', () => {
    const bare = com(101, $(2500), { parentId: GC });
    const s = sum({ commitments: [GC30, bare], txns: [pay(18000, { budgetLineId: TILE })] });
    expect(fig(s, null)).toEqual([2500, 0, 2500]);
    expect(s.flags.unsplitChanges).toEqual([101]);
    expect(s.agreedCents).toBe($(32500)); // the totals are right regardless
    expectRowsAddUp(s);
    expect(projectWarnings(s, [], {}).some((w) => w.kind === 'changeNotSplit')).toBe(true);
  });

  it('example 3a: a reversal puts the contract back in debt on the line that was undone', () => {
    const s = sum({
      commitments: [com(GC, $(30000), { allocations: gcSplit })],
      txns: [pay(10000, { budgetLineId: PLUMB }), pay(12000, { budgetLineId: TILE }), pay(5000, { budgetLineId: ELEC }), pay(-5000, { budgetLineId: PLUMB, effect: 'reversal' })],
    });
    expect(fig(s, PLUMB)).toEqual([10000, 5000, 5000]);
    expect(fig(s, ELEC)).toEqual([8000, 5000, 3000]);
    expect(s.contracts[0]).toMatchObject({ paidCents: $(22000), leftCents: $(8000) });
    expect(s.leftToPayCents).toBe($(8000));
    expectRowsAddUp(s);
  });

  it('example 3b: a vendor credit, then the matching negative change order', () => {
    const base = [pay(10000, { budgetLineId: PLUMB }), pay(12000, { budgetLineId: TILE }), pay(5000, { budgetLineId: ELEC })];
    let s = sum({ commitments: [GC30], txns: [...base, pay(-1500, { budgetLineId: TILE, effect: 'credit' })] });
    expect(fig(s, TILE)).toEqual([12000, 10500, 1500]);
    expect(s.leftToPayCents).toBe($(4500));
    expect(s.flags.creditsNotReflected).toEqual([GC]); // the existing P2 warning still appears
    expectRowsAddUp(s);
    const co = com(101, -$(1500), { parentId: GC, allocations: split([TILE, -1500]) });
    s = sum({ commitments: [GC30, co], txns: [...base, pay(-1500, { budgetLineId: TILE, effect: 'credit' })] });
    expect(fig(s, TILE)).toEqual([10500, 10500, 0]);
    expect(s.agreedCents).toBe($(28500));
    expect(s.leftToPayCents).toBe($(3000));
    expect(s.flags.creditsNotReflected).toEqual([]);
    expectRowsAddUp(s);
  });

  it('example 4: a line paid beyond its share shows a negative "left"; the rows still add to the contract', () => {
    const c = com(GC, $(22000), { allocations: split([PLUMB, 10000], [TILE, 12000]) });
    const s = sum({ commitments: [c], txns: [pay(11000, { budgetLineId: PLUMB }), pay(5000, { budgetLineId: TILE })] });
    expect(fig(s, PLUMB)).toEqual([10000, 11000, -1000]);
    expect(fig(s, TILE)).toEqual([12000, 5000, 7000]);
    expect(s.leftToPayCents).toBe($(6000));
    expectRowsAddUp(s);
  });

  it('a contract paid beyond its agreed amount overall: the project stops "left" at zero and the reconciling row absorbs the difference', () => {
    const c = com(GC, $(22000), { allocations: split([PLUMB, 10000], [TILE, 12000]) });
    const s = sum({ commitments: [c], txns: [pay(12000, { budgetLineId: PLUMB }), pay(12000, { budgetLineId: TILE })] });
    expect(s.leftToPayCents).toBe(0);
    expect(s.flags.overpaid).toEqual([GC]);
    expect(row(s, PLUMB)!.leftToPayCents).toBe(-$(2000));
    expect(row(s, null)!.leftToPayCents).toBe($(2000));
    expectRowsAddUp(s);
  });
});

describe('P4A: payments are one payment on the contract, however many lines they cover', () => {
  it('a payment split over three lines counts once toward the contract and once in the project', () => {
    const t = { ...pay(9000), project: undefined, splits: [
      { categoryId: null, amountCents: -$(5000), project: { projectId: 1, commitmentId: GC, budgetLineId: PLUMB } },
      { categoryId: null, amountCents: -$(3000), project: { projectId: 1, commitmentId: GC, budgetLineId: ELEC } },
      { categoryId: null, amountCents: -$(1000), project: { projectId: 1, commitmentId: GC, budgetLineId: TILE } },
    ] } as unknown as Txn;
    const s = sum({ commitments: [GC30], txns: [t] });
    expect(s.paidCents).toBe($(9000));
    expect(s.contracts[0].paidCents).toBe($(9000));
    expect(s.paidByCommitment[GC]).toBe($(9000));
    expect([PLUMB, ELEC, TILE].map((id) => row(s, id)!.paidCents)).toEqual([$(5000), $(3000), $(1000)]);
    expectRowsAddUp(s);
  });

  it('a payment with no line on a split contract is NOT put on the contract\'s home line; it is unassigned', () => {
    const c = com(GC, $(30000), { budgetLineId: PLUMB, allocations: gcSplit });
    const s = sum({ commitments: [c], txns: [pay(2000), pay(1000, { budgetLineId: ELEC })] });
    expect(row(s, PLUMB)!.paidCents).toBe(0);
    expect(row(s, null)!.paidCents).toBe($(2000));
    expect(s.flags.unassignedPieces).toBe(1);
    expect(s.contracts[0].split).toMatchObject({ unassignedPaidCents: $(2000), unassignedPieces: 1 });
    expect(s.paidCents).toBe($(3000));
    expectRowsAddUp(s);
    expect(projectWarnings(s, [], {}).some((w) => w.kind === 'splitUnassigned')).toBe(true);
  });

  it('an accepted change order creates no payment and moves no cash', () => {
    const base = sum({ commitments: [GC30], txns: [pay(1000, { budgetLineId: TILE })] });
    const co = sum({ commitments: [GC30, com(101, $(2500), { parentId: GC, allocations: split([TILE, 2500]) })], txns: [pay(1000, { budgetLineId: TILE })] });
    expect(co.paidCents).toBe(base.paidCents);
    expect(co.agreedCents - base.agreedCents).toBe($(2500));
  });
});

describe('P4A: older data and bad data read exactly as before', () => {
  const home = com(GC, $(30000), { budgetLineId: TILE });
  it('a contract without a split behaves as in P2: agreed and left on the home line, a lineless payment follows the contract', () => {
    const s = sum({ commitments: [home], txns: [pay(10000)] });
    expect(fig(s, TILE)).toEqual([30000, 10000, 20000]);
    expect(row(s, null)).toBeUndefined();
    expect(s.contracts[0].split).toBeUndefined();
    expect(s.flags).toMatchObject({ badSplits: [], unsplitChanges: [], danglingSplitLines: [], unassignedPieces: 0 });
    expectRowsAddUp(s);
  });

  it('no payments, partly paid and fully paid unsplit contracts keep their figures', () => {
    expect(sum({ commitments: [home] }).leftToPayCents).toBe($(30000));
    expect(sum({ commitments: [home], txns: [pay(12000)] }).leftToPayCents).toBe($(18000));
    const full = sum({ commitments: [home], txns: [pay(30000)] });
    expect([full.leftToPayCents, full.paidCents]).toEqual([0, $(30000)]);
    expect(full.contracts[0].overpaidCents).toBe(0);
  });

  it('an unsplit overpaid contract is unchanged (left stays zero on its line)', () => {
    const s = sum({ commitments: [home], txns: [pay(31000)] });
    expect(fig(s, TILE)).toEqual([30000, 31000, 0]);
    expect(s.flags.overpaid).toEqual([GC]);
    expectRowsAddUp(s);
  });

  it('declined, cancelled and quoted split contracts count for nothing, but their payments stay in the totals', () => {
    for (const status of ['declined', 'cancelled', 'quoted'] as const) {
      const s = sum({ commitments: [com(GC, $(30000), { status, allocations: gcSplit })], txns: [pay(1000, { budgetLineId: PLUMB })] });
      expect([s.agreedCents, s.leftToPayCents, s.paidCents]).toEqual([0, 0, $(1000)]);
      expect(row(s, PLUMB)!.agreedCents).toBe(0);
      expectRowsAddUp(s);
    }
  });

  it('a declined or cancelled change order contributes nothing to any line', () => {
    for (const status of ['declined', 'cancelled', 'quoted'] as const) {
      const s = sum({ commitments: [GC30, com(101, $(2500), { parentId: GC, status, allocations: split([TILE, 2500]) })] });
      expect(fig(s, TILE)).toEqual([12000, 0, 12000]);
      expect(s.agreedCents).toBe($(30000));
    }
  });

  it('a split that does not add up is ignored as a whole and flagged; the totals are untouched', () => {
    const stale = com(GC, $(31000), { budgetLineId: TILE, allocations: gcSplit }); // amount edited by an older app; list kept
    const s = sum({ commitments: [stale], txns: [pay(1000, { budgetLineId: PLUMB })] });
    expect(s.flags.badSplits).toEqual([GC]);
    expect(s.contracts[0].split).toBeUndefined();
    expect(fig(s, TILE)).toEqual([31000, 0, 30000]); // read as the home line, like P2
    expect(s.agreedCents).toBe($(31000));
    expectRowsAddUp(s);
    expect(projectWarnings(s, [], {}).some((w) => w.kind === 'splitBroken')).toBe(true);
    // the list comes back the moment the amount is changed back
    expect(sum({ commitments: [com(GC, $(30000), { allocations: gcSplit })] }).contracts[0].split).toBeDefined();
  });

  it('a split pointing at a line that no longer exists falls under "No budget line" and is flagged', () => {
    const c = com(GC, $(30000), { allocations: split([PLUMB, 10000], [99, 20000]) });
    const s = sum({ commitments: [c] });
    expect(fig(s, PLUMB)).toEqual([10000, 0, 10000]);
    expect(fig(s, null)).toEqual([20000, 0, 20000]);
    expect(s.flags.danglingSplitLines).toEqual([GC]);
    expectRowsAddUp(s);
  });

  it('transactions with no project tag and tags on other contracts never reach the split', () => {
    const plain = { ...pay(500), project: undefined } as Txn;
    const s = sum({ commitments: [GC30], txns: [plain] });
    expect(s.paidCents).toBe(0);
    expectRowsAddUp(s);
  });

  it('malformed stored lists are ignored by the reader', () => {
    for (const bad of ['garbage', [], [{ budgetLineId: 'x', amountCents: 5 }], [{ budgetLineId: 1, amountCents: 1.5 }], [null]]) {
      const info = { id: 1, module: 'projects', kind: 'commitment', data: { projectId: 1, title: 'X', status: 'accepted', amountCents: 100, allocations: bad } };
      expect(asCommitment(info as never).data.allocations).toBeUndefined();
    }
  });
});

describe('P4A: property test, rows always add up to the project totals', () => {
  const rng = (seed: number) => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };
  const partition = (total: number, parts: number, r: () => number): number[] => {
    const w = Array.from({ length: parts }, () => 1 + Math.floor(r() * 9));
    return splitProportionally(total, w);
  };

  it('holds for random projects, and the leftover row is empty in the ordinary case', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const r = rng(seed);
      const commitments: CommitmentInfo[] = [];
      const txns: Txn[] = [];
      let id = 10;
      const committed = new Map<number, Map<number, number>>();
      for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
        const total = 100 * (1000 + Math.floor(r() * 9000));
        const nLines = 1 + Math.floor(r() * 3);
        const lineIds = [PLUMB, ELEC, TILE].slice(0, nLines);
        const amounts = partition(total, nLines, r);
        const root = ++id;
        commitments.push(com(root, total, { allocations: lineIds.map((l, i) => ({ budgetLineId: l, amountCents: amounts[i] })) }));
        const m = new Map<number, number>(lineIds.map((l, i) => [l, amounts[i]]));
        committed.set(root, m);
        for (let c = 0; c < Math.floor(r() * 3); c++) { // change orders, never taking a line below zero
          const line = lineIds[Math.floor(r() * nLines)];
          const delta = (r() < 0.5 ? 1 : -1) * 100 * (1 + Math.floor(r() * 500));
          if ((m.get(line) ?? 0) + delta < 0) continue;
          m.set(line, (m.get(line) ?? 0) + delta);
          commitments.push(com(++id, delta, { parentId: root, allocations: [{ budgetLineId: line, amountCents: delta }] }));
        }
        for (const [line, cap] of m) { // payments never beyond a line's share, always naming the line
          let left = cap;
          while (left > 0 && r() < 0.8) {
            const part = Math.min(left, 100 * (1 + Math.floor(r() * 3000)));
            txns.push({ ...pay(part / 100, { budgetLineId: line }), project: { projectId: 1, commitmentId: root, budgetLineId: line } } as Txn);
            left -= part;
          }
        }
      }
      const s = sum({ commitments, txns });
      expectRowsAddUp(s);
      expect(row(s, null), `seed ${seed}`).toBeUndefined();
      expect(s.lines.every((l) => l.leftToPayCents >= 0), `seed ${seed}`).toBe(true);
    }
  });

  it('holds when the data is messy: unsplit change orders, lineless payments, overpayment, reversals, credits, gone lines', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const r = rng(seed * 7919);
      const commitments: CommitmentInfo[] = [];
      const txns: Txn[] = [];
      let id = 10;
      for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
        const total = 100 * (500 + Math.floor(r() * 5000));
        const root = ++id;
        const mode = Math.floor(r() * 4);
        const base = com(root, total, { status: r() < 0.8 ? 'accepted' : (['quoted', 'cancelled', 'declined'] as const)[Math.floor(r() * 3)], budgetLineId: r() < 0.5 ? TILE : null });
        if (mode > 0) { const amounts = partition(total, 2, r); base.allocations = [{ budgetLineId: PLUMB, amountCents: amounts[0] }, { budgetLineId: mode === 3 ? 99 : ELEC, amountCents: amounts[1] }]; }
        if (mode === 2 && r() < 0.5) base.allocations = [{ budgetLineId: PLUMB, amountCents: total - 100 }]; // does not add up
        commitments.push(base);
        for (let c = 0; c < Math.floor(r() * 3); c++) {
          const delta = (r() < 0.5 ? 1 : -1) * 100 * (1 + Math.floor(r() * 400));
          commitments.push(com(++id, delta, { parentId: root, status: r() < 0.7 ? 'accepted' : 'quoted', allocations: r() < 0.5 ? [{ budgetLineId: TILE, amountCents: delta }] : undefined }));
        }
        for (let t = 0; t < Math.floor(r() * 5); t++) {
          const amt = 100 * (1 + Math.floor(r() * 4000));
          const lineChoice = [undefined, PLUMB, ELEC, TILE, 99][Math.floor(r() * 5)];
          const kind = r();
          const ref: Partial<ProjectRef> = { commitmentId: root, ...(lineChoice !== undefined ? { budgetLineId: lineChoice } : {}) };
          if (kind < 0.7) txns.push(pay(amt / 100, ref));
          else txns.push(pay(-amt / 100, { ...ref, effect: kind < 0.85 ? 'reversal' : 'credit' }));
        }
      }
      expectRowsAddUp(sum({ commitments, txns }));
    }
  });
});

describe('P4A final verification: the "No budget line" row says why it is not empty', () => {
  const GC50 = com(GC, $(50000), { allocations: split([PLUMB, 20000], [ELEC, 15000], [TILE, 15000]) });
  const cut = com(101, -$(5000), { parentId: GC, allocations: split([TILE, -5000]) });

  it('the $50,000 / negative change order / mixed payments scenario reconciles and counts nothing twice', () => {
    const t = { ...pay(9000), project: undefined, splits: [5000, 3000, 1000].map((a, i) => ({ categoryId: null, amountCents: -$(a), project: { projectId: 1, commitmentId: GC, budgetLineId: [PLUMB, ELEC, TILE][i] } })) } as unknown as Txn;
    const txns = [pay(6000, { budgetLineId: PLUMB }), pay(4000, { budgetLineId: ELEC }), pay(3000, { budgetLineId: TILE }), pay(7000, { budgetLineId: TILE }), t, pay(2000)];
    const s = sum({ commitments: [GC50, cut], txns });
    expect([s.agreedCents, s.paidCents, s.leftToPayCents].map((c) => c / 100)).toEqual([45000, 31000, 14000]);
    expect(fig(s, PLUMB)).toEqual([20000, 11000, 9000]);
    expect(fig(s, ELEC)).toEqual([15000, 7000, 8000]);
    expect(fig(s, TILE)).toEqual([10000, 11000, -1000]); // paid beyond its share
    expect(fig(s, null)).toEqual([0, 2000, -2000]); // the unassigned payment, balanced
    expectRowsAddUp(s);
    const t0 = sum({ commitments: [GC50], txns }).paidCents;
    expect(sum({ commitments: [GC50, cut], txns }).paidCents).toBe(t0); // the change order created no payment
    expect(noLineNotes(s)).toHaveLength(1);
    expect(noLineNotes(s)[0]).toMatch(/\$2,000\.00 was paid in 1 payment.*without choosing a line/);
  });

  it('separates each cause: unsplit change order, removed line, stale split, overpaid agreement, plain unfiled', () => {
    const unsplit = sum({ commitments: [GC50, com(101, $(500), { parentId: GC })] });
    expect(noLineNotes(unsplit).join(' ')).toMatch(/change order is on a split agreement without a split/);
    expect(noLineNotes(unsplit).join(' ')).not.toMatch(/was paid in/);
    const gone = sum({ commitments: [com(GC, $(30000), { allocations: split([PLUMB, 10000], [99, 20000]) })] });
    expect(noLineNotes(gone).join(' ')).toMatch(/no longer exists/);
    const stale = sum({ commitments: [com(GC, $(31000), { allocations: gcSplit })] });
    expect(noLineNotes(stale).join(' ')).toMatch(/no longer adds up/);
    const over = sum({ commitments: [com(GC, $(22000), { allocations: split([PLUMB, 10000], [TILE, 12000]) })], txns: [pay(12000, { budgetLineId: PLUMB }), pay(12000, { budgetLineId: TILE })] });
    expect(noLineNotes(over).join(' ')).toMatch(/more than its agreed total/);
    const plain = sum({ commitments: [com(GC, $(1000))] });
    expect(noLineNotes(plain).join(' ')).toMatch(/not filed under any budget line/);
    expect(noLineNotes(sum({ commitments: [GC30] }))).toEqual([]); // nothing in the row, nothing said
  });
});

describe('P4A: helpers for splitting', () => {
  it('splits evenly in whole cents, any odd cent to the first part, deterministically', () => {
    expect(splitEvenly(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEvenly(10000, 3).reduce((a, b) => a + b, 0)).toBe(10000);
    expect(splitEvenly(-10000, 3).reduce((a, b) => a + b, 0)).toBe(-10000);
    expect(splitEvenly(5, 0)).toEqual([]);
  });
  it('splits in proportion without losing a cent, and falls back to even when all weights are zero', () => {
    expect(splitProportionally(10001, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10001);
    expect(splitProportionally(3000, [10000, 8000, 12000])).toEqual([1000, 800, 1200]);
    expect(splitProportionally(1000, [0, 0])).toEqual([500, 500]);
    expect(splitProportionally(-1000, [1, 3])).toEqual([-250, -750]);
  });
});

// ---------- with a database ----------

async function setup() {
  const d = fresh();
  const p = await createProject(blankProject({ name: 'Kitchen', budgetCents: $(60000), status: 'active' }), d);
  const other = await createProject(blankProject({ name: 'Deck' }), d);
  const plumb = await createLine(p, 'Plumbing', $(10000), d);
  const elec = await createLine(p, 'Electrical', $(8000), d);
  const tile = await createLine(p, 'Tile', $(12000), d);
  const otherLine = await createLine(other, 'Boards', $(500), d);
  const a = (await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
  const add = (amount: number, over: Partial<Txn> = {}) => d.txns.add({ accountId: a, date: '2026-11-03', amountCents: $(amount), payee: 'GC', memo: '', status: 'cleared', categoryId: null, ...over }) as Promise<number>;
  const summary = async () => (await loadProjectSummary(d, p))!;
  const fields = (over: Partial<CommitmentFields> = {}): CommitmentFields => ({
    title: 'General contractor', amountCents: $(30000), status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: '2026-11-02', notes: '', ...over,
  });
  const entries = (...e: [number | null, number][]): AllocationEntry[] => e.map(([budgetLineId, amount]) => ({ budgetLineId, amountCents: $(amount) }));
  return { d, p, other, plumb, elec, tile, otherLine, a, add, summary, fields, entries };
}
const raw = (d: FinanceDB, id: number) => d.moduleRecords.get(id) as Promise<{ data: Record<string, unknown> }>;

describe('P4A: saving a split', () => {
  it('stores one agreement with its split, and Finance reads it with the P4A figures', async () => {
    const { d, p, plumb, elec, tile, add, summary, fields, entries } = await setup();
    const { id } = await createCommitment(p, fields({ allocations: entries([plumb, 10000], [elec, 8000], [tile, 12000]) }), d);
    expect(await loadCommitments(p, d)).toHaveLength(1); // one record, one identifier
    expect(activeSplit((await getCommitment(id, d))!)).toHaveLength(3);
    const t = await add(-6000);
    await setTxnProject(d, t, { projectId: p, commitmentId: id, budgetLineId: plumb });
    const s = await summary();
    expect(s.lines.find((l) => l.lineId === plumb)).toMatchObject({ agreedCents: $(10000), paidCents: $(6000), leftToPayCents: $(4000) });
    expect(s.contracts[0]).toMatchObject({ agreedCents: $(30000), paidCents: $(6000), leftCents: $(24000) });
  });

  it('refuses a split that does not add up, saying how much is left to allocate', async () => {
    const { d, p, plumb, elec, fields, entries } = await setup();
    await expect(createCommitment(p, fields({ allocations: entries([plumb, 10000], [elec, 8000]) }), d)).rejects.toThrow(/Left to allocate: \$12,000\.00/);
    await expect(createCommitment(p, fields({ allocations: entries([plumb, 20000], [elec, 11000]) }), d)).rejects.toThrow(/\$1,000\.00 more/);
    expect(await loadCommitments(p, d)).toHaveLength(0);
  });

  it('refuses a duplicate line, a zero part, a line of another project, a negative part on an agreement and an empty list', async () => {
    const { d, p, plumb, elec, otherLine, fields, entries } = await setup();
    const tryIt = (a: AllocationEntry[]) => createCommitment(p, fields({ allocations: a }), d);
    await expect(tryIt(entries([plumb, 15000], [plumb, 15000]))).rejects.toThrow(/appears twice/);
    await expect(tryIt(entries([plumb, 30000], [elec, 0]))).rejects.toThrow(/is zero/);
    await expect(tryIt(entries([otherLine, 30000]))).rejects.toThrow(/not part of this project/);
    await expect(tryIt(entries([plumb, 40000], [elec, -10000]))).rejects.toThrow(/cannot be negative/);
    await expect(tryIt([])).rejects.toThrow(/at least one part/); // "no split" is `allocations: null`, never an empty list
  });

  it('keeps the explicit "no line yet" remainder and counts it under No budget line', async () => {
    const { d, p, plumb, summary, fields, entries } = await setup();
    await createCommitment(p, fields({ allocations: entries([plumb, 25000], [null, 5000]) }), d);
    const s = await summary();
    expect(s.lines.find((l) => l.lineId === null)).toMatchObject({ agreedCents: $(5000), leftToPayCents: $(5000) });
    expect(s.lines.reduce((t, l) => t + l.agreedCents, 0)).toBe(s.agreedCents);
  });

  it('a change order has its own split; a negative one cannot take a line below zero', async () => {
    const { d, p, plumb, elec, tile, fields, entries, summary } = await setup();
    const { id } = await createCommitment(p, fields({ allocations: entries([plumb, 10000], [elec, 8000], [tile, 12000]) }), d);
    await createCommitment(p, fields({ title: 'Extra tile', amountCents: $(2500), parentId: id, allocations: entries([tile, 2500]) }), d);
    await expect(createCommitment(p, fields({ title: 'Too much off', amountCents: -$(11000), parentId: id, allocations: entries([plumb, -11000]) }), d)).rejects.toThrow(/less than zero/);
    // mixed entries are fine as long as they add up
    await createCommitment(p, fields({ title: 'Swap', amountCents: -$(1000), parentId: id, allocations: entries([tile, 500], [plumb, -1500]) }), d);
    const s = await summary();
    expect(s.lines.find((l) => l.lineId === tile)!.agreedCents).toBe($(12000 + 2500 + 500));
    expect(s.lines.find((l) => l.lineId === plumb)!.agreedCents).toBe($(10000 - 1500));
    expect(s.agreedCents).toBe($(30000 + 2500 - 1000));
    expect(s.lines.reduce((t, l) => t + l.agreedCents, 0)).toBe(s.agreedCents);
  });

  it('suggests a change order split in the agreement\'s proportions that always adds up', async () => {
    const { d, p, plumb, elec, tile, fields, entries } = await setup();
    const { id } = await createCommitment(p, fields({ allocations: entries([plumb, 10000], [elec, 8000], [tile, 12000]) }), d);
    const root = (await getCommitment(id, d))!;
    const sug = suggestChangeSplit(root, -$(1000))!;
    expect(sug.reduce((t, e) => t + e.amountCents, 0)).toBe(-$(1000));
    expect(sug.map((e) => e.amountCents)).toEqual([-33334, -26666, -40000]); // the odd cent goes to the first part
    expect(suggestChangeSplit({ ...root, data: { ...root.data, allocations: undefined } }, $(5))).toBeUndefined();
  });

  it('editing the amount without re-balancing the split is refused; removing the split goes back to the home line without losing it', async () => {
    const { d, p, plumb, elec, tile, fields, entries, summary } = await setup();
    const { id } = await createCommitment(p, fields({ budgetLineId: tile, allocations: entries([plumb, 10000], [elec, 8000], [tile, 12000]) }), d);
    await expect(saveCommitment(id, fields({ amountCents: $(31000), budgetLineId: tile, allocations: entries([plumb, 10000], [elec, 8000], [tile, 12000]) }), d)).rejects.toThrow(/Left to allocate/);
    await saveCommitment(id, fields({ budgetLineId: tile, allocations: null }), d);
    const rec = (await raw(d, id)).data;
    expect('allocations' in rec).toBe(false);
    expect(rec.budgetLineId).toBe(tile);
    expect((await summary()).lines.find((l) => l.lineId === tile)).toMatchObject({ agreedCents: $(30000) });
  });

  it('allocations stay editable after payments exist; payments are never rewritten', async () => {
    const { d, p, plumb, elec, tile, add, fields, entries, summary } = await setup();
    const { id } = await createCommitment(p, fields({ allocations: entries([plumb, 10000], [elec, 8000], [tile, 12000]) }), d);
    const t = await add(-11000);
    await setTxnProject(d, t, { projectId: p, commitmentId: id, budgetLineId: plumb });
    const before = await d.txns.get(t);
    await saveCommitment(id, fields({ allocations: entries([plumb, 9000], [elec, 8000], [tile, 13000]) }), d);
    expect(await d.txns.get(t)).toEqual(before);
    const s = await summary();
    expect(s.lines.find((l) => l.lineId === plumb)).toMatchObject({ agreedCents: $(9000), paidCents: $(11000), leftToPayCents: -$(2000) }); // paid beyond its share
    expect(s.contracts[0].leftCents).toBe($(19000));
  });

  it('accepting a quote or change order re-checks that no line goes below zero', async () => {
    const { d, p, plumb, elec, fields, entries } = await setup();
    const { id } = await createCommitment(p, fields({ amountCents: $(5000), allocations: entries([plumb, 3000], [elec, 2000]) }), d);
    const co = await createCommitment(p, fields({ title: 'Cut', amountCents: -$(2500), status: 'quoted', parentId: id, allocations: entries([plumb, -2500]) }), d);
    const co2 = await createCommitment(p, fields({ title: 'Cut more', amountCents: -$(1000), parentId: id, allocations: entries([plumb, -1000]) }), d);
    await expect(setCommitmentStatus(co.id, 'accepted', d)).rejects.toThrow(/less than zero/);
    expect(co2.id).toBeGreaterThan(0);
  });

  it('cancelling a split agreement keeps what was paid visible and counts nothing more', async () => {
    const { d, p, plumb, elec, tile, add, fields, entries, summary } = await setup();
    const { id } = await createCommitment(p, fields({ allocations: entries([plumb, 10000], [elec, 8000], [tile, 12000]) }), d);
    const t = await add(-4000);
    await setTxnProject(d, t, { projectId: p, commitmentId: id, budgetLineId: elec });
    await setCommitmentStatus(id, 'cancelled', d);
    const s = await summary();
    expect([s.agreedCents, s.leftToPayCents, s.paidCents]).toEqual([0, 0, $(4000)]);
    expect(s.flags.paidOnInactive).toEqual([id]);
    expect(s.lines.reduce((x, l) => x + l.paidCents, 0)).toBe(s.paidCents);
    await setCommitmentStatus(id, 'accepted', d); // reinstated: the split is still there
    expect((await summary()).contracts[0].split).toBeDefined();
  });

  it('a line used by a split cannot be removed', async () => {
    const { d, p, plumb, elec, tile, fields, entries } = await setup();
    await createCommitment(p, fields({ allocations: entries([plumb, 10000], [elec, 8000], [tile, 12000]) }), d);
    await expect(removeLine(elec, d)).rejects.toThrow(/cannot be removed/);
  });
});

describe('P4A: unknown fields and stored shapes', () => {
  it('saving keeps fields this code does not know, and the split when it is not touched', async () => {
    const { d, p, plumb, tile, fields, entries } = await setup();
    const { id } = await createCommitment(p, fields({ allocations: entries([plumb, 10000], [tile, 20000]) }), d);
    await d.moduleRecords.update(id, { data: { ...(await raw(d, id)).data, futureThing: { a: 1 } } } as never);
    await saveCommitment(id, fields({ title: 'Renamed' }), d); // allocations undefined = leave as stored
    const data = (await raw(d, id)).data;
    expect(data.futureThing).toEqual({ a: 1 });
    expect(data.allocations).toHaveLength(2);
    expect(data.title).toBe('Renamed');
    await saveCommitment(id, fields({ allocations: null }), d);
    expect((await raw(d, id)).data.futureThing).toEqual({ a: 1 });
  });

  it('a commitment from before P4 has no allocations key and stays byte-for-byte as it was when only its status changes', async () => {
    const { d, p, fields } = await setup();
    const { id } = await createCommitment(p, fields({ status: 'quoted', acceptedDate: null }), d);
    expect('allocations' in (await raw(d, id)).data).toBe(false);
    await setCommitmentStatus(id, 'accepted', d);
    expect('allocations' in (await raw(d, id)).data).toBe(false);
  });

  it('a stored list that no longer adds up (an older app edited the amount) is flagged, and the figures fall back to the home line', async () => {
    const { d, p, plumb, tile, fields, entries, summary } = await setup();
    const { id } = await createCommitment(p, fields({ budgetLineId: tile, allocations: entries([plumb, 10000], [tile, 20000]) }), d);
    await d.moduleRecords.update(id, { data: { ...(await raw(d, id)).data, amountCents: $(31000) } } as never);
    const s = await summary();
    expect(s.flags.badSplits).toEqual([id]);
    expect(s.lines.find((l) => l.lineId === tile)!.agreedCents).toBe($(31000));
    expect(s.agreedCents).toBe($(31000));
  });
});

describe('P4A: tagging a payment on a split agreement', () => {
  const tag = (over: Partial<TagState>): TagState => ({ ...EMPTY_TAG, ...over });

  it('the line is required, "Not sure yet" is allowed and stores nothing extra, and the contract\'s home line no longer stands in', async () => {
    const { d, p, plumb, tile, fields, entries } = await setup();
    const { id } = await createCommitment(p, fields({ budgetLineId: tile, allocations: entries([plumb, 10000], [tile, 20000]) }), d);
    const choices = await loadProjectChoices(d);
    const proj = choices.find((c) => c.id === p)!;
    expect(proj.contracts[0].split).toBe(true);
    expect(splitContract(proj, String(id))).toBe(true);
    expect(impliedLine(proj, String(id))).toBeUndefined();
    const base = { projectId: String(p), commitmentId: String(id) };
    expect(buildRef(tag(base), choices, false).error).toMatch(/Which line is this payment for/);
    expect(buildRef(tag({ ...base, lineUnsure: true }), choices, false).ref).toEqual({ projectId: p, commitmentId: id });
    expect(buildRef(tag({ ...base, lineId: String(tile) }), choices, false).ref).toEqual({ projectId: p, commitmentId: id, budgetLineId: tile }); // stored even for the home line
  });

  it('an unsplit contract is untouched: its line is implied and nothing is asked', async () => {
    const { d, p, tile, fields } = await setup();
    const { id } = await createCommitment(p, fields({ budgetLineId: tile }), d);
    const choices = await loadProjectChoices(d);
    const proj = choices.find((c) => c.id === p)!;
    expect('split' in proj.contracts[0]).toBe(false);
    expect(buildRef(tag({ projectId: String(p), commitmentId: String(id) }), choices, false).ref).toEqual({ projectId: p, commitmentId: id });
    expect(impliedLine(proj, String(id))?.id).toBe(tile);
  });
});

describe('P4A: outside Projects nothing changes, and the data travels', () => {
  it('splitting changes no transaction amount, balance or report', async () => {
    const { d, p, plumb, tile, a, add, fields, entries } = await setup();
    const cats = [{ id: 7, groupId: 1, name: 'Home', kind: 'expense' as const }];
    const t1 = await add(-1234, { categoryId: 7 });
    const sumFor = async () => (await d.txns.where('accountId').equals(a).toArray()).reduce((s, t) => s + t.amountCents, 0);
    const before = { total: await sumFor(), spend: spendingSnapshot(await d.txns.toArray(), cats, '2026-11'), txns: await d.txns.toArray() };
    const { id } = await createCommitment(p, fields({ allocations: entries([plumb, 10000], [tile, 20000]) }), d);
    await setTxnProject(d, t1, { projectId: p, commitmentId: id, budgetLineId: plumb });
    await saveCommitment(id, fields({ allocations: entries([plumb, 5000], [tile, 25000]) }), d);
    const after = { total: await sumFor(), spend: spendingSnapshot(await d.txns.toArray(), cats, '2026-11') };
    expect(after.total).toBe(before.total);
    expect(after.spend).toEqual(before.spend);
    expect((await d.txns.get(t1))!.amountCents).toBe($(-1234));
  });

  it('export, restore and the sync snapshot carry the split exactly', async () => {
    const { d, p, plumb, tile, fields, entries } = await setup();
    const { id } = await createCommitment(p, fields({ allocations: entries([plumb, 10000], [tile, 20000]) }), d);
    const co = await createCommitment(p, fields({ title: 'Extra', amountCents: $(100), parentId: id, allocations: entries([tile, 100]) }), d);
    const file = checkBackupText(JSON.stringify(await exportAll(d))).file;
    const target = fresh();
    await target.open();
    await importAll(target, file);
    const back = await loadCommitments(p, target);
    expect(back.map((c) => c.data.allocations)).toEqual([entries([plumb, 10000], [tile, 20000]), entries([tile, 100])]);
    expect(await loadProjectSummary(target, p)).toEqual(await loadProjectSummary(d, p));
    const snap = await snapshotOf(d);
    expect((snap.tables.moduleRecords[String(id)] as { data?: { allocations?: unknown } } | undefined)).toBeDefined();
    expect(JSON.stringify(snap.tables.moduleRecords[String(co.id)])).toContain('allocations');
  });

  it('two devices: a split made on one arrives whole on the other, and each device\'s edit of a different agreement survives', async () => {
    const remote = (() => {
      const r = {
        puts: 0, file: null as RemoteFile | null,
        async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
        async putFile(bytes: Uint8Array, sha: string | undefined) {
          if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
          r.puts++;
          r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
          return r.file.sha;
        },
      };
      return r satisfies RemoteStore;
    })();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`p4a-meta-${n++}`), remote, 'a good passphrase') }; };
    const A = mk(), B = mk();
    const p = await createProject(blankProject({ name: 'Kitchen' }), A.d);
    const l1 = await createLine(p, 'Plumbing', 0, A.d), l2 = await createLine(p, 'Tile', 0, A.d);
    const base = (over: Partial<CommitmentFields>): CommitmentFields => ({ title: 'GC', amountCents: $(300), status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: '2026-11-02', notes: '', ...over });
    const c1 = await createCommitment(p, base({ title: 'First' }), A.d);
    const c2 = await createCommitment(p, base({ title: 'Second' }), A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await saveCommitment(c1.id, base({ title: 'First', allocations: [{ budgetLineId: l1, amountCents: $(100) }, { budgetLineId: l2, amountCents: $(200) }] }), A.d);
    await saveCommitment(c2.id, base({ title: 'Second', notes: 'edited on B' }), B.d);
    await A.engine.sync();
    await B.engine.sync();
    await A.engine.sync();
    for (const x of [A, B]) {
      const list = await loadCommitments(p, x.d);
      expect(list.map((c) => [c.data.title, c.data.notes, activeSplit(c)?.map((e) => e.amountCents)])).toEqual([['First', '', [$(100), $(200)]], ['Second', 'edited on B', undefined]]);
    }
  });
});

describe('P4A: model helpers', () => {
  it('committedByLine adds the agreement and its accepted change orders only', async () => {
    const { d, p, plumb, tile, fields, entries } = await setup();
    const { id } = await createCommitment(p, fields({ allocations: entries([plumb, 10000], [tile, 20000]) }), d);
    await createCommitment(p, fields({ title: 'A', amountCents: $(500), parentId: id, allocations: entries([tile, 500]) }), d);
    await createCommitment(p, fields({ title: 'B', amountCents: $(900), parentId: id, status: 'quoted', allocations: entries([plumb, 900]) }), d);
    await createCommitment(p, fields({ title: 'C', amountCents: $(70), parentId: id }), d);
    const all = await loadCommitments(p, d);
    const m = committedByLine(all.find((c) => c.id === id) as CommitmentRecord, all);
    expect([m.get(plumb), m.get(tile), m.get(null)]).toEqual([$(10000), $(20500), $(70)]);
  });

  it('validateAllocations explains each problem in plain words', () => {
    const ctx = { lineIds: [1, 2], all: [] as CommitmentRecord[], parentId: null, status: 'accepted' as const };
    expect(validateAllocations([], 100, ctx)).toMatch(/at least one part/);
    expect(validateAllocations([{ budgetLineId: 1, amountCents: 60 }], 100, ctx)).toMatch(/Left to allocate: \$0\.40/);
    expect(validateAllocations([{ budgetLineId: 1, amountCents: 60 }, { budgetLineId: 2, amountCents: 40 }], 100, ctx)).toBeNull();
  });
});
