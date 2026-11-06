import type { ProjectRef } from '../types';
import type { ProjectChoice } from './txnProject';

/**
 * What a transaction form holds while someone fills in the Project box, and how it becomes a `ProjectRef`. The rules live here (not in
 * the screen) so they can be tested: a contract implies its budget line, money coming back must say what it is, and a project with
 * accepted contracts asks whether money coming back belongs to one. Whether the numbers hold (not more than was paid) is checked by
 * Finance when the transaction is saved.
 */
export interface TagState {
  projectId: string;
  lineId: string;
  commitmentId: string;
  /** For money coming back on a contract. */
  effect: '' | 'reversal' | 'credit';
  /** For money coming back on a project that has contracts: a general refund for the project, or about a contract. */
  refundKind: '' | 'project' | 'contract';
  /** On a split agreement: the owner chose "Not sure yet" instead of a budget line. Nothing extra is stored; the payment shows as unassigned. */
  lineUnsure?: boolean;
}

export const EMPTY_TAG: TagState = { projectId: '', lineId: '', commitmentId: '', effect: '', refundKind: '' };

/** The form state for a reference already stored on a transaction or split. */
export function tagFromRef(ref: ProjectRef | undefined): TagState {
  if (!ref) return EMPTY_TAG;
  return {
    projectId: String(ref.projectId),
    lineId: ref.budgetLineId === undefined ? '' : String(ref.budgetLineId),
    commitmentId: ref.commitmentId === undefined ? '' : String(ref.commitmentId),
    effect: ref.effect ?? '',
    refundKind: ref.commitmentId === undefined ? 'project' : 'contract',
  };
}

/** The contracts that can be picked: accepted ones, plus the one already chosen (so an old tag on a cancelled contract can still be seen). */
export const pickableContracts = (p: ProjectChoice | undefined, keep: string) =>
  (p?.contracts ?? []).filter((c) => c.status === 'accepted' || String(c.id) === keep);

/** The budget line a contract files its spending under, if it has one. */
export function impliedLine(p: ProjectChoice | undefined, commitmentId: string): { id: number; name: string } | undefined {
  const c = p?.contracts.find((x) => String(x.id) === commitmentId);
  return c && !c.split && c.lineId !== null ? p?.lines.find((l) => l.id === c.lineId) : undefined;
}

/** True when the chosen contract is split across budget lines (so a payment on it has to name a line, or say it is not sure yet). */
export const splitContract = (p: ProjectChoice | undefined, commitmentId: string): boolean =>
  !!commitmentId && !!p?.contracts.find((x) => String(x.id) === commitmentId)?.split;

/** True when money coming back on this project could belong to a contract, so the form has to ask. */
export const asksAboutRefund = (p: ProjectChoice | undefined, tag: TagState) =>
  !!p && p.contracts.some((c) => c.status === 'accepted' || String(c.id) === tag.commitmentId);

export interface BuiltRef { ref?: ProjectRef; error?: string }

/**
 * Turns the form state into a reference (or nothing, or a plain-words reason it is not finished). `moneyIn` is whether the amount comes
 * back to you. `compact` is for a split row, which has no "general refund or contract" question (but can still pick a contract and a budget line).
 */
export function buildRef(tag: TagState, choices: ProjectChoice[], moneyIn: boolean, opts: { compact?: boolean } = {}): BuiltRef {
  if (!tag.projectId) return {};
  const project = choices.find((p) => String(p.id) === tag.projectId);
  if (!project) return { error: 'That project no longer exists. Choose another or clear it.' };
  const ref: ProjectRef = { projectId: project.id };

  const asks = !opts.compact && moneyIn && asksAboutRefund(project, tag);
  if (asks && !tag.refundKind) return { error: 'Say whether this money coming back is about a contract or is a general refund for the project.' };
  const wantsContract = !!tag.commitmentId && !(asks && tag.refundKind === 'project');
  if (asks && tag.refundKind === 'contract' && !tag.commitmentId) return { error: 'Choose the contract this money belongs to.' };

  if (wantsContract) {
    const c = project.contracts.find((x) => String(x.id) === tag.commitmentId);
    if (!c) return { error: 'That commitment is not part of this project. Choose another or clear it.' };
    ref.commitmentId = c.id;
    if (moneyIn) {
      if (!tag.effect) return { error: 'Say whether this is a reversal (a payment undone) or a credit (a price reduction).' };
      ref.effect = tag.effect;
    }
  }
  // A contract that has a budget line files the spending there by default, so that line is not stored (and follows the contract if it is
  // moved). A different line CAN be chosen, and is then stored: a general contractor's payment can be tile, plumbing and electrical
  // while all of it counts against the one contract. Finance uses the stored line first, else the contract's.
  if (wantsContract && splitContract(project, tag.commitmentId) && !tag.lineId && !tag.lineUnsure) {
    return { error: 'This agreement is split across budget lines. Which line is this payment for? Choose "Not sure yet" if you do not know.' };
  }
  const implied = wantsContract ? impliedLine(project, tag.commitmentId) : undefined;
  if (tag.lineId) {
    const l = project.lines.find((x) => String(x.id) === tag.lineId);
    if (!l) return { error: 'That budget line is not part of this project. Choose another or clear it.' };
    if (!implied || implied.id !== l.id) ref.budgetLineId = l.id;
  }
  return { ref };
}

/** One short phrase for a tag, for lists: "Kitchen › Cabinets" or "Kitchen › Cabinet install (contract)". */
export function describeRef(ref: ProjectRef | undefined, choices: ProjectChoice[]): string {
  if (!ref) return '';
  const p = choices.find((x) => x.id === ref.projectId);
  if (!p) return 'A project that no longer exists';
  const parts = [p.name];
  const c = ref.commitmentId === undefined ? undefined : p.contracts.find((x) => x.id === ref.commitmentId);
  if (c) parts.push(c.title);
  const l = ref.budgetLineId === undefined ? undefined : p.lines.find((x) => x.id === ref.budgetLineId);
  if (l) parts.push(l.name);
  return parts.join(' › ') + (ref.effect ? ` (${ref.effect})` : '');
}
