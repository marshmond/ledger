import { describe, expect, it } from 'vitest';
import { CARD_IDS, DEFAULT_LAYOUT, addCard, moveCard, removeCard, sanitizeLayout, toggleSize } from './homeLayout';

const ids = (l: { id: string }[]) => l.map((c) => c.id);

describe('home layout', () => {
  it('default layout lists every card once', () => {
    expect(ids(DEFAULT_LAYOUT).sort()).toEqual([...CARD_IDS].sort());
  });

  it('sanitize drops unknown and repeated cards and fixes sizes', () => {
    const out = sanitizeLayout([{ id: 'goals', size: 'full' }, { id: 'nope', size: 'half' }, { id: 'goals', size: 'half' }, { id: 'recent', size: 'huge' }, 7, null]);
    expect(out).toEqual([{ id: 'goals', size: 'full' }, { id: 'recent', size: 'half' }]);
  });

  it('sanitize falls back to the default for junk, but keeps an empty list empty', () => {
    expect(ids(sanitizeLayout('x'))).toEqual(ids(DEFAULT_LAYOUT));
    expect(sanitizeLayout([])).toEqual([]);
  });

  it('moves a card and stops at the ends', () => {
    const l = [{ id: 'a', size: 'half' as const }, { id: 'b', size: 'half' as const }, { id: 'c', size: 'half' as const }];
    expect(ids(moveCard(l, 'b', -1))).toEqual(['b', 'a', 'c']);
    expect(ids(moveCard(l, 'b', 1))).toEqual(['a', 'c', 'b']);
    expect(moveCard(l, 'a', -1)).toBe(l);
    expect(moveCard(l, 'c', 1)).toBe(l);
  });

  it('removes, adds (once, known cards only) and toggles width', () => {
    const l = removeCard(DEFAULT_LAYOUT, 'goals');
    expect(ids(l)).not.toContain('goals');
    const back = addCard(l, 'goals');
    expect(back[back.length - 1]).toEqual({ id: 'goals', size: 'half' });
    expect(addCard(back, 'goals')).toBe(back);
    expect(addCard(back, 'bogus')).toBe(back);
    expect(toggleSize([{ id: 'recent', size: 'half' }], 'recent')[0].size).toBe('full');
  });
});
