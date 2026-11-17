import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { buildProjection, ProjectionLimitError, type BuildInput } from './build';
import {
  canonicalJson, contentDigest, decodeProjection, deriveId, encodeProjection, ENTRY_KEYS, importIdKey, LIMITS, PERSON_KEYS, TASK_KEYS, TOP_KEYS, validateProjection,
  type DisplayEntry, type DisplayPerson, type DisplayProjection, type DisplayTask,
} from './contract';

/** CS-1: the version-1 contract, its validator, its opaque ids and the builder, with TEST-ONLY keys. Invented data only. */
const KEY_BYTES = new Uint8Array(32).map((_, i) => i + 1);
const key = () => importIdKey(KEY_BYTES);

const base = async (over: Partial<BuildInput> = {}): Promise<BuildInput> => ({
  today: '2026-11-09', tz: 'America/New_York', publishedAt: '2026-11-09T15:00:00.000Z', revision: 0, window: { from: '2026-10-26', to: '2027-03-09' }, household: 'Family', weekStart: 0,
  idKey: await key(),
  people: [{ memberId: 1, name: 'Sam Example', colorId: 'blue', group: 'child' }, { memberId: 2, name: 'Alex Example', colorId: null, group: 'adult' }],
  events: [{
    eventId: 10, level: 'details', busyLabel: null, memberIds: [2, 1],
    occurrences: [{ key: '2026-11-11', title: 'Swim meet', allDay: false, start: { date: '2026-11-11', time: '10:00' }, end: { date: '2026-11-11', time: '11:30' }, recurring: false, done: false }],
  }],
  dates: [], visits: [], reminders: [],
  tasks: [{ taskId: 30, title: 'Sign the form', due: { date: '2026-11-12', time: null }, status: 'todo', memberIds: [1], repeat: false }],
  grantRecordIds: [101, 102],
  ...over,
});
const built = async (over: Partial<BuildInput> = {}) => buildProjection(await base(over));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe('the contract is exactly the approved list of fields', () => {
  it('the top level, people, entries and tasks have exactly these keys', async () => {
    const p = await built();
    expect(Object.keys(p).sort()).toEqual([...TOP_KEYS].sort());
    expect(Object.keys(p.people[0]).sort()).toEqual([...PERSON_KEYS].sort());
    expect(Object.keys(p.entries[0]).sort()).toEqual([...ENTRY_KEYS].sort());
    expect(Object.keys(p.tasks[0]).sort()).toEqual([...TASK_KEYS].sort());
    expect(Object.keys(p.entries[0].start).sort()).toEqual(['date', 'time']);
    expect([...TOP_KEYS].sort()).toEqual(['counts', 'digest', 'entries', 'format', 'generatedFor', 'grantsSeen', 'household', 'minReader', 'people', 'prefs', 'publishedAt', 'revision', 'sources', 'tasks', 'version', 'window']);
  });
  it('compile-time pins: a field added to a type fails the build here', () => {
    expectTypeOf<keyof DisplayPerson>().toEqualTypeOf<'id' | 'name' | 'color' | 'group'>();
    expectTypeOf<keyof DisplayEntry>().toEqualTypeOf<'id' | 'source' | 'title' | 'allDay' | 'start' | 'end' | 'people' | 'repeat' | 'status'>();
    expectTypeOf<keyof DisplayTask>().toEqualTypeOf<'id' | 'title' | 'due' | 'status' | 'people' | 'repeat'>();
    expectTypeOf<keyof DisplayProjection>().toEqualTypeOf<(typeof TOP_KEYS)[number]>();
  });
  it('the builder\'s input types have no field for notes, places, contact details, amounts or links', async () => {
    const text = readFileSync('src/display/build.ts', 'utf8');
    const noComments = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\*\*|\*|\/\/)/.test(l)).map((l) => l.replace(/\/\*\*.*?\*\//g, '')).join('\n');
    const section = noComments(text.slice(text.indexOf('export interface PersonSource'), text.indexOf('export interface BuildInput')));
    for (const forbidden of ['notes', 'note', 'location', 'phone', 'email', 'amount', 'cents', 'account', 'url', 'link', 'birthYear', 'age', 'projectId', 'provider', 'contactIds', 'tagIds', 'priority', 'reminders']) {
      expect(section.toLowerCase(), forbidden).not.toMatch(new RegExp(`\\b${forbidden.toLowerCase()}\\b`));
    }
  });
  it('the contract folder imports nothing outside itself (a future tablet app can share it without reaching Ledger)', () => {
    const dir = resolve('src/display/contract');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      const imports = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'";]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(imports.filter((i) => !i.startsWith('./')), f).toEqual([]);
    }
  });
});

