import { afterEach, describe, expect, it, vi } from 'vitest';
import { asEvent } from './model';
import { occurrenceToOpen } from './searchSource';
import { msAt } from './time';

/** Dates in the evening (or early morning on the other side of the world) must stay on the local day. Invented data. */
const original = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
});

const stored = (data: Record<string, unknown>) => ({ id: 1, module: 'calendar', kind: 'event', data, createdAt: 1, updatedAt: 1 });

describe('asEvent default date', () => {
  it('uses the local day when a stored event has no start date (evening in Los Angeles)', () => {
    process.env.TZ = 'America/Los_Angeles';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T04:00:00Z')); // 20:00 on 4 Nov in Los Angeles
    expect(asEvent(stored({ title: 'x', allDay: true })).data.startDate).toBe('2026-11-04');
  });

  it('uses the local day in the morning in Auckland', () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T19:00:00Z')); // 08:00 on 5 Nov in Auckland
    expect(asEvent(stored({ title: 'x', allDay: true })).data.startDate).toBe('2026-11-05');
  });
});

describe('search opens an old timed event on its local day', () => {
  for (const [tz, hour] of [['America/Los_Angeles', 22], ['Pacific/Auckland', 8], ['UTC', 12]] as const) {
    it(`${tz}`, () => {
      process.env.TZ = tz;
      const startAt = msAt('2026-01-10', hour * 60 + 30);
      const ev = asEvent(stored({ title: 'Old visit', allDay: false, startAt, endAt: startAt + 3600_000 }));
      expect(occurrenceToOpen({ ...ev, data: { ...ev.data } }, '2026-11-04')?.firstDay).toBe('2026-01-10');
    });
  }
});
