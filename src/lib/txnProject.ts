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

/**
 * The transactions as one project sees them, for reports: each transaction at most ONCE, holding only the pieces that belong to the
 * project (a split's own tag wins over the transaction's, exactly as in `projectAllocations`). A transaction with no piece on the project
 * is left out; transfers and setup entries never belong to a project. A split transaction keeps just its matching parts and its amount
 * becomes their total, so summing a report over this list equals the project's "paid", and nothing is counted twice.
 */
export function projectOnlyTxns(txns: Txn[], projectId: number): Txn[] {
  const out: Txn[] = [];
  for (const t of txns) {
    if (t.transferTxnId || isSetupTxn(t)) continue;
    if (!t.splits?.length) { if (t.project?.projectId === projectId) out.push(t); continue; }
    const mine = t.splits.filter((s) => (s.project ?? t.project)?.projectId === projectId);
    if (mine.length === 0) continue;
    out.push({ ...t, splits: mine, amountCents: mine.reduce((n, s) => n + s.amountCents, 0) });
  }
  return out;
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
  /** How this commitment's amount is spread over budget lines, when the owner split it. Absent = filed under its home line (P2 behaviour). */
  allocations?: AllocationEntry[];
}
/** One part of a split commitment. `budgetLineId: null` is the explicit "not decided yet" remainder. Whole cents; a change order's entries may be negative. */
export interface AllocationEntry { budgetLineId: number | null; amountCents: number }

/** Reads a stored split defensively. Anything that is not a non-empty list of whole-cent amounts with a line id or null is ignored as a whole. */
export function readAllocations(raw: unknown): AllocationEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: AllocationEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') return undefined;
    const { budgetLineId, amountCents } = e as Record<string, unknown>;
    if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents)) return undefined;
    if (budgetLineId !== null && budgetLineId !== undefined && !(typeof budgetLineId === 'number' && Number.isFinite(budgetLineId))) return undefined;
    out.push({ budgetLineId: (budgetLineId ?? null) as number | null, amountCents });
  }
  return out;
}
/** True when the parts add up to the whole to the cent. A split that does not is never used. */
export const allocationsAddUp = (list: AllocationEntry[] | undefined, amountCents: number): list is AllocationEntry[] =>
  !!list && list.reduce((s, e) => s + e.amountCents, 0) === amountCents;

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
  ...(readAllocations(r.data.allocations) ? { allocations: readAllocations(r.data.allocations) } : {}),
});

// ---- the numbers ----

