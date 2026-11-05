/**
 * Event types. A type is only a label plus a few sensible starting values; it never locks anything. Choosing one fills in the
 * defaults below (you can change every one of them), and a few types unlock extras:
 *  - `bill`: can be handed to Ledger as a scheduled item (see handoff.ts and the module registry's `createFromEvent`),
 *  - `finance`: card due days, subscription renewals, tax reminders and similar dates Ledger does not store. They stay Calendar events.
 *  - `birthday`: a yearly all-day event about a shared contact.
 */
import type { EventSeed } from '../../core/registry';
import type { Priority } from '../../core/entities';
import { addDays } from '../../lib/dates';
import { generateDates, describeRule, type Recurrence } from './recurrence';

export interface EventTypeDef { id: string; label: string; hint: string }
export const EVENT_TYPES: EventTypeDef[] = [
  { id: '', label: 'Event', hint: '' },
  { id: 'bill', label: 'Bill / scheduled payment', hint: 'A payment that happens on a schedule. Once you know the account and amount you can hand it to Ledger, which then owns it.' },
  { id: 'finance', label: 'Finance date', hint: 'Card statement or due days, subscription renewals, tax-prep reminders: dates Ledger does not store. They stay here as calendar events.' },
  { id: 'birthday', label: 'Birthday', hint: 'A yearly all-day event. Add the person under People to link it to their contact.' },
];
export const typeLabel = (id: string | undefined) => EVENT_TYPES.find((t) => t.id === (id ?? ''))?.label ?? '';

export const FINANCE_TAG = 'Finance';

export interface TypeDefaults {
  priority: Priority;
  reminders: number[];
  trackDone: boolean;
  /** Force all-day. */
  allDay?: boolean;
  /** Repeat to start with, only when the event has none yet. */
  repeat?: Recurrence;
  /** Shared tag to add (created if missing). */
  tag?: string;
}
const monthly: Recurrence = { freq: 'monthly', interval: 1, monthly: 'date', end: { type: 'never' } };
const yearly: Recurrence = { freq: 'yearly', interval: 1, end: { type: 'never' } };

export const TYPE_DEFAULTS: Record<string, TypeDefaults> = {
  bill: { priority: 'medium', reminders: [1440], trackDone: true, allDay: true, repeat: monthly, tag: FINANCE_TAG },
  finance: { priority: 'medium', reminders: [1440], trackDone: true, allDay: true, tag: FINANCE_TAG },
  birthday: { priority: 'low', reminders: [1440], trackDone: false, allDay: true, repeat: yearly },
};

/** "Start from…" choices under the Finance type. Each only fills in a name and a repeat; the date is yours. */
export interface FinancePreset { id: string; label: string; title: string; repeat: Recurrence }
export const FINANCE_PRESETS: FinancePreset[] = [
  { id: 'card-due', label: 'Credit card payment due', title: 'Card payment due', repeat: monthly },
  { id: 'card-statement', label: 'Credit card statement closes', title: 'Card statement closes', repeat: monthly },
  { id: 'renewal', label: 'Subscription renewal', title: 'Subscription renews', repeat: yearly },
  { id: 'tax-prep', label: 'Tax preparation reminder', title: 'Gather tax documents', repeat: yearly },
];

/** What the editor changes when a type is chosen. Returns only the fields to set; the caller applies them. */
export function defaultsFor(type: string, hasRepeat: boolean): { priority: Priority; reminders: number[]; trackDone: boolean; allDay?: boolean; repeat?: Recurrence | null; tag?: string } | null {
  const d = TYPE_DEFAULTS[type];
  if (!d) return null;
  return { priority: d.priority, reminders: d.reminders, trackDone: d.trackDone, allDay: d.allDay, repeat: hasRepeat ? undefined : d.repeat, tag: d.tag };
}

/** The title for a birthday about a named person. */
export const birthdayTitle = (name: string) => `${name}'s birthday`;

/**
 * Everything a module needs to know to take over an event, in plain terms. For a repeating event the date is its next occurrence on or
 * after `today`, so a bill started long ago does not leave a pile of overdue items in the other module.
 */
export function buildSeed(f: { title: string; startDate: string; notes: string }, rule: Recurrence | null, today: string, hasExceptions: boolean): EventSeed {
  if (!rule) return { title: f.title, date: f.startDate, notes: f.notes, repeat: null, hasExceptions };
  const start = f.startDate;
  const next = generateDates(start, rule, start > today ? start : today, addDays(start > today ? start : today, 800))[0] ?? start;
  let endDate: string | undefined;
  if (rule.end.type === 'until') endDate = rule.end.date;
  else if (rule.end.type === 'count') endDate = generateDates(start, rule, start, addDays(start, 36500)).pop();
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq] as 'day' | 'week' | 'month' | 'year';
  const complex = (rule.freq === 'weekly' && (rule.byWeekday?.length ?? 0) > 1) || (rule.freq === 'monthly' && (rule.monthly ?? 'date') !== 'date');
  return {
    title: f.title, date: next, notes: f.notes, hasExceptions,
    repeat: { unit, every: rule.interval, complex, plain: describeRule(rule, start), ...(endDate ? { endDate } : {}) },
  };
}
