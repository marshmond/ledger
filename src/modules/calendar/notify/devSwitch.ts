/**
 * CAL-N1: a DEVELOPMENT-ONLY switch so the notification flow can be tried in a browser without any email service. In a development build the console gets
 * `__ledgerFakeMail('accept' | 'queue' | 'reject' | 'unreachable' | 'lost-reply' | 'quota' | null)`, which installs the test sender (it sends nothing anywhere) or
 * removes it. In a production build `import.meta.env.DEV` is false, so this does nothing and the real app has no transport at all.
 */
import { fakeTransport, setTransport, type FakeMode } from './transport';

declare global { interface Window { __ledgerFakeMail?: (mode: FakeMode | null) => void } }

export function installDevSwitch(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  window.__ledgerFakeMail = (mode) => setTransport(mode ? fakeTransport(mode) : null);
}
