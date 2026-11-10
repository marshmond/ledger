import { liveQuery } from 'dexie';
import { db } from '../../db';
import type { QuickAddDef } from '../../core/registry';
import { createStore } from '../../core/store';
import { nameKey } from '../../core/contacts';
import { addDays, dayOfWeek, endOfMonth, lastBusinessDay, monthOf, nextMonth } from '../../lib/dates';
import { formatCents, parseAmountToCents, todayISO } from '../../lib/money';
import { dayLabel } from '../../core/time';
import { loadHideAmounts } from '../../core/hideAmounts';
import { createObligation } from './data';
import { blankObligation, defaultNeed, guessType, normalizeObligation, validateObligation, type How, type ObligationData } from './model';
import { describeSchedule, nextExpected, type Schedule } from './schedule';
import { firstDayOnOrAfter } from './scheduleDraft';
import { runUndo } from './undo';
import { tidy } from './util';

export interface BillQuick {
  data: ObligationData;
  providerName: string;
  /** Display only: a Contact with that name exists. It never links anything. */
  providerExists: boolean;
  /** Set when the line could not be understood or is not valid; the preview shows it and Add is refused. */
  problem: string | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, six: 6, other: 2 };

/**
 * Pure. `bs Streamly 15.49 monthly 12th autopay`, `bs Example Power varies monthly 18th`, `bs Home insurance 1200 yearly 15 mar`.
 * The words after the LAST " with " are the provider. Recognised words: an amount ("15.49", "$15.49"), "varies"/"variable", "unknown amount",
 * "autopay" or "manual", how often (weekly, every 2 weeks, fortnightly, monthly, every N months, quarterly, yearly), a day ("12th",
 * "last day", "last business day"), a date ("15 mar") or a weekday ("fri"). Everything else is the name. An unclear line is shown with a
 * plain problem and refused when Add is pressed: nothing is guessed silently. Twice-a-month schedules need the form.
 */
