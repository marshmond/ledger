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
  | 'reversalTooBig' | 'unmarkedRefunds' | 'outsideDates' | 'brokenTags'
  | 'splitBroken' | 'changeNotSplit' | 'splitUnassigned' | 'splitLineGone';
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

/**
 * Why the "No budget line" row is not empty, in plain words, one sentence per cause, so a payment that is genuinely not assigned is not
 * confused with an agreement that was simply never given a line, an unsplit change order, a removed line, or an overpaid agreement.
 */
export function noLineNotes(s: ProjectSummary): string[] {
  const out: string[] = [];
  if (!s.lines.some((l) => l.lineId === null)) return out;
  const unassigned = s.contracts.reduce((n, c) => n + (c.split?.unassignedPaidCents ?? 0), 0);
  if (s.flags.unassignedPieces) out.push(`${formatCents(unassigned)} was paid in ${plural(s.flags.unassignedPieces, 'payment', 'payments')} on a split agreement without choosing a line. Open the transaction and choose the line. Until then the lines' "Left to pay" is higher by that amount and this row balances it.`);
  if (s.flags.unsplitChanges.length) out.push(`${plural(s.flags.unsplitChanges.length, 'change order is', 'change orders are')} on a split agreement without a split, so ${s.flags.unsplitChanges.length === 1 ? 'its' : 'their'} amount sits here. Open and split ${s.flags.unsplitChanges.length === 1 ? 'it' : 'them'}.`);
  if (s.flags.danglingSplitLines.length) out.push('Part of a split agreement points at a budget line that no longer exists. Open the agreement and choose another line.');
  if (s.flags.badSplits.length) out.push('A split no longer adds up, so that agreement is filed as a whole under its own line (or here if it has none). Open it and fix the split.');
  if (s.flags.overpaid.length) out.push('An agreement has been paid more than its agreed total, so its extra shows here while the project total stops "Left to pay" at zero.');
  if (!out.length) out.push('Agreements or payments that are not filed under any budget line.');
  return out;
}

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
  for (const id of s.flags.badSplits) {
    out.push({ kind: 'splitBroken', commitmentId: id, text: `The split of "${titleOf(id)}" across budget lines no longer adds up to its amount, so it is being ignored. Open it and fix the split.` });
  }
  for (const id of s.flags.unsplitChanges) {
    out.push({ kind: 'changeNotSplit', commitmentId: id, text: `The change order "${titleOf(id)}" is on a split agreement but is not split across lines, so its amount shows under "No budget line". Open it and split it.` });
  }
  for (const id of s.flags.danglingSplitLines) {
    out.push({ kind: 'splitLineGone', commitmentId: id, text: `"${titleOf(id)}" has money on a budget line that no longer exists. It shows under "No budget line". Open it and choose another line.` });
  }
  if (s.flags.unassignedPieces) {
    const amt = s.contracts.reduce((n, c) => n + (c.split?.unassignedPaidCents ?? 0), 0);
    out.push({ kind: 'splitUnassigned', text: `${formatCents(amt)} in ${plural(s.flags.unassignedPieces, 'payment on a split agreement is', 'payments on split agreements are')} not assigned to a budget line. ${s.flags.unassignedPieces === 1 ? 'It shows' : 'They show'} under "No budget line" until you open the transaction and choose the line.` });
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
