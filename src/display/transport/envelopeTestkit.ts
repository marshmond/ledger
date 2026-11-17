/** Test-only helpers for the transport and tablet tests (never imported by the app). Invented data only. */
import { buildProjection, type BuildInput } from '../build';
import type { DisplayProjection } from '../contract';
import { deriveDisplayKeys, idKeyOf, type DisplayKeys } from './envelope';

export const FAST_ITERATIONS = 1000;
export const keysOf = (pass: string) => deriveDisplayKeys(pass, FAST_ITERATIONS);

export async function sample(keys: DisplayKeys, over: Partial<BuildInput> = {}, revision = 1): Promise<DisplayProjection> {
  const idKey = await idKeyOf(keys);
  return buildProjection({
    today: '2026-11-09', tz: 'America/New_York', publishedAt: '2026-11-09T15:00:00.000Z', revision, window: { from: '2026-10-26', to: '2027-03-09' }, household: 'Family', weekStart: 0, idKey,
    people: [{ memberId: 1, name: 'Sam', colorId: 'blue', group: 'child' }],
    events: [{ eventId: 11, level: 'details', busyLabel: null, memberIds: [1], occurrences: [{ key: '2026-11-10', title: 'Piano with Ms Example', allDay: false, start: { date: '2026-11-10', time: '16:00' }, end: { date: '2026-11-10', time: '17:00' }, recurring: false, done: false }] }],
    dates: [], visits: [], reminders: [], tasks: [{ taskId: 21, title: 'Library books', due: { date: '2026-11-12', time: null }, status: 'todo', memberIds: [1], repeat: false }],
    grantRecordIds: [101, 102], ...over,
  });
}
