import { describe, expect, it } from 'vitest';
import type { FinanceDB } from '../../db';
import { planContactRemoval } from '../../core/contactRemoval';
import { readContactReferences } from '../../core/contactReferences';
import { resolveContactChoice, SameNameContactError } from '../../core/contactIdentity';
import { createDistinctContact } from '../../core/contacts';
import { createAsset, getAsset, updateAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import { blankService } from '../assets/service';
import { createService } from '../assets/serviceData';
import { blankWarranty } from '../assets/warranty';
import { createWarranty, updateWarranty } from '../assets/warrantyData';
import { createFromSeed } from '../bills/discoveryData';
import { createObligation, editObligation, getObligation, type ObligationEdit } from '../bills/data';
import { monthly, ob, fresh as freshBills } from '../bills/billsTestkit';
import type { ObligationData } from '../bills/model';
import { billQuickAdd } from '../bills/quickAddDef';
import { createCommitment, createProject, getCommitment, getProject, saveCommitment, addVendor, type CommitmentFields } from '../projects/data';
import { blankProject } from '../projects/model';
import { applyLifecycle, planLifecycle } from '../services/changes';
import { createArrangement, getArrangement, updateArrangement } from '../services/data';
import { blankArrangement } from '../services/model';
import { serviceQuickAdd } from '../services/quickAddDef';
import { loadVisits, logStandaloneVisit } from '../services/visits';
import { PROVIDERS } from './c2-testkit';

/**
 * Contacts U2: each module's write path uses the shared identity boundary. A Contact is chosen by id or created on purpose; a name never selects one; an edit that does
 * not touch the Contact leaves it alone; a removed Contact is shown, not repaired. Invented data only.
 */
const TODAY = '2026-11-09';
const live = async (d: FinanceDB) => (await d.contacts.toArray()).filter((c) => c.deletedAt == null);
const contactsText = async (d: FinanceDB) => JSON.stringify(await d.contacts.toArray());
const remove = (d: FinanceDB, id: number) => d.contacts.update(id, { deletedAt: Date.now() });
const twins = async (d: FinanceDB) => ({
  plumber: await createDistinctContact(d, { name: 'Sam Example', relationship: 'plumber', phone: '555-0101' }),
  coach: await createDistinctContact(d, { name: 'Sam Example', relationship: 'school coach' }),
});

const billEdit = (cur: ObligationData, over: Partial<ObligationEdit> = {}): ObligationEdit => ({
  title: cur.title, type: cur.type, need: cur.need, amountKind: cur.amountKind, amountCents: cur.prices[0]?.cents ?? null, trackingSince: cur.trackingSince, schedule: cur.schedule,
  payment: cur.payment, paidThroughLoan: cur.paidThroughLoan, review: { on: cur.review.on, note: cur.review.note }, refs: cur.refs, notes: cur.notes, ...over,
});
const newBill = (d: FinanceDB, provider: Parameters<typeof createObligation>[0]['provider'], title = 'Example Power') =>
  createObligation({ data: ob({ title, schedule: monthly(18, '2026-11') }, TODAY), provider, today: TODAY }, d);

describe('Bills & Subscriptions: manual entry and editing', () => {
  it('chooses a provider by id: two same-name Contacts stay distinct and each bill keeps ITS Contact\'s id', async () => {
    const d = freshBills('u2b');
    const { plumber, coach } = await twins(d);
    const a = await newBill(d, { contactId: plumber }, 'Bill A');
    const b = await newBill(d, { contactId: coach }, 'Bill B');
    expect((await getObligation(a.id, d))!.data).toMatchObject({ providerContactId: plumber, providerNameSnapshot: 'Sam Example' });
    expect((await getObligation(b.id, d))!.data).toMatchObject({ providerContactId: coach, providerNameSnapshot: 'Sam Example' });
    expect(await d.contacts.count()).toBe(2); // no third Contact, no merge
  });

  it('a typed name that is taken is refused with NOTHING written (no bill, no Contact); "different person" makes a separate Contact', async () => {
    const d = freshBills('u2b');
    const { plumber } = await twins(d);
    const before = await contactsText(d);
    await expect(newBill(d, { name: 'sam example' })).rejects.toBeInstanceOf(SameNameContactError);
    expect(await d.moduleRecords.count()).toBe(0);
    expect(await contactsText(d)).toBe(before);
    const ok = await newBill(d, { name: 'Sam Example', confirmedDifferent: true });
    expect(ok.contactCreated).toBe(true);
    expect(ok.contactId).not.toBe(plumber);
    expect(await d.contacts.count()).toBe(3);
  });

  it('a unique new name creates one Contact and the bill together; a later failure of the bill takes the Contact back (one transaction)', async () => {
    const d = freshBills('u2b');
    const ok = await newBill(d, { name: 'Fresh Utilities', phone: '555-0102' });
    expect(ok.contactCreated).toBe(true);
    expect(await d.contacts.get(ok.contactId!)).toMatchObject({ name: 'Fresh Utilities', phone: '555-0102' });
    const bad = createObligation({ data: ob({ title: '', schedule: monthly(18, '2026-11') }, TODAY), provider: { name: 'Never Saved' }, today: TODAY }, d);
    await expect(bad).rejects.toThrow();
    expect((await live(d)).map((c) => c.name)).toEqual(['Fresh Utilities']);
  });

  it('editing other fields (provider left out, or the same Contact chosen) never changes, recreates or touches the Contact', async () => {
    const d = freshBills('u2b');
    const { plumber } = await twins(d);
    const r = await newBill(d, { contactId: plumber });
    const before = await contactsText(d);
    let cur = (await getObligation(r.id, d))!;
    await editObligation(r.id, billEdit(cur.data, { title: 'Renamed power', notes: 'a note' }), cur.updatedAt, TODAY, d);
    cur = (await getObligation(r.id, d))!;
    expect(cur.data).toMatchObject({ title: 'Renamed power', providerContactId: plumber, providerNameSnapshot: 'Sam Example' });
    await editObligation(r.id, billEdit(cur.data, { provider: { contactId: plumber } }), cur.updatedAt, TODAY, d);
    expect((await getObligation(r.id, d))!.data.providerContactId).toBe(plumber);
    expect(await contactsText(d)).toBe(before);
  });

  it('switching to a new same-name Contact is refused and leaves the bill and Contacts exactly as they were; choosing the other one by id works', async () => {
    const d = freshBills('u2b');
    const { plumber, coach } = await twins(d);
    const r = await newBill(d, { contactId: plumber });
    const cur = (await getObligation(r.id, d))!;
    const rowBefore = JSON.stringify(await d.moduleRecords.get(r.id));
    const cBefore = await contactsText(d);
    await expect(editObligation(r.id, billEdit(cur.data, { provider: { name: 'Sam Example' } }), cur.updatedAt, TODAY, d)).rejects.toBeInstanceOf(SameNameContactError);
    expect(JSON.stringify(await d.moduleRecords.get(r.id))).toBe(rowBefore);
    expect(await contactsText(d)).toBe(cBefore);
    await editObligation(r.id, billEdit(cur.data, { provider: { contactId: coach } }), cur.updatedAt, TODAY, d);
    expect((await getObligation(r.id, d))!.data.providerContactId).toBe(coach);
  });

  it('a removed provider Contact: the stored id is kept when other fields change; it is not recreated; choosing it again is refused in words', async () => {
    const d = freshBills('u2b');
    const { plumber } = await twins(d);
    const r = await newBill(d, { contactId: plumber });
    await remove(d, plumber);
    const before = await contactsText(d);
    const cur = (await getObligation(r.id, d))!;
    await editObligation(r.id, billEdit(cur.data, { title: 'Renamed power' }), cur.updatedAt, TODAY, d);
    const after = (await getObligation(r.id, d))!;
    expect(after.data).toMatchObject({ title: 'Renamed power', providerContactId: plumber, providerNameSnapshot: 'Sam Example' });
    await expect(editObligation(r.id, billEdit(after.data, { provider: { contactId: plumber } }), after.updatedAt, TODAY, d)).rejects.toThrow(/no longer exists/);
    expect(await contactsText(d)).toBe(before);
    expect((await live(d)).map((c) => c.relationship)).toEqual(['school coach']);
  });

  it('"No provider" clears the link and the name; nothing else happens to the Contact', async () => {
    const d = freshBills('u2b');
    const { plumber } = await twins(d);
    const r = await newBill(d, { contactId: plumber });
    const before = await contactsText(d);
    const cur = (await getObligation(r.id, d))!;
    await editObligation(r.id, billEdit(cur.data, { provider: null }), cur.updatedAt, TODAY, d);
    expect((await getObligation(r.id, d))!.data).toMatchObject({ providerContactId: null, providerNameSnapshot: '' });
    expect(await contactsText(d)).toBe(before);
  });
});

describe('Bills & Subscriptions: Quick Add and discovery never link or create a Contact from a name', () => {
  it('Quick Add keeps the provider name as words only, even when a Contact with that name exists; that Contact is untouched', async () => {
    const d = freshBills('u2q');
    const { plumber } = await twins(d);
    const before = await contactsText(d);
    const { db } = await import('../../db');
    await db.contacts.clear(); await db.moduleRecords.clear();
    const existing = await createDistinctContact(db, { name: 'Quickadd Cable Co', phone: '555-0103' });
    const snap = await contactsText(db);
    const preview = billQuickAdd.parse!('Quickadd Cable 79.99 monthly 3rd manual with Quickadd Cable Co', {})!;
    expect(preview.fields.find((f) => f.label === 'Provider')!.value).toMatch(/name only, no contact linked/);
    await billQuickAdd.commit!(preview);
    const rows = (await db.moduleRecords.toArray()).filter((r) => r.module === 'bills' && r.kind === 'obligation');
    expect(rows).toHaveLength(1);
    expect((rows[0].data as unknown as ObligationData).providerContactId ?? null).toBeNull();
    expect((rows[0].data as unknown as ObligationData).providerNameSnapshot).toBe('Quickadd Cable Co');
    expect(await contactsText(db)).toBe(snap); // no Contact made, filled in or edited
    expect(existing).toBeGreaterThan(0);
    expect(plumber).toBeGreaterThan(0);
    expect(before.length).toBeGreaterThan(0);
    await db.contacts.clear(); await db.moduleRecords.clear();
  });

  it('a discovery ("create from this suggestion") save with no Contact chosen keeps the payee name as words and creates no Contact', async () => {
    const d = freshBills('u2d');
    const seedData = ob({ title: 'Streamly Premium', schedule: monthly(12, '2026-11'), providerNameSnapshot: 'Streamly Premium' }, TODAY);
    const out = await createFromSeed({ data: seedData, provider: null, today: TODAY }, d);
    expect((await getObligation(out.id, d))!.data).toMatchObject({ providerContactId: null, providerNameSnapshot: 'Streamly Premium' });
    expect(await d.contacts.count()).toBe(0);
    // and the owner can still choose a Contact for it afterwards, by id
    const c = await createDistinctContact(d, { name: 'Streamly Premium' });
    const cur = (await getObligation(out.id, d))!;
    await editObligation(out.id, billEdit(cur.data, { provider: { contactId: c } }), cur.updatedAt, TODAY, d);
    expect((await getObligation(out.id, d))!.data.providerContactId).toBe(c);
  });
});

const fields = (over: Partial<CommitmentFields> = {}): CommitmentFields => ({
  title: 'Cabinet quote', amountCents: 123400, status: 'quoted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: null, notes: '', ...over,
});

describe('Projects: vendors and commitments', () => {
  it('a vendor is chosen by id: it is added to the project once, with no second copy; two same-name vendors stay distinct', async () => {
    const d = freshBills('u2p');
    const { plumber, coach } = await twins(d);
    const p = await createProject(blankProject({ name: 'Kitchen refit' }), d);
    const c1 = await createCommitment(p, fields({ vendorContactId: plumber }), d);
    const c2 = await createCommitment(p, fields({ title: 'Second quote', vendorContactId: coach }), d);
    expect((await getProject(p, d))!.data.vendorContactIds).toEqual([plumber, coach]);
    expect((await getCommitment(c1.id, d))!.data.vendorContactId).toBe(plumber);
    expect((await getCommitment(c2.id, d))!.data.vendorContactId).toBe(coach);
    expect(await d.contacts.count()).toBe(2);
  });

  it('a NEW vendor is made in the same transaction as the commitment; a taken name is refused and writes NOTHING (no commitment, no vendor, no Contact)', async () => {
    const d = freshBills('u2p');
    const { plumber } = await twins(d);
    const p = await createProject(blankProject({ name: 'Kitchen refit' }), d);
    const ok = await createCommitment(p, fields({ newVendor: { name: 'Brand New Tiles', phone: '555-0104' } }), d);
    expect(ok.contactCreated).toBe(true);
    const made = (await getCommitment(ok.id, d))!.data.vendorContactId!;
    expect(await d.contacts.get(made)).toMatchObject({ name: 'Brand New Tiles', phone: '555-0104' });
    expect((await getProject(p, d))!.data.vendorContactIds).toEqual([made]);

    const cBefore = await contactsText(d);
    const commitmentsBefore = await d.moduleRecords.count();
    await expect(createCommitment(p, fields({ title: 'Another', newVendor: { name: ' sam   EXAMPLE ' } }), d)).rejects.toBeInstanceOf(SameNameContactError);
    expect(await d.moduleRecords.count()).toBe(commitmentsBefore);
    expect(await contactsText(d)).toBe(cBefore);
    expect((await getProject(p, d))!.data.vendorContactIds).toEqual([made]);

    const sep = await createCommitment(p, fields({ title: 'Third', newVendor: { name: 'Sam Example', confirmedDifferent: true } }), d);
    const sepId = (await getCommitment(sep.id, d))!.data.vendorContactId!;
    expect(sepId).not.toBe(plumber);
    expect(await d.contacts.count()).toBe(4);
  });

  it('a commitment that fails validation after a new vendor was asked for leaves no stray Contact', async () => {
    const d = freshBills('u2p');
    const p = await createProject(blankProject({ name: 'Kitchen refit' }), d);
    await expect(createCommitment(p, fields({ title: '', newVendor: { name: 'Never Saved Co' } }), d)).rejects.toThrow();
    expect(await d.contacts.count()).toBe(0);
  });

  it('editing a commitment without changing the vendor never creates or edits a Contact; a removed vendor keeps its id and does not block the edit', async () => {
    const d = freshBills('u2p');
    const { plumber } = await twins(d);
    const p = await createProject(blankProject({ name: 'Kitchen refit' }), d);
    const c = await createCommitment(p, fields({ vendorContactId: plumber }), d);
    const before = await contactsText(d);
    await saveCommitment(c.id, fields({ title: 'Renamed quote', vendorContactId: plumber, notes: 'edited' }), d);
    expect((await getCommitment(c.id, d))!.data).toMatchObject({ title: 'Renamed quote', vendorContactId: plumber });
    expect(await contactsText(d)).toBe(before);
    await remove(d, plumber);
    const afterRemove = await contactsText(d);
    await saveCommitment(c.id, fields({ title: 'Renamed again', vendorContactId: plumber }), d);
    expect((await getCommitment(c.id, d))!.data).toMatchObject({ title: 'Renamed again', vendorContactId: plumber }); // not replaced, not cleared
    expect(await contactsText(d)).toBe(afterRemove);
    // switching to ANOTHER removed Contact is still refused
    const gone = await createDistinctContact(d, { name: 'Other Gone' });
    await remove(d, gone);
    await expect(saveCommitment(c.id, fields({ vendorContactId: gone }), d)).rejects.toThrow(/not in your contacts/);
  });

  it('adding an existing vendor to a project is by id and idempotent', async () => {
    const d = freshBills('u2p');
    const { plumber } = await twins(d);
    const p = await createProject(blankProject({ name: 'Kitchen refit' }), d);
    await addVendor(p, plumber, d); await addVendor(p, plumber, d);
    expect((await getProject(p, d))!.data.vendorContactIds).toEqual([plumber]);
  });
});

describe('Household Services: arrangements, visits and replacing a provider', () => {
  const draft = (title = 'House cleaning') => blankArrangement({ title });

  it('an arrangement\'s provider is chosen by id; its id stays after unrelated edits; same-name Contacts stay distinct', async () => {
    const d = freshBills('u2s');
    const { plumber, coach } = await twins(d);
    const a = await createArrangement({ data: draft(), provider: { contactId: plumber }, today: TODAY }, d);
    const b = await createArrangement({ data: draft('Lawn'), provider: { contactId: coach }, today: TODAY }, d);
    const cur = (await getArrangement(a.id, d))!;
    const before = await contactsText(d);
    await updateArrangement(a.id, { title: 'Renamed', startDate: null, extraContactIds: cur.data.extraContactIds, expected: null, refs: [], notes: 'n', assignProvider: null, assetIds: [] }, cur.updatedAt, d);
    expect((await getArrangement(a.id, d))!.data).toMatchObject({ title: 'Renamed', providerContactId: plumber });
    expect((await getArrangement(b.id, d))!.data.providerContactId).toBe(coach);
    expect(await contactsText(d)).toBe(before);
  });

  it('a new provider with a taken name is refused with nothing written; confirmed, it is a separate Contact', async () => {
    const d = freshBills('u2s');
    const { plumber } = await twins(d);
    const before = await contactsText(d);
    await expect(createArrangement({ data: draft(), provider: { name: 'Sam Example' }, today: TODAY }, d)).rejects.toBeInstanceOf(SameNameContactError);
    expect(await d.moduleRecords.count()).toBe(0);
    expect(await contactsText(d)).toBe(before);
    const ok = await createArrangement({ data: draft(), provider: { name: 'Sam Example', confirmedDifferent: true }, today: TODAY }, d);
    expect(ok.contactCreated).toBe(true);
    expect(ok.contactId).not.toBe(plumber);
  });

  it('assigning a provider later: by id works; a taken typed name is refused and the arrangement is unchanged', async () => {
    const d = freshBills('u2s');
    const { plumber } = await twins(d);
    const a = await createArrangement({ data: draft(), provider: null, today: TODAY }, d);
    const cur = (await getArrangement(a.id, d))!;
    const edit = (assignProvider: Parameters<typeof updateArrangement>[1]['assignProvider']) => ({ title: cur.data.title, startDate: null, extraContactIds: [], expected: null, refs: [], notes: '', assignProvider, assetIds: [] });
    const rowBefore = JSON.stringify(await d.moduleRecords.get(a.id));
    await expect(updateArrangement(a.id, edit({ name: 'sam example' }), cur.updatedAt, d)).rejects.toBeInstanceOf(SameNameContactError);
    expect(JSON.stringify(await d.moduleRecords.get(a.id))).toBe(rowBefore);
    await updateArrangement(a.id, edit({ contactId: plumber }), cur.updatedAt, d);
    expect((await getArrangement(a.id, d))!.data).toMatchObject({ providerContactId: plumber, providerNameSnapshot: 'Sam Example' });
  });

  it('Replace provider: a typed taken name is refused and the old arrangement stays active with no successor; choosing by id works and keeps the old provider on the old arrangement', async () => {
    const d = freshBills('u2s');
    const { plumber, coach } = await twins(d);
    const a = await createArrangement({ data: draft(), provider: { contactId: plumber }, today: TODAY }, d);
    const plan = await planLifecycle(a.id, 'replace', TODAY, d);
    const rowBefore = JSON.stringify(await d.moduleRecords.get(a.id));
    const before = await contactsText(d);
    await expect(applyLifecycle({ action: 'replace', arrangementId: a.id, expect: plan.expect, today: TODAY, replace: { provider: { name: 'Sam Example' } } }, d)).rejects.toBeInstanceOf(SameNameContactError);
    expect(JSON.stringify(await d.moduleRecords.get(a.id))).toBe(rowBefore);
    expect(await contactsText(d)).toBe(before);
    const res = await applyLifecycle({ action: 'replace', arrangementId: a.id, expect: plan.expect, today: TODAY, replace: { provider: { contactId: coach } } }, d);
    expect((await getArrangement(res.successorId!, d))!.data.providerContactId).toBe(coach);
    expect((await getArrangement(a.id, d))!.data.providerContactId).toBe(plumber); // history stays with the original provider
  });

  it('a removed provider Contact: the arrangement keeps its stored id on unrelated edits; it is surfaced, not repaired', async () => {
    const d = freshBills('u2s');
    const { plumber } = await twins(d);
    const a = await createArrangement({ data: draft(), provider: { contactId: plumber }, today: TODAY }, d);
    await remove(d, plumber);
    const before = await contactsText(d);
    const cur = (await getArrangement(a.id, d))!;
    await updateArrangement(a.id, { title: 'Renamed', startDate: null, extraContactIds: [], expected: null, refs: [], notes: '', assignProvider: null, assetIds: [] }, cur.updatedAt, d);
    expect((await getArrangement(a.id, d))!.data).toMatchObject({ providerContactId: plumber, providerNameSnapshot: 'Sam Example' });
    expect(await contactsText(d)).toBe(before);
  });

  it('a one-off visit: the provider is chosen by id or created on purpose; a taken name is refused and logs nothing', async () => {
    const d = freshBills('u2s');
    const { plumber } = await twins(d);
    const input = { title: 'Tap repair', status: 'completed' as const, cancelledBy: null, date: '2026-11-03', notes: '', chargedCents: null, chargeKind: null };
    const byId = await logStandaloneVisit({ provider: { contactId: plumber }, input, today: TODAY }, d);
    expect(byId.contactId).toBe(plumber);
    const cBefore = await contactsText(d);
    await expect(logStandaloneVisit({ provider: { name: 'Sam Example' }, input: { ...input, title: 'Other' }, today: TODAY }, d)).rejects.toBeInstanceOf(SameNameContactError);
    expect(await loadVisits(d)).toHaveLength(1);
    expect(await contactsText(d)).toBe(cBefore);
    const sep = await logStandaloneVisit({ provider: { name: 'Sam Example', confirmedDifferent: true }, input: { ...input, title: 'Third' }, today: TODAY }, d);
    expect(sep.contactCreated).toBe(true);
    expect(sep.contactId).not.toBe(plumber);
  });

  it('Quick Add (arrangement and one-off visit) keeps the provider name as words only: no Contact is created, found, filled in or linked', async () => {
    const { db } = await import('../../db');
    await db.contacts.clear(); await db.moduleRecords.clear(); await db.links.clear();
    await createDistinctContact(db, { name: "Rosa's Cleaning", phone: '555-0105' });
    const snap = await contactsText(db);
    const a = serviceQuickAdd.parse!("House cleaning with Rosa's Cleaning every other Friday")!;
    expect(a.fields.find((f) => f.label === 'Provider')!.value).toMatch(/name only, no contact linked/);
    await serviceQuickAdd.commit!(a);
    const v = serviceQuickAdd.parse!("visit Drain repair with Rosa's Cleaning 2026-11-01")!;
    await serviceQuickAdd.commit!(v);
    const arr = (await db.moduleRecords.toArray()).find((r) => r.module === 'services' && r.kind === 'arrangement')!;
    expect(arr.data as object).toMatchObject({ providerNameSnapshot: "Rosa's Cleaning" });
    expect((arr.data as { providerContactId: number | null }).providerContactId ?? null).toBeNull();
    const visit = (await loadVisits(db))[0];
    expect(visit.data).toMatchObject({ providerContactId: null, providerNameSnapshot: "Rosa's Cleaning" });
    expect(await contactsText(db)).toBe(snap);
    await db.contacts.clear(); await db.moduleRecords.clear(); await db.links.clear();
  });
});

describe('Home & Assets: asset contacts, warranty and service providers', () => {
  it('asset contact roles keep their Contact ids; updating the asset never touches the Contacts', async () => {
    const d = freshBills('u2a');
    const { plumber, coach } = await twins(d);
    const id = await createAsset(blankAsset({ name: 'Boiler', type: 'appliance', contacts: [{ contactId: plumber, role: 'installer' }, { contactId: coach, role: 'servicer' }] }), d);
    const before = await contactsText(d);
    const cur = (await getAsset(id, d))!;
    await updateAsset(id, { ...cur.data, notes: 'serviced' }, d);
    expect((await getAsset(id, d))!.data.contacts).toEqual([{ contactId: plumber, role: 'installer' }, { contactId: coach, role: 'servicer' }]);
    expect(await contactsText(d)).toBe(before);
  });

  it('a warranty provider is stored by id; unrelated edits keep it, even if the Contact was removed since', async () => {
    const d = freshBills('u2a');
    const { plumber } = await twins(d);
    const asset = await createAsset(blankAsset({ name: 'Boiler', type: 'appliance' }), d);
    const w = await createWarranty({ ...blankWarranty(asset), title: 'Boiler warranty', providerContactId: plumber }, d);
    const rowOf = async () => (await d.moduleRecords.get(w))!.data as { providerContactId: number; title: string };
    expect((await rowOf()).providerContactId).toBe(plumber);
    await remove(d, plumber);
    const base = await rowOf();
    await updateWarranty(w, { ...blankWarranty(asset), ...base, title: 'Renamed warranty' } as never, d);
    expect(await rowOf()).toMatchObject({ providerContactId: plumber, title: 'Renamed warranty' });
  });

  it('a service record provider is stored by id and a removed Contact id is kept, not repaired', async () => {
    const d = freshBills('u2a');
    const { coach } = await twins(d);
    const asset = await createAsset(blankAsset({ name: 'Boiler', type: 'appliance' }), d);
    const s = await createService(blankService(asset, { date: '2026-10-01', title: 'Annual check', providerContactId: coach }), d, TODAY);
    expect(((await d.moduleRecords.get(s))!.data as { providerContactId: number }).providerContactId).toBe(coach);
  });

  it('the "create a new contact" step used by the three forms refuses a taken name and creates only on confirmation', async () => {
    const d = freshBills('u2a');
    const { plumber } = await twins(d);
    await expect(resolveContactChoice(d, { name: 'Sam Example', phone: '555-0999' })).rejects.toBeInstanceOf(SameNameContactError);
    expect((await d.contacts.get(plumber))!.phone).toBe('555-0101'); // not overwritten
    const r = await resolveContactChoice(d, { name: 'Sam Example', phone: '555-0999', confirmedDifferent: true });
    expect(r.id).not.toBe(plumber);
  });
});

describe('C2 compatibility: references, guarded removal and the cross-device recovery path', () => {
  it('every module\'s stored Contact field is still found by the C2 named readers, for each of two same-name Contacts separately', async () => {
    const d = freshBills('u2c');
    const { plumber, coach } = await twins(d);
    await newBill(d, { contactId: plumber }, 'Power');
    const p = await createProject(blankProject({ name: 'Kitchen refit' }), d);
    await createCommitment(p, fields({ vendorContactId: plumber }), d);
    await createArrangement({ data: blankArrangement({ title: 'Cleaning' }), provider: { contactId: plumber }, today: TODAY }, d);
    const asset = await createAsset(blankAsset({ name: 'Boiler', type: 'appliance', contacts: [{ contactId: plumber, role: 'installer' }] }), d);
    await createWarranty({ ...blankWarranty(asset), title: 'Warranty', providerContactId: plumber }, d);
    await newBill(d, { contactId: coach }, 'Coach bill');
    const refs = (await readContactReferences([plumber, coach], d, PROVIDERS, TODAY)).byContact;
    const mods = (id: number) => [...new Set((refs.get(id) ?? []).map((r) => r.module))].sort();
    expect(mods(plumber)).toEqual(['assets', 'bills', 'projects', 'services']);
    expect(mods(coach)).toEqual(['bills']);
    expect((refs.get(coach) ?? []).map((r) => r.title)).toEqual(['Coach bill']);
  });

  it('a Contact used by a record written through U2 cannot be removed, and a Contact made but never used still can', async () => {
    const d = freshBills('u2c');
    const { plumber, coach } = await twins(d);
    const spare = await createDistinctContact(d, { name: 'Unused Person' });
    await newBill(d, { contactId: plumber }, 'Power');
    const created = await createArrangement({ data: blankArrangement({ title: 'Cleaning' }), provider: { name: 'Fresh Cleaners' }, today: TODAY }, d);
    expect((await planContactRemoval(d, plumber, PROVIDERS, TODAY)).eligible).toBe(false);
    expect((await planContactRemoval(d, created.contactId!, PROVIDERS, TODAY)).eligible).toBe(false);
    expect((await planContactRemoval(d, coach, PROVIDERS, TODAY)).eligible).toBe(true);
    expect((await planContactRemoval(d, spare, PROVIDERS, TODAY)).eligible).toBe(true);
  });

  it('a refused same-name creation leaves no unused Contact behind that would later look removable', async () => {
    const d = freshBills('u2c');
    await twins(d);
    const before = await d.contacts.count();
    await expect(newBill(d, { name: 'Sam Example' })).rejects.toBeInstanceOf(SameNameContactError);
    await expect(createArrangement({ data: blankArrangement({ title: 'x' }), provider: { name: 'Sam Example' }, today: TODAY }, d)).rejects.toBeInstanceOf(SameNameContactError);
    expect(await d.contacts.count()).toBe(before);
  });
});
