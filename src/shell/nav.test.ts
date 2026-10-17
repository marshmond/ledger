import { describe, expect, it } from 'vitest';
import { ALL_ITEMS, GROUPS, crumbsFor, groupForPath } from './nav';

describe('navigation map', () => {
  it('every page is in exactly one group and paths are unique', () => {
    const paths = ALL_ITEMS.map((i) => i.to);
    expect(new Set(paths).size).toBe(paths.length);
  });
  it('keeps every page that existed before the redesign at its old address', () => {
    for (const p of ['/transactions', '/budget', '/income', '/paycheck', '/investments', '/projections', '/retirement', '/goals', '/roth', '/debt', '/scheduled', '/import', '/categories', '/backup']) {
      expect(ALL_ITEMS.some((i) => i.to === p)).toBe(true);
    }
  });
  it('the bottom tab bar has five tabs', () => {
    expect(GROUPS).toHaveLength(5);
  });
  it('finds the group of a path, including account ledgers', () => {
    expect(groupForPath('/').id).toBe('home');
    expect(groupForPath('/budget').id).toBe('money');
    expect(groupForPath('/account/12').id).toBe('money');
    expect(groupForPath('/debt').id).toBe('invest');
    expect(groupForPath('/roth').id).toBe('plan');
    expect(groupForPath('/backup').id).toBe('more');
    expect(groupForPath('/nowhere').id).toBe('home');
    expect(groupForPath('/budget/').id).toBe('money');
  });
  it('builds breadcrumbs', () => {
    expect(crumbsFor('/')).toEqual([]);
    expect(crumbsFor('/budget')).toEqual([{ label: 'Money', to: '/accounts' }, { label: 'Budget' }]);
    expect(crumbsFor('/account/3', 'Checking')).toEqual([{ label: 'Money', to: '/accounts' }, { label: 'Accounts', to: '/accounts' }, { label: 'Checking' }]);
    expect(crumbsFor('/more')).toEqual([{ label: 'More', to: '/more' }, { label: 'Settings' }]);
  });
});
