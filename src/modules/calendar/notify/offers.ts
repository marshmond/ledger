/**
 * CAL-N1: decides WHETHER to offer a notification, and gathers the facts for it. Reads the database; writes nothing.
 *
 * Every function here is called AFTER the Calendar has finished its own save or delete, inside a try/catch that ignores any failure: an event never
 * fails to save, and a delete never fails, because of anything in this folder. An offer is only a proposal: nothing is sent, and nothing is recorded,
 * until the owner chooses people, reviews the text and presses Send.
 */
import { db, type FinanceDB } from '../../../db';
import { isLive } from '../../../core/store';
import { asEvent, type EventData, type EventFields } from '../model';
import { pickFields, seriesStart, type Occurrence } from '../occurrences';
import type { Scope } from '../data';
import { detectChanges, factsOf, factsOfFields } from './facts';
import { getTransport } from './transport';
import { classifyContacts, hasEligible } from './recipients';
import type { NoticeKind, NoticeScope, NoticeSubject } from './types';

/** A proposal to tell people about one change. */
export interface NoticeOffer {
  subject: NoticeSubject;
  /** Contacts the event is about: suggested, never pre-selected. */
  involved: number[];
  /** Contacts already told about the cancellation this corrects (only for `restored`): offered as a one-click choice, never pre-selected. */
  told: number[];
  /** What the prompt calls it ("Event saved", "Event deleted"...). */
  headline: string;
}

/**
 * Runs an offer lookup and swallows ANY failure. The Calendar's own save or delete has already succeeded by the time this is called, so a problem
 * here must never be shown as a problem with the event: the owner simply is not offered an email.
 */
export async function quietly<T>(f: () => Promise<T | null>): Promise<T | null> {
  try { return await f(); } catch { return null; }
}

export async function namesOf(d: FinanceDB, ids: readonly number[]): Promise<string[]> {
  const rows = await d.contacts.bulkGet([...ids]);
  return rows.flatMap((r) => (r && isLive(r) ? [r.name] : []));
}

/** True only when a real or test sender is connected. Until then the after-save and after-delete questions are never shown (the owner can still open the review from the event's Messages card, labelled not connected). */
export const senderConnected = (): boolean => getTransport() !== null;

/** Is there anyone at all who could be emailed? When not, no prompt is shown. */
export async function anyoneToEmail(d: FinanceDB = db): Promise<boolean> {
  return hasEligible(classifyContacts(await d.contacts.toArray(), []));
}

async function eventData(d: FinanceDB, id: number): Promise<EventData | null> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === 'calendar' && r.kind === 'event' && isLive(r) ? asEvent(r).data : null;
}

/** What "following" really did: the first date of a series cannot be split, so it changes the whole series. */
export function effectiveScope(occ: Occurrence | undefined, scope: Scope, split: boolean, recurringNow: boolean): NoticeScope {
  if (!occ) return recurringNow ? 'all' : 'single';
  if (!occ.event.data.recurrence) return recurringNow ? 'all' : 'single';
  if (scope === 'one') return 'one';
  if (scope === 'following') return split ? 'following' : 'all';
  return 'all';
}

/** The scope of a delete: a "this and following" on the very first date removes the whole series. */
export function effectiveDeleteScope(occ: Occurrence, scope: Scope): NoticeScope {
  const d = occ.event.data;
  if (!d.recurrence) return 'single';
  if (scope === 'one') return 'one';
  if (scope === 'following') return occ.key <= seriesStart(pickFields(d)) ? 'all' : 'following';
  return 'all';
}

/**
 * After a successful create or edit: an offer, or null when it should stay quiet (nobody to email, or nothing that matters to other people changed).
 * `edited` is exactly what was saved from the form; the rest is read back from the stored event.
 */
