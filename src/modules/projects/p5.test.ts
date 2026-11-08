import { scrubGeneratedIds } from '../../lib/leakTestkit';
import { describe, expect, it } from 'vitest';
import {
  categoryCsv, projectCsvName, projectFromParam, reportProjectLink, resolveReportProject, spendingMatrix,
  type Matrix,
} from '../../lib/reports';
import { projectOnlyTxns, summariseProject, type AllocationEntry, type BudgetLineInfo, type CommitmentInfo, type ProjectSummary } from '../../lib/txnProject';
import type { ProjectRef, Txn } from '../../types';
import { agreementCostBar, buildCostBar, projectCostBar, type CostRow } from './financialView';

/** Invented data only. Money in whole cents. */
const $ = (x: number) => Math.round(x * 100);
const lines = (n: number): BudgetLineInfo[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, projectId: 1, name: `Line ${i + 1}`, plannedCents: $(1000) }));
const L3 = lines(3);
const com = (id: number, amountCents: number, over: Partial<CommitmentInfo> = {}): CommitmentInfo =>
  ({ id, projectId: 1, budgetLineId: null, title: `C${id}`, status: 'accepted', amountCents, parentId: null, ...over });
const split = (...e: [number | null, number][]): AllocationEntry[] => e.map(([budgetLineId, amount]) => ({ budgetLineId, amountCents: $(amount) }));
let tid = 0;
const pay = (amount: number, ref: Partial<ProjectRef> = {}, over: Partial<Txn> = {}): Txn =>
  ({ id: ++tid, accountId: 1, date: '2026-11-03', amountCents: -$(amount), payee: 'GC', memo: '', status: 'cleared', categoryId: null, project: { projectId: 1, commitmentId: 100, ...ref }, ...over }) as Txn;
const sum = (commitments: CommitmentInfo[], txns: Txn[] = [], ls: BudgetLineInfo[] = L3): ProjectSummary =>
  summariseProject({ project: { budgetCents: $(100000) }, lines: ls, commitments, txns });
const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const GC50 = com(100, $(50000), { allocations: split([1, 20000], [2, 15000], [3, 15000]) });

describe('P5: the project cost bar adds up to the dashboard', () => {
  it('normal multi-line agreement: parts add up to the expected total, shares to 100%', () => {
    const s = sum([GC50], [pay(6000, { budgetLineId: 1 }), pay(4000, { budgetLineId: 2 })]);
    const m = projectCostBar(s);
    expect(m.state).toBe('ok');
    expect(m.totalCents).toBe(s.expectedTotalCents);
    expect(m.reconciles).toBe(true);
    expect(m.drawnCents).toBe($(50000));
    expect(m.drawn.map((d) => [d.name, d.cents])).toEqual([['Line 1', $(20000)], ['Line 2', $(15000)], ['Line 3', $(15000)]]);
    expect(total(m.drawn.map((d) => d.pct))).toBeCloseTo(100, 9);
    expect(m.drawn.map((d) => d.slot)).toEqual([0, 1, 2]);
  });

  it('a single-line (unsplit) agreement gives one segment, and its agreement gets no bar of its own', () => {
    const c = com(100, $(10000), { budgetLineId: 2 });
    const s = sum([c], [pay(2000)]);
    const m = projectCostBar(s);
    expect(m.drawn.map((d) => d.name)).toEqual(['Line 2']);
    expect(m.reconciles).toBe(true);
    expect(agreementCostBar(s.contracts[0], (id) => `Line ${id}`).state).toBe('empty');
  });

  it('an agreement bar shows the current split by agreed amount, change orders included', () => {
    const co = com(101, -$(5000), { parentId: 100, allocations: split([3, -5000]) });
    const s = sum([GC50, co], [pay(1000, { budgetLineId: 3 })]);
    const m = agreementCostBar(s.contracts[0], (id) => `Line ${id}`);
    expect(m.totalCents).toBe($(45000));
    expect(m.drawn.map((d) => [d.name, d.cents])).toEqual([['Line 1', $(20000)], ['Line 2', $(15000)], ['Line 3', $(10000)]]);
    expect(m.reconciles).toBe(true);
    expect(m.drawn.find((d) => d.name === 'Line 3')!.paidCents).toBe($(1000));
  });

  it('partially paid: paid and left are exact for every row and add to the segment', () => {
    const s = sum([GC50], [pay(6000, { budgetLineId: 1 }), pay(4000, { budgetLineId: 2 })]);
    const m = projectCostBar(s);
    for (const r of m.legend) expect(r.paidCents + r.leftCents).toBe(r.cents);
    expect(m.legend.map((r) => [r.paidCents, r.leftCents])).toEqual([[$(6000), $(14000)], [$(4000), $(11000)], [0, $(15000)]]);
  });
});

