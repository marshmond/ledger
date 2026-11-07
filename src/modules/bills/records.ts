import { db } from '../../db';
import type { RecordChoice, RecordSource } from '../../core/registry';
import { goTo } from '../../core/dueProvider';
import { getObligation, loadObligations } from './data';
import { obligationLabel, obligationRefId, parseObligationRef, isSubscriptionType } from './model';
import { obligationPath } from './paths';

/** Lets Tasks, Calendar events and others link to an obligation and show it by name. Ids are text: `obligation:<n>`. Labels: title, provider name and status only. */
export const billRecords: RecordSource = {
  async search(text) {
    const q = text.trim().toLowerCase();
    const rows = (await loadObligations(db)).filter((r) => !q || obligationLabel(r).toLowerCase().includes(q));
    rows.sort((a, b) => Number(a.data.status === 'ended') - Number(b.data.status === 'ended') || a.data.title.localeCompare(b.data.title));
    return rows.slice(0, 30).map<RecordChoice>((r) => ({ id: obligationRefId(r.id), label: obligationLabel(r), kind: isSubscriptionType(r.data.type) ? 'Subscription' : 'Bill' }));
  },
  async describe(id) {
    const n = parseObligationRef(id);
    const r = n === null ? undefined : await getObligation(n, db);
    return r ? { label: obligationLabel(r), kind: isSubscriptionType(r.data.type) ? 'Subscription' : 'Bill', path: obligationPath(r.id) } : null;
  },
  async openSource(id) {
    const info = await billRecords.describe(id);
    if (!info) return false;
    goTo(info.path);
    return true;
  },
};
