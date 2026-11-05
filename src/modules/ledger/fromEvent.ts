/**
 * Turning a Calendar event into a Ledger scheduled item (the pure part: no screens, no database).
 * Ledger knows six frequencies; the Calendar can say much more. This maps what fits and says so plainly when it does not.
 */
import type { EventSeed } from '../../core/registry';
import type { Frequency } from '../../types';

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};
export const FREQUENCIES = Object.keys(FREQUENCY_LABEL) as Frequency[];

export interface RepeatMatch {
  /** The matching frequency, or null when the event's repeat is not one of the six. */
  frequency: Frequency | null;
  /** Shown to the owner. Empty when it matched cleanly. */
  note: string;
  /** Last date, when the event's repeat ended (or the event does not repeat: the rule then ends after its one date). */
  endDate: string | null;
}

export function matchRepeat(seed: EventSeed): RepeatMatch {
  const r = seed.repeat;
  if (!r) return { frequency: 'monthly', note: 'This event does not repeat, so the Ledger item will happen once (it ends after this date). You can change that.', endDate: seed.date };
  const endDate = r.endDate ?? null;
  const none = (why: string): RepeatMatch => ({ frequency: null, note: `This event's repeat (${r.plain}) does not match one of Ledger's six options (${why}). Please pick the closest one.`, endDate });
  if (r.complex) return none('weekly, every 2 weeks, twice a month, monthly, quarterly, yearly');
  const hit = (frequency: Frequency): RepeatMatch => ({ frequency, note: '', endDate });
  if (r.unit === 'week' && r.every === 1) return hit('weekly');
  if (r.unit === 'week' && r.every === 2) return hit('biweekly');
  if (r.unit === 'month' && r.every === 1) return hit('monthly');
  if (r.unit === 'month' && r.every === 3) return hit('quarterly');
  if (r.unit === 'year' && r.every === 1) return hit('yearly');
  if (r.unit === 'month' && r.every === 12) return hit('yearly');
  return none('weekly, every 2 weeks, twice a month, monthly, quarterly, yearly');
}
