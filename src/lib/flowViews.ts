import type { FlowDetail } from './flow';
import { RANGE_LABELS, type RangePreset } from './flowRange';

/**
 * Saved views for the flow diagram. A view remembers what you chose: net or gross, the period (a preset such as "Last 3 months"; custom
 * dates are kept separately and are not part of a view), the detail, and what you switched OFF. Storing what is off, not what is on, means a
 * category or account you add later shows up in your saved views instead of silently missing from them.
 */

export interface FlowViewState {
  view: 'net' | 'gross';
  preset: RangePreset;
  detail: FlowDetail;
  /** Filter keys switched off (see flow.ts). */
  off: string[];
  /** Ids of accounts switched off. */
  accountsOff: number[];
  /** Show entries filed under Initial setup (off unless chosen). */
  includeSetup?: boolean;
}

export interface SavedFlowView extends FlowViewState {
  id: string;
  name: string;
}

const MAX_NAME = 40;
const PRESETS = Object.keys(RANGE_LABELS);

const sortedStr = (xs: string[]) => [...xs].sort();
const sortedNum = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** Same choices? (Custom dates are not compared; they are not part of a view.) */
export function sameState(a: FlowViewState, b: FlowViewState): boolean {
  return (
    a.view === b.view &&
    a.preset === b.preset &&
    a.detail === b.detail &&
    JSON.stringify(sortedStr(a.off)) === JSON.stringify(sortedStr(b.off)) &&
    JSON.stringify(sortedNum(a.accountsOff)) === JSON.stringify(sortedNum(b.accountsOff)) &&
    !!a.includeSetup === !!b.includeSetup
  );
}

export const stateOf = (v: FlowViewState): FlowViewState => ({ view: v.view, preset: v.preset, detail: v.detail, off: [...v.off], accountsOff: [...v.accountsOff], ...(v.includeSetup ? { includeSetup: true } : {}) });

/** The accounts to count, given the ones switched off. Null means all of them. An account added since is counted. */
export function accountsFromOff(allIds: number[], off: number[]): Set<number> | null {
  const gone = new Set(off);
  const on = allIds.filter((id) => !gone.has(id));
  return on.length === allIds.length ? null : new Set(on);
}

export function offFromAccounts(allIds: number[], on: Set<number> | null): number[] {
  return on ? allIds.filter((id) => !on.has(id)) : [];
}

function parseState(r: unknown): FlowViewState | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if ((o.view !== 'net' && o.view !== 'gross') || typeof o.preset !== 'string' || !PRESETS.includes(o.preset)) return null;
  if (o.detail !== 'groups' && o.detail !== 'categories') return null;
  const strs = Array.isArray(o.off) ? o.off.filter((x): x is string => typeof x === 'string') : [];
  const nums = Array.isArray(o.accountsOff) ? o.accountsOff.filter((x): x is number => typeof x === 'number') : [];
  return { view: o.view, preset: o.preset as RangePreset, detail: o.detail, off: strs, accountsOff: nums, ...(o.includeSetup === true ? { includeSetup: true } : {}) };
}

/** Reads what was stored, ignoring anything damaged. */
export function parseViews(raw: unknown): SavedFlowView[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedFlowView[] = [];
  for (const r of raw) {
    const s = parseState(r);
    const o = r as { id?: unknown; name?: unknown };
    if (s && typeof o.id === 'string' && typeof o.name === 'string' && o.name.trim()) out.push({ ...s, id: o.id, name: o.name });
  }
  return out;
}

export function checkName(list: SavedFlowView[], name: string, exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the view a name.';
  if (n.length > MAX_NAME) return `Keep the name under ${MAX_NAME} characters.`;
  if (list.some((v) => v.id !== exceptId && v.name.toLowerCase() === n.toLowerCase())) return 'You already have a view with that name.';
  return null;
}

export function addView(list: SavedFlowView[], name: string, state: FlowViewState, id: string): SavedFlowView[] {
  return [...list, { ...stateOf(state), id, name: name.trim() }];
}
export const renameView = (list: SavedFlowView[], id: string, name: string): SavedFlowView[] => list.map((v) => (v.id === id ? { ...v, name: name.trim() } : v));
export const updateView = (list: SavedFlowView[], id: string, state: FlowViewState): SavedFlowView[] => list.map((v) => (v.id === id ? { ...v, ...stateOf(state) } : v));
export const removeView = (list: SavedFlowView[], id: string): SavedFlowView[] => list.filter((v) => v.id !== id);

export const newViewId = () => `v${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

// ---- what the page was showing last time (kept on this device only, custom dates included) ----

export interface LastFlow extends FlowViewState {
  customStart: string;
  customEnd: string;
  activeId: string | null;
}

export function parseLast(raw: unknown): LastFlow | null {
  const s = parseState(raw);
  if (!s) return null;
  const o = raw as { customStart?: unknown; customEnd?: unknown; activeId?: unknown };
  return {
    ...s,
    customStart: typeof o.customStart === 'string' ? o.customStart : '',
    customEnd: typeof o.customEnd === 'string' ? o.customEnd : '',
    activeId: typeof o.activeId === 'string' ? o.activeId : null,
  };
}
