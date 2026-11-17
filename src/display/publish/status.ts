/**
 * CS-2: plain-words status for Settings > Family display. Pure: it only looks at the device's settings, its activity record and the list of
 * privacy decisions. It never claims more than was confirmed:
 *   - "Published" means GitHub confirmed a write. It does NOT mean a tablet has fetched or shown it; Ledger cannot know that.
 *   - A hide that has not been published says so ("Hidden in Ledger. The family display has not been updated yet.").
 */
import type { Activity, PublisherConfig } from './config';
import type { ModuleRecord } from '../../core/entities';
import { GRANT_KIND } from '../grants';

export type StatusKind = 'not-configured' | 'configured' | 'pending' | 'publishing' | 'published' | 'failed' | 'disconnected';
export interface Status { kind: StatusKind; label: string; detail: string; tone: 'ok' | 'warn' | 'bad' | 'info' }

export function statusOf(c: PublisherConfig | null, a: Activity): Status {
  if (!c) return { kind: 'not-configured', label: 'Not set up', detail: 'This device is not connected to a family display. Nothing is published.', tone: 'info' };
  if (a.connection === 'rejected') return { kind: 'disconnected', label: 'Disconnected', detail: 'GitHub refused this device’s key or cannot find the display repository (the key may have been revoked, expired or deleted). Nothing more will be published until you reconnect.', tone: 'bad' };
  if (a.publishing) return { kind: 'publishing', label: 'Publishing…', detail: 'Checking everything is up to date, then sending the display file.', tone: 'info' };
  if (!c.reviewedAt) return { kind: 'configured', label: 'Set up, not published', detail: 'Connected. Review what the display will show, then confirm, before anything is published.', tone: 'info' };
  const last = a.lastAttempt;
  if (last && (last.outcome === 'failed' || last.outcome === 'blocked') && (!a.lastSuccessAt || last.at >= a.lastSuccessAt)) return { kind: 'failed', label: last.outcome === 'blocked' ? 'Stopped' : 'Failed', detail: last.message, tone: 'bad' };
  if (a.pending) return { kind: 'pending', label: 'Waiting to publish', detail: 'There are changes that have not been published yet.', tone: 'warn' };
  if (a.lastSuccessAt) return { kind: 'published', label: 'Published', detail: 'GitHub confirmed the latest display file. Whether a tablet has picked it up is shown on the tablet.', tone: 'ok' };
  return { kind: 'configured', label: 'Set up, not published', detail: 'Nothing has been published yet.', tone: 'info' };
}

export interface RevocationState {
  /** True while a hide (or the hide-everything switch) is saved in Ledger but not in the last published file. */
  waiting: boolean;
  message: string | null;
}
/** Uses the raw decision rows: a hide whose id is not in the last publication's list has not reached the display file. */
export function revocationOf(rows: Pick<ModuleRecord, 'id' | 'kind' | 'data' | 'module'>[], a: Activity, published: boolean): RevocationState {
  const done = new Set(a.publishedGrantIds);
  const waiting = rows.some((r) => r.kind === GRANT_KIND && !done.has(r.id as number) && (r.data as { decision?: unknown } | null)?.decision !== 'show');
  if (!published) return { waiting: false, message: null };
  if (waiting) return { waiting: true, message: 'Hidden in Ledger. The family display has not been updated yet.' };
  if (a.lastSuccessAt) return { waiting: false, message: 'Your latest privacy choices are in the published file. A tablet that is switched off or offline may still hold an older copy until it reconnects or its saved copy expires.' };
  return { waiting: false, message: null };
}

export function ago(ms: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
}