export interface LineSummary {
  lineId: number | null;
  name: string;
  plannedCents: number;
  agreedCents: number;
  paidCents: number;
  leftToPayCents: number;
  /** Paid + left to pay. */
  expectedCents: number;
  /** Planned minus (paid + left to pay). Negative = over plan. */
  varianceCents: number;
}
/** One contract (a commitment with its change orders) as the money sees it. */
export interface ContractSummary {
  rootId: number;
  status: CommitmentStatus;
  /** The original agreement's amount, whatever its status. */
  originalCents: number;
  /** Accepted change orders added up (negative = price went down). Zero unless the contract is accepted. */
  changesCents: number;
  /** What is agreed now: original + accepted changes. Zero unless the contract is accepted. */
  agreedCents: number;
  /** Paid net of reversals and credits, never below zero. */
  paidCents: number;
  /** Agreed minus paid, never below zero. Zero unless accepted. */
  leftCents: number;
  /** Paid beyond the agreed amount. */
  overpaidCents: number;
  /** Credits received (price-reduction refunds). */
  creditsCents: number;
  /** Credits received minus the accepted negative change orders. Above zero = the agreed amount has not been lowered enough. */
  creditGapCents: number;
  /** Present only when the agreement is split across budget lines (and the split adds up). */
  split?: ContractSplit;
}
export interface ContractSplitLine {
  /** null = no budget line. */
  lineId: number | null;
  /** The part of the agreed amount (original + accepted changes) on this line. Zero unless the contract is accepted. */
  agreedCents: number;
  /** Paid on this line, net of reversals and credits (not clamped: a line can be paid beyond its share). */
  paidCents: number;
  /** Agreed minus paid on this line. Signed: negative = paid beyond its share. Zero unless accepted. */
  leftCents: number;
}
export interface ContractSplit {
  lines: ContractSplitLine[];
  /** Net paid on this contract by payments that name no line. */
  unassignedPaidCents: number;
  /** How many payment pieces name no line. */
  unassignedPieces: number;
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
  /** One row per original contract (not per change order), in the order the commitments were given. */
  contracts: ContractSummary[];
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
    /** Accepted commitments whose stored split does not add up to their amount (the split is ignored). */
    badSplits: number[];
    /** Accepted change orders on a split agreement that carry no usable split (their amount sits in "No budget line"). */
    unsplitChanges: number[];
    /** Split agreements (original contract ids) with money filed on a budget line that no longer exists. */
    danglingSplitLines: number[];
    /** Payment pieces on a split agreement that name no budget line. */
    unassignedPieces: number;
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
  const groups = new Map<number, { root: CommitmentInfo; agreed: number; changes: number; paidOut: number; reduced: number; credits: number }>();
  for (const c of commitments) {
    const root = rootOf(c);
    const g = groups.get(root.id) ?? { root, agreed: 0, changes: 0, paidOut: 0, reduced: 0, credits: 0 };
    if (root.status === 'accepted' && c.status === 'accepted') {
      g.agreed += c.amountCents;
      if (c.id !== root.id) g.changes += c.amountCents;
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
  // A split agreement: its own list adds up to its amount. Only then are the lists of the agreement and its change orders used.
  const splitRoots = new Set<number>();
  const badSplits: number[] = [];
  for (const c of commitments) {
    if (rootOf(c).id !== c.id || !c.allocations) continue;
    if (allocationsAddUp(c.allocations, c.amountCents)) splitRoots.add(c.id);
    else if (c.status === 'accepted') badSplits.push(c.id);
  }
  const splitAgreed = new Map<number, Map<number | null, number>>(); // root id -> line -> agreed
  const unsplitChanges: number[] = [];
  const bump = (m: Map<number | null, number>, k: number | null, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const c of commitments) {
    if (c.status === 'quoted') quotedCents += c.amountCents;
    if (c.status === 'accepted' && rootOf(c).status === 'accepted') {
      agreedCents += c.amountCents;
      const root = rootOf(c);
      if (splitRoots.has(root.id)) {
        const m = splitAgreed.get(root.id) ?? new Map<number | null, number>();
        splitAgreed.set(root.id, m);
        if (allocationsAddUp(c.allocations, c.amountCents)) for (const e of c.allocations) { bump(m, e.budgetLineId, e.amountCents); agg(e.budgetLineId).agreed += e.amountCents; }
        else {
          bump(m, null, c.amountCents); agg(null).agreed += c.amountCents;
          if (c.id !== root.id) { unsplitChanges.push(c.id); if (c.allocations) badSplits.push(c.id); }
        }
      } else agg(lineOf(c)).agreed += c.amountCents;
    }
  }
  // Net paid per line on each split agreement (a payment that names no line goes under null). One payment of several pieces is several pieces here, one payment on the contract.
  const splitPaid = new Map<number, Map<number | null, number>>();
  let unassignedPieces = 0;
  const unassignedByRoot = new Map<number, { cents: number; pieces: number }>();
  for (const p of pieces) {
    const c = p.commitmentId !== undefined ? byId.get(p.commitmentId) : undefined;
    if (!c) continue;
    const root = rootOf(c);
    if (!splitRoots.has(root.id)) continue;
    const m = splitPaid.get(root.id) ?? new Map<number | null, number>();
    splitPaid.set(root.id, m);
    bump(m, p.budgetLineId ?? null, -p.amountCents);
    if (p.budgetLineId === undefined) {
      unassignedPieces++;
      const u = unassignedByRoot.get(root.id) ?? { cents: 0, pieces: 0 };
      u.cents += -p.amountCents; u.pieces++;
      unassignedByRoot.set(root.id, u);
    }
  }
  const knownLineIds = new Set(lines.map((l) => l.id));
  const danglingSplitLines: number[] = [];
  const contracts: ContractSummary[] = [];
  for (const g of groups.values()) {
    if (g.paidOut < 0) reversalsExceedPayments.push(g.root.id);
    const accepted = g.root.status === 'accepted';
    const paidNet = Math.max(0, g.paidOut);
    const left = accepted ? Math.max(0, g.agreed - paidNet) : 0;
    let split: ContractSplit | undefined;
    if (splitRoots.has(g.root.id)) {
      const ag = accepted ? splitAgreed.get(g.root.id) ?? new Map<number | null, number>() : new Map<number | null, number>();
      const pd = splitPaid.get(g.root.id) ?? new Map<number | null, number>();
      const keys = [...new Set([...ag.keys(), ...pd.keys()])];
      split = {
        lines: keys.map((k) => ({ lineId: k, agreedCents: ag.get(k) ?? 0, paidCents: pd.get(k) ?? 0, leftCents: accepted ? (ag.get(k) ?? 0) - (pd.get(k) ?? 0) : 0 })),
        unassignedPaidCents: unassignedByRoot.get(g.root.id)?.cents ?? 0,
        unassignedPieces: unassignedByRoot.get(g.root.id)?.pieces ?? 0,
      };
      if (accepted) {
        for (const l of split.lines) agg(l.lineId).left += l.leftCents;
        if (split.lines.some((l) => l.lineId !== null && !knownLineIds.has(l.lineId) && (l.agreedCents !== 0 || l.paidCents !== 0))) danglingSplitLines.push(g.root.id);
      }
    }
    contracts.push({
      rootId: g.root.id, status: g.root.status, originalCents: g.root.amountCents,
      changesCents: accepted ? g.changes : 0, agreedCents: accepted ? g.agreed : 0,
      paidCents: paidNet, leftCents: left, overpaidCents: accepted ? Math.max(0, paidNet - g.agreed) : 0,
      creditsCents: g.credits, creditGapCents: accepted ? Math.max(0, g.credits - g.reduced) : 0,
      ...(split ? { split } : {}),
    });
    if (accepted) {
      leftToPayCents += left;
      if (!split) agg(g.root.budgetLineId).left += left;
      if (paidNet > g.agreed) overpaid.push(g.root.id);
      if (g.credits > g.reduced) creditsNotReflected.push(g.root.id);
    } else if (g.paidOut > 0) paidOnInactive.push(g.root.id);
  }
  for (const p of pieces) {
    const c = p.commitmentId !== undefined ? byId.get(p.commitmentId) : undefined;
    // On a split agreement the home line no longer stands in for a payment that names no line: it stays unassigned.
    agg(p.budgetLineId ?? (c && !splitRoots.has(rootOf(c).id) ? lineOf(c) : null)).paid += -p.amountCents;
  }

  const plannedTotalCents = lines.reduce((s, l) => s + l.plannedCents, 0);
  const budgetCents = project.budgetCents ?? plannedTotalCents;
  const expectedTotalCents = paidCents + leftToPayCents;

  const mk = (lineId: number | null, name: string, plannedCents: number): LineSummary => {
    const v = lineAgg.get(lineId) ?? { agreed: 0, paid: 0, left: 0 };
    return { lineId, name, plannedCents, agreedCents: v.agreed, paidCents: v.paid, leftToPayCents: v.left, expectedCents: v.paid + v.left, varianceCents: plannedCents - (v.paid + v.left) };
  };
  const known = knownLineIds;
  const lineRows = lines.map((l) => mk(l.id, l.name, l.plannedCents));
  // Anything that points at a line that no longer exists, or at none, goes in one row. That row is defined as the project totals minus the
  // named lines, in every column, so the rows always add up to the totals. It is non-zero only for money with no line, money on a line
  // that no longer exists, and a contract paid beyond its agreed amount (where the project total stops "left" at zero).
  const loose = [...lineAgg.keys()].filter((k) => k === null || !known.has(k));
  const rest = lineRows.reduce((s, r) => ({ agreed: s.agreed - r.agreedCents, paid: s.paid - r.paidCents, left: s.left - r.leftToPayCents }), { agreed: agreedCents, paid: paidCents, left: leftToPayCents });
  if (loose.length || rest.agreed !== 0 || rest.paid !== 0 || rest.left !== 0) {
    lineRows.push({ lineId: null, name: 'No budget line', plannedCents: 0, agreedCents: rest.agreed, paidCents: rest.paid, leftToPayCents: rest.left, expectedCents: rest.paid + rest.left, varianceCents: 0 - (rest.paid + rest.left) });
  }

  const { startDate, targetDate } = project;
  const outsideDates = startDate || targetDate ? pieces.filter((p) => p.date && ((startDate && p.date < startDate) || (targetDate && p.date > targetDate))).length : 0;

  return {
    budgetCents, plannedTotalCents, notYetPlannedCents: budgetCents - plannedTotalCents,
    agreedCents, paidCents, leftToPayCents, expectedTotalCents,
    leftInBudgetCents: budgetCents - expectedTotalCents, cashLeftCents: budgetCents - paidCents, quotedCents,
    lines: lineRows,
    contracts,
    paidByCommitment,
    flags: { overBudget: expectedTotalCents > budgetCents, linesOverBudget: plannedTotalCents > budgetCents, overpaid, paidOnInactive, creditsNotReflected, reversalsExceedPayments, unmarkedRefunds, outsideDates, badSplits, unsplitChanges, danglingSplitLines, unassignedPieces },
  };
}

/** Keeps only what belongs to one project: a split that points at another project must not count here. */
export function onlyThisProject(txns: Txn[], projectId: number): Txn[] {
  return txns
    .filter((t) => t.project?.projectId === projectId || (t.splits ?? []).some((s) => s.project?.projectId === projectId))
    .map((t) => ({ ...t, project: t.project?.projectId === projectId ? t.project : undefined, splits: t.splits?.map((s) => (s.project && s.project.projectId !== projectId ? { ...s, project: undefined, amountCents: 0 } : s)) }));
}

/** The project's tagged transactions, newest first, as pieces (one per split that belongs to it). */
export async function loadProjectPieces(d: FinanceDB, projectId: number): Promise<(ProjectPiece & { payee: string; accountId: number })[]> {
  const txns = await d.txns.filter((t) => t.project?.projectId === projectId || (t.splits ?? []).some((s) => s.project?.projectId === projectId)).toArray();
  return onlyThisProject(txns, projectId)
    .flatMap((t) => projectAllocations(t).map((p) => ({ ...p, payee: t.payee, accountId: t.accountId })))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.txnId ?? 0) - (a.txnId ?? 0));
}

