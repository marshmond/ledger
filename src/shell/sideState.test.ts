import { describe, expect, it } from 'vitest';
import { loadClosedGroups, saveClosedGroups, toggleGroup } from './sideState';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('collapsed sidebar groups', () => {
  it('toggles a group closed and open', () => {
    expect(toggleGroup([], 'money')).toEqual(['money']);
    expect(toggleGroup(['money', 'plan'], 'money')).toEqual(['plan']);
  });
  it('remembers the choice', () => {
    const s = store();
    expect(loadClosedGroups(s)).toEqual([]);
    saveClosedGroups(['invest', 'plan'], s);
    expect(loadClosedGroups(s)).toEqual(['invest', 'plan']);
  });
  it('ignores damaged storage and blocked storage', () => {
    expect(loadClosedGroups({ getItem: () => 'not json', setItem: () => undefined })).toEqual([]);
    expect(loadClosedGroups({ getItem: () => '{"a":1}', setItem: () => undefined })).toEqual([]);
    expect(loadClosedGroups({ getItem: () => '[1,"money"]', setItem: () => undefined })).toEqual(['money']);
    const blocked = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadClosedGroups(blocked)).toEqual([]);
    expect(() => saveClosedGroups(['a'], blocked)).not.toThrow();
  });
});
