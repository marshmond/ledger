/** Where an address from before modules existed (#/budget, #/account/12?x=1) now lives. Pure, so it is tested without a browser. */
export function legacyTarget(
  pathname: string,
  search: string,
  mods: readonly { id: string; routePaths: string[] }[],
  fallbackModule: string,
): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  // The module to use when the address names none. A module that is not registered (a stale setting) is replaced by the first one.
  const landing = (mods.find((m) => m.id === fallbackModule) ?? mods[0])?.id ?? fallbackModule;
  if (p === '/') return `/${landing}${search}`;
  // Only modules with real pages of their own can own an old address. A module whose only route is "/" (Calendar, Tasks, Today)
  // never claims one, so an unknown address goes to the landing module rather than into a single-page module's sub-address.
  const owner = mods.find((m) => m.routePaths.some((r) => r !== '/' && matches(r, p)));
  return owner ? `/${owner.id}${p}${search}` : `/${landing}${search}`;
}

/** Does a route pattern like /account/:id match a path like /account/7? */
function matches(pattern: string, path: string): boolean {
  const a = pattern.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}
