import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FinanceDB } from '../db';
import { repo } from '../core/store';
import type { ModuleRecord } from '../core/entities';
import { allDocumentSources, allTodayCards } from '../core/registry';
import { expiryState, filterRefs, makeRefs, recordsPath, refMatches, sortRefs } from '../core/documentRefs';
import { documentHits, loadDocumentIndex, type DocumentIndex } from '../shell/recordsIndex';
import { registerModules } from './index';
import { parseHtml, textOf } from '../lib/a11yTestkit';
import { digest } from './household/householdSeed';
import { fresh, monthly, ob } from './bills/billsTestkit';
import { createObligation } from './bills/data';
import { archiveAsset, createAsset } from './assets/data';
import { blankAsset } from './assets/model';
import { blankService } from './assets/service';
import { insertService } from './assets/serviceData';
import { blankWarranty } from './assets/warranty';
import { createWarranty } from './assets/warrantyData';
import { readAssetDocs } from './assets/docRefs';
import { createArrangement } from './services/data';
import { blankArrangement } from './services/model';
import { blankVisit } from './services/visitModel';
import { readServiceDocs } from './services/docRefs';
import { readBillDocs } from './bills/docRefs';

/**
 * R4.1 Records Index against one small invented household: the three module readers, identity, search and filters, warranty gaps, unsafe links, navigation targets, a failed source,
 * and "reading changes nothing". Today is 2026-11-16. Every name, link and date is made up.
 */
registerModules();
const TODAY = '2026-11-16';
let d: FinanceDB;
const ids: Record<string, number> = {};

const link = (label: string, url?: string, note?: string) => ({ label, ...(url ? { url } : {}), ...(note ? { note } : {}) });
const rawPut = (module: string, kind: string, data: Record<string, unknown>) => repo<ModuleRecord>(d.moduleRecords).put({ module, kind, data });

beforeAll(async () => {
  d = fresh('records');
  // Home & Assets: a house with a kitchen and a dishwasher; a fridge and an old washer; a garage door whose saved link is not a web address.
  const house = await createAsset(blankAsset({ name: 'Maple House', type: 'property', address: '1 Invented Lane' }), d);
  const kitchen = await createAsset(blankAsset({ name: 'Kitchen', type: 'area', parentId: house }), d);
  ids.dishwasher = await createAsset(blankAsset({ name: 'Dishwasher', type: 'appliance', parentId: kitchen, serialNumber: 'SN-SECRET-123', refs: [link('Installation manual', 'https://docs.example.com/dw-manual', 'PDF, 40 pages')] }), d);
  ids.fridge = await createAsset(blankAsset({ name: 'Fridge', type: 'appliance', parentId: kitchen, refs: [link('Installation manual', 'https://docs.example.com/fridge-manual')] }), d);
  ids.washer = await createAsset(blankAsset({ name: 'Old washer', type: 'appliance' }), d);
  ids.legacy = await createAsset(blankAsset({ name: 'Boiler', type: 'system', warrantyEndDate: '2027-03-01' }), d); // only the old single warranty date, no warranty record
  ids.garage = await createAsset(blankAsset({ name: 'Garage door', type: 'system' }), d);
  // The save form refuses these, so they are written straight into the record (as a sync from another device or an older version could leave them).
  const g = (await d.moduleRecords.get(ids.garage))!;
  await d.moduleRecords.update(ids.garage, { data: { ...(g.data as object), refs: [link('Install quote', 'javascript:alert(1)'), link('Spec sheet', 'data:text/html,<b>x</b>'), link('Opener photo', 'HTTPS://Photos.Example.com/door'), link('Relative', '/x/y')] } });

  ids.wDish = await createWarranty(blankWarranty(ids.dishwasher, { title: 'Manufacturer warranty', endDate: '2026-12-25', refs: [link('Warranty card', 'https://example.com/dw-warranty')] }), d);
  ids.wDishExt = await createWarranty(blankWarranty(ids.dishwasher, { title: 'Extended warranty', endDate: '2028-01-01' }), d); // no document: a gap
  ids.wFridgeEnded = await createWarranty(blankWarranty(ids.fridge, { title: 'Manufacturer warranty', endDate: '2026-01-01' }), d); // ended: no gap
  ids.wFridgeNoEnd = await createWarranty(blankWarranty(ids.fridge, { title: 'Parts cover', endDate: null }), d); // no end date: still a gap
  ids.wWasher = await createWarranty(blankWarranty(ids.washer, { title: 'Manufacturer warranty', endDate: '2027-06-01' }), d);
  await archiveAsset(ids.washer, d); // archived: its warranty without a document is not a gap
  ids.svc = await insertService(blankService(ids.dishwasher, { title: 'Replace filter', date: '2026-09-02', kind: 'maintenance', refs: [link('Invoice', undefined, 'paper copy in the kitchen drawer')] }), d, TODAY);

  // Household Services: a weekly cleaning arrangement and one logged visit.
  const clean = await createArrangement({ data: blankArrangement({ title: 'Weekly cleaning', providerNameSnapshot: 'Sparkle Clean', refs: [link('Service agreement', 'https://example.com/sparkle-agreement')] }), today: TODAY, scheduleFirstVisit: false }, d);
  ids.clean = clean.id;
  ids.visit = await rawPut('services', 'visit', blankVisit({ arrangementId: clean.id, title: 'Deep clean', date: '2026-11-02', providerNameSnapshot: 'Sparkle Clean', refs: [link('Invoice', 'https://example.com/sparkle-invoice')] }) as unknown as Record<string, unknown>) as number;

  // Bills & Subscriptions: a subscription and a utility bill.
  ids.streamly = (await createObligation({ data: ob({ title: 'Streamly', type: 'subscription', schedule: monthly(15), refs: [link('Terms of service', 'https://example.com/streamly-terms')] }), today: TODAY }, d)).id;
  ids.power = (await createObligation({ data: ob({ title: 'Example Power Co', type: 'utility', refs: [link('Installation manual', 'https://example.com/power'), link('Account letter')] }), today: TODAY }, d)).id;
});

