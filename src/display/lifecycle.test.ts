import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../db';
import { encryptText, exportAll, importAll } from '../lib/backup';
import { summarizeBackup } from '../lib/backupSummary';
import { buildBackup, checkBackupText, prepareEncryptedRestore, restoreWithSafetyCopy } from '../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../lib/sync/engine';
import { carryEventDecision } from './grantStore';
import { saveEdit, loadEvents, removeOccurrence } from '../modules/calendar/data';
import { occurrencesOf } from '../modules/calendar/occurrences';
import { blankFields, type EventFields } from '../modules/calendar/model';
import { msAt } from '../modules/calendar/time';
import { completeTask, reopenTask } from '../modules/tasks/data';
import { taskRootId } from '../modules/tasks/chain';
import { compareHistory, effectiveForEvent, resolveGrants, subjectOf } from './grants';
import { appendDecision, loadGrantRows } from './grantStore';
import { addEvent, addTask, calendar, extras, fresh, household, projectionOf, stubStorage, TODAY, weekly } from './displayTestkit';
import { previewCalendarShare } from './readState';

/** CS-1 lifecycle: series splits, repeating Tasks, deletions, restore, backup, two-device sync and the privacy-decision history. Invented data only. */
vi.mock('../lib/download', () => ({ downloadText: () => undefined }));
beforeEach(() => stubStorage());

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const edited = (date: string, minutes: number, title: string): EventFields => ({ ...blankFields(date, msAt(date, minutes)), title, startDate: date, endDate: date });
const occ = async (d: FinanceDB, id: number, key: string) => occurrencesOf((await loadEvents(d)).find((e) => e.id === id)!, key, key)[0];
const titlesOf = async (d: FinanceDB) => (await projectionOf(d)).projection.entries.map((e) => `${e.title}@${e.start.date}`);