/** Reads the project's records and its tagged transactions, and works out the summary. Returns null if the project does not exist. */
export async function loadProjectSummary(d: FinanceDB, projectId: number, opts: { excludeTxnId?: number } = {}): Promise<ProjectSummary | null> {
  const rows = (await d.moduleRecords.where('module').equals(PROJECTS_MODULE).toArray()).filter(live) as Row[];
  const p = rows.find((r) => r.kind === 'project' && r.id === projectId);
  if (!p) return null;
  const mine = (r: Row) => num(r.data.projectId) === projectId;
  const txns = await d.txns.filter((t) => t.id !== opts.excludeTxnId && (t.project?.projectId === projectId || (t.splits ?? []).some((s) => s.project?.projectId === projectId))).toArray();
  const forThis = onlyThisProject(txns, projectId);
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

/**
 * All the project checks for a transaction that is being created or edited, in one place: the transaction-level reference and every
 * split's own reference must point at things that exist and belong together, money coming back on a contract must say what it is, and
 * it cannot be more than was paid. `excludeTxnId` is the transaction being edited, so its current tags are not counted twice.
 */
export async function checkTxnProjects(d: FinanceDB, a: { amountCents: number; project?: ProjectRef; splits?: Split[]; excludeTxnId?: number }): Promise<void> {
  const splits = a.splits?.length ? a.splits : undefined;
  if (a.project) {
    await checkProjectRef(d, a.project);
    const amounts = splits ? splits.filter((s) => !s.project).map((s) => s.amountCents) : [a.amountCents];
    checkRefEffect(a.project, amounts);
    await checkRefundAmount(d, a.project, amounts, a.excludeTxnId);
  }
  for (const s of splits ?? []) {
    if (!s.project) continue;
    await checkProjectRef(d, s.project);
    checkRefEffect(s.project, [s.amountCents]);
    await checkRefundAmount(d, s.project, [s.amountCents], a.excludeTxnId);
  }
}

// ---- what a transaction form can offer ----

export interface ProjectChoice {
  id: number;
  name: string;
  archived: boolean;
  status: string;
  lines: { id: number; name: string }[];
  /** The original contracts only (change orders roll into them). */
  contracts: { id: number; title: string; status: CommitmentStatus; lineId: number | null; vendorContactId: number | null; split?: true }[];
}

/** Every live project with its budget lines and contracts, so a form can offer only what belongs together. Name order; budget lines in their own order. */
export async function loadProjectChoices(d: FinanceDB): Promise<ProjectChoice[]> {
  const rows = (await d.moduleRecords.where('module').equals(PROJECTS_MODULE).toArray()).filter(live) as Row[];
  const sorted = (a: Row, b: Row) => ((num(a.data.sort) ?? 0) - (num(b.data.sort) ?? 0)) || (a.id as number) - (b.id as number);
  return rows.filter((r) => r.kind === 'project').map((p) => {
    const mine = (r: Row) => num(r.data.projectId) === p.id;
    return {
      id: p.id as number,
      name: asProject(p).name,
      archived: p.data.archived === true,
      status: typeof p.data.status === 'string' ? p.data.status : 'planning',
      lines: rows.filter((r) => r.kind === 'budgetLine' && mine(r)).sort(sorted).map((r) => ({ id: r.id as number, name: asBudgetLine(r).name })),
      contracts: rows.filter((r) => r.kind === 'commitment' && mine(r) && num(r.data.parentId) === null).sort(sorted).map((r) => {
        const c = asCommitment(r);
        // A split agreement has no single line to default to: a payment on it has to name its own line.
        return { id: c.id, title: c.title, status: c.status, lineId: c.budgetLineId, vendorContactId: num(r.data.vendorContactId), ...(allocationsAddUp(c.allocations, c.amountCents) ? { split: true as const } : {}) };
      }),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
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

/** Why a transaction was left alone by a bulk tagging. */
export type BulkSkipReason = 'transfer' | 'split' | 'alreadyTagged' | 'needsChoice' | 'ambiguousRefund' | 'exceedsPayments';
export interface BulkSkip { txnId: number; reason: BulkSkipReason }
export interface BulkProjectResult {
  updated: number;
  skippedTransfers: number;
  /** Money coming back on a contract that needs a reversal/credit choice first (not changed). */
  needsChoice?: number;
  /** Money coming back that is more than was paid on the contract (not changed). */
  exceedsPayments?: number;
  /** Money coming back on a project that has accepted contracts, with no word on whether it belongs to one (not changed). */
  ambiguousRefunds?: number;
  /** Transactions that already carry a different project tag (not changed unless replacing was asked for). */
  alreadyTagged?: number;
  /** Split transactions: tag the individual splits by editing the transaction instead (not changed). */
  splitsSkipped?: number;
  /** Every transaction that was left alone, and why. Only present when there is one. */
  skipped?: BulkSkip[];
}

export interface BulkProjectOptions {
  /** Replace a different project tag a transaction already has. Without it such transactions are skipped and counted. */
  replace?: boolean;
  /** Money coming back with no contract is a general refund or reimbursement for the project, even if the project has accepted contracts. */
  refundsAreProjectLevel?: boolean;
}

const sameRef = (a: ProjectRef | undefined, b: ProjectRef) =>
  !!a && a.projectId === b.projectId && a.budgetLineId === b.budgetLineId && a.commitmentId === b.commitmentId && (a.effect ?? undefined) === (b.effect ?? undefined);

/**
 * Sets (or clears) the project on many transactions at once. Only transactions that can be tagged safely are changed; the rest are left
 * alone and counted with the reason: transfers and setup entries, split transactions (tag a split by editing it), transactions that
 * already carry a different tag, and money coming back that needs a choice (reversal or credit, or whether it belongs to a contract).
 */
export async function bulkSetTxnProject(d: FinanceDB, ids: number[], ref: ProjectRef | null, opts: BulkProjectOptions = {}): Promise<BulkProjectResult> {
  const res: BulkProjectResult = { updated: 0, skippedTransfers: 0 };
  const skip = (txnId: number, reason: BulkSkipReason, key?: keyof BulkProjectResult) => {
    (res.skipped ??= []).push({ txnId, reason });
    if (key) (res[key] as number | undefined) = ((res[key] as number | undefined) ?? 0) + 1;
  };
  await d.transaction('rw', d.txns, d.moduleRecords, async () => {
    let hasContracts = false;
    if (ref) {
      await checkProjectRef(d, ref);
      hasContracts = (await loadProjectChoices(d)).find((p) => p.id === ref.projectId)?.contracts.some((c) => c.status === 'accepted') ?? false;
    }
    for (const id of ids) {
      const t = await d.txns.get(id);
      if (!t) continue;
      if (ref) {
        if (t.transferTxnId || isSetupTxn(t)) { res.skippedTransfers++; skip(id, 'transfer'); continue; }
        if (t.splits?.length) { skip(id, 'split', 'splitsSkipped'); continue; }
        if (t.project && !sameRef(t.project, ref) && !opts.replace) { skip(id, 'alreadyTagged', 'alreadyTagged'); continue; }
        try { checkRefEffect(ref, amountsFor(t)); } catch { skip(id, 'needsChoice', 'needsChoice'); continue; }
        if (ref.commitmentId === undefined && t.amountCents > 0 && hasContracts && !opts.refundsAreProjectLevel) { skip(id, 'ambiguousRefund', 'ambiguousRefunds'); continue; }
        try { await checkRefundAmount(d, ref, amountsFor(t), t.id); } catch { skip(id, 'exceedsPayments', 'exceedsPayments'); continue; }
      }
      await updateTxn(d, id, { project: ref ? clean(ref) : undefined });
      res.updated++;
    }
  });
  return res;
}

export type { ProjectRef, Split };
