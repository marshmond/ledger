import { describe, expect, it } from 'vitest';
import { db } from '../db';
import { taskRecords } from './tasks/records';
import { eventRecords } from './calendar/records';
import { createTask, removeTasks } from './tasks/data';
import { createEvent, removeEventById } from './calendar/data';
import { blankTask } from './tasks/model';
import { asEvent } from './calendar/model';
import { calendarModule } from './calendar';
import { tasksModule } from './tasks';
import { ledgerModule } from './ledger';

/** Tasks and Calendar events can be linked to and shown by name. Invented data. Uses the app database (fake IndexedDB). */
describe('linkable tasks and events', () => {
  it('both modules register a record source', () => {
    expect(tasksModule.contributes?.records).toBe(taskRecords);
    expect(calendarModule.contributes?.records).toBe(eventRecords);
    expect(ledgerModule.contributes?.records).toBeDefined();
  });

  it('a task is found, described by its current name, and gone after deletion', async () => {
    const id = await createTask(blankTask({ title: 'Call the electrician' }), [], db);
    expect((await taskRecords.search('electric')).map((r) => r.id)).toContain(id);
    expect(await taskRecords.describe(id)).toMatchObject({ label: 'Call the electrician', kind: 'Task' });
    expect(await taskRecords.describe(String(id))).not.toBeNull();
    await removeTasks([id], db);
    expect(await taskRecords.describe(id)).toBeNull();
    expect(await taskRecords.describe('nonsense')).toBeNull();
    expect(await taskRecords.describe(987654321)).toBeNull();
  });

  it('an event is found, described, and gone after deletion; other records are not mistaken for it', async () => {
    const data = asEvent({ id: 1, module: 'calendar', kind: 'event', data: { title: 'Inspection', allDay: true, startDate: '2026-12-02' }, createdAt: 1, updatedAt: 1 }).data;
    const id = await createEvent(data, db);
    expect((await eventRecords.search('inspect')).map((r) => r.id)).toContain(id);
    expect(await eventRecords.describe(id)).toMatchObject({ label: 'Inspection', kind: 'Event' });
    const taskId = await createTask(blankTask({ title: 'A task' }), [], db);
    expect(await eventRecords.describe(taskId)).toBeNull();
    expect(await taskRecords.describe(id)).toBeNull();
    await removeEventById(id, db);
    expect(await eventRecords.describe(id)).toBeNull();
  });
});
