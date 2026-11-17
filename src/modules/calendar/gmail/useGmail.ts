import { useSyncExternalStore } from 'react';
import { getGmailState, subscribeGmail, type GmailState } from './auth';

/** The current Gmail connection state, kept current for a screen. Reading it connects nothing. */
export function useGmailState(): GmailState {
  return useSyncExternalStore(subscribeGmail, getGmailState, getGmailState);
}