describe('P5: overpayment, offsets and awkward totals are never hidden', () => {
  it('a line paid beyond its share keeps its exact negative left, is flagged in words, and nothing is clamped', () => {
    const s = sum([GC50], [pay(25000, { budgetLineId: 1 })]);
    const m = projectCostBar(s);
    const row = m.legend.find((r) => r.name === 'Line 1')!;
    expect(row.paidCents).toBe($(25000));
    expect(row.leftCents).toBe(-$(5000)); // exact, signed
    expect(row.cents).toBe($(20000)); // its expected cost is paid + left, unchanged by the chart
    expect(m.notes.join(' ')).toMatch(/paid beyond its share/);
    expect(m.reconciles).toBe(true); // the extra is balanced by the other lines, total unchanged
    expect(m.totalCents).toBe(s.expectedTotalCents);
  });

  it('zero expected cost: no bar, an explanation, and the exact rows still listed', () => {
    const s = sum([], [], L3);
    expect(s.expectedTotalCents).toBe(0);
    const m = projectCostBar(s);
    expect(m.state).toBe('zero');
    expect(m.drawn).toEqual([]);
    expect(m.notes[0]).toMatch(/nothing to show as parts of a whole/);
    expect(m.legend).toHaveLength(3);
  });

  it('no lines at all is an empty state, not a bar', () => {
    expect(projectCostBar(sum([], [], [])).state).toBe('empty');
  });

  it('negative expected cost (money back exceeds spending): no bar, says so, exact figure kept', () => {
    // The Finance engine keeps a project's total at or above zero for real data (a contract's paid figure stops at zero), so this
    // awkward case is built from rows directly: the model must still behave honestly if a total ever is negative.
    const rows: CostRow[] = [{ key: '1', name: 'A', kind: 'line', cents: -$(200), paidCents: -$(200), leftCents: 0 }, { key: '2', name: 'B', kind: 'line', cents: $(50), paidCents: $(50), leftCents: 0 }];
    const m = buildCostBar(rows, -$(150));
    expect(m.state).toBe('negative');
    expect(m.drawn).toEqual([]);
    expect(m.notes[0]).toContain('−$150.00');
    expect(m.legend.map((r) => r.cents)).toEqual([-$(200), $(50)]);
  });

  it('positive segments offset by a negative line: exact legend, honest note, and it does not claim to reconcile', () => {
    const rows: CostRow[] = [
      { key: '1', name: 'A', kind: 'line', cents: $(1000), paidCents: $(1000), leftCents: 0 },
      { key: '2', name: 'B', kind: 'line', cents: $(500), paidCents: $(500), leftCents: 0 },
      { key: '3', name: 'C', kind: 'line', cents: -$(300), paidCents: -$(300), leftCents: 0 },
    ];
    const m = buildCostBar(rows, $(1200));
    expect(m.state).toBe('ok');
    expect(m.reconciles).toBe(false);
    expect(m.drawnCents).toBe($(1500));
    expect(m.undrawn.map((r) => [r.name, r.cents])).toEqual([['C', -$(300)]]);
    expect(m.notes[0]).toMatch(/add up to \$1,500\.00, not to the expected total of \$1,200\.00, because C \(−\$300\.00\) offsets part of it/);
    expect(total(m.drawn.map((d) => d.pct))).toBeCloseTo(100, 9); // shares are of the parts drawn, and the note says so
    expect(m.legend.map((r) => r.name)).toEqual(['A', 'B', 'C']); // the negative row is still listed, exactly
    expect(total(m.legend.map((r) => r.cents))).toBe(m.totalCents); // the legend, not the bar, reconciles
  });
});

