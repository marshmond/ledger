import { describe, expect, it } from 'vitest';
import { moveBefore, nudge, sortByOrder } from './order';

describe('sortByOrder', () => {
  it('puts ordered records first, then unordered ones by id', () => {
    const items = [{ id: 5 }, { id: 2, order: 1 }, { id: 9, order: 0 }, { id: 3 }];
    expect(sortByOrder(items).map((i) => i.id)).toEqual([9, 2, 3, 5]);
  });
  it('does not change the list it is given', () => {
    const items = [{ id: 2, order: 1 }, { id: 1, order: 0 }];
    sortByOrder(items);
    expect(items.map((i) => i.id)).toEqual([2, 1]);
  });
});

describe('moveBefore', () => {
  it('moves up and down', () => {
    expect(moveBefore([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
    expect(moveBefore([1, 2, 3, 4], 1, 4)).toEqual([2, 3, 1, 4]);
  });
  it('puts it last with no target, or adds it to a list that lacked it', () => {
    expect(moveBefore([1, 2, 3], 1, null)).toEqual([2, 3, 1]);
    expect(moveBefore([2, 3], 7, 3)).toEqual([2, 7, 3]);
  });
});

describe('nudge', () => {
  it('swaps with the neighbour and stops at the ends', () => {
    expect(nudge([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(nudge([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(nudge([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(nudge([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
  });
});
