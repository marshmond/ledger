/**
 * Contacts C2: WHICH RECORDS NAME THIS CONTACT? A shared, READ-ONLY contract (layer 2 of the C0 plan).
 *
 * Layer 1 (`contactUsage.ts`) counts records that mention a Contact's id, without knowing any module's fields. This layer is the opposite: each module
 * that stores a Contact id contributes a small reader (`contributes.contactReferences`) that knows its OWN fields and returns real, named, linkable
 * references ("Task: Book the dentist"). The Contacts screen never imports a household module.
 *
 * Rules every reader follows (same family as `txnReferences`, see docs/module-hooks.md):
 *  - READ ONLY. It writes nothing, creates nothing, repairs nothing, and leaves every timestamp alone.
 *  - It reads the shared `moduleRecords` table (and `contacts` for names). Never a Finance table.
 *  - It follows a stored Contact id, and only that. It NEVER infers a relationship from a matching name, a title, a payee or an amount, and it does
 *    not treat a provider-name snapshot as a live Contact.
 *  - A deleted record is not a reference. A damaged record is skipped (the layer-1 comparison then shows that more records mention the Contact than
 *    could be named).
 *  - If it cannot read, it THROWS. The caller then says "could not check", never "nothing found".
 *
 * Nothing here decides whether a Contact can be removed on its own; removal also needs the complete layer-1 scan (`contactRemoval.ts`).
 */
import type { FinanceDB } from '../db';
import type { ModuleRecord } from './entities';
import { isLive } from './store';
import { recordSource } from './registry';
import type { UsageEntry } from './contactUsage';

/**
 * The live rows of one record kind, each read by the owning module's own defensive reader. A row that reader cannot parse (it throws) is SKIPPED, not
 * allowed to stop the whole module's list: the layer-1 comparison then shows that more records mention the Contact than could be named.
 */
export async function readRows<T>(d: FinanceDB, module: string, kind: string, parse: (r: ModuleRecord) => T): Promise<T[]> {
  const out: T[] = [];
  for (const r of (await d.moduleRecords.where('[module+kind]').equals([module, kind]).toArray()).filter(isLive)) {
    try { out.push(parse(r)); } catch { /* a damaged row is left out of the named list */ }
  }
  return out;
}

/** What the owner can filter the directory by. These come from stored relationships only, never from a typed label. */
export type ContactFacet = 'member' | 'important' | 'provider' | 'project';
export const FACET_LABEL: Record<ContactFacet, string> = { member: 'Household member', important: 'Important Family contact', provider: 'Service provider', project: 'Project participant' };

export interface ContactReference {
  /** The shared Contact the record points at. */
  contactId: number;
  /** The module that owns the record (`tasks`) and its record kind (`task`), as stored in `moduleRecords`. */
  module: string;
  kind: string;
  /** Unique within module + kind (usually the record id as text). */
  recordId: string;
  /** How the record uses the Contact, as a short code (`person`, `vendor`, `provider`, `extra`, `member`, `important`...). One record can use a Contact in more than one way. */
  role: string;
  /** What the record is called. Never an amount, a note or a contact detail. */
  title: string;
  /** The relationship in plain words ("Listed under People on this task"). */
  relation: string;
  /** Where to open the record: a path such as `/tasks?task=12`, without `#`. Absent when the record cannot be opened. */
  href?: string;
  /** A useful date, `YYYY-MM-DD`. */
  date?: string;
  /** The record's own status in plain words. */
  status?: string;
  /** True for a record that is finished, archived or ended: still listed (and counted), shown quietly. */
  inactive?: boolean;
  facet?: ContactFacet;
}

export interface ContactReferenceContext {
  /** The Contacts being asked about. A reader looks only for these. */
  ids: ReadonlySet<number>;
  d: FinanceDB;
  /** Today as `YYYY-MM-DD` (passed in so a reader never reads the clock itself). */
  today: string;
}

export interface ContactReferenceProvider {
  /** Shown only when this reader could not run: `Tasks`. */
  label: string;
  find(ctx: ContactReferenceContext): Promise<ContactReference[]>;
}

export interface UnverifiedContactReader { label: string; message: string }

