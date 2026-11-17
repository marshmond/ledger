/**
 * CS-1: the family-display projection contract, version 1 (CS-0.1 design, section F.6).
 *
 * This folder is the ONE place that defines what a shared family display may ever receive. It imports NOTHING from the rest of Ledger (a test
 * checks), so a future tablet app can share it without being able to reach any Ledger code. It has no field for notes, places, contact details,
 * amounts, accounts, links, birth years, ages or Ledger record numbers, and the validator rejects any object key it does not know.
 *
 * Not here (CS-2): encryption, the LDP1 file container, passphrases, pairing, storage and publishing. `encodeProjection` writes canonical
 * plain JSON for tests and the local preview and for nothing else; nothing in CS-1 sends it anywhere.
 */

export const FORMAT = 'ledger-display' as const;
export const VERSION = 1 as const;
export const MIN_READER = 1 as const;

export const LIMITS = { entries: 2000, tasks: 300, bytes: 500_000, grantsSeen: 5000, title: 80, name: 40, label: 40 } as const;

export const COLOR_IDS = ['blue', 'green', 'orange', 'purple', 'pink', 'gold', 'teal', 'gray'] as const;
export type ColorId = (typeof COLOR_IDS)[number];
export const GROUPS = ['adult', 'child', 'other'] as const;
export type Group = (typeof GROUPS)[number];
export const ENTRY_SOURCES = ['events', 'dates', 'visits', 'reminders'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];
export const SOURCE_IDS = ['events', 'dates', 'tasks', 'visits', 'reminders'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];
export const ENTRY_STATUSES = ['scheduled', 'done'] as const;
export const TASK_STATUSES = ['todo', 'doing', 'waiting'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const WEEK_STARTS = [0, 1, 6] as const;

export interface DatePoint { date: string; time: string | null }
export interface DisplayPerson { id: string; name: string; color: ColorId | null; group: Group }
export interface DisplayEntry {
  id: string;
  source: EntrySource;
  title: string;
  allDay: boolean;
  start: DatePoint;
  /** For an all-day item, `end.date` is the LAST day, inclusive. */
  end: DatePoint;
  people: string[];
  repeat: boolean;
  status: (typeof ENTRY_STATUSES)[number];
}
export interface DisplayTask {
  id: string;
  title: string;
  due: DatePoint | null;
  status: TaskStatus;
  people: string[];
  repeat: boolean;
}
export interface DisplayProjection {
  format: typeof FORMAT;
  version: typeof VERSION;
  minReader: typeof MIN_READER;
  revision: number;
  publishedAt: string;
  generatedFor: { tz: string; today: string };
  window: { from: string; to: string };
  household: { label: string };
  prefs: { weekStart: (typeof WEEK_STARTS)[number] };
  people: DisplayPerson[];
  sources: { id: SourceId; label: string }[];
  entries: DisplayEntry[];
  tasks: DisplayTask[];
  /** Opaque ids of EVERY privacy decision the builder held. Used only by publishers, to prove they are not behind. Carries no content. */
  grantsSeen: string[];
  counts: { entries: number; tasks: number };
  /** SHA-256 (hex) of the canonical form of people, entries and tasks: the DISPLAY-CONTENT digest. It does not cover `grantsSeen`. */
  digest: string;
}

// The exact key lists. A test pins them; the validator rejects anything else.
export const TOP_KEYS = ['format', 'version', 'minReader', 'revision', 'publishedAt', 'generatedFor', 'window', 'household', 'prefs', 'people', 'sources', 'entries', 'tasks', 'grantsSeen', 'counts', 'digest'] as const;
export const PERSON_KEYS = ['id', 'name', 'color', 'group'] as const;
export const ENTRY_KEYS = ['id', 'source', 'title', 'allDay', 'start', 'end', 'people', 'repeat', 'status'] as const;
export const TASK_KEYS = ['id', 'title', 'due', 'status', 'people', 'repeat'] as const;
export const DATE_POINT_KEYS = ['date', 'time'] as const;
export const SOURCE_KEYS = ['id', 'label'] as const;

// ---------------- canonical form and digest ----------------

/** JSON with every object's keys sorted: the same value always gives the same text, on every device. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const enc = (s: string) => new TextEncoder().encode(s);

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc(text)));
}

/** The display-content digest: people, entries and tasks only. */
export function contentDigest(p: Pick<DisplayProjection, 'people' | 'entries' | 'tasks'>): Promise<string> {
  return sha256Hex(canonicalJson({ people: p.people, entries: p.entries, tasks: p.tasks }));
}

// ---------------- opaque ids ----------------

/**
 * Opaque, stable, non-revealing ids: the first 12 bytes of HMAC-SHA-256 over "<kind>:<recordKey>:<occurrenceKey>". The tablet never learns a
 * Ledger record number. The key is passed in: CS-1 builds a throw-away key for the local preview and uses fixed keys in tests; a real key derived
 * from a display passphrase is CS-2's job (no production credential exists yet).
 */
export type IdKey = CryptoKey;
export const importIdKey = (bytes: Uint8Array): Promise<IdKey> => crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
export const randomIdKey = (): Promise<IdKey> => importIdKey(crypto.getRandomValues(new Uint8Array(32)));

export async function deriveId(key: IdKey, kind: string, recordKey: string | number, occurrenceKey = ''): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', key, enc(`${kind}:${recordKey}:${occurrenceKey}`));
  return hex(new Uint8Array(mac).slice(0, 12));
}

