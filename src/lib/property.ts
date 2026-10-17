import type { Property, PropertyValue } from '../types';

/** Property values are whatever you entered, dated. The current value is the latest one on or before the date asked for. */

export function latestValue(values: PropertyValue[], propertyId: number, asOf?: string): { valueCents: number; date: string } | null {
  const mine = values.filter((v) => v.propertyId === propertyId && (!asOf || v.date <= asOf)).sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0));
  return mine[0] ? { valueCents: mine[0].valueCents, date: mine[0].date } : null;
}

export function propertyTotal(props: Property[], values: PropertyValue[], asOf?: string): number {
  return props.filter((p) => !p.excluded).reduce((s, p) => s + (latestValue(values, p.id!, asOf)?.valueCents ?? 0), 0);
}

/** Value less what is still owed on the loans secured by it. Null when there is no value yet. */
export function equityOf(p: Property, values: PropertyValue[], owedByLoanId: Map<number, number>, asOf?: string): { valueCents: number; owedCents: number; equityCents: number } | null {
  const v = latestValue(values, p.id!, asOf);
  if (!v) return null;
  const owed = p.loanIds.reduce((s, id) => s + (owedByLoanId.get(id) ?? 0), 0);
  return { valueCents: v.valueCents, owedCents: owed, equityCents: v.valueCents - owed };
}

/** How old the latest value is, in days (null if none). Used to nudge you to update it. */
export function valueAgeDays(values: PropertyValue[], propertyId: number, today: string): number | null {
  const v = latestValue(values, propertyId);
  return v ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(v.date + 'T00:00:00Z')) / 86400000) : null;
}
