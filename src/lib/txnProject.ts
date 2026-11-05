import type { FinanceDB } from '../db';
import type { ProjectRef, Split, Txn } from '../types';
import { formatCents } from './money';
import { isSetupTxn } from './setupCategory';
import { updateTxn } from './transfers';

/**
 * Project spending, seen from the ledger. A transaction (or one split of it) can point at a project, optionally at one of its budget
 * lines and at a commitment. Nothing here creates a transaction or stores an amount a transaction already holds: the project's
 * "paid" figure is always worked out from the transactions, so nothing can be counted twice. Transfers are never project spending.
 *
 * Definitions (cents; spending shown as a positive number, ledger outflows are negative):
 *  - Paid        = minus the sum of the project's transaction pieces. A refund is a positive piece and lowers it.
 *  - Agreed      = accepted commitments, change orders included (a change order may be negative).
 *  - Left to pay = per contract: max(0, agreed - paid on it). Money coming back is one of two kinds:
 *      reversal = undoes a payment: what was paid on the contract falls and the contract is owed again (the agreed amount is unchanged);
 *      credit   = cash back for a price reduction: what was paid falls too, and the agreed amount must fall by the same through a negative
 *                 change order, otherwise the contract looks owed again (flagged as `creditsNotReflected`).
 *  - Expected    = Paid + Left to pay.   Left in budget = budget - Expected.
 */

export const PROJECTS_MODULE = 'projects';

// ---- pieces of transactions ----

export interface ProjectPiece extends ProjectRef {
  amountCents: number;
  txnId?: number;
  date?: string;
}

/** The parts of a transaction that belong to a project. A split's own reference wins over the transaction's. Transfers give nothing. */
export function projectAllocations(t: Txn): ProjectPiece[] {
  if (t.transferTxnId || isSetupTxn(t)) return [];
  const base = (ref: ProjectRef | undefined, amountCents: number): ProjectPiece[] => (ref ? [{ ...ref, amountCents, txnId: t.id, date: t.date }] : []);
  if (!t.splits?.length) return base(t.project, t.amountCents);
  return t.splits.flatMap((s) => base(s.project ?? t.project, s.amountCents));
}

// ---- project records (read defensively; the Projects module owns writing them) ----

