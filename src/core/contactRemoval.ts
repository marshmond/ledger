/**
 * Contacts C2: REMOVING A CONTACT THAT NOTHING USES, with a preview, a re-check inside one database transaction, a soft delete and a guarded Undo.
 *
 * The same plan / apply shape as deleting a Finance transaction (`lib/txnDeletion.ts`):
 *   plan  = look at the Contact and ask every safety check whether anything mentions it (READ ONLY, nothing changes);
 *   apply = in ONE transaction over every table a Contact id can live in: plan AGAIN from the live data, refuse if anything differs from what the owner
 *           was shown, then soft-delete (`deletedAt`). The id, the row and every unknown field stay exactly as they are; nothing is ever hard-deleted.
 *
 * A Contact is removable only when ALL of these hold: it is live; the complete layer-1 scan (`contactUsage`, every number in every live record, link,
 * attachment and due item) finds nothing; the text scan (the id as digits anywhere in the stored JSON, the older `contactIsReferenced` rule) finds nothing;
 * and every module's named reader ran and found nothing. A reader that cannot run, or returns something it cannot read, BLOCKS removal ("could not check"
 * is never "nothing found"). The directory's "no confirmed references" filter and the Contact page's named lists are NOT used to authorize removal.
 *
 * What this cannot do: it cannot know about another device that has not synced yet. If a second device adds a reference to this Contact while the removal
 * is syncing, Ledger keeps both records (nothing is destroyed): the reference then points at a removed Contact, which `findRemovedButReferenced` lists so the
 * owner can restore it (same id). That is a limit of Ledger's whole-record, last-writer-wins sync, stated to the owner, not a guarantee.
 */
import type { FinanceDB } from '../db';
import { readContactReferences, type ContactReferenceProvider, type UnverifiedContactReader } from './contactReferences';
import { readContactUsage, type UsageEntry } from './contactUsage';
import type { Contact } from './entities';
import { createStore, isLive } from './store';

export type RemovalReason = 'gone' | 'referenced' | 'unverified' | 'stale';
export class RemovalRefused extends Error {
  constructor(public reason: RemovalReason, message: string) { super(message); this.name = 'RemovalRefused'; }
}

export interface RemovalPlan {
  contactId: number;
  /** The Contact as it is now (a copy), or null when it is missing or already removed. */
  contact: Contact | null;
  /** True only when every check ran and found nothing. */
  eligible: boolean;
  /** Plain-words reasons it cannot be removed (empty when eligible). */
  reasons: string[];
  /** Layer 1: records that mention the Contact's id (by module/kind). */
  mentions: UsageEntry[];
  /** The older text rule found the id somewhere in stored data. */
  textHit: boolean;
  /** Named references the module readers found (only checked when the scans found nothing). */
  named: number;
  verified: boolean;
  unverified: UnverifiedContactReader[];
  /** Equal fingerprints mean the same Contact content and the same (clear) result. */
  fingerprint: string;
}

/** What Undo needs to take exactly this removal back. */
export interface RemovalUndo {
  contactId: number;
  deletedAt: number;
  updatedAt: number;
  /** The removed row exactly as the removal left it (every field), so a change in the same millisecond is still noticed. */
  fingerprint: string;
}

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v === undefined ? null : v);
/** Every stored field except the sync time stamp, so any change to the Contact makes an old preview stale. */
const print = (c: Contact | null) => (c ? JSON.stringify(canon((({ updatedAt: _u, ...rest }) => { void _u; return rest; })(c as Contact & { updatedAt?: number }))) : 'none');

/** True when the Contact's id appears as digits anywhere in a live record, link end, attachment or due item (the conservative text rule). */
export async function idAppearsInStoredData(d: FinanceDB, contactId: number): Promise<boolean> {
  const re = new RegExp(`(?<![0-9])${contactId}(?![0-9])`);
  const hit = (v: unknown) => re.test(JSON.stringify(v ?? null));
  const loose = (row: unknown) => { const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = row as Record<string, unknown>; void _i; void _c; void _u; void _d; return rest; };
  for (const r of await d.moduleRecords.toArray()) if (isLive(r) && hit(r.data)) return true;
  for (const l of await d.links.toArray()) if (isLive(l) && (hit(l.fromId) || hit(l.toId))) return true;
  for (const a of await d.attachments.toArray()) if (isLive(a as { deletedAt?: number | null }) && hit(loose(a))) return true;
  for (const x of await d.dueItems.toArray()) if (isLive(x as { deletedAt?: number | null }) && hit(loose(x))) return true;
  return false;
}