const sources = () => allDocumentSources().map((s) => ({ moduleId: s.moduleId, source: { label: s.source.label, read: () => (s.moduleId === 'assets' ? readAssetDocs({ today: TODAY }, d) : s.moduleId === 'services' ? readServiceDocs(undefined, d) : readBillDocs(undefined, d)) } }));
let index: DocumentIndex;
beforeAll(async () => { index = await loadDocumentIndex(TODAY, sources()); });
const find = (label: string, owner: string) => index.refs.find((r) => r.label === label && r.ownerName === owner)!;

describe('the three modules offer one reader each', () => {
  it('Home & Assets, Household Services and Bills register a document reader, and nothing else does', () => {
    expect(allDocumentSources().map((s) => s.moduleId)).toEqual(['assets', 'services', 'bills']);
    expect(allDocumentSources().map((s) => s.source.label)).toEqual(['Home & Assets', 'Household Services', 'Bills & Subscriptions']);
    expect(index.complete).toBe(true);
  });
});

describe('Home & Assets references', () => {
  it('an asset, a warranty and a service record each contribute, with their own owner', () => {
    const manual = find('Installation manual', 'Dishwasher');
    expect(manual).toMatchObject({ moduleId: 'assets', recordKind: 'Appliance', recordName: '', context: 'Maple House > Kitchen', link: 'open', href: 'https://docs.example.com/dw-manual', host: 'docs.example.com', note: 'PDF, 40 pages', expires: null, recordPath: `/assets/${ids.dishwasher}`, recordAction: 'View appliance' });
    const card = find('Warranty card', 'Dishwasher');
    expect(card).toMatchObject({ recordKind: 'Warranty', recordName: 'Manufacturer warranty', expires: { date: '2026-12-25', label: 'Warranty ends' }, recordPath: `/assets/${ids.dishwasher}?warranty=${ids.wDish}`, recordAction: 'View appliance' });
    const invoice = find('Invoice', 'Dishwasher');
    expect(invoice).toMatchObject({ recordKind: 'Service record', recordName: 'Replace filter', link: 'label-only', href: null, host: '', note: 'paper copy in the kitchen drawer', expires: null, recordPath: `/assets/${ids.dishwasher}?service=${ids.svc}` });
  });
  it('a sensitive asset field never reaches a row', () => {
    const text = JSON.stringify(index.refs) + JSON.stringify(index.gaps);
    expect(text).not.toContain('SN-SECRET-123');
    expect(text).not.toContain('1 Invented Lane');
  });
  it('the asset’s old single warranty date is not turned into a document or an expiration', () => {
    expect(index.refs.some((r) => r.ownerName === 'Boiler')).toBe(false);
    expect(index.refs.every((r) => r.expires === null || r.recordKind === 'Warranty')).toBe(true);
  });
});