// ---------------- validation ----------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_RE = /^[0-9a-f]{24}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?Z$/;

const daysIn = (y: number, m: number) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
export function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo);
}
const isRealUtc = (s: unknown) => typeof s === 'string' && ISO_UTC.test(s) && isRealDate(s.slice(0, 10));

export type Validation = { ok: true; value: DisplayProjection } | { ok: false; errors: string[] };

function exactKeys(o: Record<string, unknown>, keys: readonly string[], where: string, errors: string[]) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) errors.push(`${where}: unexpected field "${k}"`);
  for (const k of keys) if (!(k in o)) errors.push(`${where}: missing field "${k}"`);
}
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && v === v.trim();

function checkPoint(p: unknown, where: string, errors: string[]): p is DatePoint {
  if (!isObj(p)) { errors.push(`${where}: not an object`); return false; }
  exactKeys(p, DATE_POINT_KEYS, where, errors);
  if (!isRealDate(p.date)) errors.push(`${where}: invalid date`);
  if (p.time !== null && !(typeof p.time === 'string' && TIME_RE.test(p.time))) errors.push(`${where}: invalid time`);
  return true;
}
function checkPeople(v: unknown, ids: ReadonlySet<string>, where: string, errors: string[]) {
  if (!Array.isArray(v)) { errors.push(`${where}: people is not a list`); return; }
  v.forEach((x, i) => {
    if (typeof x !== 'string' || !ids.has(x)) errors.push(`${where}: person reference ${i} does not match a listed person`);
    if (i > 0 && typeof x === 'string' && typeof v[i - 1] === 'string' && x <= (v[i - 1] as string)) errors.push(`${where}: people must be sorted and have no repeats`);
  });
}

