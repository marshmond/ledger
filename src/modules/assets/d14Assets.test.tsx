import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blankAsset, STATUS_LABEL, TYPE_LABEL, type AssetData, type AssetRecord } from './model';
import { topLevelPlaces, WARRANTY_TONE } from './presentation';

/** D14 Home & Assets redesign: the places grouping uses the asset's own parent only, every card and action survives, and nothing new is worked out. Invented data only. */
const read = (p: string) => readFileSync(`src/modules/assets/${p}`, 'utf8');
const rec = (id: number, over: Partial<AssetData>): AssetRecord => ({ id, data: blankAsset({ name: `Asset ${id}`, ...over }) } as unknown as AssetRecord);

describe('places and assets (the overview panel)', () => {
  const house = rec(1, { type: 'property', name: 'House' });
  const furnace = rec(2, { type: 'system', parentId: 1 });
  const oven = rec(3, { type: 'appliance', parentId: 1 });
  const car = rec(4, { type: 'vehicle', name: 'Car' });
  const oldTv = rec(5, { type: 'appliance', parentId: 1, status: 'disposed' });
  const stored = rec(6, { type: 'appliance', parentId: 1, status: 'stored' });
  const archived = rec(7, { type: 'appliance', parentId: 1, archived: true });
  const all = [house, furnace, oven, car, oldTv, stored, archived];

  it('lists only the in-use assets that have no place above them', () => {
    expect(topLevelPlaces(all).map((p) => p.asset.id)).toEqual([1, 4]);
  });

  it('counts only live in-use assets directly inside each place: past, stored and archived ones are not counted', () => {
    const by = new Map(topLevelPlaces(all).map((p) => [p.asset.id, p.inside]));
    expect(by.get(1)).toBe(2);
    expect(by.get(4)).toBe(0);
  });

  it('does not count things further down, and groups by the asset\'s own parent, never by a name or an address', () => {
    const bulb = rec(8, { type: 'other', parentId: 2 });
    expect(topLevelPlaces([...all, bulb]).find((p) => p.asset.id === 1)!.inside).toBe(2);
    const sameNameElsewhere = rec(9, { type: 'property', name: 'House', address: '1 Sample Lane (fictional)' });
    const places = topLevelPlaces([...all, sameNameElsewhere]);
    expect(places.map((p) => p.asset.id)).toEqual([1, 4, 9]);
    expect(places.find((p) => p.asset.id === 9)!.inside).toBe(0); // same name and address text do not make it the same place
  });

  it('an asset whose place has been removed is shown as top level rather than lost', () => {
    const lost = rec(10, { type: 'appliance', parentId: 999 });
    expect(topLevelPlaces([house, lost]).map((p) => p.asset.id)).toEqual([1, 10]);
  });

  it('no assets gives no places', () => {
    expect(topLevelPlaces([])).toEqual([]);
  });

  it('is a pure reading: it neither changes the records it is given nor reads a database', () => {
    const before = JSON.stringify(all);
    topLevelPlaces(all);
    expect(JSON.stringify(all)).toBe(before);
    const src = read('presentation.ts');
    expect(src).not.toMatch(/from '\.\.\/\.\.\/(db|core\/store)'/);
    expect(src).not.toMatch(/\.(put|add|update|delete|bulkAdd)\(/);
  });
});

describe('warranty chips', () => {
  it('each warranty tone has a chip tone, and the label words always come with it', () => {
    expect(WARRANTY_TONE).toEqual({ ok: 'active', soon: 'warning', past: 'overdue' });
    const list = read('AssetsPage.tsx');
    expect(list).toContain('<StatusChip tone={WARRANTY_TONE[w.tone]}>{w.label}</StatusChip>');
  });
});

describe('the asset list keeps its tabs, filters, tree and rows', () => {
  const page = read('AssetsPage.tsx');

  it('keeps all five tabs, the kind-of-past filter and the type, find and flat-list controls', () => {
    for (const label of ["'In use'", "'Stored'", "'Past'", "'Archived'", "'All'"]) expect(page).toContain(label);
    for (const text of ['Kind of past asset', 'Sold', 'Disposed of', 'Replaced', 'Name, make or model', 'All types', 'Flat list']) expect(page).toContain(text);
    expect(page).toContain('role="tablist"');
  });

  it('keeps the tree, the fold buttons and the orphan card', () => {
    expect(page).toContain('buildTree');
    expect(page).toContain('what is inside');
    expect(page).toContain('<OrphanCard />');
    expect(page).toContain('(place removed)');
  });

  it('keeps the add action and its address (?new=1) and opens an asset at its own address', () => {
    expect(page).toContain("setParams({ new: '1' })");
    expect(page).toContain('to={`/${a.id}`}');
  });

  it('shows every status word from the model, not just a color', () => {
    for (const s of Object.keys(STATUS_LABEL)) expect(STATUS_LABEL[s as keyof typeof STATUS_LABEL]).toBeTruthy();
    expect(page).toContain('{STATUS_LABEL[a.data.status]}');
    expect(page).toContain('{TYPE_LABEL[a.data.type]}');
    expect(Object.keys(TYPE_LABEL).length).toBeGreaterThan(3);
  });
});

describe('the asset page keeps every card and action', () => {
  const page = read('AssetPage.tsx');

  it('still has Details, maintenance and history, service links, spending, warranty, contacts, documents, inside, related projects and linked work', () => {
    for (const tag of ['<AssetWork', '<AssetServicesCard', '<SpendingCard', '<WarrantyCard', '<RelatedProjects', '<LinkedWork', '<NetWorthEntry', '<SensitiveValue']) expect(page).toContain(tag);
    for (const id of ['as-details-h', 'as-contacts-h', 'as-docs-h', 'as-inside-h']) expect(page).toContain(id);
  });

  it('keeps Edit, Status, Replace, Archive and Delete with their own dialogs', () => {
    for (const text of ['>Edit</button>', 'Status…', 'Replace…', 'Delete…', 'toggleArchive']) expect(page).toContain(text);
    for (const tag of ['<AssetForm', '<LifecycleDialog', '<DeleteAsset']) expect(page).toContain(tag);
  });

  it('keeps the serial number, VIN, plate and address behind the reveal control', () => {
    expect(page).toMatch(/<SensitiveValue label=\{d\.type === 'vehicle' \? 'VIN' : 'Serial number'\}/);
    expect(page).toContain('<SensitiveValue label="Plate"');
    expect(page).toContain('<SensitiveValue label="Address"');
  });

  it('keeps the lifecycle notes: no longer in use, in storage, replaced by, replaces', () => {
    for (const text of ['No longer in use:', 'In storage', 'Replaced by', 'Replaces']) expect(page).toContain(text);
  });

  it('keeps maintenance, services, tasks and projects as separate cards: the page merges nothing and creates no task', () => {
    expect(page).not.toMatch(/createTask|createService|createArrangement|addMaintenance\(/);
    expect(page).toContain('<AssetWork');
    expect(page).toContain('<AssetServicesCard');
  });

  it('uses the shared date tile and status chip, and has a jump row for narrow screens', () => {
    expect(page).toContain("from '../../ui/DateTile'");
    expect(page).toContain("from '../../ui/StatusChip'");
    expect(page).toContain('aria-label="On this page"');
  });
});

describe('the overview keeps its lists and links', () => {
  const page = read('OverviewPage.tsx');

  it('keeps every section it had, and the Add asset and All assets actions', () => {
    for (const text of ['Needs attention', 'Upcoming maintenance', 'Warranties ending soon', 'Recent service history', '<SpendingBlock', 'All assets', 'Add asset', 'Start with your home']) expect(page).toContain(text);
  });

  it('the band shows only counts of lists that are on the page: it computes nothing new', () => {
    expect(page).toContain('ov.counts.total');
    expect(page).toContain('rows.length');
    expect(page).toContain('ov.upcomingTotal');
    expect(page).toContain('ov.attention.expiringWarranties.length');
    expect(page).not.toContain('.reduce(');
    expect(page).not.toMatch(/Cents\s*[-+*/]\s*\w/);
  });

  it('upcoming maintenance still links to the task and the asset, and recent history to the service record', () => {
    expect(page).toContain('href={`#/tasks?task=${m.taskId}`}');
    expect(page).toContain('to={`/${m.assetIds[0]}`}');
    expect(page).toContain('?service=${s.id}');
  });

  it('writes nothing while rendering', () => {
    expect(page).not.toMatch(/\.(put|add|update|delete|bulkAdd)\(|createTask|createService/);
  });
});

describe('the stylesheet: layout, phone behavior and tokens', () => {
  const css = read('assets.css');

  it('is two columns on a wide screen and one on a narrow one, with the jump row shown only when narrow', () => {
    expect(css).toMatch(/\.as-layout \{[^}]*grid-template-columns: minmax\(0, 1\.6fr\) minmax\(0, 1fr\)/);
    expect(css).toMatch(/@media \(max-width: 1000px\) \{[\s\S]*?\.as-layout, \.as-ov-layout \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(css).toMatch(/\.as-jump \{ display: none;/);
    expect(css).toMatch(/@media \(max-width: 1000px\) \{[\s\S]*?\.as-jump \{ display: inline-flex; \}/);
  });

  it('long names wrap and phone buttons are at least 44px tall', () => {
    expect(css).toMatch(/\.as-row-main strong \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.as-hero-text h1 \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.as-head-actions \.btn[^}]*min-height: 44px/);
  });

  it('adds no !important', () => {
    expect(css).not.toContain('!important');
  });
});
