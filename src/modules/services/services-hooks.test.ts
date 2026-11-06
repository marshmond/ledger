import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { allQuickAdds, allSearchSources, registerModule, type ModuleDef } from '../../core/registry';
import { registerModules } from '../index';
import { installTracking } from '../../lib/sync/track';
import { createStore } from '../../core/store';
import { blankArrangement, type ArrangementRecord, type Cadence } from './model';
import { createArrangement, loadArrangements } from './data';
import { servicesModule } from './index';
import { arrangementLabel, serviceRecords } from './records';
import { searchServicesData } from './searchSource';
import { parseServiceQuick } from './quickAddDef';
import { assetViews, buildOverview, buildProvider, loadSnapshot, providerList } from './views';
import { createAsset } from '../assets/data';
import { setAssetStatus } from '../assets/data';
import { blankAsset } from '../assets/model';
import { cadenceText } from './model';

let n = 0;
const fresh = () => { const d = new FinanceDB(`test-svc-hooks-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06'; // a Friday
const cad: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: TODAY };

const SECRETS = { phone: '555-0142-9999', email: 'rosa.secret@example.test', notes: 'spare key is under the blue pot', url: 'https://example.com/private-contract', cost: 98765 };
async function seededWithSecrets(d: FinanceDB) {
  return createArrangement({
    data: blankArrangement({ title: 'House cleaning', cadence: cad, notes: SECRETS.notes, refs: [{ label: 'Contract', url: SECRETS.url }], expected: { basis: 'perVisit', cents: SECRETS.cost } }),
    provider: { name: "Rosa's Cleaning", phone: SECRETS.phone, email: SECRETS.email }, today: TODAY,
  }, d);
}

describe('registration and prefix', () => {
  it('registers with the app, with the hs prefix and no clash with the other modules', () => {
    registerModules();
    const mine = allQuickAdds().filter((q) => q.moduleId === 'services');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ prefix: 'hs', aliases: ['household'] });
    const words = allQuickAdds().flatMap((q) => [q.prefix, ...(q.aliases ?? [])].map((w) => w.toLowerCase()));
    expect(new Set(words).size).toBe(words.length);
    expect(allSearchSources().some((s) => s.moduleId === 'services')).toBe(true);
    // a clash is refused at registration
    const clash: ModuleDef = { ...servicesModule, id: 'services-clash' };
    expect(() => registerModule(clash)).toThrow(/clashes/);
  });
  it('does not take over the words service or repair, which belong to Home & Assets', () => {
    const words = (allQuickAdds().find((q) => q.moduleId === 'services')!.aliases ?? []).concat('hs');
    expect(words).not.toContain('svc');
    expect(words).not.toContain('service');
    expect(words).not.toContain('repair');
  });
});

describe('search, labels and deep links', () => {
  it('finds arrangements and providers by name and shows only names, cadence and status; never phone, email, notes, links or amounts', async () => {
    const d = fresh();
    await seededWithSecrets(d);
    const all = await loadArrangements(d);
    const hits = searchServicesData("rosa", all);
    expect(hits.map((h) => h.kind).sort()).toEqual(['Provider', 'Service']);
    const svc = hits.find((h) => h.kind === 'Service')!;
    expect(svc.title).toBe('House cleaning');
    expect(svc.subtitle).toBe("Rosa's Cleaning · Every 2 weeks on Fri");
    expect(svc.path).toBe(`/services/a/${all[0].id}`);
    expect(hits.find((h) => h.kind === 'Provider')!.path).toBe(`/services/providers/${all[0].data.providerContactId}`);
    const blob = JSON.stringify(hits) + JSON.stringify(searchServicesData('clean', all)) + (await serviceRecords.search('clean')).map((c) => c.label).join('|') + arrangementLabel(all[0]);
    for (const s of Object.values(SECRETS)) expect(blob).not.toContain(String(s));
    expect(blob).not.toContain('blue pot');
    // notes and phone are not searchable either
    expect(searchServicesData('blue pot', all)).toEqual([]);
    expect(searchServicesData('555-0142', all)).toEqual([]);
    expect(searchServicesData('', all)).toEqual([]);
  });
  it('the record source describes, opens by id, and copes with a missing record', async () => {
    const d = fresh();
    await seededWithSecrets(d);
    const a = (await loadArrangements(d))[0];
    // serviceRecords reads the app database; here we check the pure parts it relies on
    expect(arrangementLabel(a)).toBe("House cleaning, Rosa's Cleaning");
    expect(await serviceRecords.describe('arrangement:1')).toBeNull();
    expect(await serviceRecords.describe('nonsense')).toBeNull();
  });
});

describe('Quick Add grammar and preview', () => {
  const p = (t: string, contacts: string[] = []) => parseServiceQuick(t, TODAY, contacts);
  it('reads what, who, how often, first date and time', () => {
    const q = p("House cleaning with Rosa's Cleaning every other friday at 9am", ["rosa's cleaning"])!;
    expect(q.data.title).toBe('House cleaning');
    expect(q.providerName).toBe("Rosa's Cleaning");
    expect(q.providerExists).toBe(true);
    expect(q.data.cadence).toMatchObject({ mode: 'fixed', rule: { freq: 'weekly', interval: 2, byWeekday: [5] } });
    expect(q.firstDate).toBe('2026-11-13'); // the next Friday strictly after today
    expect(q.data.visitTime).toBe('09:00');
    expect(cadenceText(q.data.cadence)).toBe('Every 2 weeks on Fri');
  });
  it('a weekly repeat with no weekday word uses the first date weekday explicitly', () => {
    const q = p('Pool service every 2 weeks')!;
    expect(q.firstDate).toBe(TODAY);
    expect(q.data.cadence!.rule.byWeekday).toEqual([5]);
  });
  it('no repeat means on demand, no provider means none yet, and plain turns the shorthand off', () => {
    const q = p('Furnace tune-up')!;
    expect(q.data.cadence).toBeNull();
    expect(q.providerName).toBe('');
    expect(q.firstDate).toBeNull();
    const plain = parseServiceQuick('Lawn with Green Co every monday', TODAY, [], true)!;
    expect(plain.data.title).toBe('Lawn with Green Co every monday');
    expect(plain.data.cadence).toBeNull();
    expect(p('   ')).toBeNull();
    expect(p('x'.repeat(250))).toBeNull();
  });
  it('a new provider is announced as new; a known one as existing', () => {
    expect(p('Gutters with Top Test Gutters')!.providerExists).toBe(false);
    expect(p('Gutters with Top Test Gutters', ['TOP TEST GUTTERS'])!.providerExists).toBe(true);
  });
});

describe('read models, assets and providers', () => {
  it('shows linked asset name, type and status; handles retired and removed assets', async () => {
    const d = fresh();
    const house = await createAsset(blankAsset({ name: 'Main house', type: 'property' }), d);
    const furnace = await createAsset(blankAsset({ name: 'Furnace', type: 'system', parentId: house }), d);
    const furnace2 = await createAsset(blankAsset({ name: 'Furnace 2', type: 'system', parentId: house }), d);
    await createArrangement({ data: blankArrangement({ title: 'Furnace service' }), provider: { name: 'Heat Test Co' }, assetIds: [house, furnace], today: TODAY }, d);
    await setAssetStatus(furnace, { status: 'replaced', statusDate: TODAY, statusNote: '', replacedById: furnace2 }, d);
    const snap = await loadSnapshot(d);
    const views = assetViews([house, furnace, 424242], snap.assets);
    expect(views[0]).toMatchObject({ name: 'Main house', typeLabel: 'Property', statusLabel: 'In use', past: false, missing: false });
    expect(views[1]).toMatchObject({ name: 'Main house > Furnace', statusLabel: 'Replaced', past: true, replacedBy: 'Main house > Furnace 2' });
    expect(views[2]).toMatchObject({ missing: true });
    const ov = buildOverview(snap);
    expect(ov.attention.map((a) => a.text).join(' ')).toMatch(/serves "Main house > Furnace", which is replaced/);
    expect(ov.attention.find((a) => /replaced/.test(a.text))!.hint).toMatch(/Replaced by/);
  });
  it('overview: no provider, nothing scheduled, and provider page lists active, past and assets', async () => {
    const d = fresh();
    await createArrangement({ data: blankArrangement({ title: 'Gutters' }), provider: null, today: TODAY }, d);
    const sched = await createArrangement({ data: blankArrangement({ title: 'Cleaning', cadence: cad }), provider: { name: 'Clean Test Co' }, today: TODAY, scheduleFirstVisit: false }, d);
    const snap = await loadSnapshot(d);
    const ov = buildOverview(snap);
    const text = ov.attention.map((a) => a.text);
    expect(text).toContain('Gutters: no provider yet');
    expect(text).toContain('Cleaning: Nothing is scheduled');
    const prov = buildProvider(snap, (await loadArrangements(d)).find((a) => a.id === sched.id)!.data.providerContactId!);
    expect(prov.name).toBe('Clean Test Co');
    expect(prov.active).toHaveLength(1);
    expect(providerList(snap)).toEqual([expect.objectContaining({ name: 'Clean Test Co', active: 1, total: 1 })]);
  });
  it('a removed provider contact leaves the saved name on the row', async () => {
    const d = fresh();
    const r = await createArrangement({ data: blankArrangement({ title: 'Cleaning' }), provider: { name: 'Gone Test Co' }, today: TODAY }, d);
    await createStore(d).shared.contacts.remove(r.contactId!);
    const snap = await loadSnapshot(d);
    const row = buildOverview(snap).rows[0];
    expect(row.contactGone).toBe(true);
    expect(buildProvider(snap, r.contactId!).name).toBe('Gone Test Co');
  });
  it('the module reader is pure over the arrangement records it is given', () => {
    const a = { id: 1, createdAt: 1, updatedAt: 1, data: blankArrangement({ title: 'X' }) } as ArrangementRecord;
    expect(searchServicesData('x', [a]).some((h) => h.id === 'arrangement:1')).toBe(true);
  });
});