describe('P5: "No budget line" and unassigned payments', () => {
  it('a balancing-only "No budget line" (paid with no line) is left out of the bar and explained; the bar still reconciles', () => {
    const co = com(101, -$(5000), { parentId: 100, allocations: split([3, -5000]) });
    const s = sum([GC50, co], [pay(6000, { budgetLineId: 1 }), pay(2000)]);
    const m = projectCostBar(s);
    const none = s.lines.find((l) => l.lineId === null)!;
    expect([none.expectedCents, none.paidCents, none.leftToPayCents]).toEqual([0, $(2000), -$(2000)]);
    expect(m.drawn.some((d) => d.slot === 'none')).toBe(false);
    expect(m.undrawn.map((r) => r.name)).toEqual(['No budget line']);
    expect(m.notes.join(' ')).toMatch(/"No budget line" is not drawn: it only balances other figures \(paid \$2,000\.00, left to pay −\$2,000\.00\)/);
    expect(m.reconciles).toBe(true);
    // its negative "left" only balances the lines; it is never described as a line paid beyond its share
    expect(m.notes.join(' ')).not.toMatch(/paid beyond its share/);
    expect(m.legend.find((r) => r.name === 'No budget line')!.note).toMatch(/was paid in 1 payment.*without choosing a line/);
  });

  it('money genuinely filed under no line is drawn as its own neutral segment, with the reason in the legend', () => {
    const bare = com(101, $(2500), { parentId: 100 }); // a change order with no split
    const s = sum([GC50, bare]);
    const m = projectCostBar(s);
    const seg = m.drawn.find((d) => d.slot === 'none')!;
    expect(seg.name).toBe('No budget line');
    expect(seg.cents).toBe($(2500));
    expect(m.reconciles).toBe(true);
    expect(m.legend.find((r) => r.kind === 'none')!.note).toMatch(/change order.*without a split/);
  });

  it('an agreement with a payment whose line was not chosen lists it apart from the lines, not as a cost', () => {
    const s = sum([GC50], [pay(2000), pay(500, { budgetLineId: 1 })]);
    const m = agreementCostBar(s.contracts[0], (id) => `Line ${id}`);
    const un = m.legend.find((r) => r.name === 'Paid, line not chosen')!;
    expect(un.cents).toBe(0);
    expect(un.paidCents).toBe($(2000));
    expect(m.drawn.some((d) => d.name === 'Paid, line not chosen')).toBe(false);
    expect(un.note).toMatch(/without choosing a line/);
  });

  it('a removed line and a stale split still reconcile with the dashboard figures', () => {
    const gone = com(100, $(30000), { allocations: split([1, 10000], [99, 20000]) });
    const m = projectCostBar(sum([gone]));
    expect(m.reconciles).toBe(true);
    expect(m.drawn.find((d) => d.kind === 'none')!.cents).toBe($(20000));
    const stale = com(100, $(31000), { allocations: split([1, 10000], [2, 20000]) });
    const m2 = projectCostBar(sum([stale]));
    expect(m2.reconciles).toBe(true);
    expect(m2.totalCents).toBe($(31000));
  });
});

describe('P5: more than seven lines', () => {
  const ten = lines(10);
  const amounts = [900, 800, 700, 600, 500, 400, 300, 200, 150, 100]; // line 1 is the largest
  const c = com(100, $(total(amounts)), { allocations: amounts.map((a, i) => ({ budgetLineId: i + 1, amountCents: $(a) })) });
  const s = sum([c], [pay(100, { budgetLineId: 9 }), pay(50, { budgetLineId: 10 })], ten);

  it('keeps the seven largest apart and groups the rest, and the group reconciles to the summary', () => {
    const m = projectCostBar(s);
    expect(m.drawn).toHaveLength(8);
    const other = m.drawn.find((d) => d.kind === 'other')!;
    expect(other.name).toBe('Other lines (3)');
    expect(other.slot).toBe(7);
    expect(other.cents).toBe($(200 + 150 + 100));
    expect(other.paidCents).toBe($(150));
    expect(other.members!.map((r) => r.name)).toEqual(['Line 8', 'Line 9', 'Line 10']);
    expect(m.drawnCents).toBe(s.expectedTotalCents);
    expect(m.reconciles).toBe(true);
    expect(new Set(m.drawn.map((d) => d.slot)).size).toBe(8); // eight different colours, none repeated
  });

  it('the legend lists the group with every member\'s exact figures, so nothing is hidden', () => {
    const m = projectCostBar(s);
    const g = m.legend.find((r) => r.kind === 'other')!;
    expect(g.members!.map((r) => r.cents)).toEqual([$(200), $(150), $(100)]);
    expect(total(m.legend.filter((r) => r.kind !== 'other').map((r) => r.cents)) + g.cents).toBe(s.expectedTotalCents);
  });

  it('up to seven lines are never grouped, and a line keeps its colour when amounts change', () => {
    const seven = lines(7);
    const a = projectCostBar(sum([com(100, $(700), { allocations: seven.map((l) => ({ budgetLineId: l.id, amountCents: $(100) })) })], [], seven));
    expect(a.drawn.some((d) => d.kind === 'other')).toBe(false);
    const b = projectCostBar(sum([com(100, $(2300), { allocations: seven.map((l, i) => ({ budgetLineId: l.id, amountCents: $(i === 0 ? 1700 : 100) })) })], [], seven));
    expect(b.drawn.map((d) => d.slot)).toEqual(a.drawn.map((d) => d.slot));
  });
});

