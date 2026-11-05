import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { installTracking } from '../../lib/sync/track';
import { createEvent, retireEvent } from '../calendar/data';
import { asEvent } from '../calendar/model';
import { completeTask, createTask, getTask, reopenTask, saveTask, updateTasks } from './data';
import { blankTask } from './model';

/** Fields written by another module or a newer version of the app must survive every ordinary edit. Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-unknown-${n++}`); installTracking(d); return d; };
const extras = { projectId: 42, isMilestone: true, futureThing: { a: 1 } };
const keep = async (d: FinanceDB, id: number) => {
  const data = (await d.moduleRecords.get(id))!.data as Record<string, unknown>;
  return { projectId: data.projectId, isMilestone: data.isMilestone, futureThing: data.futureThing };
};
async function taskWithExtras(d: FinanceDB, over = {}) {
  const id = await createTask(blankTask({ title: 'Probe', dueDate: '2026-12-01', ...over }), [], d);
  const r = (await d.moduleRecords.get(id))!;
  await d.moduleRecords.update(id, { data: { ...r.data, ...extras } });
  return id;
}

describe('tasks keep fields they do not know', () => {
  it('an ordinary edit (what the task editor does)', async () => {
    const d = fresh();
    const id = await taskWithExtras(d);
    const t = (await getTask(id, d))!;
    await saveTask(id, { ...t.data, notes: 'edited' }, d);
    expect(await keep(d, id)).toEqual(extras);
    expect((await getTask(id, d))!.data.notes).toBe('edited');
  });

  it('bulk change, complete and reopen', async () => {
    const d = fresh();
    const id = await taskWithExtras(d);
    await updateTasks([id], (t) => ({ ...t, priority: 'high' }), d);
    expect(await keep(d, id)).toEqual(extras);
    await completeTask(id, '2026-12-01', d);
    expect(await keep(d, id)).toEqual(extras);
    await reopenTask(id, d);
    expect(await keep(d, id)).toEqual(extras);
  });

  it('a repeating task passes them to the next one', async () => {
    const d = fresh();
    const id = await taskWithExtras(d, { repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } } } });
    const { spawnedId } = await completeTask(id, '2026-12-01', d);
    expect(spawnedId).toBeDefined();
    expect(await keep(d, spawnedId!)).toEqual(extras);
  });

  it('clearing a field you do know still clears it', async () => {
    const d = fresh();
    const id = await taskWithExtras(d);
    const t = (await getTask(id, d))!;
    await saveTask(id, { ...t.data, dueDate: null }, d);
    expect((await getTask(id, d))!.data.dueDate).toBeNull();
    expect(await keep(d, id)).toEqual(extras);
  });
});

describe('events keep fields they do not know', () => {
  it('reading and saving an event again keeps them', async () => {
    const d = fresh();
    const id = await createEvent({ ...asEvent({ id: 1, module: 'calendar', kind: 'event', data: { title: 'Visit', startDate: '2026-12-02', allDay: true }, createdAt: 1, updatedAt: 1 }).data }, d);
    const r = (await d.moduleRecords.get(id))!;
    await d.moduleRecords.update(id, { data: { ...r.data, ...extras } });
    await retireEvent(id, { module: 'ledger', recordId: 'scheduled:1', note: 'moved' }, d); // reads with asEvent and saves
    expect(await keep(d, id)).toEqual(extras);
  });
});
