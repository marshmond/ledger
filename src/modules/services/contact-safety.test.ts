import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { createAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import { createService } from '../assets/serviceData';
import { blankService } from '../assets/service';
import { createProject } from '../projects/data';
import { blankProject } from '../projects/model';
import { blankFields } from '../calendar/model';
import { createEvent } from '../calendar/data';
import { createArrangement } from './data';
import { blankArrangement, type Cadence } from './model';
import { applyUndo, contactIsReferenced, UNDO_REFUSED } from './undo';
import { logStandaloneVisit } from './visits';

/**
 * S2.1 follow-up: a contact made by a Quick Add must never be removed by Undo while anything still refers to it. Real record shapes from each
 * module (Home & Assets nested contact roles, Project vendors, Task and Calendar contactIds, shared links, other arrangements and visits).
 * All names are invented.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-contact-safety-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: TODAY };
const snapshot = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray()]);
const live = async (d: FinanceDB) => (await d.contacts.toArray()).filter((c) => c.deletedAt == null).map((c) => c.id as number);
const visitInput = { status: 'completed' as const, cancelledBy: null, date: TODAY, notes: '', chargedCents: null, chargeKind: null, title: 'Tap repair' };
/** What a Quick Add does: a brand-new provider contact plus a record that uses it. */
const quickVisit = (d: FinanceDB, name = 'New Plumber') => logStandaloneVisit({ provider: { name }, input: visitInput, today: TODAY }, d);
const quickArrangement = (d: FinanceDB, name = 'New Gardener') => createArrangement({ data: blankArrangement({ title: 'Lawn care', cadence: biweekly }), provider: { name }, today: TODAY }, d);

/** Each: makes ONE live record, of the real shape that module uses, that refers to the contact. */
const REFERENCERS: [string, (d: FinanceDB, id: number) => Promise<unknown>][] = [
  ['a Home & Assets asset (nested contact-role object)', (d, id) => createAsset(blankAsset({ name: 'Boiler', type: 'appliance', contacts: [{ contactId: id, role: 'Installer' }] }), d)],
  ['a Home & Assets service record (provider)', async (d, id) => { const a = await createAsset(blankAsset({ name: 'Boiler', type: 'appliance' }), d); await createService(blankService(a, { date: '2026-10-01', title: 'Annual check', providerContactId: id }), d, TODAY); }],
  ['a Project (vendor)', (d, id) => createProject(blankProject({ name: 'Kitchen refit', vendorContactIds: [id] }), d)],
  ['a Task', (d, id) => createTask(blankTask({ title: 'Ring them', contactIds: [id] }), [], d)],
  ['a Calendar event', (d, id) => createEvent({ ...blankFields('2026-11-10'), title: 'Site visit', contactIds: [id] } as never, d)],
  ['a shared link (module "contacts", numeric id)', (d, id) => createStore(d).shared.links.add({ module: 'contacts', id }, { module: 'tasks', id: 5 }, 'about')],
  ['a shared link (string-form id)', (d, id) => createStore(d).shared.links.add({ module: 'tasks', id: 5 }, { module: 'contacts', id: `contact:${id}` }, 'about')],
  ['another Household Services arrangement', (d, id) => createArrangement({ data: blankArrangement({ title: 'Pool service', cadence: biweekly }), provider: { contactId: id }, today: TODAY }, d)],
  ['another Household Services arrangement (extra contact)', async (d, id) => { const other = await createStore(d).shared.contacts.put({ name: 'Main Provider' }); await createArrangement({ data: blankArrangement({ title: 'Pool service', cadence: biweekly, extraContactIds: [id] }), provider: { contactId: other }, today: TODAY }, d); }],
  ['another Household Services visit', (d, id) => logStandaloneVisit({ provider: { contactId: id }, input: { ...visitInput, title: 'Second job' }, today: TODAY }, d)],
  ['a record shape this version does not know (unknown field)', (d, id) => d.moduleRecords.add({ module: 'future', kind: 'thing', createdAt: 1, updatedAt: 1, deletedAt: null, data: { somethingNew: { people: [{ who: id }] } } } as never)],
];

describe('S2.1 follow-up: a created contact is never removed while anything still refers to it', () => {
  for (const [what, make] of REFERENCERS) {
    for (const via of ['visit', 'arrangement'] as const) {
      it(`${via} Quick Add Undo keeps the contact when ${what} refers to it`, async () => {
        const d = fresh();
        const q = via === 'visit' ? await quickVisit(d) : await quickArrangement(d);
        const cid = q.contactId!;
        await make(d, cid);
        expect(await contactIsReferenced(cid, d)).toBe(true);
        const unrelated = await createTask(blankTask({ title: 'Unrelated' }), [], d);
        const before = JSON.stringify(await d.moduleRecords.get(unrelated));
        await applyUndo(q.undo, d, { dropCreatedContact: true });
        expect(await live(d)).toContain(cid); // the contact survives
        expect(JSON.stringify(await d.moduleRecords.get(unrelated))).toBe(before); // nothing unrelated changed
        // the Undo itself still happened
        if (via === 'visit') expect((await d.moduleRecords.toArray()).filter((r) => r.kind === 'visit' && r.deletedAt == null)).toHaveLength(what.includes('visit') ? 1 : 0);
      });
    }
  }
  it('an id that merely contains the same digits is not mistaken for a reference', async () => {
    const d = fresh();
    const q = await quickVisit(d);
    await applyUndo(q.undo, d); // its own visit is gone; only OTHER records can still refer to it
    await d.moduleRecords.add({ module: 'future', kind: 'thing', createdAt: 1, updatedAt: 1, deletedAt: null, data: { x: Number(`${q.contactId}7`), y: `9${q.contactId}`, z: 5 } } as never);
    expect(await contactIsReferenced(q.contactId!, d)).toBe(false);
  });
  it('a reference held only by a deleted record does not keep it', async () => {
    const d = fresh();
    const q = await quickVisit(d);
    await applyUndo(q.undo, d);
    const t = await createTask(blankTask({ title: 'Gone', contactIds: [q.contactId!] }), [], d);
    await d.moduleRecords.update(t, { deletedAt: Date.now() });
    expect(await contactIsReferenced(q.contactId!, d)).toBe(false);
  });
  it('a genuinely unused created contact is removed, with the visit, and nothing else changes', async () => {
    const d = fresh();
    const other = await quickVisit(d, 'Different Plumber');
    const q = await quickVisit(d);
    const keep = JSON.stringify(await d.moduleRecords.get(other.visitId));
    await applyUndo(q.undo, d, { dropCreatedContact: true });
    expect(await live(d)).toEqual([other.contactId]);
    expect(JSON.stringify(await d.moduleRecords.get(other.visitId))).toBe(keep);
    const qa = await quickArrangement(d);
    await applyUndo(qa.undo, d, { dropCreatedContact: true });
    expect(await live(d)).toEqual([other.contactId]);
  });
  it('a created contact that was edited afterwards refuses the whole Undo and changes nothing', async () => {
    const d = fresh();
    const q = await quickVisit(d);
    await sleep(3);
    await d.contacts.update(q.contactId!, { phone: '555-0100' });
    const snap = await snapshot(d);
    await expect(applyUndo(q.undo, d, { dropCreatedContact: true })).rejects.toThrow(UNDO_REFUSED);
    expect(await snapshot(d)).toBe(snap);
    expect(await live(d)).toEqual([q.contactId]);
    // without asking to remove the contact (the one-off dialog), the edit of the contact is not what Undo reverses
    await applyUndo(q.undo, d);
    expect(await live(d)).toEqual([q.contactId]);
  });
  it('the removal is atomic: a failure while removing the contact rolls back the whole Undo', async () => {
    const d = fresh();
    const q = await quickArrangement(d);
    const snap = await snapshot(d);
    const real = d.contacts.put.bind(d.contacts);
    const spy = vi.spyOn(d.contacts, 'put').mockImplementation((() => { throw new Error('disk full (simulated)'); }) as never);
    await expect(applyUndo(q.undo, d, { dropCreatedContact: true })).rejects.toThrow(/simulated/);
    spy.mockRestore();
    void real;
    expect(await snapshot(d)).toBe(snap);
    await applyUndo(q.undo, d, { dropCreatedContact: true });
    expect(await live(d)).toEqual([]);
  });
});

describe('S2.1 follow-up: references arriving through two-device sync', () => {
  function remoteStore() {
    const r = {
      puts: 0, file: null as RemoteFile | null,
      async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
      async putFile(bytes: Uint8Array, sha: string | undefined) {
        if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
        r.puts++; r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() }; return r.file.sha;
      },
    };
    return r satisfies RemoteStore;
  }
  const devices = () => {
    const remote = remoteStore();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`contact-meta-${n++}`), remote, 'a good passphrase') }; };
    return { A: mk(), B: mk() };
  };
  type Dev = ReturnType<typeof devices>['A'];
  const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };

  it('B attaches the new contact to a Home & Assets asset and a Project; after sync A\'s Quick Add Undo keeps the contact on both devices', async () => {
    const { A, B } = devices();
    await A.d.contacts.add({ name: 'Seed', deletedAt: null } as never); // so the first upload has something
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const q = await quickArrangement(A.d);
    await settle(A, B);
    await sleep(15);
    await createAsset(blankAsset({ name: 'Garden shed', type: 'property', contacts: [{ contactId: q.contactId!, role: 'Gardener' }] }), B.d);
    await createProject(blankProject({ name: 'Patio', vendorContactIds: [q.contactId!] }), B.d);
    await settle(A, B);
    expect(await contactIsReferenced(q.contactId!, A.d)).toBe(true); // the references reached A through the real sync engine
    await applyUndo(q.undo, A.d, { dropCreatedContact: true });
    await sleep(15);
    await settle(A, B);
    for (const x of [A, B]) {
      expect(await live(x.d)).toContain(q.contactId);
      expect((await x.d.moduleRecords.toArray()).filter((r) => r.module === 'services' && r.deletedAt == null)).toHaveLength(0); // the arrangement itself was undone
      expect((await x.d.moduleRecords.toArray()).filter((r) => (r.module === 'assets' || r.module === 'projects') && r.deletedAt == null)).toHaveLength(2);
    }
  });
  it('B edits the new contact; after sync A\'s Quick Add Undo is refused and nothing changes on A', async () => {
    const { A, B } = devices();
    await A.d.contacts.add({ name: 'Seed', deletedAt: null } as never);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const q = await quickVisit(A.d);
    await settle(A, B);
    await sleep(15);
    await B.d.contacts.update(q.contactId!, { phone: '555-0199' });
    await settle(A, B);
    const snap = await snapshot(A.d);
    await expect(applyUndo(q.undo, A.d, { dropCreatedContact: true })).rejects.toThrow(UNDO_REFUSED);
    expect(await snapshot(A.d)).toBe(snap);
  });
  it('with nothing attached anywhere, the Undo removes the contact and the removal syncs', async () => {
    const { A, B } = devices();
    await A.d.contacts.add({ name: 'Seed', deletedAt: null } as never);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const q = await quickVisit(A.d);
    await settle(A, B);
    await applyUndo(q.undo, A.d, { dropCreatedContact: true });
    await sleep(15);
    await settle(A, B);
    for (const x of [A, B]) expect(await live(x.d)).not.toContain(q.contactId);
  });
});