describe('P5: the legend always reconciles to the existing summary (property check)', () => {
  const rng = (seed: number) => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };
  it('for messy random projects the exact legend rows add up to the dashboard figures, and a drawn bar never claims more than it can', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 104729);
      const ls = lines(1 + Math.floor(r() * 9));
      const commitments: CommitmentInfo[] = [];
      const txns: Txn[] = [];
      let id = 100;
      for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
        const root = ++id;
        const amount = 100 * (500 + Math.floor(r() * 5000));
        const mode = Math.floor(r() * 3);
        const base = com(root, amount, { status: r() < 0.85 ? 'accepted' : 'quoted', budgetLineId: r() < 0.5 ? ls[0].id : null });
        if (mode > 0 && ls.length > 1) { const first = Math.floor(amount / 200) * 100; base.allocations = [{ budgetLineId: ls[0].id, amountCents: first }, { budgetLineId: ls[1].id, amountCents: amount - first }]; }
        commitments.push(base);
        if (r() < 0.5) commitments.push(com(++id, (r() < 0.5 ? 1 : -1) * 100 * (1 + Math.floor(r() * 300)), { parentId: root }));
        for (let t = 0; t < Math.floor(r() * 4); t++) {
          const amt = 100 * (1 + Math.floor(r() * 3000));
          const ref: Partial<ProjectRef> = { commitmentId: root, ...(r() < 0.7 ? { budgetLineId: ls[Math.floor(r() * ls.length)].id } : {}) };
          txns.push(r() < 0.8 ? pay(amt / 100, ref) : pay(0, { ...ref, effect: 'reversal' }, { amountCents: amt }));
        }
      }
      const s = sum(commitments, txns, ls);
      const m = projectCostBar(s);
      if (m.state === 'empty') continue;
      expect(total(m.legend.flatMap((row) => (row.kind === 'other' ? row.members! : [row])).map((row) => row.cents)), `seed ${seed}`).toBe(s.expectedTotalCents);
      expect(total(s.lines.map((l) => l.paidCents)), `seed ${seed}`).toBe(s.paidCents);
      if (m.state === 'ok') {
        expect(m.drawn.every((d) => d.cents > 0)).toBe(true);
        expect(m.reconciles).toBe(m.drawnCents === s.expectedTotalCents);
        if (!m.reconciles) expect(m.notes.join(' ')).toMatch(/not to the expected total/);
      } else expect(m.drawn).toEqual([]);
    }
  });
});

// ---------- Reports: project-aware CSV and the deep link ----------

