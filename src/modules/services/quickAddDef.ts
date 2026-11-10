import { liveQuery } from 'dexie';
import { db } from '../../db';
import type { QuickAddDef } from '../../core/registry';
import { createStore } from '../../core/store';
import { nameKey } from '../../core/contacts';
import { addDays, dayOfWeek } from '../../lib/dates';
import { formatCents, parseAmountToCents, todayISO } from '../../lib/money';
import { dayLabel } from '../../core/time';
import { parseQuickAdd } from '../tasks/quickAdd';
import { runUndo } from './undo';
import { createArrangement } from './data';
import { logStandaloneVisit } from './visits';
import { blankArrangement, cadenceText, isDate, normalizeArrangement, tidy, validateArrangement, type ArrangementData } from './model';

/** `providerExists` is display only (a Contact with that name exists); it never links anything. */
export interface ServiceQuick { data: ArrangementData; providerName: string; providerExists: boolean; firstDate: string | null }

/**
 * Pure. `hs House cleaning with Rosa's Cleaning every other Friday at 9am`. The words after the LAST " with " (once any date, time or
 * repeat words are read) are the provider; everything before is what they do. Without "with" there is no provider yet.
 * Repeat, date and time use the Tasks shorthand. `plain` turns the shorthand off: the whole text is the title.
 */
export function parseServiceQuick(text: string, today: string, contacts: string[], plain = false): ServiceQuick | null {
  const whole = tidy(text);
  if (!whole || whole.length > 200) return null;
  const p = plain ? { title: whole, repeat: undefined, dueDate: undefined, dueTime: undefined } : parseQuickAdd(whole, today);
  let title = tidy(p.title);
  let provider = '';
  const at = plain ? -1 : title.toLowerCase().lastIndexOf(' with ');
  if (at > 0 && tidy(title.slice(at + 6))) { provider = tidy(title.slice(at + 6)); title = tidy(title.slice(0, at)); }
  const first = p.repeat ? p.dueDate ?? today : null;
  const cadence = p.repeat && first
    ? { mode: p.repeat.mode, rule: { ...p.repeat.rule, ...(p.repeat.rule.freq === 'weekly' && !p.repeat.rule.byWeekday?.length ? { byWeekday: [dayOfWeek(first)] } : {}) }, anchorDate: first }
    : null;
  const data = normalizeArrangement(blankArrangement({ title, providerNameSnapshot: provider, cadence, visitTime: cadence && p.dueTime ? p.dueTime : null }));
  if (validateArrangement(data)) return null;
  return { data, providerName: provider, providerExists: !!provider && contacts.some((c) => nameKey(c) === nameKey(provider)), firstDate: first };
}

let opCounter = 0;
export interface OneOffQuick { title: string; providerName: string; providerExists: boolean; date: string; chargedCents: number | null; problem: string | null }

/**
 * Pure. `hs visit mowed the lawn with Maple Lawn Care yesterday $85` is a one-off completed visit: the words after the last " with " are the
 * provider, "yesterday" or a date word sets the day (default today), and "$85" is the amount charged (information only). Only used when the text
 * starts with the word "visit" and has no repeat; otherwise the text is an arrangement as before. A missing provider or a future date is
 * shown in the preview and refused when Add is pressed, so nothing is half-understood silently.
 */
export function parseOneOffQuick(text: string, today: string, contacts: string[]): OneOffQuick | null {
  const m = /^visit\s+(.+)$/i.exec(tidy(text));
  if (!m) return null;
  let rest = m[1];
  let chargedCents: number | null = null;
  const money = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/.exec(rest);
  if (money) { chargedCents = parseAmountToCents(money[1]); rest = tidy(rest.replace(money[0], ' ')); }
  let date: string | null = null;
  if (/\byesterday\b/i.test(rest)) { date = addDays(today, -1); rest = tidy(rest.replace(/\byesterday\b/i, ' ')); }
  const p = parseQuickAdd(rest, today);
  if (p.repeat) return null;
  let title = tidy(p.title);
  let provider = '';
  const at = title.toLowerCase().lastIndexOf(' with ');
  if (at > 0 && tidy(title.slice(at + 6))) { provider = tidy(title.slice(at + 6)); title = tidy(title.slice(0, at)); }
  const day = date ?? p.dueDate ?? today;
  const problem = !title ? 'Say what was done.' : !provider ? 'Add the provider after the word "with", for example "with Maple Lawn Care".' : !isDate(day) ? 'That date is not a real date.' : day > today ? 'A visit that already happened cannot be dated in the future.' : null;
  return { title, providerName: provider, providerExists: !!provider && contacts.some((c) => nameKey(c) === nameKey(provider)), date: day, chargedCents, problem };
}

