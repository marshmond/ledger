import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { stable } from '../../lib/sync/merge';
import { contactIsReferenced } from '../services/undo';
import {
  applyLifecycle, buildLifecycle, createObligation, deleteObligation, editObligation, getObligation, loadObligations, planDelete, planLifecycle, resolveProvider, setReview, writeObligation,
  type LifecycleAction, type ObligationEdit,
} from './data';
import { asObligation, MODULE, obligationRef, type ObligationData } from './model';
import { expectedDates } from './schedule';
import { applyUndo, fingerprint, isUndoRefused, UNDO_REFUSED, UNDO_UNVERIFIED, type Undo } from './undo';
import { scheduleSource } from './model';
import { financeSnapshot, fresh, monthly, ob, sleep } from './billsTestkit';

/** Real Dexie. Invented data only. 2026-11-07 is a Saturday. */
const TODAY = '2026-11-07';
const add = (d: FinanceDB, over: Partial<ObligationData> = {}, provider: { name: string } | null = { name: 'Example Power Co' }) => createObligation({ data: ob(over, TODAY), provider }, d);
const edit = (cur: ObligationData): ObligationEdit => ({
  title: cur.title, type: cur.type, need: cur.need, amountKind: cur.amountKind, amountCents: cur.prices[0]?.cents ?? null, trackingSince: cur.trackingSince, schedule: cur.schedule,
  payment: cur.payment, paidThroughLoan: cur.paidThroughLoan, review: { on: cur.review.on, note: cur.review.note }, refs: cur.refs, notes: cur.notes,
});
const all = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray()]);
const life = async (d: FinanceDB, id: number, action: LifecycleAction, date?: string, reason?: 'cancelled' | 'finished') => {
  const plan = await planLifecycle(id, action, { today: TODAY, date, reason }, d);
  return applyLifecycle({ id, action, expect: plan.expect, today: TODAY, date, reason }, d);
};
const dates = async (d: FinanceDB, id: number, from: string, to: string) => expectedDates(scheduleSource((await getObligation(id, d))!.data), from, to).map((e) => e.nominal);