describe('Household Services references', () => {
  it('an arrangement and a visit contribute, each pointing at its own record', () => {
    expect(find('Service agreement', 'Weekly cleaning')).toMatchObject({ moduleId: 'services', recordKind: 'Arrangement', context: 'Sparkle Clean', recordPath: `/services/a/${ids.clean}`, recordAction: 'View arrangement', href: 'https://example.com/sparkle-agreement' });
    expect(find('Invoice', 'Weekly cleaning')).toMatchObject({ recordKind: 'Visit', recordName: 'Deep clean', recordPath: `/services/v/${ids.visit}`, recordAction: 'View visit' });
  });
});

describe('Bills & Subscriptions references', () => {
  it('a subscription and a bill contribute, worded for what they are', () => {
    expect(find('Terms of service', 'Streamly')).toMatchObject({ moduleId: 'bills', recordKind: 'Subscription', recordPath: `/bills/o/${ids.streamly}`, recordAction: 'View subscription' });
    expect(find('Installation manual', 'Example Power Co')).toMatchObject({ recordKind: 'Bill', recordAction: 'View bill', recordPath: `/bills/o/${ids.power}` });
    expect(find('Account letter', 'Example Power Co')).toMatchObject({ link: 'label-only', href: null });
  });
});

describe('identity and ownership', () => {
  it('every reference has its own id, and the same name or link on two owners is never merged', () => {
    expect(new Set(index.refs.map((r) => r.id)).size).toBe(index.refs.length);
    const manuals = index.refs.filter((r) => r.label === 'Installation manual');
    expect(manuals.map((r) => r.ownerName).sort()).toEqual(['Dishwasher', 'Example Power Co', 'Fridge']);
    expect(new Set(manuals.map((r) => r.id)).size).toBe(3);
  });
  it('the same address on two owners stays two rows', () => {
    const rows = makeRefs({ moduleId: 'x', sourceLabel: 'X', ownerKey: 'a:1', ownerName: 'A', recordKind: 'Bill', recordPath: '/x/1', recordAction: 'View' }, [link('Same', 'https://example.com/z'), link('Same', 'https://example.com/z')]);
    expect(rows.map((r) => r.id)).toEqual(['x:a:1#0', 'x:a:1#1']);
  });
  it('a reference with no name is skipped and bad stored shapes never throw', () => {
    const rows = makeRefs({ moduleId: 'x', sourceLabel: 'X', ownerKey: 'a:1', ownerName: 'A', recordKind: 'Bill', recordPath: '/x/1', recordAction: 'View' }, [{ label: '  ' }, null as never, { label: 5 as never }, { label: 'ok', url: 7 as never }]);
    expect(rows.map((r) => r.label)).toEqual(['ok']);
    expect(makeRefs({ moduleId: 'x', sourceLabel: 'X', ownerKey: 'a:1', ownerName: 'A', recordKind: 'Bill', recordPath: '/x/1', recordAction: 'View' }, undefined)).toEqual([]);
  });
});

