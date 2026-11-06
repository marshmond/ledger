/**
 * Commitments: quotes, accepted agreements and change orders. One record per commitment (module 'projects', kind 'commitment'), so
 * backup, restore and device sync already cover them and two devices editing different commitments never overwrite each other.
 *
 * Only accepted agreements count toward what is agreed; a quote is shown but never counted. A change order is a commitment with a
 * `parentId` and may be negative. Finance (src/lib/txnProject.ts) reads `projectId`, `budgetLineId`, `title`, `status`, `amountCents` and
 * `parentId` by these names, so do not rename them. The numbers (paid, left to pay) are never stored here: Finance works them out from
 * the transactions.
 */
import type { ModuleRecord } from '../../core/entities';
import { parseAmountToCents } from '../../lib/money';
import { extras, finite, isDate, str } from './model';

export type CommitmentStatus = 'quoted' | 'accepted' | 'declined' | 'cancelled';
export const COMMITMENT_STATUSES: CommitmentStatus[] = ['quoted', 'accepted', 'declined', 'cancelled'];
export const COMMITMENT_LABEL: Record<CommitmentStatus, string> = { quoted: 'Quote', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled' };

export interface CommitmentData {
  projectId: number;
  /** A budget line of the same project, or none. A change order without its own line follows its agreement's line. */
  budgetLineId: number | null;
  /** A shared contact (core/contacts.ts), or none. */
  vendorContactId: number | null;
  title: string;
  status: CommitmentStatus;
  /** Whole cents. Positive for an agreement or quote; a change order may be negative. */
  amountCents: number;
  /** The agreement this change order changes. null for an agreement. */
  parentId: number | null;
  /** Local date 'YYYY-MM-DD' it was accepted. */
  acceptedDate: string | null;
  notes: string;
}
export interface CommitmentRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  data: CommitmentData;
}

const KEYS = new Set(['projectId', 'budgetLineId', 'vendorContactId', 'title', 'status', 'amountCents', 'parentId', 'acceptedDate', 'notes']);

/** Reads a stored record defensively. Fields this code does not know are carried through untouched. */
export function asCommitment(r: ModuleRecord): CommitmentRecord {
  const d = (r.data ?? {}) as Record<string, unknown>;
  return {
    id: r.id as number,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    data: {
      ...extras(d, KEYS),
      projectId: finite(d.projectId) ? d.projectId : -1,
      budgetLineId: finite(d.budgetLineId) ? d.budgetLineId : null,
      vendorContactId: finite(d.vendorContactId) ? d.vendorContactId : null,
      title: str(d.title).trim() || 'Commitment',
      status: COMMITMENT_STATUSES.includes(d.status as CommitmentStatus) ? (d.status as CommitmentStatus) : 'quoted',
      amountCents: finite(d.amountCents) ? Math.round(d.amountCents) : 0,
      parentId: finite(d.parentId) ? d.parentId : null,
      acceptedDate: isDate(d.acceptedDate) ? d.acceptedDate : null,
      notes: str(d.notes),
    },
  };
}

export const isChangeOrder = (c: CommitmentRecord) => c.data.parentId !== null;
export const changeOrdersOf = (c: CommitmentRecord, all: CommitmentRecord[]) => all.filter((x) => x.data.parentId === c.id);

/** The agreement a commitment belongs to: itself, or the agreement it changes. A broken or circular chain stops at the last record found. */
export function rootCommitment(c: CommitmentRecord, all: CommitmentRecord[]): CommitmentRecord {
  const byId = new Map(all.map((x) => [x.id, x]));
  let cur = c;
  const seen = new Set([c.id]);
  while (cur.data.parentId !== null) {
    const p = byId.get(cur.data.parentId);
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    cur = p;
  }
  return cur;
}

const acceptedChanges = (root: CommitmentRecord, all: CommitmentRecord[], except?: number) =>
  changeOrdersOf(root, all).filter((c) => c.id !== except && c.data.status === 'accepted').reduce((s, c) => s + c.data.amountCents, 0);

export interface CommitmentInput {
  title: string;
  /** Text as typed. A change order may start with a minus sign. */
  amount: string;
  status: CommitmentStatus;
  parentId: number | null;
  budgetLineId: number | null;
  acceptedDate: string;
}
export interface CommitmentContext {
  /** Live budget line ids of the project. */
  lineIds: number[];
  /** Every live commitment of the project, including the one being edited. */
  all: CommitmentRecord[];
  editingId?: number;
}

/** The plain-words problem with a commitment or change order, or null. Whether a vendor contact exists is checked where it is saved. */
export function validateCommitment(i: CommitmentInput, ctx: CommitmentContext): string | null {
  if (!i.title.trim()) return 'Give it a title, for example "Cabinet install".';
  if (i.title.trim().length > 120) return 'That title is too long.';
  const cents = parseAmountToCents(i.amount);
  if (cents === null) return 'The amount is not an amount.';
  if (!COMMITMENT_STATUSES.includes(i.status)) return 'Choose a status.';
  if (i.acceptedDate && !isDate(i.acceptedDate)) return 'The accepted date is not a real date.';
  if (i.budgetLineId !== null && !ctx.lineIds.includes(i.budgetLineId)) return 'That budget line is not part of this project.';

  const me = ctx.editingId === undefined ? undefined : ctx.all.find((c) => c.id === ctx.editingId);
  if (i.parentId === null) {
    if (cents <= 0) return 'An agreement or quote needs an amount above zero. Use a change order to lower an agreement.';
    return null;
  }
  // a change order
  if (cents === 0) return 'A change order needs an amount, positive to add cost or negative to take it off.';
  const parent = ctx.all.find((c) => c.id === i.parentId);
  if (!parent) return 'The agreement this changes does not exist in this project.';
  if (me && parent.id === me.id) return 'A change order cannot change itself.';
  if (parent.data.parentId !== null) return 'A change order has to change the original agreement, not another change order.';
  if (me && rootCommitment(parent, ctx.all).id === me.id) return 'That would make the agreement and its change order point at each other.';
  if (me && changeOrdersOf(me, ctx.all).length) return 'This agreement has change orders of its own, so it cannot become a change order.';
  if (i.status === 'accepted') {
    if (parent.data.status !== 'accepted') return 'Accept the original agreement before accepting a change to it.';
    if (parent.data.amountCents + acceptedChanges(parent, ctx.all, ctx.editingId) + cents < 0) return 'That would take the agreed amount below zero.';
  }
  return null;
}

/** Whether a commitment may move to a new status, with the reason in plain words when it may not. */
export function checkStatusChange(c: CommitmentRecord, next: CommitmentStatus, all: CommitmentRecord[]): string | null {
  if (next === c.data.status || next !== 'accepted' || c.data.parentId === null) return null;
  const parent = all.find((x) => x.id === c.data.parentId);
  if (!parent || parent.data.status !== 'accepted') return 'Accept the original agreement before accepting a change to it.';
  if (parent.data.amountCents + acceptedChanges(parent, all, c.id) + c.data.amountCents < 0) return 'That would take the agreed amount below zero.';
  return null;
}

/** A negative change order, ready to fill in, that lowers an agreement by the amount of credit received but not yet reflected. */
export function creditChangeOrderDraft(root: CommitmentRecord, creditGapCents: number): { title: string; amount: string; parentId: number } {
  return { title: 'Credit from vendor', amount: (-creditGapCents / 100).toFixed(2), parentId: root.id };
}
