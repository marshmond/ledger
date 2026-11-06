import { liveQuery } from 'dexie';
import type { QuickAddDef } from '../../core/registry';
import { addDays } from '../../lib/dates';
import { formatCents, parseAmountToCents, todayISO } from '../../lib/money';
import { loadAssets, publicLabel } from './data';
import { isDate, nameKey, tidy, type AssetRecord } from './model';
import { blankService, SERVICE_KINDS, SERVICE_KIND_LABEL, type ServiceKind } from './service';
import { createService, removeNewService } from './serviceData';

let known: AssetRecord[] = [];

export interface ServiceQuick {
  title: string;
  kind: ServiceKind;
  date: string;
  costCents: number | null;
  assetId: number | null;
  where: string;
  /** Why it cannot be added yet (said in the preview). When set, adding is refused. */
  problem?: string;
}

const AMOUNT = /^\$?\d[\d,]*(?:\.\d{1,2})?$|^\$?\.\d{1,2}$/;
const dateWord = (w: string, today: string): string | null => {
  const l = w.toLowerCase();
  if (l === 'today') return today;
  if (l === 'yesterday') return addDays(today, -1);
  return isDate(w) ? w : null;
};

/**
 * Pure. `Replaced pump on Dishwasher $180 yesterday`:
 *  - the words after the LAST " on " are the asset's exact name (case, accents and spaces ignored) with, at the end, an optional amount
 *    ($180, 180, 1,200.50) and an optional date (today, yesterday or 2026-11-05), in either order;
 *  - the words before it say what was done. The kind is "Other" unless that text starts with the kind word itself ("Repair ...").
 * Nothing is guessed: an unknown or duplicated asset name, a second amount, a future date or a missing description gives a `problem` that
 * the preview shows, and adding is refused. The date is today unless one is typed. A cost is only set when one is typed (blank is unknown).
 */
export function parseServiceQuick(text: string, assets: AssetRecord[], today: string = todayISO()): ServiceQuick | null {
  const whole = tidy(text);
  if (!whole) return null;
  const base: ServiceQuick = { title: '', kind: 'other', date: today, costCents: null, assetId: null, where: '' };
  const at = whole.toLowerCase().lastIndexOf(' on ');
  if (at < 1) return { ...base, title: whole, problem: 'Say what was done and which asset, like "Replaced pump on Dishwasher $180 yesterday".' };
  const head = tidy(whole.slice(0, at));
  const words = tidy(whole.slice(at + 4)).split(' ').filter(Boolean);
  const live = assets.filter((a) => !a.data.archived);
  const matchName = (ws: string[]) => (ws.length ? live.filter((a) => nameKey(a.data.name) === nameKey(ws.join(' '))) : []);

  // Peel an amount and a date off the end (in either order).
  let rest = [...words];
  let date: string | null = null, amountText: string | null = null, extraAmount = false;
  for (let i = 0; i < 2 && rest.length > 1; i++) {
    const w = rest[rest.length - 1];
    const dw = dateWord(w, today);
    if (dw && date === null) { date = dw; rest = rest.slice(0, -1); }
    else if (AMOUNT.test(w) && amountText === null) { amountText = w; rest = rest.slice(0, -1); }
    else break;
  }
  if (rest.length > 1 && AMOUNT.test(rest[rest.length - 1]) && amountText !== null) extraAmount = true;

  const full = matchName(words);
  const peeled = rest.length !== words.length ? matchName(rest) : [];
  const kindWord = head.split(' ')[0].toLowerCase();
  const kind = (SERVICE_KINDS as readonly string[]).includes(kindWord) ? (kindWord as ServiceKind) : 'other';
  const out: ServiceQuick = { ...base, title: head, kind };

  let hit: AssetRecord;
  if (full.length > 1 || peeled.length > 1) return { ...out, problem: `More than one asset is named "${(peeled.length > 1 ? rest : words).join(' ')}". Use the full form on the asset's page.` };
  if (full.length === 1 && peeled.length === 1) return { ...out, problem: `"${words.join(' ')}" and "${rest.join(' ')}" are both asset names, so it is unclear which you mean. Use the full form on the asset's page.` };
  if (full.length === 1) { hit = full[0]; date = null; amountText = null; } // the whole tail is a name, so nothing in it is an amount or a date
  else if (peeled.length === 1) hit = peeled[0];
  else if (extraAmount) return { ...out, problem: 'There is more than one amount. Type just one, like $180.' };
  else return { ...out, problem: `No asset is named "${rest.join(' ')}". Type its name exactly (an archived asset must be restored first).` };

  if (!head) return { ...out, problem: 'Say what was done before "on".' };
  if (head.length > 160) return { ...out, problem: 'That description is too long (160 characters at most).' };
  let costCents: number | null = null;
  if (amountText !== null) {
    costCents = parseAmountToCents(amountText);
    if (costCents === null || costCents < 0) return { ...out, problem: `"${amountText}" is not an amount I can read.` };
  }
  const when = date ?? today;
  if (when > today) return { ...out, assetId: hit.id, where: publicLabel(assets, hit.id), problem: 'That date is in the future. Service history records work already done.' };
  return { ...out, date: when, costCents, assetId: hit.id, where: publicLabel(assets, hit.id) };
}

/** The Add box's Service destination. Shows what it understood and refuses (with the reason) when anything is unclear. */
export const serviceQuickAdd: QuickAddDef = {
  id: 'service',
  label: 'Service',
  prefix: 'svc',
  aliases: ['service', 'repair'],
  start() {
    const sub = liveQuery(() => loadAssets()).subscribe({ next: (v) => { known = v; }, error: () => undefined });
    return () => sub.unsubscribe();
  },
  parse(text) {
    const p = parseServiceQuick(text, known);
    if (!p) return null;
    if (p.problem) {
      // The box says "Will add: <summary>", so the summary stays short and the reason is the pill below it.
      return { summary: 'nothing yet (see the note)', fields: [{ label: 'Note', value: p.problem }], payload: p };
    }
    return {
      summary: `${p.title}, on ${p.where}, ${p.date}${p.costCents !== null ? `, ${formatCents(p.costCents)}` : ''}`,
      fields: [
        { label: 'Work', value: p.title }, { label: 'Asset', value: p.where }, { label: 'Date', value: p.date }, { label: 'Kind', value: SERVICE_KIND_LABEL[p.kind] },
        { label: 'Cost', value: p.costCents !== null ? formatCents(p.costCents) : 'not recorded' },
      ],
      payload: p,
    };
  },
  async commit(preview) {
    const p = preview.payload as ServiceQuick;
    if (p.problem || p.assetId === null) throw new Error((p.problem ?? 'It is not clear which asset this is for').replace(/\.$/, ''));
    const id = await createService(blankService(p.assetId, { title: p.title, kind: p.kind, date: p.date, costCents: p.costCents }));
    return async () => { await removeNewService(id); };
  },
};