export interface ContactReferenceResult {
  /** True only when EVERY reader ran and every item it returned was readable. False is "could not check", never the same as "none". */
  verified: boolean;
  unverified: UnverifiedContactReader[];
  /** Per Contact id: its references, grouped order, each (record, role) once. */
  byContact: Map<number, ContactReference[]>;
  /** Items a reader returned that could not be understood and were left out. */
  dropped: number;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const text = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FACETS: readonly string[] = ['member', 'important', 'provider', 'project'];

/** Pure: one item a reader returned, made safe, or null when it cannot be used. A bad optional part is dropped; a bad required part drops the item. */
export function cleanReference(x: unknown, wanted: ReadonlySet<number>): ContactReference | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const module = text(r.module, 40);
  const kind = text(r.kind, 40);
  const recordId = typeof r.recordId === 'number' && Number.isFinite(r.recordId) ? String(r.recordId) : text(r.recordId, 60);
  const role = text(r.role, 40);
  const title = text(r.title);
  const relation = text(r.relation);
  if (!isInt(r.contactId) || !wanted.has(r.contactId) || !module || !kind || !recordId || !role || !title || !relation) return null;
  const out: ContactReference = { contactId: r.contactId, module, kind, recordId, role, title, relation };
  // An address must be a path inside Ledger. Anything else (a full URL, a script) is not a link.
  if (typeof r.href === 'string' && /^\/[^/\\\s]/.test(r.href) && !/[\u0000-\u001f]/.test(r.href)) out.href = r.href;
  if (typeof r.date === 'string' && DATE.test(r.date)) out.date = r.date;
  const status = text(r.status, 60);
  if (status) out.status = status;
  if (r.inactive === true) out.inactive = true;
  if (typeof r.facet === 'string' && FACETS.includes(r.facet)) out.facet = r.facet as ContactFacet;
  return out;
}

const refKey = (r: ContactReference) => `${r.contactId}|${r.module}|${r.kind}|${r.recordId}|${r.role}`;

/**
 * Shared links that name a Contact (`contacts` is one end). No module creates these today, but the shared table can hold them, so they are honoured:
 * the other end is named by its own module's record source when it has one.
 */
export async function sharedLinkReferences(ctx: ContactReferenceContext): Promise<ContactReference[]> {
  const out: ContactReference[] = [];
  const idOf = (v: unknown): number | null => (isInt(v) ? v : typeof v === 'string' && /^contact:(\d+)$/.test(v) ? Number(v.slice(8)) : null);
  const links = (await ctx.d.links.toArray()).filter(isLive);
  for (const l of links) {
    const ends: { self: unknown; selfModule: string; other: { module: string; id: string | number } }[] = [
      { self: l.fromId, selfModule: l.fromModule, other: { module: l.toModule, id: l.toId } },
      { self: l.toId, selfModule: l.toModule, other: { module: l.fromModule, id: l.fromId } },
    ];
    for (const e of ends) {
      const cid = e.selfModule === 'contacts' ? idOf(e.self) : null;
      if (cid === null || !ctx.ids.has(cid)) continue;
      let title = 'A saved link';
      let href: string | undefined;
      try {
        const info = await recordSource(e.other.module)?.describe(e.other.id);
        if (info) { title = info.label; href = info.path; }
      } catch { /* the other module could not describe it: keep the plain label */ }
      out.push({ contactId: cid, module: 'shared', kind: 'link', recordId: String(l.id), role: 'link', title, relation: `Saved link${l.type ? ` (${l.type})` : ''} to this contact`, ...(href ? { href } : {}) });
    }
  }
  return out;
}

/**
 * Asks every reader (plus the shared-link reader) about the given Contacts, in one pass per module. A reader that throws is reported under `unverified`
 * and the others still run. No readers at all is also "not verified". An item a reader returns that is malformed is left out and counted in `dropped`
 * (which also makes the result unverified, because something was not understood).
 */
export async function readContactReferences(ids: readonly number[], d: FinanceDB, providers: readonly ContactReferenceProvider[], today: string): Promise<ContactReferenceResult> {
  const wanted = new Set(ids);
  const byContact = new Map<number, ContactReference[]>();
  if (wanted.size === 0) return { verified: true, unverified: [], byContact, dropped: 0 };
  const ctx: ContactReferenceContext = { ids: wanted, d, today };
  const unverified: UnverifiedContactReader[] = [];
  if (providers.length === 0) unverified.push({ label: 'Ledger', message: 'No reference readers are registered, so named references could not be checked.' });
  const seen = new Set<string>();
  let dropped = 0;
  const take = (items: unknown) => {
    if (!Array.isArray(items)) { dropped++; return; }
    for (const raw of items) {
      const r = cleanReference(raw, wanted);
      if (!r) { dropped++; continue; }
      const k = refKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      byContact.set(r.contactId, [...(byContact.get(r.contactId) ?? []), r]);
    }
  };
  for (const p of [...providers, { label: 'Saved links', find: sharedLinkReferences } satisfies ContactReferenceProvider]) {
    try { take(await p.find(ctx)); } catch (e) { unverified.push({ label: p.label, message: e instanceof Error ? e.message : 'The check failed.' }); }
  }
  if (dropped > 0) unverified.push({ label: 'Ledger', message: `${dropped} item${dropped === 1 ? '' : 's'} a module reported could not be understood and ${dropped === 1 ? 'was' : 'were'} left out.` });
  for (const [id, list] of byContact) byContact.set(id, sortReferences(list));
  return { verified: unverified.length === 0, unverified, byContact, dropped };
}

