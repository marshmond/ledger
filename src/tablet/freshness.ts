/** How old the last successful check is, in the five states of the design (I.3). Pure. */
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const RETENTION_CHOICES = [{ id: '24h', ms: 24 * HOUR, label: '24 hours' }, { id: '3d', ms: 72 * HOUR, label: '3 days' }, { id: '7d', ms: 168 * HOUR, label: '7 days' }] as const;
export const DEFAULT_RETENTION_MS = 72 * HOUR;
export const POLL_MS = 3 * MINUTE;
/** Authorization failures this long in a row are treated as "revoked or expired" (design I.4). */
export const REVOKED_AFTER_MS = 10 * MINUTE;

export type FreshnessState = 'never' | 'recent' | 'delayed' | 'stale' | 'extended-outage' | 'expired';
export interface Freshness { state: FreshnessState; ageMs: number | null; label: string }

export function freshnessOf(lastSuccessAt: number | null, nowMs: number, retentionMs: number): Freshness {
  if (lastSuccessAt === null) return { state: 'never', ageMs: null, label: 'Never checked' };
  const ageMs = Math.max(0, nowMs - lastSuccessAt);
  if (ageMs >= retentionMs) return { state: 'expired', ageMs, label: 'Saved copy expired' };
  if (ageMs < 15 * MINUTE) return { state: 'recent', ageMs, label: 'Recent successful check' };
  if (ageMs < 2 * HOUR) return { state: 'delayed', ageMs, label: 'Check delayed' };
  if (ageMs < 24 * HOUR) return { state: 'stale', ageMs, label: 'Stale connection' };
  return { state: 'extended-outage', ageMs, label: 'Extended outage' };
}

/** Back-off after a network or server failure: 3, 6, 12, then 30 minutes. */
export const backoffMs = (failures: number) => [3, 6, 12, 30][Math.min(Math.max(failures, 1), 4) - 1] * MINUTE;

export function ageText(ms: number | null): string {
  if (ms === null) return '—';
  const m = Math.floor(ms / MINUTE);
  if (m < 1) return 'less than a minute ago';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.floor(h / 24)} days ago`;
}