describe('"this and following" on a repeating event (a new event id)', () => {
  async function series(d: FinanceDB, over: Parameters<typeof addEvent>[3] = {}) {
    return addEvent(d, 'Piano', '2026-11-02', { recurrence: weekly, ...over }, 16 * 60);
  }
  const split = async (d: FinanceDB, id: number) => saveEdit(await occ(d, id, '2026-11-16'), edited('2026-11-16', 17 * 60, 'Piano (new teacher)'), extras({ recurrence: weekly }), 'following', d);

  it('an existing event-level show follows the series to the new event; the old one keeps its own', async () => {
    const { d } = await household();
    const a = await series(d);
    await appendDecision({ subject: subjectOf('event', a), decision: 'show' }, d);
    const b = await split(d, a);
    expect(b).not.toBe(a);
    const g = resolveGrants(await loadGrantRows(d));
    expect(effectiveForEvent(g, a, 1).show).toBe('details');
    expect(effectiveForEvent(g, b, 1).show).toBe('details');
    const titles = await titlesOf(d);
    expect(titles).toContain('Piano@2026-11-09');
    expect(titles).toContain('Piano (new teacher)@2026-11-16');
    expect(titles).not.toContain('Piano@2026-11-16');
  });

  it('Busy follows too, and so does the owner\'s Busy label', async () => {
    const { d } = await household();
    const a = await series(d);
    await appendDecision({ subject: subjectOf('event', a), decision: 'show', level: 'busy', label: 'Away' }, d);
    const b = await split(d, a);
    const g = resolveGrants(await loadGrantRows(d));
    expect(g.get(subjectOf('event', b))).toMatchObject({ state: 'show', level: 'busy', label: 'Away' });
    expect((await titlesOf(d)).every((t) => t.startsWith('Away@'))).toBe(true);
  });

  it('an explicit "keep this one private" follows the series, so the new event does NOT inherit a shared calendar', async () => {
    const { d } = await household();
    const fam = await calendar(d, 'Family');
    await appendDecision({ subject: subjectOf('calendar', fam), decision: 'show' }, d);
    const a = await series(d, { calendarId: fam });
    await appendDecision({ subject: subjectOf('event', a), decision: 'hide' }, d);
    expect(await titlesOf(d)).toEqual([]);
    const b = await split(d, a);
    expect(resolveGrants(await loadGrantRows(d)).get(subjectOf('event', b))).toMatchObject({ state: 'hide' });
    expect(await titlesOf(d)).toEqual([]); // nothing became visible
  });

  it('a conflicted or unreadable decision on the old event gives the new event a hide (it can only fail closed)', async () => {
    const { d } = await household();
    const a = await series(d);
    await d.moduleRecords.add({ module: 'display', kind: 'grant', data: { v: 1, subject: subjectOf('event', a), decision: 'show', supersedes: [], deviceId: 'x' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await d.moduleRecords.add({ module: 'display', kind: 'grant', data: { v: 1, subject: subjectOf('event', a), decision: 'hide', supersedes: [], deviceId: 'y' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const b = await split(d, a);
    expect(resolveGrants(await loadGrantRows(d)).get(subjectOf('event', b)).state).toBe('hide');
  });

  it('an event with no decision of its own simply inherits its calendar, before and after (and a private calendar stays private)', async () => {
    const { d } = await household();
    const fam = await calendar(d, 'Family');
    const a = await series(d, { calendarId: fam });
    const b = await split(d, a);
    expect(await titlesOf(d)).toEqual([]);
    expect(resolveGrants(await loadGrantRows(d)).recordIds).toEqual([]); // nothing was written
    await appendDecision({ subject: subjectOf('calendar', fam), decision: 'show' }, d);
    expect((await titlesOf(d)).length).toBeGreaterThan(0);
    expect(b).not.toBe(a);
  });

  it('revoking after a split hides only the one it was revoked on', async () => {
    const { d } = await household();
    const a = await series(d);
    await appendDecision({ subject: subjectOf('event', a), decision: 'show' }, d);
    const b = await split(d, a);
    await appendDecision({ subject: subjectOf('event', b), decision: 'hide' }, d);
    const titles = await titlesOf(d);
    expect(titles).toContain('Piano@2026-11-09');
    expect(titles.some((t) => t.startsWith('Piano (new teacher)'))).toBe(false);
  });

  it('a split by an OLDER build (which copies nothing) fails closed when the calendar is not shared', async () => {
    const { d } = await household();
    const a = await series(d);
    await appendDecision({ subject: subjectOf('event', a), decision: 'show' }, d);
    // an older build ends the series the day before and stores a copy under a new id, without carrying any display decision
    const old = (await d.moduleRecords.get(a))!;
    const newId = await d.moduleRecords.add({ module: 'calendar', kind: 'event', data: { ...old.data, startDate: '2026-11-16', title: 'Piano (older build)' }, createdAt: 5, updatedAt: 5, deletedAt: null } as never);
    expect(resolveGrants(await loadGrantRows(d)).get(subjectOf('event', Number(newId))).state).toBe('none');
    expect((await titlesOf(d)).some((t) => t.includes('older build'))).toBe(false);
  });

  it('one occurrence edited, the whole series edited and a skipped date change nothing about who may see it', async () => {
    const { d } = await household();
    const a = await series(d);
    await appendDecision({ subject: subjectOf('event', a), decision: 'show' }, d);
    const before = (await loadGrantRows(d)).length;
    await saveEdit(await occ(d, a, '2026-11-09'), edited('2026-11-09', 18 * 60, 'Piano (late)'), extras({ recurrence: weekly }), 'one', d);
    await removeOccurrence(await occ(d, a, '2026-11-23'), 'one', d);
    await saveEdit(await occ(d, a, '2026-11-02'), edited('2026-11-02', 15 * 60, 'Piano lesson'), extras({ recurrence: weekly }), 'all', d);
    expect((await loadGrantRows(d)).length).toBe(before); // no decision written, none needed
    const titles = await titlesOf(d);
    expect(titles).toContain('Piano lesson@2026-11-16');
    expect(titles).not.toContain('Piano lesson@2026-11-23'); // skipped date absent
    expect(await loadEvents(d)).toHaveLength(1);
  });

  it('carryEventDecision writes nothing when the old event had no decision of its own', async () => {
    const { d } = await household();
    const a = await series(d);
    await d.transaction('rw', d.moduleRecords, () => carryEventDecision(a, 999, d, 'x'));
    expect(await loadGrantRows(d)).toEqual([]);
  });

  it('the split and its decision are one transaction: if the decision cannot be written, the split does not happen', async () => {
    const { d } = await household();
    const a = await series(d);
    await appendDecision({ subject: subjectOf('event', a), decision: 'show' }, d);
    const before = await d.moduleRecords.count();
    const orig = d.moduleRecords.add.bind(d.moduleRecords);
    let adds = 0;
    // the first add is the new event, the second is the carried decision: fail the second
    vi.spyOn(d.moduleRecords, 'add').mockImplementation(((...x: Parameters<typeof orig>) => { adds++; if (adds === 2) throw new Error('disk full'); return orig(...x); }) as typeof orig);
    const o = await occ(d, a, '2026-11-16');
    await expect(saveEdit(o, edited('2026-11-16', 17 * 60, 'Piano (new teacher)'), extras({ recurrence: weekly }), 'following', d)).rejects.toThrow('disk full');
    vi.restoreAllMocks();
    expect(await d.moduleRecords.count()).toBe(before); // all or nothing
    expect((await loadEvents(d))[0].data.recurrence?.end).toEqual({ type: 'never' });
  });
});

describe('repeating Tasks: the choice follows the series, never widens it', () => {
  const rule = { mode: 'fixed' as const, rule: { freq: 'weekly' as const, interval: 1, end: { type: 'never' as const } } };
  const shown = async (d: FinanceDB) => (await projectionOf(d)).projection.tasks.map((t) => t.title);

  it('approving the root, completing it, and the successor is shown; revoking hides the successor', async () => {
    const { d } = await household();
    const root = await addTask(d, 'Weekly chore', { dueDate: '2026-11-09', repeat: rule });
    await appendDecision({ subject: subjectOf('task', root), decision: 'show' }, d);
    expect(await shown(d)).toEqual(['Weekly chore']);
    const { spawnedId } = await completeTask(root, TODAY, d);
    expect(spawnedId).toBeDefined();
    expect(await shown(d)).toEqual(['Weekly chore']); // the successor, not the done one
    const p = await projectionOf(d);
    expect(p.report.tasks).toHaveLength(1);
    expect(p.report.tasks[0]).toMatchObject({ rootId: root, taskId: spawnedId });
    const again = await completeTask(spawnedId!, TODAY, d);
    expect(taskRootId(again.spawnedId!, new Map((await d.moduleRecords.toArray()).filter((r) => r.module === 'tasks').map((r) => [r.id as number, { id: r.id as number, recurFrom: (r.data as { recurFrom?: number }).recurFrom }])))).toBe(root);
    expect(await shown(d)).toEqual(['Weekly chore']); // third in the chain
    await appendDecision({ subject: subjectOf('task', root), decision: 'hide' }, d);
    expect(await shown(d)).toEqual([]);
  });

  it('a PRIVATE series stays private when it repeats', async () => {
    const { d } = await household();
    const root = await addTask(d, 'Private repeat', { dueDate: '2026-11-09', repeat: rule });
    await completeTask(root, TODAY, d);
    expect(await shown(d)).toEqual([]);
  });

  it('approving a task that is itself a successor writes the decision on the ROOT, and a different series is untouched', async () => {
    const { d } = await household();
    const root = await addTask(d, 'Series A', { dueDate: '2026-11-09', repeat: rule });
    const other = await addTask(d, 'Series B', { dueDate: '2026-11-09', repeat: rule });
    const { spawnedId } = await completeTask(root, TODAY, d);
    await completeTask(other, TODAY, d);
    const chain = new Map((await d.moduleRecords.toArray()).filter((r) => r.module === 'tasks').map((r) => [r.id as number, { id: r.id as number, recurFrom: (r.data as { recurFrom?: number }).recurFrom }]));
    await appendDecision({ subject: subjectOf('task', taskRootId(spawnedId!, chain)!), decision: 'show' }, d);
    expect(await shown(d)).toEqual(['Series A']);
  });

  it('a task copied by hand (no recurFrom) is a new series and is private', async () => {
    const { d } = await household();
    const root = await addTask(d, 'Original', { dueDate: '2026-11-09', repeat: rule });
    await appendDecision({ subject: subjectOf('task', root), decision: 'show' }, d);
    await addTask(d, 'Original (copy)', { dueDate: '2026-11-10', repeat: rule });
    expect(await shown(d)).toEqual(['Original']);
  });

  it('a deleted (soft) ancestor still names the series; a MISSING ancestor or a loop is ambiguous and the task is omitted', async () => {
    const { d } = await household();
    const root = await addTask(d, 'Weekly chore', { dueDate: '2026-11-09', repeat: rule });
    await appendDecision({ subject: subjectOf('task', root), decision: 'show' }, d);
    const { spawnedId } = await completeTask(root, TODAY, d);
    await d.moduleRecords.update(root, { deletedAt: Date.now() }); // soft-deleted marker stays
    expect(await shown(d)).toEqual(['Weekly chore']);
    // the ancestor vanishes entirely (not even a marker): the chain cannot be proven, so nothing is shown
    await d.moduleRecords.delete(root);
    expect(await shown(d)).toEqual([]);
    expect((await projectionOf(d)).report.ambiguousTasks).toBe(1);
    // a loop
    const a = await addTask(d, 'Loop A', { dueDate: '2026-11-09' });
    const b = await addTask(d, 'Loop B', { dueDate: '2026-11-09' });
    await d.moduleRecords.update(a, { 'data.recurFrom': b });
    await d.moduleRecords.update(b, { 'data.recurFrom': a });
    await appendDecision({ subject: subjectOf('task', a), decision: 'show' }, d);
    await appendDecision({ subject: subjectOf('task', b), decision: 'show' }, d);
    expect(await shown(d)).toEqual([]);
    void spawnedId;
  });

  it('reopening a finished task keeps it under the same decision', async () => {
    const { d } = await household();
    const t = await addTask(d, 'One-off', { dueDate: '2026-11-09' });
    await appendDecision({ subject: subjectOf('task', t), decision: 'show' }, d);
    await completeTask(t, TODAY, d);
    expect(await shown(d)).toEqual([]); // done tasks are absent
    await reopenTask(t, d);
    expect(await shown(d)).toEqual(['One-off']);
  });
});

describe('deleted and missing source records', () => {
  it('a deleted event is not shown even if it was approved; restoring it shows it again under the same approval', async () => {
    const { d } = await household();
    const a = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    await appendDecision({ subject: subjectOf('event', a), decision: 'show' }, d);
    await d.moduleRecords.update(a, { deletedAt: Date.now() });
    expect(await titlesOf(d)).toEqual([]);
    await d.moduleRecords.update(a, { deletedAt: null });
    expect(await titlesOf(d)).toEqual(['Swim meet@2026-11-11']);
  });
  it('a decision for a record that no longer exists is harmless and stays in the history', async () => {
    const { d } = await household();
    await appendDecision({ subject: subjectOf('event', 424242), decision: 'show' }, d);
    expect((await projectionOf(d)).projection.entries).toEqual([]);
    expect((await projectionOf(d)).projection.grantsSeen).toHaveLength(1);
  });
  it('an event whose calendar was deleted inherits nothing from it (fail closed), but its own approval still applies', async () => {
    const { d } = await household();
    const fam = await calendar(d, 'Family');
    await addEvent(d, 'Concert', '2026-11-11', { calendarId: fam });
    const own = await addEvent(d, 'Recital', '2026-11-12', { calendarId: fam });
    await appendDecision({ subject: subjectOf('calendar', fam), decision: 'show' }, d);
    await appendDecision({ subject: subjectOf('event', own), decision: 'show' }, d);
    expect(await titlesOf(d)).toEqual(['Concert@2026-11-11', 'Recital@2026-11-12']);
    await d.moduleRecords.update(fam, { deletedAt: Date.now() });
    expect(await titlesOf(d)).toEqual(['Recital@2026-11-12']);
  });
});

describe('the privacy-decision history (groundwork for publishing)', () => {
  it('a revoked event OUTSIDE the published window: the visible schedule and digest are identical, but the history advances', async () => {
    const { d } = await household();
    const far = await addEvent(d, 'Far away', '2027-06-01', {}, 10 * 60); // about 200 days ahead
    const near = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    await appendDecision({ subject: subjectOf('event', near), decision: 'show' }, d);
    await appendDecision({ subject: subjectOf('event', far), decision: 'show' }, d);
    const a = (await projectionOf(d)).projection;
    expect(a.entries.map((e) => e.title)).toEqual(['Swim meet']); // the far one is outside the window
    await appendDecision({ subject: subjectOf('event', far), decision: 'hide' }, d);
    const b = (await projectionOf(d)).projection;
    expect(b.entries).toEqual(a.entries);
    expect(b.digest).toBe(a.digest); // no visible change
    expect(b.grantsSeen).not.toEqual(a.grantsSeen); // but the privacy history moved
    expect(compareHistory(a.grantsSeen, b.grantsSeen)).toMatchObject({ missing: [], same: false });
    expect(compareHistory(a.grantsSeen, b.grantsSeen).added).toHaveLength(1);
  });

  it('an approval, a superseding approval and a revocation each advance the history with no visible change', async () => {
    const { d } = await household();
    const far = await addEvent(d, 'Far away', '2027-06-01', {}, 10 * 60);
    let last = (await projectionOf(d)).projection;
    for (const decision of ['show', 'show', 'hide'] as const) {
      await appendDecision({ subject: subjectOf('event', far), decision }, d);
      const now = (await projectionOf(d)).projection;
      expect(now.digest).toBe(last.digest);
      expect(now.grantsSeen.length).toBe(last.grantsSeen.length + 1);
      expect(compareHistory(last.grantsSeen, now.grantsSeen).missing).toEqual([]);
      last = now;
    }
  });

  it('a stale device that lacks the revocation but shows the same schedule is detected by the history, not the content', async () => {
    const { d } = await household();
    const far = await addEvent(d, 'Far away', '2027-06-01', {}, 10 * 60);
    await appendDecision({ subject: subjectOf('event', far), decision: 'show' }, d);
    const staleRows = await loadGrantRows(d); // device B's copy, before the revocation
    const staleP = await (async () => { const e = fresh(); await e.moduleRecords.bulkAdd(staleRows); return projectionOf(e); })();
    await appendDecision({ subject: subjectOf('event', far), decision: 'hide' }, d);
    const fresher = (await projectionOf(d)).projection;
    expect(staleP.projection.digest).toBe(fresher.digest); // same visible schedule: a content-only check cannot tell them apart
    const published = fresher.grantsSeen; // what the display file lists
    const check = compareHistory(published, staleP.projection.grantsSeen);
    expect(check.same).toBe(false);
    expect(check.missing).toHaveLength(1); // the stale device is missing a decision the display file knew
  });

  it('a restore that removes decision records is detected as an incomplete history', async () => {
    const { d } = await household();
    const near = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    await appendDecision({ subject: subjectOf('event', near), decision: 'show' }, d);
    const backup = await exportAll(d);
    await appendDecision({ subject: subjectOf('event', near), decision: 'hide' }, d);
    const published = (await projectionOf(d)).projection.grantsSeen;
    await importAll(d, backup); // an older backup replaces everything: the revocation is gone, and the event is shown again
    const after = await projectionOf(d);
    expect(after.projection.entries.map((e) => e.title)).toEqual(['Swim meet']);
    const check = compareHistory(published, after.projection.grantsSeen);
    expect(check.missing).toHaveLength(1);
    expect(check.same).toBe(false);
  });

  it('records no screen can edit: the only writes are appends', async () => {
    const { d } = await household();
    const near = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    const first = await appendDecision({ subject: subjectOf('event', near), decision: 'show' }, d);
    const snapshot = JSON.stringify(await d.moduleRecords.get(first));
    await appendDecision({ subject: subjectOf('event', near), decision: 'hide' }, d);
    await appendDecision({ subject: subjectOf('event', near), decision: 'show' }, d);
    expect(JSON.stringify(await d.moduleRecords.get(first))).toBe(snapshot);
    expect((await loadGrantRows(d)).every((r) => r.deletedAt == null)).toBe(true);
    expect(await loadGrantRows(d)).toHaveLength(3);
  });

  it('a wrong device clock cannot make an old approval look newer: the order comes from supersedes only', async () => {
    const { d } = await household();
    const near = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    const show = await appendDecision({ subject: subjectOf('event', near), decision: 'show' }, d);
    await appendDecision({ subject: subjectOf('event', near), decision: 'hide' }, d);
    await d.moduleRecords.update(show, { createdAt: 9_999_999_999_999, updatedAt: 9_999_999_999_999 }); // the approval claims to be from the far future
    expect(await titlesOf(d)).toEqual([]);
  });
});

describe('backup and restore', () => {
  it('a plain and an encrypted backup carry the decisions, a restore puts them back exactly, and the summary counts them', async () => {
    const { d } = await household();
    const near = await addEvent(d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    await appendDecision({ subject: subjectOf('event', near), decision: 'show', level: 'busy', label: 'Away', titleAtGrant: 'Swim meet' }, d);
    const { file } = checkBackupText(JSON.stringify(await buildBackup(d, mem())));
    const fam = summarizeBackup(file).find((g) => g.id === 'family')!;
    expect(fam.items.map((i) => i.label.split(' (')[0])).toContain('Family display choices');
    const e = fresh();
    await restoreWithSafetyCopy(e, file, { saveCopy: async () => 'copy', storage: mem() });
    expect((await loadGrantRows(e)).map((r) => r.data)).toEqual((await loadGrantRows(d)).map((r) => r.data));
    expect((await projectionOf(e)).projection.entries.map((x) => x.title)).toEqual(['Away']);
    // encrypted
    const enc = await encryptText(JSON.stringify(await buildBackup(d, mem())), 'a good passphrase');
    expect(enc).not.toContain('Swim meet');
    const prepared = await prepareEncryptedRestore(enc, 'a good passphrase');
    const g = fresh();
    await restoreWithSafetyCopy(g, prepared.file, { saveCopy: async () => 'copy', storage: mem() });
    expect((await loadGrantRows(g)).map((r) => r.data)).toEqual((await loadGrantRows(d)).map((r) => r.data));
  }, 30000);

  it('there is no new table and no new database version', async () => {
    const d = fresh();
    expect(d.verno).toBe(15);
    expect(d.tables.map((t) => t.name)).not.toContain('display');
    expect(d.tables.map((t) => t.name)).not.toContain('grants');
  });
});

describe('two devices with the real sync engine', () => {
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
  let m = 0;
  const devices = () => {
    const remote = remoteStore();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`display-meta-${m++}`), remote, 'a good passphrase') }; };
    return { A: mk(), B: mk() };
  };
  type Dev = ReturnType<typeof devices>['A'];
  const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
  async function seeded() {
    const { A, B } = devices();
    await A.d.moduleRecords.bulkAdd([]);
    const event = await addEvent(A.d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    return { A, B, event };
  }

  it('decisions travel to the other device and give the same result there', async () => {
    const { A, B, event } = await seeded();
    await appendDecision({ subject: subjectOf('event', event), decision: 'show' }, A.d);
    await settle(A, B);
    expect((await titlesOf(B.d))).toEqual(['Swim meet@2026-11-11']);
    expect((await projectionOf(B.d)).projection.grantsSeen).toEqual((await projectionOf(A.d)).projection.grantsSeen);
  });

  it('a revocation survives a stale device: B (which never saw it) re-approves, and after sync the event is HIDDEN everywhere with a conflict to resolve', async () => {
    const { A, B, event } = await seeded();
    await appendDecision({ subject: subjectOf('event', event), decision: 'show' }, A.d);
    await settle(A, B);
    await sleep(5);
    await appendDecision({ subject: subjectOf('event', event), decision: 'hide' }, A.d); // A revokes
    await appendDecision({ subject: subjectOf('event', event), decision: 'show', level: 'busy' }, B.d); // B, stale, approves again later
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await titlesOf(d)).toEqual([]);
      const s = resolveGrants(await loadGrantRows(d)).get(subjectOf('event', event));
      expect(s).toMatchObject({ state: 'hide', conflict: true });
      expect(s.headIds).toHaveLength(2);
      expect((await projectionOf(d)).report.conflicts.map((c) => c.subject)).toEqual([subjectOf('event', event)]);
    }
    // the owner's new decision supersedes both and settles it
    await appendDecision({ subject: subjectOf('event', event), decision: 'show' }, A.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) expect(await titlesOf(d)).toEqual(['Swim meet@2026-11-11']);
  });

  it('a decision with a LATER timestamp on the stale device does not beat a revocation that superseded it', async () => {
    const { A, B, event } = await seeded();
    const showId = await appendDecision({ subject: subjectOf('event', event), decision: 'show' }, A.d);
    await settle(A, B);
    await appendDecision({ subject: subjectOf('event', event), decision: 'hide' }, A.d);
    await settle(A, B);
    await B.d.moduleRecords.update(showId, { updatedAt: Date.now() + 10_000_000 }); // B's clock edits the old record to look newer
    await settle(A, B);
    for (const d of [A.d, B.d]) expect(await titlesOf(d)).toEqual([]);
  });

  it('a device that knows nothing about the display module (an older build) keeps the records byte for byte through sync', async () => {
    const { A, B, event } = await seeded();
    const id = await appendDecision({ subject: subjectOf('event', event), decision: 'show', label: 'x', titleAtGrant: 'Swim meet' }, A.d);
    await A.d.moduleRecords.update(id, { 'data.futureField': { list: [1, 2] } });
    await settle(A, B);
    // B never looks at display records, only the generic table: the row is the same
    expect(await B.d.moduleRecords.get(id)).toEqual(await A.d.moduleRecords.get(id));
    expect((await B.d.moduleRecords.get(id))!.data).toMatchObject({ futureField: { list: [1, 2] } });
    // the older build summarizes it under "other data" rather than dropping it
    const old = summarizeBackup({ ...(await exportAll(B.d)), moduleRecords: (await exportAll(B.d)).moduleRecords!.map((r) => ({ ...(r as object), module: 'display-unknown' })) } as never);
    expect(old.find((g) => g.id === 'other')!.items.map((i) => i.label)).toContain('display-unknown records');
  });
});

describe('previews do not write, and cancelling changes nothing', () => {
  it('the calendar-sharing preview shows what would be eligible and writes nothing; "cancel" is simply not calling appendDecision', async () => {
    const { d } = await household();
    const fam = await calendar(d, 'Family');
    await addEvent(d, 'Concert', '2026-11-11', { calendarId: fam });
    const before = JSON.stringify(await loadGrantRows(d));
    const preview = await previewCalendarShare(d, fam, { today: TODAY });
    expect(preview.eligible.map((e) => e.title)).toEqual(['Concert']);
    expect(JSON.stringify(await loadGrantRows(d))).toBe(before);
    expect(await titlesOf(d)).toEqual([]); // not shared until confirmed
  });
});
