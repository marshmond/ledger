/** Checking an asset before it is saved. Plain-words messages, first problem only. Pure: parents are passed in as a lookup. */
import { parseAmountToCents } from '../../lib/money';
import { ASSET_STATUSES, ASSET_TYPES, isDate, tidy, type AssetData } from './model';

export const MAX_DEPTH = 12;

/** What the parent/replacement checks need to know about the other assets (live ones only). */
export type AssetLookup = (id: number) => { parentId: number | null; replacedById: number | null; type: string } | undefined;

/** True if putting `id` under `parentId` would make it its own ancestor (or the chain is too deep). `id` may be undefined for a new asset. */
export function wouldCreateCycle(id: number | undefined, parentId: number | null, lookup: AssetLookup): boolean {
  let cur: number | null = parentId;
  for (let i = 0; i <= MAX_DEPTH && cur !== null; i++) {
    if (id !== undefined && cur === id) return true;
    cur = lookup(cur)?.parentId ?? null;
  }
  return cur !== null; // still climbing after the limit: too deep (or a loop that arrived through sync)
}

export function wouldCreateReplaceLoop(id: number | undefined, replacedById: number | null, lookup: AssetLookup): boolean {
  let cur: number | null = replacedById;
  for (let i = 0; i <= MAX_DEPTH && cur !== null; i++) {
    if (id !== undefined && cur === id) return true;
    cur = lookup(cur)?.replacedById ?? null;
  }
  return cur !== null;
}

export function isSafeUrl(u: string): boolean {
  try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:'; } catch { return false; }
}

/** Soft hints that do not block saving. */
export function assetWarnings(d: Pick<AssetData, 'purchaseDate' | 'installDate'>): string[] {
  const w: string[] = [];
  if (d.purchaseDate && d.installDate && d.installDate < d.purchaseDate) w.push('The installed date is before the purchase date. Check both.');
  return w;
}

/**
 * The plain-words problem with an asset, or null. `id` is the asset being edited (undefined when creating). `lookup` finds LIVE assets only,
 * so a parent deleted on another device is refused here rather than stored.
 */
export function validateAsset(d: AssetData, id: number | undefined, lookup: AssetLookup): string | null {
  const name = tidy(d.name);
  if (!name) return 'Give it a name.';
  if (name.length > 120) return 'That name is too long.';
  if (!ASSET_TYPES.includes(d.type)) return 'Pick a type.';
  if (!ASSET_STATUSES.includes(d.status)) return 'Pick a status.';
  if (d.parentId !== null) {
    if (id !== undefined && d.parentId === id) return 'That would put it inside itself.';
    if (!lookup(d.parentId)) return 'The place you chose no longer exists. Pick another.';
    if (d.type === 'property') return 'A property sits at the top, so it cannot be inside something else.';
    if (wouldCreateCycle(id, d.parentId, lookup)) return 'That would put it inside itself, or nest it too deeply.';
  }
  if (d.status === 'replaced' && d.replacedById !== null) {
    if (id !== undefined && d.replacedById === id) return 'Pick the asset that replaced it, not itself.';
    if (!lookup(d.replacedById)) return 'The replacement you chose no longer exists. Pick another.';
    if (wouldCreateReplaceLoop(id, d.replacedById, lookup)) return 'That replacement chain loops back on itself.';
  }
  for (const [label, v] of [['status date', d.statusDate], ['purchase date', d.purchaseDate], ['installed date', d.installDate], ['warranty end date', d.warrantyEndDate]] as const) {
    if (v !== null && !isDate(v)) return `The ${label} is not a real date.`;
  }
  if (d.purchaseCents !== null && (!Number.isFinite(d.purchaseCents) || d.purchaseCents < 0)) return 'The price cannot be negative.';
  if (d.statusNote.length > 500 || d.warrantyNote.length > 500) return 'A note is too long (500 characters at most).';
  if (d.notes.length > 5000) return 'The notes are too long.';
  if (d.manufacturer.length > 80 || d.model.length > 80) return 'The make or model is too long.';
  if (d.serialNumber.length > 60) return 'The serial number is too long.';
  if (d.plate.length > 20) return 'The plate is too long.';
  if (d.address.length > 200) return 'The address is too long.';
  if (d.contacts.length > 20) return 'That is too many contacts (20 at most).';
  const seen = new Set<string>();
  for (const c of d.contacts) {
    if (c.role.length > 40) return 'A contact role is too long.';
    const k = `${c.contactId}|${c.role.toLowerCase()}`;
    if (seen.has(k)) return 'The same contact and role is listed twice.';
    seen.add(k);
  }
  if (d.specs.length > 30) return 'That is too many specs (30 at most).';
  for (const s of d.specs) {
    if (!tidy(s.label)) return 'Give each spec a label.';
    if (s.label.length > 40 || s.value.length > 200) return 'A spec is too long.';
  }
  if (d.refs.length > 20) return 'That is too many documents (20 at most).';
  for (const r of d.refs) {
    if (!tidy(r.label)) return 'Give each document a label.';
    if (r.label.length > 80 || (r.note?.length ?? 0) > 200) return 'A document label or note is too long.';
    if (r.url !== undefined && r.url !== '') {
      if (r.url.length > 500) return 'A link is too long.';
      if (!isSafeUrl(r.url)) return 'Links must start with http:// or https://.';
    }
  }
  return null;
}

/** Price text to cents: '' is "not set" (null); otherwise the amount, or undefined when it is not one. */
export function priceFromText(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const c = parseAmountToCents(text);
  return c === null ? undefined : c;
}
