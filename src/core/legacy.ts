/** Where an address from before modules existed (#/budget, #/account/12?x=1) now lives. Pure, so it is tested without a browser. */
export function legacyTarget(
  pathname: string,
  search: string,
  mods: readonly { id: string; routePaths: string[] }[],
  fallbackModule: string,
): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return `/${fallbackModule}${search}`;
  const owner = mods.find((m) => m.routePaths.some((r) => r !== '/' && matches(r, p)));
  return `/${(owner ?? mods.find((m) => m.id === fallbackModule) ?? mods[0]).id}${owner ? p : ''}${search}`;
}

/** Does a route pattern like /account/:id match a path like /account/7? */
function matches(pattern: string, path: string): boolean {
  const a = pattern.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}
