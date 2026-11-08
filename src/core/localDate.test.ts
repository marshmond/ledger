import { afterEach, describe, expect, it, vi } from 'vitest';
import { localISO } from './time';
import { todayISO } from '../lib/money';
import { localDay } from '../lib/backupFile';
import { localDate } from '../modules/assets/maintenance';
import { isoOfMs } from '../modules/services/visits';

/**
 * ST-S2 (ARCH-03): the five "local date" helpers are one rule: the calendar date on THIS device at that instant (not UTC). Checked against an independent reference
 * (Intl) in zones from UTC-11 to UTC+14, across year ends, a leap day, end of day and both daylight-saving changes.
 */
const ZONES = ['UTC', 'Pacific/Pago_Pago', 'Pacific/Kiritimati', 'Pacific/Honolulu', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Pacific/Auckland', 'Australia/Lord_Howe'];
const refDate = (ms: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const INSTANTS = [
  Date.UTC(2026, 11, 31, 23, 59, 59), Date.UTC(2027, 0, 1, 0, 0, 0), Date.UTC(2028, 1, 29, 12, 0, 0), Date.UTC(2028, 1, 29, 23, 59, 59), Date.UTC(2028, 2, 1, 0, 0, 1),
  Date.UTC(2026, 2, 8, 6, 59, 59), Date.UTC(2026, 2, 8, 7, 0, 0), Date.UTC(2026, 10, 1, 5, 59, 59), Date.UTC(2026, 10, 1, 6, 0, 0), // New York daylight-saving start and end
  Date.UTC(2026, 5, 30, 10, 0, 0), Date.UTC(2026, 10, 8, 3, 30, 0), Date.UTC(2026, 10, 8, 22, 30, 0),
];

describe('one local-date rule', () => {
  const original = process.env.TZ;
  afterEach(() => { vi.useRealTimers(); if (original === undefined) delete process.env.TZ; else process.env.TZ = original; });

  it('all five helpers agree with the reference in every zone at every instant (so no Calendar or Finance day moves)', () => {
    for (const tz of ZONES) {
      process.env.TZ = tz;
      for (const ms of INSTANTS) {
        const want = refDate(ms, tz);
        expect([tz, localISO(ms)]).toEqual([tz, want]);
        expect([tz, localDay(new Date(ms))]).toEqual([tz, want]);
        expect([tz, localDate(ms)]).toEqual([tz, want]);
        expect([tz, isoOfMs(ms)]).toEqual([tz, want]);
        vi.useFakeTimers(); vi.setSystemTime(ms);
        expect([tz, todayISO()]).toEqual([tz, want]);
        vi.useRealTimers();
      }
    }
  });
  it('UTC+14 is already the next day while UTC-11 is still the day before', () => {
    const ms = Date.UTC(2026, 10, 8, 12, 0, 0);
    process.env.TZ = 'Pacific/Kiritimati'; expect(localISO(ms)).toBe('2026-11-09');
    process.env.TZ = 'Pacific/Pago_Pago'; expect(localISO(ms)).toBe('2026-11-08'); expect(localISO(Date.UTC(2026, 10, 8, 10, 59, 0))).toBe('2026-11-07');
  });
  it('the shifted clock used by the tests still drives todayISO and localDay, across a leap day', () => {
    process.env.TZ = 'America/New_York';
    vi.useFakeTimers(); vi.setSystemTime(new Date(2028, 1, 29, 23, 59, 30));
    expect(todayISO()).toBe('2028-02-29'); expect(localDay()).toBe('2028-02-29');
    vi.setSystemTime(new Date(2028, 1, 29, 23, 59, 30).getTime() + 60_000);
    expect(todayISO()).toBe('2028-03-01'); expect(localDay()).toBe('2028-03-01');
  });
});