describe('a built projection validates, and is deterministic', () => {
  it('validates and round-trips through the canonical text', async () => {
    const p = await built();
    const ok = await validateProjection(p);
    expect(ok).toEqual({ ok: true, value: p });
    expect(await decodeProjection(encodeProjection(p))).toEqual({ ok: true, value: p });
    expect(p.counts).toEqual({ entries: 1, tasks: 1 });
    expect(p.sources.map((s) => s.id)).toEqual(['events', 'tasks']);
  });
  it('the same inputs give the same bytes, regardless of the order the sources arrive in', async () => {
    const a = await base();
    const b = await base({ events: [...a.events].reverse(), people: [...a.people].reverse(), grantRecordIds: [...a.grantRecordIds].reverse() });
    expect(encodeProjection(await buildProjection(a))).toBe(encodeProjection(await buildProjection(b)));
  });
  it('ids are opaque, 24 hex characters, differ by kind, record and occurrence, and never contain a Ledger id', async () => {
    const p = await built();
    for (const id of [...p.people.map((x) => x.id), ...p.entries.map((x) => x.id), ...p.tasks.map((x) => x.id), ...p.grantsSeen]) expect(id).toMatch(/^[0-9a-f]{24}$/);
    const k = await key();
    expect(await deriveId(k, 'event', 10, 'a')).not.toBe(await deriveId(k, 'event', 10, 'b'));
    expect(await deriveId(k, 'event', 10, 'a')).not.toBe(await deriveId(k, 'task', 10, 'a'));
    expect(await deriveId(k, 'event', 10, 'a')).toBe(await deriveId(k, 'event', 10, 'a'));
    const other = await importIdKey(new Uint8Array(32).fill(9));
    expect(await deriveId(other, 'event', 10, 'a')).not.toBe(await deriveId(k, 'event', 10, 'a'));
    const numbers: number[] = [];
    JSON.stringify(p, (_k, v) => { if (typeof v === 'number') numbers.push(v); return v; });
    expect(numbers.filter((n) => [10, 30, 101, 102].includes(n))).toEqual([]);
  });
  it('only the people an item names are listed, sorted, and each is a person the builder knows', async () => {
    const p = await built();
    expect(p.people.map((x) => x.name)).toEqual(['Alex Example', 'Sam Example']);
    const none = await built({ events: [], tasks: [] });
    expect(none.people).toEqual([]);
    expect(none.sources).toEqual([]);
    const stranger = await built({ events: [{ ...(await base()).events[0], memberIds: [99] }] });
    expect(stranger.entries[0].people).toEqual([]);
  });
  it('the digest covers people, entries and tasks but NOT grantsSeen, and grantsSeen changes by itself', async () => {
    const a = await built({ grantRecordIds: [101] });
    const b = await built({ grantRecordIds: [101, 102] });
    expect(a.digest).toBe(b.digest);
    expect(a.grantsSeen).not.toEqual(b.grantsSeen);
    expect(b.grantsSeen).toHaveLength(2);
    const c = await built({ tasks: [] });
    expect(c.digest).not.toBe(a.digest);
  });
  it('Busy carries the generic title, not the real one', async () => {
    const b = await base();
    const p = await buildProjection({ ...b, events: [{ ...b.events[0], level: 'busy', busyLabel: null }] });
    expect(p.entries[0].title).toBe('Busy');
    expect(JSON.stringify(p)).not.toContain('Swim meet');
  });
  it('an over-long title is shortened with an ellipsis, never carrying past the limit', async () => {
    const b = await base();
    const p = await buildProjection({ ...b, tasks: [{ ...b.tasks[0], title: 'x'.repeat(200) }] });
    expect(p.tasks[0].title.length).toBeLessThanOrEqual(LIMITS.title);
    expect(await validateProjection(p)).toMatchObject({ ok: true });
  });
  it('a long all-day event keeps its last day inclusive and no times', async () => {
    const b = await base();
    const p = await buildProjection({ ...b, events: [{ eventId: 11, level: 'details', busyLabel: null, memberIds: [], occurrences: [{ key: '2026-11-20', title: 'Trip', allDay: true, start: { date: '2026-11-20', time: null }, end: { date: '2026-11-23', time: null }, recurring: false, done: false }] }] });
    expect(p.entries[0]).toMatchObject({ allDay: true, start: { date: '2026-11-20', time: null }, end: { date: '2026-11-23', time: null } });
  });
  it('items outside the window are not included', async () => {
    const b = await base();
    const p = await buildProjection({ ...b, events: [{ eventId: 12, level: 'details', busyLabel: null, memberIds: [], occurrences: [{ key: 'x', title: 'Far away', allDay: true, start: { date: '2027-09-01', time: null }, end: { date: '2027-09-01', time: null }, recurring: false, done: false }] }] });
    expect(p.entries).toEqual([]);
  });
});