export function parseBillQuick(text: string, today: string, contacts: string[], plain = false): BillQuick | null {
  const whole = tidy(text);
  if (!whole || whole.length > 200) return null;
  let rest = whole;
  let providerName = '';
  const at = plain ? -1 : rest.toLowerCase().lastIndexOf(' with ');
  if (at > 0 && tidy(rest.slice(at + 6))) { providerName = tidy(rest.slice(at + 6)); rest = tidy(rest.slice(0, at)); }

  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(rest);
    if (m) rest = tidy(`${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`);
    return m;
  };
  let problem: string | null = null;
  let how: How = 'unknown';
  let variable = false;
  let unknownAmount = false;
  let weeks = 0, months = 0, day: number | null = null, month: number | null = null, weekday: number | null = null;
  let lastKind: 'lastDay' | 'lastBusinessDay' | null = null;

  if (!plain) {
    if (take(/\b(autopay|auto-pay|automatic|automatically)\b/i)) how = 'auto';
    else if (take(/\b(manual|manually|by hand)\b/i)) how = 'manual';
    if (take(/\b(varies|variable)\b/i)) variable = true;
    if (take(/\bunknown\s+amount\b/i)) unknownAmount = true;
    if (take(/\b(twice\s+(a\s+)?month(ly)?|semi-?monthly)\b/i)) problem = 'Twice-a-month bills need the form (two set days a month). Use Add on the Bills page.';
    let m = take(/\bevery\s+(\d+|other|two|three|four|six)\s+(week|month)s?\b/i);
    if (m) { const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()]; if (m[2].toLowerCase() === 'week') weeks = n; else months = n; }
    else if (take(/\b(fortnightly|bi-?weekly)\b/i)) weeks = 2;
    else if ((m = take(/\b(every|each)\s+(week|month|year)\b/i))) { const u = m[2].toLowerCase(); if (u === 'week') weeks = 1; else if (u === 'month') months = 1; else months = 12; }
    else if (take(/\bweekly\b/i)) weeks = 1;
    else if (take(/\bmonthly\b/i)) months = 1;
    else if (take(/\b(quarterly)\b/i)) months = 3;
    else if (take(/\b(yearly|annually|annual)\b/i)) months = 12;
    if (take(/\blast\s+business\s+day\b/i)) lastKind = 'lastBusinessDay';
    else if (take(/\blast\s+day\b/i)) lastKind = 'lastDay';
    // a date: "15 mar" / "mar 15" / "15th"
    m = take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')})[a-z]*\\b`, 'i'));
    if (m) { day = Number(m[1]); month = MONTHS.indexOf(m[2].toLowerCase()) + 1; }
    else if ((m = take(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i')))) { month = MONTHS.indexOf(m[1].toLowerCase()) + 1; day = Number(m[2]); }
    else if ((m = take(/\b(\d{1,2})(?:st|nd|rd|th)\b/i))) day = Number(m[1]);
    if ((m = take(new RegExp(`\\b(${WEEKDAYS.join('|')})[a-z]*\\b`, 'i')))) weekday = WEEKDAYS.indexOf(m[1].toLowerCase());
  }
  // the amount: the first number left over
  let cents: number | null = null;
  if (!plain) {
    const m = take(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\b(\d[\d,]*(?:\.\d{1,2})?)\b/);
    if (m) cents = parseAmountToCents(m[1] ?? m[2]);
  }
  const title = tidy(rest.replace(/^(on|the|at|of|for)\s+|\s+(on|the|at|of|for)$/gi, ''));

  let schedule: Schedule | null = null;
  if (!plain) {
    if (weeks) {
      const first = weekday === null ? today : addDays(today, (weekday - dayOfWeek(today) + 7) % 7);
      schedule = { kind: 'weeks', every: weeks, weekday: dayOfWeek(first), anchorDate: first };
    } else if (months) {
      if (lastKind) {
        const thisMonth = monthOf(today);
        const date = (m: string) => (lastKind === 'lastDay' ? endOfMonth(m) : lastBusinessDay(m));
        schedule = { kind: 'months', every: months, slot: { kind: lastKind }, anchorMonth: date(thisMonth) >= today ? thisMonth : nextMonth(thisMonth) };
      } else {
        let first: string;
        if (day !== null && month !== null) {
          const mm = String(month).padStart(2, '0');
          const [y] = today.split('-').map(Number);
          const inYear = (yy: number) => `${yy}-${mm}-${String(Math.min(day!, new Date(Date.UTC(yy, month!, 0)).getUTCDate())).padStart(2, '0')}`;
          first = inYear(y) >= today ? inYear(y) : inYear(y + 1);
        } else first = firstDayOnOrAfter(today, day ?? Number(today.slice(8, 10)), 1);
        schedule = { kind: 'months', every: months, slot: { kind: 'day', day: Number(first.slice(8, 10)), adjust: 'none' }, anchorMonth: monthOf(first) };
      }
    }
  }

  const type = guessType(title);
  const amountKind = variable ? 'variable' : unknownAmount ? 'unknown' : cents !== null ? 'fixed' : 'unknown';
  const data = blankObligation({
    title, type, need: defaultNeed(type), amountKind,
    prices: amountKind !== 'unknown' && cents !== null ? [{ from: today, cents, label: '' }] : [],
    schedule, trackingSince: today, payment: { how, fundingAccountId: null }, providerNameSnapshot: providerName,
  }, today);
  if (!problem && !title) problem = 'Say what it is, for example "Streamly 15.49 monthly 12th autopay".';
  if (!problem && !plain && !schedule) problem = 'Say how often: monthly, weekly, every 2 weeks, every 3 months, yearly …';
  if (!problem && day !== null && (day < 1 || day > 31)) problem = 'That day of the month is not valid.';
  if (!problem) problem = validateObligation(normalizeObligation(data));
  return { data, providerName, providerExists: !!providerName && contacts.some((c) => nameKey(c) === nameKey(providerName)), problem };
}

let known: string[] = [];
let opCounter = 0;
/** Shows a refusal where a toast is not available (Quick Add's Undo runs outside the toast system). */
const say = (text: string) => { if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(text); };

const amountWords = (d: ObligationData, hide: boolean) => {
  const c = d.prices[0]?.cents ?? null;
  const money = c === null ? '' : hide ? '$••••' : formatCents(c);
  return d.amountKind === 'variable' ? (money ? `varies, about ${money}` : 'amount varies') : d.amountKind === 'fixed' && money ? money : 'amount not known';
};

/**
 * The Add box's Bills & Subscriptions destination. Shows what was understood; nothing is saved until Add is pressed.
 * U2: Quick Add never creates, finds or links a Contact (there is no moment to choose one or to confirm a same-name Contact). The provider name is kept only as the bill's
 * provider-name snapshot; the owner can link the right Contact afterwards in Edit.
 */
export const billQuickAdd: QuickAddDef = {
  id: 'bills-obligation',
  label: 'Bill or subscription',
  prefix: 'bs',
  aliases: ['subscription', 'sub'],
  start() {
    const sub = liveQuery(() => createStore(db).shared.contacts.query()).subscribe({ next: (v) => { known = v.map((c) => c.name); }, error: () => undefined });
    return () => sub.unsubscribe();
  },
  parse(text, opts) {
    const today = todayISO();
    const p = parseBillQuick(text, today, known, opts?.plain);
    if (!p) return null;
    const hide = (() => { try { return loadHideAmounts(); } catch { return false; } })();
    const d = p.data;
    const next = d.schedule ? nextExpected({ schedule: d.schedule, scheduleHistory: [], trackingSince: today, pauses: [], status: 'active', endedOn: null }, today, 3) : [];
    const fields = [
      { label: 'Name', value: d.title || 'Missing' },
      { label: 'Amount', value: amountWords(d, hide) },
      { label: 'How often', value: describeSchedule(d.schedule) },
      ...(next.length ? [{ label: 'Next dates', value: next.map((e) => dayLabel(e.nominal, { weekday: 'short', year: true })).join(', ') }] : []),
      { label: 'Paid', value: d.payment.how === 'auto' ? 'Automatically' : d.payment.how === 'manual' ? 'By hand' : 'Not stated' },
      ...(p.providerName ? [{ label: 'Provider', value: `${p.providerName} (saved as a name only, no contact linked${p.providerExists ? '; a contact with this name exists, link the right one afterwards' : ''})` }] : []),
      ...(p.problem ? [{ label: 'Problem', value: p.problem }] : []),
    ];
    return { summary: `${d.title || '?'}, ${amountWords(d, hide)}, ${describeSchedule(d.schedule).toLowerCase()}. Expected dates only: nothing is paid or created in Finance`, fields, payload: { p, operationId: `qa-${Date.now().toString(36)}-${++opCounter}` } };
  },
  async commit(preview) {
    const { p } = preview.payload as { p: BillQuick; operationId: string };
    if (p.problem) throw new Error(p.problem);
    // U2: Quick Add never creates, finds or links a Contact; the provider name stays in data.providerNameSnapshot (words, not an identity)
    const r = await createObligation({ data: p.data, provider: null });
    return async () => { await runUndo(r.undo, say, db); };
  },
};
