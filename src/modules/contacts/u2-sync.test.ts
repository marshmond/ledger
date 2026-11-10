import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { readContactReferences } from '../../core/contactReferences';
import { resolveContactChoice, SameNameContactError } from '../../core/contactIdentity';
import { createDistinctContact } from '../../core/contacts';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createObligation, editObligation, getObligation } from '../bills/data';
import { monthly, ob } from '../bills/billsTestkit';
import { createCommitment, createProject, getCommitment, getProject } from '../projects/data';
import { blankProject } from '../projects/model';
import { createArrangement, getArrangement } from '../services/data';
import { blankArrangement } from '../services/model';
import { PROVIDERS } from './c2-testkit';

/**
 * Contacts U2: distinct same-name Contacts, and the Contact ids that records hold, through Ledger's real backup code and the real two-device sync engine.
 * The storage format and the sync infrastructure are unchanged by U2, so this is a focused check, not the full backup/sync suite. Invented data only.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-contacts-u2-${n++}`); installTracking(d); return d; };
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
beforeEach(() => { vi.stubGlobal('localStorage', mem()); });
const TODAY = '2026-11-09';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function remoteStore() {
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
}
const devices = () => {
  const remote = remoteStore();
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`contacts-u2-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const ready = async () => { const x = devices(); await x.A.engine.initialUpload(); await x.B.engine.replaceFromRemote(); return x; };
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
const liveNames = async (d: FinanceDB) => (await d.contacts.toArray()).filter((c) => c.deletedAt == null).map((c) => `${c.id}:${c.name}`).sort();

describe('same-name Contacts made on two devices stay two Contacts, each record keeps its own id', () => {
  it('a Bills provider made on A and a Services provider made on B, both called "Sam Example", are kept apart on both devices', async () => {
    const { A, B } = await ready();
    const bill = await createObligation({ data: ob({ title: 'Power', schedule: monthly(18, '2026-11') }, TODAY), provider: { name: 'Sam Example', phone: '555-0101' }, today: TODAY }, A.d);
    await sleep(3);
    const arr = await createArrangement({ data: blankArrangement({ title: 'Cleaning' }), provider: { name: 'Sam Example', relationship: 'cleaner' }, today: TODAY }, B.d);
    expect(bill.contactId).toBeDefined();
    await settle(A, B);
    for (const dev of [A, B]) {
      expect((await liveNames(dev.d)).filter((x) => x.endsWith(':Sam Example'))).toHaveLength(2);
      expect((await getObligation(bill.id, dev.d))!.data.providerContactId).toBe(bill.contactId);
      expect((await getArrangement(arr.id, dev.d))!.data.providerContactId).toBe(arr.contactId);
    }
    expect(bill.contactId).not.toBe(arr.contactId);
    // the named readers on the other device give each record to its own Contact
    const refs = (await readContactReferences([bill.contactId!, arr.contactId!], B.d, PROVIDERS, TODAY)).byContact;
    expect((refs.get(bill.contactId!) ?? []).map((r) => r.module)).toEqual(['bills']);
    expect((refs.get(arr.contactId!) ?? []).map((r) => r.module)).toEqual(['services']);
  });

  it('once both devices have synced, typing that name again is refused on EITHER device (the boundary sees the other device\'s Contact)', async () => {
    const { A, B } = await ready();
    await createObligation({ data: ob({ title: 'Power', schedule: monthly(18, '2026-11') }, TODAY), provider: { name: 'Pat Example' }, today: TODAY }, A.d);
    await settle(A, B);
    await expect(resolveContactChoice(B.d, { name: ' pat example ' })).rejects.toBeInstanceOf(SameNameContactError);
    await expect(createArrangement({ data: blankArrangement({ title: 'x' }), provider: { name: 'PAT EXAMPLE' }, today: TODAY }, B.d)).rejects.toBeInstanceOf(SameNameContactError);
    expect((await liveNames(B.d)).length).toBe(1);
  });

  it('editing an unrelated field of a bill on one device keeps its Contact id on both, and no second Contact appears', async () => {
    const { A, B } = await ready();
    const c = await createDistinctContact(A.d, { name: 'Sam Example' });
    const bill = await createObligation({ data: ob({ title: 'Power', schedule: monthly(18, '2026-11') }, TODAY), provider: { contactId: c }, today: TODAY }, A.d);
    await settle(A, B);
    const cur = (await getObligation(bill.id, B.d))!;
    await editObligation(bill.id, {
      title: 'Power (renamed)', type: cur.data.type, need: cur.data.need, amountKind: cur.data.amountKind, amountCents: cur.data.prices[0]?.cents ?? null, trackingSince: cur.data.trackingSince,
      schedule: cur.data.schedule, payment: cur.data.payment, paidThroughLoan: cur.data.paidThroughLoan, review: { on: cur.data.review.on, note: cur.data.review.note }, refs: cur.data.refs, notes: cur.data.notes,
    }, cur.updatedAt, TODAY, B.d);
    await settle(A, B);
    for (const dev of [A, B]) {
      expect((await getObligation(bill.id, dev.d))!.data).toMatchObject({ title: 'Power (renamed)', providerContactId: c });
      expect(await liveNames(dev.d)).toEqual([`${c}:Sam Example`]);
    }
  });

  it('a project vendor and commitment made with a confirmed-different same-name vendor keep the vendor ids after sync', async () => {
    const { A, B } = await ready();
    const first = await createDistinctContact(A.d, { name: 'Acme Tiles', relationship: 'tiler' });
    const p = await createProject(blankProject({ name: 'Kitchen refit' }), A.d);
    const c1 = await createCommitment(p, { title: 'Quote 1', amountCents: 1000, status: 'quoted', parentId: null, budgetLineId: null, vendorContactId: first, acceptedDate: null, notes: '' }, A.d);
    const c2 = await createCommitment(p, { title: 'Quote 2', amountCents: 2000, status: 'quoted', parentId: null, budgetLineId: null, vendorContactId: null, newVendor: { name: 'Acme Tiles', confirmedDifferent: true }, acceptedDate: null, notes: '' }, A.d);
    const second = (await getCommitment(c2.id, A.d))!.data.vendorContactId!;
    expect(second).not.toBe(first);
    await settle(A, B);
    expect((await getCommitment(c1.id, B.d))!.data.vendorContactId).toBe(first);
    expect((await getCommitment(c2.id, B.d))!.data.vendorContactId).toBe(second);
    expect((await getProject(p, B.d))!.data.vendorContactIds).toEqual([first, second]);
    expect((await liveNames(B.d)).filter((x) => x.endsWith(':Acme Tiles'))).toHaveLength(2);
  });
});

describe('backup and restore keep distinct same-name Contacts and the ids records hold', () => {
  it('a plain backup restores two same-name Contacts as two, with every record still pointing at its own id and no duplicate made', async () => {
    const A = fresh();
    const plumber = await createDistinctContact(A, { name: 'Sam Example', relationship: 'plumber' });
    const coach = await createDistinctContact(A, { name: 'Sam Example', relationship: 'school coach' });
    const bill = await createObligation({ data: ob({ title: 'Power', schedule: monthly(18, '2026-11') }, TODAY), provider: { contactId: plumber }, today: TODAY }, A);
    const arr = await createArrangement({ data: blankArrangement({ title: 'Cleaning' }), provider: { contactId: coach }, today: TODAY }, A);
    const p = await createProject(blankProject({ name: 'Kitchen refit' }), A);
    const cm = await createCommitment(p, { title: 'Quote', amountCents: 1000, status: 'quoted', parentId: null, budgetLineId: null, vendorContactId: plumber, acceptedDate: null, notes: '' }, A);
    const { file } = checkBackupText(JSON.stringify(await exportAll(A)));
    const B = fresh();
    await importAll(B, file);
    expect(await liveNames(B)).toEqual(await liveNames(A));
    expect((await getObligation(bill.id, B))!.data.providerContactId).toBe(plumber);
    expect((await getArrangement(arr.id, B))!.data.providerContactId).toBe(coach);
    expect((await getCommitment(cm.id, B))!.data.vendorContactId).toBe(plumber);
    expect(await B.contacts.count()).toBe(2);
    // after restoring, a typed "Sam Example" is still refused (both are found) and nothing is created
    const e = await resolveContactChoice(B, { name: 'sam example' }).catch((x) => x);
    expect(e).toBeInstanceOf(SameNameContactError);
    expect((e as SameNameContactError).matches.map((m) => m.id).sort()).toEqual([plumber, coach].sort());
    expect(await B.contacts.count()).toBe(2);
  });

  it('the Quick Add result (a provider NAME only, no Contact) survives a backup exactly: still no Contact and no invented id', async () => {
    const A = fresh();
    const bill = await createObligation({ data: ob({ title: 'Quick', schedule: monthly(3, '2026-11'), providerNameSnapshot: 'Quickadd Cable Co' }, TODAY), provider: null, today: TODAY }, A);
    const { file } = checkBackupText(JSON.stringify(await exportAll(A)));
    const B = fresh();
    await importAll(B, file);
    expect((await getObligation(bill.id, B))!.data).toMatchObject({ providerContactId: null, providerNameSnapshot: 'Quickadd Cable Co' });
    expect(await B.contacts.count()).toBe(0);
  });
});