describe('search and filters', () => {
  it('finds a reference by its name, its owner, its record kind or its module, and by nothing else', () => {
    const q = (s: string) => filterRefs(index.refs, { query: s }, TODAY).map((r) => `${r.ownerName}/${r.label}`);
    expect(q('dishwasher warranty')).toEqual(expect.arrayContaining(['Dishwasher/Warranty card']));
    expect(q('dishwasher warranty')).not.toContain('Fridge/Installation manual');
    expect(q('cleaning')).toEqual(expect.arrayContaining(['Weekly cleaning/Service agreement', 'Weekly cleaning/Invoice']));
    expect(q('streamly')).toEqual(['Streamly/Terms of service']);
    expect(q('bills')).toContain('Streamly/Terms of service'); // by module name
    expect(q('drawer')).toEqual([]); // a note is not searched
    expect(q('example.com')).toEqual([]); // an address is not searched
    expect(q('')).toHaveLength(index.refs.length);
    expect(refMatches(find('Warranty card', 'Dishwasher'), 'DISHWASHER   warranty')).toBe(true);
  });
  it('the source filter keeps only that module, and the expiring filter only a record with its own end date', () => {
    expect(new Set(filterRefs(index.refs, { source: 'bills' }, TODAY).map((r) => r.moduleId))).toEqual(new Set(['bills']));
    expect(filterRefs(index.refs, { source: 'all' }, TODAY)).toHaveLength(index.refs.length);
    const exp = filterRefs(index.refs, { expiring: true }, TODAY);
    expect(exp.map((r) => r.label)).toEqual(['Warranty card']); // the one warranty ending within 60 days that holds a document
    expect(expiryState('2026-12-25', TODAY)).toBe('soon');
    expect(expiryState('2026-11-15', TODAY)).toBe('expired');
    expect(expiryState('2026-11-16', TODAY)).toBe('soon');
    expect(expiryState('2027-02-01', TODAY)).toBe('later');
    expect(filterRefs(index.refs, { review: true }, TODAY).map((r) => r.label).sort()).toEqual(['Install quote', 'Relative', 'Spec sheet']);
  });
  it('the default order is stable: source, then item, then record, then name', () => {
    const a = sortRefs([...index.refs].reverse(), ['assets', 'services', 'bills']);
    expect(a.map((r) => r.id)).toEqual(index.refs.map((r) => r.id));
    expect(index.refs[0].moduleId).toBe('assets');
    expect(index.refs[index.refs.length - 1].moduleId).toBe('bills');
  });
});

describe('warranty gaps', () => {
  it('lists only a stored warranty record with no document, still in force, on an asset still in use', () => {
    expect(index.gaps.map((g) => `${g.ownerName}/${g.recordName}`).sort()).toEqual(['Dishwasher/Extended warranty', 'Fridge/Parts cover']);
    const g = index.gaps.find((x) => x.recordName === 'Extended warranty')!;
    expect(g).toMatchObject({ message: 'No warranty document is linked.', recordPath: `/assets/${ids.dishwasher}?warranty=${ids.wDishExt}`, recordAction: 'View appliance', moduleId: 'assets' });
  });
  it('is not reported for an ended warranty, an archived asset, a warranty that has a document, or the asset’s old single warranty date', () => {
    const names = index.gaps.map((g) => `${g.ownerName}/${g.recordName}`);
    expect(names).not.toContain('Fridge/Manufacturer warranty'); // ended 2026-01-01
    expect(names).not.toContain('Old washer/Manufacturer warranty'); // archived
    expect(names).not.toContain('Dishwasher/Manufacturer warranty'); // has a document
    expect(index.gaps.some((g) => g.ownerName === 'Boiler')).toBe(false); // old single warranty date, no warranty record
  });
  it('the words never say a warranty or document is missing or lost', () => {
    const words = JSON.stringify(index.gaps).toLowerCase();
    for (const bad of ['missing', 'lost', 'unprotected', 'not covered']) expect(words).not.toContain(bad);
    expect(words).toContain('no warranty document is linked');
  });
  it('Services and Bills report no gaps', async () => {
    expect((await readServiceDocs(undefined, d)).gaps).toEqual([]);
    expect((await readBillDocs(undefined, d)).gaps).toEqual([]);
  });
});

