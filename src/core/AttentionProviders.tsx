import type { ReactNode } from 'react';
import { allAttentionSources } from './registry';

/**
 * Wraps `children` in every module's attention Provider (a source whose reader needs shared state, such as Ledger's one copy of its alert hook). Provided through
 * the registry so the screen that shows "Needs you" never imports a module. A module without a Provider adds nothing; the order is the registry's.
 */
export function AttentionProviders({ today, children }: { today: string; children: ReactNode }) {
  const providers = allAttentionSources().flatMap((s) => (s.source.Provider ? [s.source.Provider] : []));
  return <>{providers.reduceRight<ReactNode>((inner, P) => <P today={today}>{inner}</P>, children)}</>;
}