describe('the validator rejects anything it does not know', () => {
  const reject = async (mutate: (p: DisplayProjection) => unknown, needle?: RegExp) => {
    const p = clone(await built());
    const bad = mutate(p) ?? p;
    const r = await validateProjection(bad);
    expect(r.ok).toBe(false);
    if (!r.ok && needle) expect(r.errors.join(' | ')).toMatch(needle);
  };
  it('unknown schema versions and formats', async () => {
    await reject((p) => ({ ...p, version: 2 }), /Unsupported version/);
    await reject((p) => ({ ...p, version: 0 }), /Unsupported version/);
    await reject((p) => ({ ...p, format: 'other' }), /Wrong format/);
    await reject((p) => ({ ...p, minReader: 2 }), /newer reader/);
  });
  it('unknown object keys, at every level (a sensitive field cannot ride along)', async () => {
    await reject((p) => ({ ...p, notes: 'x' }), /unexpected field "notes"/);
    await reject((p) => { (p.entries[0] as unknown as Record<string, unknown>).location = 'Home'; }, /unexpected field "location"/);
    await reject((p) => { (p.tasks[0] as unknown as Record<string, unknown>).notes = 'x'; }, /unexpected field "notes"/);
    await reject((p) => { (p.people[0] as unknown as Record<string, unknown>).email = 'a@b.c'; }, /unexpected field "email"/);
    await reject((p) => { (p.people[0] as unknown as Record<string, unknown>).birthYear = 2015; }, /unexpected field "birthYear"/);
    await reject((p) => { (p.entries[0].start as unknown as Record<string, unknown>).zone = 'x'; }, /unexpected field "zone"/);
    await reject((p) => { (p.generatedFor as unknown as Record<string, unknown>).device = 'x'; }, /unexpected field/);
  });
  it('missing fields', async () => {
    await reject((p) => { delete (p as unknown as Record<string, unknown>).grantsSeen; }, /missing field "grantsSeen"/);
    await reject((p) => { delete (p.entries[0] as unknown as Record<string, unknown>).status; }, /missing field "status"/);
  });
  it('invalid or malformed dates and times', async () => {
    await reject((p) => { p.entries[0].start.date = '2026-02-30'; }, /invalid date/);
    await reject((p) => { p.entries[0].start.date = '2026-1-5'; }, /invalid date/);
    await reject((p) => { p.entries[0].start.time = '25:00'; }, /invalid time/);
    await reject((p) => { p.entries[0].end.date = '2026-11-10'; }, /ends before it starts/);
    await reject((p) => { p.publishedAt = 'yesterday'; }, /publishedAt/);
    await reject((p) => { p.window.from = '2030-01-01'; }, /window/);
    await reject((p) => { p.tasks[0].due = { date: '2026-13-01', time: null }; }, /invalid date/);
    await reject((p) => { p.entries[0].allDay = true; }, /all-day item has no times/);
  });
  it('invalid source kinds and statuses', async () => {
    await reject((p) => { (p.entries[0] as unknown as Record<string, unknown>).source = 'bills'; }, /source/);
    await reject((p) => { (p.entries[0] as unknown as Record<string, unknown>).source = 'tasks'; }, /source/);
    await reject((p) => { (p.sources as unknown as { id: string }[])[0].id = 'finance'; }, /sources/);
    await reject((p) => { (p.entries[0] as unknown as Record<string, unknown>).status = 'cancelled'; }, /status/);
    await reject((p) => { (p.tasks[0] as unknown as Record<string, unknown>).status = 'done'; }, /status/);
    await reject((p) => { (p.people[0] as unknown as Record<string, unknown>).group = 'parent'; }, /group/);
    await reject((p) => { (p.people[0] as unknown as Record<string, unknown>).color = '#4a7bd0'; }, /color/);
  });
  it('broken person references', async () => {
    await reject((p) => { p.entries[0].people = ['0'.repeat(24)]; }, /person reference/);
    await reject((p) => { p.tasks[0].people = ['nope']; }, /person reference/);
    await reject((p) => { p.entries[0].people = [...p.entries[0].people].reverse(); }, /sorted/);
  });
  it('inconsistent counts and digest', async () => {
    await reject((p) => { p.counts.entries = 5; }, /counts\.entries/);
    await reject((p) => { p.counts.tasks = 0; }, /counts\.tasks/);
    await reject((p) => { p.digest = '0'.repeat(64); }, /digest does not match/);
    await reject((p) => { p.entries[0].title = 'Changed after the digest'; }, /digest does not match/);
    await reject((p) => { p.digest = 'zz'; }, /digest/);
  });
  it('repeated ids, bad grantsSeen and non-objects', async () => {
    await reject((p) => { p.tasks[0].id = p.entries[0].id; }, /repeated/);
    await reject((p) => { p.grantsSeen = ['b'.repeat(24), 'a'.repeat(24)]; }, /sorted/);
    await reject((p) => { p.grantsSeen = ['nope']; }, /grantsSeen/);
    for (const v of ['text', [], null, 5, undefined]) expect(await validateProjection(v)).toEqual({ ok: false, errors: ['The projection is not an object.'] });
  });
  it('an over-large projection is rejected, never silently cut', async () => {
    const b = await base();
    const many = Array.from({ length: LIMITS.tasks + 1 }, (_, i) => ({ taskId: 1000 + i, title: `T${i}`, due: null, status: 'todo' as const, memberIds: [], repeat: false }));
    await expect(buildProjection({ ...b, tasks: many })).rejects.toBeInstanceOf(ProjectionLimitError);
    const occ = Array.from({ length: LIMITS.entries + 1 }, (_, i) => ({ key: `k${i}`, title: `E${i}`, allDay: true, start: { date: '2026-11-11', time: null }, end: { date: '2026-11-11', time: null }, recurring: false, done: false }));
    await expect(buildProjection({ ...b, events: [{ eventId: 1, level: 'details', busyLabel: null, memberIds: [], occurrences: occ }] })).rejects.toBeInstanceOf(ProjectionLimitError);
    const p = clone(await built());
    p.tasks = Array.from({ length: LIMITS.tasks + 1 }, (_, i) => ({ ...p.tasks[0], id: i.toString(16).padStart(24, '0') }));
    p.counts.tasks = p.tasks.length;
    p.digest = await contentDigest(p);
    const r = await validateProjection(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/more than 300/);
    await expect(buildProjection({ ...b, grantRecordIds: Array.from({ length: LIMITS.grantsSeen + 1 }, (_, i) => i + 1) })).rejects.toBeInstanceOf(ProjectionLimitError);
  });
  it('text that is not JSON is rejected without throwing', async () => {
    expect(await decodeProjection('{nope')).toEqual({ ok: false, errors: ['The projection is not valid JSON.'] });
  });
  it('canonical JSON sorts keys and is stable', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});
