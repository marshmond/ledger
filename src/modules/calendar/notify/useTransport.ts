import { useSyncExternalStore } from 'react';
import { getGmailState, subscribeGmail } from '../gmail/auth';
import { getTransport, type NoticeTransport } from './transport';

/**
 * The sender to use right now (null when sending is not connected), kept current: a screen that is open when Gmail is connected, disconnected or
 * runs out of time updates by itself. It only READS who may send; it never connects, sends or records anything.
 */
export function useTransport(): NoticeTransport | null {
  useSyncExternalStore(subscribeGmail, getGmailState, getGmailState);
  return getTransport();
}
