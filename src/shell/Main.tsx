import type { ReactNode } from 'react';

/** The id the skip link and the route-change focus point at. Every screen has exactly one `main` landmark with this id. */
export const MAIN_ID = 'main-content';

/**
 * The page's `main` landmark. `tabIndex={-1}` lets the skip link and the route-change focus move focus here without putting the
 * landmark in the Tab order. Every module and Ledger's own shell use this instead of writing `<main>` themselves, so there is only ever one.
 */
export default function Main({ className = 'main', children }: { className?: string; children: ReactNode }) {
  return <main id={MAIN_ID} tabIndex={-1} className={className}>{children}</main>;
}