export async function offerAfterSave(
  a: { occ?: Occurrence; scope: Scope; savedId: number; edited: EventFields }, d: FinanceDB = db,
): Promise<NoticeOffer | null> {
  if (!(await anyoneToEmail(d))) return null;
  const data = await eventData(d, a.savedId);
  if (!data) return null;
  const names = await namesOf(d, data.contactIds);
  const start = seriesStart(pickFields(data));
  const facts = factsOfFields(a.edited, data.recurrence, names, start);
  if (!a.occ) {
    const kind: NoticeKind = 'created';
    return { subject: { kind, scope: data.recurrence ? 'all' : 'single', facts, changes: [], affectedDate: '', eventIds: [a.savedId], factsEventId: a.savedId }, involved: data.contactIds, told: [], headline: 'Event added.' };
  }
  const was = a.occ.event.data;
  const split = a.savedId !== a.occ.eventId;
  const scope = effectiveScope(a.occ, a.scope, split, !!data.recurrence);
  // The people and the repeat rule of a single changed date are the series' own, so they are not compared for "this one".
  const changes = detectChanges(
    { fields: pickFields(a.occ), recurrence: was.recurrence, people: was.contactIds },
    { fields: a.edited, recurrence: scope === 'one' ? was.recurrence : data.recurrence, people: scope === 'one' ? was.contactIds : data.contactIds },
    scope,
  );
  if (!changes.length) return null;
  const before = factsOfFields(pickFields(a.occ), was.recurrence, await namesOf(d, was.contactIds), seriesStart(pickFields(was)));
  const subject: NoticeSubject = {
    kind: 'updated', scope, facts, before, changes,
    affectedDate: scope === 'one' || scope === 'following' ? a.occ.key : '',
    eventIds: split ? [a.occ.eventId, a.savedId] : [a.savedId], factsEventId: a.savedId,
  };
  return { subject, involved: data.contactIds, told: [], headline: 'Event saved.' };
}

/** After a delete (the event is already gone, with Undo available): an offer to say it was cancelled. `snap` is the event as it was before. */
export async function offerAfterDelete(a: { occ: Occurrence; scope: Scope; snap: EventData }, d: FinanceDB = db): Promise<NoticeOffer | null> {
  if (!(await anyoneToEmail(d))) return null;
  const scope = effectiveDeleteScope(a.occ, a.scope);
  const names = await namesOf(d, a.snap.contactIds);
  const facts = scope === 'one' ? factsOf(a.snap, a.occ.key, names) : factsOf(a.snap, null, names);
  return {
    subject: { kind: 'cancelled', scope, facts, changes: [], affectedDate: scope === 'one' || scope === 'following' ? a.occ.key : '', eventIds: [a.occ.eventId], factsEventId: a.occ.eventId },
    involved: a.snap.contactIds, told: [], headline: 'Event deleted.',
  };
}

/** After Undo brought a cancelled event back that people were already told about: an offer to send a correction. Never sent automatically. */
export async function offerAfterRestore(a: { eventId: number; scope: NoticeScope; affectedDate: string; told: number[] }, d: FinanceDB = db): Promise<NoticeOffer | null> {
  const data = await eventData(d, a.eventId);
  if (!data) return null;
  const names = await namesOf(d, data.contactIds);
  const facts = a.scope === 'one' ? factsOf(data, a.affectedDate, names) : factsOf(data, null, names);
  return {
    subject: { kind: 'restored', scope: a.scope, facts, changes: [], affectedDate: a.affectedDate, eventIds: [a.eventId], factsEventId: a.eventId },
    involved: data.contactIds, told: a.told, headline: 'Event restored.',
  };
}

/** "Email about this event": the current details of one event, started by the owner from the event itself. */
export async function offerForDetails(a: { occ: Occurrence }, d: FinanceDB = db): Promise<NoticeOffer | null> {
  const data = await eventData(d, a.occ.eventId);
  if (!data) return null;
  const names = await namesOf(d, data.contactIds);
  const recurring = !!data.recurrence;
  const facts = recurring ? factsOf(data, a.occ.key, names) : factsOf(data, null, names);
  return {
    subject: { kind: 'details', scope: recurring ? 'one' : 'single', facts, changes: [], affectedDate: recurring ? a.occ.key : '', eventIds: [a.occ.eventId], factsEventId: a.occ.eventId },
    involved: data.contactIds, told: [], headline: 'Email about this event.',
  };
}