describe('B1: creating, reading and the shared provider Contact', () => {
  it('adds an obligation and a provider Contact in one transaction, with a name snapshot', async () => {
    const d = fresh();
    const r = await add(d);
    expect(r.contactCreated).toBe(true);
    const got = (await getObligation(r.id, d))!;
    expect(got.data.providerContactId).toBe(r.contactId);
    expect(got.data.providerNameSnapshot).toBe('Example Power Co');
    expect((await d.contacts.toArray())).toHaveLength(1);
    expect((await d.moduleRecords.toArray()).filter((x) => x.module !== MODULE)).toHaveLength(0);
  });
  it('a second bill from the same provider reuses the Contact (never a duplicate), also when typed differently', async () => {
    const d = fresh();
    const a = await add(d);
    const b = await add(d, { title: 'Second meter' }, { name: '  example   POWER co ' });
    expect(b.contactCreated).toBe(false);
    expect(b.contactId).toBe(a.contactId);
    expect(await d.contacts.count()).toBe(1);
  });
  it('picking an existing Contact by id works; a missing one is refused in words and nothing is written', async () => {
    const d = fresh();
    const c = await createStore(d).shared.contacts.put({ name: 'Maple Insurance' } as never);
    const r = await createObligation({ data: ob({ title: 'Home insurance' }, TODAY), provider: { contactId: c } }, d);
    expect((await getObligation(r.id, d))!.data.providerNameSnapshot).toBe('Maple Insurance');
    const before = await all(d);
    await expect(createObligation({ data: ob({}, TODAY), provider: { contactId: 999 } }, d)).rejects.toThrow(/no longer exists/);
    expect(await all(d)).toBe(before);
  });
  it('an invalid record is refused with a plain message and writes nothing (not even the Contact)', async () => {
    const d = fresh();
    const before = await all(d);
    await expect(createObligation({ data: ob({ title: '' }, TODAY), provider: { name: 'Example Power Co' } }, d)).rejects.toThrow(/what the bill/);
    expect(await all(d)).toBe(before);
  });
  it('a bill with no provider is fine', async () => {
    const d = fresh();
    const r = await add(d, {}, null);
    expect((await getObligation(r.id, d))!.data.providerContactId).toBeNull();
    expect(await d.contacts.count()).toBe(0);
  });
  it('loads only live bills, sorted by title, ignoring other modules and kinds', async () => {
    const d = fresh();
    await add(d, { title: 'Zeta' }, null);
    await add(d, { title: 'Alpha' }, null);
    await d.moduleRecords.add({ id: 5, module: 'services', kind: 'arrangement', data: {}, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await d.moduleRecords.add({ id: 6, module: MODULE, kind: 'cycle', data: { obligationId: 1 }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    expect((await loadObligations(d)).map((r) => r.data.title)).toEqual(['Alpha', 'Zeta']);
  });
  it('the provider Contact is still protected after the bill is added (the shared "is it used" check sees it)', async () => {
    const d = fresh();
    const r = await add(d);
    expect(await contactIsReferenced(r.contactId!, d)).toBe(true);
  });
  it('resolveProvider rejects bad input in words', async () => {
    const d = fresh();
    await expect(d.transaction('rw', [d.moduleRecords, d.links, d.contacts], () => resolveProvider({ name: '  ' }, d))).rejects.toThrow(/provider/);
    await expect(d.transaction('rw', [d.moduleRecords, d.links, d.contacts], () => resolveProvider({ name: 'X', email: 'nope' }, d))).rejects.toThrow(/email/);
  });
});

describe('B1: editing', () => {
  it('saves the fields and keeps unknown fields and unreadable values', async () => {
    const d = fresh();
    const r = await add(d);
    await d.moduleRecords.update(r.id, { data: { ...(await d.moduleRecords.get(r.id))!.data, futureThing: { a: 1 }, status: undefined } as never });
    // damage one field the form does not touch: a payee hint list becomes junk
    const raw = (await d.moduleRecords.get(r.id))!;
    await d.moduleRecords.put({ ...raw, data: { ...(raw.data as object), review: 'junk' } as never });
    const cur = (await getObligation(r.id, d))!;
    await editObligation(r.id, { ...edit(cur.data), title: 'Renamed power bill', notes: 'hello' }, cur.updatedAt, TODAY, d);
    const stored = (await d.moduleRecords.get(r.id))!.data as Record<string, unknown>;
    expect(stored.title).toBe('Renamed power bill');
    expect(stored.futureThing).toEqual({ a: 1 });
  });
  it('refuses when the record changed since the form opened, and writes nothing', async () => {
    const d = fresh();
    const r = await add(d);
    const cur = (await getObligation(r.id, d))!;
    await sleep(5);
    await setReview(r.id, true, 'x', null, TODAY, d); // another change lands first
    const before = await all(d);
    await expect(editObligation(r.id, { ...edit(cur.data), title: 'Late edit' }, cur.updatedAt, TODAY, d)).rejects.toThrow(/was changed/);
    expect(await all(d)).toBe(before);
  });
  it('changing the first price edits only that step and keeps later steps', async () => {
    const d = fresh();
    const r = await add(d, { prices: [{ from: '2026-11-07', cents: 499, label: 'intro' }, { from: '2027-02-12', cents: 1549, label: 'regular' }] });
    const cur = (await getObligation(r.id, d))!;
    await editObligation(r.id, { ...edit(cur.data), amountCents: 599 }, cur.updatedAt, TODAY, d);
    const after = (await getObligation(r.id, d))!.data.prices;
    expect(after.map((p) => p.cents)).toEqual([599, 1549]);
    expect(after[0].label).toBe('intro');
  });
  it('a schedule change keeps the old schedule in the history and the dates before it', async () => {
    const d = fresh();
    const r = await add(d, { schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01', prices: [{ from: '2026-01-01', cents: 9000, label: '' }] });
    const cur = (await getObligation(r.id, d))!;
    await editObligation(r.id, { ...edit(cur.data), schedule: monthly(20, '2027-01'), scheduleFrom: '2027-01-01' }, cur.updatedAt, TODAY, d);
    const after = (await getObligation(r.id, d))!.data;
    expect(after.scheduleHistory).toEqual([{ until: '2026-12-31', schedule: monthly(12, '2026-01') }]);
    expect(await dates(d, r.id, '2026-11-01', '2027-02-28')).toEqual(['2026-11-12', '2026-12-12', '2027-01-20', '2027-02-20']);
  });
  it('a schedule change that would double a billing period is refused with the period named, and nothing is written', async () => {
    const d = fresh();
    const r = await add(d, { schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01', prices: [{ from: '2026-01-01', cents: 9000, label: '' }] });
    const cur = (await getObligation(r.id, d))!;
    const before = await all(d);
    await expect(editObligation(r.id, { ...edit(cur.data), schedule: monthly(20, '2026-01'), scheduleFrom: '2026-12-15' }, cur.updatedAt, TODAY, d)).rejects.toThrow(/December 2026/);
    expect(await all(d)).toBe(before);
  });
  it('changing the provider updates the snapshot; leaving it alone keeps working even if the Contact was removed', async () => {
    const d = fresh();
    const r = await add(d);
    const cur = (await getObligation(r.id, d))!;
    await createStore(d).shared.contacts.remove(r.contactId!);
    await editObligation(r.id, { ...edit(cur.data), title: 'Still editable' }, cur.updatedAt, TODAY, d); // provider: undefined = leave as is
    const kept = (await getObligation(r.id, d))!;
    expect(kept.data.providerNameSnapshot).toBe('Example Power Co');
    expect(kept.data.providerContactId).toBe(r.contactId);
    await editObligation(r.id, { ...edit(kept.data), provider: { name: 'Maple Utilities' } }, kept.updatedAt, TODAY, d);
    expect((await getObligation(r.id, d))!.data.providerNameSnapshot).toBe('Maple Utilities');
    const cleared = (await getObligation(r.id, d))!;
    await editObligation(r.id, { ...edit(cleared.data), provider: null }, cleared.updatedAt, TODAY, d);
    expect((await getObligation(r.id, d))!.data.providerContactId).toBeNull();
  });
  it('the review list: on, with a note and a date; off keeps the note; never changes anything else', async () => {
    const d = fresh();
    const r = await add(d);
    const cur = (await getObligation(r.id, d))!;
    await setReview(r.id, true, '  look again ', cur.updatedAt, TODAY, d);
    const on = (await getObligation(r.id, d))!;
    expect(on.data.review).toEqual({ on: true, note: 'look again', since: TODAY });
    expect({ ...on.data, review: cur.data.review }).toEqual(cur.data);
    await sleep(3);
    await setReview(r.id, false, 'look again', on.updatedAt, '2026-12-01', d);
    expect((await getObligation(r.id, d))!.data.review.on).toBe(false);
    // any obligation, including an essential one, may be listed (A-11)
    expect(on.data.need).toBe('essential');
  });
});

describe('B1: pause, resume, end and reopen (test 36)', () => {
  const setup = async () => { const d = fresh(); const r = await add(d, { schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01', prices: [{ from: '2026-01-01', cents: 9000, label: '' }] }); return { d, id: r.id }; };
  it('pause leaves out dates from the pause day; resume brings them back and does not catch up', async () => {
    const { d, id } = await setup();
    await life(d, id, 'pause', '2026-12-01');
    expect((await getObligation(id, d))!.data.status).toBe('paused');
    expect(await dates(d, id, '2026-11-01', '2027-02-28')).toEqual(['2026-11-12']);
    await life(d, id, 'resume', '2027-02-01');
    const after = (await getObligation(id, d))!.data;
    expect(after.status).toBe('active');
    expect(after.pauses).toEqual([{ from: '2026-12-01', to: '2027-02-01' }]);
    expect(await dates(d, id, '2026-11-01', '2027-03-31')).toEqual(['2026-11-12', '2027-02-12', '2027-03-12']);
    expect(after.lifecycle.map((e) => e.kind)).toEqual(['paused', 'resumed']);
  });
  it('end stops dates after the end day and keeps everything; reopen restores them but not the ended gap', async () => {
    const { d, id } = await setup();
    await life(d, id, 'end', '2026-12-12', 'cancelled');
    const ended = (await getObligation(id, d))!.data;
    expect(ended).toMatchObject({ status: 'ended', endedOn: '2026-12-12', endReason: 'cancelled' });
    expect(await dates(d, id, '2026-11-01', '2027-03-31')).toEqual(['2026-11-12', '2026-12-12']);
    await life(d, id, 'reopen', '2027-02-01');
    const re = (await getObligation(id, d))!.data;
    expect(re).toMatchObject({ status: 'active', endedOn: null, endReason: null });
    expect(re.pauses).toEqual([{ from: '2026-12-13', to: '2027-02-01' }]);
    expect(await dates(d, id, '2026-11-01', '2027-03-31')).toEqual(['2026-11-12', '2026-12-12', '2027-02-12', '2027-03-12']);
    expect(re.title).toBe(ended.title);
    expect(re.prices).toEqual(ended.prices);
    expect(re.lifecycle.map((e) => e.kind)).toEqual(['ended', 'reopened']);
  });
  it('ending while paused closes the pause at the end; ending in the future keeps it expected until then', async () => {
    const { d, id } = await setup();
    await life(d, id, 'pause', '2026-11-20');
    await life(d, id, 'end', '2026-12-31', 'finished');
    const e = (await getObligation(id, d))!.data;
    expect(e.pauses).toEqual([{ from: '2026-11-20', to: '2027-01-01' }]);
    expect(e.status).toBe('ended');
    const d2 = fresh();
    const r2 = await add(d2, { schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01', prices: [{ from: '2026-01-01', cents: 9000, label: '' }] });
    await life(d2, r2.id, 'end', '2027-01-15');
    expect(await dates(d2, r2.id, '2026-11-01', '2027-06-30')).toEqual(['2026-11-12', '2026-12-12', '2027-01-12']);
  });
  it('reopening an item ended only briefly keeps no gap', async () => {
    const { d, id } = await setup();
    await life(d, id, 'end', '2026-11-07');
    await life(d, id, 'reopen', '2026-11-08');
    expect((await getObligation(id, d))!.data.pauses).toEqual([]);
  });
  it('each wrong transition is refused in words (pause an ended bill, resume an active one, end twice, reopen an active one)', async () => {
    const { d, id } = await setup();
    const cur = (await getObligation(id, d))!.data;
    expect(buildLifecycle(cur, 'resume', { today: TODAY }).problem).toMatch(/not paused/);
    expect(buildLifecycle(cur, 'reopen', { today: TODAY }).problem).toMatch(/not ended/);
    await life(d, id, 'end', TODAY);
    const ended = (await getObligation(id, d))!.data;
    expect(buildLifecycle(ended, 'pause', { today: TODAY }).problem).toMatch(/Reopen/);
    expect(buildLifecycle(ended, 'end', { today: TODAY }).problem).toMatch(/already ended/);
    await expect(applyLifecycle({ id, action: 'pause', expect: null, today: TODAY }, d)).rejects.toThrow(/Reopen/);
  });
  it('the preview says what will happen and writes nothing; the apply refuses if the record changed since the preview', async () => {
    const { d, id } = await setup();
    const before = await all(d);
    const plan = await planLifecycle(id, 'pause', { today: TODAY }, d);
    expect(plan.lines.join(' ')).toMatch(/Pause "Example Power Co"/);
    expect(plan.lines.join(' ')).toMatch(/Nothing in Finance, Tasks or the Calendar is changed/);
    expect(await all(d)).toBe(before);
    await sleep(5);
    await setReview(id, true, '', null, TODAY, d); // someone else changes it
    await expect(applyLifecycle({ id, action: 'pause', expect: plan.expect, today: TODAY }, d)).rejects.toThrow(/was changed/);
    expect((await getObligation(id, d))!.data.status).toBe('active');
  });
  it('an unsupported status cannot be paused, ended or reopened here (fail closed, in words)', async () => {
    const d = fresh();
    const r = await add(d);
    const raw = (await d.moduleRecords.get(r.id))!;
    await d.moduleRecords.put({ ...raw, data: { ...(raw.data as object), status: 'snoozed' } as never });
    const cur = (await getObligation(r.id, d))!;
    for (const a of ['pause', 'resume', 'end', 'reopen'] as const) expect(buildLifecycle(cur.data, a, { today: TODAY }).problem).toMatch(/does not understand/);
    expect(await dates(d, r.id, '2026-11-01', '2027-06-30')).toEqual([]);
  });
});

describe('B1: local guarded Undo (test 86)', () => {
  const ops: { name: string; run: (d: FinanceDB, id: number) => Promise<Undo> }[] = [
    { name: 'edit', run: async (d, id) => { const c = (await getObligation(id, d))!; return (await editObligation(id, { ...edit(c.data), title: 'Edited', notes: 'n' }, c.updatedAt, TODAY, d)).undo; } },
    { name: 'review list', run: async (d, id) => (await setReview(id, true, 'check', null, TODAY, d)).undo },
    { name: 'pause', run: async (d, id) => (await life(d, id, 'pause')).undo },
    { name: 'end', run: async (d, id) => (await life(d, id, 'end')).undo },
    { name: 'resume', run: async (d, id) => { await life(d, id, 'pause'); await sleep(3); return (await life(d, id, 'resume')).undo; } },
    { name: 'reopen', run: async (d, id) => { await life(d, id, 'end', '2026-11-07'); await sleep(3); return (await life(d, id, 'reopen', '2026-12-01')).undo; } },
    { name: 'delete', run: async (d, id) => (await deleteObligation(id, null, d)).undo },
  ];
  for (const op of ops) {
    it(`${op.name}: Undo puts the record back exactly (data and live state)`, async () => {
      const d = fresh();
      const r = await add(d);
      let before = '';
      const grab = async () => { const row = (await d.moduleRecords.get(r.id))!; return stable({ data: row.data, dead: row.deletedAt != null }); };
      if (op.name === 'resume' || op.name === 'reopen') { /* prepared inside run */ }
      const origRun = op.run;
      const undo = await (async () => {
        if (op.name !== 'resume' && op.name !== 'reopen') before = await grab();
        const u = await origRun(d, r.id);
        return u;
      })();
      if (op.name === 'resume' || op.name === 'reopen') {
        // "before" for these is the prepared state: undo returns to it
        const u = undo;
        expect(u.rows[0].before).not.toBeNull();
        before = stable({ data: u.rows[0].before!.data, dead: u.rows[0].before!.deletedAt != null });
      }
      await applyUndo(undo, d);
      expect(await grab()).toBe(before);
    });
    it(`${op.name}: Undo is REFUSED after an intervening change and writes nothing`, async () => {
      const d = fresh();
      const r = await add(d);
      const undo = await op.run(d, r.id);
      await sleep(3);
      // another device or action changes the record
      const row = (await d.moduleRecords.get(r.id))!;
      await d.moduleRecords.put({ ...row, data: { ...(row.data as object), notes: 'changed elsewhere' } as never, updatedAt: row.updatedAt + 1 });
      const snapshot = await all(d);
      await expect(applyUndo(undo, d)).rejects.toThrow(UNDO_REFUSED);
      expect(await all(d)).toBe(snapshot);
    });
  }
  it('even a change in the very same millisecond (same updatedAt, different data) is noticed', async () => {
    const d = fresh();
    const r = await add(d);
    const { undo } = await setReview(r.id, true, 'x', null, TODAY, d);
    const row = (await d.moduleRecords.get(r.id))!;
    await d.moduleRecords.put({ ...row, data: { ...(row.data as object), notes: 'same ms' } as never });
    await expect(applyUndo(undo, d)).rejects.toThrow(UNDO_REFUSED);
  });
  it('an Undo with no sealed state is never trusted', async () => {
    const d = fresh();
    const r = await add(d);
    const { undo } = await setReview(r.id, true, 'x', null, TODAY, d);
    await expect(applyUndo({ rows: undo.rows }, d)).rejects.toThrow(UNDO_UNVERIFIED);
  });
  it('undoing an add removes the bill but KEEPS the provider Contact (a shared Contact is never deleted automatically)', async () => {
    const d = fresh();
    const r = await add(d);
    await applyUndo(r.undo, d);
    expect(await getObligation(r.id, d)).toBeUndefined();
    expect(await d.contacts.count()).toBe(1);
    expect((await d.contacts.toArray())[0].deletedAt ?? null).toBeNull();
  });
  it('the refusal is a typed, plain-words error; a second undo of the same action is refused too', async () => {
    const d = fresh();
    const r = await add(d);
    const { undo } = await setReview(r.id, true, 'x', null, TODAY, d);
    await applyUndo(undo, d);
    try { await applyUndo(undo, d); throw new Error('should have refused'); } catch (e) { expect(isUndoRefused(e)).toBe(true); }
  });
  it('fingerprint ignores property order and treats a missing deletedAt as null', () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1, deletedAt: null }));
    expect(fingerprint(undefined)).toBe('absent');
  });
});

describe('B1: permanent delete only when it never had anything (test 35)', () => {
  it('a fresh bill with no history can be deleted; the Contact is kept', async () => {
    const d = fresh();
    const r = await add(d);
    const plan = await planDelete(r.id, d);
    expect(plan.allowed).toBe(true);
    await deleteObligation(r.id, plan.expect, d);
    expect(await getObligation(r.id, d)).toBeUndefined();
    expect(await d.contacts.count()).toBe(1);
  });
  it('a bill with history is refused and told to End it; nothing is lost', async () => {
    const d = fresh();
    const r = await add(d);
    await life(d, r.id, 'end');
    const plan = await planDelete(r.id, d);
    expect(plan.allowed).toBe(false);
    expect(plan.lines.join(' ')).toMatch(/End it instead/);
    const before = await all(d);
    await expect(deleteObligation(r.id, null, d)).rejects.toThrow(/cannot be deleted/);
    expect(await all(d)).toBe(before);
  });
  it('billing-period records or links that refer to it also block deletion', async () => {
    const d = fresh();
    const r = await add(d);
    await d.moduleRecords.add({ id: 77, module: MODULE, kind: 'cycle', data: { obligationId: r.id, slot: 'm2026-12', fact: 'invoice' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    expect((await planDelete(r.id, d)).reasons.join(' ')).toMatch(/billing-period record/);
    const d2 = fresh();
    const r2 = await add(d2);
    await createStore(d2).shared.links.add(obligationRef(r2.id), { module: 'tasks', id: 5 }, 'about');
    expect((await planDelete(r2.id, d2)).reasons.join(' ')).toMatch(/link/);
  });
  it('deleting a bill that changed since the preview is refused', async () => {
    const d = fresh();
    const r = await add(d);
    const plan = await planDelete(r.id, d);
    await sleep(3);
    await setReview(r.id, true, '', null, TODAY, d);
    await expect(deleteObligation(r.id, plan.expect, d)).rejects.toThrow(/was changed/);
  });
});

describe('B1: Bills never writes Finance, Tasks, the Calendar or cycle records (test 49)', () => {
  it('every operation leaves every Finance table, every other module record and every link exactly as it was', async () => {
    const d = fresh();
    const acct = await d.accounts.add({ name: 'Example Checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' } as never);
    await d.txns.add({ accountId: acct, date: '2026-11-05', amountCents: -1549, payee: 'Streamly', memo: '', status: 'cleared', categoryId: null } as never);
    await d.recurring.add({ accountId: acct, payee: 'Streamly', amountCents: -1549, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-01-12', active: true } as never);
    await d.loans.add({ name: 'Example Loan', kind: 'mortgage', setup: 'current' } as never);
    await d.moduleRecords.add({ id: 11, module: 'tasks', kind: 'task', data: { title: 'A task' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await d.moduleRecords.add({ id: 12, module: 'calendar', kind: 'event', data: { title: 'An event' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const fin = await financeSnapshot(d);
    const others = async () => JSON.stringify((await d.moduleRecords.toArray()).filter((x) => x.module !== MODULE));
    const links = async () => JSON.stringify(await d.links.toArray());
    const o0 = await others(); const l0 = await links();

    const r = await add(d, { schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01', prices: [{ from: '2026-01-01', cents: 1549, label: '' }], payment: { how: 'auto', fundingAccountId: acct } });
    let cur = (await getObligation(r.id, d))!;
    await editObligation(r.id, { ...edit(cur.data), title: 'Streamly Premium', schedule: monthly(20, '2027-01'), scheduleFrom: '2027-01-01' }, cur.updatedAt, TODAY, d);
    await setReview(r.id, true, 'n', null, TODAY, d);
    await life(d, r.id, 'pause'); await sleep(2);
    await life(d, r.id, 'resume'); await sleep(2);
    await life(d, r.id, 'end'); await sleep(2);
    await life(d, r.id, 'reopen', '2027-01-01'); await sleep(2);
    cur = (await getObligation(r.id, d))!;
    const u = (await setReview(r.id, false, '', cur.updatedAt, TODAY, d)).undo;
    await applyUndo(u, d);
    const del = await add(d, {}, null);
    await deleteObligation(del.id, null, d);

    expect(await financeSnapshot(d)).toBe(fin);
    expect(await others()).toBe(o0);
    expect(await links()).toBe(l0);
    expect((await d.moduleRecords.toArray()).filter((x) => x.module === MODULE && x.kind !== 'obligation')).toHaveLength(0);
    expect((await d.moduleRecords.toArray()).filter((x) => x.module === 'tasks' || x.module === 'calendar')).toHaveLength(2);
  });
  it('the funding account is only a pointer: a missing account never blocks reading or editing', async () => {
    const d = fresh();
    const r = await add(d, { payment: { how: 'auto', fundingAccountId: 424242 } });
    const cur = (await getObligation(r.id, d))!;
    expect(cur.data.payment.fundingAccountId).toBe(424242);
    await editObligation(r.id, { ...edit(cur.data), title: 'Edited anyway' }, cur.updatedAt, TODAY, d);
    expect((await getObligation(r.id, d))!.data.payment.fundingAccountId).toBe(424242);
  });
  it('writeObligation keeps the record id and createdAt stable across edits and bumps updatedAt', async () => {
    const d = fresh();
    const r = await add(d, {}, null);
    const a = (await d.moduleRecords.get(r.id))!;
    await sleep(3);
    await writeObligation(r.id, asObligation(a).data, d);
    const b = (await d.moduleRecords.get(r.id))!;
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt).toBeGreaterThan(a.updatedAt);
  });
});