let known: string[] = [];

/** The preview line for a provider typed into Quick Add. `exists` only says a Contact with that name is in your contacts; it is NOT linked (U2). */
const providerNote = (name: string, exists: boolean) => `${name} (saved as a name only, no contact linked${exists ? '; a contact with this name exists, link the right one afterwards' : ''})`;

/** Shows a refusal where a toast is not available (Quick Add's Undo runs outside the toast system). */
const say = (text: string) => { if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(text); };

/**
 * The Add box's Household Services destination. Shows what was understood; nothing is saved until Add is pressed.
 * U2: Quick Add NEVER creates, finds or links a Contact. The owner has no chance here to pick one or to confirm a same-name Contact, so the provider name is
 * kept only as the record's provider-name snapshot (words, not an identity). The owner can link the right Contact afterwards on the arrangement or visit page.
 */
export const serviceQuickAdd: QuickAddDef = {
  id: 'household-service',
  label: 'Household service',
  prefix: 'hs',
  aliases: ['household'],
  start() {
    const sub = liveQuery(() => createStore(db).shared.contacts.query()).subscribe({ next: (v) => { known = v.map((c) => c.name); }, error: () => undefined });
    return () => sub.unsubscribe();
  },
  parse(text, opts) {
    const one = opts?.plain ? null : parseOneOffQuick(text, todayISO(), known);
    if (one) {
      const fields = [
        { label: 'One-off visit', value: one.title || 'Missing' },
        { label: 'Provider', value: one.providerName ? providerNote(one.providerName, one.providerExists) : 'Missing' },
        { label: 'Date', value: dayLabel(one.date, { weekday: 'short', year: true }) },
        ...(one.chargedCents !== null ? [{ label: 'Charged', value: `${formatCents(one.chargedCents)} (information only, not a payment)` }] : []),
        ...(one.problem ? [{ label: 'Problem', value: one.problem }] : []),
      ];
      return { summary: `One-off visit: ${one.title || '?'}${one.providerName ? ` with ${one.providerName}` : ''}. No arrangement or task is created`, fields, payload: { kind: 'visit', one, operationId: `qa-${Date.now().toString(36)}-${++opCounter}` } };
    }
    const p = parseServiceQuick(text, todayISO(), known, opts?.plain);
    if (!p) return null;
    const c = p.data.cadence;
    const fields = [
      { label: 'Service', value: p.data.title },
      { label: 'Provider', value: p.providerName ? providerNote(p.providerName, p.providerExists) : 'None yet' },
      { label: 'How often', value: cadenceText(c) },
      ...(p.firstDate ? [{ label: 'First visit', value: `${dayLabel(p.firstDate, { weekday: 'short', year: true })}${p.data.visitTime ? ` at ${p.data.visitTime}` : ''}` }] : []),
    ];
    return { summary: `${p.data.title}${p.providerName ? ` with ${p.providerName}` : ''}, ${cadenceText(c)}${c ? '. A visit task is created' : ''}`, fields, payload: p };
  },
  async commit(preview) {
    const pl = preview.payload as ServiceQuick | { kind: 'visit'; one: OneOffQuick; operationId: string };
    if ('kind' in pl) {
      const o = pl.one;
      if (o.problem) throw new Error(o.problem);
      const v = await logStandaloneVisit({
        providerNameOnly: o.providerName, today: todayISO(), operationId: pl.operationId,
        input: { title: o.title, status: 'completed', cancelledBy: null, date: o.date, chargedCents: o.chargedCents, chargeKind: o.chargedCents === null ? null : 'service' },
      });
      if (v.repeated) return undefined;
      // refused (with a plain message) if the visit was changed since; the new contact is removed only if untouched and unused
      return async () => { await runUndo(v.undo, say, db, { dropCreatedContact: true }); };
    }
    const p = pl;
    const r = await createArrangement({ data: p.data, provider: null, today: todayISO() }); // the name stays in data.providerNameSnapshot; no Contact is made or linked
    return async () => { await runUndo(r.undo, say, db, { dropCreatedContact: true }); };
  },
};