describe('P5: project CSV', () => {
  const months = ['2026-09', '2026-10', '2026-11'];
  const cats = [{ id: 1, groupId: 1, name: 'Materials', kind: 'expense' as const }, { id: 2, groupId: 1, name: 'Paycheck', kind: 'income' as const }];
  const txn = (id: number, date: string, amount: number, over: Partial<Txn> = {}): Txn => ({ id, accountId: 1, date, amountCents: $(amount), payee: 'Shop', memo: '', status: 'cleared', categoryId: 1, ...over });
  const fixed: Matrix = { months, cats: [{ name: 'Materials', byMonth: [0, $(100), $(40)], total: $(140) }], spent: [0, $(100), $(40)], income: [0, $(2000), 0] };

  it('an unfiltered download is byte-for-byte what it always was', () => {
    expect(categoryCsv(fixed)).toBe(
      'Category,2026-09,2026-10,2026-11,Total\r\nMaterials,0.00,100.00,40.00,140.00\r\nTotal spending,0.00,100.00,40.00,140.00\r\nIncome,0.00,2000.00,0.00,2000.00\r\n',
    );
    expect(categoryCsv(fixed, {})).toBe(categoryCsv(fixed));
    expect(categoryCsv(fixed, { projectView: false })).toBe(categoryCsv(fixed));
  });

  it('a project download has no Income row and is otherwise the same table', () => {
    const csv = categoryCsv(fixed, { projectView: true });
    expect(csv).toBe('Category,2026-09,2026-10,2026-11,Total\r\nMaterials,0.00,100.00,40.00,140.00\r\nTotal spending,0.00,100.00,40.00,140.00\r\n');
    expect(csv).not.toContain('Income');
  });

  it('only the selected project, its split parts once, credits and reversals netted, over the selected months', () => {
    const t: Txn[] = [
      txn(1, '2026-10-02', -100, { project: { projectId: 1 } }),
      txn(2, '2026-10-05', -300, { categoryId: null, splits: [{ categoryId: 1, amountCents: -$(200), project: { projectId: 1 } }, { categoryId: 1, amountCents: -$(100), project: { projectId: 2 } }] }),
      txn(3, '2026-11-01', -50, { project: { projectId: 1 } }),
      txn(4, '2026-11-03', 30, { categoryId: null, project: { projectId: 1, effect: 'credit' } }),
      txn(5, '2026-11-04', -999), // no project
      txn(6, '2026-11-04', -10, { project: { projectId: 2 } }), // another project
      txn(7, '2026-08-01', -77, { project: { projectId: 1 } }), // outside the selected months
    ];
    const m = spendingMatrix(projectOnlyTxns(t, 1), cats, months, { net: true });
    const csv = categoryCsv(m, { projectView: true }).split('\r\n');
    expect(csv).toEqual([
      'Category,2026-09,2026-10,2026-11,Total',
      'Materials,0.00,300.00,50.00,350.00',
      'Uncategorized,0.00,0.00,-30.00,-30.00',
      'Total spending,0.00,300.00,20.00,320.00',
      '',
    ]);
    expect(scrubGeneratedIds(csv.join('\n'))).not.toMatch(/999|77\.00|10\.00,/);
  });
});

describe('P5: safe project file names', () => {
  it('builds a plain, path-safe name including the date range', () => {
    expect(projectCsvName('Kitchen Remodel', '2025-12', '2026-11')).toBe('project-kitchen-remodel-spending-2025-12-to-2026-11.csv');
    expect(projectCsvName('  Café / Deck: 2026! ', '2026-01', '2026-11')).toBe('project-cafe-deck-2026-spending-2026-01-to-2026-11.csv');
  });
  it('strips path tricks, dots and separators', () => {
    const n = projectCsvName('../../etc/passwd', 'a', 'b');
    expect(n).toBe('project-etc-passwd-spending-a-to-b.csv');
    expect(projectCsvName('C:\\Windows\\evil.exe', 'a', 'b')).toMatch(/^project-[a-z0-9-]+-spending-a-to-b\.csv$/);
    expect(projectCsvName('a.b/c\\d', 'a', 'b')).not.toMatch(/[\\/ ]|\.\./);
  });
  it('falls back to "project" for an empty or symbol-only name, and cuts very long names', () => {
    expect(projectCsvName('???', 'a', 'b')).toBe('project-project-spending-a-to-b.csv');
    expect(projectCsvName('', 'a', 'b')).toBe('project-project-spending-a-to-b.csv');
    const long = projectCsvName('x'.repeat(200), 'a', 'b');
    expect(long.length).toBeLessThanOrEqual('project-'.length + 40 + '-spending-a-to-b.csv'.length);
    expect(long).not.toMatch(/--/);
  });
});

describe('P5: Reports deep link', () => {
  it('builds the address the project page links to, and reads it back', () => {
    expect(reportProjectLink(42)).toBe('#/ledger/reports?project=42');
    expect(projectFromParam('42')).toBe(42);
  });
  it('ignores a missing or non-numeric id', () => {
    for (const bad of [null, '', 'abc', '4x', '-3', '1.5', '1e3']) expect(projectFromParam(bad)).toBeUndefined();
  });
  it('selects only a project that still exists; a deleted or unknown one leaves the filter off', () => {
    const existing = [{ id: 1 }, { id: 2 }];
    expect(resolveReportProject(2, existing)).toBe(2);
    expect(resolveReportProject(99, existing)).toBeNull();
    expect(resolveReportProject(undefined, existing)).toBeNull();
    expect(resolveReportProject(1, [])).toBeNull();
  });
});