describe('unsafe links', () => {
  const garage = () => index.refs.filter((r) => r.ownerName === 'Garage door');
  it('only an http or https address becomes an openable link', () => {
    const by = Object.fromEntries(garage().map((r) => [r.label, r]));
    expect(by['Install quote']).toMatchObject({ link: 'review', href: null, host: '' });
    expect(by['Spec sheet']).toMatchObject({ link: 'review', href: null });
    expect(by.Relative).toMatchObject({ link: 'review', href: null });
    expect(by['Opener photo']).toMatchObject({ link: 'open', href: 'HTTPS://Photos.Example.com/door', host: 'photos.example.com' });
  });
  it('an unsafe address is not carried anywhere in the row, and the row still points at its record', () => {
    const bad = garage().filter((r) => r.link === 'review');
    expect(bad).toHaveLength(3);
    const text = JSON.stringify(bad);
    expect(text).not.toMatch(/javascript:|data:text|\/x\/y/);
    for (const r of bad) expect(r.recordPath).toBe(`/assets/${ids.garage}`);
  });
  it('the screen draws only a safe address as a link, always to a new tab with no opener, and never prints the whole address', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { Row } = await import('../shell/RecordsPage');
    const html = garage().map((r) => renderToStaticMarkup(<Row r={r} today={TODAY} text={(t) => t} />)).join('');
    expect(html).not.toMatch(/href="javascript:|href="data:|href="\/x/i);
    expect(html.match(/target="_blank"/g)).toHaveLength(1);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(textOf(parseHtml(html))).not.toMatch(/\/door|https?:/i); // the visible words never show an address, only the site name
  });
});

describe('navigation targets', () => {
  it('every row’s record address opens a record in its own module; no row points back at Records or at a document', () => {
    for (const r of index.refs) expect(r.recordPath).toMatch(/^\/(assets|services|bills)(\/|$)/);
    const byModule = (m: string) => index.refs.filter((r) => r.moduleId === m);
    for (const r of byModule('services')) expect(r.recordPath).toMatch(/^\/services\/(a|v)\/\d+$/);
    for (const r of byModule('bills')) expect(r.recordPath).toMatch(/^\/bills\/o\/\d+$/);
  });
});

describe('Search rows', () => {
  it('one row per reference, worded as a Document, opening it on the Records screen by id only', () => {
    const hits = documentHits('dishwasher warranty', index, 14);
    const card = hits.results.find((r) => r.title === 'Warranty card')!;
    expect(card.kind).toBe('Document');
    expect(card.subtitle).toBe('Belongs to Dishwasher · Warranty: Manufacturer warranty · Home & Assets · Warranty ends Fri, Dec 25, 2026');
    expect(card.path).toBe(recordsPath(find('Warranty card', 'Dishwasher').id));
    expect(card.path).not.toMatch(/dishwasher|warranty card/i);
    expect(new Set(hits.results.map((r) => r.id)).size).toBe(hits.results.length);
    expect(hits.failed).toEqual([]);
  });
  it('shows no address and no note, and an empty query finds nothing', () => {
    const all = documentHits('manual', index, 14).results;
    expect(all.length).toBe(3);
    expect(all.map((r) => r.subtitle).join(' ')).not.toMatch(/https?:|PDF, 40/);
    expect(documentHits('   ', index, 14).results).toEqual([]);
  });
  it('the two same-named manuals are told apart by what they belong to', () => {
    const subs = documentHits('installation manual', index, 14).results.map((r) => r.subtitle);
    expect(new Set(subs).size).toBe(subs.length);
  });
});

