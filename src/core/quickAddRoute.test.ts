import { describe, expect, it } from 'vitest';
import { routeQuickAdd } from './quickAddRoute';

const defs = [
  { id: 'task', prefix: 't', aliases: ['task'] },
  { id: 'event', prefix: 'e', aliases: ['event'] },
  { id: 'transaction', prefix: '$', aliases: ['txn', 'transaction'] },
];

describe('which destination did the text ask for', () => {
  it('short shortcuts pick a destination and are removed', () => {
    expect(routeQuickAdd('t buy milk fri', defs)).toMatchObject({ def: { id: 'task' }, rest: 'buy milk fri' });
    expect(routeQuickAdd('e lunch 12-1pm', defs)).toMatchObject({ def: { id: 'event' }, rest: 'lunch 12-1pm' });
    expect(routeQuickAdd('$ coffee 4.50', defs)).toMatchObject({ def: { id: 'transaction' }, rest: 'coffee 4.50' });
  });
  it('whole words work too, with or without a colon, in any case', () => {
    expect(routeQuickAdd('task buy milk', defs).def?.id).toBe('task');
    expect(routeQuickAdd('Event: dentist', defs)).toMatchObject({ def: { id: 'event' }, rest: 'dentist' });
    expect(routeQuickAdd('TXN coffee', defs).def?.id).toBe('transaction');
    expect(routeQuickAdd('T buy milk', defs).def?.id).toBe('task');
  });
  it('text with no shortcut picks nothing, so the box asks', () => {
    expect(routeQuickAdd('buy milk friday', defs)).toEqual({ def: null, rest: 'buy milk friday' });
    expect(routeQuickAdd('', defs).def).toBeNull();
  });
  it('a shortcut needs a space after it, so ordinary words that start with one are left alone', () => {
    expect(routeQuickAdd('tomorrow call mom', defs).def).toBeNull();
    expect(routeQuickAdd('t', defs).def).toBeNull();
    expect(routeQuickAdd('$5 coffee', defs).def).toBeNull();
    expect(routeQuickAdd('every week', defs).def).toBeNull();
  });
  it('only the first word counts', () => {
    expect(routeQuickAdd('buy t shirt', defs).def).toBeNull();
  });
  it('a bare shortcut and a space is a destination with nothing typed yet', () => {
    expect(routeQuickAdd('e ', defs)).toMatchObject({ def: { id: 'event' }, rest: '' });
  });
});