/** Reads everything and decides whether a removal is allowed. READ ONLY. */
export async function planContactRemoval(d: FinanceDB, contactId: number, providers: readonly ContactReferenceProvider[], today: string): Promise<RemovalPlan> {
  const row = await d.contacts.get(contactId);
  const contact = row && isLive(row) ? { ...row } : null;
  const blank = { contactId, contact, mentions: [] as UsageEntry[], textHit: false, named: 0, verified: true, unverified: [] as UnverifiedContactReader[] };
  if (!contact) return { ...blank, eligible: false, reasons: ['This contact no longer exists.'], fingerprint: `none|${contactId}` };

  const usage = await readContactUsage(d, [contactId]);
  const mentions = usage.byContact.get(contactId) ?? [];
  const textHit = await idAppearsInStoredData(d, contactId);
  if (mentions.length > 0 || textHit) {
    const n = mentions.reduce((s, e) => s + e.count, 0);
    return {
      ...blank, mentions, textHit, eligible: false, fingerprint: `${print(contact)}|used`,
      reasons: [n > 0 ? `${n} stored record${n === 1 ? '' : 's'} mention${n === 1 ? 's' : ''} this contact.` : 'This contact’s identifier appears in stored data.'],
    };
  }
  // The scans are clear: now every module's named reader must also run and find nothing.
  const found = await readContactReferences([contactId], d, providers, today);
  const named = found.byContact.get(contactId)?.length ?? 0;
  const reasons: string[] = [];
  if (!found.verified) reasons.push('Ledger could not finish checking every module, so it cannot be sure nothing uses this contact.');
  if (named > 0) reasons.push(`${named} named record${named === 1 ? '' : 's'} refer${named === 1 ? 's' : ''} to this contact.`);
  return {
    ...blank, named, verified: found.verified, unverified: found.unverified, eligible: reasons.length === 0, reasons,
    fingerprint: `${print(contact)}|clear|${found.verified}|${named}`,
  };
}

/** Every table a Contact id can be stored in (see `contactUsage.ts`), so the check and the delete are one transaction. */
const tablesOf = (d: FinanceDB) => [d.contacts, d.moduleRecords, d.links, d.attachments, d.dueItems];

/**
 * Soft-deletes the Contact the plan described, or refuses without writing anything. Inside ONE transaction it plans again from the live data and refuses
 * if the Contact is gone, anything now mentions it, a reader cannot run, or the result differs from what the owner was shown.
 */
export function applyContactRemoval(d: FinanceDB, plan: RemovalPlan, providers: readonly ContactReferenceProvider[], today: string): Promise<RemovalUndo> {
  if (!plan.eligible) return Promise.reject(new RemovalRefused(plan.verified ? 'referenced' : 'unverified', 'This contact cannot be removed: ' + (plan.reasons[0] ?? 'it is in use.')));
  return d.transaction('rw', tablesOf(d), async () => {
    const live = await planContactRemoval(d, plan.contactId, providers, today);
    if (!live.contact) throw new RemovalRefused('gone', 'This contact no longer exists. Nothing was changed.');
    if (!live.verified) throw new RemovalRefused('unverified', 'Ledger could not finish checking what uses this contact, so nothing was removed.');
    if (!live.eligible) throw new RemovalRefused('referenced', 'Something now refers to this contact (it may have been added a moment ago, or on another device). Nothing was removed.');
    if (live.fingerprint !== plan.fingerprint) throw new RemovalRefused('stale', 'This contact changed since you looked. Nothing was removed. Look at it again and confirm again.');
    await createStore(d).shared.contacts.remove(plan.contactId);
    const after = await d.contacts.get(plan.contactId);
    if (!after || isLive(after)) throw new RemovalRefused('stale', 'The removal could not be completed. Nothing was removed.');
    return { contactId: plan.contactId, deletedAt: after.deletedAt as number, updatedAt: after.updatedAt, fingerprint: JSON.stringify(canon(after)) };
  });
}

/**
 * Takes a removal back: the SAME Contact (same id, same row) becomes live again. Refused, writing nothing, if the removed row is no longer exactly as the
 * removal left it (it was restored, changed or synced over). A Contact that is already live again is left alone.
 */
export function undoContactRemoval(d: FinanceDB, u: RemovalUndo): Promise<'restored' | 'already-live'> {
  return d.transaction('rw', d.contacts, async () => {
    const row = await d.contacts.get(u.contactId);
    if (!row) throw new RemovalRefused('gone', 'This contact no longer exists.');
    if (isLive(row)) return 'already-live' as const;
    if (row.deletedAt !== u.deletedAt || row.updatedAt !== u.updatedAt || JSON.stringify(canon(row)) !== u.fingerprint) throw new RemovalRefused('stale', 'This contact changed after it was removed, so Undo did nothing.');
    await createStore(d).shared.contacts.restore(u.contactId);
    return 'restored' as const;
  });
}

export interface RemovedButReferenced { contact: Contact; mentions: UsageEntry[] }

/**
 * Removed Contacts that live records still mention (for example a reference added on another device before the removal reached it). READ ONLY. They are
 * the one visible sign of the cross-device limit above; each can be restored with `restoreContact`.
 */
export async function findRemovedButReferenced(d: FinanceDB): Promise<RemovedButReferenced[]> {
  const removed = (await d.contacts.toArray()).filter((c) => !isLive(c));
  if (!removed.length) return [];
  const usage = await readContactUsage(d, removed.map((c) => c.id as number));
  return removed.flatMap((c) => { const m = usage.byContact.get(c.id as number); return m?.length ? [{ contact: c, mentions: m }] : []; })
    .sort((a, b) => a.contact.name.localeCompare(b.contact.name) || (a.contact.id as number) - (b.contact.id as number));
}

/** Restores a removed Contact (same id). Does nothing if it is not removed. */
export function restoreContact(d: FinanceDB, id: number): Promise<boolean> {
  return d.transaction('rw', d.contacts, async () => {
    const row = await d.contacts.get(id);
    if (!row || isLive(row)) return false;
    await createStore(d).shared.contacts.restore(id);
    return true;
  });
}
