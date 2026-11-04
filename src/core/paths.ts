/**
 * Page-address helpers with no React in them, so they can be tested on their own.
 * A module's pages live under its own prefix (Ledger: `#/ledger/budget`). Pages inside a module still say `/budget`; the
 * router wrappers (see router.tsx) add the prefix, so there is exactly one place that knows where a module lives.
 */

/** Addresses that belong to the app shell itself, never to a module. */
export const SHELL_PATHS = ['/settings'];

const isUnder = (base: string, p: string) => p === base || p.startsWith(`${base}/`) || p.startsWith(`${base}?`) || p.startsWith(`${base}#`);

/** Puts a module's prefix in front of an address written as `/budget`. Addresses already prefixed, or the shell's own, are left alone. */
export function withBasePath(base: string, path: string): string {
  if (!base || !path.startsWith('/')) return path;
  if (isUnder(base, path) || SHELL_PATHS.some((s) => isUnder(s, path))) return path;
  return path === '/' ? base : base + path;
}

/** The reverse: `/ledger/budget` seen from inside Ledger is `/budget`. */
export function stripBasePath(base: string, pathname: string): string {
  if (!base || !isUnder(base, pathname)) return pathname;
  return pathname.slice(base.length) || '/';
}
