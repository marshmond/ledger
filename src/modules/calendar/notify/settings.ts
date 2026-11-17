/**
 * CAL-N1: how the owner appears on a notification. One record in the existing `settings` table (so it is in backups and syncs like the Calendar's own
 * settings). Nothing here is a credential: the sender ADDRESS and any email-provider key belong to the sender service, never to this record.
 */
import { db, type FinanceDB } from '../../../db';
import { validEmail } from '../../../core/contacts';

export interface NoticeSettings {
  /** The owner's name as recipients see it ("Sent from Ledger by ..."). Required before anything can be approved. */
  senderName: string;
  /** Where a reply should go. Optional; when empty, the message does not invite a reply. */
  replyTo: string;
}

const KEY = 'calendarNotices';
export const EMPTY_NOTICE_SETTINGS: NoticeSettings = { senderName: '', replyTo: '' };

export function normalizeNoticeSettings(raw: unknown): NoticeSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<NoticeSettings>;
  const name = typeof r.senderName === 'string' ? r.senderName.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  const reply = typeof r.replyTo === 'string' ? r.replyTo.trim() : '';
  return { senderName: name, replyTo: reply && validEmail(reply) ? reply : '' };
}

export async function loadNoticeSettings(d: FinanceDB = db): Promise<NoticeSettings> {
  return normalizeNoticeSettings((await d.settings.get(KEY))?.value);
}

export async function saveNoticeSettings(next: NoticeSettings, d: FinanceDB = db): Promise<NoticeSettings> {
  const clean = normalizeNoticeSettings(next);
  const old = await loadNoticeSettings(d);
  if (old.senderName !== clean.senderName || old.replyTo !== clean.replyTo) await d.settings.put({ key: KEY, value: clean });
  return clean;
}
