import { describe, expect, it } from 'vitest';
import { accountsFromOff, addView, checkName, offFromAccounts, parseLast, parseViews, removeView, renameView, sameState, stateOf, updateView, type FlowViewState } from './flowViews';

const base: FlowViewState = { view: 'net', preset: 'last3', detail: 'groups', off: ['c11', 'loan'], accountsOff: [4, 2] };

describe('saved flow views', () => {
  it('saves a copy of the choices, so later changes do not alter the view', () => {
    const state = { ...base, off: [...base.off] };
    const list = addView([], '  No mortgage ', state, 'a1');
    state.off.push('c99');
    expect(list).toEqual([{ ...base, id: 'a1', name: 'No mortgage' }]);
  });
  it('compares choices regardless of order, and ignores custom dates', () => {
    expect(sameState(base, { ...base, off: ['loan', 'c11'], accountsOff: [2, 4] })).toBe(true);
    expect(sameState(base, { ...base, detail: 'categories' })).toBe(false);
    expect(sameState(base, { ...base, off: ['c11'] })).toBe(false);
    expect(sameState(base, { ...base, view: 'gross' })).toBe(false);
    expect(sameState(base, { ...base, preset: 'custom' })).toBe(false);
  });
  it('renames, updates, and deletes one view', () => {
    let list = addView(addView([], 'A', base, '1'), 'B', base, '2');
    list = renameView(list, '2', ' Card only ');
    list = updateView(list, '1', { ...base, detail: 'categories', off: [] });
    expect(list.map((v) => v.name)).toEqual(['A', 'Card only']);
    expect(list[0]).toMatchObject({ detail: 'categories', off: [], id: '1', name: 'A' });
    expect(list[1].detail).toBe('groups');
    expect(removeView(list, '1').map((v) => v.id)).toEqual(['2']);
  });
  it('validates names', () => {
    const list = addView([], 'Monthly', base, '1');
    expect(checkName(list, '')).toBe('Give the view a name.');
    expect(checkName(list, '   ')).toBe('Give the view a name.');
    expect(checkName(list, 'x'.repeat(41))).toMatch(/under 40/);
    expect(checkName(list, 'monthly')).toBe('You already have a view with that name.');
    expect(checkName(list, 'monthly', '1')).toBeNull(); // renaming a view to itself
    expect(checkName(list, 'Yearly')).toBeNull();
  });
});

describe('accounts in a view', () => {
  it('stores what is off, so an account added later is counted', () => {
    expect(offFromAccounts([1, 2, 3], new Set([1, 3]))).toEqual([2]);
    expect(offFromAccounts([1, 2, 3], null)).toEqual([]);
    expect(accountsFromOff([1, 2, 3], [2])).toEqual(new Set([1, 3]));
    expect(accountsFromOff([1, 2, 3, 9], [2])).toEqual(new Set([1, 3, 9]));
    expect(accountsFromOff([1, 2, 3], [])).toBeNull();
    expect(accountsFromOff([1, 2, 3], [7])).toBeNull(); // a deleted account is simply gone
  });
});

describe('reading stored data', () => {
  it('keeps good views and drops damaged ones', () => {
    const good = { ...base, id: 'a', name: 'Good' };
    expect(parseViews([good, { ...good, id: 5 }, { ...good, preset: 'someday' }, { ...good, name: '  ' }, null, 'x', { ...good, id: 'b', off: ['c1', 7], accountsOff: [1, 'z'] }]))
      .toEqual([good, { ...good, id: 'b', off: ['c1'], accountsOff: [1] }]);
    expect(parseViews(undefined)).toEqual([]);
    expect(parseViews({ not: 'a list' })).toEqual([]);
  });
  it('remembers the last settings on this device, including custom dates', () => {
    const l = parseLast({ view: 'gross', preset: 'custom', detail: 'categories', off: ['c1'], accountsOff: [1, 2], customStart: '2026-01-01', customEnd: '2026-02-01', activeId: 'v1' });
    expect(l).toEqual({ view: 'gross', preset: 'custom', detail: 'categories', off: ['c1'], accountsOff: [1, 2], customStart: '2026-01-01', customEnd: '2026-02-01', activeId: 'v1' });
    expect(parseLast({ view: 'net', preset: 'last3', detail: 'groups' })).toEqual({ view: 'net', preset: 'last3', detail: 'groups', off: [], accountsOff: [], customStart: '', customEnd: '', activeId: null });
    expect(parseLast(null)).toBeNull();
    expect(parseLast({ view: 'x' })).toBeNull();
  });
  it('stateOf copies', () => {
    const s = stateOf({ ...base, off: ['a'] } as FlowViewState);
    expect(s).toEqual({ ...base, off: ['a'] });
  });
});

describe('initial setup in a view', () => {
  it('is off unless chosen, and is part of what a view remembers', () => {
    const on = { ...base, includeSetup: true };
    expect(sameState(base, { ...base, includeSetup: false })).toBe(true);
    expect(sameState(base, on)).toBe(false);
    expect(stateOf(on).includeSetup).toBe(true);
    expect('includeSetup' in stateOf(base)).toBe(false);
    const [v] = parseViews([{ ...on, id: 'a', name: 'With setup' }]);
    expect(v.includeSetup).toBe(true);
    expect(parseLast({ ...on })?.includeSetup).toBe(true);
  });
});