/** Checks a decoded value completely. Never throws. A projection that fails ANY check is rejected whole (there is no partial acceptance). */
export async function validateProjection(value: unknown): Promise<Validation> {
  const errors: string[] = [];
  if (!isObj(value)) return { ok: false, errors: ['The projection is not an object.'] };
  if (value.format !== FORMAT) return { ok: false, errors: ['Wrong format.'] };
  if (value.version !== VERSION) return { ok: false, errors: [`Unsupported version ${String(value.version)}.`] };
  if (typeof value.minReader !== 'number' || !Number.isInteger(value.minReader) || value.minReader < 1 || value.minReader > MIN_READER) return { ok: false, errors: ['This display data needs a newer reader.'] };
  exactKeys(value, TOP_KEYS, 'projection', errors);
  if (!(typeof value.revision === 'number' && Number.isInteger(value.revision) && value.revision >= 0)) errors.push('revision: not a whole number');
  if (!isRealUtc(value.publishedAt)) errors.push('publishedAt: invalid timestamp');

  const g = value.generatedFor;
  if (!isObj(g)) errors.push('generatedFor: not an object');
  else { exactKeys(g, ['tz', 'today'], 'generatedFor', errors); if (!(typeof g.tz === 'string' && /^[A-Za-z0-9_+\-/]{1,64}$/.test(g.tz))) errors.push('generatedFor.tz: invalid'); if (!isRealDate(g.today)) errors.push('generatedFor.today: invalid date'); }
  const w = value.window;
  if (!isObj(w)) errors.push('window: not an object');
  else { exactKeys(w, ['from', 'to'], 'window', errors); if (!isRealDate(w.from) || !isRealDate(w.to) || w.from > w.to) errors.push('window: invalid dates'); }
  const h = value.household;
  if (!isObj(h)) errors.push('household: not an object');
  else { exactKeys(h, ['label'], 'household', errors); if (!text(h.label, LIMITS.label)) errors.push('household.label: invalid'); }
  const pr = value.prefs;
  if (!isObj(pr)) errors.push('prefs: not an object');
  else { exactKeys(pr, ['weekStart'], 'prefs', errors); if (!(WEEK_STARTS as readonly unknown[]).includes(pr.weekStart)) errors.push('prefs.weekStart: invalid'); }

  const personIds = new Set<string>();
  if (!Array.isArray(value.people)) errors.push('people: not a list');
  else value.people.forEach((p, i) => {
    const where = `people[${i}]`;
    if (!isObj(p)) { errors.push(`${where}: not an object`); return; }
    exactKeys(p, PERSON_KEYS, where, errors);
    if (typeof p.id !== 'string' || !ID_RE.test(p.id)) errors.push(`${where}.id: invalid`); else { if (personIds.has(p.id)) errors.push(`${where}.id: repeated`); personIds.add(p.id); }
    if (!text(p.name, LIMITS.name)) errors.push(`${where}.name: invalid`);
    if (p.color !== null && !(COLOR_IDS as readonly unknown[]).includes(p.color)) errors.push(`${where}.color: invalid`);
    if (!(GROUPS as readonly unknown[]).includes(p.group)) errors.push(`${where}.group: invalid`);
  });

  if (!Array.isArray(value.sources)) errors.push('sources: not a list');
  else {
    const seen = new Set<unknown>();
    value.sources.forEach((s, i) => {
      if (!isObj(s)) { errors.push(`sources[${i}]: not an object`); return; }
      exactKeys(s, SOURCE_KEYS, `sources[${i}]`, errors);
      if (!(SOURCE_IDS as readonly unknown[]).includes(s.id) || seen.has(s.id)) errors.push(`sources[${i}].id: invalid or repeated`);
      seen.add(s.id);
      if (!text(s.label, LIMITS.label)) errors.push(`sources[${i}].label: invalid`);
    });
  }

  const entryIds = new Set<string>();
  if (!Array.isArray(value.entries)) errors.push('entries: not a list');
  else {
    if (value.entries.length > LIMITS.entries) errors.push(`entries: more than ${LIMITS.entries}`);
    value.entries.forEach((e, i) => {
      const where = `entries[${i}]`;
      if (!isObj(e)) { errors.push(`${where}: not an object`); return; }
      exactKeys(e, ENTRY_KEYS, where, errors);
      if (typeof e.id !== 'string' || !ID_RE.test(e.id)) errors.push(`${where}.id: invalid`); else { if (entryIds.has(e.id)) errors.push(`${where}.id: repeated`); entryIds.add(e.id); }
      if (!(ENTRY_SOURCES as readonly unknown[]).includes(e.source)) errors.push(`${where}.source: invalid`);
      if (!text(e.title, LIMITS.title)) errors.push(`${where}.title: invalid`);
      if (typeof e.allDay !== 'boolean') errors.push(`${where}.allDay: not true or false`);
      if (typeof e.repeat !== 'boolean') errors.push(`${where}.repeat: not true or false`);
      if (!(ENTRY_STATUSES as readonly unknown[]).includes(e.status)) errors.push(`${where}.status: invalid`);
      const okS = checkPoint(e.start, `${where}.start`, errors);
      const okE = checkPoint(e.end, `${where}.end`, errors);
      if (okS && okE) {
        const s = e.start as DatePoint, en = e.end as DatePoint;
        if (e.allDay === true && (s.time !== null || en.time !== null)) errors.push(`${where}: an all-day item has no times`);
        if (e.allDay === false && (s.time === null || en.time === null)) errors.push(`${where}: a timed item needs both times`);
        if (isRealDate(s.date) && isRealDate(en.date) && `${en.date} ${en.time ?? ''}` < `${s.date} ${s.time ?? ''}`) errors.push(`${where}: ends before it starts`);
      }
      checkPeople(e.people, personIds, where, errors);
    });
  }

  const taskIds = new Set<string>();
  if (!Array.isArray(value.tasks)) errors.push('tasks: not a list');
  else {
    if (value.tasks.length > LIMITS.tasks) errors.push(`tasks: more than ${LIMITS.tasks}`);
    value.tasks.forEach((t, i) => {
      const where = `tasks[${i}]`;
      if (!isObj(t)) { errors.push(`${where}: not an object`); return; }
      exactKeys(t, TASK_KEYS, where, errors);
      if (typeof t.id !== 'string' || !ID_RE.test(t.id)) errors.push(`${where}.id: invalid`); else { if (taskIds.has(t.id) || entryIds.has(t.id)) errors.push(`${where}.id: repeated`); taskIds.add(t.id); }
      if (!text(t.title, LIMITS.title)) errors.push(`${where}.title: invalid`);
      if (!(TASK_STATUSES as readonly unknown[]).includes(t.status)) errors.push(`${where}.status: invalid`);
      if (typeof t.repeat !== 'boolean') errors.push(`${where}.repeat: not true or false`);
      if (t.due !== null) checkPoint(t.due, `${where}.due`, errors);
      checkPeople(t.people, personIds, where, errors);
    });
  }

  if (!Array.isArray(value.grantsSeen)) errors.push('grantsSeen: not a list');
  else {
    if (value.grantsSeen.length > LIMITS.grantsSeen) errors.push(`grantsSeen: more than ${LIMITS.grantsSeen}`);
    value.grantsSeen.forEach((x, i, a) => {
      if (typeof x !== 'string' || !ID_RE.test(x)) errors.push(`grantsSeen[${i}]: invalid`);
      else if (i > 0 && typeof a[i - 1] === 'string' && x <= (a[i - 1] as string)) errors.push('grantsSeen: must be sorted with no repeats');
    });
  }

  const c = value.counts;
  if (!isObj(c)) errors.push('counts: not an object');
  else {
    exactKeys(c, ['entries', 'tasks'], 'counts', errors);
    if (Array.isArray(value.entries) && c.entries !== value.entries.length) errors.push('counts.entries does not match');
    if (Array.isArray(value.tasks) && c.tasks !== value.tasks.length) errors.push('counts.tasks does not match');
  }
  if (typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.digest)) errors.push('digest: invalid');

  if (errors.length === 0) {
    const v = value as unknown as DisplayProjection;
    if ((await contentDigest(v)) !== v.digest) errors.push('digest does not match the content');
    if (enc(canonicalJson(v)).byteLength > LIMITS.bytes) errors.push(`The projection is larger than ${LIMITS.bytes} bytes.`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as unknown as DisplayProjection };
}

/** Canonical plain-JSON text (local preview and tests only). */
export const encodeProjection = (p: DisplayProjection): string => canonicalJson(p);

export async function decodeProjection(textIn: string): Promise<Validation> {
  let v: unknown;
  try { v = JSON.parse(textIn); } catch { return { ok: false, errors: ['The projection is not valid JSON.'] }; }
  return validateProjection(v);
}
