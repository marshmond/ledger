/**
 * CAL-N1: Calendar notifications ("email someone about this event"). Shared shapes.
 *
 * A notification is a SEPARATE, deliberate act from saving an event. Nothing in this folder runs from Save, Undo, sync or start-up: a message
 * is created only when the owner presses the one Send button, and the Calendar event is the only authority for the schedule.
 *
 * Vocabulary kept apart on purpose (CS-0 section J.1):
 *   people involved       Contacts the event is ABOUT (`contactIds`).
 *   notification recipient People the owner chooses to email, for one notification at a time.
 *   calendar invitee       A future idea (invitations, RSVP). NOT built here.
 */
import type { Recurrence } from '../../../core/recurrence';

export type NoticeKind =
  /** A new event. */
  | 'created'
  /** A meaningful change to an existing event. */
  | 'updated'
  /** The event, an occurrence, or the rest of a series was cancelled. */
  | 'cancelled'
  /** A correction after the owner pressed Undo on a cancellation that people were already told about. */
  | 'restored'
  /** "Here are the current details", started by the owner from the event itself (no change involved). */
  | 'details';

/** Which part of the event a notice is about. `single` is an event that does not repeat. */
export type NoticeScope = 'single' | 'one' | 'following' | 'all';

/** What changed in an update. Notes, tags, priority, reminders, project and calendar are NOT in this list on purpose: they are not meaningful to other people. */
export type ChangeKind = 'title' | 'date' | 'time' | 'allDay' | 'location' | 'recurrence' | 'people';

/**
 * Everything the message is ever allowed to say about an event. There is deliberately no field for notes, tags, priority, reminders, project,
 * amounts or other events: a message cannot contain what this shape cannot hold.
 */
export interface EventFacts {
  title: string;
  allDay: boolean;
  /** Local first and last day of the affected occurrence (or of the first occurrence, for a whole series). */
  firstDay: string;
  lastDay: string;
  /** Timed items: absolute start and end (ms). Shown in the device's own time zone. */
  startMs: number;
  endMs: number;
  location: string;
  /** Names of the people involved (their Contact names). Shown only when the owner leaves "mention who it involves" on. */
  people: string[];
  recurrence: Recurrence | null;
  /** The date the whole series starts on (local). */
  seriesStart: string;
}

/** The facts of one notification: what happened, to which part of the event, and what it looked like before and after. */
export interface NoticeSubject {
  kind: NoticeKind;
  scope: NoticeScope;
  /** The event as it is after the change (for a cancellation, as it was before it). */
  facts: EventFacts;
  /** The affected occurrence as it was before an update. */
  before?: EventFacts;
  changes: ChangeKind[];
  /** The occurrence date the scope refers to ("this one", "from this date on"). Empty for `single` and `all`. */
  affectedDate: string;
  /** Every event id this notice concerns. After "this and following" Ledger makes a new event, so this holds the old id and the new one. */
  eventIds: number[];
  /** The event whose stored data the message describes (for the stale check). For a split this is the NEW event. */
  factsEventId: number;
}

export interface MessageOptions {
  includeLocation: boolean;
  includePeople: boolean;
  /** One short note typed by the owner. Never required. */
  personalMessage: string;
  senderName: string;
  /** Where replies should go; empty means none is set. */
  replyTo: string;
  /** The device's time zone as words ("Eastern Standard Time"). Passed in so tests do not depend on the machine. */
  zoneLabel: string;
  /** Today (local date): a year is shown only when it differs from this year. */
  today: string;
}

export interface BuiltMessage {
  subject: string;
  text: string;
}

/** Plain-words classes for a message that was not sent. Never a raw provider error. */
export type ReasonClass = 'address-rejected' | 'service-refused' | 'quota' | 'unauthorized' | 'stale' | 'not-received' | 'unknown';

/**
 * The seven things a message can be (CS-0 J.8, simplified). "Accepted" is the strongest claim: the mail service took the message. Ledger can never
 * know it reached an inbox or was read.
 *  - declined   the owner chose Not now (recorded, final, sends nothing)
 *  - drafted    the composer is open (screen only: never stored, so abandoned drafts leave nothing behind)
 *  - confirmed  the owner pressed Send and the exact text is on record; not yet handed to a sender
 *  - queued     handed to the outbox; the sender has not reported back
 *  - accepted   the mail service accepted it
 *  - failed     definitely not sent (a reason is recorded)
 *  - unknown    Ledger cannot tell (a lost reply); retrying could send a second copy
 */
export type NoticeState = 'declined' | 'drafted' | 'confirmed' | 'queued' | 'accepted' | 'failed' | 'unknown';