describe('a source that cannot be read', () => {
  it('is reported, the others are still listed, and the index says it is incomplete', async () => {
    const broken = sources().map((s) => (s.moduleId === 'services' ? { ...s, source: { ...s.source, read: () => Promise.reject(new Error('boom')) } } : s));
    const idx = await loadDocumentIndex(TODAY, broken);
    expect(idx.complete).toBe(false);
    expect(idx.sources.map((s) => [s.moduleId, s.ok])).toEqual([['assets', true], ['services', false], ['bills', true]]);
    expect(idx.refs.some((r) => r.moduleId === 'services')).toBe(false);
    expect(idx.refs.some((r) => r.moduleId === 'assets')).toBe(true);
    expect(idx.refs.some((r) => r.moduleId === 'bills')).toBe(true);
    expect(documentHits('cleaning', idx, 14).failed).toEqual(['Household Services']);
  });
  it('a source that throws synchronously is also caught, and all three failing gives an empty but incomplete index', async () => {
    const idx = await loadDocumentIndex(TODAY, sources().map((s) => ({ ...s, source: { ...s.source, read: () => { throw new Error('x'); } } })));
    expect(idx).toMatchObject({ refs: [], gaps: [], complete: false });
  });
});

describe('reading changes nothing', () => {
  it('loading the index, searching it and reading each module leaves every table exactly as it was', async () => {
    const before = await digest(d);
    const idx = await loadDocumentIndex(TODAY, sources());
    documentHits('dishwasher', idx, 14);
    await readAssetDocs({ today: TODAY }, d); await readServiceDocs(undefined, d); await readBillDocs(undefined, d);
    expect(await digest(d)).toBe(before);
  });
  it('the reader files contain no write, network call, storage or HTML injection', () => {
    for (const f of ['src/core/documentRefs.ts', 'src/modules/assets/docRefs.ts', 'src/modules/services/docRefs.ts', 'src/modules/bills/docRefs.ts', 'src/shell/recordsIndex.ts', 'src/shell/RecordsPage.tsx']) {
      const code = readFileSync(resolve(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/\.(put|add|update|delete|bulkPut|bulkAdd|bulkDelete|clear)\s*\(|fetch\(|XMLHttpRequest|localStorage\.setItem|dangerouslySetInnerHTML|innerHTML|eval\(/);
    }
  });
  it('no new table, no migration: the database version and the backup list are untouched by this phase', () => {
    const db = readFileSync(resolve(process.cwd(), 'src/db.ts'), 'utf8');
    expect(db).not.toMatch(/records?Index|documentRefs|document_refs/i);
  });
});

describe('how Records is reached', () => {
  const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8');
  it('is a shell page like Settings and Quick Answers: no twelfth module, an address the Ledger prefix never rewrites, loaded on demand', async () => {
    const { allModules } = await import('../core/registry');
    const { SHELL_PATHS, withBasePath } = await import('../core/paths');
    expect(allModules().map((m) => m.id)).not.toContain('records');
    expect(SHELL_PATHS).toContain('/records');
    expect(withBasePath('/ledger', '/records')).toBe('/records');
    expect(withBasePath('/ledger', '/records?ref=assets%3Aasset%3A1%230')).toBe('/records?ref=assets%3Aasset%3A1%230');
    const app = read('src/App.tsx');
    expect(app).toMatch(/lazyModule\(\(\) => import\('\.\/shell\/RecordsPage'\)\)/);
    expect(app).toMatch(/path="\/records\/\*"/);
  });
  it('is on the open module list and in Search’s actions, and Today has no new card', () => {
    expect(read('src/core/ModuleBar.tsx')).toMatch(/<Link to="\/records"/);
    expect(read('src/shell/SearchDialog.tsx')).toMatch(/title: 'Open Records'[^}]*full: '\/records'/);
    expect(allTodayCards().map((c) => c.id).filter((id) => /record/i.test(id))).toEqual([]);
  });
  it('the module readers are downloaded only when asked: no module imports its docRefs file eagerly', () => {
    for (const m of ['assets', 'services', 'bills']) expect(read(`src/modules/${m}/index.tsx`)).toMatch(/import\('\.\/docRefs'\)/);
    for (const m of ['assets', 'services', 'bills']) expect(read(`src/modules/${m}/index.tsx`)).not.toMatch(/from '\.\/docRefs'/);
  });
});
