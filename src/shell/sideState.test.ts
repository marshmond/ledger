import { describe, expect, it } from 'vitest';
import { loadOpenGroup, saveOpenGroup, toggleGroup } from './sideState';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('sidebar groups (one open at a time)', () => {
  it('opening a group closes the one that was open, and clicking the open one closes it', () => {
    expect(toggleGroup(null, 'money')).toBe('money');
    expect(toggleGroup('money', 'invest')).toBe('invest');
    expect(toggleGroup('invest', 'invest')).toBeNull();
  });
  it('starts collapsed and remembers the choice', () => {
    const s = store();
    expect(loadOpenGroup(s)).toBeNull();
    saveOpenGroup('invest', s);
    expect(loadOpenGroup(s)).toBe('invest');
    saveOpenGroup(null, s);
    expect(loadOpenGroup(s)).toBeNull();
  });
  it('ignores blocked storage', () => {
    const blocked = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadOpenGroup(blocked)).toBeNull();
    expect(() => saveOpenGroup('money', blocked)).not.toThrow();
  });
});
