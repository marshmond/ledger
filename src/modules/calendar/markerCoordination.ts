/**
 * B3.1 CALENDAR COORDINATION: the same expected payment can be drawn by two layers (a Bills "Due" marker and the Finance Scheduled marker of a rule the
 * bill links). This is a DISPLAY decision, nothing more. It deletes no Calendar event, no Task, no billing-period fact and no Scheduled instruction,
 * changes no status and stores nothing (a test proves no table changes and no derived occurrence is saved).
 *
 * THE RULE. A Bills provider may mark its item `coveredBy` the id of another layer's item that stands for the very same occurrence (an explicit link to a
 * Finance rule, the same date, no unresolved drift: decided in `modules/bills/dueProvider.ts`, never by comparing titles or amounts). This filter then
 * leaves the covered item out ONLY WHILE the covering item is itself in the list it was given. So:
 *   - switching the Finance layer off (the Calendar's own visibility controls) puts the Bills marker back, because the covering item is no longer shown,
 *     and "Personal only" or "Deselect all" can never make both disappear;
 *   - the covering item is never the one hidden: a Finance Scheduled marker may be the owner's only route to approving a payment, so it always stays;
 *   - an item that is itself covered never covers another, and only an OPEN covering item counts.
 * Today applies it to everything (Today does not read layer visibility); the Calendar applies it after its visibility filter.
 *
 * F2 (Family birthdays): the covering item may also be a STORED Calendar event occurrence (a Birthday event the owner made for the same Contact). Such an
 * occurrence is named by `storedItemKey(eventId, occurrenceKey)` (the key the Calendar already gives it), and counts as covering while it is in the list and
 * not marked done. Nothing else about the rule changes: a stored event is never the covered item, and it is never hidden.
 */
interface Coordinated { key?: string; done?: boolean; occ?: unknown; source?: { id: string; status: string; coveredBy?: string } }

/** The list key the Calendar gives one occurrence of a STORED event. One definition, so the Calendar and a provider naming it in `coveredBy` cannot drift apart. */
export const storedItemKey = (eventId: number, occurrenceKey: string) => `e:${eventId}:${occurrenceKey}`;

export function dropCovered<T extends Coordinated>(items: T[]): T[] {
  const covering = new Set<string>();
  for (const i of items) {
    if (i.source) { if (i.source.status === 'open' && !i.source.coveredBy) covering.add(i.source.id); }
    else if (i.occ && i.key && !i.done) covering.add(i.key);
  }
  return items.filter((i) => !(i.source?.coveredBy && covering.has(i.source.coveredBy)));
}
