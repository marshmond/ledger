import { liveQuery } from 'dexie';
import { db } from '../../db';
import type { QuickAddDef } from '../../core/registry';
import { createStore } from '../../core/store';
import { nameKey } from '../../core/contacts';
import { dayOfWeek } from '../../lib/dates';
import { todayISO } from '../../lib/money';
import { dayLabel } from '../../core/time';
import { parseQuickAdd } from '../tasks/quickAdd';
import { applyUndo, type Undo } from './changes';
import { createArrangement } from './data';
import { blankArrangement, cadenceText, normalizeArrangement, tidy, validateArrangement, type ArrangementData } from './model';

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

let known: string[] = [];

/** The Add box's Household Services destination. Shows what was understood; nothing is saved until Add is pressed. */
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
    const p = parseServiceQuick(text, todayISO(), known, opts?.plain);
    if (!p) return null;
    const c = p.data.cadence;
    const fields = [
      { label: 'Service', value: p.data.title },
      { label: 'Provider', value: p.providerName ? `${p.providerName} (${p.providerExists ? 'existing contact' : 'new contact'})` : 'None yet' },
      { label: 'How often', value: cadenceText(c) },
      ...(p.firstDate ? [{ label: 'First visit', value: `${dayLabel(p.firstDate, { weekday: 'short', year: true })}${p.data.visitTime ? ` at ${p.data.visitTime}` : ''}` }] : []),
    ];
    return { summary: `${p.data.title}${p.providerName ? ` with ${p.providerName}` : ''}, ${cadenceText(c)}${c ? '. A visit task is created' : ''}`, fields, payload: p };
  },
  async commit(preview) {
    const p = preview.payload as ServiceQuick;
    const r = await createArrangement({ data: p.data, provider: p.providerName ? { name: p.providerName } : null, today: todayISO() });
    const undo: Undo = { arrangements: [], tasks: [], created: [r.id, ...(r.taskId !== null ? [r.taskId] : [])] };
    return async () => {
      await applyUndo(undo);
      // A contact made just for this is removed again only if nothing else uses it.
      if (r.contactCreated && r.contactId !== null) {
        const used = (await db.moduleRecords.where('module').equals('services').toArray()).some((x) => x.deletedAt == null && (x.data as { providerContactId?: number }).providerContactId === r.contactId);
        if (!used) await createStore(db).shared.contacts.remove(r.contactId);
      }
    };
  },
};
