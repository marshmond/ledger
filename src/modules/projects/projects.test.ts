import { describe, expect, it } from 'vitest';
import { db, FinanceDB } from '../../db';
import { findOrCreateContact, updateContactDetails, validateContact } from '../../core/contacts';
import { allQuickAdds, allSearchSources, getModule, recordSource } from '../../core/registry';
import { createStore } from '../../core/store';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, snapshotOf, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { loadProjectSummary, setTxnProject } from '../../lib/txnProject';
import { registerModules } from '../index';
import {
  addNewVendor, addVendor, archiveProject, createLine, createProject, getProject, loadAllBudgetLines, loadBudgetLines, loadProjects, moveLine,
  projectsUsingContact, removeLine, removeProjectRecord, removeVendor, restoreProject, saveLine, saveProject, setProjectStatus,
} from './data';
import { projectsModule } from './index';
import { asBudgetLine, asProject, blankProject, budgetFromText, budgetSummary, sortLines, STATUSES, validateLine, validateProject } from './model';
import { projectQuickAdd } from './quickAddDef';
import { projectRecords } from './records';
import { searchProjectsData } from './searchSource';

/** Invented data only. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-projects-${n++}`); installTracking(d); return d; };
const $ = (x: number) => Math.round(x * 100);
const raw = (d: FinanceDB, id: number) => d.moduleRecords.get(id) as Promise<{ data: Record<string, unknown>; deletedAt?: number | null }>;

describe('module registration', () => {
  it('registers beside the others with records, search and Add, and clashes with nothing', () => {
    registerModules();
    expect(getModule('projects')).toBe(projectsModule);
    expect(projectsModule.name).toBe('Projects');
    expect(recordSource('projects')).toBe(projectRecords);
    expect(allSearchSources().map((s) => s.moduleId)).toContain('projects');
    const q = allQuickAdds().find((x) => x.moduleId === 'projects');
    expect(q).toMatchObject({ id: 'project', prefix: 'p' });
  });
});

describe('projects: create, edit, status, archive', () => {
  it('creates a project with the defaults and reads it back', async () => {
    const d = fresh();
    const id = await createProject(blankProject({ name: 'Kitchen', budgetCents: $(60000), startDate: '2026-12-01', targetDate: '2027-03-01', notes: 'Full gut' }), d);
    expect(await getProject(id, d)).toMatchObject({ id, data: { name: 'Kitchen', status: 'planning', budgetCents: 6000000, archived: false, vendorContactIds: [], notes: 'Full gut' } });
    expect((await loadProjects(d)).map((p) => p.id)).toEqual([id]);
  });

  it('edits a project and keeps its id and creation time', async () => {
    const d = fresh();
    const id = await createProject(blankProject({ name: 'Kitchen' }), d);
    const before = (await getProject(id, d))!;
    await saveProject(id, { ...before.data, name: 'Kitchen and pantry', budgetCents: $(1), targetDate: '2027-01-01' }, d);
    const after = (await getProject(id, d))!;
    expect(after.data).toMatchObject({ name: 'Kitchen and pantry', budgetCents: 100, targetDate: '2027-01-01' });
    expect(after.createdAt).toBe(before.createdAt);
    await expect(saveProject(987654, before.data, d)).rejects.toThrow(/no longer exists/);
  });

  it('every status can be set, and nothing else about the project changes', async () => {
    const d = fresh();
    const id = await createProject(blankProject({ name: 'Trip', budgetCents: 500, notes: 'n' }), d);
    for (const s of STATUSES) {
      await setProjectStatus(id, s, d);
      expect((await getProject(id, d))!.data).toMatchObject({ status: s, name: 'Trip', budgetCents: 500, notes: 'n' });
    }
  });

  it('archives and restores without losing anything', async () => {
    const d = fresh();
    const id = await createProject(blankProject({ name: 'Fence', status: 'active' }), d);
    await createLine(id, 'Posts', 1000, d);
    await archiveProject(id, d);
    expect((await getProject(id, d))!.data).toMatchObject({ archived: true, status: 'active' });
    expect(await loadBudgetLines(id, d)).toHaveLength(1);
    await restoreProject(id, d);
    expect((await getProject(id, d))!.data).toMatchObject({ archived: false, status: 'active', name: 'Fence' });
  });

  it('validates what is typed in plain words', () => {
    const ok = { name: 'A', startDate: '', targetDate: '', budget: '' };
    expect(validateProject(ok)).toBeNull();
    expect(validateProject({ ...ok, name: '  ' })).toMatch(/name/);
    expect(validateProject({ ...ok, startDate: '2026-12-10', targetDate: '2026-12-01' })).toMatch(/before the start/);
    expect(validateProject({ ...ok, startDate: '2026-02-30' })).toMatch(/not a real date/);
    expect(validateProject({ ...ok, budget: 'lots' })).toMatch(/not an amount/);
    expect(validateProject({ ...ok, budget: '-5' })).toMatch(/negative/);
    expect(validateProject({ ...ok, budget: '$1,200.50' })).toBeNull();
    expect(budgetFromText('')).toBeNull();
    expect(budgetFromText('$1,200.50')).toBe(120050);
    expect(validateLine('', '5')).toMatch(/name/);
    expect(validateLine('Tile', 'x')).toMatch(/not an amount/);
    expect(validateLine('Tile', '-1')).toMatch(/negative/);
    expect(validateLine('Tile', '')).toBeNull();
  });

  it('the Add box makes a project, and undo removes it again', async () => {
    const preview = projectQuickAdd.parse!('  Garden   shed ')!;
    expect(preview.summary).toContain('Garden shed');
    expect(projectQuickAdd.parse!('   ')).toBeNull();
    const undo = (await projectQuickAdd.commit!(preview)) as () => Promise<void>;
    const made = (await loadProjects(db)).find((p) => p.data.name === 'Garden shed');
    expect(made?.data.status).toBe('planning');
    await undo();
    expect((await loadProjects(db)).find((p) => p.data.name === 'Garden shed')).toBeUndefined();
    await removeProjectRecord(123456789, db); // a missing id does nothing
  });
});

describe('budget lines', () => {
  it('adds lines in order and totals them', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K' }), d);
    await createLine(p, 'Cabinets', $(20000), d);
    await createLine(p, 'Flooring', $(4000.5), d);
    const lines = await loadBudgetLines(p, d);
    expect(lines.map((l) => l.data.name)).toEqual(['Cabinets', 'Flooring']);
    expect(lines[1].data.sort).toBeGreaterThan(lines[0].data.sort);
    expect(budgetSummary(null, lines).plannedTotalCents).toBe($(24000.5));
    await expect(createLine(987654, 'x', 1, d)).rejects.toThrow(/no longer exists/);
  });

  it('a blank overall budget is the total of the lines; a set one is compared', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K' }), d);
    await createLine(p, 'A', $(700), d);
    await createLine(p, 'B', $(500), d);
    const lines = await loadBudgetLines(p, d);
    expect(budgetSummary(null, lines)).toEqual({ plannedTotalCents: $(1200), budgetCents: $(1200), derived: true, notYetPlannedCents: 0, state: 'derived' });
    expect(budgetSummary($(1500), lines)).toMatchObject({ derived: false, notYetPlannedCents: $(300), state: 'under' });
    expect(budgetSummary($(1200), lines)).toMatchObject({ notYetPlannedCents: 0, state: 'balanced' });
    expect(budgetSummary($(1000), lines)).toMatchObject({ notYetPlannedCents: -$(200), state: 'over' });
    expect(budgetSummary(0, [])).toMatchObject({ state: 'balanced' });
    expect(budgetSummary(null, [])).toMatchObject({ plannedTotalCents: 0, budgetCents: 0, state: 'derived' });
  });

  it('edits name and amount; the project and the other lines are untouched', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K' }), d);
    const a = await createLine(p, 'A', 100, d);
    const b = await createLine(p, 'B', 200, d);
    await saveLine(a, { name: ' Cabinets ', plannedCents: 150 }, d);
    const lines = await loadBudgetLines(p, d);
    expect(lines.find((l) => l.id === a)!.data).toMatchObject({ name: 'Cabinets', plannedCents: 150, projectId: p });
    expect(lines.find((l) => l.id === b)!.data).toMatchObject({ name: 'B', plannedCents: 200 });
    await expect(saveLine(987654, { name: 'x' }, d)).rejects.toThrow(/no longer exists/);
  });

  it('removing a line takes it out of the list and the totals (soft delete) and leaves the others', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K' }), d);
    const a = await createLine(p, 'A', 100, d);
    const b = await createLine(p, 'B', 200, d);
    await removeLine(a, d);
    const lines = await loadBudgetLines(p, d);
    expect(lines.map((l) => l.id)).toEqual([b]);
    expect(budgetSummary(null, lines).plannedTotalCents).toBe(200);
    expect(typeof (await raw(d, a)).deletedAt).toBe('number'); // kept as a marker so the removal can sync
    await removeLine(a, d); // already gone: nothing happens
  });

  it('reordering swaps neighbours, stops at the ends, and writes only the lines that change', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K' }), d);
    const ids = [await createLine(p, 'A', 1, d), await createLine(p, 'B', 2, d), await createLine(p, 'C', 3, d)];
    const names = async () => (await loadBudgetLines(p, d)).map((l) => l.data.name).join('');
    await moveLine(p, ids[2], -1, d);
    expect(await names()).toBe('ACB');
    await moveLine(p, ids[0], -1, d); // already first
    await moveLine(p, ids[1], 1, d); // already last
    expect(await names()).toBe('ACB');
    await moveLine(p, ids[0], 1, d);
    expect(await names()).toBe('CAB');
    // a settled order is stable: moving the first one up again changes no record
    const before = (await loadBudgetLines(p, d)).map((l) => l.updatedAt);
    await moveLine(p, ids[2], -1, d);
    expect((await loadBudgetLines(p, d)).map((l) => l.updatedAt)).toEqual(before);
  });

  it('lines with the same sort number (two devices adding at once) keep a stable order', () => {
    const mk = (id: number, createdAt: number, sort: number) => asBudgetLine({ id, module: 'projects', kind: 'budgetLine', createdAt, updatedAt: 0, data: { projectId: 1, name: `L${id}`, plannedCents: 0, sort } });
    expect(sortLines([mk(3, 30, 10), mk(2, 20, 10), mk(1, 10, 20)]).map((l) => l.id)).toEqual([2, 3, 1]);
  });

  it('a line with spending tagged to it cannot be removed until it is untagged', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K' }), d);
    const l = await createLine(p, 'Tile', $(500), d);
    const acct = (await d.accounts.add({ name: 'A', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
    const t = (await d.txns.add({ accountId: acct, date: '2026-11-01', amountCents: -$(40), payee: 'Shop', memo: '', status: 'cleared', categoryId: null })) as number;
    await setTxnProject(d, t, { projectId: p, budgetLineId: l });
    await expect(removeLine(l, d)).rejects.toThrow(/tagged to this line/);
    expect(await loadBudgetLines(p, d)).toHaveLength(1);
    await setTxnProject(d, t, null);
    await removeLine(l, d);
    expect(await loadBudgetLines(p, d)).toHaveLength(0);
  });
});

describe('vendors are shared contacts', () => {
  it('adds a new vendor with phone and email as an ordinary contact', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K' }), d);
    const { contactId, created } = await addNewVendor(p, { name: 'Acme Plumbing', relationship: 'plumber', phone: '555-0100', email: 'office@example.com' }, d);
    expect(created).toBe(true);
    expect((await getProject(p, d))!.data.vendorContactIds).toEqual([contactId]);
    expect(await createStore(d).shared.contacts.get(contactId)).toMatchObject({ name: 'Acme Plumbing', relationship: 'plumber', phone: '555-0100', email: 'office@example.com' });
  });

  it('U2: a typed name never reuses a vendor: it is refused with nothing written; the existing one is added by id; a confirmed different one is a separate contact', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K' }), d);
    const first = await addNewVendor(p, { name: 'Acme Plumbing', phone: '555-0100' }, d);
    const before = JSON.stringify(await createStore(d).shared.contacts.get(first.contactId));
    await expect(addNewVendor(p, { name: '  acme   plumbing ', phone: '555-9999', email: 'a@example.com' }, d)).rejects.toThrow(/already exists/);
    expect(await d.contacts.count()).toBe(1);
    expect(JSON.stringify(await createStore(d).shared.contacts.get(first.contactId))).toBe(before); // the existing contact is not edited or filled in
    await addVendor(p, first.contactId, d); // choosing the existing contact by id adds nothing twice
    expect((await getProject(p, d))!.data.vendorContactIds).toEqual([first.contactId]);
    const other = await addNewVendor(p, { name: 'Acme Plumbing', email: 'other@example.com', confirmedDifferent: true }, d);
    expect(other.created).toBe(true);
    expect(other.contactId).not.toBe(first.contactId);
    expect(await d.contacts.count()).toBe(2);
    expect((await getProject(p, d))!.data.vendorContactIds).toEqual([first.contactId, other.contactId]);
  });

  it('an existing contact (a family member with no phone or email) works as before and can be added as a vendor', async () => {
    const d = fresh();
    const id = (await createStore(d).shared.contacts.put({ name: 'Uncle Sam', relationship: 'uncle', notes: 'electrician' })) as number;
    const p = await createProject(blankProject({ name: 'K' }), d);
    await addVendor(p, id, d);
    await addVendor(p, id, d);
    expect((await getProject(p, d))!.data.vendorContactIds).toEqual([id]);
    expect(await createStore(d).shared.contacts.get(id)).toMatchObject({ name: 'Uncle Sam', notes: 'electrician' });
  });

  it('one contact can be on several projects; removing it from one leaves the other and the contact', async () => {
    const d = fresh();
    const p1 = await createProject(blankProject({ name: 'Kitchen' }), d);
    const p2 = await createProject(blankProject({ name: 'Fence' }), d);
    const { contactId } = await addNewVendor(p1, { name: 'Pat the Painter' }, d);
    await addVendor(p2, contactId, d);
    expect((await projectsUsingContact(contactId, d)).map((p) => p.data.name).sort()).toEqual(['Fence', 'Kitchen']);
    await removeVendor(p1, contactId, d);
    expect((await projectsUsingContact(contactId, d)).map((p) => p.data.name)).toEqual(['Fence']);
    expect(await createStore(d).shared.contacts.get(contactId)).toBeDefined();
  });

  it('checks phone and email, edits details, clears them, and keeps fields it does not know', async () => {
    const d = fresh();
    expect(validateContact({ name: '' })).toMatch(/name/);
    expect(validateContact({ name: 'A', email: 'nope' })).toMatch(/email/);
    expect(validateContact({ name: 'A', email: 'a@b.co', phone: '+1 (555) 010-0100 ext 2' })).toBeNull();
    const { id } = await findOrCreateContact(d, { name: 'Dana', phone: '1', email: 'd@example.com' });
    await d.contacts.update(id, { futureField: 'keep me' } as never);
    await updateContactDetails(d, id, { name: 'Dana Smith', phone: '', email: 'ds@example.com', relationship: 'tile setter' });
    const c = (await d.contacts.get(id)) as unknown as Record<string, unknown>;
    expect(c).toMatchObject({ name: 'Dana Smith', email: 'ds@example.com', relationship: 'tile setter', futureField: 'keep me' });
    expect('phone' in c).toBe(false);
    await expect(updateContactDetails(d, id, { name: 'Dana', email: 'bad' })).rejects.toThrow(/email/);
    await expect(updateContactDetails(d, 987654, { name: 'x' })).rejects.toThrow(/no longer exists/);
  });
});

describe('reading stored records defensively', () => {
  it('bad or missing fields never throw and get safe values', () => {
    const p = asProject({ id: 1, module: 'projects', kind: 'project', createdAt: 1, updatedAt: 1, data: { name: 42, status: 'bogus', startDate: 'tomorrow', targetDate: '2026-02-30', budgetCents: 'lots', vendorContactIds: [1, 'x', 1, NaN, 2], archived: 'yes', notes: null } as never });
    expect(p.data).toEqual({ name: 'Untitled project', notes: '', status: 'planning', startDate: null, targetDate: null, budgetCents: null, vendorContactIds: [1, 2], archived: false });
    const empty = asProject({ id: 2, module: 'projects', kind: 'project', createdAt: 1, updatedAt: 1, data: undefined as never });
    expect(empty.data.name).toBe('Untitled project');
    const l = asBudgetLine({ id: 3, module: 'projects', kind: 'budgetLine', createdAt: 1, updatedAt: 1, data: { plannedCents: '5', sort: null } as never });
    expect(l.data).toEqual({ projectId: -1, name: 'Budget line', plannedCents: 0, sort: 0 });
    expect(asProject({ id: 4, module: 'projects', kind: 'project', createdAt: 1, updatedAt: 1, data: { name: 'x', budgetCents: 12.6 } }).data.budgetCents).toBe(13);
  });

  it('fields written by something else survive every change this module makes', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K' }), d);
    const l = await createLine(p, 'A', 1, d);
    const l2 = await createLine(p, 'B', 2, d);
    for (const id of [p, l]) {
      const r = await raw(d, id);
      await d.moduleRecords.update(id, { data: { ...r.data, futureThing: { x: 1 } } } as never);
    }
    await setProjectStatus(p, 'active', d);
    await archiveProject(p, d);
    await restoreProject(p, d);
    await addNewVendor(p, { name: 'V' }, d);
    await saveProject(p, { ...(await getProject(p, d))!.data, name: 'K2' }, d);
    await saveLine(l, { name: 'A2' }, d);
    await moveLine(p, l, 1, d);
    await moveLine(p, l2, -1, d);
    expect((await raw(d, p)).data.futureThing).toEqual({ x: 1 });
    expect((await raw(d, l)).data.futureThing).toEqual({ x: 1 });
  });

  it('lines that point at no project, or at another project, are not shown', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K' }), d);
    const q = await createProject(blankProject({ name: 'Q' }), d);
    await createLine(q, 'Other', 1, d);
    await d.moduleRecords.add({ module: 'projects', kind: 'budgetLine', data: { name: 'Orphan' } } as never);
    expect(await loadBudgetLines(p, d)).toEqual([]);
    expect(await loadAllBudgetLines(d)).toHaveLength(2);
  });
});

describe('search and record lookup', () => {
  it('finds projects by name and notes, open ones first, and says where they open', async () => {
    const d = fresh();
    await createProject(blankProject({ name: 'Kitchen renovation', notes: 'cabinets' }), d);
    const arch = await createProject(blankProject({ name: 'Old kitchen plan' }), d);
    await archiveProject(arch, d);
    const projects = await loadProjects(d);
    const hits = searchProjectsData('kitchen', projects);
    expect(hits.map((h) => h.title)).toEqual(['Kitchen renovation', 'Old kitchen plan']);
    expect(hits[0]).toMatchObject({ kind: 'Project', path: `/projects/${projects.find((p) => p.data.name === 'Kitchen renovation')!.id}` });
    expect(hits[1].subtitle).toContain('Archived');
    expect(searchProjectsData('cabinets', projects).map((h) => h.title)).toEqual(['Kitchen renovation']);
    expect(searchProjectsData('zzz', projects)).toEqual([]);
    expect(searchProjectsData('  ', projects)).toEqual([]);
    expect(searchProjectsData('projects', projects).some((h) => h.id === 'page:/projects')).toBe(true);
  });

  it('can be linked to: found, described by its current name, archived is labelled, a missing one is gone', async () => {
    const id = await createProject(blankProject({ name: 'Lookup trip' }), db);
    expect((await projectRecords.search('lookup')).map((r) => r.id)).toContain(id);
    expect(await projectRecords.describe(id)).toMatchObject({ label: 'Lookup trip', kind: 'Project', path: `/projects/${id}` });
    expect(await projectRecords.describe(String(id))).not.toBeNull();
    await archiveProject(id, db);
    expect((await projectRecords.describe(id))!.label).toBe('Lookup trip (archived)');
    await removeProjectRecord(id, db);
    expect(await projectRecords.describe(id)).toBeNull();
    expect(await projectRecords.describe('nonsense')).toBeNull();
    expect(await projectRecords.describe(987654321)).toBeNull();
    const taskLike = await db.moduleRecords.add({ module: 'tasks', kind: 'task', data: { title: 'x' } } as never);
    expect(await projectRecords.describe(taskLike as number)).toBeNull();
  });
});

describe('finance layer compatibility', () => {
  it('the records this module writes are the ones the Finance project layer reads and tags against', async () => {
    const d = fresh();
    const p = await createProject(blankProject({ name: 'K', budgetCents: $(1000), startDate: '2026-11-01', targetDate: '2026-12-31' }), d);
    const l1 = await createLine(p, 'Cabinets', $(600), d);
    await createLine(p, 'Flooring', $(300), d);
    const s = (await loadProjectSummary(d, p))!;
    expect(s.budgetCents).toBe($(1000));
    expect(s.plannedTotalCents).toBe($(900));
    expect(s.notYetPlannedCents).toBe($(100));
    expect(s.lines.map((x) => x.name)).toEqual(['Cabinets', 'Flooring']);
    // the same answers the Projects screen shows
    const mine = budgetSummary((await getProject(p, d))!.data.budgetCents, await loadBudgetLines(p, d));
    expect(mine.plannedTotalCents).toBe(s.plannedTotalCents);
    expect(mine.notYetPlannedCents).toBe(s.notYetPlannedCents);
    // a transaction can be tagged to this project and line
    const acct = (await d.accounts.add({ name: 'A', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
    const t = (await d.txns.add({ accountId: acct, date: '2026-11-05', amountCents: -$(50), payee: 'Shop', memo: '', status: 'cleared', categoryId: null })) as number;
    await setTxnProject(d, t, { projectId: p, budgetLineId: l1 });
    expect((await loadProjectSummary(d, p))!.paidCents).toBe($(50));
    // without an overall budget, Finance also uses the lines' total
    await saveProject(p, { ...(await getProject(p, d))!.data, budgetCents: null }, d);
    expect((await loadProjectSummary(d, p))!.budgetCents).toBe($(900));
  });
});

describe('backup and sync', () => {
  async function build(d: FinanceDB) {
    const p = await createProject(blankProject({ name: 'Kitchen', budgetCents: $(60000), status: 'active' }), d);
    await createLine(p, 'Cabinets', $(20000), d);
    await createLine(p, 'Flooring', $(4000), d);
    const { contactId } = await addNewVendor(p, { name: 'Acme', phone: '555-0100', email: 'a@example.com' }, d);
    await d.moduleRecords.update(p, { data: { ...(await raw(d, p)).data, futureThing: 7 } } as never);
    return { p, contactId };
  }

  it('projects, lines, vendors and unknown fields survive export, restore and the sync snapshot', async () => {
    const d = fresh();
    const { p, contactId } = await build(d);
    const file = checkBackupText(JSON.stringify(await exportAll(d))).file;
    const target = fresh();
    await target.open();
    await importAll(target, file);
    expect((await getProject(p, target))!.data).toMatchObject({ name: 'Kitchen', status: 'active', vendorContactIds: [contactId] });
    expect((await raw(target, p)).data.futureThing).toBe(7);
    expect(await loadBudgetLines(p, target)).toHaveLength(2);
    expect(await target.contacts.get(contactId)).toMatchObject({ name: 'Acme', phone: '555-0100', email: 'a@example.com' });
    const snap = await snapshotOf(d);
    expect(Object.keys(snap.tables.moduleRecords).length).toBe(3);
    expect(snap.tables.contacts[String(contactId)]).toMatchObject({ phone: '555-0100' });
  });

  it('two devices change different lines of one project and both changes survive', async () => {
    const remote = (() => {
      const r = {
        puts: 0, file: null as RemoteFile | null,
        async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
        async putFile(bytes: Uint8Array, sha: string | undefined) {
          if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
          r.puts++;
          r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
          return r.file.sha;
        },
      };
      return r satisfies RemoteStore;
    })();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`pj-meta-${n++}`), remote, 'a good passphrase') }; };
    const A = mk();
    const B = mk();
    const p = await createProject(blankProject({ name: 'Kitchen' }), A.d);
    const a = await createLine(p, 'Cabinets', 100, A.d);
    const b = await createLine(p, 'Flooring', 200, A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await saveLine(a, { plannedCents: 111 }, A.d); // device A
    await saveLine(b, { name: 'Flooring and tile' }, B.d); // device B, a different line
    await A.engine.sync();
    await B.engine.sync();
    await A.engine.sync();
    for (const x of [A, B]) {
      const lines = await loadBudgetLines(p, x.d);
      expect(lines.map((l) => [l.data.name, l.data.plannedCents])).toEqual([['Cabinets', 111], ['Flooring and tile', 200]]);
    }
  });
});
