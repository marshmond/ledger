/**
 * Turns the Finance layer's project figures into what the project page shows: the contracts grouped by state, the warnings in plain
 * words, and a count of tags that no longer point at anything. No money is worked out here: every figure comes from
 * `summariseProject` / `loadProjectSummary` in src/lib/txnProject.ts, so the page can never disagree with Finance.
 */
import { formatCents } from '../../lib/money';
import type { ContractSummary, ProjectPiece, ProjectSummary } from '../../lib/txnProject';
import { changeOrdersOf, COMMITMENT_LABEL, type CommitmentRecord } from './commitmentModel';

export interface ContractRow {
  root: CommitmentRecord;
  changes: CommitmentRecord[];
  /** Null only for a contract the summary has not seen yet (a moment between a save and the refresh). */
  money: ContractSummary | undefined;
}
export interface ContractGroups {
  /** Accepted agreements: they count toward what is agreed. */
  accepted: ContractRow[];
  /** Quotes waiting for an answer: shown, never counted. */
  pending: ContractRow[];
  /** Declined or cancelled: kept for reference; anything paid on them is still in the totals. */
  closed: ContractRow[];
}

export function groupContracts(commitments: CommitmentRecord[], summary: ProjectSummary | null): ContractGroups {
  const ids = new Set(commitments.map((c) => c.id));
  // An orphaned change order (its agreement was removed on another device) is shown as an agreement of its own so it is never hidden.
  const roots = commitments.filter((c) => c.data.parentId === null || !ids.has(c.data.parentId));
  const rows: ContractRow[] = roots.map((root) => ({ root, changes: changeOrdersOf(root, commitments), money: summary?.contracts.find((x) => x.rootId === root.id) }));
  return {
    accepted: rows.filter((r) => r.root.data.status === 'accepted'),
    pending: rows.filter((r) => r.root.data.status === 'quoted'),
    closed: rows.filter((r) => r.root.data.status === 'declined' || r.root.data.status === 'cancelled'),
  };
}

export type WarningKind =
  | 'overBudget' | 'linesOverBudget' | 'lineOver' | 'unfiled' | 'overpaid' | 'paidOnInactive' | 'creditNotReflected'
  | 'reversalTooBig' | 'unmarkedRefunds' | 'outsideDates' | 'brokenTags';
export interface Warning {
  kind: WarningKind;
  text: string;
  commitmentId?: number;
  lineId?: number | null;
  /** The warning has a fix the page can offer: a negative change order for this amount (positive cents). */
  creditGapCents?: number;
}

/** Tagged transactions whose budget line or commitment no longer exists (removed on another device, say). */
export function countBrokenTags(pieces: Pick<ProjectPiece, 'budgetLineId' | 'commitmentId'>[], lineIds: number[], commitmentIds: number[]): number {
  return pieces.filter((p) => (p.budgetLineId !== undefined && !lineIds.includes(p.budgetLineId)) || (p.commitmentId !== undefined && !commitmentIds.includes(p.commitmentId))).length;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Everything the page should flag, most serious first, in plain words. */
export function projectWarnings(s: ProjectSummary, commitments: CommitmentRecord[], extra: { brokenTags?: number } = {}): Warning[] {
  const out: Warning[] = [];
  const titleOf = (id: number) => commitments.find((c) => c.id === id)?.data.title ?? 'a commitment';
  const contract = (id: number) => s.contracts.find((c) => c.rootId === id);

  for (const id of s.flags.reversalsExceedPayments) {
    out.push({ kind: 'reversalTooBig', commitmentId: id, text: `Money that came back on "${titleOf(id)}" adds up to more than was paid on it. Check the transactions marked as a reversal or a credit.` });
  }
  for (const id of s.flags.creditsNotReflected) {
    const gap = contract(id)?.creditGapCents ?? 0;
    out.push({
      kind: 'creditNotReflected', commitmentId: id, creditGapCents: gap,
      text: `You got ${formatCents(contract(id)?.creditsCents ?? 0)} back as a credit on "${titleOf(id)}", but the agreed amount has not come down by as much. Until it does, ${formatCents(gap)} looks like it is owed again. Add a negative change order to match.`,
    });
  }
  for (const id of s.flags.overpaid) {
    const c = contract(id);
    out.push({ kind: 'overpaid', commitmentId: id, text: `You have paid ${formatCents(c?.paidCents ?? 0)} on "${titleOf(id)}", which is ${formatCents(c?.overpaidCents ?? 0)} more than the ${formatCents(c?.agreedCents ?? 0)} agreed. Add a change order if the price went up, or ask for a refund.` });
  }
  for (const id of s.flags.paidOnInactive) {
    const c = contract(id);
    const r = commitments.find((x) => x.id === id);
    const why = r ? (r.data.status === 'quoted' ? 'is still only a quote' : `is ${COMMITMENT_LABEL[r.data.status].toLowerCase()}`) : 'is not accepted';
    out.push({ kind: 'paidOnInactive', commitmentId: id, text: `${formatCents(c?.paidCents ?? 0)} has been paid on "${titleOf(id)}", which ${why}. That money still counts as spent, but nothing more is expected on it.` });
  }
  if (s.flags.unmarkedRefunds) {
    out.push({ kind: 'unmarkedRefunds', text: `${plural(s.flags.unmarkedRefunds, 'transaction brings', 'transactions bring')} money back on a contract without saying whether it is a reversal or a credit. Open ${s.flags.unmarkedRefunds === 1 ? 'it' : 'them'} and choose.` });
  }
  if (s.flags.overBudget) {
    out.push({ kind: 'overBudget', text: `At this pace the project will cost ${formatCents(s.expectedTotalCents)}, which is ${formatCents(s.expectedTotalCents - s.budgetCents)} more than the ${formatCents(s.budgetCents)} budget.` });
  }
  if (s.flags.linesOverBudget) {
    out.push({ kind: 'linesOverBudget', text: `The budget lines add up to ${formatCents(s.plannedTotalCents)}, which is ${formatCents(s.plannedTotalCents - s.budgetCents)} more than the ${formatCents(s.budgetCents)} budget.` });
  }
  for (const l of s.lines) {
    if (l.lineId === null) {
      if (l.expectedCents > 0) out.push({ kind: 'unfiled', lineId: null, text: `${formatCents(l.expectedCents)} of spending and commitments is not filed under any budget line.` });
    } else if (l.varianceCents < 0) {
      out.push({ kind: 'lineOver', lineId: l.lineId, text: `"${l.name}" is on track to cost ${formatCents(l.expectedCents)}, which is ${formatCents(-l.varianceCents)} over its ${formatCents(l.plannedCents)} plan.` });
    }
  }
  if (extra.brokenTags) {
    out.push({ kind: 'brokenTags', text: `${plural(extra.brokenTags, 'transaction points', 'transactions point')} at a budget line or commitment that no longer exists. Open ${extra.brokenTags === 1 ? 'it' : 'them'} and choose again. The money is still counted as project spending.` });
  }
  if (s.flags.outsideDates) {
    out.push({ kind: 'outsideDates', text: `${plural(s.flags.outsideDates, 'payment is', 'payments are')} dated outside the project's start and target dates.` });
  }
  return out;
}