// ---- grouping and words (pure) ----

/** The sections of the Contact page, in reading order. */
export const GROUPS = [
  { id: 'family', label: 'Family' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'projects', label: 'Projects' },
  { id: 'assets', label: 'Home & Assets' },
  { id: 'services', label: 'Household Services' },
  { id: 'bills', label: 'Bills & Subscriptions' },
  { id: 'other', label: 'Other supported references' },
] as const;
export type GroupId = (typeof GROUPS)[number]['id'];
export const groupOf = (module: string): GroupId => (GROUPS.some((g) => g.id === module && g.id !== 'other') ? (module as GroupId) : 'other');
const groupRank = (module: string) => GROUPS.findIndex((g) => g.id === groupOf(module));

/** Within a module: the record kinds in the order a person expects (the person first, then what they do for you). Unknown kinds follow. */
const KIND_ORDER = ['member', 'contact', 'event', 'task', 'project', 'commitment', 'asset', 'service', 'warranty', 'arrangement', 'visit', 'obligation', 'link'];
const kindRank = (k: string) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };

/** Stable reading order: module group, then record kind, then active before finished, then date (soonest first, undated last), then title, then id. */
export function sortReferences(list: readonly ContactReference[]): ContactReference[] {
  return [...list].sort((a, b) =>
    groupRank(a.module) - groupRank(b.module) || a.module.localeCompare(b.module) || kindRank(a.kind) - kindRank(b.kind) || a.kind.localeCompare(b.kind)
    || Number(!!a.inactive) - Number(!!b.inactive)
    || (a.date ?? '9999-99-99').localeCompare(b.date ?? '9999-99-99')
    || a.title.localeCompare(b.title) || a.recordId.localeCompare(b.recordId, 'en', { numeric: true }) || a.role.localeCompare(b.role));
}

export interface ReferenceGroup { id: GroupId; label: string; items: ContactReference[] }
/** Pure: the references split into the page's sections (empty sections left out). */
export function groupReferences(list: readonly ContactReference[]): ReferenceGroup[] {
  const out: ReferenceGroup[] = [];
  for (const g of GROUPS) {
    const items = list.filter((r) => groupOf(r.module) === g.id);
    if (items.length) out.push({ id: g.id, label: g.label, items });
  }
  return out;
}

/** The facets a Contact has, from its stored relationships. */
export const facetsOf = (list: readonly ContactReference[]): Set<ContactFacet> => new Set(list.flatMap((r) => (r.facet ? [r.facet] : [])));

export interface Unlisted {
  /** How many more records mention the Contact (layer 1) than could be named (layer 2). */
  total: number;
  /** Per module/kind: how many. */
  kinds: { module: string; kind: string; count: number }[];
}
/**
 * Layer 1 versus layer 2. For every kind of record the numeric scan found, how many DISTINCT records could the readers name? A shortfall means "other
 * stored references may exist" (a record kind with no reader, a damaged or retired record, or a number that only looks like an id). It is shown as a
 * limit of the list and never read as "unused".
 */
export function unlistedMentions(usage: readonly UsageEntry[] | undefined, refs: readonly ContactReference[]): Unlisted {
  const named = new Map<string, Set<string>>();
  for (const r of refs) { const k = `${r.module}/${r.kind}`; (named.get(k) ?? named.set(k, new Set()).get(k)!).add(r.recordId); }
  const kinds: Unlisted['kinds'] = [];
  for (const e of usage ?? []) {
    const have = named.get(`${e.module}/${e.kind}`)?.size ?? 0;
    if (e.count > have) kinds.push({ module: e.module, kind: e.kind, count: e.count - have });
  }
  return { total: kinds.reduce((n, k) => n + k.count, 0), kinds };
}