export interface ProjectInfo {
  id: number;
  name: string;
  budgetCents: number | null;
}
export interface BudgetLineInfo {
  id: number;
  projectId: number;
  name: string;
  plannedCents: number;
}
export type CommitmentStatus = 'quoted' | 'accepted' | 'declined' | 'cancelled';
export interface CommitmentInfo {
  id: number;
  projectId: number;
  budgetLineId: number | null;
  title: string;
  status: CommitmentStatus;
  amountCents: number;
  /** A change order points at the commitment it changes. */
  parentId: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const STATUSES: CommitmentStatus[] = ['quoted', 'accepted', 'declined', 'cancelled'];

interface Row { id?: number; module: string; kind: string; data: Record<string, unknown>; deletedAt?: number | null }
const live = (r: Row) => r.module === PROJECTS_MODULE && r.deletedAt == null;

export const asProject = (r: Row): ProjectInfo => ({ id: r.id as number, name: typeof r.data.name === 'string' ? r.data.name : 'Project', budgetCents: num(r.data.budgetCents) });
export const asBudgetLine = (r: Row): BudgetLineInfo => ({ id: r.id as number, projectId: num(r.data.projectId) ?? -1, name: typeof r.data.name === 'string' ? r.data.name : 'Line', plannedCents: num(r.data.plannedCents) ?? 0 });
export const asCommitment = (r: Row): CommitmentInfo => ({
  id: r.id as number,
  projectId: num(r.data.projectId) ?? -1,
  budgetLineId: num(r.data.budgetLineId),
  title: typeof r.data.title === 'string' ? r.data.title : 'Commitment',
  status: STATUSES.includes(r.data.status as CommitmentStatus) ? (r.data.status as CommitmentStatus) : 'quoted',
  amountCents: num(r.data.amountCents) ?? 0,
  parentId: num(r.data.parentId),
});

// ---- the numbers ----

export interface LineSummary {
  lineId: number | null;
  name: string;
  plannedCents: number;
  agreedCents: number;
  paidCents: number;
  leftToPayCents: number;
  /** Planned minus (paid + left to pay). Negative = over plan. */
  varianceCents: number;
}
export interface ProjectSummary {
  budgetCents: number;
  plannedTotalCents: number;
  /** Budget minus the sum of line plans. Negative = lines add up to more than the budget. */
  notYetPlannedCents: number;
  agreedCents: number;
  paidCents: number;
  leftToPayCents: number;
  expectedTotalCents: number;
  leftInBudgetCents: number;
  cashLeftCents: number;
  /** Quotes waiting. Shown, never counted. */
  quotedCents: number;
  lines: LineSummary[];
  /** For every commitment id: what has been paid net on its whole contract (the original plus its change orders), never below zero. */
  paidByCommitment: Record<number, number>;
  flags: {
    overBudget: boolean;
    linesOverBudget: boolean;
    /** Contracts paid more than agreed (commitment ids of the original contract). */
    overpaid: number[];
    /** Contracts that are cancelled, declined or still only quoted but have money paid on them. */
    paidOnInactive: number[];
    /** Contracts where credit refunds came back but the agreed amount was not lowered by as much (commitment ids of the original contract). */
    creditsNotReflected: number[];
    /** Contracts where reversals and credits add up to more than was ever paid on them (commitment ids of the original contract). */
    reversalsExceedPayments: number[];
    /** Money coming back on a contract with no reversal/credit choice (old or foreign data; new entries are refused). */
    unmarkedRefunds: number;
    /** Pieces dated outside the project's dates (count), when dates are given. */
    outsideDates: number;
  };
}

export function summariseProject(a: {
  project: Pick<ProjectInfo, 'budgetCents'> & { startDate?: string | null; targetDate?: string | null };
  lines: BudgetLineInfo[];
  commitments: CommitmentInfo[];
  txns: Txn[];
}): ProjectSummary {
  const { project, lines, commitments } = a;
  const byId = new Map(commitments.map((c) => [c.id, c]));
  const rootOf = (c: CommitmentInfo): CommitmentInfo => {
    let cur = c;
    for (let i = 0; i < 20 && cur.parentId !== null; i++) {
      const p = byId.get(cur.parentId);
      if (!p) break;
      cur = p;
    }
    return cur;
  };

  let unmarkedRefunds = 0;
  const pieces = a.txns.flatMap(projectAllocations);
  const paidCents = 0 - pieces.reduce((s, p) => s + p.amountCents, 0);

  // Group each contract with its change orders. Outflows paid against any member count toward the group.
  const groups = new Map<number, { root: CommitmentInfo; agreed: number; paidOut: number; reduced: number; credits: number }>();
  for (const c of commitments) {
    const root = rootOf(c);
    const g = groups.get(root.id) ?? { root, agreed: 0, paidOut: 0, reduced: 0, credits: 0 };
    if (root.status === 'accepted' && c.status === 'accepted') {
      g.agreed += c.amountCents;
      if (c.amountCents < 0) g.reduced += -c.amountCents;
    }
    groups.set(root.id, g);
  }
  for (const p of pieces) {
    if (p.commitmentId === undefined) continue;
    const c = byId.get(p.commitmentId);
    if (!c) continue;
    const g = groups.get(rootOf(c).id);
    if (!g) continue;
    if (p.amountCents < 0) g.paidOut += -p.amountCents; // a payment
    else if (p.effect === 'reversal') g.paidOut -= p.amountCents; // a payment undone: the contract is owed again
    else if (p.effect === 'credit') { g.paidOut -= p.amountCents; g.credits += p.amountCents; } // cash back for a price reduction: net paid falls too, and the agreed amount should fall by the same
    else unmarkedRefunds++;
  }

  const lineOf = (c: CommitmentInfo): number | null => c.budgetLineId ?? rootOf(c).budgetLineId;
  const lineAgg = new Map<number | null, { agreed: number; paid: number; left: number }>();
  const agg = (k: number | null) => { const v = lineAgg.get(k) ?? { agreed: 0, paid: 0, left: 0 }; lineAgg.set(k, v); return v; };

  let agreedCents = 0, leftToPayCents = 0, quotedCents = 0;
  const overpaid: number[] = [];
  const creditsNotReflected: number[] = [];
  const reversalsExceedPayments: number[] = [];
  const paidByCommitment: Record<number, number> = {};
  for (const c of commitments) paidByCommitment[c.id] = Math.max(0, groups.get(rootOf(c).id)?.paidOut ?? 0);
  const paidOnInactive: number[] = [];
  for (const c of commitments) {
    if (c.status === 'quoted') quotedCents += c.amountCents;
    if (c.status === 'accepted' && rootOf(c).status === 'accepted') { agreedCents += c.amountCents; agg(lineOf(c)).agreed += c.amountCents; }
  }
  for (const g of groups.values()) {
    if (g.paidOut < 0) reversalsExceedPayments.push(g.root.id);
    if (g.root.status === 'accepted') {
      const paidNet = Math.max(0, g.paidOut);
      const left = Math.max(0, g.agreed - paidNet);
      leftToPayCents += left;
      agg(g.root.budgetLineId).left += left;
      if (paidNet > g.agreed) overpaid.push(g.root.id);
      if (g.credits > g.reduced) creditsNotReflected.push(g.root.id);
    } else if (g.paidOut > 0) paidOnInactive.push(g.root.id);
  }
  for (const p of pieces) {
    const c = p.commitmentId !== undefined ? byId.get(p.commitmentId) : undefined;
    agg(p.budgetLineId ?? (c ? lineOf(c) : null)).paid += -p.amountCents;
  }

  const plannedTotalCents = lines.reduce((s, l) => s + l.plannedCents, 0);
  const budgetCents = project.budgetCents ?? plannedTotalCents;
  const expectedTotalCents = paidCents + leftToPayCents;

  const mk = (lineId: number | null, name: string, plannedCents: number): LineSummary => {
    const v = lineAgg.get(lineId) ?? { agreed: 0, paid: 0, left: 0 };
    return { lineId, name, plannedCents, agreedCents: v.agreed, paidCents: v.paid, leftToPayCents: v.left, varianceCents: plannedCents - (v.paid + v.left) };
  };
  const known = new Set(lines.map((l) => l.id));
  const lineRows = lines.map((l) => mk(l.id, l.name, l.plannedCents));
  // Anything that points at a line that no longer exists, or at none, goes in one row.
  const loose = [...lineAgg.keys()].filter((k) => k === null || !known.has(k));
  if (loose.length) {
    const sum = loose.reduce((s, k) => { const v = lineAgg.get(k)!; return { agreed: s.agreed + v.agreed, paid: s.paid + v.paid, left: s.left + v.left }; }, { agreed: 0, paid: 0, left: 0 });
    lineRows.push({ lineId: null, name: 'No budget line', plannedCents: 0, agreedCents: sum.agreed, paidCents: sum.paid, leftToPayCents: sum.left, varianceCents: 0 - (sum.paid + sum.left) });
  }

  const { startDate, targetDate } = project;
  const outsideDates = startDate || targetDate ? pieces.filter((p) => p.date && ((startDate && p.date < startDate) || (targetDate && p.date > targetDate))).length : 0;

  return {
    budgetCents, plannedTotalCents, notYetPlannedCents: budgetCents - plannedTotalCents,
    agreedCents, paidCents, leftToPayCents, expectedTotalCents,
    leftInBudgetCents: budgetCents - expectedTotalCents, cashLeftCents: budgetCents - paidCents, quotedCents,
    lines: lineRows,
    paidByCommitment,
    flags: { overBudget: expectedTotalCents > budgetCents, linesOverBudget: plannedTotalCents > budgetCents, overpaid, paidOnInactive, creditsNotReflected, reversalsExceedPayments, unmarkedRefunds, outsideDates },
  };
}

/** Reads the project's records and its tagged transactions, and works out the summary. Returns null if the project does not exist. */
export async function loadProjectSummary(d: FinanceDB, projectId: number, opts: { excludeTxnId?: number } = {}): Promise<ProjectSummary | null> {
  const rows = (await d.moduleRecords.where('module').equals(PROJECTS_MODULE).toArray()).filter(live) as Row[];
  const p = rows.find((r) => r.kind === 'project' && r.id === projectId);
  if (!p) return null;
  const mine = (r: Row) => num(r.data.projectId) === projectId;
  const txns = await d.txns.filter((t) => t.id !== opts.excludeTxnId && (t.project?.projectId === projectId || (t.splits ?? []).some((s) => s.project?.projectId === projectId))).toArray();
  // A split that points at another project must not count here.
  const forThis = txns.map((t) => ({ ...t, project: t.project?.projectId === projectId ? t.project : undefined, splits: t.splits?.map((s) => (s.project && s.project.projectId !== projectId ? { ...s, project: undefined, amountCents: 0 } : s)) }));
  return summariseProject({
    project: { ...asProject(p), startDate: typeof p.data.startDate === 'string' ? p.data.startDate : null, targetDate: typeof p.data.targetDate === 'string' ? p.data.targetDate : null },
    lines: rows.filter((r) => r.kind === 'budgetLine' && mine(r)).map(asBudgetLine),
    commitments: rows.filter((r) => r.kind === 'commitment' && mine(r)).map(asCommitment),
    txns: forThis,
  });
}

// ---- tagging ----

export interface ProjectRefChange { ref: ProjectRef | null; /** Tag one split instead of the whole transaction. */ splitIndex?: number }

/** Throws a plain-words error if the project, line or commitment does not exist or does not belong together. */
export async function checkProjectRef(d: FinanceDB, ref: ProjectRef) {
  const rows = (id: number) => d.moduleRecords.get(id);
  const project = await rows(ref.projectId);
  if (!project || project.module !== PROJECTS_MODULE || project.kind !== 'project' || project.deletedAt != null) throw new Error('That project does not exist.');
  if (ref.budgetLineId !== undefined) {
    const l = await rows(ref.budgetLineId);
    if (!l || l.module !== PROJECTS_MODULE || l.kind !== 'budgetLine' || l.deletedAt != null || num(l.data.projectId) !== ref.projectId) throw new Error('That budget line is not part of this project.');
  }
  if (ref.commitmentId !== undefined) {
    const c = await rows(ref.commitmentId);
    if (!c || c.module !== PROJECTS_MODULE || c.kind !== 'commitment' || c.deletedAt != null || num(c.data.projectId) !== ref.projectId) throw new Error('That commitment is not part of this project.');
  }
}

/**
 * Money coming back (a positive amount) tagged to a contract must say whether it is a reversal or a credit; the choice means nothing on a
 * payment or without a contract. `amounts` are the amounts the reference will apply to.
 */
export function checkRefEffect(ref: ProjectRef, amounts: number[]): void {
  const anyIn = amounts.some((a) => a > 0);
  if (ref.effect && (ref.commitmentId === undefined || amounts.some((a) => a < 0))) throw new Error('Reversal or credit only applies to money coming back on a contract.');
  if (ref.commitmentId !== undefined && anyIn && !ref.effect) throw new Error('Money coming back on a contract must be marked as a reversal (a payment undone) or a credit (a price reduction).');
}

/**
 * Money coming back on a contract cannot be more than what was paid on it (reversals and credits included). `amounts` are the pieces the
 * reference will apply to; `excludeTxnId` is the transaction being changed, so its current tag is not counted twice.
 */
export async function checkRefundAmount(d: FinanceDB, ref: ProjectRef, amounts: number[], excludeTxnId?: number): Promise<void> {
  if (!ref.effect || ref.commitmentId === undefined) return;
  const back = amounts.filter((a) => a > 0).reduce((n, a) => n + a, 0);
  if (back === 0) return;
  const paid = (await loadProjectSummary(d, ref.projectId, { excludeTxnId }))?.paidByCommitment[ref.commitmentId] ?? 0;
  if (back > paid) throw new Error(`That is more than the ${formatCents(paid)} paid on this contract so far, so it cannot be money coming back.`);
}

/** Only keep the fields that are set, so a reference never stores `undefined` keys. */
const clean = (r: ProjectRef): ProjectRef => ({ projectId: r.projectId, ...(r.budgetLineId !== undefined ? { budgetLineId: r.budgetLineId } : {}), ...(r.commitmentId !== undefined ? { commitmentId: r.commitmentId } : {}), ...(r.effect ? { effect: r.effect } : {}) });

/** Points a transaction (or one of its splits) at a project, or clears it with `null`. Transfers and "Initial setup" entries are refused. */
export async function setTxnProject(d: FinanceDB, txnId: number, ref: ProjectRef | null, opts: { splitIndex?: number } = {}): Promise<void> {
  await d.transaction('rw', d.txns, d.moduleRecords, async () => {
    const t = await d.txns.get(txnId);
    if (!t) throw new Error('Transaction not found');
    if (ref) {
      if (t.transferTxnId) throw new Error('A transfer moves money between your accounts; it is not project spending.');
      if (isSetupTxn(t)) throw new Error('Initial setup entries are not project spending.');
      await checkProjectRef(d, ref);
      const amounts = opts.splitIndex !== undefined ? [t.splits?.[opts.splitIndex]?.amountCents ?? t.amountCents] : amountsFor(t);
      checkRefEffect(ref, amounts);
      await checkRefundAmount(d, ref, amounts, t.id);
    }
    if (opts.splitIndex !== undefined) {
      const splits = t.splits?.map((s) => ({ ...s }));
      if (!splits || !splits[opts.splitIndex]) throw new Error('That split does not exist.');
      if (ref) splits[opts.splitIndex].project = clean(ref); else delete splits[opts.splitIndex].project;
      await updateTxn(d, txnId, { splits });
      return;
    }
    await updateTxn(d, txnId, { project: ref ? clean(ref) : undefined });
  });
}

/** The amounts a transaction-level reference would apply to: the whole amount, or the splits that have no reference of their own. */
const amountsFor = (t: Txn): number[] => (t.splits?.length ? t.splits.filter((s) => !s.project).map((s) => s.amountCents) : [t.amountCents]);

export interface BulkProjectResult { updated: number; skippedTransfers: number; /** Money coming back that needs a reversal/credit choice first (not changed). */ needsChoice?: number; /** Money coming back that is more than was paid on the contract (not changed). */ exceedsPayments?: number }

/** Sets (or clears) the project on many transactions at once. Transfers are skipped and counted. */
export async function bulkSetTxnProject(d: FinanceDB, ids: number[], ref: ProjectRef | null): Promise<BulkProjectResult> {
  const res: BulkProjectResult = { updated: 0, skippedTransfers: 0 };
  await d.transaction('rw', d.txns, d.moduleRecords, async () => {
    if (ref) await checkProjectRef(d, ref);
    for (const id of ids) {
      const t = await d.txns.get(id);
      if (!t) continue;
      if (ref && (t.transferTxnId || isSetupTxn(t))) { res.skippedTransfers++; continue; }
      if (ref) {
        try { checkRefEffect(ref, amountsFor(t)); } catch { res.needsChoice = (res.needsChoice ?? 0) + 1; continue; }
        try { await checkRefundAmount(d, ref, amountsFor(t), t.id); } catch { res.exceedsPayments = (res.exceedsPayments ?? 0) + 1; continue; }
      }
      await updateTxn(d, id, { project: ref ? clean(ref) : undefined });
      res.updated++;
    }
  });
  return res;
}

export type { ProjectRef, Split };
